import { MAGIC_SCHOOLS, policyAt } from "../realm/policy.js";
import { readFileSync } from "node:fs";
import { z } from "zod";
import { seedOf } from "@millbrook/shared";
import type { Rng } from "../dice.js";
import type { Figure, Realm } from "../realm/types.js";

/**
 * Rough justice (N26J step 1, a stand-in for N48's law and trials). A crime that is seen is punished by the place's head
 * (or the lord where the lord sits), by the crime's weight and the head's own temper: a greedy head fines, a harsh one
 * flogs, banishes or hangs, a merciful one lets a first offence go with the stocks. The same `sentence` for the player and
 * for every NPC; N48 later puts a trial in front of it. Every sentence is an event and news.
 */
export const CrimeSchema = z.object({ id: z.string(), weight: z.number().int().min(1).max(5), words: z.string() });
export type CrimeDef = z.infer<typeof CrimeSchema>;

let loaded: Record<string, CrimeDef> | null = null;
export function crimes(): Record<string, CrimeDef> {
  if (loaded) return loaded;
  const raw = JSON.parse(readFileSync(new URL("../../data/law/crimes.json", import.meta.url), "utf8")) as { crimes: unknown[] };
  return (loaded = Object.fromEntries(raw.crimes.map((c) => CrimeSchema.parse(c)).map((c) => [c.id, c])));
}

export const SENTENCES = ["fine", "lockup", "stocks", "flogging", "banished", "bounty", "hanging"] as const;
export type SentenceKind = (typeof SENTENCES)[number];

export interface Sentence {
  /** The head or lord who gave it (a figure id), or "" when the place has none (the elders, together). */
  by: string;
  kind: SentenceKind;
  crime: string;
  /** Copper, for a fine or a bounty. */
  amount?: number;
  /** The day it ends (lock-up, banishment). */
  until?: number;
  /** Why, in words: the crime and the head's temper. */
  why: string;
}

export interface Accused {
  kind: "player" | "person" | "figure";
  id: string;
  name: string;
  /** Has run off (a bounty, not a sentence served). */
  fled?: boolean;
  /** Earlier sentences at this place (a second offence is dealt with harder). */
  priors?: number;
  /** Their class (N48): some law books fine a noble where a serf is flogged. */
  cls?: string;
}

/** The head who judges at a place: the lord where they sit, else the place's own head. */
export function judgeOf(realm: Realm, place: string): Figure | null {
  const s = realm.settlements[place];
  const head = s?.leader ? realm.figures[s.leader] : undefined;
  return head?.alive ? head : null;
}

/** A head's temper, from their traits: how harsh, how greedy, how merciful (0..1 each). */
export function temperOf(f: Figure | null): { harsh: number; greedy: number; merciful: number } {
  if (!f) return { harsh: 0.4, greedy: 0.4, merciful: 0.4 };
  return { harsh: Math.min(1, 0.6 * f.bravery + 0.4 * f.ambition), greedy: f.greed, merciful: Math.max(0, 1 - (0.6 * f.bravery + 0.4 * f.ambition) * 0.8 - f.greed * 0.2) };
}

/**
 * A kingdom's law book as sentences read it (N48 decision 1): its `punishments` law (harsh: heavier, more flogging and hanging; light: no
 * flogging, no hanging) and its `class_weight` law (strong: the high-born are fined where the low-born are flogged).
 */
export function lawBook(realm: Realm, place: string, day: number): { harsh: number; weight: number; rank: string } {
  const p = policyAt(realm, place, "punishments", day);
  const rank = policyAt(realm, place, "class_weight", day);
  return { harsh: p === "harsh" ? 0.35 : p === "lenient" ? -0.35 : 0, weight: p === "harsh" ? 1 : p === "lenient" ? -1 : 0, rank };
}

/** Whether a kingdom's custom hangs (decided once per kingdom from the seed: some do, some don't). */
export function hangs(realm: Realm, place: string): boolean {
  const k = realm.settlements[place]?.kingdom;
  return !!k && (seedOf(`${realm.seed}|hangs|${k}`) >>> 0) % 3 !== 0;
}

