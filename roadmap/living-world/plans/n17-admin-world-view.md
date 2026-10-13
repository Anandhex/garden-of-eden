[← Plans](README.md) · [Stage 1: N17](../stage-1-foundations.md#n17-the-admin-world-view)

# N17 plan: The admin world view

**In one line:** a second page, `/admin`, that shows the whole world as it really is, lets you search anyone and pin people or places to follow, and never changes the game.

**Read first:** [plans README](README.md) sections 2 (determinism), 3 (truth vs knowledge), 6 (person refs), 7 (where code goes).

## What exists

- **Server:** [`web/server.ts`](../../../packages/server/src/web/server.ts) holds one live `world: SavedWorld`, a `town: Town`, a `store: WorldStore`, and routes in an `if` chain (`GET /api/state`, `GET /api/realm`, `GET /api/crowd`, `POST /api/tick`, …). Static files come from `client/dist`.
- **Realm read model:** [`realm/view.ts`](../../../packages/server/src/game/realm/view.ts) `realmView(realm)` → `RealmView` (shared [`protocol.ts`](../../../packages/shared/src/protocol.ts)), drawn as SVG by the game's Realm tab ([`client/src/ui/realm.ts`](../../../packages/client/src/ui/realm.ts)). `describeRealm` prints the numbers `sim:realm` shows.
- **Events, three kinds today:**
  - `GameEvent` (the player's and the cast's world, [`events.ts`](../../../packages/server/src/game/events.ts)): 300 in the save, all of them in SQLite (`WorldStore.archiveEvent`), with `witnesses` and `knownBy`.
  - `RealmNews` (`realm.news`, max 200, [`realm/log.ts`](../../../packages/server/src/game/realm/log.ts)): text, place, importance, `reaches` (Millbrook only).
  - `DirectorPush` (`realm.director`, max 80) with a `reason`; plus the N12 director's proposals in SQLite `director_log` with `reason`.
- **People:** cast `NpcState` (needs, emotions, relationships, rumours, goals, grudges: see [`npc/types.ts`](../../../packages/server/src/npc/types.ts)), realm `Figure`s ([`realm/types.ts`](../../../packages/server/src/game/realm/types.ts)), townsfolk rolled by `rosterFor` ([`realm/townsfolk.ts`](../../../packages/server/src/game/realm/townsfolk.ts)) and positioned by `CrowdSim.at(p, day, minute, d)` ([`shared/src/crowd.ts`](../../../packages/shared/src/crowd.ts)).
- **The player's standing:** [`reputation.ts`](../../../packages/server/src/game/reputation.ts), rumours per NPC (`state.rumours`, [`rumours.ts`](../../../packages/server/src/game/rumours.ts)), relationships to the player per NPC, debts, grudges.
- **Client build:** Vite, one entry (`client/index.html`), Phaser 3 for the map, plain DOM for panels.

## Decisions made in this plan

1. **A separate page, same server.** `client/admin.html` is a second Vite entry (`build.rollupOptions.input: { main: "index.html", admin: "admin.html" }`), served at `/admin`. It shares `@millbrook/shared` types and can reuse `CrowdLayer`/SVG drawing code by import, but has no game controls.
2. **Read-only means GET-only.** All admin data comes from `GET /api/admin/*`. Any other method on `/api/admin/*` answers 405. Pure functions in `server/src/admin/` take `(world, town, store)` and return plain data; they never write. A test hashes the world before and after calling every admin endpoint (see Tests).
3. **The admin page is local-only.** It answers only when the request comes from `127.0.0.1`/`::1`, or when `ADMIN=on`. It shows the truth (spoilers) and future interventions will be powerful; it must never be reachable from another machine by accident.
4. **Pins are not in the save.** They live in `saves/admin.json` (or the browser's localStorage; see below). The done-when says nothing on the admin page changes the save, and pins are admin state, not world state.
5. **Pinning must not change outcomes.** The stage file says a pinned NPC "is simulated at full detail (N25)". That's fine only if detail level never changes *what happens* (N25's rule: the same seed gives the same births, deaths and choices at every level of detail; detail only changes how finely we can see it). Until N25, "following" a townsperson needs no simulation at all: `CrowdSim.at()` is a pure function of roster, map and time, so their whole day can be computed on demand for any hour.
6. **Time controls act on the live game, and are the one exception to read-only** (confirmed by the user, 2026-10-13: the admin panel needs pause and step). Pause, step an hour/day and fast-forward call the same code as the player waiting (`passHours`, `/api/tick`). They're `POST /api/admin/time` (the only admin POST), go through the same `ActionQueue` as player actions, and are logged as `admin-time` entries in the director log so they're visible. The read-only test covers every other endpoint. (Observing a *copy* of the world with its own clock is N23's replay mode; don't build it here.)
7. **Live updates by polling with a cursor**, every 2 s while the tab is visible: `GET /api/admin/events?after=<cursor>`. No websockets. The server already streams NDJSON for talk; polling is simpler to test and fine at this rate.

## Data shapes (add to `packages/shared/src/admin.ts`)

```ts
/** One row in the admin event stream: any of the three event kinds, normalised. */
export interface AdminEvent {
  ref: string;            // "e:<GameEvent.id>" | "n:<RealmNews.id>" | "d:<director index>"
  day: number; hour: number;
  source: "game" | "realm" | "director";
  kind: string;           // GameEvent.kind, RealmNews.kind or DirectorPush.kind
  text: string;           // details / news text / push reason
  importance: number;     // 1..10
  site: string | null;    // settlement id where known
  people: string[];       // person refs involved (actor, target, names resolved to figures)
  factions: string[];
  why: string | null;     // the decision's reason: director reason now, NPC choice (N38) later
  causedBy: string[];     // empty until N20
}

export interface AdminOverview { day: number; hour: number; minute: number; realm: RealmView; totals: {...}; wars: ...; health: AdminHealth }
export interface AdminHealth { tickMs: Record<string, { last: number; p50: number; p95: number }>; counts: Record<string, number>; budgets?: unknown /* N19 */ }
export interface AdminPersonCard { ref: string; kind: "cast" | "figure" | "townsperson"; name: string; where: {...}; doing: string; sections: Array<{ title: string; rows: Array<[string, string]> } | { title: string; unavailable: string }> }
export interface AdminSearchHit { ref: string; kind: AdminPersonCard["kind"]; name: string; detail: string; site: string | null }
```

Keep person cards **section-based** (title + rows) rather than one big typed object: N25, N37, N38 and N40 add sections (ambitions, grievances, choices) without changing the client. A section that isn't built yet is `{ title, unavailable: "N38" }`, so the page shows what's coming.

## Steps

### Step 1: routes module, guard and the read-only harness
- Add `server/src/web/routes/admin.ts` exporting `handleAdmin(req, res, ctx): boolean`; call it from the `if` chain before the static file handler. `ctx = { world: () => world, town: () => town, store, realm: () => world.realm ?? null }` (functions, because `world` is reassigned on new game).
- Local-only guard and 405 for non-GET (except `/api/admin/time`).
- Add `worldHash(world)` now in `server/src/game/hash.ts` (sha256 of canonical JSON, sorted keys). N18 extends it to the database. You need it for this phase's main test.
- Test: `GET /api/admin/overview` from a non-local address → 403; `POST /api/admin/overview` → 405.

### Step 2: the overview
- `admin/overview.ts`: `overview(ctx)` → `AdminOverview`, built on `realmView` plus per-settlement population by class. Population by class: `rosterFor(realm, site, map, day)` for each settlement is expensive (a capital is up to 5,000 people). Cache the class counts per `(site, population, realm.day)`; compute lazily per settlement when its row is opened, and at most a few per request. After N18 this becomes a `GROUP BY` query.
- Armies, packs, caravans on the map: packs are `realm.packs` (place = `near`); wars have no army positions yet (N55), so show war fronts as lines between the warring sides' seats; caravans exist only as `HomeEvent` kind `caravan` (N26 makes them real journeys). Draw what exists; leave a legend entry "(from N26)" for what doesn't.
- Client: `client/src/admin/main.ts` draws the realm map (lift the SVG drawing out of `ui/realm.ts` into a shared `client/src/realmMap.ts` both pages import; don't copy it) plus a side table of numbers.

### Step 3: the event stream
- `admin/events.ts`: merge GameEvents (from the store, not just the 300 in the save), realm news and director pushes into `AdminEvent`s, newest first, with filters `site`, `faction`, `person`, `kind`, `minImportance`, `source`, and a cursor (`day:hour:ref`).
- **Resolving people in realm news:** news is text with `names[]`. Map each name to a figure id (`realm.figures` by name; names are unique in a realm, `takenNames`). Add an optional `people?: string[]` to `RealmNewsSchema` and fill it in `realmNews()` at the source from now on, so this stops being a text match. Same for `site` (already `at`).
- **The why:** `DirectorPush.reason` and `director_log.reason` already exist. Add `why?: string` to `GameEvent` and `RealmNews` now (optional, in the schema) and fill it wherever code makes a choice with a reason: director pushes, succession picks, war declarations (`declareWar`'s `cause`), faction splits (`split`'s `why`), treaty breaks. Grep for `why` and `cause` parameters in `realm/*.ts`; most already have one, it just isn't kept on the news.
- Client: a virtualised list (render only visible rows; the stream can hold thousands), filter chips, click a row to see the full event, its people (click → pin) and its why.

### Step 4: search
- `admin/search.ts`: `search(ctx, q, filters)` across: the cast (`town` personas, `npcStates`), visitors, figures (alive and dead), townsfolk of every settlement, beasts (figures with role `beast`, creatures in `world.creatures`, `haunts`). Match name, class, job, role, place, faction.
- Townsfolk: until N18 there's no index. Build a lazy in-memory index per settlement from `rosterFor` (name, job, class, faction), keyed by `(site, population, realm.day)`, built on first search and dropped when the key changes. A realm today is 36 settlements and about 24,500 people (seed 1); building all at once can take seconds, so build progressively and return partial results with `complete: false`. After N18 this is a SQL `LIKE` on an indexed name column.
- Return at most 50 hits, best first (exact name, then prefix, then contains).

### Step 5: person cards and pinning
- `admin/person.ts`: `card(ctx, ref)` → `AdminPersonCard`, one builder per kind:
  - **Cast:** where (place, area, site), doing (schedule entry now, `npcPlace`), needs, emotions, goals, grudges, relationships (to the player and to other NPCs, top 10 by strength), rumours they hold (with who told them, if recorded), known events (`knowsEvent` over the store's events about them), family (`family.ts` marriages, children, parents), timeline (`store.eventsAbout(id)` with `why`).
  - **Figure:** role, home, superior chain (`chainOf`), faction and rank (`rankIn`), life (tier, age stage), renown, wealth, deeds, parents, alive/death.
  - **Townsperson:** roster fields (class, job, home, work, master, faction), and **their day**: call `CrowdSim.plan(p, day, d)` and `at(p, day, minute, d)` for each hour 0–23 of today. That's "pinning a townsperson in another town shows their day hour by hour" with no simulation. Build the `CrowdSim` for that site's map (`siteMap(settlement, "village", realm)`) and cache it per site.
  - Sections not built yet (needs and emotions for townsfolk, ambitions, choices) return `unavailable` with the phase.
- **Pins:** `GET /api/admin/pins` reads `saves/admin.json`; adding or removing a pin is a client-side action stored in **localStorage** on the admin page. (A POST would break decision 2; localStorage keeps the server pure.) The server takes the pin list as a query parameter (`GET /api/admin/pinned?refs=a,b,c`) and returns the cards. Pins of a place return a place card (settlement numbers, who's notable there, today's events there).
- **Pinned NPC follows full detail (later):** expose `pinnedRefs` to the simulation through a read-only getter only once N25 exists, and only for *display granularity*. Write that rule in a comment where it's read.

### Step 6: pinning the player
- `admin/player.ts`: for every NPC that has any belief about the player, a row: relationship axes to the player, rumours about the player (`state.rumours` entries with `about === "player"`, with accuracy and day), grudges against the player, debts, the reputation they'd see. Then a **"who believes what"** table grouped by rumour key: rumour text, truth, holders (with accuracy), first heard.
- The done-when needs "a rumour about them and who believes it": in the test, start one with `hearRumour` on two NPCs and check both appear under it.

### Step 7: time controls and following
- `POST /api/admin/time` with `{ action: "pause" | "resume" | "step-hour" | "step-day" | "fast", days? }`. Pause sets a server flag that makes `/api/tick` a no-op (the game's ⏸ button already does this per browser; the admin's pause is server-wide). Step and fast-forward run through the same `ActionQueue` and the same `passHours` the player's wait uses. Fast-forward is capped (e.g. 30 days per call) and reports progress.
- Log each as a director-log entry kind `admin-time` so the event stream shows it.
- **Follow:** when a pinned person is selected and "follow" is on, the admin page shows that person's current map. For a townsperson or cast member in a settlement: draw that site's map and crowd with the same `CrowdLayer` code the game uses, read-only, centred on them. Fetch the roster with a new `GET /api/admin/crowd?site=<id>` (today's `/api/crowd` only returns the player's site).

### Step 8: health
- Add `server/src/metrics/timing.ts`: `timed(name, fn)` keeps the last 200 durations per name in a ring buffer, and `snapshot()` → `{ last, p50, p95 }`. Wrap `realmDay` (and its sub-steps: economy, factions, director, raids, wars, packs, dungeons), `passHours`, `CrowdSim.all`, `persist`/`saveWorld`.
- Counts: active fights, factions, kingdoms, population, figures alive, events today, queue length, `realm.stats`.
- N19 adds budgets next to each timing; leave a `budgets` field.

### Step 9: docs
- README: "Admin view: `npm run web`, then open `/admin` (local only)." What each panel shows. Tick the stage file, write **How it's built**.

## Edge cases and traps

- **`world` is reassigned** on `/api/new`. Never capture it in a closure at module load; always go through `ctx.world()`.
- **Don't mutate while reading.** Several existing helpers create on read (`familyOf` may default fields, `world.events ??= []`, `this.world.haunts ??= {}`). Calling one from an admin path writes to the save. Read with plain optional chaining in admin code; if you must call a helper, check it doesn't use `??=` on world state. The hash test is what catches this.
- **`rosterFor` depends on the realm's current state** (factions, population). A townsperson's details can shift when the realm changes until N18 freezes them. Show `rolled on day N` on townsperson cards so this isn't mistaken for a bug.
- **Realm news text vs figure names:** a name can be shared by a dead and a living figure only if `takenNames` allows reuse; check, and prefer `people[]` once it's filled.
- **Big payloads:** a capital roster is ~5,000 people. Never send all rosters at once; page everything.
- **Spoilers in the game page:** admin code must not be imported by the game client bundle. Keep `client/src/admin/` imported only from `admin.html`. The build test can grep the main bundle for an admin-only string.

## Tests (`packages/server/tests/n17.test.ts`)

- **Nothing changes the save:** build a world (fixed seed, model off), run a few days, take `worldHash`; call every `GET /api/admin/*` endpoint with typical parameters (or call the `admin/*.ts` functions directly); hash again; equal. Also check `world.events.length`, `realm.next`, and that `store.eventCount()` didn't change.
- **Overview:** has every kingdom and settlement, numbers match `describeRealm`.
- **Event stream:** run until a war starts, a figure dies and the director pushes (fixed seed; find one with `sim:realm` and pin it in the test); the stream holds all three with a non-empty `why` for the war and the push; filters by site and person work; the cursor returns only newer rows.
- **Search:** finds a cast member, a figure, a townsperson of another settlement by name, a beast.
- **Pinned townsperson:** their hour-by-hour day has 24 entries; they're at home at 03:00 and at work at 10:00 on a work day (compare with `CrowdSim.at`).
- **Pinned player:** two NPCs who heard a rumour about the player both show under it with accuracy.
- **Guard:** non-local → 403; non-GET → 405; `POST /api/admin/time step-hour` moves the clock one hour and logs `admin-time`.

## Done when (mapped)

| Done-when clause | Proved by |
|---|---|
| shows the realm map and its numbers | overview test + browser check |
| event stream shows a war, a death and a director push with their reasons | event stream test |
| pinning a townsperson in another town shows their day hour by hour | pinned townsperson test |
| pinning the player shows a rumour and who believes it | pinned player test |
| nothing on the admin page changes the save (except the time controls, by design) | hash test over every GET endpoint; time-control test checks only the clock moved and an `admin-time` entry was logged |

## Slice cut

For the vertical slice: steps 1–5 and 8 (overview, events, search, person cards, health) for all places; pinning the player (step 6) and time controls (step 7) can be minimal (step-hour, step-day only).

## Out of scope

Interventions (spawn, kill, edit, trigger, nudge): their own later phase, per the open decision. Replaying a copy of the world: N23. Budgets: N19. Cause chains: N20.
