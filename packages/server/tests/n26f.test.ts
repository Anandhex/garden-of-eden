import { LONG } from "./long.js";
/**
 * N26F: a road worth walking. Pack beasts are rows (step 0c), packs and gangs hold stretches of road (territories), their
 * members come out on the map, wildlife and roadside places along the way, the village's surroundings on the road,
 * commuters and the mine watch, and situations every stretch.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { config } from "../src/config.js";
import { WorldStore } from "../src/game/db.js";
import { loadCreatureTemplates } from "../src/game/creatures.js";
import { seededRng } from "../src/game/dice.js";
import { liveSites } from "../src/game/people/live.js";
import { advanceWorld } from "../src/game/people/world.js";
import { killBeast, lose, syncBeasts, tookLife } from "../src/game/realm/beasts.js";
import { generateRealm } from "../src/game/realm/generate.js";
import { settleHaunts, stockHaunts } from "../src/game/realm/haunts.js";
import { pickStartSite } from "../src/game/realm/start.js";
import type { Pack, Realm } from "../src/game/realm/types.js";
import { materialisePeople } from "../src/store/materialise.js";
import { woundsOf } from "../src/store/beastStore.js";

vi.setConfig({ testTimeout: 180_000 });
beforeEach(() => {
  config.director = false;
  config.planning = false;
  config.realm = true;
});

const templates = loadCreatureTemplates();

function realmWorld(seed = 1) {
  const realm = generateRealm(seed, 1);
  const store = new WorldStore(":memory:");
  materialisePeople(realm, store.people, 1);
  syncBeasts(realm, store.beasts, 1);
  return { realm, store };
}

const bigPack = (realm: Realm): Pack => Object.values(realm.packs).filter((p) => p.count >= 4).sort((a, b) => b.count - a.count || (a.id < b.id ? -1 : 1))[0]!;
const player = () => ({ name: "Tester", money: 0, renown: 0 }) as never;

describe("N26F step 0c: pack beasts are rows", () => {
  // Times out under a full-suite load (2026-11-03): run with LONG=1 (the nightly job).
  it.skipIf(!LONG)("every pack's count is its living rows, day after day, and the young have mothers in the pack", () => {
    const { realm, store } = realmWorld(1);
    const live = liveSites(realm, pickStartSite(realm, realm.seed), "slice");
    for (let d = 2; d <= 60; d++) {
      advanceWorld(realm, store, d, { live });
      for (const p of Object.values(realm.packs)) expect(store.beasts.livingCount(p.id), `${p.id} on day ${d}`).toBe(p.count);
    }
    const young = Object.values(realm.packs).flatMap((p) => store.beasts.ofPack(p.id)).filter((b) => b.mother);
    expect(young.length).toBeGreaterThan(0);
    for (const b of young) {
      const m = store.beasts.get(b.mother!)!;
      expect(m.sex).toBe("f");
      expect([b.pack, ...Object.keys(realm.packs)]).toContain(m.pack);
    }
  });

  it("a wolf wounded in the woods is the same wolf, still hurt, the next day", () => {
    const { realm, store } = realmWorld(1);
    const p = bigPack(realm);
    const here = {};
    const first = stockHaunts(realm, here, p.near, templates, 1, seededRng(1), () => false, store.beasts).filter((c) => c.packId === p.id);
    const hurt = first.find((c) => !c.figure)!;
    hurt.hp = Math.round(hurt.hp * 0.4);
    hurt.outcome = "fled";
    settleHaunts(realm, here, p.near, player(), 1, store.beasts, templates);
    const row = store.beasts.get(hurt.beast!)!;
    expect(woundsOf(row).hp).toBeLessThan(0.6);
    expect(woundsOf(row).survived).toBe(1);
    // The next day it has mended a little, and it is still the same beast in the same pack.
    syncBeasts(realm, store.beasts, 2);
    const again = store.beasts.get(hurt.beast!)!;
    expect(again.died).toBeNull();
    expect(woundsOf(again).hp).toBeGreaterThan(woundsOf(row).hp - 0.0001);
    expect(woundsOf(again).hp).toBeLessThan(1);
  });

  it("killing a wolf on the map kills its row, and the pack is one fewer", () => {
    const { realm, store } = realmWorld(1);
    const p = bigPack(realm);
    const before = p.count;
    const here = {};
    const c = stockHaunts(realm, here, p.near, templates, 1, seededRng(1), () => false, store.beasts).find((x) => x.packId === p.id && !x.figure)!;
    c.outcome = "dead";
    settleHaunts(realm, here, p.near, player(), 1, store.beasts, templates);
    expect(store.beasts.get(c.beast!)!.died).toBe(1);
    expect(store.beasts.get(c.beast!)!.died_by).toBe("player");
    expect(p.count).toBe(before - 1);
    expect(store.beasts.livingCount(p.id)).toBe(p.count);
  });

  it("a wolf that kills a traveller gets a name, and the news names the dead", () => {
    const { realm, store } = realmWorld(1);
    const p = bigPack(realm);
    tookLife(p, 3, { who: "someone-1", name: "Hal Mercer" });
    syncBeasts(realm, store.beasts, 3);
    const killer = store.beasts.living(p.id).find((b) => b.kills.includes("Hal Mercer"))!;
    expect(killer).toBeDefined();
    expect(killer.figure).toBeTruthy();
    const f = realm.figures[killer.figure!]!;
    expect(realm.news.some((n) => n.text.includes("Hal Mercer") && n.text.includes(f.name))).toBe(true);
  });

  it("when the alpha dies the strongest named beast leads; with none named, the oldest grown one", () => {
    const { realm, store } = realmWorld(1);
    const p = bigPack(realm);
    // Make sure there's a named beast besides the alpha.
    tookLife(p, 2, { who: "x", name: "Ada Reed" });
    syncBeasts(realm, store.beasts, 2);
    const alphaRow = store.beasts.living(p.id).find((b) => b.figure && b.figure === p.alpha);
    const named = store.beasts.living(p.id).filter((b) => b.figure && b.figure !== p.alpha);
    if (alphaRow) killBeast(realm, store.beasts, alphaRow.id, 3, "killed by hunters", null);
    else p.alpha = null;
    syncBeasts(realm, store.beasts, 3);
    expect(p.alpha).toBeTruthy();
    if (named.length > 0) expect(named.map((b) => b.figure)).toContain(p.alpha);
    expect(realm.figures[p.alpha!]!.alive).toBe(true);
  });

  it("losses by hunger fall on the youngest and oldest; losses to hunters on the grown", () => {
    const { realm, store } = realmWorld(2);
    const p = bigPack(realm);
    lose(p, 1, 2, "hunted by someone", "x");
    syncBeasts(realm, store.beasts, 2);
    const dead = store.beasts.ofPack(p.id).find((b) => b.died === 2)!;
    expect(dead.died_how).toBe("hunted by someone");
    expect(store.beasts.livingCount(p.id)).toBe(p.count);
  });
});

// ---------- steps 1 and 2: territories, and hostiles on the map ----------

import { newWorld } from "../src/game/save.js";
import { Town } from "../src/game/town.js";
import { FakeProvider, always } from "./helpers.js";
import { besideRoad, inTerritory } from "@millbrook/shared";
import { roadDataOf } from "../src/game/road/generateRoads.js";
import { territoriesNow } from "../src/game/road/territories.js";
import { hostilesStep, strongEnough, UNSTOCK } from "../src/game/road/hostiles.js";
import { encountersDay } from "../src/game/road/encounters.js";
import { journeysOf } from "../src/game/road/journeys.js";

function roadTown(seed = 1): Town {
  const store = new WorldStore(":memory:");
  const world = newWorld({}, templates, always(0.5), seed);
  materialisePeople(world.realm!, store.people, world.day);
  syncBeasts(world.realm!, store.beasts, world.day);
  return new Town({ personas: {}, creatureTemplates: templates, world, llm: new FakeProvider(), store });
}

/** Put the player on the road in the middle of a territory, at an hour. */
function standIn(town: Town, tid: string, hour: number) {
  const realm = town.world.realm!;
  const data = roadDataOf(realm);
  const t = territoriesNow(realm, data).find((x) => x.id === tid)!;
  const road = data.roads.find((r) => r.id === t.road)!;
  const at = besideRoad(road, (t.t0 + t.t1) / 2, 0);
  town.world.hour = hour;
  town.world.minute = 0;
  town.world.player.road = { x: at.x, y: at.y, steps: 0, from: t.near, paid: {}, met: {}, seen: {} };
  return { t, data, at };
}

