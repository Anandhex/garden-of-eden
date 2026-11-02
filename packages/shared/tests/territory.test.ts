import { describe, expect, it } from "vitest";
import { coverOf, emptyRoadData, inTerritory, MAX_COVER, territoriesOf, type RoadData } from "../src/index.js";

/** A forest village with three roads out, one to a hill town. */
function land(): RoadData {
  const d = emptyRoadData(3);
  const fp = (id: string, terrain: string, x: number) => ({ id, name: id, kind: "village", terrain, x0: x - 8, y0: -5, x1: x + 8, y1: 5, gates: {}, walled: false });
  d.footprints = [fp("home", "forest", 0), fp("hill", "hills", 6000), fp("plain", "plains", -6000), fp("marsh", "marsh", 0)];
  d.roads = [
    { id: "home~hill", a: "home", b: "hill", main: true, pts: [{ x: 8, y: 0 }, { x: 5992, y: 0 }], length: 5984 },
    { id: "plain~home", a: "plain", b: "home", main: true, pts: [{ x: -5992, y: 0 }, { x: -8, y: 0 }], length: 5984 },
    { id: "home~marsh", a: "home", b: "marsh", main: false, pts: [{ x: 0, y: 5 }, { x: 0, y: 4000 }], length: 3995 },
  ];
  return d;
}

describe("territories (N26F step 1)", () => {
  const input = { packs: [{ id: "wolves", species: "wolf", near: "home", count: 8, cap: 10 }, { id: "gone", species: "wolf", near: "home", count: 0, cap: 8 }], gangs: [{ id: "redhands", seat: "home" }] };

  it("are the same for the same ids and land", () => {
    expect(territoriesOf(input, land())).toEqual(territoriesOf(input, land()));
  });

  it("a strong pack holds two stretches out of its place, in country it likes first; a wiped-out pack holds none", () => {
    const ts = territoriesOf(input, land());
    const wolves = ts.filter((t) => t.owner === "wolves");
    expect(wolves).toHaveLength(2);
    for (const t of wolves) expect(t.road.split("~")).toContain("home");
    // Wolves like hills and forest: the hill road beats the plain one.
    expect(wolves.map((t) => t.road)).toContain("home~hill");
    expect(ts.some((t) => t.owner === "gone")).toBe(false);
  });

  it("a gang holds one stretch on a road out of its seat, with its camp inside the band", () => {
    const d = land();
    const g = territoriesOf(input, d).find((t) => t.kind === "gang")!;
    expect(g.t1 - g.t0).toBeGreaterThanOrEqual(150);
    expect(g.camp).toBeDefined();
    expect(inTerritory(d, g, g.camp!)).not.toBeNull();
  });

  it("no road is more than 40% covered, and the gates are clear", () => {
    const d = land();
    const ts = territoriesOf(input, d);
    for (const share of coverOf(d, ts).values()) expect(share).toBeLessThanOrEqual(MAX_COVER + 1e-9);
    for (const t of ts) {
      expect(t.t0).toBeGreaterThan(100);
      expect(t.t1).toBeLessThan(d.roads.find((r) => r.id === t.road)!.length - 100);
    }
  });

  it("a tile on the road inside the stretch is in it; far off the road is not", () => {
    const d = land();
    const t = territoriesOf(input, d)[0]!;
    const road = d.roads.find((r) => r.id === t.road)!;
    const mid = (t.t0 + t.t1) / 2;
    const on = road.id === "home~marsh" ? { x: 0, y: 5 + mid } : road.a === "home" ? { x: 8 + mid, y: 0 } : { x: -5992 + mid, y: 0 };
    expect(inTerritory(d, t, on)).not.toBeNull();
    expect(inTerritory(d, t, { x: on.x + 500, y: on.y + 500 })).toBeNull();
  });
});
