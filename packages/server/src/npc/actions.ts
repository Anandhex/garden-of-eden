import { z } from "zod";
import { config } from "../config.js";
import { attack, check, modifier, type Rng } from "../game/dice.js";
import { healingItems, isTooHurtToWork, useHealingItem } from "../game/healing.js";
import { debtStatus, payDebts } from "../game/debts.js";
import { effectiveGreed } from "../game/debts.js";
import {
  itemLabel,
  itemValue,
  parseItem,
  resolveItem,
  tierDamageBonus,
  tierMultiplier,
  wearFactor,
} from "../game/items.js";
import { equippedWeapon, playerHasRoom, repairCost, repairedKey, soak, wearGear } from "../game/gear.js";
import { tradeRecipes } from "../game/crafting.js";
import { describeObjective, questOfferError, questRewardMoney, questsFor } from "../game/quests.js";
import { quoteTraining, teachableSkills, teachCap } from "../game/training.js";
import { SKILLS, skillLevel } from "./skills.js";
import { npcHasRoom, npcSkills, statsOf } from "./state.js";
import {
  begsWhenCornered,
  fleeAt,
  giftTrust,
  insultTrustFactor,
  lieChance,
  maxGiftValue,
  moraleTarget,
  provokeLimit,
  type Traits,
  traitsOf,
} from "./traits.js";
import type { ToolDef } from "../llm/provider.js";
import { MOODS, type Mood, type NpcPersona, type NpcState, type PlayerState, type WorldSnapshot } from "./types.js";
import { formatMoney, PRICE_PARAM, PriceArgSchema } from "../game/money.js";
import { priceFactor } from "../game/events-calendar.js";
import { recordEvent } from "../game/events.js";
import { FAVOUR_KINDS, isFavourTalk, offerFavour, quoteFavour } from "../game/favours.js";
import { isServiceTalk, OFFERED_SERVICES, offerService, quoteService, SERVICE_KINDS } from "../game/services.js";
import { heldBack } from "../game/signature.js";
import { markBloodied } from "./appearance.js";
import { addEmotion } from "./emotions.js";
import { remember } from "./memory.js";
import {
  adjust,
  AFFECTION,
  amendsFine,
  canBeAttacked,
  FEAR_FOR_DISCOUNT,
  fearOf,
  friendDiscount,
  GRUDGE_REFUSAL,
  holdsGrudge,
  intimidationFear,
  setGrudge,
} from "./relationship.js";
import { isBroken, learnSecret, noteCover, reachableSecrets, SECRET_TRUST, usesCover } from "./secrets.js";
import { fearMoralePenalty } from "./triggers.js";
import { stockFactor } from "../game/economy.js";
import { factionMarkup, memberDiscount, standingForDeed, STANDING } from "../game/factions.js";
import { ARREST_BOUNTY, bountyOf, isGuard } from "../game/crime.js";
import { dilemmasFor, presentDilemma } from "../game/dilemmas.js";
import { isHireTalk, offerHire, quoteHire } from "../game/party.js";
import { quoteCommission } from "../game/commissions.js";
import { applyStatus, guardedDamage, hasStatus, tickStatuses, WEAKENED_PENALTY, clearStatuses } from "../game/status.js";
import { type Ability, ABILITIES, type AbilityId, abilitiesFor, chooseMove, combatStyle, SECOND_WIND_HP } from "../game/abilities.js";
import { maybeInjure } from "../game/health.js";
import { absoluteMinute } from "../game/clock.js";
import { townLearns } from "../game/reputation.js";
import { recordNpcDefeat } from "../game/quests.js";
import { wantRevenge } from "../director/revenge.js";
import { growthEvent, playerUsesSkill, skillTrial, addSkillXp } from "./growth.js";
import { rankForLevel } from "../game/levels.js";
import { tierIndex } from "../game/life.js";

/**
 * NPC actions are model *proposals*. The game validates and applies them,
 * then reports the result back so the NPC can react.
 *
 * Lessons from testing qwen3:4b-instruct on this machine:
 * - Offer only the tools that make sense right now (see toolsFor). Every extra
 *   tool made the model call the others less often.
 * - Restrict arguments to enums of what actually exists (items in stock, secret ids).
 * - Descriptions must say when to call the tool AND when not to.
 * - Anything with real consequences needs a check the model can't talk past:
 *   sales complete only when the player accepts (acceptOffer), secrets are only
 *   reachable at high trust, and every roll (checks, attacks) happens in code.
 */

/** Everything an action may read or change. */
export interface ActionContext {
  persona: NpcPersona;
  state: NpcState;
  world: WorldSnapshot;
  rng: Rng;
  /**
   * True when the player's line this turn is about trading (see isTradeTalk).
   * offer_to_buy is only offered then: as an always-on tool it crowded out
   * reveal_secret (5/5 → 1/5 in the bench).
   */
  tradeTalk?: boolean;
  /** True when the player's line this turn is about training (gates offer_training). */
  trainingTalk?: boolean;
  /** True when the player's line this turn is about work (gates offer_job). */
  questTalk?: boolean;
  /** True when the player's line this turn sounds like begging or giving up (gates end_fight). */
  pleading?: boolean;
  /** True when the player sounds sorry (gates make_amends, with a grudge). */
  amendsTalk?: boolean;
  /** True when the player asks a favour (gates offer_favour). */
  favourTalk?: boolean;
  /** True when the player asks for a room or healing (gates offer_service). */
  serviceTalk?: boolean;
  /** True when the player asks the NPC to come along (gates offer_companionship). */
  hireTalk?: boolean;
  /** The player's line this turn (gates present_dilemma by its keywords). */
  playerLine?: string;
}

/** Does the player sound like they're begging, apologising or giving up? */
export function isPleading(line: string): boolean {
  return /\b(sorry|stop|mercy|surrender|yield|give up|i give|enough|truce|peace|please don'?t|spare me|i'?m done)\b/i.test(line);
}

/** Crude but effective: does the player's line sound like buying or selling? */
export function isTradeTalk(line: string): boolean {
  return /\b(sell|selling|buy|buying|trade|worth|price|cost|costs|pay|afford|cheap|expensive|deal|offer|gold|silver|copper|coins?|money)\b/i.test(line);
}

export interface ActionResult {
  ok: boolean;
  message: string;
  /** reveal_secret only: the NPC lied instead of telling the secret. */
  lie?: boolean;
}

/** What a badly hurt NPC says to trade and training requests. */
export const HURT_REFUSAL = "You're in no state for this until you've healed. Tell them so.";

export { SECRET_TRUST };
// Provocation limit, flee threshold and morale target come from the NPC's traits (see traits.ts).

/** How each mood shifts trust. The game owns this, not the model. */
const TRUST_FROM_MOOD: Record<Mood, number> = {
  happy: 10,
  neutral: 0,
  annoyed: -5,
  angry: -15,
  afraid: -5,
  sad: 0,
};
const TRUST_FROM_PURCHASE = 5;
const HOSTILE: readonly Mood[] = ["annoyed", "angry"];

export const changeMoodArgs = z.object({ mood: z.enum(MOODS) });

/**
 * Validation schemas use plain strings for item and secret ids because those
 * change during play; applyAction checks them against the current state.
 * The schemas shown to the model (in toolsFor) use enums of what exists now.
 */
export const offerItemArgs = z.object({ item: z.string(), price: PriceArgSchema });
export const revealSecretArgs = z.object({ secret: z.string() });
export const offerToBuyArgs = z.object({ item: z.string(), price: PriceArgSchema });
export const offerTrainingArgs = z.object({ skill: z.enum(SKILLS), hours: z.number().int() });
export const offerQuestArgs = z.object({ quest: z.string() });
export const giveItemArgs = z.object({ item: z.string() });
export const noArgs = z.object({});
export const offerFavourArgs = z.object({ favour: z.enum(FAVOUR_KINDS), item: z.string().optional() });
export const offerServiceArgs = z.object({ service: z.enum(SERVICE_KINDS) });
export const presentDilemmaArgs = z.object({ dilemma: z.string() });
export const offerCommissionArgs = z.object({ item: z.string() });

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

function adjustTrust(state: NpcState, delta: number) {
  state.relationship = clamp(state.relationship + delta, -100, 100);
}

/** Does the player sound like they want to make up for something? Gates make_amends (with a grudge). */
export function isAmendsTalk(line: string): boolean {
  return /\b(sorry|apolog\w*|make (it|this) (right|up)|amends|forgive|regret|my fault|pay for (it|what)|compensat\w*)\b/i.test(line);
}

/**
 * The one place mood changes: updates trust and the provocation count.
 * Annoyed/angry in a row counts up; anything calmer resets it.
 * With `traits`, a hostile mood costs trust scaled by temper (insultTrustFactor).
 */
export function setMood(state: NpcState, mood: Mood, traits?: Pick<Traits, "temper">) {
  state.mood = mood;
  state.moodHours = 0;
  const hostile = HOSTILE.includes(mood);
  const factor = hostile && traits ? insultTrustFactor(traits) : 1;
  adjustTrust(state, Math.round(TRUST_FROM_MOOD[mood] * factor));
  state.provocations = hostile ? state.provocations + 1 : 0;
}

