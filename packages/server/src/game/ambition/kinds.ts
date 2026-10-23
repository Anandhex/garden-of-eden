import type { Job } from "@millbrook/shared";

/**
 * What people want from their lives (N40): the kinds of ambition, each with its ladder of rungs and the words it is spoken of in. Code picks
 * one for everyone grown (pick.ts), measures how far up it they are (careers.ts) and moves them up it by events (a guild exam, a seat won,
 * a plot bought); the menu weighs it in what they do (choice/actions/ambition.ts); talkers say it when asked what they want (words.ts).
 *
 * Adventurer grades are N42's ladder and military ranks N55's: they are not kinds here.
 */
export const AMBITION_KINDS = ["master_trade", "guild_seat", "land", "office", "wealth", "good_match", "revenge", "freedom", "knighthood", "quiet_life"] as const;
export type AmbitionKind = (typeof AMBITION_KINDS)[number];

export interface KindDef {
  /** The rungs, lowest first: being on the last one is having it. A kind with one rung (quiet_life) has no ladder. */
  ladder: readonly string[];
  /** What they want, said to them ("to master your trade"); `{target}` is filled with the target's words. */
  want: string;
  /** Said of them ("wants to master the smith's trade"). */
  wants: string;
}

export const KINDS: Record<AmbitionKind, KindDef> = {
  master_trade: { ladder: ["apprentice", "journeyman", "master", "a shop of their own"], want: "to master the {target}'s trade and keep a shop of your own", wants: "to master the {target}'s trade and keep a shop" },
  guild_seat: { ladder: ["member", "officer", "guild master"], want: "a seat in {target}, and one day to be its master here", wants: "a seat in {target}" },
  land: { ladder: ["saving for land", "a plot of their own", "tenants on it"], want: "land of your own, a plot you work for yourself", wants: "land of their own" },
  office: { ladder: ["a name in the place", "a council seat", "head of the place"], want: "a say in how {target} is run: a council seat, and one day its head", wants: "a seat on the council of {target}" },
  wealth: { ladder: ["trading", "a caravan of their own", "a trading house"], want: "to grow rich: a caravan of your own, then a trading house", wants: "to grow rich" },
  good_match: { ladder: ["a child to marry well", "a match above the family"], want: "to see {target} married above the family", wants: "a good match for {target}" },
  revenge: { ladder: ["a wrong to answer", "the wrong answered"], want: "to make {target} pay for what they did", wants: "revenge on {target}" },
  freedom: { ladder: ["bound", "free"], want: "your freedom", wants: "their freedom" },
  knighthood: { ladder: ["man-at-arms", "knight"], want: "a knighthood", wants: "a knighthood" },
  quiet_life: { ladder: ["content"], want: "a quiet life, and your days as they are", wants: "a quiet life" },
};

/** The last rung of a kind: on it, they have what they wanted. */
export const topStep = (kind: AmbitionKind): number => KINDS[kind].ladder.length - 1;

/** A step's words ("journeyman"), held to the ladder. */
export const stepWords = (kind: AmbitionKind, step: number): string => KINDS[kind].ladder[Math.max(0, Math.min(step, topStep(kind)))]!;

export const isKind = (k: string): k is AmbitionKind => (AMBITION_KINDS as readonly string[]).includes(k);

/**
 * The trades that have masters, journeymen and apprentices, and shops. `demand`: people a place needs for one shop of the trade (a place of
 * 300 keeps three bakeries and one forge), so masters beyond it find no custom and some move on (N25 migration reads it); `shop` names it.
 */
export const TRADES: Partial<Record<Job, { demand: number; shop: string; guild?: string }>> = {
  smith: { demand: 220, shop: "forge", guild: "smiths" },
  baker: { demand: 90, shop: "bakery" },
  weaver: { demand: 140, shop: "weaving shop" },
  carpenter: { demand: 160, shop: "joinery" },
  cobbler: { demand: 160, shop: "cobbler's shop" },
  tailor: { demand: 150, shop: "tailor's shop" },
  potter: { demand: 200, shop: "pottery" },
};
export const isTrade = (job: string): job is Job => job in TRADES;
export const TRADE_JOBS = Object.keys(TRADES) as Job[];

/** The words of a target in a sentence: a trade's name, a faction's or a place's (the caller gives the names). */
export function wantWords(kind: AmbitionKind, target: string, of: "want" | "wants" = "want"): string {
  return KINDS[kind][of].replace("{target}", target);
}
