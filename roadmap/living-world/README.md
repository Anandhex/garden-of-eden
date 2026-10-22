[← Roadmap](../../ROADMAP.md)

# Living world track (N17–N68)

Planned 2026-10-12 from the user's notes: "npc also acts as a living player, unpredictable"; "ordinary townsfolk should age, marry and die because their offspring might become named NPCs"; "gossip should include everyone"; "chatter shouldn't be cosmetic"; "reporting should be global"; "a world view as an administrator, where I can pin an NPC or the player and see what they're doing"; new civilisations, new settlements found by explorers, kingdoms reacting to revolts, runaway slaves freeing others, NPCs taking quests to climb the grades, and NPCs who join armies, rise through the ranks and, when they die in war, are remembered as war dead.

**The rules for the whole track:** the same as every phase before it. **Code decides, the model only writes words** (insult lines, creeds, place names, the reason an NPC gives), through the existing invented-name checks. Every decision is an event with a logged reason, and every random choice comes from a seeded stream (per NPC where it matters), so a save replays the same way and tests stay deterministic while the game stays unpredictable to the player. The admin view (N17) is how every later phase is watched and tuned, so it comes first.

**How it's organised:** a vertical slice first (below), then seven stages, built in order; inside a stage, phases go in the order listed. Phases are numbered in build order.

