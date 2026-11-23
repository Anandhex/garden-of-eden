/**
 * G8: regional building shapes in the 3D view. A place's culture, land and wealth decide how its buildings stand:
 * roof form and pitch, wall height, eaves, a footing or stilts, felt yurts on the steppe. The server sends the place's
 * `locale`; shapes.ts is pure, and massing.ts builds the shape without Three.js, so both are checked here.
 */
import { describe, expect, it } from "vitest";
import { dress, FrameSchema, restyleFrame, SHAPE_STYLES, shapeFor, standingOf, TEMPLATES, templateById, type Locale } from "@millbrook/shared/view";
import { massing, WALL_H } from "../../client/src/adapter/web/iso/massing.js";
import sheets from "../../client/src/adapter/web/art/sheets.json" with { type: "json" };

const FRAMES = sheets.frames as Record<string, unknown>;
const at = (culture: string, terrain: string, wealth = 0.5, size = "town"): Locale => ({ culture, terrain, wealth, size, colours: ["#a83a2a"] });
const house = { id: 3, x: 10, y: 10, w: 4, h: 3 };

describe("G8 regional building shapes", () => {
  it("each culture builds its own way", () => {
    const shape = (c: string, kind = "house") => shapeFor(at(c, "plains", 0.55), { id: 1, kind, template: "house_a" })!;
    expect(shape("highland").walls).toBe("stone");
    expect(shape("coastal").form).toBe("hip");
    expect(shape("imperial").form).toBe("hip");
    expect(shape("imperial").base).toBe("stone");
    expect(shape("forest").pitch).toBeGreaterThan(shape("coastal").pitch);
    expect(shape("steppe").form).toBe("round");
    expect(shape("steppe", "hall").form).toBe("flat");
    expect(shape("imperial").wallH).toBeGreaterThan(shape("highland").wallH);
  });

  it("the land changes it: stilts in the marsh, footings on the hills, deep eaves in the forest", () => {
    const b = { id: 1, kind: "house", template: "house_a" };
    expect(shapeFor(at("river", "marsh"), b)!.stilts).toBeGreaterThan(0);
    expect(shapeFor(at("river", "valley"), b)!.stilts).toBe(0);
    expect(shapeFor(at("river", "hills"), b)!.plinth).toBeGreaterThanOrEqual(0.3);
    expect(shapeFor(at("river", "forest"), b)!.overhang).toBeGreaterThan(shapeFor(at("river", "valley"), b)!.overhang);
    // A hall in the marsh stands on a footing, not stilts.
    expect(shapeFor(at("river", "marsh"), { id: 1, kind: "hall", template: "hall" })!.stilts).toBe(0);
  });

  it("wealth and size: a rich city builds taller than a poor hamlet, and the hall is the grandest", () => {
    const tall = (l: Locale, kind = "house") => {
      let sum = 0;
      for (let i = 0; i < 40; i++) sum += shapeFor(l, { id: i, kind, template: "house_a" })!.wallH;
      return sum / 40;
    };
    expect(standingOf(at("river", "valley", 0.3, "hamlet"))).toBeLessThan(standingOf(at("river", "valley", 0.6, "capital")));
    expect(tall(at("river", "valley", 0.65, "city"))).toBeGreaterThan(tall(at("river", "valley", 0.3, "hamlet")) + 0.3);
    expect(tall(at("river", "valley"), "hall")).toBeGreaterThan(tall(at("river", "valley")));
  });

  it("is stable for a building, and varies along a street", () => {
    const l = at("coastal", "coast");
    expect(shapeFor(l, { id: 5, kind: "house" }, "m:5")).toEqual(shapeFor(l, { id: 5, kind: "house" }, "m:5"));
    const heights = new Set(Array.from({ length: 12 }, (_, i) => shapeFor(l, { id: i, kind: "house" }, `m:${i}`)!.wallH.toFixed(3)));
    expect(heights.size).toBeGreaterThan(6);
  });

  it("stalls, camps and other peoples' holds keep their plain shape; no locale, no shape", () => {
    expect(shapeFor(null, { id: 1, kind: "house" })).toBeNull();
    expect(shapeFor(at("river", "valley"), { id: 1, kind: "market", template: "market" })).toBeNull();
    expect(shapeFor(at("river", "valley"), { id: 1, kind: "house", template: "tent" })).toBeNull();
    expect(shapeFor(at("highland", "hills"), { id: 1, kind: "house", template: "house_a~dwarf" })).toBeNull();
  });

  it("a building styles.ts already dressed keeps its materials; an unstyled one gets them swapped from the plain tiles", () => {
    const styled = shapeFor(at("highland", "hills"), { id: 1, kind: "house", template: "house_a~highland.hills" })!;
    expect(styled.materials).toBe(false);
    expect(styled.walls).toBeNull();
    expect(styled.roof).toBeNull();
    const plain = shapeFor(at("highland", "hills"), { id: 1, kind: "house", template: "house_a" })!;
    expect(plain.materials).toBe(true);
    expect(restyleFrame("buildings/plaster_win", plain)).toBe("buildings/stone_win");
    // Every swap lands on a frame the art has.
    for (const c of SHAPE_STYLES)
      for (const t of ["valley", "hills", "forest", "plains", "coast", "marsh"])
        for (const id of Object.keys(TEMPLATES)) {
          const s = shapeFor(at(c, t, 0.2, "hamlet"), { id: 1, kind: TEMPLATES[id]!.kinds[0], template: id });
          if (!s) continue;
          for (const f of [...TEMPLATES[id]!.walls.flat(), ...TEMPLATES[id]!.roof.flat()]) if (f) expect(FRAMES[restyleFrame(f, s)], `${c}.${t} ${id}: ${f}`).toBeTruthy();
        }
  });

  it("massing builds the shape: the style's wall height, a flat roof's parapet, a yurt's cone, a raised floor", () => {
    const t = TEMPLATES.house_a!;
    const dressed = dress(t, { ...house, door: { x: 11, y: 12 } });
    const plain = massing(house, t, dressed);
    expect(plain.wallH).toBe(WALL_H);
    expect(plain.lift).toBe(0);
    const imperial = shapeFor(at("imperial", "valley"), { id: 3, kind: "house", template: "house_a" })!;
    const m = massing(house, t, dressed, imperial);
    expect(m.wallH).toBeCloseTo(imperial.wallH);
    expect(m.form).toBe("hip");
    expect(m.lift).toBeCloseTo(imperial.plinth);
    // Stone ground floor, stucco above.
    expect(m.faces[0]!.lower.some((f) => f.startsWith("buildings/stone_"))).toBe(true);
    expect(m.faces[0]!.upper.some((f) => f.startsWith("buildings/plaster_"))).toBe(true);
    expect(m.windows.every((w) => w.y < m.wallH)).toBe(true);
    const marsh = massing(house, t, dressed, shapeFor(at("river", "marsh"), { id: 3, kind: "house", template: "house_a" })!);
    expect(marsh.lift).toBeGreaterThan(0.4);
    const yurt = massing(house, templateById("tent")!, dress(templateById("tent")!, { ...house, door: null }), shapeFor(at("steppe", "plains"), { id: 3, kind: "house", template: "tent~steppe.plains" })!);
    expect(yurt.form).toBe("round");
    expect(yurt.windows).toEqual([]);
    const hall = { ...house, w: 6, h: 4 };
    const flat = massing(hall, TEMPLATES.hall!, dress(TEMPLATES.hall!, { ...hall, door: null }), shapeFor(at("steppe", "plains"), { id: 3, kind: "hall", template: "hall" })!);
    expect(flat.form).toBe("flat");
    expect(flat.roof!.ridge).toBe(flat.roof!.eave);
    expect(flat.box.top).toBeGreaterThan(flat.wallH);
  });

  it("the frame's map carries the locale", () => {
    const map = { id: "p", name: "P", kind: "place" as const, w: 10, h: 10, locale: at("forest", "forest") };
    expect(FrameSchema.shape.map.parse(map).locale?.culture).toBe("forest");
    expect(FrameSchema.shape.map.parse({ ...map, locale: undefined }).locale).toBeUndefined();
  });
});
