import { readdirSync, readFileSync, statSync } from "node:fs";
import { join as pathJoin } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { config } from "../src/config.js";
import { WorldStore } from "../src/game/db.js";
import { seededRng } from "../src/game/dice.js";
import { appointDay, CROWD, fillSitePosts, TOWN } from "../src/game/office/appoint.js";
import { bookedSince, lineOf, periodsOf } from "../src/game/office/books.js";
import { officeSample } from "../src/game/office/bounds.js";
import { charterDay } from "../src/game/office/charter.js";
import { officesDay, officesSiteDay, reputeDay } from "../src/game/office/day.js";
import { epithetsDay } from "../src/game/office/epithets.js";
import { memberCount, minMembers } from "../src/game/office/members.js";
import { factionInst, officeFor, officeKey, officeOf, officesOf, placeInst, PLACE_POSTS } from "../src/game/office/posts.js";
import { figureJoined } from "../src/game/office/prestige.js";
import { effective, fame, standingIn } from "../src/game/office/repute.js";
import { raiseRow } from "../src/game/office/rising.js";
import { supportDay } from "../src/game/office/support.js";
import { auditDay } from "../src/game/office/treasury.js";
import { sackedSurrendered, ventureOutcome } from "../src/game/office/ventures.js";
import { talkerStanding } from "../src/game/office/words.js";
import { addGrievance } from "../src/game/chatter/grievance.js";
import { adjustRel } from "../src/game/chatter/rel.js";
import { killPerson } from "../src/game/people/index.js";
import type { LifeCtx } from "../src/game/people/step.js";
import { advanceWorld } from "../src/game/people/world.js";
import { breakTreaty, endWar, sign } from "../src/game/realm/diplomacy.js";
import { advanceRealm } from "../src/game/realm/day.js";
import { factionsDay, foundFaction, join, rankIn } from "../src/game/realm/factions.js";
import { makeFigure, residents, titled } from "../src/game/realm/figures.js";
import { generateRealm } from "../src/game/realm/generate.js";
import { successionDay } from "../src/game/realm/politics.js";
import { readyToTalk } from "../src/game/realm/rise.js";
import type { Figure, Realm, Settlement } from "../src/game/realm/types.js";
import { TITLES } from "../src/game/titles.js";
import type { Creature } from "../src/game/creatures.js";
import type { PersonRow } from "../src/store/peopleStore.js";
import { materialisePeople } from "../src/store/materialise.js";
import { SCHEMA_VERSION, TABLES } from "../src/store/schema.js";
import { pickTestPlaces } from "./helpers.js";

/**
 * N69: offices, treasuries and renown. Every place and faction is run by people in posts, paid from a treasury whose books say where the
 * coin went; guilds are chartered only with members and fold below their minimum; renown is signed; followers make or unmake a leader;
 * ventures can fail and cost the leader; leaders earn epithets by how they lead, and townsfolk whose name grows rise. People are found by
 * their post, job or role, never by name.
 */
vi.setConfig({ testTimeout: 300_000, hookTimeout: 300_000 });

const Y = config.daysPerYear;
const season = Math.max(1, Math.floor(Y / 4));
const TAX = Math.max(1, Math.round(Y / 2));

beforeEach(() => {
  config.peopleLazy = "";
  config.realm = true;
  config.realmSeed = undefined;
  config.director = false;
});

/** The slice: the start town and its liege, with their people rolled and living; `extra` places live too. */
function world(seed = 1, extra: (realm: Realm) => string[] = () => []) {
  const realm = generateRealm(seed, 1);
  const store = new WorldStore(":memory:");
  materialisePeople(realm, store.people, 1);
  const { start, liege } = pickTestPlaces(realm);
  const live = new Set([start, liege, ...extra(realm)]);
  const ctx: LifeCtx = { realm, store };
  return { realm, store, live, ctx, start, liege };
}

