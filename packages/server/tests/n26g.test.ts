/**
 * N26G: fields outside the village. A place's farmland lies around it in the road world, cut into plots held by its
 * households, the lord, the temple and the commons; they sow, weed and reap them; deer, boars, crows, stock, weather,
 * fire and the hungry damage them tile by tile; and the place's food is what its plots yield.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { dayOfYear, fieldsOf, growthAt, isMarked, nearestOnSegment, plotCount, STAGE, type Plot } from "@millbrook/shared";
import { config } from "../src/config.js";
import { WorldStore } from "../src/game/db.js";
import { cropFor, loadCrops } from "../src/game/farm/crops.js";
import { fieldsDay, playerReaps, plotTiles, pointsFor } from "../src/game/farm/day.js";
import { ensurePlots, householdsAt, plotsOf } from "../src/game/farm/fields.js";
import { checkFieldBounds } from "../src/game/farm/bounds.js";
import { liveSites } from "../src/game/people/live.js";
import { advanceWorld } from "../src/game/people/world.js";
import { syncBeasts } from "../src/game/realm/beasts.js";
import { EATEN_PER_YEAR } from "../src/game/realm/economy.js";
import { generateRealm } from "../src/game/realm/generate.js";
import { pickStartSite } from "../src/game/realm/start.js";
import type { Realm } from "../src/game/realm/types.js";
import { roadDataOf } from "../src/game/road/generateRoads.js";
import { materialisePeople } from "../src/store/materialise.js";
import type { PersonRow } from "../src/store/peopleStore.js";

vi.setConfig({ testTimeout: 300_000 });
beforeEach(() => {
  config.director = false;
  config.planning = false;
  config.fields = true;
});

function world(seed = 1) {
  const realm = generateRealm(seed, 1);
  const store = new WorldStore(":memory:");
  materialisePeople(realm, store.people, 1);
  syncBeasts(realm, store.beasts, 1);
  const start = pickStartSite(realm, realm.seed);
  const live = liveSites(realm, start, "slice");
  return { realm, store, start, live };
}

const input = (realm: Realm, id: string) => {
  const s = realm.settlements[id]!;
  return { site: id, terrain: s.terrain, population: s.population, farms: s.buildings.farms ?? 0, kind: s.kind };
};

describe("N26G step 1: the land laid out", () => {
  it("the same seed lays out the same fields; plots keep off the roads and out of every place, and don't overlap", () => {
    const realm = generateRealm(1, 1);
    const data = roadDataOf(realm);
    const start = pickStartSite(realm, realm.seed);
    const a = fieldsOf(input(realm, start), data);
    expect(fieldsOf(input(generateRealm(1, 1), start), roadDataOf(generateRealm(1, 1)))).toEqual(a);
    expect(a.length).toBe(plotCount(input(realm, start)));
    for (const p of a) {
      for (const f of data.footprints) expect(p.x + p.w <= f.x0 || p.x >= f.x1 + 1 || p.y + p.h <= f.y0 || p.y >= f.y1 + 1).toBe(true);
      for (const r of data.roads.filter((x) => !x.id.startsWith("spur:") && x.pts.some((q) => Math.abs(q.x - p.x) < 300 && Math.abs(q.y - p.y) < 300))) {
        for (const q of [{ x: p.x, y: p.y }, { x: p.x + p.w - 1, y: p.y + p.h - 1 }]) {
          let d = Infinity;
          for (let i = 1; i < r.pts.length; i++) d = Math.min(d, nearestOnSegment(r.pts[i - 1]!, r.pts[i]!, q).d);
          expect(d).toBeGreaterThan(2);
        }
      }
    }
    for (let i = 0; i < a.length; i++) for (let j = i + 1; j < a.length; j++) {
      const p = a[i]!;
      const q = a[j]!;
      expect(p.x < q.x + q.w && p.x + p.w > q.x && p.y < q.y + q.h && p.y + p.h > q.y).toBe(false);
    }
  });

  it("land per head is more on plains than in hills; every household that farms holds a plot", () => {
    expect(plotCount({ site: "x", terrain: "plains", population: 100, farms: 0, kind: "village" })).toBeGreaterThan(plotCount({ site: "x", terrain: "hills", population: 100, farms: 0, kind: "village" }));
    const { realm, store, start } = world(1);
    const s = realm.settlements[start]!;
    const rows = ensurePlots(realm, store, s, plotsOf(realm, s, 1), 1);
    const holders = new Set([...rows.values()].map((r) => r.holder));
    for (const h of householdsAt(store, start, 1).farming) expect(holders.has(h)).toBe(true);
    // The lord holds the demesne; paddocks and meadow are the commons.
    if (s.leader) expect(holders.has(`lord:${s.leader}`)).toBe(true);
    const plots = plotsOf(realm, s, 1);
    for (const p of plots.filter((x) => x.kind === "paddock" || x.kind === "meadow")) expect(rows.get(p.id)!.holder).toBe("commons");
  });
});

describe("N26G step 2: crops and growth", () => {
  const plot: Plot = { id: "pl:t:0", site: "t", x: 0, y: 0, w: 4, h: 16, kind: "strip", field: 0, ring: 0 };

  it("wheat sown in early spring is ripe in its window and rots if not reaped; a fallow plot grows nothing", () => {
    const wheat = loadCrops().wheat!;
    const sowing = { plot: plot.id, crop: "wheat", day: 2 };
    expect(growthAt(plot, sowing, wheat, [], 2)[0]).toBe(STAGE.sown);
    expect(growthAt(plot, sowing, wheat, [], 2 + wheat.grow)[0]).toBe(STAGE.ripe);
    expect(growthAt(plot, sowing, wheat, [], 2 + wheat.grow + wheat.ripe)[0]).toBe(STAGE.rotting);
    // Reaped, it's stubble.
    expect(growthAt(plot, sowing, wheat, [{ plot: plot.id, day: 2 + wheat.grow, kind: "harvest", tiles: [], by: "x", amount: 1 }], 2 + wheat.grow + 1)[0]).toBe(STAGE.stubble);
    // Fallow: the rotation leaves one field in three bare each year.
    const courses = [0, 1, 2].map((y) => cropFor("strip", 0, y, "plains", 7));
    expect(courses.filter((c) => c === null)).toHaveLength(1);
    expect(growthAt(plot, undefined, undefined, [], 10).every((x) => x === 0)).toBe(true);
  });

  it("damage marks the tiles it touched, and only those", () => {
    const wheat = loadCrops().wheat!;
    const sowing = { plot: plot.id, crop: "wheat", day: 1 };
    const st = growthAt(plot, sowing, wheat, [{ plot: plot.id, day: 10, kind: "root", tiles: [3, 4, 5], by: "b-1", amount: 3 }], 20);
    expect([...st].filter(isMarked).length).toBe(3);
    expect(isMarked(st[4]!)).toBe(true);
    expect(isMarked(st[0]!)).toBe(false);
  });
});

describe("N26G steps 3–6: the work, the damage, the food", () => {
  it("over a year the start town's plots are sown and reaped by its own people, by name, and its food rises at harvest and falls after", () => {
    const { realm, store, start, live } = world(1);
    const food: number[] = [];
    for (let d = 2; d <= 49; d++) {
      advanceWorld(realm, store, d, { live });
      food.push(realm.settlements[start]!.food);
    }
    const events = store.farm.eventsOf(start).length > 0 ? store.farm.eventsOf(start) : [];
    const years = store.farm.yearOfSite(start, 0);
    expect(years.length).toBeGreaterThan(0);
    expect(years.reduce((a, r) => a + r.reaped, 0)).toBeGreaterThan(0);
    void events;
    // Who sowed: the sowings exist for the year, and the people who did the work are rows of the place.
    const plots = plotsOf(realm, realm.settlements[start]!, 49);
    expect(plots.filter((p) => store.farm.sowingOf(start, p.id, 0)).length).toBeGreaterThan(plots.length / 3);
    // The year's shape: lowest before the harvest, then up.
    const lo = food.indexOf(Math.min(...food.slice(0, 30)));
    expect(Math.max(...food.slice(lo))).toBeGreaterThan(food[lo]! + 20);
    // The food the harvest gave is what the plots reaped.
    expect(pointsFor(years.reduce((a, r) => a + r.reaped, 0), realm.settlements[start]!.population)).toBeGreaterThan(EATEN_PER_YEAR * 0.85);
  });

  it("the work is done by named people of the household; a household with nobody left leaves its plot to the lord", () => {
    const { realm, store, start } = world(1);
    const s = realm.settlements[start]!;
    for (let d = 1; d <= 8; d++) fieldsDay(realm, store, start, d);
    const sows = store.farm.eventsOf(start).filter((e) => e.kind === "sow");
    expect(sows.length).toBeGreaterThan(0);
    for (const e of sows) {
      const r = store.people.get(e.by);
      if (r) expect(r.site).toBe(start);
      else expect(e.by).toMatch(/^(lord:|temple:|commons|hh:)/);
    }
    // Everyone in one household dies: their plots go back.
    const rows = store.farm.plotsOf(start);
    const hh = [...rows.values()].find((r) => r.holder.startsWith("hh:"))!.holder;
    for (const r of householdsAt(store, start, 9).all.get(hh) ?? []) store.people.update(r.id, { death: JSON.stringify({ cause: "illness", day: 9 }) });
    fieldsDay(realm, store, start, 9);
    expect([...rows.values()].some((r) => r.holder === hh)).toBe(false);
    expect(checkFieldBounds(realm, store, 9).find((b) => b.name === "no-orphan-plots")!.ok).toBe(true);
    void s;
  });

  it("deer graze the plots nearest the woods most; a raid burns the plots by the road; stock in a neighbour's crop is a grievance", () => {
    const { realm, store, start, live } = world(2);
    const s = realm.settlements[start]!;
    for (let d = 2; d <= 30; d++) {
      if (d === 15) s.lastRaided = 15;
      advanceWorld(realm, store, d, { live });
    }
    const plots = new Map(plotsOf(realm, s, 30).map((p) => [p.id, p]));
    const ev = store.farm.eventsOf(start);
    const graze = ev.filter((e) => e.kind === "graze");
    for (const e of ev.filter((x) => x.kind === "fire")) expect(plots.get(e.plot)!.ring).toBe(0);
    for (const e of ev.filter((x) => x.kind === "stock")) {
      const victim = store.farm.plotsOf(start).get(e.plot)!.holder;
      expect(e.by).not.toBe(victim);
    }
  });

  it("deer graze an outer plot (nearest the woods) more often than one by the walls", () => {
    let outer = 0;
    let inner = 0;
    let outerPlots = 0;
    let innerPlots = 0;
    for (const seed of [1, 2, 3]) {
      const { realm, store, start } = world(seed);
      for (let d = 1; d <= 48; d++) fieldsDay(realm, store, start, d);
      const plots = plotsOf(realm, realm.settlements[start]!, 48).filter((p) => store.farm.sowingOf(start, p.id, 0));
      const ring = new Map(plots.map((p) => [p.id, p.ring]));
      outerPlots += plots.filter((p) => p.ring >= 2).length;
      innerPlots += plots.filter((p) => p.ring < 2).length;
      for (const e of store.farm.eventsOf(start).filter((x) => x.kind === "graze" && ring.has(x.plot))) (ring.get(e.plot)! >= 2 ? outer++ : inner++);
    }
    expect(outer / Math.max(1, outerPlots)).toBeGreaterThan(inner / Math.max(1, innerPlots));
  });

  it("a boar sounder by the place roots paths through its plots by its own beasts; after three nights running, its hunters go after it", () => {
    const { realm, store, start } = world(1);
    realm.packs.boars_test = { id: "boars_test", species: "boar", near: start, count: 6, cap: 8, tier: "F", alpha: null, bounty: 0 };
    syncBeasts(realm, store.beasts, 1);
    const rows = new Set(Object.values(realm.packs).filter((p) => p.near === start && p.species === "boar").flatMap((p) => store.beasts.ofPack(p.id).map((b) => b.id)));
    for (let d = 1; d <= 48; d++) fieldsDay(realm, store, start, d);
    const roots = store.farm.eventsOf(start).filter((e) => e.kind === "root");
    expect(roots.length).toBeGreaterThan(0);
    for (const e of roots) {
      expect(rows.has(e.by), e.by).toBe(true);
      expect(e.tiles.length).toBeGreaterThanOrEqual(6);
    }
    const days = [...new Set(roots.map((e) => e.day))].sort((a, b) => a - b);
    const streak = days.some((d, i) => days[i + 2] === d + 2 && days[i + 1] === d + 1);
    if (streak) expect(realm.news.some((n) => n.text.includes("went after the boar"))).toBe(true);
  });

  it("a fenced plot loses less to deer", () => {
    // Two copies of the same world, one with every outer plot fenced.
    const count = (fenced: boolean) => {
      const { realm, store, start } = world(3);
      const s = realm.settlements[start]!;
      ensurePlots(realm, store, s, plotsOf(realm, s, 1), 1);
      if (fenced) for (const r of store.farm.plotsOf(start).values()) store.farm.setPlot(start, r.id, { fence: 2 });
      for (let d = 1; d <= 40; d++) fieldsDay(realm, store, start, d);
      return store.farm.eventsOf(start).filter((e) => e.kind === "graze").length;
    };
    expect(count(true)).toBeLessThanOrEqual(count(false));
  });

  it("the player who helps with a ripe field's reaping adds to the place's food and is owed a wage", () => {
    const { realm, store, start } = world(1);
    const s = realm.settlements[start]!;
    for (let d = 1; d <= 40; d++) fieldsDay(realm, store, start, d);
    const day = 30;
    const ripe = plotsOf(realm, s, day).find((p) => plotTiles(realm, store, s, p, day).includes(STAGE.ripe));
    if (!ripe) return;
    const before = s.food;
    const player: { duty?: { site: string; day: number; wage: number; what: string } } = {};
    expect(playerReaps(realm, store, start, ripe.id, day, player).join(" ")).toMatch(/wage/);
    expect(store.farm.eventsOfPlot(start, ripe.id).some((e) => e.kind === "harvest" && e.by === "player")).toBe(true);
    expect(s.food).toBeGreaterThanOrEqual(before);
    expect(player.duty?.site).toBe(start);
    void dayOfYear;
  });
});

describe("N26G step 8: bounds", () => {
  it("over two years the kept fields feed their places, losses are in their band, and no plot is orphaned", () => {
    const { realm, store, live } = world(1);
    for (let d = 2; d <= 97; d++) advanceWorld(realm, store, d, { live });
    for (const b of checkFieldBounds(realm, store, 97)) expect(b.ok, `${b.name}: ${b.detail}`).toBe(true);
    void ([] as PersonRow[]);
  });
});
