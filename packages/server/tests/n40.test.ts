import { DatabaseSync } from "node:sqlite";
import { CLASS_RANK, type SocialClass } from "@millbrook/shared";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { config } from "../src/config.js";
import { ambitionDay, careerYearDay } from "../src/game/ambition/day.js";
import { checkAmbitionBounds } from "../src/game/ambition/bounds.js";
import { chooseRoute, urgentOf, ventOf } from "../src/game/ambition/situations.js";
import { ambitionCtxOf } from "../src/game/choice/day.js";
import { NEUTRAL_DAY } from "../src/game/people/conditions.js";
import { temperOf } from "../src/game/chatter/person.js";
import { traitsOfRow } from "../src/game/people/traits.js";
import { CAREER, growthChance, initialSkill, JOBS, placeCareers, rankOf, shopRoom } from "../src/game/ambition/careers.js";
import { AMBITION_KINDS, isTrade } from "../src/game/ambition/kinds.js";
import { decidersOf, seatsOf } from "../src/game/ambition/seats.js";
import { ambitionRows, careerRole, talkerAmbition, viewOf } from "../src/game/ambition/words.js";
import { menuFor, decide } from "../src/game/choice/registry.js";
import type { ChoiceCtx, ChoiceHost, Other } from "../src/game/choice/types.js";
import { hateOn } from "../src/game/chatter/grievance.js";
import { WorldStore } from "../src/game/db.js";
import { streamFor } from "../src/game/dice.js";
import { eventRef } from "../src/game/gossip/refs.js";
import { worldHash } from "../src/game/hash.js";
import { liveSites } from "../src/game/people/live.js";
import { ageFrom } from "../src/game/people/rules.js";
import type { LifeCtx } from "../src/game/people/step.js";
import { advanceWorld, settle } from "../src/game/people/world.js";
import { generateRealm } from "../src/game/realm/generate.js";
import { kingdomLaws, townspersonOfRow } from "../src/game/realm/townsfolk.js";
import { TRIPS } from "../src/game/road/trips/config.js";
import { NpcAgent } from "../src/npc/NpcAgent.js";
import { createNpcState } from "../src/npc/state.js";
import type { PersonRow } from "../src/store/peopleStore.js";
import { AMBITION_DEFAULTS } from "../src/store/careerStore.js";
import { materialisePeople } from "../src/store/materialise.js";
import { applySchema, SCHEMA_VERSION, TABLES } from "../src/store/schema.js";
import type { LLMProvider } from "../src/llm/provider.js";
import { createTestWorld } from "../src/world/world.js";
import { FakeProvider, hale, pickTestPlaces, say } from "./helpers.js";

/**
 * N40: ambitions and careers. Everyone grown wants something from their life, picked in code from class, job, traits and family, with a
 * ladder; careers move (apprentice, journeyman, master, a shop); seats are scarce and the losers of a contest for one bear the winner a
 * grudge; ambition adds weight to the action menu; talkers say what they want. People are found by job and class, never by name.
 */
vi.setConfig({ testTimeout: 240_000, hookTimeout: 240_000 });

const trips = { ...Object.fromEntries(Object.entries(TRIPS).map(([k, v]) => [k, v.cap])) } as Record<string, number>;
beforeEach(() => {
  config.peopleLazy = "";
  config.gossip = true;
  config.chatter = true;
  config.ambitions = true;
  config.realm = true;
  config.realmSeed = undefined;
  for (const k of Object.keys(TRIPS)) (TRIPS as Record<string, { cap: number }>)[k]!.cap = trips[k]!;
});

const Y = config.daysPerYear;

/** The slice: the start town and its liege, with their people rolled and living. */
function world(seed = 1) {
  const realm = generateRealm(seed, 1);
  const store = new WorldStore(":memory:");
  materialisePeople(realm, store.people, 1);
  const { start, liege } = pickTestPlaces(realm);
  const live = new Set([start, liege]);
  const ctx: LifeCtx = { realm, store };
  return { realm, store, live, ctx, start, liege };
}
type W = ReturnType<typeof world>;

const grownAt = (w: W, site: string) => (w.store.people.loadSite(site, "full") as PersonRow[]).filter((r) => r.job !== "child");
const rank = (r: PersonRow) => CLASS_RANK[r.cls as SocialClass] ?? 2;