const placesOf = (realm: Realm, kind: Settlement["kind"]) => Object.values(realm.settlements).filter((s) => s.kind === kind && !s.abandoned && !s.way && !s.fallen).sort((a, b) => a.id.localeCompare(b.id));
const villageOf = (realm: Realm) => placesOf(realm, "village")[0]!.id;
const person = (realm: Realm, home: string, role: Figure["role"], over: Partial<Figure> = {}): Figure => Object.assign(makeFigure(realm, seededRng(realm.next), { role, home, tier: "F", age: 35 }, realm.day), over);

describe("N69 step 1: posts and appointments", () => {
  it("fills every place's posts: a reeve and a constable in a village, a treasurer and a captain in a town; a hamlet has only its elder; nobody holds two", () => {
    const w = world(1, (r) => [villageOf(r)]);
    advanceWorld(w.realm, w.store, 3, { live: w.live });
    for (const s of Object.values(w.realm.settlements).filter((x) => !x.abandoned && !x.way && !x.fallen)) {
      const held = officesOf(w.realm, placeInst(s.id));
      if (s.kind === "hamlet") expect(held).toEqual([]);
      for (const def of PLACE_POSTS[s.kind]) expect(w.realm.offices[officeKey(placeInst(s.id), def.id)]?.holder, `${s.kind} ${s.id} ${def.id}`).toBeTruthy();
    }
    const village = villageOf(w.realm);
    const reeve = w.realm.offices[officeKey(placeInst(village), "reeve")]!;
    // A live village's posts are held by its own townsfolk (or a figure who lives there), never a nameless one.
    expect(reeve.holder).not.toBe(CROWD);
    expect(reeve.holder).not.toBe(TOWN);
    const holders = Object.values(w.realm.offices).map((o) => o.holder).filter((h): h is string => !!h && h !== CROWD && h !== TOWN);
    expect(new Set(holders).size).toBe(holders.length);
    // Heads hold no other post.
    const heads = new Set(Object.values(w.realm.settlements).map((s) => s.leader).filter(Boolean));
    expect(holders.filter((h) => heads.has(h))).toEqual([]);
    // A townsperson made a town's treasurer is someone the realm knows of: they rose to a figure.
    const townPosts = Object.values(w.realm.offices).filter((o) => o.holder && o.holder !== CROWD && o.holder !== TOWN && ["town", "city", "capital"].includes(w.realm.settlements[o.inst.slice(2)]?.kind ?? ""));
    expect(townPosts.filter((o) => o.row)).toEqual([]);
    // Left to the town's townsfolk, a post is filled in the town's own day by one of them, who rises to a figure.
    const town = ["town", "city", "capital"].includes(w.realm.settlements[w.start]!.kind) ? w.start : w.liege;
    const key = officeKey(placeInst(town), "magistrate");
    w.realm.offices[key] = { inst: placeInst(town), post: "magistrate", holder: TOWN, town: true, since: 3, skill: 0.5, skim: 0, took: 0, unpaid: 0 };
    fillSitePosts(w.realm, town, 4, w.store, [key]);
    const o = w.realm.offices[key]!;
    expect(o.holder).not.toBe(TOWN);
    expect(o.row).toBeUndefined();
    expect(w.realm.figures[o.holder!]?.person).toBeTruthy();
    expect(w.store.dumpTable("events").some((e) => e.kind === "appointed" && e.actor === w.realm.figures[o.holder!]!.person)).toBe(true);
  });

  it("empties a post when its holder dies, and the head appoints another", () => {
    const realm = generateRealm(2, 1);
    advanceRealm(realm, 2);
    const town = placesOf(realm, "town")[0]!;
    const key = officeKey(placeInst(town.id), "treasurer");
    const was = realm.offices[key]!.holder!;
    const f = realm.figures[was];
    if (f) f.alive = false;
    officesDay(realm, 3);
    expect(realm.offices[key]!.holder).toBeTruthy();
    expect(realm.offices[key]!.holder).not.toBe(was);
  });
});

