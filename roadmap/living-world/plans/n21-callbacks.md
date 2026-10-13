[← Plans](README.md) · [Stage 1: N21](../stage-1-foundations.md#n21-callbacks-to-the-players-choices)

# N21 plan: Callbacks to the player's choices

**In one line:** when a notable event traces back to something the player did, someone who'd know tells them, or the journal links it, never revealing more than the player could learn.

**Read first:** [plans README](README.md) sections 3 (truth vs knowledge), 4 (model writes only words). Needs N20 (cause links, `chainBack`) and N24 (`playerKnows`, the player's knowledge). If N24 isn't built yet, build its `player.known` step first (it's small) or this phase can't gate what it tells.

## What exists

- N20: every event has `causedBy`; `chainBack(ref, depth)`; stories with scores.
- The journal ([`journal.ts`](../../../packages/server/src/game/journal.ts)): `note(player, { id, day, text, npc?, kind })`, kinds `secret | love | fear | promise | name | quest | lie | favour | rumour | family`. Filled by code, never by the model.
- NPC prompts get facts from lore (`learnLore`, `knownLore` in [`knowledge.ts`](../../../packages/server/src/npc/knowledge.ts)), rumours, and memory. An NPC says what it knows in its own words.
- Player-actor events: `actor === "player"` with kinds like `gift`, `attacked`, `theft`, `promise-kept`, `subdued` (spared?), `killed`, `rumour` (if the player started one), `quest-done`.

## Decisions made in this plan

1. **What counts as a player choice.** A fixed list in `stories/choices.ts`: events with `actor === "player"` and kind in {`killed`, `subdued` (spared), `theft`, `gift`, `promise-kept`, `promise-broken`, `favour`, `rumour`, `quest-done`, `quest-failed`, `attacked`, `lied-to`, `amends`}, plus any player choice later phases add (N38+). **"Spared"** needs to be an event: today, letting a subdued foe live may not record one. Add kind `spared` (actor player, target the foe) wherever a subdued NPC or figure is let go; it's the classic callback.
2. **Which outcomes are worth telling.** An event is a callback candidate if it's notable: importance ≥ 7, or a death of someone with renown ≥ 25, or the sink of a story with score ≥ a bar, or it touches ≥ 2 places. Then `chainBack(outcome, 4)`: if a player choice is within 4 steps, it's a callback `{ choice, outcome, path }`.
3. **Who may tell, and when.** The player may learn a callback only if they could have learned both ends:
   - **The outcome:** `playerKnows(outcome)` (N24), now or later; and
   - **The link:** someone the player meets who knows the choice *and* the outcome (`knowsEvent` on both, or both are rumours they hold) can say it. Or the player witnessed both. Or it's public enough (a song, N68; a proclamation).
   A callback waits (stored as pending) until one of those holds. It's never pushed into the feed as a fact out of nowhere.
4. **How it's told.**
   - **By an NPC:** the teller's next conversation with the player gets one line of context: "You know: <choice in plain words> (you heard it from …); and <outcome>. If it comes up naturally, you may tell the player one led to the other." The model phrases it; the facts and names come from code. The line is added at most once; whether the NPC actually said it is checked afterwards by matching the outcome's key names in the reply (if not said, it stays pending for another chance or another teller).
   - **By the journal:** when the player already knows both ends, add a journal note of a new kind `consequence` ("Odo, whom you spared on day 12, led the revolt at Ashby on day 40."), written from a template by code. The journal links to both events.
   - **By a song or legend:** N68 later.
5. **Rate limits.** At most one told callback per game day; at most one per chain (by outcome ref); never the same choice twice in 3 days unless the outcome is a death. Order pending callbacks by score (the outcome's story score, or importance) and drop ones older than 2 game years.

## Data shapes

```ts
// stories/callbacks.ts
export interface Callback {
  id: string;               // cb:<outcome ref>
  choice: string;           // player-choice event ref
  outcome: string;          // notable event ref
  path: string[];           // refs from choice to outcome
  score: number;
  found: number;            // day found
  told?: { day: number; by: "npc" | "journal" | "song"; npc?: string };
}
```

Keep pending and told callbacks in the save (`world.callbacks`, capped at 50 pending, oldest dropped) or a `callbacks` table; the table is better (they're queried by teller).

## Steps

### Step 1: the `spared` event and the choices list
- Find where a subdued foe is let go (`subdued` in actions/combat, creature defeat paths, figures beaten in the realm by the player) and record `spared`. Add to `EVENT_KINDS`.
- `stories/choices.ts`: `isPlayerChoice(event)`.

### Step 2: finding callbacks
- Daily, after N20's story detector: for each notable event of the day (decision 2), `chainBack` up to 4; for each player choice found, make a `Callback` (dedupe by outcome).
- Also run when an older outcome becomes notable later (a story grows): re-check stories that grew today.
- Test with hand-built chains first (a fixture world with events and causes): choice → x → y → outcome is found at depth 3; at depth 5 it isn't.

### Step 3: the gate
- `canTell(cb, teller)`: teller knows both ends (`knowsEvent` or a rumour about each). `playerCanLearn(cb)`: `playerKnows(outcome)` or will on hearing it (the teller tells both).
- `tellersNear(cb)`: NPCs at the player's site who pass `canTell`, best first (relationship to the player, then who knows most).
- Pending callbacks are checked when the player starts a conversation (cheap: the list is small).

### Step 4: telling through an NPC
- In the prompt builder (where NPC context lines are assembled; look in `npc/persona.ts`/`NpcAgent`), add an optional "something you could tell" line from the top pending callback the NPC can tell. Wording template for the facts: per choice kind ("spared <name> when you could have killed them", "stole bread from <name>'s stall"), per outcome kind ("led the revolt at <place>", "started the riot in <place>").
- After the NPC's reply, check it mentions the outcome's names; if so mark told (`by: "npc"`), add the journal `consequence` note, and record an event `callback-told` (so N20's metrics count it).
- Invented-name check on the reply as usual.

### Step 5: telling through the journal
- When the player knows both ends already (they witnessed or heard both), and no NPC has told it within 2 days, add the journal note directly (`by: "journal"`). The client's journal shows `consequence` notes with links to both events (the event detail can open in the existing journal panel).

### Step 6: rate limits, admin, docs
- Rate limits per decision 5 in one function, tested.
- Admin (N17): a Callbacks panel: pending and told, with the path drawn.
- README and the stage file.

## Edge cases and traps

- **Never tell what the teller can't know.** The NPC context line is the risky part: if the teller doesn't know the choice, they must not be given it. Unit-test `canTell` with a teller who knows only the outcome.
- **Callbacks about the player's crimes** can incriminate them. An NPC telling the player "you stole that bread" is fine; that NPC also now knows of the theft and may act (N47/N48 later). Make sure telling a callback doesn't secretly add knowledge the NPC didn't have (it only uses what they knew).
- **Long chains are rare early.** Until N38 makes NPCs act, few chains reach 4 steps. Don't loosen the depth to compensate; the done-when scenarios come with later systems (see below).
- **Spoilers via the journal:** the journal only writes callbacks whose ends the player already knows. Test it.

## Tests (`packages/server/tests/n21.test.ts`)

- Finding: hand-built chain of depth 3 from a `spared` event to a notable outcome → one callback; depth 5 → none; a non-player root → none.
- Gate: a teller who knows only the outcome isn't offered the callback; one who knows both is.
- Telling: with a `FakeProvider` reply that names the outcome, the callback is marked told, the journal gets a `consequence` note, a `callback-told` event is recorded. With a reply that doesn't, it stays pending.
- Journal-only path: the player witnessed both ends → after 2 days with no teller, the journal note appears.
- Rate limit: three callbacks ready on one day → one told that day.

## Done when (mapped)

The stage file's scenarios need systems that come later: revolts (N56) and riots (N56/N37). Build and test the machinery now with the closest existing chains, and add the exact scenarios when those phases land:

| Done-when clause | Now | When the system exists |
|---|---|---|
| the serf the player spared leads a revolt a season later and someone tells the player so | a spared bandit → leads a raid (realm `raid` caused by the bandit's figure) → a villager who knows both tells the player | add the revolt version as a test in N56 |
| the bread the player stole is traced in the journal to the riot it helped start | a theft → `theft-caught`/crime → a price rise or a guard crackdown event, traced in the journal | add the riot version in N56 |

Mark the phase `[~]` until those tests exist, with a note pointing at N56.

## Slice cut

Not in the slice.

## Out of scope

Songs (N68). The player's journal UI redesign (N65).
