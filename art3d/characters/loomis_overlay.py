"""Loomis construction overlays and scores (G9 plan 11.5).

    Blender -b art3d/characters/base.blend -P art3d/characters/loomis_overlay.py -- round=<N> [sex=f,m] [keys=Name:w,...] [species=elf]

Measures the bald neutral head (measure.py), renders it orthographic front and side (800 px, ortho 1.5 head heights, flat
studio light, brows/lashes off), then loomis_draw.py (Pillow) draws: classic Loomis lines (dashed white), the targets for the
sex/species (dashed green), the measured lines (solid, red when g > 1), the cranium ball, side-plane circle and cuts, the ear
box with the target band, and the "five eyes" ruler.  Writes previews/compare/loomis_round<N>_{f,m}_{front,side}.png, a 2x2
sheet, loomis_round<N>.json and appends the rows to report.md.  Does not modify base.blend (nothing is saved).
"""
import bpy, os, sys, json, math, subprocess
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import measure as ms  # noqa: E402

OUT = os.path.join(HERE, "previews", "compare")
SPECIES_T = {"elf": dict(brow=0.39, eye=0.53, nose_base=0.71, mouth=0.815), "dwarf": dict(brow=0.42, eye=0.52, nose_base=0.73, mouth=0.83),
             "halfling": dict(brow=0.40, eye=0.54, nose_base=0.71, mouth=0.815), "orc": dict(brow=0.43, eye=0.51, nose_base=0.69, mouth=0.80),
             "child": dict(brow=0.44, eye=0.56, nose_base=0.73, mouth=0.83)}


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    rnd, sexes, extra, species = "0", ["f", "m"], {}, None
    for a in argv:
        if a.startswith("round="):
            rnd = a[6:]
        elif a.startswith("sex="):
            sexes = a[4:].split(",")
        elif a.startswith("keys="):
            for kv in a[5:].split(","):
                k, v = kv.split(":")
                extra[k] = float(v)
        elif a.startswith("species="):
            species = a[8:]
    os.makedirs(OUT, exist_ok=True)
    T = json.load(open(os.path.join(HERE, "compare_targets.json")))
    M = ms.meta()
    if species and species != "child":
        key = "Species_" + species.capitalize()
        extra[key] = 1.0
    if species == "child":
        extra["Child"] = 1.0
    sc = bpy.context.scene
    sc.render.engine = 'BLENDER_WORKBENCH'
    sc.display.shading.light = 'STUDIO'
    sc.display.shading.color_type = 'SINGLE'
    sc.display.shading.single_color = (0.80, 0.62, 0.52)
    sc.display.shading.show_cavity = True
    sc.render.resolution_x = sc.render.resolution_y = 800
    sc.render.film_transparent = False
    sc.view_settings.view_transform = 'Standard'
    cam = bpy.data.objects.new("loomis_cam", bpy.data.cameras.new("loomis_cam"))
    sc.collection.objects.link(cam)
    sc.camera = cam
    cam.data.type = 'ORTHO'
    show = ("Mesh_Head", "Part_Nose", "Part_Ear_L", "Part_Ear_R", "Part_Eye_L", "Part_Eye_R", "Mesh_Torso")
    for o in bpy.data.objects:
        if o.type == 'MESH':
            o.hide_render = o.name not in show
    res = {}
    draw = []
    for tag in sexes:
        w = dict(extra, Sex=1.0 if tag == "f" else 0.0)
        bf, lo, geo = ms.measure(w)
        tgt_lines = dict(T["loomisTargetLines"]["F" if tag == "f" else "M"])
        if species in SPECIES_T:
            tgt_lines.update(SPECIES_T[species])
        rows, wm = ms.score({"body_face": {}, "loomis": lo}, {"body_face": {}, "loomis": T["loomis"]}, "F" if tag == "f" else "M")
        res[tag] = dict(loomis=lo, weightedMeanG=wm, rows=rows, geo=geo, species=species, keys=extra)
        hh = geo["hh"]
        cz = (geo["top"] + geo["chin"]) / 2
        S = hh * 1.5
        cam.data.ortho_scale = S
        cy = (geo["yfront"] + geo["yback"]) / 2
        for view in ("front", "side"):
            if view == "front":
                cam.location = (0, -5, cz)
                cam.rotation_euler = (math.pi / 2, 0, 0)
            else:
                cam.location = (5, cy, cz)
                cam.rotation_euler = (math.pi / 2, 0, math.pi / 2)
            p = os.path.join(OUT, f"loomis_round{rnd}_{tag}_{view}_raw.png")
            sc.render.filepath = p
            bpy.ops.render.render(write_still=True)
            draw.append(dict(raw=p, out=p.replace("_raw.png", ".png"), view=view, sex=tag, geo=geo, cz=cz, cy=cy, S=S,
                             classic=T["loomisClassic"], target=tgt_lines, rows=rows, loomis=lo))
    spec = os.path.join(OUT, f"loomis_round{rnd}_draw.json")
    json.dump(draw, open(spec, "w"))
    subprocess.run(["python3", "-I", os.path.join(HERE, "loomis_draw.py"), spec, os.path.join(OUT, f"loomis_round{rnd}_sheet.png")], check=True)
    for d in draw:
        try:
            os.remove(d["raw"])
        except OSError:
            pass
    os.remove(spec)
    json.dump(res, open(os.path.join(OUT, f"loomis_round{rnd}.json"), "w"), indent=1)
    lines = [f"\n### Loomis rows, round {rnd}" + (f" ({species})" if species else "") + "\n",
             "| row | " + " | ".join(f"ours {t.upper()} | target | g" for t in sexes) + " |",
             "|---|" + "---|---|---|" * len(sexes)]
    names = [r[1] for r in res[sexes[0]]["rows"]]
    for i, n in enumerate(names):
        cells = []
        for t in sexes:
            r = res[t]["rows"][i]
            cells.append(f"{r[2]} | {r[3]} | {'-' if r[6] is None else r[6]}")
        lines.append(f"| {n} | " + " | ".join(cells) + " |")
    lines.append("| **weighted mean g** | " + " | ".join(f"| | {res[t]['weightedMeanG']}" for t in sexes) + " |")
    with open(os.path.join(OUT, "report.md"), "a") as fh:
        fh.write("\n".join(lines) + "\n")
    print(json.dumps({t: res[t]["weightedMeanG"] for t in sexes}))


if __name__ == "__main__":
    main()
