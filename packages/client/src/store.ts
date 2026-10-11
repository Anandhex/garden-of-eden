/**
 * Client state: the last snapshot from the server and what the page is doing. The
 * server owns every rule; nothing here decides what happens in the game.
 */
import type { GameEvent, Snapshot } from "@millbrook/shared";

export interface LogEntry {
  kind: string;
  text: string;
}

export const store = {
  state: null as Snapshot | null,
  /** NPC id of the open conversation. */
  talking: null as string | null,
  /** An action is in flight (a model reply may be streaming). */
  working: false,
  /** A step request is in flight. */
  moving: false,
  tab: "skills",
  logs: {} as Record<string, LogEntry[]>,
  /** Newest server news shown (null until the first state arrives). */
  lastNewsId: null as number | null,
  /** Seconds left to act in a fight, and when we heard. */
  fightClock: null as { left: number; tick: number; at: number } | null,
};

export const game = () => {
  if (!store.state) throw new Error("No game state yet.");
  return store.state;
};

/** What the world view listens to. */
export interface WorldHooks {
  /** A new snapshot: move actors to where the server says they are. */
  state(s: Snapshot): void;
  /** Something happened (T13): animate it. */
  event(e: GameEvent): void;
  /** An NPC is thinking (null text), filling the wait, or speaking. */
  speech(npc: string, text: string | null, opts?: { done?: boolean; filler?: boolean }): void;
}

const noop = () => {};
export const world: WorldHooks = { state: noop, event: noop, speech: noop };
