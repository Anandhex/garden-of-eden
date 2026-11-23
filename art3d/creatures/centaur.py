"""Centaur: human upper body (base body snapshot, Torso/Arms/Hands/Head + face parts) on the Quaternius horse body + rig.

    Blender -b -P art3d/creatures/centaur.py

Generic rig: horse AnimalArmature (legs, spine, tail) + the human bones from Spine upward, parented to the horse's Torso3.
Horse animations drive the horse half; the human upper body follows Torso3 (add arm/head animation on top in Unity with an
avatar mask on the human bones).
"""
import bpy, bmesh, sys, os, math, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
import lib
from lib import *
import animals
import monsters
import wings

NAME = "centaur"
HORSE_DEL = ["Neck1", "Neck2", "Neck3", "Head", "Ear1.L", "Ear2.L", "Ear3.L", "Ear4.L", "Ear1.R", "Ear2.R", "Ear3.R", "Ear4.R"]
HUMAN_DROP_MESH = ["Mesh_Legs", "Mesh_Feet"]
HUMAN_BONES_DROP = ("Hips", "LeftUpperLeg", "RightUpperLeg", "LeftLowerLeg", "RightLowerLeg", "LeftFoot", "RightFoot", "LeftToes", "RightToes")


def main():
    arm, horse = animals.load_pack(os.path.join(animals.QA, "Horse.fbx"), NAME)
    horse.name = NAME + "_Horse"
    # ---- cut the horse's neck/head away
    idx = {vg.index: vg.name for vg in horse.vertex_groups}
    kill = set()
    for v in horse.data.vertices:
        if v.groups:
            g = max(v.groups, key=lambda g: g.weight)
            if idx[g.group] in HORSE_DEL:
                kill.add(v.index)
    bm = bmesh.new(); bm.from_mesh(horse.data)
    bm.verts.ensure_lookup_table()
    bmesh.ops.delete(bm, geom=[bm.verts[i] for i in kill], context='VERTS')
    # close the hole at the chest
    border = [e for e in bm.edges if e.is_boundary]
    if border:
        bmesh.ops.holes_fill(bm, edges=border, sides=64)
    bm.to_mesh(horse.data); bm.free()
    for n in HORSE_DEL:
        vg = horse.vertex_groups.get(n)
        if vg:
            horse.vertex_groups.remove(vg)
    nb = arm.data.bones["Neck1"]
    base_pt = nb.head_local.copy()
    withers = animals.withers_z(horse, groups=("Torso", "Torso2", "Torso3", "Back", "FrontShoulder.L", "FrontShoulder.R"))
    # remove horse neck/head bones
    activate(arm); mode('EDIT')
    for n in HORSE_DEL:
        eb = arm.data.edit_bones.get(n)
        if eb:
            arm.data.edit_bones.remove(eb)
    mode('OBJECT')
    for a in bpy.data.actions:
        for fc in list(a.fcurves):
            if fc.data_path.startswith('pose.bones["'):
                bn = fc.data_path.split('"')[1]
                if bn in HORSE_DEL:
                    a.fcurves.remove(fc)
    # ---- human upper body
    before = set(bpy.data.objects)
    bpy.ops.import_scene.fbx(filepath=monsters.SNAP)
    new = [o for o in bpy.data.objects if o not in before]
    harm = next(o for o in new if o.type == 'ARMATURE')
    keepn = ["Mesh_Head", "Mesh_Torso", "Mesh_Arms", "Mesh_Hands", "Part_Eye_L", "Part_Eye_R", "Part_Ear_L", "Part_Ear_R", "Part_Nose"]
    hm = {}
    for o in new:
        if o.type == 'EMPTY' or (o.type == 'MESH' and o.name not in keepn):
            bpy.data.objects.remove(o)
        elif o.type == 'MESH':
            hm[o.name] = o
    hmeshes = list(hm.values())
    monsters.drop_keys(hmeshes)
    # merge Hips weights into Spine
    for m in hmeshes:
        vg_h = m.vertex_groups.get("Hips")
        if vg_h:
            sp = m.vertex_groups.get("Spine") or m.vertex_groups.new(name="Spine")
            for v in m.data.vertices:
                for g in v.groups:
                    if g.group == vg_h.index:
                        sp.add([v.index], g.weight, 'ADD')
            m.vertex_groups.remove(vg_h)
        for n in HUMAN_BONES_DROP:
            vg = m.vertex_groups.get(n)
            if vg:
                m.vertex_groups.remove(vg)
    activate(harm); mode('EDIT')
    for n in HUMAN_BONES_DROP:
        eb = harm.data.edit_bones.get(n)
        if eb:
            harm.data.edit_bones.remove(eb)
    mode('OBJECT')
    # scale + place the human: waist ring (z .855) lands on the horse's neck base, a bit sunk in
    hs = 1.2 / 0.4144           # human is 1.2x life size in the final export (horse scale 0.4144)
    waist = Vector((0, -0.009, 0.855))
    target = Vector((0, base_pt.y + 0.15, base_pt.z - 0.1))
    for m in hmeshes:
        for v in m.data.vertices:
            v.co = (v.co - waist) * hs + target
        m.data.update()
    activate(harm); mode('EDIT')
    orig = {b.name: (b.head.copy(), b.tail.copy()) for b in harm.data.edit_bones}
    for b in harm.data.edit_bones:
        b.head = (orig[b.name][0] - waist) * hs + target
        b.tail = (orig[b.name][1] - waist) * hs + target
    mode('OBJECT')
    # skin atlas + materials
    spec = dict(skin="#c9987a", seed=41, iris="#5a7a8a", iris_rim="#2a3a44", pupil=(0.04, 0.04), sclera="#ece4d0", brow_h=0.04, brow_w=0.006,
                mouth_w=0.03, lip="#9a5a50", line="#3a2a22", hair="#4a3426", horn="#cfc4aa", spine="#7a6a50", belly="#c9987a")
    img = monsters.paint_atlas(spec, NAME)
    mat = monsters.textured_mat(NAME + "_Skin", img)
    for m in hmeshes:
        for s in m.material_slots:
            s.material = mat
        m.name = NAME + "_" + m.name.replace("Mesh_", "").replace("Part_", "")
    # coat colours for the horse
    set_slot_colors(horse, {"Main_Dark": "#5a3d2c", "Main_Light": "#957159", "Main": "#7b5239", "Hooves": "#3b332d", "Hair": "#2e2723",
                            "Muzzle": "#6a5243", "Eye": "#241e1a"})
    # ---- join the armatures (horse armature is active) and attach the human Spine to Torso3
    for m in hmeshes:
        for mod in list(m.modifiers):
            if mod.type == 'ARMATURE':
                m.modifiers.remove(mod)
    deselect()
    harm.select_set(True); arm.select_set(True)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.join()
    arm = bpy.context.view_layer.objects.active
    activate(arm); mode('EDIT')
    sp = arm.data.edit_bones["Spine"]
    sp.parent = arm.data.edit_bones["Torso3"]
    mode('OBJECT')
    for m in hmeshes:
        m.parent = arm
        mod = m.modifiers.new("Armature", 'ARMATURE'); mod.object = arm
    horse.parent = arm
    # hair + mane (generated parts)
    head = arm.data.bones["Head"]
    hh, ht = head.head_local, head.tail_local
    hair_mat = make_mat("centaur_hair", srgb("#3e2e22"))
    parts = []
    hv = [m for m in hmeshes if m.name.endswith("_Head")][0]
    xs = [v.co for v in hv.data.vertices]
    mnx, mxx = min(c.x for c in xs), max(c.x for c in xs)
    mny, mxy = min(c.y for c in xs), max(c.y for c in xs)
    mnz, mxz = min(c.z for c in xs), max(c.z for c in xs)
    w_, d_, h_ = mxx - mnx, mxy - mny, mxz - mnz
    cap = ellipsoid_mesh("centaur_HairCap", ((mnx + mxx) / 2, mny + d_ * 0.58, mxz - h_ * 0.30), (w_ * 0.55, d_ * 0.52, h_ * 0.36), seg=12, rings=7, mat=hair_mat)
    weight_all(cap, "Head", arm); parts.append(cap)
    nk = arm.data.bones["Neck"].head_local
    pts = [hh + Vector((0, 0.3, 0.15)), hh + Vector((0, 0.5, -0.2)), nk + Vector((0, 0.45, -0.1)), nk + Vector((0, 0.5, -0.9))]
    mane = tube("centaur_Mane", arm, pts, [0.2, 0.17, 0.14, 0.05], ["Head", "Neck", "Neck"], hair_mat, sides=8)
    parts.append(mane)
    # belt / junction collar in horse coat colour so the join reads as one body
    # horse mane remains cut with the neck: add a short mane ridge on the withers
    allm = [horse] + hmeshes + parts
    monsters.unify_normals(hmeshes)
    smooth_normals([horse] + parts)
    # scale: the horse is 1.5 m at the withers
    s = 1.50 / animals.withers_z(horse)
    bake_scale(arm, allm, s)
    arm.name = "Armature"; arm.data.name = "Armature"
    out = os.path.join(EXPORT, NAME + ".fbx")
    export_fbx(out, [arm] + allm, 1.0, True)
    tris = sum(tri_count(o) for o in allm)
    meta = {NAME: dict(kind="centaur", tris=tris, bones=len(arm.data.bones), size_kb=os.path.getsize(out) // 1024,
                       parts=[o.name for o in allm], anims=sorted(a.name for a in bpy.data.actions), rig="Generic (horse + human upper body)")}
    p = os.path.join(EXPORT, "monsters_meta.json")
    old = json.load(open(p)) if os.path.exists(p) else {}
    old.update(meta); json.dump(old, open(p, "w"), indent=1)
    if os.environ.get("KEEP_BLEND"):
        os.makedirs(os.path.join(HERE, "blend"), exist_ok=True)
        bpy.ops.wm.save_as_mainfile(filepath=os.path.join(HERE, "blend", NAME + ".blend"))
    print("BUILT", NAME, meta[NAME])


main()
