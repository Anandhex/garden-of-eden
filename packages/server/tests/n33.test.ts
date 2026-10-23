import { CLASS_RANK, type SocialClass } from "@millbrook/shared";
/**
 * N33: gossip for everyone. Every person keeps a short list of what they know (a row per item, how accurate their version is, who told
 * them); people who are together pass items on; news enters a place only by someone arriving with it; and a townsperson who becomes a
 * talker starts with what they knew. Ids and places are found by role, never by name (plans README section 12).
 */
import { days } from "./long.js";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { config } from "../src/config.js";
import { WorldStore } from "../src/game/db.js";
import { gossipOverview, knowersOf } from "../src/admin/gossip.js";
import { card } from "../src/admin/person.js";
import type { AdminContext } from "../src/admin/context.js";
import { checkGossipBounds } from "../src/game/gossip/bounds.js";
import { describeKnown, fieldOf, fieldsOf, variantOf } from "../src/game/gossip/describe.js";
import { KNOWLEDGE_CAP, learn, retell, tellable, tellables } from "../src/game/gossip/knowledge.js";
import { meetAtStop } from "../src/game/gossip/meet.js";
import { deathRef, newsRef, parseRef } from "../src/game/gossip/refs.js";
import { seedDay } from "../src/game/gossip/seed.js";
import { spreadSite } from "../src/game/gossip/spread.js";
import { absorbKnowledge, shareLore } from "../src/game/gossip/talkers.js";
import { worldHash } from "../src/game/hash.js";
import { knownEntry, knownRefs, KNOWN_MAX, playerKnows, playerLearns } from "../src/game/playerKnowledge.js";
import type { DeathRecord } from "../src/game/people/death.js";
import { liveSites } from "../src/game/people/live.js";
import { advanceWorld, settle } from "../src/game/people/world.js";
import type { LifeCtx, SiteStep } from "../src/game/people/step.js";
import { generateRealm } from "../src/game/realm/generate.js";
import { realmNews } from "../src/game/realm/log.js";
import { TAX_DAYS } from "../src/game/realm/politics.js";
import { pickStartSite } from "../src/game/realm/start.js";
import { journeysOf } from "../src/game/road/journeys.js";
import { TRIPS } from "../src/game/road/trips/config.js";
import { rumourToShare, shareRumour } from "../src/game/rumours.js";
import { loadCreatureTemplates } from "../src/game/creatures.js";
import { loadWorld, newWorld, SAVE_VERSION, saveWorld } from "../src/game/save.js";
import { Town } from "../src/game/town.js";
import type { NpcState, PlayerState } from "../src/npc/types.js";
import { materialisePeople } from "../src/store/materialise.js";
import { applySchema, SCHEMA_VERSION } from "../src/store/schema.js";
import type { PersonRow } from "../src/store/peopleStore.js";
import { siteMap } from "../src/web/sites.js";
import { always, FakeProvider, pickTestPerson, pickTestPlaces } from "./helpers.js";

vi.setConfig({ testTimeout: 240_000 });
const slack = () => Number(process.env.PERF_SLACK ?? 1);
const trips = { ...Object.fromEntries(Object.entries(TRIPS).map(([k, v]) => [k, v.cap])) } as Record<string, number>;

beforeEach(() => {
  config.peopleLazy = "";
  config.gossip = true;
  config.realm = true;
  config.realmSeed = undefined;
  for (const k of Object.keys(TRIPS)) (TRIPS as Record<string, { cap: number }>)[k]!.cap = trips[k]!;
});

function world(seed = 1, spec = "all") {
  const realm = generateRealm(seed, 1);
  const store = new WorldStore(":memory:");
  materialisePeople(realm, store.people, 1);
  const live = liveSites(realm, pickStartSite(realm, realm.seed), spec);
  const ctx: LifeCtx = { realm, store };
  return { realm, store, live, ctx, ...pickTestPlaces(realm) };
}

const noRoads = () => {
  for (const k of Object.keys(TRIPS)) (TRIPS as Record<string, { cap: number }>)[k]!.cap = 0;
};

const stepOf = (site: string, day: number, deaths: SiteStep["deaths"] = []): SiteStep => ({ site, day, alive: 0, births: [], deaths, marriages: [], grownUp: [], events: [] });

