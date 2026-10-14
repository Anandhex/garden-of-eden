[← Plans](README.md) · [Stage 3: N39](../stage-3-npcs-choose.md#n39-the-first-hour)

# N39 plan: The first hour

**In one line:** a new game lets the player choose the start town (or take the seed's pick); code then scans that town's real state for things already brewing (a grudge near breaking, a sick elder, a theft, a stranger, a pack at the fields, a raid due), picks one **opening incident** whose conditions hold, places the player where it will break within a few minutes, and offers a choice whose effects run on the normal systems: a grudge, a debt or a friendship that gossip spreads and someone acts on.

**Read first:** [plans README](README.md) sections 2, 4, 12 (no authored places or people), 13, 19 (`incident-line`). Needs N33 (gossip spreads the player's choice), N37 (grudges, relationships for anyone), N38 (people who then act on it). Uses N26's situation format ([`data/situations/`](../../../packages/server/src/data/situations/), [`road/situations.ts`](../../../packages/server/src/game/road/situations.ts)): actors, choices, effects.

## What exists

- **Start town by seed:** `pickStartSite(realm, seed)` and `startable`/`startScore` ([`realm/start.ts`](../../../packages/server/src/game/realm/start.ts)); `world.startSite`. The comment says choosing comes with N39.
- **New game:** `newWorld` in [`save.ts`](../../../packages/server/src/game/save.ts); the player starts at the place's gate (`startKit` in [`world/world.ts`](../../../packages/server/src/world/world.ts)).
- **Situations** (N26): JSON with `actors` (roles), `text`, `choices[].effects` (`fight`, `check`, `say`, `time`, money, relationship, reputation, an event with a cause), rolled per road segment and day. The effect runner is in `road/situations.ts`.
- **What's brewing**, readable in code: N37's grievances near a revenge threshold; N38's NPC choices for the coming hours (they can be *previewed* by running the scorer, since it's deterministic); N25's people near death (old, ill), expecting a birth; N13's realm arrivals (raids due tonight: `realm.arrivals`); packs near the fields (`site_days.beasts`); gangs a road away; debts (`debts.ts`); talkers' depth (secrets, fears, dilemmas: `npc/depth/`).

## Decisions made in this plan

1. **Choosing the start town.** The new-game screen lists 4–6 candidate towns (the top of `startScore` among `startable`, spread across kingdoms) with one generated line each ("A mining village in the hills of <kingdom>; wolves have been at the flocks."), plus "Random (the seed's choice)". The choice sets `world.startSite` before anything else happens. CLI: `--start <name>` or a numbered prompt.
2. **Incidents are data** in `server/src/data/incidents/*.json`, the situation format extended with **conditions** over the town's state and a **staging** block:
   ```json
   { "id": "grudge_breaks", "needs": [{ "grievance": { "minWeight": 0.6, "bothPresent": "square" } }],
     "stage": { "where": "square", "at": "+3m", "player": "near:victim" },
     "actors": { "avenger": "grievance.who", "victim": "grievance.against" },
     "text": "…", "choices": [ { "id": "step_in", "effects": [ … ] }, { "id": "watch", … }, { "id": "help_avenger", … } ] }
   ```
   Starting set (10–14): a grudge breaks into a fight; a thief caught at a stall (the player can speak for or against them); an old person collapses (fetch the healer, or not); a stranger arrives with news and no money; wolves at the edge field; a debt collector and a family; a child gone missing; a cart overturned at the gate; a raid party seen on the road (realm arrival due tonight); a servant flees a master (slave/serf kingdoms); a noble's horse runs down a commoner's goods; a dying talker's last request.
3. **Picking one by seed, from what's true.** `pickIncident(world, site, seed)`: evaluate every incident's `needs` against the town (cheap queries), score the satisfiable ones (drama weight × how much they touch the systems: grievance, debt, friendship), pick by `streamFor(seed, "first-hour")` among the top few. A fallback incident with no needs (the stranger with news, built from the town's real latest news) always exists, so every seed gets one.
4. **Staging bends the world a little, never invents it.** The incident may move the involved people to the stage location and bring forward something already due (the grievance's revenge is brought forward to minute 3; the collapse of an old person who is frail; a raid's scouts seen in the morning before the night's raid). It may not create a grievance, a debt or an illness that isn't there. Staging is logged (`why: "first hour"`). Same rule as N20's drama manager.
5. **The player is placed to see it.** The player starts a short walk from the stage (the gate on that side of town, or the inn's door), with a one-line nudge ("Shouting from the square.") and the incident starts when they come within sight, or at minute 5 wherever they are (then it comes to them: someone runs to them).
6. **The choice has normal consequences.** Effects use N26's effect runner and the N37/N38 systems: relationships (both sides), a grievance (against the player, if they shamed someone), a debt (a favour owed, [`favours.ts`](../../../packages/server/src/game/favours.ts)), a friendship, reputation, an event with witnesses. Witnesses mean gossip (N33); the people involved remember (memories for talkers); N38's menu then has reasons to act (a thank-you visit, a revenge).
7. **Pointers in the world, not tutorials.** Afterwards, short in-world lines show the systems at work: an innkeeper mentions "Everyone's talking about what you did in the square"; the person helped greets the player by name the next day; the admin-free journal (N65 later) notes "You stepped in for <name>". No tutorial popups.
8. **Words:** the incident's text and the actors' first lines come from templates with the real names; the model may rewrite the opening text (`incident-line`, high priority: the first minutes matter) through the invented-name check.

## Steps

### Step 1: choosing the start town
- `startCandidates(realm)`; the new-game screen (client) and CLI option; `world.startSite` from the choice.
- Test: candidates are all startable and from more than one kingdom when possible; choosing one starts there.

### Step 2: the incident format and conditions
- `game/firsthour/schema.ts` (zod), the loader, `check-npcs` validation; `needs` evaluators (`grievance`, `frail`, `debt`, `stranger`, `pack_near`, `arrival_due`, `slave_kingdom`, `talker_dying`…).
- The first 10–14 incident files.
- Test: each file passes the schema; each condition evaluator finds what it should on a seeded town.

### Step 3: picking and staging
- `pickIncident`, staging (move actors, bring forward), the fallback.
- Test: five fixed seeds each pick a satisfiable incident; at least four different ones across the five; staging changes only what the incident names (hash of the rest equal).

### Step 4: the player's start and the run
- Place the player; trigger on sight or at minute 5; the choice UI (reuse the road situation panel); effects.
- Test (done-when part): on each of five seeds the player is drawn into the incident within five game minutes of starting (walking toward the stage, or it comes to them).

### Step 5: consequences show
- Witnesses' knowledge; memory for talkers; N38 actions with the new reasons; the pointer lines.
- Test (done-when part): the choice is gossiped about within the first in-game day (people who weren't there know the event) and someone treats the player differently because of it (a relationship row toward the player differs from a run where the player chose otherwise; a talker's first line mentions it).

### Step 6: play, notes, docs
- Play the first hour of five seeds (the vertical slice's playtest asks for this); write the notes in the stage file.
- README: the first hour.

## Balance bounds

- `first-hour-variety`: over 20 seeds, at least 6 different incidents are picked.

## Edge cases and traps

- **No incident must need an authored person or place** (section 12). Conditions find roles.
- **Staging must not break determinism:** staging is part of new-game setup, from the seed's stream; a reloaded save after it is just a world.
- **Incidents that can kill** (a fight) must keep the player alive in the first hour (knockout at worst, N49's setbacks later).
- **A seed with nothing brewing** gets the fallback, which must still be worth five minutes (the stranger brings real news from the realm and asks for help).

## Tests (`packages/server/tests/n39.test.ts`)

The done-when ones, on five fixed seeds:
- A new player is drawn into a different incident within five minutes (at least four different among five).
- Their choice is gossiped about within the first in-game day.
- Someone treats them differently because of it.

## Done when (mapped)

| Done-when clause | Proved by |
|---|---|
| on five seeds, a new player is drawn into a different incident within five minutes | steps 3–4 tests + play |
| their choice is gossiped about within the first in-game day | step 5 test |
| someone treats them differently because of it | step 5 test |

**Save:** the next save version (`world.firstHour: { incident, choice, day }`, so the journal and later callbacks know).

## Slice cut

Not in the slice's build, but the slice's playtest uses step 1 (choosing the start town) if it's ready; otherwise the seed's pick.

## Out of scope

Character creation beyond the start town (name, look, background). Callbacks months later (N21 uses `world.firstHour`).
