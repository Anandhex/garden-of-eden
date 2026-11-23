import type { WorldStore } from "../db.js";
import type { GameEvent } from "../events.js";
import type { Realm } from "../realm/types.js";
import type { KnownEntry } from "../../npc/types.js";

/**
 * Liveness metrics (N20 step 5): how alive a day was, from the events table. Stored in `metrics_daily`; the long simulation prints their
 * averages (N22), the admin view the last days.
 */
export interface Liveness {
  day: number;
  /** Distinct (actor, kind) pairs that day: how many different things were done by whom. */
  distinctActions: number;
  /** Stories longer than 3 that grew that day. */
  storiesGrew: number;
  /** Events about named people (realm figures of renown 25 or more): their lives moving. */
  namedMoved: number;
  /** Things that reached the player that day: events they saw or know of, news learned (N24). */
  reachedPlayer: number;
  /** Hours of the day with nothing of importance 4 or more where the player is (24 when nobody watches). */
  quietHours: number;
  /** Events of the day, all told. */
  events: number;
}

export const NAMED_RENOWN = 25;

export function livenessFor(
  realm: Pick<Realm, "figures">,
  store: Pick<WorldStore, "eventsOfDay" | "sql">,
  day: number,
  player?: { site?: string; known?: Record<string, KnownEntry> },
  dayEvents?: GameEvent[],
): Liveness {
  const evs = dayEvents ?? store.eventsOfDay(day);
  const pairs = new Set(evs.map((e) => `${e.actor}\u0000${e.kind}`));
  const named = evs.filter((e) => [e.actor, e.target].some((p) => (realm.figures[p]?.renown ?? 0) >= NAMED_RENOWN)).length;
  const grew = Number((store.sql("SELECT COUNT(*) AS n FROM stories WHERE last_day = ? AND json_array_length(json_extract(data, '$.refs')) > 3").get(day) as { n: number }).n);
  const learned = Object.values(player?.known ?? {}).filter((k) => k.day === day).length;
  const saw = evs.filter((e) => e.actor === "player" || e.target === "player" || e.knownBy?.includes("player")).length;
  const loud = new Set(player?.site ? evs.filter((e) => e.site === player.site && e.importance >= 4).map((e) => e.hour) : []);
  return { day, distinctActions: pairs.size, storiesGrew: grew, namedMoved: named, reachedPlayer: learned + saw, quietHours: 24 - loud.size, events: evs.length };
}

export function saveLiveness(store: Pick<WorldStore, "sql">, m: Liveness): void {
  store.sql("INSERT INTO metrics_daily (day, data) VALUES (?, ?) ON CONFLICT(day) DO UPDATE SET data = excluded.data").run(m.day, JSON.stringify(m));
}

/** The stored days, oldest first (the last `n`). */
export function livenessDays(store: Pick<WorldStore, "sql">, n = 30): Liveness[] {
  return (store.sql("SELECT data FROM (SELECT day, data FROM metrics_daily ORDER BY day DESC LIMIT ?) ORDER BY day").all(n) as Array<{ data: string }>).map((r) => JSON.parse(r.data) as Liveness);
}

/** Averages over stored days (the long simulation's report). */
export function livenessAverages(days: Liveness[]): Omit<Liveness, "day"> & { days: number } {
  const keys = ["distinctActions", "storiesGrew", "namedMoved", "reachedPlayer", "quietHours", "events"] as const;
  const out = { days: days.length } as Omit<Liveness, "day"> & { days: number };
  for (const k of keys) out[k] = days.length ? Math.round((days.reduce((t, d) => t + d[k], 0) / days.length) * 10) / 10 : 0;
  return out;
}
