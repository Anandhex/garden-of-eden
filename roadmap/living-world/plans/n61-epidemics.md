[← Plans](README.md) · [Stage 6: N61](../stage-6-a-changing-world.md#n61-epidemics)

# N61 plan: Epidemics

**In one line:** an outbreak is a **disease** (data: how it spreads, how long, how deadly, what cures) running a per-place **SIR model** (susceptible → infected → recovered or dead) with a contact rate from crowding; the dead and sick are **real people** picked by the life step (like casualties); it spreads **between places only with carriers** (journeys, migrants, armies, the player); places respond (closed gates, quarantine, healers and herbs in demand, flight, blame); nothing is narrated until someone knows.

**Read first:** [plans README](README.md) sections 2, 3, 17 (`site_days.plague` already exists, unfilled). Needs N25 (rows, typed deaths with `illness`, casualty-style picking), N33 (carriers and knowledge). Uses N26 (journeys), N28 (herbs that treat it), N30 (season and crowding indoors), N36 (fear), N50 (blame: a scapegoat faith), N51 (healing magic, capped; witch hunts after a plague), N55 (camp disease), N58 (closures as policies).

## What exists

- **Illness for individuals** ([`health.ts`](../../../packages/server/src/game/health.ts)): `ILLNESSES` (fever, winter cough: `spread`, `days`, attribute effects, remedy), `fallIll`, `spreadIllness(group, day, rng)` per hour together, `cure`, `cureQuest`, `ILLNESS_CHANCE` by season. Talkers only.
- **`SiteDay.plague`** (0..1) is read by N25's death rates (`people/rates.ts`) but always 0 ([`conditions.ts`](../../../packages/server/src/game/people/conditions.ts) "N61 fills it").
- **Death cause** `illness` in the typed record.
- **Journeys** carry parties; migrants are rows that move.

## Decisions made in this plan

1. **Diseases are data:** `data/diseases/*.json`: `{ id, name, kind: "plague" | "pox" | "flux" | "fever" | "camp_fever", r0, incubationDays, infectiousDays, mortality (by age band), season?: weights, spreadsBy: ["contact", "water", "rats"], cures?: [{ item | spell, effect: "shorten" | "halve_mortality" }], marks: "boils" | "rash" | … }`. Starting set: a plague (deadly, rats and contact), a pox (children), a flux (water, camps, sieges), the existing fever and winter cough as mild endemic ones.
2. **SIR per place.** An outbreak record per place: `outbreaks(id, disease, site, start, S, E, I, R, D, peak, ended)`. Daily step: new exposures `β·S·I/N` with `β = r0 / infectiousDays × crowding factor (N25's `crowding`, the season's indoor share: N30, a market/festival day bonus)`; exposed become infected after incubation; infected recover or die by mortality. Counts only, cheap; randomness from `streamFor(seed, "sir", site, day)`.
3. **Who is sick is real.** Each day the place's step **picks** individuals for the counts (like N25's casualty picking): the newly infected (weighted by age, poverty, crowding of their household, not already recovered), the dead among the infected (by age and health). Rows get an `ill` field (disease id, since) and deaths `illness` with the outbreak ref. Talkers get the existing illness (`fallIll`) with the disease (`ILLNESSES` gains the new kinds), so talkers can be nursed, cured and die in play. `SiteDay.plague` = I/N for the life step's existing rates (so it doesn't double-kill: the SIR's deaths replace the rates' plague term; set one or the other, decided in step 2).
4. **Between places only with carriers.** A journey leaving an infected place carries infection with probability by the place's I/N and the party size (a sick traveller in the party); on arrival, it seeds `E` at the destination. Migrants carry it the same way. Armies (N55) carry it and suffer camp disease. The player can carry it (if infected: they spread it in venues they visit). No teleporting: a place far from any carrier stays clean.
5. **Starts:** outbreaks start from: a caravan from a far land (rare, by trade volume), a war (sieges, camps: flux), a famine (weakness raises susceptibility: a plague start chance), a dungeon delve (a strange sickness), rats (a granary in a crowded city, summer), a returning army.
6. **Responses** by the place's head and the crown (N38 decisions for heads; policies for crowns: N58's temporary mechanism): **close the gates** (no journeys in or out; caravans turn back, so news goes round with them), **quarantine** (the sick in their houses: lower β; marks on doors: N31), **healers and herbs in demand** (prices up for the cures; herbalists go out: N28; healers' services busy; a `cure quest` on the board: N42), **flight** (the rich leave: N25 migration of gentry/merchant households; flight carries the disease), **blame** (N50's scapegoating: a minority faith, foreigners (N53/N54), witches (N51): grievances, persecution), **burning the dead**.
7. **Knowledge:** an outbreak is not news until someone knows: the first deaths are known locally (N33: `d:` refs); "plague in X" becomes a realm news item when deaths pass a threshold, and travels with carriers like any news. The player learns of it like anyone; the admin sees it at once.
8. **The player** can catch it (exposure in venues of an infected place: a check), carry it, nurse (a risk), gather the cures (N28 herbs), take cure quests, or break a quarantine (a crime: N48).

