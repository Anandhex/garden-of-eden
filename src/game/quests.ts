import type { ActiveQuest, NpcPersona, NpcState, PlayerState, QuestDef, WorldSnapshot } from "../npc/types.js";
import { countItem, craftingNeeds, removeItem } from "./crafting.js";
import { ITEMS, itemKey } from "./items.js";
import {
  canTakeQuestTier,
  compareTiers,
  gainXp,
  QUEST_TIER_MIN_LEVEL,
  QUEST_TIER_XP,
  type QuestTier,
} from "./levels.js";

/**
 * Quests. An NPC's quests come from two places: written ones in their file
 * (persona.quests) and ones made from their needs (state.questBoard, e.g.
 * "short of iron ore"). Who sees what is decided in code:
 * - hidden entirely until the NPC trusts the player enough (minTrust),
 * - never above the NPC's maxQuestTier,
 * - known but refused if the player's level is too low for the tier.
 */

const DEFAULT_QUEST_TRUST = 5;

/** Does the player's line sound like asking for work? */
export function isQuestTalk(line: string): boolean {
  return /\b(quests?|work|jobs?|tasks?|errands?|bounty|need (any )?help|help you|anything I can do)\b/i.test(line);
}

/** Tier for a need quest, from the gold value of what's asked. */
function tierForValue(value: number): QuestTier {
  const bands: Array<[number, QuestTier]> = [[10, "G"], [25, "F"], [50, "E"], [100, "D"], [200, "C"], [400, "B"], [800, "A"], [1600, "S"], [3200, "SS"]];
  for (const [limit, tier] of bands) if (value < limit) return tier;
  return "SSS";
}

/**
 * Turn the NPC's crafting needs into quests: "bring me 8 iron ore". The reward is
 * half again the goods' value, paid from the NPC's own purse, so a broke NPC
 * posts no quests. Quests the player already took are left alone.
 */
export function refreshNeedQuests(persona: NpcPersona, state: NpcState, player: PlayerState): void {
  const taken = new Set([...player.quests.active.map((q) => q.id), ...player.quests.completed]);
  const board: QuestDef[] = [];
  for (const [item, qty] of Object.entries(craftingNeeds(persona, state))) {
    const id = `need_${persona.id}_${item.replace(/\s+/g, "_")}`;
    if (taken.has(id)) continue;
    const value = qty * (ITEMS[item]?.value ?? 1);
    let tier = tierForValue(value);
    if (compareTiers(tier, persona.maxQuestTier) > 0) tier = persona.maxQuestTier;
    const gold = Math.min(Math.ceil(value * 1.5), state.gold);
    if (gold <= 0) continue;
    board.push({
      id,
      title: `${item[0]!.toUpperCase()}${item.slice(1)} wanted`,
      description: `You're short of ${item} for your work and need ${qty} more.`,
      tier,
      minTrust: 0,
      objective: { type: "deliver", item, qty },
      reward: { gold },
    });
  }
  state.questBoard = board;
}

/** Every quest this NPC could ever give right now, ignoring the player. */
function npcQuests(persona: NpcPersona, state: NpcState): QuestDef[] {
  return [...(persona.quests ?? []), ...state.questBoard].filter((q) => compareTiers(q.tier, persona.maxQuestTier) <= 0);
}

export interface QuestView {
  /** Quests the player can take now. */
  available: QuestDef[];
  /** Quests the NPC would give, but the player's level is too low. */
  tooHard: QuestDef[];
}

/** What this player may see from this NPC. Quests above their trust stay hidden. */
export function questsFor(persona: NpcPersona, state: NpcState, player: PlayerState): QuestView {
  const taken = new Set([...player.quests.active.map((q) => q.id), ...player.quests.completed]);
  const visible = npcQuests(persona, state).filter((q) => !taken.has(q.id) && state.relationship >= q.minTrust);
  return {
    available: visible.filter((q) => canTakeQuestTier(player.level, q.tier)),
    tooHard: visible.filter((q) => !canTakeQuestTier(player.level, q.tier)),
  };
}

export function findQuest(persona: NpcPersona, state: NpcState, id: string): QuestDef | undefined {
  return npcQuests(persona, state).find((q) => q.id === id);
}

function describeObjective(q: QuestDef): string {
  return `bring ${q.objective.qty} ${q.objective.item}`;
}

export function questXp(q: QuestDef): number {
  return q.reward.xp ?? QUEST_TIER_XP[q.tier];
}

