import { config } from "../../config.js";
import { speciesOf } from "../../world/species.js";
import { ITEM_TIERS, type ItemTier } from "../items.js";
import type { Rng } from "../dice.js";

/**
 * The family rules both pools of people share (N25): the cast's (game/family.ts: talking NPCs with files)
 * and the townsfolk's (game/people/: rows in the database). Pure functions of ages, ids and numbers, so
 * the two can't drift apart. The cast keeps its own nightly pass; only the rules are shared.
 */

/** Whole years lived on `day`. */
export function ageFrom(bornDay: number, day: number): number {
  return Math.max(0, Math.floor((day - bornDay) / config.daysPerYear));
}

/** Is today a birthday (not the day they were born)? */
export function isBirthday(bornDay: number, day: number): boolean {
  return day > bornDay && (day - bornDay) % config.daysPerYear === 0;
}

/** The age a species starts courting: grown, and a couple of years past it (nobody courts the day they come of age). */
export function courtingAgeOf(species: string | undefined): number {
  return speciesOf(species).adultAge + config.family.courtingAfterAdult;
}

/** Old enough to court, wed and have children: never a minor (config.content). */
export function canCourtAt(species: string | undefined, age: number): boolean {
  return age >= courtingAgeOf(species);
}

/** Grown, in the species' own terms. */
export function isGrown(species: string | undefined, age: number): boolean {
  return age >= speciesOf(species).adultAge;
}

/** Too far apart in age to court (config.family.maxAgeGap). */
export function ageGapTooWide(a: number, b: number): boolean {
  return Math.abs(a - b) > config.family.maxAgeGap;
}

/**
 * Are two people close kin? Each is taken with their parents, and up to `generations` of grandparents
 * (1: parents only); they are kin if those sets share anyone: one is the other's parent or grandparent,
 * they share a parent (siblings, half-siblings) or a grandparent (cousins), or one's grandparent is the
 * other's parent (uncle or aunt). `parentsOf` is how to look a person up wherever they live: a cast file,
 * a realm figure or a row of `people`.
 */
export function closeKin(parentsOf: (id: string) => readonly string[], a: string, b: string, generations = 2): boolean {
  if (a === b) return true;
  const ancestry = (id: string): Set<string> => {
    const out = new Set<string>([id]);
    let level = [id];
    for (let g = 0; g < generations; g++) {
      const next: string[] = [];
      for (const x of level) for (const p of parentsOf(x)) if (!out.has(p)) {
        out.add(p);
        next.push(p);
      }
      level = next;
    }
    return out;
  };
  const mine = ancestry(a);
  for (const x of ancestry(b)) if (mine.has(x)) return true;
  return false;
}

// ---- What a child gets from their parents (townsfolk) ----

/** The few traits that matter to the rules for a townsperson; a row keeps them in `traits` as JSON. */
export interface RowTraits {
  ambition: number;
  loyalty: number;
  greed: number;
  bravery: number;
  /** The highest rank they could ever reach (the same letters as items, quests and ranks). */
  potential: ItemTier;
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * A child's traits from two parents' rows, rolled by code. Each trait is the parents' average with a
 * little luck (±0.15), so no child is a copy; potential follows the stronger parent, give or take a rank,
 * never above the species. The order of rolls is fixed: the same parents and stream give the same child.
 */
export function inheritRowTraits(a: RowTraits, b: RowTraits, rng: Rng, species = "human"): RowTraits {
  const mix = (x: number, y: number) => round2(clamp((x + y) / 2 + (rng() - 0.5) * 0.3, 0, 1));
  const ambition = mix(a.ambition, b.ambition);
  const loyalty = mix(a.loyalty, b.loyalty);
  const greed = mix(a.greed, b.greed);
  const bravery = mix(a.bravery, b.bravery);
  const best = Math.max(ITEM_TIERS.indexOf(a.potential), ITEM_TIERS.indexOf(b.potential));
  const cap = ITEM_TIERS.indexOf(speciesOf(species).maxTier);
  const potential = ITEM_TIERS[clamp(best + Math.floor(rng() * 3) - 1, 0, cap)]!;
  return { ambition, loyalty, greed, bravery, potential };
}

/** Traits from a row's JSON, or null if it has none or it isn't sound. */
export function parseRowTraits(cell: string | null | undefined): RowTraits | null {
  if (!cell) return null;
  try {
    const t = JSON.parse(cell) as Partial<RowTraits>;
    if (typeof t.ambition === "number" && typeof t.loyalty === "number" && typeof t.greed === "number" && typeof t.bravery === "number" && ITEM_TIERS.includes(t.potential as ItemTier)) return t as RowTraits;
  } catch {
    // fall through
  }
  return null;
}
