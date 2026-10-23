import { scored } from "../score.js";
import type { ActionDef, ChoiceCtx, Option, Other, Part } from "../types.js";
import { W } from "../weights.js";
import { goTo } from "./basic.js";

/**
 * Actions toward other people (N38): court, confront, insult, spread a rumour, recruit, and carry out a revenge. Each is offered once for each
 * person it could be done to, and scored from what the chooser holds against them, how they feel about them, and who they are.
 */
const other = (ctx: ChoiceCtx, o: Option): Other | undefined => ctx.present.find((p) => p.id === o.target) ?? ctx.absent.find((p) => p.id === o.target);

/** The parts that make a hostile act easier or harder for this person, against this one. */
export function nerve(ctx: ChoiceCtx, them: Other, share = 1): Part[] {
  const t = ctx.traits;
  const gap = Math.max(0, them.rank - ctx.rank);
  return [
    ["bold", (t.bravery - 0.5) * W.bold * share],
    ["hot temper", (t.temper - 0.5) * W.hot],
    [`${them.name} stands above them`, -W.rankFear * (1 - t.bravery) * gap * share],
    [`fear of ${them.name}`, -(them.fear / 100) * W.fearOfThem * 2],
    ["hunger sours", ctx.hunger * W.hungerSours],
    ctx.mood < 0 ? ["mood: anger", -ctx.mood * W.anger] : ["mood", 0],
  ];
}

const grudge = (them: Other, w: number): Part => [`grudge vs ${them.name}`, w * Math.min(1.5, them.hate)];
/** A rival for what they want (N40) is easier to have words with. */
const rivalry = (ctx: ChoiceCtx, them: Other): Part | null => (ctx.ambition?.rivals.includes(them.id) ? [`rival for ${ctx.ambition.kind.replace("_", " ")}`, W.rival * (0.4 + ctx.traits.ambition)] : null);

export const confront: ActionDef = {
  id: "confront",
  grain: "both",
  who: "both",
  available: (ctx) => ctx.present.filter((p) => p.hate >= 0.15).map((p) => ({ action: "confront", target: p.id, place: p.place })),
  score: (ctx, o) => {
    const them = other(ctx, o)!;
    return scored(grudge(them, W.grudge), rivalry(ctx, them), ...nerve(ctx, them));
  },
  apply: (ctx, o, why, host) => {
    const them = other(ctx, o)!;
    const publicly = ctx.present.length >= 3;
    host.deed({
      kind: "confrontation",
      interaction: them.rank > ctx.rank || publicly ? "humiliate" : "threaten",
      actor: ctx.who,
      target: them.id,
      details: `${ctx.name} had it out with ${them.name}`,
      importance: 3 + (them.rank > ctx.rank ? 1 : 0),
      why,
      // Having it out settles most of what they held (the other keeps a smaller grudge of their own, as with N37's revenge).
      settles: 0.7,
      grievance: 0.5 * Math.min(1, them.hate),
      witnesses: ctx.present.filter((p) => p.id !== them.id).map((p) => p.id),
    });
    return { ...goTo(ctx, them.place, `to have it out with ${them.name}`), intent: { kind: "confront", target: them.id } };
  },
};

export const insult: ActionDef = {
  id: "insult",
  grain: "both",
  who: "both",
  available: (ctx) => ctx.present.filter((p) => p.hate >= 0.1 || (ctx.mood <= -1.5 && ctx.traits.temper >= 0.65 && p.rank <= ctx.rank + 1)).map((p) => ({ action: "insult", target: p.id, place: p.place })),
  score: (ctx, o) => {
    const them = other(ctx, o)!;
    return scored(grudge(them, W.insultGrudge), rivalry(ctx, them), ...nerve(ctx, them, 0.5));
  },
  apply: (ctx, o, why, host) => {
    const them = other(ctx, o)!;
    host.deed({ kind: "affront", interaction: "insult", actor: ctx.who, target: them.id, details: `${ctx.name} insulted ${them.name}`, importance: 2, why, witnesses: ctx.present.filter((p) => p.id !== them.id).map((p) => p.id) });
    return { ...goTo(ctx, them.place, `to speak to ${them.name}`), intent: { kind: "insult", target: them.id } };
  },
};

