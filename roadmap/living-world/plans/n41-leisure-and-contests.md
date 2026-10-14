[← Plans](README.md) · [Stage 3: N41](../stage-3-npcs-choose.md#n41-leisure-and-contests)

# N41 plan: Leisure and contests

**In one line:** leisure becomes a family of N38 actions (play, bet, compete, watch, dance); **games and contests are data** with a resolver in code (skill, attribute, dice, cheating against perception); **events** (a tavern evening, a village contest day, a fair, a lord's tournament) gather people from the place and from places a journey away; outcomes give coin, renown, injuries, grudges and romances through the normal systems, and are news. The player can play, bet, compete, organise or rig.

**Read first:** [plans README](README.md) sections 2, 13 (leisure actions), 17, 19 (`banter`). Needs N37 (grudges and relationships from a caught cheat, a lost bet), N38 (people choose to go), N40 (renown as a ladder for champions; knighthood). Uses N26 (journeys: knights travel to a tournament), N30 (festivals and fairs on the calendar), N33 (results as news), N36 (mood decides who has fun), N55 later (knights' ranks; until then knights are figures/talkers of class gentry or noble with combat skill).

## What exists

- **Evenings:** the crowd's leisure after work (`leisure(sim, p, r, true)` in [`shared/crowd.ts`](../../../packages/shared/src/crowd.ts)), the inn's drinkers ([`village.ts`](../../../packages/server/src/game/village.ts): `DRINKER_SOCIABILITY`, tipsy), the festival evening in the square, market days (`MARKET_EVERY` in [`events-calendar.ts`](../../../packages/server/src/game/events-calendar.ts)).
- **Skills and checks:** `check(rng, attribute, target, bonus)` ([`dice.ts`](../../../packages/server/src/game/dice.ts)); skills include `archery`, `unarmed`, `speechcraft`, `sneak`, `lockpicking` ([`npc/skills.ts`](../../../packages/server/src/npc/skills.ts)); no gambling or sleight skill.
- **Combat** for duels (`creatures.ts`, the fight timer); injuries and death ([`health.ts`](../../../packages/server/src/game/health.ts), N25 typed death `accident`).
- **Renown** for figures (0..100) and the player's titles; reputation per town ([`reputation.ts`](../../../packages/server/src/game/reputation.ts)).
- **Theft-like cheats:** the deception module ([`deception.ts`](../../../packages/server/src/game/deception.ts)) and the stealth checks.

## Decisions made in this plan

1. **Games are data.** `server/src/data/games/*.json`: `{ id, kind: "table" | "contest" | "joust" | "race" | "dance" | "show", where: ["inn", "square", "field", "lists"], players: [2, 8], stake?: [min, max], resolve: { skill?, attribute, dice: "d20" | "2d6" | "cards", rounds, cheat?: { skill, attribute, against: "perception" } }, risk?: { injury, death } , renown: [win, place], who: { classes?, minAge?, cultures? } }`. Starting set: dice, cards, knucklebones, arm-wrestling, drinking contest, darts; archery, wrestling, foot race, horse race, strongman, village ball game; joust, melee; dances; storyteller and bard (the bard ties to N68).
2. **One resolver.** `resolveGame(game, entrants, rng)` → rounds with rolls per entrant, cheats attempted and caught or not (`cheat` check by the cheater's skill vs the best perception of watchers), winner, stakes moved, injuries rolled for contact games. Deterministic from `streamFor(seed, "game", eventId, round)`. Two new skills: `gambling` (table games and spotting cheats) and `sleight` (cheating, pickpocketing later in N47); added to `SKILLS` with trainers.
3. **Events gather people.** An **event** record: `{ id, kind: "tavern_night" | "contest_day" | "fair" | "tournament", site, day, hours, host?, games: [...], prize?, entrants: [...], watchers: count }`.
   - **Tavern nights** happen every evening at every inn, implicitly: N38's evening `play`/`bet` actions put people at tables (a few tables of 2–6). In the player's place they're resolved hourly and visible; elsewhere daily in batches.
   - **Contest days** on festivals (N30) and some market days: the place's head (or a guild) puts on archery, wrestling, races; prizes from the treasury.
   - **Fairs:** a town's fair a few times a year: travelling merchants, performers, a menagerie (N28 species), fortune tellers (N50/N51 later), games of chance; people come from places within a day or two (journeys, N26), the market is bigger, prices and crowding change.
   - **Tournaments:** held by a lord or crown (`hostTournament` as a realm decision: a lord with wealth and pride, at peace, after a victory or for a wedding), announced as news that travels (N33); **knights and squires** within reach decide to go (N38's `travel` with a reason, scored by renown ambition, bravery, distance) and travel as journeys (N26 Part E: `people.away` while gone, visitors in the host town's crowd while there); jousts and melee resolved with the resolver (`risk.death` small but real); the champion gets renown, a prize and **realm news of weight by renown** (so the name is news across the kingdom).
4. **Who takes part** is N38 scoring: `play`, `bet`, `compete`, `watch`, `dance`, `perform` actions, available at the right place and time, scored by free hours, coin, sociability, temper (contests), pride and renown ambition, drink, the place's mood (N36: grief takes leisure down) and culture (N53 later: which games). Townsfolk join at day grain as "went to the contest" with an entry in the event.
5. **Consequences through the normal systems:** a caught cheat → an `insult`/`humiliate` interaction (N37) and maybe a brawl (`confront`; a fight if violence is on); a lost big bet → a debt ([`debts.ts`](../../../packages/server/src/game/debts.ts)); a win → renown and coin; dancing together at a festival → affection (feeds courtship, [`family.ts`](../../../packages/server/src/game/family.ts)); a rival beaten publicly → a grievance; a death in a joust → an `accident` death with the event ref.
6. **Contests as jobs:** a contest day or tournament posts "champion wanted" (an entrant sponsored by a guild or a lord) on N42's board when it exists; until then, a need quest.
7. **The player:** joins a table (a small panel: stake, play, cheat?), enters a contest (archery and races use the resolver with the player's skills; jousts and wrestling use the fight code), bets on others, organises (pays the head to hold a contest day: prize money), rigs (bribe an entrant, a judge; or cheat). A beaten rival may challenge the player to a rematch: an N38 action (`challenge`) scored by the rival's pride and the grievance.
8. **Words:** banter lines from tables by game and outcome; the model's `banter` kind is the lowest priority and only for what the player watches.

## Steps

### Step 1: games as data and the resolver
- Schema, files, `check-npcs`; `resolveGame`; `gambling` and `sleight` skills.
- Test: a dice game between a skilled cheat and three marks with a sharp-eyed watcher: the cheat is caught on a fixed seed; without the watcher, not.

### Step 2: tavern nights
- Evening `play`/`bet` actions; tables at inns; hourly in the player's place (visible: people at tables, bubbles), daily elsewhere; consequences (caught cheat → insult and maybe a brawl; debts).
- Test (done-when part): evenings at the start town's inn have dice games where a cheat is caught and a fight breaks out (with violence on; with it off, a confrontation and a grievance).

### Step 3: contest days and fairs
- Calendar hooks (N30), the head's decision, prizes; fairs with visitors by journeys; menagerie and stalls.
- Test: a contest day's archery is won by the best archer most of the time over seeds; a fair brings people from places within reach (journeys arriving the day before).

### Step 4: tournaments
- `hostTournament` in the realm day; the announcement as news; knights' travel decisions; jousts and melee; injuries and deaths; the champion's renown and realm news.
- Test (done-when part): the liege town's lord holds a tournament; knights from three places travel to it; one dies (fixed seed); the champion's name is news across the kingdom (known in every town of the kingdom, carried by travellers and couriers: N26 Part E).

### Step 5: the player
- Panels for table games and contests; betting; organising and rigging; the rematch challenge.
- Test (done-when part): the player wins an archery contest and a rival challenges them to a rematch.

### Step 6: admin, words, docs
- Admin: today's events by place with entrants and results. Banter tables; README.

## Balance bounds

- `cheats-caught`: a share of cheats are caught (not 0, not all).
- `tournament-deaths-rare`: deaths per tournament low.
- `leisure-not-ruinous`: gambling debts don't bankrupt a place's commoners on average.

## Edge cases and traps

- **The evening crowd's plan** is shared code; people at tables must be positioned the same in browser and server. Add "table" spots in the inn's interior (N32) or the inn's front if interiors aren't built.
- **Journeys to a tournament** come back; knights who die don't (their journey ends with the death event).
- **Prizes from treasuries** must not empty them; hosts check coin.
- **Don't make fun a chore for the player**: everything is optional; nothing in the main paths needs a game.

## Tests (`packages/server/tests/n41.test.ts`)

The done-when ones:
- Evenings at the start town's inn have dice games where a cheat is caught and a fight breaks out.
- The liege town's lord holds a tournament that knights from three places travel to, one dies, and the champion's name is news across the kingdom.
- The player wins an archery contest and a rival challenges them to a rematch.

## Done when (mapped)

| Done-when clause | Proved by |
|---|---|
| dice games at the Gilded Goose where a cheat is caught and a fight breaks out | step 2 test |
| Highdale's lord holds a tournament that knights from three places travel to, one dies, and the champion's name is news across the kingdom | step 4 test |
| the player wins an archery contest and a rival challenges them to a rematch | step 5 test |

**Save:** the next save version (`world.leisureEvents` for scheduled fairs and tournaments; new skills in persona/state schemas).

## Slice cut

Not in the slice.

## Out of scope

Bards' songs as legends (N68). Menagerie animals as owned creatures (N28 taming covers animals generally). Betting markets across places.
