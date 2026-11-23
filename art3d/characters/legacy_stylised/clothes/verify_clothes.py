"""Poke-through / orientation test of every garment and every outfit on extreme shape stacks.

    /Applications/Blender.app/Contents/MacOS/Blender -b art3d/characters/clothes/clothes.blend -P art3d/characters/clothes/verify_clothes.py
Writes export/poke_report.json and prints a summary.
 A  garment vertices that end up inside the (deformed) body surface           (hidden body regions are still the reference)
 B  visible body vertices that end up outside / through a garment worn on them (regions the garment hides are skipped)
 C  inner garment vertices that pass through a garment worn over them (same outfit)
"""
import bpy, os, sys, json
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

HERE = os.path.dirname(os.path.abspath(__file__))
M = json.load(open(os.path.join(HERE, "export", "clothes_manifest.json")))
P = {p["id"]: p for p in M["pieces"]}
STACKS = {
    "neutral": {}, "heavy_belly": dict(Heavy=1.0, Belly=1.0, Waist_Wide=0.6, Butt=0.5), "thin": dict(Thin=1.0, Height_Legs=0.6),
    "breast_curvy": dict(Sex=1.0, Breast=1.0, Waist_Slim=1.0, Hips=1.0, Butt=1.0),
    "muscle": dict(Muscle=1.0, Shoulders=1.0, Chest_Muscle=1.0, Arms_Thick=1.0, Legs_Thick=1.0),
    "dwarf": dict(Species_Dwarf=1.0, Heavy=0.6), "halfling": dict(Species_Halfling=1.0, Belly=0.7),
    "orc": dict(Species_Orc=1.0, Muscle=1.0, Chest_Muscle=1.0), "old_heavy": dict(Age_Old=1.0, Heavy=0.8, Belly=0.8, Sex=1.0, Breast=0.6),
    "child": dict(Child=1.0), "elf_tall": dict(Species_Elf=1.0, Thin=0.5, Sex=1.0, Breast=0.5),
}
RANK = {"base": 0, "over": 1}
SLOTRANK = {"overlay": 2, "headwear": 1, "skirt": 1}
CLOAKS = {"o_cloak_long", "o_cape_short"}


def rank(pid):
    p = P[pid]
    if pid in CLOAKS:
        return 3
    if p["slot"] in SLOTRANK:
        return SLOTRANK[p["slot"]]
    return RANK[p["layer"]]


def setkeys(obs, kw):
    for ob in obs:
        if ob.data.shape_keys:
            for kb in ob.data.shape_keys.key_blocks[1:]:
                kb.value = kw.get(kb.name, 0.0)
    bpy.context.view_layer.update()


def evalco(ob, dg):
    e = ob.evaluated_get(dg)
    me = e.to_mesh()
    co = np.empty(len(me.vertices) * 3)
    me.vertices.foreach_get("co", co)
    polys = [tuple(p.vertices) for p in me.polygons]
    e.to_mesh_clear()
    return co.reshape(-1, 3), polys


def bvh_of(co, polys):
    return BVHTree.FromPolygons([tuple(c) for c in co], polys)


def boundary_verts(polys):
    cnt = {}
    for p in polys:
        for a, b in zip(p, p[1:] + p[:1]):
            e = (min(a, b), max(a, b))
            cnt[e] = cnt.get(e, 0) + 1
    return {v for e, c in cnt.items() if c == 1 for v in e}


