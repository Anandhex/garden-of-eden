[← Roadmap](../../ROADMAP.md) · [Living world overview](README.md)

# Stage 5: Power and conflict

Other peoples and monsters with settlements and kingdoms of their own, armies of real people, uprisings, how rulers answer them, and slaves who free themselves.

## N54: Peoples and monsters

**Status:** ⬜ Planned

**Implementation plan:** [plans/n54-peoples-and-monsters.md](plans/n54-peoples-and-monsters.md)

**Goal:** the realm isn't only human. Goblins, orcs, ogres, trolls, giants, dragons and other peoples and monsters live in it: some in settlements of their own, some nomadic, some with kingdoms, some independent, some plotting harm. They have their own friends and enemies, take sides with other species, and a rare few are intelligent enough to talk with humans and live among them where a kingdom allows it.

**What exists:** `world/species.ts` already has elves, dwarves, halflings and orcs as talking species (with ages and rank limits), beside humans and the beasts (wolf, bear, boar, giant spider, horse). The realm (N13) is generated with human settlements, kingdoms and factions; creatures are packs, gangs and dungeon things.

**The rules:** each species is data: body and life (size, strength, age bands, rank limit), intelligence (from beast to fully reasoning, with a share of rare clever individuals), how it lives (settled, nomadic, solitary, in a hoard, in a hive), its temperament and its stance toward every other species. Their settlements, bands, kingdoms and factions are N13's, with the same economy, politics, treaties, raids and wars, so code runs them the same way. The model writes only words (and only for those who can talk).

