import { config } from "../config.js";
import { ATTRIBUTES, type Attributes, type NpcStats } from "../npc/stats.js";
import { minTier, type SpeciesDef } from "../world/species.js";
import type { Rng } from "./dice.js";
import { ITEM_TIERS, type ItemTier } from "./items.js";
import { NEAR_DEATH_SHARE, rankTitle, type TitleId, TITLES, titleNames, VETERAN_WINS } from "./titles.js";

export { NEAR_DEATH_SHARE };

/**
 * The life of any being: talking NPCs and creatures alike. Code owns all of it.
 *
 * - **Rank** (tier G → SSS, the same letters as items and quests). Not everyone
 *   grows: each individual has a `potential`, the highest rank they will ever
 *   reach (many are already there). Below it, XP from living, working, teaching
 *   and fighting only makes them *ready*; to rise they must then **overcome a
 *   challenge** at least their own rank: beat a peer or better in a fight, or
 *   make a piece of that tier (overcome()). Rising adds HP and attribute points.
 * - **Titles** (game/titles.ts), earned by deeds: some add a small bonus.
 * - **Age**, from the day they were born and config.daysPerYear. Age stage
 *   (young / adult / elder / venerable) changes stats and how fast they learn.
 * - **Natural death**: past their species' elder age, a roll each midnight that
 *   grows likelier with age, and is certain at maxAge.
 *
 * The authored stats in an NPC or creature file are their starting point;
 * effectiveStats() adds growth and age on top.
 */
export type Tier = ItemTier;
export const TIERS = ITEM_TIERS;

export const AGE_STAGES = ["young", "adult", "elder", "venerable"] as const;
export type AgeStage = (typeof AGE_STAGES)[number];

export interface Life {
  tier: Tier;
  /** Highest rank they can ever reach (already capped by species). At it, they stop growing. */
  potential: Tier;
  /** XP toward the next rank. Stops at the amount needed: then they need a challenge. */
  xp: number;
  /** Game day of birth (usually before day 1). */
  bornOnDay: number;
  /** Stat gains from rising in rank, on top of the authored stats. */
  growth: { maxHp: number; maxMp: number; attributes: Partial<Attributes> };
  /** Age stage as of the last daily tick. Stage effects use this, so stats don't need the clock. */
  stage: AgeStage;
  titles: Array<{ id: TitleId; day: number }>;
  /** Fights won, for the Veteran title. */
  fightsWon: number;
}

/** What a being's growth depends on that isn't in its Life. */
export interface LifeContext {
  species: SpeciesDef;
  /** Authored stats: the base growth is added to. */
  base: NpcStats;
}

/**
 * Something hard a being got through. Only these raise a rank, and only if it
 * was at least their own rank. The game detects them in code; the model can't claim one.
 */
export interface Challenge {
  /** fight: won against someone; craft: made a piece; hunt: a hunt or raid that worked; survival: got through a hardship. */
  kind: "fight" | "craft" | "hunt" | "survival";
  /** How hard it was: the opponent's or prey's rank, the tier of the piece made, or their own rank for a hardship. */
  rank: Tier;
  /** Fights: they won at or below NEAR_DEATH_SHARE of their max HP. */
  nearDeath?: boolean;
  /** "beating Traveler in a fight", for the log and their memory. */
  what: string;
}

/** Per stage: attribute changes, share of max HP, and XP rate. */
export const STAGE_EFFECTS: Record<AgeStage, { attributes: Partial<Attributes>; hpShare: number; learnRate: number }> = {
  young: { attributes: { strength: -3, endurance: -2 }, hpShare: 0.7, learnRate: 1.5 },
  adult: { attributes: {}, hpShare: 1, learnRate: 1 },
  elder: { attributes: { strength: -2, agility: -2, endurance: -2, intelligence: 1, willpower: 1 }, hpShare: 0.85, learnRate: 0.5 },
  venerable: { attributes: { strength: -4, agility: -4, endurance: -4, intelligence: 1, willpower: 2 }, hpShare: 0.6, learnRate: 0.25 },
};

/** XP everyone gains just for living through a day. */
export const DAILY_XP = 2;
/** XP for common deeds. Code calls gainXp with these; the model never does. XP alone never raises a rank. */
export const XP = {
  /** Per item tier step of the output, +1 (a [G] item gives 4, an [E] item 12). */
  craftPerTier: 4,
  villageSale: 1,
  teachPerHour: 2,
  winFight: 30,
  surviveFight: 10,
} as const;
/** Max HP gained per rank, as a share of authored max HP (at least 2). */
export const TIER_HP_SHARE = 0.1;

/** XP needed to rise from `tier` to the next: 100 for G → F, 200 for F → E, ... */
export function xpToNextTier(tier: Tier): number {
  return 100 * (TIERS.indexOf(tier) + 1);
}

export function tierIndex(tier: Tier): number {
  return TIERS.indexOf(tier);
}

