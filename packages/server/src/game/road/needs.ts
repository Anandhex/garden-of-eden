import type { PlayerState } from "../../npc/types.js";
import { itemKey, parseItem } from "../items.js";
import { freshNeeds, type RoadNeeds } from "./state.js";

/**
 * What the player needs on the road (N26 D1): food, water and rest, 0 to 100. They fall only outside places (in a
 * place the player is fed and rested by being there: no chores in town), by the game hour, faster in rain and
 * heat; a meal, a drink and a night's rest bring them back. Low values slow the step and hurt; at nothing, the
 * body gives out. The cast has needs of its own (game/needs.ts); these are the player's, because the player has
 * had none until there was a road to need them on.
 */

/** Points lost per game hour walking. */
export const FALL = { food: 3.2, water: 4.6, rest: 3.4 } as const;
/** Points lost per game hour resting in the open; rest comes back. */
export const IDLE_FALL = { food: 1.4, water: 2, rest: -11 } as const;
/** What a place tops them up to when the player arrives and eats there. */
export const TOPPED = 85;
/** Below this a need is "low": slower steps, worse checks. */
export const LOW = 25;

/** What eating each food does: `[food, water]`. */
export const MEALS: Record<string, [number, number]> = {
  "bread loaf": [24, 0],
  stew: [45, 12],
  eggs: [14, 2],
  turnips: [12, 4],
  ale: [4, 16],
  "wild herbs": [6, 2],
};

export function needsOf(player: PlayerState, minute: number): RoadNeeds {
  return (player.roadNeeds ??= freshNeeds(minute));
}

const clamp = (n: number) => Math.max(0, Math.min(100, n));

/** Words for what is wrong, or null when all is well. */
export function needsWords(n: RoadNeeds): string | null {
  const w: string[] = [];
  if (n.food < 5) w.push("starving");
  else if (n.food < LOW) w.push("hungry");
  if (n.water < 5) w.push("parched");
  else if (n.water < LOW) w.push("thirsty");
  if (n.rest < 5) w.push("on your last legs");
  else if (n.rest < LOW) w.push("tired");
  return w.length > 0 ? w.join(", ") : null;
}

/** How much longer a step takes for how the player is: 1 when well. */
export function stepPenalty(n: RoadNeeds): number {
  const worst = Math.min(n.food, n.water, n.rest);
  return worst < 5 ? 1.6 : worst < LOW ? 1.25 : 1;
}

/** A bonus (usually negative) to checks for how the player is. */
export function checkPenalty(n: RoadNeeds): number {
  const worst = Math.min(n.food, n.water, n.rest);
  return worst < 5 ? -3 : worst < LOW ? -1 : 0;
}

export interface TickOpts {
  /** Resting in the open (a camp): rest comes back. */
  resting?: boolean;
  /** Weather of the day: rain and storms soak and tire. */
  weather?: string;
}

/** Let `minutes` pass on the road. Returns lines for the log when a need crosses into "low" or something gives. */
export function tickNeeds(player: PlayerState, minutes: number, minute: number, o: TickOpts = {}): string[] {
  const n = needsOf(player, minute);
  const hours = minutes / 60;
  const before = needsWords(n);
  const rate = o.resting ? IDLE_FALL : FALL;
  const wet = o.weather === "rain" || o.weather === "storm" ? 1.25 : o.weather === "snow" ? 1.35 : 1;
  n.food = clamp(n.food - rate.food * hours);
  n.water = clamp(n.water - rate.water * hours * (o.weather === "clear" ? 1.1 : 1));
  n.rest = clamp(n.rest - rate.rest * hours * (rate.rest > 0 ? wet : 1));
  n.at = minute;
  const lines: string[] = [];
  const after = needsWords(n);
  if (after && after !== before) lines.push(`You are ${after}.`);
  // Nothing to eat or drink: it costs blood, though never the last of it (nobody dies of hunger on a walk).
  if ((n.food <= 0 || n.water <= 0) && minutes >= 1 && player.hp > 1) {
    const lost = Math.min(player.hp - 1, Math.max(1, Math.round(hours * 4)));
    player.hp -= lost;
    lines.push(`${n.water <= 0 ? "Thirst" : "Hunger"} wears at you (−${lost} HP).`);
  }
  return lines;
}

/** Arriving where there's food and a bed. */
export function topUp(player: PlayerState, minute: number, to = TOPPED): void {
  const n = needsOf(player, minute);
  n.food = Math.max(n.food, to);
  n.water = Math.max(n.water, to);
  n.rest = Math.max(n.rest, to - 10);
  n.at = minute;
}

/** Eat or drink something from the pack. */
export function consume(player: PlayerState, item: string, minute: number): { ok: boolean; message: string } {
  const key = Object.keys(player.inventory).find((k) => (player.inventory[k] ?? 0) > 0 && (k === itemKey(item) || parseItem(k)?.name === item));
  const meal = MEALS[item] ?? MEALS[parseItem(key ?? item)?.name ?? item];
  if (!key || !meal) return { ok: false, message: key ? `You can't eat ${item}.` : `You have no ${item}.` };
  const left = (player.inventory[key] ?? 1) - 1;
  if (left <= 0) delete player.inventory[key];
  else player.inventory[key] = left;
  const n = needsOf(player, minute);
  n.food = clamp(n.food + meal[0]);
  n.water = clamp(n.water + meal[1]);
  return { ok: true, message: `You have ${item}.` };
}

/** Drink from a stream, a well or a trough. */
export function drink(player: PlayerState, minute: number, amount = 55): string {
  const n = needsOf(player, minute);
  n.water = clamp(n.water + amount);
  return "You drink your fill.";
}
