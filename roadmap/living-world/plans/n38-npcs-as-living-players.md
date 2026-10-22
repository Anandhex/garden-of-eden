[← Plans](README.md) · [Stage 3: N38](../stage-3-npcs-choose.md#n38-npcs-as-living-players)

> **Built 2026-10-22.** What differs from this plan is listed in the [stage file](../stage-3-npcs-choose.md#n38-npcs-as-living-players) under **What differs from the plan**; the steps below are as written.

# N38 plan: NPCs as living players

**In one line:** one action menu (section 13 of the README) for talkers, townsfolk and the player; every hour a talker in the player's place scores every option it has from its needs, goals, emotions, relationships, traits and the place's mood, and picks by a weighted roll whose spread its traits set; townsfolk make the same kind of choice once a day at coarse grain; every choice is an event with its score parts as the reason; cooldowns and caps stop loops and massacres; the model never chooses.

**Read first:** [plans README](README.md) sections 2, 9, 13 (the shape built here), 17, 19 (`choice-reason`). Needs N18 (streams, tables), N19 (budgets, perf), N37 (interactions, relationships, grievances, revenge against anyone). Uses N36 (mood) if built. **This is the phase every later one plugs into; build it carefully and keep it small.**

## What exists

- **A talker's hour** ([`simulation.ts`](../../../packages/server/src/game/simulation.ts) `passTime`/`passMinutes`): needs tick, `planHour` ([`schedule.ts`](../../../packages/server/src/game/schedule.ts)) picks activity and place from the schedule with overrides (exhausted, starving, companion, festival, broke); in work hours an idle NPC crafts or sells; healing, debts, emotions fade, revenge fades.
- **Things NPCs already do in code:** gossip ([`gossip.ts`](../../../packages/server/src/game/gossip.ts)), buy supper and drink ([`village.ts`](../../../packages/server/src/game/village.ts)), black market and raids ([`underworld.ts`](../../../packages/server/src/game/underworld.ts)), revenge plans ([`director/revenge.ts`](../../../packages/server/src/director/revenge.ts)), initiative toward the player ([`npc/initiative.ts`](../../../packages/server/src/npc/initiative.ts)), courtship ([`family.ts`](../../../packages/server/src/game/family.ts)). Each is its own loop with its own rules.
- **Daily plans** ([`director/planning.ts`](../../../packages/server/src/director/planning.ts)): flavour only, model-written, never acted on.
- **The player's actions** are web/CLI actions handled in [`web/server.ts`](../../../packages/server/src/web/server.ts) and [`npc/actions.ts`](../../../packages/server/src/npc/actions.ts) (model tool proposals validated by code).
- **Streams:** `streamFor` exists; [`dice.ts`](../../../packages/server/src/game/dice.ts). `Town.rng` may still default to `Math.random` in places (check: plans README section 2).
- **Townsfolk** live daily (N25 step) and review their outlook (N25b); their minute-to-minute day is the shared crowd plan.

## Decisions made in this plan

1. **The menu** (section 13's `ActionDef`) in `server/src/game/choice/`: `types.ts`, `registry.ts`, `context.ts` (builds `ChoiceCtx`: the person, their needs, goals, emotions, traits, relationships with people present, place mood, hour, money, items, what's available here), `score.ts`, `pick.ts`, `run.ts`, `actions/*.ts`.
2. **First actions** (the stage file's list): `eat`, `work`, `rest`/`sleep`, `gossip`, `buy`, `sell`, `court`, `confront`, `insult` (deliberate, from N37), `revenge` (carry out a plan), `spread_rumour`, `recruit` (into their faction), `travel` (leave for another place for a reason: N25 migration for townsfolk; a talker's errand), `steal`, `attack`. Each wraps the code that already does it (crafting/selling in `simulation.ts`, supper in `village.ts`, `actOnRevenge`, `steal`), so behaviour moves, not rewrites. `steal` and `attack` are `violent` (and `steal` is behind the same flag: section "Open decisions" in the overview).
3. **The schedule is the default, not the rule.** `work` during work hours, `sleep` at night and `eat` at meals get a large **habit bonus** from the schedule block, so an ordinary NPC still keeps their day. Something else wins only when its score beats habit: hunger, a strong grudge with the target present, an opportunity (the target alone, a festival), fear.
4. **Scores are sums of named parts.** `score = Σ weight × feature`, each part a `[label, value]` (`["hunger", 0.6]`, `["grudge vs t_x_12", 0.4]`, `["habit: work block", 0.5]`, `["cautious", −0.3]`, `["mood: anger", 0.1]`). Weights in one table (`choice/weights.ts`) that N22's bounds and the admin help tune.
5. **Weighted randomness by temperament.** Softmax with temperature `T` from traits: `T = 0.05 + 0.5 × recklessness` where recklessness comes from bravery, temper and low caution (a cautious NPC: T≈0.05, nearly always the top score; a reckless one: T≈0.5, often not). The roll from `streamFor(seed, "choice", who, day, hour)`.
6. **Grains:** talkers in the player's place choose **hourly** (`run.ts` called from `passTime` before the hour's activity). Talkers elsewhere catch up as today (their place's catch-up runs their hours at a coarser step: one choice per block). **Townsfolk choose daily**, from a smaller menu (`grain: "day"`: work as usual, skip work for leisure, confront someone, gossip-visit, travel, steal, revenge), in the day's life step (pure: rows + `site_days` + the stream), and their choice becomes an **override** of their crowd plan for that day (sent to the browser with the roster as a sparse list `{ id, intent, target?, at? }`, so the crowd shows the confronting commoner walking to the noble's house).
7. **Guardrails, in `choice/guards.ts`:**
   - Cooldowns per action per person (`confront` once a day, `insult` a few hours, `attack` once a week, `travel` once a season…) and per pair (no confronting the same person twice a day).
   - Loop check: if a person picked the same non-habit action N times in a row, its score is damped.
   - **Caps:** at most `MAX_FIGHTS_PER_PLACE_PER_DAY` (2) violent actions in a place, and at most one per hour in the player's place.
   - **Protected people:** `isProtected(ref)`: a companion of the player, a quest-giver with an active quest for the player, a person the player is talking to, children (always, unless config says otherwise). They can't be the target of a violent action and don't die by another NPC's action; they can still be insulted.
   - **Violence flag:** `config.choice.violence` (`CHOICE_VIOLENCE=on|off`, default **off**) gates `violent` actions (the open decision in the overview).
8. **Every choice that does something is an event** with `why` = the top three score parts, and `causedBy` = the grievance or need that drove it (N20's refs). Routine habit choices (work, sleep, eat on schedule) are not events (too many); a log of the last 48 choices per talker is kept in memory for the admin (and per pinned person persisted in a small `choices` table for N17's follow view).
9. **The player uses the same apply functions.** When the player insults, steals or confronts, the web action calls the action's `apply` (with the player as actor) after its own validation, so the effects and events are identical. The player doesn't score or roll.
10. **The model narrates only.** Asked "why did you do that?", a talker's reply is given the score parts (`choice-reason` call kind, or the parts in words as the fallback). Daily plans (planning.ts) are fed the top choices for flavour; they still never act.
11. **Rollout in the order the stage file says:** 3–4 talkers in the start town behind `CHOICE=proto` (a list of ids), then all talkers (`CHOICE=talkers`), then townsfolk (`CHOICE=all`, the default once N22's bounds hold). Each stage of the rollout is a commit with its tests.

## Data shapes

```ts
interface ChoiceCtx { who: PersonRef; grain: "hour" | "day"; day: number; hour: number; site: string; place?: PlaceId; needs?: Needs; traits: TraitSet; goals: NpcGoal[]; grievances: Array<{ against: string; weight: number }>; present: string[]; mood?: PlaceMood; money: number; habit: { activity: Activity; place: PlaceId } }
interface Option { action: string; target?: string; place?: string; item?: string }
interface Scored { score: number; parts: Array<[string, number]> }
interface ChoiceLog { who: string; day: number; hour: number; options: Array<Option & Scored>; picked: number; T: number; roll: number }
```

## Steps

### Step 1: the frame, two actions, one NPC
- `choice/` with `work` and `eat` wrapping today's code; `run.ts` called in `passTime` behind `CHOICE=proto`; with all weights at habit, behaviour equals today's.
- Test: with `CHOICE=proto` and only habit actions, a day's world hash equals the hash without it (no behaviour change).

### Step 2: the rest of the menu
- One commit per few actions: `rest/sleep`, `gossip`, `buy/sell`; `court`; `confront`, `insult`, `revenge`, `spread_rumour`; `recruit`, `travel`; `steal`, `attack` (violent).
- Each action's test: available when it should be, scored by its features, applied through the existing code.

### Step 3: temperature and streams
- Softmax by traits; per-NPC streams; make sure no simulation path uses `Math.random` (grep, and a test that runs with `Math.random` stubbed to throw).
- Test (done-when): the same seed plays a day the same twice (hash); a different seed differs.

### Step 4: guardrails
- Cooldowns, loop damping, caps, protection, the violence flag.
- Test (done-when): nobody loops on one action over a simulated week (max run of the same non-habit action ≤ 3); fights per place per day ≤ cap; protected people are never targets of violence.

### Step 5: the done-when pair
- Test (done-when): a hungry, wronged, bold commoner (set needs, a grievance against a noble present in the square, high bravery) confronts the noble instead of going to work; a cautious NPC in the same spot (same needs and grievance, low bravery/high caution) doesn't. Both on fixed seeds, with the score parts asserted.

### Step 6: townsfolk at coarse grain
- Daily menu for townsfolk in the life step; overrides sent to the browser; the crowd shows them.
- Test: live and lazy give the same choices (hash); a townsperson with a strong grievance and a confront choice shows up at the target's place that day in the crowd plan.

### Step 7: the admin explains every choice
- Admin person card: the last choices with options, scores, parts, T and the roll; a "why" line on every choice event. Client view in [`admin/views/pinned.ts`](../../../packages/client/src/admin/views/pinned.ts).
- Test (done-when): every non-habit choice event has a `why` with its parts; the admin endpoint returns the options and scores for a talker's last hour.

### Step 8: the player in the same menu; words; docs
- Player actions call `apply`; `choice-reason` call kind; daily plans fed the choices.
- README: NPCs choose; the violence flag; how to read the admin's choice view.

## Balance bounds

- `no-loops`: max run of a non-habit action per person under 4.
- `work-still-happens`: most adults still work most work hours (habit wins usually).
- `violence-rare`: violent actions per place per season under a cap; deaths by NPC action a small share of deaths.
- `choices-cost`: an hour of choices in a capital's talkers under the N19 budget.

## Edge cases and traps

- **Behaviour drift in old tests:** with the menu on, many N4–N12 tests that assume an NPC is at the forge at 10:00 may break. Step 1's "habit only" equality test is the guard: turn actions on one by one and fix tests deliberately, saying why.
- **The crowd's plan is shared code.** A townsperson's override must be in the roster data the browser has; don't make the browser ask per person.
- **Order of choosers:** in one hour, choosers act in id order; an action that changes another's options (an attack) affects later choosers in the same hour. Deterministic by the sort.
- **Talking to the player suspends choosing** for that talker (they're busy talking), as `keep` does in `passHours`.
- **Don't let the model's daily plans and the menu disagree visibly:** the plan's words are made from the choices, not the other way.

## Tests (`packages/server/tests/n38.test.ts`)

The done-when ones:
- With the same seed a day plays the same twice; with a different seed it differs.
- A hungry, wronged, bold commoner confronts the noble instead of going to work; a cautious NPC in the same spot doesn't.
- Nobody loops on one action.
- The admin view explains every choice.

## Done when (mapped)

| Done-when clause | Proved by |
|---|---|
| with the same seed a day plays the same twice, with a different seed it differs | step 3 test |
| a hungry, wronged, bold commoner confronts the noble instead of going to work; a cautious NPC in the same spot doesn't | step 5 test |
| nobody loops on one action | step 4 test |
| the admin view explains every choice | step 7 test |

## Questions for the user

1. The violence flag: keep `CHOICE_VIOLENCE` off by default until N22's bounds hold (the overview's default), or on once step 4's caps pass?
2. Who is protected? Default: companions, active quest-givers, children, and whoever the player is talking to. Should the player's spouse and children (N66) be protected too?

**Save:** the next schema version (`choices` for pinned people); NpcState gains `cooldowns` (the next save version).

## Slice cut

Steps 1–5 and 7 for the talkers of the start town and its liege town; step 6 (townsfolk) for those two places only; violence off.

## Out of scope

Life goals (N40 adds ambition as a score input). Leisure as its own family of actions (N41). Taking jobs from boards (N42). Seeking out the player (N67).
