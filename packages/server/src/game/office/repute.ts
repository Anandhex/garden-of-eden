import { config } from "../../config.js";
import { tierIndex, type Tier } from "../life.js";
import { addRenown } from "../realm/figures.js";
import type { FactionKind, Figure, Realm, Repute } from "../realm/types.js";
import type { WorldStore } from "../db.js";

/**
 * Signed renown (N69 decision 7): one number, -100..100. Above zero a person is famed, below zero infamous, near zero unknown. Where
 * code needs how widely someone is known, it uses **fame** = |renown| (a hated tyrant and a beloved king are both known by everyone).
 * Every reader of renown is one of two kinds:
 *
 * - **sign** (approval): standing for crowns, guilds, orders, associations, cults and the heads of places; a faction's prestige; who
 *   wants to join under a leader; persona words.
 * - **fame**: standing among gangs and rebels (a feared name counts); who becomes a talker; news importance; a follower's weight
 *   in support; who is notable.
 *
 * A leader's **effective** renown is their deeds plus what their followers make of them (`support`, game/office/support.ts).
 */
export const fame = (f: Pick<Figure, "renown">): number => Math.abs(f.renown);

/** Renown with what their followers make of them: what standing, news and persona read. */
export const effective = (f: Pick<Figure, "renown" | "support">): number => Math.max(-100, Math.min(100, Math.round(f.renown + (f.support ?? 0))));

/** Kinds of faction where a feared name counts as much as a good one. */
export const FAME_KINDS: ReadonlySet<FactionKind> = new Set(["gang", "rebels"]);

/**
 * How much a figure counts, for heirs, ranks and splits: their name and their rank. `kind` is the faction they count in (or none: a
 * place's succession). Among gangs and rebels it is fame; everywhere else, approval, so the infamous are passed over.
 */
export function standingIn(f: Figure, kind?: FactionKind): number {
  const name = kind && FAME_KINDS.has(kind) ? Math.abs(effective(f)) : effective(f);
  return name + tierIndex(f.life.tier as Tier) * 8;
}

/** Repute facts of a figure, made on first use. */
export const reputeOf = (f: Figure): Repute => (f.repute ??= {});

/** Keep only the days within the last two years. */
export const lastTwoYears = (days: readonly number[] | undefined, day: number): number[] => (days ?? []).filter((d) => d > day - 2 * config.daysPerYear);

/** Note a deed day on a figure's record (kept for two years). */
export function noteDay(f: Figure, key: "weakRaids" | "built", day: number): void {
  const r = reputeOf(f);
  r[key] = [...lastTwoYears(r[key], day), day];
}

/**
 * Old glory and old shame fade (decision 7): each year, renown above +20 or below −20 moves toward zero, 1 and a fifth of how far past
 * 20 it is (measured 2026-11-02: the plan's 1 a year left a realm's mean renown at 26 after five years, past the bound's 25; a tenth, 25.2).
 */
export function fadeRenown(realm: Realm): void {
  for (const f of Object.values(realm.figures)) {
    if (!f.alive) continue;
    const past = Math.abs(f.renown) - 20;
    if (past > 0) addRenown(f, -Math.sign(f.renown) * (1 + Math.floor(past / 5)));
  }
}

/** The realm owes a townsperson of `site` renown (N69): applied in that place's own day (rows are only changed by their place's step). */
export function oweRenown(realm: Realm, person: string, n: number, site: string, day: number): void {
  if (!n) return;
  owedOf(realm).renown.push({ who: person, site, day, n });
}

/** The realm's debts to townsfolk, made on first use. */
export const owedOf = (realm: Realm): NonNullable<Realm["owed"]> => (realm.owed ??= { renown: [], grievances: [] });

/** Change a townsperson's renown now (in their place's day): a riser's goes to their figure. */
export function addRowRenown(realm: Realm, store: WorldStore, id: string, n: number): void {
  if (!n) return;
  const r = store.people.get(id);
  if (!r || r.death !== null) return;
  if (r.figure && realm.figures[r.figure]) addRenown(realm.figures[r.figure]!, n);
  else store.people.update(id, { renown: Math.max(-100, Math.min(100, Math.round((r.renown ?? 0) + n))) });
}

/** Words for a name: "famed", "well thought of", "little known", "ill spoken of", "infamous". */
export function nameWords(renown: number): string {
  if (renown >= 50) return "famed";
  if (renown >= 15) return "well thought of";
  if (renown > -15) return "little known";
  if (renown > -50) return "ill spoken of";
  return "infamous";
}
