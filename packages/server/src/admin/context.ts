import type { WorldStore } from "../game/db.js";
import type { SavedWorld } from "../game/save.js";
import type { Town } from "../game/town.js";

/**
 * What the admin view reads (N17). Functions, not values: the server replaces `world`
 * and `town` on a new game, so nothing here may hold on to one.
 *
 * Everything under `admin/` is read-only: it takes this and returns plain data. It must
 * not write to the world, and so must not call helpers that fill in missing fields on
 * read (`familyOf`, `world.events ??= []`): the hash test in tests/n17.test.ts catches that.
 */
export interface AdminContext {
  world(): SavedWorld;
  town(): Town;
  store: WorldStore | null;
  /** Requests waiting in the server's queue, for the health panel. */
  queueLength(): number;
  /** The one thing the admin view changes: the clock. Absent in tests that don't need it. */
  time?: AdminTimeControls;
}

export interface AdminTimeControls {
  paused(): boolean;
  setPaused(paused: boolean): void;
  /** Let `hours` pass exactly as when the player waits (same queue, same code). Returns the log lines. */
  advance(hours: number): Promise<string[]>;
}
