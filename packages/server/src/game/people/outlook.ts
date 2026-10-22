import { CLASS_RANK, type SocialClass } from "@millbrook/shared";
import { config } from "../../config.js";
import type { PersonRow } from "../../store/peopleStore.js";
import { seedFrom, streamFor } from "../dice.js";
import { KEEP_DAYS, NEUTRAL_DAY, type SiteDay } from "./conditions.js";
import { addGrievance, strongestOf } from "../chatter/grievance.js";
import { deathRef } from "../gossip/refs.js";
import type { DeathRecord } from "./death.js";
import type { LifeCtx, SiteStep } from "./step.js";

/**
 * How townsfolk change (N25b step 2): the same kinds of change a talker's life review makes (how they see their lord, their
 * mood, what they want, who they hold a grudge against), by code's rules and without words, for everyone who doesn't talk.
 * Each person is reviewed every `review.everyDays` days (spread by a seeded offset, so a town's reviews don't all land on
 * one day) and the same day when something big hits their life: a death or wedding in the family, or the town's raid,
 * war, famine or plague starting. A review covers everything since the last, from the place's recorded conditions
 * (`site_days`) and the family's rows, and nothing else, so a place worked out years later (a lazy catch-up) gives
 * the same people the same outlook as working it out each day. Pure per person: `(seed, rows, conditions, the day)`.
 *
 * The outlook lives on the person's row (`people.outlook`, one small JSON), so it is saved, hashed, exported and
 * caught up with the rest of them. A person who becomes a talker keeps it: it is part of what the model is told
 * about them (npc/depth/facts.ts).
 */
export interface Outlook {
  /** The day of the last review. */
  r: number;
  /** -3 (miserable) to 3 (content). */
  mood: number;
  /** How they see whoever rules their place: trust, fear, respect, affection. */
  lord: { t: number; f: number; e: number; a: number };
  /** What they want, once something gives them reason to. */
  goal?: Goal;
  /** Who they hold a grudge against, and since when. */
  grudge?: { against: string; since: number; why: string };
}

/**
 * What a person wants: to move, or to have revenge. A revenge from a death in the family has a `target` (a name or cause) and nothing else;
 * one from a grievance against a person (N37, game/chatter/revenge.ts) names that person's id and has a plan, a strength (how much they still
 * hold against them), the words for it, the event behind it and, once done, the day.
 */
export interface Goal {
  kind: "move" | "avenge";
  since: number;
  target?: string;
  plan?: "ambush" | "confront" | "rumour" | "refuse";
  strength?: number;
  reason?: string;
  cause?: string;
  acted?: number;
}

export const BLANK_OUTLOOK: Outlook = { r: 0, mood: 0, lord: { t: 0, f: 0, e: 0, a: 0 } };

/** A row's outlook (blank before their first review). */
export function outlookOf(row: Pick<PersonRow, "outlook">): Outlook {
  if (!row.outlook) return { ...BLANK_OUTLOOK, lord: { ...BLANK_OUTLOOK.lord } };
  try {
    const o = JSON.parse(row.outlook) as Outlook;
    return { ...BLANK_OUTLOOK, ...o, lord: { ...BLANK_OUTLOOK.lord, ...o.lord } };
  } catch {
    return { ...BLANK_OUTLOOK, lord: { ...BLANK_OUTLOOK.lord } };
  }
}

/** The numbers of a townsperson's review, in one place. */
export const OUTLOOK = {
  /** Share of the gap to what their close people think that one review closes, the least gap that pulls, and the most it moves. */
  pull: 0.3,
  pullFrom: 10,
  pullMax: 5,
  /** Each review, opinions of the lord drift this share back toward nothing (so a whole town can't run to the extremes). */
  settle: 0.05,
  /** The most one review moves how they see their lord, and the most in a shock review. */
  step: 10,
  shockStep: 20,
  /** What a hard season does to the trust in, fear of and respect for the lord, per full review of it. */
  famine: { t: -6, e: -3 },
  raided: { e: -5, f: 3, t: -3 },
  war: { f: 4 },
  plague: { t: -4, e: -2 },
  /** Chance a free person in a hard season comes to want to leave, and a person whose kin was killed to want revenge. */
  moveChance: 0.35,
  avengeChance: 0.5,
  /** Days a grudge lasts without being refreshed, and a want to move after the hard times end. */
  grudgeDays: 30,
  moveLingerDays: 6,
} as const;

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const FREE = new Set<SocialClass>(["commoner", "artisan", "merchant"]);
const round1 = (n: number) => Math.round(n * 10) / 10;