describe("N69 step 2: the ledger and the one coin path", () => {
  it("a town's books add up to exactly how its treasury changed over a year", () => {
    const w = world(3);
    const town = w.start;
    const inst = placeInst(town);
    const before = w.realm.settlements[town]!.treasury;
    const coffers = new Map(Object.values(w.realm.factions).map((f) => [f.id, f.wealth]));
    advanceWorld(w.realm, w.store, Y + 1, { live: w.live });
    expect(periodsOf(w.realm, inst).length).toBeGreaterThanOrEqual(2);
    expect(bookedSince(w.realm, inst)).toBe(w.realm.settlements[town]!.treasury - before);
    // And every faction's that was there at the start.
    for (const f of Object.values(w.realm.factions).filter((x) => coffers.has(x.id))) expect(bookedSince(w.realm, factionInst(f.id)), f.id).toBe(f.wealth - coffers.get(f.id)!);
  });

  it("names the lines from the words of each movement", () => {
    expect(lineOf("the day's earnings", "in")).toBe("trade");
    expect(lineOf("taxes", "out")).toBe("tax_out");
    expect(lineOf("taxes", "in")).toBe("taxes_in");
    expect(lineOf("wages to the reeve", "out")).toBe("wages");
    expect(lineOf("stolen by the treasurer", "out")).toBe("stolen");
    expect(lineOf("building walls", "out")).toBe("build");
    expect(lineOf("members' dues", "in")).toBe("dues");
    expect(lineOf("the raid on Ashby", "in")).toBe("loot");
  });

  it("no code outside the ledger changes a treasury or a faction's coffer directly", () => {
    const root = pathJoin(__dirname, "../src");
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const n of readdirSync(dir)) {
        const p = pathJoin(dir, n);
        if (statSync(p).isDirectory()) walk(p);
        else if (p.endsWith(".ts")) files.push(p);
      }
    };
    walk(root);
    const bad: string[] = [];
    for (const f of files) {
      if (f.endsWith(pathJoin("realm", "ledger.ts"))) continue;
      readFileSync(f, "utf8")
        .split("\n")
        .forEach((line, i) => {
          if (/\.(treasury|wealth)\s*(\+=|-=|\*=|\/=|=(?!=))|\.(treasury|wealth)\s*(\+\+|--)/.test(line)) bad.push(`${f.slice(root.length)}:${i + 1}: ${line.trim()}`);
        });
    }
    expect(bad).toEqual([]);
  });
});

