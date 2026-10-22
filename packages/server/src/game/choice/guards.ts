import { config } from "../../config.js";
import type { ActionDef, ChoiceCtx, Option, Scored } from "./types.js";
import { DAY_COOLDOWNS, HOUR_COOLDOWNS, MAX_FIGHTS_PER_HOUR, MAX_FIGHTS_PER_PLACE_PER_DAY, MAX_RUN, W } from "./weights.js";
import { scored } from "./score.js";

/**
 * Guardrails (N38): cooldowns so nobody loops on one thing, a damp on the same non-habit action again and again, a cap on fights in one place,
 * and people nobody may do violence to. They act on the menu (an option that is not allowed is not offered) and on the score (a loop costs).
 */

/** A pair-of-people cooldown reads the same table; `since` is hours (hour grain) or days (day grain) since the last pick. */
export function coolingDown(ctx: Pick<ChoiceCtx, "grain" | "last">, def: Pick<ActionDef, "id" | "cooldown">, now: number): boolean {
  const table = ctx.grain === "hour" ? HOUR_COOLDOWNS : DAY_COOLDOWNS;
  const wait = def.cooldown ?? table[def.id] ?? 0;
  const last = ctx.last[def.id];
  return wait > 0 && last !== undefined && now - last < wait;
}

/** The absolute hour, or the day, as the cooldowns count it. */
export const clockOf = (ctx: Pick<ChoiceCtx, "grain" | "day" | "hour">): number => (ctx.grain === "hour" ? ctx.day * 24 + ctx.hour : ctx.day);

/** Nobody may do violence to these: a companion of the player, someone the player is talking to, a quest-giver with a live quest, a child. */
export function isProtected(id: string, protect: ReadonlySet<string>): boolean {
  return protect.has(id);
}

/** Can a violent action be offered here at all: the flag, the cap on fights in this place today, one an hour. */
export function mayFight(ctx: Pick<ChoiceCtx, "violence" | "fights">): boolean {
  return ctx.violence && ctx.fights.place < MAX_FIGHTS_PER_PLACE_PER_DAY && ctx.fights.hour < MAX_FIGHTS_PER_HOUR;
}

/** The loop guard: the same non-habit action again and again costs more each time, and after MAX_RUN in a row it is not offered. */
export function loopPart(ctx: Pick<ChoiceCtx, "streak">, action: string): [string, number] | null {
  const s = ctx.streak;
  return s && s.action === action && s.n > 0 ? [`again (${s.n} in a row)`, -W.loop * s.n] : null;
}
export const looping = (ctx: Pick<ChoiceCtx, "streak">, action: string): boolean => ctx.streak?.action === action && ctx.streak.n >= MAX_RUN;

/** The violence setting as the config has it. */
export const violenceOn = (): boolean => config.choice.violence;

/** Offer an option only if the action is not cooling down, not looping and (if violent) a fight is allowed. */
export function allowed(def: ActionDef, ctx: ChoiceCtx): boolean {
  // "habit" keeps only what the schedule's own pick would be: the day goes exactly as it did before the menu.
  if (ctx.only?.includes("habit")) return !!def.habit?.includes(ctx.habit.activity);
  if (ctx.only && !ctx.only.includes(def.id)) return false;
  if (def.violent && !mayFight(ctx)) return false;
  if (!def.habit && looping(ctx, def.id)) return false;
  return !coolingDown(ctx, def, clockOf(ctx));
}

/** A score with the guard's own parts added: the damp for repeating a non-habit action. */
export function guarded(def: ActionDef, ctx: ChoiceCtx, o: Option, s: Scored): Scored {
  if (def.habit?.includes(ctx.habit.activity)) return s;
  const loop = loopPart(ctx, def.id);
  return loop ? scored(...s.parts, loop) : s;
}
