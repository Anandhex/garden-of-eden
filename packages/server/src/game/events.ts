import { z } from "zod";
import type { WorldSnapshot } from "../npc/types.js";

/**
 * The event log (N5, N12.1): everything meaningful that happens, written by code,
 * never parsed from the model's words. Memory (npc/memory.ts), emotions and the
 * journal are filled from the same hooks; gossip (game/gossip.ts), reputation
 * (game/reputation.ts) and the world director (director/) read the log.
 *
 * Each event knows who saw it (`witnesses`, set in code: awake and at the same
 * place) and who has heard of it since (`knownBy`, which grows through gossip).
 * Only those NPCs know it happened.
 */
export const EVENT_KINDS = [
  // The player and an NPC (N5)
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
  // The wider world (N7, N8, N12)
  "killed",
  "death",
  "subdued",
  "looted",
  "theft",
  "theft-caught",
  "crime",
  "fine-paid",
  "dilemma",
  "faction",
  "raid",
  "raid-repelled",
  "black-market",
  "npc-fight",
  "creature-fight",
  "trade",
  "injury",
  "illness",
  "succession",
  "hired",
  "companion-left",
  "message",
  "revenge",
  "rumour",
  "growth",
  // Families (N11.3)
  "courtship",
  "marriage",
  "expecting",
  "birth",
  "coming-of-age",
  // Townsfolk lives (N25)
  "migration",
  // Lives that change (N25b): what a life review changed, written to the person it changed (known to them alone)
  "changed-mind",
  "new-goal",
  "new-fear",
  "secret-made",
  "story-turn",
  // The open road (N26): a situation met on it, and what came of it later
  "road",
  // Chatter with consequences (N37): a snub or a refusal, an insult or a humiliation, a threat, an apology
  "slight",
  "affront",
  "menace",
  "apology",
] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

export interface GameEvent {
  id: string;
  day: number;
  hour: number;
  kind: EventKind;
  /** Who did it: "player", an NPC id or a creature uid. */
  actor: string;
  /** Who it was done to. */
  target: string;
  /** A short description for logs: what was said, bought or promised. */
  details: string;
  /** 1-10. Low-importance events are pruned first. */
  importance: number;
  /** Where it happened, if known (a description, "the forge"). */
  where?: string;
  /** The place id (game/schedule.ts), for witnesses. */
  place?: string;
  /** NPC ids who saw it happen (set in code). */
  witnesses?: string[];
  /** NPC ids who know of it: the witnesses, then whoever heard through gossip. */
  knownBy?: string[];
  /** The reason behind it, when a choice made it happen: who was picked and why, what the NPC wanted (N17). */
  why?: string;
  /** Earlier events (ids, or realm refs) that led to this one (N20 fills it). */
  causedBy?: string[];
  /** The settlement it happened in and its kingdom (N24's scopes). */
  site?: string;
  kingdom?: string;
}

/** For loading saves: a malformed event is dropped, not trusted. */
export const EventSchema = z.object({
  id: z.string().min(1),
  day: z.number().int(),
  hour: z.number().int().min(0).max(23),
  kind: z.enum(EVENT_KINDS),
  actor: z.string(),
  target: z.string(),
  details: z.string(),
  importance: z.number().min(0).max(10),
  where: z.string().optional(),
  place: z.string().optional(),
  witnesses: z.array(z.string()).optional(),
  knownBy: z.array(z.string()).optional(),
  why: z.string().optional(),
  causedBy: z.array(z.string()).optional(),
  site: z.string().optional(),
  kingdom: z.string().optional(),
});

/** Keep the valid events from a save. */
export function parseEvents(raw: unknown[] | undefined): GameEvent[] {
  return (raw ?? []).flatMap((e) => {
    const r = EventSchema.safeParse(e);
    return r.success ? [r.data as GameEvent] : [];
  });
}

/** Most events kept in a save. Past this, the least important (then oldest) go. (The database keeps them all: game/db.ts.) */
export const MAX_EVENTS = 300;

/** Listeners told of every new event (the long-term archive in game/db.ts). */
const listeners: Array<(e: GameEvent) => void> = [];
export function onEvent(listener: (e: GameEvent) => void): () => void {
  listeners.push(listener);
  return () => {
    const at = listeners.indexOf(listener);
    if (at >= 0) listeners.splice(at, 1);
  };
}

type EventWorld = Pick<WorldSnapshot, "day" | "hour" | "location"> & { events?: GameEvent[]; present?: string[]; player?: { place?: string }; nextEventSeq?: number };

/**
 * Add an event to the world's log and return it. Prunes the log past MAX_EVENTS.
 * Witnesses default to the NPCs present in the scene (world.present) plus the
 * target if it's an NPC: whoever was there saw it.
 */
export function recordEvent(
  world: EventWorld,
  event: Omit<GameEvent, "id" | "day" | "hour" | "where"> & { where?: string },
): GameEvent {
  const witnesses = event.witnesses ?? defaultWitnesses(world, event);
  const full: GameEvent = {
    // The sequence is in the save, so the same run gives the same ids (N18).
    id: `e${world.day}-${world.hour}-${(world.nextEventSeq = (world.nextEventSeq ?? 0) + 1)}`,
    day: world.day,
    hour: world.hour,
    where: event.where ?? world.location,
    ...event,
    ...(event.place ?? world.player?.place ? { place: event.place ?? world.player!.place } : {}),
    witnesses,
    knownBy: [...new Set([...(event.knownBy ?? []), ...witnesses])],
  };
  const log = (world.events ??= []);
  log.push(full);
  if (log.length > MAX_EVENTS) {
    // Drop the least important event, oldest first among equals.
    let drop = 0;
    for (let i = 1; i < log.length; i++) if (log[i]!.importance < log[drop]!.importance) drop = i;
    log.splice(drop, 1);
  }
  for (const l of listeners) l(full);
  return full;
}

/** Who saw it, when the caller doesn't say: the NPCs in the scene, and the NPC it was done to or by. */
function defaultWitnesses(world: EventWorld, event: Pick<GameEvent, "actor" | "target">): string[] {
  const npcIds = [event.actor, event.target].filter((x) => x !== "player" && !x.includes("-"));
  return [...new Set([...(world.present ?? []), ...npcIds])];
}

/** An NPC learns of an event (gossip). Returns true if it's news to them. */
export function learnEvent(event: GameEvent, npcId: string): boolean {
  const known = (event.knownBy ??= []);
  if (known.includes(npcId)) return false;
  known.push(npcId);
  return true;
}

/** Does this NPC know the event happened? */
export function knowsEvent(event: GameEvent, npcId: string): boolean {
  return (event.knownBy ?? event.witnesses ?? []).includes(npcId);
}

/** Events between the player and one NPC, newest last. */
export function eventsWith(world: { events?: GameEvent[] }, npcId: string): GameEvent[] {
  return (world.events ?? []).filter((e) => e.actor === npcId || e.target === npcId);
}

/** Events on one day, most important first. */
export function eventsOn(world: { events?: GameEvent[] }, day: number): GameEvent[] {
  return (world.events ?? []).filter((e) => e.day === day).sort((a, b) => b.importance - a.importance);
}
