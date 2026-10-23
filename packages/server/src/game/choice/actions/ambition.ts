import { scored } from "../score.js";
import type { ActionDef, ChoiceCtx, Option, Other, Part } from "../types.js";
import { W } from "../weights.js";
import { goTo } from "./basic.js";

/**
 * What ambition makes people do (N40): flatter whoever decides the seat they want, petition them outright, and go where there is a master to
 * learn from. Each is small an hour or a day; over years it is the regard that wins a guild's vote or a head's appointment (ambition/seats.ts).
 * The steps themselves (an exam passed, a shop opened, land bought) are code's events in the career day, not choices.
 */
const other = (ctx: ChoiceCtx, o: Option): Other | undefined => ctx.present.find((p) => p.id === o.target);

/**
 * The ambition's own part of a score: its kind, by how much they want things at all and how much they want this now (its strength). While
 * an urgent want lasts (hunger, grief, fighting) the ambition adds nothing: it waits.
 */
export const ambitionPart = (ctx: ChoiceCtx, w: number): Part | null =>
  ctx.ambition && !ctx.ambition.urgent ? [`ambition: ${ctx.ambition.kind.replace("_", " ")}`, w * (0.4 + ctx.traits.ambition) * (0.5 + ctx.ambition.strength)] : null;

/** What an urgent want adds to the everyday actions: work to get by, rest to grieve, staying in to keep safe. */
export function urgentPart(ctx: ChoiceCtx, action: "work" | "rest" | "gossip"): Part | null {
  const u = ctx.ambition?.urgent;
  if (!u) return null;
  if (u === "get_by" && action === "work") return ["urgent: getting by", 0.3];
  if (u === "grieve" && action === "rest") return ["grieving", 0.35];
  if (u === "grieve" && action === "gossip") return ["grieving", -0.2];
  if (u === "keep_safe" && action === "rest") return ["keeping safe", 0.25];
  return null;
}

const decides = (ctx: ChoiceCtx, id: string): boolean => !!ctx.ambition?.deciders.includes(id);

export const flatter: ActionDef = {
  id: "flatter",
  grain: "both",
  who: "both",
  // Someone with a say over what they want; else anyone with a seat, or well above them.
  available: (ctx) =>
    ctx.present
      .filter((p) => p.hate < 0.1 && (decides(ctx, p.id) || p.holdsSeat || p.rank >= ctx.rank + 2))
      .sort((a, b) => Number(decides(ctx, b.id)) - Number(decides(ctx, a.id)) || (a.id < b.id ? -1 : 1))
      .slice(0, 3)
      .map((p) => ({ action: "flatter", target: p.id, place: p.place })),
  score: (ctx, o) => {
    const them = other(ctx, o)!;
    return scored(
      ["currying favour", 0.1],
      decides(ctx, them.id) && ambitionPart(ctx, W.flatter * (ctx.ambition?.route === "favour" ? 1.5 : 1)),
      [`warmth toward ${them.name}`, (them.affection / 100) * 0.15],
      ["sociable", 0.15 * ctx.traits.sociability],
      ["honest folk balk", -0.12 * ctx.traits.honesty],
      ["hunger", -0.3 * ctx.hunger],
    );
  },
  apply: (ctx, o, why, host) => {
    const them = other(ctx, o)!;
    host.deed({ kind: "flattery", actor: ctx.who, target: them.id, details: `${ctx.name} paid ${them.name} compliments and a little court`, importance: 1, why, onTarget: { respect: 2, affection: 3, trust: 1 } });
    return { ...goTo(ctx, them.place, `to pay their respects to ${them.name}`), intent: { kind: "flatter", target: them.id } };
  },
};

export const petition: ActionDef = {
  id: "petition",
  grain: "both",
  who: "both",
  available: (ctx) => (ctx.ambition && !ctx.ambition.urgent && ctx.ambition.progress >= 0.5 ? ctx.present.filter((p) => decides(ctx, p.id) && p.hate < 0.2).slice(0, 2).map((p) => ({ action: "petition", target: p.id, place: p.place })) : []),
  score: (ctx, o) => {
    const them = other(ctx, o)!;
    return scored(ambitionPart(ctx, W.petition), ["nearly due", 0.2 * ctx.ambition!.progress], ["takes nerve", (ctx.traits.bravery - 0.5) * 0.3], [`${them.name} stands above them`, -0.04 * Math.max(0, them.rank - ctx.rank)]);
  },
  apply: (ctx, o, why, host) => {
    const them = other(ctx, o)!;
    // Heard out kindly, by how they feel about them; or sent away.
    const kindly = host.roll(`petition:${them.id}`) < 0.5 + 0.3 * (them.affection / 100) + 0.2 * (them.trust / 100);
    host.deed({
      kind: "petition",
      actor: ctx.who,
      target: them.id,
      details: kindly ? `${ctx.name} asked ${them.name} to think of them for what they want, and was heard out kindly` : `${ctx.name} asked ${them.name} to think of them for what they want, and was sent away`,
      importance: 1,
      why,
      ...(kindly ? { onTarget: { respect: 4, trust: 2 } } : { onTarget: { respect: -2 }, onActor: { affection: -3 } }),
    });
    return { ...goTo(ctx, them.place, `to ask a favour of ${them.name}`), intent: { kind: "petition", target: them.id } };
  },
};

export const seekMaster: ActionDef = {
  id: "seek_master",
  grain: "day",
  who: "townsfolk",
  available: (ctx) => (ctx.ambition?.needsMaster && !ctx.wantsToLeave ? [{ action: "seek_master" }] : []),
  score: (ctx) => scored(ambitionPart(ctx, W.seekMaster), ["no master to learn from here", 0.3], ["ties at home", -0.2 * ctx.traits.sociability]),
  apply: (ctx, _o, why, host) => {
    host.deed({ kind: "new-goal", actor: ctx.who, details: `${ctx.name} means to go where there is a master to learn the trade from`, importance: 2, why, leave: true });
    return { intent: { kind: "travel" } };
  },
};
