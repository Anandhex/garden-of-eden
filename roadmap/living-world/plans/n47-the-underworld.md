[← Plans](README.md) · [Stage 4: N47](../stage-4-society.md#n47-the-underworld)

# N47 plan: The underworld

**In one line:** thieves' guilds become realm factions with dens, ranks and members who are real people; theft, fencing, smuggling and bribery become N38 actions and daily batch rules; black markets sell stolen and banned goods (and papers, and secrets); guards have a **price** set by their traits and pay; crackdowns and purges come from the place's head and the crown; the player can join, inform on, or fight them.

**Read first:** [plans README](README.md) sections 2, 13, 14 (`banned_goods` policy), 15, 17. Needs N38 (actions), N46 (secrets to buy and sell; blackmail). Uses N26 (smuggling routes on the roads, toll gates), N30 (stores and prices make smuggling pay), N43 (stolen notable items are fenced), N48 (arrests and trials; until N48, the existing crime system), N58 (curfews and bans are smuggled around).

## What exists

- **The village underworld** ([`underworld.ts`](../../../packages/server/src/game/underworld.ts)): a **black market** where bandits buy weapons from dishonest villagers (`FENCE_HONESTY`, `BLACK_MARKET_MARKUP`), and **raids** on shops by armed bandits (`considerRaid`, `villageNight`), run at night in code.
- **Theft and stealth** ([`stealth.ts`](../../../packages/server/src/game/stealth.ts)): the player steals and sneaks; **crime** ([`crime.ts`](../../../packages/server/src/game/crime.ts)): crime kinds, fines, bounties, jail hours, `isGuard`, `reportCrimes`, `payFine`, `surrender`.
- **Realm factions:** `FACTION_KINDS` includes `gang`; `GUILD_TRADES` includes `thieves`; gangs have seats and camps (N15 haunts); factions recruit and split (`factionsDay`).
- **Taxes and tolls:** settlement `taxRate`, tax days (`taxDay`); N26 toll gates by kingdom (`road/play.ts`, situations `toll_demanded`, `papers_checked`).
- **Prices:** demand by stock, `priceFactor`; traders sell only their trade.

## Decisions made in this plan

1. **A thieves' guild is a realm faction** of kind `guild`, trade `thieves` (no new kind), with **ranks** (`footpad → cutpurse → fence → master thief → guildmaster`), a **den** in each branch town (a building on the map, N31/N32: a cellar under a tavern), and members who are **people rows or talkers** (`people.faction`). Generated in cities and towns at realm creation by size and prosperity (and corruption: decision 5); new ones are founded by N13's faction rules where crime pays.
2. **Crime at scale is batch rules plus actions.**
   - **Theft:** members choose `steal` (N38) with targets by wealth and guard presence; in non-player places it's a daily batch per den: `thefts = f(members, wealth of the place, guards, crackdown)`, each a `crime` event with a victim row (or a secret if unwitnessed: N46), loot as coin or goods to the den's stash.
   - **Fencing:** stolen goods go to a fence (a member of rank fence) who sells at a markdown to the black market or to a dishonest trader (today's `FENCE_HONESTY` rule), with notable items (N43) passing through with their history (and thus recognisable).
   - **Pickpocketing** uses N41's `sleight` skill.
3. **Black markets** are a den's shop: buys stolen goods, sells stolen goods, **banned goods** (by the kingdom's `banned_goods` policy, section 14: weapons in a slave kingdom for slaves, forbidden reagents, N51's banned grimoires, contraband taxed heavily), **papers** (forged passes and freedom papers: N59, N58's checkpoints), and **secrets** (N46: bought from servants and sold to rivals). Prices by risk (crackdown level) and scarcity. Only people the guild trusts (standing, N7's faction standing) see it.
4. **Smuggling** is a journey kind (`smuggle`) from a guild's den to a place where goods are dear or banned, by roads that avoid toll gates and patrols where possible (route cost includes risk), at night near checkpoints. Patrols and tolls can catch them (a situation for the player; a roll for NPCs: guard vs smuggler, with bribery: decision 5). Profits to the guild; goods arrive in the place's stock.
5. **Corruption: guards have a price.** Every guard (talker or row) has a **bribe threshold** from their honesty, greed, loyalty, pay (the place's treasury and tax rate: a poorly paid guard is cheaper) and the current crackdown. `bribe(guard, amount, what)`: accepted when the amount clears the threshold for that kind of looking away (a theft, smuggled goods, a prisoner's escape); an accepted bribe is a `crime` event that's a secret (N46) between the two; refused bribes are reported (honest guards) or turned into a shake-down (greedy ones). Officials (a magistrate, a tax collector, N48's judges) the same. The place's **corruption** index (share of guards with low thresholds) is shown in the admin and feeds N58's response.
6. **Crackdowns and purges.** A head or crown under pressure (theft count, a famous theft, a merchant guild complaining, N58's repression policy) declares a **crackdown** (`crackdown` policy with `until`): more guards, searches, black-market prices up, bribes dearer, arrests of members (an arrest roll per member by rank and exposure); a **purge** also targets corrupt guards. Arrested members go to N48's trials (or today's jail); the guild may retaliate (N38 actions: intimidate witnesses, burn a merchant's shop) or lie low.
7. **The player:** join (a test job from the guild: steal X, fence Y), rise in its ranks, use its black market, smuggle, bribe; **inform** on it (a crime-reporting action with evidence: the guild's members are arrested; the guild's grievance against the player, a nemesis candidate N44); or **fight** it (jobs from the head or merchants on N42's board: raid the den).

## Data shapes

```ts
// faction: trade "thieves"; branches with a den building; kingdom.policy: banned_goods?: string (list key), crackdown?: { until }
// people: bribe threshold derived, not stored; dens: settlement building kind "den" (hidden: not on the player's map until found)
// Journey kind "smuggle" with cargo
```

## Steps

### Step 1: guilds, dens, ranks, members
- Generation in towns and cities; members assigned from rows (low honesty, poverty, the young); dens as hidden buildings; ranks by standing in the guild.
- Test: a city has a thieves' guild with members who are people rows and a den.

### Step 2: theft and fencing at scale
- The daily batch for non-player places; N38 `steal` and `fence` actions for the player's place; stolen goods to stashes; fences and dishonest traders.
- Test (done-when part): over a month, the city's guild steals and fences (events of theft; goods sold at the black market; a notable stolen item passing through with its history).

### Step 3: black markets
- The den's shop; banned goods by policy; papers; secrets.
- Test: the black market sells a banned good at a premium, only to trusted buyers.

### Step 4: smuggling
- `smuggle` journeys; route choice around tolls; patrols and tolls catching or bribed.
- Test (done-when part): a smuggler slips goods past a curfew (a crackdown/curfew flag on the target place: goods arrive at night; until N58, the crackdown policy from step 6).

### Step 5: corruption
- Bribe thresholds; `bribe` for NPCs and the player; corruption index.
- Test (done-when part): a guard is bribed to look away (a low-paid, greedy guard accepts; an honest one reports).

### Step 6: crackdowns and purges
- Policy decisions by heads and crowns; effects; arrests; retaliation.
- Test (done-when part): a crackdown jails some of the guild (arrest events; members in jail or tried).

### Step 7: the player
- Join, rank, inform, fight; the guild's grudge.
- Test: informing gets members arrested and gives the guild a grievance against the player.

### Step 8: admin and docs
- Admin: guilds, dens, members, corruption by place, crackdowns. README.

## Balance bounds

- `crime-band`: thefts per thousand people per season within a band; no place emptied by theft.
- `guilds-survive-crackdowns`: crackdowns hurt guilds without wiping them out every time.
- `corruption-moves`: purges lower corruption for a while.

## Edge cases and traps

- **Today's `underworld.ts`** (bandits' black market and raids on shops) stays, and becomes part of the gang side; thieves' guilds are town crime. Don't merge them; share the fence rule.
- **Batch thefts must hit real rows:** the victim is a person row (coin taken from their household's wealth: there's no per-row purse yet. Use the place's prosperity and the victim's class for the amount, and record it; a per-household purse is out of scope).
- **Hidden dens** are POIs/buildings not on the player's map until found or told (README section 3).

## Tests (`packages/server/tests/n47.test.ts`)

The done-when ones:
- A city has a thieves' guild that steals and fences.
- A smuggler slips goods past a curfew.
- A guard is bribed to look away.
- A crackdown jails some of the guild.

## Done when (mapped)

| Done-when clause | Proved by |
|---|---|
| a city has a thieves' guild that steals and fences | steps 1–2 tests |
| a smuggler slips goods past a curfew | step 4 test |
| a guard is bribed to look away | step 5 test |
| a crackdown jails some of the guild | step 6 test |

**Save:** the next save version (policies `banned_goods`, `crackdown`; guilds generated at realm creation: a save made before this phase gets its guilds founded on load by the migration).

## Slice cut

Not in the slice.

## Out of scope

Trials (N48). Assassins for hire beyond N46's plots. A purse per household.
