[← Plans](README.md) · [Stage 4: N52](../stage-4-society.md#n52-shaping-what-people-believe)

# N52 plan: Shaping what people believe

**In one line:** the player's words enter N33's gossip as knowledge items like anyone's: a **planted rumour** is a new ref with a chosen subject and claim, believed by credence (trust, affection, the speaker's renown), spreading and drifting by the normal rules; the player can **frame** people with planted evidence and false witnesses, **pay** a bard, priest or crier for a song, sermon or proclamation, and play factions against each other; every planted item keeps a hidden **trail** back to its origin, and investigation can follow it to the player, with the law and grudges as consequences.

**Read first:** [plans README](README.md) sections 3, 13, 15. Needs N33 (knowledge rows, venues, variants), N46 (secrets, prying, exposure), N48 (cases, evidence, slander and false accusation), N50 (priests, sermons). Uses N41/N68 (bards), N58 (proclamations and rulers who listen to rumours), N36 (mood moved by rumours).

## What exists

- **The player's lies to talkers** ([`deception.ts`](../../../packages/server/src/game/deception.ts)): `tellLie`, `lieTarget`, `Belief`, exposure chance (`EXPOSE_CHANCE`), `exposeLies`; beliefs about named people.
- **Rumours about the player** ([`rumours.ts`](../../../packages/server/src/game/rumours.ts)): truths and accuracy, `confrontRumour`.
- After N33: knowledge refs, credence, retelling loss, variants; after N46: secrets and exposure; after N48: cases with evidence including `planted`, slander.

## Decisions made in this plan

1. **A planted rumour is a fabricated ref.** `r:p<id>`: `{ subject (person, place or faction), claim (from a menu: stole, cheats, sleeps with, plots against, is a heretic, is a spy, is sick, is broke, will raise taxes, is hiding a runaway…), detail?, planted_by: "player", planted_day, first_told: person }` in a `fabrications` table. It's not true; the truth view knows it's false. Told to someone, it becomes their knowledge row with accuracy = how convincing it was (the player's speechcraft, the listener's credence of the player, the claim's plausibility against what the listener knows of the subject: a known-honest person's theft is less believed).
2. **It spreads like any rumour** (N33): it's tellable, gossipy people tell it more (pick a gossipy stallholder for a fast start), variants drift (the tax money becomes the grain money, the mayor becomes the mayor's wife), accuracy falls (it's already false; accuracy here is "how much they believe it"). Subjects' allies disbelieve it more (relationship bias in credence).
3. **Effects of belief:** knowledge rows about a subject that are believed (accuracy ≥ 0.5) feed relationships toward the subject (trust and respect down for theft claims), the subject's reputation by place (N67), N38 scores (confront the accused, refuse to deal), the place's mood (N36: anger at a mayor who stole the tax money), and authority action: if enough believe a crime claim (a threshold by place size), the captain or head **investigates** (decision 5).
4. **Framing** = a planted rumour plus **evidence**: plant an item (put a stolen item in someone's house: N32/N43, a document with a false secret: N46), bribe or persuade **false witnesses** (an N38 decision for them: coin, fear, a grudge against the target, low honesty). Framed evidence enters a case (N48) as `planted` (looks like real evidence to the court; the truth view knows).
5. **Investigation follows the trail.** Each fabrication's knowledge rows have `source` (who told whom). An investigation (by the captain, the subject, a curious talker, N46's prying) walks sources backward with a chance per hop (by the investigator's skill and each teller's willingness to say who told them: friends shield, enemies don't). Reaching the first teller, they name the player with a chance (they remember who told them; the player's disguise or intermediaries lower it). Found out: the subject gets a grievance (N37) and may become a nemesis (N44); the law opens a `slander` case (or `perjury` for false witnesses, `false_accusation` if a case was opened on it).
6. **Paid voices:** pay a **bard** for a song (a song is a ref with a big reach: everyone in the inn hears it; N68's songs later), a **priest** for a sermon (reaches the faithful at the temple on a rest day; weighted by their devotion: N50), a **crier** for a proclamation (only with a head's or lord's authority: bribe or persuade them; reaches the whole place at once). Each has a price and a willingness (traits, honesty, what it says about whom: a priest won't preach against their own order). Their reach is the venue's people; then gossip.
7. **Playing factions:** a planted rumour whose subject is a faction ("the merchants' guild is hoarding grain") shifts faction stances (`stances`) through members who believe it, through the normal faction rules (opinion moves by members' beliefs: a new small rule in `realm/factions.ts`).
8. **Not only the player:** NPCs already spread rumours as revenge (N37) and politics (N46); this phase gives them the same fabrication record (`planted_by: <person>`), so investigations work for everyone.

## Steps

### Step 1: fabrications
- `fabrications` table; the plant action (talk menu: "tell them that…", subject and claim pickers); first belief by credence and plausibility.
- Test: a rumour planted with a gossipy stallholder is believed by them (accuracy above 0.5) and known as false in the truth view.

### Step 2: spread and drift
- Make fabrications tellable in N33; variants for claims; allies' disbelief.
- Test (done-when part): the player whispers to a gossipy stallholder that the mayor (the place's head) stole the tax money, and it reaches half the village in three days in several versions (count rows; distinct variants ≥ 2).

### Step 3: effects and investigation
- Belief effects (relationships, reputation, mood); investigation threshold; the captain investigates.
- Test (done-when part): the captain investigates once enough believe it (an investigation record, an event).

### Step 4: the trail and getting caught
- Walking sources; naming the player; grievance and slander case.
- Test (done-when part): if the player is found out, the mayor has a grudge and the law a case (a fixed seed where the trail reaches the player; another where a friend shields them and it doesn't).

### Step 5: framing
- Planting items and documents; false witnesses; cases with `planted` evidence.
- Test: framing a merchant with a stolen item in their house and a bribed witness leads to a case against them; discovery of the bribe flips it.

### Step 6: paid voices and factions
- Bards, priests, criers; faction stances moved by believed rumours.
- Test: a paid sermon reaches the temple's faithful; a rumour about a guild lowers another faction's stance toward it.

### Step 7: NPC fabricators; admin; docs
- N37/N46 rumours as fabrications; admin: fabrications, their spread and trail. README.

## Balance bounds

- `rumours-die-out`: most fabrications are forgotten within a season.
- `trails-findable`: a share of investigations reach the origin.

## Edge cases and traps

- **Never let a fabricated claim change the truth.** The mayor didn't steal; a case on it may still convict (that's justice going wrong, intended), but the truth view says it was false.
- **The model's words** (talkers repeating the rumour) are fed the believed variant, not the truth.
- **Claims are a menu**, not free text, so code knows what they mean. The player's free text, if allowed, maps to the nearest claim (a classifier by keywords, not a model decision with effects).

## Tests (`packages/server/tests/n52.test.ts`)

The done-when one, step by step: the player whispers to a gossipy stallholder that the mayor stole the tax money; it reaches half the village in three days in several versions; the captain investigates; if the player is found out, the mayor has a grudge and the law a case.

## Done when (mapped)

| Done-when clause | Proved by |
|---|---|
| reaches half the village in three days in several versions | step 2 test |
| the captain investigates | step 3 test |
| if the player is found out the mayor has a grudge and the law a case | step 4 test |

**Save:** the next schema version (`fabrications`).

## Slice cut

Not in the slice.

## Out of scope

Songs as lasting legends (N68). Propaganda by kingdoms (N58's responses can use proclamations later).
