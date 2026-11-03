import { scored } from "../score.js";
import type { ActionDef, ChoiceCtx, KnownSecret, Option, Other } from "../types.js";
import { nerve } from "./social.js";

/**
 * Using a secret (N46 decision 5), in the action menu: **blackmail** (a demand for silence, scored by greed, low honesty, how bad the secret
 * is and how much the one it's about has to lose, against fear of them) and **expose** (tell it to everyone: scored by a grudge against
 * them, honesty, and nerve). Keeping a secret is the default: neither is picked unless it beats the day as it would go. The deed is an
 * event that names the secret (`causedBy`); what follows it (the demand, the answer, the exposure's consequences) is game/secrets/use.ts.
 */
const secretOf = (ctx: ChoiceCtx, o: Option): KnownSecret | undefined => ctx.secrets?.find((s) => s.id === o.item);
const them = (ctx: ChoiceCtx, id: string): Other | undefined => ctx.present.find((p) => p.id === id) ?? ctx.absent.find((p) => p.id === id);

export const blackmail: ActionDef = {
  id: "blackmail",
  grain: "day",
  who: "townsfolk",
  available: (ctx) => (ctx.secrets ?? []).filter((s) => !s.demanding && them(ctx, s.about)).map((s) => ({ action: "blackmail", target: s.about, item: s.id })),
  score: (ctx, o) => {
    const s = secretOf(ctx, o)!;
    const t = them(ctx, s.about)!;
    const t0 = ctx.traits;
    return scored(
      ["greed", (t0.greed - 0.4) * 0.9],
      ["dishonest", (0.5 - t0.honesty) * 0.8],
      [`what it would cost ${t.name}`, (s.weight / 10) * 0.6],
      [`${t.name} has more to lose`, Math.max(0, t.rank - ctx.rank) * 0.12],
      [`grudge vs ${t.name}`, Math.min(1.5, t.hate) * 0.3],
      ...nerve(ctx, t, 0.6),
      ["it's a dangerous game", -0.55],
    );
  },
  apply: (ctx, o, why, host) => {
    const s = secretOf(ctx, o)!;
    const t = them(ctx, s.about)!;
    host.deed({ kind: "blackmail", actor: ctx.who, target: t.id, details: `${ctx.name} told ${t.name} what they know, and named a price for keeping quiet`, importance: 3, why, causedBy: [s.id], onTarget: { fear: 12, affection: -25, trust: -20 }, grievance: 0.5 });
    return { intent: { kind: "blackmail", target: t.id } };
  },
};

export const expose: ActionDef = {
  id: "expose",
  grain: "day",
  who: "townsfolk",
  available: (ctx) => (ctx.secrets ?? []).filter((s) => them(ctx, s.about)).map((s) => ({ action: "expose", target: s.about, item: s.id })),
  score: (ctx, o) => {
    const s = secretOf(ctx, o)!;
    const t = them(ctx, s.about)!;
    const t0 = ctx.traits;
    return scored(
      [`grudge vs ${t.name}`, Math.min(1.5, t.hate) * 0.7],
      ["honest", (t0.honesty - 0.5) * 0.4],
      ["a loose tongue", (t0.sociability - 0.5) * 0.3],
      [s.demanding ? `${t.name} refused to pay` : "nothing to gain by it", s.demanding ? 0.2 : -0.2],
      ...nerve(ctx, t, 0.5),
      ["it can't be unsaid", -0.5],
    );
  },
  apply: (ctx, o, why, host) => {
    const s = secretOf(ctx, o)!;
    const t = them(ctx, s.about)!;
    host.deed({ kind: "exposure", actor: ctx.who, target: t.id, details: `${ctx.name} told everyone: ${s.text}`, importance: Math.min(9, 3 + Math.ceil(s.weight / 2)), why, causedBy: [s.id], onTarget: { affection: -30, trust: -10 }, grievance: 0.7, witnesses: ctx.present.filter((p) => p.id !== t.id).map((p) => p.id) });
    return { intent: { kind: "expose", target: t.id } };
  },
};