describe("N69 step 3: officers' effects, wages, audits", () => {
  it("the start town's greedy treasurer skims, an audit finds it, they are dismissed, lose their name, and another is appointed", () => {
    const w = world(4);
    advanceWorld(w.realm, w.store, 2, { live: w.live });
    // The start town, or its liege if the start is a village (a town's keeper of the coffers is a figure).
    const site = ["village", "hamlet"].includes(w.realm.settlements[w.start]!.kind) ? w.liege : w.start;
    const inst = placeInst(site);
    const key = officeKey(inst, "treasurer");
    const o = w.realm.offices[key]!;
    const thief = w.realm.figures[o.holder!]!;
    expect(thief).toBeDefined();
    // A greedy one: skims the most, and has little name to lose.
    thief.greed = 0.99;
    thief.renown = 3;
    o.skim = 0.05;
    const head = w.realm.figures[w.realm.settlements[site]!.leader!]!;
    head.greed = 0.1;
    let day = 2;
    while (w.realm.offices[key]!.took === 0 && day < TAX - 1) advanceWorld(w.realm, w.store, ++day, { live: w.live });
    const took = w.realm.offices[key]!.took;
    expect(took).toBeGreaterThan(0);
    // The true books show it; the books its people see carry it as upkeep.
    const truth = periodsOf(w.realm, inst, true).at(-1)!.lines;
    const shown = periodsOf(w.realm, inst, false).at(-1)!.lines;
    expect(truth.stolen).toBeLessThan(0);
    expect(shown.stolen).toBeUndefined();
    expect(shown.upkeep).toBe((truth.upkeep ?? 0) + truth.stolen!);
    // An audit on a tax day finds it (by the head's caution; tried until one does).
    let found = false;
    // A keeper who came from the town's townsfolk is audited in the town's own day; a figure appointed by the head, in the realm's.
    const town = !!w.realm.offices[key]!.town;
    for (let t = 1; t <= 40 && !found; t++) found = auditDay(w.realm, TAX * t, w.store, { rows: town, site }).some((x) => x.holder === thief.id);
    expect(found).toBe(true);
    expect(w.realm.offices[key]!.holder).not.toBe(thief.id);
    expect(thief.renown).toBeLessThan(0);
    expect(thief.life.titles.some((t) => t.id === "the_thief")).toBe(true);
    expect(titled(thief)).toContain("the Thief");
    // Told as realm news, or (a townsperson keeper) as the town's own event.
    const told = w.realm.news.some((n) => n.kind === "office" && n.text.includes(thief.name) && n.text.includes("audit")) || w.store.dumpTable("events").some((e) => e.kind === "caught-stealing" && String(e.details).includes(thief.name));
    expect(told).toBe(true);
    // The head who punished them has a deed toward the Just; and a new keeper is appointed.
    expect(head.repute?.punished).toBeDefined();
    appointDay(w.realm, TAX * 40 + 1, w.store);
    expect(w.realm.offices[key]!.holder).toBeTruthy();
    expect(w.realm.offices[key]!.holder).not.toBe(thief.id);
  });

  it("a good captain makes a place stronger and an empty post weaker; wages are paid first on tax day, and unpaid officers quit", async () => {
    const { settlementSide } = await import("../src/game/realm/military.js");
    const realm = generateRealm(5, 1);
    advanceRealm(realm, 2);
    const town = placesOf(realm, "town")[0]!;
    const key = officeKey(placeInst(town.id), "captain");
    realm.offices[key]!.skill = 1;
    const strong = settlementSide(realm, town).strength;
    const held = realm.offices[key]!.holder;
    realm.offices[key]!.holder = null;
    const empty = settlementSide(realm, town).strength;
    expect(strong / empty).toBeCloseTo(1.15 / 0.95, 2);
    realm.offices[key]!.holder = held;
    // A place that can't pay: its officers go unpaid, and after three tax days they quit.
    const cap = realm.figures[held!]!;
    const { wagesDay } = await import("../src/game/office/treasury.js");
    const { sink } = await import("../src/game/realm/ledger.js");
    for (let t = 1; t <= 3; t++) {
      sink(realm, placeInst(town.id), town.treasury, "upkeep", undefined, TAX * t);
      wagesDay(realm, TAX * t);
    }
    expect(officeOf(realm, cap.id)).toBeUndefined();
    expect(realm.news.some((n) => n.text.includes("three seasons unpaid"))).toBe(true);
  });
});

