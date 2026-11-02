import { config } from "../../config.js";
import type { Period, Realm } from "../realm/types.js";

/**
 * An institution's books (N69 decision 3): every copper that moves through the realm's one coin path (game/realm/ledger.ts:
 * `transfer`, `mint`, `sink`, the tax road) is also summed into the books of the place (`s:`) or faction (`f:`) it left or reached,
 * by line and by tax period. One row per line per period per institution, not one per coin; the newest `KEEP_PERIODS` are kept.
 * So the sum of a place's lines over a span is exactly how its treasury changed.
 *
 * The books hold the truth: skimmed coin is its own `stolen` line. What the place's people are shown (`publicLines`) carries it as
 * `upkeep`, as the thief wrote it down.
 */
export const LINES = ["taxes_in", "tax_out", "trade", "upkeep", "wages", "build", "food", "loot", "ransom", "dues", "bounty", "tribute", "fines", "stolen", "other"] as const;
export type BookLine = (typeof LINES)[number];

/** Tax periods kept: two years of them at two a year, and two more. */
export const KEEP_PERIODS = 6;

const taxDays = () => Math.max(1, Math.round(config.daysPerYear / 2));

/** The tax day that closes the period `day` falls in (a tax day closes its own period). */
export const periodOf = (day: number): number => Math.max(0, Math.ceil(day / taxDays()) * taxDays());

/** Which line of the books a movement of coin is, from its words and which side of it the institution is on. */
export function lineOf(why: string, side: "in" | "out"): BookLine {
  const w = why.toLowerCase();
  if (w.startsWith("stolen")) return "stolen";
  if (w.startsWith("tax")) return side === "in" ? "taxes_in" : "tax_out";
  if (w.startsWith("wages")) return "wages";
  if (w.includes("earnings") || w.includes("goods sold") || w.includes("caravan") || w.includes("a day on") || w.includes("sold")) return "trade";
  if (w === "upkeep" || w.includes("upkeep")) return "upkeep";
  if (w.startsWith("building") || w.includes("houses") || w.includes("a hall in")) return "build";
  if (w.includes("grain")) return "food";
  if (w.includes("raid") || w.includes("robbed") || w.includes("outlaws") || w.includes("treasure") || w.includes("carried off") || w.includes("taken from")) return "loot";
  if (w.includes("ransom") || w.includes("bribe")) return "ransom";
  if (w.includes("dues") || w.includes("fee") || w.includes("stake") || w.includes("the split") || w.includes("charter") || w.includes("takeover")) return "dues";
  if (w.startsWith("pack ") || w.startsWith("dungeon ") || w.includes("bounty")) return "bounty";
  if (w.includes("tribute") || w.includes("toll") || w === "service") return "tribute";
  if (w.includes("fine")) return "fines";
  return "other";
}

/** Add to an institution's books for the period `day` falls in. Only places and factions keep books. */
export function book(realm: Realm, inst: string, line: BookLine, amount: number, day: number): void {
  if (!amount || !(inst.startsWith("s:") || inst.startsWith("f:"))) return;
  const books = (realm.books ??= {});
  const list = (books[inst] ??= []);
  const close = periodOf(day);
  let p = list.at(-1);
  if (!p || p.day < close) {
    p = { day: close, lines: {} };
    list.push(p);
    if (list.length > KEEP_PERIODS) list.splice(0, list.length - KEEP_PERIODS);
  }
  p.lines[line] = (p.lines[line] ?? 0) + amount;
}

/** A movement of coin, booked on both sides (each side that keeps books). */
export function bookMove(realm: Realm, from: string, to: string, amount: number, why: string, day: number): void {
  book(realm, from, lineOf(why, "out"), -amount, day);
  book(realm, to, lineOf(why, "in"), amount, day);
}

/** The periods of an institution's books, oldest first. `truth` false: as its people are shown them (skimming hidden in upkeep). */
export function periodsOf(realm: Realm, inst: string, truth = true): Period[] {
  const list = realm.books?.[inst] ?? [];
  return list.map((p) => ({ day: p.day, lines: truth ? { ...p.lines } : publicLines(p.lines) }));
}

/** The lines as the thief wrote them down: stolen coin is upkeep. */
export function publicLines(lines: Record<string, number>): Record<string, number> {
  const out = { ...lines };
  if (out.stolen) {
    out.upkeep = (out.upkeep ?? 0) + out.stolen;
    delete out.stolen;
  }
  return out;
}

/** The sum of every line in an institution's books from period `fromDay` (a period's closing day) on. */
export function bookedSince(realm: Realm, inst: string, fromDay = 0): number {
  return (realm.books?.[inst] ?? []).filter((p) => p.day >= fromDay).reduce((s, p) => s + Object.values(p.lines).reduce((a, b) => a + b, 0), 0);
}