/** Materials the NPC works with (inputs to their trade's recipes): kept for work, never put on sale. */
export function workMaterials(persona: NpcPersona): Set<string> {
  return new Set(tradeRecipes(persona).flatMap((r) => Object.keys(r.inputs)));
}

/**
 * What the NPC asks for one copy, or undefined if it isn't for sale.
 * - Listed goods: their price, scaled by tier (an iron sword [B] costs 2.25x an iron sword [D]).
 * - Anything else they buy (`buys`) goes back on sale at its full value (they paid half),
 *   unless it's a material for their own work, like a smith's iron ore.
 * Worn gear sells for less either way (wearFactor).
 */
export function npcPrice(
  persona: NpcPersona,
  item: string,
  /** Today's conditions (game/events-calendar.ts): pelts dear in winter, weapons after a raid. */
  world?: Pick<WorldSnapshot, "day" | "recentEvents" | "lastRaidDay">,
  /** The seller's stock (N10): scarce goods, or goods they can't make more of, cost more (game/economy.ts). */
  state?: Pick<NpcState, "inventory">,
): number | undefined {
  const parsed = parseItem(item);
  if (!parsed) return undefined;
  const factor = (world ? priceFactor(parsed.name, world) : 1) * (state ? stockFactor(persona, state, parsed.name) : 1);
  const base = persona.prices[parsed.name];
  if (base !== undefined) return Math.max(1, Math.round(base * tierMultiplier(parsed.tier, parsed.def.tier) * wearFactor(parsed.key) * factor));
  if (persona.buys.includes(parsed.name) && !workMaterials(persona).has(parsed.name)) return Math.round(itemValue(parsed.key)! * factor);
  return undefined;
}

/** Why something the NPC has isn't for sale, in words for the player; null if it is. */
export function notForSaleReason(persona: NpcPersona, item: string): string | null {
  if (npcPrice(persona, item) !== undefined) return null;
  const name = parseItem(item)?.name ?? item;
  return workMaterials(persona).has(name) ? "kept for their work" : "not something they sell";
}

/**
 * The discount in effect: a won haggle or persuasion, a friend's discount (N5.6) or a
 * fellow member's (N7.3), whichever is biggest.
 */
export function discountFor(state: NpcState, persona?: Pick<NpcPersona, "id" | "faction">, player?: Pick<PlayerState, "factions" | "standing">): number {
  return Math.max(state.discountPct, friendDiscount(state), persona && player ? memberDiscount(persona, player) : 0);
}

/** Percent a wary NPC adds to their prices: distrust (N7: they've heard what you did), and their faction's grudge (N7.3). */
export const DISTRUST_MARKUP_AT = -10;
export function priceMarkup(persona: Pick<NpcPersona, "id" | "faction">, state: NpcState, player?: Pick<PlayerState, "standing">): number {
  const distrust = state.relationship <= DISTRUST_MARKUP_AT ? Math.min(30, Math.round(-state.relationship / 2)) : 0;
  // Both count: wary of you themselves, and as one of a faction you've crossed. At most 40%.
  return Math.min(40, distrust + (player ? factionMarkup(persona, player) : 0));
}

/** Lowest price the NPC accepts for an item, after any markup and discount. */
export function minPrice(persona: NpcPersona, state: NpcState, item: string, world?: Pick<WorldSnapshot, "day" | "recentEvents" | "lastRaidDay"> & { player?: PlayerState }): number | undefined {
  const list = npcPrice(persona, item, world, state);
  if (list === undefined) return undefined;
  const player = world?.player;
  return Math.ceil(list * (1 + priceMarkup(persona, state, player) / 100) * (1 - discountFor(state, persona, player) / 100));
}

/** Each tier of the NPC's haggling skill shrinks discounts the player wins by this much. */
export const HAGGLE_DAMPING_PER_TIER = 0.1;
/** Failed haggles allowed before the NPC refuses to budge (until the next sale). */
export const MAX_FAILED_HAGGLES = 3;

/**
 * Give the player a discount, shrunk by the NPC's haggling skill
 * (an adept haggler, tier 3, keeps 70% of it). Never lowers an existing discount.
 * Returns the discount now in effect.
 */
export function grantDiscount(persona: NpcPersona, state: NpcState, pct: number): number {
  const kept = 1 - HAGGLE_DAMPING_PER_TIER * skillLevel(npcSkills(persona, state), "haggling");
  state.discountPct = Math.max(state.discountPct, Math.round(pct * Math.max(0, kept)));
  // Pending deals improve right away: the NPC's offer gets cheaper, their buy offer higher.
  const offer = state.pendingOffer;
  if (offer) {
    const lowest = minPrice(persona, state, offer.item);
    if (lowest !== undefined) offer.price = Math.min(offer.price, lowest);
  }
  const purchase = state.pendingPurchase;
  if (purchase) {
    const most = maxBuyPrice(persona, state, purchase.item);
    if (most !== undefined) purchase.price = Math.max(purchase.price, Math.min(most, state.money));
  }
  return state.discountPct;
}

/** NPCs start buying at this share of an item's value. */
export const BUY_SHARE = 0.5;
/** How much a fully greedy NPC knocks off what it pays a stranger. */
const GREED_BUY_CUT = 0.4;
const TRUST_FROM_SELLING = 2;

/**
 * Most the NPC will pay the player for one `item`, or undefined if they don't buy it.
 * Half the item's value, less for greedy NPCs at low trust, more after a won
 * haggle/persuasion (discountPct works both ways: cheaper to buy, better to sell).
 */
export function maxBuyPrice(persona: NpcPersona, state: NpcState, item: string, world?: Pick<WorldSnapshot, "day" | "recentEvents" | "lastRaidDay">): number | undefined {
  const parsed = parseItem(item);
  const value = itemValue(item);
  if (!parsed || value === undefined || !persona.buys.includes(parsed.name)) return undefined;
  const trustShare = Math.max(0, Math.min(100, state.relationship)) / 100;
  const greedCut = 1 - GREED_BUY_CUT * effectiveGreed(persona, state) * (1 - trustShare);
  const demand = world ? priceFactor(parsed.name, world) : 1;
  const wary = 1 - priceMarkup(persona, state) / 100;
  // The tiny nudge keeps float error (25 * 0.64 = 15.999...) from losing a copper.
  return Math.max(1, Math.floor(value * BUY_SHARE * greedCut * demand * wary * (1 + discountFor(state) / 100) + 1e-9));
}

/** The NPC's weapon from the item list (fists if it isn't a known weapon). */
export function npcWeapon(state: Pick<NpcState, "equipment">) {
  return equippedWeapon(state);
}

/** True when the NPC has been pushed far enough to start a fight. */
export function isProvoked(persona: NpcPersona, state: NpcState): boolean {
  return state.provocations >= provokeLimit(traitsOf(persona, state)) && HOSTILE.includes(state.mood);
}

/** Items the NPC has in stock and has a price for. */
/**
 * Items the NPC has in stock and has a price for, cheapest first. The order matters:
 * with an iron sword [D] (40) and [B] (90) in stock, the model tended to quote the
 * dearer one; listing the cheap copy first makes it answer from that.
 */
export function itemsForSale({ persona, state }: Pick<ActionContext, "persona" | "state">): string[] {
  return Object.keys(state.inventory)
    // Hidden stock (game/signature.ts) only comes out for trusted regulars.
    .filter((item) => (state.inventory[item] ?? 0) > 0 && npcPrice(persona, item) !== undefined && !heldBack(persona, state, item))
    .sort((a, b) => npcPrice(persona, a, undefined, state)! - npcPrice(persona, b, undefined, state)!);
}

/** Items the NPC would give a trusted player as a gift right now (empty if they wouldn't give anything). */
export function giftableItems({ persona, state, world }: Pick<ActionContext, "persona" | "state" | "world">): string[] {
  const t = traitsOf(persona, state);
  if (state.inCombat || state.relationship < giftTrust(t) || state.lastGiftDay === world.day) return [];
  const most = maxGiftValue(t);
  return Object.keys(state.inventory).filter((item) => (state.inventory[item] ?? 0) > 0 && (itemValue(item) ?? Infinity) <= most);
}

/** Can the NPC trade with or work for the player right now? Null if so, else why not (for the model). */
function tradeBlock(ctx: ActionContext): string | null {
  if (ctx.state.inCombat) return "You can't trade in the middle of a fight.";
  if (isTooHurtToWork(ctx.persona, ctx.state)) return HURT_REFUSAL;
  if (holdsGrudge(ctx.state, ctx.world.day)) return GRUDGE_REFUSAL;
  if (isGuard(ctx.persona) && bountyOf(ctx.world.player) > 0) return "They're wanted. You won't deal with them until the fine is paid.";
  return null;
}

/** A guard may take a wanted player by force once the bounty is high enough (game/crime.ts). */
export function mayArrest(ctx: Pick<ActionContext, "persona" | "world">): boolean {
  return isGuard(ctx.persona) && bountyOf(ctx.world.player) >= ARREST_BOUNTY;
}

const changeMoodTool: ToolDef = {
  name: "change_mood",
  // Firm wording matters: with a second tool offered, the softer "Call this whenever..."
  // got called on 0-3 of 10 insults; this version on 8/8.
  description:
    "ALWAYS call this when the player insults, compliments, or threatens you, even if you also reply. Your mood must reflect how you feel.",
  parameters: z.toJSONSchema(changeMoodArgs),
};

