import { npcHasRoom } from "../npc/state.js";
import { playerProgressTitles } from "./titles.js";
import { questRewardBonus, traitsOf } from "../npc/traits.js";
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
import { formatMoney } from "./money.js";
import { priceFactor } from "./events-calendar.js";
import { recordEvent } from "./events.js";
import { favourRepaid } from "./favours.js";
import { note } from "./journal.js";
import { addEmotion } from "../npc/emotions.js";
import { remember } from "../npc/memory.js";
import { adjust, AFFECTION, holdsGrudge, questRespect, respectForQuestTier, respectOf, settleGrudge } from "../npc/relationship.js";

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

/** Tier for a need quest, from the value (in copper) of what's asked. */
function tierForValue(value: number): QuestTier {
  // Below 1 gold: G; below 2 gold 5 silver: F; ... (copper)
  const bands: Array<[number, QuestTier]> = [[100, "G"], [250, "F"], [500, "E"], [1000, "D"], [2000, "C"], [4000, "B"], [8000, "A"], [16000, "S"], [32000, "SS"]];
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
    const money = Math.min(Math.ceil(value * 1.5), state.money);
    if (money <= 0) continue;
    board.push({
      id,
      title: `${item[0]!.toUpperCase()}${item.slice(1)} wanted`,
      description: `You're short of ${item} for your work and need ${qty} more.`,
      tier,
      minTrust: 0,
      objective: { type: "deliver", item, qty },
      reward: { money },
    });
  }
  // Favours being called in (game/favours.ts) stay on the board until done.
  state.questBoard = [...state.questBoard.filter((q) => q.favour && !taken.has(q.id)), ...board];
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

/** Respect a quest needs: its own minRespect, or what its tier calls for (npc/relationship.ts). */
export function questRespectNeeded(q: QuestDef): number {
  return Math.max(q.minRespect ?? 0, respectForQuestTier(q.tier));
}

/** What this player may see from this NPC. Quests above their trust or respect stay hidden. */
export function questsFor(persona: NpcPersona, state: NpcState, player: PlayerState): QuestView {
  const taken = new Set([...player.quests.active.map((q) => q.id), ...player.quests.completed]);
  const respect = respectOf(state, player);
  const visible = npcQuests(persona, state).filter((q) => !taken.has(q.id) && state.relationship >= q.minTrust && (questRespectNeeded(q) === 0 || respect >= questRespectNeeded(q)));
  return {
    available: visible.filter((q) => canTakeQuestTier(player.level, q.tier)),
    tooHard: visible.filter((q) => !canTakeQuestTier(player.level, q.tier)),
  };
}

export function findQuest(persona: NpcPersona, state: NpcState, id: string): QuestDef | undefined {
  return npcQuests(persona, state).find((q) => q.id === id);
}

/** Plural of a creature kind for quest text: "bandit" → "bandits", "wolf" → "wolves". */
function creaturePlural(kind: string, qty: number): string {
  const name = kind.replace(/_/g, " ");
  if (qty === 1) return name;
  return name.endsWith("f") ? `${name.slice(0, -1)}ves` : name.endsWith("s") ? name : `${name}s`;
}

/** "bring 3 wild herbs", "kill or drive off 3 bandits". */
export function describeObjective(q: Pick<QuestDef, "objective">): string {
  const o = q.objective;
  return o.type === "deliver" ? `bring ${o.qty} ${o.item}` : `kill or drive off ${o.qty} ${creaturePlural(o.creature, o.qty)}`;
}

/** How far the player has got: items carried for a delivery, creatures beaten for a defeat. */
export function questProgress(player: PlayerState, q: QuestDef & { progress?: number }): { have: number; need: number; done: boolean } {
  const o = q.objective;
  const have = o.type === "deliver" ? countItem(player.inventory, o.item) : Math.min(o.qty, q.progress ?? 0);
  return { have, need: o.qty, done: have >= o.qty };
}

