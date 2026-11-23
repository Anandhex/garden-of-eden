[← Roadmap](../../ROADMAP.md) · [Living world overview](README.md)

# Stage 4: Society

How people live together and against each other: families, secrets, crime, law, faith and culture.

> **Where this stage stands (audit, 2026-11-16).** N45–N53 were built on 2026-11-03 (save v17, schema 18), then work stopped for the 3D look before the player's side, the admin cards and the docs were done. The rules run for every NPC and their tests pass. What the player was meant to do with them mostly can't be reached in the game: see each phase's notes in *italics* and [N70](#n70-society-in-play-catch-up), the catch-up phase that closes it. **N70 was built on 2026-11-22:** every player action below is now reached through the one `society` action (server, CLI and panels), the two dead ends are closed, and the admin page shows Stage 4–5 state; the italic notes say what each phase's player side does now. Done-whens that name Millbrook or Highdale mean the start town and its liege town ([plans README §12](plans/README.md#12-names-in-the-done-whens)).

## N45: Family feuds and inheritance

**Status:** ✅ Built 2026-11-03 (`game/kin/`, `tests/n45.test.ts`; save v17, schema 18; `FEUDS=off`). Nothing here needs a player action.

**Implementation plan:** [plans/n45-family-feuds-and-inheritance.md](plans/n45-family-feuds-and-inheritance.md)

**Goal:** families have histories: estates are fought over, feuds last generations, marriages break.

**The rules:** built on N25's lineage. Inheritance follows each kingdom's law (eldest, split, chosen heir); disputes arise when the law and the family disagree. Grudges (N37) can pass to children.

- [x] Inheritance of land, shops, offices and coin by kingdom law; disputes between heirs
- [x] Feuds between families that outlive the people who started them
- [x] Affairs, divorce or separation where the law allows, and their gossip
- [x] Marriages arranged for advantage (feeds N40)
- [x] Tests, README, this roadmap — *tests ✅ (`tests/n45.test.ts`); README section and admin cards added by N70 (2026-11-22)*

- **Done when:** a smith dies with two heirs who dispute the forge, one family's grudge against another passes to their children and flares a generation later, and an affair becomes gossip that ends a marriage.

## N46: Secrets, spies and blackmail

**Status:** ✅ Built 2026-11-03 (`game/secrets/`, `tests/n46.test.ts`; `SECRETS=off`); the player's side wired by [N70](#n70-society-in-play-catch-up) on 2026-11-22.

**Implementation plan:** [plans/n46-secrets-spies-and-blackmail.md](plans/n46-secrets-spies-and-blackmail.md)

**Goal:** people hide things, find them out, and use them.

**The rules:** a secret is a fact in code with who knows it. NPCs can discover secrets (witnessing, prying, gossip), then keep them, tell them, or use them (N38's menu gains blackmail and exposure). Kingdoms run spies who report to their courts.

- [x] Secrets: crimes, affairs, debts, true loyalties, hidden runaways (N59), cover stories (N4) — *kinds in code: affair, crime, debt, loyalty, runaway, cover, bastard, war plans, gift, plot, bribe, cult*
- [x] Discovery and blackmail; exposure as an event with consequences
- [x] Spies between kingdoms; plots; succession crises that can end in assassination
- [x] The player can uncover, keep, sell or use secrets — *N70: the `society` ops `pry`, `sellsecret`, `blackmail`, `expose` (chat tools *Pry* and *Sell what you know*, the World tab's secrets with *Blackmail* and *Tell everyone*, `/society`)*
- [x] Tests, README, this roadmap — *tests ✅ (`tests/n46.test.ts`); README section and admin cards added by N70 (2026-11-22)*

- **Done when:** an NPC witnesses a noble's crime, blackmails them, and the noble pays or has the witness silenced; a kingdom's spy learns of a neighbour's war plans and the court acts on it; a disputed succession ends in an assassination plot.

## N47: The underworld

**Status:** ✅ Built 2026-11-03 (`game/thieves/`, `tests/n47.test.ts`; `UNDERWORLD=off`); the player's side wired by [N70](#n70-society-in-play-catch-up) on 2026-11-22 (fighting a guild is still not built).

**Implementation plan:** [plans/n47-the-underworld.md](plans/n47-the-underworld.md)

**Goal:** crime is organised: thieves' guilds, smuggling, black markets and corrupt guards.

**The rules:** a thieves' guild is an N13 faction kind with its own ranks; smuggling routes avoid taxes and tolls; black markets sell what's banned or stolen; guards can be bribed, weighted by their traits and pay.

- [x] Thieves' guilds with dens in towns and cities; theft and fencing (N7's theft) at scale
- [x] Smuggling around N13's taxes and around curfews and bans (N58)
- [x] Black markets: stolen goods, banned goods, runaways' papers — *N70: the den's row in the World tab lists the market for a member (`buy`, offered then confirmed); what's bought goes in the pack (a banned grimoire is what N51's toll finds)*
- [x] Corruption: bribed guards and officials; crackdowns and purges
- [~] The player can join, inform on or fight them — *N70: `joinguild` (once the player knows who to ask: shown the den, or talking to a member) and `inform` (confirmed); fighting a guild isn't built*
- [x] Tests, README, this roadmap — *tests ✅ (`tests/n47.test.ts`); README section and admin cards added by N70 (2026-11-22)*

- **Done when:** a city has a thieves' guild that steals and fences, a smuggler slips goods past a curfew, a guard is bribed to look away, and a crackdown jails some of the guild.

## N48: Law and trials

**Status:** ✅ Built 2026-11-03 (`game/law/trial.ts`, `player.ts`, in front of N26J's `justiceDay`; `tests/n48.test.ts`; `TRIALS=off`); the player is tried on court day since [N70](#n70-society-in-play-catch-up) (2026-11-22).

**Implementation plan:** [plans/n48-law-and-trials.md](plans/n48-law-and-trials.md)

**Goal:** crime is judged, not just punished on the spot, and justice depends on the kingdom and who you are.

**What exists:** N7's crime and the guard: witnesses, bounties and arrests.

**The rules:** each kingdom has laws (crimes, punishments, who may judge, the weight of a person's word by class). A trial is decided in code from evidence (witnesses, N46's secrets), the judge's traits and relationships, bribes and class; the model writes the words of the hearing.

- [x] Courts and judges by place (the head, a lord, a magistrate); trials for NPCs and the player — *NPC trials run every day; N70: the player's cases are heard on their place's court day (`societyPlayerDay`, from `Town.realmNights`), with them there or after two missed sittings without them*
- [~] Verdicts and sentences: fines, flogging, stocks, prison, exile, execution, forced labour; pardons by rulers — *fine, lock-up, stocks, flogging, banishment, bounty, hanging, and pardons by rulers; no forced labour, and prison is N26J's lock-up*
- [x] Class and influence: a noble's word against a serf's; bribing a judge; a secret (N46) to have a case dropped; false accusation — *class weights, false accusation and slander work; N70: *Offer the judge…* on each of the player's cases (`bribejudge`, confirmed)*
- [x] Prisons the player can be held in or break someone out of — *the player can be held (N26J's `taken.ts`; N70: a lock-up from their own trial is a `prisoner` chapter until its day); *Break them out* on each prisoner in the place's cell (`breakout`)*
- [x] Tests, README, this roadmap — *tests ✅ (`tests/n48.test.ts`); README section and admin cards added by N70 (2026-11-22)*

- **Done when:** a serf who stole bread is sentenced harshly in Millbrook's kingdom and lightly in the free kingdom; a noble accused by a commoner walks free unless the witnesses are many; the player bribes a judge and it works, or doesn't and they're charged for it.

## N49: Setbacks instead of game over

**Status:** ✅ Built 2026-11-03 and wired into defeat (`game/setback/`, `Town.setback`; `tests/n49.test.ts`); the slave's dead end closed by [N70](#n70-society-in-play-catch-up) (2026-11-22).

**Implementation plan:** [plans/n49-setbacks-instead-of-game-over.md](plans/n49-setbacks-instead-of-game-over.md)

**Goal:** losing doesn't end the game; it starts a new chapter.

**The rules:** where the player would die or lose everything, code chooses an outcome from the situation and the world: captured (held for ransom, sold, imprisoned), left for dead and found, enslaved where the law allows, exiled, in debt to someone dangerous, maimed. Real death brings the player back (decided 2026-10-23): they wake a day later where they last slept or at a temple, and what they carried stays where they fell.

- [x] Defeat outcomes by who beat the player and where (bandits rob and leave, slavers sell, a crown imprisons, beasts leave them wounded)
- [~] Escaping: break out, be ransomed by friends or a faction (N57), work off a debt, earn freedom (N59's paths, as a slave) — *N70: a slave can run for it once a day (`escape`, then `Town.arriveAt` the free place), buy their freedom or have a friend pay (`ransom`); `comeHome` runs when they next reach home, `recoverPack` where they fell. A faction's ransom (N57), working off a debt and N59's paths aren't built*
- [x] Lasting marks: a lost limb or scar (N8's injuries), a criminal record (N48), a reputation for it
- [x] Tests, README, this roadmap — *tests ✅ (`tests/n49.test.ts`); README section and admin cards added by N70 (2026-11-22)*

- **Done when:** the player loses to slavers, is sold in the slave kingdom, escapes with another slave's help through N59's paths, and comes home with a scar and a story people have heard.

## N50: Belief

**Status:** ✅ Built 2026-11-03 (`game/faith/`, `tests/n50.test.ts`; `BELIEF=off`).

**Implementation plan:** [plans/n50-belief.md](plans/n50-belief.md)

**Goal:** faith is a force: temples compete, cults spread, rulers listen to omens.

**The rules:** each person has a faith and how devout they are; faiths are N13 factions (orders, cults) with tenets that change how their followers score actions. Omens are events rolled in code from what's happening (an eclipse, a comet, a two-headed calf), interpreted by seers and priests according to their faction's interest.

- [x] Temples, orders and cults spreading through preaching and gossip; conversion; heresy and persecution
- [x] Pilgrimages to holy sites (travel and trade)
- [x] Omens and seers: a court seer's reading can tip a ruler's choice (N58 repression or concession, war or peace)
- [~] Blame in a crisis: a cult blamed for a plague (N61) — *the blame rule exists, but nothing starts an outbreak until N61 (`epidemic/model.ts` is only the state), so it happens only in tests*
- [x] Tests, README, this roadmap — *tests ✅ (`tests/n50.test.ts`); README section and admin cards added by N70 (2026-11-22)*

- **Done when:** a cult spreads from one town to the next, is persecuted as heresy in a harsh kingdom, an omen read by a court seer changes a ruler's decision (logged with the reading), and pilgrims travel to a shrine at its festival.

## N51: Magic

**Status:** 🟨 Rules built 2026-11-03 (`game/magic/`, `data/magic/`, `tests/n51.test.ts`; `MAGIC=off`); the player learns and casts since [N70](#n70-society-in-play-catch-up) (2026-11-22); magical places and enchanted items are still not built.

**Implementation plan:** [plans/n51-magic.md](plans/n51-magic.md)

**Goal:** magic has rules in this world: who can use it, how it's learned, what it costs, where it's strong, and how each kingdom and faith treats those who use it.

**What exists:** N8's MP abilities (signature moves, healing) work as combat and service skills; there is no idea of what magic is, who has it or what it means.

**The rules:** magic is data and code like everything else. A person has a gift (from none to rare great talent, inherited in part through N11's families) and schools they've learned; a spell has a cost (MP, materials from N28, time, risk, and for some kinds a lasting price), a rank (the tiers) and effects code applies. Where it's strong or weak is part of the land (N27's places). The model only describes it.

- [~] **Schools:** healing, elemental (fire, water, earth, air), illusion, divination, warding, beast-speech and growth (N28), necromancy and blood magic as forbidden kinds; peoples with their own magic (elven, dwarven runes, orc shamans, dragon magic; N54) — *twelve schools and 14 spells as data; peoples' own magic (runes, shamans, dragon magic) isn't built*
- [~] **Learning:** apprenticeship to a mage, a mages' guild or college, a temple (N50), forbidden books and hidden teachers; ranks as for any craft (N40, N42's grades) — *apprenticeship to a hedge witch; no mages' guild or college, no forbidden books*
- [x] **Costs and risks:** MP and rest, reagents, failed casts, magic sickness, corruption from forbidden schools that changes traits (N9's drift)
- [ ] **Magical places and things:** ley lines and standing stones (N27), cursed ruins, wild magic in deep wilds, enchanted items (N43) — *not built: no ley lines or strong and weak places; enchanted items (N43) neither*
- [x] **Laws and belief:** each kingdom's policy per school (licensed, taxed, a crown monopoly, banned, burned as witchcraft), set by the ruler and the faith (N50) and changeable; witch hunts in fear (N58), trials for sorcery (N48) — *a witch burned after a plague needs N61's outbreaks to happen in play*
- [~] **Mages in the world:** court wizards advising rulers, hedge witches in villages, battle mages in armies (N55), mage guilds as factions (N13), rogue mages and cults (N50); NPC mages choose and use magic through N38 — *court wizards, hedge witches and battle mages (capped); no mage guilds as factions, and N38's menu has no cast action*
- [~] **For the player:** discover a gift or not; learn, hide it where it's banned, be hunted or hired for it — *`borderCheck` runs when the player arrives somewhere; N70: *Learn* from a hedge witch (`learn`, confirmed) and *Cast* (`cast`; seen where the school is banned, it's a sorcery case heard on court day). Being hired for it isn't built*
- [x] Balance bounds in N22 (magic doesn't make armies or rulers unbeatable) — *two bounds in `society/bounds.ts`*
- [x] Tests, README, this roadmap — *tests ✅ (`tests/n51.test.ts`); README section and admin cards added by N70 (2026-11-22)*

- **Done when:** a child in Millbrook shows a gift and is taken as a hedge witch's apprentice; the free kingdom licenses healers while the slave kingdom burns a witch after a plague (N61); a court wizard's divination changes a ruler's decision (logged); a battle mage turns a battle in N55; the player learns a minor spell and must hide it when crossing into a kingdom that bans it.

## N52: Shaping what people believe

**Status:** ✅ Built 2026-11-03 (`game/shaping/rumours.ts`, `tests/n52.test.ts`); playable since [N70](#n70-society-in-play-catch-up) (2026-11-22).

**Implementation plan:** [plans/n52-shaping-what-people-believe.md](plans/n52-shaping-what-people-believe.md)

**Goal:** the player uses gossip and belief as tools: plant rumours, frame people, pay for songs, set factions against each other.

**The rules:** the player's words enter N33's gossip like anyone's, believed by credence (trust, affection, the speaker's renown); lies can be found out (N5's lies), and a planted rumour traced back to the player is a crime or a grudge.

- [~] Plant a rumour with a chosen person, place or faction as its subject; watch it spread and drift — *N70: *Whisper…* in a conversation (`plant`, "who, and what they did"); the subject is a person of the place named in the words; a faction or place as subject isn't offered*
- [x] Frame someone: plant evidence or false witnesses (N46, N48) — *N70: *Pay to swear…* (`frame`, 40 copper by default, confirmed)*
- [~] Pay a bard (N68), a priest (N50) or a crier for a song, sermon or proclamation — *N70: `voice`, offered on an innkeeper (the bard's evening crowd: there is no bard job), a priest or a clerk (the crier); real songs wait for N68*
- [~] Play factions against each other with false news — *works through a planted rumour about a faction: tests only*
- [x] Getting caught: the rumour's trail leads back; consequences by law and grudge — *N70: `society/day.ts` passes the player (on `LifeCtx.player`) for the place they're in; a case traced to them elsewhere opens all the same and is heard on court day*
- [x] Tests, README, this roadmap — *tests ✅ (`tests/n52.test.ts`); README section and admin cards added by N70 (2026-11-22)*

- **Done when:** the player whispers to a gossipy stallholder that the mayor stole the tax money, it reaches half the village in three days in several versions, the captain investigates, and if the player is found out the mayor has a grudge and the law a case.

## N53: Cultures and languages

**Status:** ✅ Built 2026-11 (`game/culture/`, `data` templates, `tests/n53.test.ts`, green 2026-11-16; `CULTURES=off`); customs kept and taboos broken in play since [N70](#n70-society-in-play-catch-up) (2026-11-22).

**Implementation plan:** [plans/n53-cultures-and-languages.md](plans/n53-cultures-and-languages.md)

**Goal:** travelling to another kingdom feels like going somewhere else.

**The rules:** each kingdom (and new ones, N64) has a culture in data: naming patterns, greetings and forms of address, foods, dress colours, festivals (N30), customs and taboos, attitudes to classes and strangers. A culture can drift and mix along roads and through migrants.

- [x] Culture files per kingdom; names (N13's generator), chatter (N16), festivals and personas follow it — *cultures are generated per kingdom from templates, not hand-written files*
- [x] Languages or dialects: strangers from far away are harder to talk to (lower persuasion, misunderstood rumours) until the player learns some of the tongue — *rumours lose accuracy across tongues (`gossip/knowledge.ts`) and the player learns a tongue by living there (`dayAmong`); N70: `tonguePenalty` adds up to +4 to the persuasion target (`npc/actions.ts`) and the NPC is told "you barely share a language"*
- [x] Customs that matter: a taboo broken angers people; a custom kept earns respect — *N70: the place's customs as buttons (`custom`), taboos that are deeds (whistling, spilling salt or milk, the threshold, speaking ill of the dead) as `taboo`, and eating horse or gull where it's forbidden breaks one from the `eat` action*
- [x] Mixing: border places and trade towns blend cultures over time
- [x] Tests, README, this roadmap — *tests ✅ (`tests/n53.test.ts`); README section and admin cards added by N70 (2026-11-22)*

- **Done when:** names, greetings, food at the inn and the festival differ between the three kingdoms; a Millbrook rumour told in a far kingdom loses accuracy faster; breaking a local taboo lowers how people there treat the player.

## N70: Society in play (catch-up)

**Status:** ✅ Built 2026-11-22 (`game/society/player.ts`, `admin/society.ts`, `admin` Society tab, `tests/n70.test.ts`; no save bump). Planned 2026-11-16 from the audit of the roadmap against the code.

**Implementation plan:** [plans/n70-society-in-play.md](plans/n70-society-in-play.md)

**Goal:** everything N46–N55 built for the player can be done in the game, and what those phases did can be seen on the admin page.

**What exists:** the rules and their tests. The player functions of `game/secrets`, `thieves`, `law`, `magic`, `shaping`, `culture` and `war` have no caller outside tests; the setback chooser is wired, but a player sold as a slave has no exit; a case against the player is opened and never heard.

**The rules:** no new ones. One `society` action family on the server, offered only where it can be done, with the same offer-then-confirm as every other costly action; the panels come from `server/src/view/ui.ts`, so the web and Unity clients both get them.

- [x] Fix `tests/n55.test.ts` (soldiers still serving after the peace) — *a soldier who died away from battle stays `serving`; such records are now closed. The test's own scenario, run as a script without its time limit, ends with 0 of 178 soldiers serving and 132 home (2026-11-22). Under load the test itself runs longer than its 600 s limit*
- [x] The dead ends: escape, ransom and coming home for an enslaved player; the player's own trial on court day, with the judge's bribe
- [x] Server and CLI actions for secrets, the underworld, breaking someone out, learning and casting, planting rumours, paid voices and framing, customs and taboos, enlisting
- [x] Panels: what the player knows of a person and a place (faith, customs, den, cases, war), and their own tongues, spells, record and chapter
- [x] `tonguePenalty` applied where the player persuades
- [x] Admin: Stage 4–5 state on person and place cards, and a Society tab (feuds, cases, plots, omens, armies, rolls of the fallen)
- [x] Balance bounds for N52–N55; unused `config.society` switches removed or marked — *marked "not built" in `config.ts`; bounds not yet run through `sim:years` (long run skipped)*
- [x] Tests (through `Town` and the server, not the functions), README, this roadmap

**What differs (N70, 2026-11-22):**

- **Step 0:** the plan's guess was right: `soldiersSiteDay` skipped a serving soldier whose person had died of something other than the war, so the record stayed `serving`. Now such a record is closed as `dead` (or `missing`), with no war-dead row; the death keeps its own cause.
- **One handler, three callers:** the ops live in `game/society/player.ts` (`societyAct(host, op, args)`, host = `Town`); `web/server.ts`'s `society` action, the CLI's `/society` and the tests all call it. Costly ops (`bribejudge`, `blackmail`, `buy`, `learn`, `voice`, `frame`, `enlist`, `ransom`, `inform`) are offered first: the price and risk wait on `player.society.offer` until `confirm` or `cancel`.
- **Court day:** nothing had one. A place's court sits every sixth day from a day of its own (`courtDayAt`). A player's case is heard there with them present, or after two missed sittings without them: `tryPlayer` gained `{ absent }` (no word of their own, "did not come to answer" +0.2, sentenced as fled, so a bounty). A lock-up sentence is a `prisoner` chapter until its day (`Chapter.until`, new). A day's warning comes the day before.
- **`bribeJudge`:** an honest judge already sentenced the bribe on the spot, but the bribery case it opened stayed open and would have been tried again. It's now closed at once (`guilty`). The test's "second case" is that record.
- **Ransom for a slave:** freedom costs half again the sale price, from the player's purse or a friend's (a talker who likes them and has the coin). The master is a townsperson with no purse the realm counts, so the coin leaves the books with the player's (as N52's framing bribe does). Escape is tried at most once a day.
- **Panels:** no separate person sheet. What the player knows of someone goes in the chat panel's lines and their ops in its tools; the player's own state ("You") and the place's ("Among the people of …") are sections at the top of the World tab, with a "Waiting on your word" row for an offer. All of it is the snapshot's new optional `society` field (`SocietyView` in `shared/protocol.ts`), built by the server. The game's web client needed no change; Unity's `Hud.RenderSections` draws the sections as they are (checked, not touched).
- **Voices:** there is no bard job. The innkeeper stands in for the bard (the evening crowd) and the clerk for the crier.
- **Rumours:** the subject is a person of the place named in the player's words ("Hal Webb stole the grain money"). A faction or place as subject isn't offered through the ops.
- **Taboos:** taboos that are deeds (whistling, spilling salt or milk, the threshold, speaking ill of the dead) are buttons. Eating horse or gull breaks one from the `eat` action. Killing bears or ravens, going armed into a temple and cutting the sacred birch aren't hooked yet.
- **Black market:** `buyBlack` put nothing in the pack. The op now adds `grimoire_necromancy`, `forged_papers` or `stolen_ring` (the grimoire is what N51's toll looks for).
- **Witnesses:** the onlookers to a cast, a taboo or an exposure are the talkers standing where the player is who are people rows. The crowd isn't counted.
- **Enlisting:** sets the player on the roll (`player.society.army`). N55's first cut has no battles for the player, so nothing more happens yet.
- **Admin:** the Society tab is a server card (ref `society`, new `AdminCardKind`) drawn by the generic card renderer. The only client code is a small view (`client/src/admin/views/society.ts`) and one tab button.
- **Bounds:** `rumours-die-out` and `player-rumours-traced` (N52), `cultures-distinct` (N53), `peoples-survive` and `dragon-burns-rarely` (N54), `levies-bounded` and `nobody-serves-an-ended-war` (N55). They aren't run through `sim:years` yet (the long run was skipped).
- **Save:** none. `LifeCtx` gained an optional `player`, so a rumour traced in the player's place names them.


- **Done when:** from a new game the player pries out a secret and sells it, buys on the black market, is tried and bribes the judge, is sold and escapes, learns a spell and is caught with it at a border, plants a rumour that is traced back, breaks a taboo and enlists; the admin page shows why each happened; `npm test` is green.
