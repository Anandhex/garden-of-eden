[← Roadmap](../../ROADMAP.md) · [Living world overview](README.md)

# Stage 3: NPCs choose

NPCs act for themselves: interactions with consequences, hourly choices, life goals, and jobs they compete with the player for.

## N37: Chatter with consequences

**Status:** ⬜ Planned

**Goal:** what townsfolk say to each other matters. A noble's sneer, a refused bow or an insult changes how people feel and can start a grudge, and NPCs can wrong each other and seek revenge.

**The rules:** code decides an interaction happened (greet, bow, refuse to bow, insult, humiliate, order, refuse, complain, share news), applies it to the four relationship axes (N5) and logs it as an event; the speech bubble (N16's `chatLines`) only shows it.

- [ ] **Interactions, not lines:** every chatter exchange becomes a typed interaction with an effect on trust, fear, respect and affection
- [ ] **Relationship scores for townsfolk:** compact (only for people they've met), feeding N33's credence
- [ ] **Insults between NPCs:** a check weighted by class, temper and existing dislike produces "insulted" or "humiliated"; witnesses see it and gossip spreads it
- [ ] **Grievances:** each wrong adds a grievance against the person who did it (kept per pair, decaying slowly)
- [ ] **Revenge against an NPC:** N12's revenge goal generalised from `"player"` to any NPC id; traits pick the plan (hire men through the spawn-rule path, ambush, confront, spread a rumour, refuse to deal)
- [ ] The model writes the insult line, through the invented-name checks
- [ ] Tests, README, this roadmap

- **Done when:** a noble who repeatedly sneers at a serf lowers the serf's respect, the serf has a grievance against that noble, witnesses gossip about it, and a proud noble who is insulted forms a revenge goal against a named NPC and carries it out.

## N38: NPCs as living players

**Status:** ⬜ Planned

**Goal:** NPCs act like players: they choose what to do from what they want right now, and the player can't predict them.

**The rules:**
1. **One action menu** for NPCs and the player: eat, work, rest, gossip, buy, sell, court, confront, take revenge, spread a rumour, recruit, travel, steal, attack. The same rules govern both.
2. **Each hour** (at full detail), score every option from needs, goals, emotions, relationships and traits.
3. **Pick with weighted randomness**, not the top score. Traits set how random: a cautious NPC nearly always plays safe, a reckless one often doesn't.
4. **A seeded stream per NPC**, so a save replays the same way.
5. **Every action is an event**, so gossip, grudges, factions and the realm react: an insult leads to a grudge, an ambush, a rebel band.
6. **The model narrates only** (dialogue, the reason given); it never picks.

- [ ] Shared action menu and scoring; N6's schedules and N12's daily plans become defaults the scoring can override
- [ ] Per-NPC seeded RNG (switch the default away from `Math.random` for the simulation)
- [ ] Guardrails: cooldowns so they don't loop, a cap on fights at once, story-critical NPCs can't die by accident
- [ ] Violent actions behind a config flag (open decision above)
- [ ] The admin view (N17) shows each NPC's options, scores and choice per hour
- [ ] Prototype in Millbrook with 3–4 NPCs first, then the cast, then townsfolk at coarse grain
- [ ] Tests, README, this roadmap

- **Done when:** with the same seed a day plays the same twice, with a different seed it differs; a hungry, wronged, bold commoner confronts the noble instead of going to work; a cautious NPC in the same spot doesn't; nobody loops on one action; the admin view explains every choice.

## N39: The first hour

**Status:** ⬜ Planned

**Goal:** a new game grabs the player within minutes and pulls them into the living world's systems.

**The rules:** not a fixed script. At a new game, code picks an opening incident from what the seeded world already has brewing in Millbrook (a death, a theft, a stranger, a grudge near breaking, a raid coming), arranges for the player to be there when it breaks, and offers a choice with consequences that run on the normal systems.

- [ ] A set of opening incidents with conditions; one picked per seed from the world's state
- [ ] The incident involves the player within the first few minutes, with a choice that sets a grudge, a debt or a friendship
- [ ] Gentle pointers to the systems it touches (gossip spreading, someone remembering), in the world, not as tutorials
- [ ] Tested by playing several seeds' first hours (part of the vertical slice's playtest)
- [ ] Tests, README, this roadmap

- **Done when:** on five seeds, a new player is drawn into a different incident within five minutes, their choice is gossiped about within the first in-game day, and someone treats them differently because of it.

## N40: Ambitions and careers

**Status:** ⬜ Planned

**Goal:** people want something from their life, not just from the next hour.

**The rules:** each NPC (cast, notables and townsfolk at coarse grain) has an ambition picked in code from class, job, traits and family: master their trade, a guild seat, land, office, wealth, a good marriage for a child, revenge, freedom. It adds long-term weight to N38's scoring and is re-picked when achieved or impossible.

- [ ] Ambitions and the steps toward them (apprentice → journeyman → master; member → officer → guild master; knight → landed)
- [ ] Careers change: townsfolk change jobs, open shops, take apprentices; an empty office is sought
- [ ] Rivalries from ambition: two who want the same seat
- [ ] Ambitions in the admin view and in an NPC's persona (they talk about what they want)
- [ ] Tests, README, this roadmap

- **Done when:** over a few simulated years an apprentice becomes a master and opens a shop, two journeymen compete for one guild seat and the loser bears a grudge, and an NPC asked what they want names their ambition.

## N41: Leisure and contests

**Status:** ⬜ Planned

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

**Goal:** one NPC the player made an enemy of keeps coming back, remembering every meeting, learning how the player fights and rising against them.

**The rules:** a nemesis is chosen in code from who has the strongest grudge against the player and survived them (a beaten bandit, a humiliated noble, a rival adventurer, a deserter the player spared). Their revenge goal (N12, N37) becomes a life ambition (N40). After every meeting code updates what they know of the player's style (weapons, tricks, companions, weak spots) and they prepare against it.

- [ ] Choosing and replacing a nemesis (at most one or two at a time); they can be won over, killed for good, or outlast the player into their heir's life (N66)
- [ ] Memory of every meeting, in their persona: they taunt with it
- [ ] Adapting: gear, allies and tactics chosen against the player's last fights
- [ ] Rising: they climb ranks, grades and offices (N42, N55) faster, driven by the grudge; scars and titles from meetings with the player
- [ ] They act off-screen against the player's people and holdings (N66, N57)
- [ ] Tests, README, this roadmap

- **Done when:** a bandit the player beat and let go returns months later as a sergeant with a shield against the player's favoured spear, names the day they met, and has hired men to burn the player's workshop.
