import { ITEM_TIERS, type ItemTier } from "./items.js";

/** Quests use the same G → SSS tiers as items. */
export type QuestTier = ItemTier;
export const QUEST_TIERS = ITEM_TIERS;

/** Player level needed to take a quest of each tier. */
export const QUEST_TIER_MIN_LEVEL: Record<QuestTier, number> = {
  G: 1, F: 2, E: 3, D: 5, C: 7, B: 10, A: 13, S: 16, SS: 20, SSS: 25,
};

/** XP a quest of each tier is worth. */
export const QUEST_TIER_XP: Record<QuestTier, number> = {
  G: 25, F: 50, E: 100, D: 175, C: 275, B: 400, A: 600, S: 900, SS: 1300, SSS: 2000,
};

/** XP needed to go from `level` to `level + 1`: 50, 100, 150, ... */
export function xpToNextLevel(level: number): number {
  return 50 * level;
}

/** Add XP and level up as many times as it covers. Returns the levels gained. */
export function gainXp(player: { level: number; xp: number }, xp: number): number {
  player.xp += xp;
  let gained = 0;
  while (player.xp >= xpToNextLevel(player.level)) {
    player.xp -= xpToNextLevel(player.level);
    player.level += 1;
    gained += 1;
  }
  return gained;
}

/** Attribute points the player gets per level (spent with /raise: npc/growth.ts). */
export const POINTS_PER_LEVEL = 1;

/** The player gains XP: levels as above, plus an attribute point for each level gained. */
export function playerGainXp(player: { level: number; xp: number; attributePoints?: number }, xp: number): number {
  const gained = gainXp(player, xp);
  if (gained > 0) player.attributePoints = (player.attributePoints ?? 0) + gained * POINTS_PER_LEVEL;
  return gained;
}

/** Beating a creature is worth this share of a quest of its rank. */
export const KILL_XP_SHARE = 0.4;

/**
 * Player XP for beating a creature of `rank`: KILL_XP_SHARE of that rank's quest XP,
 * halved for each rank it's below the player (at least 1). Running it off is worth half.
 */
export function creatureXp(rank: QuestTier, level: number, routed = false): number {
  const below = Math.max(0, QUEST_TIERS.indexOf(rankForLevel(level)) - QUEST_TIERS.indexOf(rank));
  const xp = QUEST_TIER_XP[rank] * KILL_XP_SHARE * 0.5 ** below * (routed ? 0.5 : 1);
  return Math.max(1, Math.round(xp));
}

/** The player's rank, for judging fights as challenges: the highest quest tier their level allows. */
export function rankForLevel(level: number): QuestTier {
  let rank: QuestTier = "G";
  for (const tier of QUEST_TIERS) if (level >= QUEST_TIER_MIN_LEVEL[tier]) rank = tier;
  return rank;
}

export function canTakeQuestTier(level: number, tier: QuestTier): boolean {
  return level >= QUEST_TIER_MIN_LEVEL[tier];
}

/** Compare tiers: negative if a is lower than b. */
export function compareTiers(a: QuestTier, b: QuestTier): number {
  return QUEST_TIERS.indexOf(a) - QUEST_TIERS.indexOf(b);
}