/** Kill someone of a place today, as a day's step would (the row's death record and the step's passing), and let the place take it in. */
function killAt(w: ReturnType<typeof world>, site: string, day: number, index = 3) {
  const rows = (w.store.people.loadSite(site, "full") as PersonRow[]).filter((r) => r.job !== "child" && r.persona === null && !r.away);
  const dead = rows[index]!;
  const record: DeathRecord = { cause: "illness", day, hour: 9, site };
  w.store.people.update(dead.id, { death: JSON.stringify(record) });
  seedDay(w.ctx, stepOf(site, day, [{ id: dead.id, name: dead.name, persona: null, figure: null, record }]), day);
  return { dead, ref: deathRef(dead.id) };
}

const holdersAt = (w: ReturnType<typeof world>, ref: string, site: string) => w.store.knowledge.holders(ref).filter((r) => w.store.people.get(r.who)!.site === site);

describe("N33 step 0: what the player knows (N24 step 1)", () => {
  const player = () => ({ name: "Tester" }) as PlayerState;

  it("the player knows only what they learned, and a better version replaces a worse one", () => {
    const p = player();
    expect(playerKnows(p, "n:rn1")).toBe(false);
    expect(playerLearns(p, "n:rn1", "news", 4)).toBe(true);
    expect(playerKnows(p, "n:rn1")).toBe(true);
    expect(playerLearns(p, "n:rn1", "told", 6, { accuracy: 0.5 })).toBe(false);
    expect(knownEntry(p, "n:rn1")).toMatchObject({ day: 4, how: "news", accuracy: 1 });
    expect(playerLearns(p, "d:t_x_1", "told", 5, { from: "wenna", accuracy: 0.6, variant: 33, text: "Old Tam died" })).toBe(true);
    expect(playerLearns(p, "d:t_x_1", "told", 7, { from: "bert", accuracy: 0.9, variant: 0, text: "Tam died of an illness" })).toBe(true);
    expect(knownEntry(p, "d:t_x_1")).toMatchObject({ day: 5, from: "bert", variant: 0 });
    expect(knownRefs(p)).toEqual(["d:t_x_1", "n:rn1"]);
    expect(knownRefs(p, { sinceDay: 5 })).toEqual(["d:t_x_1"]);
  });

  it("the record is capped: the oldest go first", () => {
    const p = player();
    for (let i = 0; i < KNOWN_MAX + 20; i++) playerLearns(p, `n:rn${i}`, "news", i + 1);
    expect(Object.keys(p.known!).length).toBe(KNOWN_MAX);
    expect(playerKnows(p, "n:rn0")).toBe(false);
    expect(playerKnows(p, `n:rn${KNOWN_MAX + 19}`)).toBe(true);
  });
});

