"""Headless test of the editor kit: every panel operator, and that saves round-trip.  Leaves recipe.json as it was.

    $B -b art3d/characters/mh/editor.blend -P art3d/characters/mh/editor_panel.py -P art3d/characters/mh/test_editor.py
"""
import bpy, os, sys, json, glob, shutil
import numpy as np

HERE = os.path.dirname(os.path.abspath(bpy.data.filepath))
ok = True


def check(c, msg):
    global ok
    print(("PASS " if c else "FAIL ") + msg, flush=True)
    ok &= bool(c)


sc = bpy.context.scene
g = sc.goe
recipe = os.path.join(HERE, "recipe.json")
orig = open(recipe).read()
import time as _t
t_start = _t.time() - 1
try:
    # sliders drive the blend shapes of the active person
    g.person = 'F'
    g.s_eye_gap = 0.5
    head = bpy.data.objects["F_Mesh_Head"]
    check(abs(head.data.shape_keys.key_blocks["Eye_Spacing"].value - 0.5) < 1e-6, "slider 'Eye gap' sets Eye_Spacing on the woman")
    g.s_mouth_width = -0.4
    check(abs(head.data.shape_keys.key_blocks["Mouth_Narrow"].value - 0.4) < 1e-6 and head.data.shape_keys.key_blocks["Mouth_Wide"].value == 0,
          "negative 'Mouth width' uses Mouth_Narrow")
    # preset round trip
    g.preset_name = "_test_preset"
    bpy.ops.goe.save_preset()
    p = json.load(open(os.path.join(HERE, "presets", "_test_preset.json")))
    check(abs(p["sliders"]["Eye gap"] - 0.5) < 1e-4 and abs(p["sliders"]["Mouth width"] + 0.4) < 1e-4, "preset saved with the slider values")
    sys.path.insert(0, HERE)
    import person
    w = person.generate("x", sex="F", preset="_test_preset", sd=0.0, body_sd=0.0)
    check(abs(w.get("Eye_Spacing", 0) - 0.5) < 1e-4 and abs(w.get("Mouth_Narrow", 0) - 0.4) < 1e-4, "person.generate uses the preset as its mean")
    os.remove(os.path.join(HERE, "presets", "_test_preset.json"))
    # save as neutral round trip (recipe restored afterwards)
    bpy.ops.goe.save_neutral()
    R = json.load(open(recipe))
    check(abs(R["F"]["sliders"]["Eye gap"] - 0.5) < 1e-4, "save as neutral writes the sliders into recipe.json")
    baks = [b for b in glob.glob(os.path.join(HERE, "backups", "recipe_*.json")) if os.path.getmtime(b) >= t_start]
    check(len(baks) == 1 and open(baks[0]).read() == orig, "a backup of the previous recipe was written")
    for b in baks:
        os.remove(b)                      # only the backup this test made
    # random / reset
    bpy.ops.goe.random()
    vals = [getattr(g, k) for k in g.__annotations__ if k.startswith("s_")]
    check(any(abs(v) > 1e-3 for v in vals) and all(-1 <= v <= 1 for v in vals), "random person sets sliders within -1..1")
    bpy.ops.goe.reset()
    check(all(abs(getattr(g, k)) < 1e-9 for k in g.__annotations__ if k.startswith("s_") and k not in ("s_stylise",)) and g.s_stylise == 1.0,
          "reset")
    # render preview (small)
    sc.render.resolution_x = sc.render.resolution_y = 200
    sc.eevee.taa_render_samples = 4
    bpy.ops.goe.render_preview()
    outs = glob.glob(os.path.join(os.path.dirname(HERE), "previews", "editor", "woman_*.png"))
    check(len(outs) >= 2, f"render preview wrote {len(outs)} pictures")
    # sculpt: move a few vertices on the head near the cheek and on the seam, save, check seams and the export
    bpy.ops.goe.start_sculpt()
    kb = head.data.shape_keys.key_blocks["Sculpt"]
    co = np.array([v.co[:] for v in kb.data])
    sel = np.nonzero((np.abs(co[:, 0] - 0.04) < 0.01) & (co[:, 2] > co[:, 2].min() + 0.0) & (co[:, 2] < co[:, 2].min() + 0.03))[0]
    for i in sel:
        kb.data[i].co.x += 0.002
    g.sculpt_name = "_test"
    bpy.ops.goe.save_sculpt()
    f = os.path.join(HERE, "sculpts", "User__test.npz")
    check(os.path.exists(f), "sculpt exported to mh/sculpts")
    import editor_panel as ep
    worst, bad, _ = ep.seam_check(ep.set_objects('F'), "User__test")
    check(not bad, f"sculpt seams welded after save (worst {worst:.1e} m)")
    os.remove(f)
finally:
    open(recipe, "w").write(orig)
print("EDITOR TEST", "OK" if ok else "FAILED", flush=True)
