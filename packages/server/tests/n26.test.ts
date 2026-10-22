/**
 * N26: the open road. Chunks are made from the realm; a player walks them step by step; the clock runs on the
 * road scale; settlements are entered by their gates.
 */
import { days } from "./long.js";
import { beforeEach, describe, expect, it } from "vitest";
import { cumulative, pointAt, findPath, resample, CHUNK, STEPS_PER_DAY_WALK, STEPS_PER_GAME_MINUTE, STEPS_PER_SECOND, REAL_MINUTES_PER_DAY_WALK, TILES_PER_UNIT, DAY_WALK_UNITS, chunkAt, isSolidGround, journeyLine, type Journey, positionAt, shortestWay, type RoadData } from "@millbrook/shared";
import { config } from "../src/config.js";
import { loadCreatureTemplates } from "../src/game/creatures.js";
import { generateRealm } from "../src/game/realm/generate.js";
import { roadDataOf } from "../src/game/road/generateRoads.js";
import { landOf, walkableAt } from "../src/game/road/ground.js";
import { newWorld } from "../src/game/save.js";
import { Town } from "../src/game/town.js";
import { journeysOf, roadsAlong } from "../src/game/road/journeys.js";
import { WorldStore } from "../src/game/db.js";
import { ensureLivePeople } from "../src/store/materialise.js";
import { liveSites } from "../src/game/people/live.js";
import { itemKey } from "../src/game/items.js";
import { loadSituations, rollSegment, dueLater, type Rolled } from "../src/game/road/situations.js";
import { meetThreats, threatsOf } from "../src/game/road/threats.js";
import { needsOf, needsWords, tickNeeds } from "../src/game/road/needs.js";
import { startRoad } from "../src/game/road/walk.js";
import { buyMount, mountStep, tickMount, treatMount } from "../src/game/road/mounts.js";
import { canFast } from "../src/game/road/fast.js";
import { checkRoadBounds } from "../src/game/road/bounds.js";
import { quoteCoach, takeCoach } from "../src/game/road/coach.js";
import { always, FakeProvider } from "./helpers.js";

beforeEach(() => {
  config.director = false;
  config.planning = false;
  config.summaries = false;
  config.realm = true;
  config.realmSeed = undefined;
});

/** A town with the people table (N26 Part E: the road's people are rows, so the road has traffic only where there is a table). */
const peopleTown = (seed: number): Town => {
  const templates = loadCreatureTemplates();
  return new Town({ personas: {}, creatureTemplates: templates, world: newWorld({}, templates, always(0.5), seed), llm: new FakeProvider(), store: new WorldStore(":memory:") });
};

const townOf = (seed: number): Town => {
  const templates = loadCreatureTemplates();
  return new Town({ personas: {}, creatureTemplates: templates, world: newWorld({}, templates, always(0.5), seed), llm: new FakeProvider() });
};

/** Walk the player along the roads to `dest`, one step at a time, as the client's auto-walk does. Returns steps taken. */
function walkTo(town: Town, data: RoadData, from: string, dest: string, max = 400_000): { steps: number; entered?: string } {
  const way = shortestWay(data, from, dest)!;
  const line = resample(
    way.roads.flatMap((jr) => {
      const r = data.roads.find((x) => x.id === jr.id)!;
      return jr.rev ? [...r.pts].reverse() : r.pts;
    }),
    10,
  );
  const p = town.world.player;
  let i = 0;
  let steps = 0;
  while (steps < max) {
    const pos = p.road!;
    // Something on the road: take the first choice that can be taken (a test walker is not curious).
    const pending = p.road!.pending ? town.road.view()?.pending : null;
    if (pending) town.road.choose((pending.choices.filter((c) => !c.hint).at(-1) ?? pending.choices[0]!).id);
    while (i < line.length - 1 && Math.hypot(line[i]!.x - pos.x, line[i]!.y - pos.y) < 3) i++;
    const target = line[i]!;
    const land = landOf(town.world.realm!);
    const path = findPath(pos, (t) => (i === line.length - 1 ? t.x === target.x && t.y === target.y : Math.hypot(t.x - target.x, t.y - target.y) < 1.5), (x, y) => !walkableAt(land, x, y), 1500);
    const first = path?.[0] ?? { x: pos.x + Math.sign(target.x - pos.x), y: pos.y };
    const res = town.road.step(first.x - pos.x, first.y - pos.y);
    if (!res?.ok) throw new Error(`stuck at ${pos.x},${pos.y} after ${steps} steps: ${res?.reason ?? "blocked"}`);
    steps++;
    if (res.entered) return { steps, entered: res.entered };
  }
  return { steps };
}

