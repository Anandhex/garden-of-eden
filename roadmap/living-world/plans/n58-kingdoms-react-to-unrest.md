[← Plans](README.md) · [Stage 5: N58](../stage-5-power-and-conflict.md#n58-kingdoms-react-to-unrest)

# N58 plan: Kingdoms react to unrest

**In one line:** each kingdom keeps an **unrest memory** (recent revolts, uprisings and rebel bands, its own and its neighbours' once the news reaches the court, weighted by distance and age); when it passes a threshold the ruler's traits and the court's mood pick a **response** (repression, concession, or fear without action) carried out as **temporary policies** (section 14) that play follows (curfews in the crowd's day, heavier tithes, extra guards, lower taxes, pardons, freed serfs, alliances against revolt); every response is logged with its reason, and policies decay unless renewed, so a kingdom can swing.

**Read first:** [plans README](README.md) sections 2, 14 (policies with `until`), 17 (`SiteDay` fields: `curfew`, `crackdown`). Needs N33 (news reaching the court), N48 (public punishments, rebel trials), N56 (revolts and bands). Uses N29 (silent curfew nights), N31 (curfew guards, banners), N36 (fear and anger), N47 (crackdowns on the underworld use the same policy), N50/N51 (omens and witch hunts in fear), N59 (slave kingdoms tighten after escapes).

## What exists

- **Kingdoms** with rulers (figures with ambition, loyalty, greed, bravery), opinions, weariness, laws; taxes and tax rates per settlement; wars.
- **The crown's** faction; `successionDay`, `install`; heads of places.
- After N45: the policy mechanism; after N56: revolts and bands as realm news; after N48: punishments.
- **The crowd's day** is shared code (N16) with `CrowdDay` flags (weather, festival; N30 adds daylight).

## Decisions made in this plan

1. **The unrest memory** is computed, not stored: `unrestOf(realm, kingdom, day)` = Σ over revolt/uprising/band news that **has reached the capital** (`reachesAt(news, capital)` is set and ≤ day: N26 Part E, the day a traveller or courier brought it) of `weight(kind, outcome) × decay(age) × distance factor (own places 1, a neighbour 0.5, far 0.2)`, plus the kingdom's own active bands (known to the crown: N46 discovery) and slave escapes (N59). A short list of the contributing refs is kept for the `why`.
2. **The response** is a `decidePolicy` (section 14) on a key `unrest_response` when unrest passes a threshold, re-decided weekly while it stays high, by the ruler's traits: **harsh/fearful** (low loyalty to people, high bravery or high fear: there's no fear trait for figures; use low bravery + low loyalty as "fearful") → `repression`; **cautious/pragmatic** (high loyalty, moderate ambition) → `concession`; **weak** (low bravery, low ambition) → `fear_without_action`. The court's mood (the capital's N36 mood) and omens (N50's readings) shift it; the `why` names them all.
3. **Repression** sets temporary policies with `until` (two to four weeks, renewed if unrest stays): `curfew` (no one out after dusk except guards; `SiteDay.curfew` for every place of the kingdom, or only for places with bands), `guards_doubled` (more guards on the map: N31's `guards` marks; patrols on roads: N26's source), `tithe_up` (tax and labour up: `taxRate` +, slaves' and serfs' work hours longer in the crowd's day), `public_punishment` (N48's sentences harsher and public: stocks and executions in the square), `rebel_hunt` (N47's crackdown machinery against bands: arrests by suspicion). Effects: revolt chance down for the duration (the N56 threshold rises with fear), **grievances build faster** (every curfew night and punishment is a grievance against the ruler or the head who enforces it, per affected person; N56 counts them).
4. **Concession** sets: `tax_down`, `serfs_freed` (a share of serfs become commoners: a class change on rows, by place, with news), `small_rights` (e.g. the right to petition, lighter `word_weight` for commoners in N48's book), `pardons` (members of failed bands released). Effects: grievances against the crown fall (settled grievances), but **nobles who lose out resent the crown**: grievances of nobles and gentry against the ruler; past a threshold, a **noble faction** forms (N13 `foundFaction` of kind `association`/`crown`-opposed) that may plot (N46) or attempt a coup.
5. **Fear without action**: no policy; instead nobles act on their own (N38 actions for noble talkers/figures): hire private guards (spending their wealth; guards on their manors), flee to another kingdom (migration of a noble household), or the crown signs an alliance for **mutual defence against revolts** with another crown (a new treaty kind `revolt_pact`: each sends soldiers to crush the other's revolts; N55).
6. **Effects in play** read the policies through `SiteDay` and the roster: the crowd's day (curfew: everyone home by dusk, the streets empty but for the watch; longer slave/serf hours), chatter (whispers; guards harassing in N37's interaction picker: guards get a higher hostility roll toward commoners), prices (tithes and fear raise them), how guards treat the player (stops and searches: a situation on the road and in town; papers checked: N26's `papers_checked` situation turns on), and **rebels may approach the player** (a band's talker seeks the player out: N67 later; a talker in a venue now).
7. **Decay:** every temporary policy has `until`; when it ends and unrest is low, it lapses (news: "the curfew in Ashby is lifted"); a ruler who repressed and saw quiet may repress again next time (a memory of what worked: a small weight); a new ruler re-decides.

## Steps

### Step 1: the unrest memory
- `game/unrest/memory.ts`; contributing refs; the admin's chart per kingdom.
- Test: a revolt in a neighbouring kingdom raises this kingdom's unrest only after a traveller or courier brings its news to the capital.

### Step 2: deciding the response
- `unrest_response` via `decidePolicy` with traits, mood and omens; the `why`.
- Test: on the same unrest, a harsh ruler represses and a cautious one concedes (two kingdoms, or one kingdom with the ruler's traits swapped).

### Step 3: repression in play
- Policies with `until`; `SiteDay.curfew`, `crackdown`; crowd day changes (shared code), guards, tithes, public punishments, rebel hunts; grievances from each.
- Test (done-when part): after a revolt next door, a harsh ruler's kingdom imposes a curfew that the townsfolk's day follows (no free townsperson outdoors after dusk in the crowd plan) and grievances there rise faster (grievance rows per day higher than before).

### Step 4: concession in play
- Tax down, serfs freed, small rights, pardons; nobles' resentment; the noble faction.
- Test (done-when part): a cautious ruler lowers taxes instead and a noble faction forms against them.

### Step 5: fear without action
- Nobles' private guards, flight, `revolt_pact` treaties.
- Test: a weak ruler's nobles hire guards and the crown signs a revolt pact.

### Step 6: decay; admin; docs
- Lapsing, renewal, memory of what worked; admin: unrest, responses, policies in force with reasons. README: how kingdoms react.
- Test (done-when part): both policies fade if unrest stays quiet (policies lapse after `until` with no renewal).

## Balance bounds

- `policies-swing`: over a long run, kingdoms change responses at least sometimes; none is in permanent curfew.
- `concession-cost`: concessions lead to noble resentment often enough to matter.

## Edge cases and traps

- **The crowd's day is shared code:** curfew must be a `CrowdDay` flag the browser has (from the state), not a server-only rule.
- **Grievances against the ruler** are against a figure far away; they count for N56 only if the local enforcer is named (the head or captain who enforces) or the place's people's `lord` axes include the ruler. Make enforcement grievances target the enforcer, and the ruler only through the outlook's `lord` axes.
- **Lazy places** read the policies from `site_days` written by the realm day.

## Tests (`packages/server/tests/n58.test.ts`)

The done-when ones:
- After a revolt next door, a harsh ruler's kingdom imposes a curfew that the townsfolk's day follows, and grievances there rise faster.
- A cautious ruler lowers taxes instead and a noble faction forms against them.
- Both policies fade if unrest stays quiet.

## Done when (mapped)

| Done-when clause | Proved by |
|---|---|
| a harsh ruler's kingdom imposes a curfew that the townsfolk's day follows, and grievances there rise faster | step 3 test |
| a cautious ruler lowers taxes instead and a noble faction forms against them | step 4 test |
| both policies fade if unrest stays quiet | step 6 test |

**Save:** the next save version (policies; treaty kind `revolt_pact`); `SiteDay` gains `curfew`, `crackdown` (JSON, no schema change).

## Slice cut

Not in the slice.

## Out of scope

Runaway policies (N59). New kingdoms from successful revolts (N64).