/**
 * The player killed or drove off a creature of this kind (a template id): it counts
 * towards every active defeat quest for that kind. Returns lines for the player.
 */
export function recordCreatureDefeat(player: PlayerState, kind: string): string[] {
  const lines: string[] = [];
  for (const q of player.quests.active) {
    if (q.objective.type !== "defeat" || q.objective.creature !== kind) continue;
    if ((q.progress ?? 0) >= q.objective.qty) continue;
    q.progress = (q.progress ?? 0) + 1;
    const done = q.progress >= q.objective.qty;
    lines.push(`Quest "${q.title}": ${q.progress}/${q.objective.qty}${done ? `. Done: report back to ${q.giverName}.` : "."}`);
  }
  return lines;
}

/**
 * Money (copper) the NPC pays for a quest: the written reward plus a generous NPC's bonus
 * (questRewardBonus), times what the goods are worth today (pelts in winter: game/events-calendar.ts).
 */
export function questRewardMoney(persona: NpcPersona, q: QuestDef, world?: Pick<WorldSnapshot, "day" | "recentEvents" | "lastRaidDay">): number {
  const demand = world && q.objective.type === "deliver" ? priceFactor(q.objective.item, world) : 1;
  const base = Math.round(q.reward.money * demand);
  return base + Math.round(base * questRewardBonus(traitsOf(persona)));
}

export function questXp(q: QuestDef): number {
  return q.reward.xp ?? QUEST_TIER_XP[q.tier];
}

/** For the model on quest turns: what it can offer, and what it would refuse as too dangerous. */
export function describeQuestsForNpc(persona: NpcPersona, state: NpcState, player: PlayerState, world?: Pick<WorldSnapshot, "day" | "recentEvents" | "lastRaidDay">): string {
  const { available, tooHard } = questsFor(persona, state, player);
  const offer = available.map((q) => `"${q.id}" [${q.tier}] ${q.title}: ${describeObjective(q)} for ${formatMoney(questRewardMoney(persona, q, world))} (${q.description})`);
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
  if (questRespectNeeded(quest) > 0 && respectOf(state, player) < questRespectNeeded(quest)) return "You don't rate them highly enough for that one yet.";
  if (player.quests.active.some((q) => q.id === id) || player.quests.completed.includes(id)) {
    return "They've already taken that one.";
  }
  if (!canTakeQuestTier(player.level, quest.tier)) {
    return `That's a ${quest.tier}-tier job and they're only level ${player.level} (needs ${QUEST_TIER_MIN_LEVEL[quest.tier]}). Turn them down.`;
  }
  return null;
}

/** The player accepted the NPC's quest offer. */
export function acceptQuest(
  persona: NpcPersona,
  state: NpcState,
  player: PlayerState,
  world?: Pick<WorldSnapshot, "day" | "recentEvents" | "lastRaidDay">,
): ActiveQuest | null {
  const id = state.pendingQuest;
  state.pendingQuest = null;
  const quest = id ? findQuest(persona, state, id) : undefined;
  if (!quest || questOfferError(persona, state, player, quest.id)) return null;
  // The reward is fixed when the quest is taken, generosity bonus and today's demand included.
  const active: ActiveQuest = {
    ...quest,
    reward: { ...quest.reward, money: questRewardMoney(persona, quest, world) },
    giverId: persona.id,
    giverName: persona.name,
    ...(world ? { acceptedDay: world.day } : {}),
  };
  player.quests.active.push(active);
  if (world) note(player, { id: `quest:${quest.id}`, day: world.day, npc: persona.id, kind: "quest", text: `Took "${quest.title}" for ${persona.name}: ${describeObjective(quest)}.` });
  return active;
}

export interface TurnInResult {
  completed: ActiveQuest[];
  /** For the player and (as an event) the NPC. */
  message: string;
  levelsGained: number;
  /** Titles the player earned by it, as lines for them (not the NPC). */
  titles?: string[];
}

