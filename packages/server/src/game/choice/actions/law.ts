import { scored } from "../score.js";
import type { ActionDef, ChoiceCtx, Option, Other } from "../types.js";

/**
 * False accusation (N48 decision 7), in the menu: someone with a grudge and little honesty goes to the watch and swears the one they hate
 * stole from them. It is a case; at its trial the accuser's word is thin, and an accusation found false is slander against them.
 */
const them = (ctx: ChoiceCtx, o: Option): Other | undefined => ctx.present.find((p) => p.id === o.target);

export const accuse: ActionDef = {
  id: "accuse",
  grain: "day",
  who: "townsfolk",
  available: (ctx) => (ctx.traits.honesty < 0.35 ? ctx.present.filter((p) => p.hate >= 0.6 && !p.protected).map((p) => ({ action: "accuse", target: p.id })) : []),
  score: (ctx, o) => {
    const t = them(ctx, o)!;
    return scored([`grudge vs ${t.name}`, Math.min(1.5, t.hate) * 0.6], ["dishonest", (0.35 - ctx.traits.honesty) * 1.2], [`${t.name} stands above them`, -Math.max(0, t.rank - ctx.rank) * 0.15], ["a lie before the law", -0.6]);
  },
  apply: (ctx, o, why, host) => {
    const t = them(ctx, o)!;
    host.deed({ kind: "accusation", actor: ctx.who, target: t.id, details: `${ctx.name} went to the watch and swore ${t.name} had robbed them`, importance: 3, why, onTarget: { trust: -25, affection: -15 }, grievance: 0.6 });
    return { intent: { kind: "accuse", target: t.id } };
  },
};