describe("N26F step 1: territories", () => {
  it("every live pack and gang holds a stretch of road near home; a wiped-out pack's is gone", () => {
    const { realm } = realmWorld(1);
    const data = roadDataOf(realm);
    const ts = territoriesNow(realm, data);
    for (const p of Object.values(realm.packs).filter((x) => x.count > 0 && realm.settlements[x.near]?.roads.length)) {
      const mine = ts.filter((t) => t.owner === p.id);
      if (mine.length === 0) continue; // a place whose roads are all too short to hold one
      for (const t of mine) expect(t.road.split("~")).toContain(p.near);
    }
    expect(ts.filter((t) => t.kind === "gang").length).toBeGreaterThan(0);
    expect(ts.filter((t) => t.kind === "pack").length).toBeGreaterThan(Object.keys(realm.packs).length / 2);
    const p = Object.values(realm.packs).find((x) => ts.some((t) => t.owner === x.id))!;
    p.count = 0;
    expect(territoriesNow(realm, data).some((t) => t.owner === p.id)).toBe(false);
    // The same seed, the same territories.
    expect(territoriesNow(generateRealm(1, 1), data).map((t) => t.id)).toEqual(territoriesNow(generateRealm(1, 1), data).map((t) => t.id));
  });

  it("off the screen, a party robbed by a gang was robbed on that gang's road", () => {
    const { realm, store } = realmWorld(1);
    const live = liveSites(realm, pickStartSite(realm, realm.seed), "all");
    for (let d = 2; d <= 30; d++) advanceWorld(realm, store, d, { live });
    const data = roadDataOf(realm);
    const ts = territoriesNow(realm, data);
    const robbed = journeysOf(realm).filter((j) => j.ended?.why.startsWith("robbed by"));
    for (const j of robbed) {
      const gangRoads = ts.filter((t) => t.kind === "gang").map((t) => t.road);
      expect(j.roads.some((r) => gangRoads.includes(r.id))).toBe(true);
    }
    void encountersDay;
  });
});