/** Highest rank this individual can reach. */
export function tierCap(life: Pick<Life, "potential">, species: SpeciesDef): Tier {
  return minTier(life.potential, species.maxTier);
}

/** At their potential: they'll never rise again. */
export function atPeak(life: Life, species: SpeciesDef): boolean {
  return tierIndex(life.tier) >= tierIndex(tierCap(life, species));
}

/** Enough XP for the next rank; they need to overcome a challenge to break through. */
export function isReady(life: Life, species: SpeciesDef): boolean {
  return !atPeak(life, species) && life.xp >= xpToNextTier(life.tier);
}

/** Whole years lived on `day`. */
export function ageOn(life: Pick<Life, "bornOnDay">, day: number): number {
  return Math.max(0, Math.floor((day - life.bornOnDay) / config.daysPerYear));
}

export function ageStage(species: SpeciesDef, age: number): AgeStage {
  if (age < species.adultAge) return "young";
  if (age < species.elderAge) return "adult";
  if (age < (species.elderAge + species.maxAge) / 2) return "elder";
  return "venerable";
}

/**
 * A new life: `age` years old on `day`, at rank `tier`, never rising past
 * `potential` (or their species' cap). A potential below `tier` means they're at their peak.
 */
export function createLife(species: SpeciesDef, age: number, tier: Tier, day = 1, potential: Tier = species.maxTier): Life {
  const capped = minTier(potential, species.maxTier);
  return {
    tier,
    potential: tierIndex(capped) < tierIndex(tier) ? tier : capped,
    xp: 0,
    bornOnDay: day - age * config.daysPerYear,
    growth: { maxHp: 0, maxMp: 0, attributes: {} },
    stage: ageStage(species, age),
    titles: [],
    fightsWon: 0,
  };
}

const clampAttr = (n: number) => Math.max(1, Math.min(20, n));

/** Authored stats plus rank growth, title bonuses and age. */
export function effectiveStats(base: NpcStats, life: Life): NpcStats {
  const stage = STAGE_EFFECTS[life.stage];
  const attributes = { ...base.attributes };
  for (const a of ATTRIBUTES) {
    const titles = life.titles.reduce((sum, t) => sum + ((TITLES[t.id] as { bonus?: Partial<Attributes> }).bonus?.[a] ?? 0), 0);
    attributes[a] = clampAttr(base.attributes[a] + (life.growth.attributes[a] ?? 0) + titles + (stage.attributes[a] ?? 0));
  }
  return {
    maxHp: Math.max(1, Math.round((base.maxHp + life.growth.maxHp) * stage.hpShare)),
    maxMp: base.maxMp + life.growth.maxMp,
    attributes,
  };
}

/** Rise one rank: more HP (and MP if they have any), and +1 to their two best attributes. */
function rankUp(life: Life, base: NpcStats): void {
  life.tier = TIERS[tierIndex(life.tier) + 1]!;
  life.growth.maxHp += Math.max(2, Math.round(base.maxHp * TIER_HP_SHARE));
  if (base.maxMp > 0) life.growth.maxMp += Math.max(1, Math.round(base.maxMp * TIER_HP_SHARE));
  const current = (a: (typeof ATTRIBUTES)[number]) => base.attributes[a] + (life.growth.attributes[a] ?? 0);
  const best = ATTRIBUTES.filter((a) => current(a) < 20)
    .sort((a, b) => current(b) - current(a))
    .slice(0, 2);
  for (const a of best) life.growth.attributes[a] = (life.growth.attributes[a] ?? 0) + 1;
}

/**
 * Add XP, scaled by species and age. XP stops at what the next rank needs:
 * from there only a challenge (overcome) raises them. At their peak XP stays 0.
 * Returns true if this gain made them ready to break through.
 */
export function gainXp(life: Life, ctx: LifeContext, xp: number): boolean {
  if (atPeak(life, ctx.species)) {
    life.xp = 0;
    return false;
  }
  if (xp <= 0) return false;
  const need = xpToNextTier(life.tier);
  const wasReady = life.xp >= need;
  life.xp = Math.min(need, Math.round((life.xp + xp * ctx.species.learnRate * STAGE_EFFECTS[life.stage].learnRate) * 100) / 100);
  return !wasReady && life.xp >= need;
}

/** Give a title once. Returns true if it's new. */
function award(life: Life, id: TitleId, day: number): boolean {
  if (life.titles.some((t) => t.id === id)) return false;
  life.titles.push({ id, day });
  return true;
}

export interface Overcome {
  /** Lines for the log. */
  log: string[];
  /** The rank they broke through to, if they did. */
  rose: Tier | null;
  /** Titles earned. */
  titles: TitleId[];
}

/**
 * They got through a challenge. Earns any titles it deserves; and if they were
 * ready and the challenge was at least their own rank, they break through to the next rank.
 */