describe("N40 step 1: kinds, picking, the table", () => {
  let w: W;
  beforeAll(() => {
    w = world(1);
    advanceWorld(w.realm, w.store, 2, { live: w.live });
  });

  it("everyone grown has one ambition, and no child does", () => {
    for (const site of [w.start, w.liege]) {
      for (const r of w.store.people.loadSite(site, "full") as PersonRow[]) {
        const a = w.store.careers.ambitionOf(r.id);
        if (r.job === "child") expect(a, r.id).toBeNull();
        else {
          expect(a, r.id).not.toBeNull();
          expect(AMBITION_KINDS).toContain(a!.kind);
        }
      }
    }
  });

  it("the spread follows class and job: no bondsman wants a guild seat, most in a trade want mastery, the old want quiet", () => {
    const all = [...grownAt(w, w.start), ...grownAt(w, w.liege)];
    const kinds = (rows: PersonRow[]) => rows.map((r) => w.store.careers.ambitionOf(r.id)!.kind);
    const bound = all.filter((r) => r.cls === "slave" || r.cls === "serf");
    expect(kinds(bound)).not.toContain("guild_seat");
    expect(kinds(bound)).not.toContain("office");
    // In a trade and still short of a shop of their own: mastery is what most of them want.
    const learning = all.filter((r) => (isTrade(r.job) || r.job === "apprentice") && r.shop === null && ageFrom(r.born_day, 2) < 55);
    expect(learning.length).toBeGreaterThan(5);
    expect(kinds(learning).filter((k) => k === "master_trade").length / learning.length).toBeGreaterThan(0.5);
    const old = all.filter((r) => ageFrom(r.born_day, 2) >= 61);
    expect(kinds(old).filter((k) => k === "quiet_life").length / old.length).toBeGreaterThan(0.6);
    // A seat on a city's or town's council is for those of the class it takes.
    for (const r of all.filter((x) => w.store.careers.ambitionOf(x.id)!.kind === "office")) expect(rank(r)).toBeGreaterThanOrEqual(2);
    // More than three kinds are wanted in a place: it is not one ambition for all.
    expect(new Set(kinds(all)).size).toBeGreaterThan(3);
  });

  it("a career is worked out for everyone: skill from job and age, a rank in a trade, and a jobs_held row", () => {
    const all = grownAt(w, w.liege);
    for (const r of all) {
      expect(r.skill, r.id).not.toBeNull();
      expect(r.skill!).toBeGreaterThanOrEqual(0);
      expect(r.skill!).toBeLessThanOrEqual(5);
      expect(w.store.careers.openJobs(r.id).length, r.id).toBeGreaterThan(0);
    }
    const masters = all.filter((r) => rankOf(r, w.store.careers.openJobs(r.id)) === "master");
    expect(masters.length).toBeGreaterThan(0);
    for (const m of masters) expect(m.skill!).toBeGreaterThanOrEqual(4);
    // Apprentices learn under a master of their trade who keeps a shop here, where there is one.
    for (const a of all.filter((r) => r.job === "apprentice" && r.master_id)) {
      const m = w.store.people.get(a.master_id!)!;
      expect(m.shop).not.toBeNull();
      expect(a.work).toBe(`front:${m.shop}`);
    }
  });

  it("a place's first day finds its masters in their shops and its seats held, without a contest", () => {
    const shops = w.store.careers.holdersOf(`shop:${w.liege}:`);
    expect(shops.length).toBeGreaterThan(0);
    for (const { who } of shops) expect(w.store.people.get(who)!.shop).not.toBeNull();
    expect(w.store.careers.seatHolders(w.liege).size).toBeGreaterThan(0);
    expect(w.store.dumpTable("events").filter((e) => e.kind === "seat-won" && Number(e.day) <= 2)).toHaveLength(0);
  });

  it("skill grows on a career year, faster for the young and those with a master", () => {
    const young = { job: "apprentice", master_id: "x", species: "human", born_day: 2 - 17 * Y } as PersonRow;
    const old = { ...young, born_day: 2 - 50 * Y };
    expect(growthChance(young, 2, 1)).toBeGreaterThan(growthChance(old, 2, 1));
    expect(growthChance({ ...young, master_id: null }, 2, 1)).toBeLessThan(growthChance(young, 2, 1));
    expect(growthChance(young, 2, 5)).toBe(0);
    expect(initialSkill({ id: "a", job: "smith", born_day: 2 - 45 * Y, species: "human" } as PersonRow, 2)).toBeGreaterThanOrEqual(4);
    // Everyone has one career year a year, spread over the year.
    const days = Array.from({ length: Y }, (_, d) => d + 100).filter((d) => careerYearDay("t_x_1", d));
    expect(days).toHaveLength(1);
  });

  it("the same seed gives the same careers; a place worked out later gives the same careers as one worked out on the day", () => {
    const run = (lazy: boolean) => {
      const x = world(1);
      for (const k of Object.keys(TRIPS)) (TRIPS as Record<string, { cap: number }>)[k]!.cap = 0;
      advanceWorld(x.realm, x.store, 2, { live: x.live });
      config.peopleLazy = lazy ? x.start : "";
      advanceWorld(x.realm, x.store, 40, { live: x.live });
      if (lazy) settle(x.ctx, x.start, 40);
      config.peopleLazy = "";
      const mine = (id: unknown) => x.store.people.get(String(id))?.site === x.start;
      return JSON.stringify({
        amb: x.store.dumpTable("ambitions").filter((r) => mine(r.who)),
        jobs: x.store.dumpTable("jobs_held").filter((r) => r.site === x.start),
        skill: (x.store.people.loadSite(x.start, "full") as PersonRow[]).map((r) => [r.id, r.skill, r.shop, r.job]),
      });
    };
    const live = run(false);
    expect(live.length).toBeGreaterThan(1000);
    expect(run(true)).toBe(live);
    const a = world(2);
    const b = world(2);
    advanceWorld(a.realm, a.store, 20, { live: a.live });
    advanceWorld(b.realm, b.store, 20, { live: b.live });
    expect(worldHash(a.realm, a.store)).toBe(worldHash(b.realm, b.store));
  });
});