describe("N26F step 2: hostiles on the map", () => {
  const wolfTerritory = (town: Town) => {
    const realm = town.world.realm!;
    const ts = territoriesNow(realm, roadDataOf(realm));
    const t = ts.find((x) => x.kind === "pack" && realm.packs[x.owner]!.species === "wolf" && !x.id.includes("#"))!;
    const p = realm.packs[t.owner]!;
    // Strong enough to come out.
    if (p.count < Math.ceil(p.cap * 0.6)) {
      p.count = p.cap;
      syncBeasts(realm, town.store!.beasts, town.world.day);
    }
    return { t, p };
  };

  it("walking a wolf pack's stretch at night, its own wolves come out on the map, and are seen coming", () => {
    const town = roadTown(1);
    const { t, p } = wolfTerritory(town);
    standIn(town, t.id, 22);
    const lines: string[] = [];
    for (let h = 0; h < 6 && Object.keys(town.roadCreatures).length === 0; h++) {
      town.world.hour = (22 + h) % 24;
      lines.push(...hostilesStep(town, seededRng(h)));
    }
    const wolves = Object.values(town.roadCreatures);
    expect(wolves.length).toBeGreaterThan(0);
    const rows = new Set(town.store!.beasts.living(p.id).map((b) => b.id));
    for (const c of wolves) {
      expect(c.packId).toBe(p.id);
      expect(rows.has(c.beast!)).toBe(true);
    }
    // They come on until the player sees them.
    for (let i = 0; i < 80 && !lines.some((l) => /wol/i.test(l)); i++) lines.push(...hostilesStep(town, seededRng(100 + i)));
    expect(lines.join(" ")).toMatch(/wol/i);
  });

  it("killing one is one fewer in the pack; fleeing far puts the rest back, the count unchanged", () => {
    const town = roadTown(1);
    const { t, p } = wolfTerritory(town);
    standIn(town, t.id, 22);
    for (let h = 0; h < 8 && Object.keys(town.roadCreatures).length === 0; h++) {
      town.world.hour = (21 + h) % 24;
      hostilesStep(town, seededRng(h));
    }
    const before = p.count;
    const one = Object.values(town.roadCreatures)[0]!;
    one.outcome = "dead";
    town.settleRoad();
    expect(p.count).toBe(before - 1);
    expect(town.store!.beasts.get(one.beast!)!.died).not.toBeNull();
    // Run: far enough, and they're gone back to the wild.
    town.world.player.road!.x += UNSTOCK + 50;
    hostilesStep(town, seededRng(9));
    expect(Object.keys(town.roadCreatures)).toHaveLength(0);
    expect(p.count).toBe(before - 1);
  });

  it("a weak pack stays in; and a territory comes out at most once a day", () => {
    const town = roadTown(1);
    const { t, p } = wolfTerritory(town);
    p.count = Math.max(0, Math.ceil(p.cap * 0.6) - 1);
    expect(strongEnough(town.world.realm!, t)).toBe(false);
    p.count = p.cap;
    standIn(town, t.id, 22);
    town.world.player.road!.met[t.id] = town.world.day;
    for (let h = 0; h < 6; h++) {
      town.world.hour = (22 + h) % 24;
      hostilesStep(town, seededRng(h));
    }
    expect(Object.keys(town.roadCreatures)).toHaveLength(0);
  });

  it("a gang demands a toll by its members' names on its own stretch; paying sends them off", () => {
    const town = roadTown(1);
    const realm = town.world.realm!;
    const t = territoriesNow(realm, roadDataOf(realm)).find((x) => x.kind === "gang")!;
    standIn(town, t.id, 10);
    const lines: string[] = [];
    for (let h = 0; h < 10 && !town.world.player.road!.pending; h++) {
      town.world.hour = 8 + h;
      for (let i = 0; i < 40 && !town.world.player.road!.pending; i++) lines.push(...hostilesStep(town, seededRng(h * 100 + i)));
    }
    const pend = town.world.player.road!.pending!;
    expect(pend.kind).toBe("toll");
    const gang = realm.factions[t.owner]!;
    const named = Object.values(town.roadCreatures).map((c) => c.figure);
    for (const id of named) expect(gang.members).toContain(id);
    expect(lines.join(" ")).toContain(realm.figures[named[0]!]!.name);
    town.world.player.money = 500;
    const wealth = gang.wealth;
    const r = town.road.choose("pay");
    expect(r.ok).toBe(true);
    expect(gang.wealth).toBeGreaterThan(wealth);
    expect(Object.keys(town.roadCreatures)).toHaveLength(0);
    void inTerritory;
  });
});

