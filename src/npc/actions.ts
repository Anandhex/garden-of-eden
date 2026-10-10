import { z } from "zod";
import { attack, check, modifier, type Rng } from "../game/dice.js";
import { debtStatus, payDebts } from "../game/debts.js";
import { effectiveGreed } from "../game/debts.js";
import {
  bestWeapon,
  FISTS,
  itemLabel,
  itemValue,
  parseItem,
  resolveItem,
  tierDamageBonus,
  tierMultiplier,
  weaponFor,
} from "../game/items.js";
import { questOfferError, questsFor } from "../game/quests.js";
import { quoteTraining, teachableSkills, trustCap } from "../game/training.js";
import { SKILLS, skillLevel } from "./skills.js";
import type { ToolDef } from "../llm/provider.js";
import { MOODS, type Mood, type NpcPersona, type NpcState, type WorldSnapshot } from "./types.js";

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
}

/** Does the player sound like they're begging, apologising or giving up? */
export function isPleading(line: string): boolean {
  return /\b(sorry|stop|mercy|surrender|yield|give up|i give|enough|truce|peace|please don'?t|spare me|i'?m done)\b/i.test(line);
}

/** Crude but effective: does the player's line sound like buying or selling? */
export function isTradeTalk(line: string): boolean {
  return /\b(sell|selling|buy|buying|trade|worth|price|cost|costs|pay|afford|cheap|expensive|deal|offer|gold|coins?)\b/i.test(line);
}

export interface ActionResult {
  ok: boolean;
  message: string;
}

/** Trust needed before reveal_secret is offered (and accepted). */
export const SECRET_TRUST = 50;
/** Mean comments in a row (while still annoyed or angry) before the NPC may attack. */
export const PROVOKE_LIMIT = 3;
/** At or below this share of max HP, a fighting NPC may flee, and must pass a morale check when hit. */
export const FLEE_AT = 0.4;
/** Willpower check a badly hurt NPC must pass when hit, or it runs. */
export const MORALE_TARGET = 15;

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
export const offerItemArgs = z.object({ item: z.string(), price: z.number().int() });
export const revealSecretArgs = z.object({ secret: z.string() });
export const offerToBuyArgs = z.object({ item: z.string(), price: z.number().int() });
export const offerTrainingArgs = z.object({ skill: z.enum(SKILLS), hours: z.number().int() });
export const offerQuestArgs = z.object({ quest: z.string() });
export const noArgs = z.object({});

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

function adjustTrust(state: NpcState, delta: number) {
  state.relationship = clamp(state.relationship + delta, -100, 100);
}

/**
 * The one place mood changes: updates trust and the provocation count.
 * Annoyed/angry in a row counts up; anything calmer resets it.
 */
export function setMood(state: NpcState, mood: Mood) {
  state.mood = mood;
  adjustTrust(state, TRUST_FROM_MOOD[mood]);
  state.provocations = HOSTILE.includes(mood) ? state.provocations + 1 : 0;
}

/** The NPC's list price for one copy, scaled by tier: an iron sword [B] costs 2.25x an iron sword [D]. */
export function npcPrice(persona: NpcPersona, item: string): number | undefined {
  const parsed = parseItem(item);
  const base = parsed ? persona.prices[parsed.name] : undefined;
  if (!parsed || base === undefined) return undefined;
  return Math.max(1, Math.round(base * tierMultiplier(parsed.tier, parsed.def.tier)));
}

