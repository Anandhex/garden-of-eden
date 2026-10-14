[← Plans](README.md) · [Stage 5: N56](../stage-5-power-and-conflict.md#n56-grievances-and-uprisings)

# N56 plan: Grievances and uprisings

**In one line:** code sums open grievances (N37's table) **per oppressor across a place**; past a threshold scaled by place size, a local **band** (an N13 faction of kind `rebels`) is founded with the boldest, most aggrieved person as leader, the aggrieved as members, the oppressor as **target** and a creed; the band acts through N38 (recruit by gossip, hide, threaten, ambush, revolt); a revolt is a fight with real people; success can take the settlement (N13's breakaway), failure brings punishment and fear; either way it's realm news.

**Read first:** [plans README](README.md) sections 2, 13, 15 (grievances), 17, 19 (`band-creed`). Needs N37 (grievances per wrong), N38 (actions), N55 (fights with real people; armies that crush revolts). Uses N33 (recruiting is gossip), N36 (anger and fear), N45 (feuds aren't uprisings: the target must be an oppressor), N48 (punishment by law), N58 (kingdoms react), N59 (slave revolts), N64 (a held breakaway becomes a kingdom).

## What exists

- **Rebels** in the realm: `breakAway` ([`realm/politics.ts`](../../../packages/server/src/game/realm/politics.ts)) when a settlement in arrears with an ambitious leader is strong enough; rebels form, and the crown comes (`REBEL_WAR_CHANCE` in diplomacy); faction kind `rebels`.
- **Factions founding** ([`realm/factions.ts`](../../../packages/server/src/game/realm/factions.ts) `foundFaction`, `RECRUIT_CHANCE`, `split`) and the director's pushes for the angry ([`realm/director.ts`](../../../packages/server/src/game/realm/director.ts)).
- **Townsfolk outlooks** have `lord` axes (how they see whoever rules: trust, fear, respect, affection) and grudges.
- **Grievances** (N37), relationships, revenge against anyone.

## Decisions made in this plan

1. **Oppression is counted, not declared.** `grievanceTotals(site)`: for each `against` with open grievances from people of this place, the sum of weights and the number of distinct aggrieved people. An **oppressor** is someone with power over the aggrieved (a noble, a lord, a master, a captain, a tax collector, the head; their class rank above the aggrieved's, or an office over them), not a neighbour in a feud. Wrongs that count: N37's insults and humiliations, N48's harsh sentences, N58's curfews and extra labour (recorded as grievances against the person who ordered them), N47's corrupt guards' shake-downs, masters' cruelty to slaves (N59), seizures of land (N45).
2. **The threshold** scales with place size: `aggrieved ≥ max(4, 0.03 × population)` and `sum ≥ k × aggrieved × 0.5`. Checked weekly per place (cheap: one grouped query). The place's mood (N36 anger) lowers it a little; fear raises it (people too scared).
3. **Founding a band** (an event with the grievance totals as cause): leader = the aggrieved with the highest `boldness × grievance weight × renown` (bravery, temper, ambition); members = aggrieved people whose N38 `join_band` score passes (their grievance, boldness, low fear of the target, the leader's affection); target = the oppressor; creed = model-written (`band-creed`) from the grievances' kinds, or a template ("Down with Lord X, who flogs the hungry"). It's a realm faction of kind `rebels`, seat = the place, secret membership (each member's membership is an N46 `loyalty` secret).
4. **The band acts** through N38 actions for members (grain day for rows, hour for talkers): `recruit` (in venues by gossip, among the aggrieved; risk of discovery), `hide` (lie low when watched), `threaten` (the oppressor or their men: a note, a burned barn), `ambush` (the oppressor's men: a fight), `sabotage`, and **`revolt`**: the leader calls it when the band's strength (members, arms, sympathy among non-members: their `lord` axes) beats the oppressor's force (guards, household men, the lord's men from N55's soldiers stationed there) by a margin, or when something breaks (an execution of a member, a festival crowd, news of a revolt elsewhere: N58's memory works both ways).
5. **The revolt is a fight with real people** (N55's sides from people, not numbers): the band and sympathisers who join on the day against the oppressor's force. In the player's place it plays on the map (the raid code with townsfolk). Outcomes:
   - **Success:** the oppressor is killed, fled or captured; if the oppressor ruled the place (its head, lord), the place **breaks away** (N13's `breakAway` with the band's leader as head, the band as the new seat's faction) — or, if the oppressor was below the head (a cruel noble), the head must respond (N58: concession or crackdown).
   - **Failure:** leaders and members captured or killed; trials (N48 `sedition`), public punishments; fear (N36) and more grievances.
   - Either way: realm news with importance by size and outcome; the news travels (N33) and feeds other places' grievance thresholds (decision 2) and kingdoms' unrest memory (N58).
6. **Players and bands:** the player may be approached by a band (N67's seek-out later; for now a talker in the band with high trust), join it, inform on it (N47's informer path), or lead one (N57).

## Steps

### Step 1: totals and oppressors
- `game/unrest/totals.ts`; the oppressor rule; the weekly check.
- Test: a noble who abuses several commoners (many insults/humiliations: forced N37 interactions) has a grievance total above the threshold in the start town.

### Step 2: founding a band
- Leader, members, target, creed, secret memberships; the event with its cause.
- Test (done-when part): the noble is targeted by a band the aggrieved founded.

### Step 3: band actions
- `join_band`, `recruit` (gossip in venues), `hide`, `threaten`, `ambush`, `sabotage`.
- Test (done-when part): the band recruits through gossip (members grow; new members heard of the band in a venue).

### Step 4: revolt
- The trigger rule; the fight with real people; success (breakaway or the head's response) and failure (capture, trials, fear).
- Test (done-when part): the band revolts; on one fixed seed it succeeds (the noble is overthrown, news), on another it fails (members tried; fear).

### Step 5: news and contagion
- Realm news; other places' thresholds read news of revolts; N58's hook.
- Test (done-when part): the revolt's outcome is news across the realm (known in places across the realm, carried by travellers and couriers: N26 Part E).

### Step 6: the player; admin; docs
- Join, inform; admin: grievance totals by place and oppressor, bands, their members (truth), revolts. README.

## Balance bounds

- `revolts-not-constant`: revolts per kingdom per year in a band; most places never revolt in a decade.
- `bands-dissolve`: bands without action for a long time dissolve; the target's death or reform settles grievances.

## Edge cases and traps

- **Double counting with N13's breakaway:** today's arrears-based `breakAway` stays for settlements as a whole (a town that won't pay its liege); N56 is people against a person. Keep both, and let a successful revolt *call* `breakAway` rather than copying it.
- **Feuds vs oppression:** grievances between equals don't count (the rule is power over).
- **Secret membership and determinism:** the discovery of members is N46's machinery; don't invent a separate one.

## Tests (`packages/server/tests/n56.test.ts`)

The done-when one, as a scenario: a noble who abuses several commoners is targeted by a band they founded, which recruits through gossip and revolts; the revolt's outcome is news across the realm.

## Done when (mapped)

| Done-when clause | Proved by |
|---|---|
| a noble who abuses several commoners is targeted by a band they founded | steps 1–2 tests |
| which recruits through gossip | step 3 test |
| and revolts | step 4 test |
| the revolt's outcome is news across the realm | step 5 test |

**Save:** the next save version (band fields on factions: target, creed source); no new tables (grievances exist; memberships are secrets from N46).

## Slice cut

Not in the slice.

## Out of scope

Kingdom-level responses (N58). The player leading a band (N57). Slaves' liberation groups (N59).
