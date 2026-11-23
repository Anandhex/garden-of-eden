import bpy, json, numpy as np, sys
OUT=sys.argv[sys.argv.index('--')+1]
META=json.load(open(bpy.path.abspath("//export/base_body_meta.json")))
def ev(n):
    dg=bpy.context.evaluated_depsgraph_get(); o=bpy.data.objects[n].evaluated_get(dg); me=o.to_mesh()
    P=np.array([(o.matrix_world@v.co)[:] for v in me.vertices])
    if n in DENSE:
        me.calc_loop_triangles(); T=np.array([t.vertices[:] for t in me.loop_triangles]); a,b,c=P[T[:,0]],P[T[:,1]],P[T[:,2]]
        out=[P]
        k=6
        for i in range(k+1):
            for j in range(k+1-i):
                u,v=i/k,j/k; out.append(a*u+b*v+c*(1-u-v))
        P=np.concatenate(out)
    o.to_mesh_clear(); return P
DENSE=('Mesh_Torso','Mesh_Legs','Mesh_Arms')
def setk(w):
    for o in bpy.data.objects:
        if o.type=='MESH' and o.data.shape_keys:
            for k in o.data.shape_keys.key_blocks[1:]: k.value=w.get(k.name,0.0)
bpy.data.objects["Armature"].data.pose_position='REST'
def W(P,z,h=0.008,ax=0,cond=None):
    m=np.abs(P[:,2]-z)<h
    if cond is not None: m&=cond
    return float(P[m,ax].max()-P[m,ax].min()) if m.any() else 0.0
