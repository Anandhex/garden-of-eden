[← Plans](README.md) · [Stage 7: N66](../stage-7-the-player-in-the-world.md#n66-the-players-own-life)

# N66 plan: The player's own life

**In one line:** the player lives by the same rules as everyone: they can **rent or buy** a house, land, a shop or a workshop (real buildings on the fixed layouts), **hire** people to run them (wages, theft, loyalty), **run a business** through the economy and pay taxes; **court, marry and have children** by N11's rules with a spouse and children who have their own lives; they **age**; and when they die they **play on as an heir** who inherits by the kingdom's law, with the world's memory of the parent.

**Read first:** [plans README](README.md) sections 2, 13, 14, 15. Needs N32 (interiors and household goods: a home to furnish), N40 (shops, careers, apprentices), N45 (estates and heirs by law). Uses N31 (buildings on reserved lots), N38 (employees choose and may steal), N44 (a nemesis outlasting the player strikes the heir), N47 (theft from the business), N49 (setbacks; real death leads here), N57 (the player's faction), N65 (the journal carries on).

## What exists

- **Property:** none for the player (they sleep at inns: N26's beds, camp).
- **Courtship and family for talkers** ([`family.ts`](../../../packages/server/src/game/family.ts)): `canCourt`, `propose`, `wed`, children (`makeChild`, `childhood`, `adulthood`), the `PLAYER` constant suggests the player can be courted (`config.content.romance` gates romance; check what's possible today).
- **Hiring companions** ([`party.ts`](../../../packages/server/src/game/party.ts)): wages and loyalty for followers.
- **Crafting and selling** for the player ([`crafting.ts`](../../../packages/server/src/game/crafting.ts), trading with NPCs), taxes only for settlements.
- **Ageing:** the player has a `life` like NPCs? (Check `PlayerState`: the player may have tier/XP but no age; NPC `ageOn`/`ageStage` in [`life.ts`](../../../packages/server/src/game/life.ts).)

## Decisions made in this plan

1. **Property is real buildings.** A place's houses and shops have owners (N31's fixed layout indexes; N40's `shop` lots; N45's estates). The **market for property**: empty houses (their household died or moved), shops of masters who retired without heirs, plots of land (N40's `land` lots) are **for sale or rent** by the place's head or the owner's heirs, priced by the place's prosperity and size. The player buys or rents (rent due weekly; missed rent = eviction after a warning). Owning gives an interior (N32) with **household goods** the player places (the stash model from N32 with `owner = player`), a bed (rest and needs: N26), storage, and safety (a locked door: N32's locks; thieves may still try: N47).
2. **Hiring:** the player hires **employees** (townsfolk rows or talkers) for a shop, workshop or farm: wage, role (apprentice, journeyman, shopkeeper, labourer, steward), hours; employees decide by N38 (`take_employment` scored by wage vs their current, the player's reputation, their ambition). Employees have loyalty (N57's model): paid on time and treated well → loyal; unpaid or mistreated → slack, **theft** (N47's theft rule with the stash as target: a greedy, disloyal employee skims), leaving. An apprentice taught by the player (N9 training) grows skill and may later want their own shop (N40).
3. **Running a business:** a **business** record: `{ id, kind: shop | workshop | farm | inn | trading_house, building, owner: "player", employees, stock, prices, ledger }`. It makes goods (crafting by employees at their skill, from inputs bought), sells at the place's market through the existing NPC economy (villagers buy from it like any trader: N10's demand), pays **taxes** to the place's head on tax days (N13's rate), and keeps a ledger the player reads. While the player travels, it runs by day (the employees' daily step); the player gets news of it by letter from the steward (N34) or on return.
4. **Family:** courtship with talkers or townsfolk (a townsperson becomes a talker when courted), by N11's rules (affection, trust, compatibility; `config.content.romance` must be on), marriage (a wedding event; the spouse moves into the player's home), **children** born (talkers by `makeChild`; they grow up by `childhood`/`adulthood` over in-game years), a spouse who has their own life (their job, friends, ambitions: N38/N40 apply), and who may grow unhappy (N45's affairs and separation apply to the player's marriage too).
5. **Age:** the player gets an age (start ~20, chosen at creation), ages with the calendar (`daysPerYear`), reaches elder and venerable stages with stat effects (N25's rules: `ageStage`), and can die of old age (a daily chance in old age, as NPCs) or by violence or illness (N49's real death).
6. **Heirs:** on the player's death, **play on as an heir**: the heir is chosen by the kingdom's inheritance law (N45: the eldest child, or a will the player made in a "Will" panel), among the player's grown children (or, if none, a sibling or spouse: or the game ends with the memorial screen). The heir **inherits** the estate (house, businesses, coin, notable items, the faction's leadership if N57's rules allow), **the family's reputation** (the parent's reputation by place at a share: N67), and **the world's memory**: grudges against the parent pass to the heir at half weight (N45's rule; a nemesis may outlast the parent: N44), friends of the parent are warmer, the parent's deeds are known (gossip continues). The journal (N65) starts a new chapter with the parent's life summarised.
7. **Children as playable:** the heir's stats come from the child's own life (talents inherited, skills trained if apprenticed) — the player who wants a strong heir trains their child.

## Steps

### Step 1: the property market
- For-sale and for-rent houses, shops and lots; buying and renting; eviction; ownership records (`owner` on buildings: a per-place map of building index → owner ref).
- Test (done-when part): the player buys a workshop in the start town (an empty smithy or a workshop lot).

### Step 2: home and goods
- Interior with the player's goods; bed and storage; locks.
- Test: goods placed in the home stay there across days and saves.

### Step 3: employees and the business
- Hiring by N38 decision; the business record; production, selling, taxes, ledger; running while away; the steward's letters.
- Test (done-when part): the player hires an apprentice who runs it while they travel (the ledger shows sales made on days the player was away).

### Step 4: theft and loyalty among employees
- Loyalty, skimming, leaving.
- Test: unpaid employees skim and leave.

### Step 5: courtship, marriage, children
- The player in `family.ts`'s rules; spouses' own lives; children growing.
- Test (done-when part): the player marries and has a child.

### Step 6: age and death
- The player's age and stages; death by old age and other causes; the will panel.
- Test: an old player dies of old age eventually in a long run.

### Step 7: playing on as the heir
- Heir selection by law; inheritance; reputation and memory; the new chapter.
- Test (done-when part): after the player's death, they play on as that child with the workshop and the family's reputation.

### Step 8: admin and docs
- Admin shows the player's property, businesses and family. README: a life in the world.

## Balance bounds

- `business-viable`: a well-run shop in a town turns a profit in an average year; a badly run one fails.
- `player-ageing`: a player character's life is long enough to raise an heir with the default `daysPerYear` (or the year length must change: **Question 1**).

## Edge cases and traps

- **Time scale:** with 12 days a year, raising a child to adulthood (16 years) takes 192 game days, months of real play. **Question 1** asks whether ageing should be optional or the year longer.
- **The player as a household:** many systems assume a household is rows; the player's household (spouse and children as talkers) must be visible to them (gossip venues: home; N45 heirs).
- **Romance config:** marriage and children need `config.content.romance`; when off, heirs come from adoption (an orphan taken in: a row) so the heir path still works.

## Tests (`packages/server/tests/n66.test.ts`)

The done-when one, as a long scenario (LONG=1 for the ageing; a short version with a fast `daysPerYear`): the player buys a workshop in the start town, hires an apprentice who runs it while they travel, marries and has a child, and after the player's death plays on as that child with the workshop and the family's reputation.

## Done when (mapped)

| Done-when clause | Proved by |
|---|---|
| buys a workshop in Millbrook | step 1 test |
| hires an apprentice who runs it while they travel | step 3 test |
| marries and has a child | step 5 test |
| after the player's death plays on as that child with the workshop and the family's reputation | step 7 test |

## Questions for the user

1. With a 12-day year, a child grows up in about 200 game days. Should the player age at all by default, should the year be longer, or should there be a "the years pass" skip (N35) that ages everyone faster?

**Save:** the next save version (property owners, businesses, the player's age, will, family).

## Slice cut

Not in the slice.

## Out of scope

Owning a whole settlement (N64's founding covers rule). Banking and loans to others.
