import type { Attributes } from "../npc/stats.js";
import type { PlayerState } from "../npc/types.js";
import type { ItemTier } from "./items.js";
import { QUEST_TIERS, rankForLevel } from "./levels.js";

/**
 * Titles: names earned by deeds, never given by the model. Code awards them
 * when a being overcomes a challenge (game/life.ts) or reaches a high rank.
 * The player earns them from the same table (awardPlayer... below).
 * Some carry a small, permanent bonus. The NPC hears its titles in its
 * situation line, so it can be proud of them.
 */
export interface TitleDef {
  name: string;
  /** What it was earned for, in words. */
  description: string;
  /** Added to attributes for as long as they hold it. */
  bonus?: Partial<Attributes>;
}

export const TITLES = {
  // Deeds
  giant_slayer: { name: "Giant-slayer", description: "beat a foe two or more ranks above them", bonus: { willpower: 1 } },
  death_cheater: { name: "Death-cheater", description: "won a fight on the brink of death", bonus: { endurance: 1 } },
  veteran: { name: "Veteran", description: "won five fights", bonus: { strength: 1 } },
  master_artisan: { name: "Master Artisan", description: "made an A-tier piece or better", bonus: { intelligence: 1 } },
  reliable: { name: "the Reliable", description: "finished five quests", bonus: { charisma: 1 } },
  // Ranks
  rank_A: { name: "the Renowned", description: "reached rank A" },
  rank_S: { name: "the Hero", description: "reached rank S" },
  rank_SS: { name: "the Legend", description: "reached rank SS" },
  rank_SSS: { name: "the Myth", description: "reached rank SSS" },
} as const satisfies Record<string, TitleDef>;
export type TitleId = keyof typeof TITLES;

/** Fights won before a being is a Veteran. */
export const VETERAN_WINS = 5;
/** Quests finished before someone is Reliable. */
export const RELIABLE_QUESTS = 5;
/** Share of max HP at or below which a win counts as cheating death. */
export const NEAR_DEATH_SHARE = 0.15;

/** The title for reaching a rank, if it has one. */
export function rankTitle(tier: ItemTier): TitleId | null {
  const id = `rank_${tier}`;
  return id in TITLES ? (id as TitleId) : null;
}

/** "Giant-slayer, the Hero" */
export function titleNames(titles: Array<{ id: TitleId }>): string {
  return titles.map((t) => TITLES[t.id].name).join(", ");
}

// ---- The player ----

/**
 * Give the player a title once. Its bonus goes straight onto their attributes
 * (titles are never lost). Returns a line for them, or null if they had it.
 */
export function awardPlayerTitle(player: PlayerState, id: TitleId, day: number): string | null {
  player.titles ??= [];
  if (player.titles.some((t) => t.id === id)) return null;
  player.titles.push({ id, day });
  const def: TitleDef = TITLES[id];
  for (const [attr, n] of Object.entries(def.bonus ?? {}) as Array<[keyof Attributes, number]>) {
    player.attributes[attr] = Math.min(20, player.attributes[attr] + n);
  }
  const bonus = Object.entries(def.bonus ?? {}).map(([a, n]) => `+${n} ${a}`);
  return `You earned the title "${def.name}" (${def.description})${bonus.length > 0 ? `: ${bonus.join(", ")}` : ""}.`;
}

/**
 * The player won a fight (the opponent died, ran or begged). `opponentRank` is
 * the NPC's or creature's rank; the player's comes from their level.
 */
export function playerWonFight(player: PlayerState, opponentRank: ItemTier, day: number): string[] {
  player.fightsWon = (player.fightsWon ?? 0) + 1;
  const gap = QUEST_TIERS.indexOf(opponentRank) - QUEST_TIERS.indexOf(rankForLevel(player.level));
  const earned = [
    player.fightsWon >= VETERAN_WINS ? awardPlayerTitle(player, "veteran", day) : null,
    gap >= 2 ? awardPlayerTitle(player, "giant_slayer", day) : null,
    player.hp > 0 && player.hp <= player.maxHp * NEAR_DEATH_SHARE ? awardPlayerTitle(player, "death_cheater", day) : null,
  ];
  return earned.filter((l): l is string => l !== null);
}

/** After quests are handed in or levels gained: Reliable, and the high-rank titles. */
export function playerProgressTitles(player: PlayerState, day: number): string[] {
  const earned = [player.quests.completed.length >= RELIABLE_QUESTS ? awardPlayerTitle(player, "reliable", day) : null];
  const rank = QUEST_TIERS.indexOf(rankForLevel(player.level));
  for (const tier of QUEST_TIERS.slice(0, rank + 1)) {
    const id = rankTitle(tier);
    if (id) earned.push(awardPlayerTitle(player, id, day));
  }
  return earned.filter((l): l is string => l !== null);
}
