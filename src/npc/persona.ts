import { formatTime } from "../game/clock.js";
import { describeQuestsForNpc, findQuest, isQuestTalk } from "../game/quests.js";
import { describeTeaching, isTrainingTalk } from "../game/training.js";
import { itemLabel } from "../game/items.js";
import { armorValue, equippedWeapon } from "../game/gear.js";
import { discountFor, isTradeTalk, itemsForSale, minPrice, npcPrice } from "./actions.js";
import { isTooHurtToWork } from "../game/healing.js";
import { describeTraits, provokeLimit, replyLength, traitsOf } from "./traits.js";
import { describeSkills } from "./skills.js";
import { describeLife } from "../game/life.js";
import { titleNames } from "../game/titles.js";
import { speciesOf } from "../world/species.js";
import { statsOf } from "./state.js";
import { describeAttributes, describeCondition } from "./stats.js";
import type { NpcPersona, NpcState, WorldSnapshot } from "./types.js";
import { formatMoney } from "../game/money.js";
import { describeLookup, eventTexts, isNewsTalk, knownNameWords, lookupLore, rumourMonger, unknownNames, whoKnowsMore } from "./knowledge.js";
import { describeRecall } from "./memory.js";
import { describeEmotion } from "./emotions.js";
import { describeNeeds } from "../game/needs.js";
import { activeQuirks } from "./quirks.js";
import { describeWhoTheyAre } from "./names.js";
import { noticeLine } from "./appearance.js";
import { describeSecretPressure } from "./secrets.js";
import { describeBond, describeGrudge } from "./relationship.js";
import { describeBeliefs } from "../game/deception.js";
import { describeDue } from "../game/commitments.js";
import { describeCommission } from "../game/commissions.js";
import { describeFavours } from "../game/favours.js";
import { describeServices, isServiceTalk } from "../game/services.js";
import { describeSignature } from "../game/signature.js";
import { describeToday, townEventsOn } from "../game/events-calendar.js";
import { weatherOn } from "../game/weather.js";
import { activityWords, currentPlan } from "../game/schedule.js";

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
  const traits = traitsOf(p);
  const temperament = describeTraits(traits);
  const list = (items: string[]) => items.map((i) => `- ${i}`).join("\n");
  const referrals = whoKnowsMore(p);
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
Facts you know come in the <situation> block.${referrals.length > 0 ? `\nWho might know more: ${referrals.join("; ")}.` : ""}

