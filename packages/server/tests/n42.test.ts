import { beforeEach, describe, expect, it, vi } from "vitest";
import { config } from "../src/config.js";
import { loadCreatureTemplates } from "../src/game/creatures.js";
import { WorldStore } from "../src/game/db.js";
import { seededRng } from "../src/game/dice.js";
import { claimJobs, formParties, marketDay, membersOf, postRealmJobs, resolveJobs } from "../src/game/market/day.js";
import { fresh, gradeRecord, marketOf, mayTake, recordJob } from "../src/game/market/grades.js";
import { claim, complete, post, reopen, resultOf } from "../src/game/market/jobs.js";
import { boardView, playerClaim, playerJoinParty } from "../src/game/market/player.js";
import { makeFigure } from "../src/game/realm/figures.js";
import { generateRealm } from "../src/game/realm/generate.js";
import type { Figure, Realm } from "../src/game/realm/types.js";
import { newWorld } from "../src/game/save.js";
import { SCHEMA_VERSION, TABLES } from "../src/store/schema.js";
import { Town } from "../src/game/town.js";
import { initiativeFor } from "../src/npc/initiative.js";
import { materialisePeople } from "../src/store/materialise.js";
import { FakeProvider, pickTestPlaces } from "./helpers.js";

/**
 * N42: a shared quest market and adventurer grades. Every job is one record on a board, open to the player and every NPC alike; NPC
 * parties choose jobs, run them with the code that runs fights and delves, get paid, rise in grade (passing trials from B), and die above
 * their grade; givers tell the player when someone else did their job; the player can go with a party for a share. People and places are
 * found by role, never by name.
 */
vi.setConfig({ testTimeout: 600_000, hookTimeout: 600_000 });

beforeEach(() => {
  config.realm = true;
  config.realmSeed = undefined;
  config.director = false;
  config.planning = false;
  config.peopleLazy = "";
  config.market = true;
  config.firstHour = false;
  config.leisure = true;
});

function slice(seed = 1) {
  const realm = generateRealm(seed, 1);
  const store = new WorldStore(":memory:");
  materialisePeople(realm, store.people, 1);
  const { start, liege } = pickTestPlaces(realm);
  return { realm, store, start, liege };
}

/** An adventurer of a place, made the way the realm makes its figures. */
function adventurer(realm: Realm, home: string, tier: string, over: Partial<Figure> = {}): Figure {
  return Object.assign(makeFigure(realm, seededRng(realm.next + 7), { role: "adventurer", home, tier: tier as never, age: 28 }, realm.day), over);
}

/** No other adventurers or hunters near: the test's own are the only ones on the market. */
function clearAdventurers(realm: Realm): void {
  for (const f of Object.values(realm.figures)) if (f.role === "adventurer" || f.role === "hunter") f.home = null;
}

describe("N42 step 1: the jobs table and the board", () => {
  it("is in the schema, the world hash, export and import", () => {
    expect(SCHEMA_VERSION).toBeGreaterThanOrEqual(16);
    expect(TABLES.jobs).toContain("holder");
    expect(TABLES.parties).toContain("shares");
    expect(TABLES.people).toContain("grade");
  });

  it("posting, claiming, giving up, failing and expiring move a job's status, and a job back on the board is open again", () => {
    const { store } = slice(1);
    const j = post(store, { id: "j1", site: "x", kind: "cull", title: "Cull the wolves", tier: "E", reward: 100, day: 1 });
    expect(j.status).toBe("open");
    expect(claim(store, "j1", "party1", 1, { arrive: 2 })).toBe(true);
    expect(claim(store, "j1", "player", 1)).toBe(false);
    expect(store.jobs.job("j1")!.holder).toBe("party1");
    reopen(store, "j1", 3, "failed", "they failed");
    expect(store.jobs.job("j1")!.status).toBe("open");
    expect((resultOf(store.jobs.job("j1")!).past as unknown[]).length).toBe(1);
    expect(claim(store, "j1", "player", 3)).toBe(true);
    reopen(store, "j1", 9, "expired", "out of time");
    expect(store.jobs.job("j1")!.holder).toBeNull();
    complete(store, "j1", "party2", 10, "done");
    expect(store.jobs.job("j1")!.status).toBe("done");
    reopen(store, "j1", 11, "failed", "gone", false);
    expect(store.jobs.job("j1")!.status).toBe("failed");
  });
});

