[← Plans](README.md) · [Stage 3: N40](../stage-3-npcs-choose.md#n40-ambitions-and-careers)

# N40 plan: Ambitions and careers

**In one line:** everyone grown has one **ambition** (a row in `ambitions`) picked in code from class, job, traits and family, with a **ladder** of steps; progress comes from what they do (N38's actions, N25's life step, the economy); ambition adds long-term weight to N38's scores; careers move (apprentice → journeyman → master, a shop of one's own, an office, a guild seat), seats are scarce so people **compete**, and the loser carries a grievance (N37). Talkers say what they want.

**Read first:** [plans README](README.md) sections 2, 13, 15 (`ambitions`, `jobs_held` are this phase's), 17. Needs N38 (the menu: ambition becomes score parts and a few new actions). Uses N37 (grievances from losing a rivalry), N25 (lives, ages, deaths that free seats), N13's realm offices (heads, captains, guild masters).

## What exists

- **Jobs:** townsfolk rows have `job`, `work`, `master`, `master_id`; `occupationAtAdulthood(cls, gender, kind, rng)` ([`people/jobs.ts`](../../../packages/server/src/game/people/jobs.ts)) picks a job at coming of age; `NO_RETIRING`. Jobs never change after that. `apprentice` is a job; `master_id` links a servant or apprentice to someone.
- **Talkers:** trades, skills with tiers ([`npc/skills.ts`](../../../packages/server/src/npc/skills.ts)), XP and rank ([`life.ts`](../../../packages/server/src/game/life.ts)), training the player ([`training.ts`](../../../packages/server/src/game/training.ts)), guild ranks by standing ([`factions.ts`](../../../packages/server/src/game/factions.ts) `rankWith`), titles ([`titles.ts`](../../../packages/server/src/game/titles.ts)).
- **The realm's offices:** settlement heads (`leader`), captains, guildmasters, faction leaders, chosen by `successionDay`/`install` ([`realm/politics.ts`](../../../packages/server/src/game/realm/politics.ts)) by renown and rank; figures have `ambition` (a 0..1 trait) but no goal.
- **N25b outlook goals** (`move`, `avenge`) for townsfolk: short-term, from code reviews.
- **Tables:** `ambitions(who, kind, target, progress, since)`, `jobs_held(who, job, site, from_day, to_day)`, empty.

## Decisions made in this plan

1. **Ambition kinds** (data in `game/ambition/kinds.ts`), each with who can hold it, a ladder and how progress is measured:
   - `master_trade` (artisans): apprentice → journeyman → master (skill tier and years at the bench) → own shop.
   - `guild_seat` (guild members): member → officer → guild master (renown in the guild, standing, and a seat being free).
   - `land` (commoners, gentry, rich serfs where allowed): coin saved → a plot bought (a farm lot in the place) → tenants.
   - `office` (anyone with renown and the class the place allows): a seat on the council, captain of the guard, head of the place, a lord's steward.
   - `wealth` (merchants): coin over thresholds; a caravan of one's own; a trading house (N66 lets the player have one too).
   - `good_match` (parents): a child married above the family's class (feeds N45's arranged marriages).
   - `revenge` (from N37 grievances above a threshold: becomes a life goal, which is how N44's nemesis is born).
   - `freedom` (slaves and serfs: buy freedom, earn it, or run: N59 later).
   - `knighthood` (soldiers, squires: N55 fills the ranks) and `grade` (adventurers: N42's grades).
   - `quiet_life` (the content and the old: no ladder; keeps the habit weights).
2. **Picked in code, re-picked on events.** `pickAmbition(row or talker, ctx, rng)` at adulthood and whenever the current one is **achieved** or **impossible** (the seat went to a rival for life, a master died with no shop to take, the child married). Weights from class, job, traits (ambition, greed, pride, caution), family (a master's child wants the shop), age (the old want quiet). Stream `streamFor(seed, "ambition", who, day)`.
3. **Progress is measured, not rolled.** Each kind has `progressOf(who, world)` (skill tier, coin, standing, renown, years) computed in the daily step from the person's state. Steps are taken by **events**: a guild exam, a master's say-so, a seat falling vacant, buying a lot. Those are rules in code, each an event.
4. **Ambition in N38's scores:** each kind adds score parts to the actions that move it (`work` +0.2 for `master_trade`; `buy` land; `recruit` and `flatter` toward the people who decide a seat; `court` for `good_match` of oneself; `travel` to a bigger town for a better master). Small per hour, so the day still mostly follows habit; over years it adds up.
5. **Careers change:**
   - **Townsfolk change jobs** in the daily step: an apprentice becomes a journeyman then a master by years and skill (townsfolk get a coarse `skill` 0..5 on their row: one new column) and, as master, may **open a shop** (job becomes the trade's master job, `work` = a building lot: N31's reserved lots let a new shop appear on the map), taking an apprentice (another young person whose `master_id` points at them).
   - **Talkers** progress through the same ladder; their persona's job and title update.
   - **`jobs_held`** records every change (`from_day`/`to_day`), so a career is readable and N55 writes service there.
6. **Scarce seats and rivalries.** A seat (a guild officer post, the guild master, a council seat, the captaincy, the only smithy in a village) has **candidates**: everyone with that ambition at the seat's place whose progress qualifies. When it falls free, code picks by the rule for that seat (the guild's vote = standing and friendships among members; a lord's appointment = the lord's relationship and the candidate's renown; a village head = N13's succession). The losers each get a **grievance** against the winner (weight by how close they came and their pride), so rivalries come from ambition, and N37/N38 carry them on.
7. **Visible:** the admin card shows the ambition, its ladder, progress and rivals; talkers asked "what do you want?" answer from it (a persona line "You want to be master of the smiths' guild; Odo is in your way."); townsfolk who become talkers keep theirs.

## Data shapes

```ts
// ambitions row
{ who: string; kind: AmbitionKind; target: string | null /* a seat id, a person, a place */; progress: number /* 0..1 within the current step */; since: number; step?: number /* add column */ }
// people row gains: skill INTEGER (0..5), shop TEXT (building lot) – one migration
// seats: game/ambition/seats.ts — seatsOf(site) derived from the place's buildings and factions; holder from people/figures/talkers.
```

## Steps

### Step 1: kinds, picking, the table
- `game/ambition/kinds.ts`, `pick.ts`; write `ambitions` rows at adulthood and in a one-off pass for everyone at load (a migration fills existing people).
- Test: across a seeded town, the spread of ambitions follows class and job (no serf wants a guild seat where serfs can't hold one; most artisans want mastery).

### Step 2: progress and steps for trades
- `skill` column for townsfolk; yearly growth by job and age; apprentice → journeyman → master by years and skill; opening a shop on a free lot; taking an apprentice. `jobs_held` rows.
- Test (done-when part): over a few simulated years an apprentice becomes a master and opens a shop (a new shop building appears on the place's map from its reserved lot, N31).

### Step 3: seats and rivalries
- `seats.ts`; candidates; the choosing rules; grievances for the losers.
- Test (done-when part): two journeymen compete for one guild seat; one gets it; the loser has a grievance against the winner.

### Step 4: ambition in the menu
- Score parts from the ambition for N38's actions; a few new actions where needed (`seek_master` = travel to a bigger place to learn; `buy_land`; `petition` = ask the seat's decider).
- Test: two otherwise equal NPCs, one with `guild_seat`, flatter the guild master more often over a month.

### Step 5: talkers and the admin
- Persona lines; talker ladders; admin card.
- Test (done-when part): an NPC asked what they want names their ambition (the reply's fallback contains the kind's words; with the fake model, the prompt contains the ambition line).

### Step 6: re-picking; docs
- Achieved/impossible rules; README: ambitions and careers.

## Balance bounds

- `ambitions-churn`: a share of ambitions are achieved or changed each year; none fixed for a whole life except `quiet_life`.
- `seats-filled`: no seat stays empty more than a season when candidates exist.
- `shops-bounded`: shops per place within what its lots and economy allow.

## Edge cases and traps

- **Map growth:** a new shop needs a lot (N31's fixed layouts). If N31 isn't built, a new shop is a change of an existing house's use (a sign on the house), not a new building.
- **Economy:** more masters means more goods; the place's demand (N10's prices) should push some to move (N25 migration reads "no work here"). Watch `shops-bounded`.
- **Lazy places:** careers change in the daily step from rows and `site_days` only; seats in a lazy place are decided in catch-up in day order.
- **Talkers' trades are richer than townsfolk's.** Keep one ladder definition and map talkers' skill tiers to the townsfolk scale (0..5 = untrained…master).

## Tests (`packages/server/tests/n40.test.ts`)

The done-when ones:
- Over a few simulated years an apprentice becomes a master and opens a shop.
- Two journeymen compete for one guild seat and the loser bears a grudge.
- An NPC asked what they want names their ambition.

## Done when (mapped)

| Done-when clause | Proved by |
|---|---|
| an apprentice becomes a master and opens a shop | step 2 test |
| two journeymen compete for one guild seat and the loser bears a grudge | step 3 test |
| an NPC asked what they want names their ambition | step 5 test |

**Save:** the next schema version (`people.skill`, `people.shop`, `ambitions.step`).

## Slice cut

Steps 1–3 and 5 for the start town and its liege town.

## Out of scope

Adventurer grades (N42 owns the `grade` ladder). Military ranks (N55). Inheritance of shops (N45). The player's own career (N66).
