[← Plans](README.md) · [Stage 3: N44](../stage-3-npcs-choose.md#n44-a-nemesis)

# N44 plan: A nemesis

**In one line:** code watches everyone with a grudge against the player and picks at most two **nemeses** (the strongest grudge among those who survived the player); a nemesis's revenge becomes a life ambition (N40) that drives N38's scores; after every meeting code records what the nemesis learned of the player's style (weapons, tricks, companions, weak spots) and the nemesis **prepares**: gear, allies and tactics chosen against it; they rise faster (grades, ranks, offices), act off-screen against the player's people and holdings, taunt with real memories, and can be won over, killed for good, or outlast the player into their heir's life.

**Read first:** [plans README](README.md) sections 2, 13, 19 (`taunt`). Needs N37 (grievances and revenge against anyone), N38 (the menu), N40 (ambition as a ladder: revenge as a life goal), N42 (grades and jobs: how they rise). Uses N34 (the nemesis is followed automatically), N43 (they may take or covet the player's notable gear), N55 (military ranks), N57/N66 (the player's holdings to strike at).

## What exists

- **Revenge goals** (N12, [`director/revenge.ts`](../../../packages/server/src/director/revenge.ts)): strength by what was done (attacked 0.8, robbed 0.6, humiliated 0.4), plans by traits (ambush, confront, rumour, refuse), acted once; N37 generalises the target.
- **Grudges and relationships with the player** for talkers ([`npc/relationship.ts`](../../../packages/server/src/npc/relationship.ts): `setGrudge`, `holdsGrudge`, `settleGrudge`; the four axes).
- **Memories** of the player for talkers ([`npc/memory.ts`](../../../packages/server/src/npc/memory.ts), embeddings), with importance.
- **Fights:** the player's equipped weapon and skill, abilities used ([`abilities.ts`](../../../packages/server/src/game/abilities.ts): `chooseMove`, combat styles), companions in the fight ([`party.ts`](../../../packages/server/src/game/party.ts) `companionsStrike`), sneaking, fleeing; the fight log in [`creatures.ts`](../../../packages/server/src/game/creatures.ts).
- **Rising** to figure and talker ([`realm/rise.ts`](../../../packages/server/src/game/realm/rise.ts), [`people/rising.ts`](../../../packages/server/src/game/people/rising.ts)); **spared** enemies: N21's plan adds a `spared` event (not built). A bandit the player beat and let go today: the creature flees or yields; check `fleeAt` and the yield path.

## Decisions made in this plan

1. **Candidates and choice.** Every day, `nemesisCandidates(world)`: people (talkers, figures, rows, creatures with a name) alive, with an open grudge/grievance against the player of weight ≥ 0.5, who **survived a meeting** with the player (beaten and spared or fled, humiliated, robbed by the player, a rival beaten in a contest or for a job). Score = grudge weight × pride × ambition × (1 + renown/100). The top one becomes a nemesis when no nemesis exists, or a second when its score is far above; at most two. A creature or bandit that's a candidate is **made a person** (a figure, and a talker when they next meet the player) so they persist.
2. **The record.** `nemesis: { who, since, cause (event ref), meetings: Meeting[], knows: StyleModel, plan, stage: "rising" | "striking" | "won_over" | "dead" | "outlasted", scars: string[], titlesFromPlayer: string[] }` in `world.nemeses`. A `Meeting { day, site, kind: "fight" | "talk" | "contest" | "job" | "crime", outcome, playerUsed: { weapon?, skill?, abilities[], companions[], tricks[] }, wounds? }`.
3. **The style model is counts, not words.** `StyleModel { weapons: Record<skill, n>, abilities: Record<id, n>, companions: n, sneaks: n, ranged: n, fled: n, magic: n }` from the meetings and from what the nemesis heard (N33 knowledge about the player's deeds). Preparation picks counters by table: against spears/polearms → a shield; against archery → close quickly, armour; against companions → hire more men; against sneak attacks → watchmen and dogs; against magic (N51) → a ward or a mage of their own; against a known weak spot (the player's lowest defence stat in fights) → a weapon that targets it. Each counter is a concrete change: an item bought or looted (N43), men hired (a spawn rule / faction recruits), a skill trained (they gain XP in that skill faster).
4. **Revenge as a life ambition.** The nemesis's N40 ambition becomes `revenge` with a ladder: **gather** (coin, men, gear, skill) → **rise** (a rank, grade or office that gives power: a gang's lead, a sergeant's stripes, a guild officer) → **strike** (at the player or what they love) → **finish** (face the player). Score weights for N38: actions that move the ladder get a large bonus. They rise faster: progress multipliers on their N40/N42/N55 ladders while the grudge is strong.
5. **Striking off-screen** (stage `striking`), only at what the player has: the player's workshop or house (N66; until then their inn room or a friend's shop) burned by hired men (a fire event, N31/N62 marks), a companion ambushed, a friend threatened, a rumour spread (N37), the player's job claimed first (N42), a bounty posted on the player where they're wanted. Each is an N38 action with the nemesis as actor and normal effects, with a cooldown (not more than once a season).
6. **Meeting again.** The nemesis comes to the player (N67's "seek out" later; for now when the player is in their place or on their road: a staged encounter, like N39's staging: never invented, the nemesis really travels there). Before the fight, a **taunt** that names a real meeting ("Ashby's road, the third day of spring. You let me live. You shouldn't have."): from the meeting log, the model's `taunt` kind or a template.
7. **Endings.** Won over: amends, a gift, saving their life, a high enough affection (relationship rules) → stage `won_over`, grudge settled, they may become an ally. Killed for good: dead with a typed death. Outlasted: the player dies (N66's heir): the nemesis's target becomes the heir with the grudge at half weight (N45's inheritance of grudges). A nemesis who loses a meeting and survives gains a scar and a stronger grudge.
8. **Visible:** followed automatically (N34): the player hears of them rising ("they say the bandit you spared is a sergeant now"); the admin shows the record, the style model and the plan.

## Steps

### Step 1: spared and survived
- The `spared`/`fled`/`yielded` events in fights (N21's step 1 if not built); meetings recorded for every candidate.
- Test: beating a bandit and letting them go records a `spared` event and a grievance.

### Step 2: candidates and the record
- `game/nemesis/choose.ts`, `record.ts`; making a creature into a figure (and later a talker); auto-follow.
- Test: after a few hostile meetings with different people, the strongest grudge who survived becomes the nemesis; at most two.

### Step 3: the style model and preparation
- `style.ts` from meetings and knowledge; `prepare.ts` with counters as concrete changes.
- Test: a player who fought the nemesis twice with a spear makes the nemesis acquire a shield.

### Step 4: the ambition and rising
- Revenge ladder in N40; score weights; rise multipliers on grades and ranks.
- Test: over months the nemesis climbs (a bandit becomes a gang leader or joins an army and becomes a sergeant, by what's open to them).

### Step 5: striking off-screen
- Actions: burn a holding, ambush a companion, rumour, claim the player's job; cooldowns.
- Test (done-when part): the nemesis has hired men to burn the player's workshop (with N66; until N66, the player's rented room or a friend's shop: note which in the stage file).

### Step 6: meeting again and taunts
- The approach; the taunt from the log; the fight with the prepared gear and men.
- Test (done-when part): a bandit the player beat and let go returns months later as a sergeant with a shield against the player's favoured spear and names the day they met.

### Step 7: endings, admin, docs
- Won over, killed, outlasted; admin panel; README.

## Balance bounds

- `nemesis-not-unbeatable`: a nemesis's power stays within a band of the player's (prepared, not overwhelming).
- `strikes-rare`: at most one off-screen strike per nemesis per season.

## Edge cases and traps

- **The player must be able to see it coming:** rumours of the nemesis rising reach the player (N33/N34) before a strike, most of the time.
- **Not every grudge is a nemesis:** the threshold and the cap keep it special.
- **Dead nemesis returning:** never (no resurrection) unless N51's necromancy, which is a separate story.
- **Persistence:** a creature that becomes a nemesis must stop being a "creature" that can despawn with its spawn rule.

## Tests (`packages/server/tests/n44.test.ts`)

The done-when one, as a scenario on a fixed seed with time skipped: a bandit the player beat with a spear and let go returns months later as a sergeant with a shield against the spear, names the day they met (taunt contains the day and place), and has hired men to burn the player's workshop.

## Done when (mapped)

| Done-when clause | Proved by |
|---|---|
| a bandit the player beat and let go | step 1 |
| returns months later as a sergeant | step 4 test (N55's ranks; until N55, a gang lieutenant: note it) |
| with a shield against the player's favoured spear | step 3 test |
| names the day they met | step 6 test |
| has hired men to burn the player's workshop | step 5 test |

**Save:** the next save version (`world.nemeses`).

## Slice cut

Not in the slice.

## Out of scope

The heir carrying on (N66). Armies (N55: "sergeant" needs ranks; until then use gang or guard ranks). Seeking the player from afar (N67).