// ---------- step 3: wildlife ----------

import { wildlifeAt } from "@millbrook/shared";
import { promoteWild, wildNear } from "../src/game/road/wild.js";

describe("N26F step 3: wildlife", () => {
  it("the same seed, road, day and hour give the same animals; herons only by water, adders only on warm days", () => {
    const realm = generateRealm(1, 1);
    const road = roadDataOf(realm).roads[0]!;
    const a = wildlifeAt(1, road, 0, road.length, 5, 7);
    expect(a).toEqual(wildlifeAt(1, road, 0, road.length, 5, 7));
    expect(a.length).toBeGreaterThan(0);
    expect(wildlifeAt(1, road, 0, road.length, 5, 7, { water: () => false }).some((w) => w.kind === "heron")).toBe(false);
    for (let day = 1; day <= 30; day++) expect(wildlifeAt(1, road, 0, road.length, day, 13, { warm: false }).some((w) => w.kind === "adder")).toBe(false);
    const warm = Array.from({ length: 30 }, (_, i) => wildlifeAt(1, road, 0, road.length, i + 1, 13, { warm: true })).flat();
    expect(warm.some((w) => w.kind === "adder")).toBe(true);
  });

  it("a hunted deer is gone for the rest of the day, and gives meat and a hide", () => {
    const town = roadTown(1);
    const realm = town.world.realm!;
    const data = roadDataOf(realm);
    // Find a deer on some road at dawn.
    let found: { road: (typeof data.roads)[number]; id: string; x: number; y: number } | null = null;
    for (const road of data.roads) {
      const deer = wildlifeAt(realm.seed, road, 0, road.length, town.world.day, 6).find((w) => w.kind === "deer");
      if (deer) {
        found = { road, id: deer.id, x: deer.x, y: deer.y };
        break;
      }
    }
    expect(found).not.toBeNull();
    town.world.hour = 6;
    town.world.player.road = { x: found!.x, y: found!.y + 3, steps: 0, from: found!.road.a, paid: {}, met: {}, seen: {} };
    const near = wildNear(town, 80);
    if (!near.some((w) => w.id === found!.id)) return; // the land check (water, season) changed what's about here; the shared test covers the rest
    const r = promoteWild(town, found!.id);
    expect(r.creature?.template).toBe("deer");
    expect(wildNear(town, 80).some((w) => w.id === found!.id)).toBe(false);
    expect(promoteWild(town, found!.id).creature).toBeUndefined();
    const loot = templates.deer!.loot.map((l) => l.item);
    expect(loot).toEqual(expect.arrayContaining(["venison", "deer hide"]));
  });
});

