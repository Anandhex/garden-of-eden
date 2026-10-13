[← Plans](README.md) · [Stage 1: N23](../stage-1-foundations.md#n23-sharing-worlds)

# N23 plan: Sharing worlds

**In one line:** a world can be exported with its snapshots, chronicle, stories and a journal of the player's inputs and the model's state-changing replies, imported on another machine, and replayed from any day exactly, as an observer or as a new player.

**Read first:** [plans README](README.md) section 2 (determinism). Needs N18 (export/import, `worldHash`, deterministic streams) and N20 (stories). N68's chronicle comes later; use N12's nightly chronicle until then.

## What exists

- N18: `world:export` / `world:import` (`.mbworld`: gzip JSON of the save and the state tables), `worldHash`, a seed and named RNG streams, deterministic ids.
- [`game/transcript.ts`](../../../packages/server/src/game/transcript.ts) and `npm run replay` read a JSONL transcript of conversation turns (player line → actions). Prints them; doesn't replay state.
- N12's chronicle ([`director/chronicle.ts`](../../../packages/server/src/director/chronicle.ts)): nightly, model-written, stored.
- N20: stories in SQLite.

## The core problem, and the decision

A world is **not** a pure function of its seed. Three things feed it from outside:
1. **The player's inputs** (move, talk, buy, attack, travel, wait…).
2. **The model's replies that change state**: an NPC's tool calls in conversation (`give_item`, `change_mood`, a promise, a price), faction names, director proposals accepted, a daily plan that moves an NPC.
3. **Real time**: time flowing while the player stands about (`/api/tick`), the combat timer.

With only seed and snapshots, "replay from day 40" reproduces day 40's state but not what followed, unless the player did nothing and the model was off.

**Decision: record an input journal.** Every external input that changes state is appended, in order, to `inputs(seq, day, hour, minute, kind, payload JSON, result JSON)`:
- player actions as they reach the server (the `ActionQueue` already serialises them, which gives a total order);
- each model reply that's applied to state, recorded **as applied** (the validated tool calls and parsed structured output), so a replay applies the recorded result instead of calling the model;
- time ticks as "advance N minutes" entries (not wall-clock times).

Replaying = load the nearest snapshot ≤ the chosen day, then apply journal entries in order with the model replaced by the journal. Same seed + same snapshot + same journal → same hash, on any machine.

Two replay modes, both from a chosen day:
- **Observer:** load the snapshot and play the journal forward; watch in the admin view (N17). Pause anywhere. Or, "observer, no player": drop the player's inputs after day D and let the world run on its own (it diverges; that's the point: "what if I'd never come").
- **New player:** load the snapshot at day D as a new save; the original player becomes an NPC-less absence (their character is gone; the realm keeps its state). Simplest version: the new player takes over the old player character at day D. Pick the simplest first (take over), note the other as later.

## Data shapes

```sql
CREATE TABLE snapshots (day INTEGER PRIMARY KEY, created_tick INTEGER, data BLOB);  -- gzip of the .mbworld document at that day's start
CREATE TABLE inputs (seq INTEGER PRIMARY KEY, day INTEGER, hour INTEGER, minute INTEGER, kind TEXT, payload TEXT, result TEXT);
CREATE INDEX inputs_day ON inputs(day);
```

`.mbworld` v2 adds: `snapshots` (all, or every K-th), `inputs`, `stories`, `chronicle` (the chronicle entries), and a `checks` list `[{ day, hash }]`: the world hash at the start of each snapshot day, so an importer can verify its replay as it goes.

## Steps

