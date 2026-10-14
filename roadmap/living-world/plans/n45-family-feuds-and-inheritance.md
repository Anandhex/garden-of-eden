[← Plans](README.md) · [Stage 4: N45](../stage-4-society.md#n45-family-feuds-and-inheritance)

# N45 plan: Family feuds and inheritance

**In one line:** when someone dies, their estate (house, shop, land, office, coin, notable items) passes by **their kingdom's inheritance law**; when the law and the family disagree (a will, a favourite, a claim), heirs **dispute**; grievances between families can be **inherited** by children, so feuds outlive their founders and flare later; affairs, separations and arranged marriages follow each kingdom's law and become gossip. This phase also builds the **kingdom policy** mechanism (README section 14) every later law uses.

**Read first:** [plans README](README.md) sections 2, 13, 14 (built here), 15, 17. Needs N25 (lineage, deaths, marriages of townsfolk), N37 (grievances), N40 (shops, land, offices as things held; `good_match` ambition). Uses N43 (heirlooms), N48 later (disputes go to court; until N48, the head of the place decides).

## What exists

- **Talkers' succession** ([`succession.ts`](../../../packages/server/src/game/succession.ts)): `deathRipple`; a named `successor` or the eldest grown child takes over place, trade, part of the stock and purse (`INHERIT_SHARE`), unfinished quests; a blood grudge if the player killed them (`BLOOD_GRUDGE_DAYS`).
- **Talkers' families** ([`family.ts`](../../../packages/server/src/game/family.ts)): marriages, courtships, children, `inherit` (traits and talents from parents, not property).
- **Townsfolk lineage** ([`people/index.ts`](../../../packages/server/src/game/people/index.ts) `lineageOf`), marriages and births in the life step ([`people/step.ts`](../../../packages/server/src/game/people/step.ts)), `home` (a house index), `master_id`; N40 adds `shop`, land.
- **Realm figures' succession** to offices ([`realm/politics.ts`](../../../packages/server/src/game/realm/politics.ts) `successionDay`, `install`): by renown and rank, not family; figures have `parents`.
- **Kingdom laws:** `laws: { slavery, serfdom }` only.
- **Grievances** (N37) per wrong between two people.

## Decisions made in this plan

1. **The policy mechanism first** (README section 14): `game/realm/policy.ts` with `POLICY_KEYS`, `decidePolicy`, `policyOf`, the `policy` news kind, `kingdom.policy` in the schema. The first keys: `inheritance` (`eldest` | `eldest_son` | `split` | `chosen`), `divorce` (`forbidden` | `church` | `allowed`), `marriage_by` (`family` | `free`: arranged marriages are the norm or not). Rulers decide at realm generation (by culture traits and the ruler's traits) and may change on succession; each change is news with a why.
2. **An estate** is computed at death: `estateOf(person)` → house (if they head the household), shop/workshop, land plots, an office that's hereditary (a lordship, a guild seat that passes by blood where the guild says), coin, notable items (N43). Rows and talkers alike.
3. **Heirs by law.** `heirsOf(person, law)`: from lineage (children, then spouse, then siblings, then parents) by the kingdom's `inheritance` policy: `eldest` (first child of age), `eldest_son` (first son, else first daughter), `split` (coin and land split equally; the house and shop to the eldest; offices to the eldest), `chosen` (a will: the deceased's favourite by affection, ambition and competence; a will is made by people with an estate when they become old or ill, a small record `will: { heir, day }`).
4. **Disputes when law and family disagree.** A dispute arises when: under `chosen`, the eldest is passed over; under `eldest`, a more competent or favoured child expected it (their ambition was the shop: N40); a spouse from a second marriage and children from the first; an illegitimate child (N45 affairs) claims. `dispute = { estate part, claimants, since, status }`. Resolution: by the place's head now (relationship and the claimants' standing), by a court once N48 exists; claimants may also settle (split, buy out), or act (N38: `insult`, `confront`, `spread_rumour`, sabotage, in the worst case `attack`). The loser gets a large grievance against the winner; the family's split is gossip.
5. **Inherited grievances make feuds.** When a person with an open grievance dies or when a child comes of age, part of their parents' open grievances **pass to the children** (weight × an inheritance factor by family closeness and the parent's weight; only grievances of weight ≥ 0.4). A **feud** is recognised when two families have mutual grievances across at least two people each: `feuds(id, a_family, b_family, since, cause_ref, flares)`; a family is a surname line at a place (N25's `surnameOf`). Feuds raise the hostility roll between their members (N37) and give N38's revenge actions reasons; they **flare** when a new wrong lands or a young hot-tempered member comes of age, and settle by marriage between the families (a classic; an arranged-marriage target), a big amends, or extinction.
6. **Affairs and separation.** A married person with low affection for their spouse and high affection for someone else may have an affair (N38 `court` with a married target, scored by temperament, low honesty, the place's culture; a **secret** for N46). Discovery (a witness in the venue, or through gossip of servants) → gossip → the spouse's grievance → separation where the kingdom's `divorce` policy allows (households split: one moves out), else a cold marriage (affection floor, no children) and a grievance. Children of affairs are recorded with the true father on the row (`father`) and a `claimed_father` where it differs (one new column), which is a secret until discovered.
7. **Arranged marriages.** Parents with the `good_match` ambition (N40) pick a match for a grown child by class, wealth and alliance (a rival family to end a feud; a richer one), under `marriage_by = family`. The child's affection is still a factor: an unwilling match lowers affection between child and parent and raises the chance of an affair later.

## Data shapes

```ts
kingdom.policy: { inheritance?: …, divorce?: …, marriage_by?: … }   // section 14
// people: will TEXT (JSON {heir, day}), claimed_father TEXT    – migration
// SQLite: disputes(id, estate_of, part, claimants JSON, since, status, winner, resolved_day); feuds(id, a_family, b_family, since, cause_ref, flares, settled)
```

## Steps

### Step 1: kingdom policies
- `policy.ts` (section 14), schema migration, generation-time decisions, the admin table of laws, news on change.
- Test: every kingdom has an inheritance, divorce and marriage policy; a new ruler may change one, with news and a why.

### Step 2: estates and heirs
- `estateOf`, `heirsOf`, the transfer at death for rows and talkers (talkers' `succession.ts` uses it instead of its own rules, keeping the named-successor behaviour as a `chosen` will), wills.
- Test: under `eldest`, a smith's shop goes to the eldest child; under `split`, coin is split.

### Step 3: disputes
- Detection, records, resolution by the head (or N48's court), settlements, actions between claimants.
- Test (done-when part): a smith dies with two heirs who dispute the forge (the younger had the `master_trade` ambition and more skill); the dispute is recorded and resolved, and the loser holds a grievance.

### Step 4: inherited grievances and feuds
- Passing grievances at death and coming of age; feud detection, effects on hostility and revenge; flares; settling by marriage.
- Test (done-when part): one family's grudge against another passes to their children and flares a generation later (a long run: years; a young member of age commits a wrong against the other family).

### Step 5: affairs and separation
- The affair action, the secret, discovery and gossip, separation by policy, `claimed_father`.
- Test (done-when part): an affair becomes gossip that ends a marriage (in a kingdom that allows divorce: the household splits).

### Step 6: arranged marriages
- `good_match` ambitions pick matches; feud-ending marriages.
- Test: a parent with `good_match` marries a child into a richer family.

### Step 7: admin and docs
- Admin: a family's tree with estates, disputes and feuds; README.

## Balance bounds

- `feuds-bounded`: active feuds per place under a cap; most settle within a generation.
- `estates-pass`: no estate is left without an owner longer than a season while kin exist.
- `affairs-rare`.

## Edge cases and traps

- **Generation length:** with `daysPerYear = 12`, a generation is ~240 days. Long tests (`LONG=1`) for feuds over generations; a small version runs always with a short fake generation (young people coming of age in the test's span).
- **Houses** are indexes in a fixed layout (N31): inheriting a house means the household's `home` stays; an heir who already has a house may sell it to a family needing one (N40 economy).
- **Talkers vs rows:** one estate/heir function for both; talkers who inherit change their persona's job/workplace.
- **Feud spirals:** the inherited weight factor < 1 and settling options keep them from growing forever (bound).

## Tests (`packages/server/tests/n45.test.ts`)

The done-when ones:
- A smith dies with two heirs who dispute the forge.
- One family's grudge against another passes to their children and flares a generation later.
- An affair becomes gossip that ends a marriage.

## Done when (mapped)

| Done-when clause | Proved by |
|---|---|
| a smith dies with two heirs who dispute the forge | step 3 test |
| one family's grudge passes to their children and flares a generation later | step 4 test (LONG; short version always) |
| an affair becomes gossip that ends a marriage | step 5 test |

**Save:** the next save version (`kingdom.policy`); the next schema version (`people.will`, `people.claimed_father`, `disputes`, `feuds`).

## Slice cut

Not in the slice.

## Out of scope

Courts and trials for disputes (N48). The player's own estate and heirs (N66). Royal succession crises and assassination (N46).
