import { config } from "../../config.js";
import { speciesOf } from "../../world/species.js";
import { dailyDeathChance } from "../life.js";

/**
 * The numbers behind townsfolk lives (N25), in one place. Each came from running the realm for years
 * (`npm run sim:lives`) until the bounds in balance/bounds hold: a steady population with a sound age pyramid,
 * births and deaths each a few in a hundred a year. A year is `config.daysPerYear` (12) days, so every
 * rule is stated as a chance over a year and turned into a daily one here.
 */
export const LIVES = {
  /** Yearly chance of dying of illness or accident (apart from old age), by age. */
  yearly: { infant: 0.035, child: 0.006, adult: 0.004, middle: 0.01, elder: 0.02 },
  /** Daily chance, for a married woman of child-bearing age with room, to conceive. */
  conception: 0.03,
  /**
   * Most children a couple has. The cast's cap (config.family.maxChildrenPerCouple, 3) is about how many
   * talking NPCs 8 GB can hold; the townsfolk are rows, and a realm of three-child families could not grow.
   */
  maxChildren: 6,
  /** Past this age a woman no longer conceives. */
  fertileUntil: 45,
  /** She dies in childbirth with this chance. */
  childbirthDeath: 0.012,
  /** Daily chance an unmarried adult looks for a match. */
  seeking: 0.02,
  /** How many candidates a seeker meets in a day. */
  meets: 8,
  /** Famine: the daily chance of dying at full famine, before who they are. */
  famineDaily: 0.012,
  /** Crowding (people against what the houses hold) that slows births and raises illness. */
  crowded: 1.5,
  /** Crowding at which nobody conceives. */
  packed: 2.2,
  /** Retire (job becomes "elder") this many years after the species' elder age begins. */
  retireAfterElder: 5,
};

/** Hazard tables by age for one species and year length, built once. */
interface Hazards {
  background: Float64Array;
  old: Float64Array;
}
const tables = new Map<string, Hazards>();

function hazardsFor(species: string): Hazards {
  const key = `${species}|${config.daysPerYear}`;
  let t = tables.get(key);
  if (t) return t;
  const sp = speciesOf(species);
  const top = sp.maxAge + 2;
  const background = new Float64Array(top + 1);
  const old = new Float64Array(top + 1);
  const daily = (yearly: number) => 1 - (1 - yearly) ** (1 / config.daysPerYear);
  for (let age = 0; age <= top; age++) {
    const y = age < 2 ? LIVES.yearly.infant : age < sp.adultAge ? LIVES.yearly.child : age < 45 ? LIVES.yearly.adult : age < sp.elderAge ? LIVES.yearly.middle : LIVES.yearly.elder;
    background[age] = daily(y);
    old[age] = dailyDeathChance(sp, age);
  }
  t = { background, old };
  tables.set(key, t);
  return t;
}

/** The chance of dying of illness or accident on a day, at this age. */
export function backgroundDaily(species: string, age: number): number {
  const t = hazardsFor(species);
  return t.background[Math.min(age, t.background.length - 1)]!;
}

/** The chance of dying of old age on a day, at this age (certain at the species' top age). */
export function oldAgeDaily(species: string, age: number): number {
  const t = hazardsFor(species);
  return t.old[Math.min(age, t.old.length - 1)]!;
}

/** How exposed each class is to hunger: the poor go first. */
export const FAMINE_EXPOSURE: Record<string, number> = { slave: 1.5, serf: 1.2, commoner: 1, artisan: 0.9, merchant: 0.5, clergy: 0.5, gentry: 0.2, noble: 0.1, royal: 0.05 };

/** The chance of dying of hunger on a day: `famine` is 0 (fed) to 1 (starving); the old and very young go first. */
export function famineDaily(famine: number, cls: string, age: number, species: string): number {
  if (famine <= 0) return 0;
  const sp = speciesOf(species);
  const frail = age < 5 || age >= sp.elderAge ? 2 : 1;
  return Math.min(0.5, LIVES.famineDaily * famine * (FAMINE_EXPOSURE[cls] ?? 1) * frail);
}

/** How much a place's conditions scale the daily chance to conceive: prosperous and fed places have more children. */
export function birthMultiplier(prosperity: number, food: number, crowding: number): number {
  if (crowding >= LIVES.packed) return 0;
  const p = Math.max(0.3, Math.min(1.5, prosperity / 50));
  const fed = food >= 30 ? 1 : food >= 12 ? 0.5 : 0.1;
  const room = crowding <= LIVES.crowded ? 1 : 1 - (crowding - LIVES.crowded) / (LIVES.packed - LIVES.crowded);
  return p * fed * room;
}