/** Lowest price the NPC accepts for an item, after any discount. */
export function minPrice(persona: NpcPersona, state: NpcState, item: string): number | undefined {
  const list = npcPrice(persona, item);
  return list === undefined ? undefined : Math.ceil(list * (1 - state.discountPct / 100));
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
  const kept = 1 - HAGGLE_DAMPING_PER_TIER * skillLevel(persona.skills, "haggling");
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
    if (most !== undefined) purchase.price = Math.max(purchase.price, Math.min(most, state.gold));
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
export function maxBuyPrice(persona: NpcPersona, state: NpcState, item: string): number | undefined {
  const parsed = parseItem(item);
  const value = itemValue(item);
  if (!parsed || value === undefined || !persona.buys.includes(parsed.name)) return undefined;
  const trustShare = Math.max(0, Math.min(100, state.relationship)) / 100;
  const greedCut = 1 - GREED_BUY_CUT * effectiveGreed(persona, state) * (1 - trustShare);
  return Math.max(1, Math.floor(value * BUY_SHARE * greedCut * (1 + state.discountPct / 100)));
}

/** The NPC's weapon from the item list (fists if it isn't a known weapon). */
export function npcWeapon(persona: NpcPersona) {
  return weaponFor(persona.weapon) ?? FISTS;
}

/** True when the NPC has been pushed far enough to start a fight. */
export function isProvoked(state: NpcState): boolean {
  return state.provocations >= PROVOKE_LIMIT && HOSTILE.includes(state.mood);
}

/** Items the NPC has in stock and has a price for. */
/**
 * Items the NPC has in stock and has a price for, cheapest first. The order matters:
 * with an iron sword [D] (40) and [B] (90) in stock, the model tended to quote the
 * dearer one; listing the cheap copy first makes it answer from that.
 */
export function itemsForSale({ persona, state }: Pick<ActionContext, "persona" | "state">): string[] {
  return Object.keys(state.inventory)
    .filter((item) => (state.inventory[item] ?? 0) > 0 && npcPrice(persona, item) !== undefined)
    .sort((a, b) => npcPrice(persona, a)! - npcPrice(persona, b)!);
}

function unrevealedSecrets({ persona, state }: ActionContext) {
  return persona.secrets.filter((s) => !state.revealedSecrets.includes(s.id));
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
    if (state.hp <= persona.stats.maxHp * FLEE_AT) {
      tools.push({
        name: "flee",
        description: "Run away from the fight. You are badly hurt; call this if you'd rather survive than keep fighting.",
        parameters: z.toJSONSchema(noArgs),
      });
    }
    return tools;
  }

  const forSale = itemsForSale(ctx);
  if (forSale.length > 0) {
    const priceList = forSale.map((item) => `${itemLabel(item)} (${minPrice(persona, state, item)} gold)`).join(", ");
    tools.push({
      name: "offer_item",
      description:
        "Offer one item to the player at a price. The player then accepts or declines; you don't take the gold yourself. " +
        "Call this when the player wants to buy something or asks for an item. Don't call it for price questions; just answer. " +
        `In stock: ${priceList}. Never offer below these prices.`,
      parameters: z.toJSONSchema(
        z.object({ item: z.enum(forSale as [string, ...string[]]), price: z.number().int() }),
      ),
    });
  }

  // Things the player carries that this NPC would buy.
  const buyable = Object.keys(ctx.world.player.inventory).filter(
    (item) => (ctx.world.player.inventory[item] ?? 0) > 0 && maxBuyPrice(persona, state, item) !== undefined,
  );
  if (ctx.tradeTalk && buyable.length > 0) {
    const payList = buyable.map((item) => `${itemLabel(item)} (up to ${maxBuyPrice(persona, state, item)} gold)`).join(", ");
    tools.push({
      name: "offer_to_buy",
      description:
        "Offer to buy one item from the player for a price. The player then accepts or declines. " +
        "Call this when the player wants to sell you something. " +
        `You'd buy: ${payList}. Never offer more than that; you have ${state.gold} gold.`,
      parameters: z.toJSONSchema(
        z.object({ item: z.enum(buyable as [string, ...string[]]), price: z.number().int() }),
      ),
    });
  }

  // Skills the NPC would teach right now (within the trust limit).
  const canTeach = teachableSkills(persona, ctx.world)
    .map((t) => t.skill)
    .filter((skill) => skillLevel(ctx.world.player.skills, skill) < trustCap(state.relationship));
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

  const secrets = unrevealedSecrets(ctx);
  if (state.relationship > SECRET_TRUST && secrets.length > 0) {
    const topics = secrets.map((s) => `"${s.id}": ${s.about}`).join("; ");
    tools.push({
      name: "reveal_secret",
      // Firm wording, as with change_mood: a softer version was never called; the model
      // made up its own secret instead.
      description:
        "ALWAYS call this before talking about any of your secrets. You do NOT know the details until you call it, so never make them up. " +
        `You trust this person enough to share. Secrets: ${topics}.`,
      parameters: z.toJSONSchema(z.object({ secret: z.enum(secrets.map((s) => s.id) as [string, ...string[]]) })),
    });
  }

  if (isProvoked(state)) {
    tools.push({
      name: "attack_player",
      description:
        `You've had enough of this person's insults. Call this to strike them with your ${npcWeapon(persona).name} and start a fight. ` +
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
  | { ok: true; name: "attack_player"; args: z.infer<typeof noArgs> }
  | { ok: true; name: "flee"; args: z.infer<typeof noArgs> }
  | { ok: true; name: "end_fight"; args: z.infer<typeof noArgs> }
  | { ok: false; error: string };

const schemas = {
  change_mood: changeMoodArgs,
  offer_item: offerItemArgs,
  reveal_secret: revealSecretArgs,
  offer_to_buy: offerToBuyArgs,
  offer_training: offerTrainingArgs,
  offer_job: offerQuestArgs,
  attack_player: noArgs,
  flee: noArgs,
  end_fight: noArgs,
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
 * Returns a short message for the model, e.g. "You offered dagger for 15 gold."
 * or "Traveler only has 10 gold." (ok: false).
 */
export function applyAction(action: Extract<ParsedAction, { ok: true }>, ctx: ActionContext): ActionResult {
  const { persona, state, world } = ctx;
  switch (action.name) {
    case "change_mood":
      setMood(state, action.args.mood);
      return { ok: true, message: "Mood updated. Now reply in character; let the feeling show in your words, never name it." };

    case "offer_item": {
      if (state.inCombat) return { ok: false, message: "You can't trade in the middle of a fight." };
      const { price } = action.args;
      const item = resolveItem(state.inventory, action.args.item) ?? action.args.item;
      const player = world.player;
      const lowest = minPrice(persona, state, item);

      if (!state.inventory[item]) return { ok: false, message: `You don't have any ${itemLabel(item)}.` };
      if (lowest === undefined) return { ok: false, message: `You don't sell ${itemLabel(item)}.` };
      if (price < lowest) return { ok: false, message: `${price} gold is below your price for ${item} (${lowest} gold).` };
      if (player.gold < price)
        return { ok: false, message: `${player.name} only has ${player.gold} gold; ${item} costs ${price}.` };

      state.pendingOffer = { item, price };
      return {
        ok: true,
        message: `You offered ${itemLabel(item)} for ${price} gold. Tell them exactly that now; they'll accept or decline. Don't hand it over yet.`,
      };
    }

    case "offer_to_buy": {
      if (state.inCombat) return { ok: false, message: "You can't trade in the middle of a fight." };
      const { price } = action.args;
      const player = world.player;
      const item = resolveItem(player.inventory, action.args.item) ?? action.args.item;
      const most = maxBuyPrice(persona, state, item);

      if (most === undefined) return { ok: false, message: `You don't buy ${item}.` };
      if (!player.inventory[item]) return { ok: false, message: `${player.name} doesn't have any ${item}.` };
      if (price < 1) return { ok: false, message: "Offer at least 1 gold." };
      if (price > most) return { ok: false, message: `${price} gold is more than ${item} is worth to you (${most} at most).` };
      if (price > state.gold) return { ok: false, message: `You only have ${state.gold} gold.` };

      state.pendingPurchase = { item, price };
      return {
        ok: true,
        message: `You offered ${price} gold for ${player.name}'s ${itemLabel(item)}. Tell them exactly that now; they'll accept or decline. Don't pay yet.`,
      };
    }

    case "offer_training": {
      const quote = quoteTraining(persona, state, world, action.args.skill, action.args.hours);
      if (!quote.ok) return { ok: false, message: quote.message };
      state.pendingTraining = { skill: action.args.skill, hours: quote.hours, cost: quote.cost };
      const asked = Math.max(1, Math.floor(action.args.hours));
      const why = quote.endLevel >= quote.cap ? "that's as far as you'll teach them" : "that's all they can afford";
      // Terms first and in plain words: the model tended to repeat the hours the player asked for.
      const terms = `${quote.hours} hour${quote.hours === 1 ? "" : "s"} of ${action.args.skill.replace("_", "-")} for ${quote.cost} gold`;
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
          `Say exactly this offer: "${quest.title}" [${quest.tier}]: bring ${quest.objective.qty} ${quest.objective.item}, ` +
          `for ${quest.reward.gold} gold. They'll accept or decline.`,
      };
    }

    case "reveal_secret": {
      const secret = persona.secrets.find((s) => s.id === action.args.secret);
      if (!secret) return { ok: false, message: `You have no secret called "${action.args.secret}".` };
      // Checked again here: the tool is only offered at high trust, but never trust that alone.
      if (state.relationship <= SECRET_TRUST) return { ok: false, message: "You don't trust them enough to share that." };
      if (!state.revealedSecrets.includes(secret.id)) state.revealedSecrets.push(secret.id);
      const status = secret.debt ? ` ${debtStatus(persona, state, secret.debt)}` : "";
      return { ok: true, message: `Tell them this in your own words: ${secret.text}${status}` };
    }

    case "attack_player": {
      if (!state.inCombat && !isProvoked(state)) return { ok: false, message: "You haven't been provoked enough to attack." };
      return npcAttack(ctx);
    }

    case "end_fight": {
      if (!state.inCombat) return { ok: false, message: "There's no fight to end." };
      state.inCombat = false;
      state.lastCombatNote = null;
      return { ok: true, message: "The fight is over; you've let it go. Tell them so, in your own words." };
    }

    case "flee": {
      if (!state.inCombat) return { ok: false, message: "There's no fight to run from." };
      if (state.hp > persona.stats.maxHp * FLEE_AT) return { ok: false, message: "You're not hurt enough to run." };
      state.outcome = "fled";
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

  const { item, price } = offer;
  const player = world.player;
  if (!state.inventory[item]) return { ok: false, message: `The ${item} is no longer in stock.` };
  if (player.gold < price) return { ok: false, message: `${player.name} can't afford ${item} for ${price} gold.` };

  player.gold -= price;
  state.gold += price;
  state.inventory[item] -= 1;
  if (state.inventory[item] === 0) delete state.inventory[item];
  player.inventory[item] = (player.inventory[item] ?? 0) + 1;
  adjustTrust(state, TRUST_FROM_PURCHASE);
  state.discountPct = 0; // a discount is good for one sale
  state.failedHaggles = 0;
  payDebts(persona, state); // quietly, never told to the model
  return { ok: true, message: `${player.name} accepted and paid ${price} gold for the ${item}.` };
}

/** Called by the game when the player turns the offer down. */
export function declineOffer({ state, world }: ActionContext): ActionResult {
  const offer = state.pendingOffer;
  if (!offer) return { ok: false, message: "There is no offer to decline." };
  state.pendingOffer = null;
  return { ok: true, message: `${world.player.name} declined your offer of ${offer.item} for ${offer.price} gold.` };
}

/**
 * Complete the NPC's offer to buy from the player. Called by the game when the
 * player accepts. Rechecks everything, since state may have changed.
 */
export function acceptPurchase({ state, world }: ActionContext): ActionResult {
  const offer = state.pendingPurchase;
  if (!offer) return { ok: false, message: "There is no offer to accept." };
  state.pendingPurchase = null;

  const { item, price } = offer;
  const player = world.player;
  if (!player.inventory[item]) return { ok: false, message: `${player.name} no longer has the ${item}.` };
  if (state.gold < price) return { ok: false, message: `You can't afford to pay ${price} gold any more.` };

  state.gold -= price;
  player.gold += price;
  player.inventory[item] -= 1;
  if (player.inventory[item] === 0) delete player.inventory[item];
  state.inventory[item] = (state.inventory[item] ?? 0) + 1;
  adjustTrust(state, TRUST_FROM_SELLING);
  state.discountPct = 0; // a won haggle is good for one deal
  state.failedHaggles = 0;
  return { ok: true, message: `${player.name} sold you the ${item} for ${price} gold.` };
}

/** Called by the game when the player turns down the NPC's offer to buy. */
export function declinePurchase({ state, world }: ActionContext): ActionResult {
  const offer = state.pendingPurchase;
  if (!offer) return { ok: false, message: "There is no offer to decline." };
  state.pendingPurchase = null;
  return { ok: true, message: `${world.player.name} turned down your offer of ${offer.price} gold for their ${offer.item}.` };
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

  // Persuade: charisma + speechcraft. Intimidate: strength + intimidation.
  // The NPC resists with willpower + the same skill.
  const skill = kind === "persuade" ? "speechcraft" : "intimidation";
  const stat = kind === "persuade" ? player.attributes.charisma : player.attributes.strength;
  const target = 10 + modifier(persona.stats.attributes.willpower) + skillLevel(persona.skills, skill);
  const result = check(rng, stat, target, skillLevel(player.skills, skill));
  const said = `${player.name} tried to ${kind} you: "${attempt}"`;
  const roll = describeRoll(result);

  if (kind === "persuade") {
    if (result.success) {
      adjustTrust(state, 15);
      const pct = grantDiscount(persona, state, 20);
      if (state.mood !== "happy") setMood(state, "neutral");
      return {
        ok: true,
        success: true,
        message: `${said}. It worked (${roll}): they've won you over. You're inclined to agree to what they asked, and you'd give them up to ${pct}% off.`,
      };
    }
    setMood(state, "annoyed");
    return { ok: true, success: false, message: `${said}. It didn't work (${roll}): you're not convinced, and a little annoyed. Turn them down.` };
  }

  if (result.success) {
    setMood(state, "afraid");
    adjustTrust(state, -10);
    const pct = grantDiscount(persona, state, 30);
    return { ok: true, success: true, message: `${said}. It worked (${roll}): you're afraid of them. You'd give in on price, up to ${pct}% off.` };
  }
  setMood(state, "angry");
  return { ok: true, success: false, message: `${said}. It didn't work (${roll}): you're not scared, you're angry.` };
}

/**
 * The NPC swings at the player. Starts a fight if there wasn't one. Used for the
 * NPC's first strike (attack_player) and for its automatic attack every turn of
 * a fight. Mutates the player's HP.
 */
export function npcAttack(ctx: ActionContext): ActionResult {
  const { persona, state, world, rng } = ctx;
  const player = world.player;
  state.inCombat = true;
  state.pendingOffer = null;
  state.pendingPurchase = null;
  state.pendingTraining = null;
  state.pendingQuest = null;
  const weapon = npcWeapon(persona);
  const hit = attack(
    rng,
    { strength: persona.stats.attributes.strength, weaponSkill: skillLevel(persona.skills, weapon.skill) },
    { agility: player.attributes.agility, evasion: skillLevel(player.skills, "evasion") },
    weapon.die,
    tierDamageBonus(weapon.tier),
  );
  if (!hit.success) {
    state.lastCombatNote = `You swung at ${player.name} and missed.`;
    return { ok: true, message: `You swing your ${weapon.name} at ${player.name} and miss (${describeRoll(hit)}).` };
  }
  player.hp = Math.max(0, player.hp - hit.damage);
  const after = player.hp === 0 ? `${player.name} collapses.` : `${player.name} has ${player.hp}/${player.maxHp} HP left.`;
  state.lastCombatNote = `You hit ${player.name} for ${hit.damage}. ${after}`;
  return {
    ok: true,
    message: `You hit ${player.name} with your ${weapon.name} for ${hit.damage} damage (${describeRoll(hit)}). ${after}`,
  };
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
    10 + modifier(persona.stats.attributes.agility),
    skillLevel(player.skills, "evasion"),
  );
  if (result.success) {
    state.inCombat = false;
    state.outcome = "player fled";
    state.conversationOver = true;
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
 * The player attacks the NPC with their best weapon. Starts (or continues) a fight.
 * Returns the event the NPC is told about.
 */
export function playerAttack(ctx: ActionContext): ActionResult & { damage: number } {
  const { persona, state, world, rng } = ctx;
  const player = world.player;
  const weapon = bestWeapon(player.inventory);

  state.inCombat = true;
  state.pendingOffer = null;
  state.pendingPurchase = null;
  state.pendingTraining = null;
  if (state.mood !== "afraid") setMood(state, "angry");
  adjustTrust(state, -40);

  const hit = attack(
    rng,
    { strength: player.attributes.strength, weaponSkill: skillLevel(player.skills, weapon.skill) },
    { agility: persona.stats.attributes.agility, evasion: skillLevel(persona.skills, "evasion") },
    weapon.die,
    tierDamageBonus(weapon.tier),
  );
  const roll = describeRoll(hit);
  if (!hit.success) {
    return { ok: true, damage: 0, message: `${player.name} attacked you with their ${weapon.name} and missed (${roll}). You're in a fight.` };
  }

  state.hp = Math.max(0, state.hp - hit.damage);
  const hitMessage = `${player.name} attacked you with their ${weapon.name} and hit for ${hit.damage} damage (${roll}). You have ${state.hp}/${persona.stats.maxHp} HP.`;
  state.lastCombatNote = `${player.name} hit you for ${hit.damage}.`;
  if (state.hp === 0) {
    state.outcome = "dead";
    state.conversationOver = true;
    return { ok: true, damage: hit.damage, message: hitMessage };
  }

  // Badly hurt: a morale check decides whether the NPC keeps fighting. The model
  // almost never chose to flee on its own, so this is a roll, not its choice.
  if (state.hp <= persona.stats.maxHp * FLEE_AT) {
    const morale = check(rng, persona.stats.attributes.willpower, MORALE_TARGET);
    if (!morale.success) {
      setMood(state, "afraid");
      state.outcome = "fled";
      state.conversationOver = true;
      return {
        ok: true,
        damage: hit.damage,
        message: `${hitMessage} You lose your nerve (morale ${describeRoll(morale)}) and run. Say one last line as you flee.`,
      };
    }
    return { ok: true, damage: hit.damage, message: `${hitMessage} You're badly hurt but hold your ground (morale ${describeRoll(morale)}).` };
  }
  return { ok: true, damage: hit.damage, message: `${hitMessage} You're in a fight.` };
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
    10 + modifier(persona.stats.attributes.intelligence) + skillLevel(persona.skills, "haggling") + 2 * state.failedHaggles;
  const result = check(rng, player.attributes.charisma, target, skillLevel(player.skills, "haggling"));
  const said = `${player.name} haggled with you: "${attempt}"`;
  const roll = describeRoll(result);

  if (result.success) {
    const pct = grantDiscount(persona, state, Math.min(30, 10 + 2 * Math.max(0, result.total - target)));
    const offer = state.pendingOffer;
    const purchase = state.pendingPurchase;
    const offerNote =
      (offer ? ` Your offer is now ${offer.item} for ${offer.price} gold.` : "") +
      (purchase ? ` You now offer ${purchase.price} gold for their ${purchase.item}.` : "");
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
