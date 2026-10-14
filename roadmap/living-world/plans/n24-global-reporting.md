[← Plans](README.md) · [Stage 1: N24](../stage-1-foundations.md#n24-global-reporting)

# N24 plan: Global reporting

**In one line:** the player has a knowledge record of their own; the feed shows only what's in it, in three scopes (here, my kingdom, everywhere); news reaches **every place** at the speed travellers carry it, so the player, and the talking people of every town, learn it when it reaches *their* place, not Millbrook; and the feed stops reporting Millbrook's trades when the player is somewhere else.

> **Changed by [N26 Part E](n26-the-open-road.md#part-e-everyone-on-the-road-is-someone-rework-asked-for-2026-10-14) (2026-10-14):** news no longer follows a computed relay or a formula. A place hears a piece of news only when a real traveller brings it, and travellers swap news at the inns along the road (crown couriers carry great news). `reachesAt(news, site)` becomes "the day this place heard it, or not yet". The player learns news from the place they're in and from the travellers they meet. Where this plan computes arrival days in advance, Part E replaces it.

**Read first:** [plans README](README.md) section 3 (truth vs knowledge). Needs N17 (admin view, the truth side) and N18 (events with `site`/`kingdom` columns).

## What exists

- **News timing is Millbrook-only.** `realmNews()` in [`realm/log.ts`](../../../packages/server/src/game/realm/log.ts) sets `reaches = day + travelDays(realm, at, HOME_ID)`; `deliverNews()` in [`realm/news.ts`](../../../packages/server/src/game/realm/news.ts) delivers due news to Millbrook's NPCs as lore (`realm.<id>`) and returns lines for the player. **People of other places use Millbrook's clock too.** A visitor's persona ([`visitors.ts`](../../../packages/server/src/game/realm/visitors.ts) ~line 133) gets `knows: { "realm.*": "rumour", … }`, and realm news only *becomes* lore when `deliverNews` delivers it to Millbrook. So a visitor knows exactly the news that has reached Millbrook: someone in the town where a fire broke out learns of it only when the news reaches Millbrook (days later), and someone far away knows news from near Millbrook that couldn't have reached them. `n.delivered` is a single Millbrook-only flag.
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
5. **Every place has its own news clock (added 2026-10-13 at the user's request).** The same `reachesAt(news, site)` rule that times the player's news times what the talking people of every place know. Realm news gets a lore entry when it happens (lore existing isn't anyone knowing it); who knows it is per person (`state.learned`), filled by per-place delivery, never by a `realm.*` wildcard. Millbrook keeps its current delivery rules (certain for locals awake, rumour for gossips, the inn and gate crowd, guards for war); every other place uses the same rules. Non-talking townsfolk hold no lore until N33; when one is first spoken to, their persona starts with what has reached their place by then.
6. **The trades fix:** the feed reports trades of **the site the player is at**. Millbrook's cast trades are only reported while the player is in Millbrook. For other sites, there are no trade events today (N16's townsfolk traders don't trade). Add a small deterministic **market day summary** per site: from the site's roster traders, `marketLines(site, day)` produces a few trade lines ("Wenna the baker sold out of rye loaves") seeded by `(seed, site, day)`, emitted only when the player is at that site at market hours. This is cosmetic for now and marked as such; N38/N40 make it real.

## Steps

### Step 1: `player.known`
- `server/src/game/playerKnowledge.ts`: `playerKnows(ref)`, `playerLearns(ref, how, from?)`, `knownSince(ref)`, `knownRefs({ sinceDay, scope })`. Backed by the `knowledge` table; an in-memory set for the session for speed, flushed with N18's batch.
- Seed it on a new world with lore the player starts knowing (whatever the opening tells them).
- Make every existing player-facing "the player now knows" path call `playerLearns`: witnessing (`recordEvent` when the player is present: add `"player"` to witnesses/knownBy by the same rule as NPCs), the journal's `note()` (things noted are known), news delivered at Millbrook today.

### Step 2: news reaches the player anywhere
- `reachesAt(realm, news, site)` in `realm/news.ts`: the one rule for when news reaches any place (the player's and, in step 2b, everyone's). `reaches` (Millbrook only) goes away in step 2b.
- Each hour (or on arrival at a site, and on each day change), `deliverToPlayer(site, day)`: news with `reachesAt(site) ≤ day` and not yet known → `playerLearns(ref, "news")` → feed item.
- Travelling: on arrival at a site, everything that has reached that site is learned at once (with the arrival day). While on the road (N26), news is learned from travellers met (N26 hooks into `playerLearns(ref, "told", traveller)`).
- Speed factor: `importance ≥ 8 → 0.5`, `≥ 6 → 0.75`, else 1. Constants in `news.ts`. This applies to Millbrook too, so Millbrook's arrival days change a little for important news; update the N13 tests that pin arrival days on purpose (say so in the commit), don't special-case Millbrook.

### Step 2b: every place hears news on its own clock
- **Lore at creation:** `realmNews()` creates the lore entry for news of importance ≥ `DELIVER_IMPORTANCE` when the news is made (same entry `deliverNews` builds today: `realmNewsId`, `shortName`, `keywordsFor`, `newNames`). Nobody knows it yet.
- **Per-place delivery state:** replace the single `n.delivered` flag with a SQLite table `news_delivered(news_id, site, day)` (v11 is a clean break, so no migration). Drop `reaches` from `RealmNewsSchema` and use `reachesAt(news, site)` everywhere.
- **`deliverNewsAt(realm, world, site, listeners, day)`:** generalise `deliverNews`. Due news for that site (`reachesAt(news, site) ≤ day`, not yet in `news_delivered` for the site), at most `DELIVER_PER_DAY` per site per day, best first; the same listener rules as today with `local = n.at === site`. Millbrook calls it with `HOME_ID` and the cast as listeners, so Millbrook behaves as before.
- **Which places, and when:** places whose talking people exist (Millbrook's cast and notables; `world.visitors` grouped by their site). Deliver to Millbrook daily as now. For other places, **catch up lazily**: when the player arrives at a place, or a visitor from it is about to speak, run `deliverNewsAt` for every day since that site's last delivery (a `news_sites(site, last_day)` row). With the per-site daily cap applied day by day, catch-up gives the same result as daily delivery (test it). Use the listener's schedule for the day each item arrived (awake, at the inn or gate) when deciding certain vs rumour, so catch-up matches what would have happened.
- **Visitor personas:** in `visitors.ts`, remove `"realm.*": "rumour"` from `persona.knows`; keep the place scopes (`realm.place_<site>` and neighbours, certain). Their news knowledge comes only from `state.learned` filled by delivery. Millbrook's home notables (`homeKnows`, `"realm.*": "rumour"`) change the same way; check what else `realm.*` covered for them (place lore, the guild, the dungeon) and give those scopes explicitly so nothing they knew is lost.
- **First meeting:** `townsfolkPersona` and `personaFor` start a new talking person with everything that has reached their site by today (local news certain, the rest rumour), so a townsperson spoken to for the first time knows their town's news.
- **Lore pruning:** today's `KEEP_LORE = 60` prune removes the oldest realm news lore and `learned` entries from Millbrook's listeners only. Prune by age across all places and remove the `learned` entries from **every** talking person (cast and visitors), or a visitor keeps pointing at lore that's gone (the persona schema rejects scopes that match nothing; `learned` ids that match nothing must be dropped too).
- **Not simulated off-screen:** visitors don't gossip with each other while the player is away (as today). N33 adds that.
- **The player's feed:** `deliverNews`'s returned lines ("Travellers bring news: …") come only from the player's current site's delivery, through `playerLearns` (step 2), never from Millbrook's when the player is elsewhere.

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
- **Same rules, many places:** don't copy `deliverNews` for visitors; generalise it to take a site and listeners, and call it for Millbrook too. Two copies drift.
- **Catch-up equals daily:** delivering 20 days at once must give each visitor the same `learned` (and certainty) as delivering daily. The per-day cap and per-day schedule checks are what make this true; a single "deliver everything due" call would break it.
- **Determinism:** learning depends on the player's position, which is an input (journal, N23); that's fine.

## Tests (`packages/server/tests/n24.test.ts`)

- A war starts in a far kingdom on day d: not in the player's feed on day d (admin stream has it); in the "everywhere" feed on `reachesAt(home)`; not in "here".
- The player travels toward the war: they learn it earlier than if they'd stayed (arrival-based learning).
- Important news travels faster: a ruler's death reaches sooner than a hamlet's fire from the same place.
- Standing in the liege town shows its market lines, not Millbrook's restock lines; back in Millbrook, restock lines show again.
- Followed person: an event about them shows in the feed regardless of the importance floor, once known.
- **Every place has its own clock:** news happens at town A on day d. A talking person of A who is awake knows it for certain on day d. A talking person of town B (farther from A than Millbrook is) doesn't know it on the day it reaches Millbrook, and does on `reachesAt(news, B)`. Someone in town C next to A knows it before Millbrook does.
- **Catch-up equals daily:** a visitor site delivered daily for 20 days and the same site caught up once at day 20 give identical `learned` maps.
- **First meeting:** a townsperson of A spoken to for the first time on day d+1 knows A's news.
- **Millbrook unchanged:** the existing N13 news tests pass (apart from arrival days changed on purpose by the speed factor).
- **Pruning:** after more than `KEEP_LORE` realm news, no talking person anywhere holds a `learned` id whose lore is gone.
- `playerKnows` is the only check used by the feed (a test that calls the feed builder with an event the player doesn't know and gets nothing).

## Done when (mapped)

| Done-when clause | Proved by |
|---|---|
| a war in a far kingdom appears in the player's "everywhere" feed only after its news reaches them, and in the admin view at once | first test + admin column |
| standing in Highdale shows Highdale's trades, not Millbrook's | trades test (with the liege town standing in for "Highdale") |
| people in the town where something happened know it that day, and people farther away learn it when it reaches *their* place, not when it reaches Millbrook | "every place has its own clock" test |

## Slice cut

Not in the slice as a phase, but the trades fix (step 4's first bullet) is a one-line bug that will confuse the playtest; do it during the slice.

## Out of scope

Gossip spreading to everyone (N33). The journal's redesign (N65). Following people in the game properly (N34).
