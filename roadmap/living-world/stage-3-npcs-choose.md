[← Roadmap](../../ROADMAP.md) · [Living world overview](README.md)

# Stage 3: NPCs choose

NPCs act for themselves: interactions with consequences, hourly choices, life goals, and jobs they compete with the player for.

## N37: Chatter with consequences

**Status:** ✅ Built (2026-10-14; database schema 7, the save is still v15: nothing new is saved in the save file). Revenge against another person never kills (see **What differs**); the player's own place does its exchanges from the crowd the player can see.

**Implementation plan:** [plans/n37-chatter-with-consequences.md](plans/n37-chatter-with-consequences.md)

**Goal:** what townsfolk say to each other matters. A noble's sneer, a refused bow or an insult changes how people feel and can start a grudge, and NPCs can wrong each other and seek revenge.

**The rules:** code decides an interaction happened (greet, bow, refuse to bow, insult, humiliate, order, refuse, complain, share news), applies it to the four relationship axes (N5) and logs it as an event; the speech bubble (N16's `chatLines`) only shows it.

- [x] **Interactions, not lines:** every chatter exchange becomes a typed interaction with an effect on trust, fear, respect and affection
- [x] **Relationship scores for townsfolk:** compact (only for people they've met), feeding N33's credence
- [x] **Insults between NPCs:** a check weighted by class, temper and existing dislike produces "insulted" or "humiliated"; witnesses see it and gossip spreads it
- [x] **Grievances:** each wrong adds a grievance against the person who did it (kept per pair, decaying slowly)
- [x] **Revenge against an NPC:** N12's revenge goal generalised from `"player"` to any NPC id; traits pick the plan (hire men, confront, spread a rumour, refuse to deal)
- [x] The model writes the insult line, through the invented-name checks
- [x] Tests, README, this roadmap

- **Done when:** a noble who repeatedly sneers at a serf lowers the serf's respect, the serf has a grievance against that noble, witnesses gossip about it, and a proud noble who is insulted forms a revenge goal against a named NPC and carries it out. ✅ (`tests/n37.test.ts`: "a noble who repeatedly sneers at a serf…" and "a proud noble who is insulted forms a revenge goal…")

**Built:** `packages/server/src/game/chatter/`: `types.ts` and `effects.ts` (the thirteen kinds of exchange and what each does to the four axes, to a grievance and to the record), `person.ts` (temper, pride, forgiveness and honesty, worked out from a person's id and class), `rel.ts` (a person's view of another: `adjustRel`, fading by `HALF_LIFE_YEARS`, pruning, `credenceOf` for gossip), `pick.ts` (`pickInteraction`, the scored roll), `apply.ts` (`applyInteraction`: relationships, grievance, event, who knows), `grievance.ts` (weights, decay by forgiveness, amends, hatred), `day.ts` (`chatterDay`: a place's pairs for a day, the grievances that have faded, revenge), `revenge.ts` (`vendettaDay`: a goal formed, then carried out), `hours.ts` (`crowdHour`: an hour of the player's map), `words.ts` (the model's insult line), `bounds.ts`; `store/socialStore.ts` (`store.social`: the `relationships` and `grievances` tables); `shared/src/chatter.ts` (`INTERACTIONS`, `ChatterMark`) and `kindLines` / `Chat.kind` in `shared/src/crowd.ts`; `Town.crowdSim` / `chatterMarks`; the browser's red-edged bubbles (`CrowdLayer`); `admin/social.ts` (the *Relationships* and *Grievances* sections of a person's card, the revenge a person wants in their *Outlook*); `tests/n37.test.ts` (38 tests). Database schema 7 adds indexes only; the tables were made empty by schema 1. The new event kinds are `slight`, `affront`, `menace` and `apology`.

**What differs from the plan:**
- **No new saved state.** The revenge goal lives on the person's row (`people.outlook.goal`, with the target's id, a plan, how strong it still is, the words and the event behind it), not in the save, so the save stays v15 and `NpcGoal` is unchanged: a talker's `NpcGoal` is still the player-only revenge of N12. A talker is a row too, so a talker who is wronged by a person forms the same goal on their row, and `feelingsOf` puts it in the facts a talker's story is written from. Widening `NpcGoal.target` and mirroring each row goal into the talker's state is for N38, whose action menu will read one goal list.
- **Temperament is worked out, not stored.** A townsperson's row keeps ambition, loyalty, greed and bravery; temper, pride (which grows with station), forgiveness and honesty come from a fixed function of their id and class (`person.ts`), the same every time and the same in a lazy catch-up. A talker's own trait file is not read (the daily step reads only rows).
- **Three grains, as planned, with one change for the player's place.** Live places: a few pairs a day (3% of their grown people, 2 to 24) from N33's venues, with the inn's drink making tempers worse. Lazy places: the same function in a catch-up (a test checks it matches). The place the player is in: no daily pairs; instead each hour is planned before it is lived (changing nothing, so a world loaded elsewhere plans the same hour) and applied when it has passed, by running `CrowdSim.chats` on the server for each three-minute bucket (the same function, the same minute, so the pair the player sees is the pair that was picked), and sending the exchanges that were more than courtesy as `crowd.marks` in the snapshot. The browser gives a marked chat its kind and its words (`Chat.kind`, red edge, a 💢 over the one who did it); the rest are the old default lines. A long wait is sampled every fifteen minutes. A pair can have a notable exchange only in 4 of every 30 three-minute buckets (picked from who they are, so nothing is remembered and a world loaded elsewhere gives the same hour), or neighbours standing together would quarrel every three minutes. A person who is a full talker is skipped (the crowd does not draw them).
- **The kinds.** `obey` is dropped (a master's order is `order`, a servant's refusal `refuse_order`); `complain` and `flatter` change feelings but leave no event and no mark. A plain greeting between two people who have nothing written about each other writes nothing (so the table holds only pairs who have really met).
- **Relationship rows are one person's view of another**, in the four axes (-100 to 100; fear 0 to 100). `since` is the day a row was last changed, from where it fades: half is gone in two years (`HALF_LIFE_YEARS`); `pruneRels` drops a row with every feeling under 3 and left alone for a year, but only as maintenance, never in a day (a person who moved is in another place on the day the row they left behind is caught up, so a daily prune would make a lazy place differ); nobody keeps more than 50 (the weakest goes). N33's credence now uses it: how far a listener believes a speaker is the venue's base raised by their trust and affection toward the speaker (0.5 to 1).
- **A wrong is felt as the wronged would feel it:** the weight is the kind's weight times `0.7 + 0.8 × pride`, and a slight from someone beneath you cuts deeper. A grievance fades by the day at half-lives of a quarter to a year and a quarter (the forgiving let go in days, the unforgiving carry it past a year), so most have faded by half within a year (a bound). Amends (an apology) take 70% of it; death settles it. A pair keeps at most six; more deepen the lightest. The outlook's `grudge` is now a view of the heaviest open grievance, and a death in the family by a known hand (a person of the realm) makes a grievance against whoever did it.
- **Revenge is formed from hatred, carried out the next day.** When what someone holds open against one other adds up to more than their pride, temper and forgiveness allow (about 0.28 for the proud and quick, 0.64 for the gentle and forgiving; one insult to a proud noble is enough), they form a goal, written as a `new-goal` event whose cause is the wrong. The next day they act, once: `ambush` (the gentry and the well-off merchants hire men, which can fail, more often the higher the target stands), `confront` (the brave and hot-tempered, against someone within two ranks of them: a fight in the open, in front of the street), `rumour` (the dishonest: a lie the place hears, at 80% sure, thinking the worse of the target) or `refuse` (everyone else: nothing more to do with them). The event points at the wrong that caused it. It settles the grievance and wrongs the target in turn at half the weight (a rumour a third, a refusal not at all, a failed plot a tenth), so a revenge can start another but a town does not run into a feud alone. **Nothing here kills or maims**: a beating is an event and a change of feeling; deaths wait for N38's violence setting. The `ambush` plan is resolved in code (no spawn rule) because the target is not the player; the spawn-rule path is still the player-targeted one.
- **Event weight in gossip.** An `e:` ref is worth `2 + the event's importance` (3 to 9) to tell, so a humiliation is talked of for days and a sneer for a few.
- **The model's line** (`chatter-line`, the lowest-priority kind, 12 a game day): for up to two hostile exchanges an hour, ahead of the minutes they happen in, the model may write what the one who did it says (under 14 words, only the two names, no digits); the mark takes it when it arrives. Under load, or with `DIRECTOR=off`, the table's lines stand.
- **Balance bounds** (`chatter/bounds.ts`): `insults-rare` (under 5% of what random pairs would say is hostile, measured on real people with no feelings written), `grievances-settle` (most over a year old are settled or faded by half), `revenge-bounded` (under 2% of a place's people, at least 3, a season), `relationships-bounded` (50 views).
- **Cost.** About 10 ms a game day for the whole realm (24,000 people, 100 places: the daily pairs, the settling of faded grievances and revenge), plus the reviews' grievance lookup; the player's hour (an hour is 20 buckets of the crowd's chats, at most 40 each) is a few milliseconds.
- **Not done:** the place's mood making a crowd quarrelsome (N36 is not built; a person's own mood from their review stands in for it); the `violence` setting and killing (N38); hiring men with coin (N38's actions); an admin overview tab (the card sections only); N38's turning each kind into an action with a score; talkers' own trait files deciding their tempers.

## N38: NPCs as living players

**Status:** ✅ Built (2026-10-22; the save is still v15 and the database schema 7: a talker's `choice` memory is an optional field of their saved state, a townsperson's cooldowns sit in their outlook JSON). Violent actions are behind `CHOICE_VIOLENCE` (off by default); nothing an NPC chooses ever kills (see **What differs**).

**Implementation plan:** [plans/n38-npcs-as-living-players.md](plans/n38-npcs-as-living-players.md)

**Goal:** NPCs act like players: they choose what to do from what they want right now, and the player can't predict them.

**The rules:**
1. **One action menu** for NPCs and the player: eat, work, rest, gossip, buy, sell, court, confront, take revenge, spread a rumour, recruit, travel, steal, attack. The same rules govern both.
2. **Each hour** (at full detail), score every option from needs, goals, emotions, relationships and traits.
3. **Pick with weighted randomness**, not the top score. Traits set how random: a cautious NPC nearly always plays safe, a reckless one often doesn't.
4. **A seeded stream per NPC**, so a save replays the same way.
5. **Every action is an event**, so gossip, grudges, factions and the realm react: an insult leads to a grudge, an ambush, a rebel band.
6. **The model narrates only** (dialogue, the reason given); it never picks.

- [x] Shared action menu and scoring; N6's schedules and N12's daily plans become defaults the scoring can override
- [x] Per-NPC seeded RNG (switch the default away from `Math.random` for the simulation)
- [x] Guardrails: cooldowns so they don't loop, a cap on fights at once, story-critical NPCs can't die by accident
- [x] Violent actions behind a config flag (open decision above)
- [x] The admin view (N17) shows each NPC's options, scores and choice per hour
- [x] Prototype in Millbrook with 3–4 NPCs first, then the cast, then townsfolk at coarse grain
- [x] Tests, README, this roadmap

- **Done when:** with the same seed a day plays the same twice, with a different seed it differs; a hungry, wronged, bold commoner confronts the noble instead of going to work; a cautious NPC in the same spot doesn't; nobody loops on one action; the admin view explains every choice. ✅ (`tests/n38.test.ts`: "the same seed plays the same days twice…", "a hungry, wronged, bold commoner confronts the noble…", "a cautious one in the same spot… does not", "nobody loops on one action over a simulated week", "the admin view explains every choice…")

**Built:** `packages/server/src/game/choice/`: `types.ts` (`ActionDef`, `ChoiceCtx`, `Option`, `Deed`, `ChoiceHost`), `weights.ts` (every weight, cooldown and cap in one table), `score.ts` (`scored`, softmax, `temperatureOf`, `reasonOf`), `guards.ts` (cooldowns, the loop damp and cut-off, the fight cap, the violence flag), `registry.ts` (`ACTIONS`, `menuFor`, `decide`), `actions/basic.ts` (work, eat, rest, gossip, buy, sell), `actions/social.ts` (court, confront, insult, revenge, spread_rumour, recruit), `actions/risk.ts` (steal, attack, travel), `talker.ts` (the hourly menu for talkers: `chooseHour`, the context, the host that writes events and feelings), `day.ts` (`choiceDay`: the same menu for townsfolk, a day at a time), `intents.ts` (what the crowd shows), `protect.ts` (who nobody may do violence to), `player.ts` (the player's insult and confront through the same `apply`), `words.ts` (the reason in plain words, `describeChoices`, the `choice-reason` call), `bounds.ts` (`no-loops`, `work-still-happens`, `violence-rare`, `choices-cost`), `memory.ts`; `simulation.ts` follows a talker's pick for the hour instead of the schedule's (`chosenPlan`) and a `sell` pick skips crafting; `village.ts` `passVillage` calls `choose` before each hour; `Town.talkersChoose`; `people/world.ts` runs `choiceDay` after gossip (and in `catchUp`); `shared/src/crowd.ts` `CrowdDay.intents` (the confronting commoner walks to the noble's door); `admin/choices.ts` (the *Choices (last hours)* and *Chose to do* sections, `GET /api/admin/choices?ref=`); `web/server.ts` `insult` and `confront` actions; `tests/n38.test.ts` (28 tests). New event kinds `confrontation` and `recruited`; new call kind `choice-reason`.

**What differs from the plan:**
- **No new table and no save bump.** The plan's `choices` table for pinned people and `NpcState.cooldowns` are not built: a talker's recent choices (the last 48, with every option and its score) are kept in memory for the admin, a talker's cooldowns and loop count are `NpcState.choice` (an optional field), a townsperson's cooldowns are `outlook.choice.cd` on their row. Each deed is an event with `why` (the top three score parts), which is what a pinned person's history shows.
- **The schedule is read first, then overridden.** `planHour` is the *habit*: the action that does what the schedule has them doing gets a +0.85 habit part, so a worker with nothing against anyone keeps their day (tests: at least 50 of 60 hours). The menu's pick becomes the hour's plan (`state.choice.plan`, for that absolute hour only): a confronting commoner leaves the forge for the square. Choosing is done before each hour is lived, in id order, so what one does changes what the next sees.
- **Rows, not the player's NPC state, hold the feelings that matter.** A talker with a row feels others through the row's grievances and relationships (N37); talkers without one use their own four-axis `npcRelations`. Both change when a deed is done.
- **Townsfolk choose a smaller group.** Everyone with an open grievance, plus 1% of the rest (picked by who they are and the day, no stream walked), score the menu at day grain, up to 2% of a place's grown people a day (4 to 60, a fair draw of those who want to choose, not the lowest ids), the people in reach being the ones they hold something against and a few more picked by the stream. A wish to leave is looked at only for these. Revenge for townsfolk stays N37's `vendettaDay` (it already acts the day after the goal is made, before the menu runs); the `revenge` action is the talkers'. Townsfolk have no purse, so `sell`, `buy` and the coin of a theft do nothing for them; `travel` writes the move goal N25b's migration already reads.
- **Nothing kills.** Violent deeds (attack, steal, the hired-men way of revenge) are offered only with `CHOICE_VIOLENCE=on`, at most two a place a day and one an hour, never against a protected person (a companion, whoever the player is talking to, an open quest-giver, a child). A beaten talker is hurt, never below 1 hit point. Deaths by NPC action wait for a phase that needs them.
- **`recruit` moves a row's faction**, not a talker's (a talker's faction comes from their file); `court` is a courtship event and a little warmth, the weddings stay with N11 and N25.
- **Two things this found in older phases, fixed.** N33's `learn` counted (and could forget) rows learned on days after the one being worked out, so a place caught up late chose differently from one worked out on the day (it now looks only at rows learned by that day); N37's `vendettaDay` settled a grievance because the person it was held against had died, even if they died after the day being worked out (it now compares the day of death). `WorldStore.eventsAbout` now returns the *latest* events of a person (it returned the oldest, so a busy person's card lost their recent past); the admin card's placeholder *Ambitions and choices* is now *Ambitions* (N40) with the choices in their own sections.
- **The default is `CHOICE=all`.** N22's bounds runner does not exist yet, so the four bounds are `choice/bounds.ts` and are checked in the tests; `CHOICE=off`, `proto` (the ids in `CHOICE_PROTO`) and `talkers` step the rollout back. `CHOICE_ONLY=habit` keeps only the schedule's own actions (a test proves the day then goes exactly as before).
- **The reason is plain words first.** `describeChoices` is in a talker's situation lines when the player asks why, and in the day's plan; `explainChoice` asks the model for the line in their voice (`choice-reason`, 6 a game day) and falls back to the words.
- **The player's menu is two actions.** `insult` and `confront` call the same `apply` with the player as actor (the same exchange table and event kinds; the player's events use the kinds the rest of the game reacts to: `insulted`, `threatened`). The player's steal and attack keep their own richer flows (N7, N8).

## N39: The first hour

**Status:** ⬜ Planned

**Implementation plan:** [plans/n39-the-first-hour.md](plans/n39-the-first-hour.md)

**Goal:** a new game grabs the player within minutes and pulls them into the living world's systems.

**The rules:** not a fixed script. At a new game, code picks an opening incident from what the seeded world already has brewing in Millbrook (a death, a theft, a stranger, a grudge near breaking, a raid coming), arranges for the player to be there when it breaks, and offers a choice with consequences that run on the normal systems.

- [ ] **Choosing the start town** (deferred from N25a, user decision 2026-10-13): a new game lets the player pick the town to start in, or take one at random; until then `pickStartSite` picks it from the seed
- [ ] A set of opening incidents with conditions; one picked per seed from the world's state
- [ ] The incident involves the player within the first few minutes, with a choice that sets a grudge, a debt or a friendship
- [ ] Gentle pointers to the systems it touches (gossip spreading, someone remembering), in the world, not as tutorials
- [ ] Tested by playing several seeds' first hours (part of the vertical slice's playtest)
- [ ] Tests, README, this roadmap

- **Done when:** on five seeds, a new player is drawn into a different incident within five minutes, their choice is gossiped about within the first in-game day, and someone treats them differently because of it.

## N40: Ambitions and careers

**Status:** ⬜ Planned

**Implementation plan:** [plans/n40-ambitions-and-careers.md](plans/n40-ambitions-and-careers.md)

**Goal:** people want something from their life, not just from the next hour.

**The rules:** each NPC (cast, notables and townsfolk at coarse grain) has an ambition picked in code from class, job, traits and family: master their trade, a guild seat, land, office, wealth, a good marriage for a child, revenge, freedom. It adds long-term weight to N38's scoring and is re-picked when achieved or impossible.

- [ ] Ambitions and the steps toward them (apprentice → journeyman → master; member → officer → guild master; knight → landed)
- [ ] Careers change: townsfolk change jobs, open shops, take apprentices; an empty office is sought
- [ ] Rivalries from ambition: two who want the same seat
- [ ] Ambitions in the admin view and in an NPC's persona (they talk about what they want)
- [ ] Tests, README, this roadmap

- **Done when:** over a few simulated years an apprentice becomes a master and opens a shop, two journeymen compete for one guild seat and the loser bears a grudge, and an NPC asked what they want names their ambition.

## N69: Offices, treasuries and renown

**Status:** ⬜ Planned (asked for 2026-10-22; build right after N40)

**Implementation plan:** [plans/n69-offices-treasuries-and-renown.md](plans/n69-offices-treasuries-and-renown.md)

**Goal:** guilds, villages, towns and cities are run by people: officers who keep the treasury, the watch and the stores, paid from a treasury whose ledger shows where the coin went. A guild needs members to exist and must recruit to grow; belonging raises a member's name; renown runs from −100 (infamous) to 100 (famed), a leader's comes partly from the people who follow them, a failed venture costs it, and how someone leads earns them a name (the Good, the Cruel) and can make them a named NPC.

**The rules:** all in code. Posts by institution (reeve, treasurer, captain, steward, warden, quartermaster...) are appointed by the head and change the numbers (income, defence, costs, recruiting); unpaid officers quit; a greedy treasurer may skim until an audit finds them. A guild is chartered only once enough members pledge, folds below a minimum, and recruits in drives that people choose to answer. Renown becomes signed, −100..100 (fame = how far from zero); a leader's support from followers (their regard, grievances and own fame) adds to or takes from it. Epithets are titles awarded from facts (the Good, the Just, the Generous, the Bold, the Bad, the Cruel, the Coward, the Thief, Oathbreaker); a townsperson rises to a figure at fame 25, an epithet or a town office, and a figure talks at fame 30. Every raid, war, conquest or takeover has a failure side: the leader and the guild head lose renown, followers lose loyalty, the families of the dead bear grievances, and a lieutenant may split.

- [ ] Offices and appointments for every settlement and faction; wages; the ledger and one coin path
- [ ] Officers' effects, embezzlement and audits
- [ ] Charters, a minimum membership, recruiting drives, dues; members counted as figures and townsfolk
- [ ] Signed renown (−100..100), prestige, renown from belonging, support from followers, challenges
- [ ] Epithets for good and bad leaders; rising to a named NPC by renown
- [ ] Ventures that can fail: raids, wars, conquests, guild takeovers
- [ ] Admin cards, talkers' lines, tests, README, this roadmap

- **Done when:** the start town's treasurer skims, is found out and replaced; a guild founded by one smith is chartered only when three have joined (or fails, costing its founder); a respected village head gains renown from their people while a resented one loses it and is challenged; and a lord's failed conquest costs them renown (below zero when it repeats), their captain loyalty, and leaves grieving families with a grudge; a loved head is called the Good, a cruel lord the Cruel, and a reeve caught skimming becomes the Thief and a named NPC.

## N41: Leisure and contests

**Status:** ⬜ Planned

**Implementation plan:** [plans/n41-leisure-and-contests.md](plans/n41-leisure-and-contests.md)

**Goal:** people in the world have fun, and their games and contests are where they meet, compete, bet, quarrel and make names.

**The rules:** leisure is part of N38's action menu and N16's day: people with time, coin and the temperament for it go to games, contests and fairs. Contests are resolved in code by skill, attributes, dice and cheating; the model only writes the banter.

- [ ] **Tavern games:** dice, cards, knucklebones, arm-wrestling, drinking contests, darts; betting and cheating, caught or not (grudges, N37)
- [ ] **Contests and sports:** archery, wrestling, foot and horse races, strongman feats, a village ball game; prizes and renown
- [ ] **Tournaments and jousts:** held by lords and crowns, with knights and squires (N55's ranks), heralds, champions, injuries and deaths, a champion's fame across the realm
- [ ] **Fairs and market days:** travelling merchants, players and performers, menageries (N28), fortune tellers (N50, N51), games of chance; crowds from nearby places (N26)
- [ ] **Music, stories and dancing:** bards (N68), dances at festivals (N30), storytellers in inns
- [ ] **Who takes part:** NPCs by class, culture (N53), traits and mood (N36); the player can play, bet, compete, organise or rig them
- [ ] Contests as news, rivalries and romances (N5.6, N11), and as jobs on the board (N42: "champion wanted")
- [ ] Tests, README, this roadmap

- **Done when:** evenings at the Gilded Goose have dice games where a cheat is caught and a fight breaks out; Highdale's lord holds a tournament that knights from three places travel to, one dies, and the champion's name is news across the kingdom; the player wins an archery contest and a rival challenges them to a rematch.

## N42: A shared quest market and adventurer grades

**Status:** ⬜ Planned

**Implementation plan:** [plans/n42-shared-quest-market.md](plans/n42-shared-quest-market.md)

**Goal:** quests aren't only the player's. NPCs take jobs too, as adventurers, hunters and explorers, to earn coin and climb the grades, and they compete with the player for them.

**What exists:** quest boards (`state.questBoard`, N9 and N13's realm jobs) are taken only by the player. Realm adventurers and hunters (`realm/wilds.ts`) already delve and hunt on their own, and gain XP, titles and breakthroughs through `figureOvercomes`, but not through quests. `guildRank` grades only the player, by renown. The talking cast never adventure.

**The rules:** a job is one record on a board, open to the player and every NPC alike; whoever claims it first holds it. NPCs choose jobs with N38's scoring (reward, danger against their own strength, N40's ambition, traits); code runs the job like a delve or a hunt today. Grades follow the same rules for the player and NPCs.

- [ ] **One board for everyone:** guild halls, notice boards and quest-givers post jobs (bounties, culls, delves, escorts, deliveries, rescues, N63's surveys); a claimed job is held by that party, with a deadline, and freed again if they fail or give up
- [ ] **NPCs take jobs:** adventurers, hunters, explorers and willing townsfolk score open jobs; a reckless one takes jobs above their grade, a cautious one doesn't. At coarse detail (N25) they take and finish jobs in daily batches
- [ ] **Adventurer grades for everyone** (matching the existing tiers): a grade sets which jobs one may take; promotion from jobs done, renown and, for the higher grades, a trial; demotion or expulsion for failures or crimes. `guildRank` becomes this grade
- [ ] **Parties:** formed by role (fighter, healer, scout), friendship and grade; loot split by agreement; parties break up over arguments, deaths or unfair shares. The player can join an NPC party, hire one, or recruit NPCs into their own (N8's companions)
- [ ] **Real outcomes:** success, failure, injury and death; an unfinished job goes back on the board. All of it is news (N33), and great deeds become songs (N68)
- [ ] **Competition:** an NPC party can beat the player to a job ("the Greyfang bounty was claimed by Odo's party yesterday"); rival parties, poached jobs and grudges over stolen kills (N37)
- [ ] **Quest-givers react:** a giver whose job someone else did stops waiting for the player; givers prefer parties they trust
- [ ] **Rising:** a famous adventurer becomes a named or talking NPC through N13's rise rules; ambition (N40) can be "reach grade S"
- [ ] The admin view (N17) lists every board, who holds which job, and each adventurer's grade and record
- [ ] Tests, README, this roadmap

- **Done when:** an NPC party claims a wolf-cull job the player saw on Millbrook's board, does it while the player waits, and the giver pays them and tells the player it's done; an NPC adventurer climbs a grade from jobs done and passes a trial; a reckless low-grade adventurer dies on a job above their grade and the job returns to the board; the player joins an NPC party and shares the loot.

## N43: Items with a history

**Status:** ⬜ Planned

**Implementation plan:** [plans/n43-items-with-a-history.md](plans/n43-items-with-a-history.md)

**Goal:** things remember. A sword, a ring or a crown carries who owned it, what was done with it and where it's been, and people recognise it.

**The rules:** notable items (weapons, armour, jewellery, heirlooms, artefacts, anything named, stolen or used in a notable event) keep a provenance in code: makers, owners, deeds, losses and finds. Ordinary items stay plain, so the cost stays small (N18, N19).

- [ ] **Provenance:** made by whom (N10's smiths), owned by whom, used for what (a killing, a duel, a coronation), lost or stolen where, found how
- [ ] **Names and legends:** an item used in great deeds gets a name and a story (N68), and its fame grows with its deeds
- [ ] **Recognition:** NPCs who knew an item or heard of it recognise it ("that's Greyfang's bane, Hale's father carried it"): stolen goods give a thief away (N7, N48), an heirloom stirs feelings in its family (N45), a dead hero's sword brings grief or a claim
- [ ] **Heirlooms and inheritance:** items passed down by N45's rules; disputes over them
- [ ] **Artefacts:** old and magical items (N51) in hoards (N54's dragons), ruins (N27) and dungeons, with histories from the realm's past
- [ ] The item's history in the player's journal (N65) as far as they know it; the full history in the admin view (N17)
- [ ] Tests, README, this roadmap

- **Done when:** the player takes a named sword from a bandit, a guard recognises it as one stolen from a knight's family, the family wants it back, and a bard's song about the knight's last fight names the sword; the admin view shows every hand it passed through.

## N44: A nemesis

**Status:** ⬜ Planned

**Implementation plan:** [plans/n44-a-nemesis.md](plans/n44-a-nemesis.md)

**Goal:** one NPC the player made an enemy of keeps coming back, remembering every meeting, learning how the player fights and rising against them.

**The rules:** a nemesis is chosen in code from who has the strongest grudge against the player and survived them (a beaten bandit, a humiliated noble, a rival adventurer, a deserter the player spared). Their revenge goal (N12, N37) becomes a life ambition (N40). After every meeting code updates what they know of the player's style (weapons, tricks, companions, weak spots) and they prepare against it.

- [ ] Choosing and replacing a nemesis (at most one or two at a time); they can be won over, killed for good, or outlast the player into their heir's life (N66)
- [ ] Memory of every meeting, in their persona: they taunt with it
- [ ] Adapting: gear, allies and tactics chosen against the player's last fights
- [ ] Rising: they climb ranks, grades and offices (N42, N55) faster, driven by the grudge; scars and titles from meetings with the player
- [ ] They act off-screen against the player's people and holdings (N66, N57)
- [ ] Tests, README, this roadmap

- **Done when:** a bandit the player beat and let go returns months later as a sergeant with a shield against the player's favoured spear, names the day they met, and has hired men to burn the player's workshop.
