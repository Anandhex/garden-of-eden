import bpy, math, sys, numpy as np
from mathutils import Vector
OUT=sys.argv[sys.argv.index('--')+1]
def find(n):
    k=n.replace(" ","").lower()
    return [o for o in bpy.data.objects if o.name.replace(" ","").lower()==k][0]
names=["GEO-body_female_realistic","GEO-body_male_realistic","GEO-body_female_stylized","GEO-head_animation_realistic","GEO-head_sculpting_realistic","GEO-head_stylized","Jaw - Stylized","Jaw - Realistic","Hand  - Realistic","Eye - Realistic"]
for n in names:
    o=find(n); me=o.data
    fs=[a.name for a in me.attributes]
    info=""
    if ".sculpt_face_set" in me.attributes:
        v=np.zeros(len(me.polygons),int); me.attributes[".sculpt_face_set"].data.foreach_get("value",v); info=f"facesets={len(set(v))}"
    print("INFO",n,fs,info,[ (m.type,getattr(m,'levels',None),getattr(m,'total_levels',None)) for m in o.modifiers], "loc",tuple(round(x,2) for x in o.matrix_world.translation), "bb z",round(min((o.matrix_world@Vector(c)).z for c in o.bound_box),3),round(max((o.matrix_world@Vector(c)).z for c in o.bound_box),3))
sc=bpy.data.scenes.new("r"); bpy.context.window.scene=sc
sc.render.engine='BLENDER_WORKBENCH'; sc.display.shading.light='STUDIO'; sc.display.shading.show_cavity=True; sc.display.shading.color_type='SINGLE'; sc.display.shading.single_color=(0.8,0.62,0.52)
sc.render.resolution_x=700; sc.render.resolution_y=900; sc.render.film_transparent=False
cam=bpy.data.objects.new("c",bpy.data.cameras.new("c")); sc.collection.objects.link(cam); sc.camera=cam; cam.data.type='ORTHO'
def shot(n,tag,yaw,scale_mul=1.1,zfrac=None):
    for o in list(sc.collection.objects):
        if o!=cam: sc.collection.objects.unlink(o)
    o=find(n); n=o.name; sc.collection.objects.link(o)
    for e in bpy.data.objects:
        if e.name.startswith(n+".") : sc.collection.objects.link(e)
    for m in o.modifiers:
        if m.type=='MULTIRES': m.render_levels=min(2,m.total_levels); m.levels=m.render_levels
    bb=[o.matrix_world@Vector(c) for c in o.bound_box]; c=sum(bb,Vector())/8; h=max(b.z for b in bb)-min(b.z for b in bb)
    if zfrac: 
        top=max(b.z for b in bb); c.z=top-h*zfrac/2; h=h*zfrac
    cam.data.ortho_scale=h*scale_mul*700/900*1.3 if False else h*scale_mul
    a=math.radians(yaw); cam.location=c+Vector((math.sin(a)*5,-math.cos(a)*5,0)); cam.rotation_euler=(math.pi/2,0,a)
    sc.render.filepath=f"{OUT}/bundle_{tag}.png"; bpy.ops.render.render(write_still=True)
shot("GEO-body_female_realistic","bf_real_front",0); shot("GEO-body_female_realistic","bf_real_q",-35)
shot("GEO-body_male_realistic","bm_real_front",0)
shot("GEO-body_female_stylized","bf_sty_front",0)
shot("GEO-body_female_realistic","bf_real_head",-35,zfrac=0.19); shot("GEO-body_female_realistic","bf_real_headf",0,zfrac=0.19)
shot("GEO-body_female_stylized","bf_sty_head",-35,zfrac=0.2)
shot("GEO-head_animation_realistic","head_anim_q",-35); shot("GEO-head_stylized","head_sty_q",-35)
shot("Jaw - Stylized","jaw_sty",-35); shot("Jaw - Realistic","jaw_real",-35)