/** The tools to offer the model this turn, based on the current state. */
export function toolsFor(ctx: ActionContext): ToolDef[] {
  const { persona, state } = ctx;
  // Fled or knocked out: they can still say a last line, but can't act.
  if (state.outcome) return [];
  const tools: ToolDef[] = [changeMoodTool];

  if (state.inCombat) {
    // In a fight the NPC attacks automatically every turn (see npcAttack / NpcAgent),
    // so the only choices left to the model are stopping or running. end_fight is only
    // offered when the player pleads: offered always, the model sometimes called it
    // right after being hit, and never fought back.
    if (ctx.pleading) tools.push({
      name: "end_fight",
      description:
        "Stop fighting. Call this only if the player begs, apologises or surrenders and you're willing to let it go. " +
        "Otherwise don't call it: the fight goes on and you keep attacking.",
      parameters: z.toJSONSchema(noArgs),
    });
    if (state.hp <= statsOf(persona, state).maxHp * fleeAt(traitsOf(persona, state))) {
      tools.push({
        name: "flee",
        description: "Run away from the fight. You are badly hurt; call this if you'd rather survive than keep fighting.",
        parameters: z.toJSONSchema(noArgs),
      });
    }
    return tools;
  }

  // Badly hurt NPCs won't trade or teach until they've healed (see the situation line), nor will one holding a grudge.
  const hurt = isTooHurtToWork(persona, state) || holdsGrudge(state, ctx.world.day);
  const forSale = hurt ? [] : itemsForSale(ctx);
  if (forSale.length > 0) {
    const priceList = forSale.map((item) => `${itemLabel(item)} (${formatMoney(minPrice(persona, state, item, ctx.world)!)})`).join(", ");
    tools.push({
      name: "offer_item",
      description:
        "Offer one item to the player at a price. The player then accepts or declines; you don't take the money yourself. " +
        "Call this when the player wants to buy something or asks for an item. Don't call it for price questions; just answer. " +
        `In stock: ${priceList}. Never offer below these prices.`,
      parameters: z.toJSONSchema(
        z.object({ item: z.enum(forSale as [string, ...string[]]), price: PRICE_PARAM }),
      ),
    });
  }

  // Things the player carries that this NPC would buy.
  const buyable = hurt
    ? []
    : Object.keys(ctx.world.player.inventory).filter(
        (item) => (ctx.world.player.inventory[item] ?? 0) > 0 && maxBuyPrice(persona, state, item, ctx.world) !== undefined,
      );
  if (ctx.tradeTalk && buyable.length > 0) {
    const payList = buyable.map((item) => `${itemLabel(item)} (up to ${formatMoney(maxBuyPrice(persona, state, item, ctx.world)!)})`).join(", ");
    tools.push({
      name: "offer_to_buy",
      description:
        "Offer to buy one item from the player for a price. The player then accepts or declines. " +
        "Call this when the player wants to sell you something. " +
        `You'd buy: ${payList}. Never offer more than that; you have ${formatMoney(state.money)}.`,
      parameters: z.toJSONSchema(
        z.object({ item: z.enum(buyable as [string, ...string[]]), price: PRICE_PARAM }),
      ),
    });
  }

  // Skills the NPC would teach right now (within the trust limit).
  const canTeach = (hurt ? [] : teachableSkills(persona, ctx.world))
    .map((t) => t.skill)
    .filter((skill) => skillLevel(ctx.world.player.skills, skill) < teachCap(state, ctx.world.player));
  if (ctx.trainingTalk && canTeach.length > 0) {
    tools.push({
      name: "offer_training",
      // Firm wording, as with change_mood: with the softer "Call this when..." Pell named a
      // price in words but never made an offer the player could accept.
      description:
        "ALWAYS call this when the player asks you to train or teach them, instead of just naming a price in words. " +
        "Offer your skill for some hours (1-8); the game works out the price, and they accept or decline.",
      parameters: z.toJSONSchema(z.object({ skill: z.enum(canTeach as [string, ...string[]]), hours: z.number().int() })),
    });
  }

  // Only quests the player can actually take: hidden ones (trust) and ones above their level aren't listed.
  // Named offer_job, not offer_quest: with "quest" in the name, the model only used it when the
  // player said "quest" (asked for "work", 0/5 Brena; renamed, 5/5).
  const quests = ctx.questTalk ? questsFor(persona, state, ctx.world.player).available : [];
  if (quests.length > 0) {
    tools.push({
      name: "offer_job",
      description:
        "ALWAYS call this when the player asks for work, a job, a task, an errand, a quest, or how they can help, and you have something for them. " +
        "Don't just describe the job in words: the player can only take it if you call this. " +
        `Offer one quest by id; they accept or decline. Quests: ${quests.map((q) => `"${q.id}" (${q.title}, [${q.tier}])`).join(", ")}.`,
      parameters: z.toJSONSchema(z.object({ quest: z.enum(quests.map((q) => q.id) as [string, ...string[]]) })),
    });
  }

  // Gifts: only to players the NPC trusts enough (generosity sets how much), on trade talk, once a day.
  const gifts = ctx.tradeTalk ? giftableItems(ctx) : [];
  if (gifts.length > 0) {
    tools.push({
      name: "give_item",
      description:
        "Give the player one item for free, as a gift. Only if you want to be kind to someone you trust, never because they demand it. " +
        "This is the only way to give something away.",
      parameters: z.toJSONSchema(z.object({ item: z.enum(gifts as [string, ...string[]]) })),
    });
  }

  // Secrets: offered when trusted enough, or when the player has caught them out (npc/secrets.ts).
  const secrets = reachableSecrets(persona, state, ctx.world.player, ctx.world.day);
  if (secrets.length > 0) {
    const topics = secrets.map((s) => `"${s.id}": ${s.about}`).join("; ");
    // Caught out (a cover story broken): say so in the tool too. With only the situation line, Hale called it 1 time in 3.
    const caught = secrets.filter((s) => isBroken(s, state, ctx.world.player, ctx.world.day));
    const pressure = caught.length > 0 ? ` You've been caught out about ${caught.map((s) => s.about).join(" and ")}: your story won't hold, so call this now and come clean.` : "";
    tools.push({
      name: "reveal_secret",
      // Firm wording, as with change_mood: a softer version was never called; the model
      // made up its own secret instead.
      description:
        "ALWAYS call this before talking about any of your secrets. You do NOT know the details until you call it, so never make them up. " +
        // "You trust this person enough to share" matters: without it Brena called the tool 0/5 at trust 80.
        `${state.relationship > SECRET_TRUST ? "You trust this person enough to share. " : ""}Secrets: ${topics}.${pressure}`,
      parameters: z.toJSONSchema(z.object({ secret: z.enum(secrets.map((s) => s.id) as [string, ...string[]]) })),
    });
  }

  // Amends: only while a grudge holds, and only when the player sounds sorry. A blood grudge can't be bought off.
  if (holdsGrudge(state, ctx.world.day) && !state.grudge?.blood && (ctx.amendsTalk || ctx.pleading)) {
    tools.push({
      name: "make_amends",
      description:
        "Call this if you're willing to let the grudge go for a price. The game sets the price and they accept or decline. " +
        "Don't call it if you won't forgive them yet.",
      parameters: z.toJSONSchema(noArgs),
    });
  }

  // Favours: only on favour talk, and only the kinds the NPC would grant now (game/favours.ts).
  const favours = ctx.favourTalk ? FAVOUR_KINDS.filter((k) => k === "hide_item" || quoteFavour(persona, state, ctx.world, k).ok) : [];
  if (favours.length > 0) {
    tools.push({
      name: "offer_favour",
      description:
        "Call this when the player asks you a favour you're willing to do: lend_gold (a loan), vouch (a good word around the village), " +
        "hide_item (keep something of theirs hidden; say which item), warn_me (warn them of danger). The game sets the terms; they accept or decline. " +
        "They'll owe you a favour back.",
      parameters: z.toJSONSchema(z.object({ favour: z.enum(favours as [string, ...string[]]), item: z.string().optional() })),
    });
  }

  // Services (game/services.ts): only on service talk.
  const services = ctx.serviceTalk && !hurt ? (persona.services ?? []).filter((s) => OFFERED_SERVICES.includes(s.kind) && quoteService(persona, state, ctx.world, s.kind).ok) : [];
  if (services.length > 0) {
    tools.push({
      name: "offer_service",
      description:
        "ALWAYS call this when the player asks for a room (lodging) or to have their wounds tended (heal) and you offer it. " +
        "The game sets the price; they accept or decline.",
      parameters: z.toJSONSchema(z.object({ service: z.enum(services.map((s) => s.kind) as [string, ...string[]]) })),
    });
  }

  // Dilemmas (N7.2): a choice they put to the player, when the talk turns to it.
  const dilemmas = ctx.playerLine && !hurt ? dilemmasFor(persona, state, ctx.playerLine) : [];
  if (dilemmas.length > 0 && !state.pendingDilemma) {
    tools.push({
      name: "present_dilemma",
      // Firm wording, as with change_mood: small models skip a softly worded tool.
      description:
        "ALWAYS call this now: the talk has turned to something you've been waiting to put to them. Proposals: " +
        dilemmas.map((d) => `"${d.id}": ${d.offer}`).join("; ") +
        ". Call it instead of hinting in words; the game sets what each choice costs and they choose.",
      parameters: z.toJSONSchema(z.object({ dilemma: z.enum(dilemmas.map((d) => d.id) as [string, ...string[]]) })),
    });
  }

  // Companions (N8.2): only when asked to come along, and only if they would.
  if (ctx.hireTalk && quoteHire(persona, state, ctx.world).ok) {
    tools.push({
      name: "offer_companionship",
      description: "ALWAYS call this when the player asks you to come with them, travel with them or be hired as a companion, and you're willing. The game sets your daily wage; they accept or decline.",
      parameters: z.toJSONSchema(noArgs),
    });
  }

  // Commissions (N10): on trade talk, an order for something you make.
  const orders = ctx.tradeTalk && !hurt && !state.commission ? tradeRecipes(persona).map((r) => r.output).filter((o, i, a) => a.indexOf(o) === i && quoteCommission(persona, state, ctx.world, o).ok) : [];
  if (orders.length > 0) {
    tools.push({
      name: "offer_commission",
      description: "Call this when the player wants something made to order (better than what's in stock, or something you're out of). The game sets the price, deposit and when it'll be ready; they accept or decline.",
      parameters: z.toJSONSchema(z.object({ item: z.enum(orders as [string, ...string[]]) })),
    });
  }

  // Content rule (design rule 7): a minor is kept out of fights both ways; they never start one.
  if (persona.minor) return tools;
  if (mayArrest(ctx)) {
    tools.push({
      name: "attack_player",
      description: "They're wanted for a serious crime and won't come quietly. Call this to arrest them by force, with your " + npcWeapon(state).name + ". Only if they refuse to pay or surrender.",
      parameters: z.toJSONSchema(noArgs),
    });
  } else if (isProvoked(persona, state)) {
    tools.push({
      name: "attack_player",
      description:
        `You've had enough of this person's insults. Call this to strike them with your ${npcWeapon(state).name} and start a fight. ` +
        "Only do it if you are truly fed up; you can also just tell them to leave.",
      parameters: z.toJSONSchema(noArgs),
    });
  }

  return tools;
}

