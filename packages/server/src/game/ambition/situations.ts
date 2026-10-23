import type { AmbitionRow } from "../../store/careerStore.js";
import type { PersonRow } from "../../store/peopleStore.js";
import { temperOf } from "../chatter/person.js";
import { sociability } from "../gossip/venues.js";
import type { SiteDay } from "../people/conditions.js";
import { traitsOfRow } from "../people/traits.js";
import type { AmbitionKind } from "./kinds.js";

/**
 * Ambitions that live (N40 follow-up). An ambition is not a fixed path walked at a fixed pace: how much someone wants it (`strength`) rises
 * with an opening and falls with setbacks, grief and age, and below a point they let it go; being blocked builds `frustration`, which at a
 * head turns into something by their temper (a grudge against whoever is in the way, a slander, a shortcut, leaving, or giving up); the
 * way they go about it (`route`) is chosen from their situation (a spouse's shop, a parent's land, the urge to wander) and changes when it
 * does; and a hard day (a famine, a death in the family, a raid) can push it aside for a while with an `urgent` want. These are the pure
 * rules; the career day (day.ts) applies them.
 */

/** How they are going about what they want. */
export const ROUTES = ["custom", "take_over", "marry_in", "inherit", "wander", "unlicensed", "save", "standing", "favour"] as const;
export type Route = (typeof ROUTES)[number];

export const ROUTE_WORDS: Record<Route, string> = {
  custom: "the usual way, waiting your turn",
  take_over: "taking over a shop whose master is gone",
  marry_in: "through your marriage",
  inherit: "what your family will leave you",
  wander: "working as a journeyman in other towns, to come back a better hand",
  unlicensed: "your own way, without the guild's leave",
  save: "saving every coin you can",
  standing: "your good name and your work",
  favour: "the favour of those who decide",
};

/** A short-term want that takes over while it lasts. */
export interface Urgent {
  kind: "get_by" | "grieve" | "keep_safe";
  since: number;
  until: number;
  why: string;
}

export const URGENT_WORDS: Record<Urgent["kind"], string> = {
  get_by: "getting through the hunger",
  grieve: "your grief",
  keep_safe: "keeping your family safe",
};

export function urgentOf(a: Pick<AmbitionRow, "urgent">, day: number): Urgent | null {
  if (!a.urgent) return null;
  try {
    const u = JSON.parse(a.urgent) as Urgent;
    return u.until >= day ? u : null;
  } catch {
    return null;
  }
}

/** The numbers of a living ambition, per check (four a year) unless said otherwise. */
export const LIVING = {
  /** Below this they let it go. */
  letGo: 0.15,
  /** Each check, strength moves this share of the way back toward their own base. */
  drift: 0.1,
  /** From this many years past coming of age, wanting fades a little each check. */
  fadeFrom: 34,
  fade: 0.02,
  /** An opening (a seat falls vacant, room for a shop, a rival gone, a new place). */
  opening: 0.15,
  /** A blocked check, a failed exam, a refusal, a lost seat: frustration added. */
  blocked: 0.1,
  failed: 0.15,
  lostSeat: 0.3,
  /** Frustration fades this much a check when nothing blocks them, and turns into something at this. */
  ease: 0.04,
  head: 0.7,
  /** What is left of frustration after it has been let out. */
  vented: 0.25,
  /** A death in the family: grief for this many days, and the share of strength it leaves. */
  griefDays: 12,
  grief: 0.7,
  /** A famine at or above this makes the poor want only to get by. */
  famine: 0.3,
  /** A season of famine eats this many days' worth of what was put by for land or wealth, a day. */
  famineCost: 1,
} as const;

/** How much someone wants things at all: their own level, which strength drifts back to. */
export const baseStrength = (row: Pick<PersonRow, "id" | "cls" | "traits">): number => Math.round((0.35 + 0.5 * traitsOfRow(row).ambition) * 1000) / 1000;