export const revenge: ActionDef = {
  id: "revenge",
  grain: "hour",
  who: "both",
  cooldown: 0,
  available: (ctx) => (ctx.goal && ctx.present.some((p) => p.id === ctx.goal!.target) ? [{ action: "revenge", target: ctx.goal.target }] : []),
  score: (ctx, o) => {
    const them = other(ctx, o)!;
    const g = ctx.goal!;
    return scored([`revenge: ${g.reason}`, W.revenge * g.strength], grudge(them, 0.4), ...nerve(ctx, them, 0.6));
  },
  apply: (ctx, o, why, host) => {
    const them = other(ctx, o)!;
    const g = ctx.goal!;
    const base = { actor: ctx.who, target: them.id, why, ...(g.cause ? { causedBy: [g.cause] } : {}), settles: 1 } as const;
    switch (g.plan) {
      case "ambush":
        // Hired men are a violent act; without the setting the grudge is told to their face instead.
        if (ctx.violence) host.deed({ ...base, kind: "attacked", details: `${ctx.name} had men beat ${them.name} (${g.reason})`, importance: 5, onTarget: { fear: 15, trust: -12, affection: -10 }, grievance: 0.5 * 0.5 + 0.3, harm: 2 });
        else host.deed({ ...base, kind: "menace", interaction: "threaten", details: `${ctx.name} threatened ${them.name} over an old wrong`, importance: 3 });
        break;
      case "confront":
        host.deed({ ...base, kind: "confrontation", interaction: "humiliate", details: `${ctx.name} had it out with ${them.name} over an old wrong`, importance: 4, witnesses: ctx.present.map((p) => p.id).filter((id) => id !== them.id) });
        break;
      case "rumour":
        host.deed({ ...base, kind: "rumour", details: `${ctx.name} is telling folk ${them.name} is not to be trusted (it is not true)`, importance: 3, rumour: { text: `${them.name} is not to be trusted`, hearers: ctx.present.map((p) => p.id).filter((id) => id !== them.id) }, grievance: 0.2 });
        break;
      default:
        host.deed({ ...base, kind: "slight", interaction: "refuse_bow", details: `${ctx.name} will have nothing more to do with ${them.name}`, importance: 2 });
    }
    host.finishGoal(ctx.who);
    return { ...goTo(ctx, them.place, `to settle with ${them.name}`), intent: { kind: "revenge", target: them.id } };
  },
};

export const spreadRumour: ActionDef = {
  id: "spread_rumour",
  grain: "both",
  who: "both",
  available: (ctx) => (ctx.present.length >= 1 ? ctx.absent.filter((a) => a.hate >= 0.2).map((a) => ({ action: "spread_rumour", target: a.id })) : []),
  score: (ctx, o) => {
    const them = other(ctx, o)!;
    return scored(grudge(them, W.rumourHate), rivalry(ctx, them), ["dishonest", W.dishonest * (1 - ctx.traits.honesty)], ["sociable", 0.2 * ctx.traits.sociability], ["fear of being caught", -0.2 * ctx.traits.honesty]);
  },
  apply: (ctx, o, why, host) => {
    const them = other(ctx, o)!;
    host.deed({
      kind: "rumour",
      actor: ctx.who,
      target: them.id,
      details: `${ctx.name} is telling folk that ${them.name} is a cheat (it is not true)`,
      importance: 3,
      why,
      rumour: { text: `${them.name} is a cheat`, hearers: ctx.present.map((p) => p.id) },
      grievance: 0.2,
    });
    return { intent: { kind: "spread_rumour", target: them.id } };
  },
};

export const recruit: ActionDef = {
  id: "recruit",
  grain: "both",
  who: "both",
  available: (ctx) => (ctx.recruiter ? ctx.present.filter((p) => p.restless && !p.sameFaction && !p.protected).slice(0, 3).map((p) => ({ action: "recruit", target: p.id, place: p.place })) : []),
  score: (ctx, o) => {
    const them = other(ctx, o)!;
    return scored(["believes in the cause", W.recruit * (0.4 + 0.4 * ctx.traits.ambition)], ctx.ambition?.kind === "guild_seat" && ["a following in the guild", 0.15], [`${them.name} is restless`, 0.3], ["sociable", 0.2 * ctx.traits.sociability], [`${them.name} likes them`, (them.affection / 100) * 0.3], ["honest folk balk", -0.1 * ctx.traits.honesty]);
  },
  apply: (ctx, o, why, host) => {
    const them = other(ctx, o)!;
    host.deed({ kind: "recruited", actor: ctx.who, target: them.id, details: `${ctx.name} brought ${them.name} into their company`, importance: 3, why, recruit: true, onTarget: { trust: 3, affection: 2 } });
    return { ...goTo(ctx, them.place, `to talk to ${them.name}`), intent: { kind: "recruit", target: them.id } };
  },
};

export const court: ActionDef = {
  id: "court",
  grain: "both",
  who: "both",
  available: (ctx) => ctx.present.filter((p) => p.suitable && p.hate < 0.1 && p.affection >= 8).slice(0, 3).map((p) => ({ action: "court", target: p.id, place: p.place })),
  score: (ctx, o) => {
    const them = other(ctx, o)!;
    return scored([`warmth toward ${them.name}`, ((them.affection - 8) / 100) * W.affection + 0.05], ["spark", W.spark * ctx.traits.sociability], ctx.mood > 0 && ["good mood", 0.05 * ctx.mood]);
  },
  apply: (ctx, o, why, host) => {
    const them = other(ctx, o)!;
    host.deed({ kind: "courtship", actor: ctx.who, target: them.id, details: `${ctx.name} paid court to ${them.name}`, importance: 2, why, onTarget: { affection: 2, trust: 1 }, onActor: { affection: 1.5 } });
    return { ...goTo(ctx, them.place, `to see ${them.name}`), intent: { kind: "court", target: them.id } };
  },
};