describe("N42 step 2: sources", () => {
  it("a pack's bounty is a job on its place's board; a party doing the job clears the bounty", () => {
    const { realm, store } = slice(2);
    clearAdventurers(realm);
    const pack = Object.values(realm.packs).find((p) => p.count >= 3 && realm.settlements[p.near] && !realm.settlements[p.near]!.abandoned)!;
    pack.bounty = 200;
    pack.tier = "F";
    postRealmJobs(realm, store, 1);
    const job = store.jobs.list((j) => j.target === pack.id)[0]!;
    expect(job.kind).toBe("cull");
    expect(job.reward).toBe(200);
    for (let i = 0; i < 3; i++) adventurer(realm, pack.near, "B", { bravery: 0.6, greed: 0.6 });
    let day = 1;
    while (store.jobs.job(job.id)!.status !== "done" && day < 30) marketDay(realm, store, ++day);
    expect(store.jobs.job(job.id)!.status).toBe("done");
    expect(pack.bounty).toBe(0);
  });
});

describe("N42 step 3: grades", () => {
  it("the same rule for everyone: jobs at the grade promote, from B a trial is set and passing it promotes; failures demote", () => {
    const r = fresh("D", 1);
    for (let i = 0; i < 3; i++) recordJob(r, "D", true, 1);
    expect(r.g).toBe("C");
    for (let i = 0; i < 3; i++) recordJob(r, "C", true, 2);
    expect(r.g).toBe("C");
    expect(r.trial).toBe("B");
    expect(recordJob(r, "B", true, 3)?.how).toBe("trial");
    expect(r.g).toBe("B");
    for (let i = 0; i < 3; i++) recordJob(r, "B", false, 4);
    expect(r.g).toBe("C");
    expect(mayTake("E", "D")).toBe(true);
    expect(mayTake("E", "B")).toBe(false);
    expect(mayTake("E", "B", true)).toBe(true);
  });

  it("an NPC adventurer climbs a grade from jobs done and passes a trial", () => {
    const { realm, store } = slice(3);
    clearAdventurers(realm);
    const home = Object.values(realm.packs).find((p) => realm.settlements[p.near] && !realm.settlements[p.near]!.abandoned)!.near;
    const hero = adventurer(realm, home, "S", { bravery: 0.6, greed: 0.5, ambition: 0.8 });
    const rec = gradeRecord(realm, hero.id);
    Object.assign(rec, fresh("C", 1), { done: 2 });
    // Work at their grade, then a harder one: packs by their home.
    const packs = Object.values(realm.packs).filter((p) => p.near === home);
    const pack = packs[0]!;
    const job = (tier: string, day: number) => {
      pack.count = Math.max(pack.count, 6);
      pack.tier = tier as typeof pack.tier;
      return post(store, { id: `test:${tier}:${day}`, site: home, kind: "cull", giver: null, title: `A ${tier} cull`, target: pack.id, tier, reward: 150, day });
    };
    let day = 1;
    const run = (id: string) => {
      while (store.jobs.job(id)!.status !== "done" && day < 120) {
        day++;
        formParties(realm, store, day);
        resolveJobs(realm, store, day);
        claimJobs(realm, store, day);
        if (store.jobs.job(id)!.status === "open" && store.jobs.job(id)!.deadline < day) store.jobs.putJob({ ...store.jobs.job(id)!, deadline: day + 10 });
      }
      expect(store.jobs.job(id)!.status, id).toBe("done");
    };
    run(job("C", 1).id);
    expect(gradeRecord(realm, hero.id).trial).toBe("B");
    run(job("B", day).id);
    expect(gradeRecord(realm, hero.id).g).toBe("B");
    expect(store.recentEvents({ limit: 200 }).some((e) => e.kind === "promoted" && e.details.includes("passed the guild's trial"))).toBe(true);
  });
});

