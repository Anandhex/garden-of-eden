import bpy, json, numpy as np, sys, math
from mathutils import Vector
OUT=sys.argv[sys.argv.index('--')+1]
META=json.load(open(bpy.path.abspath("//export/base_body_meta.json")))
def ev(n):
    dg=bpy.context.evaluated_depsgraph_get(); o=bpy.data.objects[n].evaluated_get(dg); me=o.to_mesh()
    P=np.array([(o.matrix_world@v.co)[:] for v in me.vertices]); o.to_mesh_clear(); return P
def setk(w):
    for o in bpy.data.objects:
        if o.type=='MESH' and o.data.shape_keys:
            for k in o.data.shape_keys.key_blocks[1:]: k.value=w.get(k.name,0.0)
arm=bpy.data.objects["Armature"]; arm.data.pose_position='REST'
sc=bpy.context.scene
sc.render.engine='BLENDER_WORKBENCH'; sc.display.shading.light='STUDIO'; sc.display.shading.color_type='SINGLE'; sc.display.shading.single_color=(0.8,0.62,0.52); sc.display.shading.show_cavity=True
sc.render.resolution_x=sc.render.resolution_y=800; sc.render.film_transparent=False
cam=bpy.data.objects.new("lc",bpy.data.cameras.new("lc")); sc.collection.objects.link(cam); sc.camera=cam; cam.data.type='ORTHO'
show=("Mesh_Head","Part_Nose","Part_Ear_L","Part_Ear_R","Part_Eye_L","Part_Eye_R","Mesh_Torso")
for o in bpy.data.objects:
    if o.type=='MESH': o.hide_render = o.name not in show
res={}
for tag,sex in (("f",1.0),("m",0.0)):
    setk({"Sex":sex}); bpy.context.view_layer.update()
    H=ev("Mesh_Head"); N=ev("Part_Nose"); E=ev("Part_Ear_L")
    lm=META["faceLandmarkVerts"]; hv=lambda k:(H if lm[k]["mesh"]=="Mesh_Head" else N)[lm[k]["vertex"]]
    top=H[:,2].max(); fr=H[(np.abs(H[:,0])<0.02)&(H[:,1]<H[:,1].mean()-0.02)]; chin=fr[:,2].min(); hh=top-chin
    ci,co=hv("canthusInner_L"),hv("canthusOuter_L"); eyez=(ci[2]+co[2])/2
    # brow ridge: most forward point over the eye centre column, above the upper lid
    lu=hv("lidUpper_L"); col=H[(np.abs(H[:,0]-(ci[0]+co[0])/2)<0.008)&(H[:,2]>lu[2]+0.004)&(H[:,2]<lu[2]+0.05)&(H[:,1]<-0.05)]
    brow=col[np.argmin(col[:,1])]
    mid=H[(np.abs(H[:,0])<0.006)&(H[:,1]<-0.05)]
    sub=N[np.abs(N[:,0])<0.004][:,2].min(); ntip=N[np.argmin(N[:,1])]
    lipc=hv("lipUpperContact"); mc=hv("mouthCorner_L")
    eart,earb=E[:,2].max(),E[:,2].min(); earf,earbk=E[:,1].min(),E[:,1].max()
    yfront=mid[:,1].min(); yback=H[:,1].max(); depth=yback-min(yfront,ntip[1])
    width=max(np.ptp(H[np.abs(H[:,2]-z)<0.006][:,0]) for z in np.arange(chin+0.08,top-0.02,0.005))
    f=lambda z:(top-z)/hh
    r=dict(head_h=hh,brow_line=f(brow[2]),eye_line=f(eyez),nose_tip=f(ntip[2]),nose_base=f(sub),mouth_line=f(lipc[2]),chin=1.0,ear_top=f(eart),ear_bottom=f(earb),ear_h=(eart-earb)/hh,
           eye_between_brow_and_nose=(brow[2]-eyez)/(brow[2]-sub),mouth_between_nose_and_chin=(sub-lipc[2])/(sub-chin),lower_over_middle_third=(sub-chin)/(brow[2]-sub),
           head_w_over_h=width/hh,head_depth_over_h=(yback-yfront)/hh,ear_front_depth_frac=(earf-yfront)/(yback-yfront),ear_centre_depth_frac=((earf+earbk)/2-yfront)/(yback-yfront),
           eye_w_over_head_w=float(np.linalg.norm(co-ci))/width,inter_over_head_w=abs(ci[0])*2/width,nose_w_over_head_w=float(np.ptp(N[:,0]))/width,mouth_w_over_head_w=abs(mc[0])*2/width,
           pupil_dist_over_head_w=(ci[0]+co[0])/width)
    res[tag]={k:round(float(v),3) for k,v in r.items()}
    cz=(top+chin)/2; Sc=hh*1.5; cam.data.ortho_scale=Sc
    geo=dict(top=top,chin=chin,cz=cz,S=Sc,yfront=float(yfront),yback=float(yback),cy=float((yfront+yback)/2),brow=float(brow[2]),eye=float(eyez),sub=float(sub),lip=float(lipc[2]),eart=float(eart),earb=float(earb),earf=float(earf),earbk=float(earbk),width=float(width),ntip=[float(x) for x in ntip])
    res[tag+"_geo"]=geo
    cam.location=(0,-5,cz); cam.rotation_euler=(math.pi/2,0,0); sc.render.filepath=f"{OUT}/round7_{tag}_front_raw.png"; bpy.ops.render.render(write_still=True)
    cam.location=(5,geo["cy"],cz); cam.rotation_euler=(math.pi/2,0,math.pi/2); sc.render.filepath=f"{OUT}/round7_{tag}_side_raw.png"; bpy.ops.render.render(write_still=True)
json.dump(res,open(OUT+"/round7_loomis_measure.json","w"),indent=1); print(json.dumps({k:v for k,v in res.items() if not k.endswith("_geo")},indent=1))
