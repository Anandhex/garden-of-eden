/**
 * N31: visible consequences on the map. A place's layout never moves; marks are laid over it from what happened: houses
 * burned in a raid and repaired over the following weeks (slower where people live poorly), scaffolding while something
 * is built, a named grave for each of the dead, empty stalls in a famine, banners, and smoke from the chimneys.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { config } from "../src/config.js";
import { WorldStore } from "../src/game/db.js";
import { checkMarkBounds, marksRealmDay, marksSiteDay, marksToDraw, repairDays } from "../src/game/marks/rules.js";
import { generateRealm } from "../src/game/realm/generate.js";
import { pickStartSite } from "../src/game/realm/start.js";
import { syncBeasts } from "../src/game/realm/beasts.js";
import { materialisePeople } from "../src/store/materialise.js";
import type { PersonRow } from "../src/store/peopleStore.js";
import { siteMap } from "../src/web/sites.js";

vi.setConfig({ testTimeout: 120_000 });
beforeEach(() => {
  config.director = false;
  config.planning = false;
});

function world(seed = 1) {
  const realm = generateRealm(seed, 1);
  const store = new WorldStore(":memory:");
  materialisePeople(realm, store.people, 1);
  syncBeasts(realm, store.beasts, 1);
  const start = pickStartSite(realm, realm.seed);
  return { realm, store, start, s: realm.settlements[start]! };
}

describe("N31 step 1: the layout stays put", () => {
  it("raising a building or adding houses moves no house on the map", () => {
    const { realm, s } = world(1);
    const before = siteMap(s, "village", realm).buildings.filter((b) => b.kind === "house").map((b) => [b.x, b.y]);
    s.buildings.market = (s.buildings.market ?? 0) + 1;
    s.houses = (s.houses ?? 10) + 4;
    const after = siteMap(s, "village", realm).buildings.filter((b) => b.kind === "house").map((b) => [b.x, b.y]);
    expect(after.slice(0, before.length)).toEqual(before);
  });
});

describe("N31 steps 2–3: a raid's burned houses, repaired over the weeks", () => {
  it("a raid on the start town burns houses with the raid named; they're repaired after a while, slower in a poor place", () => {
    const { realm, store, start, s } = world(1);
    const day = 20;
    s.lastRaided = day;
    s.prosperity = 55;
    marksRealmDay(realm, store, day);
    const burned = store.marks.active(start, day).filter((m) => m.kind === "burned");
    expect(burned.length).toBeGreaterThanOrEqual(1);
    expect(burned.every((m) => m.ref === `raid:${day}:${start}` && m.building !== null)).toBe(true);
    const m = siteMap(s, "village", realm);
    for (const b of burned) expect(m.buildings[b.building!]!.kind).toBe("house");
    // Still burned a few days later; repaired by the day set.
    expect(store.marks.active(start, day + 3).filter((x) => x.kind === "burned").length).toBe(burned.length);
    const end = Math.max(...burned.map((x) => x.ends!));
    expect(store.marks.active(start, end).filter((x) => x.kind === "burned").length).toBe(0);
    expect(repairDays({ prosperity: 20 })).toBeGreaterThan(repairDays({ prosperity: 80 }));
    expect(repairDays({ prosperity: 60 })).toBeLessThanOrEqual(config.daysPerYear / 4);
    // Drawn on the map, with words on hover.
    expect(marksToDraw(realm, store, start, day + 1, m).filter((x) => x.kind === "burned").every((x) => x.label === "burned in the raid")).toBe(true);
  });

  it("scaffolding stands while a building goes up, and comes down when it's done", () => {
    const { realm, store, start, s } = world(1);
    s.project = { building: "market", done: 0, cost: 500 };
    marksRealmDay(realm, store, 10);
    expect(store.marks.active(start, 10).some((m) => m.kind === "scaffold" && m.ref === "project:market")).toBe(true);
    marksRealmDay(realm, store, 11);
    expect(store.marks.active(start, 11).filter((m) => m.kind === "scaffold").length).toBe(1);
    s.project = null;
    marksRealmDay(realm, store, 15);
    expect(store.marks.active(start, 15).some((m) => m.kind === "scaffold")).toBe(false);
  });
});

describe("N31 step 4: graves", () => {
  it("the graveyard has a grave for each person killed, with their name, the day and how; once each", () => {
    const { realm, store, start } = world(1);
    const rows = (store.people.loadSite(start, "full") as PersonRow[]).slice(0, 4);
    for (const r of rows) store.people.update(r.id, { death: JSON.stringify({ cause: "raid", day: 20, site: start, event: `raid:20:${start}` }) });
    marksSiteDay(realm, store, start, 20);
    marksSiteDay(realm, store, start, 21);
    const graves = store.marks.active(start, 21).filter((m) => m.kind === "grave");
    expect(graves.length).toBe(4);
    for (const r of rows) {
      const g = graves.find((x) => x.ref === r.id)!;
      expect(g.label).toContain(r.name);
      expect(g.label).toContain("day 20");
      expect(g.label).toMatch(/raid/);
    }
    // No two graves on one spot.
    expect(new Set(graves.map((g) => `${g.x},${g.y}`)).size).toBe(4);
  });
});

describe("N31 step 5: famine, banners", () => {
  it("the market's stalls stand empty in a famine; a faction with a hall here flies its banner", () => {
    const { realm, store, start, s } = world(1);
    const m = siteMap(s, "village", realm);
    s.food = 50;
    expect(marksToDraw(realm, store, start, 5, m).some((x) => x.kind === "stall_empty")).toBe(false);
    s.food = 3;
    expect(marksToDraw(realm, store, start, 5, m).filter((x) => x.kind === "stall_empty").length).toBeGreaterThan(2);
    const f = Object.values(realm.factions).find((x) => !x.dissolved)!;
    if (!f.branches.includes(start)) f.branches.push(start);
    expect(marksToDraw(realm, store, start, 5, m).some((x) => x.id === `banner:${f.id}`) || !m.buildings.some((b) => b.kind === "hall" || b.kind === "guildhall" || b.kind === "temple")).toBe(true);
  });
});

describe("N31 bounds", () => {
  it("marks per place are bounded; thriving places repair within a season", () => {
    const { realm, store, s } = world(1);
    s.prosperity = 80;
    s.lastRaided = 3;
    marksRealmDay(realm, store, 3);
    for (const b of checkMarkBounds(realm, store, 40)) expect(b.ok, `${b.name}: ${b.detail}`).toBe(true);
  });
});
