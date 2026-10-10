import { formatTime } from "../game/clock.js";
import { describeQuestsForNpc, findQuest, isQuestTalk } from "../game/quests.js";
import { describeTeaching, isTrainingTalk } from "../game/training.js";
import { bestWeapon, itemLabel } from "../game/items.js";
import { isTradeTalk, itemsForSale, minPrice, npcPrice } from "./actions.js";
import { describeTraits, provokeLimit, traitsOf } from "./traits.js";
import { describeSkills } from "./skills.js";
import { describeAttributes, describeCondition } from "./stats.js";
import type { NpcPersona, NpcState, WorldSnapshot } from "./types.js";

/**
 * Build the NPC's system prompt from its persona.
 *
 * Rules of thumb for small models:
 * - Keep it short (under ~400 words) and direct.
 * - Keep it identical every turn: no mood, inventory, or time here.
 *   Changing state goes in the per-turn message (buildTurnMessage), so Ollama
 *   can reuse the already-processed system prompt and replies start faster.
 */
export function buildSystemPrompt(p: NpcPersona): string {
  const temperament = describeTraits(traitsOf(p));
  const list = (items: string[]) => items.map((i) => `- ${i}`).join("\n");
  return `You are ${p.name}, ${p.role}, a character in a fantasy role-playing game. The player is talking to you.

# Who you are
Personality: ${[...p.personality, ...(temperament ? [temperament] : [])].join(", ")}.
Body and mind: ${describeAttributes(p.stats)}. Act like it.
Skills: ${describeSkills(p.skills)}. Talk about your trade like someone at that level would.
How you speak: ${p.speechStyle}
Backstory: ${p.backstory}
What you want:
${list(p.goals)}

# What you know
${list(p.knowledge)}

# Rules
- Stay in character. You know nothing about AI, games, or the modern world; treat strange talk as strange.
- Speak only as ${p.name}, in 1-2 short sentences. Do not describe the player's actions.
- The player's messages begin with a <situation> block (your mood, trust, stock, surroundings, what the player carries). It is always true. It is for you to read; never write one yourself.
- Reply only with the words you say out loud. Never say your mood label; let it show in how you talk.
- Actions only happen through tools. Saying you hand something over does nothing unless you call the tool.
- Never invent items you don't have. Never give items away for free.
- Fights happen only through tools; the game rolls every hit and miss. Never claim you hit or got hit unless you were told so.`;
}

/** "With 50 gold, they can afford: horseshoe [G], dagger [E], iron sword [D]. Too dear for them: iron sword [B]." */
function describeAffordable(persona: NpcPersona, state: NpcState, gold: number, forSale: string[]): string {
  const price = (item: string) => minPrice(persona, state, item) ?? Infinity;
  const can = forSale.filter((item) => price(item) <= gold).map(itemLabel);
  const cannot = forSale.filter((item) => price(item) > gold).map(itemLabel);
  return (
    `With ${gold} gold, they can afford: ${can.join(", ") || "nothing you sell"}.` +
    (cannot.length > 0 ? ` Too dear for them: ${cannot.join(", ")}.` : "")
  );
}

/** Turn a -100..100 relationship score into words a small model can use. */
function describeTrust(relationship: number): string {
  if (relationship <= -50) return "you despise them";
  if (relationship < -10) return "you dislike them";
  if (relationship <= 10) return "a stranger to you";
  if (relationship <= 50) return "you like them";
  return "you trust them deeply";
}

/** The <situation> block: everything that changes during play. */
/**
 * `trading` adds the NPC's stock and the player's items. They're only shown when
 * the player is talking trade, or for game events: on other turns the extra lines
 * distracted the model badly (reveal_secret calls fell from 10/10 to 4/10 with the
 * player's items, and to 0/10 once tiered stock was listed). The NPC still sees
 * its stock in the offer_item tool description.
 */