describe("N69 step 4: charters, the minimum, recruiting drives, dues", () => {
  it("a smith who founds a smiths' guild alone has a charter; with no one to join it fails within a year and costs the founder", () => {
    const realm = generateRealm(6, 1);
    const village = villageOf(realm);
    const smith = person(realm, village, "smith", { renown: 10 });
    const fac = foundFaction(realm, seededRng(1), { kind: "guild", trade: "smiths", founder: smith, seat: village, creed: "good iron", why: "the smiths want a say" }, 1);
    expect(fac.charter?.need).toBe(minMembers(realm, fac));
    expect(officesOf(realm, factionInst(fac.id))).toEqual([]);
    const after = smith.renown;
    // Nobody else in the realm is a smith near it: the year runs out.
    for (const f of Object.values(realm.figures)) if (f.role === "smith" && f.id !== smith.id) f.role = "farmer";
    let day = 1;
    while (fac.dissolved === undefined && day <= Y + 2) factionsDay(realm, ++day, seededRng(day));
    expect(fac.dissolved).toBeDefined();
    expect(fac.charter).toBeDefined();
    expect(smith.renown).toBe(after - 6);
    expect(smith.faction).toBeNull();
    expect(realm.news.some((n) => n.text.includes("never got its charter"))).toBe(true);
  });

  it("is chartered once enough have pledged: news, and its posts filled", () => {
    const realm = generateRealm(6, 1);
    const village = villageOf(realm);
    const smith = person(realm, village, "smith");
    const fac = foundFaction(realm, seededRng(1), { kind: "guild", trade: "smiths", founder: smith, seat: village, creed: "good iron", why: "the smiths want a say" }, 1);
    expect(charterDay(realm, fac, 2)).toBeNull();
    for (let i = 1; i < fac.charter!.need; i++) join(realm, person(realm, village, "smith"), fac);
    expect(charterDay(realm, fac, 3)).toBe("chartered");
    expect(fac.charter).toBeUndefined();
    expect(realm.news.some((n) => n.text.includes("is chartered"))).toBe(true);
    appointDay(realm, 4);
    expect(officeFor(realm, factionInst(fac.id), "coffer")?.office?.holder).toBeTruthy();
  });

  it("over five years no chartered guild stays under its minimum past a season, and drives recruit (figures and townsfolk)", () => {
    const w = world(7);
    advanceWorld(w.realm, w.store, 2 * Y, { live: w.live });
    const s = officeSample(w.realm, w.realm.day);
    expect(s.underMinLong).toBe(0);
    expect((w.realm.stats.recruited ?? 0) + (w.realm.stats.recruited_rows ?? 0)).toBeGreaterThan(0);
    expect(w.realm.stats.recruited_rows ?? 0).toBeGreaterThan(0);
    // Townsfolk members are counted: a faction's count is its named members and its sworn rows.
    const guild = Object.values(w.realm.factions).find((f) => f.dissolved === undefined && (f.rows ?? 0) > 0)!;
    expect(memberCount(w.realm, guild)).toBe(guild.members.filter((m) => w.realm.figures[m]?.alive).length + guild.rows!);
    // The realm alone, five years.
    const realm = generateRealm(7, 1);
    for (let d = 2; d <= 5 * Y; d++) {
      advanceRealm(realm, d);
      expect(officeSample(realm, d).underMinLong).toBe(0);
    }
  });
});

describe("N69 step 5: signed renown, prestige", () => {
  it("joining a prestigious guild raises a member's name, once", () => {
    const realm = generateRealm(8, 1);
    const fac = Object.values(realm.factions).find((f) => f.kind === "guild")!;
    fac.prestige = 60;
    const f = person(realm, fac.seat!, "merchant", { renown: 4 });
    expect(figureJoined(f, fac)).toBe(6);
    expect(f.renown).toBe(10);
    expect(figureJoined(f, fac)).toBe(0);
  });

  it("breaking two treaties takes a figure from +5 below zero, and they are Oathbreaker", () => {
    const realm = generateRealm(8, 1);
    const k = Object.values(realm.kingdoms);
    const ruler = realm.figures[k[0]!.ruler!]!;
    ruler.renown = 5;
    for (const kind of ["trade", "non_aggression"] as const) breakTreaty(realm, sign(realm, kind, `k:${k[0]!.id}`, `k:${k[1]!.id}`, 1, 30, "a test"), `k:${k[0]!.id}`, 2, "a test");
    expect(ruler.renown).toBeLessThan(0);
    epithetsDay(realm, season);
    expect(ruler.life.titles.some((t) => t.id === "oathbreaker")).toBe(true);
  });

  it("an infamous bandit chief still leads their gang and talks; an infamous merchant loses a guild's lead to one of good name; a −50 head is passed over", () => {
    const realm = generateRealm(9, 1);
    const gang = Object.values(realm.factions).find((f) => f.kind === "gang")!;
    const chief = realm.figures[gang.leader!]!;
    chief.renown = -60;
    chief.life.tier = "D";
    gang.leader = null;
    factionsDay(realm, 2, seededRng(2));
    expect(gang.leader).toBe(chief.id);
    expect(rankIn(realm, gang, chief.id)).toBe("chief");
    const site = gang.seat!;
    chief.home = site;
    const creatures = { c1: { uid: "c1", figure: chief.id, outcome: null } as unknown as Creature };
    expect(readyToTalk(realm, creatures, site).map((f) => f.id)).toContain(chief.id);
    // A guild picks a merchant of good name over a better-ranked one of ill name.
    const town = placesOf(realm, "town")[0]!.id;
    const bad = person(realm, town, "merchant", { renown: -40 });
    bad.life.tier = "C";
    const good = person(realm, town, "merchant", { renown: 10 });
    expect(standingIn(bad, "guild")).toBeLessThan(standingIn(good, "guild"));
    expect(standingIn(bad, "gang")).toBeGreaterThan(standingIn(good, "gang"));
    const founder = person(realm, town, "merchant");
    const g = foundFaction(realm, seededRng(3), { kind: "guild", trade: "merchants", founder, seat: town, creed: "scales", why: "trade" }, 2);
    join(realm, bad, g);
    join(realm, good, g);
    g.leader = null;
    founder.alive = false;
    factionsDay(realm, 3, seededRng(3));
    expect(g.leader).toBe(good.id);
    // A place's succession passes over the infamous.
    const village = placesOf(realm, "village")[1]!;
    for (const f of residents(realm, village.id)) f.home = null;
    const hated = person(realm, village.id, "farmer", { renown: -50 });
    hated.life.tier = "D";
    const liked = person(realm, village.id, "farmer", { renown: 5 });
    village.leader = null;
    successionDay(realm, 3, seededRng(4));
    expect(village.leader).toBe(liked.id);
    expect(talkerStanding(realm, undefined, hated.id)).toBeNull();
    hated.talks = "t_hated";
    expect(talkerStanding(realm, undefined, "t_hated")).toContain("curse your name");
  });

  it("a townsperson who rises keeps their row's renown", () => {
    const w = world(10);
    const r = (w.store.people.loadSite(w.start, "full") as PersonRow[]).find((x) => x.job !== "child" && !x.figure && !x.persona)!;
    w.store.people.update(r.id, { renown: -30 });
    const f = raiseRow(w.realm, w.store, r.id, 2, "a test")!;
    expect(f.renown).toBe(-30);
    expect(f.person).toBe(r.id);
    expect(w.store.people.get(r.id)!.figure).toBe(f.id);
    expect(fame(f)).toBe(30);
  });

  it("the schema carries the townsfolk's renown and epithet", () => {
    expect(TABLES.people).toContain("renown");
    expect(TABLES.people).toContain("epithet");
    expect(SCHEMA_VERSION).toBeGreaterThanOrEqual(13);
  });
});