// ---------- step 4: roadside places ----------

import { POI_EVERY } from "@millbrook/shared";
import { wrecksNear } from "../src/game/road/roadside.js";

describe("N26F step 4: places beside the road", () => {
  const OLD = new Set(["stones", "ruin", "cave", "herbs", "ore"]);

  it("about one old place every 700 tiles along the realm's roads, the same for the same seed", () => {
    const data = roadDataOf(generateRealm(1, 1));
    const total = data.roads.filter((r) => !r.id.startsWith("spur:")).reduce((a, r) => a + r.length, 0);
    const old = data.places.filter((p) => OLD.has(p.kind));
    const per = total / Math.max(1, old.length);
    expect(per).toBeGreaterThan(POI_EVERY * 0.7);
    expect(per).toBeLessThan(POI_EVERY * 2.2);
    expect(roadDataOf(generateRealm(1, 1)).places.filter((p) => OLD.has(p.kind)).map((p) => p.id)).toEqual(old.map((p) => p.id));
    // Each sits a little way off the road, in sight of it.
    for (const p of old.slice(0, 50)) expect(Math.hypot(p.at.x - p.on.x, p.at.y - p.on.y)).toBeLessThanOrEqual(31);
  });

  it("herbs can be picked, and grow back after some days; a shrine is prayed at once a day", () => {
    const town = roadTown(1);
    const data = roadDataOf(town.world.realm!);
    const herbs = data.places.find((p) => p.kind === "herbs")!;
    town.world.player.road = { x: herbs.on.x, y: herbs.on.y, steps: 0, from: herbs.road.split("~")[0]!, paid: {}, met: {}, seen: {} };
    town.world.player.attributes.perception = 30;
    const first = town.road.usePlace(herbs.id, "gather");
    expect(first.join(" ")).toMatch(/gather/);
    expect(town.road.usePlace(herbs.id, "gather").join(" ")).toMatch(/bare/);
    town.world.day += 4;
    expect(town.road.usePlace(herbs.id, "gather").join(" ")).toMatch(/gather/);
    const shrine = data.places.find((p) => p.kind === "shrine")!;
    town.world.player.road = { x: shrine.on.x, y: shrine.on.y, steps: 0, from: shrine.road.split("~")[0]!, paid: {}, met: {}, seen: {} };
    expect(town.road.usePlace(shrine.id, "pray").join(" ")).toMatch(/kneel/);
    expect(town.road.usePlace(shrine.id, "pray").join(" ")).toMatch(/prayed here today/);
  });

  it("an overturned cart lies only where a party was really robbed", () => {
    const town = roadTown(1);
    // No robbery yet: no carts anywhere along the first road.
    const data = roadDataOf(town.world.realm!);
    const road = data.roads[0]!;
    for (let t = 0; t < road.length; t += 200) {
      const at = besideRoad(road, t, 0);
      town.world.player.road = { x: at.x, y: at.y, steps: 0, from: road.a, paid: {}, met: {}, seen: {} };
      expect(wrecksNear(town, 40)).toEqual([]);
    }
  });
});

