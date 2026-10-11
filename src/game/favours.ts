import { fearOf, respectOf } from "../npc/relationship.js";
import { npcHasRoom } from "../npc/state.js";
import { traitsOf } from "../npc/traits.js";
import type { NpcPersona, NpcState, PlayerState, QuestDef, WorldSnapshot } from "../npc/types.js";
import { absoluteMinute, formatMinute } from "./clock.js";
import { promise } from "./commitments.js";
import { craftingNeeds } from "./crafting.js";
import { recordEvent } from "./events.js";
import { itemLabel, parseItem, resolveItem } from "./items.js";
import { note } from "./journal.js";
import { formatMoney } from "./money.js";

/**
 * Favours (N5.1): things the player can ask for outside the shop and quests. Code
 * decides from trust, fear, respect and traits whether the NPC agrees, and sets the
 * terms; the NPC offers them and the player accepts (offer, then confirm). Every
 * favour leaves the player owing one back, which the NPC calls in later
 * (npc/initiative.ts) as a small job (callInFavour).
 */
export const FAVOUR_KINDS = ["lend_gold", "vouch", "hide_item", "warn_me"] as const;
export type FavourKind = (typeof FAVOUR_KINDS)[number];

export interface OwedFavour {
  kind: FavourKind;
  day: number;
  /** The quest they asked in return, once they've called it in. */
  quest?: string;
}

/** Days a loan runs before it's due. */
export const LOAN_DAYS = 3;
/** Days before an NPC calls in a favour. */
export const CALL_IN_AFTER_DAYS = 1;

/** Does the player's line sound like asking a favour? Gates offer_favour. */
export function isFavourTalk(line: string): boolean {
  return /\b(favou?r|lend|loan|borrow|hide|stash|keep (this|it) safe|vouch|put in a (good )?word|warn me|tip me off|look out for me)\b/i.test(line);
}

/** Trust needed for a loan: 60 for the stingiest NPC, 20 for the most generous. */
export function loanTrust(persona: Pick<NpcPersona, "traits">): number {
  return Math.round(60 - 40 * traitsOf(persona).generosity);
}

/** How much they'd lend: from their spare money (above their reserve), more if generous. 0 if nothing. */
export function loanAmount(persona: NpcPersona, state: NpcState): number {
  const spare = state.money - (persona.reserveMoney ?? 200);
  const wanted = Math.round(300 + 700 * traitsOf(persona).generosity);
  const amount = Math.min(spare, wanted);
  return amount >= 50 ? Math.floor(amount / 10) * 10 : 0;
}

export interface FavourQuote {
  ok: boolean;
  /** The terms, or why not, in words. */
  message: string;
  amount?: number;
  item?: string;
  due?: number;
}

/** Would the NPC do this favour now, and on what terms? Changes nothing. */
export function quoteFavour(persona: NpcPersona, state: NpcState, world: WorldSnapshot, kind: FavourKind, item?: string): FavourQuote {
  const player = world.player;
  const trust = state.relationship;
  const fear = fearOf(state, player);
  const respect = respectOf(state, player);
  const no = (message: string): FavourQuote => ({ ok: false, message });
  if (state.inCombat || state.outcome) return no("Not now.");
  if (state.owedFavours.length > 0) return no(`${player.name} still owes you a favour. Not until that's squared.`);
  switch (kind) {
    case "lend_gold": {
      if (trust < loanTrust(persona) && fear < 60) return no("You don't trust them with your money.");
      if ((player.commitments ?? []).some((c) => c.status === "open" && c.kind === "repay_loan" && c.toWhom === persona.id)) return no("They haven't paid back the last loan.");
      const amount = loanAmount(persona, state);
      if (amount === 0) return no("You've no money to spare.");
      const due = absoluteMinute(world) + LOAN_DAYS * 1440;
      return { ok: true, amount, due, message: `lend them ${formatMoney(amount)}, to be paid back by ${formatMinute(due, world.day)}` };
    }
    case "vouch":
      if (trust < 30 || respect < 10) return no("You don't know them well enough to put your name to them.");
      if ((player.vouchedBy ?? []).includes(persona.name)) return no("You've already vouched for them.");
      return { ok: true, message: "put in a good word for them around the village" };
    case "hide_item": {
      if (trust < 50) return no("You don't trust them enough to hide things for them.");
      const key = item ? resolveItem(player.inventory, item) : undefined;
      if (!key) return no(item ? `They aren't carrying any ${item}.` : "They need to say what to hide.");
      if (!npcHasRoom(persona, state, { [key]: 1 })) return no("You've no room to hide anything.");
      return { ok: true, item: key, message: `keep their ${itemLabel(key)} hidden and safe until they come for it` };
    }
    case "warn_me":
      if (trust < 20 && fear < 40) return no("Why would you look out for a stranger?");
      if ((player.warnedBy ?? []).includes(persona.name)) return no("You've already said you'll warn them.");
      return { ok: true, message: "warn them if you hear of danger, like bandits on the move" };
  }
}

/** The NPC offers a favour (the player then accepts or declines). */
export function offerFavour(persona: NpcPersona, state: NpcState, world: WorldSnapshot, kind: FavourKind, item?: string): FavourQuote {
  const quote = quoteFavour(persona, state, world, kind, item);
  if (quote.ok) state.pendingFavour = { kind, ...(quote.amount ? { amount: quote.amount } : {}), ...(quote.item ? { item: quote.item } : {}), ...(quote.due ? { due: quote.due } : {}) };
  return quote;
}