/** For the model on quest turns: what it can offer, and what it would refuse as too dangerous. */
export function describeQuestsForNpc(persona: NpcPersona, state: NpcState, player: PlayerState): string {
  const { available, tooHard } = questsFor(persona, state, player);
  const offer = available.map((q) => `"${q.id}" [${q.tier}] ${q.title}: ${describeObjective(q)} for ${q.reward.gold} gold (${q.description})`);
  const refuse = tooHard.map((q) => `[${q.tier}] ${q.title} (needs level ${QUEST_TIER_MIN_LEVEL[q.tier]})`);
  return (
    `They are level ${player.level}. Work you could give them: ${offer.join("; ") || "nothing right now"}.` +
    (refuse.length > 0 ? ` Too dangerous for them at their level, so refuse if asked: ${refuse.join("; ")}.` : "")
  );
}

/** Check an offer the model wants to make. Returns an error, or null if fine. */
export function questOfferError(persona: NpcPersona, state: NpcState, player: PlayerState, id: string): string | null {
  const quest = findQuest(persona, state, id);
  if (!quest) return `You have no quest called "${id}".`;
  if (state.relationship < quest.minTrust) return "You don't trust them enough for that one.";
  if (player.quests.active.some((q) => q.id === id) || player.quests.completed.includes(id)) {
    return "They've already taken that one.";
  }
  if (!canTakeQuestTier(player.level, quest.tier)) {
    return `That's a ${quest.tier}-tier job and they're only level ${player.level} (needs ${QUEST_TIER_MIN_LEVEL[quest.tier]}). Turn them down.`;
  }
  return null;
}

/** The player accepted the NPC's quest offer. */
export function acceptQuest(persona: NpcPersona, state: NpcState, player: PlayerState): ActiveQuest | null {
  const id = state.pendingQuest;
  state.pendingQuest = null;
  const quest = id ? findQuest(persona, state, id) : undefined;
  if (!quest || questOfferError(persona, state, player, quest.id)) return null;
  const active: ActiveQuest = { ...quest, giverId: persona.id, giverName: persona.name };
  player.quests.active.push(active);
  return active;
}

export interface TurnInResult {
  completed: ActiveQuest[];
  /** For the player and (as an event) the NPC. */
  message: string;
  levelsGained: number;
}

/**
 * Hand in every finished quest for this NPC: the items move to the NPC, who pays
 * the reward from their purse (all they have, if short). XP may level the player up.
 */
export function turnInQuests(persona: NpcPersona, state: NpcState, world: WorldSnapshot): TurnInResult {
  const player = world.player;
  const mine = player.quests.active.filter((q) => q.giverId === persona.id);
  if (mine.length === 0) return { completed: [], message: `You have no quests for ${persona.name}.`, levelsGained: 0 };

  const ready = mine.filter((q) => countItem(player.inventory, q.objective.item) >= q.objective.qty);
  if (ready.length === 0) {
    const what = mine.map((q) => `${q.title} (${countItem(player.inventory, q.objective.item)}/${q.objective.qty} ${q.objective.item})`);
    return { completed: [], message: `Not ready yet: ${what.join(", ")}.`, levelsGained: 0 };
  }

  const parts: string[] = [];
  let levelsGained = 0;
  for (const quest of ready) {
    const { item, qty } = quest.objective;
    removeItem(player.inventory, item, qty);
    const key = itemKey(item);
    state.inventory[key] = (state.inventory[key] ?? 0) + qty;

    const gold = Math.min(quest.reward.gold, state.gold);
    state.gold -= gold;
    player.gold += gold;
    const xp = questXp(quest);
    levelsGained += gainXp(player, xp);
    state.relationship = Math.min(100, state.relationship + (quest.reward.trust ?? DEFAULT_QUEST_TRUST));

    player.quests.active = player.quests.active.filter((q) => q.id !== quest.id);
    player.quests.completed.push(quest.id);
    state.questBoard = state.questBoard.filter((q) => q.id !== quest.id);
    const short = gold < quest.reward.gold ? ` (you could only pay ${gold} of the ${quest.reward.gold} promised)` : "";
    parts.push(`${player.name} finished "${quest.title}": handed you ${qty} ${item}; you paid ${gold} gold${short}; they gained ${xp} XP`);
  }
  const levelNote = levelsGained > 0 ? ` They're now level ${player.level}!` : "";
  return { completed: ready, message: `${parts.join(". ")}.${levelNote}`, levelsGained };
}