function buildSituation(
  persona: NpcPersona,
  state: NpcState,
  world: WorldSnapshot,
  trading: boolean,
  training = false,
  questing = false,
): string {
  const { player } = world;
  // Cheapest first (see itemsForSale), then anything the NPC doesn't sell.
  const forSale = itemsForSale({ persona, state });
  const notForSale = Object.keys(state.inventory).filter((item) => (state.inventory[item] ?? 0) > 0 && !forSale.includes(item));
  const stock =
    [
      ...forSale.map((item) => `${itemLabel(item)} x${state.inventory[item]} (${npcPrice(persona, item)} gold each)`),
      ...notForSale.map((item) => `${itemLabel(item)} x${state.inventory[item]}`),
    ].join(", ") || "nothing";
  const carrying =
    Object.entries(player.inventory)
      .map(([item, qty]) => `${itemLabel(item)} x${qty}`)
      .join(", ") || "nothing";
  const offer = state.pendingOffer;

  const lines = [
    `Time: ${formatTime(world)}. Place: ${world.location}.`,
    world.nearby.length > 0 ? `Nearby: ${world.nearby.join(", ")}.` : null,
    world.recentEvents.length > 0 ? `Recent news: ${world.recentEvents.join(" ")}` : null,
    `Your condition: ${describeCondition(state.hp, persona.stats.maxHp)} (HP ${state.hp}/${persona.stats.maxHp}, MP ${state.mp}/${persona.stats.maxMp}).`,
    `Your mood: ${state.mood}. ${player.name} is ${describeTrust(state.relationship)} (trust ${state.relationship}).`,
    state.inCombat
      ? `You are in a FIGHT with ${player.name}. They are ${describeCondition(player.hp, player.maxHp)} (HP ${player.hp}/${player.maxHp}) and armed with ${itemLabel(bestWeapon(player.inventory).name)}. You strike at them every turn until the fight ends.`
      : null,
    state.inCombat && state.lastCombatNote ? `Last exchange: ${state.lastCombatNote}` : null,
    !state.inCombat && state.provocations >= 2
      ? `${player.name} has insulted you ${state.provocations} times in a row${state.provocations >= provokeLimit(traitsOf(persona)) ? "; your patience is gone" : ""}.`
      : null,
    trading ? `Your stock: ${stock}. Your purse: ${state.gold} gold.` : null,
    state.discountPct > 0 ? `You're willing to sell for up to ${state.discountPct}% off.` : null,
    state.failedHaggles > 0 ? `${player.name} has tried to haggle you down ${state.failedHaggles} time(s) and failed.` : null,
    offer ? `You offered ${player.name} a ${offer.item} for ${offer.price} gold and are waiting for their answer.` : null,
    state.pendingPurchase
      ? `You offered ${state.pendingPurchase.price} gold for ${player.name}'s ${state.pendingPurchase.item} and are waiting for their answer.`
      : null,
    state.following ? `You are currently following ${player.name}.` : null,
    training ? describeTeaching(persona, state, world) : null,
    questing ? describeQuestsForNpc(persona, state, player) : null,
    state.pendingQuest
      ? `You offered them the job "${findQuest(persona, state, state.pendingQuest)?.title ?? state.pendingQuest}" and are waiting for their answer.`
      : null,
    state.pendingTraining
      ? `You offered to teach ${player.name} ${state.pendingTraining.skill.replace("_", "-")} for ${state.pendingTraining.hours}h (${state.pendingTraining.cost} gold) and are waiting for their answer.`
      : null,
    trading
      ? `${player.name} has ${player.gold} gold and carries: ${carrying}.`
      : `${player.name} has ${player.gold} gold.`,
    // Worked out in code: the model kept getting "is 50 enough for 40?" wrong.
    trading && forSale.length > 0 ? describeAffordable(persona, state, player.gold, forSale) : null,
  ].filter((l): l is string => l !== null);

  return `<situation>\n${lines.join("\n")}\n</situation>`;
}

/**
 * The per-turn message: current state first, then the player's line.
 * Everything that changes during play goes here, not in the system prompt.
 */
export function buildTurnMessage(
  persona: NpcPersona,
  state: NpcState,
  world: WorldSnapshot,
  playerLine: string,
  /** Override topic detection, e.g. to keep training on for a "yes" after a training request. */
  topic: { trading?: boolean; training?: boolean; questing?: boolean } = {},
): string {
  const trading = topic.trading ?? isTradeTalk(playerLine);
  const training = topic.training ?? isTrainingTalk(playerLine);
  const questing = topic.questing ?? isQuestTalk(playerLine);
  return `${buildSituation(persona, state, world, trading, training, questing)}\n\n${world.player.name} says: "${playerLine}"`;
}

/** A game event the NPC should react to, e.g. the player accepting an offer. */
export function buildEventMessage(
  persona: NpcPersona,
  state: NpcState,
  world: WorldSnapshot,
  event: string,
  /** True for trade events (a sale, a haggle). Others leave stock and the player's items out. */
  trading = false,
  /** True when the event is about training (shows what the NPC can teach). */
  training = false,
): string {
  return `${buildSituation(persona, state, world, trading, training)}\n\n(${event})`;
}
