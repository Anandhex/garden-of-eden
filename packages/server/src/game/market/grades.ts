import type { PlayerState } from "../../npc/types.js";
import type { WorldStore } from "../db.js";
import { ITEM_TIERS, type ItemTier } from "../items.js";
import { tierIndex, type Tier } from "../life.js";
import type { Realm } from "../realm/types.js";

/**
 * Adventurer grades for everyone (N42 decision 6): one tier F…SSS (the item tiers), held by the player, by realm adventurers and by any
 * townsperson who takes jobs, under one rule. A grade says which jobs one may take (its own tier, one above with the guild's leave, more
 * only for the reckless). Jobs done at or above the grade earn promotion; from B up, promotion also needs a **trial** (the next job of the
 * next tier, set by the guild). Failures in a row cost a grade.
 */

export const GRADES = ITEM_TIERS.slice(1) as readonly ItemTier[]; // F … SSS
/** Jobs done at or above one's grade for the next. */
export const PROMOTE_AFTER = 3;
/** Failures in a row that cost a grade. */
export const DEMOTE_AFTER = 3;
/** From this grade up, promotion needs a trial. */
export const TRIAL_FROM: ItemTier = "B";

export interface GradeRecord {
  g: ItemTier;
  /** Jobs done at or above the grade since it was won. */
  done: number;
  /** Failures in a row. */
  fail: number;
  /** A trial set (the next job of this tier counts as it). */
  trial?: ItemTier;
  since: number;
  /** All jobs done and failed, ever. */
  total: { done: number; failed: number };
}

export const gradeIndex = (g: string): number => Math.max(0, ITEM_TIERS.indexOf(g as ItemTier));

/** A first grade from what someone is: their rank (at least F). One below it left nearly every adventurer at F, so grades never spread. */
export function startingGrade(tier: string): ItemTier {
  const i = Math.max(1, tierIndex(tier as Tier));
  return ITEM_TIERS[Math.min(ITEM_TIERS.length - 1, i)]!;
}

export const fresh = (g: ItemTier, day: number): GradeRecord => ({ g, done: 0, fail: 0, since: day, total: { done: 0, failed: 0 } });

interface MarketState {
  grades: Record<string, GradeRecord>;
  /** Giver lines owed to the player (N42 decision 9), by giver persona id: what they'd say of a job someone else did. */
  told: Record<string, Array<{ job: string; text: string; day: number }>>;
  next: number;
}

export function marketOf(realm: Realm): MarketState {
  const m = (realm.market ??= { grades: {}, told: {}, next: 0 }) as MarketState;
  m.grades ??= {};
  m.told ??= {};
  m.next ??= 0;
  return m;
}

/** Someone's grade record: a figure's (in the realm), a townsperson's (their row), or the player's. Made at first look. */
export function gradeRecord(realm: Realm, ref: string, opts: { store?: Pick<WorldStore, "people"> | undefined; player?: PlayerState | undefined; day?: number; peek?: boolean } = {}): GradeRecord {
  const day = opts.day ?? realm.day;
  // `peek` reads without keeping a fresh record (the admin never writes).
  if (opts.peek) {
    if (ref === "player" && opts.player) return opts.player.grade ?? playerGrade(opts.player, day);
    const kept = (realm.market as ReturnType<typeof marketOf> | undefined)?.grades?.[ref];
    if (kept) return kept;
    if (realm.figures[ref]) return fresh(startingGrade(realm.figures[ref]!.life.tier), day);
    const row = opts.store?.people.get(ref);
    return row?.grade ? (JSON.parse(row.grade) as GradeRecord) : fresh("F", day);
  }
  if (ref === "player" && opts.player) return (opts.player.grade ??= playerGrade(opts.player, day));
  const m = marketOf(realm);
  if (realm.figures[ref]) return (m.grades[ref] ??= fresh(startingGrade(realm.figures[ref]!.life.tier), day));
  const row = opts.store?.people.get(ref);
  if (row) {
    if (row.grade) return JSON.parse(row.grade) as GradeRecord;
    return fresh("F", day);
  }
  return (m.grades[ref] ??= fresh("F", day));
}

/** Write a townsperson's record back to their row (figures' and the player's are kept where they are). */
export function saveGrade(realm: Realm, ref: string, rec: GradeRecord, store?: Pick<WorldStore, "people">): void {
  if (ref === "player" || realm.figures[ref]) return;
  const row = store?.people.get(ref);
  if (row) store!.people.update(ref, { grade: JSON.stringify(rec) });
  else marketOf(realm).grades[ref] = rec;
}

/** The player's grade at first look: their old guild rank by renown, mapped (the migration from apprentice/journeyman/master). */
export function playerGrade(p: Pick<PlayerState, "renown" | "level">, day: number): GradeRecord {
  const r = p.renown ?? 0;
  const g: ItemTier = r >= 60 ? "C" : r >= 25 ? "D" : p.level >= 6 ? "E" : "F";
  return fresh(g, day);
}

export const gradeOf = (realm: Realm, ref: string, opts: Parameters<typeof gradeRecord>[2] = {}): ItemTier => gradeRecord(realm, ref, opts).g;

/** May someone of this grade take a job of this tier: their own, one above; more only when reckless (and at their own risk). */
export function mayTake(grade: string, tier: string, reckless = false): boolean {
  const gap = gradeIndex(tier) - gradeIndex(grade);
  return gap <= 1 || reckless;
}

export interface GradeChange {
  from: ItemTier;
  to: ItemTier;
  how: "promoted" | "trial" | "demoted" | "trial-set";
}

/** A job ended: count it, and promote, set a trial, pass one, or demote. Returns what changed. */
export function recordJob(rec: GradeRecord, tier: string, ok: boolean, day: number): GradeChange | null {
  const from = rec.g;
  if (!ok) {
    rec.total.failed++;
    rec.fail++;
    if (rec.fail >= DEMOTE_AFTER && gradeIndex(rec.g) > 1) {
      rec.g = ITEM_TIERS[gradeIndex(rec.g) - 1]!;
      rec.fail = 0;
      rec.done = 0;
      delete rec.trial;
      rec.since = day;
      return { from, to: rec.g, how: "demoted" };
    }
    return null;
  }
  rec.total.done++;
  rec.fail = 0;
  const next = ITEM_TIERS[Math.min(ITEM_TIERS.length - 1, gradeIndex(rec.g) + 1)]!;
  // The trial: a job of the next tier, done.
  if (rec.trial && gradeIndex(tier) >= gradeIndex(rec.trial)) {
    rec.g = rec.trial;
    delete rec.trial;
    rec.done = 0;
    rec.since = day;
    return { from, to: rec.g, how: "trial" };
  }
  if (gradeIndex(tier) >= gradeIndex(rec.g)) rec.done++;
  if (rec.done >= PROMOTE_AFTER && next !== rec.g && !rec.trial) {
    if (gradeIndex(next) >= gradeIndex(TRIAL_FROM)) {
      rec.trial = next;
      return { from, to: rec.g, how: "trial-set" };
    }
    rec.g = next;
    rec.done = 0;
    rec.since = day;
    return { from, to: rec.g, how: "promoted" };
  }
  return null;
}
