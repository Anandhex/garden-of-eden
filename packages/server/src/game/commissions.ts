import { npcPrice } from "../npc/actions.js";
import { holdsGrudge } from "../npc/relationship.js";
import { npcHasRoom } from "../npc/state.js";
import type { NpcPersona, NpcState, WorldSnapshot } from "../npc/types.js";
import { absoluteMinute, formatMinute } from "./clock.js";
import { LATE_DISCOUNT, promise, settleNpcPromise } from "./commitments.js";
import { tradeRecipes, type Recipe } from "./crafting.js";
import { recordEvent } from "./events.js";
import { isTooHurtToWork } from "./healing.js";
import { itemKey, itemLabel, parseItem } from "./items.js";
import { note } from "./journal.js";
import { formatMoney } from "./money.js";
import { playerHasRoom } from "./gear.js";

/**
 * Commissions (the part of N10 that promises need, N5.5). The player orders
 * something the NPC makes and pays half up front. The NPC names a time from how long
 * the work takes, not from their schedule, so an order placed late in the day can
 * run late. They make it in their working hours (game/simulation.ts); if it's late
 * they apologise unprompted (npc/initiative.ts) and take LATE_DISCOUNT% off.
 */
export interface Commission {
  /** Item name ordered: "iron sword". */
  item: string;
  recipeId: string;
  /** Full price in copper; `deposit` of it already paid. */
  price: number;
  deposit: number;
  /** Absolute minute they promised it by. */
  due: number;
  status: "waiting" | "making" | "ready";
  /** What came out (with its rolled tier), once made. Kept aside, not for sale. */
  output?: string;
  /** The promise in state.commitments. */
  commitment: string;
  late?: boolean;
}

/** Extra time (minutes) an NPC adds to the work time when naming a due time. */
export const COMMISSION_SLACK = 60;

export interface CommissionQuote {
  ok: boolean;
  message: string;
  price: number;
  deposit: number;
  due: number;
  recipe?: Recipe;
}

/** What an order would cost and when it'd be ready, without changing anything. */
export function quoteCommission(persona: NpcPersona, state: NpcState, world: WorldSnapshot, itemName: string): CommissionQuote {
  const fail = (message: string): CommissionQuote => ({ ok: false, message, price: 0, deposit: 0, due: 0 });
  const name = parseItem(itemName)?.name ?? itemName.trim().toLowerCase();
  const recipe = tradeRecipes(persona).find((r) => r.output === name);
  if (!recipe) return fail(`${persona.name} doesn't make ${name || "that"}.`);
  if (state.commission) return fail(`${persona.name} is still working on your ${state.commission.item}.`);
  if (state.inCombat || state.outcome) return fail(`${persona.name} is in no state for that.`);
  if (isTooHurtToWork(persona, state)) return fail(`${persona.name} is too badly hurt to take on work.`);
  if (holdsGrudge(state, world.day)) return fail(`${persona.name} won't take work from you while they hold a grudge.`);
  const price = (npcPrice(persona, itemKey(name), world) ?? 0) * recipe.qty;
  if (price <= 0) return fail(`${persona.name} doesn't sell ${name}.`);
  const deposit = Math.ceil(price / 2);
  if (world.player.money < deposit) return fail(`The deposit is ${formatMoney(deposit)}; you have ${formatMoney(world.player.money)}.`);
  // Rounded up to the hour: "ready by six".
  const due = Math.ceil((absoluteMinute(world) + recipe.hours * 60 + COMMISSION_SLACK) / 60) * 60;
  return {
    ok: true,
    message: `${recipe.qty > 1 ? `${recipe.qty} ` : ""}${name} for ${formatMoney(price)}, ${formatMoney(deposit)} up front, ready by ${formatMinute(due, world.day)}`,
    price,
    deposit,
    due,
    recipe,
  };
}

/** Place the order: the deposit is paid, and the NPC promises a time. */
export function orderCommission(persona: NpcPersona, state: NpcState, world: WorldSnapshot, itemName: string): CommissionQuote {
  const quote = quoteCommission(persona, state, world, itemName);
  if (!quote.ok) return quote;
  const player = world.player;
  player.money -= quote.deposit;
  state.money += quote.deposit;
  const name = quote.recipe!.output;
  const c = promise(state.commitments, { kind: "commission", what: `${quote.recipe!.qty > 1 ? `${quote.recipe!.qty} ` : /^[aeiou]/.test(name) ? "an " : "a "}${name}`, due: quote.due, owner: persona.id, toWhom: "player" });
  state.commission = { item: name, recipeId: quote.recipe!.id, price: quote.price, deposit: quote.deposit, due: quote.due, status: "waiting", commitment: c.id };
  recordEvent(world, { kind: "commission", actor: "player", target: persona.id, details: name, importance: 3 });
  note(player, { id: `promise:${c.id}`, day: world.day, npc: persona.id, kind: "promise", text: `${persona.name} promised you ${c.what} by ${formatMinute(quote.due, world.day)}.` });
  return quote;
}

