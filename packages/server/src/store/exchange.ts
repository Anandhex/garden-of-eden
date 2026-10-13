import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { z } from "zod";
import type { WorldStore } from "../game/db.js";
import { SAVE_VERSION, SaveSchema, saveWorld, type SavedWorld } from "../game/save.js";
import { TABLES, type TableName } from "./schema.js";

/**
 * Exporting and importing a world (N18): one gzip of one JSON document, `.mbworld`,
 * holding the save and every database table. The same document is what N23 will share.
 *
 * Export reads through SQLite (never the .db file: its WAL holds changes the file does not),
 * so what is exported is the world as it is now, including people not yet flushed.
 */

export const FORMAT = "mbworld";
/** Version of this container, not of the save inside it. */
export const FORMAT_VERSION = 1;

export interface MbWorld {
  format: typeof FORMAT;
  version: number;
  saveVersion: number;
  exportedDay: number;
  world: SavedWorld;
  tables: Record<TableName, Array<Record<string, unknown>>>;
}

/** The world and its tables as one document. Embedding vectors in `memories` are included (recall must replay the same), and they are large. */
export function exportWorld(world: SavedWorld, store: WorldStore): MbWorld {
  const tables = Object.fromEntries((Object.keys(TABLES) as TableName[]).map((t) => [t, store.dumpTable(t)])) as MbWorld["tables"];
  return { format: FORMAT, version: FORMAT_VERSION, saveVersion: SAVE_VERSION, exportedDay: world.day, world, tables };
}

export const encodeMbWorld = (doc: MbWorld): Buffer => gzipSync(JSON.stringify(doc));

const cell = z.union([z.string(), z.number(), z.null()]);
/** A row of a table: exactly its columns, each a string, a number or null. */
const rowSchema = (table: TableName) => z.object(Object.fromEntries(TABLES[table].map((c) => [c, cell]))).strict();

export class ImportError extends Error {}

/** Check a document: its format and versions, the world against the save's schema, every row against its table's columns. */
export function parseMbWorld(raw: unknown): MbWorld {
  const head = z.object({ format: z.string(), version: z.number().int(), saveVersion: z.number().int() }).safeParse(raw);
  if (!head.success || head.data.format !== FORMAT) throw new ImportError(`Not a ${FORMAT} file.`);
  if (head.data.version > FORMAT_VERSION) throw new ImportError(`This file is from a newer version of the game (container ${head.data.version}; this build reads up to ${FORMAT_VERSION}).`);
  if (head.data.saveVersion !== SAVE_VERSION) throw new ImportError(`This world is save version ${head.data.saveVersion}; this build plays version ${SAVE_VERSION}.`);
  const doc = raw as { world: unknown; tables: Record<string, unknown>; exportedDay: unknown };
  const world = SaveSchema.safeParse(doc.world);
  if (!world.success) throw new ImportError(`The world in the file is not sound: ${world.error.issues[0]?.path.join(".")} ${world.error.issues[0]?.message}`);
  const tables = {} as MbWorld["tables"];
  for (const table of Object.keys(TABLES) as TableName[]) {
    const rows = z.array(rowSchema(table)).safeParse(doc.tables?.[table] ?? []);
    if (!rows.success) throw new ImportError(`Table ${table} is not sound: ${rows.error.issues[0]?.path.join(".")} ${rows.error.issues[0]?.message}`);
    tables[table] = rows.data;
  }
  return { format: FORMAT, version: head.data.version, saveVersion: SAVE_VERSION, exportedDay: Number(doc.exportedDay), world: doc.world as SavedWorld, tables };
}

export function decodeMbWorld(buf: Buffer): MbWorld {
  let json: unknown;
  try {
    json = JSON.parse(gunzipSync(buf).toString("utf8"));
  } catch {
    throw new ImportError(`Not a ${FORMAT} file (it is not gzipped JSON).`);
  }
  return parseMbWorld(json);
}

export function writeMbWorld(file: string, world: SavedWorld, store: WorldStore): number {
  mkdirSync(dirname(file), { recursive: true });
  const buf = encodeMbWorld(exportWorld(world, store));
  writeFileSync(file, buf);
  return buf.length;
}

export function readMbWorld(file: string): MbWorld {
  return decodeMbWorld(readFileSync(file));
}

/**
 * Put an imported world into a save file and a database. The save file must be new unless `force`: an
 * import never writes over the world you are playing by accident. The database should be empty
 * (a fresh `WorldStore`); its tables are replaced and the save is written with the matching tick.
 */
export function importWorld(doc: MbWorld, o: { saveFile: string; store: WorldStore; force?: boolean }): SavedWorld {
  if (!o.force && existsSync(o.saveFile)) throw new ImportError(`${o.saveFile} already exists. Import into a new path (--to), or add --force to replace it.`);
  const world = structuredClone(doc.world);
  o.store.reset();
  o.store.people.transaction(() => {
    for (const table of Object.keys(TABLES) as TableName[]) o.store.replaceTable(table, TABLES[table], doc.tables[table]);
  });
  saveWorld(o.saveFile, world, o.store);
  return world;
}
