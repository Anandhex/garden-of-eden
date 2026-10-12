/**
 * N16: crowds and classes. Every settlement's map is sized to the place (a hamlet
 * small, a capital a walled city), and every one of its people is on it: rolled
 * once (realm/townsfolk.ts), placed minute by minute by the shared crowd simulation
 * (the same code in the browser), talking to each other by rank and faction, and
 * talkable by the player, who turns them into full NPCs. Only traders sell. The
 * cast's long days get a break, and nobody stands frozen to one tile.
 */
import { CLASS_RANK, chatLines, CrowdSim, findPath, type CrowdDay, type CrowdRoster, type Townsperson } from "@millbrook/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { config } from "../src/config.js";
import { generateRealm, HOME_ID } from "../src/game/realm/generate.js";
import { kingdomLaws, MAX_TOWNSFOLK, parseTownsfolkId, rosterFor, townsfolkId, townsfolkPersona } from "../src/game/realm/townsfolk.js";
import type { Realm, Settlement, SettlementKind } from "../src/game/realm/types.js";
import { breakHour, planHour } from "../src/game/schedule.js";
import { createNpcState } from "../src/npc/state.js";
import { loadTemplates } from "../src/npc/templates.js";
import { siteMap, VILLAGE_SIZE, type SiteMap } from "../src/web/sites.js";
import { allPersonas, makeTown, worldAt } from "./helpers.js";

beforeEach(() => {
  config.director = false;
  config.planning = false;
  config.summaries = false;
  config.realm = true;
});

const realm: Realm = generateRealm(7);
const ofKind = (kind: SettlementKind, where: (s: Settlement) => boolean = () => true) => Object.values(realm.settlements).find((s) => s.kind === kind && !s.home && where(s))!;
const simFor = (m: SiteMap, r: CrowdRoster) => new CrowdSim({ id: m.id, w: m.w, h: m.h, tiles: m.tiles, buildings: m.buildings, zones: m.zones }, r);
const CLEAR: CrowdDay = { weather: "clear", festival: false };
const person = (o: Partial<Townsperson>): Townsperson => ({ id: "t_x_0", name: "Ada Lowe", gender: "female", age: 30, cls: "commoner", job: "labourer", faction: null, factionName: null, home: 0, work: "streets", master: null, masterId: null, color: "#888888", ...o });
const roster0 = (o: Partial<CrowdRoster> = {}): CrowdRoster => ({ site: "x", map: "x", place: "Ashby", lord: "Lord Edric Pike", ruler: "Queen Maud Reed", laws: { slavery: true, serfdom: true }, people: [], rivals: [], scorn: [], talk: [], ...o });

describe("N16.1 maps sized to the place", () => {
  it("a hamlet is small and a capital a walled city, with more houses the bigger the place", () => {
    const kinds: SettlementKind[] = ["hamlet", "village", "town", "city", "capital"];
    const maps = kinds.map((k) => siteMap(ofKind(k), "village", realm));
    maps.forEach((m, i) => {
      expect(m.w).toBe(VILLAGE_SIZE[kinds[i]!]!.w);
      expect(m.h).toBe(VILLAGE_SIZE[kinds[i]!]!.h);
    });
    const houses = maps.map((m) => m.buildings.filter((b) => b.kind === "house").length);
    expect(houses[4]!).toBeGreaterThan(houses[2]!);
    expect(houses[2]!).toBeGreaterThan(houses[0]!);
    const capital = maps[4]!;
    expect(capital.buildings.some((b) => b.kind === "palace")).toBe(true);
    expect(capital.buildings.filter((b) => b.kind === "manor").length).toBeGreaterThan(3);
    expect(capital.zones.map((z) => z.kind)).toEqual(expect.arrayContaining(["square", "market", "gate", "fields"]));
  });

  it("every building's door opens on a path you can walk to from the gate", () => {
    for (const kind of ["village", "town", "city", "capital"] as SettlementKind[]) {
      const m = siteMap(ofKind(kind), "village", realm);
      for (const b of m.buildings) {
        expect(b.front, `${kind}: ${b.name || b.kind}`).toBeDefined();
        expect(m.tiles[b.front!.y]![b.front!.x]).toBe("path");
      }
      // From the start, reach a sample of fronts (all of them in the smaller places).
      const sample = m.buildings.filter((_, i) => kind === "village" || i % 7 === 0);
      for (const b of sample) expect(findPath(m.start, (t) => t.x === b.front!.x && t.y === b.front!.y, (x, y) => m.isSolid(x, y), 20_000), `${kind}: ${b.name || b.kind} at ${b.front!.x},${b.front!.y}`).not.toBeNull();
    }
  });

  it("the same place gives the same map every time", () => {
    const s = ofKind("city");
    expect(JSON.stringify(siteMap({ ...s, buildings: { ...s.buildings } }, "village", realm).tiles)).toBe(JSON.stringify(siteMap(s, "village", realm).tiles));
  });
});

