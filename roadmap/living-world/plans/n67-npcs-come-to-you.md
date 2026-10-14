[← Plans](README.md) · [Stage 7: N67](../stage-7-the-player-in-the-world.md#n67-npcs-come-to-you-and-reputation-by-place)

# N67 plan: NPCs come to you, and reputation by place

**In one line:** N38's menu gains **seek out the player**: an NPC who needs something the player can give, wants to warn, threaten or thank them, has an offer, or has a debt to collect, **travels** (a real journey to where they believe the player is) and finds them; reputation becomes a record **per place and per faction** (and per people, from N54) that spreads by N33's carriers, so the player can be a hero in one town and wanted in the next, with bounties that travel; people react on meeting to the player's renown, gear and deeds as they know them.

**Read first:** [plans README](README.md) sections 2, 3, 13. Needs N33 (carriers and knowledge), N38 (the menu). Uses N26 (journeys to the player), N34 (where people believe the player is: their knowledge), N42 (bounties as jobs), N43 (recognised gear), N44 (the nemesis comes this way), N48 (wanted by law in one kingdom), N53 (customs), N54 (reputation by people), N57 (rebels approach the player), N66 (a home to be found at).

## What exists

- **Reputation for the player by town** ([`reputation.ts`](../../../packages/server/src/game/reputation.ts)): `Reputation`, `IMPACT`, `townLearns`, `witnessesLearn`, `titleRespect`, `firstImpression`, `describeReputation`: one reputation (the start town's view), learned by witnesses and gossip.
- **Initiative** ([`npc/initiative.ts`](../../../packages/server/src/npc/initiative.ts)): talkers in the player's place approach them (`TRIGGERS`, `openingsFor`, `fireOpening`, cooldowns): only when already near.
- **Crime** bounties ([`crime.ts`](../../../packages/server/src/game/crime.ts)): per place's guards, not travelling.
- **Faction standing** for the player ([`factions.ts`](../../../packages/server/src/game/factions.ts)): per faction.

## Decisions made in this plan

1. **`seek_player` is an action** (N38, grain day) with reasons as options: `reward` (the player saved their kin or did them a great favour: N21's choices and N37's relationships), `request` (a need the player can meet: a job only the player's skill or renown fits: N42's jobs with a preferred party), `warn` (they know of a threat to the player: a nemesis's plan (N44), a bounty, a plot), `threaten` (a gang whose leader the player killed: the gang's revenge plan sends someone: N37/N44), `offer` (trade, alliance, a rebel band's invitation: N56/N57), `collect` (a debt the player owes: N4's debts). Scored by the strength of the reason, distance (they won't cross the realm for a small thing), their boldness and means.
2. **They travel to where they believe the player is:** the NPC's knowledge of the player's whereabouts (their `knowledge` rows about the player's location; N34's model reversed: "the player was last seen at Ashby"; if unknown, the player's home (N66) or the place where the player is famous). A **journey** goes there; on arrival, if the player isn't there, they ask around (the place's knowledge rows about the player's latest whereabouts: someone saw them leave for X) and follow, up to a limit of tries; or wait at the inn for a while; or leave a **letter** (N34) or a message with the innkeeper. When they find the player (same place, in sight), they approach (N38's initiative opening with the reason); a threat may be an ambush on the road (a situation from N26's format with the real person).
3. **Reputation per place and faction:** `reputation(subject, scope, axes)` where `scope` is a place id, a faction id, a kingdom id or a people (N54) and the axes are the existing ones (renown/fame, honour, fear, kindness or similar from `Reputation`). Each deed (an event with the player as actor) moves reputation **where it's known**: at the place it happened via witnesses, and elsewhere only as knowledge of it arrives (N33's carriers; each place's share of people who know the deed, weighted by their accuracy). So reputation in a place is a function of what's known there, recomputed when knowledge arrives (cheap: a running sum per place updated on learn).
4. **Bounties travel:** a crime bounty (N48 case) is posted in the kingdom's places as a job (N42) once the news reaches them; bounty hunters (NPCs taking the job) come after the player; in a different kingdom the bounty is valid only with a treaty (extradition clause) or as a private bounty (a gang's, a noble's).
5. **People react on meeting:** first impressions (`firstImpression`) read the place's reputation, the player's renown and what the person personally knows of them (their knowledge rows of the player's deeds), and **what they see**: gear (a famous sword: N43 recognition; a noble's colours; a brand from N49), companions, the player's class markers. Guards at a gate read the place's reputation and the kingdom's bounties: **turned away** at the gate if wanted there (a gate check: N26 toll gates and town gates).
6. **The player sees it:** the journal's place pages (N65) show "how they see you here" as last noticed (perceived, not exact).

## Steps

### Step 1: reputation per scope
- `reputation` table by scope; deeds update by knowledge; first impressions read it; migration of the old single reputation into the start town's scope.
- Test (done-when part): the player is welcome in the start town (high honour there) but has a bad name in the liege town after a crime there.

### Step 2: travelling bounties and gates
- Bounties as jobs in places the case's news reached; hunters; gate checks.
- Test (done-when part): the player is turned away at the liege town's gate after a crime there.

### Step 3: seek_player
- The action and its reasons; journeys to the believed place; asking around; following; letters or waiting; approaching.
- Test (done-when part): an NPC whose son the player saved travels to find them with a reward (fixed seed: the father learns of it, travels to the player's place, finds them, gives the reward).

### Step 4: threats and offers
- A gang's avenger sent after the player (from N37/N44 plans); rebels' invitations (N56/N57); debt collectors.
- Test (done-when part): a gang whose leader the player killed sends someone after them (an ambush on the road or an approach in town by a real gang member who travelled).

### Step 5: reactions on meeting; journal; docs
- Gear, renown, brands, colours in first impressions; "how they see you here" on place pages. README.

## Balance bounds

- `visitors-bounded`: NPCs seeking the player per week under a cap (not a queue at the door).
- `reputation-local`: a deed's reputation effect elsewhere never exceeds the share of people there who know it.

## Edge cases and traps

- **The player moves:** seekers must not chase forever; a try limit and a give-up rule.
- **Seekers and the player's protected status:** threats obey N38's violence flag and caps.
- **Old reputation tests:** the single-town reputation becomes the start town's scope; keep its API as a view.

## Tests (`packages/server/tests/n67.test.ts`)

The done-when ones:
- An NPC whose son the player saved travels to find them with a reward.
- A gang whose leader the player killed sends someone after them.
- The player is welcome in the start town but turned away at the liege town's gate after a crime there.

## Done when (mapped)

| Done-when clause | Proved by |
|---|---|
| an NPC whose son the player saved travels to find them with a reward | step 3 test |
| a gang whose leader the player killed sends someone after them | step 4 test |
| the player is welcome in Millbrook but turned away at Highdale's gate after a crime there | steps 1–2 tests |

**Save:** the next schema version (`reputation` by scope); the next save version (the old reputation migrated).

## Slice cut

Not in the slice.

## Out of scope

Disguises (changing how people recognise the player). Heralds announcing the player.
