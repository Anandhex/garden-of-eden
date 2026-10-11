import { npcHasRoom } from "../npc/state.js";
import { playerProgressTitles } from "./titles.js";
import { questRewardBonus, traitsOf } from "../npc/traits.js";
import type { ActiveQuest, NpcPersona, NpcState, PlayerState, QuestDef, WorldSnapshot } from "../npc/types.js";
import { countItem, craftingNeeds, removeItem } from "./crafting.js";
import { ITEM_TIERS, ITEMS, itemKey, type ItemTier, parseItem } from "./items.js";
import { canTakeQuestTier, compareTiers, playerGainXp, QUEST_TIER_MIN_LEVEL, QUEST_TIER_XP, type QuestTier } from "./levels.js";
import { formatMoney } from "./money.js";
import { priceFactor } from "./events-calendar.js";
import { recordEvent } from "./events.js";
import { favourRepaid } from "./favours.js";
import { note } from "./journal.js";
import { addEmotion } from "../npc/emotions.js";
import { remember } from "../npc/memory.js";
import { adjust, AFFECTION, holdsGrudge, questRespect, respectForQuestTier, respectOf, settleGrudge } from "../npc/relationship.js";
import { absoluteMinute, formatMinute } from "./clock.js";
import { cure, cureQuest, tend } from "./health.js";
import { factionOf, shiftStanding, standingWith, STANDING } from "./factions.js";
import { lockedQuests } from "../npc/arcs.js";
import { TIERS, tierIndex } from "./life.js";
import { PLACE_NAMES, type PlaceId } from "./schedule.js";
import { growthEvent } from "../npc/growth.js";
import { treatWell } from "./party.js";
import { npcName } from "../world/names.js";
import { townLearns } from "./reputation.js";

/**
 * Quests. An NPC's quests come from three places: written ones in their file
 * (persona.quests), ones made from their needs (state.questBoard, e.g. "short of
 * iron ore", or a cure while they're hurt), and ones the world director proposed
 * (director/chronicle.ts). Who sees what is decided in code:
 * - hidden until the NPC trusts (minTrust) and rates (minRespect) the player enough,
 *   until earlier quests in a chain are done (requires), until the giver's faction
 *   thinks well enough of them (minStanding), and until a personal arc opens them;
 * - never above the NPC's maxQuestTier, nor more than a rank above their own;
 * - known but refused if the player's level is too low for the tier.
 *
 * Goals (N9), each with one checker here: deliver, gather, craft, talk_to, defeat
 * (creatures), defeat_npc, escort. Deadlines run on the clock; a missed one fails
 * the quest and costs trust and respect.
 */

const DEFAULT_QUEST_TRUST = 5;
/** Trust and respect a failed quest costs with the giver. */
export const FAILED_QUEST = { trust: -10, respect: -5 } as const;

/** NPC names for objective text ("take word to Corporal Hale"): world/names.ts, set at startup. */
const nameOf = (id: string) => npcName(id);

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
 * The highest tier this NPC gives now: their file's maxQuestTier, but no more than a
 * rank above their own (N3.3, N9). A rising NPC posts harder work.
 */
export function questTierCap(persona: NpcPersona, state: Pick<NpcState, "life">): QuestTier {
  const byRank = TIERS[Math.min(TIERS.length - 1, tierIndex(state.life.tier) + 1)]!;
  return compareTiers(byRank, persona.maxQuestTier) < 0 ? byRank : persona.maxQuestTier;
}

/**
 * Turn the NPC's crafting needs into quests: "bring me 8 iron ore". The reward is
 * half again the goods' value, paid from the NPC's own purse, so a broke NPC
 * posts no quests. While they're hurt or ill, they also ask for the cure. Quests
 * the player already took are left alone.
 */
