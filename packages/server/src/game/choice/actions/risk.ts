import { scored } from "../score.js";
import type { ActionDef, ChoiceCtx, Option, Other } from "../types.js";
import { W } from "../weights.js";
import { goTo } from "./basic.js";
import { nerve } from "./social.js";

/**
 * The actions that can hurt (N38): steal and attack are `violent`, so they are offered only with the violence setting on, and under the
 * caps (a place sees two a day, the player's place one an hour). A talker is never killed by one: a beaten talker is knocked senseless.
 * Travel is not violent; it is the wish to be elsewhere.
 */
const other = (ctx: ChoiceCtx, o: Option): Other => ctx.present.find((p) => p.id === o.target)!;

export const steal: ActionDef = {
  id: "steal",
  grain: "both",
  who: "both",
  violent: true,
  available: (ctx) => ctx.present.filter((p) => p.carries && !p.protected && p.rank <= ctx.rank + 2).slice(0, 3).map((p) => ({ action: "steal", target: p.id, place: p.place })),
  score: (ctx, o) => {
    const them = other(ctx, o);
    return scored(
      ["greed", W.greed * ctx.traits.greed],
      ["honest", -W.honest * ctx.traits.honesty],
      ctx.broke && ["broke", W.broke],
      ctx.present.length === 1 && ["nobody else about", W.opportunity],
      [`fear of ${them.name}`, -(them.fear / 100) * W.fearOfThem],
      ["bold", (ctx.traits.bravery - 0.5) * 0.3],
      ctx.hunger >= 0.7 && ["hunger", 0.4 * ctx.hunger],
    );
  },
  apply: (ctx, o, why, host) => {
    const them = other(ctx, o);
    const caught = host.roll(`steal:${them.id}`) < 0.25 + 0.35 * ctx.traits.honesty + (ctx.present.length - 1) * 0.1;
    if (caught)
      host.deed({ kind: "theft-caught", actor: ctx.who, target: them.id, details: `${ctx.name} was caught stealing from ${them.name}`, importance: 4, why, onTarget: { trust: -20, respect: -10 }, onActor: { respect: -3 }, grievance: 0.45, witnesses: ctx.present.map((p) => p.id) });
    else host.deed({ kind: "theft", actor: ctx.who, target: them.id, details: `${ctx.name} lifted something from ${them.name}`, importance: 3, why, coin: 30, grievance: 0.1 });
    return { ...goTo(ctx, them.place, `after ${them.name}`), intent: { kind: "steal", target: them.id } };
  },
};

export const attack: ActionDef = {
  id: "attack",
  grain: "both",
  who: "both",
  violent: true,
  available: (ctx) => ctx.present.filter((p) => p.hate >= 0.3 && !p.protected).slice(0, 3).map((p) => ({ action: "attack", target: p.id, place: p.place })),
  score: (ctx, o) => {
    const them = other(ctx, o);
    return scored([`grudge vs ${them.name}`, W.violence * Math.min(1.5, them.hate)], ...nerve(ctx, them, 1.5), ["it would end in blows", (ctx.traits.temper - 0.5) * 0.4]);
  },
  apply: (ctx, o, why, host) => {
    const them = other(ctx, o);
    const edge = 0.5 + 0.25 * (ctx.traits.bravery - 0.5) + 0.05 * (ctx.rank - them.rank);
    const won = host.roll(`attack:${them.id}`) < Math.max(0.15, Math.min(0.85, edge));
    host.deed({
      kind: "attacked",
      actor: ctx.who,
      target: them.id,
      details: `${ctx.name} and ${them.name} came to blows; ${won ? them.name : ctx.name} came off worse`,
      importance: 5,
      why,
      onTarget: { fear: 12, trust: -15, affection: -12 },
      grievance: won ? 0.5 : 0.2,
      settles: won ? 0.6 : 0.2,
      harm: 2,
      knockOut: true,
      ...(won ? {} : { lost: true }),
      witnesses: ctx.present.map((p) => p.id).filter((id) => id !== them.id),
    });
    return { ...goTo(ctx, them.place, `after ${them.name}`), intent: { kind: "attack", target: them.id } };
  },
};

export const travel: ActionDef = {
  id: "travel",
  grain: "day",
  who: "townsfolk",
  available: (ctx) => (ctx.wantsToLeave ? [{ action: "travel" }] : []),
  score: (ctx) => scored(["wants to be elsewhere", W.leave], ["ambition", 0.2 * ctx.traits.ambition], ["bold", (ctx.traits.bravery - 0.5) * 0.2], ctx.mood < 0 && ["unhappy here", -ctx.mood * 0.1]),
  apply: (ctx, _o, why, host) => {
    host.deed({ kind: "changed-mind", actor: ctx.who, details: `${ctx.name} means to leave`, importance: 2, why, leave: true });
    return { intent: { kind: "travel" } };
  },
};