describe("N33 step 1: the record and the renderer", () => {
  it("a death renders true at accuracy 1 and wrong, the same way every time, at a changed variant", () => {
    const w = world(1);
    const { dead, ref } = killAt(w, w.start, 2);
    const truth = describeKnown(w.ctx, ref, 1, 0)!;
    expect(truth).toContain(dead.name);
    expect(truth).toContain("of an illness");
    const fields = fieldsOf(w.ctx, ref);
    expect(fields).toContain(4);
    const wrong = describeKnown(w.ctx, ref, 0.6, variantOf(4, 0))!;
    expect(wrong).not.toBe(truth);
    expect(wrong).toContain(dead.name);
    expect(describeKnown(w.ctx, ref, 0.6, variantOf(4, 0))).toBe(wrong);
    // The truth stays where it was: the record still says an illness.
    expect(describeKnown(w.ctx, ref, 1, 0)).toBe(truth);
    // Someone doubtful says so.
    expect(describeKnown(w.ctx, ref, 0.4, 0)).toContain("or so folk say");
  });

  it("news changes in the telling: the place, the number, the person", () => {
    const w = world(1);
    const town = Object.values(w.realm.settlements).find((s) => s.kind === "town" && s.roads.some((r) => !w.realm.settlements[r]!.way))!;
    realmNews(w.realm, 5, town.id, "raid", `Raiders took 6 head of cattle from ${town.name}.`, 5, [town.name]);
    const n = w.realm.news.at(-1)!;
    const ref = newsRef(n.id);
    expect(describeKnown(w.ctx, ref, 1, 0)).toBe(n.text);
    expect(fieldsOf(w.ctx, ref)).toEqual(expect.arrayContaining([2, 3]));
    const place = describeKnown(w.ctx, ref, 0.6, variantOf(2, 0))!;
    expect(place).not.toContain(town.name);
    const count = describeKnown(w.ctx, ref, 0.6, variantOf(3, 0))!;
    expect(count).not.toContain(" 6 ");
    expect(fieldOf(variantOf(3, 5))).toBe(3);
  });

  it("a retelling of something at accuracy 1 is never changed, and the chance of a change grows as it gets less accurate", () => {
    const w = world(1);
    const { ref } = killAt(w, w.start, 2);
    const row = (accuracy: number) => ({ ref, accuracy, variant: 0 });
    for (let i = 0; i < 200; i++) expect(retell(w.ctx, row(1), `x${i}`, 3, 0.9, () => 0.5)!.variant).toBe(0);
    let changed = 0;
    for (let i = 0; i < 200; i++) if (retell(w.ctx, row(0.5), `x${i}`, 3, 0.9)!.variant !== 0) changed++;
    expect(changed).toBeGreaterThan(40);
    expect(changed).toBeLessThan(160);
    // A change the teller made stays.
    expect(retell(w.ctx, { ref, accuracy: 0.7, variant: 37 }, "z", 3, 0.9)!.variant).toBe(37);
    // Too garbled to pass on.
    expect(retell(w.ctx, row(0.3), "z", 3, 0.9)).toBeNull();
  });

  it("a person holds at most 24 items: the ones worth most are kept", () => {
    const w = world(1);
    const who = pickTestPerson(w.store, w.start)!.id;
    // 30 news items of rising weight, all heard today.
    for (let i = 1; i <= 30; i++) realmNews(w.realm, 5, w.start, "event", `Event number ${i} in the realm.`, Math.min(10, 1 + (i % 10)), []);
    const refs = w.realm.news.slice(-30).map((n) => newsRef(n.id));
    for (const r of refs) learn(w.ctx, who, r, { day: 5, source: "saw", accuracy: 1 });
    const held = w.store.knowledge.rowsOf(who);
    expect(held.length).toBe(KNOWLEDGE_CAP);
    const worth = (r: string) => tellable(w.ctx, { ref: r, learned_day: 5 }, 5);
    const kept = new Set(held.map((r) => r.ref));
    const lost = refs.filter((r) => !kept.has(r));
    expect(lost.length).toBe(6);
    expect(Math.max(...lost.map(worth))).toBeLessThanOrEqual(Math.min(...held.map((r) => worth(r.ref))));
  });

  it("refs parse", () => {
    expect(parseRef("d:t_a_1")).toEqual({ kind: "d", id: "t_a_1" });
    expect(parseRef("n:rn4")).toEqual({ kind: "n", id: "rn4" });
    expect(parseRef("x:1")).toBeNull();
  });
});

