[← Plans](README.md) · [Stage 1: N18](../stage-1-foundations.md#n18-scale-and-storage)

# N18 plan: Scale and storage

**In one line:** every person moves into SQLite, saved by place in batches; the save becomes small, fast and deterministic; old saves are set aside (v11 clean break); a world can be exported and imported.

**Read first:** [plans README](README.md) sections 1 (old saves), 2 (determinism), 6 (person refs), 9 (performance).

## What exists

- [`save.ts`](../../../packages/server/src/game/save.ts): `saveWorld` writes the whole `SavedWorld` as **pretty-printed** JSON (`JSON.stringify(…, null, 2)`) to `saves/world.json` on every `persist()` in `server.ts`. `loadWorld` → `upgradeSave` runs migrations v1→v10. `SAVE_VERSION = 10`.
- [`db.ts`](../../../packages/server/src/game/db.ts): `WorldStore` over `node:sqlite` (`DatabaseSync`) with tables `events`, `memories`, `director_log`. No schema version. No transactions around batches.
- Townsfolk aren't saved: `rosterFor(realm, site, map, day)` rolls them from the realm seed person by person ([`townsfolk.ts`](../../../packages/server/src/game/realm/townsfolk.ts)); a townsperson spoken to becomes a persona in `world.visitors`.
- Realm figures (hundreds) live in `world.realm.figures`.
- Ids and rolls aren't deterministic (see README section 2).

## Decisions made in this plan

1. **v11 clean break** (user decision): no migrations from ≤ v10. Set the old file aside, reset the db, new world. Delete the migration chain and its tests.
2. **Materialise everyone at world creation.** The stage file says "the seeded roster stays the starting point; the database holds what has changed since". Diffs against a roll would be fragile: `rosterFor` reads the realm's *current* factions, population and buildings, so re-rolling an unchanged person later can give a different person. Instead, roll every settlement's people **once**, when the world is made, and insert them all into SQLite in one transaction. From then on the database is the truth and `rosterFor` is only the generator. 50,000 rows insert in well under a second with a prepared statement in a transaction.
3. **Figures stay in the realm JSON for now.** They're few (hundreds), the realm code reads them everywhere, and moving them is a big risky change with no payoff in Stage 1. The people facade (README section 6) hides the difference. Revisit when N25's risers make figures and townsfolk overlap a lot.
4. **The cast stays in the save** (`npcStates`, personas): tens of NPCs, each a prompt; no scale problem.
5. **One commit point.** `world.json` and `world.db` must not disagree after a crash. Write the db batch in a transaction that also stores `meta.save_tick = N`; then write `world.json` (with `saveTick: N`) to a temp file and `rename` it over the old one (atomic on the same disk). On load, if `world.json.saveTick` ≠ `meta.save_tick`, the files are from different moments: since saves are disposable this early, report it clearly and offer a new world rather than guessing. (Later, if needed: keep the last two ticks' changes and roll the db back.)
6. **Compact JSON** (`JSON.stringify(world)` without indentation) for `world.json`. Pretty printing a big save costs time and space; `npm run world:export -- --pretty` can pretty print for reading.

## The schema (in `server/src/store/schema.ts`, applied by `PRAGMA user_version`)

```sql
PRAGMA journal_mode = WAL;        -- readers don't block the writer
PRAGMA synchronous = NORMAL;      -- safe with WAL, much faster

CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);   -- save_tick, world_seed, schema version notes

CREATE TABLE people (
  id TEXT PRIMARY KEY,            -- t_<site>_<n> (keep N16's ids)
  site TEXT NOT NULL,             -- where they live now (settlement id; later road places)
  n INTEGER NOT NULL,             -- order in the place (a growing town adds to the end)
  name TEXT NOT NULL, gender TEXT NOT NULL, species TEXT NOT NULL,
  born_day INTEGER NOT NULL,      -- age comes from this, not a stored age
  cls TEXT NOT NULL, job TEXT NOT NULL,
  home INTEGER, work TEXT, master TEXT, faction TEXT,
  mother TEXT, father TEXT, spouse TEXT,        -- person refs (N25)
  figure TEXT,                    -- set when they rose to a realm figure (N25)
  persona TEXT,                   -- set when they became a talking NPC
  traits TEXT,                    -- JSON, small (N25 inheritance)
  death TEXT,                     -- JSON DeathRecord or NULL (N25)
  rev INTEGER NOT NULL DEFAULT 0  -- bumped on every write, for dirty checks and debugging
);
CREATE INDEX people_site ON people(site, n);
CREATE INDEX people_name ON people(name);       -- admin search
CREATE INDEX people_alive_site ON people(site) WHERE death IS NULL;

CREATE TABLE relationships (a TEXT, b TEXT, trust REAL, affection REAL, respect REAL, fear REAL, since INTEGER, PRIMARY KEY (a, b));
CREATE TABLE knowledge (who TEXT, ref TEXT, learned_day INTEGER, source TEXT, accuracy REAL, PRIMARY KEY (who, ref));
CREATE INDEX knowledge_ref ON knowledge(ref);
CREATE TABLE grievances (id INTEGER PRIMARY KEY, who TEXT, against TEXT, cause_ref TEXT, weight REAL, since INTEGER, settled INTEGER);
CREATE TABLE ambitions (who TEXT PRIMARY KEY, kind TEXT, target TEXT, progress REAL, since INTEGER);
CREATE TABLE jobs_held (who TEXT, job TEXT, site TEXT, from_day INTEGER, to_day INTEGER);
```

And extend `events` now, while the version is breaking anyway: `caused_by TEXT` (JSON array of refs, N20), `why TEXT` (N17), `site TEXT`, `kingdom TEXT` (N24's scopes), `seq INTEGER` with an index on `(day, hour, seq)`. Add `CREATE INDEX events_site ON events(site, day)`.

Only `people` is filled in this phase. The other tables are created empty with their indexes, with a typed accessor each, so N25/N33/N37/N40 don't each need a schema change. Keep **sparse**: a relationship row exists only once two people have actually interacted; 50,000² rows is not a thing.

## Steps

### Step 1: determinism first
Do this before storage, or the export/replay test can't pass.
- `streamFor(seed, ...keys)` in `dice.ts` (README section 2).
- Replace the single `Town.rng` with streams: `advanceRealm` gets a day stream per day (`streamFor(realm.seed, "realm", d)`), and inside `realmDay` each sub-step gets its own sub-stream (`"economy"`, `"factions"`, …). Same for `breedCreatures`, `nameRisers`, `familyNight`, `passVillage`, spawning.
- The world needs a seed: add `world.seed` (from `config.realmSeed` or rolled once at new-game time; the *only* `Math.random` call left in setup).
- Event ids: `e<day>-<hour>-<seq>` with `world.nextEventSeq`.
- Grep the server for `Math.random` and `Date.now()` and classify each: real-time (keep, add a comment `// real time, not simulation`) or simulation (replace). The NpcAgent's conversation randomness can stay non-deterministic only if its outcome is recorded (N23's input journal); note it, don't fix it here.
- **Test:** same seed, two fresh worlds, 30 days each with the model off → identical `worldHash`. Then change one unrelated roll (add a dummy `streamFor(...)("x")` call in packs) and the economy sub-step's results stay identical.
- Expect existing tests that relied on `Math.random` defaults to need a fixed rng; fix them by passing a seed, not by loosening their assertions.

### Step 2: the v11 break
- `SAVE_VERSION = 11`. `loadWorld`: if the file's `version < 11`, rename it aside, `store.reset()`, return a new world, and a message for the player. Delete `upgradeMoney`/`moveMoney`/`scale`, the old-version branches in `upgradeSave`, and the old-save tests. Keep `parseEvents`/schema checks on load (they protect against corrupt files, not old ones).
- Strike the migration items in the stage files (done in the roadmap already; keep them in sync if you change anything).

### Step 3: the store module and schema
- `server/src/store/peopleStore.ts` (one class, `PeopleStore`, sharing the `DatabaseSync` handle with `WorldStore`: open the db once, pass it to both). Schema versioning: read `PRAGMA user_version`; if 0, create everything and set it to 1; later versions add migrations in an array.
- Prepared statements created once and reused (`db.prepare` per call is slow at this volume).
- A `transaction(fn)` helper (`BEGIN` / `COMMIT` / `ROLLBACK` on throw).

### Step 4: materialise people at world creation
- In `newWorld` (or where the realm is generated): for each settlement, build its map (`siteMap`), call `rosterFor`, and insert every person. Cast and notables aren't townsfolk; keep `rosterFor`'s exclusions.
- Time it: a realm's worth (seed 1 today: 36 settlements, about 24,500 people, the biggest capital 4,149; N25 growth and bigger realms push toward 50,000) must be under 2 s on the M2. If it isn't, profile `rosterFor` first (it's the generator, probably the cost), not SQLite.
- `rosterFor` stays for generating; add `rosterFromStore(site)` → the same `CrowdRoster` shape from the db, so `CrowdSim`, `/api/crowd`, the admin view and `meetTownsperson` read stored people. Swap callers to it. The crowd test in `client/tests/crowd.test.ts` and `n16.test.ts` must still pass unchanged (the roster has the same people).

### Step 5: load by place, write in batches
- **Load:** `loadSite(site, detail: "full" | "coarse")` → the living people of a place (full: everything incl. traits; coarse: only what daily rules need). Keep at most the player's site and pinned people's sites loaded in full; drop others after use.
- **Write:** a `dirty` set of person ids per tick. Every change goes through `PeopleStore.update(id, patch)` which marks dirty and keeps the patched row in a small cache. At the end of a tick (`persist()`), `flush()` writes all dirty rows in one transaction with `meta.save_tick`, then the JSON (decision 5).
- **No full rewrite per hour.** Nothing writes people outside `flush()`.
- **`world.json`** keeps: version, seed, clock, player, cast states and personas, realm (with figures), small logs (events capped at 300 as today, news, pushes), and `saveTick`. Nothing per townsperson.

### Step 6: the hash, extended
- `worldHash(world, store)` hashes canonical JSON of the save plus, for each state table, rows sorted by primary key (`SELECT * FROM people ORDER BY id`). Exclude real-time-only fields (none should exist in the save after step 1; if a test finds one, fix the source).

### Step 7: export and import
- `npm run world:export -- <out.mbworld>` and `npm run world:import -- <file>` (`scripts/world.ts`). Format: gzip (`node:zlib`) of one JSON document `{ format: "mbworld", version: 1, saveVersion: 11, exportedDay, world, tables: { people: [...], events: [...], memories: [...], director_log: [...], ... } }`. Embedding vectors in `memories` are large: export them (recall must replay the same) but note the size.
- Import validates with zod (the world with the save's schema, rows with a per-table schema), refuses unknown `format` or a newer version, writes into a **new** save path (never over the current save without `--force`).
- Also expose `GET /api/admin/export` (N17's admin page gets a download button) — a GET that only reads, so it fits the admin rules.

### Step 8: bench and docs
- `npm run bench:storage`: generate a realm scaled to 50,000 people (raise settlement populations, or generate with a "big realm" option), then time: full save (flush everything dirty + JSON) and loading the player's site. Print ms; exit non-zero past the budgets (1 s save, 2 s load). N19 moves these numbers into its budget config.
- README: what's in `world.json` vs `world.db`, that pre-v11 saves are set aside, export/import commands.

## Edge cases and traps

- **`node:sqlite` is synchronous.** A 50,000-row flush blocks the event loop. Keep flushes to dirty rows only; a normal hour changes few people. If a flush ever takes > 50 ms, the browser's time flow stutters; N19 checks it.
- **WAL files:** `world.db-wal` and `world.db-shm` sit next to the db. Exports must read through SQLite (or checkpoint first: `PRAGMA wal_checkpoint(TRUNCATE)`), never copy the file alone.
- **Tests use `:memory:`.** `WorldStore` already supports it; keep it so tests stay fast. WAL doesn't apply in memory; that's fine.
- **The house a person lives in** (`home` index into the map's buildings) must stay valid when the map changes. Maps are generated from population (`sites.ts` adds houses by population), so a growing town's map would renumber houses. N25 deals with this properly; for now, store `home` as the building index at materialisation and add a test that loading a site whose population changed doesn't put anyone in a missing house (clamp to an existing house and log it).
- **A talking townsperson** (persona in `world.visitors`) and their `people` row must agree on name, job and class. Make `townsfolkPersona` read from the row, and set `people.persona` when they become talking.
- **Two processes** (CLI and web) share `saves/`. Today they "share world.json"; with SQLite, two writers can lock each other. Document: run one at a time; take an exclusive lock file (`saves/.lock`) at start and refuse to start a second writer with a clear message.

## Tests (`packages/server/tests/n18.test.ts`)

- **Determinism:** same seed → same hash after 30 days (model off); a new dummy roll in one system doesn't change another's results.
- **v11 break:** a v10 file is renamed aside, a new world starts, the db is empty of the old events, the message is returned.
- **Materialised:** every settlement's living count in `people` equals what `rosterFor` rolled at creation; reading a site back gives the same roster (same ids, names, jobs) as the generator did.
- **Batch writes:** changing three people and calling `flush()` writes exactly three rows (`rev` bumped) in one transaction; nothing is written before `flush()`.
- **Commit point:** simulate a crash between the db commit and the JSON rename (throw in a test hook) → load reports the mismatch.
- **Export/import:** export at day 5, import into a fresh path, run both 10 more days with the same inputs → equal hashes.
- **Scale (LONG=1, and a small always-on version):** 50,000 people: save < 1 s, load player's site < 2 s (× `PERF_SLACK`).

## Done when (mapped)

| Done-when clause | Proved by |
|---|---|
| 50,000 people save in under a second and load the player's place in under two | scale test, `bench:storage` |
| ~~a v10 save migrates and plays on~~ → a pre-v11 save is set aside and a new world starts (user decision 2026-10-13) | v11 break test |
| an exported world imports and replays identically with the same seed | export/import test |

## Slice cut

All of it. The slice needs real, stored townsfolk in Millbrook and its neighbour (N25), and N25 needs this storage and determinism. The 50,000 benchmark can wait for Stage 1's end, but the code paths are the same.

## Out of scope

Moving figures or the cast into SQLite. Filling relationships/knowledge/grievances/ambitions (their phases do). Snapshots and input journals (N23).
