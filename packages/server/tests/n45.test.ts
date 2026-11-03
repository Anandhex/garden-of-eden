import { beforeEach, describe, expect, it, vi } from "vitest";
import { config } from "../src/config.js";
import { ambitionDay } from "../src/game/ambition/day.js";
import { JOBS, rankOf } from "../src/game/ambition/careers.js";
import { addGrievance, hateOn } from "../src/game/chatter/grievance.js";
import { adjustRel } from "../src/game/chatter/rel.js";
import { WorldStore } from "../src/game/db.js";
import { learn } from "../src/game/gossip/knowledge.js";
import { eventRef } from "../src/game/gossip/refs.js";
import { affairsDay, type AffairData } from "../src/game/kin/affairs.js";
import { arrangeDay } from "../src/game/kin/arranged.js";
import { DISPUTE_DAYS, type DisputeData } from "../src/game/kin/disputes.js";
import { figureEstatesDay, heirsOf } from "../src/game/kin/estate.js";
import { familyOf, feudsDay, inheritGrudges, FEUD_SCAN_DAYS, type FeudData } from "../src/game/kin/feuds.js";
import { kinSiteDay } from "../src/game/kin/day.js";
import { NEUTRAL_DAY } from "../src/game/people/conditions.js";
import type { LifeCtx, SiteStep } from "../src/game/people/step.js";
import { advanceWorld } from "../src/game/people/world.js";
import { generateRealm } from "../src/game/realm/generate.js";
import { makeFigure } from "../src/game/realm/figures.js";
import { policyKeysOf, policyOf, policyRealmDay, POLICY_KEYS, setPolicy } from "../src/game/realm/policy.js";
import { seededRng } from "../src/game/dice.js";
import { SAVE_VERSION } from "../src/game/save.js";
import type { PersonRow } from "../src/store/peopleStore.js";
import { AMBITION_DEFAULTS } from "../src/store/careerStore.js";
import { materialisePeople } from "../src/store/materialise.js";
import { SCHEMA_VERSION, TABLES } from "../src/store/schema.js";
import { pickTestPlaces } from "./helpers.js";

/**
 * N45: family feuds and inheritance. Kingdom laws (the policy mechanism every later law uses), estates by law, disputes between heirs,
 * grudges handed down into feuds that flare, affairs that become gossip and end marriages, marriages arranged for advantage. People are
 * found by job and family, never by name.
 */
vi.setConfig({ testTimeout: 240_000, hookTimeout: 240_000 });

beforeEach(() => {
  config.peopleLazy = "";
  config.realm = true;
  config.realmSeed = undefined;
  config.society.feuds = true;
  config.ambitions = true;
});

function world(seed = 1) {
  const realm = generateRealm(seed, 1);
  const store = new WorldStore(":memory:");
  materialisePeople(realm, store.people, 1);
  const { start, liege } = pickTestPlaces(realm);
  const live = new Set([start, liege]);
  const ctx: LifeCtx = { realm, store };
  advanceWorld(realm, store, 2, { live });
  return { realm, store, live, ctx, start, liege };
}
type W = ReturnType<typeof world>;

const living = (w: W, site: string) => (w.store.people.loadSite(site, "full") as PersonRow[]).filter((r) => r.death === null && !r.away);
const grown = (w: W, site: string) => living(w, site).filter((r) => r.job !== "child");
const step = (site: string, day: number, p: Partial<SiteStep> = {}): SiteStep => ({ site, day, alive: 0, births: [], deaths: [], marriages: [], grownUp: [], events: [], ...p });

/** Make two grown people the children of a parent (and flush, so the people table's lookups find them). */
function makeChildren(w: W, parent: PersonRow, kids: PersonRow[]) {
  const key = parent.gender === "female" ? "mother" : "father";
  kids.forEach((k, i) => w.store.people.update(k.id, { [key]: parent.id, born_day: parent.born_day + (20 + i * 3) * config.daysPerYear }));
  w.store.commit(w.realm.day);
}