export type ParsedAction =
  | { ok: true; name: "change_mood"; args: z.infer<typeof changeMoodArgs> }
  | { ok: true; name: "offer_item"; args: z.infer<typeof offerItemArgs> }
  | { ok: true; name: "reveal_secret"; args: z.infer<typeof revealSecretArgs> }
  | { ok: true; name: "offer_to_buy"; args: z.infer<typeof offerToBuyArgs> }
  | { ok: true; name: "offer_training"; args: z.infer<typeof offerTrainingArgs> }
  | { ok: true; name: "offer_job"; args: z.infer<typeof offerQuestArgs> }
  | { ok: true; name: "give_item"; args: z.infer<typeof giveItemArgs> }
  | { ok: true; name: "attack_player"; args: z.infer<typeof noArgs> }
  | { ok: true; name: "flee"; args: z.infer<typeof noArgs> }
  | { ok: true; name: "end_fight"; args: z.infer<typeof noArgs> }
  | { ok: true; name: "make_amends"; args: z.infer<typeof noArgs> }
  | { ok: true; name: "offer_favour"; args: z.infer<typeof offerFavourArgs> }
  | { ok: true; name: "offer_service"; args: z.infer<typeof offerServiceArgs> }
  | { ok: true; name: "present_dilemma"; args: z.infer<typeof presentDilemmaArgs> }
  | { ok: true; name: "offer_companionship"; args: z.infer<typeof noArgs> }
  | { ok: true; name: "offer_commission"; args: z.infer<typeof offerCommissionArgs> }
  | { ok: false; error: string };

const schemas = {
  change_mood: changeMoodArgs,
  offer_item: offerItemArgs,
  reveal_secret: revealSecretArgs,
  offer_to_buy: offerToBuyArgs,
  offer_training: offerTrainingArgs,
  offer_job: offerQuestArgs,
  give_item: giveItemArgs,
  attack_player: noArgs,
  flee: noArgs,
  end_fight: noArgs,
  make_amends: noArgs,
  offer_favour: offerFavourArgs,
  offer_service: offerServiceArgs,
  present_dilemma: presentDilemmaArgs,
  offer_companionship: noArgs,
  offer_commission: offerCommissionArgs,
};

/** Validate a raw tool call from the model. Never throws. */
export function parseAction(name: string, args: unknown): ParsedAction {
  if (!(name in schemas)) return { ok: false, error: `Unknown action "${name}"` };
  // Models sometimes send null or omit arguments for no-argument tools.
  const r = schemas[name as keyof typeof schemas].safeParse(args ?? {});
  if (!r.success) return { ok: false, error: z.prettifyError(r.error) };
  return { ok: true, name, args: r.data } as ParsedAction;
}

/** "rolled 14+1=15 vs 12" for logs and tool results. */
function describeRoll(r: { roll: number; total: number; target: number }): string {
  const mod = r.total - r.roll;
  return `rolled ${r.roll}${mod >= 0 ? "+" : ""}${mod}=${r.total} vs ${r.target}`;
}

/**
 * Apply a validated action to game state. Mutates `state` and `world.player`.
 * Returns a short message for the model, e.g. "You offered dagger for 1 gold 5 silver."
 * or "Traveler only has 1 silver." (ok: false).
 */