- [ ] **Species:** goblins, hobgoblins, orcs, ogres, trolls, giants (hill, frost, stone), dragons, kobolds, gnolls, lizardfolk, harpies, centaurs, minotaurs, and the existing elves, dwarves and halflings; each with terrain and climate (dwarves under mountains, lizardfolk in marshes, frost giants in the high north)
- [ ] **Ways of living:** goblin warrens and orc strongholds as settlements with heads and ranks; nomadic orc warbands and centaur herds that follow the seasons and grazing (N30); solitary dragons with lairs and hoards; troll bridges and ogre caves; giants in steadings; some species in kingdoms of their own (an orc kingdom, a dwarf hold, an elf realm) with rulers, laws (N16's `kingdomLaws`), taxes and armies (N55)
- [ ] **Intentions:** each group has goals by temperament and needs: trade, raid, conquer, hoard, be left alone, take revenge for an old war; some plot harm (a dragon's raids, a goblin chief's plan to take the mine, an orc warlord gathering tribes) and the director (N13.8) pushes their needs like anyone's
- [ ] **Relations between peoples:** old hatreds and friendships (dwarves and goblins, elves and orcs), alliances of convenience (goblins serving an ogre, orcs hiring giants, a human lord paying an orc band), tribute to a dragon; treaties and wars between species as between kingdoms; a weak group seeks the support of a stronger one
- [ ] **Rare intelligent individuals:** a small share of beast-minded species (a goblin, a troll, a dragon, a wolf) are clever enough to speak; they can become talking NPCs (N11's templates, N13's rise rules), with their own view of humans and of their own kind; old dragons are nearly always clever
- [ ] **Living among humans:** each kingdom has a policy per species: welcome as residents, tolerated with limits (a quarter of the city, a tax, no arms), allowed only as slaves where slavery exists, or banned and hunted; chosen by the ruler's traits and history with that people, changeable like N59's runaway policy. Non-human residents appear in N16's townsfolk, with jobs, class and how people treat them (prejudice in chatter, N37)
- [ ] **In the land:** their settlements, camps and lairs on the realm map and in the wilds (N27); their tracks and signs (N28); travellers of other peoples on the road (N26); their cultures and tongues (N53)
- [ ] **Dragons especially:** few, ancient, enormously strong; lairs and hoards; raids that burn villages (N31's marks); tribute, bargains or dragon-slayer quests (N42); a dead dragon is realm news for years and a song (N68)
- [ ] **For the player:** trade, ally, fight or live among them; a non-human companion; earning a people's trust or hatred (reputation by people as well as by place, N67)
- [ ] Balance bounds for peoples and monsters in N22 (no species wiped out by default, no dragon flattening the realm)
- [ ] Tests, README, this roadmap

- **Done when:** the realm generates a goblin warren in the hills near Millbrook, an orc kingdom in the east, a nomadic centaur herd moving with the seasons and a dragon in the northern peaks; the goblins raid the mine road and make a pact with an ogre; the orc kingdom wars with the dwarves and the dwarves seek help from a human crown; a clever goblin talks with the player and lives in Highdale's outer quarter because its kingdom tolerates goblins, while the slave kingdom keeps orcs only as slaves; the dragon burns a hamlet, demands tribute, and the hamlet's head pays.

## N55: Armies, soldiers and the war dead

**Status:** ⬜ Planned

**Implementation plan:** [plans/n55-armies-soldiers-and-the-war-dead.md](plans/n55-armies-soldiers-and-the-war-dead.md)

**Goal:** wars are fought by real people. NPCs join armies and rise through the ranks; those who die in war are counted and remembered as war dead, distinct from other deaths.

**What exists:** wars (N13) are strength rolls between sides (`realm/military.ts`'s `fight`). Named fighters can die with a free-text cause ("killed in …"); nameless losses come off a place's population number (`bury`). There is no soldier role, no military rank, no army that moves.

**The rules:** all in code.
- **Recruitment:** armies are raised from real townsfolk (N25): levies by kingdom law (serfs owe service, slaves may be sent as fodder where allowed), volunteers by ambition (N40) and pay, mercenaries by contract, knights and nobles by duty.
- **Ranks:** a military ladder (levy, soldier, sergeant, lieutenant, captain, commander, marshal; knights alongside), with promotion from battles survived, deeds, renown and a commander's favour, and demotion or execution for cowardice or failure.
- **How a soldier died is part of N25's typed death record:** war causes (battle, siege, skirmish, execution for desertion, disease in camp) plus the war, the battle, the side and who killed them when known. Missing, captured and dead are separate states.

- [ ] **Armies as things on the map:** raised, supplied, marched along roads (N14, N63), camped, besieging; supply from places (N30's stores); hunger in camp, and disease once N61 exists
- [ ] **Joining up:** NPCs (and the player) enlist or are levied; families left behind; soldiers' wages and loot
- [ ] **Military ranks and promotion** for NPCs and the player; officers with commands; a famous soldier can rise to a named or talking NPC (N13's rise rules); veterans come home changed (traits, N9's drift)
- [ ] **Battles with real people:** casualties drawn from the soldiers present, not a number; heroes and cowards; prisoners and ransoms; deserters who flee (and may become bandits)
- [ ] **The war dead distinguished:** N25's typed death record gains the war, battle and side; rolls of the fallen per war and battle; missing in action until found or given up; widows, orphans and pensions (or none); grief that differs from other deaths (pride or bitterness, a grudge against the enemy side or one's own commander); war graves and memorials (N31); songs of the fallen (N68)
- [ ] **War weariness:** a kingdom's losses, levies and taxes feed unrest (N56, N58) and the will to make peace
- [ ] The admin view shows armies, their soldiers and ranks, and each war's dead by battle and place
- [ ] Tests, README, this roadmap

- **Done when:** a war raises levies from real Millbrook serfs who march to a battle; a levy survives three battles and is promoted to sergeant; those killed are on the war's roll of the fallen with the battle named, their families grieve and one carries a grudge against the enemy; a missing soldier comes home after the peace; the admin view counts the dead by cause, and war dead are never mixed with plague or famine deaths.

## N56: Grievances and uprisings

**Status:** ⬜ Planned

**Implementation plan:** [plans/n56-grievances-and-uprisings.md](plans/n56-grievances-and-uprisings.md)

**Goal:** people band together against someone who keeps wronging them: commoners against a cruel noble, serfs against a harsh lord.

**The rules:** code counts grievances per oppressor across a place. Past a threshold, a small rebel faction (N13's `rebel` kind) is founded with the aggrieved as members and the oppressor as its target. Gossip does the recruiting.

- [ ] Grievance totals per oppressor; threshold by place size
- [ ] Founding a local band: leader (the boldest, most aggrieved), members, target, creed (model-written)
- [ ] The band acts through N38's menu: recruit, hide, threaten, ambush, revolt
- [ ] A revolt that succeeds can take a settlement (a breakaway, N13 politics); one that fails ends in punishment and fear
- [ ] Tests, README, this roadmap

- **Done when:** a noble who abuses several commoners is targeted by a band they founded, which recruits through gossip and revolts; the revolt's outcome is news across the realm.

## N57: Player-led factions

**Status:** ⬜ Planned

**Implementation plan:** [plans/n57-player-led-factions.md](plans/n57-player-led-factions.md)

**Goal:** the player can found and lead their own band, guild, company or rebel group, and be followed, doubted and betrayed by its members like any leader.

**What exists:** the player can join factions (N7, N13's guilds, `/joinguild`) but never found or lead one. NPC leaders already found, recruit and split factions (N13.4).

**The rules:** a player faction is an N13 faction like any other, with the player as its leader. Members are NPCs who join by N38's scoring (pay, cause, loyalty to the player, fear, ambition) and keep judging the player: unpaid wages, defeats, cruelty or a broken promise lower loyalty; an ambitious, disloyal lieutenant can split off or betray the player (N13.4's split rule).

- [ ] Found a faction (a mercenary band, a merchant company, a guild chapter, a rebel group, a liberation group with N59): a name, a creed, a seat, starting coin
- [ ] Recruit NPCs (townsfolk, adventurers, veterans, runaways) who choose to join or refuse; ranks and offices the player hands out
- [ ] Give orders through N38's menu: raid, trade, recruit, defend, spread a rumour, take a job (N42), go to war (N55)
- [ ] Loyalty per member; desertion, splits and betrayal (sold out to the crown, a coup by a lieutenant)
- [ ] Other factions and kingdoms treat it as they would any faction: treaties, rivalry, crackdowns (N58)
- [ ] Tests, README, this roadmap

- **Done when:** the player founds a rebel band in Millbrook, recruits aggrieved serfs who join for their own reasons, leads a raid on the lord's granary, and an ambitious lieutenant later betrays the band to the lord when wages stop.

## N58: Kingdoms react to unrest

**Status:** ⬜ Planned

**Implementation plan:** [plans/n58-kingdoms-react-to-unrest.md](plans/n58-kingdoms-react-to-unrest.md)

**Goal:** a kingdom that has seen revolts (its own, or a neighbour's) becomes scared, repressive or conciliatory.

**The rules:** each kingdom keeps an **unrest memory**: recent revolts, uprisings and rebel factions, weighted by distance and age; a neighbour's revolt counts once its news reaches the court (N33). The ruler's traits and the court's mood pick a response. Policies are temporary and decay unless renewed, so a kingdom can swing between them.

- [ ] **Repression** (harsh or fearful rulers): more guards and patrols, curfews, heavier tithes or labour, public punishments, hunts for rebels. Revolts get rarer for a while; grievances build faster
- [ ] **Concession** (cautious or pragmatic rulers): lower taxes, freed serfs, small rights, pardons. Grievances fall; nobles who lose out resent the crown (a noble faction, or a coup)
- [ ] **Fear without action** (weak rulers): nobles hire private guards, flee, or ally with other crowns for mutual defence against revolts (a treaty kind)
- [ ] Effects in play: townsfolk's schedules (curfew, longer slave hours), chatter (whispers, guards harassing), prices, taxes and how guards treat the player; rebels may approach the player
- [ ] Every response logged with its reason ("the queen tightened the curfew because of the Ashford revolt, 9 days ago, 2 places away")
- [ ] Tests, README, this roadmap

- **Done when:** after a revolt next door, a harsh ruler's kingdom imposes a curfew that the townsfolk's day follows, and grievances there rise faster; a cautious ruler lowers taxes instead and a noble faction forms against them; both policies fade if unrest stays quiet.

## N59: Runaways and liberation

**Status:** ⬜ Planned

**Implementation plan:** [plans/n59-runaways-and-liberation.md](plans/n59-runaways-and-liberation.md)

**Goal:** a slave can run away, survive, and found a group that frees other slaves. Free kingdoms choose how to treat runaways, which drives diplomacy and war.

**The rules:**
- **Escape:** a slave's daily chance comes from grievances, mistreatment by their master, boldness, a missing guard or a festival, and rumours of a free kingdom nearby.
- **Runaway policy:** each free kingdom chooses, per slave kingdom, from its ruler's traits and its opinion of that kingdom: **shelter** (refuge; relations fall per runaway; the slave kingdom may demand them back and refusal can lead to raids or war), **return for a reward** (border guards hand them back for coin; relations improve; its own commoners and any abolitionist faction resent it), or **ignore** (no help, no hunting; runaways more likely to join gangs or the liberation group). A new ruler re-decides; a treaty can include it ("return runaways"); pressure (war threat, bribe, a liberation hero's renown, unrest at home) can shift it. Every change is news.

- [ ] Escapes, and the run: travel toward a free place or the wilds; road encounters can catch them; caught runaways are punished and returned, and other slaves hear of it
- [ ] Bounty on a runaway, posted by the master or crown: a quest the player can take or refuse
- [ ] **Liberation group:** a runaway who survives and has renown founds a faction with a hidden camp (like N15's bandit camp); it raids to free slaves, recruits the freed and grows
- [ ] Ripples: slave kingdoms tighten control after escapes or raids (feeds N58); hope among slaves raises escape chances; a strong group can take a settlement (feeds N64)
- [ ] Runaway policy per free kingdom, its changes and its treaty clause
- [ ] Border guards, NPC talk and bounties follow the policy in play
- [ ] The player can join the group, hunt runaways, or help a slave escape
- [ ] A liberation leader can rise to a talking NPC with their own history
- [ ] Tests, README, this roadmap

- **Done when:** a mistreated slave escapes during a festival, is sheltered by a free kingdom whose relations with the slave kingdom then fall, founds a liberation group that frees others in a raid, and the slave kingdom cracks down; a free kingdom with a "return" policy hands a runaway back for coin and its commoners resent it.
