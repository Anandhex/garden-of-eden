import bpy, numpy as np, json, sys
out={}
for nm,n in (("feminine","GEO-body_female_realistic"),("masculine","GEO-body_male_realistic")):
    me=bpy.data.objects[n].data
    P=np.array([v.co[:] for v in me.vertices]); fs=np.zeros(len(me.polygons),int); me.attributes[".sculpt_face_set"].data.foreach_get("value",fs)
    def pts(sets):
        o=[]
        for p in me.polygons:
            if fs[p.index] in sets:
                q=P[list(p.vertices)]; o.append(q); o.append((q+np.roll(q,1,0))/2); o.append(q.mean(0,keepdims=True))
        return np.concatenate(o)
    T=pts({1,19,18}); L=pts({23,24}); TL=np.concatenate([T,L]); Hd=pts({17,2,3,7,8,22}); ear=pts({4}); nose=pts({7}); eye=pts({2})
    top=P[:,2].max(); z0=P[:,2].min(); ht=top-z0
    f=Hd[(np.abs(Hd[:,0])<0.02)]; f2=f[f[:,1]<f[:,1].min()+0.05]; chin=f2[:,2].min(); hh=top-chin
    def W(Q,z,h=0.008,ax=0):
        m=np.abs(Q[:,2]-z)<h; return float(Q[m,ax].max()-Q[m,ax].min()) if m.any() else 0
    crotch=T[np.abs(T[:,0])<0.006][:,2].min()
    zs=np.arange(crotch-0.02,crotch+0.16,0.005); w=[W(TL,z) for z in zs]; hipw=max(w); hipz=zs[int(np.argmax(w))]
    zt=np.arange(hipz+0.08,hipz+0.32,0.005); wt=[W(T[np.abs(T[:,0])<0.2],z) for z in zt]; waistw=min(wt)
    shw=2*np.abs(T[:,0]).max()
    headw=max(W(Hd,z) for z in np.arange(chin+0.08,top-0.02,0.005))
    ex=eye[eye[:,0]>0]; ew=ex[:,0].max()-ex[:,0].min()
    r=dict(height=ht,head_h=hh,heads_tall=ht/hh,head_w_over_h=headw/hh,shoulder_w_over_head_h=shw/hh,waist_w_over_head_h=waistw/hh,hip_w_over_head_h=hipw/hh,waist_over_hip=waistw/hipw,
           crotch_over_height=(crotch-z0)/ht,ear_h_over_head_h=float(np.ptp(ear[:,2]))/hh,nose_w_over_head_h=float(np.ptp(nose[:,0]))/hh,eye_set_w_over_head_h=float(ew)/hh)
    out[nm]={k:round(float(v),3) for k,v in r.items()}
print(json.dumps(out,indent=1)); json.dump(out,open(sys.argv[sys.argv.index('--')+1],"w"),indent=1)