describe("N16.2 the townsfolk", () => {
  it("a place has as many townsfolk as people (less its notables), the same ones every time", () => {
    const s = ofKind("city");
    const m = siteMap(s, "village", realm);
    const r = rosterFor(realm, s.id, m, 1)!;
    const notables = Object.values(realm.figures).filter((f) => f.alive && f.home === s.id && f.role !== "beast").length;
    expect(r.people.length).toBe(Math.min(MAX_TOWNSFOLK, s.population - notables));
    expect(r.people.length).toBeGreaterThan(1000);
    // Rolled again from scratch (a fresh realm from the same seed): the same people.
    const again = rosterFor(generateRealm(7), s.id, m, 1)!;
    expect(again.people.map((p) => p.name)).toEqual(r.people.map((p) => p.name));
    expect(parseTownsfolkId(r.people[5]!.id)).toEqual({ site: s.id, n: 5 });
    expect(parseTownsfolkId("hale")).toBeNull();
  });

  it("a growing town keeps its people and adds to the end", () => {
    const s = structuredClone(ofKind("town"));
    const big = structuredClone(realm);
    big.settlements[s.id]!.population = s.population + 40;
    const m = siteMap(s, "village", realm);
    const before = rosterFor(realm, s.id, m, 1)!.people;
    const after = rosterFor(big, s.id, m, 1)!.people;
    expect(after.length).toBe(before.length + 40);
    expect(after.slice(0, before.length).map((p) => `${p.name}/${p.job}`)).toEqual(before.map((p) => `${p.name}/${p.job}`));
  });

  it("classes follow the kingdom's laws: serfs in Millbrook's kingdom, slaves in another, children, nobles, a royal family", () => {
    const home = realm.settlements[HOME_ID]!.kingdom;
    expect(kingdomLaws(realm, home)).toEqual({ slavery: false, serfdom: true });
    const serfCity = ofKind("city", (s) => s.kingdom === home);
    const slaveCity = ofKind("city", (s) => kingdomLaws(realm, s.kingdom).slavery);
    const a = rosterFor(realm, serfCity.id, siteMap(serfCity, "village", realm), 1)!;
    const b = rosterFor(realm, slaveCity.id, siteMap(slaveCity, "village", realm), 1)!;
    const count = (r: CrowdRoster, cls: string) => r.people.filter((p) => p.cls === cls).length;
    expect(count(a, "slave")).toBe(0);
    expect(count(a, "serf")).toBeGreaterThan(50);
    expect(count(b, "slave")).toBeGreaterThan(50);
    expect(count(b, "serf")).toBe(0);
    expect(count(a, "noble")).toBeGreaterThan(10);
    expect(a.people.filter((p) => p.job === "child").length).toBeGreaterThan(200);
    // Every slave with a master lives in that master's house.
    for (const p of b.people.filter((x) => x.cls === "slave" && x.masterId)) {
      const m = b.people.find((x) => x.id === p.masterId)!;
      expect(CLASS_RANK[m.cls]).toBeGreaterThanOrEqual(3);
      expect(p.home).toBe(m.home);
    }
    const capital = ofKind("capital");
    const c = rosterFor(realm, capital.id, siteMap(capital, "village", realm), 1)!;
    expect(c.people.filter((p) => p.cls === "royal").length).toBeGreaterThanOrEqual(4);
  });

  it("no more at one door than could work there; Millbrook's inn and forge stay the cast's", () => {
    const s = ofKind("capital");
    const m = siteMap(s, "village", realm);
    const r = rosterFor(realm, s.id, m, 1)!;
    const smithies = m.buildings.filter((b) => b.kind === "smithy").length;
    expect(r.people.filter((p) => p.job === "smith").length).toBeLessThanOrEqual(3 * smithies);
    expect(r.people.filter((p) => p.job === "innkeeper").length).toBe(m.buildings.filter((b) => b.kind === "inn").length);
    const home = rosterFor(realm, HOME_ID, siteMap(realm.settlements[HOME_ID]!, "village", realm), 1)!;
    expect(home.people.some((p) => p.job === "innkeeper" || p.job === "smith" || p.job === "apprentice")).toBe(false);
  });
});

