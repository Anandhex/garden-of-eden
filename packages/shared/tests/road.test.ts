import { describe, expect, it } from "vitest";
import { CHUNK, DAY_ENDS, DAY_STARTS, Ground, WALK_PACE, buildTimeline, chunkAt, emptyRoadData, journeyLine, partyAt, positionAt, shortestWay, valueNoise, type Journey, type RoadData } from "../src/index.js";

/** Two places a day apart with a road between, a river across it, and an inn beside it. */
function small(): RoadData {
  const d = emptyRoadData(7);
  d.anchors = [{ x: 0, y: 0, terrain: "plains" }, { x: 9000, y: 0, terrain: "forest" }];
  d.footprints = [
    { id: "a", name: "A", kind: "village", terrain: "plains", x0: -8, y0: -5, x1: 8, y1: 6, gates: { "a~b": { x: 8, y: 0 } }, walled: false },
    { id: "b", name: "B", kind: "village", terrain: "forest", x0: 8992, y0: -5, x1: 9008, y1: 6, gates: { "a~b": { x: 8992, y: 0 } }, walled: false },
  ];
  d.roads = [{ id: "a~b", a: "a", b: "b", main: true, pts: [{ x: 8, y: 0 }, { x: 4500, y: 20 }, { x: 8992, y: 0 }], length: 8985 }];
  d.rivers = [{ id: "r", name: "the Test", half: 4, pts: [{ x: 3000, y: -500 }, { x: 3000, y: 500 }] }];
  d.places = [{ id: "way:w", kind: "waystation", name: "W", road: "a~b", t: 4500, at: { x: 4500, y: 25 }, on: { x: 4500, y: 20 }, site: "w" }];
  return d;
}

describe("road: noise and chunks", () => {
  it("noise is the same every time and stays in range", () => {
    for (const [x, y] of [[0, 0], [-37, 4001], [123456, -98765]] as const) {
      expect(valueNoise(5, x, y, 64)).toBe(valueNoise(5, x, y, 64));
      expect(valueNoise(5, x, y, 64)).toBeGreaterThanOrEqual(0);
      expect(valueNoise(5, x, y, 64)).toBeLessThan(1024);
    }
  });

  it("a chunk is a pure function of the data: same twice, and the road runs on across the chunk seam", () => {
    const d = small();
    expect(Buffer.from(chunkAt(d, 20, 0).tiles).equals(Buffer.from(chunkAt(d, 20, 0).tiles))).toBe(true);
    // The road at y = 6 through x = 1279 / 1280 (a chunk edge): road on both sides.
    const left = chunkAt(d, 19, 0);
    const right = chunkAt(d, 20, 0);
    expect(left.tiles[6 * CHUNK + CHUNK - 1]).toBe(Ground.road);
    expect(right.tiles[6 * CHUNK]).toBe(Ground.road);
  });

  it("a river is water, and a main road over it is a bridge", () => {
    const d = small();
    const c = chunkAt(d, Math.floor(3000 / CHUNK), 0);
    const kinds = new Set(c.tiles);
    expect(kinds.has(Ground.water)).toBe(true);
    expect(kinds.has(Ground.bridge)).toBe(true);
  });

  it("a settlement is a walled block with a gate where the road meets it", () => {
    const d = small();
    const c = chunkAt(d, 0, 0);
    expect(c.tiles[0 * CHUNK + 8]).toBe(Ground.gate);
  });
});

describe("road: journeys are formulas", () => {
  const d = small();
  const line = journeyLine(d, [{ id: "a~b", rev: false }], ["a", "b"]);

  it("a day's walk covers about a day's road, and the party sleeps at an inn within reach", () => {
    const { timeline, arrive } = buildTimeline(1440 * 3 + DAY_STARTS * 60, line, WALK_PACE);
    expect(arrive).toBeGreaterThan(1440 * 3 + DAY_ENDS * 60);
    // Nobody walks in the dead of night.
    for (const leg of timeline) if (leg.d1 > leg.d0) expect(((leg.t0 % 1440) / 60 >= DAY_STARTS && (leg.t1 % 1440 === 0 ? 1440 : leg.t1 % 1440) / 60 <= DAY_ENDS) || leg.t1 - leg.t0 <= 600, `${leg.t0}`).toBe(true);
    expect(timeline.some((l) => l.d0 === l.d1 && l.at)).toBe(true);
  });

  it("position is the same on both sides of a JSON round trip, and the party follows its leader", () => {
    const { timeline, arrive } = buildTimeline(1440 * 3 + DAY_STARTS * 60, line, WALK_PACE);
    const j: Journey = { id: "j1", kind: "caravan", party: [{ name: "A", role: "merchant", gender: "male" }, { name: "B", role: "guard", gender: "female" }], path: ["a", "b"], roads: [{ id: "a~b", rev: false }], depart: timeline[0]!.t0, arrive, timeline, pace: WALK_PACE, purpose: "carrying iron" };
    const copy = JSON.parse(JSON.stringify(j)) as Journey;
    const m = j.depart + 200;
    expect(positionAt(copy, line, m)).toEqual(positionAt(j, line, m));
    const [lead, second] = partyAt(j, line, m);
    expect(lead!.state).toBe("walking");
    expect(Math.hypot(second!.x - lead!.x, second!.y - lead!.y)).toBeGreaterThan(0);
    expect(Math.hypot(second!.x - lead!.x, second!.y - lead!.y)).toBeLessThan(6);
    expect(positionAt(j, line, j.depart - 5).state).toBe("waiting");
    expect(positionAt(j, line, arrive + 5).state).toBe("arrived");
  });

  it("the graph finds the way between places by road length", () => {
    expect(shortestWay(d, "a", "b")!.path).toEqual(["a", "b"]);
    expect(shortestWay(d, "a", "zzz")).toBeNull();
  });
});
