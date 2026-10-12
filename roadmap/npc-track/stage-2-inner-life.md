[← Roadmap](../../ROADMAP.md) · [NPC track overview](README.md)

# Stage 2: Inner life

Depth of character, memory and relationships.

## N4: Character depth

**Status:** ✅ Built (`src/npc/secrets.ts`, `quirks.ts`, `names.ts`, `appearance.ts`; tests in `tests/n4.test.ts`)

**Goal:** each NPC feels like a specific person: secrets with cover stories, habits that show up at the right moment, knowing your name, and a visible appearance.

**Benchmark after N4–N6** (`RUNS=5 npm run bench`): 70/75. New scenarios: Hale keeps his cover story 5/5, breaks with proof 4/5, uses the player's name 5/5, remembers yesterday's insult 5/5, Pell offers a room 5/5. Older ones held (secret at trust 80 5/5 after lesson 9); "knows player can afford" is still the weak one (1/5), as before.

**Features in this phase:** N4.1 Layered secrets; N4.2 Quirks and tells; N4.3 Learning the player's name; N4.4 Appearances and `/look`.

### N4.1: Layered secrets

A secret can have a cover story. The NPC tells the cover first, and the truth only comes out under pressure.

*Why now:* gives `honesty` a real rule.

- **Mechanics:** `secrets[].cover` (the lie), plus `breaks_with`: an item or fact the player holds, or an intimidation or persuasion check. Low-honesty NPCs lie readily, honest ones less (N1).
- **Tasks:**
  - [x] Add `cover` and `breaksWith` (camelCase, like the rest of the file) to the secret schema, plus `keywords` that bring the subject up. A break is `{ item }`, `{ fact }` (another NPC's secret the player learned, "pell.hale_cellar") or `{ check: "persuade" | "intimidate" }` won today
  - [x] `reveal_secret` returns the cover until the break condition is met (code decides, not the model). A dishonest NPC keeps the cover until broken; an honest one drops it once trusted. Once broken, the secret is reachable at any trust. Asked about the subject, the NPC gets the cover as a situation line to stick to
  - [x] A covered secret for Hale (the night he left his post), broken by Pell's new secret (`hale_cellar`) or by intimidating him
  - [x] Tests with fixed dice: honest NPC reveals at trust 50, a liar needs the evidence or a won check
- **Done when:** ✅ Hale denies leaving his post until you show proof or break him; Brena just tells the truth at trust 50.

### N4.2: Quirks and tells

A few habits per NPC that show up as situation lines.

*Why now:* cheap: one situation line per trigger.

- **Mechanics:** `quirks: [{ when, line }]`, where `when` is a code condition (time, place, topic, who's nearby, mood). Examples: Brena won't talk shop mid-job, Pell drops his voice when the guard is near, Hale gets shifty at the mention of the captain.
- **Tasks:**
  - [x] `QuirkSchema`, with `when` limited to a fixed set of checks: activity, place, topic words, who's nearby, mood, hours, hurt. Every condition given must hold
  - [x] Gate each quirk line by topic (rule 3): at most two lines per turn, topic quirks first
  - [x] Two or three quirks per NPC
  - [x] Test: a quirk line appears only when its condition holds
- **Done when:** ✅ the same question gets a different situation line at the forge mid-job than at rest.

### N4.3: Learning the player's name

NPCs learn who you are, and remember it.

*Why now:* everyone calls you "Traveler" forever.

- **Mechanics:** the player has a name. Each NPC has `knownName: string | null` and `metBefore: boolean` in state. They learn it when you tell them (detected in code from "I'm …" or "my name is …", or through `/introduce`), or through gossip (N7) as a rumour. Below a trust level they still call you "stranger"; above it, by name. On a return visit after a gap (N2), they greet you as someone they know, using memory (N5).
- **Tasks:**
  - [x] Name detection in code, plus `knownName`, `nameSource`, `metBefore` and `lastMetDay` in state and save. `/introduce`, and `--name=Anand` for the CLI
  - [x] The situation says who they think you are: "They told you their name is Anand" / "a stranger you've never met". Until told, the model never sees the real name: NpcAgent swaps it for what the NPC knows in everything it sends (`maskPlayerName`)
  - [x] Tests: a name is learned once, persists, and spreads through gossip as a rumour (`src/game/gossip.ts`, when NPCs share a place)
- **Done when:** ✅ after you introduce yourself and earn some trust, Brena uses your name, and Pell already knows it from her (over supper at the inn).

### N4.4: Appearances and `/look`

What NPCs look like, and what they notice about you.

*Why now:* NPCs have no described look, and don't notice yours.

- **Mechanics:**
  - An `appearance` in each NPC file: a fixed description (build, age, clothes) plus **visible state worked out in code**: injured (from HP), soot-covered (working), armed (equipment, N8), drunk, tired (needs, N6).
  - `/look` shows it to the player, with no model call.
  - **NPCs notice the player:** a drawn or bloody weapon, a visible wound, rich or ragged clothes, a stolen item they recognise (N7.5). The most notable one becomes a situation line ("They're carrying your stolen dagger").
- **Tasks:**
  - [x] `appearance` in the schema, and `describeNpcAppearance` in code: wounds, soot at the forge, weapons and armour, a little drunk (an evening ale), tired, hungry
  - [x] `/look [npc|me]` (and a Look button), and a player appearance built from their gear and condition. A weapon is bloody for two hours after drawing blood
  - [x] A notice rule that shows at most one line per turn (rule 3), once per encounter for each thing; loved or feared gear counts most
  - [x] Tests: the visible state follows HP, equipment and needs
  - [x] Stolen items they recognise (N7.5): gear on show stolen from them or a friend gets you caught
- **Done when:** ✅ `/look` at a wounded Brena mentions the wound, and she comments when you walk in with a bloody sword.

---

## N5: Memory and relationships

**Status:** ✅ Built (`src/game/events.ts`, `src/npc/memory.ts`, `src/npc/relationship.ts`; tests in `tests/n5.test.ts`)

**Goal:** NPCs remember what you did, and it changes how they treat you days later.

**Mechanics:**
- **Event log, written in code, not by the LLM.** Every meaningful action records an event: `{ day, kind, actor, target, details, importance }`. Kinds: bought, sold, insulted, complimented, attacked, fled, lied-to, quest done, quest failed, gift, secret shared.
- **Memory = events the NPC witnessed.** Each fact has an importance (1–10) that fades over time, and `forgiveness` controls how fast negative facts fade.
- **Recall:** the top 3 facts by importance × freshness go into the situation block as short lines ("Two days ago they insulted your forge."). This uses no LLM call.
- **Relationships with three axes instead of one:**
  - **Trust:** do they believe you? This is today's trust.
  - **Fear:** are they scared of you? Intimidation, attacks and your strength raise it.
  - **Respect:** do they rate you? Finished quests, skill and level raise it.

  Rules use different axes:
  - **Secrets** need trust.
  - **Discounts from intimidation** need fear.
  - **High-tier quests and master training** need respect.
- **Grudges:** being attacked or robbed sets a grudge that blocks trading and training until it fades or you make amends (a gift, a quest or paying a fine).

**Tasks:**
- [x] `src/game/events.ts` (the event log, saved in the world, least important pruned past 300) and `src/npc/memory.ts` (witnessed facts, decay, recall). Bad memories fade at a half-life of 3 to 12 days by `forgiveness`, good ones at 10
- [x] Record events from the existing actions: insults and kindness (from the NPC's own mood call after the player's line), purchases, sales, attacks, threats, quests, gifts, secrets, lies, promises, favours, amends, services
- [x] Add `fear`, `respect` and `affection` next to trust (`relationship` stays the trust field, to keep saves and rules). Fear and respect also grow with the player's rank above the NPC. Gates moved: discounts from intimidation need fear (a brave NPC is shaken but won't cut prices); C-tier and higher quests need respect (`minRespect` too); expert and master training need respect 15 and 30
- [x] Grudges and amends: being attacked sets a grudge (2 to 10 days by forgiveness) that blocks trade, training, repairs and services. `make_amends` is offered only while a grudge exists and the player sounds sorry; the fine is set in code. A quest or a gift worth the fine settles it too
- [x] Optional: an LLM summary of a conversation (facts and tone), using Ollama's `format` with a Zod schema (`director/summary.ts`). Code events stay the source of truth: summary memories are marked, capped at importance 4, never gossiped

**Done when:** ✅ insult Brena, `/wait 24`, come back, and she's still cold and says why. Help her with two quests, and her respect unlocks something trust alone didn't (expert smithing).

**Features in this phase:** N5.1 Asking for favours; N5.2 Fears and loves; N5.3 Lasting emotions; N5.4 The player can lie; N5.5 Promises and commitments; N5.6 Affection, friendship and romance; N5.7 The player's journal.

### N5.1: Asking for favours

The player can ask for something outside the shop and quests.

*Why now:* needs the trust, fear and respect axes.

- **Mechanics:** favour kinds such as `vouch`, `lend_gold`, `hide_item` and `warn_me`. Code decides from trust, fear, respect and traits (generosity, honesty), and sets the cost. Following the "offer, then confirm" rule, the NPC offers terms and the player accepts. A favour creates a debt of favour that the NPC can call in later.
- **Tasks:**
  - [x] `src/game/favours.ts`: kinds, requirements, terms, `owedFavours` in state. A loan is a promise to repay (N5.5); vouching lifts other NPCs' trust once; hidden items come back with `/retrieve`; a warning comes as an opening line after a raid (N6.3)
  - [x] `/ask <favour>` in the CLI, and a gated `offer_favour` tool (favour talk only, and only the kinds they'd grant)
  - [x] Tests: refused below the needed trust, accepted above, and a favour is owed after
- **Done when:** ✅ a trusted player gets a loan from Brena and she later asks for a favour back (a day later she calls it in: a job on her board, "A favour returned").

### N5.2: Fears and loves

Specific things an NPC reacts to strongly.

*Why now:* triggers and gifts move mood and trust.

- **Mechanics:** `fears` and `loves` lists of people, items, topics or places. A mention or sighting shifts mood and trust by an amount set in code. A gift of a loved item is worth more than gold. A fear raises the chance of fleeing and lowers the morale roll.
- **Tasks:**
  - [x] Schema (`{ name, words, item?, minTier?, npc? }`), plus the detection of mentions (keyword lists, not the model). Once a day each; the player's journal notes what they found out
  - [x] Gift flow (`/give <item|money>`) and the morale modifier from fears in sight (+3 to the morale target)
  - [x] Tests: a loved gift raises trust more than its gold value, a feared name shifts mood
- **Done when:** ✅ a well-made blade wins Brena over faster than coins do, and Pell panics when the mayor is named.

### N5.3: Lasting emotions

Moods that last past one conversation: grief, pride, embarrassment, resentment.

*Why now:* needs the event log.

- **Mechanics:** an `emotions` list in state with a strength and a decay rate (set by `forgiveness` for negative ones). Events from the log (N5) add emotions: a job well done gives pride, a public haggle loss gives resentment. Emotions nudge mood and drive a situation line.
- **Tasks:**
  - [x] `src/npc/emotions.ts`: add, decay and describe. Moods now drift back to a baseline (feelings, then needs) after three hours away from the player
  - [x] Hook into the event log (N5) and the save (N2): insults (worse in front of others), a public haggle loss, a masterwork, a quest done, being lied to, a broken promise
  - [x] Tests: decay over `/wait`, and slower decay for grudge-holders
- **Done when:** ✅ after you insult Pell in front of others, he's cool with you a day later and warm again a week later.

### N5.4: The player can lie

The player can bluff, and the NPC may see through it.

*Why now:* today only NPCs can be dishonest.

- **Mechanics:** `/lie <claim>`, or a lie detected in what the player says. Rolled: the player's charisma + speechcraft against the NPC's perception + an "insight" bonus from their traits. If it works, the claim is believed and stored as a fact (N5), e.g. "they said the mayor sent them". If it fails, it's spotted: trust and respect drop, and it's remembered and gossiped (N7). A lie that's later contradicted by evidence is found out after the fact.
- **Tasks:**
  - [x] `src/game/deception.ts`: the roll, and believed claims stored as beliefs with a `false` flag the NPC doesn't see. Only `/lie` for now; spotting lies in plain talk would need the model's help
  - [x] When a believed lie is later contradicted, mark it found out and apply the penalty: each night a chance (25% if it names someone they know for certain, 5% otherwise). `exposeLie` is there for gossip and items to call (N7)
  - [x] Tests with fixed dice: believed, spotted, and found out later
- **Done when:** ✅ telling Hale "the captain sent me" works on a good roll, and he turns cold once he learns otherwise.

### N5.5: Promises and commitments

When an NPC promises something, code tracks it.

*Why now:* NPCs say "tomorrow" and nothing tracks it.

- **Mechanics:** a `commitments` list in state: `{ what, due, toWhom }`. Created by game actions (a commission is due at a time, a favour is owed, a quest has a deadline), never by parsing the model's words. Keeping a promise raises reputation; breaking one costs trust and is gossiped. This applies to the player's commitments too.
- **Tasks:**
  - [x] `src/game/commitments.ts`: create, check on time passing, keep or break
  - [x] Hook commissions and favours (loans) into it. Commissions came forward from N10 for this (`src/game/commissions.ts`, `/commission`, `/collect`): the NPC names a time from the work alone, not their schedule, so a late order runs late
  - [x] Quest deadlines (N9): `deadlineHours`, failed in code (`failOverdueQuests`)
  - [x] A situation line when something is due ("You promised them the sword by sundown")
  - [x] Tests: kept and broken promises apply their effects once
- **Done when:** ✅ Brena finishes a commission late, apologises unprompted, and gives a discount (20% off).

### N5.6: Affection, friendship and romance

Liking someone, as its own score.

*Why now:* liking someone isn't the same as trusting or respecting them.

- **Mechanics:**
  - A fourth relationship axis, **affection** (−100 to 100), next to trust, fear and respect (N5). It's raised by time spent together, gifts they love (N5.2), help and shared experiences, and lowered by insults and betrayal.
  - **Friendship stages:** acquaintance → friend → close friend, each unlocking something in code (a discount, a favour, a personal quest).
  - **Romance is opt-in**, per NPC (`romance: { open: true, orientation, conditions }`) and per player setting. It has stages, needs a minimum affection and trust, and is never available for NPCs marked `minor: true`.
  - **Content limits come first** (design rule 7): what the game allows is set in config and enforced in code, before any romance content exists.
- **Tasks:**
  - [x] Add `affection` to relationships (N5), and friendship stages with unlocks: a friend's discount of 10%, 15% for a close friend. Affection comes from time together (a little, three times a day), gifts, loved gifts, quests; insults, lies found out and attacks take it away
  - [x] `minor` and `romance` fields in the schema; the schema rejects `romance.open` on a minor
  - [x] Content settings in `config.ts` (`content.romance`, off unless `ROMANCE=on`; `content.minorsCanBeAttacked`, off), and tests that a minor NPC never gets romance and can't be attacked
  - [x] Romance stages for one adult NPC (Brena), as a proof: from affection and trust, shown as one situation line. No romance tools or scenes yet
- **Done when:** ✅ helping Pell over several days makes him a friend with a friend's discount, and the tests show no route to romance with a minor NPC.

### N5.7: The player's journal

What the player has learned, kept for them.

*Why now:* what the *player* has learned has nowhere to live.

- **Mechanics:** a `journal` in the player save, filled in **by code from events (N5)**, never from the model's words: secrets revealed (N4.1), likes and dislikes discovered (N5.2), rumours heard and whether they turned out true (N7.1), promises made (N5.5), names learned, and quest notes. `/journal [npc]` shows it. Later, G1's interface can show it as pages.
- **Tasks:**
  - [x] `src/game/journal.ts`: entries from events, grouped by NPC (secrets, cover stories heard, loves, fears, promises, names, quests, lies, favours). Rumours (N7.1) later
  - [x] `/journal [npc]` in the CLI, and grouped by NPC in the browser's Quests tab
  - [x] Tests: each kind of event adds the right entry once
- **Done when:** ✅ after a session with Brena, `/journal brena` lists her secret, the stew she loves and the sword she promised you.

**Also from the old memory plan:**
- [x] Optional: recall by meaning with a small local embedding model (`nomic-embed-text` via `ollama.embed()`, `OllamaEmbedder`), falling back to a hashed bag of words when it isn't pulled. Summaries live in a SQLite store (`game/db.ts`, `node:sqlite`) with their vectors; an NPC recalls the closest old talks into the situation block
- [x] Optional: an LLM summary of a finished conversation (or of exchanges dropped from the context window) into 1–5 facts, with `format` + Zod (`director/summary.ts`). Code events stay the source of truth
