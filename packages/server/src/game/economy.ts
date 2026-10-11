import { adjustRelation } from "../npc/social.js";
import type { NpcPersona, NpcState, WorldSnapshot } from "../npc/types.js";
import { countItem, craftingNeeds, hasInputs, tradeRecipes } from "./crafting.js";
import { payDebts } from "./debts.js";
import type { Rng } from "./dice.js";
import { mineRoadClosed, townEventsOn } from "./events-calendar.js";
import { recordEvent } from "./events.js";
import { ITEMS, itemKey, itemLabel, itemValue, parseItem } from "./items.js";
import { formatMoney } from "./money.js";
import { npcHasRoom } from "../npc/state.js";

/**
 * A small working economy (N10). Prices follow stock: the last copies of something
 * a maker can't make more of right now (no materials) cost more, and what they have
 * piles of costs less. Village demand differs by item: horseshoes and bread
 * always sell, chain mail rarely. NPCs restock: they buy materials from whoever
 * sells them at the same place, and from travelling traders on market day (no ore
 * while the mine road is shut). All in code; the model only sees the prices.
 */

/** How keen the village is on each item: weights village sales. 1 is ordinary. */
export const VILLAGE_DEMAND: Record<string, number> = {
  horseshoe: 1.6,
  "bread loaf": 1.5,
  ale: 1.4,
  stew: 1.2,
  "healing salve": 1,
  "wild herbs": 0.8,
  dagger: 0.8,
  "rabbit pelt": 0.7,
  "wolf pelt": 0.6,
  "iron sword": 0.5,
  "leather armor": 0.4,
  cudgel: 0.4,
  "chain mail": 0.2,
  "forge hammer": 0.2,
  "iron ore": 0.3,
};

export const demandOf = (name: string) => VILLAGE_DEMAND[name] ?? 1;

/** Price factors from stock: a pile of it is cheaper; the last copies, with nothing to make more from, dearer. */
export const SCARCE = { atOrBelow: 1, factor: 1.25 } as const;
export const PLENTY = { atOrAbove: 12, factor: 0.9 } as const;
/** Most stock and materials can move a price, either way. */
export const STOCK_CAP = { low: 0.85, high: 1.4 } as const;

/**
 * What stock and materials do to an NPC's price for one item (1 = no change). Only
 * for things they make: a shopkeeper reselling something isn't short of materials.
 */
export function stockFactor(persona: NpcPersona, state: Pick<NpcState, "inventory">, name: string): number {
  const recipe = tradeRecipes(persona).find((r) => r.output === name);
  if (!recipe) return 1;
  const have = countItem(state.inventory, name);
  const f = have >= PLENTY.atOrAbove ? PLENTY.factor : have <= SCARCE.atOrBelow && !hasInputs(state.inventory, recipe) ? SCARCE.factor : 1;
  return Math.max(STOCK_CAP.low, Math.min(STOCK_CAP.high, f));
}

/** Words for the situation block when stock is moving prices. */
export function describeStockPrices(persona: NpcPersona, state: Pick<NpcState, "inventory">): string | null {
  const out = tradeRecipes(persona)
    .map((r) => ({ name: r.output, f: stockFactor(persona, state, r.output) }))
    .filter((x) => x.f !== 1);
  if (out.length === 0) return null;
  return `Your prices follow your stock: ${out.map((x) => `${x.name} ${x.f > 1 ? "dearer" : "cheaper"} (${x.f > 1 ? "nearly out, and nothing to make more from" : "plenty in stock"})`).join("; ")}.`;
}

export interface Trader {
  id: string;
  persona: NpcPersona;
  state: NpcState;
}

/** Markup travelling traders charge over an item's value. */
export const TRADER_MARKUP = 1.2;
/** Hours on market day the traders are about. */
export const MARKET_HOURS = [8, 16] as const;

/**
 * Restocking, for an hour: each NPC short of materials buys from someone at the same
 * place who sells them, and on market day from a travelling trader. Returns log lines.
 */
