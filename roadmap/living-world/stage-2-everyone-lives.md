[← Roadmap](../../ROADMAP.md) · [Living world overview](README.md)

# Stage 2: Everyone lives

Every person is real and the year has a rhythm: they age, marry, die, gossip and feel, and it shows on the map.

## N25: Townsfolk lives

**Status:** ⬜ Planned

**Implementation plan:** [plans/n25-townsfolk-lives.md](plans/n25-townsfolk-lives.md)

**Goal:** ordinary townsfolk age, marry, have children and die, so a place's population is a count of real people, and a townsperson's child can grow up to become a named or talking NPC.

**The rules:** levels of detail, all in code, no model calls:
- **Full detail:** the place the player is in, and pinned NPCs (N17): hourly.
- **Coarse:** other places: still individuals, updated once a day in batches.
- **Lazy catch-up:** a place nobody has looked at for a while fast-forwards when the player arrives or something there needs checking (seeded, so the result is the same either way).

- [ ] **Ageing:** every person ages yearly, with species age bands as for the named cast (N3.3)
- [ ] **Marriage:** partners matched within a place, weighted by class, age and relationship; cross-class matches are rare and become gossip. Reuses N11's courtship and marriage rules at coarse grain
- [ ] **Births:** children inherit traits and some skills (N11's inheritance)
- [ ] **Deaths:** old age, famine, raids, wars, beasts, illness, each tied to the realm event that caused it; a death is news (N13.0)
- [ ] **A typed death record for everyone:** `cause` (battle, siege, raid, execution, illness, famine, old age, beast, murder, accident, …), with the event, place and killer when known, replacing N13's free-text cause and the nameless `bury` count. Missing is a state of its own. N55 adds the war details on top
- [ ] **The population number becomes a count:** roster changes replace N16's "only the population number changes"; a growing town still adds to the end, so existing people keep their place
- [ ] **Migration as people:** N13's moves to better places move named townsfolk, with their family
- [ ] **Rising:** a notable's child, or a child with strong inherited traits, goes through N13's rise rules and can become a named or talking NPC; lineage kept, so the admin view can trace who came from whom
- [ ] Births, deaths and moves stored in N18's people tables (no migration of older saves: they're set aside, user decision 2026-10-13)
- [ ] Tests, README, this roadmap

- **Done when:** over 10 simulated years a village's people age, marry, have children and die, the population figure equals the living roster, a born townsperson rises to a talking NPC with their parents in their file, a famine kills people in the place it struck, and a capital still runs at 60 fps.

## N26: The open road

**Status:** ⬜ Planned

**Implementation plan:** [plans/n26-the-open-road.md](plans/n26-the-open-road.md)

**Goal:** travel is a journey, not a time skip. The player walks the realm between places through a world that is there: roads, people on them, roadside places, night, weather and things to stop for. A trip takes real playing time and is full of interaction.

**What exists:** N14's travel picks a route, skips the hours the distance takes (`hoursFor`, `TRAVEL_PER_DAY`) and rolls at most two encounters, fought in code. Between places there is nothing to walk through; N15's localities are the only maps outside a village.

**The rules:** the realm between places becomes walkable maps (chunks), generated with a seed from the realm's terrain, roads and rivers, so a stretch of road looks the same every time. A set **travel time scale** makes a day's walk take several real minutes of play (about 7 of walking), not hours and not an instant. To get that at the normal walking speed, a road tile passes *less* game time than a village tile, so the clock runs faster on the road (user decision 2026-10-13). Everything met on the road is real: travellers are the realm's people actually moving (N33's carriers, caravans, armies, adventurers, runaways), not spawned for the moment.

