[← Plans](README.md) · [Stage 2: N26I](../stage-2-everyone-lives.md#n26i-fallen-places-lairs-and-strongholds)

# N26I plan: Fallen places, lairs and strongholds

Asked for 2026-10-24: "when a village or town is destroyed by wild animals or bandits, it should be converted into their base or stronghold, where they live and breed; bandits can also farm and make money, attack other villages and kidnap people to increase their population, and people can get quests to attack the place, and so on."

**In one line:** a place that is overrun doesn't just empty: it **falls** to whoever broke it. A pack makes the ruins its **lair** and grows there, and a gang makes it its **stronghold**: they live in the houses, farm the fields with captives, keep stolen herds, toll the road, sell what they take, raid their neighbours and carry people off. Everyone around reacts, with tribute, refugees, bounties and quests to scout it, rescue the captives, kill the chief or retake it. A place that is won back can be **resettled** by the people who fled it.

**Read first:** [plans README](README.md) **Part 3 (sections 21–29), which every playtest phase follows**, and sections 2, 13 (the action menu), 15, 16, 17. Needs N25 (people rows, migration), N26 Part E (journeys of real people), [N26F](n26f-a-road-worth-walking.md) (pack beasts as rows, territories, the tracking rule), [N26G](n26g-fields-outside-the-village.md) (plots that can be farmed by anyone), [N26H](n26h-districts-access-and-buildings-to-scale.md) (districts and buildings, which become ruins or a stronghold's quarters). Hooks for N47 (the underworld: fences and buyers), N55 (soldiers sent to retake it), N59 (captives running away), N64 (a stronghold that becomes a lordship).

**The rule** (from [N26F](n26f-a-road-worth-walking.md#the-rule-every-person-is-tracked)): every bandit, captive, refugee, ransomed noble, soldier and settler is a real row or figure; every wolf in the lair is a beast row. A place's population is the rows that live there.

## What exists

- **Attacks:** a pack at 80% of its cap attacks the place it lives by now and then (`attackFrom` in [`realm/wilds.ts`](../../../packages/server/src/game/realm/wilds.ts)): a fight, deaths among the defenders, `food − 8` and `lastRaided` if it wins. Gangs raid through `arrivals.ts` (raids on the player's place) and fight on the road. A win never takes the place.
- **Emptying:** a place under 8 people is `abandoned` (`growOrEmpty` in [`realm/economy.ts`](../../../packages/server/src/game/realm/economy.ts)); its people migrate to the richest neighbour, and it stays empty forever. Roads, trips and bounds skip abandoned places.
- **Gangs** are factions of kind `gang` with a `seat` (a settlement they work out of), members as figures, a leader, strength (`gangSide`).
- **Slavery** exists by law per kingdom (classes slave and serf, N16). **Nobody is ever captured.**
- **Quests** from N38's quest kinds (defeat, deliver, etc.) and bounties on packs.

## Decisions made in this plan

1. **How a place falls.** A place falls when an attacker wins and the defenders are broken: no able fighters left standing, or the people who are left flee. Each attack that wins kills and hurts real defenders and drives some households away (migration as refugees, real journeys). A place that keeps losing shrinks until the next win breaks it. One big attack can break a small place at once (a hamlet against a large gang). What happens at the fall:
   - the dead are deaths on their rows (N25's typed death records, cause `beasts` or `raid`);
   - survivors who can flee go to kin or the nearest safe place, as refugees on journeys, and **remember where they came from** (`people.from` with the fallen place and day);
   - bandits take **captives** (decision 5); beasts take none;
   - the place gets `fallen: { to: "pack" | "gang", id, day, how }` and becomes a **lair** or a **stronghold**. It's not `abandoned`: it's held.
   Walled places, a garrison and neighbours who come to help (a patrol on the road, a lord's men) make falling much harder.
2. **A lair: beasts move in.** The pack's den moves into the ruins (the burned hall, the empty barns). In a lair:
   - the pack's cap rises (shelter and prey: livestock left behind turns feral, and the fields going wild draw deer, so there's more to eat);
   - it breeds better, and its territory (N26F) centres on the place and reaches the roads out of it;
   - the fields go back to scrub plot by plot (N26G: no one weeds, crops seed themselves, then brambles), and the buildings decay day by day (roofs fall, then walls);
   - from the lair the pack hunts the herds and fields of the next places along, so a lair spreads danger. A big pack can split and send a new pack to take another weak place.
3. **A stronghold: bandits move in.** The gang's seat moves to the place. Its members live in the houses as residents (rows of the place now), the chief takes the best house or the hall, and they make it defensible: a palisade, a gate and a watch post (N26H's posts, manned by named gang members).
4. **Bandits make a living.** A stronghold has its own stores (food, coin, goods, livestock) and earns them:
   - **farming:** they keep working the fields (N26G), with captives and their own people, so the fields don't go wild (but with fewer hands, less is grown);
   - **herds:** stolen livestock kept in the pinfold;
   - **tolls and robbery:** on the roads through their territory (N26F), now from home;
   - **tribute:** neighbours who are weaker are told to pay each season or be raided. Paying is the place's choice (its head decides by strength, coin and temper). A place that pays is left alone, and resents it (a grievance, N37);
   - **selling:** stolen goods go to a crooked merchant in a nearby town (a real row with a `fence` trait; N47 later makes this the underworld), captives are ransomed (nobles, merchants' children) or, where the law allows slavery, sold to slavers;
   - the gang's coin and food decide what it can do next: hungry gangs raid more, rich gangs recruit.
5. **Captives.** In a raid or when a place falls, bandits carry people off: the young, the strong, craftsmen and anyone worth a ransom. A captive is a row with `captive: { by, since, worth, use }` living at the stronghold:
   - **labour:** fields, cooking, mending, digging the palisade;
   - **ransom:** a letter goes to their kin or master (a real courier journey); paid, they walk home;
   - **sold:** where slavery is legal, to a slaver, and they become slaves in another place;
   - **turned:** over time, by fear, need or a bond, some join the gang (a captive with low loyalty to home, a grievance against their old lord, or a friend in the gang). Children taken young grow up in it;
   - **escaping:** a captive may run (stealth and courage against the watch; N59 builds out runaways). An escaped captive brings news of the stronghold home, which is how places learn where people are kept.
6. **The gang grows.** By captives who turn; by recruits (desperate rows nearby: hungry, outlawed, debtors, runaways, people with grievances against their lord, who leave home and walk to the stronghold); and by families, since gang members marry and have children by N25's ordinary rules. Its strength is its members, and every one of them is someone.
7. **Raids from a base.** Once a week (a `perDay` rule), a stronghold decides whether to raid, by its hunger and coin, the targets in reach (wealth against defences), tribute refused, and old grudges. A raid is a real journey of named members to the target. The fight is the place's guards, the patrol if one is there, and the player if they're there (on the map, as N26F's hostiles). The raiders bring back food, coin, livestock and captives, or come back short of men. Raids, captives and deaths are news and gossip.
8. **The world answers.** Places near a lair or stronghold:
   - **post quests** through N38's quest kinds: scout the place, rescue a named captive, recover stolen herds, kill the chief or the alpha, clear the lair, burn the palisade; with bounties paid from their treasury, the lord's, or by a captive's kin;
   - **ask their lord** for help: a lord with soldiers sends them when the threat is big enough (real guard and soldier rows on a journey; N55 makes this an army);
   - **pay or fight:** pay the tribute, build walls, hire sellswords (N26F decision 13);
   - **empty out:** people leave a place that keeps being raided, which can make it the next to fall.
   Hunters and adventurers (real figures) may go on their own for the bounty.
9. **Taking it back.** A lair is cleared when its pack is killed or driven off (fewer than two beasts left). A stronghold is broken when its chief is dead and most members are dead, captured or scattered (scattered ones become outlaws on the road or join another gang). Then:
   - captives are freed and walk home (or stay, if they have nowhere to go);
   - the place is **held by no one**: it's ruins. Survivors who fled and remember it (`people.from`) may **come back to resettle** if their new home is poor, they have kin there, or the lord offers land. The first households to return make it a hamlet again, with its old name, its burned buildings and its graves;
   - if nobody comes back for a year, it stays a ruin (N27's ruins, with the graves of its last people).
10. **What the player can do there.** Everything in N26H's access rules: walk up and be turned away at the palisade, sneak in at night, bribe a watchman, be taken captive and escape, buy a captive's freedom, bring a ransom, join the gang (a hook for N47; for now, the gang may take on a player who is an outlaw or who asks the chief), or come with a lord's men to take it. A lair is simpler: it's a place full of wolves, and a cave or a burned hall is the den.

## Data shapes

```ts
// realm: Settlement gains
fallen?: { to: "pack" | "gang"; id: string; day: number; how: string };
stores?: { food: number; coin: number; goods: Record<string, number>; livestock: Record<string, number> };   // strongholds
tribute?: Record<string /* place id */, { amount: number; every: number; last: number; refused?: number }>;

// people rows gain
captive?: { by: string /* faction id */; since: number; worth: number; use: "labour" | "ransom" | "sale" | "turning"; ransom?: { asked: number; of: string; sent: number } };
from?: { site: string; day: number; why: "fled" | "freed" | "moved" };
```

Ruins and decay go through N31's marks when built (until then, a `decay` number per building from the day it fell). A lair's buildings and fields read `fallen.day`.

Save: a new save version (new settlement and people fields; old saves are disposable, so a clean break is fine).

## Steps

### Step 1: falling
- `game/realm/fall.ts`: after a winning attack (packs in `attackFrom`, gangs in a new `raidFrom`), check whether the defenders are broken (decision 1); refugees as journeys with `people.from`; `fallen`. `growOrEmpty` keeps abandoning a place that empties slowly with nobody to blame; one that's broken by an attacker falls instead.
- Every rule that skips `abandoned` places now also decides what it does with fallen ones: trips don't go there (except raids and quests), patrols and couriers avoid it, migration never chooses it.
- Tests: a pack that wins against a hamlet with its fighters dead takes it; a walled town with a garrison doesn't fall to the same pack; the refugees are real rows on journeys and remember where they came from.

### Step 2: lairs
- The den moves; cap and breeding up; the territory recentred; fields to scrub (N26G); buildings decay; hunting the neighbours' herds; a split pack can take another weak place.
- Tests: a pack in a lair grows past its old cap within a year; the next place along loses more livestock; after a year the fields are scrub and roofs are gone.

### Step 3: strongholds
- The seat moves; members live there as residents; the palisade and the watch post (N26H posts with named members); stores; farming with captives and members (N26G); herds; tolls from the territory.
- Tests: after a gang takes a village, its chief lives in the hall, its members in the houses, a named member is on the gate at night, and its fields are still sown.

### Step 4: captives
- Taking captives in raids and at a fall (decision 5); their uses; ransom letters by courier; sale where slavery is legal; turning; escape.
- Tests: a raid on a village brings back named captives; a merchant's daughter is ransomed and walks home when her father pays; in a kingdom without slavery no captive is sold; a captive with a grievance against their lord joins the gang within a season (seeded); an escaped captive carries the stronghold's news home.

### Step 5: a living gang
- Recruits walk in; families by N25's rules; the weekly raid decision; tribute demands, payments and refusals; selling through a fence; hunger and wealth deciding what's next.
- Tests: a hungry stronghold raids within the week; a place that refuses tribute is raided; a rich gang grows by recruits; the gang's strength equals its members.

### Step 6: the world answers
- Quests (scout, rescue a named captive, recover herds, kill the chief or alpha, clear, burn the palisade) with real bounties; asking the lord, who may send real soldiers; tribute, walls, sellswords; emptying under raids; bounty hunters going on their own.
- Tests: a place within a day's walk of a stronghold posts a quest to rescue one of its captives by name; the lord sends soldiers when the gang passes a strength; the soldiers' fight is real deaths on both sides.

### Step 7: taking it back and resettling
- Clearing a lair, breaking a stronghold, freeing captives, scattered bandits as outlaws, the place held by no one; resettlement by those who remember it; a ruin after a year with nobody.
- Tests: after the player kills the chief and the soldiers rout the rest, the captives go home; within a season some families who fled come back and it's a hamlet again with its old name; a lair cleared and never resettled is a ruin with graves.

### Step 8: the player, the browser, the admin view, tune and document
- On the map: palisades, the pen, wolves in burned houses, scrub fields, ruins. N26H access for the stronghold. The player's actions (decision 10).
- Admin: fallen places on the realm map, each with who holds it, since when, its stores, captives and tribute.
- Bounds: `fallen-band` (no more than a tenth of places fallen at once over a long sim), `fallen-turn-over` (over 5 sim years some fallen places are retaken and resettled), `captives-accounted` (every captive is alive somewhere, has a captor that exists, or has been freed, sold, turned or has died on record).
- README and stage file.

## Edge cases and traps

- **Fallen places and the player's start town:** the start town can fall too. That's a real story; the player isn't moved. They walk into a stronghold or a lair, or come back later.
- **Capitals and seats of power** fall only to an army (N55), never to a pack, and a gang needs to be very large. Keep that in the fall rule rather than special cases elsewhere.
- **Cascades:** a lair next to a weak place makes that place weaker, which can fall, which grows the pack. `fallen-band` catches runaway cascades; the answers in decision 8 (lords, bounties, hunters) are what stop them in play, so tune those, not a hard cap.
- **People in two places:** a captive lives at the stronghold, not at home. Their old home's household knows they're missing (a worry for N25b and a quest). Freed, they go back to that household if it still exists.
- **Roads to fallen places** stay on the map. Their stretches become the pack's or gang's territory.

## Tests (`packages/server/tests/n26i.test.ts`)

As listed in each step, plus a long fixed-seed sim: a hamlet falls to a gang, its people are refugees by name, the gang farms with captives and raids the next village, a quest rescues a captive, soldiers break the stronghold, and the hamlet is resettled by families who fled it.

## Done when (mapped)

| Done-when clause | Proved by |
|---|---|
| a village overrun by wolves becomes their lair, where the pack grows and hunts the next village's herds | lair tests |
| a village overrun by bandits becomes their stronghold: they live in its houses, farm its fields with captives, keep stolen herds and demand tribute | stronghold and captives tests |
| the gang raids its neighbours and carries off named people, who can be ransomed, sold where slavery is legal, turned or rescued | captives tests |
| nearby places post quests and ask their lord, and a stronghold that is broken is resettled by the people who fled it | answers and resettling tests |

## Slice cut

A hamlet near the start town that falls to a gang: the stronghold, captives, one raid, a rescue quest, retaking and resettling. Lairs and tribute wait.

## Out of scope

Armies and sieges (N55), the underworld beyond a single fence (N47), runaways as a movement (N59), a stronghold that becomes a lordship or kingdom (N64), trials for captured bandits (N48).
