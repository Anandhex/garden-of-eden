[← Plans](README.md) · [Stage 1: N24](../stage-1-foundations.md#n24-global-reporting)

# N24 plan: Global reporting

**In one line:** the player has a knowledge record of their own; the feed shows only what's in it, in three scopes (here, my kingdom, everywhere); news reaches the player wherever they are, at the speed travellers carry it; and the feed stops reporting Millbrook's trades when the player is somewhere else.

**Read first:** [plans README](README.md) section 3 (truth vs knowledge). Needs N17 (admin view, the truth side) and N18 (events with `site`/`kingdom` columns).

## What exists

- **News timing is Millbrook-only.** `realmNews()` in [`realm/log.ts`](../../../packages/server/src/game/realm/log.ts) sets `reaches = day + travelDays(realm, at, HOME_ID)`; `deliverNews()` in [`realm/news.ts`](../../../packages/server/src/game/realm/news.ts) delivers due news to Millbrook's NPCs as lore (`realm.<id>`) and returns lines for the player. The people of other places "hear only the news that reaches them" (N14) through visitor lore.
- **The player's feed** is `pushNews(event)` in [`web/server.ts`](../../../packages/server/src/web/server.ts) (a list of 50 `NewsItem`s), filled from `town.takeNews()`, turn events, combat notes. The client shows it ([`client/src/game.ts`](../../../packages/client/src/game.ts) `feed`).
- **The trades bug:** `restock()` in [`game/economy.ts`](../../../packages/server/src/game/economy.ts) runs for Millbrook's cast every hour and its log lines ("Brena bought 3 iron ore from …") reach the feed even while the player is in another place.
- The player's knowledge today is scattered: journal notes, `world.recentEvents`, events with `player` as actor, lore delivered. No single "the player knows X".
- N13.0's death news: `deathNotes` and [`deathNews.ts`](../../../packages/server/src/game/deathNews.ts).

## Decisions made in this plan

1. **`player.known`: one record of what the player knows.** A map `ref → { day, how: "saw" | "told" | "news" | "read", from?: string }` for events and news refs (N20's ref format). Stored in SQLite `knowledge` (N18's table, `who = "player"`) so it can grow without bloating the save. One function, `playerKnows(ref)`, and one way in, `playerLearns(ref, how, from?)`.
2. **How the player learns:**
   - **Saw it:** events at the player's site and area while they're there and awake (the witness rule events already use; the player is a witness when present).
   - **News arrives where they are:** generalise `reaches` to any place: `reachesAt(news, site) = news.day + travelDays(news.at, site) × speedFactor(importance)` (important news travels faster: a king's death rides; a hamlet's fire walks). When the player is at `site` on or after that day, they learn it (`how: "news"`). Store per news only the day and place it happened; compute arrival on demand.
   - **Told:** an NPC says it (gossip, N33 later; callbacks, N21; a conversation where the NPC passes on news they hold as lore). Hook: when an NPC's turn uses a lore entry or rumour about an event, the player learns that event (`how: "told", from: npc`).
   - Later: read it (a broadsheet, a letter: N65).
3. **Feed scopes:** `here` (the player's current site), `kingdom` (the current site's kingdom; if free, just here), `everywhere`. Each item has a scope computed from its place relative to the player **at the time they learned it**. Per-scope importance floor (defaults: here ≥ 1, kingdom ≥ 4, everywhere ≥ 6), tunable in the client.
4. **Pinned people** (N17): events about a pinned person always show in the admin view at once. In the player's feed, only once known, but with the importance floor ignored. The game page doesn't know about admin pins; add a separate **"follow"** list in the player's own UI (N34 builds following properly; here, a simple list the player sets) and use that for the player's feed. Don't leak admin pins into the game.
5. **The trades fix:** the feed reports trades of **the site the player is at**. Millbrook's cast trades are only reported while the player is in Millbrook. For other sites, there are no trade events today (N16's townsfolk traders don't trade). Add a small deterministic **market day summary** per site: from the site's roster traders, `marketLines(site, day)` produces a few trade lines ("Wenna the baker sold out of rye loaves") seeded by `(seed, site, day)`, emitted only when the player is at that site at market hours. This is cosmetic for now and marked as such; N38/N40 make it real.

## Steps

### Step 1: `player.known`
- `server/src/game/playerKnowledge.ts`: `playerKnows(ref)`, `playerLearns(ref, how, from?)`, `knownSince(ref)`, `knownRefs({ sinceDay, scope })`. Backed by the `knowledge` table; an in-memory set for the session for speed, flushed with N18's batch.
- Seed it on a new world with lore the player starts knowing (whatever the opening tells them).
- Make every existing player-facing "the player now knows" path call `playerLearns`: witnessing (`recordEvent` when the player is present: add `"player"` to witnesses/knownBy by the same rule as NPCs), the journal's `note()` (things noted are known), news delivered at Millbrook today.

### Step 2: news reaches the player anywhere
- `reachesAt(realm, news, site)` in `realm/news.ts`; keep `reaches` (Millbrook) as `reachesAt(news, HOME_ID)` so NPC delivery doesn't change.
- Each hour (or on arrival at a site, and on each day change), `deliverToPlayer(site, day)`: news with `reachesAt(site) ≤ day` and not yet known → `playerLearns(ref, "news")` → feed item.
- Travelling: on arrival at a site, everything that has reached that site is learned at once (with the arrival day). While on the road (N26), news is learned from travellers met (N26 hooks into `playerLearns(ref, "told", traveller)`).
- Speed factor: `importance ≥ 8 → 0.5`, `≥ 6 → 0.75`, else 1. Constants in `news.ts`.

### Step 3: the feed reads only knowledge
- Change the feed's source: instead of pushing every server log line, the feed is built from `player.known` (events and news the player learned, newest first) plus local, immediate things (combat notes, system messages). Turn events of the player's own actions are "saw".
- Give each feed item `{ ref?, text, day, scope, importance, kind }`. `scope` from the item's site vs the player's site/kingdom at learn time.
- Endpoint `GET /api/feed?scope=here|kingdom|everywhere&after=<cursor>`; the client shows three tabs (or a selector) with the floors from decision 3 and a "show minor" toggle.

### Step 4: the trades fix and market lines
- Make `restock()`'s log lines carry their site (`Millbrook`); the server only forwards them to the feed when `siteOf(player) === HOME_ID`.
- `marketLines(roster, day, rng)` in `realm/townsfolk.ts` (or a new `realm/markets.ts`): 1–3 lines on market days from that site's traders; called when the player is at a non-home site during market hours; seeded by `streamFor(seed, "market", site, day)`.
- Test: at Highdale (in the test, the liege town; see N26's note on names) the feed shows that town's market lines, and no Millbrook restock line, during a day there.

### Step 5: the admin side
- N17's event stream already shows the truth at once. Add a column "player knows since" (day or —) so the gap between truth and knowledge is visible.

### Step 6: docs
- README: the three scopes, how news reaches you, the follow list.

## Edge cases and traps

- **Don't double-learn.** `playerLearns` is idempotent (first learning wins; keep the earliest `day` and `how`).
- **Old news on arrival:** arriving in a far town after a month can deliver dozens of items at once. Group: "While you were away: 14 pieces of news (3 important)". Show the important ones; the rest under a fold.
- **Lore vs events:** NPC knowledge of realm news is lore (`realm.<id>`), player knowledge is refs. Keep the mapping one function (`realmNewsId(n)` ↔ `n:<id>`), not string-building in several places.
- **The CLI** has its own output path. Make sure the CLI uses the same `player.known` checks (or at least doesn't print far news early). If the CLI feed is out of scope, say so in the README.
- **Determinism:** learning depends on the player's position, which is an input (journal, N23); that's fine.

## Tests (`packages/server/tests/n24.test.ts`)

- A war starts in a far kingdom on day d: not in the player's feed on day d (admin stream has it); in the "everywhere" feed on `reachesAt(home)`; not in "here".
- The player travels toward the war: they learn it earlier than if they'd stayed (arrival-based learning).
- Important news travels faster: a ruler's death reaches sooner than a hamlet's fire from the same place.
- Standing in the liege town shows its market lines, not Millbrook's restock lines; back in Millbrook, restock lines show again.
- Followed person: an event about them shows in the feed regardless of the importance floor, once known.
- `playerKnows` is the only check used by the feed (a test that calls the feed builder with an event the player doesn't know and gets nothing).

## Done when (mapped)

| Done-when clause | Proved by |
|---|---|
| a war in a far kingdom appears in the player's "everywhere" feed only after its news reaches them, and in the admin view at once | first test + admin column |
| standing in Highdale shows Highdale's trades, not Millbrook's | trades test (with the liege town standing in for "Highdale") |

## Slice cut

Not in the slice as a phase, but the trades fix (step 4's first bullet) is a one-line bug that will confuse the playtest; do it during the slice.

## Out of scope

Gossip spreading to everyone (N33). The journal's redesign (N65). Following people in the game properly (N34).
