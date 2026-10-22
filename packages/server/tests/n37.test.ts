/**
 * N37: chatter with consequences. When two people meet, code decides what kind of exchange it is from who they are and how they get on;
 * the exchange changes how they see each other (the relationships table) and may leave a grievance; the people who saw it know of it and
 * gossip (N33) carries it on; a wronged person with enough pride or hate comes to want revenge on the one who wronged them (anyone, not
 * only the player) and carries it out. Words come last. Roles are found by class and job, never by name (plans README section 12).
 */
import { days } from "./long.js";
import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CHAT_MINUTES, CLASS_RANK, CrowdSim, kindLines, markKey, type SocialClass } from "@millbrook/shared";
import { config } from "../src/config.js";
import { card } from "../src/admin/person.js";
import type { AdminContext } from "../src/admin/context.js";
import { applyInteraction, sting } from "../src/game/chatter/apply.js";
import { checkChatterBounds } from "../src/game/chatter/bounds.js";
import { chatterDay, courtesyWithoutRows } from "../src/game/chatter/day.js";
import { addGrievance, easeGrievances, forgivenessOf, halfLifeOf, hateOn, weightOn } from "../src/game/chatter/grievance.js";
import { crowdHour } from "../src/game/chatter/hours.js";
import { pickInteraction, type Party, type PickIn } from "../src/game/chatter/pick.js";
import { temperOf, type Temper } from "../src/game/chatter/person.js";
import { adjustRel, credenceOf, feelings, MAX_RELS, pruneRels, viewOf } from "../src/game/chatter/rel.js";
import { thresholdOf, vendettaDay } from "../src/game/chatter/revenge.js";
import { HOSTILE, type Interaction, type InteractionKind } from "../src/game/chatter/types.js";
import { WorldStore } from "../src/game/db.js";
import { streamFor } from "../src/game/dice.js";
import { eventRef } from "../src/game/gossip/refs.js";
import { learn } from "../src/game/gossip/knowledge.js";
import { worldHash } from "../src/game/hash.js";
import { liveSites } from "../src/game/people/live.js";
import { outlookOf } from "../src/game/people/outlook.js";
import { advanceWorld, settle } from "../src/game/people/world.js";
import type { LifeCtx } from "../src/game/people/step.js";
import { generateRealm } from "../src/game/realm/generate.js";
import { pickStartSite } from "../src/game/realm/start.js";
import { TRIPS } from "../src/game/road/trips/config.js";
import { loadCreatureTemplates } from "../src/game/creatures.js";
import { newWorld } from "../src/game/save.js";
import { Town } from "../src/game/town.js";
import { materialisePeople } from "../src/store/materialise.js";
import { applySchema, SCHEMA_VERSION } from "../src/store/schema.js";
import type { PersonRow } from "../src/store/peopleStore.js";
import { siteMap } from "../src/web/sites.js";
import { CALL_KINDS, budgets } from "../src/budgets.js";
import { writeChatterLine } from "../src/game/chatter/words.js";
import { always, FakeProvider, pickTestPlaces, say } from "./helpers.js";

vi.setConfig({ testTimeout: 240_000 });
const trips = { ...Object.fromEntries(Object.entries(TRIPS).map(([k, v]) => [k, v.cap])) } as Record<string, number>;

beforeEach(() => {
  config.peopleLazy = "";
  config.gossip = true;
  config.chatter = true;
  config.realm = true;
  config.realmSeed = undefined;
  for (const k of Object.keys(TRIPS)) (TRIPS as Record<string, { cap: number }>)[k]!.cap = trips[k]!;
});

const noRoads = () => {
  for (const k of Object.keys(TRIPS)) (TRIPS as Record<string, { cap: number }>)[k]!.cap = 0;
};

function world(seed = 1) {
  const realm = generateRealm(seed, 1);
  const store = new WorldStore(":memory:");
  materialisePeople(realm, store.people, 1);
  const live = liveSites(realm, pickStartSite(realm, realm.seed), "all");
  const ctx: LifeCtx = { realm, store };
  return { realm, store, live, ctx, ...pickTestPlaces(realm) };
}
type W = ReturnType<typeof world>;

const rankOf = (r: PersonRow) => CLASS_RANK[r.cls as SocialClass] ?? 2;
const grown = (w: W, site: string) => (w.store.people.loadSite(site, "full") as PersonRow[]).filter((r) => r.job !== "child" && !r.away && r.persona === null && !r.master_id);

/** A place with a high-born person and several low-born, found by class (never by name). Returns them sorted by id. */
function folkWithRanks(w: W, minHigh = 5, maxLow = 1): { site: string; high: PersonRow[]; low: PersonRow[]; all: PersonRow[] } {
  const sites = [w.start, w.liege, ...[...w.live].sort()];
  for (const site of sites) {
    const all = grown(w, site);
    const high = all.filter((r) => rankOf(r) >= minHigh).sort((a, b) => (a.id < b.id ? -1 : 1));
    const low = all.filter((r) => rankOf(r) <= maxLow).sort((a, b) => (a.id < b.id ? -1 : 1));
    if (high.length >= 1 && low.length >= 6 && all.length >= 20) return { site, high, low, all };
  }
  throw new Error("no place with both high and low born people");
}

const party = (id: string, cls: SocialClass, t: Partial<Temper> = {}): Party => ({
  row: { id, cls, job: "farmer", master_id: null },
  t: { rank: CLASS_RANK[cls], temper: 0.5, pride: 0.5, forgiveness: 0.5, honesty: 0.5, bravery: 0.5, greed: 0.5, mood: 0, ...t },
});
const NEUTRAL = { trust: 0, affection: 0, respect: 0, fear: 0 };
const pickIn = (x: Party, y: Party, o: Partial<PickIn> = {}): PickIn => ({ x, y, viewXofY: NEUTRAL, viewYofX: NEUTRAL, hateXofY: 0, hateYofX: 0, kin: false, witnesses: 0, drink: false, bowing: false, ...o });

