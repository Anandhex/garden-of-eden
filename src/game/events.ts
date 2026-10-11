import type { WorldSnapshot } from "../npc/types.js";

/**
 * The event log (N5): everything meaningful that happens, written by code, never
 * parsed from the model's words. Memory (npc/memory.ts), emotions and the journal
 * are filled from the same hooks; gossip and the world director (N7, N12) can read
 * the log later.
 */
export const EVENT_KINDS = [
  "bought",
  "sold",
  "insulted",
  "complimented",
  "threatened",
  "attacked",
  "fled",
  "lied-to",
  "lie-spotted",
  "lie-found-out",
  "quest-done",
  "quest-failed",
  "gift",
  "secret-shared",
  "favour",
  "promise-kept",
  "promise-broken",
  "amends",
  "service",
  "commission",
] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

export interface GameEvent {
  id: string;
  day: number;
  hour: number;
  kind: EventKind;
  /** Who did it: "player" or an NPC id. */
  actor: string;
  /** Who it was done to. */
  target: string;
  /** A short description for logs: what was said, bought or promised. */
  details: string;
  /** 1-10. Low-importance events are pruned first. */
  importance: number;
  /** Where it happened, if known. */
  where?: string;
}

/** Most events kept in a save. Past this, the least important (then oldest) go. */
export const MAX_EVENTS = 300;

let counter = 0;

/** Add an event to the world's log and return it. Prunes the log past MAX_EVENTS. */
export function recordEvent(
  world: Pick<WorldSnapshot, "day" | "hour" | "location"> & { events?: GameEvent[] },
  event: Omit<GameEvent, "id" | "day" | "hour" | "where"> & { where?: string },
): GameEvent {
  const full: GameEvent = {
    id: `e${world.day}-${world.hour}-${++counter}`,
    day: world.day,
    hour: world.hour,
    where: event.where ?? world.location,
    ...event,
  };
  const log = (world.events ??= []);
  log.push(full);
  if (log.length > MAX_EVENTS) {
    // Drop the least important event, oldest first among equals.
    let drop = 0;
    for (let i = 1; i < log.length; i++) if (log[i]!.importance < log[drop]!.importance) drop = i;
    log.splice(drop, 1);
  }
  return full;
}

/** Events between the player and one NPC, newest last. */
export function eventsWith(world: { events?: GameEvent[] }, npcId: string): GameEvent[] {
  return (world.events ?? []).filter((e) => e.actor === npcId || e.target === npcId);
}
