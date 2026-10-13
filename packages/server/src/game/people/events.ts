import type { WorldStore } from "../db.js";
import { streamFor } from "../dice.js";
import type { EventKind, GameEvent } from "../events.js";
import type { Realm } from "../realm/types.js";

/**
 * Events of townsfolk lives (N25): births, deaths, marriages, moves. Written straight to the database's
 * event table (a day's step can make hundreds, which the save's short list of important events is not
 * for), with ids and hours that depend on nothing but who, what and when, so a day worked out later
 * writes exactly the rows it would have written on the day.
 */

/** The hour of the day something happened: drawn from a stream of its own, so asking never changes any outcome. */
export function hourFor(realm: Pick<Realm, "seed">, who: string, day: number, kind: string): number {
  return Math.floor(streamFor(realm.seed, "life-hour", who, day, kind)() * 24);
}

export interface LifeEventInput {
  kind: EventKind;
  /** Who did it or whom it happened to (a person id). */
  actor: string;
  /** The other person, or "". */
  target?: string;
  site: string;
  day: number;
  details: string;
  importance: number;
  /** Where the id is made from when `actor` alone isn't enough. */
  key?: string;
}

/** Make an event and write it. Returns it, with its hour, for the player's view of a place at full detail. */
export function recordLifeEvent(realm: Realm, store: Pick<WorldStore, "archiveEvent">, e: LifeEventInput): GameEvent {
  const hour = hourFor(realm, e.key ?? e.actor, e.day, e.kind);
  const kingdom = realm.settlements[e.site]?.kingdom ?? undefined;
  const event: GameEvent = {
    id: `l${e.day}-${hour}-${e.kind}-${e.key ?? e.actor}`,
    day: e.day,
    hour,
    kind: e.kind,
    actor: e.actor,
    target: e.target ?? "",
    details: e.details,
    importance: Math.max(0, Math.min(10, e.importance)),
    witnesses: [],
    knownBy: [],
    site: e.site,
    ...(kingdom ? { kingdom } : {}),
  };
  store.archiveEvent(event);
  return event;
}