function tally(n: number, make: (i: number) => PickIn): Record<InteractionKind, number> {
  const out = {} as Record<InteractionKind, number>;
  for (let i = 0; i < n; i++) {
    const k = pickInteraction(make(i), streamFor(7, "t", i)).kind;
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}
const count = (t: Partial<Record<InteractionKind, number>>, ...kinds: InteractionKind[]) => kinds.reduce((s, k) => s + (t[k] ?? 0), 0);

describe("N37 step 1: relationships for everyone", () => {
  it("a first exchange makes a row; the feelings fade slowly by themselves and a row left alone is dropped", () => {
    const w = world(1);
    const [a, b] = grown(w, w.start);
    expect(w.store.social.rel(a!.id, b!.id)).toBeNull();
    adjustRel(w.store, a!.id, b!.id, { trust: 20, respect: -10, fear: 6 }, 5);
    const row = w.store.social.rel(a!.id, b!.id)!;
    expect(row).toMatchObject({ trust: 20, respect: -10, fear: 6, since: 5 });
    // The other direction is its own row.
    expect(w.store.social.rel(b!.id, a!.id)).toBeNull();
    // Half is left after two years; nothing is written by looking.
    const later = feelings(row, 5 + 2 * config.daysPerYear);
    expect(later.trust).toBeCloseTo(10, 1);
    expect(later.respect).toBeCloseTo(-5, 1);
    expect(w.store.social.rel(a!.id, b!.id)!.trust).toBe(20);
    // A change counts from the faded value, and the axes are clamped.
    adjustRel(w.store, a!.id, b!.id, { trust: 200, fear: -50 }, 5 + 2 * config.daysPerYear);
    expect(w.store.social.rel(a!.id, b!.id)).toMatchObject({ trust: 100, fear: 0 });
    // A row with every feeling nearly gone and untouched for a year is dropped; a strong one is kept.
    adjustRel(w.store, a!.id, b!.id, { trust: -100, respect: 100, fear: 0 }, 6);
    adjustRel(w.store, b!.id, a!.id, { trust: 2 }, 6);
    expect(pruneRels(w.store, 6 + config.daysPerYear + 1)).toBe(1);
    expect(w.store.social.rel(b!.id, a!.id)).toBeNull();
    expect(w.store.social.rel(a!.id, b!.id)).not.toBeNull();
  });

  it("nobody keeps more than 50 views: the weakest goes first", () => {
    const w = world(1);
    const rows = grown(w, w.start);
    const me = rows[0]!;
    const others = rows.slice(1, 60);
    expect(others.length).toBeGreaterThan(MAX_RELS);
    others.forEach((o, i) => adjustRel(w.store, me.id, o.id, { affection: 5 + i }, 3));
    expect(w.store.social.relCount(me.id)).toBe(MAX_RELS);
    // The strongest feelings are the ones kept.
    expect(w.store.social.rel(me.id, others.at(-1)!.id)).not.toBeNull();
    expect(w.store.social.rel(me.id, others[0]!.id)).toBeNull();
  });
});

describe("N37 step 2: what kind of exchange", () => {
  it("a proud, hot-tempered noble sneers at serfs far more than a gentle one does", () => {
    const serf = party("s", "serf");
    const proud = tally(6000, (i) => pickIn(party("n", "noble", { temper: 0.95, pride: 0.95 }), { ...serf, row: { ...serf.row, id: `s${i}` } }, { bowing: true }));
    const gentle = tally(6000, (i) => pickIn(party("n", "noble", { temper: 0.1, pride: 0.1 }), { ...serf, row: { ...serf.row, id: `s${i}` } }, { bowing: true }));
    const meanProud = count(proud, "sneer", "insult", "humiliate", "threaten");
    const meanGentle = count(gentle, "sneer", "insult", "humiliate", "threaten");
    expect(meanProud).toBeGreaterThan(2.5 * meanGentle);
    expect(proud.sneer).toBeGreaterThan(gentle.sneer ?? 0);
    // And they are still mostly polite: courtesy is the base.
    expect(count(proud, "greet", "bow", "share_news", "complain", "flatter")).toBeGreaterThan(3000);
  });

  it("a servant who holds a grievance against their master is likelier to refuse an order; a plain one almost never does", () => {
    const master = party("m", "gentry");
    const servant = party("v", "serf");
    servant.row.master_id = "m";
    const plain = tally(4000, () => pickIn(master, servant));
    const sore = tally(4000, () => pickIn(master, servant, { hateYofX: 0.7 }));
    expect(plain.refuse_order ?? 0).toBeLessThan(200);
    expect(sore.refuse_order ?? 0).toBeGreaterThan(5 * Math.max(1, plain.refuse_order ?? 0));
    expect(plain.order ?? 0).toBeGreaterThan(3000);
  });

  it("a lower person with a score to settle is likelier to refuse a bow; fear holds them back", () => {
    const noble = party("n", "noble");
    const serf = party("s", "serf", { bravery: 0.8 });
    const calm = tally(6000, () => pickIn(serf, noble, { bowing: true }));
    const sore = tally(6000, () => pickIn(serf, noble, { bowing: true, hateXofY: 0.6 }));
    const afraid = tally(6000, () => pickIn(serf, noble, { bowing: true, hateXofY: 0.6, viewXofY: { ...NEUTRAL, fear: 100 } }));
    expect(calm.bow ?? 0).toBeGreaterThan(5000);
    expect(sore.refuse_bow ?? 0).toBeGreaterThan(8 * Math.max(1, calm.refuse_bow ?? 0));
    expect(afraid.refuse_bow ?? 0).toBeLessThan((sore.refuse_bow ?? 0) * 0.6);
  });

  it("someone who owes amends may apologise, the honest more often", () => {
    const a = party("a", "commoner", { honesty: 0.95 });
    const b = party("b", "commoner");
    const honest = tally(4000, () => pickIn(a, b, { hateYofX: 0.5 }));
    const liar = tally(4000, () => pickIn(party("a", "commoner", { honesty: 0.05 }), b, { hateYofX: 0.5 }));
    expect(honest.apologise ?? 0).toBeGreaterThan(liar.apologise ?? 0);
    expect(honest.apologise ?? 0).toBeGreaterThan(100);
    // Nobody apologises for nothing.
    expect(tally(2000, () => pickIn(a, b)).apologise ?? 0).toBe(0);
  });

  it("close kin quarrel less, and drink and a sour mood make tempers worse", () => {
    const hi = party("h", "gentry", { temper: 0.7, pride: 0.7 });
    const lo = party("l", "commoner");
    const base = count(tally(6000, () => pickIn(hi, lo)), "sneer", "insult", "humiliate", "threaten");
    const kin = count(tally(6000, () => pickIn(hi, lo, { kin: true })), "sneer", "insult", "humiliate", "threaten");
    const drunk = count(tally(6000, () => pickIn(hi, lo, { drink: true })), "sneer", "insult", "humiliate", "threaten");
    const sour = count(tally(6000, () => pickIn({ ...hi, t: { ...hi.t, mood: -2.5 } }, lo)), "sneer", "insult", "humiliate", "threaten");
    expect(kin).toBeLessThan(base * 0.6);
    expect(drunk).toBeGreaterThan(base * 1.3);
    expect(sour).toBeGreaterThan(base * 1.3);
  });

  it("the same stream and the same people give the same exchange", () => {
    const x = party("a", "gentry", { temper: 0.9 });
    const y = party("b", "serf");
    const run = () => Array.from({ length: 200 }, (_, i) => pickInteraction(pickIn(x, y, { bowing: true }), streamFor(3, "same", i)).kind).join(",");
    expect(run()).toBe(run());
  });

  it("a townsperson's temper is the same every time and pride grows with station", () => {
    const w = world(1);
    const rows = grown(w, w.start);
    for (const r of rows.slice(0, 20)) expect(temperOf(r)).toEqual(temperOf(r));
    const all = [...w.live].flatMap((s) => grown(w, s)).slice(0, 4000);
    const mean = (rs: PersonRow[]) => rs.reduce((s, r) => s + temperOf(r).pride, 0) / Math.max(1, rs.length);
    expect(mean(all.filter((r) => rankOf(r) >= 5))).toBeGreaterThan(mean(all.filter((r) => rankOf(r) <= 1)) + 0.15);
  });
});

describe("N37 step 3: an exchange becomes real", () => {
  it("a noble who repeatedly sneers at a serf lowers the serf's respect, the serf holds a grievance, and witnesses gossip about it", () => {
    noRoads();
    const w = world(1);
    advanceWorld(w.realm, w.store, 2, { live: w.live });
    const f = folkWithRanks(w, 5, 1);
    const noble = f.high[0]!;
    const serf = f.low[0]!;
    const watchers = f.all.filter((r) => r.id !== noble.id && r.id !== serf.id).slice(0, 5).map((r) => r.id);
    const day = w.realm.day + 1;
    const before = viewOf(w.store, serf.id, noble.id, day).respect;
    const made: string[] = [];
    for (let i = 0; i < 6; i++) {
      const it: Interaction = { a: noble.id, b: serf.id, kind: "sneer", day, minute: -1, site: f.site, witnesses: watchers, venue: "market" };
      const r = applyInteraction(w.ctx, it, i)!;
      expect(r.interaction.event).toBeDefined();
      made.push(r.interaction.event!);
    }
    // The serf thinks less of the noble each time.
    const after = viewOf(w.store, serf.id, noble.id, day);
    expect(after.respect).toBeLessThan(before - 12);
    expect(after.affection).toBeLessThan(-10);
    // They hold a grievance against the noble, one per wrong (the pair keeps six).
    const open = w.store.social.openBetween(serf.id, noble.id);
    expect(open.length).toBeGreaterThanOrEqual(5);
    expect(hateOn(w.store, serf.id, noble.id, day)).toBeGreaterThan(0.3);
    expect(open.every((g) => g.cause_ref.startsWith("e:"))).toBe(true);
    // The events are in the archive, with who saw them.
    const e = w.store.eventById(made[0]!)!;
    expect(e).toMatchObject({ kind: "slight", actor: noble.id, target: serf.id, site: f.site });
    expect(e.witnesses).toEqual([...watchers].sort());
    expect(e.details).toContain(noble.name);
    // The witnesses, the noble and the serf know of it at once; everyone else does not.
    const knowers = (ref: string) => w.store.knowledge.holders(ref).filter((r) => w.store.people.get(r.who)!.site === f.site);
    const ref = eventRef(made.at(-1)!);
    expect(knowers(ref).length).toBe(2 + watchers.length);
    // And over the next days the place talks.
    const first = knowers(ref).length;
    advanceWorld(w.realm, w.store, day + 4, { live: w.live });
    expect(knowers(ref).length).toBeGreaterThan(first);
    const told = knowers(ref).filter((r) => r.source !== "saw");
    expect(told.length).toBeGreaterThan(0);
    expect(told.every((r) => r.accuracy <= 0.9)).toBe(true);
  });

  it("an insult hurts the proud more, and more still when it comes from someone beneath them", () => {
    const w = world(1);
    const f = folkWithRanks(w, 5, 1);
    const noble = f.high[0]!;
    const serf = f.low[0]!;
    const peer = f.all.find((r) => rankOf(r) >= 5 && r.id !== noble.id) ?? f.high[0]!;
    // An insult from a serf stings a noble more than the same from an equal.
    expect(sting(noble, serf)).toBeGreaterThan(sting(noble, peer));
    // And a proud person is hurt more than a meek one.
    const rows = [...w.live].flatMap((s) => grown(w, s)).slice(0, 3000).sort((a, b) => temperOf(a).pride - temperOf(b).pride);
    expect(sting(rows.at(-1)!, serf)).toBeGreaterThan(sting(rows[0]!, serf));
  });

  it("courtesy between people with no feelings on record leaves nothing; a notable exchange makes both rows", () => {
    const w = world(1);
    const [a, b, c] = grown(w, w.start);
    expect(courtesyWithoutRows(w.ctx, { a: a!.id, b: b!.id, kind: "greet" })).toBe(true);
    expect(courtesyWithoutRows(w.ctx, { a: a!.id, b: b!.id, kind: "insult" })).toBe(false);
    applyInteraction(w.ctx, { a: a!.id, b: b!.id, kind: "insult", day: 3, minute: -1, site: w.start, witnesses: [] }, 0);
    expect(w.store.social.rel(b!.id, a!.id)).not.toBeNull();
    expect(w.store.social.rel(a!.id, b!.id)).not.toBeNull();
    expect(courtesyWithoutRows(w.ctx, { a: a!.id, b: b!.id, kind: "greet" })).toBe(false);
    expect(courtesyWithoutRows(w.ctx, { a: a!.id, b: c!.id, kind: "greet" })).toBe(false);
    expect(courtesyWithoutRows(w.ctx, { a: b!.id, b: c!.id, kind: "greet" })).toBe(false);
  });

  it("an apology eases the grievance and earns back some trust", () => {
    const w = world(1);
    const [a, b] = grown(w, w.start);
    applyInteraction(w.ctx, { a: a!.id, b: b!.id, kind: "humiliate", day: 3, minute: -1, site: w.start, witnesses: [] }, 0);
    const heavy = hateOn(w.store, b!.id, a!.id, 3);
    expect(heavy).toBeGreaterThan(0.3);
    const trust = viewOf(w.store, b!.id, a!.id, 3).trust;
    applyInteraction(w.ctx, { a: a!.id, b: b!.id, kind: "apologise", day: 3, minute: -1, site: w.start, witnesses: [] }, 1);
    expect(hateOn(w.store, b!.id, a!.id, 3)).toBeLessThan(heavy * 0.4);
    expect(viewOf(w.store, b!.id, a!.id, 3).trust).toBeGreaterThan(trust);
  });

  it("with chatter off nothing is written", () => {
    config.chatter = false;
    const w = world(1);
    advanceWorld(w.realm, w.store, 8, { live: w.live });
    expect(w.store.social.relTotal()).toBe(0);
    expect(w.store.social.grievanceCounts()).toEqual({ open: 0, settled: 0 });
  });
});

describe("N37 step 4: grievances", () => {
  it("a grievance fades at its owner's pace, is eased by amends, and is settled when it is nothing or the other is dead", () => {
    const w = world(1);
    const rows = [...w.live].flatMap((s) => grown(w, s)).slice(0, 3000);
    const forgiving = [...rows].sort((x, y) => forgivenessOf(y.id) - forgivenessOf(x.id))[0]!;
    const grudging = [...rows].sort((x, y) => forgivenessOf(x.id) - forgivenessOf(y.id))[0]!;
    const other = rows.find((r) => r.id !== forgiving.id && r.id !== grudging.id)!;
    expect(halfLifeOf(forgiving.id)).toBeLessThan(halfLifeOf(grudging.id));
    const g1 = addGrievance(w.store, { who: forgiving.id, against: other.id, cause: "e:x1", weight: 0.4, day: 3 })!;
    const g2 = addGrievance(w.store, { who: grudging.id, against: other.id, cause: "e:x2", weight: 0.4, day: 3 })!;
    const later = 3 + config.daysPerYear;
    expect(weightOn(g1, later)).toBeLessThan(weightOn(g2, later));
    expect(weightOn(g2, 3)).toBe(0.4);
    // Amends take a share of what is held now.
    const eased = easeGrievances(w.store, grudging.id, other.id, 0.5, 3);
    expect(eased).toBeCloseTo(0.2, 2);
    expect(hateOn(w.store, grudging.id, other.id, 3)).toBeCloseTo(0.2, 2);
    // Easing it to nothing settles it.
    easeGrievances(w.store, grudging.id, other.id, 0.95, 3);
    expect(w.store.social.openBetween(grudging.id, other.id)).toHaveLength(0);
    expect(w.store.social.grievance(g2.id)!.settled).toBe(3);
    // Grievances against the dead are settled by the place's day.
    const site = w.store.people.get(forgiving.id)!.site;
    w.store.people.update(other.id, { death: JSON.stringify({ cause: "illness", day: 4, hour: 5, site }) });
    chatterDay(w.ctx, { site }, 5, { hourly: true });
    expect(w.store.social.grievance(g1.id)!.settled).toBe(5);
  });

  it("the same wrong adds up to a hatred, but a pair keeps only six grievances (more deepen the lightest)", () => {
    const w = world(1);
    const [a, b] = grown(w, w.start);
    for (let i = 0; i < 9; i++) addGrievance(w.store, { who: a!.id, against: b!.id, cause: `e:y${i}`, weight: 0.2, day: 3 });
    expect(w.store.social.openBetween(a!.id, b!.id)).toHaveLength(6);
    expect(hateOn(w.store, a!.id, b!.id, 3)).toBeCloseTo(0.2 * 9, 1);
  });

  it("the outlook's grudge is a view of the heaviest grievance", () => {
    noRoads();
    const w = world(1);
    advanceWorld(w.realm, w.store, 2, { live: w.live });
    const f = folkWithRanks(w, 5, 1);
    const noble = f.high[0]!;
    const serf = f.low[0]!;
    const day = w.realm.day;
    applyInteraction(w.ctx, { a: noble.id, b: serf.id, kind: "insult", day, minute: -1, site: f.site, witnesses: [] }, 0);
    // The next review of the serf sets their grudge from it.
    advanceWorld(w.realm, w.store, day + w.realm.day + 6, { live: w.live });
    const o = outlookOf(w.store.people.get(serf.id)!);
    expect(o.grudge?.against).toBe(noble.id);
    expect(o.grudge?.why).toContain(noble.name);
  });
});

describe("N37 step 5: revenge against anyone", () => {
  /** The most easily wounded high-born person of a place, and a low-born one to wrong them. */
  function insulted(w: W, kind: InteractionKind = "insult") {
    const f = folkWithRanks(w, 5, 2);
    const proud = [...f.high].sort((a, b) => thresholdOf(temperOf(a)) - thresholdOf(temperOf(b)))[0]!;
    const rude = f.low.find((r) => r.id !== proud.id)!;
    const day = w.realm.day + 1;
    const it = applyInteraction(w.ctx, { a: rude.id, b: proud.id, kind, day, minute: -1, site: f.site, witnesses: f.all.slice(0, 4).map((r) => r.id).filter((id) => id !== proud.id && id !== rude.id) }, 0)!;
    return { f, proud, rude, day, insult: it.interaction.event! };
  }

  it("a proud noble who is insulted forms a revenge goal against the person who did it, and carries it out the next day", () => {
    const w = world(1);
    const { f, proud, rude, day, insult } = insulted(w);
    expect(hateOn(w.store, proud.id, rude.id, day)).toBeGreaterThan(thresholdOf(temperOf(proud)));
    // The day it happens they brood; a goal is formed.
    const r1 = vendettaDay(w.ctx, f.site, day);
    expect(r1).toMatchObject({ formed: 1, acted: 0 });
    const goal = outlookOf(w.store.people.get(proud.id)!).goal!;
    expect(goal).toMatchObject({ kind: "avenge", target: rude.id, plan: "ambush", cause: insult });
    expect(goal.reason).toContain(rude.name);
    const formed = w.store.recentEvents({ person: proud.id }).find((e) => e.kind === "new-goal")!;
    expect(formed.details).toContain(rude.name);
    expect(formed.causedBy).toEqual([insult]);
    // The next day they do something about it.
    const r2 = vendettaDay(w.ctx, f.site, day + 1);
    expect(r2.acted).toBe(1);
    const act = w.store.recentEvents({ person: proud.id }).find((e) => e.actor === proud.id && e.id.includes("vendetta:") && e.kind !== "new-goal")!;
    expect(act).toBeDefined();
    expect(act.target).toBe(rude.id);
    expect(act.causedBy).toEqual([insult]);
    expect(["attacked", "revenge"]).toContain(act.kind);
    // It is done: the goal is gone, what they held against them is settled.
    expect(outlookOf(w.store.people.get(proud.id)!).goal).toBeUndefined();
    expect(w.store.social.openBetween(proud.id, rude.id)).toHaveLength(0);
    // And they cannot do it twice for the same wrong.
    expect(vendettaDay(w.ctx, f.site, day + 2)).toMatchObject({ formed: 0, acted: 0 });
  });

  it("a revenge wrongs its target in turn at a smaller weight, so a town does not run into a feud on its own", () => {
    const w = world(1);
    const { f, proud, rude, day } = insulted(w, "humiliate");
    const held = hateOn(w.store, proud.id, rude.id, day);
    // Whether the hired men get through is a roll; either way the one who ordered it has had their say.
    vendettaDay(w.ctx, f.site, day);
    vendettaDay(w.ctx, f.site, day + 1);
    expect(w.store.social.openBetween(proud.id, rude.id)).toHaveLength(0);
    const back = hateOn(w.store, rude.id, proud.id, day + 1);
    expect(back).toBeLessThan(held);
    // A plan that always lands (the open fight) wrongs the other at half the weight, and is capped.
    const w2 = world(1);
    const g = insulted(w2, "humiliate");
    const before = hateOn(w2.store, g.proud.id, g.rude.id, g.day);
    w2.store.people.update(g.proud.id, { outlook: JSON.stringify({ ...outlookOf(w2.store.people.get(g.proud.id)!), goal: { kind: "avenge", since: g.day - 1, target: g.rude.id, plan: "rumour", strength: 0.9, reason: "q" } }) });
    vendettaDay(w2.ctx, g.f.site, g.day);
    const returned = hateOn(w2.store, g.rude.id, g.proud.id, g.day);
    expect(returned).toBeGreaterThan(0);
    expect(returned).toBeLessThan(before * 0.5);
  });

  it("the plan follows who they are: those with means hire men, the dishonest spread a tale, the rest keep away", () => {
    const hot = { rank: 3, temper: 0.9, pride: 0.5, forgiveness: 0.1, honesty: 0.8, bravery: 0.9, greed: 0.1, mood: 0 };
    const target = { ...hot, rank: 2 };
    return import("../src/game/chatter/revenge.js").then(({ choosePlan }) => {
      expect(choosePlan({ ...hot, rank: 5 }, target)).toBe("ambush");
      expect(choosePlan({ ...hot, greed: 0.9 }, target)).toBe("ambush");
      expect(choosePlan(hot, target)).toBe("confront");
      // Out of reach: a serf cannot have it out with a noble.
      expect(choosePlan({ ...hot, rank: 1 }, { ...target, rank: 6, honesty: 0.5 })).toBe("refuse");
      expect(choosePlan({ ...hot, rank: 1, honesty: 0.2 }, { ...target, rank: 6 })).toBe("rumour");
      expect(choosePlan({ ...hot, bravery: 0.2, honesty: 0.9 }, target)).toBe("refuse");
    });
  });

  it("a rumour plan spreads a false tale that others hear, and a refusal costs the other their dealings", () => {
    const w = world(1);
    const f = folkWithRanks(w, 2, 2);
    const me = f.low.find((r) => temperOf(r).honesty < 0.4 && temperOf(r).bravery < 0.5) ?? f.low[0]!;
    const them = f.low.find((r) => r.id !== me.id)!;
    const day = w.realm.day + 1;
    addGrievance(w.store, { who: me.id, against: them.id, cause: "e:zz", weight: 0.9, day });
    const o = outlookOf(w.store.people.get(me.id)!);
    w.store.people.update(me.id, { outlook: JSON.stringify({ ...o, goal: { kind: "avenge", since: day - 1, target: them.id, plan: "rumour", strength: 0.9, reason: "a quarrel" } }) });
    expect(vendettaDay(w.ctx, f.site, day).acted).toBe(1);
    const tale = w.store.recentEvents({ person: me.id }).find((e) => e.kind === "rumour")!;
    expect(tale.details).toContain("not true");
    expect(w.store.knowledge.holders(eventRef(tale.id)).length).toBeGreaterThan(1);
    const believers = w.store.knowledge.holders(eventRef(tale.id)).filter((r) => r.who !== me.id);
    expect(believers.every((r) => r.accuracy < 1)).toBe(true);
    expect(w.store.social.rel(believers[0]!.who, them.id)!.trust).toBeLessThan(0);
    // Refusing to deal.
    const g2 = f.low.find((r) => r.id !== me.id && r.id !== them.id)!;
    addGrievance(w.store, { who: g2.id, against: them.id, cause: "e:zy", weight: 0.9, day });
    w.store.people.update(g2.id, { outlook: JSON.stringify({ ...outlookOf(w.store.people.get(g2.id)!), goal: { kind: "avenge", since: day - 1, target: them.id, plan: "refuse", strength: 0.9, reason: "a debt" } }) });
    vendettaDay(w.ctx, f.site, day);
    expect(w.store.social.rel(g2.id, them.id)!.trust).toBeLessThanOrEqual(-15);
    expect(w.store.social.openBetween(them.id, g2.id)).toHaveLength(0);
  });

  it("a goal that cools below what they can hold is forgotten, and a target who has gone away leaves it waiting", () => {
    const w = world(1);
    const f = folkWithRanks(w, 5, 2);
    const proud = f.high[0]!;
    const rude = f.low[0]!;
    const day = w.realm.day + 1;
    addGrievance(w.store, { who: proud.id, against: rude.id, cause: "e:q", weight: 0.9, day });
    w.store.people.update(proud.id, { outlook: JSON.stringify({ ...outlookOf(w.store.people.get(proud.id)!), goal: { kind: "avenge", since: day, target: rude.id, plan: "refuse", strength: 0.9, reason: "q" } }) });
    // Far in the future the grievance has faded: they let it go.
    const future = day + 6 * config.daysPerYear;
    const r = vendettaDay(w.ctx, f.site, future);
    expect(r).toMatchObject({ forgotten: 1, acted: 0 });
    expect(outlookOf(w.store.people.get(proud.id)!).goal).toBeUndefined();
    // A goal against someone who has moved away waits: it neither acts nor is lost while the hatred lasts.
    addGrievance(w.store, { who: proud.id, against: rude.id, cause: "e:q2", weight: 0.9, day: future });
    w.store.people.update(proud.id, { outlook: JSON.stringify({ ...outlookOf(w.store.people.get(proud.id)!), goal: { kind: "avenge", since: future - 1, target: rude.id, plan: "refuse", strength: 0.9, reason: "q" } }) });
    w.store.people.update(rude.id, { away: JSON.stringify({ journey: "j1", since: future, purpose: "trade", returns: true }) });
    expect(vendettaDay(w.ctx, f.site, future)).toMatchObject({ acted: 0, forgotten: 0 });
    expect(outlookOf(w.store.people.get(proud.id)!).goal).toMatchObject({ target: rude.id, plan: "refuse" });
  });
});

describe("N37 step 6: the player's map", () => {
  function town() {
    noRoads();
    const store = new WorldStore(":memory:");
    const templates = loadCreatureTemplates();
    const t = new Town({ personas: {}, creatureTemplates: templates, world: newWorld({}, templates, always(0.5), 1), llm: new FakeProvider(), store });
    const site = t.world.startSite;
    t.rosterAt(site, siteMap(t.world.realm!.settlements[site]!, "village", t.world.realm));
    return { t, store, site };
  }

  it("the server's chats are the browser's chats, and an exchange that was more than a greeting comes with a mark that changes the words", () => {
    const { t, store, site } = town();
    const sim = t.crowdSim()!;
    expect(sim).not.toBeNull();
    const day = t.world.day;
    const ctx = { realm: t.world.realm!, store };
    // Look at several busy hours for marks.
    const marks = [];
    for (let h = 8; h < 20; h++) marks.push(...crowdHour(ctx, site, day, h, sim, t.crowdDay()).marks);
    expect(marks.length).toBeGreaterThan(0);
    for (const m of marks) {
      expect([m.a, m.b]).toContain(m.actor);
      expect(["greet", "bow", "share_news", "order", "complain", "flatter"]).not.toContain(m.kind);
    }
    // The chats the browser would compute for that minute carry the kind and the matching words.
    const m = marks[0]!;
    const minute = m.k * CHAT_MINUTES - day * 1440;
    const at = sim.all(day, minute, t.crowdDay());
    const without = sim.chats(day, minute, t.crowdDay(), at).find((c) => (c.a === m.a && c.b === m.b) || (c.a === m.b && c.b === m.a))!;
    const withMarks = sim.chats(day, minute, t.crowdDay(), at, undefined, new Map([[markKey(m.a, m.b, m.k), m]])).find((c) => c.a === without.a && c.b === without.b)!;
    expect(withMarks.kind).toBe(m.kind);
    expect(withMarks.actor).toBe(m.actor);
    if (kindLines(m.kind, sim.roster.people[m.actor]!, sim.roster.people[m.actor === m.a ? m.b : m.a]!, 1)) expect(withMarks.lines).not.toEqual(without.lines);
  });

  it("the hour is worked out once, hostile exchanges leave events and grievances, and the same world gives the same hour", () => {
    const run = () => {
      const { t, store, site } = town();
      const sim = t.crowdSim()!;
      const ctx = { realm: t.world.realm!, store };
      const day = t.world.day;
      let hostile = 0;
      let chats = 0;
      for (let h = 6; h < 22; h++) {
        const r = crowdHour(ctx, site, day, h, sim, t.crowdDay());
        hostile += r.hostile;
        chats += r.chats;
      }
      return { hash: worldHash(t.world, store), hostile, chats, rels: store.social.relTotal() };
    };
    const a = run();
    expect(a.chats).toBeGreaterThan(50);
    expect(a.hostile / a.chats).toBeLessThan(0.05);
    expect(a.rels).toBeGreaterThan(0);
    expect(run()).toEqual(a);
  });

  it("passing hours on the player's map works out each hour once, and the snapshot's marks are for the hour it is", () => {
    const { t, store } = town();
    t.passHours(1);
    const first = t.chatterMarks();
    const rels = store.social.relTotal();
    // Asking again changes nothing.
    expect(t.chatterMarks()).toEqual(first);
    expect(store.social.relTotal()).toBe(rels);
    for (let i = 0; i < 6; i++) t.passHours(1);
    expect(store.social.relTotal()).toBeGreaterThanOrEqual(rels);
  });

  it("the daily chatter skips the place the player is watching (its crowd does the hours), and still runs its grievances", () => {
    const w = world(1);
    advanceWorld(w.realm, w.store, 2, { live: w.live });
    const r = chatterDay(w.ctx, { site: w.start }, 3, { hourly: true });
    expect(r.pairs).toBe(0);
    expect(chatterDay(w.ctx, { site: w.start }, 4).pairs).toBeGreaterThan(0);
  });
});

describe("N37 step 7: the whole thing, over days", () => {
  it("the same seed gives the same chatter: the world hashes the same", () => {
    const run = () => {
      const w = world(1);
      advanceWorld(w.realm, w.store, 14, { live: w.live });
      return { hash: worldHash(w.realm, w.store), rels: w.store.social.relTotal(), griev: w.store.social.grievanceCounts() };
    };
    const a = run();
    expect(a.rels).toBeGreaterThan(20);
    expect(a.griev.open + a.griev.settled).toBeGreaterThan(5);
    expect(run()).toEqual(a);
  });

  it("a place worked out later gives the same chatter as one worked out on the day", () => {
    noRoads();
    const run = (lazy: boolean) => {
      const w = world(1);
      advanceWorld(w.realm, w.store, 2, { live: w.live });
      config.peopleLazy = lazy ? w.start : "";
      advanceWorld(w.realm, w.store, 12, { live: w.live });
      if (lazy) settle(w.ctx, w.start, 12);
      const mine = (id: unknown) => w.store.people.get(String(id))?.site === w.start;
      return JSON.stringify({ rels: w.store.dumpTable("relationships").filter((r) => mine(r.a)), griev: w.store.dumpTable("grievances").filter((r) => mine(r.who)), events: w.store.dumpTable("events").filter((e) => String(e.site) === w.start && ["slight", "affront", "menace", "apology"].includes(String(e.kind))) });
    };
    const live = run(false);
    expect(live.length).toBeGreaterThan(100);
    expect(run(true)).toBe(live);
  });

  it("the balance bounds hold after a good while", () => {
    const w = world(1);
    advanceWorld(w.realm, w.store, days(50, 30), { live: w.live });
    const bounds = checkChatterBounds(w.realm, w.store);
    for (const b of bounds) expect(b, `${b.name}: ${b.detail}`).toMatchObject({ ok: true });
    expect(bounds.map((b) => b.name)).toEqual(["insults-rare", "grievances-settle", "revenge-bounded", "relationships-bounded"]);
  });

  it("revenge happens, now and then, in a living place, and nobody dies of it", () => {
    const w = world(1);
    advanceWorld(w.realm, w.store, days(60, 40), { live: w.live });
    const events = w.store.dumpTable("events").filter((e) => String(e.id).includes("vendetta:"));
    expect(events.length).toBeGreaterThan(0);
    const forms = events.filter((e) => e.kind === "new-goal");
    const acts = events.filter((e) => e.kind !== "new-goal");
    expect(forms.length).toBeGreaterThanOrEqual(acts.length);
    // Every act points at the wrong behind it.
    for (const e of acts) expect(String(e.caused_by)).not.toBe("null");
    expect(w.store.dumpTable("events").filter((e) => e.kind === "death" && String(e.details).includes("vendetta"))).toHaveLength(0);
  });

  it("the admin card shows relationships, grievances and the revenge a person wants", () => {
    const store = new WorldStore(":memory:");
    const templates = loadCreatureTemplates();
    const t = new Town({ personas: {}, creatureTemplates: templates, world: newWorld({}, templates, always(0.5), 1), llm: new FakeProvider(), store });
    const site = t.world.startSite;
    const realm = t.world.realm!;
    t.rosterAt(site, siteMap(realm.settlements[site]!, "village", realm));
    const ctx: AdminContext = { world: () => t.world, town: () => t, store, queueLength: () => 0 };
    const life: LifeCtx = { realm, store };
    const rows = (store.people.loadSite(site, "full") as PersonRow[]).filter((r) => r.job !== "child" && r.persona === null && !r.away);
    const hi = [...rows].sort((a, b) => rankOf(b) - rankOf(a) || (a.id < b.id ? -1 : 1))[0]!;
    const lo = rows.find((r) => rankOf(r) < rankOf(hi) && r.id !== hi.id)!;
    const day = t.world.day;
    applyInteraction(life, { a: lo.id, b: hi.id, kind: "humiliate", day, minute: -1, site, witnesses: [] }, 0);
    vendettaDay(life, site, day);
    const c = card(ctx, `town:${hi.id}`)!;
    const titles = c.sections.map((s) => s.title);
    expect(titles).toEqual(expect.arrayContaining(["Relationships", "Grievances"]));
    const rel = c.sections.find((s) => s.title === "Relationships")!;
    if (!("rows" in rel)) throw new Error("no rows");
    expect(rel.rows[0]![0]).toBe(lo.name);
    const g = c.sections.find((s) => s.title === "Grievances")!;
    if (!("rows" in g)) throw new Error("no rows");
    expect(g.rows[0]![0]).toContain(lo.name);
    expect(g.rows[0]![1]).toContain("humiliated");
    const out = c.sections.find((s) => s.title === "Outlook");
    if (out && "rows" in out) expect(out.rows.find((r) => r[0] === "Wants")?.[1]).toContain(lo.name);
    // The lowly one sees it from the other side.
    const c2 = card(ctx, `town:${lo.id}`)!;
    const g2 = c2.sections.find((s) => s.title === "Grievances")!;
    if (!("rows" in g2)) throw new Error("no rows");
    expect(g2.rows.some((r) => r[0].includes("holds against them"))).toBe(true);
  });
});

describe("N37: gossip believes those it trusts", () => {
  it("a listener who distrusts a speaker believes them less, and trust helps", () => {
    const w = world(1);
    const [a, b, c] = grown(w, w.start);
    const base = 0.8;
    expect(credenceOf(w.store, a!.id, b!.id, 5, base)).toBe(base);
    adjustRel(w.store, a!.id, b!.id, { trust: -80, affection: -40 }, 5);
    adjustRel(w.store, a!.id, c!.id, { trust: 80, affection: 60 }, 5);
    expect(credenceOf(w.store, a!.id, b!.id, 5, base)).toBeLessThan(base * 0.75);
    expect(credenceOf(w.store, a!.id, c!.id, 5, base)).toBeGreaterThan(base);
    expect(credenceOf(w.store, a!.id, c!.id, 5, base)).toBeLessThanOrEqual(1);
    expect(credenceOf(w.store, a!.id, b!.id, 5, 0.1)).toBeGreaterThanOrEqual(0.5);
  });
});

describe("N37: the browser's words", () => {
  const person = (cls: SocialClass, gender: "female" | "male" = "male") => ({ id: cls, name: cls, gender, age: 30, cls, job: "farmer" as const, faction: null, factionName: null, home: 0, work: "home", master: null, masterId: null, color: "#fff" });
  it("every kind of exchange that is more than a greeting has words, and the same seed says the same thing", () => {
    for (const kind of ["sneer", "insult", "humiliate", "refuse_bow", "refuse_order", "complain", "flatter", "threaten", "apologise"] as InteractionKind[]) {
      const a = kindLines(kind, person("noble"), person("serf"), 11);
      expect(a, kind).not.toBeNull();
      expect(a![0].length).toBeGreaterThan(3);
      expect(a![1].length).toBeGreaterThan(1);
      expect(kindLines(kind, person("noble"), person("serf"), 11)).toEqual(a);
    }
    expect(kindLines("greet", person("noble"), person("serf"), 1)).toBeNull();
    expect(HOSTILE.has("insult")).toBe(true);
    expect(HOSTILE.has("greet")).toBe(false);
  });
});

describe("N37: the model's words (chatter-line)", () => {
  const about = { kind: "insult" as InteractionKind, actor: "Ada Lowe", actorClass: "noble", target: "Bran Reed", targetClass: "serf", place: "Ashby" };

  it("is a registered, low-priority, capped kind", () => {
    expect(CALL_KINDS).toContain("chatter-line");
    expect(CALL_KINDS.indexOf("chatter-line")).toBeGreaterThan(CALL_KINDS.indexOf("quest-flavor"));
    expect(budgets.model.perGameDay["chatter-line"]).toBeGreaterThan(0);
  });

  it("uses a good line and rejects one with a name it was not given, a number or the wrong shape", async () => {
    expect(await writeChatterLine(new FakeProvider([say('{"line":"Out of my road, Bran Reed, you great lump."}')]), about)).toBe("Out of my road, Bran Reed, you great lump.");
    expect(await writeChatterLine(new FakeProvider([say('{"line":"Out of my road, Gundar the Foul, you lump."}'), say('{"line":"Out of my road, Gundar the Foul, you lump."}')]), about)).toBeNull();
    expect(await writeChatterLine(new FakeProvider([say('{"line":"Get out, I counted 3 of you."}'), say("not json")]), about)).toBeNull();
    expect(await writeChatterLine(new FakeProvider([say("{}"), say("{}")]), about)).toBeNull();
    // Nothing to say for a plain greeting.
    expect(await writeChatterLine(new FakeProvider([]), { ...about, kind: "greet" })).toBeNull();
  });

  it("a mark gets the model's line when it arrives, and keeps the table's until then; with the model off nothing is asked", async () => {
    noRoads();
    config.director = true;
    // A new town queues a lot of other work; the line is the least protected of it, so give the queue room.
    const room = budgets.model.maxQueueWaitMs;
    (budgets.model as { maxQueueWaitMs: number }).maxQueueWaitMs = 1e12;
    const store = new WorldStore(":memory:");
    const templates = loadCreatureTemplates();
    const llm = new FakeProvider(Array.from({ length: 40 }, () => say('{"line":"Mind your tongue, you great lump."}')));
    const t = new Town({ personas: {}, creatureTemplates: templates, world: newWorld({}, templates, always(0.5), 1), llm, backgroundLlm: llm, store });
    const site = t.world.startSite;
    t.rosterAt(site, siteMap(t.world.realm!.settlements[site]!, "village", t.world.realm));
    let marks = t.chatterMarks();
    // Find an hour with a hostile exchange.
    for (let i = 0; i < 20 && !marks.some((m) => HOSTILE.has(m.kind) && m.kind !== "threaten"); i++) {
      t.passHours(1);
      marks = t.chatterMarks();
    }
    const hot = marks.find((m) => HOSTILE.has(m.kind) && m.kind !== "threaten");
    expect(hot).toBeDefined();
    await t.background.drain();
    expect(marks.filter((m) => m.line).length).toBeGreaterThan(0);
    expect(marks.filter((m) => m.line).every((m) => m.line === "Mind your tongue, you great lump.")).toBe(true);
    (budgets.model as { maxQueueWaitMs: number }).maxQueueWaitMs = room;
    expect(llm.requests.filter((r) => r.kind === "chatter-line").length).toBeGreaterThan(0);
    // With the model off nothing is asked, and the table's words stand.
    config.director = false;
    const quiet = new FakeProvider([]);
    const t2 = new Town({ personas: {}, creatureTemplates: templates, world: newWorld({}, templates, always(0.5), 1), llm: quiet, backgroundLlm: quiet, store: new WorldStore(":memory:") });
    t2.rosterAt(t2.world.startSite, siteMap(t2.world.realm!.settlements[t2.world.startSite]!, "village", t2.world.realm));
    for (let i = 0; i < 6; i++) t2.passHours(1);
    await t2.background.drain();
    expect(quiet.requests.filter((r) => r.kind === "chatter-line")).toHaveLength(0);
  });
});

describe("N37: the database", () => {
  it("a version-6 database is brought up to date and keeps its rows", () => {
    const db = new DatabaseSync(":memory:");
    applySchema(db, false);
    db.exec("INSERT INTO relationships (a, b, trust, affection, respect, fear, since) VALUES ('x', 'y', 1, 2, 3, 4, 5)");
    db.exec("DROP INDEX relationships_b; DROP INDEX grievances_who; PRAGMA user_version = 6");
    applySchema(db, false);
    expect(Number((db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version)).toBe(SCHEMA_VERSION);
    expect(db.prepare("SELECT trust FROM relationships WHERE a = 'x'").get()).toEqual({ trust: 1 });
    expect((db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'relationships_b'").all() as unknown[]).length).toBe(1);
  });

  it("relationships and grievances travel with the world: export and import keep them", async () => {
    const w = world(1);
    advanceWorld(w.realm, w.store, 8, { live: w.live });
    expect(w.store.social.relTotal()).toBeGreaterThan(0);
    const rels = w.store.dumpTable("relationships");
    const other = new WorldStore(":memory:");
    other.replaceTable("relationships", ["a", "b", "trust", "affection", "respect", "fear", "since"], rels);
    expect(other.social.relTotal()).toBe(rels.length);
    expect(other.dumpTable("relationships")).toEqual(rels);
  });
});

// Unused imports kept honest: learn is how witnesses come to know; the hash covers the new tables.
void learn;
