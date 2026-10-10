import { SKILLS, type Skill, skillLevel, TIERS } from "../npc/skills.js";
import type { NpcPersona, NpcState, WorldSnapshot } from "../npc/types.js";
import { advanceTime } from "./clock.js";
import { effectiveGreed, payDebts } from "./debts.js";
import { isTooHurtToWork } from "./healing.js";

/**
 * Training: the player learns a skill from an NPC, one hour at a time.
 * - The NPC can only teach up to their own level in that skill, and only as far
 *   as they trust the player (TRUST_FOR_TIER).
 * - Each level takes longer: reaching tier N takes HOURS_PER_TIER * N hours
 *   (novice 4h, apprentice 8h, adept 12h, expert 16h, master 20h).
 * - Each hour costs FEE_PER_TIER * (tier being worked toward) gold, marked up by
 *   the NPC's greed when trust is low.
 * - Progress carries over between sessions; the world clock moves forward.
 *
 * quoteTraining() works out hours and cost without changing anything, so the
 * player can be asked to confirm; train() does the same and applies it.
 */
export const HOURS_PER_TIER = 4;
export const DEFAULT_SESSION_HOURS = 2;
export const MAX_SESSION_HOURS = 8;
/** Gold per hour per tier being taught: 5/h toward novice ... 25/h toward master. */
export const FEE_PER_TIER = 5;
/** Trust needed before the NPC will teach each tier (index = tier). */
export const TRUST_FOR_TIER = [0, 0, 0, 20, 40, 60] as const;
/** Trust gained per session: time spent together. */
const TRUST_PER_SESSION = 2;

/** Hours of training needed to go from `level` to `level + 1`. */
export function hoursToNextLevel(level: number): number {
  return HOURS_PER_TIER * (level + 1);
}

/** The highest tier the NPC is willing to teach at this trust level. */
export function trustCap(relationship: number): number {
  let cap = 0;
  for (let tier = 1; tier < TRUST_FOR_TIER.length; tier++) {
    if (relationship >= TRUST_FOR_TIER[tier]!) cap = tier;
  }
  return cap;
}

/**
 * Gold per hour for working toward `tier`. Greedy NPCs (greed up to 1) mark it up
 * when trust is low: at trust 0 a fully greedy NPC charges double; at trust 100, list price.
 * Uses the NPC's current greed, which drops once their debts are paid (effectiveGreed).
 */
export function feePerHour(persona: NpcPersona, state: NpcState, tier: number): number {
  const trustShare = Math.max(0, Math.min(100, state.relationship)) / 100;
  const markup = 1 + effectiveGreed(persona, state) * (1 - trustShare);
  return Math.ceil(FEE_PER_TIER * tier * markup);
}

const label = (skill: Skill) => skill.replace("_", "-");

/** Accepts "two-handed", "Two Handed", "two_handed". Returns null if it isn't a skill. */
export function parseSkill(name: string): Skill | null {
  const key = name.trim().toLowerCase().replace(/[\s-]+/g, "_");
  return (SKILLS as readonly string[]).includes(key) ? (key as Skill) : null;
}

/**
 * The one skill an NPC teaches: `teaches` if set, otherwise their best skill
 * (ties go to the earlier skill in SKILLS). Brena: smithing. Pell: haggling.
 */
export function trainerSkill(persona: NpcPersona): Skill | undefined {
  if (persona.teaches) return persona.teaches;
  let best: Skill | undefined;
  for (const s of SKILLS) {
    if (skillLevel(persona.skills, s) > (best ? skillLevel(persona.skills, best) : 0)) best = s;
  }
  return best;
}

/** What this NPC could still teach the player (ignoring trust): their one skill, if the player is below them. */
export function teachableSkills(persona: NpcPersona, world: WorldSnapshot): Array<{ skill: Skill; upTo: number }> {
  const skill = trainerSkill(persona);
  if (!skill) return [];
  const upTo = skillLevel(persona.skills, skill);
  return upTo > skillLevel(world.player.skills, skill) ? [{ skill, upTo }] : [];
}

export interface TrainingQuote {
  ok: boolean;
  /** Why not, if !ok. Otherwise a summary like "2h of smithing for 10 gold". */
  message: string;
  hours: number;
  cost: number;
  /** The level the player would be at, and progress toward the next. */
  endLevel: number;
  endProgress: number;
  /** Highest level this NPC will take the player to right now. */
  cap: number;
  /** Set when trust, not the NPC's own skill, is what limits the cap. */
  limitedByTrust: boolean;
}

function refusal(persona: NpcPersona, state: NpcState): string | null {
  if (state.outcome || state.inCombat) return `${persona.name} is in no state to teach anyone.`;
  if (isTooHurtToWork(persona, state)) return `${persona.name} is too badly hurt to teach until they've healed.`;
  if (state.mood === "angry") return `${persona.name} is too angry to teach you.`;
  if (state.relationship < 0) return `${persona.name} won't teach you; there's no goodwill between you.`;
  return null;
}

/**
 * Work out a session of up to `hours` without changing anything. Stops early
 * at the cap or when the player runs out of gold for the next hour.
 */
