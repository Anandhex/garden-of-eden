import { CHAT_MINUTES, hashStr, markKey, type ChatterMark, type CrowdDay, type CrowdSim, type InteractionKind } from "@millbrook/shared";
import { config } from "../../config.js";
import { timed } from "../../metrics/timing.js";
import { streamFor } from "../dice.js";
import type { LifeCtx } from "../people/step.js";
import { applyInteraction } from "./apply.js";
import { courtesyWithoutRows, pickFor } from "./day.js";
import { HOSTILE, type Interaction } from "./types.js";

/**
 * The place the player is in (N37): the exchanges the player can see are the real ones. The server runs the same `CrowdSim.chats` the
 * browser does, for the same minute, so the pair the player watches talking is the pair that was picked; `pickInteraction` decides what
 * passed between them, it is applied (hours.ts → apply.ts), and the exchange is sent as a mark so the bubble matches. An hour is worked
 * out before it is lived (the crowd's places are a function of the clock), so the marks are ready when its minutes come.
 */
export const CROWD = {
  /** Minutes of a bucket evaluated per hour: every bucket for an hour at a time, a few for a long wait. */
  fullEvery: CHAT_MINUTES,
  sparseEvery: 15,
  /** Most chats considered in one bucket. */
  perBucket: 40,
  /** Tiles within which others see an exchange, and the most who do. */
  sight: 6,
  witnesses: 6,
} as const;

/**
 * The kinds that are not worth a mark: the default lines already say them (a greeting, a bow, news shared, an order), or they leave nothing
 * behind to see (a complaint, a compliment). Only an exchange that wronged someone, or put one right, is sent.
 */
const PLAIN = new Set<InteractionKind>(["greet", "bow", "share_news", "order", "complain", "flatter"]);

/**
 * Neighbours who stand together would otherwise quarrel every three minutes. Stateless, so a world loaded elsewhere gives the same hour:
 * in each window of `WINDOW` buckets (90 game minutes) a pair has `SLOTS` buckets, picked from who they are, in which a notable exchange can
 * happen; in the others they are polite.
 */
export const WINDOW = 30;
export const SLOTS = 4;
const mayQuarrel = (pair: string, k: number): boolean => {
  const w = Math.floor(k / WINDOW);
  const at = k % WINDOW;
  for (let i = 0; i < SLOTS; i++) if (hashStr(`${pair}|${w}|${i}`) % WINDOW === at) return true;
  return false;
};

export interface HourPlan {
  marks: ChatterMark[];
  /** The exchanges that change something, in the order they happen. */
  todo: Array<{ it: Interaction; slot: number }>;
  chats: number;
}

export interface HourResult {
  marks: ChatterMark[];
  chats: number;
  hostile: number;
}

/**
 * Work out one hour of the player's map without changing anything: which of the crowd's chats are more than courtesy, and what each does.
 * Reads only the stores as they stand and the clock, so working it out again (after a save is loaded elsewhere) gives the same hour; it is
 * applied when the hour has passed (`applyHour`). Exchanges of one hour do not see each other's effects.
 */
export function planHour(ctx: LifeCtx, site: string, day: number, hour: number, sim: CrowdSim, crowdDay: CrowdDay, opts: { sparse?: boolean } = {}): HourPlan {
  const out: HourPlan = { marks: [], todo: [], chats: 0 };
  if (!config.chatter) return out;
  const people = sim.roster.people;
  timed("chatter.plan", () => {
    const step = opts.sparse ? CROWD.sparseEvery : CROWD.fullEvery;
    for (let m = hour * 60; m < hour * 60 + 60; m += step) {
      const at = sim.all(day, m, crowdDay);
      const chats = sim.chats(day, m, crowdDay, at).slice(0, CROWD.perBucket);
      const k = Math.floor((day * 1440 + m) / CHAT_MINUTES);
      for (const c of chats) {
        const pa = people[c.a]!;
        const pb = people[c.b]!;
        const ra = ctx.store.people.get(pa.id);
        const rb = ctx.store.people.get(pb.id);
        // A person who is a talking NPC is not drawn in the crowd (they have a conversation of their own).
        if (!ra || !rb || ra.death !== null || rb.death !== null || ra.persona !== null || rb.persona !== null) continue;
        out.chats++;
        const pair = pa.id < pb.id ? `${pa.id}|${pb.id}` : `${pb.id}|${pa.id}`;
        if (!mayQuarrel(pair, k)) continue;
        const rng = streamFor(ctx.realm.seed, "chatter", site, day, "c", k, c.a < c.b ? pa.id : pb.id, c.a < c.b ? pb.id : pa.id);
        const near = onlookers(at, c.a, c.b, people.length);
        const picked = pickFor(ctx, ra, rb, day, rng, { witnesses: near.length, drink: false, bowing: c.bow });
        const hostile = HOSTILE.has(picked.kind);
        const witnesses = hostile ? near.slice(0, CROWD.witnesses).map((i) => people[i]!.id).sort() : [];
        const it: Interaction = { a: picked.actor.row.id, b: picked.target.row.id, kind: picked.kind, day, minute: m, site, witnesses };
        if (!courtesyWithoutRows(ctx, it)) out.todo.push({ it, slot: m });
        if (PLAIN.has(picked.kind)) continue;
        out.marks.push({ a: c.a, b: c.b, k, actor: picked.actor.row.id === pa.id ? c.a : c.b, kind: picked.kind });
      }
    }
  });
  return out;
}

/** The hour has passed: what was planned happens. Returns how many were hostile. */
export function applyHour(ctx: LifeCtx, plan: HourPlan): number {
  let hostile = 0;
  timed("chatter.hour", () => {
    ctx.store.social.transaction(() => {
      for (const { it, slot } of plan.todo) if (applyInteraction(ctx, it, slot) && HOSTILE.has(it.kind)) hostile++;
    });
  });
  return hostile;
}

/** Plan an hour and apply it at once (tests, and anything that does not live the hour). */
export function crowdHour(ctx: LifeCtx, site: string, day: number, hour: number, sim: CrowdSim, crowdDay: CrowdDay, opts: { sparse?: boolean } = {}): HourResult {
  const plan = planHour(ctx, site, day, hour, sim, crowdDay, opts);
  return { marks: plan.marks, chats: plan.chats, hostile: applyHour(ctx, plan) };
}

/** Who stands within sight of a pair, by roster index. */
function onlookers(at: ReturnType<CrowdSim["all"]>, a: number, b: number, n: number): number[] {
  const ca = at[a]!;
  const out: number[] = [];
  for (let i = 0; i < n && out.length < CROWD.witnesses * 4; i++) {
    if (i === a || i === b) continue;
    const p = at[i]!;
    if (!p.visible || p.inside !== undefined) continue;
    if (Math.abs(p.x - ca.x) <= CROWD.sight && Math.abs(p.y - ca.y) <= CROWD.sight) out.push(i);
  }
  return out;
}

/** A lookup for `CrowdSim.chats`. */
export function marksMap(marks: readonly ChatterMark[]): Map<string, ChatterMark> {
  return new Map(marks.map((m) => [markKey(m.a, m.b, m.k), m]));
}

