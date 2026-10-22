[← Plans](README.md) · [Stage 3: N69](../stage-3-npcs-choose.md#n69-offices-treasuries-and-renown)

# N69 plan: Offices, treasuries and renown

Asked for 2026-10-22: "for running the guild, village, city each needs a treasury and people to manage everything", "there can't be a guild with one member; they need to recruit to grow, and being part of a guild increases renown", "people who follow a village head, king or faction head give them renown", "negative and positive renown: a failed conquest affects the NPC negatively and the guild head's reputation is damaged". Revised 2026-10-23: "make renown itself go from -100 to 100" and "the person gets titles like good leader or bad leader and becomes a named NPC too".

**In one line:** every settlement and every faction is **run by people in offices** (a treasurer, a captain, a recruiter, a clerk...) who are paid from a **treasury with a ledger**, and how well they do the job moves the coffers; a guild is **chartered** only once enough members have pledged, must **recruit** to stay above a minimum, and lends its **prestige** to its members; **renown** becomes signed, **-100..100** (famed above zero, infamous below), and part of a leader's renown comes **from the people who follow them**, for good or ill; every venture (raid, war, conquest, takeover, delve) has a **success and a failure** side, and a failed one costs the leader renown (down past zero if it keeps happening), their followers' loyalty, and may split the faction; leaders earn **epithets** by how they lead (the Good, the Just, the Cruel, the Coward, Oathbreaker), and a townsperson whose name grows, for good or ill, **rises to a named NPC**.

**Read first:** [plans README](README.md) sections 2, 3, 4, 13 (the action menu), 15 (tables), 16 (save), 17 (grains). Needs N37 (relationships and grievances: how followers feel about a leader), N38 (the `recruit` action and the menu). Fits with N40: N40's scarce seats (`seats.ts`) are the offices this phase defines; build N69 right after N40, or build N69 step 1 as N40 step 3's list of seats. Later phases build on it: N47 (corrupt officers), N48 (trials for embezzlement), N55 (captains and marshals), N56 (support turning to grievance), N57 (the player's own offices and treasury), N58 (a crown's council).

## What exists

- **Treasuries, but nobody runs them.** `Settlement.treasury` (copper) moves in `economyDay` (`income` − `upkeep`, food bought when short), in `taxDay` (`taxRate` of the treasury to the liege, `arrears`, `collect`), raids (loot) and building projects (`build`, `buildCost`). [`realm/economy.ts`](../../../packages/server/src/game/realm/economy.ts), [`realm/politics.ts`](../../../packages/server/src/game/realm/politics.ts). No ledger: you can't see where the coin went. No wages: the head, the guards and the captain are not paid.
- **One office per place.** `Settlement.leader` (elder, village head, mayor, lord, ruler) chosen by `successionDay`/`install` by `standing` (renown + rank). Captains exist as a `Role` and `fightersOf` counts them, but nobody holds a "captain of Ashby" post. `refreshHierarchy` sets `superior`.
- **Factions with one coffer and no officers.** `RealmFaction.wealth`, `members` (figure ids only), `leader`, `rankIn` (leader / top 30% / the rest, by `standing`). `factionsDay`: income `members × 4 + branches × 8`, `RECRUIT_CHANCE` 0.2 a day of one random suitable figure, a hall when wealth > 1500, `succeed`, `maybeSplit`, dissolved at zero members. [`realm/factions.ts`](../../../packages/server/src/game/realm/factions.ts).
- **A guild of one is normal today.** `foundFaction` makes a faction with `members: [founder]`; nothing stops it staying that way for ever. The director founds factions (`realm/director.ts`) and `split` makes new ones.
- **Two kinds of member that don't meet.** Figures are in `fac.members`; townsfolk rows have `people.faction` and join through N38's `recruit` intent (`choice/day.ts`, `choice/talker.ts`: `store.people.update(b.id, { faction })`). `factionsDay` never counts the rows, so a guild with twenty townsfolk members and one figure looks like a guild of one.
- **Renown is one number, never below 0.** `Figure.renown` 0..100, `addRenown` clamps at 0 and 100. Raised by deeds (founding +8, leading +5, a rise +6, clearing a dungeon, winning a fight +3, a free city's new lord +15); lowered only by `breakTreaty` (−10). `standing(f) = renown + tier × 8` drives succession, `rankIn`, splits. Townsfolk rows have no renown (a riser starts at 12, `people/rising.ts`).
- **Titles exist, for deeds and rank only.** [`titles.ts`](../../../packages/server/src/game/titles.ts) `TITLES` (Giant-slayer, Veteran, the Renowned, the Hero...) are awarded in code, held in `life.titles`, heard in a talker's situation line; `titled(f)` (`realm/figures.ts`) names a figure with their office. Nothing names how someone leads.
- **Rising exists, at coming of age only.** `riseDay` (`people/rising.ts`) makes a row a figure at adulthood (promise and a notable house, or 1% luck); `readyToTalk` (`realm/rise.ts`) makes a figure a talker at `renown ≥ TALKER_RENOWN` (30). A townsperson who becomes a famous reeve, or a hated one, never rises.
- **Failure costs nothing.** A lost raid: the raiders limp home and bury their dead. A lost war: rebels are `dissolved`, a kingdom pays tribute; the leader who started it loses nothing. A failed delve: the figure may die, nothing else.
- **N37's feelings are there to read:** `relationships(a, b, trust, affection, respect, fear)` and `grievances(who, against, weight)` (`chatter/rel.ts`, `chatter/grievance.ts`, `weightOn`). Nothing reads them for a leader's standing yet.

## Decisions made in this plan

1. **Offices are data.** `game/office/posts.ts`: for each settlement kind and each faction kind, the posts it has, what each post does and its wage (copper per tax day, scaled by `KIND_SCALE`):

   | Institution | Posts (the head is always there) |
   |---|---|
   | hamlet | elder |
   | village | village head, **reeve** (treasury and tax), **constable** (the watch) |
   | town | mayor, **treasurer**, **captain of the watch**, **magistrate** (N48 uses it), **clerk** |
   | city | lord, treasurer, captain, magistrate, **steward** (projects and stores), **marshal** (the levy) |
   | capital | ruler, **chancellor** (the council's head), treasurer, marshal, steward, magistrate, **spymaster** (reserved, idle until N46) |
   | guild, association | guildmaster, **treasurer** (dues and the coffer), **warden** (recruits and examines), masters (up to 1 per 4 members) |
   | order, cult | grand master / high priest, treasurer, **marshal** / **preacher** (recruits) |
   | gang, rebels | chief / leader, **lieutenant** (recruits, leads raids), **quartermaster** (the coffer) |
   | crown | the ruler; its council is the capital's posts |

   A post is one row in a new `offices` table: `(inst, post, holder, since, wage, unpaid)`, `inst` = `s:<settlement>` or `f:<faction>`, `holder` = a figure id or a `people` id (townsfolk hold most village posts). One person holds at most one post besides membership.

2. **Who gets a post.** When a post is empty (new institution, death, dismissal, resignation), **the head appoints** in code: candidates are residents (or members) of age and the class the kingdom allows (`laws`), scored by the post's skill (treasurer: greed low and a merchant or clerk's job; captain: a fighter, bravery; warden: sociable, renown), the head's feeling for them (N37 `respect + trust`, kin +), and their standing. Stream `streamFor(seed, "office", inst, day)`. When N40 is built its seat rule replaces this pick (candidates with the `office`/`guild_seat` ambition, losers get a grievance); until then the losers get nothing. A head with no candidates leaves it empty (a hamlet has only its elder).

3. **The treasury has a ledger.** A new `ledger` table: `(inst, day, line, amount)`, written by every movement of coin that today changes `treasury` or `wealth`: `taxes_in`, `tax_out`, `trade`, `upkeep`, `wages`, `build`, `food`, `loot`, `ransom`, `dues`, `bounty`, `tribute`, `stolen`. Lines are summed per tax day (one row per line per tax day per institution, not one per coin), and kept for two years (24 tax periods × ~13 lines, then pruned). The coin moves through one function, `pay(realm, inst, line, amount, day)`, so no code changes `treasury`/`wealth` directly any more (a grep test keeps it so).

4. **Officers change the numbers.** Each post has one effect, applied in the existing rules, never a new economy:
   - **treasurer / reeve / quartermaster:** income × (0.9 + 0.2 × skill); `stolen` = a share by their greed and honesty (0 for an honest one, up to 5% of income), hidden: the ledger line exists in truth, the public books show it as `upkeep` (section 3: truth and knowledge). An **audit** (the head's chance per tax day by their caution, or the magistrate's) finds it: the thief is dismissed, loses renown 20 (decision 7), pays back what they have, and gets a grievance from the head; news.
   - **captain / constable / marshal:** adds to `settlementSide` strength (a skilled captain +15%) and lowers raid success against the place.
   - **steward / clerk:** `build` costs −10%; food bought cheaper.
   - **warden / preacher / lieutenant:** the faction's recruiting (decision 5).
   - **An empty post** costs its bonus and the head does it badly (−5% on the matching number).
   - **Wages** are paid first on tax day. Unpaid officers count `unpaid`; at 2 they lose loyalty, at 3 they quit (news) and may carry a grievance. A place that can't pay its officers loses them, then its prosperity drifts down (its target reads "unrun": −5).

5. **Guilds need people: charters, a minimum, recruiting.**
   - **A charter first.** `foundFaction` for a guild, association, order or cult no longer makes a working faction: it makes one with `charter: { until: day + CHARTER_DAYS (12, a year), need: MIN_MEMBERS (3, plus 1 per settlement size above village) }`. While chartering it has no income and no halls; its founder and warden recruit at double rate. When `need` is met it is **chartered** (news, founder +renown) and its posts are filled. When `until` passes first, it **fails**: the members go back to none, the founder loses renown 6 ("could not find three smiths to stand with them"), the coin goes back to the founder. Gangs and rebels skip the charter (a band of two is a band), but have the same minimum for raids (decision 8).
   - **A minimum to stay.** An active guild below `MIN_MEMBERS` for a whole season (3 days) **folds**: it merges into the strongest guild of the same trade within two roads if one exists (members join, branches pass, the old leader becomes a master), or dissolves. News either way. The dissolve-at-zero rule stays.
   - **Members are figures and rows.** `memberCount(realm, fac, store)` = alive figures in `members` + alive `people` rows with `faction = fac.id`. Income, the minimum, ranks and prestige read this. Rows in a lazy place are counted from the store (a cheap `COUNT` by faction, indexed: one migration adds `people_faction` index).
   - **Recruiting is a drive, not a lottery.** `RECRUIT_CHANCE` goes; each tax day a faction makes `recruitDrive(realm, fac, day, rng)`: tries = 1 + the warden's skill (+1 while chartering, +1 if rich), each picks the best-suited figure or row near a branch, who **chooses** by score: the faction's prestige, pay (dues against wage), their trade, their feelings for the leader, their loyalty to their current faction (they may leave one for a better one). Refusals are fine. In the player's place N38's `recruit` action stays the way it happens (it already sets `people.faction`); it gains score from the faction's need (`charter` or below the minimum: +0.3).
   - **Dues:** members pay dues per tax day (a share of their income by trade, into the ledger as `dues`); in return the guild pays a sick or ruined member, buys a member out of debt, and its prestige lifts them (decision 6). A member who can't pay for two periods is put out.

6. **Prestige: belonging raises your name.** A faction gets `prestige` 0..100, recomputed each tax day from its size (log-scaled), halls, wealth, its leader's renown (signed: an infamous guildmaster drags it down), and its recent deeds (charters, raids won, dungeons cleared by members, lost wars). Joining gives a member `+prestige/10` renown once; each year in a faction of prestige ≥ 40 gives +1; rising to an office gives the post's renown (treasurer +3, guildmaster +5). Leaving a prestigious guild in disgrace (put out, dismissed) costs renown 5. Belonging to a gang or a band that raids the weak is the other way round: each raid it wins on the weak costs its members 1 (they are known as cutthroats). Townsfolk rows get a coarse `renown` column (-100..100, default 0) so this reaches them too; a row's fame (`|renown|`) counts toward `rising.ts`'s pick of who becomes a figure.

7. **Renown is signed: -100..100** (user decision, 2026-10-23: one number, not a second "honour" score). Above zero a person is *famed* (well spoken of), below zero *infamous* (spoken of with fear or scorn), near zero unknown. There is no separate measure of how widely known someone is; where code needs one it uses **fame** = `|renown|` (a hated tyrant and a beloved king are both known by everyone).
   - `Figure.renown`'s schema goes to `min(-100).max(100)`; `addRenown(f, n)` clamps to -100..100 and gains a `why` and `day` so it records the deed and writes the event (`causedBy`, N20 when built). It stays the one way renown changes. Existing values (all ≥ 0) carry over as they are.
   - **Which readers use the sign and which use fame.** Every current reader of `renown` is put in one of two groups (step 5 lists them all):
     - **sign** (approval): `standing` for crowns, guilds, orders, associations and settlement succession (`renown + tier × 8`, so an infamous figure is passed over for a guild seat or a village headship); a faction's prestige; who wants to join under a leader; N37 `credenceOf` and trust in trade (someone of ill name is believed less); talkers' persona line ("people curse your name in Ashby").
     - **fame** (`|renown|`): `standing` for gangs and rebels (`fame + tier × 8`: among cutthroats a feared name counts, so a chief at −60 still leads); `TALKER_RENOWN` and `rising.ts` (a notorious bandit becomes a talker just as a famed hero does); news importance; a follower's weight in support (decision 9); heirs' sort when only fame matters (gangs).
   - **What lowers renown, past zero if it keeps happening:** breaking a treaty (−10, as now, now able to go negative), not paying officers or tribute (−2 a period), embezzlement found (−20), sacking a place that surrendered (−8), a raid of greed on the weak (−4 even when won), a charter that failed (−6), failed ventures (decision 8), and support from resentful followers (decision 9). **What raises it:** today's deeds (founding, leading, clearing dungeons, winning fights), defending one's place (+), mercy to the beaten (+3), paying debts and wages, and support from content followers.
   - **Old glory and old shame fade:** each year renown above +20 or below −20 moves 1 toward zero.

8. **Every venture can fail, and failure has a price.** One module, `game/office/ventures.ts`: a **venture** is a raid, a war, a siege, a **conquest** (taking a settlement: N13's rebels winning, a lord seizing a neighbour, N55's campaigns later), a guild **takeover** (one guild absorbing another by force or by buying its masters), a delve or hunt led by a named figure, or a bid for office. `ventureOutcome(realm, v, won, day)` is called by `raid`, `endWar`, the takeover rule and the delve rule at the end, and applies by the venture's size:

   | | Won | Failed |
   |---|---|---|
   | the leader who called it | renown +(3..15) if the cause was just (defence, a grievance, a broken treaty); a smaller gain, or a loss, if it was greed against the weak (+win, −4 for the cruelty) | renown −(5..20); bigger if they lost their own people or their seat; this is what takes a leader below zero |
   | followers who went | renown + (small), loyalty to the leader + | loyalty to the leader −, relationship `respect` −; the families of their dead get a grievance against the leader (N37 `addGrievance`, cause = the venture) |
   | the faction | prestige +, wealth (loot) | prestige −, and for the next season `maybeSplit`'s loyalty bar is 0.1 lower (an ambitious lieutenant is likelier to break away after a defeat) |
   | the guild head, when the venture was the guild's (a takeover, a contracted delve, a gang raid) | as the leader | as the leader, plus the guild's members' dues fall for a season (people pay less to a failing guild) |

   A **failed conquest** is the request's case: the lord or faction head who led it loses the most (renown −15..20), their captain or lieutenant loses half that, the guild head loses the same when it was the guild's conquest, the dead's families bear grievances, and if the leader's renown falls below −30 or the faction's prestige halves, their lieutenant's split check runs at once. A leader who loses three ventures in two years is **challenged** (decision 9).

9. **Support: followers make (and unmake) a leader.** A leader's renown has two parts: `renown` (deeds, kept on the figure, fading toward zero as in decision 7) and `support` (recomputed each tax day, −20..+20). `support(leader)` = the sum over their followers (residents for a head of place, members for a faction head, vassal heads for a lord or ruler) of each follower's **regard**: for figures, `loyalty` and their N37 relationship to the leader (`respect + trust − fear/2`), for rows (sampled: 50 at most a place, scaled up), the same relationship row if there is one, else a neutral 0, minus their grievances' weight against the leader (`weightOn`). Each follower counts by their own fame, `1 + |renown| / 20` (a well-known captain's backing or contempt is worth more than a farmer's). Scaled to −20..+20.
   - **Effective renown** for standing, news and persona is `clamp(renown + support, -100, 100)`: a leader with modest deeds and a loyal people is famed; one with great deeds and a people who hate them can sink below zero. Support is not added into the stored `renown`; a season of it at ±10 or more moves the stored `renown` 1 a period the same way (a name their people speak well or ill of sticks).
   - Followers get some back: a follower of a leader whose effective renown is ≥ +10 gains +1 renown a year (the king's men are known as the king's men); under a leader at ≤ −10 they lose 1 a year (the tyrant's men share his name).
   - **Losing support has consequences:** support ≤ −10 for a season → the strongest rival among the followers may **challenge** (a faction: N13's `split`, or a vote that replaces the leader; a settlement: a rival founds rebels, today's `successionDay` rule, or the liege removes the head; a guild: the masters vote the guildmaster out, the best-standing master takes over). N56 later turns the same grievances into uprisings.
   - **Kings get theirs from vassals.** A ruler's followers are the heads of every settlement in the kingdom, weighted by kind; a lord's are the heads of their vassal places. So a king whose village heads resent the war tax loses support.

10. **Names earned by how one leads, and rising by them** (asked for 2026-10-23: "the person gets titles like good leader or bad leader and becomes a named NPC too").
    - **Epithets are titles.** New entries in [`titles.ts`](../../../packages/server/src/game/titles.ts)'s `TITLES` table, kind `"repute"`, held in the same `life.titles` list figures already carry, heard by a talker in their situation line like every title. They are awarded in code only, from facts (never the model), checked each tax day by `epithetsDay` in `office/epithets.ts`:

      | Title | Earned when (all over the last 2 years unless said) |
      |---|---|
      | **the Good** | a head or faction leader with effective renown ≥ +40 and support ≥ +10 for a year |
      | **the Just** | a head or magistrate who found and punished embezzlement, and whose people's grievances against them are under the place's median |
      | **the Generous** | paid every officer and wage while the treasury was low, or fed the place from their own wealth in a famine |
      | **the Bold** / **Conqueror** | won two ventures they called / took a settlement |
      | **the Builder** | three building projects finished under them |
      | **the Bad** | a leader with effective renown ≤ −40 and support ≤ −10 for a year |
      | **the Cruel** | sacked a place that surrendered, or raided the weak three times |
      | **the Coward** | lost two ventures they called and fled or left their people to die (their own side lost more than half) |
      | **the Greedy** / **the Thief** | taxed above 0.4 for a year while prosperity fell / caught embezzling |
      | **Oathbreaker** | broke two treaties |
      | **the Unready** | lost three ventures in two years (the same rule that brings a challenge) |

      A leader can hold a good and a bad epithet at once (a Bold but Cruel lord). They are lost when the fact stops holding for a year (the Good who turns tyrant stops being the Good) except the deed ones (Conqueror, Oathbreaker, the Thief), which are kept for life, as deeds are. Each award is news ("They call her Hild the Just in Ashby now") and adds renown once (+5 for a good name, −5 for a bad one), and `titled(f)` puts the newest one after the name ("Odo the Cruel, lord of Brack").
    - **Townsfolk earn them too.** A row holding an office (reeve, constable, a guild's treasurer) gets the office-fitting ones (the Just, the Generous, the Thief) on its row as a short `epithet` column; holding a title is the second way a row rises (below).
    - **Rising by renown, good or bad.** Today a row becomes a figure only at coming of age (`riseDay`: promise and a notable house, or 1% luck), and a figure becomes a talker at `renown ≥ TALKER_RENOWN` (`readyToTalk`). This phase adds:
      - **A row becomes a figure** (`people/rising.ts`, a new `riseByRepute` in the daily step) when its fame (`|renown|`) reaches 25, when it earns an epithet, or when it is appointed to a post above a village's (a town's treasurer is someone the realm knows of). The figure keeps the row's renown, office and epithet, and the links (`people.figure`, `figure.person`) as risers have now.
      - **A figure becomes a talker** when its **fame** reaches `TALKER_RENOWN` (so the infamous talk too: a reeve known as the Thief is someone the player can confront), or when it holds an epithet and lives in the player's place.
      - Both are bounded by N19's talker budget: when the place is at its cap, the most famous waits; nobody is promoted only to be demoted.

11. **Lazy places and grains** (section 17): offices, ledgers, charters, recruiting drives, prestige, support and ventures are tax-day and daily realm rules. They read realm state, `people` rows by index and `relationships`/`grievances` by holder; they never step a place's hours. Support from rows is computed from at most 50 sampled rows a place, picked by `streamFor(seed, "support", inst, day)`, so a lazy place catching up gets the same number.

12. **Words, not decisions, for the model** (section 4): charter news, an audit's news, a venture's fallout and a talker's line about their office and an epithet's news are templated in code; `realm-news` may reword. No new model call kind.

## Data shapes

```ts
// offices table
{ inst: string /* "s:ashby" | "f:fac12" */; post: PostId; holder: string /* figure id or people id */; since: number; wage: number; unpaid: number }
// ledger table: one row per (inst, period, line)
{ inst: string; day: number /* the tax day that closes the period */; line: LedgerLine; amount: number /* signed copper */ }
// FigureSchema: renown widens to z.number().min(-100).max(100); gains
support: z.number().min(-20).max(20).default(0),
ventures: z.array(z.object({ day: z.number().int(), kind: z.string(), won: z.boolean() })).default([]), // the last 6
// RealmFactionSchema gains
prestige: z.number().min(0).max(100).default(0),
charter: z.object({ until: z.number().int(), need: z.number().int() }).optional(),
dues: z.number().min(0).max(0.2).default(0.05),
belowMin: z.number().int().optional(), // the day it fell under MIN_MEMBERS
// TITLES gains the repute epithets (kind "repute"), held in figures' life.titles
// people row gains: renown INTEGER DEFAULT 0 (-100..100), epithet TEXT; index people_faction(faction) WHERE death IS NULL
```

Code lives in `server/src/game/office/`: `posts.ts` (the table), `appoint.ts`, `treasury.ts` (`pay`, ledger, wages, audits), `charter.ts` (charter, minimum, folding, merging), `recruit.ts` (`recruitDrive`, dues), `prestige.ts`, `repute.ts` (`fame`, effective renown, `standing` by kind, decay; `addRenown` stays in `realm/figures.ts`), `support.ts`, `ventures.ts`, `epithets.ts`, `day.ts` (one entry from the realm day, after `economyDay` and before `taxDay`'s wages).

## Steps

### Step 1: posts and appointments
- `posts.ts`, `appoint.ts`, the `offices` table (in `TABLES`/`ORDER_BY`, a migration); fill every institution at load in a one-off pass (and at realm generation); fill empty posts each day; holders die, move or quit → empty.
- Test: a seeded realm has a reeve and constable in every village that has the people for them, a treasurer and captain in every town; no one holds two posts; a hamlet has only its elder.

### Step 2: the ledger and `pay`
- `treasury.ts`; route every change to `treasury`/`wealth` through `pay` (economy, tax, raids, build, food, factions, treaties, bounties); the ledger rows per period, the prune.
- Test: over a seeded year, the sum of a town's ledger lines equals its treasury's change exactly; a grep test fails if any file outside `office/treasury.ts` assigns to `.treasury` or `.wealth` of a settlement or faction.

### Step 3: officers' effects, wages, audits
- The post effects in decision 4; wages first on tax day; unpaid → loyalty → quit; embezzlement as a hidden line; audits.
- Test (done-when part): a greedy treasurer in the start town skims for some periods (the true ledger shows `stolen`, the public view shows `upkeep`), an audit finds it, they are dismissed and lose renown (below zero if they had little), a new treasurer is appointed, news names them.

### Step 4: charters, the minimum, recruiting drives, dues
- `charter.ts`, `recruit.ts`; `memberCount` with rows; `foundFaction` for guild-like kinds starts a charter; folding and merging; `RECRUIT_CHANCE` replaced; N38's `recruit` gets the need score; dues.
- Test (done-when part): a smith founds a smiths' guild alone; within a year either three members pledge and it is chartered (posts filled, news) or the charter fails and the founder loses renown; no active non-gang faction stays under `MIN_MEMBERS` for more than a season across a seeded 5-year run.

### Step 5: signed renown, prestige
- Widen `Figure.renown` to -100..100 and `addRenown`'s clamp; add `why`/`day`. Go through **every reader of `renown`** (today: `realm/` figures, factions, politics, diplomacy, military, economy, rise, notables, director, view, sync, townsfolk, travel, wilds, haunts, road/waystations, people/rising, admin/person, web/server, npc/types, titles) and mark each `sign` or `fame` (decision 7); `fame()` and `standing` by kind in `repute.ts`; the new causes of loss; decay toward zero; `prestige.ts`; joining and office renown; `people.renown`.
- Test: joining a prestigious guild raises a member's renown; breaking two treaties takes a figure who started at +5 below zero; an infamous bandit chief (−60) still leads their gang and becomes a talker, while an infamous merchant (−40) loses a guild seat to a worse-ranked one of good name; a riser keeps their row's renown.

### Step 6: support
- `support.ts`: followers per leader kind, regard from loyalty, N37 relationships and grievances, weighted by follower fame, the sample for rows; effective renown; support moving stored renown; followers' reflected renown (both signs); challenges at low support.
- Test (done-when part): two village heads alike but for their people: one whose villagers respect them gains renown over a year; one whose villagers hold grievances against them loses it, sinks below zero, and after a season of support below −10 is challenged by a rival.

### Step 7: ventures and failure
- `ventures.ts`; call it from `raid`, `endWar`, delves, a new guild takeover rule (a rich guild buys or forces out a weak one of the same trade in a shared place); grievances for the dead; split pressure after defeats.
- Test (done-when part): a lord's failed conquest of a neighbour: the lord loses 15–20 renown (and a lord who loses twice from +10 ends below zero), the captain who led it loses half, a guild head whose guild's takeover failed loses the same, the families of the dead bear grievances against the lord, and the lieutenant's split check runs; a won defence raises the defender's renown.

### Step 8: epithets and rising by renown
- `office/epithets.ts` and the repute entries in `TITLES`; `epithetsDay`; awarding and losing; `titled(f)` with the epithet; the row `epithet` column; `riseByRepute` (row → figure at fame 25, an epithet, or a post above a village's); `readyToTalk` reads fame and epithets; N19's talker cap.
- Test (done-when part): a village head loved by their people for a year is called "the Good" (news, the title in `life.titles`, `titled` shows it); a lord who sacks a surrendered town is "the Cruel" and loses it never; a townsfolk reeve caught skimming becomes "the Thief", rises to a figure, and in the player's place becomes a talker whose situation line names the title; a leader who stops being good for a year loses "the Good".

### Step 9: admin, talkers, docs
- Admin: a place's or faction's card shows its offices and holders, the ledger by period (truth, with `stolen` marked), the charter, member count (figures + rows), prestige; a figure's card shows renown (signed, with fame), support (its top supporters and detractors), their epithets and why, and their ventures. Talkers' persona: their post ("You are the reeve of Hollin; the coffers are thin and the head blames you"), their guild's standing, what people call them and whether their name is good or ill. README: offices, treasuries, signed renown, epithets.

## Balance bounds

- `offices-filled`: in places with candidates, posts stay empty under a season.
- `treasury-bounded`: no treasury grows without limit (wages and projects absorb it) and fewer than 10% of places are at 0 for a year.
- `embezzlement-rare`: skimming in under a fifth of treasuries at once; most found within two years.
- `guild-sizes`: no active guild under the minimum past a season; the median guild has 4–15 members (figures + rows).
- `renown-spread`: renown not bunched at −100, 0 or 100; leaders' support centred near 0 with a spread.
- `renown-centred`: realm-wide mean renown within −10..+25 after 10 years, and under 15% of figures below −30 (mostly gang and rebel leaders): no drift to a realm of saints or of villains.
- `epithets-rare`: under a third of leaders hold a repute epithet at once; good and bad ones both occur in a 10-year run.
- `splits-after-defeat`: splits happen more after lost ventures, but under one per faction per two years.

## Edge cases and traps

- **One coin path.** Step 2 is the risky one: every place that changes a treasury today must go through `pay`, or the ledger lies. Do it first and keep the grep test.
- **Two member lists.** Figures in `fac.members` and rows with `people.faction` both count; a riser (row → figure) must not be counted twice (the row's `figure` column points at the figure: count the figure only).
- **Talkers are protected** (N38's `protected`): a talker can hold an office but is never dismissed in their own place's hour without an event the player can see; they can still be audited in a lazy place.
- **The crown faction** has no charter and no minimum; its "members" are nobles and heads, and its support is the kingdom's vassals.
- **Merging guilds** must keep stances and branches sane: the absorbed guild's stances go; its enemies stay enemies of the merged one at half.
- **Signed renown and old code.** Every reader that assumed `renown ≥ 0` (thresholds, sorts by renown, news importance, persona words, the admin bar) is wrong for a negative value until it is marked `sign` or `fame`: step 5 does them all, and a test feeds a −50 figure through succession, `rankIn`, `readyToTalk` and the persona. `standing` changes slightly too; re-run the N13 realm tests and the succession tests, and expect small changes in seeded outcomes (record the new hashes).
- **Titles are deeds, not the model's.** An epithet comes only from `epithetsDay`'s facts; the director or `realm-news` may word the news but never award one.
- **Determinism:** appointments, audits, drives, support samples and rising each use their own stream (`office`, `audit`, `recruit`, `support`, `rise`), so changing one doesn't shift another.

## Tests (`packages/server/tests/n69.test.ts`)

The done-when ones:
- The start town's treasurer skims, is found out, dismissed and replaced, and the ledger shows it.
- A guild founded by one person is chartered only once three have joined, or fails and costs its founder.
- A respected village head gains renown from their people; a resented one loses it and is challenged.
- A failed conquest costs its leader renown (past zero when it repeats), its followers' loyalty, and brings grievances.
- A good leader is called the Good, a cruel one the Cruel, and an office holder with an epithet rises to a named NPC.

## Done when (mapped)

| Done-when clause | Proved by |
|---|---|
| every village, town and city has officers who run its treasury and watch, paid from a ledgered treasury | step 1–3 tests |
| a guild can't stand with one member: it charters with three or fails, and recruits to stay above the minimum | step 4 test |
| belonging to a guild raises a member's renown | step 5 test |
| followers give their leader (head, lord, king, faction head) renown, or take it away | step 6 test |
| renown goes from −100 to 100: good deeds and followers raise it, bad ones lower it below zero | step 5–7 tests |
| a failed conquest damages the leader's and the guild head's renown | step 7 test |
| people earn titles like the Good or the Cruel by how they lead, and become named NPCs | step 8 test |

**Save:** v16 and schema 8: `offices`, `ledger` tables; `people.renown` (−100..100), `people.epithet`, the `people_faction` index; `Figure.renown` widened to −100..100, `Figure.support`, `ventures`; the repute titles; `RealmFaction.prestige`, `charter`, `dues`, `belowMin`. The migration fills offices by appointment, keeps every renown as it is (all are ≥ 0 today), and gives every existing guild-like faction under the minimum a charter of one year from the load day (so old one-member guilds recruit or fail, rather than vanishing at once).

## Slice cut

Steps 1–6 and 8 for the start town, its liege town and their guilds; ventures (step 7) for raids and wars only.

## Out of scope

Elections and councils that vote on laws (N58's court; section 14's kingdom policies). Trials for embezzlers (N48: until then, dismissal and a grievance). Spymasters doing anything (N46). The player holding an office or running a treasury (N57, N66). Armies that march (N55): until then a conquest is N13's war or a rebel win.
