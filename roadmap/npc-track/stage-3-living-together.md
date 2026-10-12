[← Roadmap](../../ROADMAP.md) · [NPC track overview](README.md)

# Stage 3: Living together

Daily life in the village and the social web between NPCs.

## N6: Daily life

**Status:** ✅ Built (`src/game/schedule.ts`, `needs.ts`, `village.ts`; tests in `tests/n6.test.ts`)

**Goal:** NPCs live a day. They're somewhere specific at each hour, for a reason you can see.

**Mechanics:**
- **Schedules in the NPC file:** blocks like `{ from: 6, to: 18, activity: "work", place: "forge" }`. Activities: work, eat, socialise, sleep, travel.
- **Needs that tick every hour:** hunger, energy, money. They're satisfied by activities: eating at the inn costs gold and fills hunger, sleep restores energy, work earns money.
- **Utility choice in code:** when a need is urgent, it overrides the schedule. A hungry NPC goes to eat, and a broke one works late. There are no LLM calls in the simulation.
- **Where they are matters:** you can only talk to NPCs at your location, and asleep or away NPCs are unavailable, like busy ones today.
- **Mood follows needs:** a hungry or tired NPC drifts towards annoyed. This is shown to the model as a situation line ("You're tired and hungry").

**Tasks:**
- [x] `src/game/schedule.ts` and `src/game/needs.ts`, and `passVillage` (`src/game/village.ts`) runs every NPC an hour at a time, together. Needs override the schedule: starving → eat, exhausted → sleep, broke → work through supper
- [x] Locations: `forge`, `inn`, `square`, `gate`, `camp`, `home`. A player location, `/go <place>` and `/where` in the CLI; in the browser NPCs move between spots on the map and are gone when home or asleep
- [x] Crafting and selling only happen during "work" blocks; replaces today's fixed 6:00–20:00 (NPCs without a schedule keep it). Villagers don't shop at the bandit camp
- [x] Brena eats at Pell's inn in the evening and pays him, which is the first trade between NPCs (N7). Sociable NPCs have an ale (and look a little drunk)
- [x] Tests: 24 hours with fixed dice give the expected locations and activities

**Done when:** ✅ `/wait 24` shows Brena forging by day, eating at the inn in the evening and sleeping at night. She's only reachable where she is, and a starving NPC acts differently.

**Features in this phase:** N6.1 Signature moves; N6.2 Healers and services; N6.3 NPCs who start things; N6.4 Weather, seasons and town events; N6.5 Group scenes.

### N6.1: Signature moves

One memorable, rule-based thing each NPC does reliably.

*Why now:* tied to schedule and work blocks.

- **Mechanics:** `signature: { trigger, effect }` evaluated in code. Examples: on a good forge day (a high roll during a work block) Brena makes a masterwork, and Pell keeps a hidden stock for trusted regulars. The model narrates the result.
- **Tasks:**
  - [x] `SignatureSchema` with a fixed set of triggers (`good_work_day`, `trusted_regular`) and effects (`masterwork`, `hidden_stock`)
  - [x] Evaluate during work blocks (N6): the first work hour rolls d20 + luck modifier ≥ 18; Pell's strong salve stays off the shelf (and away from villagers) until trust 50
  - [x] Tests with fixed dice, and a seeded rate test
- **Done when:** ✅ over many forge days Brena sometimes makes a masterwork, at a rate you can state and test: 3 days in 20 (15%) with average luck.

### N6.2: Healers and services

Some NPCs sell services, not items.

*Why now:* healing exists (N0) but nobody sells it.

- **Mechanics:** a `services` list in the NPC file: heal, repair (N10), lodging, training (exists), with a price from code. They use the existing offer flow (`offer_service`, gated on topic). Lodging lets the player sleep (N6) and save.
- **Tasks:**
  - [x] `ServiceSchema` and a gated `offer_service` tool (service talk only)
  - [x] Healing restores HP for gold (30 HP); a room at Pell's inn restores HP overnight (the player has no MP yet), and the village lives on while you sleep
  - [x] Tests: a service charges once and applies its effect