/** The day a person's reviews fall on: `(day + offset) % everyDays === 0`. */
export const offsetOf = (id: string): number => seedFrom(`review:${id}`) % config.review.everyDays;
export const cycleDue = (id: string, day: number): boolean => (day + offsetOf(id)) % config.review.everyDays === 0;

/**
 * What a stretch of days was like for a place: shares of days, 0..1, from its recorded conditions. Only the plain
 * flags and the famine line are read, never the levels of food and prosperity: those drift with the realm's coin,
 * which reads a lazy place's population, so a lazy place's levels may differ a little from a live one's (see N25.9).
 */
export interface Season {
  days: number;
  famine: number;
  raided: number;
  war: number;
  plague: number;
}

/** The place's conditions over `from..to`, averaged. Days no longer kept count as ordinary. */
export function seasonOf(ctx: LifeCtx, site: string, from: number, to: number): Season {
  const lo = Math.max(from, to - KEEP_DAYS + 1);
  const days = ctx.store.people.siteDays<SiteDay>(site, lo).filter((d) => d.day >= lo && d.day <= to);
  const n = Math.max(1, to - lo + 1);
  const sum = (f: (d: SiteDay) => number) => days.reduce((s, d) => s + f(d.data), 0) / n;
  return {
    days: n,
    famine: sum((d) => (d.famine > 0 ? Math.max(0.5, d.famine) : 0)),
    raided: sum((d) => (d.raided ? 1 : 0)),
    war: sum((d) => (d.atWar ? 1 : 0)),
    plague: sum((d) => (d.plague > 0 ? 1 : 0)),
  };
}

/** What happened to someone in the family or the town today, that makes this review a shock. */
export interface Hit {
  kind: "family-death" | "wedding" | "raid" | "war" | "famine" | "plague";
  /** For a death: how, and who did it. */
  death?: DeathRecord;
  /** For a death: the name, for the grudge's reason. */
  who?: string;
  /** For a death: the dead person's id (a grievance against the killer points at their death). */
  whoId?: string;
}

