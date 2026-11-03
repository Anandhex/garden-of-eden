/**
 * G7: the 2.5D world view. The camera's geometry (keys follow the screen on every turn), buildings as masses from
 * their templates (box, door, windows, roofless ones standing as sprites), the doorway nudge and fading, the person
 * bake, the view preference, and the renderers kept apart (Three.js only in iso/, Phaser only in world/). Part B: the
 * land's height, upper floors with stairs, low-poly models and the new art.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { floorTiles, furnitureOn, interiorOf, interiorWalkable, ITILE, spotFor } from "@millbrook/shared";
import { dress, PatchSchema, TEMPLATES } from "@millbrook/shared/view";
import { FRAMES } from "../../client/src/adapter/web/art.js";
import { MODEL_IDS, modelGeometry } from "../../client/src/adapter/web/iso/models.js";
import { HEIGHT_MAX, heightAt, patchHeights, type HeightCtx, type LandKind } from "../src/view/height.js";
import { bakeLayers } from "../../client/src/adapter/web/iso/bake.js";
import { cameraOffset, screenFacing, stepFor, toScreen, yawOf } from "../../client/src/adapter/web/iso/camera.js";
import { hides, INSET, massing, nudgeOut, WALL_H } from "../../client/src/adapter/web/iso/massing.js";
import { DEFAULT_VIEW, VIEW_BOX, viewPref } from "../../client/src/adapter/web/viewPref.js";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? files(join(dir, f)) : f.endsWith(".ts") ? [join(dir, f)] : []));

describe("G7 camera", () => {
  it("W, D, S, A are four different grid steps on every turn, and W is up-right on screen", () => {
    for (let turn = 0; turn < 4; turn++) {
      const yaw = yawOf(turn);
      const w = stepFor(yaw, 0, -1);
      const steps = [w, stepFor(yaw, 1, 0), stepFor(yaw, 0, 1), stepFor(yaw, -1, 0)].map((s) => `${s.dx},${s.dy}`);
      expect(new Set(steps).size).toBe(4);
      const s = toScreen(yaw, w.dx, w.dy);
      expect(s.sx).toBeGreaterThan(0);
      expect(s.sy).toBeGreaterThan(0);
    }
    // Turn 0 is the classic corner: W is north, D east.
    expect(stepFor(yawOf(0), 0, -1)).toEqual({ dx: 0, dy: -1 });
    expect(stepFor(yawOf(0), 1, 0)).toEqual({ dx: 1, dy: 0 });
  });

  it("four turns come back round, and the camera stays above the ground", () => {
    const a = cameraOffset(yawOf(0));
    const b = cameraOffset(yawOf(4));
    expect(b.x).toBeCloseTo(a.x);
    expect(b.z).toBeCloseTo(a.z);
    expect(a.y).toBeGreaterThan(0);
  });

  it("walking the way W goes shows a back, S a front, on every turn", () => {
    const dir = (s: { dx: number; dy: number }) => (s.dy < 0 ? "n" : s.dy > 0 ? "s" : s.dx > 0 ? "e" : "w") as "n" | "e" | "s" | "w";
    for (let turn = 0; turn < 4; turn++) {
      const yaw = yawOf(turn);
      expect(screenFacing(yaw, dir(stepFor(yaw, 0, -1)))).toBe("n");
      expect(screenFacing(yaw, dir(stepFor(yaw, 0, 1)))).toBe("s");
      expect(screenFacing(yaw, dir(stepFor(yaw, 1, 0)))).toBe("e");
      expect(screenFacing(yaw, dir(stepFor(yaw, -1, 0)))).toBe("w");
    }
  });
});

describe("G7 buildings as masses", () => {
  const house = { id: 7, x: 10, y: 10, w: 4, h: 4 };
  const t = TEMPLATES.house_a!;

  it("a house is a box inset in its rectangle, the door on its front, panes where the template has windows", () => {
    const door = { x: 11, y: 13 };
    const m = massing(house, t, dress(t, { ...house, door }));
    expect(m.kind).toBe("box");
    expect(m.box).toMatchObject({ x0: 10 + INSET, x1: 14 - INSET, z0: 10 + INSET, z1: 14 - INSET });
    expect(m.box.top).toBeGreaterThan(WALL_H);
    const front = m.faces.find((f) => f.name === "front")!;
    expect(front.lower).toHaveLength(4);
    expect(front.lower[1]).toBe(t.door);
    expect(front.upper).not.toContain(t.door);
    for (const f of m.faces.filter((f) => f.name !== "front")) expect(f.lower).not.toContain(t.door);
    // house_a's window moves along the wall when the door takes its place; it still glows, on both bands.
    expect(m.windows.length).toBeGreaterThan(0);
    expect(m.windows.every((w) => w.z === m.box.z1 && w.id.startsWith("win:7:"))).toBe(true);
    // The roof: ridge first, eave last, a column a tile; the chimney stands on it.
    expect(m.roof!.rows[0]![0]).toMatch(/_top_/);
    expect(m.roof!.rows.at(-1)![0]).toMatch(/_near_/);
    expect(m.roof!.rows[0]).toHaveLength(4);
    expect(m.standing.some((s) => s.frame.startsWith("props/chimney") && s.y > WALL_H)).toBe(true);
  });

  it("a door on the left wall is drawn on the left face", () => {
    const door = { x: 10, y: 12 };
    const m = massing(house, t, dress(t, { ...house, door }));
    const left = m.faces.find((f) => f.name === "left")!;
    expect(left.lower[door.y - house.y]).toBe(t.door);
    expect(m.faces.find((f) => f.name === "front")!.lower).not.toContain(t.door);
  });

  it("a roofless template (a camp's fire) stands as sprites; no template is a plain block", () => {
    const camp = { id: 1, x: 3, y: 3, w: 1, h: 2 };
    const m = massing(camp, TEMPLATES.camp!, dress(TEMPLATES.camp!, { ...camp, door: null }));
    expect(m.kind).toBe("standing");
    expect(m.standing.map((s) => s.frame)).toContain("buildings/campfire");
    expect(massing(camp, undefined, null).kind).toBe("plain");
  });

  it("someone on the door tile is drawn outside the box, in front of the door", () => {
    const m = massing(house, t, dress(t, { ...house, door: { x: 11, y: 13 } }));
    const p = nudgeOut([m.box], 11.5, 13.5);
    expect(p.z).toBeGreaterThan(m.box.z1);
    expect(p.x).toBe(11.5);
    expect(nudgeOut([m.box], 20, 20)).toEqual({ x: 20, z: 20 });
  });

  it("a building between the camera and the player hides them; one behind does not", () => {
    const m = massing(house, t, dress(t, { ...house, door: null }));
    const yaw = yawOf(0); // the camera is south-east, looking north-west
    expect(hides(m.box, yaw, { x: 9.5, z: 9.5 })).toBe(true);
    expect(hides(m.box, yaw, { x: 15.5, z: 15.5 })).toBe(false);
    expect(hides(m.box, yaw, { x: 30, z: 30 })).toBe(false);
  });
});

describe("G7 person bake", () => {
  it("tints only a layer's own pixels and stacks layers in order", () => {
    const px = (r: number, g: number, b: number, a: number) => new Uint8ClampedArray([r, g, b, a, 0, 0, 0, 0]);
    const out = bakeLayers(
      [
        { px: px(200, 200, 200, 255), tint: 0xffffff },
        { px: new Uint8ClampedArray([0, 0, 0, 0, 255, 255, 255, 255]), tint: 0xff0000 },
        { px: px(100, 100, 100, 255), tint: 0x00ff00 },
      ],
      2,
      1,
    );
    expect([...out.slice(0, 4)]).toEqual([0, 100, 0, 255]);
    expect([...out.slice(4, 8)]).toEqual([255, 0, 0, 255]);
  });
});

describe("G7 view choice", () => {
  it("?view= beats the saved setting, which beats the default (2.5D)", () => {
    expect(viewPref("?view=flat", "iso")).toBe("flat");
    expect(viewPref("", "flat")).toBe("flat");
    expect(viewPref("", null)).toBe(DEFAULT_VIEW);
    expect(DEFAULT_VIEW).toBe("iso");
    expect(viewPref("?view=nonsense", "junk")).toBe("iso");
    // The 2.5D diamond asks for more ground, inside what the server allows.
    expect(VIEW_BOX.iso.w).toBeLessThanOrEqual(80);
    expect(VIEW_BOX.iso.h).toBeLessThanOrEqual(60);
  });

  it("Three.js only in adapter/web/iso, Phaser only in adapter/web/world, and the page loads one or the other", () => {
    const src = join(root, "packages/client/src");
    for (const f of files(src)) {
      const text = readFileSync(f, "utf8");
      const rel = f.slice(src.length + 1);
      if (/from\s+"three(\/[^"]*)?"/.test(text)) expect(rel, `${rel} imports three`).toMatch(/^adapter\/web\/iso\//);
      if (/from\s+"phaser"/.test(text)) expect(rel, `${rel} imports phaser`).toMatch(/^adapter\/web\/world\//);
      if (rel.startsWith("adapter/web/iso/")) expect(text, rel).not.toMatch(/from\s+"[^"]*world\/(WorldScene|textures|actors|buildings|ground|lighting|atmosphere|marks)"/);
    }
    const main = readFileSync(join(src, "adapter/web/main.ts"), "utf8");
    expect(main).toMatch(/await import\("\.\/iso\/IsoWorld"\)/);
    expect(main).toMatch(/await import\("\.\/world\/WorldScene"\)/);
    expect(main).not.toMatch(/^import .*(IsoWorld|WorldScene)/m);
  });
});

describe("G7 Part B: the land's height", () => {
  // A river along x = 10, a hill round (30, 30), open land elsewhere.
  const kind = (x: number, y: number): LandKind => (x === 10 ? "water" : Math.hypot(x - 30, y - 30) < 5 ? "hill" : "land");
  const open: HeightCtx = { seed: 42, open: true, kind };

  it("is the same for the same seed and tile, and stays in range", () => {
    const a = patchHeights(open, 0, 0, 48, 48);
    expect(patchHeights(open, 0, 0, 48, 48)).toEqual(a);
    expect(a.every((h) => Number.isInteger(h) && h >= 0 && h <= HEIGHT_MAX)).toBe(true);
    expect(patchHeights({ ...open, seed: 43 }, 0, 0, 48, 48)).not.toEqual(a);
  });

  it("water lies lowest, the land slopes down to it, and a hill stands above the land round it", () => {
    for (let y = 0; y < 20; y++) {
      expect(heightAt(open, 10, y)).toBeLessThan(heightAt(open, 11, y));
      expect(heightAt(open, 11, y)).toBeLessThanOrEqual(heightAt(open, 15, y) + 1);
    }
    expect(heightAt(open, 30, 30)).toBeGreaterThan(heightAt(open, 45, 30) + 4);
  });

  it("a building's pad (and a tile round it) is level; inside is flat", () => {
    const place: HeightCtx = { seed: 7, open: false, kind: () => "land", pads: [{ x: 20, y: 20, w: 4, h: 3 }] };
    const pad = new Set<number>();
    for (let y = 19; y <= 23; y++) for (let x = 19; x <= 24; x++) pad.add(heightAt(place, x, y));
    expect(pad.size).toBe(1);
    expect(patchHeights(null, 0, 0, 4, 4)).toEqual(new Array(16).fill(0));
  });

  it("a patch with heights validates; one without still does (flat)", () => {
    const base = { key: "m:0:0", x0: 0, y0: 0, w: 2, h: 1, ground: [0, 0], objects: [0, 0] };
    expect(PatchSchema.safeParse({ ...base, height: [3, 40] }).success).toBe(true);
    expect(PatchSchema.safeParse(base).success).toBe(true);
    expect(PatchSchema.safeParse({ ...base, height: [41, 0] }).success).toBe(false);
  });
});

describe("G7 Part B: upper floors", () => {
  const inn = interiorOf(1, "site:a", 3, { kind: "inn", wealth: 2 });

  it("an inn has two floors with stairs on the same walkable tile of both; a hovel has one", () => {
    expect(inn.floors).toBe(2);
    const s = inn.stairs!;
    expect(inn.tiles[s.y * inn.w + s.x]).toBe(ITILE.stairs);
    expect(floorTiles(inn, 1)[s.y * inn.w + s.x]).toBe(ITILE.stairs);
    expect(interiorWalkable(inn, s.x, s.y, 0)).toBe(true);
    expect(interiorWalkable(inn, s.x, s.y, 1)).toBe(true);
    const hovel = interiorOf(1, "site:a", 4, { kind: "house", style: "hovel", wealth: 0 });
    expect(hovel.floors).toBe(1);
    expect(hovel.upper).toBeUndefined();
  });

  it("the ground floor is furnished as before; the upper floor has beds, and sleepers lie in them", () => {
    const ground = furnitureOn(inn, 0);
    const up = furnitureOn(inn, 1);
    expect(ground.length).toBeGreaterThan(0);
    expect(up.some((f) => f.kind === "bed")).toBe(true);
    for (const f of up) expect(floorTiles(inn, 1)[f.y * inn.w + f.x]).toBe(ITILE.floor);
    // Ids and slots stay unique across floors.
    expect(new Set(inn.furniture.map((f) => f.id)).size).toBe(inn.furniture.length);
    const slots = inn.furniture.filter((f) => f.slot).map((f) => f.slot!.id);
    expect(new Set(slots).size).toBe(slots.length);
    const spot = spotFor(inn, "asleep", 0);
    expect(inn.furniture.some((f) => (f.floor ?? 0) === spot.floor && f.x === spot.x && f.y === spot.y && (f.kind === "bed" || f.kind === "straw"))).toBe(true);
  });

  it("a merchant's house goes up a floor too; the same house is the same twice", () => {
    const h = { kind: "house", style: "merchant", cls: "merchant", wealth: 2 };
    const a = interiorOf(9, "site:b", 1, h);
    expect(a.floors).toBe(2);
    expect(interiorOf(9, "site:b", 1, h)).toEqual(a);
  });
});

describe("G7 Part B: models and new art", () => {
  it("every model is a frame that's packed (or the bridge's deck), and builds a coloured mesh", () => {
    for (const id of MODEL_IDS) {
      if (!id.startsWith("model/")) expect(FRAMES[id], id).toBeDefined();
      const g = modelGeometry(id)!;
      expect(g.getAttribute("color"), id).toBeDefined();
      expect(g.getAttribute("position").count, id).toBeGreaterThan(0);
      g.computeBoundingBox();
      expect(g.boundingBox!.min.y, id).toBeGreaterThanOrEqual(-0.01);
    }
  });

  it("the new art is packed: banks, stairs, side walls and gables for every wall material", () => {
    for (const f of ["terrain/bank_0", "terrain/bank_1", "buildings/stairs"]) expect(FRAMES[f], f).toBeDefined();
    for (const m of ["plaster", "stone", "plank"]) for (const p of ["side", "gable"]) expect(FRAMES[`buildings/${m}_${p}`], `${m}_${p}`).toBeDefined();
  });

  it("a house's side walls and gables use its material's own art", () => {
    const t = TEMPLATES.house_a!;
    const b = { id: 1, x: 0, y: 0, w: 4, h: 4 };
    const m = massing(b, t, dress(t, { ...b, door: null }));
    const left = m.faces.find((f) => f.name === "left")!;
    expect(left.lower.slice(1, -1).every((f) => f === "buildings/plaster_side")).toBe(true);
    expect(m.roof!.gable).toBe("buildings/plaster_gable");
  });
});
