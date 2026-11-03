/**
 * N27: the wilds. Off the road the chunk world holds places found by walking: seeded ones (caves, ruins, stones,
 * groves, herbs, ore, hermits' huts) and ones from the realm (a pack's lair where the pack is, a dungeon's mouth, the
 * ruins of an abandoned place, a battlefield with its graves). Nothing is on the player's map until found, told or read
 * on a map; off the road the player can lose their way; finds can be reported to a place's head.
 */
import { CHUNK, Ground, chunkAt, offRoad, tileOf, wildPoiIn, wildPoisNear } from "@millbrook/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { config } from "../src/config.js";
import { loadCreatureTemplates } from "../src/game/creatures.js";
import { WorldStore } from "../src/game/db.js";
import { syncBeasts } from "../src/game/realm/beasts.js";
import { pickStartSite } from "../src/game/realm/start.js";
import { checkWildBounds } from "../src/game/road/wildPlaces.js";
import { roadDataOf } from "../src/game/road/generateRoads.js";
import { groundAt, landOf } from "../src/game/road/ground.js";
import { buyMap, gravesOf, hearOfPlaces, lostHour, mapOf, reportFind, spotPlaces, statePois, unreported, useWild, wildNearby, type StatePoi } from "../src/game/road/wildPlaces.js";
import { newWorld } from "../src/game/save.js";
import { Town } from "../src/game/town.js";
import { materialisePeople } from "../src/store/materialise.js";
import { FakeProvider, always } from "./helpers.js";

vi.setConfig({ testTimeout: 180_000 });
beforeEach(() => {
  config.director = false;
  config.planning = false;
  config.realm = true;
});

const templates = loadCreatureTemplates();

function town(seed = 1): Town {
  const store = new WorldStore(":memory:");
  const world = newWorld({}, templates, always(0.5), seed);
  materialisePeople(world.realm!, store.people, world.day);
  syncBeasts(world.realm!, store.beasts, world.day);
  return new Town({ personas: {}, creatureTemplates: templates, world, llm: new FakeProvider(), store });
}

/** Stand the player on the land at a tile (off the road or on it). */
function standAt(t: Town, x: number, y: number, hour = 12) {
  t.world.hour = hour;
  t.world.minute = 0;
  t.world.player.road = { x, y, steps: 0, from: t.world.player.site ?? pickStartSite(t.world.realm!, t.world.realm!.seed), paid: {}, met: {}, seen: {} };
}

describe("N27 step 1: seeded places in the chunks", () => {
  it("the same chunk gives the same place; they lie off the road, a few to a day's walk", () => {
    const t = town(1);
    const data = roadDataOf(t.world.realm!);
    const start = t.world.realm!.settlements[t.world.player.site!]!;
    const cx = Math.floor(tileOf(start.pos.x) / CHUNK);
    const cy = Math.floor(tileOf(start.pos.y) / CHUNK);
    let n = 0;
    for (let y = cy - 30; y < cy + 30; y++) for (let x = cx - 30; x < cx + 30; x++) {
      const p = wildPoiIn(data, x, y);
      if (!p) continue;
      n++;
      expect(wildPoiIn(roadDataOf(t.world.realm!), x, y)).toEqual(p);
      expect(offRoad(data, p.x, p.y)).toBe(true);
    }
    // 3,600 chunks, one in seven at most, less the road country.
    expect(n).toBeGreaterThan(80);
    expect(n).toBeLessThan(3600 / 7 + 60);
  });

  it("a place is drawn into its chunk (a cave has its mouth, a grove its trees)", () => {
    const t = town(1);
    const data = roadDataOf(t.world.realm!);
    const start = t.world.realm!.settlements[t.world.player.site!]!;
    const all = wildPoisNear(data, tileOf(start.pos.x), tileOf(start.pos.y), 8000);
    const cave = all.find((p) => p.kind === "cave")!;
    expect(cave).toBeTruthy();
    const c = chunkAt(data, Math.floor(cave.x / CHUNK), Math.floor(cave.y / CHUNK));
    expect(c.tiles[(cave.y - c.cy * CHUNK) * CHUNK + (cave.x - c.cx * CHUNK)]).toBe(Ground.cave);
  });
});