describe("N33 step 2: venues and the daily spread", () => {
  it("a death is known to the family and the household at once, and by most of a small town within ten", () => {
    const w = world(1);
    advanceWorld(w.realm, w.store, 2, { live: w.live });
    const { ref } = killAt(w, w.start, 2);
    const people = w.store.people.livingCount(w.start);
    const first = holdersAt(w, ref, w.start);
    expect(first.length).toBeGreaterThanOrEqual(3);
    expect(first.every((r) => r.accuracy === 1 && r.source === "saw")).toBe(true);
    advanceWorld(w.realm, w.store, 4, { live: w.live });
    expect(holdersAt(w, ref, w.start).length / people).toBeGreaterThan(0.25);
    advanceWorld(w.realm, w.store, 10, { live: w.live });
    const later = holdersAt(w, ref, w.start);
    expect(later.length / people).toBeGreaterThan(0.6);
    // It gets less accurate as it is retold, and at least once is told wrong.
    expect(later.some((r) => r.accuracy < 1)).toBe(true);
    // No more than the cap.
    expect(Math.max(...later.map((r) => w.store.knowledge.countOf(r.who)))).toBeLessThanOrEqual(KNOWLEDGE_CAP);
  });

  it("the same seed gives the same gossip: the world hashes the same", () => {
    const run = () => {
      const w = world(1);
      advanceWorld(w.realm, w.store, 2, { live: w.live });
      killAt(w, w.start, 2);
      advanceWorld(w.realm, w.store, 8, { live: w.live });
      return worldHash(w.realm, w.store);
    };
    expect(run()).toBe(run());
  });

  it("gossip stays inside a place: nobody hears of a death in another place without a traveller", () => {
    noRoads();
    const w = world(2);
    advanceWorld(w.realm, w.store, 2, { live: w.live });
    const { ref } = killAt(w, w.start, 2);
    advanceWorld(w.realm, w.store, 14, { live: w.live });
    expect(w.store.knowledge.holders(ref).length).toBeGreaterThan(5);
    // Elsewhere it is known only by households that moved from the start town (they take what they know with them), and by whoever they told.
    const all = new Map(w.store.knowledge.holders(ref).map((r) => [r.who, r]));
    for (const r of all.values()) {
      if (w.store.people.get(r.who)!.site === w.start) continue;
      expect(r.who.startsWith(`t_${w.start}_`) || all.has(r.source)).toBe(true);
    }
  });

  it("a place worked out later gives the same gossip as one worked out on the day", () => {
    noRoads();
    const run = (lazy: boolean) => {
      const w = world(1);
      const start = w.start;
      advanceWorld(w.realm, w.store, 2, { live: w.live });
      config.peopleLazy = lazy ? start : "";
      killAt(w, start, 3);
      realmNews(w.realm, 4, start, "event", "A great fire burned the granary.", 6, []);
      advanceWorld(w.realm, w.store, 9, { live: w.live });
      if (lazy) settle(w.ctx, start, 9);
      const rows = w.store.dumpTable("knowledge").filter((r) => w.store.people.get(String(r.who))!.site === start);
      return JSON.stringify(rows);
    };
    const live = run(false);
    expect(live.length).toBeGreaterThan(10);
    expect(run(true)).toBe(live);
  });

  it("with gossip off nothing is learned", () => {
    config.gossip = false;
    const w = world(1);
    advanceWorld(w.realm, w.store, 6, { live: w.live });
    expect(w.store.knowledge.total()).toBe(0);
  });
});