/**
 * Hand in every finished quest for this NPC: the items move to the NPC, who pays
 * the reward from their purse (all they have, if short). XP may level the player up.
 */
export function turnInQuests(persona: NpcPersona, state: NpcState, world: WorldSnapshot): TurnInResult {
  const player = world.player;
  const mine = player.quests.active.filter((q) => q.giverId === persona.id);
  if (mine.length === 0) return { completed: [], message: `You have no quests for ${persona.name}.`, levelsGained: 0 };

  const ready = mine.filter((q) => questProgress(player, q).done);
  if (ready.length === 0) {
    const what = mine.map((q) => {
      const { have, need } = questProgress(player, q);
      const what = q.objective.type === "deliver" ? ` ${q.objective.item}` : ` ${creaturePlural(q.objective.creature, need)}`;
      return `${q.title} (${have}/${need}${what})`;
    });
    return { completed: [], message: `Not ready yet: ${what.join(", ")}.`, levelsGained: 0 };
  }

  const parts: string[] = [];
  let levelsGained = 0;
  const noRoom: string[] = [];
  for (const quest of ready) {
    const o = quest.objective;
    if (o.type === "deliver") {
      // They have to have somewhere to put it.
      if (!npcHasRoom(persona, state, { [itemKey(o.item)]: o.qty })) {
        noRoom.push(quest.title);
        continue;
      }
      removeItem(player.inventory, o.item, o.qty);
      const key = itemKey(o.item);
      state.inventory[key] = (state.inventory[key] ?? 0) + o.qty;
    }

    const paid = Math.min(quest.reward.money, state.money);
    state.money -= paid;
    player.money += paid;
    const xp = questXp(quest);
    levelsGained += gainXp(player, xp);
    state.relationship = Math.min(100, state.relationship + (quest.reward.trust ?? DEFAULT_QUEST_TRUST));
    // Help earns respect and affection, settles a grudge, and leaves them grateful (N5).
    adjust(state, "respect", questRespect(quest.tier));
    adjust(state, "affection", AFFECTION.quest);
    if (holdsGrudge(state, world.day)) settleGrudge(state);
    if (quest.favour) favourRepaid(state, quest.id);
    addEmotion(state, "gratitude", 0.5, `their help with "${quest.title}"`, world.day, true);
    remember(state, { id: `quest-${quest.id}`, day: world.day, text: `they finished your job "${quest.title}"`, importance: 6, valence: 1 }, traitsOf(persona));
    recordEvent(world, { kind: "quest-done", actor: "player", target: persona.id, details: quest.title, importance: 6 });
    note(player, { id: `quest:${quest.id}`, day: world.day, npc: persona.id, kind: "quest", text: `Finished "${quest.title}" for ${persona.name}.` });

    player.quests.active = player.quests.active.filter((q) => q.id !== quest.id);
    player.quests.completed.push(quest.id);
    state.questBoard = state.questBoard.filter((q) => q.id !== quest.id);
    const short = paid < quest.reward.money ? ` (you could only pay ${formatMoney(paid)} of the ${formatMoney(quest.reward.money)} promised)` : "";
    const did = o.type === "deliver" ? `handed you ${o.qty} ${o.item}` : `${describeObjective(quest).replace(/^kill or drive off/, "killed or drove off")}`;
    parts.push(`${player.name} finished "${quest.title}": ${did}; you paid ${formatMoney(paid)}${short}; they gained ${xp} XP`);
  }
  const levelNote = levelsGained > 0 ? ` They're now level ${player.level}!` : "";
  const titles = playerProgressTitles(player, world.day);
  if (parts.length === 0) {
    return { completed: [], message: `You've no room to take the goods for ${noRoom.join(", ")} right now.`, levelsGained: 0, titles };
  }
  if (noRoom.length > 0) parts.push(`you had no room to take the goods for ${noRoom.join(", ")} yet`);
  return { completed: ready.filter((q) => !noRoom.includes(q.title)), message: `${parts.join(". ")}.${levelNote}`, levelsGained, titles };
}
