import { buy, eat, gossip, rest, sell, work } from "./actions/basic.js";
import { attack, steal, travel } from "./actions/risk.js";
import { confront, court, insult, recruit, revenge, spreadRumour } from "./actions/social.js";
import { flatter, petition, seekMaster } from "./actions/ambition.js";
import { allowed, guarded } from "./guards.js";
import { choose } from "./score.js";
import type { ActionDef, Applied, ChoiceCtx, ChoiceHost, ChoiceLog, Option, Ranked } from "./types.js";
import type { Rng } from "../dice.js";

/**
 * The action menu (N38). A phase that adds something people do adds an `ActionDef` in `actions/` and a line here; it does not add a loop of
 * its own. Order is the tie-break of equal scores, so keep new ones at the end.
 */
export const ACTIONS: readonly ActionDef[] = [work, eat, rest, gossip, buy, sell, court, confront, insult, revenge, spreadRumour, recruit, travel, steal, attack, flatter, petition, seekMaster];

export const actionById = (id: string): ActionDef | undefined => ACTIONS.find((a) => a.id === id);

/** The options a person has right now, scored, best first (ties by the action's place in the menu, then the target's id, so the order is always the same). */
export function menuFor(ctx: ChoiceCtx, actions: readonly ActionDef[] = ACTIONS): Ranked[] {
  const out: Array<Ranked & { at: number }> = [];
  actions.forEach((def, at) => {
    if (def.grain !== "both" && def.grain !== ctx.grain) return;
    if (def.who !== "both" && def.who !== (ctx.kind === "talker" ? "talker" : "townsfolk")) return;
    if (!allowed(def, ctx)) return;
    for (const o of def.available(ctx)) {
      const s = guarded(def, ctx, o, def.score(ctx, o));
      out.push({ ...o, ...s, at });
    }
  });
  out.sort((a, b) => b.score - a.score || a.at - b.at || (a.target ?? "").localeCompare(b.target ?? ""));
  return out.map(({ at: _at, ...r }) => r);
}

/** Is this option what their schedule already had them doing? */
export const isHabitOption = (ctx: Pick<ChoiceCtx, "habit">, o: Option): boolean => !!actionById(o.action)?.habit?.includes(ctx.habit.activity);

export interface Decision {
  log: ChoiceLog;
  picked: Ranked;
  /** What doing it asked of the hour; nothing when it was just the schedule's own pick. */
  applied: Applied | void;
}

/** Score the menu, pick by the person's own roll, and do what was picked. */
export function decide(ctx: ChoiceCtx, host: ChoiceHost, rng: Rng, actions: readonly ActionDef[] = ACTIONS): Decision | null {
  const options = menuFor(ctx, actions);
  if (options.length === 0) return null;
  const log = choose(ctx, options, rng, (o) => isHabitOption(ctx, o));
  const picked = options[log.picked]!;
  const def = actionById(picked.action)!;
  const applied = def.apply(ctx, picked, picked.parts, host);
  return { log, picked, applied };
}