export function overcome(name: string, life: Life, ctx: LifeContext, challenge: Challenge, day: number): Overcome {
  const titles: TitleId[] = [];
  const gap = tierIndex(challenge.rank) - tierIndex(life.tier);
  if (challenge.kind === "fight") {
    life.fightsWon += 1;
    if (life.fightsWon >= VETERAN_WINS && award(life, "veteran", day)) titles.push("veteran");
    if (gap >= 2 && award(life, "giant_slayer", day)) titles.push("giant_slayer");
    if (challenge.nearDeath && award(life, "death_cheater", day)) titles.push("death_cheater");
  }
  if (challenge.kind === "craft" && tierIndex(challenge.rank) >= tierIndex("A") && award(life, "master_artisan", day)) {
    titles.push("master_artisan");
  }

  let rose: Tier | null = null;
  if (isReady(life, ctx.species) && gap >= 0) {
    rankUp(life, ctx.base);
    life.xp = 0;
    rose = life.tier;
    const title = rankTitle(rose);
    if (title && award(life, title, day)) titles.push(title);
  }

  const log: string[] = [];
  if (rose) log.push(`${name} broke through to rank ${rose} by ${challenge.what}.`);
  for (const id of titles) log.push(`${name} earned the title "${TITLES[id].name}".`);
  return { log, rose, titles };
}

/**
 * Chance of dying of old age on one day. 0 before elder age, 1 from maxAge.
 * In between, the yearly chance is ((age - elder) / (max - elder))², spread over the year's days.
 */
export function dailyDeathChance(species: SpeciesDef, age: number): number {
  if (age < species.elderAge) return 0;
  if (age >= species.maxAge) return 1;
  const yearly = ((age - species.elderAge) / (species.maxAge - species.elderAge)) ** 2;
  return 1 - (1 - yearly) ** (1 / config.daysPerYear);
}

export interface DayResult {
  age: number;
  /** Set when the age stage changed today. */
  newStage: AgeStage | null;
  /** Today's XP made them ready for a breakthrough. */
  ready: boolean;
  /** Died of old age today. */
  died: boolean;
}

/** A new day (run at midnight): age, a day's XP, and the natural-death roll. */
export function liveDay(life: Life, ctx: LifeContext, day: number, rng: Rng): DayResult {
  const age = ageOn(life, day);
  const stage = ageStage(ctx.species, age);
  const newStage = stage !== life.stage ? stage : null;
  life.stage = stage;
  const ready = gainXp(life, ctx, DAILY_XP);
  const died = rng() < dailyDeathChance(ctx.species, age);
  return { age, newStage, ready, died };
}

/**
 * A new day for anyone, with lines for the log: readiness, growing old, and
 * dying in their sleep. The caller marks them dead if `died`.
 */
export function newDay(name: string, life: Life, ctx: LifeContext, day: number, rng: Rng): DayResult & { log: string[] } {
  const result = liveDay(life, ctx, day, rng);
  const log: string[] = [];
  if (result.ready) log.push(`${name} is ready for a breakthrough to rank ${TIERS[tierIndex(life.tier) + 1]}.`);
  if (result.newStage === "adult") log.push(`${name} has come of age (${result.age}).`);
  if (result.newStage === "elder") log.push(`${name} is starting to feel their age (${result.age}).`);
  if (result.newStage === "venerable") log.push(`${name} has grown frail with age (${result.age}).`);
  if (result.died) log.push(`${name} died in their sleep, aged ${result.age}.`);
  return { ...result, log };
}

const STAGE_WORDS: Record<AgeStage, string> = { young: "young", adult: "", elder: "getting old", venerable: "very old" };

/** "34-year-old human, rank C" / "67-year-old human (getting old), rank E, known as Veteran". */
export function describeLife(speciesName: string, life: Life, day: number): string {
  const stage = STAGE_WORDS[life.stage];
  const kind = speciesName.replace(/^an? /, "");
  const known = life.titles.length > 0 ? `, known as ${titleNames(life.titles)}` : "";
  return `${ageOn(life, day)}-year-old ${kind}${stage ? ` (${stage})` : ""}, rank ${life.tier}${known}`;
}

/** "at their peak", "ready for a breakthrough to B", "growing (40/500 XP)". */
export function growthStatus(life: Life, species: SpeciesDef): string {
  if (atPeak(life, species)) return "at their peak";
  const next = TIERS[tierIndex(life.tier) + 1];
  if (isReady(life, species)) return `ready for a breakthrough to ${next}`;
  return `growing toward ${next} (${Math.floor(life.xp)}/${xpToNextTier(life.tier)} XP)`;
}

/** Fill fields a life saved by an older version lacks. */
export function upgradeLife(saved: Partial<Life>, fresh: Life): Life {
  return { ...fresh, ...saved, potential: saved.potential ?? fresh.potential, titles: saved.titles ?? [], fightsWon: saved.fightsWon ?? 0 };
}