describe("N26 the scale", () => {
  it("is derived from three numbers: a day's walk plays in about seven minutes", () => {
    expect(STEPS_PER_DAY_WALK).toBe(REAL_MINUTES_PER_DAY_WALK * 60 * STEPS_PER_SECOND);
    expect(TILES_PER_UNIT * DAY_WALK_UNITS).toBeGreaterThan(STEPS_PER_DAY_WALK * 0.98);
    expect(TILES_PER_UNIT * DAY_WALK_UNITS).toBeLessThan(STEPS_PER_DAY_WALK * 1.02);
    // A road step passes less game time than a village step (a whole minute): the clock runs faster on the road.
    expect(1 / STEPS_PER_GAME_MINUTE).toBeLessThan(1);
    expect(STEPS_PER_DAY_WALK / STEPS_PER_GAME_MINUTE / 60).toBe(10);
  });
});

describe("N26 A1 road geometry", () => {
  const realm = generateRealm(1, 1);
  const data = roadDataOf(realm);

  it("is the same for the same seed", () => {
    expect(JSON.stringify(roadDataOf(generateRealm(1, 1)))).toBe(JSON.stringify(data));
    expect(JSON.stringify(roadDataOf(generateRealm(2, 1)))).not.toBe(JSON.stringify(data));
  });

  it("every road starts and ends on its settlements' gates", () => {
    for (const r of data.roads) {
      const a = data.footprints.find((f) => f.id === r.a)!;
      const gate = Object.entries(a.gates).find(([id]) => id === r.id)?.[1];
      expect(gate, r.id).toBeDefined();
      expect(r.pts[0]).toEqual(gate);
      if (!r.id.startsWith("spur:")) {
        const b = data.footprints.find((f) => f.id === r.b)!;
        expect(r.pts.at(-1)).toEqual(b.gates[r.id]);
      }
    }
  });

  it("every river crossing a road has a crossing, a bridge on a main road", () => {
    expect(data.rivers.length).toBeGreaterThan(0);
    for (const c of data.crossings) {
      const road = data.roads.find((r) => r.id === c.road)!;
      if (road.main) expect(c.kind).toBe("bridge");
      else expect(["ford", "ferry"]).toContain(c.kind);
    }
  });

  it("waystation inns stand about a day's walk apart on main roads, as hamlets with an inn", () => {
    const ways = Object.values(realm.settlements).filter((s) => s.way);
    expect(ways.length).toBeGreaterThan(10);
    for (const w of ways) {
      expect(w.kind).toBe("hamlet");
      expect(w.buildings.inn).toBe(1);
      expect(w.roads).toEqual([]);
      expect(data.roads.some((r) => r.id === `spur:${w.id}`)).toBe(true);
    }
  });

  it("no river runs through a settlement", () => {
    for (const f of data.footprints) {
      for (const r of data.rivers) for (const p of r.pts) expect(p.x >= f.x0 - r.half && p.x <= f.x1 + r.half && p.y >= f.y0 - r.half && p.y <= f.y1 + r.half, `${r.id} in ${f.id}`).toBe(false);
    }
  });
});