/** Two village heads alike but for their people: followers set loyal or resentful. */
function twoHeads(seed: number) {
  const realm = generateRealm(seed, 1);
  const store = new WorldStore(":memory:");
  const [a, b] = placesOf(realm, "village").filter((s) => s.leader);
  const heads = [a!, b!].map((s) => {
    const h = realm.figures[s.leader!]!;
    h.renown = 5;
    h.life.tier = "E";
    for (const f of residents(realm, s.id)) if (f.id !== h.id) f.home = null;
    return h;
  });
  // Only their own people follow them here: the hamlets under them answer elsewhere.
  for (const s of Object.values(realm.settlements)) if (s.liege === a!.id || s.liege === b!.id) s.liege = null;
  const followers = [a!, b!].map((s, i) => Array.from({ length: 4 }, () => person(realm, s.id, "farmer", { loyalty: i === 0 ? 0.95 : 0.05 })));
  for (const f of followers[0]!) adjustRel(store, f.id, heads[0]!.id, { respect: 40, trust: 30 }, 1);
  for (const f of followers[1]!) addGrievance(store, { who: f.id, against: heads[1]!.id, cause: "test:taxes", weight: 0.8, day: 1 });
  return { realm, store, a: a!, b: b!, heads, followers };
}

describe("N69 step 6: support", () => {
  it("a respected head gains renown over a year; a resented one loses it, sinks below zero, and after a season under −10 is challenged", () => {
    const { realm, store, a, b, heads } = twoHeads(11);
    const [good, bad] = heads as [Figure, Figure];
    let challengedOn: number | null = null;
    for (let d = season; d <= Y; d += season) {
      supportDay(realm, d, store);
      if (challengedOn === null && b.leader !== bad.id) challengedOn = d;
    }
    expect(good.support).toBeGreaterThanOrEqual(10);
    expect(good.renown).toBeGreaterThan(5);
    expect(a.leader).toBe(good.id);
    expect(bad.renown).toBeLessThan(0);
    expect(challengedOn).toBe(2 * season);
    expect(b.leader).not.toBe(bad.id);
    expect(realm.news.some((n) => n.kind === "challenge" && n.text.includes(bad.name))).toBe(true);
    expect(effective(good)).toBe(good.renown + good.support!);
  });
});

