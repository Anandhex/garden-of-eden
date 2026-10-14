[← Plans](README.md) · [Stage 5: N57](../stage-5-power-and-conflict.md#n57-player-led-factions)

# N57 plan: Player-led factions

**In one line:** the player can found an N13 faction (a mercenary band, a merchant company, a guild chapter, a rebel group, a liberation group) with themselves as leader; NPCs **choose** to join or refuse by N38 scoring and keep judging the player through a per-member **loyalty** fed by pay, cause, success, treatment and fear; the player gives **orders** that become members' actions; disloyal, ambitious lieutenants can desert, split or **betray** the player (N13's split rule, plus selling them out); other factions and kingdoms treat the player's faction like any other.

**Read first:** [plans README](README.md) sections 2, 13, 14. Needs N38 (the menu: orders become actions with a bonus), N56 (bands, revolts). Uses N40 (lieutenants' ambitions), N42 (taking jobs as a company), N46 (betrayal as selling a secret), N47 (informers), N48 (sedition), N55 (going to war; the player's company as mercenaries), N58 (crackdowns on it), N59 (liberation groups).

## What exists

- **The player joins** factions (N7 [`factions.ts`](../../../packages/server/src/game/factions.ts): `joinFaction`, standing, ranks; N13's guilds: `joinGuild`), never founds or leads.
- **NPC leaders** found, recruit and split factions ([`realm/factions.ts`](../../../packages/server/src/game/realm/factions.ts): `foundFaction`, `join`, `leave`, `split` with `SPLIT_CHANCE`, `RECRUIT_CHANCE`, `MAX_BRANCHES`).
- **Companions** ([`party.ts`](../../../packages/server/src/game/party.ts)): hire, wages, loyalty (`START_LOYALTY`, `LEAVE_LOYALTY`, `PAID_LOYALTY`, `UNPAID_LOYALTY`, `DANGER_LOYALTY`), `payWages`, `leave`, `treatWell`: a model for loyalty to the player, for a handful of followers.

## Decisions made in this plan

1. **Founding** (`foundPlayerFaction(kind, name, creed, seat)`): kinds `company` (mercenary band), `trading_house` (merchant company), `chapter` (of an existing guild: needs the guild's leave), `rebels`, `liberation` (N59). Costs: starting coin by kind, a seat (a room at the inn, a house the player owns: N66, or a hidden camp for rebels), and for some kinds a requirement (renown for a company, a licence for a trading house in kingdoms that need one, N48). The faction is a normal `RealmFaction` with `leader = "player"` (a party ref `p:player`).
2. **Recruiting:** the player asks people (talkers by talk; townsfolk by a recruit action in a venue, N33's venues, or a posting on a board: N42) and they **decide** with an N38 `join_faction` score: pay offered vs their wage, the cause (the creed's match with their grievances and ambition: rebels attract the aggrieved, a company attracts adventurers and veterans, a trading house attracts merchants), loyalty to the player (relationship axes), fear (of the player, or of the crown if the faction is outlawed), the faction's renown and success. Refusals are real (and some report a rebel recruiter: N47's informer path).
3. **Ranks and offices:** the player hands out ranks (`lieutenant`, `quartermaster`, `captain of a branch`, …) and offices; ranks change members' authority and pay; lieutenants can run branches and give orders to members under them.
4. **Orders:** the player gives an order to the faction or a group (raid a target, trade a route, recruit in a place, defend the seat, spread a rumour (N52), take a job (N42), go to war on a side (N55)). An order is a **bonus** to the matching N38 action for members, scaled by loyalty and rank; it does not force them. Low-loyalty members may ignore it (an event) or do it badly. Results are resolved by the action's own code (a raid is a fight with real people; a trade is a caravan journey).
5. **Loyalty per member** (0..100; generalises N8's companion loyalty): rises with pay on time, victories, loot shares, kindness, shared cause, protection; falls with unpaid wages, defeats, cruelty (the player's executions, beatings), broken promises (N4's commitments), danger without reward, and being passed over (an ambitious member not promoted). Morale for the faction as a whole = the mean.
6. **Leaving and betrayal:**
   - **Desertion:** a member under `LEAVE_LOYALTY` leaves (with their gear, maybe some coin).
   - **Split:** an ambitious lieutenant with followers whose loyalty to them exceeds loyalty to the player takes them and founds their own faction (N13's `split`, with the player's faction as parent; a grievance).
   - **Betrayal:** a lieutenant with low loyalty, high ambition and greed, and an opportunity (the crown's bounty on the faction, a rival's offer, unpaid wages), **sells the faction out**: tells the crown (N46: a `loyalty`/`plan` secret exposed; the crown raids the seat), sells the seat's location, or leads a coup (takes over as leader; the player is expelled or killed). Logged with the score parts.
7. **Others treat it as a faction:** treaties (N13), rivalries and stances, crackdowns (N58: an outlawed rebel group is hunted), war (a company hired by a crown under a `service` treaty), taxes for a trading house (N13's tax days), guild politics for a chapter.

## Steps

### Step 1: founding and the seat
- `foundPlayerFaction`, kinds and requirements, the seat; the faction panel (members, ranks, treasury, orders, loyalty).
- Test: the player founds a rebel band in the start town; it's a realm faction with the player as leader.

### Step 2: recruiting
- `join_faction` scoring; asking talkers and townsfolk; postings; refusals; informers.
- Test (done-when part): the player recruits aggrieved serfs who join for their own reasons (the score parts name their grievances), and some refuse.

### Step 3: ranks, offices, loyalty
- Ranks, pay, loyalty rules (from `party.ts`, generalised), morale.
- Test: unpaid wages for two weeks lower every member's loyalty; a victory raises it.

### Step 4: orders
- Orders as action bonuses; ignored orders; results from actions' code.
- Test (done-when part): the player leads a raid on the lord's granary (members join the raid by order; a fight with the granary's guards; the granary's stores taken).

### Step 5: desertion, splits, betrayal
- The three rules; coups.
- Test (done-when part): when wages stop, an ambitious lieutenant later betrays the band to the lord (the lord's men raid the seat; the betrayal's why names unpaid wages, ambition and the lord's bounty).

### Step 6: the faction among others; admin; docs
- Treaties, stances, crackdowns, hire as mercenaries, taxes; admin shows player factions like any; README.

## Balance bounds

- `player-faction-loyalty`: a well-run faction keeps most members a year; a badly run one doesn't.
- `betrayals-need-cause`: no betrayal without low loyalty and an opportunity.

## Edge cases and traps

- **The player is not a figure:** party ref `p:player` must work everywhere factions read their leader (realm code assumes figure ids: grep `leader` uses and handle the player).
- **Orders while the player is away:** lieutenants carry on with standing orders; the player hears of results by news (N33/N34: the faction's members are followed automatically).
- **Size:** a player faction can't exceed a cap by kind (a company of 200 is fine; an army is N55's).

## Tests (`packages/server/tests/n57.test.ts`)

The done-when one, as a scenario: the player founds a rebel band in the start town, recruits aggrieved serfs who join for their own reasons, leads a raid on the lord's granary, and an ambitious lieutenant later betrays the band to the lord when wages stop.

## Done when (mapped)

| Done-when clause | Proved by |
|---|---|
| founds a rebel band in Millbrook | step 1 test |
| recruits aggrieved serfs who join for their own reasons | step 2 test |
| leads a raid on the lord's granary | step 4 test |
| an ambitious lieutenant later betrays the band to the lord when wages stop | step 5 test |

**Save:** the next save version (player factions: leader `p:player`, member loyalty and ranks as a map on the faction).

## Slice cut

Not in the slice.

## Out of scope

Founding a kingdom (N64). Running a business as a person rather than a company (N66).