describe("N27 step 2: places from the realm", () => {
  it("a pack's lair lies in its range and stays put; when the pack is gone, so is its lair", () => {
    const t = town(1);
    const realm = t.world.realm!;
    const data = roadDataOf(realm);
    const pack = Object.values(realm.packs).find((p) => p.count > 0)!;
    const lair = statePois(realm, data).find((x) => x.id === `lair:${pack.id}`)!;
    const near = realm.settlements[pack.near]!;
    expect(Math.hypot(lair.x - tileOf(near.pos.x), lair.y - tileOf(near.pos.y))).toBeLessThan(1800);
    realm.day += 1;
    expect(statePois(realm, data).find((x) => x.id === lair.id)).toMatchObject({ x: lair.x, y: lair.y });
    pack.count = 0;
    realm.day += 1;
    expect(statePois(realm, data).find((x) => x.id === lair.id)).toBeUndefined();
  });

  it("every dungeon has its mouth, and an abandoned place is a ruin", () => {
    const t = town(1);
    const realm = t.world.realm!;
    const data = roadDataOf(realm);
    for (const d of Object.values(realm.dungeons)) expect(statePois(realm, data).some((x) => x.id === `dungeon:${d.id}`)).toBe(true);
    const s = Object.values(realm.settlements).find((x) => !x.way && x.kind === "hamlet")!;
    s.abandoned = true;
    realm.day += 1;
    expect(statePois(realm, data).some((x) => x.id === `abandoned:${s.id}` && x.kind === "abandoned")).toBe(true);
  });
});

describe("N27 the done-when: off the road from the start town", () => {
  it("the player finds a cave not on any map, a battlefield of an old war with a named grave, and reports an ore outcrop to the head", () => {
    const t = town(1);
    const realm = t.world.realm!;
    const data = roadDataOf(realm);
    const home = realm.settlements[t.world.player.site!]!;
    const hx = tileOf(home.pos.x);
    const hy = tileOf(home.pos.y);
    const east = wildPoisNear(data, hx, hy, 30000).filter((p) => p.x > hx);
    const cave = east.filter((p) => p.kind === "cave").sort((a, b) => a.x - b.x)[0]!;
    const ore = east.filter((p) => p.kind === "ore").sort((a, b) => a.x - b.x)[0]!;
    expect(cave && ore).toBeTruthy();
    // Not on the player's map until found.
    expect(mapOf(t.world.player).pois[cave.id]).toBeUndefined();
    standAt(t, cave.x, cave.y + 2);
    expect(spotPlaces(t).join(" ")).toContain(cave.name);
    expect(mapOf(t.world.player).pois[cave.id]?.how).toBe("found");
    expect(wildNearby(t).map((x) => x.id)).toContain(cave.id);
    standAt(t, ore.x, ore.y + 2);
    spotPlaces(t);
    expect(unreported(t.world.player).map((f) => f.id)).toContain(ore.id);

    // An old war: a battle fought for the start town, and one of its people killed in it.
    const row = (t.store!.people.loadSite(home.id, "full") as Array<{ id: string; name: string }>)[0]!;
    realm.wars.push({ id: "w_test", attackers: [], defenders: [], cause: "a test", start: 1, score: 0, battles: [{ day: 1, at: home.id, winner: "defenders", losses: 3, text: "the raiders were thrown back" }] } as never);
    t.store!.people.update(row.id, { death: JSON.stringify({ cause: "battle", day: 1, site: home.id }) });
    realm.day += 1;
    const field = statePois(realm, data).find((x) => x.id === "battle:w_test:0") as StatePoi;
    expect(field).toBeTruthy();
    standAt(t, field.x, field.y + 2);
    spotPlaces(t);
    expect(useWild(t, field.id, "graves", 0).join(" ")).toContain(row.name);
    expect(gravesOf(t, field).join(" ")).toContain(row.name);

    // Back in town: the ore outcrop reported to the head pays from the coffers and goes in the realm's finds.
    delete t.world.player.road;
    const before = t.world.player.money;
    home.treasury = Math.max(home.treasury, 500);
    const lines = reportFind(t, ore.id);
    expect(lines.join(" ")).toContain(ore.name);
    expect(t.world.player.money).toBeGreaterThan(before);
    expect(realm.finds?.some((f) => f.poi === ore.id && f.reportedTo === home.id)).toBe(true);
    expect(reportFind(t, ore.id).join(" ")).toContain("already");
  });

  it("an innkeeper tells of places; a bought map marks the country round", () => {
    const t = town(1);
    const realm = t.world.realm!;
    const home = realm.settlements[t.world.player.site!]!;
    const at = { x: tileOf(home.pos.x), y: tileOf(home.pos.y) };
    expect(hearOfPlaces(t, at).join(" ")).toContain("They tell you of");
    expect(Object.values(mapOf(t.world.player).pois).some((k) => k.how === "told")).toBe(true);
    t.world.player.money = 100;
    expect(buyMap(t, at, "").join(" ")).toContain("marks");
    expect(t.world.player.money).toBe(40);
    expect(Object.values(mapOf(t.world.player).pois).some((k) => k.how === "map")).toBe(true);
  });

  it("the player never hears of a place from the realm they don't know: only known places are near them", () => {
    const t = town(1);
    const realm = t.world.realm!;
    const lair = statePois(realm, roadDataOf(realm)).find((x) => x.kind === "lair")!;
    standAt(t, lair.x + 3, lair.y);
    expect(wildNearby(t).map((x) => x.id)).not.toContain(lair.id);
    expect(t.road.view()!.nearby.map((x) => x.id)).not.toContain(lair.id);
  });
});