def main():
    G = {o.name: o for o in bpy.data.collections["Clothes"].objects}
    W = bpy.data.objects["Body_Welded_Source"]
    allobs = [W] + list(G.values())
    for o in G.values():
        o.hide_viewport = False
        o.hide_render = False
    W.hide_viewport = False
    W.hide_set(False)
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    # region of each welded vertex
    sys.path.insert(0, os.path.dirname(HERE))
    sys.path.insert(0, HERE)
    import clothes_lib as L
    B = L.Body()
    reg_of = {}
    for r in ("torso", "arms", "hands", "legs", "feet"):
        for v in B.pv[r]:
            reg_of.setdefault(v, r)
    wreg = np.array([reg_of.get(i, "head") for i in range(B.n)])
    report = {"garments": {}, "outfits": {}}
    worst = {}
    for sname, kw in STACKS.items():
        setkeys(allobs, kw)
        dg = bpy.context.evaluated_depsgraph_get()
        bco, bpolys = evalco(W, dg)
        btris = [tuple(t) for t in B.tris]
        bbvh = BVHTree.FromPolygons([tuple(c) for c in bco], btris)
        from mathutils import kdtree
        seamv = sorted(B.allseam)
        skd = kdtree.KDTree(len(seamv))
        for k, i in enumerate(seamv):
            skd.insert(bco[i], k)
        skd.balance()
        nearseam = lambda v: skd.find(Vector(v))[2] < 0.035
        gdata = {}
        for pid, o in G.items():
            co, polys = evalco(o, dg)
            gdata[pid] = (co, polys, bvh_of(co, polys), boundary_verts(polys))
        # A: garment verts vs body
        for pid, (co, polys, bv, bnd) in gdata.items():
            sd = []
            for v in co:
                loc, nor, idx, dist = bbvh.find_nearest(Vector(v), 0.05)
                if loc is None or nearseam(v):
                    continue
                sd.append((Vector(v) - loc).dot(nor) if dist > 1e-6 else 0.0)
            sd = np.array(sd) if sd else np.array([1.0])
            nin = int((sd < -0.008).sum())
            r = report["garments"].setdefault(pid, {})
            r[sname] = dict(minSD=round(float(sd.min()), 4), inside=nin)
            # B: body verts poking through garment
            hides = set(P[pid]["hides"])
            cnt = 0
            vis = np.where(~np.isin(wreg, list(hides)))[0] if hides else np.arange(B.n)
            for vi in vis:
                v = bco[vi]
                loc, nor, idx, dist = bv.find_nearest(Vector(v), 0.012)
                if loc is None:
                    continue
                if any(i in bnd for i in polys[idx]) or nearseam(v):
                    continue
                if (Vector(v) - loc).dot(nor) > 0.004:
                    cnt += 1
            r[sname]["bodyThrough"] = cnt
            if sname == "neutral":
                inw = tot = 0
                for pi, pl in enumerate(polys):
                    c = np.mean([co[i] for i in pl], axis=0)
                    loc, nor, idx, dist = bbvh.find_nearest(Vector(c), 0.06)
                    if loc is None:
                        continue
                    n = np.zeros(3)
                    a, b2, c2 = [co[i] for i in pl[:3]]
                    n = np.cross(b2 - a, c2 - a)
                    tot += 1
                    if np.dot(n, c - np.array(loc)) < 0:
                        inw += 1
                r[sname]["inwardFaces"] = f"{inw}/{tot}"
            worst[(pid, sname)] = (nin, cnt)
        # C: outfits
        for o in M["outfits"]:
            ids = o["pieces"]
            c = 0
            detail = {}
            for a in ids:
                for b in ids:
                    if a == b or rank(a) >= rank(b):
                        continue
                    if b in CLOAKS and P[a]["slot"] in ("arms", "hands"):
                        continue
                    cob, polyb, bvb, bndb = gdata[b]
                    n = 0
                    for v in gdata[a][0]:
                        loc, nor, idx, dist = bvb.find_nearest(Vector(v), 0.015)
                        if loc is None or any(i in bndb for i in polyb[idx]) or nearseam(v):
                            continue
                        if (Vector(v) - loc).dot(nor) > 0.004:
                            n += 1
                    if n:
                        detail[f"{a} through {b}"] = n
                        c += n
            report["outfits"].setdefault(o["id"], {})[sname] = dict(total=c, detail=detail)
        print("stack", sname, "done")
    # summary
    tot_in = {p: sum(report["garments"][p][s]["inside"] for s in STACKS) for p in report["garments"]}
    tot_bt = {p: sum(report["garments"][p][s]["bodyThrough"] for s in STACKS) for p in report["garments"]}
    print("garment verts inside body (all stacks):", {k: v for k, v in tot_in.items() if v})
    print("visible body through garment (all stacks):", {k: v for k, v in tot_bt.items() if v})
    oc = {o: sum(report["outfits"][o][s]["total"] for s in STACKS) for o in report["outfits"]}
    print("faces whose normal points into the body (neutral, within 6 cm):", {p: report["garments"][p]["neutral"]["inwardFaces"] for p in report["garments"] if int(report["garments"][p]["neutral"]["inwardFaces"].split("/")[0]) > 0.05 * max(1, int(report["garments"][p]["neutral"]["inwardFaces"].split("/")[1]))})
    print("outfit layer pokes:", {k: v for k, v in oc.items() if v})
    report["summary"] = dict(garmentInside=tot_in, bodyThrough=tot_bt, outfitLayerPokes=oc)
    json.dump(report, open(os.path.join(HERE, "export", "poke_report.json"), "w"), indent=1)


main()
