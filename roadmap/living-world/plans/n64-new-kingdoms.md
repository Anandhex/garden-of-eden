[← Plans](README.md) · [Stage 6: N64](../stage-6-a-changing-world.md#n64-new-kingdoms)

# N64 plan: New kingdoms

**In one line:** a free settlement (or a cluster of them) that has **held out** 60+ days with enough people, wealth and defenders and a ruler with renown becomes a **kingdom**: a capital, a crown faction, a ruler, laws chosen from how it was born, a culture (inherited or mixed), opinions of the old kingdom starting negative; other kingdoms **recognise** it, attack it or ignore it, recorded as treaties; it can be conquered, merge back or split again; the number of kingdoms never passes the cap; the player can found one the same way.

**Read first:** [plans README](README.md) sections 2, 14 (a new kingdom's policies), 19 (`culture-names`). Needs N56 (successful revolts and breakaways), N59 (liberation groups holding a settlement), N63 (new settlements that break away). Uses N13's `breakAway`, `declareWar`, treaties and `capture`; N45/N48/N50/N51/N54/N58/N59 policies (a new kingdom needs every policy key set); N53 (culture); N57 (the player's faction holding a settlement).

## What exists

- **Breakaways** ([`realm/politics.ts`](../../../packages/server/src/game/realm/politics.ts) `breakAway`): a settlement (and those under it) breaks free; rebels form; the crown may come (`REBEL_WAR_CHANCE`). `settlement.freeSince`; `kingdom: null` for free places.
- **Kingdoms:** `KingdomSchema` (capital, crown faction, ruler, colour, opinion, weariness, laws, `fallen`); `COLORS` in [`realm/names.ts`](../../../packages/server/src/game/realm/names.ts) has six colours.
- **Diplomacy:** treaties (`sign`, `breakTreaty`), opinions (`shiftOpinion`), wars (`declareWar`, `endWar`, `capture`).
- **The cap:** the overview's open decisions say **12** by default; the stage file says **6**. **Question 1.**

## Decisions made in this plan

1. **The trigger** (checked weekly): a free settlement (no kingdom; `freeSince` ≥ 60 days ago; not crushed: it was never captured back since) or a **cluster** (free settlements within a day's walk whose heads are allied: the strongest is the seat) with: population ≥ a town's band, treasury ≥ a sum, defenders (guards, walls, its faction's soldiers: N55) ≥ a strength, and a head with renown ≥ a threshold. And the realm has fewer kingdoms than the cap (decision 6).
2. **Founding** is an event and big news: a new `Kingdom` (id, a name in its culture's style: the model's `culture-names` or the syllable tables; a colour from an extended palette; capital = the seat; ruler = the head, crowned: their role becomes `ruler`), a crown faction (the band or group that won becomes it, or a new crown faction with them as members), the cluster's settlements join it, `opinion` toward the old kingdom starts at −60 (and the old kingdom's toward it at −80).
3. **Laws from its birth:** a liberation kingdom (born of N59) keeps no slaves (`slavery: false`), shelters runaways; a peasants' revolt (N56 against a lord) frees serfs (`serfdom: false`), lighter word weights; a breakaway of nobles keeps the old laws; a new settlement's breakaway (N63) keeps its parent's. Every policy key (section 14) is set: inherited from the old kingdom then adjusted by how it was born and by the new ruler's traits (`decidePolicy` for each key, news for the notable ones).
4. **Culture:** inherited from the old kingdom with a drift (N53's mixing), or from the people who founded it (a liberation kingdom of many origins gets a mixed culture), named.
5. **Recognition:** every other kingdom decides within a few weeks: `recognise` (a `non_aggression` or `trade` treaty: by opinion and interest: an enemy of the old kingdom recognises gladly), `attack` (the old liege nearly always tries to take it back unless weary; others who covet it), or `ignore` (no treaty). Recorded as treaties and news. The old liege's war is N13's war with the cause "to take back X".
6. **The cap:** at most `config.realm.maxKingdoms` kingdoms (default per question 1). If the realm is at the cap, a qualifying settlement stays a **free city** (it may still act like a small state: treaties as a settlement party `s:`) until a kingdom falls (conquered or merged).
7. **Endings:** **conquered** (`capture` of the capital by a war: the kingdom is `fallen`, its places join the conqueror), **merged back** (by treaty after a long peace and high opinion, or a royal marriage: N45 at crown level), **split again** (a province's own breakaway by N56/N13 rules). All news; the admin shows the kingdom's life.
8. **The player can found one** (the overview's default yes): when the player's faction (N57) holds a free settlement that meets the rules, the player is offered the crown (or declines and names a ruler). The player as ruler sets policies through a court panel (each policy key with its options and their expected effects), and the realm treats them like any ruler.

## Steps

### Step 1: the trigger and the cap
- Weekly check; clusters; `maxKingdoms` config.
- Test: a free settlement that meets every rule but the cap stays a free city.

### Step 2: founding
- New kingdom, crown, ruler, settlements joining, opinions, news; colour palette extended.
- Test (done-when part): a settlement that broke away after a revolt holds out 60+ days and becomes a kingdom with a crown.

### Step 3: laws and culture
- Laws from its birth; every policy key set; culture inherited or mixed and named.
- Test (done-when part): its laws follow its birth (a liberation kingdom has no slavery; a peasants' revolt frees serfs).

### Step 4: recognition
- Each kingdom's decision; treaties; the old liege's war.
- Test (done-when part): it's recognised by one neighbour and attacked by its old liege.

### Step 5: endings
- Conquest, merging, splitting.
- Test: a conquered new kingdom is `fallen` and its places join the conqueror; the count drops.

### Step 6: the player as founder and ruler
- The offer, the court panel, policies set by the player.
- Test: the player's faction holding a qualifying free settlement is offered the crown; accepting makes the player the ruler.

### Step 7: admin and docs
- Admin: kingdoms' histories (founded, recognised, wars, fallen). README.
- Test (done-when part): over a long run the count never passes the cap.

## Balance bounds

- `kingdom-cap`: never above the cap.
- `new-kingdoms-rare`: a new kingdom every few years at most.
- `kingdoms-survive-sometimes`: some new kingdoms last more than a decade.

## Edge cases and traps

- **Everything that iterates kingdoms** (policies, unrest memory, runaway policies per pair) must handle kingdoms appearing and falling: pair-keyed policies (`runaways:<k>`) are set for the new kingdom on founding and removed for fallen ones.
- **Free cities** at the cap use settlement parties in treaties (already supported: `s:`).
- **The player as ruler** must not freeze the realm waiting for their decisions: unanswered decisions fall back to the policy's default after a few days.

## Tests (`packages/server/tests/n64.test.ts`)

The done-when one: a settlement that broke away after a revolt holds out, becomes a kingdom with a crown and laws, is recognised by one neighbour and attacked by its old liege, and never pushes the count past the cap.

## Done when (mapped)

| Done-when clause | Proved by |
|---|---|
| a settlement that broke away after a revolt holds out, becomes a kingdom with a crown and laws | steps 2–3 tests |
| is recognised by one neighbour and attacked by its old liege | step 4 test |
| and never pushes the count past the cap | steps 1, 7 tests |

## Questions for the user

1. The kingdom cap: the overview's open decisions say **12**, the stage file says **6**. Which? (Plan default: 12, as the overview is the newer decision list; the stage file to be corrected.)

**Save:** the next save version (new kingdoms are just kingdoms; `settlement.freeSince` exists; config only).

## Slice cut

Not in the slice.

## Out of scope

Empires and vassal kingdoms (a kingdom under another). Elections in kingdoms.
