import { z } from "zod";

/**
 * Money: copper, silver and gold coins. 1 gold = 10 silver = 100 copper.
 *
 * Code always counts in copper (whole numbers), so sums and splits stay exact.
 * People see coins: formatMoney(150) is "1 gold 5 silver". The model is shown
 * prices that way too, and names prices that way in tool calls (parseMoney), so
 * it never has to convert units itself (design rule 2: words, not maths).
 *
 * Data files may write amounts as coin phrases ("15 silver", "2g 5s") or as
 * plain copper numbers (MoneySchema).
 */
export const COPPER_PER_SILVER = 10;
export const SILVER_PER_GOLD = 10;
export const COPPER_PER_GOLD = COPPER_PER_SILVER * SILVER_PER_GOLD;

/** An amount of money, in copper. */
export type Money = number;

export interface Coins {
  gold: number;
  silver: number;
  copper: number;
}

/** 1234 copper → { gold: 12, silver: 3, copper: 4 }: the fewest coins. */
export function toCoins(copper: Money): Coins {
  const c = Math.max(0, Math.round(copper));
  return {
    gold: Math.floor(c / COPPER_PER_GOLD),
    silver: Math.floor((c % COPPER_PER_GOLD) / COPPER_PER_SILVER),
    copper: c % COPPER_PER_SILVER,
  };
}

/** 1234 → "12 gold 3 silver 4 copper"; 15 → "1 silver 5 copper"; 0 → "0 copper". */
export function formatMoney(copper: Money): string {
  const { gold, silver, copper: cp } = toCoins(copper);
  const parts = [gold ? `${gold} gold` : "", silver ? `${silver} silver` : "", cp ? `${cp} copper` : ""].filter(Boolean);
  return parts.length > 0 ? parts.join(" ") : "0 copper";
}

/** 1234 → "12g 3s 4c": for tight spots in the UI. */
export function formatMoneyShort(copper: Money): string {
  const { gold, silver, copper: cp } = toCoins(copper);
  const parts = [gold ? `${gold}g` : "", silver ? `${silver}s` : "", cp ? `${cp}c` : ""].filter(Boolean);
  return parts.length > 0 ? parts.join(" ") : "0c";
}

const UNIT: Record<string, Money> = {
  g: COPPER_PER_GOLD,
  gp: COPPER_PER_GOLD,
  gold: COPPER_PER_GOLD,
  s: COPPER_PER_SILVER,
  sp: COPPER_PER_SILVER,
  silver: COPPER_PER_SILVER,
  c: 1,
  cp: 1,
  copper: 1,
};

/**
 * Read a coin phrase: "1 silver 5 copper", "1s 5c", "2 gold, 3 silver and 4 copper",
 * "15 coppers". Every number needs its coin: "15" alone is ambiguous and is
 * rejected. Returns copper, or null if it isn't a clean coin phrase.
 */
export function parseMoney(text: string): Money | null {
  const cleaned = text.trim().toLowerCase().replace(/\b(coins?|pieces?|and)\b/g, " ").replace(/[,.]/g, " ");
  const token = /(\d+)\s*(gold|silver|copper|gp|sp|cp|g|s|c)(?:s\b|\b)/g;
  let total = 0;
  let matched = 0;
  for (const m of cleaned.matchAll(token)) {
    total += Number(m[1]) * UNIT[m[2]!]!;
    matched += 1;
  }
  if (matched === 0) return null;
  // Nothing may be left over: "15 silver and change" is not a price.
  if (cleaned.replace(token, "").trim() !== "") return null;
  return total;
}

/** An amount in a data file: a coin phrase ("15 silver") or a whole number of copper. */
export const MoneySchema = z.union([
  z.number().int().min(0),
  z.string().transform((s, ctx) => {
    const copper = parseMoney(s);
    if (copper === null) {
      ctx.addIssue({ code: "custom", message: `"${s}" isn't an amount of money; write it like "1 silver 5 copper"` });
      return z.NEVER;
    }
    return copper;
  }),
]);

/** A price in a tool call from the model: a coin phrase, read into copper. Numbers alone are refused. */
export const PriceArgSchema = z.string().transform((s, ctx) => {
  const copper = parseMoney(s);
  if (copper === null || copper <= 0) {
    ctx.addIssue({ code: "custom", message: `Say the price in coins, like "1 silver 5 copper" (got "${s}").` });
    return z.NEVER;
  }
  return copper;
});

/** How a price parameter is described to the model. */
export const PRICE_PARAM = z.string().describe('The price in coins, e.g. "1 silver 5 copper" or "4 gold"');