describe("N69 step 7: ventures and failure", () => {
  it("a failed conquest costs the ruler 15..20 (below zero when it repeats), their marshal half, the families of the dead a grudge; a won defence raises the defender", () => {
    const w = world(12);
    advanceWorld(w.realm, w.store, 2, { live: w.live });
    const [k1, k2] = Object.values(w.realm.kingdoms);
    const ruler = w.realm.figures[k1!.ruler!]!;
    const defender = w.realm.figures[k2!.ruler!]!;
    ruler.renown = 10;
    const marshal = w.realm.figures[officeFor(w.realm, placeInst(k1!.capital), "levy")!.office!.holder!]!;
    const m0 = marshal.renown;
    const d0 = defender.renown;
    // A soldier of the capital fell in the war: a row with family.
    const cap = k1!.capital;
    const grown = (w.store.people.loadSite(cap, "full") as PersonRow[]).filter((r) => r.job !== "child" && r.persona === null);
    const soldier = grown.find((r) => r.spouse) ?? grown[0]!;
    if (!soldier.spouse) {
      // One of the first people of the place, unmarried: give them a wife, so someone mourns.
      const wife = grown.find((r) => r.id !== soldier.id && !r.spouse)!;
      w.store.people.update(soldier.id, { spouse: wife.id });
      w.store.people.update(wife.id, { spouse: soldier.id });
    }
    killPerson(w.realm, w.store, soldier.id, { cause: "battle", day: 3, event: `battle:3:${k2!.capital}:attackers` });
    const war = { id: "w-test", attackers: [`k:${k1!.id}`], defenders: [`k:${k2!.id}`], cause: "a test", start: 2, score: -80, battles: [{ day: 3, at: k2!.capital, winner: "defenders" as const, losses: 10, text: "" }] };
    w.realm.wars.push(war);
    endWar(w.realm, war, 3, "defenders", "they threw the attackers back");
    expect(ruler.renown).toBeLessThanOrEqual(10 - 15);
    expect(ruler.renown).toBeGreaterThanOrEqual(10 - 22);
    expect(ruler.renown).toBeLessThan(0);
    expect(marshal.renown - m0).toBe(Math.round((ruler.renown - 10) / 2));
    expect(defender.renown).toBeGreaterThan(d0);
    expect(ruler.ventures?.at(-1)).toMatchObject({ kind: "conquest", won: false, led: true });
    // The grudges are borne the day after, by the soldier's family.
    officesSiteDay(w.realm, w.store, cap, 4);
    expect(w.store.social.openBetween(w.store.people.get(soldier.id)!.spouse!, ruler.person ?? ruler.id).length).toBeGreaterThan(0);
    // A second defeat.
    const before = ruler.renown;
    ventureOutcome(w.realm, { kind: "conquest", leader: ruler.id, won: false }, 5);
    expect(ruler.renown).toBeLessThan(before - 14);
  });

  it("a guild head whose takeover failed loses the same; the faction is shaken (a lieutenant likelier to break away)", () => {
    const realm = generateRealm(13, 1);
    const fac = Object.values(realm.factions).find((f) => f.kind === "guild" && f.leader)!;
    const head = realm.figures[fac.leader!]!;
    const r0 = head.renown;
    ventureOutcome(realm, { kind: "takeover", leader: head.id, faction: fac.id, won: false }, 6);
    expect(head.renown).toBeLessThanOrEqual(r0 - 8);
    expect(fac.shaken).toBeGreaterThan(6);
  });
});