- [ ] **Walkable realm:** chunk maps between places, by terrain (plains, forest, hills, marsh, coast), with the road through them, rivers, bridges, fords and ferries; walk from one chunk into the next; N14's routes become the roads on these maps
- [ ] **Time on the road:** a travel time scale per tile; day and night, weather (N30) that slows and soaks; the header shows the day and how far to the next place
- [ ] **People on the road:** merchants and caravans, pilgrims, messengers, patrols, refugees from a war (N55), runaways (N59), adventurer parties (N42), bandits; all real and on their own journeys. They can be talked to, traded with, travelled with, robbed or helped, and they carry and give news (N33)
- [ ] **Roadside places:** inns and waystations, farmsteads, hamlets, shrines, toll gates, milestones and signposts, crossroads, bridges with keepers, ferry crossings; each with people living there (N16) and its own small happenings
- [ ] **Situations, not just fights:** a broken cart, an injured traveller, a toll demanded, papers checked under a crackdown (N58), a quarantine line (N61), a flooded ford, a beast on the road, an ambush; each a choice with consequences on the normal systems
- [ ] **Nights:** find an inn or camp; a fire, a watch, rest (N6's needs), night sounds and night encounters; companions talk by the fire (N8's companions)
- [ ] **Supplies and mounts:** food and water run down; buy, forage or hunt on the way; walk, ride a horse, take a cart or a river boat, each with a speed and a cost, and horses that need care and can be stolen
- [ ] **Travelling with others:** join a caravan for safety, take an escort job (N42), hire a guide
- [ ] **Fast travel only as a choice:** only along roads the player has already walked, and it still stops for anything worth stopping for (N35); a paid coach or boat as the in-world way to skip a known stretch
- [ ] Performance: chunks streamed and simulated by level of detail (N25), inside N19's budgets
- [ ] Tests, README, this roadmap

- **Done when:** walking from Millbrook to Highdale takes a set number of real minutes over several chunk maps; on the way the player meets real travellers (one carries news the player didn't have), stops at a roadside inn for the night, helps or ignores someone in trouble with consequences later, and sees the same road again on the way back; fast travel is offered only for the stretch already walked.

## N27: The wilds

**Status:** ⬜ Planned

**Implementation plan:** [plans/n27-the-wilds.md](plans/n27-the-wilds.md)

**Goal:** off the road the world is open to explore: places to find, ways to get lost, and things no one has told the player about.

**The rules:** the land away from roads is walkable chunks too (N26), by terrain, with points of interest placed by seed and by the realm's state (a pack's lair where its pack lives, a hidden camp where a gang or liberation group really is). Nothing is on the player's map until they find it or hear of it (N65).