export function quoteTraining(
  persona: NpcPersona,
  state: NpcState,
  world: WorldSnapshot,
  skill: Skill,
  hours: number = DEFAULT_SESSION_HOURS,
): TrainingQuote {
  const player = world.player;
  const start = skillLevel(player.skills, skill);
  const progress0 = player.skillProgress[skill] ?? 0;
  const teacherLevel = skillLevel(persona.skills, skill);
  const byTrust = trustCap(state.relationship);
  const cap = Math.min(teacherLevel, byTrust);
  const limitedByTrust = byTrust < teacherLevel;
  const fail = (message: string): TrainingQuote => ({
    ok: false, message, hours: 0, cost: 0, endLevel: start, endProgress: progress0, cap, limitedByTrust,
  });

  const blocked = refusal(persona, state);
  if (blocked) return fail(blocked);
  const specialty = trainerSkill(persona);
  if (skill !== specialty) {
    return fail(specialty ? `${persona.name} only teaches ${label(specialty)}.` : `${persona.name} doesn't teach.`);
  }
  if (teacherLevel === 0) return fail(`${persona.name} doesn't know ${label(skill)}.`);
  if (start >= teacherLevel) {
    return fail(`You've learned all ${persona.name} can teach about ${label(skill)} (${TIERS[teacherLevel]}).`);
  }
  if (start >= cap) {
    const needed = TRUST_FOR_TIER[start + 1]!;
    return fail(
      `${persona.name} won't teach you ${TIERS[start + 1]} ${label(skill)} yet. ` +
        `That takes more trust (${state.relationship} now, ${needed} needed).`,
    );
  }

  hours = Math.max(1, Math.min(MAX_SESSION_HOURS, Math.floor(hours)));
  let level = start;
  let progress = progress0;
  let spent = 0;
  let cost = 0;
  while (spent < hours && level < cap) {
    const fee = feePerHour(persona, state, level + 1);
    if (cost + fee > player.gold) break;
    cost += fee;
    spent += 1;
    progress += 1;
    if (progress >= hoursToNextLevel(level)) {
      progress = 0;
      level += 1;
    }
  }

  if (spent === 0) {
    const fee = feePerHour(persona, state, start + 1);
    return fail(`One hour of ${label(skill)} with ${persona.name} costs ${fee} gold; you have ${player.gold}.`);
  }
  return {
    ok: true,
    message: `${spent}h of ${label(skill)} for ${cost} gold`,
    hours: spent,
    cost,
    endLevel: level,
    endProgress: progress,
    cap,
    limitedByTrust,
  };
}

export interface TrainingResult {
  ok: boolean;
  /** For the player (and the NPC, as an event). */
  message: string;
  hoursSpent: number;
  cost: number;
  levelsGained: number;
}

/**
 * Train `skill` with the NPC for up to `hours`: charges the player, raises
 * their skill, moves the clock, and nudges trust. Stops early at the cap or
 * when gold runs out (see quoteTraining).
 */
export function train(
  persona: NpcPersona,
  state: NpcState,
  world: WorldSnapshot,
  skill: Skill,
  hours: number = DEFAULT_SESSION_HOURS,
): TrainingResult {
  const quote = quoteTraining(persona, state, world, skill, hours);
  if (!quote.ok) return { ok: false, message: quote.message, hoursSpent: 0, cost: 0, levelsGained: 0 };

  const player = world.player;
  const start = skillLevel(player.skills, skill);
  player.gold -= quote.cost;
  state.gold += quote.cost;
  payDebts(persona, state); // quietly, never told to the model
  if (quote.endLevel > 0) player.skills[skill] = quote.endLevel;
  player.skillProgress[skill] = quote.endProgress;
  advanceTime(world, quote.hours);
  state.relationship = Math.min(100, state.relationship + TRUST_PER_SESSION);

  const level = quote.endLevel;
  const gained = level - start;
  let status: string;
  if (level >= skillLevel(persona.skills, skill)) {
    status = `${player.name} is now ${TIERS[level]} at ${label(skill)}, as far as you can take them.`;
  } else if (level >= quote.cap) {
    status = `${player.name} is now ${TIERS[level]} at ${label(skill)}. You won't teach them more until you trust them more.`;
  } else {
    status = `${player.name} is ${TIERS[level]} at ${label(skill)} (${quote.endProgress}/${hoursToNextLevel(level)} hours toward ${TIERS[level + 1]}).`;
  }
  const message =
    `${player.name} paid you ${quote.cost} gold and trained ${label(skill)} with you for ${quote.hours} hour${quote.hours === 1 ? "" : "s"}.` +
    (gained > 0 ? " They improved!" : "") +
    ` ${status}`;
  return { ok: true, message, hoursSpent: quote.hours, cost: quote.cost, levelsGained: gained };
}

/** Does the player's line sound like asking for training? */
export function isTrainingTalk(line: string): boolean {
  return /\b(train|training|teach|teaching|lessons?|learn|learning|apprentice|mentor|show me how)\b/i.test(line);
}

/**
 * For the model, on training turns: what this NPC can teach right now, with the
 * hourly price and the trust limit worked out in code. Null if nothing to teach.
 */
export function describeTeaching(persona: NpcPersona, state: NpcState, world: WorldSnapshot): string | null {
  const teachable = teachableSkills(persona, world);
  if (teachable.length === 0) return null;
  const byTrust = trustCap(state.relationship);
  const now: string[] = [];
  const later: string[] = [];
  for (const { skill, upTo } of teachable) {
    const next = skillLevel(world.player.skills, skill) + 1;
    const fee = feePerHour(persona, state, next);
    if (next <= byTrust) now.push(`${label(skill)} (to ${TIERS[Math.min(upTo, byTrust)]}, ${fee} gold/hour)`);
    else later.push(`${label(skill)} (needs trust ${TRUST_FOR_TIER[next]})`);
  }
  return (
    `You teach one thing for pay: your trade. You could teach them now: ${now.join(", ") || "nothing yet"}.` +
    (later.length > 0 ? ` Not until you trust them more: ${later.join(", ")}.` : "") +
    ` They have ${world.player.gold} gold.`
  );
}
