import { holdsGrudge } from "../npc/relationship.js";
import type { NpcPersona, NpcState, WorldSnapshot } from "../npc/types.js";
import { recordEvent } from "./events.js";
import { isTooHurtToWork } from "./healing.js";
import { formatMoney } from "./money.js";

/**
 * Services (N6.2): some NPCs sell what they do, not just goods. Prices are in the
 * NPC file; the effect is code. They use the offer flow: the model calls
 * offer_service (on service talk only), the player accepts, and only then is the
 * player charged, once. Repairs and training have their own flows and prices.
 */
export const SERVICE_KINDS = ["heal", "lodging", "repair", "training"] as const;
export type ServiceKind = (typeof SERVICE_KINDS)[number];
/** Services sold through offer_service (the others have their own commands). */
export const OFFERED_SERVICES: readonly ServiceKind[] = ["heal", "lodging"];

/** HP a paid healing restores. */
export const HEAL_SERVICE_HP = 30;
/** The hour a lodger wakes. */
export const WAKE_HOUR = 6;

/** Does the player's line sound like asking for a service? Gates offer_service. */
export function isServiceTalk(line: string): boolean {
  return /\b(room|bed|stay the night|lodging|lodge|sleep here|rest here|a night|heal|healing|patch me up|tend|bandage|wounds?|hurt|injur(ed|y))\b/i.test(line);
}

/** Hours of sleep in a rented room: until WAKE_HOUR, at least 1. */
export function lodgingHours(hour: number): number {
  const h = (WAKE_HOUR - hour + 24) % 24;
  return h === 0 ? 24 : h;
}

export interface ServiceQuote {
  ok: boolean;
  message: string;
  price: number;
}

/** Would the NPC do this service now, and for how much? Changes nothing. */
export function quoteService(persona: NpcPersona, state: NpcState, world: WorldSnapshot, kind: ServiceKind): ServiceQuote {
  const fail = (message: string): ServiceQuote => ({ ok: false, message, price: 0 });
  const def = (persona.services ?? []).find((s) => s.kind === kind);
  if (!def || def.price === undefined || !OFFERED_SERVICES.includes(kind)) return fail(`${persona.name} doesn't offer that.`);
  if (state.inCombat || state.outcome) return fail(`${persona.name} is in no state for that.`);
  if (isTooHurtToWork(persona, state)) return fail(`${persona.name} is too badly hurt to help anyone.`);
  if (holdsGrudge(state, world.day)) return fail(`${persona.name} won't do anything for you while they hold a grudge.`);
  const player = world.player;
  if (kind === "heal" && player.hp >= player.maxHp) return fail("You're not hurt.");
  if (player.money < def.price) return fail(`That costs ${formatMoney(def.price)}; you have ${formatMoney(player.money)}.`);
  const what = kind === "heal" ? `tend their wounds (up to ${HEAL_SERVICE_HP} HP)` : `a room for the night, until ${WAKE_HOUR}:00`;
  return { ok: true, price: def.price, message: `${what} for ${formatMoney(def.price)}` };
}

/** The NPC offers a service; the player then accepts or declines. */
export function offerService(persona: NpcPersona, state: NpcState, world: WorldSnapshot, kind: ServiceKind): ServiceQuote {
  const quote = quoteService(persona, state, world, kind);
  if (quote.ok) state.pendingService = { kind, price: quote.price };
  return quote;
}

export interface ServiceResult {
  ok: boolean;
  message: string;
  kind?: ServiceKind;
  /** For lodging: hours the player sleeps. The caller passes that much time for the village. */
  sleepHours?: number;
  healed?: number;
}

/** The player accepted: charge once and apply the effect. Rechecks everything. */
export function acceptService(persona: NpcPersona, state: NpcState, world: WorldSnapshot): ServiceResult {
  const offer = state.pendingService;
  state.pendingService = null;
  if (!offer) return { ok: false, message: "There's no service on offer." };
  const quote = quoteService(persona, state, world, offer.kind);
  if (!quote.ok) return { ok: false, message: quote.message };
  const player = world.player;
  const price = offer.price;
  if (player.money < price) return { ok: false, message: `You can't afford ${formatMoney(price)}.` };
  player.money -= price;
  state.money += price;
  recordEvent(world, { kind: "service", actor: persona.id, target: "player", details: offer.kind, importance: 2 });
  if (offer.kind === "heal") {
    const healed = Math.min(HEAL_SERVICE_HP, player.maxHp - player.hp);
    player.hp += healed;
    return { ok: true, kind: "heal", healed, message: `${player.name} paid you ${formatMoney(price)} and you tended their wounds: +${healed} HP (${player.hp}/${player.maxHp}).` };
  }
  // A night's sleep in a proper bed: they wake fully healed.
  const sleepHours = lodgingHours(world.hour);
  player.hp = player.maxHp;
  return { ok: true, kind: "lodging", sleepHours, message: `${player.name} paid you ${formatMoney(price)} for a room. They'll sleep ${sleepHours} hours and wake at ${WAKE_HOUR}:00, rested and healed.` };
}

/** The services an NPC sells through offer_service, with prices: "a room for the night (8 silver)". */
export function describeServices(persona: NpcPersona): string | null {
  const offered = (persona.services ?? []).filter((s) => OFFERED_SERVICES.includes(s.kind) && s.price !== undefined);
  if (offered.length === 0) return null;
  const words = offered.map((s) => `${s.kind === "heal" ? "tending wounds" : "a room for the night"} (${formatMoney(s.price!)})`);
  return `Services you sell: ${words.join(", ")}.`;
}
