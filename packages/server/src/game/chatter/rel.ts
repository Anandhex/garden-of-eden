import { config } from "../../config.js";
import type { RelRow } from "../../store/socialStore.js";
import type { WorldStore } from "../db.js";
import type { Axes } from "./types.js";

/**
 * Relationship rows for any two people (N37): `a`'s view of `b`. A row exists only for a pair who have interacted. Feelings fade by
 * themselves, slowly: halved every `HALF_LIFE_YEARS` years (`since` is the day a row was last changed), so a quarrel that is never
 * renewed is forgotten, and a row where every feeling is nearly gone and untouched for a year is dropped.
 */
export const HALF_LIFE_YEARS = 2;
export const AXIS_MAX = 100;
/** Most views one person keeps; a new one beyond this pushes out the weakest. */
export const MAX_RELS = 50;
/** A row with every feeling below this, untouched for a year, is dropped. */
export const NEGLIGIBLE = 3;

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const round1 = (n: number) => Math.round(n * 10) / 10;

/** How much of a feeling is left `days` after it was last changed. */
export const fadeAfter = (days: number): number => (days <= 0 ? 1 : Math.pow(0.5, days / (HALF_LIFE_YEARS * config.daysPerYear)));

/** What a row says on a day: its feelings after their fading. */
export function feelings(row: RelRow | null, day: number): Axes {
  if (!row) return { trust: 0, affection: 0, respect: 0, fear: 0 };
  const f = fadeAfter(day - row.since);
  return { trust: row.trust * f, affection: row.affection * f, respect: row.respect * f, fear: row.fear * f };
}

/** `a`'s view of `b` on a day. */
export const viewOf = (store: Pick<WorldStore, "social">, a: string, b: string, day: number): Axes => feelings(store.social.rel(a, b), day);

/** Change `a`'s view of `b` by `delta` on `day` (the old feelings first fade to the day). Returns the new feelings. */
export function adjustRel(store: Pick<WorldStore, "social">, a: string, b: string, delta: Partial<Axes>, day: number): Axes {
  const social = store.social;
  const old = social.rel(a, b);
  const now = feelings(old, day);
  const next: Axes = {
    trust: round1(clamp(now.trust + (delta.trust ?? 0), -AXIS_MAX, AXIS_MAX)),
    affection: round1(clamp(now.affection + (delta.affection ?? 0), -AXIS_MAX, AXIS_MAX)),
    respect: round1(clamp(now.respect + (delta.respect ?? 0), -AXIS_MAX, AXIS_MAX)),
    fear: round1(clamp(now.fear + (delta.fear ?? 0), 0, AXIS_MAX)),
  };
  social.putRel({ a, b, ...next, since: Math.max(day, old?.since ?? day) });
  if (!old && social.relCount(a) > MAX_RELS) {
    const strength = (r: RelRow) => Math.abs(r.trust) + Math.abs(r.affection) + Math.abs(r.respect) + Math.abs(r.fear);
    const out = social.relsOf(a).filter((r) => r.b !== b).sort((x, y) => strength(x) - strength(y) || x.since - y.since || (x.b < y.b ? -1 : 1))[0];
    if (out) social.removeRel(a, out.b);
  }
  return next;
}

/** Overall warmth of a view, -100..100 (affection weighs most, then trust). */
export const warmth = (v: Axes): number => (v.affection * 2 + v.trust) / 3;

/**
 * Drop rows that have faded to nothing and been left alone for a year. One pass a day, bounded; the oldest first. Not part of a day: which rows exist must not depend on when a place was worked out (a person who moved is in another place on the day the row they left behind is caught up), so the day never deletes; this is for maintenance and tests.
 * Returns how many went.
 */
export function pruneRels(store: Pick<WorldStore, "social">, day: number, limit = 200, site?: string): number {
  const year = config.daysPerYear;
  let gone = 0;
  for (const r of site ? store.social.staleRelsAt(site, day - year, limit) : store.social.staleRels(day - year, limit)) {
    const v = feelings(r, day);
    if (Math.max(Math.abs(v.trust), Math.abs(v.affection), Math.abs(v.respect), Math.abs(v.fear)) < NEGLIGIBLE) {
      store.social.removeRel(r.a, r.b);
      gone++;
    }
  }
  return gone;
}

/**
 * How far a listener believes a speaker: the venue's base credence (people at an inn believe a little less than at home), raised by
 * trust and affection toward them and lowered by distrust. A listener with no view of the speaker takes the venue's.
 */
export function credenceOf(store: Pick<WorldStore, "social">, listener: string, speaker: string, day: number, base: number): number {
  if (!store.social.holders().has(listener)) return base;
  const row = store.social.rel(listener, speaker);
  if (!row) return base;
  const v = feelings(row, day);
  return clamp(base * (1 + v.trust / 200 + v.affection / 400), 0.5, 1);
}
