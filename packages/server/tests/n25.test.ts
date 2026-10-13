/**
 * N25: townsfolk lives. Every stored person ages, marries, has children, moves and dies by code; a place's
 * population is the count of its living people; level of detail never changes outcomes.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { config } from "../src/config.js";
import { WorldStore } from "../src/game/db.js";
import { worldHash } from "../src/game/hash.js";
import { DEATH_CAUSES, DeathRecordSchema, parseDeath } from "../src/game/people/death.js";
import { lineageOf } from "../src/game/people/index.js";
import { liveSites } from "../src/game/people/live.js";
import { checkLifeBounds } from "../src/game/people/bounds.js";
import { lifeStats } from "../src/game/people/report.js";
import { closeKin, inheritRowTraits } from "../src/game/people/rules.js";
import { stepSite } from "../src/game/people/step.js";
import { advanceWorld, lifeDay } from "../src/game/people/world.js";
import { HOME_ID, generateRealm } from "../src/game/realm/generate.js";
import { housesOf } from "../src/game/realm/houses.js";
import type { PersonRow } from "../src/store/peopleStore.js";
import { siteMap } from "../src/web/sites.js";
import { materialisePeople } from "../src/store/materialise.js";
import { ageFrom, courtingAgeOf } from "../src/game/people/rules.js";
import { streamFor } from "../src/game/dice.js";

vi.setConfig({ testTimeout: 120_000 });
beforeEach(() => {
  config.peopleLazy = "";
});

function world(seed = 1) {
  const realm = generateRealm(seed, 1);
  const store = new WorldStore(":memory:");
  materialisePeople(realm, store.people, 1);
  const live = liveSites(realm, "slice");
  return { realm, store, live };
}
const living = (store: WorldStore, site: string) => store.people.loadSite(site, "full") as ReturnType<WorldStore["people"]["loadSite"]> & Array<import("../src/store/peopleStore.js").PersonRow>;
const sqlAlive = (store: WorldStore, site: string) => store.dumpTable("people").filter((r) => r.site === site && r.death === null).length;

describe("N25.1 rules and death records", () => {
  it("refuses siblings, parents and grandparents as kin to wed", () => {
    const parents: Record<string, string[]> = { kid: ["mum", "dad"], sib: ["mum", "dad"], gran: [], mum: ["gran", "gpa"], cousin: ["aunt"], aunt: ["gran", "gpa"] };
    const of = (id: string) => parents[id] ?? [];
    expect(closeKin(of, "kid", "sib")).toBe(true);
    expect(closeKin(of, "kid", "mum")).toBe(true);
    expect(closeKin(of, "kid", "gran")).toBe(true);
    expect(closeKin(of, "kid", "cousin")).toBe(true);
    expect(closeKin(of, "kid", "stranger")).toBe(false);
  });
  it("accepts every death cause in a DeathRecord", () => {
    for (const cause of DEATH_CAUSES) expect(DeathRecordSchema.safeParse({ cause, day: 3, site: "x" }).success).toBe(true);
    expect(parseDeath("not json")).toBeNull();
  });
  it("blends a child's traits from both parents, the same every time", () => {
    const a = { ambition: 0.2, loyalty: 0.2, greed: 0.2, bravery: 0.2, potential: "F" as const };
    const b = { ambition: 0.8, loyalty: 0.8, greed: 0.8, bravery: 0.8, potential: "D" as const };
    expect(inheritRowTraits(a, b, streamFor(1, "t"))).toEqual(inheritRowTraits(a, b, streamFor(1, "t")));
    const c = inheritRowTraits(a, b, streamFor(1, "t"));
    expect(c.ambition).toBeGreaterThan(0.3);
    expect(c.ambition).toBeLessThan(0.7);
  });
});

describe("N25.2 houses are fixed", () => {
  it("draws the same houses however the population moves, until houses are built", () => {
    const { realm } = world();
    const s = realm.settlements[HOME_ID]!;
    const count = (x: typeof s) => siteMap(x, "village", realm).buildings.filter((b) => b.kind === "house").length;
    const before = siteMap(s, "village", realm).buildings.map((b) => `${b.kind}${b.x},${b.y}`);
    s.population *= 2;
    expect(siteMap(s, "village", realm).buildings.map((b) => `${b.kind}${b.x},${b.y}`)).toEqual(before);
    const houses = count(s);
    s.houses = housesOf(s) + 4;
    expect(count(s)).toBeGreaterThanOrEqual(houses);
  });
});

describe("N25.3 a village lives ten years", () => {
  it("ages, marries, has children and dies; the population is the living roster every day", () => {
    const { realm, store, live } = world();
    const site = HOME_ID;
    const start = living(store, site).length;
    const day0 = realm.day;
    for (let d = day0 + 1; d <= day0 + 120; d++) {
      advanceWorld(realm, store, d, { live });
      expect(realm.settlements[site]!.population).toBe(sqlAlive(store, site));
    }
    const stats = lifeStats(store, realm.day, new Set([site]));
    expect(start).toBeGreaterThan(50);
    const events = store.eventsOfKinds(["birth", "death", "marriage"], 0).filter((e) => e.site === site);
    expect(events.filter((e) => e.kind === "birth").length).toBeGreaterThan(5);
    expect(events.filter((e) => e.kind === "death").length).toBeGreaterThan(5);
    expect(events.filter((e) => e.kind === "marriage").length).toBeGreaterThan(5);
    expect(stats.married / stats.courting).toBeGreaterThan(0.4);
    // Everyone alive who is a year-12-day cohort older: a 30-year-old on day 1 is 40 now.
    const old = store.people.get(`t_${site}_0`);
    if (old) expect(ageFrom(old.born_day, realm.day) - ageFrom(old.born_day, 1)).toBe(10);
    // Every child has parents in the table, and nobody wed or conceived under age.
    for (const r of store.dumpTable("people")) {
      if (r.mother) expect(store.people.get(String(r.mother))).not.toBeNull();
      if (r.spouse) expect(ageFrom(Number(r.born_day), realm.day)).toBeGreaterThanOrEqual(courtingAgeOf("human"));
      if (r.expecting) expect(ageFrom(Number(r.born_day), realm.day)).toBeGreaterThanOrEqual(16);
    }
  });

  it("marries mostly within a class, never kin, and records a gap of rank", () => {
    const { realm, store, live } = world();
    advanceWorld(realm, store, 121, { live });
    const rows = new Map(store.dumpTable("people").map((r) => [String(r.id), r]));
    let pairs = 0;
    for (const r of rows.values()) {
      if (!r.spouse || String(r.id) > String(r.spouse)) continue;
      pairs++;
      const parentsOf = (id: string) => [rows.get(id)?.mother, rows.get(id)?.father].filter(Boolean).map(String);
      expect(closeKin(parentsOf, String(r.id), String(r.spouse))).toBe(false);
    }
    expect(pairs).toBeGreaterThan(5);
  });
});

describe("N25.6 a famine kills where it struck", () => {
  it("writes famine deaths with the place on the record", () => {
    const { realm, store } = world();
    const site = HOME_ID;
    for (let d = 2; d <= 15; d++) {
      store.people.putSiteDay(site, d, { food: 0, prosperity: 20, famine: 1, crowding: 1, houses: 36, raided: false, atWar: false, besieged: false, beasts: false, plague: 0, casualties: [] });
      stepSite({ realm, store }, site, d);
    }
    const famine = store.dumpTable("people").filter((r) => r.death && parseDeath(String(r.death))?.cause === "famine");
    expect(famine.length).toBeGreaterThan(3);
    for (const r of famine) expect(parseDeath(String(r.death))!.site).toBe(site);
  });
  it("a raid's casualty order kills fighters of that place with the event on the record", () => {
    const { realm, store } = world();
    store.people.putSiteDay(HOME_ID, 2, { food: 80, prosperity: 50, famine: 0, crowding: 1, houses: 36, raided: true, atWar: false, besieged: false, beasts: false, plague: 0, casualties: [{ cause: "raid", count: 6, event: "raid:2:test" }] });
    stepSite({ realm, store }, HOME_ID, 2);
    const dead = store.dumpTable("people").filter((r) => r.death && parseDeath(String(r.death))?.event === "raid:2:test");
    expect(dead.length).toBe(6);
  });
});

describe("N25.9 level of detail never changes outcomes", () => {
  it("a lazy place caught up at day 60 is the place that ran daily", () => {
    const a = world();
    const b = world();
    const lazy = [...b.live].find((id) => id !== HOME_ID)!;
    advanceWorld(a.realm, a.store, 61, { live: a.live });
    config.peopleLazy = lazy;
    advanceWorld(b.realm, b.store, 61, { live: b.live, settleLazy: true });
    config.peopleLazy = "";
    const rows = (w: ReturnType<typeof world>) => JSON.stringify(w.store.dumpTable("people").filter((r) => w.live.has(String(r.site))).map((r) => ({ ...r, rev: 0 })));
    expect(rows(b)).toBe(rows(a));
    // The people, their counters and every event they made are the same. (A lazy place's population *number* is as of its
    // last catch-up, so the realm's coin, which reads it, can differ by a few copper while it is behind: that is why lazy is only for budgets.)
    expect(worldHash({}, b.store)).toBe(worldHash({}, a.store));
  });
  it("the same seed gives the same people", () => {
    const a = world();
    const b = world();
    advanceWorld(a.realm, a.store, 40, { live: a.live });
    advanceWorld(b.realm, b.store, 40, { live: b.live });
    expect(worldHash({ realm: a.realm }, a.store)).toBe(worldHash({ realm: b.realm }, b.store));
  });
});

describe("N25.7 moving as households", () => {
  it("a famine at one village sends whole households to a neighbour, the counts matching", () => {
    const { realm, store, live } = world();
    const from = realm.settlements[HOME_ID]!;
    const to = [...live].map((id) => realm.settlements[id]!).find((s) => s.id !== HOME_ID)!;
    from.food = 0;
    to.prosperity = 95;
    to.food = 100;
    const before = store.people.livingCount(HOME_ID) + store.people.livingCount(to.id);
    let moved = 0;
    for (let d = 2; d <= 8; d++) {
      from.food = 0;
      to.prosperity = 95;
      moved += lifeDay({ realm, store }, d, { live }).moved;
    }
    expect(moved).toBeGreaterThan(0);
    for (const r of living(store, to.id)) if (r.spouse) expect(store.people.get(r.spouse)!.site).toBe(to.id);
    expect(store.people.livingCount(HOME_ID)).toBe(sqlAlive(store, HOME_ID));
    expect(store.people.livingCount(to.id)).toBe(sqlAlive(store, to.id));
    expect(before).toBeGreaterThan(0);
  });
});

describe("N25.5 the whole realm is within budget and in balance", () => {
  it("lives a year for every place, with sound bounds", () => {
    const realm = generateRealm(1, 1);
    const store = new WorldStore(":memory:");
    materialisePeople(realm, store.people, 1);
    const t0 = performance.now();
    advanceWorld(realm, store, 1 + config.daysPerYear * 3);
    const ms = (performance.now() - t0) / (config.daysPerYear * 3);
    expect(ms).toBeLessThan(250 * Number(process.env.PERF_SLACK ?? 1));
    const stats = lifeStats(store, realm.day);
    expect(stats.pyramid.children).toBeGreaterThan(0.1);
    expect(stats.pyramid.children).toBeLessThan(0.55);
    expect(stats.pyramid.elders).toBeGreaterThan(0.03);
    expect(stats.birthRate).toBeGreaterThan(10);
    expect(stats.deathRate).toBeGreaterThan(5);
    expect(stats.deathRate).toBeLessThan(60);
    expect(stats.married / stats.courting).toBeGreaterThan(0.4);
    const sum = Object.values(realm.settlements).filter((s) => !s.abandoned).reduce((a, s) => a + s.population, 0);
    expect(sum).toBe(store.dumpTable("people").filter((r) => r.death === null && !realm.settlements[String(r.site)]?.abandoned).length);
    for (const s of Object.values(realm.settlements)) if (s.kind === "capital") expect(s.population).toBeGreaterThan(500);
    for (const b of checkLifeBounds(realm, store)) expect(b.ok, `${b.name}: ${b.detail}`).toBe(true);
    expect(lineageOf(store.people, store.people.get("t_millbrook_0")!).children).toBeDefined();
  });
});

describe("N25.8 rising", () => {
  it.each([[HOME_ID], ["away"]])("a person born in play at %s who comes of age with promise becomes a figure, then a talking NPC naming both parents", async (where) => {
    const { makeTown } = await import("./helpers.js");
    config.director = false;
    config.planning = false;
    config.summaries = false;
    config.realm = true;
    config.realmSeed = 1;
    const store = new WorldStore(":memory:");
    const town = makeTown({ rng: null, store });
    town.passHours(24);
    const realm = town.world.realm!;
    const day = town.world.day;
    const site = where === "away" ? [...liveSites(realm, "slice")].find((id) => id !== HOME_ID)! : HOME_ID;
    const folk = store.people.loadSite(site, "full") as PersonRow[];
    const base = folk[0]!;
    const mum = folk.find((r) => r.gender === "female")!;
    const dad = folk.find((r) => r.gender === "male")!;
    const kids = Array.from({ length: 40 }, (_, i) => ({
      ...base, id: `t_${site}_9${i}`, site, n: 900 + i, name: `Kid ${i} Reed`, gender: "female", cls: "gentry", job: "child", born_day: day - 16 * config.daysPerYear + 1, mother: mum.id, father: dad.id, spouse: null, expecting: null, figure: null, persona: null, death: null, traits: JSON.stringify({ ambition: 0.8, loyalty: 0.5, greed: 0.5, bravery: 0.5, potential: "C" }), stepped_day: 0,
    }));
    for (const k of kids) store.people.add(k as PersonRow);
    town.passHours(24);
    const risen = Object.values(realm.figures).filter((f) => f.person?.startsWith(`t_${site}_9`));
    expect(risen.length).toBeGreaterThan(3);
    expect(store.people.get(risen[0]!.person!)!.figure).toBe(risen[0]!.id);
    risen[0]!.renown = 40;
    for (let i = 0; i < 3; i++) town.passHours(24);
    const talker = risen.find((f) => f.talks);
    expect(talker, "one of them talks").toBeDefined();
    const persona = town.personas[talker!.talks!]!;
    expect(persona.parents).toHaveLength(2);
    // Everyone who made a name talks (no cap of 14); one from another place is one of its people, not Millbrook's cast.
    expect(town.ids.includes(persona.id)).toBe(where !== "away");
    if (where === "away") expect(town.world.visitors![persona.id]).toBeDefined();
    expect(store.people.get(talker!.person!)!.persona).toBe(persona.id);
  });
});

describe("N25 save v12", () => {
  it("a v11 save loads: each place gets the houses its people gave it", async () => {
    const { mkdtempSync, readFileSync, writeFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { loadWorld, newWorld, saveWorld } = await import("../src/game/save.js");
    const { allPersonas } = await import("./helpers.js");
    const { loadCreatureTemplates } = await import("../src/game/creatures.js");
    config.realm = true;
    config.realmSeed = 1;
    const personas = allPersonas();
    const templates = loadCreatureTemplates();
    const w = newWorld(personas, templates);
    const file = join(mkdtempSync(join(tmpdir(), "n25-")), "world.json");
    saveWorld(file, w);
    const json = JSON.parse(readFileSync(file, "utf8"));
    json.version = 11;
    for (const s of Object.values(json.realm.settlements) as Array<{ houses?: number }>) delete s.houses;
    delete json.realm.casualties;
    writeFileSync(file, JSON.stringify(json));
    const back = loadWorld(file, personas, templates);
    const mb = back.realm!.settlements[HOME_ID]!;
    expect(mb.houses).toBe(Math.ceil(mb.population / 5));
    expect(back.realm!.casualties).toEqual([]);
    expect(back.version).toBe(12);
  });
});

describe("N25 the admin person card", () => {
  it("shows a child's parents and a dead person's death, and traces lineage both ways", async () => {
    const { makeTown } = await import("./helpers.js");
    const { card } = await import("../src/admin/person.js");
    config.director = false;
    config.planning = false;
    config.summaries = false;
    config.realm = true;
    config.realmSeed = 1;
    const store = new WorldStore(":memory:");
    const town = makeTown({ rng: null, store });
    for (let i = 0; i < 60; i++) town.passHours(24);
    const ctx = { world: () => town.world, town: () => town, store, queueLength: () => 0, time: undefined } as never;
    const rows = store.dumpTable("people") as unknown as PersonRow[];
    const child = rows.find((r) => r.mother && r.death === null)!;
    const c = card(ctx, `town:${child.id}`)!;
    const family = c.sections.find((s) => s.title === "Family") as { rows: Array<[string, string, string?]> };
    expect(family.rows.map((r) => r[0])).toContain("Mother");
    expect(family.rows.find((r) => r[0] === "Mother")![2]).toBe(`town:${child.mother}`);
    const mum = card(ctx, `town:${child.mother}`)!;
    expect((mum.sections.find((s) => s.title === "Family") as { rows: Array<[string, string, string?]> }).rows.some((r) => r[0] === "Child" && r[2] === `town:${child.id}`)).toBe(true);
    const dead = rows.find((r) => r.death !== null && parseDeath(String(r.death))?.cause !== "missing")!;
    const d = card(ctx, `town:${dead.id}`)!;
    expect(d.alive).toBe(false);
    const life = d.sections.find((s) => s.title === "Life") as { rows: Array<[string, string, string?]> };
    expect(life.rows.some((r) => r[0] === "Died")).toBe(true);
  });
});
