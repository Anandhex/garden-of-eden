[← Plans](README.md) · [Stage 2: N36](../stage-2-everyone-lives.md#n36-the-mood-of-a-place)

# N36 plan: The mood of a place

**In one line:** each place has six mood numbers (grief, fear, anger, joy, hope, unease) computed in code each day from what happened there, weighted by how many people there felt it, and decaying; the mood goes into the place's day record so everyone's daily rules can read it, and it shifts chatter, prices, how strangers are treated, N38's scores and N58's unrest.

**Read first:** [plans README](README.md) sections 2, 13, 17 (the `SiteDay` bridge). Needs N25b (townsfolk outlooks: each person already has a mood from -3 to 3, [`people/outlook.ts`](../../../packages/server/src/game/people/outlook.ts)). Uses N20 step 1 (cause refs: a mood shift records what caused it) if built; else the event or realm ref directly. N29 plays it, N31 may show it, N38 scores with it, N56/N58 read anger and fear.

## What exists

- **Each townsperson's outlook** (`Outlook.mood` −3..3, `lord` axes, goal, grudge), set by code reviews from the place's `site_days` and family events; talkers' moods and emotions ([`npc/emotions.ts`](../../../packages/server/src/npc/emotions.ts)) move with what happens to them.
- **`site_days`** ([`people/conditions.ts`](../../../packages/server/src/game/people/conditions.ts)): food, prosperity, famine, crowding, raided, atWar, besieged, beasts, plague, casualties.
- **Chatter** (`chatLines` in [`shared/crowd.ts`](../../../packages/shared/src/crowd.ts)) already reads `CrowdDay` (weather, festival) and `roster.talk`/`scorn`.
- **Prices** (`priceFactor`, `stockFactor`); **first impressions** of the player ([`reputation.ts`](../../../packages/server/src/game/reputation.ts) `firstImpression`).

## Decisions made in this plan

1. **Six numbers, 0..100 each**, per place per day: `grief, fear, anger, joy, hope, unease`. Not one emotion: a place can grieve and be angry at once. The **dominant** mood (highest above 30) is what's shown and said.
2. **Moods come from shocks.** A table in `game/mood/shocks.ts` maps each kind of thing that happens in or to a place to mood pushes, scaled by **how many there felt it** (deaths in the place count by how many families are touched: N25's lineage; a curfew by everyone; a tax hike by everyone who pays; a victory by the families of soldiers) over the place's population. Examples: deaths in a raid → grief and fear and anger at the raider; a massacre (many deaths in one event) → grief ×2; a curfew (N58) → fear and anger; a tax hike → anger; a good harvest (N30) → joy and hope; a festival → joy (small, a day); a famine → unease rising, then anger; a plague (N61) → fear; a new kind ruler → hope.
3. **Mood decays toward a baseline** set by prosperity and food (a poor place's baseline has more unease), with half-lives per mood (grief long: ~a season; joy short: a few days; fear medium).
4. **One place of record:** `site_days.mood` (the six numbers, rounded), written by the realm day for every place (cheap: a few shocks a day). The daily mood update itself is a pure function of yesterday's mood, today's conditions and today's events at the place. Lazy places compute it the same way during catch-up (from their `site_days` and their events), so live and lazy agree.
5. **Individuals and the place feed each other, gently.** The place's mood nudges townsfolk outlook reviews (N25b rules gain a "the town is grieving" input), and the share of people with low mood adds unease. No feedback loop: the place's mood is computed from events and conditions; people's outlooks *read* it; the place doesn't read the people's moods back except as unease, capped.
6. **Effects, each small and named:**
   - **Chatter:** `CrowdDay.mood` (the dominant one) chooses chat line tables (grief: quiet, short lines, fewer chats; fear: whispers, glances at guards; anger: complaints about the cause; joy: jokes, songs).
   - **Prices:** grief and fear raise prices of candles, drink and weapons a little; joy lowers drink at the inn; anger: traders less willing to haggle.
   - **Strangers:** fear and anger lower first-impression trust of outsiders (the player, travellers); joy raises it.
   - **Willingness to help:** a modifier on asks (favours, jobs) and on N38's "help" actions.
   - **N38 scoring:** mood is an input to every score (`anger` raises confront/protest; `fear` raises stay home; `grief` lowers leisure).
   - **N58:** anger and fear feed unrest.
   - **Talkers:** their persona prompt gets one line ("The town is in mourning after the raid four days ago.").
7. **Shown** in the place's header for the player ("Millbrook is grieving"), as a tint and fewer people outdoors on the map, and fully in the admin (six lines over time with the shocks marked).

## Data shapes

```ts
// SiteDay gains
mood: { grief: number; fear: number; anger: number; joy: number; hope: number; unease: number; causes?: Array<{ ref: string; mood: MoodKind; push: number }> };
```

## Steps

### Step 1: the mood model
- `game/mood/model.ts` (decay, baseline, dominant), `shocks.ts` (the table and the felt-by share), `game/mood/day.ts` (yesterday + today → today), written into `site_days` by the realm's day.
- Test: a raid killing several people in the start town puts it in grief (dominant) with the raid as cause; it fades over weeks (a long run of days, grief under 30 within a season); a lazy place and a live place with the same events give the same mood (hash).

### Step 2: effects on chatter and the crowd
- `CrowdDay.mood`, chat line tables per mood, fewer chats and fewer people out in grief and fear.
- Test (shared): chat lines for a grieving day come from the grief table; outdoor count lower.

### Step 3: prices, strangers, help
- `priceFactor`, `firstImpression`, favour/ask modifiers read the place's mood.
- Test: after the raid, candles and drink cost more and the player's first impression is cooler.

### Step 4: outlooks and talkers
- N25b outlook rules read the place's mood; talker personas get the line.
- Test: townsfolk reviewed during grief have lower mood than those reviewed a season later.

### Step 5: shown, and the admin
- Place header line, map tint, admin chart.
- Test (done-when): a festival after a good harvest lifts the place to joy (dominant).

### Step 6: docs
- README: the mood of a place.

## Balance bounds

- `moods-move`: over a long run every mood is dominant somewhere at some time; none is pinned above 70 in a place for more than a season without fresh shocks.

## Edge cases and traps

- **Felt-by needs families.** "How many felt it" for deaths uses N25's lineage (parents, spouse, children, siblings) through one query per death; for a big raid that's a few dozen queries. Batch them.
- **Mood must not hide in the outlook only.** Don't compute the place mood by averaging people (that's the feedback loop); compute it from events and conditions.
- **Small places swing hard** (one death in a hamlet of 20 is huge). That's right, but cap a single shock at 60.

## Tests (`packages/server/tests/n36.test.ts`)

The done-when ones:
- After a raid kills several people the start town is in grief, its chatter and prices show it, and it fades over weeks.
- A festival after a good harvest lifts it to joy.

## Done when (mapped)

| Done-when clause | Proved by |
|---|---|
| after a raid kills several people Millbrook is in grief | step 1 test |
| its chatter and prices show it | steps 2–3 tests |
| it fades over weeks | step 1 test |
| a festival after a good harvest lifts it to joy | step 5 test |

**Save:** none in the save; `site_days.data` grows by a small object (no schema change: it's JSON).

## Slice cut

Not in the slice (but cheap; if the slice's playtest says the towns feel flat, pull it in).

## Out of scope

Mood of kingdoms or courts (N58 keeps the court's unrest memory). Individuals' emotions (already exist for talkers).
