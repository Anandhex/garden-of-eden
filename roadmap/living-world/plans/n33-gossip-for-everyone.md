[← Plans](README.md) · [Stage 2: N33](../stage-2-everyone-lives.md#n33-gossip-for-everyone)

# N33 plan: Gossip for everyone

**In one line:** every person keeps a short list of what they know (a row per item in the `knowledge` table, with how accurate their version is and who told them); people who are together (a workshop, a household, the inn in the evening, the market) pass items on by sampled pairs, losing accuracy; news enters a place only by someone arriving with it (N26's messengers, caravans, migrants, any traveller); and a townsperson who becomes a talker starts with what they knew.

**Read first:** [plans README](README.md) sections 2, 3 (truth and knowledge), 9 (performance), 15 (the `knowledge` table is this phase's), 17 (grains). Needs N18 (tables), N25 (people who live by day, lazy catch-up), N26 with **Part E** (real people on journeys, `people.away`, news carried by travellers and swapped at inns: `journey.carries`, `newsSeen` days, `exchangeNews`). **Step 0:** N24 steps 1–3 (`player.known`, `playerKnows`, `playerLearns`) if not built, because the done-when has the player hearing a rumour from a stranger.

## What exists

- **Gossip among talkers** ([`gossip.ts`](../../../packages/server/src/game/gossip.ts)): `gossipTogether(group, day, rng, world)`: every pair in a place each hour, chance from sociability and friendship (`gossipChance`), belief from `credence` ([`npc/social.ts`](../../../packages/server/src/npc/social.ts): `0.6 + trust/200 + affection/400`). Passes the player's name, important memories (`GOSSIP_IMPORTANCE`, `RETELLING_LOSS`), rumours ([`rumours.ts`](../../../packages/server/src/game/rumours.ts): accuracy, `RETELL_LOSS`, `MIN_ACCURACY`), death news, event knowledge (`knownBy`). Only talkers (`npcStates`).
- **Lore and news for talkers** ([`npc/knowledge.ts`](../../../packages/server/src/npc/knowledge.ts)): `learnLore`, `knowsOf`, certainty levels; realm news delivered per place on its own clock (`deliverNews` in [`realm/news.ts`](../../../packages/server/src/game/realm/news.ts), `site.newsSeen`).
- **News by people (N26 Part E):** realm news is known **by places** (`SiteState.newsSeen` with the day) and **carried by travellers** (`journey.carries`, filled at departure); `exchangeNews(day)` swaps it at every stop (inns, visits, destinations) in time order; crown couriers carry great news; `reachesAt(news, site)` is the day the place first heard it, or null. (Part E deletes the old relay, `relay.ts`.) Knowledge is per **place**: everyone in a place "knows" once the place does.
- **Journeys** ([`road/journeys.ts`](../../../packages/server/src/game/road/journeys.ts), [`sources.ts`](../../../packages/server/src/game/road/sources.ts)): caravans, messengers, patrols, pilgrims, adventurers, migrants; in `world.journeys`, a formula of time.
- **The crowd** knows who stands near whom each minute (`CrowdSim.chats`), and chat lines are cosmetic ([`shared/crowd.ts`](../../../packages/shared/src/crowd.ts) `chatLines`).
- **The table:** `knowledge(who, ref, learned_day, source, accuracy)`, empty, index on `ref`.
- **Townsfolk become talkers** with `townsfolkPersona` ([`realm/townsfolk.ts`](../../../packages/server/src/game/realm/townsfolk.ts)) and depth from `npc/depth/facts.ts`.

## Decisions made in this plan

1. **What can be known is a ref.** `n:<realmNewsId>` (realm news), `e:<eventId>` (a game event: a death, a theft, an insult from N37), `r:<rumourKey>` (a rumour about someone), `d:<personId>` (a death of a townsperson, from N25's record, so every death is gossip without making an event per death), `s:<secretId>` later (N46). One function `describeKnown(ref, accuracy, variant, world)` renders what the person would say.
2. **A compact record per person:** `knowledge(who, ref, learned_day, source, accuracy, variant)` (add `variant` with a migration). `source` is a person ref or `carrier:<journeyId>` or `saw`. **Cap 24 items per person**, keeping the most important by `importance × freshness`; the rest are dropped (people forget).
3. **Who meets is a venue, not a pair loop.** Each day (each hour in the player's place) people are bucketed by **venue**: household (home), workplace (building), the inn (evening, by sociability and coin), the market (market days), the temple (rest days), the square (festivals). In each venue of size *n*, sample `k = ceil(n × talkRate)` speaker–listener pairs, weighted by sociability and relationship (N37's table when it exists; until then, household and co-workers count as warm). Cost O(people), never O(people²).
4. **What gets passed:** the speaker's most *tellable* item the listener doesn't have (importance × freshness × "about someone the listener knows" bonus). The listener believes it with `credence(trust, affection)` (the same formula, from the relationships table); disbelieved items are still kept with low accuracy ("I heard, but I doubt it"). Accuracy after a retelling: `acc × (1 − RETELL_LOSS) × credence`; under `MIN_ACCURACY` the item is dropped.
5. **Distortion is a variant, picked by seed.** Each retelling may change one detail with chance `1 − acc`: who did it (swapped for a plausible person: same place, related), where (a neighbouring place), how many, or why. The change is a small integer `variant` chosen from `streamFor(seed, "gossip", who, ref, day)`, and `describeKnown` renders the variant deterministically. So "the smith's wife died of fever" can become "the smith died" or "of the plague". The truth stays in the event/record; only the telling changes.
6. **News enters a place only with a person, and then only the people who met them know.** This refines N26 Part E from places to people:
   - **What a traveller carries is what they know.** Since every traveller is a person row (Part E decision 1), `journey.carries` becomes a view of the party members' own knowledge rows at departure (top tellable items, up to Part E's `CARRY_MAX`), so a caravan driver tells what *he* heard, in *his* version. Local events (a townsperson's death, an insult) travel the same way as realm news: whoever knew it when they left carries it.
   - **Part E's exchange at each stop, made personal:** the place side of `exchangeNews` is the people the travellers actually meet there: the inn's household and the people in the inn venue that evening, the market venue on a market day, the kin they visit. They get knowledge rows (source = the traveller); the travellers pick up what those people know. Part E's place-level `newsSeen[id].day` stays as "the first day anyone here knew it" (set by the first knowledge row), so `reachesAt` and everything that reads it keep working.
   - **Crown couriers** (Part E) seed the head and the crier's audience (the square on the next morning) for great news.
   - **Migrants and people coming home** carry their rows with them (rows are keyed by `who`) and gossip in the place they arrive at.
7. **Talkers and townsfolk are one gossip.** Talkers in a venue speak and listen like anyone: a talker telling a townsperson writes a knowledge row from the talker's lore/rumours; a townsperson telling a talker calls `learnLore`/`hearRumour`. The existing `gossipTogether` stays for talker pairs (it carries more: names, memories).
8. **Becoming a talker carries it over.** `townsfolkPersona` (and the depth facts) seed the new talker's rumours and lore from their knowledge rows, with the same accuracy and variant, so they tell the player the version they heard.
9. **The player hears it like anyone.** Talking to someone with an item the player doesn't know: they may share it (the talker's normal news talk), and `playerLearns(ref, "told", who, accuracy, variant)`. The player's journal (N65) keeps the version they were told.
10. **Lazy places stay pure.** A lazy place's gossip for its missed days runs in its catch-up, day by day, from its rows, its `site_days`, and the exchanges into it (Part E's realm-wide daily exchange log: who arrived with what, which is saved data).

## Data shapes

```ts
// knowledge row (schema migration adds variant)
{ who: string; ref: string; learned_day: number; source: string; accuracy: number; variant: number }
// Journey.carries (Part E) entries gain accuracy and variant, filled from the party's knowledge rows:
carries?: Array<{ ref: string; accuracy: number; variant: number; from: string /* the party member */ }>;
// SiteDay gains nothing; arrivals are read from Part E's exchange log.
```

## Steps

### Step 0: N24 steps 1–3 if missing
- `player.known`, `playerKnows`, `playerLearns` as written in the [N24 plan](n24-global-reporting.md).

### Step 1: the record and the renderer
- `game/gossip/knowledge.ts`: add, get, cap, top-tellable, move-with-person; schema migration (`variant`).
- `game/gossip/describe.ts`: `describeKnown(ref, acc, variant, world)` for each ref kind, with variants (who/where/how many/why).
- Test: a death ref renders true at accuracy 1 and wrong in a stable way at a low-accuracy variant; capping keeps the 24 most tellable.

### Step 2: venues and daily spread
- `game/gossip/venues.ts`: bucket a place's living rows into venues for a day (households from `home`, workplaces from `work`, the inn by sociability and wealth, the market on market days, the temple on rest days); `game/gossip/spread.ts`: sample pairs with `streamFor(seed, "gossip", site, day, venue)`, pass items.
- Called in the day's life step for live places (after deaths, so the deaths are gossip), and in catch-up for lazy ones.
- Test: a death in the start town is known by most of its people within three days and by none in the liege town (no traveller yet).

### Step 3: hourly in the player's place
- The active place runs spread hourly using the crowd's positions (people within 3 tiles in the same building or zone form a venue), at a lower rate per hour so the day's total matches the daily model.
- Chat bubbles: when a crowd pair is chatting and one passes an item, the bubble shows a short line of it (from `describeKnown`) instead of a cosmetic line, now and then.
- Perf test: a capital of 3,000 people, an hour of gossip under 5 ms server time (median, `PERF_SLACK`); the browser's 60 fps is unaffected (it does no gossip; bubbles are already drawn).

### Step 4: news enters with people
- `journey.carries` from the party's knowledge rows; Part E's `exchangeNews` writes knowledge rows for the people met at each stop (inn venue, market, kin), and reads theirs back; couriers seed heads; migrants and returners carry their rows; `newsSeen` days set from the first row.
- Test (done-when): a death in the start town reaches a labourer in the liege town only after a journey from the start town arrived there (check the labourer's row before and after the journey's arrival time; also a run with journeys turned off: never arrives).

### Step 5: talkers in the same gossip
- Talker ↔ townsperson exchange in venues; talker pairs keep `gossipTogether`.
- `townsfolkPersona` seeds from knowledge rows.
- Test (done-when): a townsperson the player has never met tells the player a rumour, slightly wrong (fixed seed: their accuracy < 1 and their variant differs from the truth; the player's known entry holds that version).

### Step 6: admin and docs
- Admin: a person's card lists what they know (ref, accuracy, from whom, when); a ref's page shows who knows it, on a map of places (spread over time).
- README: how news spreads.

## Balance bounds

- `knowledge-bounded`: rows ≤ 24 × living people.
- `news-travels`: important local events reach a neighbour place within a few days when roads are open and travelled.
- `gossip-not-instant`: no place learns a far event before a carrier could have arrived (checked against the exchange log: every row has a source who was there).

## Edge cases and traps

- **Two news systems:** Part E's place-level `site.newsSeen` (and `recentEvents`, what talkers there talk about) and knowledge rows. Keep `newsSeen[id].day` as "first known here" (written when the first row appears), make the place's "talk of the town" a query over knowledge rows (top refs by count), and have `recentEvents` read it, so there's one truth of who knows what.
- **Performance of the daily step:** sampling pairs must be O(people) with small constants; don't load all knowledge rows of a place into JS objects every day. Read the rows for sampled speakers only (one query by `who IN (...)`), batch writes in one transaction.
- **Stable order:** venues sorted by id, members sorted by id before sampling (section 2).
- **Death refs:** `d:<personId>` only for deaths from now on; don't backfill history.
- **Variants must not contradict the truth the admin sees;** the admin shows both.

## Tests (`packages/server/tests/n33.test.ts`)

The done-when ones:
- A death in the start town reaches a labourer in the liege town only after a caravan or traveller has gone between them.
- A townsperson the player has never met tells the player a rumour, slightly wrong.
- 3,000 people in a capital gossip without dropping below 60 fps (server hour under budget; client unaffected: the frame test in [`client/tests/frame.test.ts`](../../../packages/client/tests/frame.test.ts) with gossip bubbles on).

## Done when (mapped)

| Done-when clause | Proved by |
|---|---|
| a death in Millbrook reaches a labourer in Highdale only after a caravan or traveller has gone between them | step 4 test (Part E makes it reach the *place*; this phase makes it reach the *labourer*, through the people the traveller met) |
| a townsperson the player has never met can tell the player a rumour, slightly wrong | step 5 test |
| 3,000 people in a capital gossip without dropping below 60 fps | step 3 perf test + play |

**Save:** the next schema version (`knowledge.variant`); the next save version (`Journey.carries` entries gain accuracy and variant).

## Slice cut

All of it, for the start town and its liege town (the other places run the same code; there's no reason to switch it off elsewhere unless the perf budget says so, in which case lazy places skip gossip until they're activated and catch up).

## Out of scope

Insults and other interactions as gossip (N37 makes them events, and they spread through this). The player planting rumours (N52). Languages that garble news (N53). Following people (N34).