describe("N45 step 1: kingdom policies", () => {
  it("every kingdom has an inheritance, divorce and marriage law, written down on its first day", () => {
    const w = world(1);
    for (const k of Object.values(w.realm.kingdoms)) {
      for (const key of ["inheritance", "divorce", "marriage_by"]) {
        expect(POLICY_KEYS[key]!.values).toContain(policyOf(w.realm, k.id, key));
        expect(k.policy?.[key]?.value).toBe(policyOf(w.realm, k.id, key));
      }
      // The admin table lists every key, magic by school and runaways by neighbour too.
      expect(policyKeysOf(w.realm, k).length).toBeGreaterThan(Object.keys(POLICY_KEYS).length);
    }
    // Laws differ between kingdoms on some key (they are the rulers' choices, not one default).
    const ks = Object.values(w.realm.kingdoms);
    expect(Object.keys(POLICY_KEYS).some((key) => new Set(ks.map((k) => policyOf(w.realm, k.id, key))).size > 1)).toBe(true);
  });

  it("a new ruler may change a law, with news and a why that names them", () => {
    const realm = generateRealm(3, 1);
    policyRealmDay(realm, 1);
    let changed = 0;
    // Each kingdom gets a run of new rulers until one changes something.
    for (const k of Object.values(realm.kingdoms)) {
      for (let i = 0; i < 12 && changed === 0; i++) {
        const f = makeFigure(realm, seededRng(100 + i), { name: `Test Heir ${k.id} ${i}`, role: "ruler", home: k.capital, tier: "B", age: 40 }, 1);
        k.ruler = f.id;
        const before = realm.news.length;
        policyRealmDay(realm, 2 + i);
        const news = realm.news.slice(before).filter((n) => n.kind === "policy");
        if (news.length > 0) {
          changed++;
          expect(news[0]!.why).toMatch(new RegExp(f.name));
          expect(news[0]!.text).toMatch(k.name);
        }
      }
    }
    expect(changed).toBeGreaterThan(0);
  });

  it("a temporary law runs out and the old one is back", () => {
    const realm = generateRealm(1, 1);
    policyRealmDay(realm, 1);
    const k = Object.values(realm.kingdoms)[0]!;
    setPolicy(realm, k.id, "curfew", "dusk", 2, "unrest in the capital", 6);
    expect(policyOf(realm, k.id, "curfew", 3)).toBe("dusk");
    policyRealmDay(realm, 6);
    expect(policyOf(realm, k.id, "curfew", 6)).toBe("none");
  });
});

