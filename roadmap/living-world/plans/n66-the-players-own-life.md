[← Plans](README.md) · [Stage 7: N66](../stage-7-the-player-in-the-world.md#n66-the-players-own-life)

# N66 plan: The player's own life

**In one line:** the player lives by the same rules as everyone: they can **rent or buy** a house, land, a shop or a workshop (real buildings on the fixed layouts), **hire** people to run them (wages, theft, loyalty), **run a business** through the economy and pay taxes; **court, marry and have children** by N11's rules with a spouse and children who have their own lives; they **don't age**, and when they die they **come back** (decided 2026-10-23, plans README §5a); their children grow up as people with their own lives.

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
5. **Age (decided 2026-10-23):** the player has **no age** and never dies of it (plans README §5a). When they die they come back (N49 step 6). Their spouse and children age like anyone.
6. **Heirs (dropped 2026-10-23):** there's no handover on death, since the player comes back. The **will** stays: the player can name who gets their property if they choose to give it up, and the kingdom's law (N45) still decides for the player's spouse and children when *they* die.
7. **Children (changed 2026-10-23):** the player's children are not playable; they grow up by their own lives (talents inherited, skills trained if apprenticed to the player), and can become companions, employees, rivals or heirs to the player's business.

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

### Step 6: no age, and the will
- The player has no age (plans README §5a); death is N49 step 6 (coming back). The will panel for property.
- Test: in a long run the player's age never changes while their child grows up.

### Step 7: (dropped 2026-10-23: no heir handover)
- The player comes back from death instead (N49 step 6).

### Step 8: admin and docs
- Admin shows the player's property, businesses and family. README: a life in the world.

## Balance bounds

- `business-viable`: a well-run shop in a town turns a profit in an average year; a badly run one fails.

## Edge cases and traps

- **Time scale:** with a 48-day year (plans README §5), a child takes ~770 game days to grow up; the player sees it through N35's "the years pass" skip.
- **The player as a household:** many systems assume a household is rows; the player's household (spouse and children as talkers) must be visible to them (gossip venues: home; N45 heirs).
- **Romance config:** marriage and children need `config.content.romance`; when off, the player can still take in an orphan (a row) as a ward.

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

1. ~~How fast should the player age?~~ Answered 2026-10-23: the player doesn't age and comes back from death (plans README §5a); a 48-day year, with N35's "the years pass" skip for watching a child grow up.

**Save:** the next save version (property owners, businesses, the player's age, will, family).

## Realism notes (2026-10-23)

From the [realism review](../README.md#realism-gaps-review-2026-10-23); not decided or built yet.

- **Gap 1, one 48-day year (decided 2026-10-23):** the player doesn't age and comes back from death; dates can show year numbers again.

## Slice cut

Not in the slice.

## Out of scope

Owning a whole settlement (N64's founding covers rule). Banking and loans to others.
