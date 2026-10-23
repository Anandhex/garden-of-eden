import { config } from "../../config.js";
import type { GrievanceRow } from "../../store/socialStore.js";
import type { WorldStore } from "../db.js";
import { unit } from "../gossip/venues.js";
import { seedFrom } from "../dice.js";

/**
 * Grievances (N37): one per wrong. A wronged person's weight fades by the day at their own pace (the forgiving let go within a few
 * weeks, the unforgiving carry it for more than a year); it is settled by amends, by revenge carried out, by
 * the other's death, or when it has faded to nothing. The sum of what a person holds open against someone is how much they hate them.
 */
export const FADED_BELOW = 0.03;
/** Open grievances one person keeps against one other; a further wrong deepens the lightest. */
export const MAX_OPEN_PER_PAIR = 6;

export const forgivenessOf = (id: string): number => unit(`${id}:forgive`);

/** Days in which a person's grievance loses half its weight: a quarter of a year for the most forgiving, a year and a quarter for the least. */
export const halfLifeOf = (who: string): number => config.daysPerYear * (0.25 + 1.0 * (1 - forgivenessOf(who)));

/** What a grievance weighs on a day. */
export function weightOn(g: Pick<GrievanceRow, "who" | "weight" | "since">, day: number): number {
  const age = day - g.since;
  return age <= 0 ? g.weight : g.weight * Math.pow(0.5, age / halfLifeOf(g.who));
}

/** Everything `who` holds open against `against`, summed on a day (more than 1 is as much hatred as a person can hold). */
export function hateOn(store: Pick<WorldStore, "social">, who: string, against: string, day: number): number {
  if (!store.social.hasOpen(who)) return 0;
  let sum = 0;
  for (const g of store.social.openBetween(who, against)) sum += weightOn(g, day);
  return Math.min(2, sum);
}

/** Add a wrong. Merges into the lightest open grievance when the pair already has the most they keep. */
export function addGrievance(store: Pick<WorldStore, "social">, g: { who: string; against: string; cause: string; weight: number; day: number }): GrievanceRow | null {
  const weight = Math.max(0, Math.min(1, Math.round(g.weight * 100) / 100));
  if (weight <= 0) return null;
  const open = store.social.openBetween(g.who, g.against);
  if (open.length >= MAX_OPEN_PER_PAIR) {
    const lightest = [...open].sort((a, b) => weightOn(a, g.day) - weightOn(b, g.day) || a.id - b.id)[0]!;
    store.social.setWeight(lightest.id, Math.min(1, Math.round((weightOn(lightest, g.day) + weight) * 100) / 100), g.day);
    return store.social.grievance(lightest.id);
  }
  return store.social.addGrievance({ id: seedFrom(`${g.who}|${g.against}|${g.cause}`), who: g.who, against: g.against, cause_ref: g.cause, weight, since: g.day });
}

/** Amends: every open grievance of `who` against `against` loses a share of its weight; those that fade to nothing are settled. Returns how much was taken. */
export function easeGrievances(store: Pick<WorldStore, "social">, who: string, against: string, share: number, day: number): number {
  let taken = 0;
  for (const g of store.social.openBetween(who, against)) {
    const now = weightOn(g, day);
    const left = now * (1 - share);
    taken += now - left;
    if (left < FADED_BELOW) store.social.settle(g.id, day);
    else store.social.setWeight(g.id, Math.round(left * 100) / 100, day);
  }
  return taken;
}

/** Everything `who` holds against `against` is done with (revenge carried out, or they are dead). */
export function settleAll(store: Pick<WorldStore, "social">, who: string, against: string, day: number): void {
  for (const g of store.social.openBetween(who, against)) store.social.settle(g.id, day);
}

/** The heaviest grievance a person holds open, on a day (the outlook's "grudge" is a view of it). */
export function strongestOf(store: Pick<WorldStore, "social">, who: string, day: number): { g: GrievanceRow; weight: number } | null {
  if (!store.social.hasOpen(who)) return null;
  let best: { g: GrievanceRow; weight: number } | null = null;
  for (const g of store.social.openOf(who)) {
    const weight = weightOn(g, day);
    if (!best || weight > best.weight) best = { g, weight };
  }
  return best;
}