describe("N16.3 a day in the crowd", () => {
  const s = ofKind("town");
  const m = siteMap(s, "village", realm);
  const r = rosterFor(realm, s.id, m, 1)!;

  it("asleep indoors at night, out and about by day", () => {
    const sim = simFor(m, r);
    const night = sim.all(3, 2 * 60, CLEAR).filter((p) => p.visible).length;
    const noon = sim.all(3, 10 * 60, CLEAR).filter((p) => p.visible).length;
    expect(night).toBeLessThan(r.people.length * 0.1);
    expect(noon).toBeGreaterThan(r.people.length * 0.5);
  });

  it("everyone out stands on open ground, and walkers go a tile a minute", () => {
    const sim = simFor(m, r);
    let prev = sim.all(3, 7 * 60, CLEAR);
    for (let minute = 7 * 60 + 1; minute < 7 * 60 + 30; minute++) {
      const now = sim.all(3, minute, CLEAR);
      now.forEach((p, i) => {
        if (!p.visible) return;
        expect(m.isSolid(p.x, p.y)).toBe(false);
        const before = prev[i]!;
        if (p.moving && before.visible && before.moving) expect(Math.abs(p.x - before.x) + Math.abs(p.y - before.y)).toBeLessThanOrEqual(1);
      });
      prev = now;
    }
  });

  it("people move from minute to minute (nobody's frozen), and take a break at midday", () => {
    const sim = simFor(m, r);
    const a = sim.all(3, 9 * 60, CLEAR);
    const b = sim.all(3, 9 * 60 + 8, CLEAR);
    const moved = a.filter((p, i) => p.visible && b[i]!.visible && (p.x !== b[i]!.x || p.y !== b[i]!.y)).length;
    expect(moved).toBeGreaterThan(a.filter((p) => p.visible).length * 0.3);
    const doing = new Set<string>();
    for (let minute = 11 * 60 + 30; minute <= 14 * 60; minute += 10) for (const p of sim.all(3, minute, CLEAR)) doing.add(p.doing);
    expect(doing).toContain("on a break");
  });

  it("the server and the browser agree: two sims of the same roster put everyone in the same place", () => {
    const one = simFor(m, r).all(4, 15 * 60 + 17, CLEAR);
    const two = simFor(m, structuredClone(r)).all(4, 15 * 60 + 17, CLEAR);
    expect(two).toEqual(one);
  });

  it("in a storm the outdoor trades stay in; at the festival the evening is in the square", () => {
    const sim = simFor(m, r);
    const farmers = r.people.map((p, i) => ({ p, i })).filter((x) => x.p.job === "farmer");
    expect(farmers.length).toBeGreaterThan(0);
    const out = sim.all(5, 10 * 60, { weather: "storm", festival: false });
    expect(farmers.filter((f) => out[f.i]!.visible && out[f.i]!.doing === "working the fields").length).toBe(0);
    const fest = sim.all(5, 19 * 60 + 30, { weather: "clear", festival: true });
    expect(fest.filter((p) => p.doing === "at the festival").length).toBeGreaterThan(r.people.length * 0.3);
  });

  it("people standing together talk, and the talk follows rank", () => {
    const sim = simFor(m, r);
    const at = sim.all(3, 10 * 60, CLEAR);
    const chats = sim.chats(3, 10 * 60, CLEAR, at);
    expect(chats.length).toBeGreaterThan(20);
    for (const c of chats) {
      const a = r.people[c.a]!;
      const b = r.people[c.b]!;
      // The lower-born speaks first to their better.
      if (CLASS_RANK[a.cls] !== CLASS_RANK[b.cls]) expect(CLASS_RANK[a.cls]).toBeLessThan(CLASS_RANK[b.cls]);
      expect(Math.max(Math.abs(at[c.a]!.x - at[c.b]!.x), Math.abs(at[c.a]!.y - at[c.b]!.y))).toBeLessThanOrEqual(1);
    }
  });
});