export function applyAction(action: Extract<ParsedAction, { ok: true }>, ctx: ActionContext): ActionResult {
  const { persona, state, world } = ctx;
  switch (action.name) {
    case "change_mood":
      setMood(state, action.args.mood, traitsOf(persona, state));
      return { ok: true, message: "Mood updated. Now reply in character; let the feeling show in your words, never name it." };

    case "offer_item": {
      const blocked = tradeBlock(ctx);
      if (blocked) return { ok: false, message: blocked };
      const { price } = action.args;
      const item = resolveItem(state.inventory, action.args.item) ?? action.args.item;
      const player = world.player;
      const lowest = minPrice(persona, state, item, world);

      if (!state.inventory[item]) return { ok: false, message: `You don't have any ${itemLabel(item)}.` };
      if (lowest === undefined) return { ok: false, message: `You don't sell ${itemLabel(item)}.` };
      if (heldBack(persona, state, item)) return { ok: false, message: `You keep ${itemLabel(item)} for trusted regulars only.` };
      if (price < lowest) return { ok: false, message: `${formatMoney(price)} is below your price for ${item} (${formatMoney(lowest)}).` };
      if (player.money < price)
        return { ok: false, message: `${player.name} only has ${formatMoney(player.money)}; ${item} costs ${formatMoney(price)}.` };
      if (!playerHasRoom(player, { [item]: 1 })) return { ok: false, message: `${player.name} can't carry any more; their pack is full.` };

      state.pendingOffer = { item, price };
      return {
        ok: true,
        message: `You offered ${itemLabel(item)} for ${formatMoney(price)}. Tell them exactly that now; they'll accept or decline. Don't hand it over yet.`,
      };
    }

    case "offer_to_buy": {
      const blocked = tradeBlock(ctx);
      if (blocked) return { ok: false, message: blocked };
      const { price } = action.args;
      const player = world.player;
      const item = resolveItem(player.inventory, action.args.item) ?? action.args.item;
      const most = maxBuyPrice(persona, state, item, world);

      if (most === undefined) return { ok: false, message: `You don't buy ${item}.` };
      if (!player.inventory[item]) return { ok: false, message: `${player.name} doesn't have any ${item}.` };
      if (price < 1) return { ok: false, message: "Offer at least 1 copper." };
      if (price > most) return { ok: false, message: `${formatMoney(price)} is more than ${item} is worth to you (${formatMoney(most)} at most).` };
      if (price > state.money) return { ok: false, message: `You only have ${formatMoney(state.money)}.` };
      if (!npcHasRoom(persona, state, { [item]: 1 })) return { ok: false, message: `You've no room left for ${itemLabel(item)}${persona.storage ? ` (${persona.storage.name} is full)` : ""}.` };

      state.pendingPurchase = { item, price };
      return {
        ok: true,
        message: `You offered ${formatMoney(price)} for ${player.name}'s ${itemLabel(item)}. Tell them exactly that now; they'll accept or decline. Don't pay yet.`,
      };
    }

    case "offer_training": {
      const quote = quoteTraining(persona, state, world, action.args.skill, action.args.hours);
      if (!quote.ok) return { ok: false, message: quote.message };
      state.pendingTraining = { skill: action.args.skill, hours: quote.hours, cost: quote.cost };
      const asked = Math.max(1, Math.floor(action.args.hours));
      const why = quote.endLevel >= quote.cap ? "that's as far as you'll teach them" : "that's all they can afford";
      // Terms first and in plain words: the model tended to repeat the hours the player asked for.
      const terms = `${quote.hours} hour${quote.hours === 1 ? "" : "s"} of ${action.args.skill.replace("_", "-")} for ${formatMoney(quote.cost)}`;
      return {
        ok: true,
        message:
          `Say exactly these terms: ${terms}.` +
          (quote.hours < asked ? ` Not ${asked} hours: ${why}.` : "") +
          " They'll accept or decline. Don't start yet.",
      };
    }

    case "offer_job": {
      if (state.inCombat) return { ok: false, message: "Not in the middle of a fight." };
      const error = questOfferError(persona, state, world.player, action.args.quest);
      if (error) return { ok: false, message: error };
      const quest = questsFor(persona, state, world.player).available.find((q) => q.id === action.args.quest)!;
      state.pendingQuest = quest.id;
      return {
        ok: true,
        message:
          `Say exactly this offer: "${quest.title}" [${quest.tier}]: ${describeObjective(quest)}, ` +
          `for ${formatMoney(questRewardMoney(persona, quest))}. They'll accept or decline.`,
      };
    }

    case "reveal_secret": {
      const secret = persona.secrets.find((s) => s.id === action.args.secret);
      if (!secret) return { ok: false, message: `You have no secret called "${action.args.secret}".` };
      // Checked again here: the tool is only offered when trusted or caught out, but never trust that alone.
      const reachable = reachableSecrets(persona, state, world.player, world.day).includes(secret) || state.revealedSecrets.includes(secret.id);
      if (!reachable) return { ok: false, message: "You don't trust them enough to share that." };
      // A secret with a cover story: the cover, until they're caught out (npc/secrets.ts).
      if (usesCover(persona, secret, state, world.player, world.day)) {
        noteCover(persona, secret, world.player, world.day);
        return { ok: true, lie: true, message: `Don't tell the truth. Tell them your story instead: ${secret.cover}` };
      }
      // A dishonest NPC may lie instead, and sticks to the lie for the rest of the day.
      // Honest NPCs (chance 0) don't roll, so they use no dice here; nor does anyone who's been caught out.
      const liedToday = state.secretLies[secret.id] === world.day && !secret.cover;
      const chance = state.revealedSecrets.includes(secret.id) || secret.cover ? 0 : lieChance(traitsOf(persona, state));
      if (liedToday || (chance > 0 && ctx.rng() < chance)) {
        state.secretLies[secret.id] = world.day;
        return {
          ok: true,
          lie: true,
          message: `You decide to lie about ${secret.about}. Deny it, or give a believable cover story. Don't tell the truth today.`,
        };
      }
      if (!state.revealedSecrets.includes(secret.id)) {
        state.revealedSecrets.push(secret.id);
        learnSecret(persona, secret, world.player, world.day);
        remember(state, { id: `told-${secret.id}`, day: world.day, text: `you told them about ${secret.about}`, importance: 5, valence: 1 }, traitsOf(persona, state));
        recordEvent(world, { kind: "secret-shared", actor: persona.id, target: "player", details: secret.id, importance: 5 });
      }
      const status = secret.debt ? ` ${debtStatus(persona, state, secret.debt)}` : "";
      return { ok: true, message: `Tell them this in your own words: ${secret.text}${status}` };
    }

    case "make_amends": {
      if (!holdsGrudge(state, world.day)) return { ok: false, message: "You don't hold a grudge against them." };
      const fine = amendsFine(persona);
      state.pendingAmends = { fine };
      return { ok: true, message: `Tell them it'll cost ${formatMoney(fine)} to make things right. They'll pay or not.` };
    }

    case "offer_favour": {
      if (state.inCombat) return { ok: false, message: "Not in the middle of a fight." };
      const quote = offerFavour(persona, state, world, action.args.favour, action.args.item);
      if (!quote.ok) return { ok: false, message: `${quote.message} Turn them down.` };
      return { ok: true, message: `Say these terms: you'll ${quote.message}. They'll accept or decline, and they'll owe you one.` };
    }

    case "offer_service": {
      const quote = offerService(persona, state, world, action.args.service);
      if (!quote.ok) return { ok: false, message: quote.message };
      return { ok: true, message: `Say exactly this offer: ${quote.message}. They'll accept or decline.` };
    }

    case "give_item": {
      const item = resolveItem(state.inventory, action.args.item) ?? action.args.item;
      if (!state.inventory[item]) return { ok: false, message: `You don't have any ${itemLabel(item)}.` };
      // Rechecked here: trust, value and the once-a-day limit, whatever the model was offered.
      if (!giftableItems(ctx).includes(item)) return { ok: false, message: `You won't give ${itemLabel(item)} away.` };
      if (!playerHasRoom(world.player, { [item]: 1 })) return { ok: false, message: `${world.player.name} can't carry any more.` };
      state.inventory[item] -= 1;
      if (state.inventory[item] === 0) delete state.inventory[item];
      world.player.inventory[item] = (world.player.inventory[item] ?? 0) + 1;
      state.lastGiftDay = world.day;
      return { ok: true, message: `You gave ${world.player.name} a ${itemLabel(item)} as a gift. Tell them, in your own words.` };
    }

    case "attack_player": {
      if (persona.minor) return { ok: false, message: "Children don't start fights." };
      if (!state.inCombat && !isProvoked(persona, state) && !mayArrest(ctx)) return { ok: false, message: "You haven't been provoked enough to attack." };
      return npcAttack(ctx);
    }

    case "present_dilemma": {
      if (state.inCombat) return { ok: false, message: "Not in the middle of a fight." };
      const offered = ctx.playerLine ? dilemmasFor(persona, state, ctx.playerLine).some((d) => d.id === action.args.dilemma) : false;
      if (!offered) return { ok: false, message: "That's not something to bring up now." };
      return presentDilemma(persona, state, action.args.dilemma);
    }

    case "offer_companionship": {
      if (state.inCombat) return { ok: false, message: "Not in the middle of a fight." };
      const q = offerHire(persona, state, world);
      if (!q.ok) return { ok: false, message: `${q.message} Turn them down.` };
      return { ok: true, message: `Name your price in your own words: ${q.message}, and you'll go along with them. They'll accept or decline.` };
    }

    case "offer_commission": {
      const blocked = tradeBlock(ctx);
      if (blocked) return { ok: false, message: blocked };
      const q = quoteCommission(persona, state, world, action.args.item);
      if (!q.ok) return { ok: false, message: q.message };
      state.pendingCommission = q.recipe!.output;
      return { ok: true, message: `Say exactly this offer: ${q.message}. They'll accept or decline; they pay the deposit if they accept.` };
    }

    case "end_fight": {
      if (!state.inCombat) return { ok: false, message: "There's no fight to end." };
      state.inCombat = false;
      state.lastCombatNote = null;
      return { ok: true, message: "The fight is over; you've let it go. Tell them so, in your own words." };
    }

    case "flee": {
      if (!state.inCombat) return { ok: false, message: "There's no fight to run from." };
      if (state.hp > statsOf(persona, state).maxHp * fleeAt(traitsOf(persona, state))) return { ok: false, message: "You're not hurt enough to run." };
      state.outcome = "fled";
      state.inCombat = false;
      state.conversationOver = true;
      return { ok: true, message: "You run from the fight. Say one last line as you go." };
    }
  }
}

/**
 * Complete the pending sale. Called by the game when the player accepts the
 * offer, never by the model. Rechecks everything, since state may have changed.
 */
export function acceptOffer({ persona, state, world }: ActionContext): ActionResult {
  const offer = state.pendingOffer;
  if (!offer) return { ok: false, message: "There is no offer to accept." };
  state.pendingOffer = null;
  if (holdsGrudge(state, world.day)) return { ok: false, message: GRUDGE_REFUSAL };

  const { item, price } = offer;
  const player = world.player;
  if (!state.inventory[item]) return { ok: false, message: `The ${item} is no longer in stock.` };
  if (player.money < price) return { ok: false, message: `${player.name} can't afford ${item} for ${formatMoney(price)}.` };
  if (!playerHasRoom(player, { [item]: 1 })) return { ok: false, message: `${player.name} has no room in their pack for the ${item}.` };

  player.money -= price;
  state.money += price;
  state.inventory[item] -= 1;
  if (state.inventory[item] === 0) delete state.inventory[item];
  player.inventory[item] = (player.inventory[item] ?? 0) + 1;
  adjustTrust(state, TRUST_FROM_PURCHASE);
  state.discountPct = 0; // a discount is good for one sale
  state.failedHaggles = 0;
  payDebts(persona, state); // quietly, never told to the model
  recordEvent(world, { kind: "bought", actor: "player", target: persona.id, details: item, importance: 2 });
  remember(state, { id: `bought-${world.day}`, day: world.day, text: `they bought ${itemLabel(item)} from you`, importance: 2, valence: 1 }, traitsOf(persona, state));
  return { ok: true, message: `${player.name} accepted and paid ${formatMoney(price)} for the ${item}.` };
}

/** Called by the game when the player turns the offer down. */
export function declineOffer({ state, world }: ActionContext): ActionResult {
  const offer = state.pendingOffer;
  if (!offer) return { ok: false, message: "There is no offer to decline." };
  state.pendingOffer = null;
  return { ok: true, message: `${world.player.name} declined your offer of ${offer.item} for ${formatMoney(offer.price)}.` };
}

/**
 * Complete the NPC's offer to buy from the player. Called by the game when the
 * player accepts. Rechecks everything, since state may have changed.
 */