describe("N45 step 2: estates and heirs", () => {
  it("under `eldest`, a smith's shop goes to the eldest child", () => {
    const w = world(1);
    const day = w.realm.day + 1;
    const smith = grown(w, w.liege).find((r) => r.shop !== null && r.job === "smith") ?? grown(w, w.liege).find((r) => r.shop !== null)!;
    const kids = grown(w, w.liege).filter((r) => r.id !== smith.id && r.shop === null && r.id !== smith.spouse && r.mother !== smith.id && r.father !== smith.id && !r.captive).slice(0, 2);
    makeChildren(w, smith, kids);
    for (const k of kids) {
      for (const j of w.store.careers.openJobs(k.id)) if (!j.job.startsWith("seat:")) w.store.careers.endJob(k.id, j.job, day - 1);
      w.store.people.update(k.id, { job: smith.job, skill: 2 });
      w.store.careers.startJob(k.id, JOBS.journeyman(smith.job), w.liege, day - 100);
      w.store.careers.setAmbition({ who: k.id, kind: "quiet_life", target: null, progress: 0, since: 1, step: 0, ...AMBITION_DEFAULTS });
    }
    setPolicy(w.realm, w.realm.settlements[w.liege]!.kingdom!, "inheritance", "eldest", day, "test");
    w.store.people.update(smith.id, { death: JSON.stringify({ cause: "illness", day, hour: 3, site: w.liege }) });
    const o = ambitionDay(w.ctx, { site: w.liege }, day);
    const eldest = [...kids].sort((a, b) => w.store.people.get(a.id)!.born_day - w.store.people.get(b.id)!.born_day)[0]!;
    expect(o.passed).toContainEqual({ from: smith.id, to: eldest.id, what: JOBS.shop(w.liege, smith.job) });
    expect(w.store.people.get(eldest.id)!.shop).toBe(smith.shop);
    // Nobody wanted it more: no dispute.
    expect(w.store.records.open("dispute").length).toBe(0);
  });

  it("the heirs a law names: eldest, eldest son, a split, a will", () => {
    const w = world(1);
    const day = w.realm.day + 1;
    const parent = grown(w, w.liege).find((r) => r.gender === "female" && w.store.people.childrenOf(r.id).length === 0)!;
    const pool = grown(w, w.liege).filter((r) => r.id !== parent.id && r.id !== parent.spouse && r.mother !== parent.id);
    const daughter = pool.find((r) => r.gender === "female")!;
    const son = pool.find((r) => r.gender === "male")!;
    makeChildren(w, parent, [daughter, son]);
    const P = w.store.people.get(parent.id)!;
    expect(heirsOf(w.store, P, "eldest", day).heir!.id).toBe(daughter.id);
    expect(heirsOf(w.store, P, "eldest_son", day).heir!.id).toBe(son.id);
    expect(heirsOf(w.store, P, "split", day).shares.map((s) => s.id).sort()).toEqual([daughter.id, son.id].sort());
    w.store.people.update(parent.id, { will: JSON.stringify({ heir: son.id, day }) });
    expect(heirsOf(w.store, w.store.people.get(parent.id)!, "chosen", day).heir!.id).toBe(son.id);
  });

  it("under `split`, a lord's coin is split among the children, through the ledger", () => {
    const realm = generateRealm(1, 1);
    const site = Object.values(realm.settlements).find((s) => s.kingdom)!;
    setPolicy(realm, site.kingdom!, "inheritance", "split", 1, "test");
    const rng = seededRng(5);
    const lord = makeFigure(realm, rng, { name: "Testlord Pike", role: "lord", home: site.id, tier: "B", age: 40 }, 1);
    const a = makeFigure(realm, rng, { name: "Testa Pike", role: "noble", home: site.id, tier: "C", age: 20 }, 1);
    const b = makeFigure(realm, rng, { name: "Testb Pike", role: "noble", home: site.id, tier: "C", age: 20 }, 1);
    for (const c of [a, b]) {
      c.parents = [lord.id];
      c.life.stage = "adult";
      c.wealth = 0;
    }
    lord.wealth = 1000;
    lord.alive = false;
    lord.deathDay = 9;
    const lines = realm.coin.lines.length;
    figureEstatesDay(realm, 9);
    expect(a.wealth).toBe(500);
    expect(b.wealth).toBe(500);
    expect(lord.wealth).toBe(0);
    expect(realm.coin.lines.slice(lines).every((l) => l.why.startsWith("inheritance"))).toBe(true);
  });
});

describe("N45 step 3: disputes", () => {
  it("a smith dies with two heirs who dispute the forge: recorded, decided, and the loser holds a grievance", () => {
    const w = world(1);
    const day = w.realm.day + 1;
    const smith = grown(w, w.liege).find((r) => r.shop !== null && r.job === "smith") ?? grown(w, w.liege).find((r) => r.shop !== null)!;
    const kids = grown(w, w.liege).filter((r) => r.id !== smith.id && r.shop === null && r.id !== smith.spouse && r.mother !== smith.id && r.father !== smith.id && !r.captive).slice(0, 2);
    makeChildren(w, smith, kids);
    const [elder, younger] = [...kids].sort((a, b) => w.store.people.get(a.id)!.born_day - w.store.people.get(b.id)!.born_day) as [PersonRow, PersonRow];
    for (const [k, skill] of [[elder, 1], [younger, 4]] as const) {
      for (const j of w.store.careers.openJobs(k.id)) if (!j.job.startsWith("seat:")) w.store.careers.endJob(k.id, j.job, day - 1);
      w.store.people.update(k.id, { job: smith.job, skill });
      w.store.careers.startJob(k.id, JOBS.journeyman(smith.job), w.liege, day - 100);
    }
    // The younger wanted the trade's mastery, and is the better hand.
    w.store.careers.setAmbition({ who: younger.id, kind: "master_trade", target: smith.job, progress: 0.6, since: 1, step: 2, ...AMBITION_DEFAULTS });
    setPolicy(w.realm, w.realm.settlements[w.liege]!.kingdom!, "inheritance", "eldest", day, "test");
    w.store.people.update(smith.id, { death: JSON.stringify({ cause: "illness", day, hour: 3, site: w.liege }) });
    ambitionDay(w.ctx, { site: w.liege }, day);
    // The law gave it to the elder; the younger disputes it.
    expect(w.store.people.get(elder.id)!.shop).toBe(smith.shop);
    const d = w.store.records.open<DisputeData>("dispute")[0]!;
    expect(d).toBeDefined();
    expect(d.data.claimants.sort()).toEqual([elder.id, younger.id].sort());
    expect(d.data.lawful).toBe(elder.id);
    expect(d.data.claim).toMatch(/better hand/);
    expect(w.store.recentEvents({ limit: 100 }).some((e) => e.kind === "dispute" && e.actor === younger.id)).toBe(true);
    // A few days on, the head of the place decides it.
    for (let dd = day + 1; dd <= day + DISPUTE_DAYS; dd++) kinSiteDay(w.ctx, step(w.liege, dd), dd);
    const done = w.store.records.get<DisputeData>(d.id)!;
    expect(done.ended).not.toBeNull();
    const winner = done.data.winner!;
    const loser = winner === elder.id ? younger.id : elder.id;
    expect(hateOn(w.store, loser, winner, day + DISPUTE_DAYS)).toBeGreaterThan(0.2);
    expect(w.store.people.get(winner)!.shop).toBe(smith.shop);
    expect(w.store.people.get(loser)!.shop).toBeNull();
  });
});

