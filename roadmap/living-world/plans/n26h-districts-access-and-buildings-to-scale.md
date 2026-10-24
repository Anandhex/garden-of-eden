[← Plans](README.md) · [Stage 2: N26H](../stage-2-everyone-lives.md#n26h-districts-access-and-buildings-to-scale)

# N26H plan: Districts, access and buildings to scale

Asked for 2026-10-24: "a village needs to split into different districts like the market square, slums, noble districts, not only for villages but for towns, cities and everything else"; "there are certain levels of relations required to enter a specific district: the noble district can't be entered by anyone, they need to be noble"; "the king's palace no one can enter easily unless they are summoned, or have relations, or are on a quest, or they can bribe the guards if there is a quest to attack or assassinate a particular person"; "lodgings need to match the actual size of the place: a castle can't be the same size as a house, and a town hall can't be the size of a house"; "you can't enter people's places without having a relation with them".

**In one line:** every settlement is made of **districts** fitting its size (a hamlet is a green and its farmsteads; a capital has a palace ward, a noble quarter, merchant streets, the market, the craft quarter, the temple close, the docks and the slums outside the walls); people live in the district their class and trade put them in; **buildings are drawn to their real size** (a cottage, a merchant's house, a town hall, a cathedral and a castle are each as big as they should be); and **every district, building and door has an access rule**, checked the same way for the player and for every NPC, with real ways round it: rank, relationships, a summons, a job there, a quest's writ, a bribe, or sneaking in.

**Read first:** [plans README](README.md) **Part 3 (sections 21–29), which every playtest phase follows**, and sections 2, 7, 9, 13 (the action menu), 15, 16. Needs N16 (maps by size, the crowd, classes), N25 (people rows and homes), N37 (relationships), N38 (the action menu). Brings forward [N32](n32-interiors-and-homes.md) steps 1 and 2 (interiors as areas, and the generator) as **step 0**, because doors that can be refused need somewhere to lead. N32 keeps belongings, secrets in drawers and trespass. Fits with [N26G](n26g-fields-outside-the-village.md) (fields leave the village map, which frees room) and [N26F](n26f-a-road-worth-walking.md) (the woods, camp and mine leave it too).

**The rule** (from [N26F](n26f-a-road-worth-walking.md#the-rule-every-person-is-tracked)): every guard on a gate, servant at a door, steward who lets you in and guard who takes a bribe is a real row on duty.

## What exists

- **One map per settlement**, sized by kind in [`sites.ts`](../../../packages/server/src/web/sites.ts) (`VILLAGE_SIZE`): hamlet 26×18 tiles, village 34×24, town 50×34, city 72×48, capital 96×64. Buildings are placed along streets: the palace is **7×4 tiles**, a hall 4–5×3, a manor 5×3, a house 3–4×2–3. So a palace is about two houses wide, which is what the user noticed.
- **Classes** and their rank (`CLASS_RANK` in [`shared/crowd.ts`](../../../packages/shared/src/crowd.ts): slave 0 to royal 7); homes by household (N25); the crowd's zones (square, market, fields, gate, exits). Homes aren't placed by class: any house can go to anyone.
- **Relationships** between people and with the player (N37, [`chatter/`](../../../packages/server/src/game/chatter/)), the action menu (N38), quests (N38's quest kinds), crime with witnesses and bounties ([`crime.ts`](../../../packages/server/src/game/crime.ts)), stealth ([`stealth.ts`](../../../packages/server/src/game/stealth.ts)), and some bribe dilemmas ([`dilemmas.ts`](../../../packages/server/src/game/dilemmas.ts)).
- **No interiors**: doors are drawn but lead nowhere (N32 isn't built).

## Decisions made in this plan

1. **Districts by kind of place.** Each kind has a set of districts, and the place's buildings, wealth and laws decide which it has:

   | Place | Districts |
   |---|---|
   | hamlet | the green, farmsteads |
   | village | the green and church, the street, farmsteads, the manor (if a lord lives there) |
   | town | the market square, the high street (merchants), the craft lanes, the temple close, the poor end, the castle or keep (if the lord is seated there), the gate and its inns |
   | city | all of a town's, plus the **noble quarter** (walled off), the guild quarter, the docks (on water), the barracks, the **slums** (outside the walls or by the tanneries), a foreigners' street (hook for N53) |
   | capital | all of a city's, plus the **palace ward** (inner walls) and the cathedral close |

   Districts sit where they would in a real place: the castle on the high ground, the docks on the water, the market at the crossroads, the slums downwind and outside the walls, the noble quarter next to the castle.
2. **Big places are several maps.** A capital to scale can't fit on one map. A town or larger is made of **district maps**, each its own area (`d:<district>`) joined by streets and gates, like N26F's interiors. Small places (hamlet, village) stay one map with districts as zones. District maps are 60×40 to 100×70 tiles, so a capital is six to ten maps and has room for its real number of houses. The crowd runs per district, and people cross between districts at gates and street ends.
3. **Buildings at their real size.** A footprint table by kind, class and wealth (in tiles, where a tile is about 2 m):

   | Building | Footprint | Notes |
   |---|---|---|
   | hovel, slave or serf cottage | 3×2 | one room |
   | cottage | 4×3 | |
   | craftsman's house and shop | 5×4 | shop at the front |
   | merchant's house | 6×5 | two floors, a yard |
   | inn | 8×6 | stable yard |
   | town hall, guild hall | 10×8 | |
   | temple | 8×12 | |
   | cathedral (capital) | 14×24 | |
   | barracks | 10×8 | yard |
   | manor | 10×8, in grounds of 16×14 | walled garden, gate |
   | castle | keep 12×12 in a walled bailey of 30×24 | gatehouse, towers |
   | palace | 40×30 compound | courts, gardens, its own gate and guards |

   Big buildings are **compounds**: an outer wall, a gate, a yard, and the building, each with its own access rule. N32's interior generator uses the footprint, so a castle's interior is a great hall, a solar, kitchens, a chapel, a guardroom and cells, while a cottage's is one room.
4. **People live where their class puts them.** Homes are given by class and trade: nobles in the noble quarter or the castle, merchants on the high street, craftsmen in the craft lanes over their shops, the poor and freed slaves in the poor end and the slums, servants in their master's house, guards in the barracks. A person who rises or falls (N25b, N40, N69) moves district when they can find a house there. A person's home district is part of their row, and what they say ("down in the Shambles").
5. **One access rule for everyone.** Every district gate, compound gate, building door and room has an **access level**, and one function decides: `canEnter(who, place, minute) → { ok, why, unless }`. It's used for the player, and the crowd uses it to route every NPC, so a commoner never wanders into the palace ward unless they work there.

   | Level | Who may enter | Examples |
   |---|---|---|
   | open | anyone, at any hour | streets, the market square, the green, the slums |
   | open by day | anyone, in its hours | shops, the inn's taproom, the temple nave, the town hall's front room |
   | ranked | people of a class or higher, or anyone with business there | the noble quarter (gentry and above), the guild quarter (members by night) |
   | members | people of a faction, guild, office or household | a guild hall's inner rooms, the barracks, the temple sanctum (clergy) |
   | private | the household, and people they let in | every home |
   | guarded | only those the guards let through | the castle keep, the palace ward and the throne room |

6. **Ways in, each with a real cause.** Being refused says why and what would change it. The ways past a rule are:
   - **Rank:** class at or above the district's.
   - **Relationship:** a household lets in people they like enough (N37 relationship: kin and friends always, acquaintances by day, strangers not at all). Knocking on a friend's door and being let in by name is the normal way into a home.
   - **Invitation or escort:** a resident who likes you can bring you in ("Lady Aldis walks you through the gate"). A summons is an invitation from an office: a lord or king **summons** the player (a quest, a crime, an honour, a petition granted) and the summons is a document item the gate guards accept on its day.
   - **Work:** servants, guards, clerks, cooks, tradesmen delivering goods, all with jobs there. The player can be hired into a household (a hook for N40's careers: a seat as a servant or guard opens the doors that job opens).
   - **A quest's writ:** a quest given by someone with the right to it (a captain, a steward) carries a pass to the places the quest needs.
   - **A bribe:** a guard on duty may take coin, by their own traits (greed, loyalty to their master, fear of being caught) and the stakes (more for the palace than a noble street, more at night). A refused bribe can be reported (a crime), and a guard who took one may talk later (gossip, N33). Bribes are how the player gets in for a quest to rob or kill someone inside.
   - **Sneaking:** climbing a wall at night, the servants' door, the sewers, with `stealth` against the watch (real guards with real sight). Caught means trespass or worse.
   - **Force:** fighting past the gate guards is a crime, and the place calls more guards (real rows from the barracks).
7. **Guards are on duty, by name.** Every guarded gate and door has a **post** with a rota of real guard rows (the barracks', or a household's own men; the palace has the king's guard). Who is on the gate now is a function of the rota and the minute, so a guard you bribed at night isn't the one on the gate at noon. A post with nobody to fill it (guards dead or away at war) is unguarded, which is a real opening.
8. **Assassination and attacks follow from all this.** A quest to kill or rob someone inside a guarded place is planned through these rules. The target is where their own routine puts them (asleep in the keep's solar at 02:00, in the great hall at noon). The ways in are the ones above, and what the player does inside is seen by the people really there. A killing in the palace is the realm's biggest news, with witnesses and a manhunt (N48 trials later).
9. **NPCs use the same doors.** The crowd's routes, N38's NPC actions (a thief breaking into a merchant's house, a suitor calling on a noble's daughter, a spy bribing a palace guard) and N37's visits (a friend calls on a friend) all go through `canEnter`. An NPC thief needs the same ways in as the player.

## Data shapes

```ts
// shared/src/town/districts.ts
export type DistrictKind = "green" | "farmsteads" | "street" | "manor" | "market" | "high_street" | "craft" | "temple_close" | "poor_end" | "castle" | "gate" | "noble" | "guild" | "docks" | "barracks" | "slums" | "foreign" | "palace" | "cathedral";
export interface District { id: string; kind: DistrictKind; name: string; map?: { w: number; h: number } /* own map in towns and up */; access: Access; gates: Array<{ to: string; x: number; y: number; post?: string }> }
export interface Access { level: "open" | "day" | "ranked" | "members" | "private" | "guarded"; minClass?: SocialClass; members?: string /* faction, guild, office, household */; hours?: [number, number] }
export function canEnter(who: Entrant, place: Place, minute: number): { ok: boolean; why: string; unless: Array<"rank" | "relation" | "invite" | "summons" | "work" | "writ" | "bribe" | "sneak"> };

// server: game/town/posts.ts
export interface Post { id: string; site: string; at: string /* gate or door id */; guards: string[] /* person ids */; rota: "day-night" | "three-watch"; master: string /* who they serve */ }
```

`people` rows gain `district`. Settlements gain their districts (derived from the seed and the place, cached like the site map, not saved). SQLite: `posts(id, site, at, master, rota)` and `post_guards(post, person)`. Documents (summons, writs, passes) are items with a ref to the office that issued them and a day.

Save: a new save version. Homes move between districts, so a migration reassigns houses by class. Old saves are disposable, so a clean break is fine.

## Steps

### Step 0: interiors (N32 steps 1 and 2)
- Build N32's interiors as areas and its generator, as written in [the N32 plan](n32-interiors-and-homes.md), using this plan's footprints (step 2). N32's later steps stay in N32.

### Step 1: districts
- `shared/src/town/districts.ts`: districts per place (decision 1), where they sit, their names (from code templates; the model may improve them through N19's `place-name` budget with the invented-name check).
- `sites.ts`: small places get district zones; towns and up get one map per district (decision 2), joined by gates. The crowd runs per district map.
- Tests: a hamlet is one map with a green and farmsteads; a capital has a palace ward, a noble quarter and slums outside its walls; the same seed gives the same districts; every district map is reachable from the gate.

### Step 2: buildings to scale
- The footprint table (decision 3) replaces `sized(...)`; compounds (wall, gate, yard, building) for manors, castles and palaces; the interior generator reads footprints.
- Tests: a palace's compound is at least 10 times a cottage's area; a town hall is at least 5 times; the castle has a gatehouse and a bailey; a cathedral is only in a capital.

### Step 3: homes by class
- House assignment by class and trade (decision 4); `people.district`; moving district on rising or falling.
- Tests: in the start town's liege town every noble lives in the noble quarter or the castle, no slave or serf owns a house outside the poor end, slums or farmsteads (servants live in their master's house); a merchant ruined by N25b moves to the poor end when a house is free there.

### Step 4: access
- `canEnter` (decisions 5 and 6) in shared code; server move checks at every gate and door; the crowd routes with it.
- Refusal lines that say why and what would change it ("The guard looks at your clothes. The noble quarter is for gentry, or those with business there.").
- Tests: a commoner player is turned back at the noble quarter's gate; a friend's door opens, a stranger's doesn't; a shop is open by day and locked at night; no crowd person in the palace ward lacks a job, rank or household there.

### Step 5: guards, posts and ways in
- `posts` and rotas of real guard rows (decision 7); summons and writs as documents (from N38's quests and from offices); invitations and escorts; bribes by guard traits and stakes; reporting a refused bribe; sneaking with stealth against posted guards; forcing a gate.
- Tests: the guard on the palace gate at 02:00 is a named guard from the rota; a summoned player is let in on the summons' day and not the day after; a greedy guard on night watch takes a bribe and a loyal one reports it; with the gate's guards away at war, the post is empty.

### Step 6: quests to get inside
- N38's quest kinds gain targets inside guarded places (rob, kill, rescue, deliver a letter). The quest says who the target is and where they'll be, not how to get in. Writs for lawful quests; nothing for unlawful ones.
- Tests: a quest to kill a noble in the castle can be done by bribing the night guard and finding them asleep in the solar; a killing in the palace is news with witnesses.

### Step 7: NPCs through the same doors
- N38's NPC actions and N37's visits check `canEnter` and use the same ways in.
- Tests: an NPC thief breaks into a merchant's house only by a way in the rules allow; a suitor visits a noble's house when invited.

### Step 8: browser, admin, tune and document
- Client: district maps, gates, compounds, footprints (sprites through the G6 pipeline), the refusal lines, a district name in the header.
- Admin: a place's districts, posts and who is on them now.
- Bounds: `homes-by-class`, `posts-filled` (most posts are manned in peace), `nobody-misplaced` (no NPC inside a place they may not enter, except by a recorded way in).
- README and stage file.

## Edge cases and traps

- **Map count and memory:** a capital of ten district maps, each with its crowd, is heavy. Only the district the player is in (and its neighbours' edges) runs the crowd at full detail. Others are worked out at the level the crowd uses for places out of sight.
- **Routes across districts:** the crowd's path-finding must go through gates the person may use. Precompute the district graph per class.
- **The player's own home and rank** (N66) later change what's open to them; `canEnter` reads the player's class, offices and relationships, so it'll just work.
- **Hamlets with no lord** have no guarded places at all. That's right: not every place has a castle.
- **Interiors and footprints must agree:** N32's generator must not make a cottage with five rooms. Tie room count to the footprint.
- **Bribes and loyalty:** a guard who takes a bribe from an assassin and whose master dies is a story. Record the bribe as an event with both names.

## Tests (`packages/server/tests/n26h.test.ts`, `packages/shared/tests/districts.test.ts`)

As listed in each step, plus a fixed-seed walk through the liege town: gate, market, high street, turned away from the noble quarter, let into a friend's house, summoned into the castle, a bribe at night.

## Done when (mapped)

| Done-when clause | Proved by |
|---|---|
| every place from a hamlet to the capital has the districts its size calls for, and people live in the one their class puts them in | districts and homes tests |
| a castle, a town hall and a cottage are each drawn at their real size | footprint tests |
| a commoner can't walk into the noble quarter or the palace; summoned, on a quest's writ, escorted by a friend or with a bribe they can | access and ways-in tests |
| nobody, player or NPC, enters someone's home without a relationship, an invitation, a job there or a crime | access and NPC tests |

## Slice cut

The start town and its liege town: their districts, footprints, homes by class, access, posts and the summons and bribe ways in. The capital's palace ward waits.

## Out of scope

Belongings, secrets in drawers and trespass details (N32), trials (N48), the player's own house (N66), cultures' own quarters (N53), sieges of walled districts (N55).