export function restock(members: Trader[], where: (m: Trader) => string | null, world: WorldSnapshot, rng: Rng): string[] {
  const log: string[] = [];
  const market = townEventsOn(world).includes("market") && world.hour >= MARKET_HOURS[0] && world.hour < MARKET_HOURS[1];
  for (const buyer of members) {
    if (buyer.state.outcome === "dead" || buyer.state.dormant) continue;
    const place = where(buyer);
    if (!place) continue;
    for (const [name, short] of Object.entries(craftingNeeds(buyer.persona, buyer.state))) {
      // From a neighbour who sells it.
      const seller: Trader | undefined = members.find((s) => s !== buyer && where(s) === place && s.state.outcome !== "dead" && countItem(s.state.inventory, name) > 0 && (s.persona.prices[name] !== undefined || s.persona.buys.includes(name)));
      if (seller) {
        const key = Object.keys(seller.state.inventory).find((k) => parseItem(k)?.name === name && (seller.state.inventory[k] ?? 0) > 0)!;
        const qty = Math.min(short, seller.state.inventory[key] ?? 0);
        const each = Math.max(1, Math.round((itemValue(key) ?? 0) * (seller.persona.prices[name] !== undefined ? 1 : 0.9)));
        const afford = Math.min(qty, Math.floor((buyer.state.money - (buyer.persona.reserveMoney ?? 200) / 2) / each));
        if (afford > 0 && npcHasRoom(buyer.persona, buyer.state, { [key]: afford })) {
          seller.state.inventory[key] = (seller.state.inventory[key] ?? 0) - afford;
          if (seller.state.inventory[key] === 0) delete seller.state.inventory[key];
          buyer.state.inventory[key] = (buyer.state.inventory[key] ?? 0) + afford;
          buyer.state.money -= afford * each;
          seller.state.money += afford * each;
          payDebts(seller.persona, seller.state);
          adjustRelation(buyer.state, seller.id, "affection", 1);
          adjustRelation(seller.state, buyer.id, "affection", 1);
          recordEvent(world, { kind: "trade", actor: buyer.id, target: seller.id, details: `${afford} ${itemLabel(key)} for ${formatMoney(afford * each)}`, importance: 2, witnesses: [buyer.id, seller.id] });
          log.push(`${buyer.persona.name} bought ${afford} ${itemLabel(key)} from ${seller.persona.name}.`);
          continue;
        }
      }
      // From a travelling trader on market day: once a day each, and no ore while the mine road is shut.
      if (!market || buyer.state.triggerDay[`market:${world.day}`] !== undefined) continue;
      if (name === "iron ore" && mineRoadClosed(world)) continue;
      const def = ITEMS[name];
      if (!def || rng() > 0.8) continue;
      const each = Math.round(def.value * TRADER_MARKUP);
      const afford = Math.min(short, Math.floor((buyer.state.money - (buyer.persona.reserveMoney ?? 200)) / each));
      const key = itemKey(name);
      if (afford <= 0 || !npcHasRoom(buyer.persona, buyer.state, { [key]: afford })) continue;
      buyer.state.triggerDay[`market:${world.day}`] = world.day;
      buyer.state.inventory[key] = (buyer.state.inventory[key] ?? 0) + afford;
      buyer.state.money -= afford * each;
      log.push(`${buyer.persona.name} bought ${afford} ${name} from a travelling trader for ${formatMoney(afford * each)}.`);
    }
  }
  return log;
}

/** Pick what a villager buys from stock, weighted by village demand. */
export function pickDemanded(keys: string[], rng: Rng): string | undefined {
  if (keys.length === 0) return undefined;
  const weights = keys.map((k) => demandOf(parseItem(k)?.name ?? k));
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rng() * total;
  for (let i = 0; i < keys.length; i++) {
    r -= weights[i]!;
    if (r <= 0) return keys[i];
  }
  return keys[keys.length - 1];
}