describe("N45 step 4: inherited grievances and feuds", () => {
  it("one family's grudge against another passes to their children and flares a generation later", () => {
    const w = world(1);
    let day = w.realm.day + 1;
    const rows = grown(w, w.liege);
    // Two families: the Elders of A, who hold grudges against B's, and B's back.
    const famA = new Map<string, PersonRow[]>();
    for (const r of rows) famA.set(familyOf(r), [...(famA.get(familyOf(r)) ?? []), r]);
    const big = [...famA.values()].filter((l) => l.length >= 3).sort((a, b) => b.length - a.length);
    const [A, B] = [big[0]!, big[1]!];
    const elderA = A[0]!;
    // A's elder bears B's a grudge, and B's elder A's: a quarrel between the families.
    for (const b of B.slice(0, 2)) addGrievance(w.store, { who: elderA.id, against: b.id, cause: "test:quarrel", weight: 0.9, day });
    addGrievance(w.store, { who: A[1]!.id, against: B[0]!.id, cause: "test:quarrel", weight: 0.6, day });
    for (const a of A.slice(0, 2)) addGrievance(w.store, { who: B[0]!.id, against: a.id, cause: "test:quarrel", weight: 0.7, day });
    addGrievance(w.store, { who: B[1]!.id, against: A[0]!.id, cause: "test:quarrel", weight: 0.6, day });
    // A child of A's elder, who comes of age today (a short fake generation).
    const child = living(w, w.liege).find((r) => r.job === "child" && r.mother !== elderA.id)!;
    w.store.people.update(child.id, { [elderA.gender === "female" ? "mother" : "father"]: elderA.id, name: `${child.name.split(" ")[0]} ${elderA.name.split(" ")[1]}`, job: "labourer" });
    w.store.commit(day);
    inheritGrudges(w.ctx, step(w.liege, day, { grownUp: [child.id] }), day);
    expect(hateOn(w.store, child.id, B[0]!.id, day)).toBeGreaterThan(0.3);
    // The elder dies; their grudges pass on again (they are their parent's to hand down).
    const passed = inheritGrudges(w.ctx, step(w.liege, day, { deaths: [{ id: elderA.id, name: elderA.name, persona: null, figure: null, record: { cause: "old-age", day, site: w.liege } as never }] }), day);
    expect(passed).toBeGreaterThan(0);
    // The families are at feud once someone looks.
    while (day % FEUD_SCAN_DAYS !== 0) day++;
    feudsDay(w.ctx, step(w.liege, day), day);
    const feud = w.store.records.open<FeudData>("feud")[0]!;
    expect(feud).toBeDefined();
    expect(feud.data.names).toContain(familyOf(elderA));
    // A generation later (fast-forwarded): the grown child, hot-tempered, flares it on coming of age.
    const later = day + 1;
    const young = living(w, w.liege).find((r) => r.job === "child" && r.id !== child.id)!;
    w.store.people.update(young.id, { name: `${young.name.split(" ")[0]} ${elderA.name.split(" ")[1]}`, job: "labourer" });
    w.store.commit(later);
    // Pick someone whose temper is hot enough (temper is derived from the id: find one among the young of the place).
    const hot = living(w, w.liege).filter((r) => r.job === "child").map((r) => r.id);
    let flared = false;
    for (const id of [young.id, ...hot]) {
      const r = w.store.people.get(id)!;
      w.store.people.update(id, { name: `${r.name.split(" ")[0]} ${elderA.name.split(" ")[1]}`, job: "labourer" });
      const ev = feudsDay(w.ctx, step(w.liege, later, { grownUp: [id] }), later);
      if (ev.length > 0) {
        flared = true;
        const e = w.store.eventById(ev[0]!)!;
        expect(e.kind).toBe("feud");
        expect(e.details).toMatch(/flared/);
        expect(e.causedBy).toContain(feud.id);
        break;
      }
    }
    expect(flared).toBe(true);
    expect(w.store.records.get<FeudData>(feud.id)!.data.flares).toBeGreaterThan(0);
  });

  it("a marriage between feuding families ends the feud", () => {
    const w = world(1);
    const day = w.realm.day + 1;
    const rows = grown(w, w.liege);
    const fams = new Map<string, PersonRow[]>();
    for (const r of rows) fams.set(familyOf(r), [...(fams.get(familyOf(r)) ?? []), r]);
    const [A, B] = [...fams.values()].filter((l) => l.length >= 2).sort((a, b) => b.length - a.length) as [PersonRow[], PersonRow[]];
    const [x, y] = [familyOf(A[0]!), familyOf(B[0]!)].sort() as [string, string];
    w.store.records.put<FeudData>({ id: `feud:${x}|${y}`, kind: "feud", site: w.liege, a: x, b: y, since: day, status: "open", ended: null, data: { names: [x, y], cause: "test", flares: 0 } });
    addGrievance(w.store, { who: A[0]!.id, against: B[0]!.id, cause: "test", weight: 0.8, day });
    feudsDay(w.ctx, step(w.liege, day + 1, { marriages: [[A[1]!.id, B[1]!.id]] }), day + 1);
    expect(w.store.records.get<FeudData>(`feud:${x}|${y}`)!.status).toBe("wed");
    expect(hateOn(w.store, A[0]!.id, B[0]!.id, day + 1)).toBe(0);
  });
});