## Steps

### Step 1: diseases as data and the SIR model
- Schema, files, `check-npcs`; `outbreaks` table; the daily step (counts only).
- Test: an outbreak in a city burns out (I → 0) within a bounded time; a crowded place peaks higher than a sparse one with the same disease (done-when part: deaths depend on crowding).

### Step 2: real people
- Picking the infected and the dead among rows and talkers; `ill` on rows; illness deaths with the outbreak ref; `SiteDay.plague` wiring (no double deaths).
- Test: the dead are real rows with the disease named.

### Step 3: carriers
- Infection on journeys, migrants, armies, the player; seeding on arrival.
- Test (done-when part): a plague that starts in a capital reaches the start town only after a carrier arrives (and never with journeys off).

### Step 4: starts and responses
- Start rules; head and crown responses (gates, quarantine, demand, flight, blame).
- Test (done-when part): a city closes its gates (journeys turned back, news of it).

### Step 5: knowledge and the player
- Local knowledge, realm news thresholds; catching, carrying, nursing, cures, quests.
- Test: a herb cure from N28 shortens the illness for a talker.

### Step 6: admin and docs
- Admin: outbreaks by place, SIR curves, the map of spread. README.

## Balance bounds

- `outbreaks-burn-out`: every outbreak ends.
- `plague-not-apocalypse`: a plague kills at most a set share of the realm's people.
- `endemic-mild`: fevers and coughs stay mild and seasonal.

## Edge cases and traps

- **Double deaths:** N25's rates already have a plague term; choose one source (the SIR picks deaths; set the rates' plague term to 0 when an outbreak is active).
- **Lazy places:** outbreaks are realm-level counts per place (daily in the realm step); picking individuals happens in the place's step (live or catch-up) from the day's counts in `site_days`, so live and lazy agree.
- **Gates closed and news:** a closed place sends and receives no journeys (Part E), so it hears and spreads news only by couriers allowed through (a policy choice); journeys planned to it reroute or wait.

## Tests (`packages/server/tests/n61.test.ts`)

The done-when ones:
- A plague that starts in a capital reaches the start town only after a carrier arrives.
- It kills people at a rate that depends on crowding.
- A city closes its gates.
- It burns out.

## Done when (mapped)

| Done-when clause | Proved by |
|---|---|
| reaches Millbrook only after a carrier arrives | step 3 test |
| kills people at a rate that depends on crowding | step 1 test |
| a city closes its gates | step 4 test |
| it burns out | step 1 test |

**Save:** the next schema version (`outbreaks`, `people.ill`); the next save version (illness kinds on talkers, policies for closures).

## Slice cut

Not in the slice.

## Out of scope

Animal plagues. Long-term immunity across generations (recovered is immune for the outbreak only).
