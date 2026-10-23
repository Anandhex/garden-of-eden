import { scored } from "../score.js";
import type { PlaceId } from "../../schedule.js";
import type { ActionDef, Applied, ChoiceCtx, Part } from "../types.js";
import { W } from "../weights.js";
import { ambitionPart, urgentPart } from "./ambition.js";

/**
 * The everyday actions (N38): work, eat, rest, gossip, buy, sell. Each stands for something the schedule already does, so the schedule's own
 * pick gets the habit bonus and an ordinary person keeps their day; something else wins only when its score beats habit.
 */
export const habitPart = (ctx: ChoiceCtx, def: Pick<ActionDef, "habit">, label: string): Part | null =>
  def.habit?.includes(ctx.habit.activity) ? [`habit: ${label}${ctx.habit.why ? ` (${ctx.habit.why})` : ""}`, W.habit] : null;

/** A talker goes where the other one is (the hour's plan); a townsperson's whole day is one place, so nothing changes. */
export const goTo = (ctx: ChoiceCtx, place: PlaceId | undefined, why: string): Pick<Applied, "plan"> =>
  ctx.kind === "talker" && place && place !== "home" ? { plan: { activity: "socialise", place, why } } : {};

export const work: ActionDef = {
  id: "work",
  grain: "both",
  who: "both",
  habit: ["work"],
  available: (ctx) => [{ action: "work", place: ctx.habit.activity === "work" ? ctx.habit.place : ctx.workPlace }],
  score: (ctx) =>
    scored(
      habitPart(ctx, work, "work block"),
      ctx.broke && ["broke", W.broke],
      ["ambition", W.ambition * ctx.traits.ambition],
      // Working toward what they want: a trade's mastery, coin for land or wealth, the skill a knight needs.
      !!ctx.ambition && ["master_trade", "land", "wealth", "knighthood"].includes(ctx.ambition.kind) && ambitionPart(ctx, W.ambitionWork),
      urgentPart(ctx, "work"),
      ["hunger", -0.5 * ctx.hunger],
      ["tired", -0.4 * ctx.fatigue],
      ctx.storm && ["storm", -0.3],
      ctx.festival && ["festival", -W.festival],
    ),
  apply: (ctx, o) => ({ plan: { activity: "work", place: o.place ?? ctx.workPlace, why: "work" }, intent: { kind: "work" } }),
};

export const eat: ActionDef = {
  id: "eat",
  grain: "both",
  who: "both",
  habit: ["eat"],
  available: (ctx) => (ctx.hunger >= 0.3 || ctx.habit.activity === "eat" ? [{ action: "eat", place: ctx.habit.activity === "eat" ? ctx.habit.place : "home" }] : []),
  score: (ctx) => scored(habitPart(ctx, eat, "meal"), ["hunger", W.hunger * ctx.hunger]),
  apply: (_ctx, o) => ({ plan: { activity: "eat", place: o.place ?? "home", why: "hungry" }, intent: { kind: "eat" } }),
};

export const rest: ActionDef = {
  id: "rest",
  grain: "both",
  who: "both",
  habit: ["sleep", "socialise"],
  available: (ctx) => [{ action: "rest", place: ctx.habit.activity === "sleep" || ctx.habit.activity === "socialise" ? ctx.habit.place : "home" }],
  score: (ctx) =>
    scored(
      habitPart(ctx, rest, ctx.habit.activity === "sleep" ? "night's sleep" : "free hour"),
      ["tired", W.fatigue * ctx.fatigue],
      urgentPart(ctx, "rest"),
      ctx.storm && ["storm", 0.3],
      ctx.festival && ctx.habit.activity !== "sleep" && ["festival", -0.1],
    ),
  apply: (ctx, o) => ({
    plan: {
      activity: ctx.habit.activity === "sleep" || ctx.habit.activity === "socialise" ? ctx.habit.activity : ctx.hour >= 21 || ctx.hour < 6 || ctx.fatigue >= 0.85 ? "sleep" : "socialise",
      place: o.place ?? "home",
      why: "rest",
    },
    intent: { kind: "rest" },
  }),
};

export const gossip: ActionDef = {
  id: "gossip",
  grain: "both",
  who: "both",
  habit: undefined,
  available: (ctx) =>
    ctx.gatherings
      .filter((g) => g.place !== "home" && g.place !== ctx.habit.place && g.count >= 1)
      .slice(0, 2)
      .map((g) => ({ action: "gossip", place: g.place })),
  score: (ctx, o) => {
    const here = ctx.gatherings.find((g) => g.place === o.place)?.count ?? 0;
    return scored(
      ["sociable", W.social * ctx.traits.sociability],
      ["company", Math.min(here, W.crowdMax) * W.crowd],
      ctx.festival && ["festival", W.festival],
      ["hunger", -0.4 * ctx.hunger],
      urgentPart(ctx, "gossip"),
    );
  },
  apply: (_ctx, o) => ({ plan: { activity: "socialise", place: o.place ?? "square", why: "to talk" }, intent: { kind: "gossip", ...(o.place ? { place: o.place } : {}) } }),
};

export const buy: ActionDef = {
  id: "buy",
  grain: "hour",
  who: "talker",
  available: (ctx) => (ctx.broke || ctx.money <= 0 || (ctx.hunger < 0.5 && ctx.hour < 18) ? [] : ctx.present.some((p) => p.sells) ? [{ action: "buy", place: ctx.eatPlace }] : []),
  score: (ctx) => scored(["hunger", 0.8 * ctx.hunger - 0.2], ["coin to spend", 0.15 * Math.min(1, ctx.money / 400)], ["sociable", 0.15 * ctx.traits.sociability], ctx.hour >= 18 && ["an evening out", 0.15]),
  apply: (_ctx, o) => ({ plan: { activity: "eat", place: o.place ?? "inn", why: "to buy a meal" }, buy: true }),
};

export const sell: ActionDef = {
  id: "sell",
  grain: "hour",
  who: "talker",
  available: (ctx) => (ctx.stock > 0 ? [{ action: "sell", place: ctx.workPlace }] : []),
  score: (ctx) => scored(ctx.broke && ["broke", W.broke], ["goods to sell", Math.min(0.3, 0.05 * ctx.stock)], ["greed", 0.1 * ctx.traits.greed]),
  apply: (ctx, o) => ({ plan: { activity: "work", place: o.place ?? ctx.workPlace, why: "selling" }, sell: true }),
};