- [ ] **Points of interest:** caves, ruins, abandoned villages (N13's emptied hamlets), old battlefields (N55), standing stones, groves, hermits' huts, shrines, beast lairs, hidden camps (N15, N59), dungeon mouths, herb patches and ore outcrops
- [ ] **Discovery:** finding a place puts it on the player's map and is news if it matters; an ore outcrop or a ruin the player finds is an N63 find they can tell a settlement about (or sell, or keep)
- [ ] **Getting lost and finding the way:** off-road travel is slower; without a map, a guide or skill the player can lose their bearings; maps bought from merchants or drawn by the player
- [ ] **Living wilds:** game and beasts move by ecology (N60), seasons change the land (N30), weather is harsher, nights are dangerous
- [ ] **People out there:** hunters, prospectors, hermits, outlaws, runaways in hiding, explorers on N63 trips; each real and somewhere for a reason
- [ ] **Secrets in the land:** ruins with a story from the realm's history (N68), a lost camp with clues to what happened, a grave with a name
- [ ] Tests, README, this roadmap

- **Done when:** leaving the road east of Millbrook the player finds a cave not on any map, a ruin from an old war with a named grave, and an ore outcrop they can report to the mayor; they get lost in the marsh at night without a guide; a hidden runaway camp is found exactly where the realm says the runaways are.

## N28: Fauna and flora

**Status:** ⬜ Planned

**Implementation plan:** [plans/n28-fauna-and-flora.md](plans/n28-fauna-and-flora.md)

**Goal:** the land is full of living things: many animals and plants, different in every terrain and season, that the player and NPCs notice, use, hunt, gather, fear and learn about.

**What exists:** creatures are a short list made for fighting (wolves, bears, boars, giant spiders, horses, bandits; N3.2, N13.6). Herbs, pelts and ore come from foraging (N15) as items, not as living things on the map.

**The rules:** species are data files (like creatures and templates), each with the terrains and seasons it lives in, how common it is, how it behaves, what it eats or needs, and what it's good for. Where each lives on a map is placed by seed from terrain, season and the realm's state (N60's populations), so the land looks and behaves the same on every visit and changes with the year. Most wildlife is light: drawn and simulated cheaply (N19's budgets), and only becomes a full creature when hunted, provoked or tamed.

- [ ] **Animals by terrain:** in the forest deer, boar, foxes, badgers, owls, woodpeckers; in the hills goats, eagles, hares; in marshes herons, frogs, eels, midges; on plains rabbits, partridges, skylarks; on coasts and rivers gulls, otters, fish, crabs; in caves bats and stranger things; around villages cats, dogs, rats, crows, pigeons and livestock
- [ ] **Behaviour:** herds and flocks, grazing and fleeing, nests and dens, day and night animals, birdsong at dawn, migration with the seasons (N30), animals that follow the plough or raid the grain store
- [ ] **Plants by terrain and season:** trees (oak, ash, pine, birch, willow, fruit trees), flowers and grasses, herbs, mushrooms, berries, reeds, crops in the fields; budding, flowering, fruiting and dying back through the year (N30)
- [ ] **Uses:** food, medicine and poison (N8's injuries and illness, N61's plague cures), dyes, timber, fibre, hides and feathers, alchemy and crafting (N10); rare ones worth a lot and sought on the quest market (N42)
- [ ] **Signs in the land:** tracks, droppings, broken branches, a silent wood before a predator; skill shows the player what they mean
- [ ] **Hunting, fishing, gathering and taming:** traps, bows, nets, rods; seasons when it's forbidden or a lord's right (N48's poaching); taming a dog, a hawk or a horse; NPC hunters, herbalists, foragers and fishers doing the same for their living (N38, N40)
- [ ] **Knowledge:** a bestiary and herbarium in the player's journal (N65) that fills in as they see, are told about or study species; herbalists and hunters can teach; wrong identification has consequences (the wrong mushroom)
- [ ] **In culture and belief:** sacred animals and trees, omens from birds (N50), regional dishes (N53), animals in songs and names (N68)
- [ ] **Beyond the ordinary:** rare and strange creatures and plants in deep wilds and dungeons, with legends about them, seen by few
- [ ] Tests, README, this roadmap

- **Done when:** a walk through the woods east of Millbrook shows deer that flee, birds at dawn and different flowers in spring and autumn; the player tracks a boar by its signs, gathers a herb that cures a fever and a mushroom that sickens them, fishes the river, and tames a stray dog; the bestiary has the species they've met; an NPC herbalist goes out at the right season for a rare root and sells it.

## N29: A soundscape

**Status:** ⬜ Planned

**Goal:** the world sounds alive: places, times, weather, crowds and wildlife each have their own sound.

**The rules:** ambient sound is chosen in the client from state the client already has (place, area, time, weather, N16's crowd nearby, N28's wildlife, N36's mood), so it costs no server time. Speech stays with the existing voices (Piper, T14).

- [ ] **Place and time:** birdsong at dawn, a busy market by day, crickets and owls at night, a silent street under curfew (N58), bells from the temple
- [ ] **Weather and season:** rain on roofs and on the road (N26), wind in the hills, snow's hush, thunder (N30)
- [ ] **Crowds and work:** murmur by crowd size, the smith's hammer, the mill, carts, livestock, children playing
- [ ] **Wildlife:** each species' calls where it lives (N28); a wood going quiet before a predator
- [ ] **Events:** battle at a distance, a fire's roar and shouting (N62), a festival's music, a bard in the inn (N41)
- [ ] **Mood:** a grieving town is quieter (N36)
- [ ] Volume and mix settings; off by default in tests
- [ ] Tests, README, this roadmap

- **Done when:** standing in Millbrook's square from dawn to night the sound changes with the hour and the crowd, rain is heard on the roofs in a storm, the woods have birdsong by day and owls by night and go quiet when wolves are near, and a curfew night is silent but for the watch.

## N30: Seasons and the farming year

**Status:** ⬜ Planned

**Goal:** the year has a rhythm that every system follows.

**The rules:** the calendar decides the season; the season changes what code does: food made, prices, schedules, travel, beasts and festivals. Seeded weather (N6) is weighted by season.

- [ ] Planting, growing, harvest and winter: farm output by season, stores that run down over winter, a lean late winter
- [ ] Prices follow stores (N10's demand prices); hunger in a bad winter feeds N13's starvation and migration and N56's grievances
- [ ] Schedules by season: long days at harvest, short days in winter, townsfolk (N16) indoors more
- [ ] Travel: snow closes high roads, mud slows them; beasts migrate and are hungrier in winter
- [ ] Seasonal festivals in every kingdom (planting, midsummer, harvest home, midwinter), filling squares as N16's festival does
- [ ] The season shows on the map (snow, bare fields, harvest stooks)
- [ ] Tests, README, this roadmap

- **Done when:** over a simulated year Millbrook's stores rise at harvest and fall in winter, bread costs more in late winter, a high road closes with snow and reopens, and each season's festival fills the square.

## N31: Visible consequences on the map

**Status:** ⬜ Planned

**Goal:** what happened can be seen where it happened.

**The rules:** a place's map is still generated from a seed (N15), and its **marks** (damage, works in progress, graves) are laid over it from the realm's state. Marks fade or are repaired over time in code.

- [ ] Burned and broken buildings after a raid, fire (N62) or war, repaired as the place rebuilds (N13 building)
- [ ] Scaffolding while something is built; the new building when it's done
- [ ] A graveyard that grows, each grave with a real name and date (from N25's deaths); hover to read it
- [ ] Empty stalls and thin crowds in a famine; extra guards and empty streets under a curfew (N58); banners of a new ruler or faction
- [ ] Smoke from chimneys, lit windows at night by who's home (N16's roster)
- [ ] Tests, README, this roadmap

- **Done when:** after a raid on Millbrook the player sees burned houses that are rebuilt over the following weeks, the graveyard has a grave for each person killed, and the market's stalls empty during a famine.

## N32: Interiors and homes

**Status:** ⬜ Planned

**Goal:** buildings can be entered, and a home shows who lives there.

**The rules:** every building gets an interior map, generated by seed from its kind and its owner's class, wealth and trade (N16's roster), so a serf's hovel, a merchant's house and a lord's hall differ and stay the same between visits. Belongings are kept per household, cheaply (N18), and become real items when touched.

- [ ] **Interiors:** homes, workshops, inns, temples, halls, shops, prisons (N48), guild halls; rooms, furniture and goods by wealth and trade
- [ ] **Belongings:** what a household owns, where it's kept; hidden things (coin under a floorboard, letters, N46's secrets in a drawer)
- [ ] **Life indoors:** people at home by their day (N16), eating, sleeping, working, quarrelling; family scenes
- [ ] **Trespass:** locked doors, people who notice an intruder, guards called (N7's theft and stealth, N48)
- [ ] **Change:** homes show fortune and misfortune (a new table after a good year, bare rooms in famine, damage after a raid, N31); the player's own home (N66) furnished by them
- [ ] Tests, README, this roadmap

- **Done when:** the player walks into a serf's hovel and a merchant's house in Millbrook and they look as different as their owners are; at night the family is asleep inside; the player finds a hidden letter in the mayor's desk that is one of his real secrets, and a servant who sees them raises the alarm.

## N33: Gossip for everyone

**Status:** ⬜ Planned

**Goal:** every person in the world takes part in gossip, not just the cast and the people the player has talked to, and news travels between places with real carriers.

**The rules:** pairwise checks for every person every hour won't scale, so:
- **Who meets:** people are grouped by where they actually are (workplace, inn, market, home, from N16's `CrowdSim`); pairs are sampled within a group, weighted by sociability and relationship.
- **What they know:** each townsperson keeps a compact record (news id, accuracy, who told them, when), not full memories. Full memories start when they become a talking NPC, seeded from that record.

- [ ] Group-based meeting and pair sampling for townsfolk, at the level of detail from N25
- [ ] Compact knowledge per person; credence from trust and affection as in N7 (`credence`)
- [ ] **Between places:** news travels with carriers (travellers, caravans, migrants, adventurers, messengers); it arrives late and can be distorted
- [ ] Retelling loses accuracy (N7's rumours), now for everyone
- [ ] Townsfolk's knowledge carries into their persona when the player first talks to them
- [ ] Tests, README, this roadmap

- **Done when:** a death in Millbrook reaches a labourer in Highdale only after a caravan or traveller has gone between them; a townsperson the player has never met can tell the player a rumour, slightly wrong; 3,000 people in a capital gossip without dropping below 60 fps.

## N34: Following people in the game

**Status:** ⬜ Planned

**Goal:** the player can follow people they care about from inside the game, and hears about them as news reaches them.

**The rules:** the in-game version of N17's pin, bound by what the player knows (N24): following someone means news of them is noticed and kept when it reaches the player, not that the player sees them.

- [ ] Follow friends, family, rivals, a nemesis (N44), a famous adventurer
- [ ] Word of them when it arrives ("your brother made sergeant", "Greyfang was seen near Highdale"), with source and how sure
- [ ] Letters: followed people (and the player) can send and receive them by carriers (N33)
- [ ] A followed list in the journal (N65) with each person's last known whereabouts
- [ ] Tests, README, this roadmap

- **Done when:** the player follows a friend who leaves for Highdale, hears weeks later from a caravan that she married there, and gets a letter from her that arrives days after she sent it.

## N35: Moving through time

**Status:** ⬜ Planned

**Goal:** the player gets past the slow parts of a big simulation without missing what matters.

**The rules:** waiting and travelling run the world fast (N25's levels of detail and catch-up) and stop when something happens that the player would care about: to them, to people they follow (N34), or where they are.

- [ ] "Wake me when…": something happens to someone I follow, a person arrives, a job is posted, a season turns, a set time
- [ ] Fast travel only along roads already walked (N26), and it stops for real events on the road (people, situations, news from a passing traveller)
- [ ] Skip days or a season, with a summary of what the player heard while time passed
- [ ] Tests, README, this roadmap

- **Done when:** the player waits "until something happens to someone I follow" and is woken when their friend in Highdale falls ill; a season skip ends with a short list of the news they heard; fast travel stops for a gang on the road.

## N36: The mood of a place

**Status:** ⬜ Planned

**Goal:** a place has a shared mood that people feel and act on.

**The rules:** a place's mood (grief, fear, anger, joy, hope, unease) is computed in code from recent events weighted by how many there felt them, and decays. It shifts chatter, prices, willingness to help, N38's scoring and N58's unrest.

- [ ] Mood from events: a massacre (grief), a curfew (fear), a tax hike (anger), a good harvest or a victory (joy)
- [ ] Mood in chatter, NPC personas, prices and how strangers (the player) are treated
- [ ] Mood on the map and in the admin view
- [ ] Tests, README, this roadmap

- **Done when:** after a raid kills several people Millbrook is in grief, its chatter and prices show it and it fades over weeks; a festival after a good harvest lifts it to joy.
