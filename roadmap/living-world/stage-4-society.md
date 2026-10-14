[← Roadmap](../../ROADMAP.md) · [Living world overview](README.md)

# Stage 4: Society

How people live together and against each other: families, secrets, crime, law, faith and culture.

## N45: Family feuds and inheritance

**Status:** ⬜ Planned

**Implementation plan:** [plans/n45-family-feuds-and-inheritance.md](plans/n45-family-feuds-and-inheritance.md)

**Goal:** families have histories: estates are fought over, feuds last generations, marriages break.

**The rules:** built on N25's lineage. Inheritance follows each kingdom's law (eldest, split, chosen heir); disputes arise when the law and the family disagree. Grudges (N37) can pass to children.

- [ ] Inheritance of land, shops, offices and coin by kingdom law; disputes between heirs
- [ ] Feuds between families that outlive the people who started them
- [ ] Affairs, divorce or separation where the law allows, and their gossip
- [ ] Marriages arranged for advantage (feeds N40)
- [ ] Tests, README, this roadmap

- **Done when:** a smith dies with two heirs who dispute the forge, one family's grudge against another passes to their children and flares a generation later, and an affair becomes gossip that ends a marriage.

## N46: Secrets, spies and blackmail

**Status:** ⬜ Planned

**Implementation plan:** [plans/n46-secrets-spies-and-blackmail.md](plans/n46-secrets-spies-and-blackmail.md)

**Goal:** people hide things, find them out, and use them.

**The rules:** a secret is a fact in code with who knows it. NPCs can discover secrets (witnessing, prying, gossip), then keep them, tell them, or use them (N38's menu gains blackmail and exposure). Kingdoms run spies who report to their courts.

- [ ] Secrets: crimes, affairs, debts, true loyalties, hidden runaways (N59), cover stories (N4)
- [ ] Discovery and blackmail; exposure as an event with consequences
- [ ] Spies between kingdoms; plots; succession crises that can end in assassination
- [ ] The player can uncover, keep, sell or use secrets
- [ ] Tests, README, this roadmap

- **Done when:** an NPC witnesses a noble's crime, blackmails them, and the noble pays or has the witness silenced; a kingdom's spy learns of a neighbour's war plans and the court acts on it; a disputed succession ends in an assassination plot.

## N47: The underworld

**Status:** ⬜ Planned

**Implementation plan:** [plans/n47-the-underworld.md](plans/n47-the-underworld.md)

**Goal:** crime is organised: thieves' guilds, smuggling, black markets and corrupt guards.

**The rules:** a thieves' guild is an N13 faction kind with its own ranks; smuggling routes avoid taxes and tolls; black markets sell what's banned or stolen; guards can be bribed, weighted by their traits and pay.

- [ ] Thieves' guilds with dens in towns and cities; theft and fencing (N7's theft) at scale
- [ ] Smuggling around N13's taxes and around curfews and bans (N58)
- [ ] Black markets: stolen goods, banned goods, runaways' papers
- [ ] Corruption: bribed guards and officials; crackdowns and purges
- [ ] The player can join, inform on or fight them
- [ ] Tests, README, this roadmap

- **Done when:** a city has a thieves' guild that steals and fences, a smuggler slips goods past a curfew, a guard is bribed to look away, and a crackdown jails some of the guild.

## N48: Law and trials

**Status:** ⬜ Planned

**Implementation plan:** [plans/n48-law-and-trials.md](plans/n48-law-and-trials.md)

**Goal:** crime is judged, not just punished on the spot, and justice depends on the kingdom and who you are.

**What exists:** N7's crime and the guard: witnesses, bounties and arrests.

**The rules:** each kingdom has laws (crimes, punishments, who may judge, the weight of a person's word by class). A trial is decided in code from evidence (witnesses, N46's secrets), the judge's traits and relationships, bribes and class; the model writes the words of the hearing.

- [ ] Courts and judges by place (the head, a lord, a magistrate); trials for NPCs and the player
- [ ] Verdicts and sentences: fines, flogging, stocks, prison, exile, execution, forced labour; pardons by rulers
- [ ] Class and influence: a noble's word against a serf's; bribing a judge; a secret (N46) to have a case dropped; false accusation
- [ ] Prisons the player can be held in or break someone out of
- [ ] Tests, README, this roadmap

- **Done when:** a serf who stole bread is sentenced harshly in Millbrook's kingdom and lightly in the free kingdom; a noble accused by a commoner walks free unless the witnesses are many; the player bribes a judge and it works, or doesn't and they're charged for it.

## N49: Setbacks instead of game over

**Status:** ⬜ Planned

**Implementation plan:** [plans/n49-setbacks-instead-of-game-over.md](plans/n49-setbacks-instead-of-game-over.md)

**Goal:** losing doesn't end the game; it starts a new chapter.

**The rules:** where the player would die or lose everything, code chooses an outcome from the situation and the world: captured (held for ransom, sold, imprisoned), left for dead and found, enslaved where the law allows, exiled, in debt to someone dangerous, maimed. Real death stays possible, and N66's heir carries on.

