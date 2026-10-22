import type { KnowledgeRow } from "../../store/knowledgeStore.js";
import { streamFor, type Rng } from "../dice.js";
import type { LifeCtx } from "../people/step.js";
import { MIN_ACCURACY } from "../rumours.js";
import { fieldsOf, variantOf, type Field } from "./describe.js";
import { importanceOf, placeOfRef } from "./refs.js";

/**
 * What a person knows (N33): adding, ranking and forgetting. A person holds at most KNOWLEDGE_CAP items; when a new one would be the
 * 25th, the least worth keeping (importance × how recently they heard it) is forgotten.
 */
export const KNOWLEDGE_CAP = 24;
/** Accuracy lost each time townsfolk pass something on (the talkers' own rumours lose RETELL_LOSS, 0.2: game/rumours.ts). Believing the teller costs a little more. */
export const GOSSIP_LOSS = 0.1;
/** Days over which something loses half its interest. */
const HALF_LIFE = 8;

export { MIN_ACCURACY };

/** How worth telling a thing is, to someone: weighty, fresh, and (a bonus) about the listener's own place. */
export function tellable(ctx: LifeCtx, row: Pick<KnowledgeRow, "ref" | "learned_day">, day: number, listenerSite?: string): number {
  const imp = cachedImportance(ctx, row.ref);
  if (imp <= 0) return 0;
  const fresh = 1 / (1 + Math.max(0, day - row.learned_day) / HALF_LIFE);
  const near = listenerSite && placeOfRef(ctx, row.ref) === listenerSite ? 1.3 : 1;
  return imp * fresh * near;
}

const importances = new WeakMap<object, Map<string, number>>();
function cachedImportance(ctx: LifeCtx, ref: string): number {
  let m = importances.get(ctx.store);
  if (!m || m.size > 20000) importances.set(ctx.store, (m = new Map()));
  let v = m.get(ref);
  if (v === undefined) {
    v = importanceOf(ctx, ref);
    // Weight that cannot be worked out yet (a person not saved yet) is asked again.
    if (v > 0) m.set(ref, v);
  }
  return v;
}

/** Below this a thing is stale news: nobody brings it up. */
export const TELL_MIN = 2;
/** People forget what they heard this long ago, whether or not they tell it. */
export const FORGET_DAYS = 40;
/** People tell what they heard lately: something heard this long ago has been said already. */
export const TELL_WINDOW = 6;
/** How much a listener cares to take something in: a small matter is often shrugged off, a big one never. */
export const interestIn = (worth: number): number => Math.max(0.15, Math.min(1, worth / 5));

/** A person's rows, as they stood on a day, most worth telling first. */
export function tellables(ctx: LifeCtx, who: string, day: number, listenerSite?: string): KnowledgeRow[] {
  const held = ctx.store.knowledge.rowsOf(who);
  // Old things are forgotten.
  if (held.some((r) => r.learned_day < day - FORGET_DAYS)) for (const r of [...held]) if (r.learned_day < day - FORGET_DAYS) ctx.store.knowledge.remove(who, r.ref);
  return [...ctx.store.knowledge.rowsOf(who)]
    .filter((r) => r.learned_day <= day && r.learned_day >= day - TELL_WINDOW && r.accuracy >= MIN_ACCURACY)
    .map((r) => [r, tellable(ctx, r, day, listenerSite)] as const)
    .filter(([, t]) => t >= TELL_MIN)
    .sort((a, b) => b[1] - a[1] || (a[0].ref < b[0].ref ? -1 : 1))
    .map(([r]) => r);
}

export interface Learned {
  day: number;
  source: string;
  accuracy: number;
  variant?: number;
}

/**
 * Someone learns a thing. A row they already have is kept unless this version is more accurate (then the version changes, not who
 * first told them or when). Returns true if they now know it
 * (or know it better), false if they had it as well or forgot it at once because they hold too much that matters more.
 */
export function learn(ctx: LifeCtx, who: string, ref: string, o: Learned): boolean {
  const k = ctx.store.knowledge;
  const had = k.get(who, ref);
  if (had && had.accuracy >= o.accuracy) return false;
  k.put({ who, ref, learned_day: had?.learned_day ?? o.day, source: had?.source ?? o.source, accuracy: Math.round(o.accuracy * 100) / 100, variant: o.variant ?? 0 });
  // Only what they knew by this day counts toward what they can hold: a place caught up late already has the rows of later days (news a
  // traveller brought on day 13 when day 11 is being worked out), and they must not decide what is forgotten on day 11.
  const rows = [...k.rowsOf(who)].filter((r) => r.learned_day <= o.day);
  if (!had && rows.length > KNOWLEDGE_CAP) {
    let worst = rows[0]!;
    let low = Infinity;
    for (const r of rows) {
      const t = tellable(ctx, r, o.day);
      if (t < low || (t === low && (r.learned_day < worst.learned_day || (r.learned_day === worst.learned_day && r.ref < worst.ref)))) {
        low = t;
        worst = r;
      }
    }
    k.remove(who, worst.ref);
    if (worst.ref === ref) return false;
  }
  return true;
}

/**
 * The version a listener ends up with after a teller passes something on: a little less accurate (and less still if they doubt the
 * teller), and with a chance of `1 − accuracy` that one detail comes out changed. A change the teller made stays.
 */
export function retell(ctx: LifeCtx, row: Pick<KnowledgeRow, "ref" | "accuracy" | "variant">, listener: string, day: number, credence: number, rng?: Rng): { accuracy: number; variant: number } | null {
  const accuracy = row.accuracy * (1 - GOSSIP_LOSS) * credence;
  if (accuracy < MIN_ACCURACY) return null;
  let variant = row.variant;
  if (variant === 0) {
    const roll = rng ?? streamFor(ctx.realm.seed, "gossip", listener, row.ref, day);
    if (roll() < 1 - row.accuracy) {
      const fields = fieldsOf(ctx, row.ref);
      if (fields.length > 0) variant = variantOf(fields[Math.floor(roll() * fields.length)] as Field, Math.floor(roll() * 16));
    }
  }
  return { accuracy, variant };
}