describe("N33 step 4: news enters with people", () => {
  it("a death in the start town reaches someone in the liege town only after a traveller went between them, who told it", () => {
    // The death comes a few days before the first tax day, when the tax clerk goes up to the liege town (TAX_DAYS: 24 at 48 days a
    // year): news is told for TELL_WINDOW days after it is heard, so a death weeks before is stale by the time the clerk goes.
    const dies = TAX_DAYS - 4;
    // Someone of standing: their death is worth telling over the realm's other news of the day (whose freshness to the teller depends on
    // who met whom, which careers move: N40).
    const notable = (x: ReturnType<typeof world>) => {
      const rows = (x.store.people.loadSite(x.start, "full") as PersonRow[]).filter((r) => r.job !== "child" && r.persona === null && !r.away);
      const best = rows.reduce((b, r, i) => ((CLASS_RANK[r.cls as SocialClass] ?? 2) > (CLASS_RANK[rows[b]!.cls as SocialClass] ?? 2) ? i : b), 0);
      return best;
    };
    // With no one on the road it never arrives.
    noRoads();
    let w = world(2);
    advanceWorld(w.realm, w.store, dies, { live: w.live });
    let k = killAt(w, w.start, dies, notable(w));
    advanceWorld(w.realm, w.store, dies + 14, { live: w.live });
    expect(holdersAt(w, k.ref, w.liege)).toEqual([]);

    // With them it does, and every row there came from a person who had it before: a traveller of another place, or someone in the liege town who had it from one.
    for (const key of Object.keys(TRIPS)) (TRIPS as Record<string, { cap: number }>)[key]!.cap = trips[key]!;
    w = world(2);
    advanceWorld(w.realm, w.store, dies, { live: w.live });
    k = killAt(w, w.start, dies, notable(w));
    // Day by day: whoever learned it in the liege town that day was told by someone from elsewhere who is out on the road.
    let first: { day: number; rows: ReturnType<typeof holdersAt> } | null = null;
    for (let d = dies + 1; d <= dies + 12 && !first; d++) {
      advanceWorld(w.realm, w.store, d, { live: w.live });
      const rows = holdersAt(w, k.ref, w.liege);
      if (rows.length > 0) first = { day: d, rows };
    }
    expect(first).not.toBeNull();
    for (const r of first!.rows) {
      const teller = w.store.people.get(r.source)!;
      expect(r.learned_day).toBe(first!.day);
      // Someone of another place: a traveller (a short trip may be over by the end of the day).
      expect(teller.site).not.toBe(w.liege);
      expect(w.store.knowledge.get(teller.id, k.ref)!.learned_day).toBeLessThanOrEqual(first!.day);
    }
    // Before that day nobody in the liege town knew it; the start town had known it since the day it happened.
    expect(first!.day).toBeGreaterThan(dies);
    expect(holdersAt(w, k.ref, w.start).length).toBeGreaterThan(3);
    const bounds = checkGossipBounds(w.realm, w.store);
    expect(bounds.find((b) => b.name === "gossip-not-instant")!.ok).toBe(true);
  });

  it("a traveller tells what they heard, in their own version, and the people they meet hear it", () => {
    const w = world(1);
    advanceWorld(w.realm, w.store, 3, { live: w.live });
    // A traveller with nothing else to tell yet, so what they tell is this death (otherwise fresher news may come first).
    const firstRow = (x: ReturnType<typeof journeysOf>[number]) => x.party.find((t) => !w.realm.figures[t.person])?.person;
    const j = journeysOf(w.realm).find((x) => x.path.length >= 2 && firstRow(x) && tellables(w.ctx, firstRow(x)!, 3, x.path[1]).length === 0)!;
    const traveller = firstRow(j)!;
    const there = j.path[1]!;
    const { ref } = killAt(w, j.path[0]!, 3);
    learn(w.ctx, traveller, ref, { day: 3, source: "saw", accuracy: 0.8, variant: variantOf(4, 1) });
    const before = w.store.knowledge.holders(ref).filter((r) => w.store.people.get(r.who)!.site === there).length;
    // Several stops of the party in the same place (each meets other people).
    let moved = 0;
    for (let i = 0; i < 6; i++) moved += meetAtStop(w.ctx, j, there, 3000 + i, 5);
    const after = w.store.knowledge.holders(ref).filter((r) => w.store.people.get(r.who)!.site === there);
    expect(moved).toBeGreaterThan(0);
    expect(after.length).toBeGreaterThan(before);
    // They got the traveller's version (less accurate, the same changed detail).
    for (const r of after.filter((x) => x.source === traveller)) {
      expect(r.variant).toBe(variantOf(4, 1));
      expect(r.accuracy).toBeLessThan(0.8);
    }
  });

  it("the place still hears news as before, and the people know it only if someone told them", () => {
    const w = world(1);
    advanceWorld(w.realm, w.store, 3, { live: w.live });
    const origin = Object.values(w.realm.settlements).find((s) => s.kind === "village" && !s.way && !s.abandoned)!;
    realmNews(w.realm, w.realm.day, origin.id, "dungeon", `A bell rang in ${origin.name}.`, 6, [origin.name]);
    const n = w.realm.news.at(-1)!;
    advanceWorld(w.realm, w.store, w.realm.day + 1, { live: w.live });
    const inOrigin = w.store.knowledge.holders(newsRef(n.id)).filter((r) => w.store.people.get(r.who)!.site === origin.id);
    expect(inOrigin.length).toBeGreaterThan(0);
    // Everywhere it is known has a person who knows it (or a lone place with nobody: a waystation).
    advanceWorld(w.realm, w.store, w.realm.day + 14, { live: w.live });
    for (const [site, heard] of Object.entries(w.realm.heard)) {
      if (!heard[n.id] || site === origin.id || w.store.people.livingCount(site) < 5) continue;
      expect(w.store.knowledge.holders(newsRef(n.id)).some((r) => w.store.people.get(r.who)!.site === site)).toBe(true);
    }
  });
});

describe("N33 step 4b: great news", () => {
  it("a crown courier's news is known to people where it is cried, not only to the place", () => {
    const w = world(1);
    advanceWorld(w.realm, w.store, 6, { live: w.live });
    const capital = Object.values(w.realm.settlements).find((s) => s.kind === "capital" && !s.abandoned)!;
    realmNews(w.realm, w.realm.day, capital.id, "death", `The king of ${capital.name} is dead.`, 9, [capital.name]);
    const n = w.realm.news.at(-1)!;
    advanceWorld(w.realm, w.store, w.realm.day + 12, { live: w.live });
    const crier = journeysOf(w.realm).some((j) => j.kind === "courier" && j.carries?.some((c) => c.id === n.id));
    expect(crier).toBe(true);
    const places = Object.entries(w.realm.heard).filter(([site, h]) => h[n.id] && site !== capital.id && w.store.people.livingCount(site) >= 5);
    expect(places.length).toBeGreaterThan(3);
    const knowing = places.filter(([site]) => w.store.knowledge.holders(newsRef(n.id)).some((r) => w.store.people.get(r.who)!.site === site));
    expect(knowing.length).toBe(places.length);
  });
});