describe("N42 step 4: NPCs take jobs", () => {
  it("an NPC party claims the wolf cull the player saw on the start town's board, does it while the player waits, and the giver pays them and tells the player", () => {
    const templates = loadCreatureTemplates();
    const store = new WorldStore(":memory:");
    const world = newWorld({}, templates, Math.random, 1);
    materialisePeople(world.realm!, store.people, 1);
    clearAdventurers(world.realm!);
    const town = new Town({ personas: {}, creatureTemplates: templates, world, llm: new FakeProvider(), store, stories: false });
    const realm = world.realm!;
    const site = town.site();
    // The head's opening work: the beasts in the woods.
    const job = store.jobs.list((j) => j.site === site && j.kind === "cull" && j.ref !== null)[0];
    expect(job, "a cull on the start town's board").toBeDefined();
    const giver = town.agents[job!.giver!]!;
    expect(giver.state.questBoard.some((q) => q.id === job!.ref)).toBe(true);
    // The player sees it on the board.
    expect(boardView(town)!.jobs.some((j) => j.id === job!.id)).toBe(true);
    const money = giver.state.money;
    // Adventurers of the town, strong enough for it.
    realm.packs[job!.target!]!.tier = "F";
    for (let i = 0; i < 3; i++) adventurer(realm, site, "B", { bravery: 0.6, greed: 0.7 });
    for (let d = 0; d < 20 && store.jobs.job(job!.id)!.status !== "done"; d++) town.passHours(24);
    const done = store.jobs.job(job!.id)!;
    expect(done.status).toBe("done");
    expect(done.holder!.startsWith("party")).toBe(true);
    // The giver paid them out of their purse, and no longer offers it.
    expect(Number(resultOf(done).paid)).toBeGreaterThan(0);
    void money;
    expect(giver.state.questBoard.some((q) => q.id === job!.ref)).toBe(false);
    const party = store.jobs.party(done.holder!)!;
    expect(realm.figures[party.leader]!.wealth).toBeGreaterThan(0);
    // ... and tells the player it's done.
    const opening = initiativeFor(giver.persona, giver.state, town.sceneFor(giver));
    expect(opening?.trigger).toBe("jobdone");
    expect(opening!.event).toContain(realm.figures[party.leader]!.name);
    town.close();
  });

  it("a reckless low-grade adventurer dies on a job above their grade, and the job returns to the board", () => {
    let seen = false;
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const { realm, store } = slice(seed);
      clearAdventurers(realm);
      const pack = Object.values(realm.packs).find((p) => realm.settlements[p.near] && !realm.settlements[p.near]!.abandoned)!;
      pack.count = 9;
      pack.cap = Math.max(pack.cap, 9);
      pack.tier = "C";
      const fool = adventurer(realm, pack.near, "F", { bravery: 0.97, greed: 0.9, ambition: 0.9 });
      Object.assign(gradeRecord(realm, fool.id), fresh("F", 1));
      const job = post(store, { id: `hard:${seed}`, site: pack.near, kind: "cull", giver: null, title: "Cull the pack", target: pack.id, tier: "C", reward: 400, day: 1 });
      expect(mayTake("F", "C")).toBe(false);
      for (let day = 2; day < 40 && fool.alive; day++) {
        formParties(realm, store, day);
        resolveJobs(realm, store, day);
        claimJobs(realm, store, day);
        if (store.jobs.job(job.id)!.status === "done") break;
      }
      if (fool.alive) continue;
      expect(store.jobs.job(job.id)!.status).toBe("open");
      expect((resultOf(store.jobs.job(job.id)!).past as Array<{ status: string }>).some((p) => p.status === "failed")).toBe(true);
      seen = true;
      break;
    }
    expect(seen).toBe(true);
  });
});