/** A marsh tile off the road. */
function marshSpot(t: Town): { x: number; y: number } | null {
  const realm = t.world.realm!;
  const land = landOf(realm);
  for (const s of Object.values(realm.settlements).filter((x) => x.terrain === "marsh" && !x.way)) {
    const cx = tileOf(s.pos.x);
    const cy = tileOf(s.pos.y);
    for (let r = 400; r < 1600; r += 100) for (let a = 0; a < 16; a++) {
      const x = Math.round(cx + Math.cos(a) * r);
      const y = Math.round(cy + Math.sin(a) * r);
      if (!offRoad(land.data, x, y)) continue;
      const g = groundAt(land, x, y);
      if (g === Ground.marsh || g === Ground.reeds) return { x, y };
    }
  }
  return null;
}

describe("N27 step 6: getting lost", () => {
  it("in the marsh at night without a guide the player loses their way within a few hours; with a guide, never", () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const t = town(seed);
      const spot = marshSpot(t);
      if (!spot) continue;
      standAt(t, spot.x, spot.y, 21);
      let lost = false;
      for (let h = 0; h < 8 && !lost; h++) {
        t.world.hour = (21 + h) % 24;
        lostHour(t);
        lost = !!mapOf(t.world.player).lost;
      }
      expect(lost).toBe(true);
      // With a guide (a companion who knows the country), never.
      const guided = town(seed);
      standAt(guided, spot.x, spot.y, 21);
      guided.companions = () => [{ persona: { skills: { survival: 3 } } }] as never;
      for (let h = 0; h < 8; h++) {
        guided.world.hour = (21 + h) % 24;
        lostHour(guided);
      }
      expect(mapOf(guided.world.player).lost).toBeUndefined();
      return;
    }
    throw new Error("no marsh off the road on seeds 1-5");
  });

  it("lost, a step can go astray; reaching the road ends it", () => {
    const t = town(1);
    const realm = t.world.realm!;
    const road = roadDataOf(realm).roads.find((r) => !r.id.startsWith("spur:"))!;
    const mid = road.pts[Math.floor(road.pts.length / 2)]!;
    standAt(t, mid.x, mid.y, 12);
    mapOf(t.world.player).lost = { since: 0 };
    expect(lostHour(t).join(" ")).toContain("road");
    expect(mapOf(t.world.player).lost).toBeUndefined();
  });
});

describe("N27 bounds", () => {
  it("no place has more than a few lairs near it", () => {
    const t = town(1);
    for (const b of checkWildBounds(t.world.realm!)) expect(b.ok, `${b.name}: ${b.detail}`).toBe(true);
  });
});
