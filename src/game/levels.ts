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

export function canTakeQuestTier(level: number, tier: QuestTier): boolean {
  return level >= QUEST_TIER_MIN_LEVEL[tier];
}

/** Compare tiers: negative if a is lower than b. */
export function compareTiers(a: QuestTier, b: QuestTier): number {
  return QUEST_TIERS.indexOf(a) - QUEST_TIERS.indexOf(b);
}