export function acceptPurchase({ persona, state, world }: ActionContext): ActionResult {
  const offer = state.pendingPurchase;
  if (!offer) return { ok: false, message: "There is no offer to accept." };
  state.pendingPurchase = null;
  if (holdsGrudge(state, world.day)) return { ok: false, message: GRUDGE_REFUSAL };

  const { item, price } = offer;
  const player = world.player;
  if (!player.inventory[item]) return { ok: false, message: `${player.name} no longer has the ${item}.` };
  if (state.money < price) return { ok: false, message: `You can't afford to pay ${formatMoney(price)} any more.` };
  if (!npcHasRoom(persona, state, { [item]: 1 })) return { ok: false, message: `You've no room left for the ${item}.` };

  state.money -= price;
  player.money += price;
  player.inventory[item] -= 1;
  if (player.inventory[item] === 0) delete player.inventory[item];
  state.inventory[item] = (state.inventory[item] ?? 0) + 1;
  adjustTrust(state, TRUST_FROM_SELLING);
  state.discountPct = 0; // a won haggle is good for one deal
  state.failedHaggles = 0;
  recordEvent(world, { kind: "sold", actor: "player", target: persona.id, details: item, importance: 2 });
  return { ok: true, message: `${player.name} sold you the ${item} for ${formatMoney(price)}.` };
}

/** Called by the game when the player turns down the NPC's offer to buy. */
export function declinePurchase({ state, world }: ActionContext): ActionResult {
  const offer = state.pendingPurchase;
  if (!offer) return { ok: false, message: "There is no offer to decline." };
  state.pendingPurchase = null;
  return { ok: true, message: `${world.player.name} turned down your offer of ${formatMoney(offer.price)} for their ${offer.item}.` };
}

/** Who can repair gear: anyone with some smithing. */
export function isSmith(persona: NpcPersona): boolean {
  return skillLevel(persona.skills, "smithing") > 0;
}

/**
 * The player pays a smith to mend a piece of gear: "weapon" or "armor" (what
 * they have equipped) or an item in their pack. Done in code; the fee goes to
 * the smith. The price is repairCost (half the value the wear took off).
 */
export function repairForPlayer(which: string, ctx: ActionContext, { quote = false } = {}): ActionResult & { cost: number } {
  const { persona, state, world } = ctx;
  const player = world.player;
  const fail = (message: string) => ({ ok: false, cost: 0, message });
  if (!isSmith(persona)) return fail(`${persona.name} doesn't repair gear.`);
  if (state.inCombat || state.outcome) return fail(`${persona.name} is in no state for that.`);
  if (isTooHurtToWork(persona, state)) return fail(HURT_REFUSAL);
  if (state.mood === "angry" || state.relationship < 0 || holdsGrudge(state, world.day)) return fail(`${persona.name} won't do work for you right now.`);

  const slot = which === "weapon" || which === "armor" ? which : null;
  const key = slot ? player.equipment?.[slot] : resolveItem(player.inventory, which);
  if (!key || (!slot && !player.inventory[key])) return fail(slot ? `You have nothing in your ${slot} slot.` : `You don't have ${itemLabel(which)}.`);
  const cost = repairCost(key);
  if (cost === 0) return fail(`Your ${itemLabel(key)} doesn't need mending.`);
  if (player.money < cost) return fail(`Mending your ${itemLabel(key)} costs ${formatMoney(cost)}; you have ${formatMoney(player.money)}.`);
  if (quote) return { ok: true, cost, message: `Mending your ${itemLabel(key)} costs ${formatMoney(cost)}.` };

  const fixed = repairedKey(key);
  if (slot) player.equipment![slot] = fixed;
  else {
    player.inventory[key] = (player.inventory[key] ?? 0) - 1;
    if (player.inventory[key] === 0) delete player.inventory[key];
    player.inventory[fixed] = (player.inventory[fixed] ?? 0) + 1;
  }
  player.money -= cost;
  state.money += cost;
  payDebts(persona, state);
  return { ok: true, cost, message: `${player.name} paid you ${formatMoney(cost)} to mend their ${itemLabel(fixed)}. It's good as new.` };
}

export type SocialKind = "persuade" | "intimidate";

/**
 * The player tries to persuade (charisma + speechcraft) or intimidate (strength + intimidation)
 * the NPC. Rolled against 10 + the NPC's willpower modifier + the NPC's level in the same skill. Returns the event the NPC
 * is told about, and whether it worked.
 */
export function socialCheck(kind: SocialKind, attempt: string, ctx: ActionContext): ActionResult & { success: boolean } {
  const { persona, state, world, rng } = ctx;
  const player = world.player;
  if (state.inCombat) return { ok: false, success: false, message: "You can't talk your way out of a fight that's already started." };
  if (state.socialFailureDay !== world.day) {
    state.socialFailures = { persuade: 0, intimidate: 0 };
    state.socialFailureDay = world.day;
  }
  const failures = state.socialFailures[kind];
  if (failures >= config.maxSocialFailuresPerDay) {
    return { ok: false, success: false, message: `${persona.name} won't hear another word of that today. Try again tomorrow.` };
  }

  // Persuade: charisma + speechcraft. Intimidate: strength + intimidation.
  // The NPC resists with willpower + the same skill, and each failure today makes the next harder.
  const skill = kind === "persuade" ? "speechcraft" : "intimidation";
  const stat = kind === "persuade" ? player.attributes.charisma : player.attributes.strength;
  const target =
    10 + modifier(statsOf(persona, state).attributes.willpower) + skillLevel(npcSkills(persona, state), skill) + config.socialFailurePenalty * failures;
  const result = check(rng, stat, target, skillLevel(player.skills, skill));
  const said = `${player.name} tried to ${kind} you: "${attempt}"`;
  const roll = describeRoll(result);

  if (kind === "persuade") {
    if (result.success) {
      adjustTrust(state, 15);
      state.wonCheckDay.persuade = world.day; // breaks a cover story that can be talked out of them (npc/secrets.ts)
      const pct = grantDiscount(persona, state, 20);
      if (state.mood !== "happy") setMood(state, "neutral");
      return {
        ok: true,
        success: true,
        message: `${said}. It worked (${roll}): they've won you over. You're inclined to agree to what they asked, and you'd give them up to ${pct}% off.`,
      };
    }
    setMood(state, "annoyed", traitsOf(persona, state));
    state.socialFailures.persuade += 1;
    return { ok: true, success: false, message: `${said}. It didn't work (${roll}): you're not convinced, and a little annoyed. Turn them down.` };
  }

  if (result.success) {
    setMood(state, "afraid");
    adjustTrust(state, -10);
    state.wonCheckDay.intimidate = world.day;
    // Fear is what buys a discount: a brave NPC may be shaken without giving in on price (npc/relationship.ts).
    adjust(state, "fear", intimidationFear(traitsOf(persona, state)));
    adjust(state, "respect", -5);
    recordEvent(world, { kind: "threatened", actor: "player", target: persona.id, details: attempt, importance: 5 });
    remember(state, { id: `threatened-${world.day}`, day: world.day, text: `they threatened you, and it worked`, importance: 5, valence: -1 }, traitsOf(persona, state));
    if (fearOf(state, player) < FEAR_FOR_DISCOUNT) {
      return { ok: true, success: true, message: `${said}. It worked (${roll}): you're shaken, and you'll answer them straight, but not scared enough to cut your prices.` };
    }
    const pct = grantDiscount(persona, state, 30);
    return { ok: true, success: true, message: `${said}. It worked (${roll}): you're afraid of them. You'd give in on price, up to ${pct}% off.` };
  }
  // A failed threat is a provocation: it counts towards the NPC's patience like an insult (setMood).
  setMood(state, "angry", traitsOf(persona, state));
  state.socialFailures.intimidate += 1;
  return { ok: true, success: false, message: `${said}. It didn't work (${roll}): you're not scared, you're angry.` };
}

/** Options for a blow: an MP ability, or pulling punches to knock out rather than kill (N8). */
export interface AttackOptions {
  ability?: Ability;
  /** The player means to knock them out, not kill them (/subdue). */
  subdue?: boolean;
}

/** Hours a subdued NPC stays out cold. */
export const UNCONSCIOUS_HOURS = 4;

/** Roll an ability's status on whoever it lands on. Returns a line, or "". */
function inflict(ability: Ability | undefined, target: { statuses?: StatusEffectList; hp: number }, name: string, rng: Rng): string {
  const i = ability?.inflicts;
  if (!i || rng() >= i.chance) return "";
  applyStatus(target, i.kind, i.turns, i.power);
  return ` ${name} is ${i.kind}.`;
}
type StatusEffectList = Parameters<typeof applyStatus>[0]["statuses"];

/**
 * The NPC swings at the player. Starts a fight if there wasn't one. Used for the
 * NPC's first strike (attack_player) and for its attacks every turn of a fight,
 * with an ability if their style picked one. Mutates the player's HP.
 */