- **Done when:** ✅ a hurt player pays Pell for a room and wakes up healed.

### N6.3: NPCs who start things

NPCs speak first when they have a reason.

*Why now:* NPCs only ever reply.

- **Mechanics:** **triggers in code** decide when an NPC opens a conversation: a promise is due (N5.5), they have news for you (N7), a need is urgent (a quest they'd give you), a grudge or fear when they see you, or a greeting the first time you enter their place. The model writes only the one opening line, from a short event line ("You have news: the mine road is open again"). A cooldown stops nagging, and at most one NPC speaks first per scene.
- **Tasks:**
  - [x] `src/npc/initiative.ts`: triggers (an apology owed, a promise due, a grudge or fear on sight, a favour to call in, a job they gave you, news, a need, a first greeting), priority and cooldowns (12 game hours, or once ever)
  - [x] The CLI shows an NPC's opening line when you arrive or when time passes; the browser when you open a conversation
  - [x] Tests: each trigger fires once per cooldown, and the highest-priority one wins
- **Done when:** ✅ walking into the forge the day after accepting her quest, Brena calls out "Got that ore yet?" before you say anything, and doesn't repeat it on every turn.

### N6.4: Weather, seasons and town events

Days that differ.

*Why now:* days are all the same.

- **Mechanics:** weather per day (rolled from the season), seasons over weeks, and scheduled or random town events: a market day, a festival, a bandit raid. Each changes needs (cold raises hunger and the demand for pelts), prices, schedules (no work in a storm) and the news line. All in code; the model only hears it in words.
- **Tasks:**
  - [x] `src/game/weather.ts` (four seasons over `config.daysPerYear`; each day's weather is a hash of the day, so nothing is saved) and `src/game/events-calendar.ts` (market every 7th day, the midsummer festival, a raid day after a raid)
  - [x] Effects on needs (cold makes everyone hungrier), prices (pelts ×1.5 in the cold; weapons and armour ×1.25 and ore ×1.5 after a raid; `npcPrice` takes the world), schedules (no outdoor work in a storm, the festival evening in the square) and village sales (doubled on market day)
  - [x] Tests: a winter day raises pelt demand, and a raid day changes the news and closes the mine road
  - [ ] Closing the road in the creature world too (spawns, travel)
- **Done when:** ✅ a bandit raid shows up in every NPC's news and in prices, and Pell's pelt quest pays more in winter.

### N6.5: Group scenes

The player talking with several NPCs at once.

*Why now:* the player can only talk to one NPC at a time.

- **Mechanics:**
  - When several NPCs share a place (N6), the player addresses one, but others may **join in**.
  - **Code chooses who speaks next:**
    - addressed by name
    - the topic touches them (gossip about them, their trade)
    - their relationship with the speaker
    - a cooldown, so one NPC doesn't take over
  - **At most one interjection per player turn.**
  - Each NPC keeps their own history and situation, plus a short "what just happened in the scene" line, so they react to each other ("Don't listen to her, Brena overcharges everyone").
  - **Vouching:** a trusted NPC's word can raise another's trust (N7).
- **Tasks:**
  - [x] `src/game/scene.ts`: who's present, turn-taking rules (the NPC named first is addressed), interjection chance (the topic, sociability, strong feelings), a two-turn cooldown
  - [x] A shared scene log fed into each participant's situation (kept short, rule 3: the last three lines)
  - [x] The CLI shows who's speaking, and `/to <npc>` addresses one; the browser shows a chime-in in the open chat
  - [x] Tests with a fake model: only one interjection per turn, and the addressed NPC always answers
- **Done when:** ✅ haggling with Brena at the inn, Pell chimes in once, and Brena reacts to what he said.

**Also from the old living-world plan:**
- [x] Optional: off-screen planning (`director/planning.ts`). Once per in-game day each NPC makes one short structured call for 1-3 plans, checked for invented names, shown as one situation line and never acted on in code. It runs in the background on its own connection (`director/background.ts`) and is cancelled the moment the player acts

---

## N7: The social web

**Status:** ✅ Built (`src/npc/social.ts`, `src/game/gossip.ts`, `reputation.ts`, `crime.ts`, `rumours.ts`, `dilemmas.ts`, `factions.ts`, `succession.ts`, `stealth.ts`, `town.ts`; tests in `tests/n7.test.ts`)

**Goal:** the town reacts as one. What you do to one NPC reaches the others.

**Mechanics:**
- **NPC-to-NPC relationships** (the same three axes), written in each NPC file: Brena and Pell are friendly, and Pell is scared of the guard.
- **Gossip:** when two NPCs share a place (N6), each shares its most important recent facts. The listener stores them at lower importance, depending on the speaker's `sociability` and their relationship. All in code.
- **Reputation:** a town-wide score per axis, built from gossip. It sets how strangers first treat you, so starting trust isn't always 0.
- **Crimes:** attacking or killing in town is witnessed. Witnesses gossip, a bounty may follow, and a guard NPC can come for you.
- **Death has consequences:** a dead NPC's quests fail, their shop is gone, and friends grieve or hold a grudge.

**Tasks:**
- [x] `relationships` in NPC files (`npcRelations` in the save): the four axes towards other NPCs, moved by gossip, trade and time together
- [x] `src/game/gossip.ts`: exchanges when NPCs share a place, fading with each retelling. Deeds (memories tied to events), rumours (losing accuracy), news (as hearsay) and the player's name; how likely and how believed depend on sociability and on how the two get on; hearing that the player hurt a friend hits hardest. Witnesses remember what they saw (`absorbWitnessed`)
- [x] Reputation from what people saw and heard (`player.reputation`: every NPC who learns of a deed moves it), and a stranger's first impression from it, plus respect for deed titles. Wary NPCs (distrust, or a crossed faction) charge more
- [x] A guard NPC (Hale, `guard: true`), crimes once a guard knows of them, a bounty, an opening line, no dealings while wanted, arrest by force past `ARREST_BOUNTY`, and `/payfine` or `/surrender`
- [x] Death ripple: quests fail, it's news (lore made in play), friends grieve, and if the player did it, friends turn on them; the successor takes over (N7.4); the body can be looted (N8)

**Done when:** attack Brena, then go to Pell without telling him. He already knows, is wary, and charges more. Kill someone, and the guard brings it up.
✅ In tests: after an attack at the forge, by 21:00 Pell has heard it from Brena at the Goose, trusts the player at -10 or less and asks more for an ale; kill Brena and Hale opens with the murder and the fine. Live (qwen3:4b-instruct, browser): asked for gossip, Pell said Brena had "a hand in the robberies".

**Features in this phase:** N7.1 Rumours about the NPC; N7.2 Moral dilemmas; N7.3 Factions; N7.4 Successors after a death; N7.5 Theft and stealth.

### N7.1: Rumours about the NPC

What others say about an NPC before you meet them, which may be wrong.

*Why now:* needs gossip.

- **Mechanics:** each NPC has `reputationFacts`: some true, some exaggerated, some false. Other NPCs pass them on through gossip (N7). When you meet the NPC, they can confirm or deny.
- **Tasks:**
  - [x] `reputationFacts` with a `truth` flag (`true`, `exaggerated`, `false`), who starts out knowing them, and an optional correction
  - [x] Include them in the gossip pool, with accuracy that falls 0.2 at each retelling (too garbled to pass on below 0.3); an NPC passes one on when asked for gossip or about the subject, and the player's journal notes it
  - [x] Tests: a false rumour gets denied, a true one confirmed
- **Done when:** Pell tells you Brena is a thief, and when you ask her she is angry about it. ✅ Live: Pell passed it on; Brena, asked, went angry ("That rumour's rot... I never stole a thing") and the journal marked it a lie. Found on the way: the first correction text gave her secret (the key) away, so it was rewritten.

### N7.2: Moral dilemmas

The NPC offers a choice with a cost on each side.

*Why now:* needs reputation and the three axes.

- **Mechanics:** `dilemmas: [{ id, offer, options: [{ id, effects }] }]`. Effects are code-set changes to trust, fear, respect, reputation and items. Hale's is a bribe to look away, Brena's is asking you to lie to the mayor. The choice is logged (N5) and remembered.
- **Tasks:**
  - [x] `DilemmaSchema` and `src/game/dilemmas.ts` (Hale's smuggler's cart, Brena's lie to the mayor once her secret is out)
  - [x] A `/choose` command (and buttons in the browser) and a gated `present_dilemma` tool. The model often voiced the offer without calling the tool, so when the talk turns to it the game puts it to the player anyway: the terms are code's
  - [x] Tests: each option applies exactly its effects
- **Done when:** taking Hale's bribe pays you and drops the guard captain's regard for you (N7); refusing raises Hale's fear of you. ✅ In tests, and live: taking it paid 5 silver and cost 15 standing with the guard.

### N7.3: Factions

Groups with their own standing towards the player.

*Why now:* reputation is per person and town, not per group.

- **Mechanics:** factions in data files (`src/data/factions/*.json`: the town guard, the merchants, the bandits) with members, attitudes to each other, and ranks. Standing with a faction comes from what you do to its members and to its rivals. It sets prices, quest access, and whether guards stop you. Joining one can close doors with a rival.
- **Tasks:**
  - [x] `FactionSchema` (`src/data/factions/`: the guard, the merchants, Rook's gang), membership in faction files (or `faction` in an NPC file), standing and joined factions in the save, `/factions`, `/join`
  - [x] Events raise or lower standing with the victim's faction and, through each faction's attitudes, its rivals
  - [x] Rank-gated quests (`minStanding`) and a member's discount; a markup from members of a faction you've crossed
  - [x] Tests: hurting a guard lowers guard standing and raises bandit standing
- **Done when:** after you help the merchants, Pell gives a member's discount and Hale is warier of you. ✅ In tests (the guard and the merchants are rivals over the gate tolls: joining one closes the door on the other).

### N7.4: Successors after a death

Permanent death shouldn't break the town.

*Why now:* permanent death leaves the town without a smith.

- **Mechanics:** each NPC can name a `successor` in their file: an apprentice or a relative with their own persona file. When the NPC dies, the successor takes over their place, part of their stock, their shop and their unfinished need quests. The successor **remembers** how the predecessor died (N5), and gossip has spread it (N7). An NPC with no successor leaves a gap, which can become a town need and a quest.
- **Tasks:**
  - [x] `successor` / `successorOf` fields, with the takeover rules in `src/game/succession.ts`. Wren Tally (`wren.json`) waits out of the world until Brena dies
  - [x] Inherited stock and gold (75%), need and director quests; the player's quests for the dead fail
  - [x] Tests: the successor appears after the death is recorded, and treats the killer accordingly
- **Done when:** if Brena dies, her apprentice runs the forge next day and refuses to serve her killer. ✅ In tests: a blood grudge (no trade, no amends).

### N7.5: Theft and stealth

Crime beyond violence.

*Why now:* crime today is only violence.

- **Mechanics:** `/steal` from an NPC or their stock, `/sneak` past someone. Rolled: the player's agility + sneak against the NPC's perception, with modifiers for whether they're busy, asleep or nearby (N6). On failure, the NPC catches you: anger, a grudge, and the guard (N7). Stolen items are marked, so selling them to the victim's friends is risky.
- **Tasks:**
  - [x] `src/game/stealth.ts`: rolls, modifiers by activity (busy −4, asleep −8, face to face +4, sneaking −3, +2 per witness), and stolen goods remembered (`player.stolen`); `/steal`, `/sneak`
  - [x] Witnesses and reports to the guard (N7): a crime once a guard knows
  - [x] Tests with fixed dice: a busy NPC is easier to rob, and a failed theft starts the right consequences
- **Done when:** you can lift a dagger while Brena is mid-forge, but trying it face to face gets you caught. ✅ In tests, and live (stealing from Hale after `/sneak`).

**Also from the old living-world plan:**
- [ ] Optional: NPC-to-NPC chats the player can overhear (2–4 lines, hard cap), using the group-scene rules (N6.5)