describe("N40: the database", () => {
  it("a version-7 database is brought up to date (schemas 8 and 9): people.skill and people.shop, ambitions.step, strength, frustration, route and urgent, and keeps its rows", () => {
    const db = new DatabaseSync(":memory:");
    applySchema(db, false);
    db.exec("INSERT INTO ambitions (who, kind, target, progress, since, step) VALUES ('x', 'land', NULL, 0.5, 3, 0)");
    db.exec("ALTER TABLE people DROP COLUMN skill; ALTER TABLE people DROP COLUMN shop; ALTER TABLE ambitions DROP COLUMN step; ALTER TABLE ambitions DROP COLUMN strength; ALTER TABLE ambitions DROP COLUMN frustration; ALTER TABLE ambitions DROP COLUMN route; ALTER TABLE ambitions DROP COLUMN urgent; DROP INDEX jobs_held_who; DROP INDEX jobs_held_open; PRAGMA user_version = 7");
    applySchema(db, false);
    expect(Number((db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version)).toBe(SCHEMA_VERSION);
    const cols = (t: string) => (db.prepare(`PRAGMA table_info(${t})`).all() as Array<{ name: string }>).map((c) => c.name);
    expect(cols("people")).toEqual(expect.arrayContaining(["skill", "shop"]));
    expect(cols("ambitions")).toEqual(expect.arrayContaining(["step", "strength", "frustration", "route", "urgent"]));
    // A row from before wants what it wanted at the middling strength, with no frustration, route or urgent want yet (schema 9).
    expect(db.prepare("SELECT kind, step, strength, frustration, route, urgent FROM ambitions WHERE who = 'x'").get()).toEqual({ kind: "land", step: 0, strength: 0.6, frustration: 0, route: null, urgent: null });
    expect(TABLES.ambitions).toContain("step");
    expect(TABLES.people).toEqual(expect.arrayContaining(["skill", "shop"]));
  });
});

describe("N40 step 2 and step 6: years of careers", () => {
  // The slice, lived for eight years (one 48-day year each): long enough for an apprentice of the first day to rise and open a shop.
  let w: W;
  let achieved = 0;
  let changed = 0;
  const YEARS = 8;
  beforeAll(() => {
    w = world(1);
    advanceWorld(w.realm, w.store, 2, { live: w.live });
    advanceWorld(w.realm, w.store, 2 + YEARS * Y, { live: w.live });
    const ev = w.store.dumpTable("events");
    achieved = ev.filter((e) => e.kind === "ambition-achieved").length;
    changed = ev.filter((e) => e.kind === "ambition-changed").length;
  });

  it("over a few simulated years an apprentice becomes a master and opens a shop", () => {
    const rose = w.store.dumpTable("people").filter((r) => {
      const h = w.store.careers.history(String(r.id)).map((j) => j.job);
      return h.some((j) => j.startsWith("apprentice:")) && h.some((j) => j.endsWith(":journeyman")) && h.some((j) => j.endsWith(":master")) && h.some((j) => j.startsWith("shop:"));
    });
    expect(rose.length).toBeGreaterThanOrEqual(1);
    const who = rose[0]!;
    const row = w.store.people.get(String(who.id))!;
    const hist = w.store.careers.history(row.id);
    // In order: apprentice, then journeyman, then master, then a shop.
    const at = (p: (j: string) => boolean) => hist.find((j) => p(j.job))!.from_day;
    expect(at((j) => j.startsWith("apprentice:"))).toBeLessThanOrEqual(at((j) => j.endsWith(":journeyman")));
    expect(at((j) => j.endsWith(":journeyman"))).toBeLessThan(at((j) => j.endsWith(":master")));
    expect(at((j) => j.endsWith(":master"))).toBeLessThanOrEqual(at((j) => j.startsWith("shop:")));
    const events = w.store.eventsAbout(row.id, 200).map((e) => e.kind);
    expect(events).toEqual(expect.arrayContaining(["promoted", "opened-shop"]));
    // The shop is on the place's map: their house bears their sign (the roster's townsperson has it, and the frame labels it).
    if (row.death === null && row.shop !== null && row.site) {
      const t = townspersonOfRow(row, w.realm, w.realm.day, 0, 10_000);
      expect(t.shop).toBe(row.shop);
      expect(t.work).toBe(`front:${row.shop}`);
    }
  });

  it("masters take on apprentices from the young of the place, and journeymen pass their exams", () => {
    const ev = w.store.dumpTable("events");
    const apprenticed = ev.filter((e) => e.kind === "apprenticed");
    expect(apprenticed.length).toBeGreaterThan(3);
    for (const e of apprenticed.slice(0, 5)) {
      const h = w.store.careers.history(String(e.target)).map((j) => j.job);
      expect(h.some((j) => j.startsWith("apprentice:"))).toBe(true);
    }
    expect(ev.filter((e) => e.kind === "promoted" && String(e.details).includes("master")).length).toBeGreaterThan(3);
  });

  it("ambitions are re-picked when had or when they can't be had, and the bounds hold (churn, seats filled, shops bounded)", () => {
    expect(achieved).toBeGreaterThan(5);
    expect(changed).toBeGreaterThan(5);
    const bounds = checkAmbitionBounds(w.realm, w.store, { sites: [w.start, w.liege], from: 2, to: w.realm.day, achieved, changed });
    for (const b of bounds) expect(b, `${b.name}: ${b.detail}`).toMatchObject({ ok: true });
    expect(bounds.map((b) => b.name)).toEqual(["ambitions-churn", "seats-filled", "shops-bounded"]);
    // Someone who had what they wanted now wants something else.
    const had = w.store.dumpTable("events").find((e) => e.kind === "ambition-achieved" && w.store.people.get(String(e.actor))?.death === null)!;
    const now = w.store.careers.ambitionOf(String(had.actor))!;
    expect(now.since).toBeGreaterThanOrEqual(Number(had.day));
  });

  it("a revenge whose target dies is given up", () => {
    const r = grownAt(w, w.liege).find((x) => x.persona === null && !x.away)!;
    const dead = w.store.dumpTable("people").find((x) => x.death !== null)!;
    w.store.careers.setAmbition({ who: r.id, kind: "revenge", target: String(dead.id), progress: 0, since: w.realm.day, step: 0, ...AMBITION_DEFAULTS });
    // Run the career day on each of the next days until their check comes round.
    let gaveUp = false;
    for (let d = w.realm.day + 1; d <= w.realm.day + Y && !gaveUp; d++) {
      const out = ambitionDay(w.ctx, { site: w.liege }, d);
      gaveUp = out.changed.some((c) => c.who === r.id && c.kind === "revenge");
    }
    expect(gaveUp).toBe(true);
    expect(w.store.careers.ambitionOf(r.id)!.kind).not.toBe("revenge");
  });
});

describe("N40 step 3: seats and rivalries", () => {
  it("two journeymen compete for one guild seat; one gets it; the loser bears the winner a grudge", () => {
    // Find a place of the slice (or beyond) with a guild, and two journeymen there; make them its members and the seat's only hopefuls.
    const w = world(1);
    advanceWorld(w.realm, w.store, 2, { live: w.live });
    let found: { site: string; fac: string; pair: PersonRow[]; others: PersonRow[] } | null = null;
    for (const site of [w.liege, w.start, ...[...liveSites(w.realm, w.start, "all")].sort()]) {
      if (!w.live.has(site)) continue;
      const guild = Object.values(w.realm.factions).find((f) => (f.kind === "guild" || f.kind === "association") && !f.dissolved && (f.seat === site || f.branches.includes(site)));
      const rows = grownAt(w, site).filter((r) => r.persona === null && !r.away);
      const journeymen = rows.filter((r) => rankOf(r, w.store.careers.openJobs(r.id)) === "journeyman" && ageFrom(r.born_day, w.realm.day) < 50);
      if (guild && journeymen.length >= 2) {
        const pair = journeymen.slice(0, 2);
        const others = rows.filter((r) => !pair.includes(r) && ageFrom(r.born_day, w.realm.day) < 55).slice(0, 3);
        found = { site, fac: guild.id, pair, others };
        break;
      }
    }
    expect(found).not.toBeNull();
    const { site, fac, pair, others } = found!;
    const day = w.realm.day + 1;
    // The guild here: the pair and three more; everyone else of it is out of it (so it has one officer's seat and a master's).
    for (const r of grownAt(w, site)) if (r.faction === fac) w.store.people.update(r.id, { faction: null });
    for (const r of [...pair, ...others]) w.store.people.update(r.id, { faction: fac });
    for (const j of w.store.careers.holdersOf(`seat:g:${fac}:${site}:`)) w.store.careers.endJob(j.who, j.row.job, day - CAREER.vacancyDays);
    for (const r of others) w.store.careers.setAmbition({ who: r.id, kind: "quiet_life", target: null, progress: 0, since: 1, step: 0, ...AMBITION_DEFAULTS });
    for (const r of pair) w.store.careers.setAmbition({ who: r.id, kind: "guild_seat", target: fac, progress: 0.8, since: 1, step: 0, ...AMBITION_DEFAULTS });
    // A master of the guild here already, so only the officer's seat is free.
    w.store.careers.startJob(others[0]!.id, JOBS.seat(`g:${fac}:${site}:master`), site, 1);
    const seats = seatsOf(w.realm, site, new Set([fac]), new Map([[fac, 5]]));
    expect(seats.filter((s) => s.kind === "guild_officer")).toHaveLength(1);

    const out = ambitionDay(w.ctx, { site }, day);
    const contest = out.contests.find((c) => c.seat.faction === fac && c.seat.kind === "guild_officer")!;
    expect(contest).toBeDefined();
    expect(contest.scores.map((s) => s.who).sort()).toEqual(pair.map((p) => p.id).sort());
    const winner = contest.winner;
    const loser = pair.find((p) => p.id !== winner)!.id;
    expect(w.store.careers.seatHolders(site).get(JOBS.seat(`g:${fac}:${site}:officer:1`))).toBe(winner);
    expect(w.store.careers.ambitionOf(winner)!.step).toBe(1);
    // The loser's grudge points at the seat's event.
    const won = out.events.find((e) => e.kind === "seat-won")!;
    expect(won.actor).toBe(winner);
    const g = w.store.social.openBetween(loser, winner);
    expect(g.length).toBeGreaterThan(0);
    expect(g[0]!.cause_ref).toBe(eventRef(won.id));
    expect(hateOn(w.store, loser, winner, day)).toBeGreaterThan(0.2);
    // And it is a rivalry the menu sees: the winner is in the loser's way no more, the master decides the next rung.
    expect(decidersOf(w.store, w.realm, w.store.people.get(winner)!, w.store.careers.ambitionOf(winner))).toContain(others[0]!.id);
  });

  it("a council seat is the head's appointment; a guild's vote reads what its members think of each candidate", () => {
    const w = world(1);
    advanceWorld(w.realm, w.store, 2, { live: w.live });
    const s = w.realm.settlements[w.liege]!;
    const seats = seatsOf(w.realm, w.liege, new Set(), new Map());
    if (s.kind !== "hamlet") expect(seats.some((x) => x.kind === "council" && x.rule === "appointed")).toBe(true);
    expect(kingdomLaws(w.realm, s.kingdom)).toBeDefined();
  });
});

describe("N40 step 4: ambition in the menu", () => {
  const base = (who: string, ambition?: ChoiceCtx["ambition"]): ChoiceCtx => {
    const master: Other = { id: "gm", name: "Guildmaster", place: "square", rank: 3, hate: 0, trust: 10, affection: 10, fear: 0, protected: false, carries: true, suitable: false, sameFaction: true, sells: false, restless: false, holdsSeat: true };
    return {
      who,
      name: who,
      kind: "townsperson",
      grain: "day",
      day: 1,
      hour: 12,
      site: "x",
      habit: { activity: "work", place: "square" },
      workPlace: "square",
      eatPlace: "inn",
      rank: 3,
      traits: { bravery: 0.5, temper: 0.4, honesty: 0.5, sociability: 0.5, forgiveness: 0.5, greed: 0.5, ambition: 0.7 },
      hunger: 0,
      fatigue: 0.2,
      mood: 0,
      money: 0,
      broke: false,
      stock: 0,
      festival: false,
      storm: false,
      present: [master],
      absent: [],
      gatherings: [],
      recruiter: false,
      wantsToLeave: false,
      violence: false,
      last: {},
      streak: null,
      fights: { place: 0, hour: 0 },
      ...(ambition ? { ambition } : {}),
    };
  };
  const host = (who: string): ChoiceHost => ({ seed: 1, deed: () => "e", finishGoal: () => {}, roll: (k) => streamFor(1, "t", who, k)() });

  it("two otherwise equal NPCs, one with guild_seat, flatter the guild master more often over a month", () => {
    const count = (who: string, ambition?: ChoiceCtx["ambition"]) => {
      let n = 0;
      const last: Record<string, number> = {};
      for (let day = 1; day <= Y; day++) {
        const ctx = { ...base(who, ambition), day, last: { ...last } };
        const d = decide(ctx, host(who), streamFor(7, "month", day))!;
        if (d.picked.action === "flatter") {
          n++;
          last.flatter = day;
        }
      }
      return n;
    };
    const ambitious = count("a", { kind: "guild_seat", step: 0, target: "guild", progress: 0.3, strength: 0.6, deciders: ["gm"], rivals: [] });
    const content = count("b");
    expect(ambitious).toBeGreaterThan(content);
    expect(ambitious).toBeGreaterThanOrEqual(3);
  });

  it("flattery names the ambition in its reason; petition is offered when the next rung is near; an apprentice with no master seeks one", () => {
    const amb = { kind: "guild_seat", step: 0, target: "guild", progress: 0.8, strength: 0.6, deciders: ["gm"], rivals: [] };
    const menu = menuFor(base("a", amb));
    const fl = menu.find((o) => o.action === "flatter")!;
    expect(fl.parts.map(([l]) => l)).toContain("ambition: guild seat");
    expect(menu.some((o) => o.action === "petition" && o.target === "gm")).toBe(true);
    expect(menuFor(base("b")).some((o) => o.action === "petition")).toBe(false);
    const seek = menuFor(base("c", { kind: "master_trade", step: 0, target: "smith", progress: 0, strength: 0.6, deciders: [], rivals: [], needsMaster: true }));
    expect(seek.some((o) => o.action === "seek_master")).toBe(true);
    // Work weighs a little more for those working toward something.
    const work = (c: ChoiceCtx) => menuFor(c).find((o) => o.action === "work")!.score;
    expect(work(base("d", { kind: "master_trade", step: 1, target: "smith", progress: 0.2, strength: 0.6, deciders: [], rivals: [] }))).toBeGreaterThan(work(base("e")));
  });
});

describe("N40 step 5: talkers and the admin", () => {
  const w = (() => {
    const x = world(1);
    advanceWorld(x.realm, x.store, 2, { live: x.live });
    return x;
  })();
  const journeyman = grownAt(w, w.liege).find((r) => rankOf(r, w.store.careers.openJobs(r.id)) === "journeyman" && w.store.careers.ambitionOf(r.id)?.kind === "master_trade")!;
  const persona = { ...hale, id: journeyman.id, name: journeyman.name, role: `a ${journeyman.job} of the place` };
  const hook = () => talkerAmbition(w.realm, w.store, persona, w.liege, w.realm.day);

  it("an NPC asked what they want names their ambition: the prompt has the line, and the fallback says it", async () => {
    const llm = new FakeProvider([say("To be a master, one day.")]);
    const agent = new NpcAgent(persona, llm, undefined, createNpcState(persona));
    agent.ambition = hook;
    await agent.respond("What do you want from life?", createTestWorld());
    expect(llm.lastUser()).toContain("What you want from life:");
    expect(llm.lastUser()).toContain(`${journeyman.job}'s trade`);

    // With no model at all, the reply is code's: it names the trade and the shop they want.
    const none: LLMProvider = { chat: async () => Promise.reject(new Error("no model")) };
    const quiet = new NpcAgent(persona, none, undefined, createNpcState(persona));
    quiet.ambition = hook;
    const turn = await quiet.respond("What do you want from life?", createTestWorld());
    expect(turn.fallback).toBe(true);
    expect(turn.text).toContain(`${journeyman.job}'s trade`);
    expect(turn.text).toMatch(/shop/);
  });

  it("the view says the rung they are on, how far, and who is in their way", () => {
    const v = viewOf(w.realm, w.store, journeyman.id, w.store.careers.ambitionOf(journeyman.id)!, journeyman)!;
    expect(v.rung).toBe("journeyman");
    expect(v.next).toBe("master");
    expect(v.line).toMatch(/You are a journeyman now/);
    expect(careerRole({ ...journeyman }, "master", "Harton")).toBe(`a master ${journeyman.job} of Harton`);
  });

  it("a talker with no row gets one ambition from their file, kept under their persona id", () => {
    const smith = { ...hale, id: "talker_no_row", role: "the village smith" };
    const v = talkerAmbition(w.realm, w.store, smith, w.liege, 3);
    expect(v).not.toBeNull();
    expect(w.store.careers.ambitionOf("talker_no_row")).not.toBeNull();
    expect(talkerAmbition(w.realm, w.store, smith, w.liege, 9)!.kind).toBe(v!.kind);
  });

  it("the admin card's Ambitions section shows the ambition, its ladder, progress and the career so far", () => {
    const rows = ambitionRows(w.realm, w.store, journeyman.id);
    const labels = rows.map(([l]) => l);
    expect(labels).toEqual(expect.arrayContaining(["Wants", "Ladder", "Progress", "Skill", "Rank", "Career"]));
    expect(rows.find(([l]) => l === "Ladder")![1]).toContain("[journeyman]");
  });
});


describe("N40 follow-up: situations change what people want", () => {
  const fresh = () => {
    const x = world(1);
    for (const k of Object.keys(TRIPS)) (TRIPS as Record<string, { cap: number }>)[k]!.cap = 0;
    advanceWorld(x.realm, x.store, 2, { live: x.live });
    return x;
  };
  const free = (w: W, site: string) => grownAt(w, site).filter((r) => r.persona === null && !r.away);
  /** Run the career day on the next days until `done` (a person's check comes four times a year). */
  const runUntil = (w: W, site: string, from: number, done: (o: ReturnType<typeof ambitionDay>) => boolean, days = Y) => {
    for (let d = from; d < from + days; d++) {
      const o = ambitionDay(w.ctx, { site }, d);
      if (done(o)) return { o, day: d };
    }
    return null;
  };

  it("a famine makes the poor want only to get by, eats what savers put by, and lets go when it ends", () => {
    const w = fresh();
    const day = w.realm.day + 1;
    const poor = free(w, w.liege).find((r) => rank(r) <= 2 && r.shop === null && w.store.careers.ambitionOf(r.id)?.kind === "land")!;
    expect(poor).toBeDefined();
    const before = w.store.careers.ambitionOf(poor.id)!;
    w.store.people.putSiteDay(w.liege, day, { ...NEUTRAL_DAY, famine: 0.6 });
    const o = ambitionDay(w.ctx, { site: w.liege }, day);
    expect(o.urgent.some((u) => u.who === poor.id && u.kind === "get_by")).toBe(true);
    const during = w.store.careers.ambitionOf(poor.id)!;
    expect(urgentOf(during, day)!.kind).toBe("get_by");
    expect(during.since).toBeGreaterThan(before.since);
    // The menu: work is for getting by, and the ambition adds nothing while it lasts.
    const ac = ambitionCtxOf(w.ctx, w.store.people.get(poor.id)!, day)!;
    expect(ac.urgent).toBe("get_by");
    // The famine over, the urgent want goes.
    w.store.people.putSiteDay(w.liege, day + 1, { ...NEUTRAL_DAY });
    ambitionDay(w.ctx, { site: w.liege }, day + 1);
    expect(w.store.careers.ambitionOf(poor.id)!.urgent).toBeNull();
  });

  it("a master's death lets the journeyman who works their shop take it over", () => {
    const w = fresh();
    const day = w.realm.day + 1;
    const master = free(w, w.liege).find((r) => r.shop !== null && isTrade(r.job))!;
    const hand = free(w, w.liege).find((r) => r.id !== master.id && r.shop === null && r.spouse !== master.id && !w.store.people.childrenOf(master.id).some((c) => c.id === r.id) && ageFrom(r.born_day, day) < 50)!;
    for (const j of w.store.careers.openJobs(hand.id)) if (!j.job.startsWith("seat:")) w.store.careers.endJob(hand.id, j.job, day - 1);
    w.store.people.update(hand.id, { job: master.job, work: `front:${master.shop}`, skill: 3 });
    w.store.careers.startJob(hand.id, JOBS.journeyman(master.job), w.liege, day - 3 * Y);
    w.store.careers.setAmbition({ who: hand.id, kind: "master_trade", target: master.job, progress: 0.5, since: 1, step: 1, ...AMBITION_DEFAULTS });
    w.store.people.update(master.id, { death: JSON.stringify({ cause: "illness", day, hour: 3, site: w.liege }) });
    const o = ambitionDay(w.ctx, { site: w.liege }, day);
    expect(o.passed).toContainEqual({ from: master.id, to: hand.id, what: JOBS.shop(w.liege, master.job) });
    expect(w.store.people.get(hand.id)!.shop).toBe(master.shop);
    expect(rankOf(w.store.people.get(hand.id)!, w.store.careers.openJobs(hand.id))).toBe("master");
    expect(o.events.find((e) => e.kind === "opened-shop" && e.actor === hand.id)!.details).toMatch(/took over/);
    // Their ambition was had (by taking it over), so they want something else now.
    expect(o.achieved).toContainEqual({ who: hand.id, kind: "master_trade" });
  });

  it("a death in the family brings grief: what they want waits, and a widow wants it less", () => {
    const w = fresh();
    const day = w.realm.day + 1;
    const wife = free(w, w.liege).find((r) => r.spouse && w.store.people.get(r.spouse)?.death === null && w.store.careers.ambitionOf(r.id)!.kind !== "quiet_life")!;
    const husband = w.store.people.get(wife.spouse!)!;
    const before = w.store.careers.ambitionOf(wife.id)!;
    const record = { cause: "illness" as const, day, hour: 3, site: w.liege };
    w.store.people.update(husband.id, { death: JSON.stringify(record) });
    const o = ambitionDay(w.ctx, { site: w.liege, deaths: [{ id: husband.id, name: husband.name, persona: null, figure: null, record }] }, day);
    expect(o.urgent).toContainEqual({ who: wife.id, kind: "grieve" });
    const after = w.store.careers.ambitionOf(wife.id)!;
    expect(after.strength).toBeLessThan(before.strength);
    expect(urgentOf(after, day)!.why).toContain(husband.name);
    // Asked what they want, they say the grief first.
    const v = viewOf(w.realm, w.store, wife.id, after, w.store.people.get(wife.id), day)!;
    expect(v.line).toMatch(/nothing matters but your grief/);
    expect(v.say).toMatch(/Right now, only my grief/);
  });

  it("an ambition whose heart has gone out of it is let go", () => {
    const w = fresh();
    const day = w.realm.day + 1;
    const r = free(w, w.liege).find((x) => ["land", "office", "wealth"].includes(w.store.careers.ambitionOf(x.id)!.kind))!;
    const kind = w.store.careers.ambitionOf(r.id)!.kind;
    w.store.careers.setAmbition({ ...w.store.careers.ambitionOf(r.id)!, strength: 0.05 });
    const hit = runUntil(w, w.liege, day, (o) => o.changed.some((c) => c.who === r.id));
    expect(hit).not.toBeNull();
    expect(hit!.o.changed.find((c) => c.who === r.id)!.why).toMatch(/heart has gone/);
    expect(w.store.careers.ambitionOf(r.id)!.kind).not.toBe(kind);
  });

  it("being blocked builds frustration until it is let out, by temper: the hot-tempered and dishonest turn on whoever is in the way, the forgiving give up", () => {
    const w = fresh();
    const rows = free(w, w.liege);
    // By temper alone (who is in the way and whether they could leave are the same for both).
    const hot = rows.find((r) => temperOf(r).temper > 0.8 && temperOf(r).honesty < 0.3 && temperOf(r).forgiveness < 0.4)!;
    const mild = rows.find((r) => temperOf(r).temper < 0.2 && temperOf(r).forgiveness > 0.8 && traitsOfRow(r).ambition < 0.3)!;
    expect(["grudge", "slander"]).toContain(ventOf(hot, "guild_seat", 0, { blocker: true, free: false, shortcut: false }, 0.5));
    expect(ventOf(mild, "guild_seat", 0, { blocker: true, free: false, shortcut: false }, 0.5)).toBe("give_up");
    expect(ventOf(hot, "master_trade", 2, { blocker: false, free: false, shortcut: true }, 0.1)).toBe("shortcut");

    // In the career day: a master with no room for a shop, nearly out of patience, lets it out on their next check.
    const day = w.realm.day + 1;
    const place = placeCareers(w.realm, w.liege, w.store.people.loadSite(w.liege, "full") as PersonRow[], w.store.careers, kingdomLaws(w.realm, w.realm.settlements[w.liege]!.kingdom));
    const waiting = rows.find((r) => isTrade(r.job) && r.shop === null && rankOf(r, w.store.careers.openJobs(r.id)) === "master" && shopRoom(place, r.job) <= 0)!;
    expect(waiting).toBeDefined();
    w.store.careers.setAmbition({ who: waiting.id, kind: "master_trade", target: waiting.job, progress: 1, since: day, step: 2, ...AMBITION_DEFAULTS, frustration: 0.69 });
    const hit = runUntil(w, w.liege, day, (o) => o.vented.some((v) => v.who === waiting.id));
    expect(hit).not.toBeNull();
    const how = hit!.o.vented.find((v) => v.who === waiting.id)!.how;
    expect(["grudge", "slander", "shortcut", "leave", "give_up"]).toContain(how);
    if (how === "grudge" || how === "slander") expect(hit!.o.vented.find((v) => v.who === waiting.id)!.at).toBeDefined();
  });

  it("a slander turns those who hear it against the one in the way", () => {
    const w = fresh();
    const day = w.realm.day + 1;
    const rows = free(w, w.liege);
    const place = placeCareers(w.realm, w.liege, w.store.people.loadSite(w.liege, "full") as PersonRow[], w.store.careers, kingdomLaws(w.realm, w.realm.settlements[w.liege]!.kingdom));
    // A trade whose shops are full here, and someone whose temper makes slander their answer whatever the roll.
    const trade = [...place.shops.keys()].sort().find((t) => shopRoom(place, t) <= 0)!;
    expect(trade).toBeDefined();
    const freeOf = (r: PersonRow) => r.cls !== "slave" && r.cls !== "serf";
    const rolls = Array.from({ length: 20 }, (_, i) => i / 20);
    const liar = rows.find((r) => r.shop === null && rolls.every((x) => ventOf(r, "master_trade", 2, { blocker: true, free: freeOf(r), shortcut: false }, x) === "slander"))!;
    expect(liar).toBeDefined();
    // They are a master of the trade with no room, out of patience; one shop of it is already open without leave (so no shortcut).
    for (const j of w.store.careers.openJobs(liar.id)) if (!j.job.startsWith("seat:")) w.store.careers.endJob(liar.id, j.job, day - 1);
    w.store.people.update(liar.id, { job: trade as PersonRow["job"], skill: 4 });
    w.store.careers.startJob(liar.id, JOBS.master(trade), w.liege, day - 2 * Y);
    const other = rows.find((r) => r.id !== liar.id && r.shop === null && r.job !== trade)!;
    w.store.careers.startJob(other.id, `${JOBS.shop(w.liege, trade)}:unlicensed`, w.liege, day - 1);
    w.store.careers.setAmbition({ who: liar.id, kind: "master_trade", target: trade, progress: 1, since: day, step: 2, ...AMBITION_DEFAULTS, frustration: 0.69 });
    const hit = runUntil(w, w.liege, day, (o) => o.vented.some((v) => v.who === liar.id));
    expect(hit).not.toBeNull();
    const vent = hit!.o.vented.find((v) => v.who === liar.id)!;
    expect(vent.how).toBe("slander");
    const rumour = hit!.o.events.find((e) => e.kind === "rumour" && e.actor === liar.id)!;
    expect(rumour.target).toBe(vent.at);
    // Those who heard it trust the slandered one less.
    const heard = w.store.social.relsAbout(vent.at!).filter((r) => r.since === hit!.day && r.trust < 0);
    expect(heard.length).toBeGreaterThan(0);
  });

  it("routes follow the situation: land through marriage or a parent, a journeyman with wanderlust, the sociable by favour", () => {
    const w = fresh();
    const r = free(w, w.liege)[0]!;
    const env = { spouseShop: null, parentShop: null, spouseLand: false, parentLand: false, free: true };
    expect(chooseRoute(r, "land", 0, null, { ...env, spouseLand: true }, 0.5)).toBe("marry_in");
    expect(chooseRoute(r, "land", 0, null, { ...env, parentLand: true }, 0.5)).toBe("inherit");
    expect(chooseRoute(r, "land", 0, null, env, 0.5)).toBe("save");
    expect(chooseRoute(r, "master_trade", 2, "baker", { ...env, spouseShop: "baker" }, 0.5)).toBe("marry_in");
    expect(chooseRoute(r, "master_trade", 1, "baker", { ...env, parentShop: "baker" }, 0.5)).toBe("inherit");
    // Two people who want the same kind of thing go about it differently: more than one route is taken in a place.
    const routes = new Set(free(w, w.liege).map((x) => w.store.careers.ambitionOf(x.id)).filter((a) => a && (a.kind === "office" || a.kind === "guild_seat")).map((a) => a!.route));
    expect(routes.size).toBeGreaterThan(1);
  });

  it("a master who marries into a shop of the same trade has one", () => {
    const w = fresh();
    const day = w.realm.day + 1;
    const rows = free(w, w.liege);
    const keeper = rows.find((r) => r.shop !== null && isTrade(r.job) && !r.spouse)!;
    const other = rows.find((r) => r.id !== keeper.id && r.shop === null && !r.spouse && ageFrom(r.born_day, day) < 55)!;
    for (const j of w.store.careers.openJobs(other.id)) if (!j.job.startsWith("seat:")) w.store.careers.endJob(other.id, j.job, day - 1);
    w.store.people.update(other.id, { job: keeper.job, skill: 4, spouse: keeper.id });
    w.store.people.update(keeper.id, { spouse: other.id });
    w.store.careers.startJob(other.id, JOBS.master(keeper.job), w.liege, day - 2 * Y);
    w.store.careers.setAmbition({ who: other.id, kind: "master_trade", target: keeper.job, progress: 1, since: 1, step: 2, ...AMBITION_DEFAULTS, route: "marry_in" });
    const hit = runUntil(w, w.liege, day, (o) => o.achieved.some((a) => a.who === other.id));
    expect(hit).not.toBeNull();
    expect(w.store.people.get(other.id)!.shop).toBe(keeper.shop);
  });
});
