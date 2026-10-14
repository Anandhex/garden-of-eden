[← Plans](README.md) · [Stage 4: N51](../stage-4-society.md#n51-magic)

# N51 plan: Magic

**In one line:** magic becomes data and rules: a person has a **gift** (none → great, partly inherited) and **schools** learned to a rank; a **spell** is a data file with a cost (MP, reagents from N28's species, time, risk, and for forbidden schools a lasting price), a rank and effects the existing systems apply; places have **magic strength** (ley lines, standing stones, cursed ruins: N27's POIs); each kingdom and faith sets a **policy per school**; mages live in the world as court wizards, hedge witches, battle mages, guild members and rogues who choose and cast through N38; the player may discover a gift, learn, and hide it where it's banned.

**Read first:** [plans README](README.md) sections 2, 4, 13, 14 (`magic:<school>` policy), 19 (`spell-words`). Needs N48 (sorcery as a crime; trials), N50 (faiths' stance on schools; seers). Uses N27 (POIs for ley lines and stones; step 0 per section 11 if missing), N28 (reagents), N40 (ranks as a ladder), N42 (grades), N43 (enchanted items), N54 (peoples' own magic), N55 (battle mages), N58 (witch hunts in fear), N61 (plague and blame).

## What exists

- **Abilities and MP** ([`abilities.ts`](../../../packages/server/src/game/abilities.ts)): `ABILITIES` (signature moves, healing), `abilitiesFor`, `usableAbilities`, `chooseMove`, `SECOND_WIND_HP`; MP on stats (`maxMp`, `regenNpc` in [`healing.ts`](../../../packages/server/src/game/healing.ts)); healing as a service ([`services.ts`](../../../packages/server/src/game/services.ts)). No idea of a gift or a school.
- **Life and growth:** tiers, XP, talents from parents (`TALENT_CHANCE_PER_TIER`, `MAX_TALENTS` in [`family.ts`](../../../packages/server/src/game/family.ts) `inherit`), trait drift ([`npc/growth.ts`](../../../packages/server/src/npc/growth.ts)).
- **Alchemy** is a skill; herbs and reagents are items.

## Decisions made in this plan

1. **The gift.** Every person has `gift` 0..4 (none, faint, real, strong, great): rolled at birth from parents (`inherit` gains it: a gifted parent raises the chance; great talent is rare: about 1 in 2,000), stored on rows (one column) and talkers. Most people are 0 and never know. A gift **shows** in childhood with a chance per year by its strength (an event: odd things happen near the child), and then is known to the family and gossiped.
2. **Schools as data:** `data/magic/schools/*.json`: `healing, fire, water, earth, air, illusion, divination, warding, beast_speech, growth, necromancy, blood` (the last two `forbidden: true` by default), plus peoples' schools (`runes` for dwarves, `elven`, `shamanic` for orcs, `draconic`: N54). Each has an affinity to place kinds (fire strong near forges and volcanic hills; growth in groves), a lasting price for forbidden schools (corruption: trait drift toward cruelty, a mark visible to the gifted), and teachers.
3. **Spells as data:** `data/magic/spells/*.json`: `{ id, school, rank: tier, cost: { mp, reagents?: [{ item, qty }], minutes, risk }, effect: { kind: "heal" | "damage" | "shield" | "reveal" | "charm" | "scry" | "grow" | "calm_beast" | "raise_dead" | "curse" | "ward_place" | "illusion", magnitude, duration } , requires?: { gift, schoolRank } }`. Effects go through existing systems (heal = `tend`/HP; damage = the fight's damage; scry = learn a ref the caster asks about: a knowledge row from the truth at a distance, with accuracy by rank; charm = a relationship nudge with a secret if discovered; grow = a farm yield bonus (N30); calm = a pack's aggression for a day). **Failure** by `risk`: a misfire (the effect turns on the caster), MP lost, magic sickness (an illness), and for forbidden schools corruption.
4. **Learning** is N40's ladder for the `mage` ambition and N9's training: a teacher (a mage, a hedge witch, a temple for healing, a forbidden book: an item from a ruin, N27/N43) teaches schools up to their own rank; a college or mages' guild (a guild faction, trade `mages`, in cities) grants ranks by trial (N42's grade rules reused). Apprenticeship takes a gifted child from their family (a `child_taken` event: a choice for the parents in N38 scoring: pay, honour, fear).
5. **Places:** `magicAt(pos)` 0..2 from N27's POIs (standing stones, ley lines as seeded lines between stones, groves, cursed ruins) and dungeons; spells cost less or are stronger in strong places; some spells need one (raising the dead at a cursed site). If N27 isn't built, a per-settlement value from terrain and nearby dungeons (step 0 note).
6. **Policies** (section 14): `magic:<school>` per kingdom with values `free | licensed | taxed | crown | banned | burned`, chosen by the ruler's traits, the state faith's stance (N50 tenets: a purity faith bans necromancy and illusion; a mercy faith licenses healing), and events (after a plague blamed on witches, `burned`). Licensed mages register (a licence item; unlicensed casting is a crime); `crown` means only the court's mages; `banned` means casting is a crime (N48 `sorcery`); `burned` means mages are hunted (witch hunts: N38 persecution actions by zealous people and guards; trials with execution).
7. **Mages in the world:** generated at realm creation by role (a court wizard per crown, hedge witches in villages with a gifted person, a mages' guild in cities, battle mages in barracks towns), and grown in play from gifted children. They act through N38 actions (`cast` with the spell as the option: heal a sick neighbour for pay, scry for their lord, ward a granary, curse a rival if their traits and school allow; `teach`, `seek_teacher`). Court wizards give **divinations** to rulers (the N50 seer mechanism with a divination spell's accuracy). **Battle mages** add a side bonus in N55's battles (bounded: decision 9).
8. **The player** can have a gift (rolled at character start: low chance, shown as an odd event in the first days; or never); learn from a teacher; cast with MP and reagents; **hide** it: casting where banned is witnessed like a crime (perception of people in sight); crossing a border where the school is banned means carrying grimoires and reagents is contraband (N47 checkpoints) and being known as a mage is dangerous (knowledge rows about the player's casting).
9. **Balance:** magic can't make armies or rulers unbeatable (bounds): battle mage bonus capped at +15% side strength; healing caps per day; scrying limited by rank and cost; no resurrection of the long dead; great talents are rare and their training is slow.

## Steps

### Step 1: gifts
- `gift` on rows and talkers (migration), inheritance, showing in childhood (events, gossip).
- Test (done-when part): a child in the start town shows a gift (fixed seed) and the family and neighbours know.

### Step 2: schools and spells as data
- Schemas, files, `check-npcs` (reagents are items; schools exist).
- Test: every spell file passes; a broken one fails with a clear message.

### Step 3: casting
- `game/magic/cast.ts`: costs, effects through existing systems, failure and corruption; magic strength of places.
- Test: a healing spell cures a fever (reusing `cure`); a misfire with a fixed failing roll hurts the caster.

### Step 4: learning
- Teachers, apprenticeship (the hedge witch takes the gifted child: done-when part), guilds and trials, forbidden books.
- Test (done-when part): the gifted child is taken as a hedge witch's apprentice.

### Step 5: policies, licences, witch hunts
- `magic:<school>` policies, decided with faith stances and events; licences; sorcery cases; witch hunts.
- Test (done-when part): the free kingdom licenses healers while the slave kingdom burns a witch after a plague (until N61 exists, a forced plague condition on `site_days.plague`).

### Step 6: mages in the world
- Generation; N38 `cast`/`teach` actions; court divinations; battle mages' bounded bonus in fights (and in N55's battles).
- Tests (done-when parts): a court wizard's divination changes a ruler's decision (logged); a battle mage turns a battle (a fight with and without the mage on a fixed seed: different winner, within the cap).

