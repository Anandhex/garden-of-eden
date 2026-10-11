import { config } from "../config.js";
import { tierIndex, type Tier } from "../game/life.js";
import { rankForLevel } from "../game/levels.js";
import { formatMoney } from "../game/money.js";
import type { Traits } from "./traits.js";
import type { NpcPersona, NpcState, PlayerState } from "./types.js";

/**
 * Relationships (N5, N5.6): four axes instead of one, each used by different rules.
 * - trust (`relationship`): do they believe you? Secrets, gifts and training need it.
 * - fear: are they scared of you? Intimidation, attacks and your rank raise it. Discounts from intimidation need it.
 * - respect: do they rate you? Finished quests, skill and rank raise it. High-tier quests and master training need it.
 * - affection: do they like you? Time together, gifts they love and help raise it. Friendship and romance need it.
 * Grudges (being attacked) block trade and training until they fade or the player makes amends.
 */
export const AXES = ["trust", "fear", "respect", "affection"] as const;
export type Axis = (typeof AXES)[number];

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/** Change one axis by `delta`, within its range (fear 0..100, the rest -100..100). */
export function adjust(state: NpcState, axis: Axis, delta: number): void {
  if (axis === "trust") state.relationship = clamp(state.relationship + delta, -100, 100);
  else if (axis === "fear") state.fear = clamp(state.fear + delta, 0, 100);
  else if (axis === "respect") state.respect = clamp(state.respect + delta, -100, 100);
  else state.affection = clamp(state.affection + delta, -100, 100);
}

/** How many ranks the player stands above the NPC (negative when below). */
export function rankGap(player: Pick<PlayerState, "level">, npcTier: Tier): number {
  return tierIndex(rankForLevel(player.level)) - tierIndex(npcTier);
}

/** Fear right now: what they feel, plus 10 for each rank the player stands above them. */
export function fearOf(state: Pick<NpcState, "fear" | "life">, player: Pick<PlayerState, "level">): number {
  return clamp(state.fear + 10 * Math.max(0, rankGap(player, state.life.tier)), 0, 100);
}

/** Respect right now: what they feel, plus 5 per rank the player stands above them. */
export function respectOf(state: Pick<NpcState, "respect" | "life">, player: Pick<PlayerState, "level">): number {
  return clamp(state.respect + 5 * Math.max(0, rankGap(player, state.life.tier)), -100, 100);
}

/** Fear needed before a won intimidation gets a discount. */
export const FEAR_FOR_DISCOUNT = 20;

/** Fear a won intimidation adds: 40 for the most cowardly, 10 for the bravest. */
export function intimidationFear(t: Pick<Traits, "bravery">): number {
  return Math.round(10 + 30 * (1 - t.bravery));
}

/** Respect needed to be taught each skill tier (index = tier): expert and master take respect, not just trust. */
export const RESPECT_FOR_TIER = [0, 0, 0, 0, 15, 30] as const;

/** Respect needed for a quest of a tier: C and up are only given to someone they rate. */
export function respectForQuestTier(tier: Tier): number {
  const at = tierIndex(tier);
  return at < tierIndex("C") ? 0 : 10 * (at - tierIndex("C") + 1);
}

/** Respect a finished quest earns: 10, more for harder work. */
export function questRespect(tier: Tier): number {
  return 10 + 2 * Math.max(0, tierIndex(tier) - tierIndex("E"));
}

/** Each night fear fades by this much. */
export const FEAR_FADE_PER_DAY = 5;

// ---- Grudges ----

/** Days a grudge lasts before it fades on its own: 2 for the most forgiving, 10 for the most grudge-holding. */
export function grudgeDays(t: Pick<Traits, "forgiveness">): number {
  return Math.round(2 + 8 * (1 - t.forgiveness));
}

/** Start (or renew) a grudge. */
export function setGrudge(state: NpcState, t: Pick<Traits, "forgiveness">, reason: string, day: number): void {
  state.grudge = { reason, day, until: day + grudgeDays(t) };
}

/** Is a grudge holding today? An expired one is cleared. */
export function holdsGrudge(state: NpcState, day: number): boolean {
  if (state.grudge && day >= state.grudge.until) state.grudge = null;
  return state.grudge !== null;
}

/** The fine an NPC asks to settle a grudge: 1 gold, plus more from the greedy. */
export function amendsFine(persona: Pick<NpcPersona, "greed">): number {
  return Math.round(100 * (1 + persona.greed));
}