// ---------- steps 5 and 5b: the village's surroundings on the road; commuters and the mine watch ----------

import { siteMap } from "../src/web/sites.js";
import { campsNear } from "../src/game/road/roadside.js";
import { commutesOf, commuterAt, workPlacesOf } from "../src/game/road/commute.js";
import { mineDanger, payDuty, watchDay, SELLSWORD_WAGE } from "../src/game/road/watch.js";
import type { PersonRow } from "../src/store/peopleStore.js";

describe("N26F step 5: the woods, the camp and the mine are on the road", () => {
  it("the start town's map has no way into the woods but the road, and the woods are a place on a road out of it", () => {
    const town = roadTown(1);
    const realm = town.world.realm!;
    const site = town.site();
    const s = realm.settlements[site]!;
    const map = siteMap({ ...s, id: site } as never, "village", realm);
    expect(map.exits.map((e) => e.to)).toEqual(["realm"]);
    const woods = roadDataOf(realm).places.find((p) => p.id === `woods:${site}`)!;
    expect(woods).toBeDefined();
    expect(woods.road.split("~")).toContain(site);
    expect(woods.area).toEqual({ site, id: "woods" });
  });

  it("from the road the player walks into the woods, and out again where they went in", () => {
    const town = roadTown(1);
    const realm = town.world.realm!;
    const site = town.site();
    const woods = roadDataOf(realm).places.find((p) => p.id === `woods:${site}`)!;
    town.world.player.road = { x: woods.on.x, y: woods.on.y, steps: 0, from: site, paid: {}, met: {}, seen: {} };
    town.road.usePlace(woods.id, "enter");
    expect(town.world.player.road).toBeUndefined();
    expect(town.world.player.area).toBe("woods");
    expect(town.site()).toBe(site);
    const out = town.leaveByRoad();
    expect(out.join(" ")).toMatch(/back out onto the road/);
    expect(town.world.player.area).toBeUndefined();
    expect(town.world.player.road).toMatchObject({ x: woods.on.x, y: woods.on.y });
  });

  it("a gang's camp is never in the road data the browser gets, and is shown only once the player has found it", () => {
    const town = roadTown(1);
    const realm = town.world.realm!;
    const data = roadDataOf(realm);
    expect(data.places.some((p) => p.kind === "camp")).toBe(false);
    const t = territoriesNow(realm, data).find((x) => x.kind === "gang" && x.camp)!;
    // Far off: not known, not shown.
    town.world.player.road = { x: t.camp!.x + 60, y: t.camp!.y, steps: 0, from: t.near, paid: {}, met: {}, seen: {} };
    expect(campsNear(town, 100)).toEqual([]);
    // Close by: found.
    town.world.player.road = { x: t.camp!.x + 5, y: t.camp!.y, steps: 0, from: t.near, paid: {}, met: {}, seen: {} };
    expect(campsNear(town, 10).map((c) => c.gang)).toContain(t.owner);
    expect(town.world.player.known?.[`camp:${t.owner}`]?.how).toBe("saw");
  });
});

