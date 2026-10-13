import { createHash } from "node:crypto";
import type { WorldStore } from "./db.js";

/**
 * A fingerprint of the world, for "nothing changed" and "the same seed gives the same
 * world" checks (N17; N18 extends it to the database tables). sha256 of the save as
 * canonical JSON: keys sorted, so insertion order doesn't matter.
 */

/** JSON with every object's keys in sorted order and `undefined` left out. */
export function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) => {
    if (v === null || typeof v !== "object" || Array.isArray(v)) return v;
    const o = v as Record<string, unknown>;
    return Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]]));
  });
}

/** The hash of a world (and, if given, the sizes of what its database holds). */
export function worldHash(world: unknown, store?: Pick<WorldStore, "eventCount" | "memoryCount" | "directorEntries"> | null): string {
  const h = createHash("sha256").update(canonical(world));
  if (store) h.update(`|events=${store.eventCount()}|memories=${store.memoryCount()}|director=${store.directorEntries().length}`);
  return h.digest("hex");
}