/** One person's review (pure). `kin` are their spouse's and parents' outlooks. */
export function review(row: PersonRow, old: Outlook, season: Season, kin: Outlook[], hits: Hit[], day: number, seed: number): Outlook {
  const shock = hits.length > 0;
  const stepMax = shock ? OUTLOOK.shockStep : OUTLOOK.step;
  const next: Outlook = { r: day, mood: old.mood, lord: { ...old.lord }, ...(old.goal ? { goal: { ...old.goal } } : {}), ...(old.grudge ? { grudge: { ...old.grudge } } : {}) };
  const weeks = Math.max(1, Math.min(season.days, config.review.everyDays * 2)) / config.review.everyDays;

  // The season: what it did to their view of whoever rules.
  const move = (axis: "t" | "f" | "e" | "a", delta: number) => {
    next.lord[axis] = clamp(next.lord[axis] + clamp(delta, -stepMax, stepMax), axis === "f" ? 0 : -100, 100);
  };
  const apply = (share: number, effect: Partial<Record<"t" | "f" | "e" | "a", number>>) => {
    if (share <= 0) return;
    for (const [axis, per] of Object.entries(effect) as Array<["t" | "f" | "e" | "a", number]>) move(axis, per * share * weeks);
  };
  apply(season.famine, OUTLOOK.famine);
  apply(season.raided, OUTLOOK.raided);
  apply(season.war, OUTLOOK.war);
  apply(season.plague, OUTLOOK.plague);
  // A shock is felt at once, whatever the season's average says.
  for (const h of hits) {
    if (h.kind === "raid") apply(1, { e: -3, f: 3 });
    else if (h.kind === "famine") apply(1, { t: -4 });
    else if (h.kind === "war") apply(1, { f: 4 });
    else if (h.kind === "plague") apply(1, { t: -3 });
  }

  // The pull of the people close to them: their spouse's and parents' view of the lord draws theirs, a share of the gap at a time.
  for (const axis of ["t", "e", "a"] as const) {
    if (kin.length === 0) break;
    const avg = kin.reduce((s, k) => s + k.lord[axis], 0) / kin.length;
    const gap = avg - next.lord[axis];
    if (Math.abs(gap) >= OUTLOOK.pullFrom) next.lord[axis] = clamp(next.lord[axis] + clamp(gap * OUTLOOK.pull, -OUTLOOK.pullMax, OUTLOOK.pullMax), -100, 100);
  }
  // And a slow drift back toward how they were, so opinions don't only ever run one way.
  for (const axis of ["t", "e", "a"] as const) next.lord[axis] = round1(next.lord[axis] * (1 - OUTLOOK.settle));
  next.lord.f = round1(next.lord.f * (1 - OUTLOOK.settle));
  for (const axis of ["t", "e", "a", "f"] as const) next.lord[axis] = round1(next.lord[axis]);

  // Mood: the hardness of the times, and what happened at home.
  const times = -3 * season.famine - 2 * season.raided - 1 * season.war - 2 * season.plague;
  const home = hits.reduce((s, h) => s + (h.kind === "family-death" ? -2.5 : h.kind === "wedding" ? 1.5 : 0), 0);
  next.mood = round1(clamp(old.mood * 0.5 + times + home, -3, 3));

  // Wants. A free person in hard times may come to want to leave; someone whose kin was killed by a known hand, revenge.
  const rng = streamFor(seed, "outlook", row.id, day);
  const hard = season.famine > 0.3 || season.raided > 0.3 || season.war > 0.5 || season.plague > 0.3;
  const killed = hits.find((h) => h.kind === "family-death" && h.death && ["raid", "murder", "battle", "siege", "beast", "execution"].includes(h.death.cause));
  if (!next.goal) {
    if (killed && rng() < OUTLOOK.avengeChance) next.goal = { kind: "avenge", since: day, target: killed.death!.killer ?? killed.death!.cause };
    else if (hard && FREE.has(row.cls as SocialClass) && CLASS_RANK[row.cls as SocialClass] <= 4 && rng() < OUTLOOK.moveChance) next.goal = { kind: "move", since: day };
  } else if (next.goal.kind === "move" && !hard && day - next.goal.since >= OUTLOOK.moveLingerDays) delete next.goal;
  if (killed) next.grudge = { against: killed.death!.killer ?? killed.death!.cause, since: day, why: `${killed.who ?? "someone close"} died in ${killed.death!.cause === "beast" ? "an attack by beasts" : `a ${killed.death!.cause}`}` };
  else if (next.grudge && day - next.grudge.since >= OUTLOOK.grudgeDays) delete next.grudge;
  return next;
}

/** What turned for a whole place today: a raid, a war, a famine or a plague begun since yesterday (from its recorded conditions). */
export function townHits(people: Pick<LifeCtx["store"]["people"], "siteDay">, site: string, day: number): Hit[] {
  const out: Hit[] = [];
  const today = people.siteDay<SiteDay>(site, day) ?? NEUTRAL_DAY;
  const yesterday = people.siteDay<SiteDay>(site, day - 1) ?? NEUTRAL_DAY;
  if (today.raided && !yesterday.raided) out.push({ kind: "raid" });
  if (today.atWar && !yesterday.atWar) out.push({ kind: "war" });
  if (today.famine > 0 && !(yesterday.famine > 0)) out.push({ kind: "famine" });
  if (today.plague > 0 && !(yesterday.plague > 0)) out.push({ kind: "plague" });
  return out;
}

/** Whoever in this place the day touches: from the day's conditions turning, and from its births, deaths and weddings. */
function hitsOf(ctx: LifeCtx, step: SiteStep, day: number, rows: PersonRow[]): { town: Hit[]; people: Map<string, Hit[]> } {
  const people = ctx.store.people;
  const town = townHits(people, step.site, day);
  const hits = new Map<string, Hit[]>();
  const add = (id: string, h: Hit) => hits.set(id, [...(hits.get(id) ?? []), h]);
  const alive = new Set(rows.map((r) => r.id));
  for (const d of step.deaths) {
    const dead = people.get(d.id);
    if (!dead) continue;
    const kin = new Set<string>([...[dead.spouse, dead.mother, dead.father].filter((x): x is string => !!x), ...people.childrenOf(dead.id).map((c) => c.id)]);
    for (const k of kin) if (alive.has(k)) add(k, { kind: "family-death", death: d.record, who: dead.name, whoId: dead.id });
  }
  for (const [a, b] of step.marriages) {
    for (const id of [a, b]) if (alive.has(id)) add(id, { kind: "wedding" });
  }
  return { town, people: hits };
}

