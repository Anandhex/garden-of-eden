[← Plans](README.md) · [Stage 5: N55](../stage-5-power-and-conflict.md#n55-armies-soldiers-and-the-war-dead)

# N55 plan: Armies, soldiers and the war dead

**In one line:** an army becomes a record of **real soldiers** (people rows, talkers and figures) raised by the kingdom's levy law, volunteers and mercenaries, with ranks; it **marches** along the roads as a journey, camps, eats from places' stores, and **fights** battles where casualties are drawn from the soldiers present (heroes and cowards, prisoners and deserters); every soldier's service and death is recorded (the war, the battle, the side, the killer when known; missing and captured as states); rolls of the fallen per war and battle; families grieve differently; war weariness feeds unrest.

**Read first:** [plans README](README.md) sections 2, 9, 13, 14 (`levy` policy), 15 (`jobs_held` for service), 17. Needs N25 (rows, typed deaths, casualty orders: battles already kill real townsfolk through `casualty(...)` → the life step), N26 (journeys on roads), N40 (ranks as a ladder; `jobs_held`). Uses N30 (stores feed armies), N31 (war graves and memorials), N33 (news of the dead), N36 (grief), N44 (sergeants), N51 (battle mages, capped), N54 (other peoples' armies), N56/N58 (weariness → unrest), N61 (disease in camp).

## What exists

- **Wars** ([`realm/diplomacy.ts`](../../../packages/server/src/game/realm/diplomacy.ts)): `declareWar`, `warsDay` (a battle every `BATTLE_EVERY` days at the `front`), `armyOf(realm, party, day)` (a strength sum from the kingdom's settlements ×0.3: no soldiers), `fight` ([`realm/military.ts`](../../../packages/server/src/game/realm/military.ts)) with named fighters who may die and nameless losses; `casualty(realm, s, "battle", n, ref, day)` queues deaths that the day's life step picks **among the place's real people** (N25) with typed death records (`battle`, `siege`, `event`); `capture`, `endWar`, weariness per kingdom, `war_levy` arrivals.
- **Typed deaths** with `missing` as a state ([`people/death.ts`](../../../packages/server/src/game/people/death.ts)).
- **Journeys** with `positionAt` ([`shared/road/journey.ts`](../../../packages/shared/src/road/journey.ts)); patrols already walk roads.
- **Guards** are a job; `barracks` is a building; captains are a role.

## Decisions made in this plan

1. **An army is a record:** `armies(id, kingdom|faction, war, commander, status: mustering|marching|camped|besieging|fighting|disbanded, at, journey, supply, morale, since)` and `soldiers(army, who, rank, unit, joined, how: levy|volunteer|mercenary|knight|slave, wage, status: serving|wounded|captured|missing|deserted|dead|discharged)`. Soldiers are person refs: rows (most), talkers, figures. A row's `job` becomes `soldier` while serving (`jobs_held` records `soldier:<rank>`), and they're **away** (N26 Part E's `people.away`, purpose `war`, `returns: true`): still counted as their home's people, not in its crowd, positioned by the army's journey.
2. **Raising an army** when a war starts (or a campaign is decided: the war's attacker raises; defenders raise on news of it arriving: N33):
   - **Levies** by the kingdom's `levy` policy (section 14): `serfs_owe` (a share of serfs of fighting age per place), `all_free_men`, `none` (paid only); slaves as fodder where the law allows (`slaves_fodder: true`). Picked by rule from each place's rows (age, health, not the only adult of a household where the policy spares them), sent as journeys to the muster point.
   - **Volunteers** by N38 (`enlist` action, grain day): scored by ambition (`knighthood`, wealth), poverty, pay, patriotism (`lord` axes of the outlook), grievances against the enemy, bravery.
   - **Mercenaries** by contract (a faction or band with a `service` treaty: existing).
   - **Knights and nobles** by duty (class gentry/noble with combat skill; knights are a rank track).
   The army's **strength** is computed from its soldiers (tier, gear, numbers, ranks of officers), not from settlements. `armyOf` is replaced (or reads the army when one exists, the old formula as a fallback for factions without armies).
3. **Ranks:** `levy → soldier → sergeant → lieutenant → captain → commander → marshal`, knights alongside (`squire → knight → banneret`). Promotion after battles survived (a count), deeds (kills of officers, saving a commander, holding a line: from the battle roll), renown, and the commander's favour (relationship); demotion or execution for cowardice (fled from battle) or failure (lost a battle as commander) by the kingdom's law (N48 `desertion`). A famous soldier rises to a figure and talker (N13's rules). Veterans come home changed: trait drift (bravery up or broken, temper), injuries, a grievance against the enemy or their own commander.
4. **Marching and supply:** the army is a journey along roads (N26) from muster to the front, at army pace, stopping each night (a camp on the map: tents, fires), drawing **supply** from places it passes or holds (N30's stores: the place's food falls; a hungry army's morale drops and it forages: a raid on its own people). Hunger and disease in camp (N61 once built: an outbreak model on the army) kill and weaken. Armies on the road are visible to the player and a situation (papers checked, conscription of the player if eligible: decision 8).
5. **Battles with real people.** `warsDay`'s battle, when both sides have armies at the front: `fight` gets sides built from soldiers. Casualties are **drawn from the soldiers present** by rank exposure (levies in front die more, officers less, knights in the melee), each roll a **hero/coward** test from bravery: heroes kill or hold (deeds, promotion), cowards flee (deserters: a status; may become bandits: they join a gang or form one, N13). The winner takes **prisoners** (captured status; held for ransom by the captor's kingdom; exchanged at peace or sold where slavery is law). Some are **missing** (not found after the battle): a state that resolves later (found dead, turns up alive at home after the peace: an event, or deserted). Every death is a typed record with `war`, `battle`, `side`, `killer` (when the battle roll pairs them), recorded with the battle's ref.
6. **The war dead are their own record.** `war_dead(war, battle, side, who, rank, day, cause: battle|siege|skirmish|execution|camp_disease|missing_presumed)`: the **roll of the fallen** per war and battle. The admin counts deaths by cause, and **war dead are never mixed with plague or famine deaths** (separate tables or causes). Families get: grief (outlook, N36) of a kind by the death (pride if the war was popular and they died well; bitterness if the commander was blamed: a grievance against the commander; a grudge against the enemy side), pensions by the kingdom's policy (`war_pensions`), widows and orphans recorded. **War graves** at the battlefield (N27 POI with graves) and **memorials** at home (N31 `memorial` mark listing names); songs of the fallen (N68).
7. **War weariness** becomes concrete: a kingdom's weariness rises with its dead (share of its people), levies taken, taxes raised for war (`WAR_TAX`), and stores eaten; it feeds unrest (N56's grievances against the crown, N58's memory) and peace (endWar's weary rule reads it).
8. **The player** can enlist (volunteer) or be levied (if their class and the policy say so, and they live in the kingdom: they get a summons; refusing is a crime), serve with the same ranks and promotion rules, desert (a crime), and lead (as an officer, through N57's commands later).

## Data shapes

```ts
// SQLite: armies(...), soldiers(...), war_dead(...), prisoners(who, captor, war, since, ransom, status)
// DeathRecord gains war?: string; battle?: string; side?: "attackers" | "defenders"
// policy keys: levy, slaves_fodder, war_pensions
```

## Steps

### Step 1: armies and soldiers as records
- Tables, `game/war/army.ts`; raising by levy policy, volunteers (`enlist` action), mercenaries, knights; strength from soldiers.
- Test (done-when part): a war raises levies from real start-town serfs (rows whose job becomes soldier, who leave the place's roster).

### Step 2: marching, camps, supply
- Army journeys to the muster and the front; camps; supply from stores; hunger.
- Test: the levies march to the battle (their journey's positions along the road; arrival at the front).

### Step 3: battles with real people
- `fight` sides from soldiers; casualties drawn from those present; heroes, cowards, deserters, prisoners, missing; typed deaths with war, battle, side.
- Test (done-when part): those killed are on the war's roll of the fallen with the battle named.

### Step 4: ranks and promotion
- Ladders, promotion and demotion rules; executions for desertion by law; rising to figures; veterans' drift.
- Test (done-when part): a levy survives three battles and is promoted to sergeant.

### Step 5: the war dead and their families
- `war_dead`; pensions; grief kinds; grudges against the enemy or commander; war graves and memorials (N31/N27 if built).
- Tests (done-when parts): the families of the dead grieve and one carries a grudge against the enemy; a missing soldier comes home after the peace.

### Step 6: weariness, the player, admin
- Weariness from concrete losses; the player's enlistment, levy summons and service; admin: armies, soldiers and ranks, each war's dead by battle and place, deaths by cause.
- Test (done-when part): the admin counts the dead by cause, and war dead are never mixed with plague or famine deaths.

### Step 7: docs
- README: war and soldiers.

## Balance bounds

- `wars-not-genocidal`: a war's dead under a share of the kingdoms' people.
- `promotion-ladder`: sergeants and captains exist in proportion.
- `deserters-become-bandits`: some, not all.
- `realm-day-budget`: armies and soldiers inside N19's budget (tens of thousands of soldier rows in a big war: soldiers are rows; the army's daily step must be O(soldiers) with tiny constants).

## Edge cases and traps

- **Lazy places and levies:** taking rows out of a lazy place must bring it up to date first (`ensureCurrent`, as migration does).
- **The talkers among soldiers** (a notable's son) keep their talker files; their place says they're at war.
- **Battles at the player's place** play on the map (the raid code) with the real soldiers spawned; elsewhere they're rolled.
- **Old `armyOf`** stays as a fallback for parties without armies (gangs, rebels before N56 gives them bands).

## Tests (`packages/server/tests/n55.test.ts`)

The done-when ones:
- A war raises levies from real start-town serfs who march to a battle.
- A levy survives three battles and is promoted to sergeant.
- Those killed are on the war's roll of the fallen with the battle named; their families grieve and one carries a grudge against the enemy.
- A missing soldier comes home after the peace.
- The admin counts the dead by cause, and war dead are never mixed with plague or famine deaths.

## Done when (mapped)

| Done-when clause | Proved by |
|---|---|
| a war raises levies from real Millbrook serfs who march to a battle | steps 1–2 tests |
| a levy survives three battles and is promoted to sergeant | step 4 test |
| those killed are on the war's roll of the fallen with the battle named; their families grieve and one carries a grudge against the enemy | steps 3, 5 tests |
| a missing soldier comes home after the peace | step 5 test |
| the admin view counts the dead by cause, and war dead are never mixed with plague or famine deaths | step 6 test |

**Save:** the next schema version (`armies`, `soldiers`, `war_dead`, `prisoners`); the next save version (policies, death record fields).

## Slice cut

Not in the slice.

## Out of scope

Tactics on a battle map. Naval war. Sieges as long minigames (a siege is a status with supply and assaults rolled).
