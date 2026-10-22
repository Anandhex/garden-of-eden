import type { Rng } from "../dice.js";
import type { ChoiceCtx, ChoiceLog, Option, Part, Ranked, Scored, Temperament } from "./types.js";
import { TEMPERATURE } from "./weights.js";

const round = (n: number) => Math.round(n * 1000) / 1000;

/** A score from its named parts. Parts of zero are left out, so the reason lists only what mattered. */
export function scored(...parts: Array<Part | null | false>): Scored {
  const kept = parts.filter((p): p is Part => !!p && Math.abs(p[1]) >= 0.005).map(([label, v]): Part => [label, round(v)]);
  return { score: round(kept.reduce((s, [, v]) => s + v, 0)), parts: kept };
}

/** How reckless a person is, 0..1: bravery and temper make it, caution (the lack of bravery) takes it away. */
export function recklessness(t: Pick<Temperament, "bravery" | "temper">): number {
  return Math.max(0, Math.min(1, 0.6 * t.bravery + 0.4 * t.temper));
}

/** The softmax temperature: T≈0.05 for the cautious (nearly always the top score), up to ≈0.55 for the reckless. */
export function temperatureOf(t: Pick<Temperament, "bravery" | "temper">): number {
  return round(TEMPERATURE.base + TEMPERATURE.spread * recklessness(t) ** 2);
}

/** Softmax weights of the scores at temperature T (the top score is subtracted first so nothing overflows). */
export function weights(scores: readonly number[], T: number): number[] {
  const top = Math.max(...scores);
  const raw = scores.map((s) => Math.exp((s - top) / T));
  const sum = raw.reduce((a, b) => a + b, 0);
  return raw.map((w) => w / sum);
}

/** Pick an index by a weighted roll. `roll` is in [0, 1). */
export function pickIndex(ws: readonly number[], roll: number): number {
  let acc = 0;
  for (let i = 0; i < ws.length; i++) {
    acc += ws[i]!;
    if (roll < acc) return i;
  }
  return ws.length - 1;
}

/** Choose among scored options: the weighted roll, from the person's own stream. Returns the log of the choice. */
export function choose(ctx: Pick<ChoiceCtx, "who" | "name" | "day" | "hour" | "grain" | "traits">, options: readonly Ranked[], rng: Rng, isHabit: (o: Ranked) => boolean): ChoiceLog {
  const T = temperatureOf(ctx.traits);
  const roll = rng();
  const picked = pickIndex(weights(options.map((o) => o.score), T), roll);
  return { who: ctx.who, name: ctx.name, day: ctx.day, hour: ctx.hour, grain: ctx.grain, options: [...options], picked, T, roll: round(roll), habit: isHabit(options[picked]!) };
}

/** The top three parts of a score by size, as the reason in words: "grudge vs Odo 0.9, bold 0.3, habit: work block −0.0". */
export function reasonOf(parts: readonly Part[], n = 3): string {
  return [...parts]
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]) || (a[0] < b[0] ? -1 : 1))
    .slice(0, n)
    .map(([l, v]) => `${l} ${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(2)}`)
    .join(", ");
}

/** The same option twice. */
export const sameOption = (a: Option, b: Option): boolean => a.action === b.action && a.target === b.target && a.place === b.place && a.item === b.item;
