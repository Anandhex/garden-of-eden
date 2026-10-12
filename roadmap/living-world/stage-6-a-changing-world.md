[← Roadmap](../../ROADMAP.md) · [Living world overview](README.md)

# Stage 6: A changing world

Nature, disease and disaster, and a map that grows new places and new kingdoms.

## N60: Ecology

**Status:** ⬜ Planned

**Goal:** nature has its own balance, and people change it.

**The rules:** predator and prey populations per area rise and fall together (prey grows, predators eat prey, predators starve without it); hunting, clearing and mining draw on stocks that regrow slowly or not at all.

- [ ] Prey and predators per area from N28's species (deer, hares, boar; wolves, bears, foxes), linked to N13's packs and breeding; plants as food for grazers and as stocks that are gathered and regrow
- [ ] Overhunting empties woods; hungry predators come for herds and villages
- [ ] Forests cleared for building and fuel; mines that run out (driving N63's exploration)
- [ ] Stocks visible in the admin view
- [ ] Tests, README, this roadmap

- **Done when:** over a few simulated years wolf and deer numbers rise and fall out of step, a village that overhunts finds empty woods and wolves at its herds, and Millbrook's mine runs low and its prospectors go looking for more.

## N61: Epidemics

**Status:** ⬜ Planned

**Goal:** disease spreads through the world.

**The rules:** an outbreak is modelled per place as susceptible → infected → recovered (or dead), with contact rates from crowding (N16's roster and places) and spread between places by N33's carriers. Code decides; nothing is narrated until someone knows.

- [ ] Outbreaks start from caravans, wars, famine or a dungeon; spread within and between places
- [ ] Illness and death for the cast (N8's illness) and townsfolk (N25)
- [ ] Responses: closed gates, quarantine, healers and herbs in demand, flight from cities, blame (a scapegoat faction or cult, N50)
- [ ] The player can catch it, carry it, or help (herbs, a cure quest)
- [ ] Tests, README, this roadmap

- **Done when:** a plague that starts in a capital reaches Millbrook only after a carrier arrives, kills people at a rate that depends on crowding, a city closes its gates, and it burns out.

## N62: Disasters

**Status:** ⬜ Planned

**Goal:** fires, floods, droughts and collapses happen, tied to the world.

**The rules:** each disaster's chance comes from the place: fires from dense wooden houses, forges and dry weather; floods from rivers and storms; drought from the season (N30); collapses from mines (N63). Seeded and logged.

- [ ] Fire that spreads house to house, fought by townsfolk; floods; droughts; mine collapses that trap miners
- [ ] Deaths, ruined stores and buildings (marks in N31), rebuilding, migration, relief or neglect from the liege (feeds N58)
- [ ] Rescue as quests for the player
- [ ] Tests, README, this roadmap

- **Done when:** a fire in a crowded town spreads more than one in a hamlet, the burned houses show and are rebuilt, a drought hits harvests, and a mine collapse traps named miners the player can try to save.

## N63: Exploration, roads and new settlements

**Status:** ⬜ Planned

**Goal:** the map grows. Explorers find things near their village, roads are built to them, and new hamlets are founded that can grow into towns.

**The rules:** all in code, seeded; the model writes place names and news lines only.

- [ ] **Exploration:** prospectors, hunters, guild adventurers and the player (walking N27's wilds) go into unexplored land within a day's reach; each trip rolls for a find weighted by terrain (ore in hills, timber in forest, peat and herbs in marsh, fish and salt on the coast, ruins or a dungeon mouth anywhere)
- [ ] **Discoveries:** a find is news and a place on the realm map; a nearby settlement can claim an ore deposit and build a mine (the building N13 already has)
- [ ] **Roads:** built from a settlement to a find with labour and time; a road becomes a new edge in the travel graph (N14), changing routes and travel times; trade, caravans and raids are easier along it
- [ ] **New settlements:** a claimed find with a road and spare settlers (from a place with food to spare) gets a hamlet, which grows by N13's size bands; it joins the nearest liege or can break away
- [ ] New places get maps, localities and townsfolk like every other (N14–N16, N25)
- [ ] Tests, README, this roadmap

- **Done when:** over a simulated year Millbrook's prospectors find iron in the hills, a road is built, a mine is worked and a hamlet founded there, which the player can travel to and which shows on their map once they've heard of it.

## N64: New kingdoms

**Status:** ⬜ Planned

**Goal:** new kingdoms form: a free settlement or cluster that holds out becomes a state.

**The rules:**
- **Trigger:** a free settlement (or cluster) that has held out 60+ days, with enough people, wealth and defenders, and a ruler with renown. Crushed breakaways don't count.
- **Founding:** a capital, a crown faction and a ruler; opinion of the old kingdom starts negative.
- **Recognition:** other kingdoms accept it, go to war with it or ignore it, by opinion and interest, recorded as treaties.
- **Endings:** it can be conquered, merge back or split again; all news.
- **Cap:** at most 6 kingdoms (open decision above).

- [ ] Founding, recognition and endings in `realm/politics.ts` and `diplomacy.ts`
- [ ] Causes that lead here: a successful uprising (N56), a liberation group holding a settlement (N59), a new settlement that breaks away (N63)
- [ ] Laws for the new kingdom (serfs, slaves or neither, as N16's `kingdomLaws`), from how it was born (a liberation kingdom keeps no slaves)
- [ ] The player can found one by holding a free settlement that meets the rules (open decision above)
- [ ] Tests, README, this roadmap

- **Done when:** a settlement that broke away after a revolt holds out, becomes a kingdom with a crown and laws, is recognised by one neighbour and attacked by its old liege, and never pushes the count past the cap.