export function npcAttack(ctx: ActionContext, opts: AttackOptions = {}): ActionResult {
  const { persona, state, world, rng } = ctx;
  const player = world.player;
  if (!state.inCombat) state.fightRound = 0;
  state.inCombat = true;
  state.pendingOffer = null;
  state.pendingPurchase = null;
  state.pendingTraining = null;
  state.pendingQuest = null;
  const weapon = npcWeapon(state);
  const weak = hasStatus(state, "weakened") ? WEAKENED_PENALTY : 0;
  const ability = opts.ability;
  const hit = attack(
    rng,
    { strength: statsOf(persona, state).attributes.strength, weaponSkill: skillLevel(npcSkills(persona, state), weapon.skill) + (ability?.toHit ?? 0) - weak },
    { agility: player.attributes.agility, evasion: skillLevel(player.skills, "evasion") },
    weapon.die,
    tierDamageBonus(weapon.tier) + (ability?.damage ?? 0) - weak,
  );
  const how = ability ? `${ability.name} (${ability.describe})` : `your ${weapon.name}`;
  if (!hit.success) {
    state.lastCombatNote = `You swung at ${player.name}${ability ? ` with a ${ability.name}` : ""} and missed.`;
    return { ok: true, message: `You swing ${how} at ${player.name} and miss (${describeRoll(hit)}).` };
  }
  // Their armour soaks some of it, a raised guard halves it; the blow wears your weapon and their armour.
  const damage = guardedDamage(player, soak(hit.damage, player));
  player.hp = Math.max(0, player.hp - damage);
  const broke = [wearGear(state, "weapon"), wearGear(player, "armor")].filter((l): l is string => l !== null);
  const status = inflict(ability, player, player.name, rng);
  const injury = player.hp > 0 ? maybeInjure(player, damage / player.maxHp, player.hp / player.maxHp, world.day, rng) : null;
  const after = player.hp === 0 ? `${player.name} collapses.` : `${player.name} has ${player.hp}/${player.maxHp} HP left.`;
  const notes = `${broke.length > 0 ? ` ${broke.join(" ")}` : ""}${status}${injury ? ` ${player.name} is left with ${injury.replace(/_/g, " ")}.` : ""}`;
  state.lastCombatNote = `You hit ${player.name} for ${damage}. ${after}${notes}`;
  return {
    ok: true,
    message: `You hit ${player.name} with ${how} for ${damage} damage (${describeRoll(hit)}). ${after}${notes}`,
  };
}

export type FightMove = "use_item" | "attack_player" | "ability" | "beg" | "stunned";

/**
 * The NPC's automatic turn in a fight, all in code (N8). Statuses tick first
 * (bleeding hurts, a stun loses the turn). Then their combat style (from traits)
 * picks the move: attack (perhaps with an MP ability), an ability (a war cry, a
 * guard, a second wind), a healing item, or, for a coward at half health, begging.
 */
export function npcFightTurn(ctx: ActionContext): ActionResult & { name: FightMove; begged?: boolean } {
  const { persona, state, world, rng } = ctx;
  const max = statsOf(persona, state).maxHp;
  const tick = tickStatuses(state, "You", rng);
  const before = tick.log.length > 0 ? `${tick.log.join(" ")} ` : "";
  state.fightRound = (state.fightRound ?? 0) + 1;
  if (tick.skip) return { name: "stunned", ok: true, message: `${before}You're stunned and can't act this turn.` };
  const style = combatStyle(traitsOf(persona, state));
  const item = healingItems(state.inventory)[0];
  const move = chooseMove(style, npcSkills(persona, state), state.mp, {
    hpShare: state.hp / max,
    round: (state.fightRound ?? 1) - 1,
    canHeal: item !== undefined,
    begged: state.triggerDay["begged"] === world.day,
    foeWeakened: hasStatus(world.player, "weakened"),
    foeTougher: tierIndex(rankForLevel(world.player.level)) > tierIndex(state.life.tier),
  });
  if (move.kind === "beg") {
    state.triggerDay["begged"] = world.day;
    state.inCombat = false;
    state.lastCombatNote = null;
    setMood(state, "afraid");
    clearStatuses(state);
    return { name: "beg", ok: true, begged: true, message: `${before}You can't take any more. You drop your guard and beg for mercy. Say it.` };
  }
  if (move.kind === "heal" && item) {
    const used = useHealingItem(state.inventory, state, max, item);
    if (used.ok) {
      state.lastCombatNote = `You used a ${itemLabel(item)} instead of attacking and healed ${used.healed}.`;
      return { name: "use_item", ok: true, message: `${before}You use a ${itemLabel(item)} and heal ${used.healed} HP (${state.hp}/${max}).` };
    }
  }
  if (move.kind === "ability") {
    const r = useAbility(move.ability, { who: state, name: "You", maxHp: max, willpower: statsOf(persona, state).attributes.willpower }, { foe: world.player, foeName: world.player.name }, rng);
    state.lastCombatNote = r.message;
    return { name: "ability", ok: true, message: `${before}${r.message}` };
  }
  const ability = move.kind === "attack" ? move.ability : undefined;
  if (ability) state.mp -= ability.mp;
  const hit = npcAttack(ctx, ability ? { ability } : {});
  return { name: "attack_player", ...hit, message: `${before}${hit.message}` };
}

/**
 * Use a non-attack ability (war cry, guard, second wind, dirty trick): spend MP and
 * apply it, in code. For NPCs and the player alike.
 */
export function useAbility(
  ability: Ability,
  self: { who: { mp?: number; hp: number; statuses?: StatusEffectList }; name: string; maxHp: number; willpower: number },
  target: { foe: { statuses?: StatusEffectList; hp: number }; foeName: string },
  rng: Rng,
): { ok: boolean; message: string } {
  const mp = self.who.mp ?? 0;
  if (mp < ability.mp) return { ok: false, message: `Not enough MP for ${ability.name} (${ability.mp} needed, ${mp} left).` };
  self.who.mp = mp - ability.mp;
  const you = self.name === "You";
  if (ability.id === "guard") {
    applyStatus(self.who as { hp: number; statuses?: StatusEffectList }, "guarding", 1);
    return { ok: true, message: `${self.name} raise${you ? "" : "s"} a guard.` };
  }
  if (ability.id === "second_wind") {
    const healed = Math.min(self.maxHp - self.who.hp, SECOND_WIND_HP + modifier(self.willpower));
    self.who.hp += Math.max(0, healed);
    return { ok: true, message: `${self.name} catch${you ? "" : "es"} a second wind and heal${you ? "" : "s"} ${Math.max(0, healed)} HP.` };
  }
  const landed = inflict(ability, target.foe, target.foeName, rng);
  return { ok: true, message: `${self.name} use${you ? "" : "s"} ${ability.name} (${ability.describe}).${landed || ` ${target.foeName} shrugs it off.`}` };
}

/**
 * The player tries to run from a fight: their agility + evasion against
 * 10 + the NPC's agility modifier. Escaping ends the conversation; failing
 * gives the NPC a free attack.
 */
export function playerFlee(ctx: ActionContext): ActionResult & { escaped: boolean } {
  const { persona, state, world, rng } = ctx;
  const player = world.player;
  if (!state.inCombat) return { ok: false, escaped: false, message: "You're not in a fight." };
  const result = check(
    rng,
    player.attributes.agility,
    10 + modifier(statsOf(persona, state).attributes.agility),
    skillLevel(player.skills, "evasion"),
  );
  if (result.success) {
    state.inCombat = false;
    state.outcome = "player fled";
    state.conversationOver = true;
    clearStatuses(state);
    clearStatuses(player);
    return { ok: true, escaped: true, message: `${player.name} ran from the fight and got away (${describeRoll(result)}). Shout after them.` };
  }
  const hit = npcAttack(ctx);
  return {
    ok: true,
    escaped: false,
    message: `${player.name} tried to run and you cut them off (${describeRoll(result)}). ${hit.message}`,
  };
}

/**
 * The player attacks the NPC with their equipped weapon, or an ability (/ability),
 * or pulling their blows to knock them out (/subdue). Starts (or continues) a fight.
 * Returns the event the NPC is told about.
 */