export function refreshNeedQuests(persona: NpcPersona, state: NpcState, player: PlayerState): void {
  const taken = new Set([...player.quests.active.map((q) => q.id), ...player.quests.completed, ...(player.quests.failed ?? [])]);
  const board: QuestDef[] = [];
  const cap = questTierCap(persona, state);
  for (const [item, qty] of Object.entries(craftingNeeds(persona, state))) {
    const id = `need_${persona.id}_${item.replace(/\s+/g, "_")}`;
    if (taken.has(id)) continue;
    const value = qty * (ITEMS[item]?.value ?? 1);
    let tier = tierForValue(value);
    if (compareTiers(tier, cap) > 0) tier = cap;
    const money = Math.min(Math.ceil(value * 1.5), state.money);
    if (money <= 0) continue;
    // Keep a write-up the model already gave it (director/flavor.ts).
    const old = state.questBoard.find((q) => q.id === id && q.flavored);
    board.push({
      id,
      title: old?.title ?? `${item[0]!.toUpperCase()}${item.slice(1)} wanted`,
      description: old?.description ?? `You're short of ${item} for your work and need ${qty} more.`,
      tier,
      minTrust: 0,
      objective: { type: "deliver", item, qty },
      reward: { money },
      ...(old ? { flavored: true } : {}),
    });
  }
  const healing = cureQuest(persona.id, state, [...(persona.quests ?? []), ...board], state.money);
  if (healing && !taken.has(healing.id)) board.push(healing);
  // Favours being called in (game/favours.ts) and director quests stay on the board until done.
  state.questBoard = [...state.questBoard.filter((q) => (q.favour || q.director) && !taken.has(q.id)), ...board];
}