/** What a route choice reads of someone's situation. */
export interface RouteEnv {
  /** A spouse living here keeps a shop of this trade. */
  spouseShop: string | null;
  /** A parent living here keeps a shop of this trade. */
  parentShop: string | null;
  spouseLand: boolean;
  parentLand: boolean;
  /** Free to go where they like (not bound to a master or the land). */
  free: boolean;
}

/** The way they mean to go about it, from where they stand: a family shop or land first, the urge to wander, the sociable and unscrupulous by favour. */
export function chooseRoute(row: PersonRow, kind: AmbitionKind, step: number, target: string | null, env: RouteEnv, roll: number): Route | null {
  const t = temperOf(row);
  const tr = traitsOfRow(row);
  switch (kind) {
    case "master_trade":
      if (step >= 2 && target && env.spouseShop === target) return "marry_in";
      if (step >= 1 && target && env.parentShop === target) return "inherit";
      if (step === 1 && env.free && tr.bravery > 0.55 && sociability(row.id) < 0.55 && roll < 0.6) return "wander";
      return "custom";
    case "land":
      if (env.spouseLand) return "marry_in";
      if (env.parentLand) return "inherit";
      return "save";
    case "guild_seat":
    case "office":
      return sociability(row.id) > 0.55 && t.honesty < 0.5 ? "favour" : "standing";
    case "wealth":
      return "save";
    default:
      return null;
  }
}

/** What frustration at a head turns into. */
export type Vent = "grudge" | "slander" | "shortcut" | "leave" | "give_up";

/**
 * Which way someone's frustration goes, by their temper: the hot-tempered and proud hold it against whoever is in their way, the dishonest
 * blacken them, the greedy and unscrupulous take a shortcut (a shop without the guild's leave), the bold and free leave, the forgiving and
 * the unambitious give up. `roll` (0..1) breaks the closeness of two. A way that does not apply (no one in the way, no shortcut for this
 * ambition, not free to leave) is not taken.
 */
export function ventOf(row: PersonRow, kind: AmbitionKind, step: number, can: { blocker: boolean; free: boolean; shortcut: boolean }, roll: number): Vent {
  const t = temperOf(row);
  const tr = traitsOfRow(row);
  const options: Array<[Vent, number]> = [["give_up", 0.6 * t.forgiveness + 0.5 * (1 - tr.ambition)]];
  if (can.blocker) options.push(["grudge", 0.8 * t.temper + 0.3 * t.pride], ["slander", 0.9 * (1 - t.honesty) + 0.2 * t.temper]);
  if (kind === "master_trade" && step === 2 && can.shortcut) options.push(["shortcut", 0.6 * tr.greed + 0.6 * (1 - t.honesty)]);
  if (can.free) options.push(["leave", 0.4 * tr.bravery + 0.3 * (1 - sociability(row.id))]);
  const jitter = (i: number) => 0.3 * ((roll * (i + 1) * 7.31) % 1);
  return options.map(([v, w], i) => [v, w + jitter(i)] as const).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]![0];
}

/** What the place's day means for someone's wanting: hunger, war, plenty. Returns the change to strength and an urgent want, if one comes. */
export function hardTimes(row: Pick<PersonRow, "cls" | "job" | "shop">, kind: AmbitionKind, sd: SiteDay, day: number, poor: boolean): { strength: number; urgent: Urgent | null } {
  let strength = 0;
  let urgent: Urgent | null = null;
  if (sd.famine >= LIVING.famine && poor) urgent = { kind: "get_by", since: day, until: day + 12, why: "the hunger" };
  if (sd.besieged || (sd.raided && sd.atWar)) {
    if (kind === "knighthood") strength += LIVING.opening;
    else if (poor) urgent ??= { kind: "keep_safe", since: day, until: day + 6, why: "the fighting" };
  }
  if (sd.prosperity >= 70 && (kind === "master_trade" || kind === "wealth" || kind === "land")) strength += 0.03;
  if (sd.prosperity <= 25 && (kind === "wealth" || kind === "master_trade")) strength -= 0.03;
  if (sd.plague >= 0.2) strength -= 0.05;
  return { strength, urgent };
}
