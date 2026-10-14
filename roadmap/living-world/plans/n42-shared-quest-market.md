[← Plans](README.md) · [Stage 3: N42](../stage-3-npcs-choose.md#n42-a-shared-quest-market-and-adventurer-grades)

# N42 plan: A shared quest market and adventurer grades

**In one line:** every job (a giver's quest, a realm need, a bounty, a cull, a delve, an escort, a delivery, a survey) becomes one record on one market, posted at a board in a place and visible to everyone there; whoever **claims** it first holds it until done, failed, given up or past its deadline; NPC adventurers, hunters and explorers (and willing townsfolk) choose jobs with N38's scoring and run them with the code that already runs delves and hunts; adventurer **grades** (the item tiers) gate jobs for the player and NPCs alike; parties form, split loot and break up.

**Read first:** [plans README](README.md) sections 2, 13 (`take_job`, `form_party`), 15, 17. Needs N38 (the menu), N40 (the `grade` ambition and renown ladders). Uses N26 (journeys to the job: adventurers on the road), N33 (results as news), N37 (grudges over stolen kills), N41 (contest jobs), N63 later (surveys).

## What exists

- **Quests** ([`quests.ts`](../../../packages/server/src/game/quests.ts)): each giver talker has `state.questBoard` (their offers); the player accepts (`acceptQuest`), progress by records (`recordCreatureDefeat`, `recordClear`, `recordGather`, `recordCraft`, `deliverMessages`, `checkEscorts`), `turnInQuests`, `failOverdueQuests`, tier caps (`questTierCap`), respect needed. Only the player takes them.
- **Realm needs** post jobs to a place's givers ([`realm/needs.ts`](../../../packages/server/src/game/realm/needs.ts) `postNeedQuests`: `rq_<need>_…`), with cooldowns per place.
- **Realm adventurers and hunters** ([`realm/wilds.ts`](../../../packages/server/src/game/realm/wilds.ts)): `dungeonsDay` (delves by figures, `delve`, `levelPower`, `DELVE_CHANCE`), `packsDay` (culls, bounties on packs and dungeons), XP and titles through `figureOvercomes`. `guildRank(player)` = apprentice/journeyman/master by renown (player only); `ADVENTURERS` guild faction, `joinGuild`, `GUILD_FEE`.
- **Companions** ([`party.ts`](../../../packages/server/src/game/party.ts)): hire, wages, loyalty, leaving; the player's party.
- **Tiers:** `ITEM_TIERS` (F…SSS) used for ranks (`life.tier`), quests and items.

## Decisions made in this plan

1. **One market.** `jobs` table (SQLite; there may be hundreds across the realm): `id, site, board, kind, giver, title, target (pack/dungeon/person/place/item), tier, reward, posted, deadline, holder (party id | "player" | null), claimed_day, status (open|held|done|failed|expired), result, ref`. A **board** is a place's notice board, its guild hall, or a giver in person (N9's givers keep offering in conversation, but the offer *is* a job row).
2. **Sources write job rows**: a giver's quests (today's `questBoard` entries become rows; `questBoard` becomes a view over rows with `giver = them`), realm needs (`postNeedQuests`), bounties on packs and dungeons (realm `bounty` fields become a job each), escorts (caravans in N26 that want guards), deliveries (letters N34, goods), rescues (N62 later), surveys (N63), contests (N41's "champion wanted"), runaway bounties (N59). Each source is a small function writing rows; the old per-system bounty handling reads the job's status instead.
3. **Claiming is first come.** `claim(job, party, day)` sets the holder; others see it as taken ("held by Odo's party") until it resolves. A holder can give up (back to open, a small renown loss), fail (back to open, with the failure recorded), or let the deadline pass (expired: back to open if the need remains, with a shorter deadline). Re-posting is immediate, so a failed job is on the board again the next morning.
4. **NPCs choose jobs with N38.** A new action `take_job` (grain: day) for anyone with the adventurer, hunter or explorer job, guild members, and townsfolk whose ambition is wealth or renown and who have combat skill. Score: reward vs need for coin, **danger vs own strength** (job tier vs their tier; party strength), ambition (`grade`), distance, traits. **Reckless** NPCs (high T, low caution) take jobs above their grade; cautious ones don't. A claim by an NPC is an event ("Odo's party took the wolf cull").
5. **Running a job is today's code.** NPC parties travel to the job (a journey; N26) and the job resolves when they arrive, with the existing resolvers: culls with `packsDay`'s fight (`packSide` vs party side), delves with `delve`, escorts with the caravan's journey (bandit ambush ground checks), deliveries on arrival. At coarse detail it's a daily batch; if the player is where the job happens, the fight is real on the map (the party is spawned as creatures/talkers at the target).
6. **Grades for everyone.** `grade` on the adventurers' guild membership: a tier F…SSS (matching existing tiers). A job's tier sets the minimum grade (one above is allowed with the guild's leave, any above for the reckless who ignore it at a renown risk). Promotion: jobs done at or above the grade (a count), renown, and for B and above a **trial** (a guild-set job of the next tier that must be done). Demotion for repeated failures; expulsion for crimes (N48 later; today crimes known by the guild). `guildRank` becomes `gradeOf(member)` and the player uses the same rule (their old apprentice/journeyman/master map to grades for a migration).
7. **Parties.** A party: `{ id, members, leader, roles (fighter, healer, scout), grade (the leader's), shares: "equal" | "leader-heavy" | "by-role", formed, record }`. NPCs form parties by role need, friendship and grade (an N38 action `form_party` / `join_party`), split loot by agreement, and break up over a death, a failure, an unfair split (a grievance; N37) or arguments (low affection). The player can join an NPC party (their leader's terms), hire one (a contract: a job held by them for the player's pay), or recruit NPCs into their own (N8's companions get a share agreement).
8. **Competition:** an NPC party can claim a job the player saw first; when the player comes to claim, the board says who holds it. Stealing a kill (finishing a job another holds) is allowed but: no reward from the giver, a grievance with the holder, a reputation hit with the guild.
9. **Givers react.** A giver whose job someone else did tells the player ("Odo's lot saw to the wolves yesterday; paid them myself.") and stops waiting; givers keep a small preference list (trust per party) and post their next jobs **to** a trusted party first (claimed for a day before the board).
10. **Rising:** a party member with many deeds rises by N13's rules (figure → talker); ambition `grade` (N40) "reach grade S" drives the score.

## Data shapes

```ts
// SQLite: jobs(...) as decision 1; parties(id, leader, members JSON, roles JSON, shares, formed, disbanded, record JSON)
// guild membership grade: on figures (life.tier exists; add guildGrade), on talkers (state.guildGrade), on the player (player.guildGrade), on rows (people.grade column) — one helper gradeOf(ref)
```

## Steps

### Step 1: the jobs table and the board view
- Migration (`jobs`, `parties`); `game/market/jobs.ts`; `questBoard` reads rows; the player's `acceptQuest` becomes `claim(job, "player")`; all quest tests still pass.
- Test: posting, claiming, giving up, failing and expiring move the job's status and re-open it.

### Step 2: sources
- Realm needs, pack/dungeon bounties, escorts, deliveries write rows; the old bounty fields read job status.
- Test: a pack's bounty is a job on the nearest guild/board; completing the job clears the pack's bounty.

### Step 3: grades
- `gradeOf`, promotion, trials, demotion; the player's migration from renown ranks; job eligibility by grade.
- Test (done-when part): an NPC adventurer climbs a grade from jobs done and passes a trial.

### Step 4: NPCs take jobs
- `take_job` action; travel to the job (journeys); resolution by existing code; payment and renown; failure and death (a reckless NPC above grade).
- Tests (done-when parts): an NPC party claims a wolf-cull job the player saw on the start town's board, does it while the player waits, and the giver pays them and tells the player it's done; a reckless low-grade adventurer dies on a job above their grade and the job returns to the board.

### Step 5: parties
- Forming, roles, shares, breaking up; joining, hiring and recruiting for the player.
- Test (done-when part): the player joins an NPC party and shares the loot by the agreed split.

### Step 6: competition and givers
- Taken jobs shown as held; stolen kills; givers' trust and direct offers.
- Test: a giver whose job an NPC party did tells the player and doesn't hold it for them.

### Step 7: admin and docs
- Admin: every board, who holds what, each adventurer's grade and record. README: the market and grades.

## Balance bounds

- `jobs-get-done`: most jobs are done or expire, few stay held past deadlines.
- `adventurer-deaths`: deaths per season among adventurers in a band (some die, not all).
- `grades-spread`: the realm's adventurers spread across grades (not all F, not all S).
- `player-gets-jobs`: in a place with a board, there's usually something open the player's grade allows.

## Edge cases and traps

- **The player's quests are richer** (dialogue, objectives, deliveries to talkers). Keep that; the job row is the claim and the reward, the objective tracking stays in `quests.ts`.
- **Two parties at one pack:** claims prevent it for jobs; but a pack can be attacked by anyone (a hunter on their own). The job's resolution checks the target still exists; if it's gone, the job is done by whoever did it (the record says).
- **Reckless NPCs dying too often** empties the realm of adventurers: the bound watches it; recruitment (young people choosing the adventurer job at adulthood) refills.
- **Determinism of claims:** claims in the same hour resolve by party id order; the player's claim is immediate when they act.

## Tests (`packages/server/tests/n42.test.ts`)

The done-when ones:
- An NPC party claims a wolf-cull job the player saw on the start town's board, does it while the player waits, and the giver pays them and tells the player it's done.
- An NPC adventurer climbs a grade from jobs done and passes a trial.
- A reckless low-grade adventurer dies on a job above their grade and the job returns to the board.
- The player joins an NPC party and shares the loot.

## Done when (mapped)

| Done-when clause | Proved by |
|---|---|
| an NPC party claims a wolf-cull job the player saw … and tells the player it's done | step 4 + step 6 tests |
| an NPC adventurer climbs a grade from jobs done and passes a trial | step 3 test |
| a reckless low-grade adventurer dies on a job above their grade and the job returns to the board | step 4 test |
| the player joins an NPC party and shares the loot | step 5 test |

**Save:** the next schema version (`jobs`, `parties`, `people.grade`); the next save version (grades on the player and talkers; `questBoard` removed from talker state in favour of rows, with a migration that writes existing boards as rows).

## Slice cut

Not in the slice.

## Out of scope

Item provenance of loot (N43). Nemesis rivals (N44). Military contracts (N55). Player-led companies (N57).