def measure(sex):
    setk({"Sex":sex}); bpy.context.view_layer.update()
    E={n:ev(n) for n in ["Mesh_Head","Mesh_Torso","Mesh_Arms","Mesh_Hands","Mesh_Legs","Mesh_Feet","Part_Nose","Part_Ear_L","Part_Eye_L"]}
    H,T,L,Ft,A,Hd=E["Mesh_Head"],E["Mesh_Torso"],E["Mesh_Legs"],E["Mesh_Feet"],E["Mesh_Arms"],E["Mesh_Hands"]
    allv=np.concatenate([H,T,L,Ft]); z0,z1=allv[:,2].min(),allv[:,2].max(); ht=z1-z0
    front=H[H[:,1]<H[:,1].mean()-0.02]; chin=front[np.abs(front[:,0])<0.02][:,2].min()
    hh=z1-chin
    lm=META["faceLandmarkVerts"]; hv=lambda k:E[lm[k]["mesh"]][lm[k]["vertex"]]
    ci,co,lu,ll=hv("canthusInner_L"),hv("canthusOuter_L"),hv("lidUpper_L"),hv("lidLower_L")
    eyez=(ci[2]+co[2])/2
    # skull width w/o ears at eye level and max
    headw=max(W(H,z) for z in np.arange(chin+0.08,z1-0.02,0.005))
    facew=W(H,eyez-0.02,cond=H[:,1]<H[:,1].mean())  # cheekbone level
    mc=hv("mouthCorner_L"); mcr=hv("mouthCorner_R"); mz=mc[2]
    jaww=W(H,mz-0.012,cond=H[:,1]<-0.02)   # jaw width just below mouth
    chinw=W(H,chin+0.012,cond=H[:,1]<-0.04)
    N=E["Part_Nose"]; nosew=N[:,0].max()-N[:,0].min(); sub=N[np.abs(N[:,0])<0.004][:,2].min(); ntip=N[:,1].min()
    ear=E["Part_Ear_L"]
    TL=np.concatenate([T,L])
    crotch=T[np.abs(T[:,0])<0.004][:,2].min()
    zs=np.arange(crotch-0.05,T[:,2].max(),0.005)
    wx=np.array([W(TL,z) for z in zs]); 
    # torso only above crotch+0.03 for waist
    neckbase=float(np.median(T[T[:,2]>T[:,2].max()-0.01][:,2]))
    torso_top=T[:,2].max()
    # hip: max width between crotch-0.02 and crotch+0.15
    m=(zs>crotch-0.02)&(zs<crotch+0.16); hip_i=np.argmax(np.where(m,wx,0)); hipw,hipz=wx[hip_i],zs[hip_i]
    # waist: min torso width between hip+0.08 and hip+0.30
    zt=np.arange(hipz+0.08,hipz+0.32,0.005); wt=np.array([W(T,z,cond=np.abs(T[:,0])<0.2) for z in zt]); wi=np.argmin(wt); waistw,waistz=wt[wi],zt[wi]
    waistd=W(T,waistz,ax=1); hipd=W(TL,hipz,ax=1)
    # bust/chest: max depth between waist+0.1 and neckbase-0.08
    zb=np.arange(waistz+0.08,neckbase-0.08,0.005); db=np.array([W(T,z,ax=1,cond=np.abs(T[:,0])<0.15) for z in zb]); bi=np.argmax(db); bustd,bustz=db[bi],zb[bi]
    bustw=W(T,bustz,cond=np.abs(T[:,0])<0.19)
    shw=float(2*np.abs(T[T[:,2]>neckbase-0.14][:,0]).max())
    # neck min width between chin-0.01 and neckbase
    HN=np.concatenate([H,T]); zn=np.arange(neckbase+0.01,chin-0.005,0.004); nw=[W(HN,z,h=0.006,cond=np.abs(HN[:,0])<0.09) for z in zn]; neckw=min([x for x in nw if x>0.03])
    LMK=META["landmarks"] if sex==0 else META["landmarksFemale"]
    wrist=np.array(LMK["wrist"]); hl=Hd[Hd[:,0]>0]; handlen=float(np.linalg.norm(hl-wrist,axis=1).max())
    knee=LMK["knee"][2]; ankle=LMK["ankle_b"][2]
    Lp=L[L[:,0]>0]
    def lw(z): 
        m=np.abs(Lp[:,2]-z)<0.01; return float(Lp[m,0].max()-Lp[m,0].min()) if m.any() else 0
    thigh=max(lw(z) for z in np.arange(knee+0.12,crotch-0.03,0.01)); calf=max(lw(z) for z in np.arange(ankle+0.1,knee-0.06,0.01))
    kneew=lw(knee); anklew=min(x for x in [lw(z) for z in np.arange(ankle,ankle+0.08,0.01)] if x>0)
    Ap=A[A[:,0]>0]; sh=np.array(LMK["shoulder_b"]); el=np.array(LMK["elbow"])
    armlen=float(np.linalg.norm(el-sh)+np.linalg.norm(wrist-el))
    footlen=float(Ft[:,1].max()-Ft[:,1].min())
    ew=float(np.linalg.norm(co-ci)); eh=float(lu[2]-ll[2])
    inter=float(abs(ci[0])*2)
    r=dict(height=ht,head_h=hh,heads_tall=ht/hh,head_w_over_h=headw/hh,face_w_over_head_h=facew/hh,jaw_w_over_face_w=jaww/facew,chin_w_over_face_w=chinw/facew,
      neck_w_over_head_h=neckw/hh,neck_len_over_head_h=(chin-neckbase)/hh,shoulder_w_over_head_h=shw/hh,bust_w_over_head_h=bustw/hh,bust_depth_over_head_h=bustd/hh,
      waist_w_over_head_h=waistw/hh,hip_w_over_head_h=hipw/hh,waist_over_hip=waistw/hipw,waist_over_shoulder=waistw/shw,hip_over_shoulder=hipw/shw,
      crotch_over_height=(crotch-z0)/ht,knee_over_height=(knee-z0)/ht,thigh_w_over_head_h=thigh/hh,calf_w_over_head_h=calf/hh,knee_w_over_head_h=kneew/hh,ankle_w_over_head_h=anklew/hh,
      arm_len_over_height=armlen/ht,hand_len_over_head_h=handlen/hh,foot_len_over_head_h=footlen/hh,
      eye_w_over_head_h=ew/hh,eye_w_over_face_w=ew/facew,eye_h_over_w=eh/ew,eye_tilt_deg=float(np.degrees(np.arctan2(co[2]-ci[2],co[0]-ci[0]))),inter_over_eye_w=inter/ew,
      iris_d_over_eye_w=2*0.4*META["faceRig"]["eyeRadius"][0]/ew, eyeball_d_over_head_h=2*META["faceRig"]["eyeRadius"][0]/hh,
      eye_line_from_top=(z1-eyez)/hh,nose_w_over_face_w=nosew/facew,nose_w_over_inter=nosew/inter,nose_len_over_head_h=(ci[2]-sub)/hh,nose_proj_over_head_h=float((H[np.abs(H[:,0])<0.01][:,1].min()-ntip))/hh,
      mouth_w_over_face_w=float(abs(mc[0]-mcr[0]))/facew,mouth_w_over_nose_w=float(abs(mc[0]-mcr[0]))/nosew,mouth_z_from_chin_over_head_h=(mz-chin)/hh,subnasale_to_mouth_over_head_h=(sub-mz)/hh,
      ear_h_over_head_h=float(ear[:,2].max()-ear[:,2].min())/hh,ear_stickout_over_head_w=float(ear[:,0].max()-headw/2)/headw)
    return {k:round(float(v),3) for k,v in r.items()}
res={"feminine":measure(1.0),"masculine":measure(0.0)}
json.dump(res,open(OUT,"w"),indent=1); print(json.dumps(res,indent=1))