### Step 7: the player's magic
- Gift at start, learning, casting UI (abilities list), hiding, contraband at borders.
- Test (done-when part): the player learns a minor spell and must hide it when crossing into a kingdom that bans it (carrying a grimoire is contraband at a toll gate; casting in sight there opens a case).

### Step 8: admin, words, docs
- Admin: gifts by place, mages, policies per school per kingdom. `spell-words` kind for descriptions. README.

## Balance bounds

- `magic-not-dominant`: battles with mages won by mages' side at most a little more often than strength predicts; rulers with court wizards don't win every war.
- `gifted-rare`: share of gifted people in a band.
- `witch-hunts-rare`.

## Edge cases and traps

- **Existing abilities stay:** signature moves and second wind are not magic; healing abilities of healers become the `healing` school's lowest spells (map them), so N8's tests keep passing.
- **Scrying reads the truth:** it's the one sanctioned way the truth becomes knowledge without a carrier; give it limits (rank, cost, accuracy < 1, only what the caster names).
- **Corruption must be visible to the gifted** (a hint in talker descriptions) so it's a story, not a hidden stat.

## Tests (`packages/server/tests/n51.test.ts`)

The done-when ones:
- A child in the start town shows a gift and is taken as a hedge witch's apprentice.
- The free kingdom licenses healers while the slave kingdom burns a witch after a plague.
- A court wizard's divination changes a ruler's decision (logged).
- A battle mage turns a battle.
- The player learns a minor spell and must hide it when crossing into a kingdom that bans it.

## Done when (mapped)

| Done-when clause | Proved by |
|---|---|
| a child in Millbrook shows a gift and is taken as a hedge witch's apprentice | steps 1, 4 tests |
| the free kingdom licenses healers while the slave kingdom burns a witch after a plague | step 5 test |
| a court wizard's divination changes a ruler's decision (logged) | step 6 test |
| a battle mage turns a battle in N55 | step 6 test (realm fights now; N55's battles when built) |
| the player learns a minor spell and must hide it when crossing into a kingdom that bans it | step 7 test |

**Save:** the next save version (policies, mages' fields on talkers and figures); the next schema version (`people.gift`, school ranks for rows as a small JSON column).

## Slice cut

Not in the slice.

## Out of scope

Enchanting items in depth (N43's items can carry an enchantment flag; crafting enchantments later). Peoples' magic details (N54). Magic in epidemics beyond healing (N61).
