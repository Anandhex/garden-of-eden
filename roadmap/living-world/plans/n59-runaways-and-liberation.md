[← Plans](README.md) · [Stage 5: N59](../stage-5-power-and-conflict.md#n59-runaways-and-liberation)

# N59 plan: Runaways and liberation

**In one line:** each slave (a row or talker of class slave) has a daily **escape chance** from their grievances against their master, mistreatment, boldness, a missing guard or a festival, and rumours of a free kingdom near; a runaway **runs** as a journey toward freedom (a free kingdom's border or the wilds) with catchers, bounties and road situations; each free kingdom has a **runaway policy per slave kingdom** (shelter, return for a reward, ignore) set by its ruler and changeable by treaty and pressure; a runaway who survives and gains renown can found a **liberation group** with a hidden camp that raids to free slaves; slave kingdoms tighten control (N58), and a strong group can take a settlement (N64).

**Read first:** [plans README](README.md) sections 2, 13, 14 (`runaways:<kingdom>` policy), 17. Needs N26 (journeys, roads, toll gates and border checks), N27 (hidden camps; step 0 if missing), N56 (bands from grievances), N58 (crackdowns after escapes). Uses N33 (rumours of a free kingdom; hope), N42 (bounties on the board), N46 (hidden runaways as secrets), N47 (forged freedom papers), N48 (runaway as a crime), N49 (the player as a slave uses these paths), N64 (taking a settlement).

## What exists

- **Slaves** as a class with masters (`master`, `master_id` on rows; `kingdomLaws` slavery; the crowd's master/slave chatter; slaves' work schedules in [`shared/crowd.ts`](../../../packages/shared/src/crowd.ts)).
- **Migration** of households ([`people/migration.ts`](../../../packages/server/src/game/people/migration.ts)): only free classes move; slaves don't.
- **Journeys** with kinds (N26 [`road/sources.ts`](../../../packages/server/src/game/road/sources.ts)): runaways listed in the stage file but not built; toll gates at kingdom borders; situations `papers_checked`, `patrol_search`.
- **Outlooks** with grievances and `lord` axes; N37 grievances against masters.

## Decisions made in this plan

1. **Escape is a daily rule for slaves** (rows: in the life step; talkers: in their day): `p = base × f(grievance vs master, mistreatment events in the last season, boldness (bravery), hope)` × opportunity (a festival day (N30): ×3; the master away; guards fewer: N58 policies the other way; a crackdown: ×0.3). **Hope** is a place value from knowledge rows (N33): the share of slaves there who know of a free kingdom's shelter policy, a liberation group's raids, a recent successful escape (a contagion: one escape makes the next more likely). Stream `streamFor(seed, "escape", who, day)`.
2. **The run is a journey** (`runaway` kind) toward the nearest refuge they know of: a free kingdom whose policy toward their kingdom is `shelter` (if they've heard), else the wilds (a hidden spot: N27) or a liberation camp they've heard of. They travel at night where possible, off main roads near checkpoints. **Catchers:** the master posts a **bounty** (a job on N42's board; NPC hunters take it); patrols and toll gates check (a roll by the policy and the guard's attention; bribery with N47 papers); a road situation `runaway_on_road` for the player (help, ignore, turn in). Caught runaways are **punished** (N48's law: flogging, branding, sold away) and returned; other slaves at the place **hear of it** (fear up, hope down).
3. **Runaway policy** (section 14) for each free kingdom toward each slave kingdom (`runaways:<k>`): `shelter`, `return_for_reward`, `ignore`. Chosen by the ruler's traits (loyalty to people, greed, bravery), opinion of that kingdom, the state faith's tenets (N50: `liberation` → shelter), and pressures: war threat from the slave kingdom (→ return), a bribe or treaty clause (`return_runaways` in a treaty), a liberation hero's renown (→ shelter), unrest at home (N58: commoners who resent returns). A new ruler re-decides; every change is news.
   - **Shelter:** runaways reaching the border are free (class becomes commoner, a new home in a border place: N25 arrival); relations with the slave kingdom fall per runaway sheltered; the slave kingdom may **demand them back** (a diplomatic event) and refusal can lead to raids or war (N13's war chance with a cause).
   - **Return for a reward:** border guards hand them back for coin; relations improve; the kingdom's own commoners (and any abolitionist faction) gain a grievance against the crown (N56/N58).
   - **Ignore:** no help, no hunting; runaways get no new home: they're more likely to join gangs or a liberation group.
4. **Border guards, talk and bounties follow the policy** in play: the guards at a shelter kingdom's toll gate wave runaways through and arrest catchers who chase across; at a return kingdom they hold runaways for the reward; talkers in border places talk about it; bounties posted across the border are void in shelter kingdoms.
5. **Liberation group:** a runaway who survives (free or hidden) with renown (escapes, deeds) and grievances founds a faction (kind `rebels` with trade-like purpose `liberation`, or a `liberation` kind) with a **hidden camp** (an N27 POI, state-sourced: "exactly where the realm says the runaways are"); it **raids** (a fight with real people: N55 sides) a slave market or estate to free slaves (who join or flee), **recruits** the freed, and **grows**. The leader may rise to a talker with their own history (N13 rise rules; the persona's depth from their real past: N25a facts).
6. **Ripples:** slave kingdoms add escapes and raids to their **unrest memory** (N58: tightening: more guards, harsher punishments, curfews for slaves); hope rises among slaves where a group operates; a strong group can **take a settlement** (a revolt by N56's rules where the group's strength beats the place's force), which then breaks away (N13) and can become a kingdom (N64, with no slaves by law).
7. **The player** can join the group, hunt runaways (the bounty jobs), help a slave escape (an action: forged papers, hiding them: an N46 secret, guiding them on the road), and use these paths themselves as a slave (N49).

## Data shapes

```ts
// policy keys "runaways:<slaveKingdom>" on free kingdoms; treaty clause: Treaty gains clauses?: Array<"return_runaways">
// Journey kind "runaway" (party: the runaway; target: a refuge); rows: status "runaway" while running (not at home, not in the roster)
// faction kind or purpose "liberation"; camp POI source
```

## Steps

### Step 1: escapes
- The daily rule with hope and opportunity; the runaway status; the master's bounty.
- Test (done-when part): a mistreated slave (many grievances against a cruel master) escapes during a festival (fixed seed).

### Step 2: the run
- `runaway` journeys toward known refuges; catchers (bounty hunters, patrols, gates); the road situation; capture, punishment and return; hope and fear.
- Test: a caught runaway is returned and punished, and other slaves there know of it.

### Step 3: runaway policies
- Keys, decisions, pressures, treaty clause, news; guards and talk by policy.
- Test (done-when parts): a runaway reaching a sheltering free kingdom is freed and that kingdom's relations with the slave kingdom fall; a free kingdom with a `return` policy hands a runaway back for coin and its commoners resent it (grievances against the crown).

### Step 4: liberation groups
- Founding by a surviving runaway; the hidden camp (N27 state POI); raids that free slaves; recruiting; growth; the leader rising.
- Test (done-when part): the runaway founds a liberation group that frees others in a raid.

### Step 5: ripples
- Slave kingdoms' unrest memory and tightening (N58); taking a settlement (N56 revolt rules) and the hook to N64.
- Test (done-when part): the slave kingdom cracks down after the raid (a repression policy with the raid in its why).

### Step 6: the player; admin; docs
- Join, hunt, help, hide; admin: escapes, runaways on the run, policies, groups and camps. README.

## Balance bounds

- `escapes-band`: escapes per thousand slaves per year in a band; most are caught where policies are hostile.
- `groups-not-instant`: a liberation group needs a few seasons to grow.

## Edge cases and traps

- **Rows on the run** use N26 Part E's `people.away` (purpose `runaway`, `returns: false`): out of their place's crowd but still its people until they're free elsewhere (the arrival moves them, as a migration's does) or caught (returned home).
- **Hidden camp positions** must be the same for N27's POIs and the group's state (one source).
- **The slice rule:** no site is special; the "free kingdom" and "slave kingdom" come from laws (section 12).

## Tests (`packages/server/tests/n59.test.ts`)

The done-when ones:
- A mistreated slave escapes during a festival, is sheltered by a free kingdom whose relations with the slave kingdom then fall, founds a liberation group that frees others in a raid, and the slave kingdom cracks down.
- A free kingdom with a "return" policy hands a runaway back for coin and its commoners resent it.

## Done when (mapped)

| Done-when clause | Proved by |
|---|---|
| a mistreated slave escapes during a festival | step 1 test |
| is sheltered by a free kingdom whose relations with the slave kingdom then fall | step 3 test |
| founds a liberation group that frees others in a raid | step 4 test |
| the slave kingdom cracks down | step 5 test |
| a free kingdom with a "return" policy hands a runaway back for coin and its commoners resent it | step 3 test |

**Save:** the next save version (policies, treaty clauses, liberation factions, runaway journeys); rows' `status` (from N48) gains `runaway`.

## Slice cut

Not in the slice.

## Out of scope

Abolition as a kingdom-wide policy change by a ruler (possible later through `laws.slavery` as a policy). New kingdoms (N64).