describe("N45 step 5: affairs and separation", () => {
  it("an affair becomes gossip that ends a marriage, where the law allows it", () => {
    const w = world(1);
    const day = w.realm.day + 1;
    setPolicy(w.realm, w.realm.settlements[w.liege]!.kingdom!, "divorce", "allowed", day, "test");
    const wife = grown(w, w.liege).find((r) => r.gender === "female" && r.spouse && w.store.people.get(r.spouse)?.death === null)!;
    const husband = w.store.people.get(wife.spouse!)!;
    // She is cold to him and warm to another.
    adjustRel(w.store, wife.id, husband.id, { affection: -60 }, day);
    const lover = grown(w, w.liege).find((r) => r.gender === "male" && r.id !== husband.id && r.mother !== wife.id && r.id !== wife.father)!;
    adjustRel(w.store, wife.id, lover.id, { affection: 80 }, day);
    let d = day;
    let begun = false;
    for (; d < day + 2000 && !begun; d++) {
      affairsDay(w.ctx, step(w.liege, d), d);
      begun = w.store.records.open<AffairData>("secret", (s) => s.data.what === "affair" && s.data.about === wife.id).length > 0;
    }
    expect(begun).toBe(true);
    const sec = w.store.records.open<AffairData>("secret", (s) => s.data.about === wife.id)[0]!;
    // Only the two of them know at first: it's a secret.
    expect(w.store.knowledge.holders(`s:${sec.id}`).map((k) => k.who).sort()).toEqual([wife.id, sec.data.others![0]!].sort());
    // Seen, told: an affair event that gossip carries.
    let told: string | undefined;
    for (; d < day + 4000 && !told; d++) {
      affairsDay(w.ctx, step(w.liege, d), d);
      told = w.store.records.get<AffairData>(sec.id)!.data.told;
    }
    expect(told).toBeDefined();
    expect(w.store.eventById(told!)!.kind).toBe("affair");
    // The husband hears it (gossip brings it to him), and the marriage ends.
    learn(w.ctx, husband.id, eventRef(told!), { day: d, source: "told", accuracy: 0.8 });
    affairsDay(w.ctx, step(w.liege, d), d);
    expect(w.store.people.get(wife.id)!.spouse).toBeNull();
    expect(w.store.people.get(husband.id)!.spouse).toBeNull();
    expect(hateOn(w.store, husband.id, wife.id, d)).toBeGreaterThan(0.5);
    expect(w.store.recentEvents({ limit: 200 }).some((e) => e.kind === "separation" && e.target === wife.id && /moved out/.test(e.details))).toBe(true);
  });

  it("where divorce is forbidden the marriage goes cold instead", () => {
    const w = world(1);
    const day = w.realm.day + 1;
    setPolicy(w.realm, w.realm.settlements[w.liege]!.kingdom!, "divorce", "forbidden", day, "test");
    const wife = grown(w, w.liege).find((r) => r.gender === "female" && r.spouse && w.store.people.get(r.spouse)?.death === null)!;
    const husband = w.store.people.get(wife.spouse!)!;
    const lover = grown(w, w.liege).find((r) => r.gender === "male" && r.id !== husband.id)!;
    const id = "sec:affair:test";
    w.store.records.put<AffairData>({ id, kind: "secret", site: w.liege, a: wife.id, b: lover.id, since: day, status: "told", ended: null, data: { what: "affair", about: wife.id, others: [lover.id], spouse: husband.id, text: "t", weight: 6, told: "evt-x" } });
    w.store.archiveEvent({ id: "evt-x", day, hour: 1, kind: "affair", actor: wife.id, target: lover.id, details: "seen", importance: 5, witnesses: [], knownBy: [] });
    learn(w.ctx, husband.id, eventRef("evt-x"), { day, source: "told", accuracy: 1 });
    affairsDay(w.ctx, step(w.liege, day), day);
    expect(w.store.people.get(wife.id)!.spouse).toBe(husband.id);
    expect(w.store.records.get<AffairData>(id)!.data.ended).toBe("cold");
  });
});