describe("N33 step 5: talkers and townsfolk are one gossip", () => {
  function townWith(seed: number) {
    const store = new WorldStore(":memory:");
    const templates = loadCreatureTemplates();
    const town = new Town({ personas: {}, creatureTemplates: templates, world: newWorld({}, templates, always(0.5), seed), llm: new FakeProvider(), store });
    return { town, store, realm: town.world.realm!, site: town.world.startSite };
  }

  it("a townsperson the player has never met tells the player a rumour, slightly wrong, and the player's record holds that version", () => {
    const { town, store, realm, site } = townWith(1);
    const ctx: LifeCtx = { realm, store };
    const roster = town.rosterAt(site, mapOf(town, site))!;
    // Someone who heard of a death third hand, with the detail changed.
    const dead = store.people.loadSite(site, "full").find((r) => r.job !== "child" && r.persona === null)!;
    const record: DeathRecord = { cause: "old-age", day: town.world.day, hour: 8, site };
    store.people.update(dead.id, { death: JSON.stringify(record) });
    const listener = (store.people.loadSite(site, "full") as PersonRow[]).find((r) => r.persona === null && r.job !== "child" && r.id !== dead.id)!;
    const teller = (store.people.loadSite(site, "full") as PersonRow[]).find((r) => r.persona === null && r.job !== "child" && r.id !== dead.id && r.id !== listener.id)!;
    const variant = variantOf(4, 0);
    learn(ctx, teller.id, deathRef(dead.id), { day: town.world.day, source: "saw", accuracy: 1 });
    learn(ctx, listener.id, deathRef(dead.id), { day: town.world.day, source: teller.id, accuracy: 0.72, variant });
    const person = roster.people.find((p) => p.id === listener.id)!;
    expect(town.personas[listener.id]).toBeUndefined();
    const id = town.meetTownsperson(roster, person)!;
    const state = town.agents[id]!.state;
    const heard = Object.values(state.rumours).find((r) => r.ref === deathRef(dead.id))!;
    expect(heard).toBeDefined();
    expect(heard.accuracy).toBeLessThan(1);
    expect(heard.variant).not.toBe(0);
    expect(heard.text).toBe(describeKnown(ctx, deathRef(dead.id), 0.72, variant));
    expect(heard.text).not.toBe(describeKnown(ctx, deathRef(dead.id), 1, 0));
    // The player asks what folk are saying.
    const player = { name: "Tester", journal: [] } as unknown as PlayerState;
    const rumour = rumourToShare(state, "Any news? What's the talk?", {}, true)!;
    expect(rumour).toBe(heard);
    shareRumour(town.personas[id]!, state, rumour, player, {}, town.world.day);
    const known = player.known![deathRef(dead.id)]!;
    expect(known.how).toBe("told");
    expect(known.from).toBe(id);
    expect(known.variant).toBe(variant);
    expect(known.accuracy).toBeLessThan(1);
    expect(known.text).toBe(heard.text);
    expect(player.journal!.some((j) => j.text.includes(heard.text))).toBe(true);
  });

  it("a talker with a row tells news straight if they heard it straight, and what a talker learned goes back to their row", () => {
    const { town, store, realm, site } = townWith(1);
    const ctx: LifeCtx = { realm, store };
    realmNews(realm, town.world.day, site, "event", "A bell rang at the temple.", 6, []);
    const n = realm.news.at(-1)!;
    const roster = town.rosterAt(site, mapOf(town, site))!;
    const row = (store.people.loadSite(site, "full") as PersonRow[]).find((r) => r.persona === null && r.job !== "child")!;
    learn(ctx, row.id, newsRef(n.id), { day: town.world.day, source: "saw", accuracy: 1 });
    const id = town.meetTownsperson(roster, roster.people.find((p) => p.id === row.id)!)!;
    const state = town.agents[id]!.state;
    expect(state.learned[`realm.${n.id}`]).toBe("certain");
    // Something the talker learns by other means is written to their row.
    realmNews(realm, town.world.day, site, "event", "The miller wed.", 5, []);
    const m = realm.news.at(-1)!;
    town.learnNews(state, m, "rumour");
    expect(store.knowledge.has(id, newsRef(m.id))).toBe(false);
    town.syncTalker(id);
    expect(store.knowledge.get(id, newsRef(m.id))).toMatchObject({ accuracy: 0.7, source: "saw" });
  });

  it("absorb and share are idempotent", () => {
    const w = world(1);
    const who = pickTestPerson(w.store, w.start)!.id;
    realmNews(w.realm, 1, w.start, "event", "Something happened.", 6, []);
    const ref = newsRef(w.realm.news.at(-1)!.id);
    learn(w.ctx, who, ref, { day: 1, source: "saw", accuracy: 1 });
    const state = { learned: {}, rumours: {} } as unknown as NpcState;
    const hooks = { news: (_n: unknown, c: string) => void (state.learned[`realm.${w.realm.news.at(-1)!.id}`] = c as "certain") };
    expect(absorbKnowledge(w.ctx, who, state, 2, hooks as never)).toBe(1);
    expect(absorbKnowledge(w.ctx, who, state, 2, hooks as never)).toBe(0);
    expect(shareLore(w.ctx, who, state, 2)).toBe(0);
  });

  it("the place the player is in talks hour by hour while time passes, and says what is told", () => {
    const { town, store, realm, site } = townWith(1);
    town.passHours(24);
    const { ref } = killAt({ realm, store, ctx: { realm, store }, start: site, live: new Set([site]), liege: site } as ReturnType<typeof world>, site, town.world.day);
    expect(store.knowledge.holders(ref).length).toBeGreaterThan(2);
    town.passHours(10);
    expect(town.toldHere.length).toBeGreaterThan(0);
    const t = town.toldHere.at(-1)!;
    expect(t.site).toBe(site);
    expect(t.text.length).toBeGreaterThan(5);
    expect(store.knowledge.has(t.listener, t.ref)).toBe(true);
  });
});