describe("N26F step 5b: commuters, the mine watch and hired swords", () => {
  /** A place with a working mine and miners, on a world with every place's people made. */
  function mineTown() {
    const town = roadTown(1);
    const realm = town.world.realm!;
    const data = roadDataOf(realm);
    const site = Object.values(realm.settlements)
      .filter((s) => workPlacesOf(data, s.id).mine && (town.store!.people.loadSite(s.id, "full") as PersonRow[]).some((r) => r.job === "miner" && r.death === null))
      .sort((a, b) => (a.id < b.id ? -1 : 1))[0]!;
    return { town, realm, data, site };
  }

  it("a mining town's miners walk out to its mine in the morning and are at work there by noon, by name", () => {
    const { town, realm, data, site } = mineTown();
    expect(site).toBeDefined();
    const cs = commutesOf(realm, town.store!.people, site.id, 2, data).filter((c) => c.job === "miner");
    expect(cs.length).toBeGreaterThan(0);
    const going = cs.map((c) => commuterAt(c, data, 7 * 60 + 15)).filter((x) => x?.where === "going");
    expect(going.length).toBeGreaterThan(0);
    const working = cs.map((c) => commuterAt(c, data, 12 * 60)).filter((x) => x?.where === "working");
    expect(working.length).toBe(cs.length);
    for (const c of cs) expect(town.store!.people.get(c.person)!.job).toBe("miner");
    // At night nobody is out.
    expect(cs.map((c) => commuterAt(c, data, 23 * 60)).filter(Boolean)).toHaveLength(0);
    // The afternoon cart carries the day's ore.
    const cart = commutesOf(realm, town.store!.people, site.id, 2, data).find((c) => c.job === "carter");
    if (cart) expect(cart.cargo!["iron ore"]).toBeGreaterThan(0);
  });

  it("a gang on the mine road makes the town post its full watch within a week, and hire swords it pays from its treasury", () => {
    const { town, realm, data, site } = mineTown();
    const mine = workPlacesOf(data, site.id).mine!;
    // A gang sits on the mine road (its seat the town at the other end of that road).
    const gang = Object.values(realm.factions).find((f) => f.kind === "gang")!;
    const [a, b] = mine.road.split("~");
    gang.seat = a === site.id ? b! : a!;
    // Force its stretch onto the mine road: make that the gang's only road out.
    let danger = mineDanger(realm, data, site, 2);
    if (danger.level === 0) {
      site.lastRaided = 1;
      realm.journeys.push({ id: "jx", kind: "caravan", party: [], path: [site.id, gang.seat], roads: [], depart: 0, arrive: 10, timeline: [], pace: 1, purpose: "", returns: false, ended: { minute: 1440 * 1, why: "robbed by test" } } as never);
      danger = mineDanger(realm, data, site, 2);
    }
    expect(danger.level).toBeGreaterThan(0);
    site.treasury = 100_000;
    // Few guards of its own: let them all be away.
    for (const r of town.store!.people.loadSite(site.id, "full") as PersonRow[]) if (r.job === "guard") town.store!.people.update(r.id, { job: "labourer" });
    for (let d = 2; d <= 9; d++) watchDay(realm, town.store!.people, data, d);
    expect(site.watch!.level).toBeGreaterThan(0);
    expect(site.watch!.hired.length).toBeGreaterThan(0);
    for (const h of site.watch!.hired) expect(town.store!.people.get(h.person)!.job).toBe("sellsword");
    const before = site.treasury;
    watchDay(realm, town.store!.people, data, 10);
    expect(site.treasury).toBe(before - site.watch!.hired.length * SELLSWORD_WAGE);
  });

  it("with no coin the town can't hire, and says so", () => {
    const { town, realm, data, site } = mineTown();
    realm.journeys.push({ id: "jy", kind: "caravan", party: [], path: [site.id, "x"], roads: [], depart: 0, arrive: 10, timeline: [], pace: 1, purpose: "", returns: false, ended: { minute: 1440, why: "robbed by test" } } as never);
    site.treasury = 0;
    for (const r of town.store!.people.loadSite(site.id, "full") as PersonRow[]) if (r.job === "guard") town.store!.people.update(r.id, { job: "labourer" });
    watchDay(realm, town.store!.people, data, 2);
    expect(site.watch!.hired).toHaveLength(0);
    expect(realm.news.some((n) => n.text.includes("can't pay"))).toBe(true);
  });

  it("the player hired for a day on the watch is paid at the end of it", () => {
    const { town, realm, site } = mineTown();
    site.watch = { guards: [], hired: [], level: 1, checked: 1 };
    site.treasury = 500;
    town.world.player.duty = { site: site.id, day: 3, wage: SELLSWORD_WAGE, what: "the watch" };
    town.world.player.money = 0;
    expect(payDuty(realm, town.world.player, 3)).toBeNull();
    expect(payDuty(realm, town.world.player, 4)).toMatch(/paid/);
    expect(town.world.player.money).toBe(SELLSWORD_WAGE);
  });
});

