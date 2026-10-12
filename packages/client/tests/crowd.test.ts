import { describe, expect, it } from "vitest";
import { CrowdSim, type CrowdRoster, type Snapshot, type Townsperson } from "@millbrook/shared";
import { crowd, describeFolk, folkAt, insideOf, nearestFolk, promoted, updateCrowd } from "../src/crowd";

// A little village: a lane, a house and a square.
const W = 10;
const H = 6;
const tiles = Array.from({ length: H }, (_, y) => Array.from({ length: W }, (_, x) => (y === 0 || y === H - 1 || x === 0 || x === W - 1 ? "tree" : y === 3 ? "path" : "grass")));
for (let x = 2; x <= 4; x++) for (let y = 1; y <= 2; y++) tiles[y]![x] = "wall";
tiles[2]![3] = "door";
const buildings = [{ name: "", x: 2, y: 1, w: 3, h: 2, color: "#888", kind: "house", front: { x: 3, y: 3 } }];
const zones = [{ id: "square", kind: "square", x0: 6, y0: 2, x1: 8, y1: 4 }];
const who = (n: number, o: Partial<Townsperson> = {}): Townsperson => ({ id: `t_v_${n}`, name: `Ada Lowe${n}`, gender: "female", age: 30, cls: "commoner", job: "washer", faction: null, factionName: null, home: 0, work: "zone:square", master: null, masterId: null, color: "#999999", ...o });
const roster: CrowdRoster = { site: "v", map: "v", place: "Vale", lord: null, ruler: null, laws: { slavery: false, serfdom: true }, people: [who(0), who(1, { cls: "serf", job: "farmer", master: "Lord Pike" }), who(2)], rivals: [], scorn: [], talk: [] };

const snap = (hour: number, minute: number, npcs: Array<{ id: string }> = []): Snapshot =>
  ({
    map: { id: "v", w: W, h: H, tiles, buildings, zones, talkRange: 1.5 },
    crowd: { map: "v", count: 3, day: { weather: "clear", festival: false } },
    time: { day: 2, hour, minute },
    position: { x: 6, y: 3 },
    npcs,
  }) as unknown as Snapshot;

describe("the townsfolk in the browser (N16)", () => {
  crowd.map = "v";
  crowd.sim = new CrowdSim({ id: "v", w: W, h: H, tiles, buildings, zones }, roster);

  it("works out everyone's place once a minute, the same as the server would", () => {
    const s = snap(11, 0);
    expect(updateCrowd(s)).toBe(true);
    expect(updateCrowd(s)).toBe(false);
    expect(crowd.pos).toEqual(new CrowdSim({ id: "v", w: W, h: H, tiles, buildings, zones }, roster).all(2, 11 * 60, { weather: "clear", festival: false }));
  });

  it("finds who's on a tile and who's in reach, and says who they are", () => {
    const s = snap(10, 30);
    updateCrowd(s);
    const out = crowd.pos.map((p, i) => ({ p, i })).filter((x) => x.p.visible);
    expect(out.length).toBeGreaterThan(0);
    const one = out[0]!;
    expect(folkAt(s, one.p.x, one.p.y)).not.toBeNull();
    expect(describeFolk(1)).toMatch(/farmer \(serf\), bound to Lord Pike/);
    const near = nearestFolk(s);
    if (near) expect(near.d).toBeLessThanOrEqual(1.5);
  });

  it("leaves out anyone who's a full NPC now, and knows who's indoors at night", () => {
    const s = snap(10, 30, [{ id: "t_v_0" }]);
    updateCrowd(s);
    expect(promoted(s, 0)).toBe(true);
    expect(promoted(s, 1)).toBe(false);
    const night = snap(2, 0);
    updateCrowd(night);
    expect(insideOf(0).length).toBe(3);
  });
});