function mapOf(town: Town, site: string) {
  const realm = town.world.realm!;
  return siteMap(realm.settlements[site]!, "village", realm);
}

describe("N33 step 3: an hour of gossip in a big place", () => {
  it("3,000 people gossip for an hour in a few milliseconds", () => {
    const w = world(1);
    // The biggest place there is, grown to 3,000 people if it needs it.
    const site = Object.values(w.realm.settlements).sort((a, b) => w.store.people.livingCount(b.id) - w.store.people.livingCount(a.id))[0]!.id;
    expect(w.store.people.livingCount(site)).toBeGreaterThanOrEqual(3000);
    const rows = (w.store.people.loadSite(site, "full") as PersonRow[]).filter((r) => !r.away);
    // A tenth of them know a handful of things.
    for (let i = 0; i < 20; i++) realmNews(w.realm, 3, site, "event", `Event ${i} in the capital.`, 6, []);
    const refs = w.realm.news.slice(-20).map((n) => newsRef(n.id));
    for (const [i, r] of rows.entries()) if (i % 10 === 0) for (let k = 0; k < 5; k++) learn(w.ctx, r.id, refs[(i + k) % refs.length]!, { day: 3, source: "saw", accuracy: 1 });
    spreadSite(w.ctx, site, 3, { hour: 19 });
    const ms: number[] = [];
    for (let h = 0; h < 15; h++) {
      const t = performance.now();
      spreadSite(w.ctx, site, 3, { hour: 8 + h });
      ms.push(performance.now() - t);
    }
    ms.sort((a, b) => a - b);
    const median = ms[Math.floor(ms.length / 2)]!;
    expect(median).toBeLessThan(5 * slack());
  });
});

describe("N33 balance bounds", () => {
  it("knowledge is bounded and nothing is told before the teller knew it, over a long run", () => {
    const w = world(1);
    advanceWorld(w.realm, w.store, 2, { live: w.live });
    killAt(w, w.start, 2);
    advanceWorld(w.realm, w.store, days(30, 15), { live: w.live });
    for (const b of checkGossipBounds(w.realm, w.store)) expect(b.ok, `${b.name}: ${b.detail}`).toBe(true);
    expect(w.store.knowledge.total()).toBeGreaterThan(100);
  });
});