/** The sentence for `who`'s `crime` at `place` on `day`. Pure but for the roll. */
export function sentence(realm: Realm, who: Accused, crime: string, place: string, day: number, rng: Rng): Sentence {
  const def = crimes()[crime] ?? { id: crime, weight: 2, words: crime };
  const judge = judgeOf(realm, place);
  const t0 = temperOf(judge);
  // The kingdom's law book (N48): how harsh its punishments are, and whether rank buys a lighter one.
  const book = lawBook(realm, place, day);
  const t = { ...t0, harsh: Math.max(0, Math.min(1, t0.harsh + book.harsh)), merciful: Math.max(0, Math.min(1, t0.merciful - book.harsh)) };
  const high = who.cls === "noble" || who.cls === "gentry" || who.cls === "royal";
  const low = who.cls === "serf" || who.cls === "slave";
  // Where a school of magic is burned, sorcery is a capital crime (N51); where heresy is hunted, heresy weighs more (N50).
  const burns = crime === "sorcery" && MAGIC_SCHOOLS.some((sc) => policyAt(realm, place, `magic:${sc}`, day) === "burned");
  const hunted = crime === "heresy" && policyAt(realm, place, "heresy", day) === "persecute";
  const w = def.weight + Math.min(2, who.priors ?? 0) + book.weight + (book.rank === "strong" ? (low ? 1 : high ? -1 : 0) : 0) + (burns ? 2 : 0) + (hunted ? 1 : 0);
  const by = judge?.id ?? "";
  const why = `${def.words}${(who.priors ?? 0) > 0 ? ", and not the first time" : ""}${book.harsh > 0 ? " (the law here is harsh)" : book.harsh < 0 ? " (the law here is light)" : ""}; judged by ${judge?.name ?? "the elders"}${t.harsh > 0.65 ? ", a hard one" : t.greedy > 0.6 ? ", who likes coin" : t.merciful > 0.55 ? ", who is known to be merciful" : ""}`;
  if (who.fled) return { by, kind: "bounty", crime, amount: 50 * w * w, why };
  // Each choice scored by the weight of the crime and the judge's temper; the roll breaks near-ties.
  const score: Array<[SentenceKind, number]> = [
    ["fine", 1.2 + t.greedy * 1.5 - t.harsh * 1.0 - (w - 2) * 0.35],
    ["stocks", 0.9 + t.merciful * 0.8 - Math.abs(w - 1.5) * 0.4],
    ["lockup", 0.6 + (w - 1) * 0.35 + t.harsh * 0.3],
    ["flogging", -0.2 + t.harsh * 1.8 + (w - 2) * 0.35],
    ["banished", -0.8 + (w - 2) * 0.6 + t.harsh * 0.6],
    ["hanging", w >= 5 && (hangs(realm, place) || burns) && who.kind !== "player" && book.harsh >= 0 ? -0.5 + t.harsh * 2 + (w - 4) * 0.5 + (burns ? 0.8 : 0) : -9],
  ];
  // A light law book doesn't flog; a book that favours rank lets the high-born pay instead.
  if (book.harsh < 0) for (const x of score) if (x[0] === "flogging" || x[0] === "banished") x[1] -= 1.2;
  if (high && book.rank !== "equal") for (const x of score) if (x[0] === "fine") x[1] += book.rank === "strong" ? 1.5 : 0.6;
  const ranked = score.map(([k, s]) => [k, s + rng() * 0.35] as const).sort((a, b) => b[1] - a[1]);
  const kind = ranked[0]![0];
  const out: Sentence = { by, kind, crime, why };
  if (kind === "fine") out.amount = Math.round((20 + 30 * w * w) * (0.8 + t.greedy * 0.6));
  if (kind === "lockup") out.until = day + Math.max(1, w);
  if (kind === "banished") out.until = day + w * 6;
  return out;
}

export const SENTENCE_WORDS: Record<SentenceKind, string> = {
  fine: "fined",
  lockup: "locked up",
  stocks: "put in the stocks for a day",
  flogging: "flogged",
  banished: "banished from the place",
  bounty: "put a price on",
  hanging: "hanged",
};
