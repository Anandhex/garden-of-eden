import { scored } from "../score.js";
import type { ActionDef, ChoiceCtx } from "../types.js";
import { W } from "../weights.js";
import { goTo } from "./basic.js";

/**
 * Leisure in the menu (N41 decision 4): an evening's game at the inn (`play`, betting and maybe cheating), entering a festival's contests
 * (`compete`), and the festival dancing (`dance`). Chosen like anything else: free hours, coin, sociability, temper and the place's mood
 * for a game; pride, nerve and wanting a name for a contest. Where it is played out is game/leisure/ (tavern.ts, contests.ts): this only
 * sends them there and says why.
 */
const evening = (ctx: ChoiceCtx) => ctx.grain === "day" || (ctx.hour >= 18 && ctx.hour <= 23);

export const play: ActionDef = {
  id: "play",
  grain: "both",
  who: "both",
  available: (ctx) => (evening(ctx) && !ctx.storm && ctx.rank >= 1 && ctx.rank <= 5 && !ctx.broke ? [{ action: "play", place: "inn" }] : []),
  score: (ctx) =>
    scored(
      ["sociable", W.play * ctx.traits.sociability],
      ["a gambler's itch", W.gamble * (1 - ctx.traits.honesty) * ctx.traits.greed],
      ["hot temper", 0.15 * ctx.traits.temper],
      ctx.money > 50 ? ["coin to stake", W.coin * 0.5] : ["little coin", -0.1],
      ctx.mood < -1 ? ["low spirits", -0.1 * -ctx.mood] : ["in good spirits", 0.04 * ctx.mood],
      ["tired", -0.3 * ctx.fatigue],
      ["hungry", -0.4 * ctx.hunger],
    ),
  apply: (ctx) => ({ ...goTo(ctx, "inn", "for a game at the inn"), intent: { kind: "play", place: "inn" } }),
};

export const compete: ActionDef = {
  id: "compete",
  grain: "both",
  who: "both",
  available: (ctx) => (ctx.festival && (ctx.grain === "day" || (ctx.hour >= 10 && ctx.hour <= 15)) ? [{ action: "compete", place: "square" }] : []),
  score: (ctx) => scored(["nerve", W.compete * ctx.traits.bravery], ["wants a name", W.compete * 0.6 * ctx.traits.ambition], ctx.ambition?.kind === "knighthood" ? ["a knighthood to win", 0.2] : null, ["tired", -0.3 * ctx.fatigue], ["festival", W.festival * 0.5]),
  apply: (ctx) => ({ ...goTo(ctx, "square", "to try their hand at the contests"), intent: { kind: "compete", place: "square" } }),
};

export const dance: ActionDef = {
  id: "dance",
  grain: "both",
  who: "both",
  available: (ctx) => (ctx.festival && (ctx.grain === "day" || ctx.hour >= 19) ? [{ action: "dance", place: "square" }] : []),
  score: (ctx) => scored(["sociable", W.play * ctx.traits.sociability], ["festival", W.festival], ["tired", -0.4 * ctx.fatigue], ctx.mood < -1 ? ["grieving", -0.15 * -ctx.mood] : null),
  apply: (ctx) => ({ ...goTo(ctx, "square", "for the festival dancing"), intent: { kind: "dance", place: "square" } }),
};
