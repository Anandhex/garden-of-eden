import { createHash } from "node:crypto";
import type { WorldStore } from "./db.js";
import { type TableName } from "../store/schema.js";

/**
 * A fingerprint of the world, for "nothing changed" and "the same seed gives the same
 * world" checks (N17; N18 extends it to the database). sha256 of the save as canonical JSON
 * (keys sorted, so insertion order doesn't matter) followed by every state table of the
 * database, rows in primary key order.
 *
 * Left out: `saveTick` (it counts saves, not the world) and the embedding vectors of memories
 * (a model's floating point isn't the simulation's).
 */

/** JSON with every object's keys in sorted order and `undefined` left out. */
export function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) => {
    if (v === null || typeof v !== "object" || Array.isArray(v)) return v;
    const o = v as Record<string, unknown>;
    return Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]]));
  });
}

/** Tables the hash reads. (`site_days` is a working record of each day's conditions, pruned on its own schedule, so it is left out.) */
export const HASHED_TABLES: TableName[] = ["people", "relationships", "knowledge", "grievances", "ambitions", "jobs_held", "events", "director_log", "memories", "site_seq"];
/** `rev` counts how often a row was written, which depends on when the world was saved, not on what happened in it. */
const SKIP_COLUMNS: Partial<Record<TableName, string[]>> = { memories: ["vector", "embedder"], people: ["rev"] };

/** The hash of a world and, if given, the state tables of its database. */
export function worldHash(world: unknown, store?: Pick<WorldStore, "dumpTable"> | null): string {
  const h = createHash("sha256").update(canonical(world !== null && typeof world === "object" ? { ...(world as object), saveTick: undefined } : world));
  if (store) {
    for (const table of HASHED_TABLES) {
      const skip = SKIP_COLUMNS[table] ?? [];
      h.update(`|${table}=`);
      for (const row of store.dumpTable(table)) h.update(canonical(skip.length > 0 ? Object.fromEntries(Object.entries(row).filter(([k]) => !skip.includes(k))) : row)).update("\n");
    }
  }
  return h.digest("hex");
}
