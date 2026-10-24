[← Plans](README.md) · [Stage 2: N26J](../stage-2-everyone-lives.md#n26j-rough-justice-and-being-taken)

# N26J plan: Rough justice and being taken

Planned 2026-10-24 as a **stand-in** ([plans README §28](README.md#28-every-phase-brings-its-admin-page-its-art-list-and-its-stand-ins)). N26H (bribes, trespass, forcing gates) and N26I (bandits, captives, ransoms) need consequences, but law and trials (N48) and setbacks (N49) are in Stage 4. This phase builds the smallest working version of each, and N48 and N49 replace them later without changing what the player sees on the surface.

**In one line:** a crime that is seen has a **simple local punishment** handed down by the place's head or lord, by the place's custom and the crime's weight (a fine, the stocks, a night in the lock-up, a flogging, being thrown out, a price on their head), for NPCs and the player alike; and when bandits beat the player, they may **take them captive** instead of just robbing them: held at their camp or stronghold as a real captive (N26I), with real ways out (escape, ransom, rescue, or being set free).

**Read first:** [plans README](README.md) Part 3. Needs [N26I](n26i-fallen-places-lairs-and-strongholds.md) decision 5 (captives) for the second half, so build that half with or after N26I. Takes from [N48](n48-law-and-trials.md) (crimes and punishments, as a thin cut) and [N49](n49-setbacks-instead-of-game-over.md) decisions 1–3 (one setback chooser; a chapter on the player; exits as mechanics), only for "captured by bandits".

## What exists

- **Crime:** witnesses, reports, bounties and jail hours for the player ([`crime.ts`](../../../packages/server/src/game/crime.ts): `reportCrimes`, `surrender`); theft and stealth ([`stealth.ts`](../../../packages/server/src/game/stealth.ts)). NPC crimes from N38's actions (theft, violence behind a flag) have witnesses but no sentence.
- **Defeat:** `config.playerDefeat` is `knockout` (wake later with some HP, lose some money) or `permadeath`; the ageless player comes back from death (decided 2026-10-23).
- **Bribes** only as dilemma text ([`dilemmas.ts`](../../../packages/server/src/game/dilemmas.ts)).

## Decisions made in this plan

1. **Crimes have a weight.** A small table in `data/law/crimes.json`: trespass, petty theft, theft, bribery (giving or taking), assault, poaching, stealing crops, breaking into a guarded place, kidnapping, banditry, killing. Each has a weight 1–5 and words.
2. **Punishment is local custom, decided by a real person.** The place's head (or the lord where the lord sits) decides, through N38's action scoring with their traits (harsh, fair, greedy, merciful) and the crime's weight. The choices: a **fine** (paid to the treasury through §24's `transfer`), a night or several in the **lock-up** (a cell in the hall or barracks, N26H), the **stocks** for a day (seen by everyone, a shame that gossip spreads), a **flogging** (an injury), being **thrown out** of the place for a time (refused at its gate), a **bounty** on someone who ran (real hunters and guards may come after them), and for the worst crimes, **hanging** for NPCs where the place's custom allows it. The player isn't hanged: a death sentence becomes the worst setback instead (decision 5), since the player comes back from death anyway.
3. **The same for everyone.** An NPC thief caught by a witness and a player caught by one go through the same `sentence(who, crime, place, day)`. Gang members caught in a raid are punished by the place they raided (or ransomed back to their gang). Every sentence is an event and news; N48 later turns it into trials, records and appeals.
4. **Bribes and their price.** Bribing a guard (N26H) is a crime for both sides if found out: the guard loses their post, the briber is fined or thrown out. Whether it's found out is who else saw and what the guard says later (gossip, N33).
5. **When bandits win, the player may be taken.** One chooser (N49 decision 1, cut down) decides what happens when the player is beaten: by beasts, the usual knockout (or dragged off and left for dead); by bandits, **robbed and left**, or **taken** if the gang has a camp or stronghold and the player is worth something (renown, wealth, a lord who'd pay, or labour). A taken player is a captive like any other (N26I decision 5), and the player's chapter (`player.chapter = { kind: "captive", holder, since, exits }`) limits what they can do: talk to captors and fellow captives, work, wait, plan.
6. **Real ways out.** Each exit is a mechanic, not a cutscene:
   - **escape:** find a way (a bribable guard, a fellow captive who knows the path, a night when the watch is thin, a tool), then a stealth check against the real watch; failure means a beating and a closer watch;
   - **ransom:** the chief names a price, and a letter goes by courier to whoever might pay: the player's friends (N37 relationships), their lord or guild (N40/N69 seats), or the player's own coin. Paying is an N38 action for those NPCs;
   - **rescue:** friends and the player's home place may post a rescue quest (N26I decision 8), which real NPCs can take;
   - **working it off** or **joining**: the chief may let a useful captive go after a stretch of labour, or take them into the gang (the hook N26I decision 10 has).
   Coming home, people greet the player as they've heard it.
7. **N48 and N49 replace this.** The table, `sentence`, the chooser and the captive chapter are written so N48 can put a trial in front of `sentence` and N49 can add its other setbacks (prison, slavery, debt, exile, maiming) to the chooser.

## Data shapes

```ts
// data/law/crimes.json: [{ id: "trespass", weight: 1, words: "trespass" }, ...]
// game/law/sentence.ts
export function sentence(realm: Realm, who: PersonRef, crime: string, place: string, day: number, rng: Rng): Sentence;
export interface Sentence { by: string /* the head or lord */; kind: "fine" | "lockup" | "stocks" | "flogging" | "banished" | "bounty" | "hanging"; amount?: number; until?: number }
// player
chapter?: { kind: "captive"; holder: string /* faction id */; since: number; exits: Array<"escape" | "ransom" | "rescue" | "labour" | "join"> };
banished?: Record<string /* place */, number /* until day */>;
```

Save: shares N26F–N26J's save version (section 20).

## Steps

### Step 1: crimes and sentences
- `data/law/crimes.json`, `game/law/sentence.ts`, the head's or lord's choice by traits, lock-up and stocks as places on the map (N26H), banishment at the gate, bounties with real hunters. NPCs and the player both.
- Tests: a petty thief caught in the market is fined by a fair head and flogged by a harsh one; a banished player is refused at the gate until the day it ends; an NPC thief and the player caught for the same crime get the same range of sentences.

### Step 2: bribes found out
- Bribery as a crime for both sides; the guard loses their post.
- Test: a guard who took a bribe and was seen is dismissed, and the briber is fined.

### Step 3: the player taken
- The defeat chooser; the captive chapter; escape, ransom (a courier letter, an N38 action for whoever pays), rescue quests, labour, joining.
- Tests: beaten by a gang with a stronghold, a player with renown is taken to it and held as a captive; a friend with coin pays the ransom and the player walks home; an escape at night with a bribed watchman works, and a failed one is punished.

### Step 4: docs
- README: crime and punishment for now, being taken. Stage file. Notes in N48 and N49 saying what they replace.

## Done when (mapped)

| Done-when clause | Proved by |
|---|---|
| a crime that's seen is punished by the place's head by its custom, for the player and NPCs alike | sentences tests |
| beaten by bandits, the player can be taken to their stronghold and get out by escape, ransom or rescue | captive tests |

## Out of scope

Trials, records and appeals (N48). Prison sentences, slavery, debt, exile and maiming for the player (N49). Laws that differ by kingdom (N45's policy mechanism).