describe("N33 the database", () => {
  it("a schema 5 database gains knowledge.variant, keeping its rows", () => {
    const db = new DatabaseSync(":memory:");
    applySchema(db, false);
    db.exec("INSERT INTO knowledge (who, ref, learned_day, source, accuracy, variant) VALUES ('a', 'n:rn1', 3, 'saw', 1, 0)");
    db.exec("ALTER TABLE knowledge DROP COLUMN variant");
    db.exec("PRAGMA user_version = 5");
    applySchema(db, false);
    const row = db.prepare("SELECT * FROM knowledge").get() as Record<string, unknown>;
    expect(row).toMatchObject({ who: "a", ref: "n:rn1", variant: 0 });
    expect(Number((db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version)).toBe(SCHEMA_VERSION);
  });
});

describe("N33 the save", () => {
  it("a v14 save loads, and the player knows nothing yet; what they learn survives a save", () => {
    const templates = loadCreatureTemplates();
    const w = newWorld({}, templates, always(0.5), 3);
    const file = join(mkdtempSync(join(tmpdir(), "n33-")), "world.json");
    saveWorld(file, w);
    const doc = JSON.parse(readFileSync(file, "utf8")) as { version: number; player: { known?: unknown } };
    expect(doc.version).toBe(SAVE_VERSION);
    // As a v14 file had it: no `known`.
    doc.version = 14;
    delete doc.player.known;
    writeFileSync(file, JSON.stringify(doc));
    const back = loadWorld(file, {}, templates);
    expect(back.version).toBe(SAVE_VERSION);
    expect(back.player.known).toEqual({});
    playerLearns(back.player, "n:rn7", "told", 5, { from: "x", accuracy: 0.7, variant: variantOf(2, 1), text: "A fire." });
    saveWorld(file, back);
    const again = loadWorld(file, {}, templates);
    expect(knownEntry(again.player, "n:rn7")).toMatchObject({ day: 5, how: "told", accuracy: 0.7, variant: variantOf(2, 1), text: "A fire." });
  });
});

describe("N33 the admin view", () => {
  it("a person's card says what they know, with the truth beside a wrong version, and reading it changes nothing", () => {
    const store = new WorldStore(":memory:");
    const templates = loadCreatureTemplates();
    const town = new Town({ personas: {}, creatureTemplates: templates, world: newWorld({}, templates, always(0.5), 1), llm: new FakeProvider(), store });
    const site = town.world.startSite;
    const realm = town.world.realm!;
    const ctx: AdminContext = { world: () => town.world, town: () => town, store, queueLength: () => 0 };
    town.rosterAt(site, mapOf(town, site));
    const rows = (store.people.loadSite(site, "full") as PersonRow[]).filter((r) => r.job !== "child" && r.persona === null);
    const dead = rows[0]!;
    const record: DeathRecord = { cause: "old-age", day: town.world.day, hour: 7, site };
    store.people.update(dead.id, { death: JSON.stringify(record) });
    const listener = rows[1]!;
    const life: LifeCtx = { realm, store };
    learn(life, listener.id, deathRef(dead.id), { day: town.world.day, source: rows[2]!.id, accuracy: 0.6, variant: variantOf(4, 0) });
    const before = worldHash(town.world, store);
    const c = card(ctx, `town:${listener.id}`)!;
    const knows = c.sections.find((s) => s.title === "Knows")!;
    if (!("rows" in knows)) throw new Error("the Knows section has no rows");
    const line = knows.rows[0]!;
    expect(line[0]).toContain(dead.name);
    expect(line[1]).toContain("60% sure");
    expect(line[1]).toContain("The truth:");
    expect(line[1]).toContain("of old age");
    const k = knowersOf(ctx, deathRef(dead.id))!;
    expect(k.total).toBe(1);
    expect(k.truth).toContain(dead.name);
    expect(k.holders[0]).toMatchObject({ wrong: true, name: listener.name });
    expect(k.places[0]).toMatchObject({ site, count: 1 });
    expect(gossipOverview(ctx).popular[0]).toMatchObject({ ref: deathRef(dead.id), count: 1 });
    expect(knowersOf(ctx, "nonsense")).toBeNull();
    expect(worldHash(town.world, store)).toBe(before);
  });
});