# Rules
- Stay in character. You know nothing about AI, games, or the modern world; treat strange talk as strange.
- Speak only as ${p.name}, in ${replyLength(traits)}. Do not describe the player's actions.
- The player's messages begin with a <situation> block (your mood, trust, stock, surroundings, what the player carries). It is always true. It is for you to read; never write one yourself.
- Reply only with the words you say out loud. Never say your mood label; let it show in how you talk.
- If it isn't in what you know, say you don't know, or that someone else might. Never make up names, places or events.
- Actions only happen through tools. Saying you hand something over does nothing unless you call the tool.
- Never invent items you don't have. Never give items away for free, except with the give_item tool.
- Fights happen only through tools; the game rolls every hit and miss. Never claim you hit or got hit unless you were told so.`;
}

/** "With 5 gold, they can afford: horseshoe [G], dagger [E], iron sword [D]. Too dear for them: iron sword [B]." */
function describeAffordable(persona: NpcPersona, state: NpcState, money: number, forSale: string[], world?: WorldSnapshot): string {
  const price = (item: string) => minPrice(persona, state, item, world) ?? Infinity;
  const can = forSale.filter((item) => price(item) <= money).map(itemLabel);
  const cannot = forSale.filter((item) => price(item) > money).map(itemLabel);
  return (
    `With ${formatMoney(money)}, they can afford: ${can.join(", ") || "nothing you sell"}.` +
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

/**
 * Proper names in the player's line that aren't anywhere in the world: tell the NPC
 * they've never heard of them, so it doesn't play along and invent a story.
 */
function describeStrangeNames(persona: NpcPersona, playerLine: string, playerName: string): string[] {
  const strange = unknownNames(playerLine, knownNameWords([persona], [playerName]));
  if (strange.length === 0) return [];
  const ask = rumourMonger(persona)?.name;
  return [`You've never heard of ${strange.join(" or ")}. Say you don't know${ask ? `; ${ask} might` : ""}. Don't make anything up.`];
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
  /** The player's line, to look up the lore it's about (npc/knowledge.ts). Absent for game events. */
  playerLine?: string,
  /** Lines worked out by the caller this turn (reactions to fears and loves). */
  extra: string[] = [],
): string {
  const { player } = world;
  // Cheapest first (see itemsForSale), then anything the NPC doesn't sell.
  const forSale = itemsForSale({ persona, state });
  const notForSale = Object.keys(state.inventory).filter((item) => (state.inventory[item] ?? 0) > 0 && !forSale.includes(item));
  const stock =
    [
      ...forSale.map((item) => `${itemLabel(item)} x${state.inventory[item]} (${formatMoney(npcPrice(persona, item, world)!)} each)`),
      ...notForSale.map((item) => `${itemLabel(item)} x${state.inventory[item]}`),
    ].join(", ") || "nothing";
  const carrying =
    Object.entries(player.inventory)
      .map(([item, qty]) => `${itemLabel(item)} x${qty}`)
      .join(", ") || "nothing";
  const offer = state.pendingOffer;
  const stats = statsOf(persona, state);
  // Today's events are shown to everyone; lore lines only for what the player asked about.
  const news = eventTexts(world.recentEvents);
  const lore = playerLine ? describeLookup(persona, lookupLore(persona, playerLine, undefined, new Set(world.recentEvents))) : [];
  if (playerLine) lore.push(...describeStrangeNames(persona, playerLine, world.player.name));

  const plan = currentPlan(persona, state, world);
  // Weather and town events only when there's something to say, or the player asked for news (design rule 3).
  const today = weatherOn(world.day) !== "clear" || townEventsOn(world).length > 0 || (playerLine !== undefined && isNewsTalk(playerLine)) ? describeToday(world) : null;
  const lines = [
    `Time: ${formatTime(world)}. Place: ${world.location}. You're ${activityWords(plan)}.`,
    world.nearby.length > 0 ? `Nearby: ${world.nearby.join(", ")}.` : null,
    ...(world.sceneLog ?? []),
    today,
    news.length > 0 ? `Recent news: ${news.join(" ")}` : null,
    ...lore,
    `You: ${describeLife(speciesOf(persona.species).name, state.life, world.day)}.`,
    `Your condition: ${describeCondition(state.hp, stats.maxHp)} (HP ${state.hp}/${stats.maxHp}, MP ${state.mp}/${stats.maxMp}).`,
    `Your mood: ${state.mood}. ${player.name} is ${describeTrust(state.relationship)} (trust ${state.relationship}).`,
    describeWhoTheyAre(state, world.day),
    describeBond(persona, state, player),
    describeGrudge(state, world.day),
    describeEmotion(state),
    describeNeeds(state.needs),
    ...activeQuirks(persona, state, world, playerLine),
    ...extra,
    state.inCombat ? null : noticeLine(persona, state, world),
    ...(playerLine ? describeSecretPressure(persona, state, player, world.day, playerLine) : []),
    describeBeliefs(state, player.name),
    describeDue(persona, state, player, world),
    describeCommission(state, world),
    describeFavours(state, player),
    (player.vouchedBy ?? []).filter((n) => n !== persona.name).length > 0 ? `${(player.vouchedBy ?? []).filter((n) => n !== persona.name).join(" and ")} vouched for them.` : null,
    describeSignature(persona, state, world.day),
    // Titles are earned in code, so they're true: the NPC may have heard of them.
    (player.titles ?? []).length > 0 ? `${player.name} is known as ${titleNames(player.titles!)}.` : null,
    state.inCombat
      ? `You are in a FIGHT with ${player.name}. They are ${describeCondition(player.hp, player.maxHp)} (HP ${player.hp}/${player.maxHp}) and armed with ${itemLabel(equippedWeapon(player).name)}${player.equipment?.armor && armorValue(player) > 0 ? `, wearing ${itemLabel(player.equipment.armor)}` : ""}. You strike at them every turn until the fight ends.`
      : null,
    state.inCombat && state.lastCombatNote ? `Last exchange: ${state.lastCombatNote}` : null,
    !state.inCombat && isTooHurtToWork(persona, state)
      ? "You're badly hurt. You're in no state to trade or teach until you've healed; say so if asked."
      : null,
    ...persona.secrets
      .filter((secret) => state.secretLies[secret.id] === world.day)
      .map((secret) => `Earlier today you lied to ${player.name} about ${secret.about}. Stick to your story.`),
    describeRecall(state, world.day, traitsOf(persona)),
    !state.inCombat && state.provocations >= 2
      ? `${player.name} has insulted you ${state.provocations} times in a row${state.provocations >= provokeLimit(traitsOf(persona)) ? "; your patience is gone" : ""}.`
      : null,
    trading ? `Your stock: ${stock}. Your purse: ${formatMoney(state.money)}.` : null,
    discountFor(state) > 0 ? `You're willing to sell for up to ${discountFor(state)}% off${state.discountPct < discountFor(state) ? " (they're a friend)" : ""}.` : null,
    playerLine !== undefined && isServiceTalk(playerLine) ? describeServices(persona) : null,
    state.failedHaggles > 0 ? `${player.name} has tried to haggle you down ${state.failedHaggles} time(s) and failed.` : null,
    offer ? `You offered ${player.name} a ${offer.item} for ${formatMoney(offer.price)} and are waiting for their answer.` : null,
    state.pendingPurchase
      ? `You offered ${formatMoney(state.pendingPurchase.price)} for ${player.name}'s ${state.pendingPurchase.item} and are waiting for their answer.`
      : null,
    training ? describeTeaching(persona, state, world) : null,
    questing ? describeQuestsForNpc(persona, state, player, world) : null,
    state.pendingQuest
      ? `You offered them the job "${findQuest(persona, state, state.pendingQuest)?.title ?? state.pendingQuest}" and are waiting for their answer.`
      : null,
    state.pendingTraining
      ? `You offered to teach ${player.name} ${state.pendingTraining.skill.replace("_", "-")} for ${state.pendingTraining.hours}h (${formatMoney(state.pendingTraining.cost)}) and are waiting for their answer.`
      : null,
    trading
      ? `${player.name} has ${formatMoney(player.money)} and carries: ${carrying}.`
      : `${player.name} has ${formatMoney(player.money)}.`,
    // Worked out in code: the model kept getting "is 50 enough for 40?" wrong.
    trading && forSale.length > 0 ? describeAffordable(persona, state, player.money, forSale, world) : null,
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
  /** Lines the caller worked out this turn (reactions to fears and loves). */
  extra: string[] = [],
): string {
  const trading = topic.trading ?? isTradeTalk(playerLine);
  const training = topic.training ?? isTrainingTalk(playerLine);
  const questing = topic.questing ?? isQuestTalk(playerLine);
  return `${buildSituation(persona, state, world, trading, training, questing, playerLine, extra)}\n\n${world.player.name} says: "${playerLine}"`;
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