### Step 1: snapshots
- At the start of each game day where `day % SNAPSHOT_EVERY === 0` (config, default every 5 days) and at day 1: write the export document (N18's code) into `snapshots`, compressed, and record its hash in `checks`.
- Keep all snapshots by default (a snapshot of a 25k-person world is a few MB compressed; check and set a cap, e.g. last 20 plus every 50th day).

### Step 2: the input journal
- One function, `journal.record(kind, payload, result?)`, called from:
  - the server's action entry points (`act`, `move`, `travel`, `/api/tick` → "advance minutes"), with the request body as payload;
  - the CLI's command loop, the same way;
  - `BudgetedProvider` (N19) when a reply is *applied*: record at the point of application, not at the network call, because a reply can be fetched and then discarded (aborted, invalid). Find each place model output becomes state: NPC tool calls applied in `npc/actions.ts`, `nameFaction`, director proposals accepted (`director/validator.ts`), `planDay` results, child words, summaries stored as memories.
- A **replay provider**: an `LLMProvider` that, instead of calling Ollama, returns the next recorded result for that call kind and key. If the journal has no entry for a call (the code changed), replay stops with a clear "replay diverged at seq N: expected <kind> for <key>".

### Step 3: deterministic real time
- Combat's real-seconds timer and time flow must enter the world only as journal entries ("the player's turn timed out", "advance 1 minute"). Check `server.ts` for any place real time changes state without going through an action (the combat tick, `/api/tick`, idle time) and route it through `journal.record`.

### Step 4: replay
- `scripts/world-replay.ts` and `npm run world:replay -- <file.mbworld> --from 40 [--to 60] [--observer|--player] [--no-player-after]`:
  - load the snapshot for the greatest snapshot day ≤ 40, run forward to day 40 with the journal (fast, no rendering), checking the hash at each snapshot day against `checks`;
  - then either keep replaying (observer) or stop and write a new save at day 40 for a new player.
- In the server: `world:replay --serve` loads the replay into the running server in a read-only **observer** mode: the admin view shows it, the game page shows a banner "Replay of <world> — observer", and player actions are refused. Use N17's time controls to step the replay.

### Step 5: the shareable chronicle
- `npm run world:chronicle -- <file.mbworld> --view truth|player --out chronicle.html`: a single static HTML page (no scripts needed) with the realm's history by day: the N12/N68 chronicle entries, the stories (N20) with their chains, deaths of note, wars, foundings.
- `--view player` filters everything through what the player knew (`player.known`, N24): only events they witnessed or heard of, dated by when they learned them.
- No personal data in it except the player's chosen character name.

### Step 6: cross-machine check
- Commit a small golden fixture: a seed, a scripted 10-day input journal (moves, a purchase, a fight, a few waits), and the expected hash at days 5 and 10. A test replays it and compares. CI runs on Linux; the hash was made on macOS: this catches platform differences in `Math` functions or sort order.
- If it ever differs, find the cause (usually iteration order, `Math.hypot`/`Math.exp` in a threshold, or a locale-dependent sort); don't regenerate the golden file to make it pass.

### Step 7: docs
- README: export, import, replay, chronicle commands; what's in a `.mbworld`; how to attach one to a bug report.
- Tooling track: mention `.mbworld` files as playtest material for the vertical slice and N22.

## Edge cases and traps

- **Code changes break old journals.** A journal is only valid for the code version that made it. Store the git commit (or package version + `SAVE_VERSION`) in the export; replay warns when they differ and stops at the first divergence. That's fine for bug reports (reproduce on the same commit).
- **Model replies that are discarded** must not be journaled (step 2). Otherwise replay gets an extra entry and diverges.
- **Background jobs finish at random real times.** A faction's name arrives when the model is done, between other inputs. Recording the result *as applied, with its seq* puts it at a fixed point in the order. On replay, apply it at that seq, not when the code would have queued it.
- **The player's free text** (what they said) is in the journal. Warn in the export command that the file contains everything the player typed.
- **Size:** inputs grow with play. Compress; consider pruning journal entries before the oldest kept snapshot.

## Tests (`packages/server/tests/n23.test.ts`)

- Snapshot then replay with no inputs: hash at day 10 equals the original's.
- With a scripted input journal (including a fake model reply applied as a tool call): replay from day 0 and from the day-5 snapshot both match the original hashes at days 5 and 10.
- Divergence: remove one journal entry → replay stops with "diverged at seq N".
- Observer mode refuses player actions.
- Chronicle `--view player` doesn't contain an event the player never learned.
- Golden fixture hash (cross-machine).

## Done when (mapped)

| Done-when clause | Proved by |
|---|---|
| a world is exported, imported on another machine and replayed from day 40 identically | journal replay tests + golden fixture on CI (another machine) |
| its chronicle reads the same in both | chronicle is recorded text: a test compares the two chronicle files byte for byte |

## Slice cut

Not in the slice. But the input journal (step 2) is far easier to add before many more model-driven state changes exist; consider doing steps 2–3 right after N18.

## Out of scope

Online sharing (uploading, a gallery). Merging worlds.
