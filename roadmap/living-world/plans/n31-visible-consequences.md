[← Plans](README.md) · [Stage 2: N31](../stage-2-everyone-lives.md#n31-visible-consequences-on-the-map)

# N31 plan: Visible consequences on the map

**In one line:** a place's map stays generated from its seed, and a list of **marks** (burned, broken, being built, a grave, an empty stall, a banner, extra guards) is laid over it from the realm's and the people's real state; marks are records with a start, an end and a cause, repaired or faded by code, and the browser draws them as a layer.

**Read first:** [plans README](README.md) sections 2, 15, 17, 18. Needs N25 (typed deaths with site and event), N30 (seasons, for fading and rebuilding pace). Uses N20 step 1 (a mark's cause is an event ref) **if built**; until then marks keep the realm ref they came from (`raid:34:ashby`), the same string N25's casualty orders use. Later phases add mark kinds: N55 (war graves, memorials), N58 (curfew guards, banners), N62 (fire, flood), N54 (dragon burn).

## What exists

- **Maps** are `siteMap(s, area, realm)` ([`web/sites.ts`](../../../packages/server/src/web/sites.ts)), cached by a key that includes `JSON.stringify(s.buildings)` and `s.houses`: **today the whole layout is re-rolled when a building level changes**, so a raid that knocks down the walls (`damageBuilding` in [`realm/diplomacy.ts`](../../../packages/server/src/game/realm/diplomacy.ts) lowers a level by one) can shuffle every house. That has to stop before marks mean anything (step 1).
- Buildings in a map: `{ name, x, y, w, h, kind, color, front }` with doors; houses are `kind: "house"` and townsfolk have `home` (house index) from the roster.
- Building projects: `settlement.project` (`{ building, done, cost }`), finished in `economyDay`.
- Deaths: N25 typed records on `people.death` (`cause, day, site, event, killer`), figures' `death`.
- Famine: `site_days.famine`; the crowd's market stalls are drawn from traders in the roster ([`CrowdLayer.ts`](../../../packages/client/src/world/CrowdLayer.ts)).
- Faction branches (`faction.branches`) and kingdoms' colours exist; nothing draws them.

## Decisions made in this plan

1. **The layout is fixed for the place's whole life.** The map is generated from the seed and the place's **largest plan**: at realm generation, each settlement gets lots reserved for every building it could reach (`MAX_LEVEL` of each, plus houses for growth). A building that isn't built yet is an empty lot (grass, or a fenced plot); a destroyed one is a ruin on the same lot; a new one appears on its reserved lot. The cache key drops `buildings`/`houses` and keeps only `site id, area, kind`. Growth from village to town that needs more space: the map is generated for the biggest kind the place could become within its band, and the outer lots stay empty fields until used. **This is the big change in this phase; do it first and prove nothing moves.**
2. **Marks are records.** A small table `marks(id, site, kind, x, y, w, h, ref, cause, since, until, data)` in SQLite (section 15: add to `TABLES`). Kinds: `burned`, `ruin`, `scaffold`, `grave`, `stall_empty`, `banner`, `guards`, `smoke_damage`, `boarded`, `memorial`. A mark is placed on a building's lot (by building index) or a tile.
3. **Marks come from state, by rules in one module.** `game/marks/rules.ts`, run in the realm's day for each place (cheap; only places with changes):
   - A raid that damaged a building (`damageBuilding` returns which) → that building's lot `burned` (or `ruin` at level 0), `cause` = the raid ref; a raid on a place also burns 1–3 houses by seed.
   - A building under construction (`settlement.project`) → `scaffold` on its reserved lot until done; then the mark ends and the building is drawn.
   - Rebuilding: a `burned` house is repaired after `REPAIR_DAYS` scaled by the place's prosperity (a poor place leaves ruins for a season); a burned building is repaired when the economy rebuilds its level.
   - **Graves:** every death with this `site` and a body (not `missing`, not died away) adds a `grave` in the graveyard zone, in order (rows filling up), with the person ref; the browser shows "Name, d. day N, killed in the raid on X" on hover. Graveyard size grows with the place; old unmarked graves (no family left, older than ~10 years) fade to unnamed mounds to keep counts bounded.
   - **Famine:** `stall_empty` on market stalls in proportion to `site_days.famine`; the crowd gets thinner because N25's deaths and migration already happen; nothing faked.
   - **Banners:** a faction with a branch here → its banner on its building (guild hall, temple, a rebel's mark painted on a wall when the place's mood is defiant, N56); the ruler's colours on the hall, changed when the ruler or kingdom changes (N56/N64).
   - **Curfew guards** (N58 sets the flag): extra guard posts; until N58 the hook is there with no source.
4. **Light from who's home.** Lit windows at night and chimney smoke are not marks: the browser computes them from the roster and the crowd (who is in which house now) and the season (smoke in cold weather). No server work.
5. **The browser gets marks with the map.** `GET /api/map` includes the place's active marks (a few hundred at most); a change to marks while the player is there arrives with the normal state update (a `marksVersion` number per place: the client refetches on change).

## Data shapes

```ts
// shared/src/marks.ts
export const MARK_KINDS = ["burned", "ruin", "scaffold", "grave", "stall_empty", "banner", "guards", "boarded", "memorial", "smoke_damage"] as const;
export interface Mark { id: string; kind: MarkKind; x: number; y: number; w: number; h: number; building?: number; ref?: string; label?: string; since: number; until?: number; data?: { colour?: string; faction?: string; person?: string } }
```

## Steps

### Step 1: fixed layouts
- Reserve lots for every building a place could have; draw unbuilt ones as empty lots; cache key without `buildings`.
- Test: generate a place's map, raise and lower each building level, grow its houses: every existing building and house is at the same position, and the tiles outside changed lots are byte-equal.
- Update N15/N16 tests that assumed the old layout, deliberately (section 8.5).

### Step 2: the marks table and the rules
- `store/schema.ts` migration (next schema version); `game/marks/store.ts` (add, end, list by site); `game/marks/rules.ts` called from `realmDay` (after raids and the economy) and from the life step for graves.
- Test: a raid on the start town (forced) adds `burned` marks with the raid ref; a project adds a `scaffold` that ends when done.

### Step 3: repair and fading
- Repair rules by prosperity and the economy's rebuilding; graves fade after the threshold.
- Test: after a raid, the burned houses are repaired over the following weeks (a long run of days); a poor place repairs slower.

### Step 4: graves
- Graveyard zone in the map (every place has one, by the temple if any, else at the edge); grave placement in order; the hover text from the death record.
- Test: after a raid kills several people, the graveyard has a grave for each one killed, with their names and the raid named.

### Step 5: famine, banners, guards hooks
- `stall_empty` from famine; banners from faction branches and the ruler's colours; the `guards` source list (empty until N58).
- Test: with the start town under `FAMINE`, some stalls are empty; a guild with a branch shows its banner.

### Step 6: the browser layer
- `client/src/world/MarksLayer.ts`: burned/ruin overlays on building sprites, scaffolding, grave tiles with hover, banners, empty stalls; lit windows and smoke from who's home (in `CrowdLayer` or a small `HomesLayer`).
- Textures in [`textures.ts`](../../../packages/client/src/world/textures.ts).
- Play: force a raid with the admin (or wait for one), walk the town, watch it rebuild with fast-forward.

### Step 7: admin and docs
- Admin: a place's marks list (kind, cause, since, until). README: what can be seen.

## Balance bounds

- `marks-bounded`: active marks per place under a cap (graves count only named ones).
- `ruins-repaired`: no burned house in a prosperous place stays burned more than a season.

## Edge cases and traps

- **The fixed-layout change touches every place's map.** It's a clean change in what a map is; do it in its own commit with only that and its tests.
- **Talkers' homes** (notables live in named buildings): a burned home moves its people to a neighbour's house or the inn until repaired. The crowd's homes are house indexes; a burned house's people sleep elsewhere (the crowd's home lookup falls back).
- **Graves for people who died away** (in battle far off, on the road): they get a grave where they died if it's a place, else a memorial line in their home graveyard once the news arrives (N55 does war memorials properly).
- **Lazy places:** marks for a lazy place are made by the realm's day for the realm's events (raids, projects) and by the catch-up for deaths, so they're the same either way.

## Tests (`packages/server/tests/n31.test.ts`)

The done-when ones:
- After a raid on the start town: burned houses that are rebuilt over the following weeks.
- The graveyard has a grave for each person killed (names, day, cause).
- The market's stalls empty during a famine.

## Done when (mapped)

| Done-when clause | Proved by |
|---|---|
| after a raid on Millbrook the player sees burned houses that are rebuilt over the following weeks | steps 2–3 tests + play |
| the graveyard has a grave for each person killed | step 4 test |
| the market's stalls empty during a famine | step 5 test |

**Save:** the next schema version (`marks`). No save version change (marks are in the database). Fixed layouts change maps but not saved data.

## Slice cut

Not in the slice.

## Out of scope

Fire spreading house to house (N62 owns fire; it adds `burned` marks through the same module). War memorials and battlefield graves (N55, N27). Interiors showing damage (N32 reads marks).