- [ ] Defeat outcomes by who beat the player and where (bandits rob and leave, slavers sell, a crown imprisons, beasts leave them wounded)
- [ ] Escaping: break out, be ransomed by friends or a faction (N57), work off a debt, earn freedom (N59's paths, as a slave)
- [ ] Lasting marks: a lost limb or scar (N8's injuries), a criminal record (N48), a reputation for it
- [ ] Tests, README, this roadmap

- **Done when:** the player loses to slavers, is sold in the slave kingdom, escapes with another slave's help through N59's paths, and comes home with a scar and a story people have heard.

## N50: Belief

**Status:** ⬜ Planned

**Implementation plan:** [plans/n50-belief.md](plans/n50-belief.md)

**Goal:** faith is a force: temples compete, cults spread, rulers listen to omens.

**The rules:** each person has a faith and how devout they are; faiths are N13 factions (orders, cults) with tenets that change how their followers score actions. Omens are events rolled in code from what's happening (an eclipse, a comet, a two-headed calf), interpreted by seers and priests according to their faction's interest.

- [ ] Temples, orders and cults spreading through preaching and gossip; conversion; heresy and persecution
- [ ] Pilgrimages to holy sites (travel and trade)
- [ ] Omens and seers: a court seer's reading can tip a ruler's choice (N58 repression or concession, war or peace)
- [ ] Blame in a crisis: a cult blamed for a plague (N61)
- [ ] Tests, README, this roadmap

- **Done when:** a cult spreads from one town to the next, is persecuted as heresy in a harsh kingdom, an omen read by a court seer changes a ruler's decision (logged with the reading), and pilgrims travel to a shrine at its festival.

## N51: Magic

**Status:** ⬜ Planned

**Implementation plan:** [plans/n51-magic.md](plans/n51-magic.md)

**Goal:** magic has rules in this world: who can use it, how it's learned, what it costs, where it's strong, and how each kingdom and faith treats those who use it.

**What exists:** N8's MP abilities (signature moves, healing) work as combat and service skills; there is no idea of what magic is, who has it or what it means.

**The rules:** magic is data and code like everything else. A person has a gift (from none to rare great talent, inherited in part through N11's families) and schools they've learned; a spell has a cost (MP, materials from N28, time, risk, and for some kinds a lasting price), a rank (the tiers) and effects code applies. Where it's strong or weak is part of the land (N27's places). The model only describes it.

- [ ] **Schools:** healing, elemental (fire, water, earth, air), illusion, divination, warding, beast-speech and growth (N28), necromancy and blood magic as forbidden kinds; peoples with their own magic (elven, dwarven runes, orc shamans, dragon magic; N54)
- [ ] **Learning:** apprenticeship to a mage, a mages' guild or college, a temple (N50), forbidden books and hidden teachers; ranks as for any craft (N40, N42's grades)
- [ ] **Costs and risks:** MP and rest, reagents, failed casts, magic sickness, corruption from forbidden schools that changes traits (N9's drift)
- [ ] **Magical places and things:** ley lines and standing stones (N27), cursed ruins, wild magic in deep wilds, enchanted items (N43)
- [ ] **Laws and belief:** each kingdom's policy per school (licensed, taxed, a crown monopoly, banned, burned as witchcraft), set by the ruler and the faith (N50) and changeable; witch hunts in fear (N58), trials for sorcery (N48)
- [ ] **Mages in the world:** court wizards advising rulers, hedge witches in villages, battle mages in armies (N55), mage guilds as factions (N13), rogue mages and cults (N50); NPC mages choose and use magic through N38
- [ ] **For the player:** discover a gift or not; learn, hide it where it's banned, be hunted or hired for it
- [ ] Balance bounds in N22 (magic doesn't make armies or rulers unbeatable)
- [ ] Tests, README, this roadmap

- **Done when:** a child in Millbrook shows a gift and is taken as a hedge witch's apprentice; the free kingdom licenses healers while the slave kingdom burns a witch after a plague (N61); a court wizard's divination changes a ruler's decision (logged); a battle mage turns a battle in N55; the player learns a minor spell and must hide it when crossing into a kingdom that bans it.

## N52: Shaping what people believe

**Status:** ⬜ Planned

**Implementation plan:** [plans/n52-shaping-what-people-believe.md](plans/n52-shaping-what-people-believe.md)

**Goal:** the player uses gossip and belief as tools: plant rumours, frame people, pay for songs, set factions against each other.

**The rules:** the player's words enter N33's gossip like anyone's, believed by credence (trust, affection, the speaker's renown); lies can be found out (N5's lies), and a planted rumour traced back to the player is a crime or a grudge.

- [ ] Plant a rumour with a chosen person, place or faction as its subject; watch it spread and drift
- [ ] Frame someone: plant evidence or false witnesses (N46, N48)
- [ ] Pay a bard (N68), a priest (N50) or a crier for a song, sermon or proclamation
- [ ] Play factions against each other with false news
- [ ] Getting caught: the rumour's trail leads back; consequences by law and grudge
- [ ] Tests, README, this roadmap

- **Done when:** the player whispers to a gossipy stallholder that the mayor stole the tax money, it reaches half the village in three days in several versions, the captain investigates, and if the player is found out the mayor has a grudge and the law a case.

## N53: Cultures and languages

**Status:** ⬜ Planned

**Implementation plan:** [plans/n53-cultures-and-languages.md](plans/n53-cultures-and-languages.md)

**Goal:** travelling to another kingdom feels like going somewhere else.

**The rules:** each kingdom (and new ones, N64) has a culture in data: naming patterns, greetings and forms of address, foods, dress colours, festivals (N30), customs and taboos, attitudes to classes and strangers. A culture can drift and mix along roads and through migrants.

- [ ] Culture files per kingdom; names (N13's generator), chatter (N16), festivals and personas follow it
- [ ] Languages or dialects: strangers from far away are harder to talk to (lower persuasion, misunderstood rumours) until the player learns some of the tongue
- [ ] Customs that matter: a taboo broken angers people; a custom kept earns respect
- [ ] Mixing: border places and trade towns blend cultures over time
- [ ] Tests, README, this roadmap

- **Done when:** names, greetings, food at the inn and the festival differ between the three kingdoms; a Millbrook rumour told in a far kingdom loses accuracy faster; breaking a local taboo lowers how people there treat the player.