/** The job for a commission just finished: set the piece aside and settle the promise (late or not). */
export function commissionMade(persona: NpcPersona, state: NpcState, output: string, world: Pick<WorldSnapshot, "day" | "hour" | "minute" | "location" | "events">): string | null {
  const order = state.commission;
  if (!order || order.status !== "making") return null;
  const qty = state.inventory[output] ?? 0;
  if (qty <= 0) return null;
  state.inventory[output] = qty - 1;
  if (state.inventory[output] === 0) delete state.inventory[output];
  order.output = output;
  order.status = "ready";
  const c = state.commitments.find((x) => x.id === order.commitment);
  if (c) settleNpcPromise(persona, state, c, world);
  order.late = c?.late === true;
  return `${persona.name} finished your ${itemLabel(output)}${order.late ? ", late" : ""}.`;
}

/** What the player still owes on collection: the balance, less the late discount. */
export function balanceDue(order: Commission): number {
  const off = order.late ? Math.round((order.price * LATE_DISCOUNT) / 100) : 0;
  return Math.max(0, order.price - order.deposit - off);
}

export interface CollectResult {
  ok: boolean;
  message: string;
  paid: number;
}

/** Pick up a finished commission: pay the balance and take it. */
export function collectCommission(persona: NpcPersona, state: NpcState, world: WorldSnapshot): CollectResult {
  const order = state.commission;
  const player = world.player;
  if (!order) return { ok: false, paid: 0, message: `You haven't ordered anything from ${persona.name}.` };
  if (order.status !== "ready" || !order.output) return { ok: false, paid: 0, message: `Your ${order.item} isn't ready yet (promised by ${formatMinute(order.due, world.day)}).` };
  const owed = balanceDue(order);
  if (player.money < owed) return { ok: false, paid: 0, message: `You owe ${formatMoney(owed)} on your ${order.item}; you have ${formatMoney(player.money)}.` };
  if (!playerHasRoom(player, { [order.output]: 1 })) return { ok: false, paid: 0, message: "No room in your pack for it." };
  player.money -= owed;
  state.money += owed;
  player.inventory[order.output] = (player.inventory[order.output] ?? 0) + 1;
  state.commission = null;
  const discount = order.late ? ` (${LATE_DISCOUNT}% off for the wait)` : "";
  return { ok: true, paid: owed, message: `${player.name} collected their ${itemLabel(order.output)} and paid the ${formatMoney(owed)} balance${discount}.` };
}

/** Can the NPC start the commission now? (Has the inputs and the room.) */
export function canStartCommission(persona: NpcPersona, state: NpcState): Recipe | null {
  const order = state.commission;
  if (!order || order.status !== "waiting") return null;
  const recipe = tradeRecipes(persona).find((r) => r.id === order.recipeId);
  if (!recipe) return null;
  const has = Object.entries(recipe.inputs).every(([name, qty]) => Object.entries(state.inventory).reduce((n, [k, q]) => n + (parseItem(k)?.name === name ? q : 0), 0) >= qty);
  return has && npcHasRoom(persona, state, { [itemKey(recipe.output)]: recipe.qty }) ? recipe : null;
}

/** The situation line about an order, or null. */
export function describeCommission(state: NpcState, world: Pick<WorldSnapshot, "day" | "hour" | "minute">): string | null {
  const order = state.commission;
  if (!order) return null;
  if (order.status === "ready") {
    return `Their ${order.item} is ready for them to collect${order.late ? `. You finished it late: apologise, and take ${LATE_DISCOUNT}% off` : ""}.`;
  }
  const late = absoluteMinute(world) > order.due ? " You're already late with it." : "";
  return `You promised to make them ${/^[aeiou]/.test(order.item) ? "an" : "a"} ${order.item} by ${formatMinute(order.due, world.day)}${order.status === "making" ? " and you're working on it" : ", and haven't started"}.${late}`;
}
