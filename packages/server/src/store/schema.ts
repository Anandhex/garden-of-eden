import type { DatabaseSync } from "node:sqlite";

/**
 * The database's tables (N18), made and brought up to date by `applySchema` using
 * `PRAGMA user_version`. Version 1 is the first, made together with save v11, so it
 * holds the columns later phases need (events: caused_by, site, kingdom, seq; people:
 * family refs, figure, persona, traits, death; the relationship, knowledge, grievance,
 * ambition and job tables, empty until their phases fill them) and none of them costs
 * another migration. From version 2 on, add a migration to MIGRATIONS.
 */

/** Columns of each state table, in order: what export and the world hash read, and what import checks. */
export const TABLES = {
  people: ["id", "site", "n", "name", "gender", "species", "born_day", "cls", "job", "home", "work", "master", "master_id", "faction", "mother", "father", "spouse", "figure", "persona", "traits", "death", "rev"],
  relationships: ["a", "b", "trust", "affection", "respect", "fear", "since"],
  knowledge: ["who", "ref", "learned_day", "source", "accuracy"],
  grievances: ["id", "who", "against", "cause_ref", "weight", "since", "settled"],
  ambitions: ["who", "kind", "target", "progress", "since"],
  jobs_held: ["who", "job", "site", "from_day", "to_day"],
  events: ["id", "day", "hour", "kind", "actor", "target", "details", "importance", "place", "witnesses", "known_by", "why", "caused_by", "site", "kingdom", "seq"],
  memories: ["id", "npc", "day", "kind", "text", "importance", "embedder", "vector"],
  director_log: ["id", "day", "kind", "ok", "reason", "proposal", "event"],
} as const;
export type TableName = keyof typeof TABLES;

/** Primary key (sort) of each table, for stable dumps. */
export const ORDER_BY: Record<TableName, string> = {
  people: "id",
  relationships: "a, b",
  knowledge: "who, ref",
  grievances: "id",
  ambitions: "who",
  jobs_held: "who, job, from_day",
  events: "id",
  memories: "id",
  director_log: "id",
};

const V1 = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);

CREATE TABLE IF NOT EXISTS people (
  id TEXT PRIMARY KEY,
  site TEXT NOT NULL,
  n INTEGER NOT NULL,
  name TEXT NOT NULL, gender TEXT NOT NULL, species TEXT NOT NULL,
  born_day INTEGER NOT NULL,
  cls TEXT NOT NULL, job TEXT NOT NULL,
  home INTEGER, work TEXT, master TEXT, master_id TEXT, faction TEXT,
  mother TEXT, father TEXT, spouse TEXT,
  figure TEXT, persona TEXT, traits TEXT, death TEXT,
  rev INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS people_site ON people(site, n);
CREATE INDEX IF NOT EXISTS people_name ON people(name);
CREATE INDEX IF NOT EXISTS people_alive_site ON people(site) WHERE death IS NULL;

CREATE TABLE IF NOT EXISTS relationships (a TEXT, b TEXT, trust REAL, affection REAL, respect REAL, fear REAL, since INTEGER, PRIMARY KEY (a, b));
CREATE TABLE IF NOT EXISTS knowledge (who TEXT, ref TEXT, learned_day INTEGER, source TEXT, accuracy REAL, PRIMARY KEY (who, ref));
CREATE INDEX IF NOT EXISTS knowledge_ref ON knowledge(ref);
CREATE TABLE IF NOT EXISTS grievances (id INTEGER PRIMARY KEY, who TEXT, against TEXT, cause_ref TEXT, weight REAL, since INTEGER, settled INTEGER);
CREATE TABLE IF NOT EXISTS ambitions (who TEXT PRIMARY KEY, kind TEXT, target TEXT, progress REAL, since INTEGER);
CREATE TABLE IF NOT EXISTS jobs_held (who TEXT, job TEXT, site TEXT, from_day INTEGER, to_day INTEGER);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY, day INTEGER, hour INTEGER, kind TEXT, actor TEXT, target TEXT,
  details TEXT, importance REAL, place TEXT, witnesses TEXT, known_by TEXT, why TEXT,
  caused_by TEXT, site TEXT, kingdom TEXT, seq INTEGER
);
CREATE TABLE IF NOT EXISTS memories (
  id INTEGER PRIMARY KEY AUTOINCREMENT, npc TEXT, day INTEGER, kind TEXT, text TEXT,
  importance REAL, embedder TEXT, vector TEXT
);
CREATE INDEX IF NOT EXISTS memories_npc ON memories(npc);
CREATE TABLE IF NOT EXISTS director_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT, day INTEGER, kind TEXT, ok INTEGER, reason TEXT, proposal TEXT, event TEXT
);
`;

/** Columns an events table made before version 1 may lack. */
const EVENT_COLUMNS: Array<[string, string]> = [
  ["why", "TEXT"],
  ["caused_by", "TEXT"],
  ["site", "TEXT"],
  ["kingdom", "TEXT"],
  ["seq", "INTEGER"],
];

/** Later versions: `MIGRATIONS[0]` takes version 1 to 2, and so on. */
const MIGRATIONS: Array<(db: DatabaseSync) => void> = [];

/** The version `applySchema` leaves a database at. */
export const SCHEMA_VERSION = 1 + MIGRATIONS.length;

/** Create the tables and bring an existing database up to the current version. `wal`: file databases (not `:memory:`). */
export function applySchema(db: DatabaseSync, wal: boolean): void {
  if (wal) {
    // Readers don't block the writer, and NORMAL is safe with WAL and much faster.
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA synchronous = NORMAL");
  }
  let version = Number((db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version);
  if (version === 0) {
    db.exec(V1);
    // A database from before the schema was versioned has an events table without the newer columns.
    const have = new Set((db.prepare("PRAGMA table_info(events)").all() as Array<{ name: string }>).map((c) => c.name));
    for (const [name, type] of EVENT_COLUMNS) if (!have.has(name)) db.exec(`ALTER TABLE events ADD COLUMN ${name} ${type}`);
    db.exec("CREATE INDEX IF NOT EXISTS events_when ON events(day, hour, seq)");
    db.exec("CREATE INDEX IF NOT EXISTS events_actor ON events(actor)");
    db.exec("CREATE INDEX IF NOT EXISTS events_target ON events(target)");
    db.exec("CREATE INDEX IF NOT EXISTS events_site ON events(site, day)");
    db.exec("PRAGMA user_version = 1");
    version = 1;
  }
  if (version > SCHEMA_VERSION) throw new Error(`world.db is from a newer version of the game (schema ${version}, this build knows ${SCHEMA_VERSION}).`);
  for (; version < SCHEMA_VERSION; version++) {
    MIGRATIONS[version - 1]!(db);
    db.exec(`PRAGMA user_version = ${version + 1}`);
  }
}