/**
 * The day's reviews for one place, run after its step (and its risers): everyone whose cycle falls today, and everyone
 * a shock touches. Returns how many were reviewed. Talkers (people with a persona) are reviewed by their own system
 * (npc/review/), not here.
 */
export function reviewDay(ctx: LifeCtx, step: SiteStep, day: number): number {
  if (!config.review.enabled) return 0;
  const people = ctx.store.people;
  const rows = (people.loadSite(step.site, "full") as PersonRow[]).filter((r) => r.persona === null);
  if (rows.length === 0) return 0;
  const { town, people: byPerson } = hitsOf(ctx, step, day, rows);
  const inSite = new Map(rows.map((r) => [r.id, r]));
  const seasons = new Map<number, Season>();
  const seasonFrom = (from: number): Season => {
    let s = seasons.get(from);
    if (!s) seasons.set(from, (s = seasonOf(ctx, step.site, from, day)));
    return s;
  };
  let done = 0;
  const staged: Array<[string, Outlook, Hit[]]> = [];
  // Read everyone's outlook as it was this morning, write after: the order of the roster never matters.
  for (const row of rows) {
    const own = byPerson.get(row.id) ?? [];
    const hits = [...town, ...own];
    if (hits.length === 0 && !cycleDue(row.id, day)) continue;
    const old = outlookOf(row);
    if (old.r >= day) continue;
    const kin = [row.spouse, row.mother, row.father]
      .filter((x): x is string => !!x)
      .map((id) => inSite.get(id) ?? people.get(id))
      .filter((r): r is PersonRow => !!r && r.death === null)
      .map(outlookOf);
    const from = old.r === 0 ? Math.max(1, day - config.review.everyDays + 1) : old.r + 1;
    staged.push([row.id, review(row, old, seasonFrom(from), kin, hits, day, ctx.realm.seed), hits]);
    done++;
  }
  for (const [id, o, hits] of staged) {
    grudgeFromGrievances(ctx, id, o, hits, day);
    people.update(id, { outlook: JSON.stringify(o) });
  }
  return done;
}

/**
 * One source of truth for who someone holds a grudge against (N37): the grievances table. A death in the family by a known hand (a person
 * of the realm) is a grievance against whoever did it; and the outlook's `grudge` is a view of the heaviest grievance a person holds
 * open (or, where they hold none, the review's own: a death by raiders or beasts has no one to be a grievance against).
 */
function grudgeFromGrievances(ctx: LifeCtx, id: string, o: Outlook, hits: Hit[], day: number): void {
  const { store } = ctx;
  for (const h of hits) {
    const killer = h.kind === "family-death" ? h.death?.killer : undefined;
    if (!killer || !h.whoId || !store.people.get(killer)) continue;
    addGrievance(store, { who: id, against: killer, cause: deathRef(h.whoId), weight: 0.6, day });
  }
  const strongest = strongestOf(store, id, day);
  if (!strongest || strongest.weight < 0.1) return;
  const g = strongest.g;
  const against = store.people.get(g.against);
  const cause = g.cause_ref.startsWith("e:") ? store.eventById(g.cause_ref.slice(2))?.details : g.cause_ref.startsWith("d:") ? `${store.people.get(g.cause_ref.slice(2))?.name ?? "someone close"} was killed` : undefined;
  o.grudge = { against: g.against, since: g.since, why: cause ?? `${against?.name ?? "someone"} wronged them` };
}

/** Feelings a person's outlook gives them, in plain sentences (the facts sheet carries them to a new talker's story). */
export function feelingsOf(o: Outlook, lord?: string): string[] {
  const out: string[] = [];
  const who = lord ?? "whoever rules";
  if (o.lord.t <= -25) out.push(`they have little trust in ${who}`);
  else if (o.lord.t >= 25) out.push(`they trust ${who}`);
  if (o.lord.f >= 40) out.push(`they are afraid of ${who}`);
  if (o.lord.e <= -25) out.push(`they have lost respect for ${who}`);
  if (o.mood <= -1.5) out.push("they have been low in spirits lately");
  else if (o.mood >= 1.5) out.push("they have been in good spirits lately");
  if (o.goal?.kind === "move") out.push("they have been thinking of leaving");
  if (o.goal?.kind === "avenge") out.push(o.goal.reason ? `they want revenge: ${o.goal.reason}` : `they want to see ${o.goal.target ?? "someone"} answer for a death in the family`);
  if (o.grudge) out.push(`they hold a grudge: ${o.grudge.why}`);
  return out;
}

