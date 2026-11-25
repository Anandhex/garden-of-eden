import { gunzipSync, gzipSync } from "node:zlib";
import { config } from "../../config.js";
import { TABLES, type TableName } from "../../store/schema.js";
import { WorldStore } from "../db.js";
import { worldHash } from "../hash.js";
import { advanceWorld, type LifeOptions } from "../people/world.js";
import type { Realm } from "../realm/types.js";

/**
 * Snapshots and replay (N23 steps 1 and 4, the cut). At the start of every `config.snapshotEvery`-th day (and day 1) the world as it
 * stands (the realm and every table) is written, gzipped, into the store's `snapshots` table with its hash: the **checks**. Replaying from
 * day D loads the nearest snapshot at or before D and runs the days forward through the same entry point the game uses
 * (`advanceWorld`), comparing the hash at every later snapshot day with the one recorded. With no outside input (the player idle, the
 * model off) the replay is exact; the input journal that makes a played world replayable too (the player's actions, the model's applied
 * replies) is N23's next step.
 */

export interface Snapshot {
  day: number;
  hash: string;
  realm: Realm;
  tables: Record<TableName, Array<Record<string, unknown>>>;
}

export interface Check {
  day: number;
  hash: string;
}

/** The hash of the world as it stands: the realm and the hashed tables. */
export const hashOf = (realm: Realm, store: WorldStore): string => worldHash({ realm }, store);

/** Write a snapshot of the world at the start of `day` (before the day is run). */
export function takeSnapshot(realm: Realm, store: WorldStore, day: number): Check {
  const tables = Object.fromEntries((Object.keys(TABLES) as TableName[]).map((t) => [t, store.dumpTable(t)]));
  const hash = hashOf(realm, store);
  const data = gzipSync(JSON.stringify({ day, hash, realm, tables }));
  store.sql("INSERT INTO snapshots (day, hash, data) VALUES (?, ?, ?) ON CONFLICT(day) DO UPDATE SET hash = excluded.hash, data = excluded.data").run(day, hash, data);
  return { day, hash };
}

/** Is today a snapshot day? */
export const snapshotDue = (day: number, every = config.snapshotEvery): boolean => every > 0 && (day === 1 || day % every === 0);

/** The recorded checks, oldest first. */
export function checksOf(store: Pick<WorldStore, "sql">): Check[] {
  return store.sql("SELECT day, hash FROM snapshots ORDER BY day").all() as unknown as Check[];
}

export function loadSnapshot(store: Pick<WorldStore, "sql">, day: number): Snapshot | null {
  const r = store.sql("SELECT data FROM snapshots WHERE day = ?").get(day) as { data: Uint8Array } | undefined;
  if (!r) return null;
  // Our own writing, read back as written (a schema pass could drop or default a field and change the hash).
  return JSON.parse(gunzipSync(r.data).toString("utf8")) as Snapshot;
}

/** A fresh world (an in-memory store) from a snapshot. The snapshots and checks come along, so a replay can check itself. */
export function restore(snap: Snapshot, checks: Check[] = []): { realm: Realm; store: WorldStore } {
  const store = new WorldStore(":memory:");
  store.people.transaction(() => {
    for (const t of Object.keys(TABLES) as TableName[]) store.replaceTable(t, TABLES[t], snap.tables[t] ?? []);
  });
  for (const c of checks) store.sql("INSERT OR IGNORE INTO snapshots (day, hash, data) VALUES (?, ?, ?)").run(c.day, c.hash, new Uint8Array());
  return { realm: structuredClone(snap.realm), store };
}

export interface Replay {
  realm: Realm;
  store: WorldStore;
  from: number;
  /** Snapshot days whose hash the replay matched. */
  matched: number[];
  /** The first snapshot day it didn't, if any. */
  diverged?: { day: number; expected: string; got: string };
}

/**
 * Replay a world from day `from` to the start of day `to`: the nearest snapshot at or before `from`, then the days forward, checked
 * against every recorded snapshot day on the way. Stops at the first divergence.
 */
export function replay(source: Pick<WorldStore, "sql">, from: number, to: number, opts: LifeOptions = {}): Replay {
  const checks = checksOf(source);
  const start = [...checks].reverse().find((c) => c.day <= from);
  if (!start) throw new Error(`no snapshot at or before day ${from}`);
  const snap = loadSnapshot(source, start.day)!;
  const { realm, store } = restore(snap, checks);
  const out: Replay = { realm, store, from: start.day, matched: [] };
  const got0 = hashOf(realm, store);
  if (got0 !== start.hash) return { ...out, diverged: { day: start.day, expected: start.hash, got: got0 } };
  out.matched.push(start.day);
  for (let d = start.day; d < to; d++) {
    advanceWorld(realm, store, d, opts);
    const want = checks.find((c) => c.day === d + 1);
    if (!want) continue;
    const got = hashOf(realm, store);
    if (got !== want.hash) return { ...out, diverged: { day: d + 1, expected: want.hash, got } };
    out.matched.push(d + 1);
  }
  return out;
}