/** The player accepted the favour: do it, and the player owes one back. Returns a line for the player and the NPC. */
export function grantFavour(persona: NpcPersona, state: NpcState, world: WorldSnapshot): { ok: boolean; message: string } {
  const offer = state.pendingFavour;
  state.pendingFavour = null;
  if (!offer) return { ok: false, message: "There's no favour on offer." };
  const recheck = quoteFavour(persona, state, world, offer.kind, offer.item);
  if (!recheck.ok) return { ok: false, message: recheck.message };
  const player = world.player;
  let message: string;
  switch (offer.kind) {
    case "lend_gold": {
      const amount = offer.amount!;
      state.money -= amount;
      player.money += amount;
      const c = promise((player.commitments ??= []), { kind: "repay_loan", what: `to repay ${formatMoney(amount)}`, amount, due: offer.due!, owner: "player", toWhom: persona.id });
      note(player, { id: `promise:${c.id}`, day: world.day, npc: persona.id, kind: "promise", text: `You promised ${persona.name} to repay ${formatMoney(amount)} by ${formatMinute(c.due, world.day)}.` });
      message = `You lent ${player.name} ${formatMoney(amount)}. They've promised it back by ${formatMinute(c.due, world.day)}.`;
      break;
    }
    case "vouch":
      (player.vouchedBy ??= []).push(persona.name);
      message = `You'll vouch for ${player.name} around the village.`;
      break;
    case "hide_item": {
      const key = offer.item!;
      player.inventory[key] = (player.inventory[key] ?? 0) - 1;
      if (player.inventory[key] === 0) delete player.inventory[key];
      state.keptForPlayer[key] = (state.keptForPlayer[key] ?? 0) + 1;
      message = `You took ${player.name}'s ${itemLabel(key)} and hid it away for them.`;
      break;
    }
    case "warn_me":
      (player.warnedBy ??= []).push(persona.name);
      message = `You'll warn ${player.name} if you hear of danger.`;
      break;
  }
  state.owedFavours.push({ kind: offer.kind, day: world.day });
  recordEvent(world, { kind: "favour", actor: persona.id, target: "player", details: offer.kind, importance: 5 });
  note(player, { id: `favour:${persona.id}:${offer.kind}:${world.day}`, day: world.day, npc: persona.id, kind: "favour", text: `${persona.name} did you a favour (${offer.kind.replace("_", " ")}). You owe them one.` });
  return { ok: true, message };
}

/** The player gets back what the NPC hid for them. */
export function retrieveHidden(persona: NpcPersona, state: NpcState, player: PlayerState): { ok: boolean; message: string } {
  const items = Object.entries(state.keptForPlayer).filter(([, q]) => q > 0);
  if (items.length === 0) return { ok: false, message: `${persona.name} isn't keeping anything for you.` };
  for (const [key, qty] of items) player.inventory[key] = (player.inventory[key] ?? 0) + qty;
  state.keptForPlayer = {};
  return { ok: true, message: `${persona.name} hands back ${items.map(([k, q]) => `${itemLabel(k)} x${q}`).join(", ")}.` };
}

/** The open loan the player owes this NPC, if any. */
export function loanDue(player: PlayerState, npcId: string) {
  return (player.commitments ?? []).find((c) => c.status === "open" && c.kind === "repay_loan" && c.toWhom === npcId);
}

/** What the NPC asks in return: something they love, else what their work needs, else bread. */
function askInReturn(persona: NpcPersona, state: NpcState): { item: string; qty: number } {
  const loved = (persona.loves ?? []).find((l) => l.item && parseItem(l.item) && !l.minTier);
  if (loved) return { item: loved.item!, qty: 1 };
  const need = Object.entries(craftingNeeds(persona, state))[0];
  if (need) return { item: need[0], qty: Math.min(2, need[1]) };
  return { item: "bread loaf", qty: 2 };
}

/**
 * Time to call in a favour: the oldest one owed for at least CALL_IN_AFTER_DAYS that
 * hasn't been asked for yet becomes a small job on their quest board. Returns the job, or null.
 */
export function callInFavour(persona: NpcPersona, state: NpcState, day: number): QuestDef | null {
  const owed = state.owedFavours.find((f) => !f.quest && day - f.day >= CALL_IN_AFTER_DAYS);
  if (!owed) return null;
  const ask = askInReturn(persona, state);
  const quest: QuestDef = {
    id: `favour_${persona.id}_${owed.kind}_${owed.day}`,
    title: "A favour returned",
    description: `You did them a favour (${owed.kind.replace("_", " ")}) and now you want one back: ${ask.qty} ${ask.item}.`,
    tier: "G",
    minTrust: -100,
    objective: { type: "deliver", item: ask.item, qty: ask.qty },
    reward: { money: 0, xp: 10, trust: 5 },
    favour: true,
  };
  owed.quest = quest.id;
  state.questBoard.push(quest);
  return quest;
}

/** A favour job was handed in: the debt is squared. */
export function favourRepaid(state: NpcState, questId: string): void {
  state.owedFavours = state.owedFavours.filter((f) => f.quest !== questId);
}

/** The situation line about favours between them, or null. */
export function describeFavours(state: NpcState, player: PlayerState): string | null {
  const owed = state.owedFavours[0];
  if (!owed) return null;
  if (owed.quest && !player.quests.active.some((q) => q.id === owed.quest)) {
    return `${player.name} owes you a favour; you've asked them for something in return ("A favour returned").`;
  }
  return `${player.name} owes you a favour (you did them a ${owed.kind.replace("_", " ")}).`;
}