describe("N16.4 what they say", () => {
  const day = CLEAR;
  it("the low-born bow and the high-born sneer", () => {
    const serf = person({ id: "t_x_1", cls: "serf", job: "farmer" });
    const lord = person({ id: "t_x_2", cls: "noble", job: "noble", gender: "male", name: "Edric Pike" });
    for (let seed = 0; seed < 20; seed++) {
      const [up, down] = chatLines(roster0(), serf, lord, day, 600, seed * 7919);
      expect(up).toMatch(/lord|bows|forelock|servant/i);
      expect(down).not.toMatch(/my lord/);
    }
  });

  it("a master gives orders and their slave obeys", () => {
    const master = person({ id: "t_x_3", cls: "merchant", job: "merchant", gender: "female" });
    const slave = person({ id: "t_x_4", cls: "slave", job: "slave", master: "Ada Lowe", masterId: "t_x_3" });
    const [order, reply] = chatLines(roster0(), master, slave, day, 600, 12345);
    expect(order.length).toBeGreaterThan(0);
    expect(reply).toMatch(/mistress/);
  });

  it("rival factions trade insults; the crown's people look down on the guilds", () => {
    const a = person({ id: "t_x_5", faction: "guild_a", factionName: "the Ironhands" });
    const b = person({ id: "t_x_6", faction: "gang_b", factionName: "the Ravens" });
    const r = roster0({ rivals: [["guild_a", "gang_b"]] });
    const lines = Array.from({ length: 10 }, (_, i) => chatLines(r, a, b, day, 600, i * 104729).join(" "));
    expect(lines.every((l) => /Ravens|Ironhands|scum|tongue|dare|likes of you/.test(l))).toBe(true);
    expect(lines.join(" ")).not.toMatch(/the the/);
    const crown = person({ id: "t_x_7", faction: "crown_k", factionName: "the Crown of Aldmar", job: "guard" });
    const guild = person({ id: "t_x_8", faction: "guild_m", factionName: "the Merchants' League", cls: "merchant", job: "merchant" });
    const s = roster0({ scorn: [["crown_k", "guild_m"]] });
    const scorned = Array.from({ length: 30 }, (_, i) => chatLines(s, crown, guild, day, 600, i * 7907).join(" "));
    expect(scorned.some((l) => /Merchants' League/.test(l))).toBe(true);
  });

  it("children are children, whoever their parents", () => {
    const kid = person({ id: "t_x_9", cls: "clergy", job: "child", age: 8 });
    const adult = person({ id: "t_x_10", cls: "commoner", job: "washer" });
    const [a, b] = chatLines(roster0(), adult, kid, day, 600, 4242);
    expect(`${a} ${b}`).not.toMatch(/Mother|Father/);
  });
});

describe("N16.5 talking to one of them", () => {
  const s = ofKind("city", (x) => kingdomLaws(realm, x.kingdom).slavery);
  const m = siteMap(s, "village", realm);
  const r = rosterFor(realm, s.id, m, 1)!;
  const templates = loadTemplates();

  it("only traders sell; everyone else has nothing for sale and buys nothing", () => {
    const trader = r.people.find((p) => p.job === "stallholder")!;
    const labourer = r.people.find((p) => p.job === "labourer")!;
    const t = townsfolkPersona(realm, r, trader, templates)!;
    const l = townsfolkPersona(realm, r, labourer, templates)!;
    expect(Object.keys(t.prices).length).toBeGreaterThan(0);
    expect(l.prices).toEqual({});
    expect(l.buys).toEqual([]);
    expect(l.startingInventory).toEqual({});
    expect(l.backstory).toMatch(/nothing to sell/);
    expect(l.goals.join(" ")).not.toMatch(/egg|sell/i);
    expect(t.id).toBe(trader.id);
  });

  it("their file knows their class, their master and what they think of the others", () => {
    const slave = r.people.find((p) => p.cls === "slave" && p.master)!;
    const noble = r.people.find((p) => p.cls === "noble" && p.job === "noble")!;
    const sp = townsfolkPersona(realm, r, slave, templates)!;
    const np = townsfolkPersona(realm, r, noble, templates)!;
    expect(sp.backstory).toContain(`slave of ${slave.master}`);
    expect(sp.backstory).toMatch(/freedom/);
    expect(np.backstory).toMatch(/look down on commoners/);
    expect(np.speechStyle).toMatch(/Haughty/);
  });

  it("a townsperson the player speaks to becomes a talking NPC of their village, kept in the save", () => {
    const town = makeTown();
    const home = rosterFor(town.world.realm!, HOME_ID, siteMap(town.world.realm!.settlements[HOME_ID]!, "village", town.world.realm), 1)!;
    const p = home.people[10]!;
    expect(town.localIds()).not.toContain(p.id);
    const id = town.meetTownsperson(home, p)!;
    expect(id).toBe(townsfolkId(HOME_ID, 10));
    expect(town.agents[id]!.persona.name).toBe(p.name);
    expect(town.world.visitors?.[id]).toBeDefined();
    expect(town.localIds()).toContain(id);
    // Not part of Millbrook's cast: the village's hourly life doesn't run them.
    expect(town.ids).not.toContain(id);
    // Off in the woods, they're not about.
    town.world.player.area = "woods";
    expect(town.localIds()).not.toContain(id);
  });
});

describe("N16.6 breaks for the cast", () => {
  const cast = allPersonas();
  it("a long working day has an hour's break in the middle; not for the guard on watch, nor the innkeeper", () => {
    const brena = cast.brena!;
    expect(breakHour({ from: 6, to: 20, activity: "work", place: "forge" })).toBe(13);
    expect(breakHour({ from: 7, to: 12, activity: "work", place: "square" })).toBe(-1);
    expect(planHour(brena, createNpcState(brena), worldAt(13))).toEqual({ activity: "eat", place: "inn", why: "midday break" });
    expect(planHour(brena, createNpcState(brena), worldAt(12))).toMatchObject({ activity: "work", place: "forge" });
    expect(planHour(cast.hale!, createNpcState(cast.hale!), worldAt(13))).toMatchObject({ activity: "work", place: "gate" });
    expect(planHour(cast.pell!, createNpcState(cast.pell!), worldAt(13))).toMatchObject({ activity: "work", place: "inn" });
  });

  it("nobody stands frozen to one spot: the map gives them a step or two about it as the minutes pass", () => {
    const m = siteMap(realm.settlements[HOME_ID]!, "village", realm);
    const spots = new Set<string>();
    for (let k = 0; k < 20; k++) {
      const at = m.wanderSpot("square", "pip", k)!;
      expect(m.isSolid(at.x, at.y)).toBe(false);
      spots.add(`${at.x},${at.y}`);
    }
    expect(spots.size).toBeGreaterThan(2);
  });
});
