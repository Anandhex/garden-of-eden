import { config } from "../../config.js";
import type { PersonRow } from "../../store/peopleStore.js";
import { addGrievance, hateOn } from "../chatter/grievance.js";
import { temperOf } from "../chatter/person.js";
import { thresholdOf } from "../chatter/revenge.js";
import { outlookOf } from "../people/outlook.js";
import type { LifeCtx } from "../people/step.js";

/**
 * The drama manager (N20 step 6). It only touches what is already in motion: **threads**, things with a progress and a threshold that
 * code already tracks. When the player's place has been quiet for DRAMA.quietDays (nothing of importance DRAMA.loud or more there), it
 * picks the thread nearest its threshold and nudges it once, so the system then acts by its own rules. It never makes an event or a
 * thread. At most one nudge every DRAMA.everyDays; every nudge is logged with its reason in `drama_log`, and has a ref (`dr:<id>`) so what
 * follows is caused by it.
 *
 * Threads now: grudges (the hatred one person holds against another, toward what they can bear before they want revenge: N37). N38 adds
 * plans, N56 grievances of the many; packs and caravans join when their counts are rows to nudge.
 *
 * Off until N38 (`DRAMA=on` turns it on early, as the tests do).
 */
export const DRAMA = {
  quietDays: 2,
  everyDays: 3,
  loud: 5,
  /** The most a grudge is hurried by in one nudge. */
  nudgeMax: 0.35,
} as const;

export interface Thread {
  id: string;
  kind: "grudge";
  /** How far along it is, and where it acts. */
  progress: number;
  threshold: number;
  site: string;
  words: string;
  hurry(day: number, ref: string): void;
}

/** The grudges of a place: who holds what against whom, and how far that is from wanting revenge. */
export function grudgeThreads(ctx: LifeCtx, site: string, day: number): Thread[] {
  const { store } = ctx;
  const pairs = new Map<string, { who: string; against: string }>();
  for (const g of store.social.openAt(site)) pairs.set(`${g.who}>${g.against}`, { who: g.who, against: g.against });
  const out: Thread[] = [];
  for (const [id, { who, against }] of [...pairs].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const me = store.people.get(who);
    const them = store.people.get(against);
    if (!me || !them || me.death !== null || them.death !== null || me.away || them.away || me.site !== site || them.site !== site || me.job === "child") continue;
    // Someone who already wants revenge (or something else) is in motion on their own.
    if (outlookOf(me as PersonRow).goal) continue;
    const progress = hateOn(store, who, against, day);
    const threshold = thresholdOf(temperOf(me as PersonRow));
    if (progress >= threshold) continue;
    out.push({
      id: `grudge:${id}`,
      kind: "grudge",
      progress,
      threshold,
      site,
      words: `${me.name}'s grudge against ${them.name} is ${(threshold - progress).toFixed(2)} short of revenge`,
      hurry: (d, ref) => void addGrievance(store, { who, against, cause: ref, weight: Math.min(DRAMA.nudgeMax, threshold - progress + 0.02), day: d }),
    });
  }
  return out;
}

export interface Nudge {
  id: string;
  day: number;
  thread: string;
  action: string;
  reason: string;
}

/** One day of the drama manager for the player's place. Returns the nudge made, or null. */
export function dramaDay(ctx: LifeCtx, site: string | undefined, day: number): Nudge | null {
  if (!config.drama || !site || !ctx.realm.settlements[site]) return null;
  const { store } = ctx;
  const last = store.sql("SELECT MAX(day) AS d FROM drama_log").get() as { d: number | null };
  if (last.d !== null && day - last.d < DRAMA.everyDays) return null;
  const loud = store.sql("SELECT COUNT(*) AS n FROM events WHERE site = ? AND day > ? AND day <= ? AND importance >= ?").get(site, day - DRAMA.quietDays, day, DRAMA.loud) as { n: number };
  if (Number(loud.n) > 0) return null;
  const threads = grudgeThreads(ctx, site, day).sort((a, b) => a.threshold - a.progress - (b.threshold - b.progress) || (a.id < b.id ? -1 : 1));
  const t = threads[0];
  if (!t) return null;
  const id = `dr${day}-${t.id}`;
  const name = ctx.realm.settlements[site]!.name;
  const nudge: Nudge = { id, day, thread: t.id, action: "hurry", reason: `quiet for ${DRAMA.quietDays} days in ${name}; ${t.words}` };
  t.hurry(day, `dr:${id}`);
  store.sql("INSERT OR IGNORE INTO drama_log (id, day, thread, action, reason) VALUES (?, ?, ?, ?, ?)").run(nudge.id, nudge.day, nudge.thread, nudge.action, nudge.reason);
  return nudge;
}

export function dramaLog(store: LifeCtx["store"], limit = 50): Nudge[] {
  return store.sql("SELECT id, day, thread, action, reason FROM drama_log ORDER BY day DESC, id LIMIT ?").all(limit) as unknown as Nudge[];
}