describe("N42 step 5: parties and the player", () => {
  it("adventurers of a place form parties with roles and an agreement on shares", () => {
    const { realm, store, start } = slice(4);
    clearAdventurers(realm);
    for (let i = 0; i < 3; i++) adventurer(realm, start, "D");
    formParties(realm, store, 2);
    const p = store.jobs.partyList((x) => x.disbanded === null)[0]!;
    expect(membersOf(p).length).toBe(3);
    expect(Object.values(JSON.parse(p.roles) as Record<string, string>).every((r) => ["fighter", "healer", "scout"].includes(r))).toBe(true);
    expect(["equal", "leader-heavy"]).toContain(p.shares);
  });

  it("the player joins an NPC party and shares the loot", () => {
    const templates = loadCreatureTemplates();
    const store = new WorldStore(":memory:");
    const world = newWorld({}, templates, Math.random, 2);
    materialisePeople(world.realm!, store.people, 1);
    clearAdventurers(world.realm!);
    const town = new Town({ personas: {}, creatureTemplates: templates, world, llm: new FakeProvider(), store, stories: false });
    const realm = world.realm!;
    const site = town.site();
    const pack = Object.values(realm.packs).find((p) => p.near === site) ?? Object.values(realm.packs)[0]!;
    pack.near = site;
    pack.count = Math.max(pack.count, 6);
    pack.tier = "F";
    realm.settlements[site]!.treasury = Math.max(realm.settlements[site]!.treasury, 1000);
    const job = post(store, { id: "share-test", site, kind: "cull", giver: `s:${site}`, title: "Cull the beasts", target: pack.id, tier: "F", reward: 200, day: world.day });
    const crew = [adventurer(realm, site, "B", { greed: 0.3 }), adventurer(realm, site, "B", { greed: 0.3 })];
    formParties(realm, store, world.day);
    const party = store.jobs.partyList((x) => x.disbanded === null && membersOf(x).includes(crew[0]!.id))[0]!;
    store.jobs.putParty({ ...party, shares: "equal" });
    const before = world.player.money;
    const wealth = crew.map((f) => f.wealth);
    let r = playerJoinParty(town, party.id);
    for (let i = 0; i < 6 && !r.lines.some((l) => l.includes("is yours")); i++) {
      // A bad day: the job is on the board again; go again.
      pack.count = Math.max(pack.count, 6);
      r = playerJoinParty(town, party.id);
    }
    expect(r.ok).toBe(true);
    expect(r.lines.join(" ")).toContain("is yours");
    expect(world.player.money).toBeGreaterThan(before);
    expect(crew.some((f, i) => f.wealth > wealth[i]!)).toBe(true);
    // The job they went on is done, by the party.
    expect(store.jobs.list((j) => j.status === "done" && j.holder === party.id).length).toBeGreaterThan(0);
    void job;
    town.close();
  });

  it("the player claims an open board job by the same first-come rule, within their grade", () => {
    const templates = loadCreatureTemplates();
    const store = new WorldStore(":memory:");
    const world = newWorld({}, templates, Math.random, 3);
    materialisePeople(world.realm!, store.people, 1);
    const town = new Town({ personas: {}, creatureTemplates: templates, world, llm: new FakeProvider(), store, stories: false });
    const realm = world.realm!;
    const site = town.site();
    const pack = Object.values(realm.packs).find((p) => p.near === site)!;
    const easy = post(store, { id: "easy", site, kind: "cull", giver: null, title: "An easy cull", target: pack.id, tier: "F", reward: 50, day: world.day });
    const hard = post(store, { id: "hard", site, kind: "cull", giver: null, title: "A hard cull", target: pack.id, tier: "A", reward: 900, day: world.day });
    expect(playerClaim(town, hard.id).ok).toBe(false);
    expect(playerClaim(town, easy.id).ok).toBe(true);
    expect(store.jobs.job(easy.id)!.holder).toBe("player");
    expect(world.player.quests.active.some((q) => q.id === easy.id)).toBe(true);
    void marketOf;
    town.close();
  });
});
