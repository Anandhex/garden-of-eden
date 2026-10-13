[← Plans](README.md) · [Stage 2: N25b](../stage-2-everyone-lives.md#n25b-lives-that-change)

# N25b plan: Lives that change

> **Built 2026-10-13.** Read the plan as the design; what differs in the build (townsfolk outlook on the row, which shock sources are wired, the flat reply schema) is listed under *Built* in [the stage file](../stage-2-everyone-lives.md#n25b-lives-that-change).

**In one line:** every person's opinions, feelings, goals, secrets and story keep changing with what happens to them, to the people close to them, and in the town they live in. For talking NPCs the model proposes the changes in a periodic **life review**, using what they remember (recalled by meaning through embeddings), what their friends, family and rivals think and do, and their town's recent events. Code checks every proposal before applying it. For everyone else, code makes the same kinds of change by rules.

**User request (2026-10-13):** "can the model generate … stories, everything under this, and change people's things periodically, like their opinions and their life surrounding; this applies to all the NPCs", and "the embeddings and their relations with other NPCs can be used to update their things, and also recent events in the place they live."

**Builds on:** [N25a](n25a-a-world-without-a-centre.md) (every talker generated; step 5 writes their first story and depth; per-site state; talkers registry), [N25](n25-townsfolk-lives.md) (people rows, family, `site_days`), [N18](n18-scale-and-storage.md) (SQLite: `memories` with embeddings, empty `relationships`/`knowledge`/`grievances`/`ambitions` tables), [N19](n19-performance-and-budgets.md) (call kinds, caps, priority queue, fallbacks), and N20 (cause links) if built. Built **right after N25a, before N26.**

**Read first:** [plans README](README.md) sections 2 (determinism; record model output), 3 (truth vs knowledge: people change only from what *they* know), 4 (the model writes words and proposes; code decides), 9 (the 8 GB machine).

---

## What exists

- **Opinions** are relationship axes: an NPC's view of the player (`trust`, `affection`, `respect`, `fear` on `NpcState`, [`npc/relationship.ts`](../../../packages/server/src/npc/relationship.ts) `adjust`) and of other NPCs (`state.npcRelations`, [`npc/social.ts`](../../../packages/server/src/npc/social.ts) `relationTo`, `adjustRelation`, `isFriend`, `isEnemy`, `credence`). Grudges (`setGrudge`, `holdsGrudge`), emotions (`state.emotions`, [`npc/emotions.ts`](../../../packages/server/src/npc/emotions.ts)), goals (`state.goals`), rumours (`state.rumours`), lore known (`state.learned`).
- **Changes today come from code hooks on events:** gossip moves trust ([`gossip.ts`](../../../packages/server/src/game/gossip.ts)), events change mood and memory (`remember` in `npc/memory.ts`), N9's trait drift ([`npc/growth.ts`](../../../packages/server/src/npc/growth.ts) `driftTrait`), and N12's nightly chronicle, where **the model proposes trait drift and code validates it** ([`director/chronicle.ts`](../../../packages/server/src/director/chronicle.ts), [`director/validator.ts`](../../../packages/server/src/director/validator.ts)). That chronicle is the pattern this phase generalises.
- **Embeddings:** `WorldStore.addMemory(npc, day, kind, text, importance)` and `recall(npc, query, k)` ([`game/db.ts`](../../../packages/server/src/game/db.ts)) store and search an NPC's memories by meaning, with a local embedding model (`nomic-embed-text`) or a hashed bag of words. Today only conversation summaries with the player are stored, and only conversation recalls them.
- **Places:** N25a's `world.sites[site]` (recent events, raid day, arrivals), N25's `site_days` (food, raids, war per day), events with a `site` column (N18).
- **Budgets:** a game day is 48 real minutes; a background call is about 3 s. That's at most ~960 calls a game day; leaving room for conversation, ~300 are usable for background work (N19's numbers in [`budgets.ts`](../../../packages/server/src/budgets.ts)).

## Decisions made in this plan

1. **Three tiers of change, one set of rules.** All three tiers change the same things (opinions, feelings, goals, grudges, secrets, life story) with the same limits. They differ in who proposes:

   | Who | Who proposes the change | How often |
   |---|---|---|
   | Talkers at the player's site (and companions) | the model, in a **life review**, several people per call | every `REVIEW_EVERY_DAYS` (default 3), **at once after a big event** |
   | Talkers elsewhere | the model, batched | on activation (one review covering the time away), and every few cycles if the budget has room; **at once after a big event** if the budget allows, else code |
   | Everyone else (~25,000 people rows) | **code rules** (the same kinds of change, from the same inputs, without words) | every `REVIEW_EVERY_DAYS`, **at once after a big event** |

   When the model is off or over budget, a talker gets the code rules too, so nobody stops changing.
2. **Code gathers the inputs; the model proposes; code checks and applies.** The model never sees the whole world, never changes state directly, and never decides that something happened.
3. **People change only from what they know** (README section 3): events they witnessed or heard of (`knowsEvent`, rumours, delivered news), their own memories, their own relationships. A review never gets an event they don't know.
4. **The three inputs the user asked for are first-class:**
   - **Memories by meaning (embeddings).** The review's query is built from what's new (today's events they know, in a sentence each). `recall(npc, query, k = 4)` brings back older memories close in meaning ("the last time wolves came", "when the lord raised the tithe"), so reactions have history: a second raid hurts more than the first; a friend's kindness recalls an old debt. **Every review's outcome is itself stored as a memory** (`kind: "reflection"`), so the next review can recall how they felt before. To keep the store sane, memories are only for talkers (vectors cost space and embedding calls); townsfolk get no vectors.
   - **Relations with other NPCs.** Each review includes the people who matter to them (top by strength of relationship, plus family): how each has changed lately, and **what those people think** about the things in question (their opinion of the player, of the lord, of a faction), weighted by how much this person trusts them (`credence`). That's how opinions spread through a town: a man whose wife distrusts the newcomer drifts the same way; a gang member follows his chief's grudge. Code applies the same **social pull** to townsfolk without words (decision 8).
   - **Recent events in the place they live.** The site's events of the last days (known to them: local events are known to the people of the place who were awake, or heard by gossip), and its conditions (`site_days`: hunger, raids, war, prices, a new lord, a crackdown), so a famine sours everyone a little and a festival lifts them.
5. **A fixed proposal format, small and checkable.** The model returns structured JSON (zod schema): a list of **changes**, each one of a known kind, each citing the reason as one or more refs (event ids, memory ids, person ids from the input) and one sentence of why. No change without a valid ref.
6. **Hard limits per review** (all in `budgets.ts`/config, tunable): an opinion axis moves at most ±10 per review (±20 in a shock review, decision 7); at most 6 changes per review; at most 1 new secret, 1 new fear/love, 1 goal change, 1 arc step; traits (N9) drift only through the existing `driftTrait` limits. Anything over a limit is clipped, not rejected, and the clip is logged.
7. **Batched by time, immediate for big events (user decision 2026-10-13).** Ordinary days don't change people much, so reviews run on a cycle and catch up on everything since the last one; a war, a famine, a raid or a death in the family changes a life at once, so it triggers a review **that day**:
   - **The cycle:** every `REVIEW_EVERY_DAYS` days (config, default 3, a season with 12-day years). Each person's review day is spread by a seeded offset, `(day + offset(personId)) % REVIEW_EVERY_DAYS === 0`, so a town's reviews are spread across the days instead of all landing on one. A cycle review covers everything since the last review (the inputs are gathered for the whole period and capped).
   - **Big events ("shocks"):** each event gets an **impact** on each person = event weight × closeness. Weights (config): death in the family 9, enslaved or freed 9, war declared on their kingdom or their town besieged 8, famine starting in their town 8, plague in their town 8 (N61), a raid on their town 7, attacked or robbed 7, lost their job or home 7, their lord or ruler killed or replaced 6, a marriage or birth in the family 6, a crackdown in their town 6 (N58). Closeness: themselves 1.0, household and close family 0.8, close friends and master 0.6, their town 0.5, their kingdom 0.3. Impact ≥ `SHOCK_IMPACT` (default 5) → a **shock review** that day: talkers through the model at high priority, townsfolk through the code rules at once. Shock reviews get the bigger limits (decision 6) and restart the person's cycle (the next cycle review is `REVIEW_EVERY_DAYS` later).
   - **Batching people into one model call:** up to `REVIEW_BATCH` talkers (default 3) per call, grouped by what they share: the same household, then the same town and the same shock. The shared part (the town's events and conditions, the shock) is written once; each person gets their own section (what *they* know, their memories, their people) and their own list of changes in the reply. With N19's 4,096-token context that's ~400 shared tokens + ~350 per person, so 3 fit. Each person's changes are checked against **their own section only**, so one person can't pick up what another knows.
   - **Load:** 30 talkers in a town on a 3-day cycle in batches of 3 is about 4 calls a game day; a raid on that town adds about 10 calls that day. Both are small next to the ~300 usable background calls a game day.
8. **Code rules for everyone (and the fallback):** per person, on their cycle day and on a shock, deterministic (`streamFor(seed, "life-review", personId, day)`):
   - opinions move by the events they know (existing hooks) and by **social pull**: each relation axis drifts a small step toward the average of what their close people think, weighted by trust (e.g. 5% of the gap per day since the last review, capped);
   - mood/emotions from site conditions (hunger, raids, a death in the family: grief for N days);
   - goals from triggers (a debt due → "pay off the moneylender"; kin killed by wolves → "see the pack culled"; a famine → "move to a better place", which N25 migration already reads);
   - grudges from harm by a known actor; settled with time and amends as today.
   The code rules write no words; when a townsperson becomes a talker, N25a step 5 writes their story from these accumulated facts.
9. **Stories change too.** A talker's `backstory` gets an addition when their life turns (a marriage, a death in the family, a new job, a crime, a betrayal): the review may propose a `story` change ("Since the raid took her brother she has hardly spoken"), one or two sentences appended, never rewriting facts. Code also adds a plain line from the event when the model doesn't. N20's stories (chains across people) are separate and get their words from N20.
10. **Everything is recorded and visible.** Each applied change is an event `changed-mind` (or `new-fear`, `new-goal`, `secret-made`, `story-turn`) with the review's sentence as `why`, `causedBy` the cited refs (N20), stored with the proposal and the clip notes in a `life_reviews` table. The admin view shows a person's review history. The accepted output is in N23's input journal, so replays don't need the model.

## Data shapes

```ts
// server/src/npc/review/types.ts
export const CHANGE_KINDS = [
  "opinion",      // { about: personRef | "player" | factionId | siteId, axis: "trust"|"affection"|"respect"|"fear", delta }
  "emotion",      // { emotion: Emotion, strength: 1..3, days }
  "goal-add",     // { goal: GoalKind, target?: ref, words }
  "goal-drop",    // { goalId }
  "grudge",       // { against: ref }
  "forgive",      // { grudgeAgainst: ref }
  "fear", "love", // { what: species | place | person | thing, words }
  "secret",       // { candidateId, words }   (a candidate from code's facts, as in N25a 5a)
  "belief",       // { rumourKey, accept: boolean }   (believe or dismiss a rumour they hold)
  "arc-step",     // { arcId, step, words }
  "story",        // { words }   (append to backstory)
] as const;

export interface ReviewInput {
  who: PersonaSummary;                 // name, job, class, site, traits, current goals, fears, loves, secrets (theirs only)
  since: number;                       // day of their last review
  news: Array<{ ref: string; text: string; importance: number }>;          // events they know since `since`
  recalled: Array<{ ref: string; day: number; text: string }>;            // memories by meaning (embeddings)
  people: Array<{ ref: string; name: string; tie: string; myView: Axes; theirViews: Array<{ about: string; axes: Axes }>; recent: string[] }>;
  place: { site: string; name: string; conditions: string[]; events: Array<{ ref: string; text: string }> };
  opinions: Array<{ about: string; axes: Axes }>;                          // their current views of the subjects in play
}

export interface ReviewProposal { changes: Array<{ kind: ChangeKind; args: unknown; because: string[]; why: string }>; mood?: string }
```

SQLite: `life_reviews(id, who, day, input_hash, proposal JSON, applied JSON, clipped JSON, rejected JSON, by "model"|"code")`, indexed by `(who, day)`. Townsfolk opinions use N18's `relationships` table (sparse: only pairs that exist: family, master, neighbours by house, faction comrades); their goals and grudges use `ambitions` and `grievances`.

## Steps

### Step 1: the inputs
- `server/src/npc/review/inputs.ts`: `reviewInput(world, store, who, sinceDay)`. Pieces:
  - **news:** events `who` knows (`knowsEvent` in the store, delivered news, rumours heard) since `sinceDay`, top 8 by importance, each as a short sentence (reuse `witnessedText` and the realm news text).
  - **recalled:** build a query string from the news sentences; `store.recall(who, query, 4)`; skip memories already in `news`.
  - **people:** the 5–6 strongest relations (by |trust| + |affection|, plus spouse/parents/children always), each with this person's view of them, **their** views of the subjects in this review (the player if the player is in the news, the lord, the factions involved), and their own recent life events (died, married, robbed, took a new job).
  - **place:** the site's conditions from `site_days` and N25a site state (in words: "food is short", "raided 2 days ago", "the kingdom is at war", "a new lord"), and its recent events that `who` knows.
  - **opinions:** their current axes toward each subject in play.
- Keep the whole input under ~1,200 tokens (N19: `contextTokenBudget`); trim lowest-importance items first.
- Tests: a person who didn't witness or hear of an event never gets it; the recalled memories are the most similar ones (with the hashed embedder in tests); the people list includes family even when the relationship is weak.

### Step 2: the code rules (for everyone, and the fallback)
- `server/src/npc/review/rules.ts`: `ruleChanges(input-like facts, rng)` → `ReviewProposal` with the same change kinds and refs, no model. Social pull, conditions → emotions, triggers → goals, harm → grudges, time → forgiveness (decision 8).
- Hook into N25's people step for townsfolk: each day, only people whose cycle day it is (about a third of them with the default) or who were hit by a shock run the rules, over the days since their last review. Keep it inside N19's `dayCoarseMs`. Lazy catch-up (N25) runs the cycle days and shocks in order, so it gives the same result as running daily.
- Tests: in a village where the lord raised the tithe and a friend of mine distrusts him, my trust in the lord falls over days; a famine makes most people's mood worse and some add a "move" goal (and N25 migration acts on it); two families with a killing between them hold grudges.

### Step 3: the model's review
- `server/src/npc/review/model.ts`: `modelReview(llm, input)` → `ReviewProposal | null` with `structured(…, { kind: "life-review" })`. System prompt: "You are deciding how {name} feels after these days. Propose only changes that follow from the items given, cite their refs, keep it small and in character." Few-shot examples in the prompt from a fixture.
- Add `life-review` to `CALL_KINDS` (after `persona-story`, before `chronicle`), `perGameDay` (start at 30 calls: batching makes each call cover up to 3 people), `expectedMs` (≈ 6,000 for a batch of 3). Priority inside the kind: shocks at the player's site first, then other shocks by impact, then cycle reviews at the player's site and companions, then the rest.
- `modelReviewBatch(llm, inputs[])`: the prompt has one shared section and one section per person (keyed by person ref); the reply schema is `{ people: { [ref]: ReviewProposal } }`. A person missing from the reply, or with an invalid proposal, gets the code rules.
- Tests with `FakeProvider`: a good reply produces the expected changes; malformed JSON → `null` → code rules.

### Step 4: the checks
- `server/src/npc/review/validate.ts`: for each proposed change: the kind is known; every `because` ref was in the input; subjects exist and `who` knows of them; the arguments are in range; the invented-name check on words; content rules (minors, romance off); no contradiction of facts (no grudge against someone they've never heard of; no forgiveness of a grudge they don't hold; no `secret` that isn't a real candidate). Then the limits (decision 6): clip deltas, cap counts.
- Output: `{ applied, clipped, rejected }` with reasons, all stored in `life_reviews`.
- Tests: an invented person, a ref not in the input, a delta of 50, a second new secret, romance for a minor → rejected or clipped with the right reason.

### Step 5: applying changes
- `server/src/npc/review/apply.ts`: each change kind maps to existing functions: `opinion` → `adjust`/`adjustRelation` (player / NPC), faction stances via `standing`, site opinion via a new `state.placeViews`; `emotion` → `npc/emotions.ts`; goals → `state.goals`; grudges → `setGrudge`/`settleGrudge`; fears/loves/secrets → persona fields (talkers' personas are saved in the talkers registry); `belief` → rumour `accuracy` 1 or drop; `arc-step` → N9 arcs; `story` → append to `backstory` (max length; oldest additions summarised by code into one line).
- Each change records its event (decision 10) with `why` and `causedBy`.
- **Store the reflection as a memory:** one `addMemory(who, day, "reflection", "<one-sentence summary of what changed and why>", importance)` per review, so later recalls find it.
- Tests: after a review, the NPC's next conversation prompt reflects the change (their mood line, their goal, their view of the player); the memory is recalled by a related query a week later.

### Step 6: when reviews happen (cycles and shocks)
- `server/src/npc/review/schedule.ts`:
  - `cycleDue(person, day)`: `(day + offset(person)) % REVIEW_EVERY_DAYS === 0`, offset from `streamFor(seed, "review-offset", personId)`.
  - `impacts(event, world)`: for each new event of the day, the people it hits and how hard (decision 7's weights × closeness: the person, their household and family via N25 rows, their close relations, their town's people, their kingdom's people). Town- and kingdom-wide events (war, famine, plague) hit everyone there at once.
  - Each day, at a quiet hour: collect **shock reviews** (impact ≥ `SHOCK_IMPACT`) and **cycle reviews** (`cycleDue`) for talkers at the player's site and companions; group them into batches (decision 7) and queue them. Talkers elsewhere: shocks are queued if the budget's estimated wait is low (else code rules at once); cycle reviews elsewhere run every few cycles when there's room.
  - On `activate(site)` (N25a): one review per talker there covering `since = lastReview` (one batched call per group, not one per missed cycle).
  - Townsfolk: code rules on their cycle day and on shocks, in the people step.
- If a model review is dropped (over budget) or a person is missing from a batch reply, run the code rules for that person immediately.
- Tests:
  - on quiet days each person is reviewed once every `REVIEW_EVERY_DAYS`, and a town's reviews spread across the days (no day has more than about a third plus rounding);
  - war declared on a kingdom → every person in it gets a shock review that day (talkers by the model, townsfolk by code), with the bigger limits; a raid on one town shocks its people but not a town far away; a death shocks the family that day and their close friends only if the impact passes the bar;
  - a batch of 3 is one call; one person's changes citing another person's refs are rejected;
  - a busy simulated week (fake provider with realistic latency, a war starting mid-week) stays inside N19's caps and tick budgets; dropped reviews fall back to code; the player's first-token time is unaffected (N19's pre-emption test extended);
  - lazy catch-up of a town over 30 days gives the same opinions as running it daily.

### Step 7: the admin view and docs
- N17 person card: a **Life reviews** section: date, inputs (collapsed), proposal, what was applied/clipped/rejected and why; and a small chart of their view of the player and of their lord over time.
- README: how people change, what the model does and doesn't decide, the budgets, `DIRECTOR=off` behaviour.

## Balance bounds (add to `balance/bounds.ts`, N22)

- `opinions-not-frozen`: across a town, the spread of trust in the lord changes over a year.
- `opinions-not-runaway`: no more than a share of people at the extremes (±90) of any axis.
- `goals-churn`: goals change at a moderate rate (not every day, not never).
- `grudges-settle`: most grudges end within a band of days unless refreshed.
- `secrets-real`: every secret has a live fact behind it (a debt still owed, a crime still unknown to some).

## Edge cases and traps

- **Echo chambers and runaway opinions.** Social pull plus model reviews can drive a whole town to an extreme. The per-review limits, a pull capped at a fraction of the gap, and a slow drift back toward the person's baseline traits keep it bounded; the `opinions-not-runaway` bound checks it.
- **Small-model nonsense.** Expect many proposals to be clipped or rejected; that's fine. Log the rejection rate per day in the admin health panel; if it's very high, improve the prompt and examples, don't loosen the checks.
- **Leaking knowledge.** The input must only hold what the person knows. One test per input piece.
- **Embedding cost.** Each review adds one memory (one embedding call, cheap and local) and one `recall` (a scan of that NPC's memories). Cap memories per talker (e.g. 400, pruning the least important and oldest reflections) so recall stays fast.
- **Determinism.** Model outputs are non-deterministic: record the accepted proposal (N23 journal) and replay it. The code rules use per-person streams.
- **Dead or absent people.** Reviews skip the dead and the dormant; a person's death triggers reviews for their family (grief).
- **Contradicting authored-by-code mechanics.** The model can't set prices, stock, hire terms, services or successors (those stay code's), so economic balance isn't at the model's mercy.

## Tests (`packages/server/tests/n25b.test.ts`)

- Inputs only hold what the person knows; recalled memories are by meaning; family always included.
- Code rules: social pull, famine mood, debt goal, grudges and forgiveness (step 2's cases).
- Model path with `FakeProvider`: good proposals applied; bad ones clipped or rejected with reasons; a review stored as a reflection memory and recalled later.
- Scheduling: cycle reviews every `REVIEW_EVERY_DAYS` spread by offset; shock reviews the same day for war, famine, raids and family deaths, with impact by closeness; batches of 3 per call with no knowledge leaking between them; one catch-up review on activation; code fallback when dropped; budgets held over a busy week with a war.
- **Done-when scenarios** (model off, so deterministic, plus one run with a scripted fake reply): after the player robs a woman's brother, her trust in the player falls at her next review even though she didn't see it (her brother told her), and her friend's falls a little later through social pull; when war is declared on their kingdom, everyone in it changes that day (fear up, trust in the ruler moved, some take a goal to flee or to join up); a famine in a town worsens the mood of most of its people and some decide to move; a widow's backstory gains a line about her husband's death; the admin view shows the review that made each change and why.

## Done when

- Every person is reviewed every few days (`REVIEW_EVERY_DAYS`), and **the same day** when a big event hits their life (war, famine, a raid, a death in the family), talkers in batches through the model, everyone else by code; and their opinions, feelings, goals, grudges, secrets and story change from what they know, the memories it calls up by meaning, what the people close to them think, and what's happening in their town.
- Every townsperson changes by code rules from the same three inputs (without words).
- Every change is checked, limited, recorded with its reason, and visible in the admin view; the model never decides a fact.
- With the model off, everyone still changes; with it on, a busy week stays inside N19's budgets and conversation isn't slowed.

## Slice cut

In the slice: steps 1–6 for the talkers of the start town and its liege town; the code rules for their townsfolk. The admin section (step 7) can be minimal.

## Out of scope

NPCs **acting** on their changed goals (plotting, leaving, attacking): N37/N38/N40. Shaping beliefs on purpose (preaching, propaganda): N52. Secrets being found out and used: N46.