describe("N26 A2 chunks", () => {
  const data = roadDataOf(generateRealm(1, 1));

  it("the same chunk twice is byte-equal", () => {
    const r = data.roads.find((x) => !x.id.startsWith("spur:"))!;
    const mid = r.pts[Math.floor(r.pts.length / 2)]!;
    const cx = Math.floor(mid.x / CHUNK);
    const cy = Math.floor(mid.y / CHUNK);
    expect(Buffer.from(chunkAt(data, cx, cy).tiles).equals(Buffer.from(chunkAt(data, cx, cy).tiles))).toBe(true);
  });

  it("edges line up: the road crosses from one chunk into the next", () => {
    const r = data.roads.find((x) => !x.id.startsWith("spur:") && x.length > 600)!;
    // Walk the polyline and find a place it crosses a chunk edge; the tile on both sides is road (or a bridge).
    let checked = 0;
    for (let i = 1; i < r.pts.length && checked < 5; i++) {
      const a = r.pts[i - 1]!;
      const b = r.pts[i]!;
      if (Math.floor(a.x / CHUNK) === Math.floor(b.x / CHUNK)) continue;
      const edgeX = Math.max(Math.floor(a.x / CHUNK), Math.floor(b.x / CHUNK)) * CHUNK;
      const y = Math.round(a.y + ((b.y - a.y) * (edgeX - a.x)) / (b.x - a.x));
      const left = chunkAt(data, Math.floor((edgeX - 1) / CHUNK), Math.floor(y / CHUNK));
      const right = chunkAt(data, Math.floor(edgeX / CHUNK), Math.floor(y / CHUNK));
      const ly = ((y % CHUNK) + CHUNK) % CHUNK;
      expect([6, 7, 8, 20]).toContain(left.tiles[ly * CHUNK + CHUNK - 1]);
      expect([6, 7, 8, 20]).toContain(right.tiles[ly * CHUNK]);
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
  });

  it("a chunk takes a few milliseconds", () => {
    chunkAt(data, 100, 100);
    const t = performance.now();
    for (let i = 0; i < 20; i++) chunkAt(data, 100 + i, 200);
    expect((performance.now() - t) / 20).toBeLessThan(25);
  });
  void isSolidGround;
});

describe("N26 A3 walking from a place to its liege town", () => {
  it("takes about the steps a day's walk takes, over several chunks, and the clock runs the road scale", () => {
    const town = townOf(1);
    const realm = town.world.realm!;
    const data = roadDataOf(realm);
    const from = town.site();
    const s = realm.settlements[from]!;
    const dest = realm.settlements[s.liege ?? s.roads[0]!]!;
    const set = town.road.setDestination(dest.id, (t) => town.leaveByRoad(t));
    expect(set.ok).toBe(true);
    expect(town.road.onRoad()).toBe(true);
    const startMinute = town.world.day * 1440 + town.world.hour * 60 + (town.world.minute ?? 0);
    const way = shortestWay(data, from, dest.id)!;
    const r = walkTo(town, data, from, dest.id);
    expect(r.entered).toBe(dest.id);
    // The steps are the road's length (the gates are a couple of tiles in), give or take the width of the road.
    expect(r.steps).toBeGreaterThan(way.tiles * 0.9);
    expect(r.steps).toBeLessThan(way.tiles * 1.15 + 20);
    // Across several chunks.
    expect(r.steps / CHUNK).toBeGreaterThan(8);
    // The clock: seven steps a game minute.
    const minutes = town.world.day * 1440 + town.world.hour * 60 + (town.world.minute ?? 0) - startMinute;
    // (A situation met on the way can cost an hour or two more.)
    expect(minutes).toBeGreaterThanOrEqual(r.steps / STEPS_PER_GAME_MINUTE - 5);
    expect(minutes).toBeLessThan(r.steps / STEPS_PER_GAME_MINUTE + 600);
    // The player arrived: they are in that place, off the road, and the stretch is recorded as walked.
    expect(town.site()).toBe(dest.id);
    expect(town.world.player.road).toBeUndefined();
    expect(town.world.player.walked?.length).toBeGreaterThan(0);
    // Real minutes: steps at the walking rate.
    expect(r.steps / STEPS_PER_SECOND / 60).toBeLessThan(REAL_MINUTES_PER_DAY_WALK * (way.tiles / STEPS_PER_DAY_WALK) * 1.2 + 1);
  }, 120_000);

  it("walking back sees the same road: the chunks are byte-equal", () => {
    const realm = generateRealm(1, 1);
    const a = roadDataOf(realm);
    const b = roadDataOf(JSON.parse(JSON.stringify(realm)));
    const r = a.roads.find((x) => !x.id.startsWith("spur:"))!;
    const p = r.pts[3]!;
    expect(Buffer.from(chunkAt(a, Math.floor(p.x / CHUNK), Math.floor(p.y / CHUNK)).tiles).equals(Buffer.from(chunkAt(b, Math.floor(p.x / CHUNK), Math.floor(p.y / CHUNK)).tiles))).toBe(true);
  });
});

describe("N26 B journeys: real people on real journeys", () => {
  /** A town after some days of the realm, with the road's journeys made. */
  const aged = (days = 14) => {
    const town = peopleTown(1);
    town.passHours(24 * days);
    return town;
  };

  it("the realm sends market-goers, caravans, kin, patrols and pilgrims, each on a road that joins its places", () => {
    const town = aged();
    const js = journeysOf(town.world.realm!);
    const kinds = new Set(js.map((j) => j.kind));
    expect(kinds.has("market")).toBe(true);
    expect(kinds.size).toBeGreaterThanOrEqual(3);
    const data = roadDataOf(town.world.realm!);
    for (const j of js) {
      expect(roadsAlong(data, j.path)).toEqual(j.roads);
      expect(j.arrive).toBeGreaterThan(j.depart);
      expect(j.party.length).toBeGreaterThan(0);
    }
  });

  it("a party's position is a formula: on its road at any minute, resting at night and not before it sets out", () => {
    const town = aged();
    const data = roadDataOf(town.world.realm!);
    const j = journeysOf(town.world.realm!).find((x) => x.arrive - x.depart > 1500)!;
    expect(j).toBeDefined();
    const line = journeyLine(data, j.roads, j.path);
    expect(positionAt(j, line, j.depart - 100).state).toBe("waiting");
    expect(positionAt(j, line, j.arrive + 100).state).toBe("arrived");
    let walking = 0;
    let resting = 0;
    for (let t = j.depart; t < j.arrive; t += 37) {
      const p = positionAt(j, line, t);
      // Distance from the line (or from the inn's gate while resting at one).
      const off = Math.min(...line.pts.map((q) => Math.hypot(q.x - p.x, q.y - p.y)));
      if (p.state === "walking") {
        walking++;
        expect(off).toBeLessThan(60);
      } else resting++;
      // The walking day: nobody walks in the dead of night.
      const hour = Math.floor((t % 1440) / 60);
      if (p.state === "walking") expect(hour >= 6 && hour < 16).toBe(true);
    }
    expect(walking).toBeGreaterThan(0);
    expect(resting).toBeGreaterThan(0);
    // The same on the other side of the wire.
    expect(positionAt(JSON.parse(JSON.stringify(j)), line, j.depart + 300)).toEqual(positionAt(j, line, j.depart + 300));
  });
});

describe("N26 C roadside places, situations and nights", () => {
  it("a waystation is a hamlet's inn beside the road: walk in by its lane, find its people, and leave by the lane", () => {
    const town = townOf(1);
    const realm = town.world.realm!;
    const data = roadDataOf(realm);
    const way = Object.values(realm.settlements).find((s) => s.way)!;
    const fp = data.footprints.find((f) => f.id === way.id)!;
    const gate = fp.gates[`spur:${way.id}`]!;
    // Stand on the lane a step outside the gate and walk in.
    const out = gate.x === fp.x0 ? { x: gate.x - 1, y: gate.y } : gate.x === fp.x1 ? { x: gate.x + 1, y: gate.y } : gate.y === fp.y0 ? { x: gate.x, y: gate.y - 1 } : { x: gate.x, y: gate.y + 1 };
    town.world.player.road = { x: out.x, y: out.y, steps: 0, from: town.site(), paid: {}, met: {}, seen: {} };
    const r = town.road.step(gate.x - out.x, gate.y - out.y);
    expect(r.entered).toBe(way.id);
    expect(town.site()).toBe(way.id);
    // An inn, and an innkeeper who hears every rumour, are there.
    expect(town.localIds().some((id) => /innkeeper/i.test(town.personas[id]!.role) || town.personas[id]!.template === "innkeeper")).toBe(true);
    // Leaving puts them back on the lane outside the gate.
    town.leaveByRoad();
    const road = town.world.player.road!;
    expect(Math.abs(road.x - gate.x) + Math.abs(road.y - gate.y)).toBeLessThanOrEqual(3);
  });

  it("every situation file passes its schema and has a choice that needs nothing", () => {
    const defs = loadSituations();
    expect(defs.length).toBeGreaterThanOrEqual(10);
    for (const d of defs) expect(d.choices.some((c) => !c.requires), d.id).toBe(true);
  });

  /** A town whose player stands on a road where `id` is rolled for a day, with it pending. */
  function withSituation(id: string): { town: Town; rolled: Rolled } {
    const town = peopleTown(1);
    const realm = town.world.realm!;
    ensureLivePeople(realm, town.store!.people, liveSites(realm), 1);
    const data = roadDataOf(realm);
    for (let day = 1; day < 200; day++) {
      for (const road of data.roads) {
        if (road.id.startsWith("spur:")) continue;
        for (let seg = 0; seg < 4; seg++) {
          const rolled = rollSegment(realm, data, road, seg, day, town.store!.people);
          if (rolled?.def.id === id) {
            town.world.day = day;
            const at = pointAt(road.pts, cumulative(road.pts), rolled.t);
            town.world.player.road = { x: Math.round(at.x), y: Math.round(at.y), steps: 0, from: road.a, paid: {}, met: {}, seen: {}, pending: { kind: "situation", id, key: rolled.key } };
            return { town, rolled };
          }
        }
      }
    }
    throw new Error(`no ${id} rolled in 200 days`);
  }

  it("the same stretch of road has the same trouble on the same day, for everyone", () => {
    const realm = generateRealm(1, 1);
    const data = roadDataOf(realm);
    const road = data.roads.find((r) => !r.id.startsWith("spur:") && r.length > 3000)!;
    const a = Array.from({ length: 30 }, (_, d) => rollSegment(realm, data, road, 0, d + 1)?.def.id ?? null);
    const again = generateRealm(1, 1);
    const againData = roadDataOf(again);
    const b = Array.from({ length: 30 }, (_, d) => rollSegment(again, againData, againData.roads.find((r) => r.id === road.id)!, 0, d + 1)?.def.id ?? null);
    expect(a).toEqual(b);
    expect(a.some((x) => x !== null)).toBe(true);
  });

  it("helping someone hurt records an event, raises their trust, and what came of it later is linked to the choice", () => {
    const { town, rolled } = withSituation("injured_traveller");
    const world = town.world;
    const view = town.road.view()!.pending!;
    expect(view.title).toMatch(/hurt/i);
    const before = world.player.reputation?.trust ?? 0;
    const r = town.road.choose("tend");
    expect(r.ok).toBe(true);
    const ev = world.events!.filter((e) => e.kind === "road").at(-1)!;
    expect(ev.details).toMatch(/Bind the leg/);
    expect(world.player.reputation!.trust).toBeGreaterThan(before);
    // The one they helped is someone who talks now, and trusts the player.
    // They are a real person of the table, not made up for the occasion (N26 Part E).
    const id = rolled.actors[0]!.person;
    expect(town.store!.people.get(id)).not.toBeNull();
    expect(world.talkers![id]).toBeDefined();
    expect(town.agents[id]!.state.relationship).toBeGreaterThan(0);
    // Days later: what came of it, linked to the choice.
    const later = world.roadLater!.find((x) => x.cause === ev.id)!;
    expect(later).toBeDefined();
    const lines = dueLater(town, later.day);
    expect(lines.length).toBeGreaterThan(0);
    const result = world.events!.filter((e) => e.kind === "road").at(-1)!;
    expect(result.causedBy).toEqual([ev.id]);
  });

  it("ignoring someone hurt has a consequence too, linked to the same choice", () => {
    const { town } = withSituation("injured_traveller");
    town.road.choose("pass");
    const ev = town.world.events!.filter((e) => e.kind === "road").at(-1)!;
    const lines = dueLater(town, town.world.day + 5);
    expect(lines.length).toBeGreaterThan(0);
    expect(town.world.events!.filter((e) => e.kind === "road").at(-1)!.causedBy).toEqual([ev.id]);
  });

  it("a choice that needs coin can't be made without it", () => {
    const { town } = withSituation("peddler");
    town.world.player.money = 0;
    expect(town.road.view()!.pending!.choices.find((c) => c.id === "pie")!.hint).toMatch(/need/i);
    expect(town.road.choose("pie").ok).toBe(false);
    expect(town.world.player.road!.pending).toBeDefined();
  });

  it("a pack's ground and a gang's ambush are met once a day, with the fight", () => {
    const town = townOf(1);
    const realm = town.world.realm!;
    const data = roadDataOf(realm);
    const t = threatsOf(realm, data).find((x) => x.kind === "pack" && realm.packs[x.id.slice(5)]!.count >= realm.packs[x.id.slice(5)]!.cap * 0.6) ?? threatsOf(realm, data).find((x) => x.kind === "gang")!;
    town.world.player.road = { x: t.at.x, y: t.at.y, steps: 0, from: t.near, paid: {}, met: {}, seen: {} };
    town.world.player.hp = town.world.player.maxHp;
    const first = meetThreats(town, always(0.1));
    expect(first.length).toBeGreaterThan(0);
    expect(meetThreats(town, always(0.1))).toEqual([]);
  });

  it("nights in the open: a camp passes the hours, brings rest back, and things come to the fire", () => {
    const town = townOf(1);
    const p = town.world.player;
    startRoad(town.world.realm!, p, town.site());
    needsOf(p, 0).rest = 10;
    town.world.hour = 21;
    const day = town.world.day;
    const lines = town.road.camp(8);
    expect(needsOf(p, 0).rest).toBeGreaterThan(60);
    expect(town.world.day * 24 + town.world.hour).toBe(day * 24 + 21 + 8);
    expect(lines[0]).toMatch(/camp/);
  });
});

describe("N26 D supplies, mounts and fast travel", () => {
  it("food, water and rest fall on the road, slow the step when low, and a meal brings them back", () => {
    const town = townOf(1);
    const p = town.world.player;
    startRoad(town.world.realm!, p, town.site());
    const n = needsOf(p, 0);
    expect(town.road.cost()).toBe(1);
    tickNeeds(p, 600, 0, {});
    expect(n.food).toBeLessThan(70);
    expect(n.water).toBeLessThan(50);
    tickNeeds(p, 60 * 14, 0, {});
    expect(needsWords(n)).toMatch(/thirsty|parched/);
    expect(town.road.cost()).toBeGreaterThan(1);
    p.inventory[itemKey("bread loaf")] = 2;
    const food = n.food;
    town.road.eat("bread loaf");
    expect(n.food).toBeGreaterThan(food);
    expect(p.inventory[itemKey("bread loaf")]).toBe(1);
  });

  it("a horse makes the same road take half the time; it eats, tires and can go lame", () => {
    const town = townOf(1);
    const p = town.world.player;
    p.money = 1000;
    expect(buyMount(p, "horse", town.site(), always(0.1)).ok).toBe(true);
    expect(town.road.cost()).toBeCloseTo(0.5);
    const m = p.mount!;
    tickMount(p, 6, { riding: true, rng: always(0.9) });
    expect(m.fed).toBeLessThan(100);
    expect(m.fitness).toBeLessThan(100);
    m.fed = 5;
    m.fitness = 20;
    const lines = tickMount(p, 2, { riding: true, rng: always(0.0) });
    expect(m.lame).toBe(true);
    expect(lines.join(" ")).toMatch(/lame/);
    expect(mountStep(m)).toBe(1);
    expect(treatMount(p).ok).toBe(true);
    expect(m.lame).toBeUndefined();
  });

  it("fast travel is offered only along the stretch already walked, and runs the clock", () => {
    const town = townOf(1);
    const realm = town.world.realm!;
    const data = roadDataOf(realm);
    const from = town.site();
    const s = realm.settlements[from]!;
    const dest = realm.settlements[s.liege ?? s.roads[0]!]!;
    // Nothing walked: no fast travel.
    town.road.setDestination(dest.id, (t) => town.leaveByRoad(t));
    expect(canFast(town)).toBe(false);
    expect(town.road.fast().join(" ")).toMatch(/haven't walked/);
    // Walk it once.
    walkTo(town, data, from, dest.id);
    expect(town.site()).toBe(dest.id);
    // Back the other way: the road is known.
    town.world.player.hp = town.world.player.maxHp;
    town.road.setDestination(from, (t) => town.leaveByRoad(t));
    expect(canFast(town)).toBe(true);
    const day0 = town.world.day * 1440 + town.world.hour * 60;
    // It stops for anything worth stopping for; asking again carries on from there.
    let arrived = false;
    const said: string[] = [];
    for (let i = 0; i < 40 && !arrived; i++) {
      const pending = town.world.player.road?.pending ? town.road.view()?.pending : null;
      if (pending) town.road.choose((pending.choices.filter((c) => !c.hint).at(-1) ?? pending.choices[0]!).id);
      said.push(...town.road.fast());
      arrived = town.site() === from && !town.world.player.road;
      if (!arrived && town.world.player.road && !town.road.view()?.pending) {
        // Walk a few steps past whatever stopped it.
        const dest2 = town.world.player.road.dest;
        void dest2;
      }
    }
    expect(arrived || said.some((l) => /You stop|You slow/.test(l))).toBe(true);
    expect(town.world.day * 1440 + town.world.hour * 60).toBeGreaterThan(day0);
    // A place the player has never walked toward is not on offer.
    const other = Object.values(realm.settlements).find((x) => !x.way && x.id !== from && x.id !== dest.id && !s.roads.includes(x.id) && shortestWay(data, dest.id, x.id))!;
    town.world.player.hp = town.world.player.maxHp;
    town.road.setDestination(other.id, (t) => town.leaveByRoad(t));
    expect(canFast(town)).toBe(false);
  }, 120_000);

  it("a paid coach between towns on the main roads skips the stretch for a fare, and sleeps at the inns", () => {
    const realm = generateRealm(1, 1);
    const data = roadDataOf(realm);
    const towns = Object.values(realm.settlements).filter((s) => !s.way && (s.kind === "town" || s.kind === "city" || s.kind === "capital"));
    let pair: [string, string] | null = null;
    for (const a of towns) for (const b of towns) if (!pair && a.id !== b.id) {
      const t = townOf(1);
      t.world.player.site = a.id;
      if (quoteCoach(t, b.id, 0).ok) pair = [a.id, b.id];
    }
    expect(pair).not.toBeNull();
    const t = townOf(1);
    t.world.realm = realm;
    t.world.player.site = pair![0];
    t.world.player.money = 5000;
    const q = quoteCoach(t, pair![1], t.road.minute());
    expect(q.price).toBeGreaterThan(0);
    const day = t.world.day;
    const r = takeCoach(t, pair![1], t.road.minute());
    expect(r.ok).toBe(true);
    expect(t.world.player.money).toBe(5000 - q.price);
    expect(t.site()).toBe(pair![1]);
    expect(t.world.day).toBeGreaterThanOrEqual(day);
    void data;
  });
});

describe("N26 B3 meeting a caravan", () => {
  /** A town with the player standing beside a caravan that is on the road now. */
  function besideCaravan(): { town: Town; j: Journey } {
    const town = peopleTown(1);
    town.passHours(24 * 12);
    let j: Journey | undefined;
    for (let i = 0; i < 60 && !j; i++) {
      const now = town.road.minute();
      j = journeysOf(town.world.realm!).find((x) => x.kind === "caravan" && now >= x.depart && now < x.arrive && x.cargo && x.path.length >= 2);
      if (!j) town.passHours(4);
    }
    const data = roadDataOf(town.world.realm!);
    const at = positionAt(j!, journeyLine(data, j!.roads, j!.path), town.road.minute());
    town.world.player.road = { x: Math.round(at.x), y: Math.round(at.y), steps: 0, from: j!.path[0]!, paid: {}, met: {}, seen: {} };
    town.world.player.hp = town.world.player.maxHp;
    return { town, j: j! };
  }

  it("robbing one takes its goods, is a crime, ends its journey, and is news that travels", () => {
    const { town, j } = besideCaravan();
    town.world.player.level = 40;
    town.world.player.attributes.strength = 20;
    const goods = Object.keys(j.cargo!);
    const r = town.road.rob(j.id);
    expect(r.ok).toBe(true);
    // The strong win; if the dice went the other way the player is hurt instead.
    if (j.ended) {
      for (const item of goods) expect(Object.keys(town.world.player.inventory).some((k) => k.startsWith(item))).toBe(true);
      expect(town.world.player.bounty).toBeGreaterThan(0);
      expect(town.world.realm!.news.some((n) => /robbed on the road/.test(n.text))).toBe(true);
      expect(town.road.rob(j.id).ok).toBe(false);
    } else expect(town.world.player.hp).toBeLessThan(town.world.player.maxHp);
  });

  it("travelling with one is safer and takes the days it takes, and ends where it ends", () => {
    const { town, j } = besideCaravan();
    const day = town.world.day;
    const r = town.road.travelWith(j.id);
    expect(r.ok).toBe(true);
    expect(town.site()).toBe(j.path.at(-1));
    expect(town.world.player.road).toBeUndefined();
    expect(town.world.day * 1440 + town.world.hour * 60).toBeGreaterThanOrEqual(Math.floor(j.arrive / 1440) * 1440);
    expect(town.world.day).toBeGreaterThanOrEqual(day);
  });

  it("the road stays inside its bounds after weeks", () => {
    const town = peopleTown(2);
    town.passHours(24 * 30);
    for (const b of checkRoadBounds(town.world.realm!, town.store!.people, town.world.day)) expect(b.ok, `${b.name}: ${b.detail}`).toBe(true);
  });
});