/** Every quest this NPC could ever give right now, ignoring the player. */
function npcQuests(persona: NpcPersona, state: NpcState): QuestDef[] {
  const locked = lockedQuests(persona, state);
  return [...(persona.quests ?? []), ...state.questBoard].filter((q) => compareTiers(q.tier, persona.maxQuestTier) <= 0 && !locked.has(q.id));
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

/** Earlier quests in the chain the player hasn't finished. */
export function missingPrerequisites(q: QuestDef, player: PlayerState): string[] {
  return (q.requires ?? []).filter((id) => !player.quests.completed.includes(id));
}

/** Is the giver's faction friendly enough for this one? */
function standingOk(persona: NpcPersona, q: QuestDef, player: PlayerState): boolean {
  if (q.minStanding === undefined) return true;
  const f = factionOf({ persona });
  return !f || standingWith(player, f.id) >= q.minStanding;
}

/** What this player may see from this NPC. Quests above their trust, respect, chain or standing stay hidden. */
export function questsFor(persona: NpcPersona, state: NpcState, player: PlayerState): QuestView {
  const taken = new Set([...player.quests.active.map((q) => q.id), ...player.quests.completed, ...(player.quests.failed ?? [])]);
  const respect = respectOf(state, player);
  const cap = questTierCap(persona, state);
  const visible = npcQuests(persona, state).filter(
    (q) =>
      !taken.has(q.id) &&
      state.relationship >= q.minTrust &&
      (questRespectNeeded(q) === 0 || respect >= questRespectNeeded(q)) &&
      missingPrerequisites(q, player).length === 0 &&
      standingOk(persona, q, player) &&
      compareTiers(q.tier, cap) <= 0,
  );
  return {
    available: visible.filter((q) => canTakeQuestTier(player.level, q.tier)),
    tooHard: visible.filter((q) => !canTakeQuestTier(player.level, q.tier)),
  };
}

export function findQuest(persona: NpcPersona, state: NpcState, id: string): QuestDef | undefined {
  return npcQuests(persona, state).find((q) => q.id === id) ?? [...(persona.quests ?? []), ...state.questBoard].find((q) => q.id === id);
}

/** Plural of a creature kind for quest text: "bandit" → "bandits", "wolf" → "wolves". */
function creaturePlural(kind: string, qty: number): string {
  const name = kind.replace(/_/g, " ");
  if (qty === 1) return name;
  return name.endsWith("f") ? `${name.slice(0, -1)}ves` : name.endsWith("s") ? name : `${name}s`;
}

const placeName = (p: string) => PLACE_NAMES[p as PlaceId] ?? p.replace(/_/g, " ");

/** "bring 3 wild herbs", "kill or drive off 3 bandits", "take word to Corporal Hale". */
export function describeObjective(q: Pick<QuestDef, "objective">): string {
  const o = q.objective;
  switch (o.type) {
    case "deliver":
      return `bring ${o.qty} ${o.item}`;
    case "defeat":
      return `kill or drive off ${o.qty} ${creaturePlural(o.creature, o.qty)}`;
    case "defeat_npc":
      return `defeat ${nameOf(o.npc)}, by force or by beating them senseless`;
    case "gather":
      return `gather ${o.qty} ${o.item} yourself at ${placeName(o.place)} and bring them`;
    case "craft":
      return `make ${o.qty} ${o.item} of tier ${o.minTier} or better yourself, and bring ${o.qty === 1 ? "it" : "them"}`;
    case "talk_to":
      return `take word to ${nameOf(o.npc)}: "${o.message}"`;
    case "escort":
      return `bring the ${o.who.replace(/_/g, " ")} safely to ${placeName(o.to)}`;
  }
}

/** Copies of an item at `minTier` or better in an inventory. */
function countAtTier(inventory: Record<string, number>, name: string, minTier: string): number {
  let n = 0;
  for (const [key, qty] of Object.entries(inventory)) {
    const p = parseItem(key);
    if (p?.name === name && ITEM_TIERS.indexOf(p.tier) >= ITEM_TIERS.indexOf(minTier as ItemTier)) n += qty;
  }
  return n;
}

/** How far the player has got with a quest. */
export function questProgress(player: PlayerState, q: QuestDef & { progress?: number }): { have: number; need: number; done: boolean } {
  const o = q.objective;
  const progress = q.progress ?? 0;
  let have: number;
  switch (o.type) {
    case "deliver":
      have = countItem(player.inventory, o.item);
      break;
    case "gather":
      have = Math.min(progress, countItem(player.inventory, o.item));
      break;
    case "craft":
      have = Math.min(progress, countAtTier(player.inventory, o.item, o.minTier));
      break;
    default:
      have = Math.min(o.qty, progress);
  }
  return { have, need: o.qty, done: have >= o.qty };
}

/** The player killed or drove off a creature of this kind: it counts towards defeat quests for that kind. Returns lines. */
export function recordCreatureDefeat(player: PlayerState, kind: string): string[] {
  return bump(player, (q) => q.objective.type === "defeat" && q.objective.creature === kind);
}

/** The player beat a named NPC (they died, fled, begged or were knocked out). */
export function recordNpcDefeat(player: PlayerState, npc: string): string[] {
  return bump(player, (q) => q.objective.type === "defeat_npc" && q.objective.npc === npc);
}

/** The player gathered an item at a place (/forage, /hunt). */
export function recordGather(player: PlayerState, item: string, place: string): string[] {
  return bump(player, (q) => q.objective.type === "gather" && q.objective.item === item && q.objective.place === place);
}

/** The player made an item (/craft). Counts for craft quests if it's good enough. */
export function recordCraft(player: PlayerState, key: string): string[] {
  const p = parseItem(key);
  if (!p) return [];
  return bump(player, (q) => q.objective.type === "craft" && q.objective.item === p.name && ITEM_TIERS.indexOf(p.tier) >= ITEM_TIERS.indexOf(q.objective.minTier as ItemTier));
}

function bump(player: PlayerState, match: (q: ActiveQuest) => boolean): string[] {
  const lines: string[] = [];
  for (const q of player.quests.active) {
    if (!match(q) || (q.progress ?? 0) >= q.objective.qty) continue;
    q.progress = (q.progress ?? 0) + 1;
    const done = q.progress >= q.objective.qty;
    lines.push(`Quest "${q.title}": ${q.progress}/${q.objective.qty}${done ? `. Done: report back to ${q.giverName}.` : "."}`);
  }
  return lines;
}

/**
 * The player is talking to an NPC: any message they're carrying for them is
 * delivered (talk_to). Returns event lines for that NPC ("Brena sends word: ...").
 */
export function deliverMessages(player: PlayerState, npc: NpcPersona, world: Pick<WorldSnapshot, "day" | "hour" | "location" | "events">): string[] {
  const lines: string[] = [];
  for (const q of player.quests.active) {
    if (q.objective.type !== "talk_to" || q.objective.npc !== npc.id || (q.progress ?? 0) >= 1) continue;
    q.progress = 1;
    lines.push(`${player.name} brings word from ${q.giverName}: "${q.objective.message}".`);
    recordEvent(world, { kind: "message", actor: "player", target: npc.id, details: `from ${q.giverId}: ${q.objective.message}`, importance: 3, witnesses: [] });
    note(player, { id: `quest:${q.id}`, day: world.day, npc: q.giverId, kind: "quest", text: `Gave ${npc.name} ${q.giverName}'s message. Report back.` });
  }
  return lines;
}

/** An escort arrives: the player is at the destination and whoever they guard is alive. Returns lines. */
export function checkEscorts(player: PlayerState, alive: (who: string) => boolean): string[] {
  return bump(player, (q) => q.objective.type === "escort" && player.place === q.objective.to && alive(q.escortee ?? q.objective.who));
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
  const offer = available.map((q) => `"${q.id}" [${q.tier}] ${q.title}: ${describeObjective(q)} for ${formatMoney(questRewardMoney(persona, q, world))}${q.deadlineHours ? `, within ${q.deadlineHours} hours` : ""} (${q.description})`);
  const refuse = tooHard.map((q) => `[${q.tier}] ${q.title} (needs level ${QUEST_TIER_MIN_LEVEL[q.tier]})`);
  return (
    `They are level ${player.level}. Work you could give them: ${offer.join("; ") || "nothing right now"}.` +
    (refuse.length > 0 ? ` Too dangerous for them at their level, so refuse if asked: ${refuse.join("; ")}.` : "")
  );
}

/** Check an offer the model wants to make. Returns an error, or null if fine. */
export function questOfferError(persona: NpcPersona, state: NpcState, player: PlayerState, id: string): string | null {
  const quest = findQuest(persona, state, id);
  if (!quest || lockedQuests(persona, state).has(id)) return `You have no quest called "${id}".`;
  if (state.relationship < quest.minTrust) return "You don't trust them enough for that one.";
  if (questRespectNeeded(quest) > 0 && respectOf(state, player) < questRespectNeeded(quest)) return "You don't rate them highly enough for that one yet.";
  if (player.quests.active.some((q) => q.id === id) || player.quests.completed.includes(id)) {
    return "They've already taken that one.";
  }
  if ((player.quests.failed ?? []).includes(id)) return "They failed that one; you won't trust them with it again.";
  const missing = missingPrerequisites(quest, player);
  if (missing.length > 0) return `That comes later: they haven't done ${missing.join(", ")} yet.`;
  if (!standingOk(persona, quest, player)) return "That's work for friends of your people, and they're not one.";
  if (compareTiers(quest.tier, questTierCap(persona, state)) > 0) return "That's beyond what you can offer right now.";
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
  world?: Pick<WorldSnapshot, "day" | "hour" | "minute" | "recentEvents" | "lastRaidDay">,
  /** For escorts: who's being escorted (a creature uid of the right kind, or an NPC id). */
  findEscortee?: (who: string) => string | null,
): ActiveQuest | null {
  const id = state.pendingQuest;
  state.pendingQuest = null;
  const quest = id ? findQuest(persona, state, id) : undefined;
  if (!quest || questOfferError(persona, state, player, quest.id)) return null;
  const escortee = quest.objective.type === "escort" ? (findEscortee?.(quest.objective.who) ?? quest.objective.who) : undefined;
  // The reward is fixed when the quest is taken, generosity bonus and today's demand included.
  const active: ActiveQuest = {
    ...quest,
    reward: { ...quest.reward, money: questRewardMoney(persona, quest, world) },
    giverId: persona.id,
    giverName: persona.name,
    ...(world ? { acceptedDay: world.day } : {}),
    ...(world && quest.deadlineHours ? { due: absoluteMinute(world) + quest.deadlineHours * 60 } : {}),
    ...(escortee ? { escortee } : {}),
  };
  player.quests.active.push(active);
  if (world) {
    const by = active.due !== undefined ? ` by ${formatMinute(active.due, world.day)}` : "";
    note(player, { id: `quest:${quest.id}`, day: world.day, npc: persona.id, kind: "quest", text: `Took "${quest.title}" for ${persona.name}: ${describeObjective(quest)}${by}.` });
  }
  return active;
}

/**
 * Deadlines: a quest past its due minute fails. The giver loses trust and respect,
 * remembers it, and it's gone from the log. Returns lines for the player.
 */
export function failOverdueQuests(player: PlayerState, givers: Record<string, { persona: NpcPersona; state: NpcState }>, world: Pick<WorldSnapshot, "day" | "hour" | "minute" | "location" | "events">): string[] {
  const now = absoluteMinute(world);
  const lines: string[] = [];
  for (const q of [...player.quests.active]) {
    if (q.due === undefined || now <= q.due || questProgress(player, q).done) continue;
    player.quests.active = player.quests.active.filter((a) => a !== q);
    (player.quests.failed ??= []).push(q.id);
    const giver = givers[q.giverId];
    if (giver && giver.state.outcome !== "dead") {
      adjust(giver.state, "trust", FAILED_QUEST.trust);
      adjust(giver.state, "respect", FAILED_QUEST.respect);
      remember(giver.state, { id: `quest-failed-${q.id}`, day: world.day, text: `they let you down on "${q.title}"`, importance: 5, valence: -1 }, traitsOf(giver.persona, giver.state));
    }
    const e = recordEvent(world, { kind: "quest-failed", actor: "player", target: q.giverId, details: q.title, importance: 4, witnesses: [q.giverId] });
    townLearns(player, e);
    note(player, { id: `quest:${q.id}`, day: world.day, npc: q.giverId, kind: "quest", text: `Failed "${q.title}": out of time.` });
    lines.push(`You ran out of time on "${q.title}" for ${q.giverName}.`);
  }
  return lines;
}

export interface TurnInResult {
  completed: ActiveQuest[];
  /** For the player and (as an event) the NPC. */
  message: string;
  levelsGained: number;
  /** Titles the player earned by it, as lines for them (not the NPC). */
  titles?: string[];
  /** Growth the giver had from it, for logs. */
  growth?: string[];
}

/** Take what a finished quest asks for from the player. Returns false if the NPC has no room. */
function collectGoods(persona: NpcPersona, state: NpcState, player: PlayerState, q: ActiveQuest): boolean {
  const o = q.objective;
  if (o.type === "deliver" || o.type === "gather") {
    if (!npcHasRoom(persona, state, { [itemKey(o.item)]: o.qty })) return false;
    removeItem(player.inventory, o.item, o.qty);
    const key = itemKey(o.item);
    state.inventory[key] = (state.inventory[key] ?? 0) + o.qty;
  } else if (o.type === "craft") {
    // Hand over the best copies that qualify.
    const keys = Object.keys(player.inventory)
      .filter((k) => {
        const p = parseItem(k);
        return p?.name === o.item && ITEM_TIERS.indexOf(p.tier) >= ITEM_TIERS.indexOf(o.minTier as ItemTier);
      })
      .sort((a, b) => ITEM_TIERS.indexOf(parseItem(a)!.tier) - ITEM_TIERS.indexOf(parseItem(b)!.tier));
    let left = o.qty;
    const moving: Record<string, number> = {};
    for (const k of keys) {
      const take = Math.min(left, player.inventory[k] ?? 0);
      if (take > 0) moving[k] = take;
      left -= take;
      if (left === 0) break;
    }
    if (!npcHasRoom(persona, state, moving)) return false;
    for (const [k, n] of Object.entries(moving)) {
      player.inventory[k] = (player.inventory[k] ?? 0) - n;
      if (player.inventory[k] === 0) delete player.inventory[k];
      state.inventory[k] = (state.inventory[k] ?? 0) + n;
    }
  }
  return true;
}

/** What the player did, in words for the NPC. */
function didWhat(q: ActiveQuest): string {
  const o = q.objective;
  switch (o.type) {
    case "deliver":
    case "gather":
      return `handed you ${o.qty} ${o.item}`;
    case "craft":
      return `handed you ${o.qty} ${o.item} they made themselves`;
    case "defeat":
      return describeObjective(q).replace(/^kill or drive off/, "killed or drove off");
    case "defeat_npc":
      return `beat ${nameOf(o.npc)}`;
    case "talk_to":
      return `took your message to ${nameOf(o.npc)}`;
    case "escort":
      return `brought the ${o.who.replace(/_/g, " ")} safely to ${placeName(o.to)}`;
  }
}

/**
 * Hand in every finished quest for this NPC: the goods move to the NPC, who pays
 * the reward from their purse (all they have, if short). XP may level the player up.
 * A quest that cures the giver heals them; helping earns standing with their faction.
 */
export function turnInQuests(persona: NpcPersona, state: NpcState, world: WorldSnapshot): TurnInResult {
  const player = world.player;
  const mine = player.quests.active.filter((q) => q.giverId === persona.id);
  if (mine.length === 0) return { completed: [], message: `You have no quests for ${persona.name}.`, levelsGained: 0 };

  const ready = mine.filter((q) => questProgress(player, q).done);
  if (ready.length === 0) {
    const what = mine.map((q) => {
      const { have, need } = questProgress(player, q);
      const o = q.objective;
      const what = o.type === "deliver" || o.type === "gather" || o.type === "craft" ? ` ${o.item}` : o.type === "defeat" ? ` ${creaturePlural(o.creature, need)}` : "";
      return `${q.title} (${have}/${need}${what})`;
    });
    return { completed: [], message: `Not ready yet: ${what.join(", ")}.`, levelsGained: 0 };
  }

  const parts: string[] = [];
  const growth: string[] = [];
  let levelsGained = 0;
  const noRoom: string[] = [];
  for (const quest of ready) {
    if (!collectGoods(persona, state, player, quest)) {
      noRoom.push(quest.title);
      continue;
    }
    const paid = Math.min(quest.reward.money, state.money);
    state.money -= paid;
    player.money += paid;
    const xp = questXp(quest);
    levelsGained += playerGainXp(player, xp);
    state.relationship = Math.min(100, state.relationship + (quest.reward.trust ?? DEFAULT_QUEST_TRUST));
    // Help earns respect and affection, settles a grudge, and leaves them grateful (N5).
    adjust(state, "respect", questRespect(quest.tier));
    adjust(state, "affection", AFFECTION.quest);
    if (holdsGrudge(state, world.day) && !state.grudge?.blood) settleGrudge(state);
    if (quest.favour) favourRepaid(state, quest.id);
    // A cure for what ails them (N8.1): healed outright.
    if (quest.cures && cure(state, quest.cures)) {
      tend(state);
      addEmotion(state, "joy", 0.4, "being on the mend", world.day);
    }
    addEmotion(state, "gratitude", 0.5, `their help with "${quest.title}"`, world.day, true);
    remember(state, { id: `quest-${quest.id}`, day: world.day, text: `they finished your job "${quest.title}"`, importance: 6, valence: 1 }, traitsOf(persona, state));
    const e = recordEvent(world, { kind: "quest-done", actor: "player", target: persona.id, details: quest.title, importance: 6 });
    townLearns(player, e);
    const f = factionOf({ persona });
    if (f) shiftStanding(player, f.id, STANDING.questDone);
    treatWell(state);
    growth.push(...growthEvent(persona, state, { kind: "quest_done" }, world.day));
    note(player, { id: `quest:${quest.id}`, day: world.day, npc: persona.id, kind: "quest", text: `Finished "${quest.title}" for ${persona.name}.` });

    player.quests.active = player.quests.active.filter((q) => q.id !== quest.id);
    player.quests.completed.push(quest.id);
    state.questBoard = state.questBoard.filter((q) => q.id !== quest.id);
    const short = paid < quest.reward.money ? ` (you could only pay ${formatMoney(paid)} of the ${formatMoney(quest.reward.money)} promised)` : "";
    parts.push(`${player.name} finished "${quest.title}": ${didWhat(quest)}; you paid ${formatMoney(paid)}${short}; they gained ${xp} XP`);
  }
  const levelNote = levelsGained > 0 ? ` They're now level ${player.level}!` : "";
  const titles = playerProgressTitles(player, world.day);
  if (parts.length === 0) {
    return { completed: [], message: `You've no room to take the goods for ${noRoom.join(", ")} right now.`, levelsGained: 0, titles };
  }
  if (noRoom.length > 0) parts.push(`you had no room to take the goods for ${noRoom.join(", ")} yet`);
  return { completed: ready.filter((q) => !noRoom.includes(q.title)), message: `${parts.join(". ")}.${levelNote}`, levelsGained, titles, growth };
}