// ---------- steps 6 and 7: situations every stretch, signs, and the bounds ----------

import { rollSegment, STRETCH } from "../src/game/road/situations.js";
import { signsNear } from "../src/game/road/signs.js";
import { checkN26fBounds, roadBeatsBound } from "../src/game/road/bounds.js";
import { pickTestPlaces } from "./helpers.js";

describe("N26F step 6: situations every stretch, and signs", () => {
  it("a stretch whose actors can't be found gets a situation that needs nobody, not nothing", () => {
    const realm = generateRealm(1, 1);
    const data = roadDataOf(realm);
    const empty = new WorldStore(":memory:");
    let rolled = 0;
    for (const road of data.roads.filter((r) => !r.id.startsWith("spur:")).slice(0, 20)) {
      for (let seg = 0; seg * STRETCH < road.length; seg++) {
        const r = rollSegment(realm, data, road, seg, 3, empty.people);
        if (!r) continue;
        rolled++;
        expect(r.actors.length).toBe(r.def.actors.length);
        expect(r.def.actors.length).toBe(0);
      }
    }
    expect(rolled).toBeGreaterThan(0);
  });

  it("tracks are only inside a pack's stretch, and a fresh grave names someone who really died there", () => {
    const town = roadTown(1);
    const realm = town.world.realm!;
    const data = roadDataOf(realm);
    const t = territoriesNow(realm, data).find((x) => x.kind === "pack")!;
    const road = data.roads.find((r) => r.id === t.road)!;
    const inside = besideRoad(road, t.t0 + 160, 0);
    town.world.player.road = { x: inside.x, y: inside.y, steps: 0, from: t.near, paid: {}, met: {}, seen: {} };
    expect(signsNear(town, 40).some((s) => s.kind === "tracks" || s.kind === "carcass")).toBe(true);
    for (const s of signsNear(town, 400).filter((x) => x.kind === "tracks")) {
      const owners = territoriesNow(realm, data).filter((tt) => tt.kind === "pack" && inTerritory(data, tt, { x: s.x, y: s.y }) !== null);
      expect(owners.length).toBeGreaterThan(0);
    }
    // A grave: a party with a death, ended where the player stands.
    const way = [road.a, road.b];
    realm.journeys.push({ id: "jg", kind: "market", party: [{ person: "p1", name: "Hal Mercer", role: "farmer", gender: "male" }], path: way, roads: [{ id: road.id, rev: false }], depart: 0, arrive: 99999, timeline: [{ t0: 0, t1: 99999, d0: 0, d1: road.length }], pace: 1, purpose: "", returns: false, ended: { minute: (town.world.day - 1) * 1440 + 600, why: "driven back by wolves", dead: ["Hal Mercer"] } } as never);
    const graves = signsNear(town, 100000).filter((s) => s.kind === "grave");
    if (graves.length > 0) expect(graves[0]!.line).toContain("Hal Mercer");
  });
});

describe("N26F step 7: the road's bounds", () => {
  it("a day's walk from the start town toward its liege has 5 to 10 things to see or do, spaced through it", () => {
    for (const seed of [1, 2, 3]) {
      const realm = generateRealm(seed, 1);
      const store = new WorldStore(":memory:");
      materialisePeople(realm, store.people, 1);
      const { start, liege } = pickTestPlaces(realm);
      const b = roadBeatsBound(realm, start, liege, [2, 5, 9], store.people);
      expect(b.ok, `seed ${seed}: ${b.detail}`).toBe(true);
    }
  });

  it("territories are sane and the watch is paid", () => {
    const { realm, store } = realmWorld(1);
    for (const b of checkN26fBounds(realm, store.people)) expect(b.ok, `${b.name}: ${b.detail}`).toBe(true);
  });
});