describe("N45 step 6: arranged marriages", () => {
  it("a parent with `good_match` marries a child into a richer family", () => {
    const w = world(1);
    let day = w.realm.day + 1;
    while (day % 4 !== 0) day++;
    setPolicy(w.realm, w.realm.settlements[w.liege]!.kingdom!, "marriage_by", "family", day, "test");
    const rows = grown(w, w.liege);
    const parent = rows.find((r) => r.cls === "commoner" && !r.captive)!;
    const child = rows.find((r) => r.id !== parent.id && !r.spouse && r.cls === "commoner" && r.gender === "female")!;
    w.store.people.update(child.id, { [parent.gender === "female" ? "mother" : "father"]: parent.id });
    w.store.commit(day);
    w.store.careers.setAmbition({ who: parent.id, kind: "good_match", target: child.id, progress: 1, since: 1, step: 0, ...AMBITION_DEFAULTS });
    const made = arrangeDay(w.ctx, step(w.liege, day), day);
    expect(made.length).toBeGreaterThan(0);
    const spouse = w.store.people.get(w.store.people.get(child.id)!.spouse!)!;
    expect(rankOf).toBeDefined();
    const worth = (r: PersonRow) => ({ slave: 0, serf: 1, commoner: 2, artisan: 3, merchant: 3, clergy: 4, gentry: 5, noble: 6, royal: 7 })[r.cls as "commoner"] + (r.shop !== null ? 1 : 0);
    expect(worth(spouse)).toBeGreaterThanOrEqual(worth(w.store.people.get(child.id)!));
    expect(w.store.recentEvents({ limit: 100 }).some((e) => e.kind === "arranged-match" && e.actor === parent.id)).toBe(true);
  });
});

describe("N45 save and schema", () => {
  it("the save is v17 and the database schema 18 with the new columns and records", () => {
    expect(SAVE_VERSION).toBeGreaterThanOrEqual(17);
    expect(SCHEMA_VERSION).toBeGreaterThanOrEqual(18);
    expect(TABLES.people).toContain("will");
    expect(TABLES.people).toContain("claimed_father");
    expect(TABLES.records).toContain("kind");
  });

  it("a world of families runs the same twice (feuds, affairs and estates are seeded)", () => {
    const run = () => {
      const w = world(2);
      advanceWorld(w.realm, w.store, 40, { live: w.live });
      return JSON.stringify(w.store.dumpTable("records"));
    };
    expect(run()).toBe(run());
  });
});

void NEUTRAL_DAY;