**Implementation plans:** [plans/](plans/README.md) holds detailed build guides for every phase, N17–N68 (what exists, decisions, data shapes, steps, traps, tests), written for coding agents and people alike. The N29–N68 plans (2026-10-14) share building blocks set out in [plans/README.md part 2](plans/README.md#part-2-rules-for-n29n68): the missing pieces from N20–N28 to build as step 0, one action menu (N38), one kingdom-policy mechanism (N45), and which phase fills which table. N25a ([plan](plans/n25a-a-world-without-a-centre.md)) removes Millbrook and every hand-written NPC (user decision 2026-10-13: no scenarios, no authored NPCs; the world is generated): from then on, "Millbrook", "Highdale" or a cast member's name in any phase's text means "the start town", "its liege town" or "a generated person with that job", not a rule. Read [plans/README.md](plans/README.md) first: it holds the rules every phase shares, including that **older saves are not migrated** (user decision 2026-10-13: N18 starts save v11 as a clean break).

**Open decisions** (defaults used until the user says otherwise):

- **How free NPCs are (N38):** do both social and economic actions first; violence (attack, murder, theft) behind a config flag, turned on once the guardrails hold.
- **The model never picks an action:** code picks, the model narrates.
- **Kingdom cap (N64):** default 12.
- **Can the player found a kingdom (N64):** default yes, by holding a free settlement that meets the founding rules.
- **Exploration rate (N63):** default a few trips per settlement per season.
- **Discoveries on the player's map (N63):** default only once the player has heard of them (the admin view shows them at once).
- **The player doesn't age and comes back from death** (decided 2026-10-23). The player has no age; when they die they comes back: they wake a day later where they last slept (home, an inn) or at a temple (N50 can make it a shrine of their faith), at low HP; what they carried stays where they fell, for others to take or for them to recover; and people who saw them die talk about it ("came back from the dead"), which can make them feared or revered. Setbacks (N49) still come first where a captor would rather keep them alive; `PLAYER_DEFEAT=permadeath` stays as an option. No heir handover is needed (N66).
- **Quiet travel is quick** (decided 2026-10-23): fast travel works on any road the player knows of (walked, heard of, or on a map), not only roads walked, and still stops for anything worth stopping for; and walking speeds up on quiet stretches, dropping back when a traveller, a situation or a place comes into view. N26 follow-up.
- **How long a journey takes in real time (N26):** decided 2026-10-13: a day's walk is about 7 real minutes of walking, so a road tile passes less game time than a village tile (the clock runs faster on the road); set by the travel time scale.
- **Which peoples and monsters (N54):** default the list in N54; dragons rare (a few in the realm).
- **Can the player lead a faction (N57):** default yes, any kind an NPC could found.
- **Can the player join an army (N55):** default yes, as a volunteer or a levy, with the same ranks as NPCs.
- **The time scale (realism gap 1):** decided 2026-10-23: **one clock, a 48-day year** (`config.daysPerYear` 48: four 12-day seasons). Seasons, harvests, travel, wars and lives all run on it, so ages and dates agree. Generations turn over slowly in normal play (a child takes ~770 days to grow up), so time passes faster where nothing happens: sleep skips the night, fast travel and "wait until" (N35) skip empty days, and N35 adds a "the years pass" skip. Rules: [plans README §5](plans/README.md#5-time-one-clock-a-48-day-year). (A two-clock split was considered the same day and dropped.)
- **Admin powers (N17):** read-only first, except the time controls (pause, step, fast-forward), which act on the live game (decided 2026-10-13); interventions (spawn, kill, edit traits, trigger an event, nudge the director) later, as their own phase.

| Stage                                                                  | Phases, in build order                                                                                                                                                                                                                                                                                               |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Milestone: vertical slice](#milestone-the-vertical-slice)             | N17 → N18 → N25 → N25a → N25b → N26 → N33 → N37 → N38 → N40, for the start town and its liege town and the road between; play, then revise the plan                                                                                                                                                                                           |
| [Stage 1: Foundations](stage-1-foundations.md)                         | N17 The admin world view → N18 Scale and storage → N19 Performance and model-call budgets → N20 Stories, drama and liveness metrics → N21 Callbacks to the player's choices → N22 Long-run balance tests → N23 Sharing worlds → N24 Global reporting                                                                 |
| [Stage 2: Everyone lives](stage-2-everyone-lives.md)                   | N25 Townsfolk lives → N25a A world without a centre → N25b Lives that change → N26 The open road → N27 The wilds → N28 Fauna and flora → N29 A soundscape → N30 Seasons and the farming year → N31 Visible consequences on the map → N32 Interiors and homes → N33 Gossip for everyone → N34 Following people in the game → N35 Moving through time → N36 The mood of a place |
| [Stage 3: NPCs choose](stage-3-npcs-choose.md)                         | N37 Chatter with consequences → N38 NPCs as living players → N39 The first hour → N40 Ambitions and careers → N69 Offices, treasuries and renown → N41 Leisure and contests → N42 A shared quest market and adventurer grades → N43 Items with a history → N44 A nemesis                                                                                  |
| [Stage 4: Society](stage-4-society.md)                                 | N45 Family feuds and inheritance → N46 Secrets, spies and blackmail → N47 The underworld → N48 Law and trials → N49 Setbacks instead of game over → N50 Belief → N51 Magic → N52 Shaping what people believe → N53 Cultures and languages                                                                            |
| [Stage 5: Power and conflict](stage-5-power-and-conflict.md)           | N54 Peoples and monsters → N55 Armies, soldiers and the war dead → N56 Grievances and uprisings → N57 Player-led factions → N58 Kingdoms react to unrest → N59 Runaways and liberation                                                                                                                               |
| [Stage 6: A changing world](stage-6-a-changing-world.md)               | N60 Ecology → N61 Epidemics → N62 Disasters → N63 Exploration, roads and new settlements → N64 New kingdoms                                                                                                                                                                                                          |
| [Stage 7: The player in the world](stage-7-the-player-in-the-world.md) | N65 The player's view → N66 The player's own life → N67 NPCs come to you, and reputation by place → N68 Legends, songs and the realm's history                                                                                                                                                                       |

## Realism gaps (review, 2026-10-23)

A read through every plan for where the world stops feeling real. Most topics are covered; the gaps are in how systems connect. Gaps 1–7 are noted in the plans they touch (a "Realism notes" section before each plan's slice cut); none is built yet. Ordered by how much they hurt.

1. **A year too short for its seasons** (decided 2026-10-23: one 48-day year; see the open decisions above). The day runs at walking speed (a day's walk is ~7 real minutes) but the year was 12 days, so a season was 3 days, a 3-day trip a quarter of a year, a week's march half a campaign year, two days of snow closed a pass for most of winter, and news "days late" arrived a season late. Now a season is 12 days. Lives slow down 4× with it, so generations are seen through skips (N35) and an ageless player. To be built in N30 step 1. Notes: N22, N25, N26, N30, N35, N40, N45, N49, N55, N66, N68.
2. **Goods and coin don't flow.** Prices are local factors (`priceFactor`, `stockFactor`); caravans carry news and get robbed but don't move surpluses to shortages, price gaps between places don't steer merchants, and famine relief is a stabiliser switch, not grain someone hauls. Townsfolk have no household purse, so poverty is a class label. Nothing tracks where coin enters and leaves. Notes: N26, N30, N40, N22.
3. **Townsfolk health is alive or dead.** The player and the talking cast already have lasting injuries and illness (N8.1, `game/health.ts`: a burned hand costs smithing, illness spreads, remedies and healer quests), but townsfolk rows (N25) have none: they only roll a daily death chance. Healers exist mainly as a magic school (N51). Notes: N25, N61.
4. **Child deaths look modern.** Townsfolk couples can have up to 6 children (the cast's cap of 3 is a memory limit), but infant deaths are 3.5% a year and children's 0.6%, so far fewer children die than in a pre-modern town, where a third to half never grew up; that shapes grief, heirs and feuds. Notes: N25, N22.
5. **Small places run out of spouses.** Matching is by class and age; marriage between places exists but has no rate, and nothing forbids close kin. A 40-person hamlet stalls or inbreeds within a few generations. Notes: N25, N22.
6. **War doesn't empty the fields.** Armies eat from stores, but levies taken from a village don't shrink its harvest, and there's no campaigning season (winter halts, home for harvest). Notes: N55, N30.
7. **Nobody cares for the old or the orphaned.** `NO_RETIRING`; elders don't depend on kin; orphans are recorded only for war deaths; no one takes in children after plague or famine. Notes: N40, N45.

**Smaller:** what one person knows doesn't fade or blur (only mood, news and legends decay: N33); drink at the inn never becomes drunkenness or habit (N36/N41); fire is only a disaster (N62), not a daily risk of candles, hearths and thatch.

**Next:** the [migration guide](plans/migration-2026-10-23-one-year-ageless-player.md) says how the decisions change built code; gap 1 (the 48-day clock) is built alone after G5 and G6 and before N40 (order decided 2026-10-23), the ageless, returning player with N49/N66, quick travel as an N26 follow-up; gaps 2–7 go into the phases named, or into a follow-up phase for those already built (N25, N26).

## Milestone: the vertical slice

**Status:** ⬜ Planned

**Goal:** play the core of the living world before building all of it, and change the plan from what that shows.

**Scope:** the start town (picked by the seed) and its liege town only ("Millbrook" and "Highdale" in older notes mean these two; the rest of the realm runs as today), with **N17 → N18 → N25 → N25a → N25b → N26 → N33 → N37 → N38 → N40**, each cut down to what the two places need; N26 for the one road between them, so the slice tests travel as a journey. Then play it for a few in-game months, including several seeds' first hours (N39's question: does something grab the player in the first five minutes?).

- [ ] **Player fantasies as checks:** write down the paths the game promises (for example: a nobody rising to lord, leading the slave revolt, building a trading house, becoming a famous adventurer, a soldier rising through the ranks). For each, list the phases it needs and check that it can be played end to end once they're built; gaps found become phases
- [ ] Build the slice phases for the two places only
- [ ] Play it; write down what feels alive and what feels like noise, using N17 and N20's metrics as well as notes
- [ ] Revise the rest of the track from the notes (cut, merge, reorder or add phases) before Stage 2's remaining phases

- **Done when:** a few in-game months in Millbrook and Highdale produce NPC choices, grudges and gossip the player notices and can act on, the playtest notes are written up, and this roadmap has been revised from them.

## Phase index

| Phase | Title                                                                                                                        | Stage |
| ----- | ---------------------------------------------------------------------------------------------------------------------------- | ----- |
| N17   | [The admin world view](stage-1-foundations.md#n17-the-admin-world-view)                                                      | 1     |
| N18   | [Scale and storage](stage-1-foundations.md#n18-scale-and-storage)                                                            | 1     |
| N19   | [Performance and model-call budgets](stage-1-foundations.md#n19-performance-and-model-call-budgets)                          | 1     |
| N20   | [Stories, drama and liveness metrics](stage-1-foundations.md#n20-stories-drama-and-liveness-metrics)                         | 1     |
| N21   | [Callbacks to the player's choices](stage-1-foundations.md#n21-callbacks-to-the-players-choices)                             | 1     |
| N22   | [Long-run balance tests](stage-1-foundations.md#n22-long-run-balance-tests)                                                  | 1     |
| N23   | [Sharing worlds](stage-1-foundations.md#n23-sharing-worlds)                                                                  | 1     |
| N24   | [Global reporting](stage-1-foundations.md#n24-global-reporting)                                                              | 1     |
| N25   | [Townsfolk lives](stage-2-everyone-lives.md#n25-townsfolk-lives)                                                             | 2     |
| N25a  | [A world without a centre](stage-2-everyone-lives.md#n25a-a-world-without-a-centre)                                          | 2     |
| N25b  | [Lives that change](stage-2-everyone-lives.md#n25b-lives-that-change)                                                        | 2     |
| N26   | [The open road](stage-2-everyone-lives.md#n26-the-open-road)                                                                 | 2     |
| N27   | [The wilds](stage-2-everyone-lives.md#n27-the-wilds)                                                                         | 2     |
| N28   | [Fauna and flora](stage-2-everyone-lives.md#n28-fauna-and-flora)                                                             | 2     |
| N29   | [A soundscape](stage-2-everyone-lives.md#n29-a-soundscape)                                                                   | 2     |
| N30   | [Seasons and the farming year](stage-2-everyone-lives.md#n30-seasons-and-the-farming-year)                                   | 2     |
| N31   | [Visible consequences on the map](stage-2-everyone-lives.md#n31-visible-consequences-on-the-map)                             | 2     |
| N32   | [Interiors and homes](stage-2-everyone-lives.md#n32-interiors-and-homes)                                                     | 2     |
| N33   | [Gossip for everyone](stage-2-everyone-lives.md#n33-gossip-for-everyone)                                                     | 2     |
| N34   | [Following people in the game](stage-2-everyone-lives.md#n34-following-people-in-the-game)                                   | 2     |
| N35   | [Moving through time](stage-2-everyone-lives.md#n35-moving-through-time)                                                     | 2     |
| N36   | [The mood of a place](stage-2-everyone-lives.md#n36-the-mood-of-a-place)                                                     | 2     |
| N37   | [Chatter with consequences](stage-3-npcs-choose.md#n37-chatter-with-consequences)                                            | 3     |
| N38   | [NPCs as living players](stage-3-npcs-choose.md#n38-npcs-as-living-players)                                                  | 3     |
| N39   | [The first hour](stage-3-npcs-choose.md#n39-the-first-hour)                                                                  | 3     |
| N40   | [Ambitions and careers](stage-3-npcs-choose.md#n40-ambitions-and-careers)                                                    | 3     |
| N41   | [Leisure and contests](stage-3-npcs-choose.md#n41-leisure-and-contests)                                                      | 3     |
| N42   | [A shared quest market and adventurer grades](stage-3-npcs-choose.md#n42-a-shared-quest-market-and-adventurer-grades)        | 3     |
| N43   | [Items with a history](stage-3-npcs-choose.md#n43-items-with-a-history)                                                      | 3     |
| N44   | [A nemesis](stage-3-npcs-choose.md#n44-a-nemesis)                                                                            | 3     |
| N45   | [Family feuds and inheritance](stage-4-society.md#n45-family-feuds-and-inheritance)                                          | 4     |
| N46   | [Secrets, spies and blackmail](stage-4-society.md#n46-secrets-spies-and-blackmail)                                           | 4     |
| N47   | [The underworld](stage-4-society.md#n47-the-underworld)                                                                      | 4     |
| N48   | [Law and trials](stage-4-society.md#n48-law-and-trials)                                                                      | 4     |
| N49   | [Setbacks instead of game over](stage-4-society.md#n49-setbacks-instead-of-game-over)                                        | 4     |
| N50   | [Belief](stage-4-society.md#n50-belief)                                                                                      | 4     |
| N51   | [Magic](stage-4-society.md#n51-magic)                                                                                        | 4     |
| N52   | [Shaping what people believe](stage-4-society.md#n52-shaping-what-people-believe)                                            | 4     |
| N53   | [Cultures and languages](stage-4-society.md#n53-cultures-and-languages)                                                      | 4     |
| N54   | [Peoples and monsters](stage-5-power-and-conflict.md#n54-peoples-and-monsters)                                               | 5     |
| N55   | [Armies, soldiers and the war dead](stage-5-power-and-conflict.md#n55-armies-soldiers-and-the-war-dead)                      | 5     |
| N56   | [Grievances and uprisings](stage-5-power-and-conflict.md#n56-grievances-and-uprisings)                                       | 5     |
| N57   | [Player-led factions](stage-5-power-and-conflict.md#n57-player-led-factions)                                                 | 5     |
| N58   | [Kingdoms react to unrest](stage-5-power-and-conflict.md#n58-kingdoms-react-to-unrest)                                       | 5     |
| N59   | [Runaways and liberation](stage-5-power-and-conflict.md#n59-runaways-and-liberation)                                         | 5     |
| N60   | [Ecology](stage-6-a-changing-world.md#n60-ecology)                                                                           | 6     |
| N61   | [Epidemics](stage-6-a-changing-world.md#n61-epidemics)                                                                       | 6     |
| N62   | [Disasters](stage-6-a-changing-world.md#n62-disasters)                                                                       | 6     |
| N63   | [Exploration, roads and new settlements](stage-6-a-changing-world.md#n63-exploration-roads-and-new-settlements)              | 6     |
| N64   | [New kingdoms](stage-6-a-changing-world.md#n64-new-kingdoms)                                                                 | 6     |
| N65   | [The player's view](stage-7-the-player-in-the-world.md#n65-the-players-view)                                                 | 7     |
| N66   | [The player's own life](stage-7-the-player-in-the-world.md#n66-the-players-own-life)                                         | 7     |
| N67   | [NPCs come to you, and reputation by place](stage-7-the-player-in-the-world.md#n67-npcs-come-to-you-and-reputation-by-place) | 7     |
| N68   | [Legends, songs and the realm's history](stage-7-the-player-in-the-world.md#n68-legends-songs-and-the-realms-history)        | 7     |