/** The grudge is settled (amends paid, a gift, a quest): it's gone and some trust comes back. */
export function settleGrudge(state: NpcState): void {
  state.grudge = null;
  state.pendingAmends = null;
  adjust(state, "trust", 10);
}

export const GRUDGE_REFUSAL = "You hold a grudge against them. You won't trade with them or teach them until they make amends.";

// ---- Friendship and romance (N5.6) ----

export const FRIENDSHIP = ["stranger", "acquaintance", "friend", "close friend"] as const;
export type Friendship = (typeof FRIENDSHIP)[number];

/** Affection and trust each friendship stage needs. */
const STAGES: Array<{ stage: Friendship; affection: number; trust: number }> = [
  { stage: "close friend", affection: 60, trust: 50 },
  { stage: "friend", affection: 30, trust: 20 },
  { stage: "acquaintance", affection: 0, trust: -10 },
];

export function friendshipOf(state: Pick<NpcState, "affection" | "relationship" | "metBefore">): Friendship {
  if (!state.metBefore) return "stranger";
  return STAGES.find((s) => state.affection >= s.affection && state.relationship >= s.trust)?.stage ?? "stranger";
}

/** Percent off for friends: 10% for a friend, 15% for a close friend. */
export function friendDiscount(state: Pick<NpcState, "affection" | "relationship" | "metBefore">): number {
  const stage = friendshipOf(state);
  return stage === "close friend" ? 15 : stage === "friend" ? 10 : 0;
}

/** Affection each kind of shared moment adds. */
export const AFFECTION = { talk: 1, gift: 2, lovedGift: 8, quest: 5, insult: -5, betrayal: -15, attack: -30 } as const;
/** Talking adds affection at most this many times a day (time spent together). */
export const TALK_AFFECTION_PER_DAY = 3;

export const ROMANCE_STAGES = ["none", "interested", "courting", "partners"] as const;

/**
 * Can this NPC's romance be pursued at all? Only when the player turned romance on
 * (config.content.romance), the NPC is open to it, and they are not a minor.
 * Every romance rule goes through this, so nothing reaches a minor (design rule 7).
 */
export function romanceAllowed(persona: Pick<NpcPersona, "minor" | "romance">): boolean {
  return config.content.romance && persona.minor !== true && persona.romance?.open === true;
}

/** The romance stage the relationship has reached, from affection and trust. 0 when not allowed. */
export function romanceStageFor(persona: Pick<NpcPersona, "minor" | "romance">, state: Pick<NpcState, "affection" | "relationship">): number {
  if (!romanceAllowed(persona)) return 0;
  const a = persona.romance!.minAffection ?? 50;
  const t = persona.romance!.minTrust ?? 40;
  if (state.affection >= a + 30 && state.relationship >= t + 30) return 3;
  if (state.affection >= a + 15 && state.relationship >= t + 15) return 2;
  if (state.affection >= a && state.relationship >= t) return 1;
  return 0;
}

/** May the player attack this NPC? A minor can't be, unless the content rules allow it. */
export function canBeAttacked(persona: Pick<NpcPersona, "minor">): boolean {
  return persona.minor !== true || config.content.minorsCanBeAttacked;
}

// ---- Words for the model ----

/** One line on how they see the player beyond trust, or null when there's nothing notable. */
export function describeBond(persona: Pick<NpcPersona, "minor" | "romance">, state: NpcState, player: PlayerState): string | null {
  const parts: string[] = [];
  const fear = fearOf(state, player);
  if (fear >= 50) parts.push("they frighten you");
  else if (fear >= 20) parts.push("they make you a little nervous");
  const respect = respectOf(state, player);
  if (respect >= 30) parts.push("you respect them");
  else if (respect <= -20) parts.push("you look down on them");
  const stage = friendshipOf(state);
  if (stage === "close friend") parts.push("they're a close friend");
  else if (stage === "friend") parts.push("you count them a friend");
  else if (state.affection <= -20) parts.push("you don't like them");
  const romance = romanceStageFor(persona, state);
  if (romance > 0) parts.push(romance === 1 ? "you're drawn to them" : romance === 2 ? "you're courting them" : "you're together");
  if (parts.length === 0) return null;
  return `Also: ${parts.join(", ")}.`;
}

/** The grudge as a situation line, with the fine to settle it if one was named. */
export function describeGrudge(state: NpcState, day: number): string | null {
  if (!holdsGrudge(state, day)) return null;
  const fine = state.pendingAmends ? ` You told them it'll cost ${formatMoney(state.pendingAmends.fine)} to make it right.` : "";
  return `You hold a grudge: ${state.grudge!.reason}. No trade or teaching until they make amends.${fine}`;
}