export function playerAttack(ctx: ActionContext, opts: AttackOptions = {}): ActionResult & { damage: number; begged?: boolean; subdued?: boolean } {
  const { persona, state, world, rng } = ctx;
  const player = world.player;
  const weapon = equippedWeapon(player);
  // Content rule (design rule 7): a minor can't be attacked unless config allows it.
  if (!canBeAttacked(persona)) return { ok: false, damage: 0, message: `You won't raise a hand against ${persona.name}.` };
  const ability = opts.ability;
  if (ability && (player.mp ?? 0) < ability.mp) return { ok: false, damage: 0, message: `Not enough MP for ${ability.name} (${ability.mp} needed, ${player.mp ?? 0} left).` };

  const started = !state.inCombat;
  if (started) state.fightRound = 0;
  state.inCombat = true;
  state.pendingOffer = null;
  state.pendingPurchase = null;
  state.pendingTraining = null;
  if (state.mood !== "afraid") setMood(state, "angry", traitsOf(persona, state));
  adjustTrust(state, -40);
  if (started) {
    // Being attacked is the worst thing the player can do: a grudge, a lasting memory, fear and resentment.
    const t = traitsOf(persona, state);
    setGrudge(state, t, "they attacked you", world.day);
    adjust(state, "fear", 15);
    adjust(state, "affection", AFFECTION.attack);
    addEmotion(state, "resentment", 0.7, "them attacking you", world.day, true);
    const event = recordEvent(world, { kind: "attacked", actor: "player", target: persona.id, details: weapon.name, importance: 9 });
    remember(state, { id: `attacked-${world.day}`, day: world.day, text: "they attacked you", importance: 9, valence: -1, event: event.id }, t);
    townLearns(player, event);
    standingForDeed(player, { persona }, STANDING.attacked);
    wantRevenge(persona, state, "attacked", "they attacked you", world.day, event.id);
  }

  // The player's own statuses tick first: bleeding hurts, a stun loses the blow.
  const tick = tickStatuses(player, player.name, rng);
  const before = tick.log.length > 0 ? `${tick.log.join(" ")} ` : "";
  if (tick.skip) return { ok: true, damage: 0, message: `${before}${player.name} is stunned and can't strike. You're in a fight.` };
  if (ability) player.mp = (player.mp ?? 0) - ability.mp;

  const weak = hasStatus(player, "weakened") ? WEAKENED_PENALTY : 0;
  const hit = attack(
    rng,
    { strength: player.attributes.strength, weaponSkill: skillLevel(player.skills, weapon.skill) + (ability?.toHit ?? 0) - weak },
    { agility: statsOf(persona, state).attributes.agility, evasion: skillLevel(npcSkills(persona, state), "evasion") },
    weapon.die,
    tierDamageBonus(weapon.tier) + (ability?.damage ?? 0) - weak,
  );
  const roll = describeRoll(hit);
  const how = ability ? ` with a ${ability.name}` : opts.subdue ? ", pulling their blows" : "";
  if (!hit.success) {
    return { ok: true, damage: 0, message: `${before}${player.name} attacked you with their ${weapon.name}${how} and missed (${roll}). You're in a fight.` };
  }

  // Pulled blows do a little less; a guard halves it.
  const damage = guardedDamage(state, Math.max(1, soak(hit.damage, state) - (opts.subdue ? 1 : 0)));
  state.hp = Math.max(0, state.hp - damage);
  if (damage > 0 && player.equipment?.weapon) markBloodied(player, world);
  playerUsesSkill(player, weapon.skill, false, 0.25);
  const broke = [wearGear(player, "weapon"), wearGear(state, "armor")].filter((l): l is string => l !== null);
  const status = inflict(ability, state, "You", rng);
  const max = statsOf(persona, state).maxHp;
  const injury = state.hp > 0 ? maybeInjure(state, damage / max, state.hp / max, world.day, rng) : null;
  const hitMessage =
    `${before}${player.name} attacked you with their ${weapon.name}${how} and hit for ${damage} damage (${roll}). You have ${state.hp}/${max} HP.` +
    (broke.length > 0 ? ` ${broke.join(" ")}` : "") +
    status.replace("You is", "You're") +
    (injury ? ` You're left with ${injury.replace(/_/g, " ")}.` : "");
  state.lastCombatNote = `${player.name} hit you for ${damage}.`;
  if (state.hp === 0) {
    clearStatuses(state);
    clearStatuses(player);
    state.inCombat = false;
    state.conversationOver = true;
    if (opts.subdue) {
      // Knocked out, not killed: they come round later, and remember it.
      state.outcome = "unconscious";
      state.unconsciousUntil = absoluteMinute(world) + UNCONSCIOUS_HOURS * 60;
      const e = recordEvent(world, { kind: "subdued", actor: "player", target: persona.id, details: weapon.name, importance: 8 });
      remember(state, { id: `subdued-${world.day}`, day: world.day, text: "they beat you senseless", importance: 8, valence: -1, event: e.id }, traitsOf(persona, state));
      townLearns(player, e);
      standingForDeed(player, { persona }, STANDING.subdued);
      recordNpcDefeat(player, persona.id);
      return { ok: true, damage, subdued: true, message: `${hitMessage} You're knocked out cold.` };
    }
    state.outcome = "dead";
    state.deathCause = player.name;
    const e = recordEvent(world, { kind: "killed", actor: "player", target: persona.id, details: weapon.name, importance: 10 });
    townLearns(player, e);
    standingForDeed(player, { persona }, STANDING.killed);
    recordNpcDefeat(player, persona.id);
    return { ok: true, damage, message: hitMessage };
  }

  // Badly hurt: a morale check decides whether the NPC keeps fighting. The model
  // almost never chose to flee on its own, so this is a roll, not its choice.
  if (state.hp <= max * fleeAt(traitsOf(persona, state))) {
    const traits = traitsOf(persona, state);
    // Something they fear in sight (a feared weapon, a feared person) makes them likelier to break (npc/triggers.ts).
    const morale = check(rng, statsOf(persona, state).attributes.willpower, moraleTarget(traits) + fearMoralePenalty(persona, world));
    if (!morale.success) {
      // Scared: try to run (agility + evasion vs 10 + the player's agility modifier).
      setMood(state, "afraid");
      const escape = check(rng, statsOf(persona, state).attributes.agility, 10 + modifier(player.attributes.agility), skillLevel(npcSkills(persona, state), "evasion"));
      const nerve = `You lose your nerve (morale ${describeRoll(morale)})`;
      if (escape.success) {
        state.outcome = "fled";
        state.inCombat = false;
        state.conversationOver = true;
        clearStatuses(state);
        recordNpcDefeat(player, persona.id);
        return { ok: true, damage, message: `${hitMessage} ${nerve} and run. Say one last line as you flee.` };
      }
      if (begsWhenCornered(traits)) {
        // Cornered coward: the fight stops and the NPC begs. The player may still strike again.
        state.inCombat = false;
        state.lastCombatNote = null;
        state.triggerDay["begged"] = world.day;
        recordNpcDefeat(player, persona.id);
        return {
          ok: true,
          damage,
          begged: true,
          message: `${hitMessage} ${nerve}, try to run, and ${player.name} cuts you off (${describeRoll(escape)}). You give up the fight and beg for mercy. Say it.`,
        };
      }
      return {
        ok: true,
        damage,
        message: `${hitMessage} ${nerve}, but ${player.name} cuts off your escape (${describeRoll(escape)}). Cornered, you fight on.`,
      };
    }
    return { ok: true, damage, message: `${hitMessage} You're badly hurt but hold your ground (morale ${describeRoll(morale)}).` };
  }
  return { ok: true, damage, message: `${hitMessage} You're in a fight.` };
}

/** The player uses a non-attack ability on the NPC they're fighting (/ability war_cry). */
export function playerAbility(id: AbilityId, ctx: ActionContext): ActionResult {
  const { state, world, rng } = ctx;
  const player = world.player;
  const ability = ABILITIES[id];
  if (!abilitiesFor(player.skills).some((a) => a.id === id)) return { ok: false, message: `You don't know ${ability.name}: it needs ${ability.skills.join(" or ")} at ${ability.minLevel}.` };
  if (ability.kind === "attack") return playerAttack(ctx, { ability });
  if (!state.inCombat) return { ok: false, message: "You're not in a fight." };
  const r = useAbility(ability, { who: player, name: player.name, maxHp: player.maxHp, willpower: player.attributes.willpower }, { foe: state, foeName: "You" }, rng);
  return { ok: r.ok, message: r.ok ? `${r.message.replace("You is", "You're")} ${player.name} used it on you. You're in a fight.` : r.message };
}

/**
 * The player haggles over price: charisma + haggling against
 * 10 + the NPC's intelligence modifier + haggling, +2 for every earlier failed haggle.
 * Winning by more gets a bigger discount: 10% + 2% per point over, capped at 30%
 * (before the NPC's own haggling shrinks it). A pending offer gets cheaper right away.
 */
export function haggle(attempt: string, ctx: ActionContext): ActionResult & { success: boolean } {
  const { persona, state, world, rng } = ctx;
  const player = world.player;
  if (state.inCombat) return { ok: false, success: false, message: "Nobody haggles in the middle of a fight." };
  if (state.failedHaggles >= MAX_FAILED_HAGGLES) {
    return { ok: false, success: false, message: `${persona.name} won't budge on price any more.` };
  }

  const target =
    10 + modifier(statsOf(persona, state).attributes.intelligence) + skillLevel(npcSkills(persona, state), "haggling") + 2 * state.failedHaggles;
  const result = check(rng, player.attributes.charisma, target, skillLevel(player.skills, "haggling"));
  const said = `${player.name} haggled with you: "${attempt}"`;
  const roll = describeRoll(result);

  if (result.success) {
    // Losing a haggle in front of others stings (N5.3).
    if ((world.present ?? []).length > 0) addEmotion(state, "resentment", 0.3, "being haggled down in front of others", world.day, true);
    const pct = grantDiscount(persona, state, Math.min(30, 10 + 2 * Math.max(0, result.total - target)));
    const offer = state.pendingOffer;
    const purchase = state.pendingPurchase;
    const offerNote =
      (offer ? ` Your offer is now ${offer.item} for ${formatMoney(offer.price)}.` : "") +
      (purchase ? ` You now offer ${formatMoney(purchase.price)} for their ${purchase.item}.` : "");
    return {
      ok: true,
      success: true,
      message: `${said}. They got the better of you (${roll}): ${pct}% better deals for them (cheaper to buy, more when they sell).${offerNote}`,
    };
  }

  state.failedHaggles += 1;
  const left = MAX_FAILED_HAGGLES - state.failedHaggles;
  if (left === 0) setMood(state, "annoyed");
  const note = left === 0 ? " You're done haggling with them; the price is final." : "";
  return { ok: true, success: false, message: `${said}. You held your price (${roll}).${note}` };
}