describe("N69 step 8: epithets and rising by renown", () => {
  it("a head loved for a year is called the Good, and loses it a year after their people turn", () => {
    const { realm, store, heads, followers } = twoHeads(14);
    const good = heads[0]!;
    good.renown = 45;
    let day = 0;
    for (; day <= 2 * Y && !good.life.titles.some((t) => t.id === "the_good"); day += season) {
      supportDay(realm, day, store);
      epithetsDay(realm, day);
    }
    expect(good.life.titles.some((t) => t.id === "the_good")).toBe(true);
    expect(titled(good)).toContain("the Good");
    expect(realm.news.some((n) => n.kind === "epithet" && n.text.includes(good.name) && n.text.includes("the Good"))).toBe(true);
    // Their people turn on them.
    for (const f of followers[0]!) {
      f.loyalty = 0.05;
      addGrievance(store, { who: f.id, against: good.id, cause: "test:turned", weight: 0.9, day });
    }
    const turned = day;
    for (; day <= turned + Y + 2 * season && good.life.titles.some((t) => t.id === "the_good"); day += season) {
      supportDay(realm, day, store);
      epithetsDay(realm, day);
    }
    expect(good.life.titles.some((t) => t.id === "the_good")).toBe(false);
    expect(day - turned).toBeGreaterThanOrEqual(Y);
  });

  it("a lord who sacks a place that gave in is the Cruel, for life", () => {
    const realm = generateRealm(15, 1);
    const lord = Object.values(realm.figures).find((f) => f.role === "lord" && f.alive)!;
    sackedSurrendered(realm, lord, "a test village", 2);
    expect(lord.life.titles.some((t) => t.id === "the_cruel")).toBe(true);
    for (let d = season; d <= 3 * Y; d += season) epithetsDay(realm, d);
    expect(lord.life.titles.some((t) => t.id === "the_cruel")).toBe(true);
  });

  it("a townsfolk reeve caught skimming is the Thief, rises to a figure, and in their place talks of it", () => {
    const w = world(16, (r) => [villageOf(r)]);
    advanceWorld(w.realm, w.store, 2, { live: w.live });
    const village = villageOf(w.realm);
    const key = officeKey(placeInst(village), "reeve");
    let o = w.realm.offices[key]!;
    // Make the reeve a townsperson, if a figure took it.
    if (!o.row) {
      const r = (w.store.people.loadSite(village, "full") as PersonRow[]).find((x) => x.job !== "child" && !x.figure && x.death === null && !officeOf(w.realm, x.id))!;
      w.realm.offices[key] = o = { ...o, holder: r.id, row: true, town: true, name: r.name };
    }
    const rowId = o.holder!;
    o.skim = 0.05;
    o.took = 40;
    let found = false;
    // A townsperson keeper is audited in their place's own day.
    for (let t = 1; t <= 40 && !found; t++) found = auditDay(w.realm, TAX * t, w.store, { rows: true, site: village }).some((x) => x.holder === rowId);
    expect(found).toBe(true);
    expect(w.store.people.get(rowId)!.epithet).toBe("the_thief");
    officesSiteDay(w.realm, w.store, village, TAX * 40 + 1);
    const row = w.store.people.get(rowId)!;
    expect(row.figure).toBeTruthy();
    const fig = w.realm.figures[row.figure!]!;
    expect(fig.life.titles.some((t) => t.id === "the_thief")).toBe(true);
    expect(fig.renown).toBeLessThan(0);
    expect(fig.person).toBe(rowId);
    expect(readyToTalk(w.realm, {}, village).map((f) => f.id)).toContain(fig.id);
    expect(talkerStanding(w.realm, w.store, rowId)).toContain(TITLES.the_thief.name);
  });
});

describe("N69: determinism and the long run", () => {
  it("the same seed gives the same offices, books and renown", () => {
    const run = () => {
      const realm = generateRealm(17, 1);
      advanceRealm(realm, Y);
      return JSON.stringify({ o: realm.offices, b: realm.books, r: Object.values(realm.figures).map((f) => [f.id, f.renown, f.support ?? null]), f: Object.values(realm.factions).map((f) => [f.id, f.prestige, f.charter ?? null, f.dissolved ?? null]) });
    };
    expect(run()).toBe(run());
  });
});
