[← Plans](README.md) · [Stage 2: N34](../stage-2-everyone-lives.md#n34-following-people-in-the-game)

# N34 plan: Following people in the game

**In one line:** the player marks people to follow; any knowledge about them that reaches the player (N33's gossip, N24's news, a letter) is flagged, kept and shown in a followed list with their last *known* whereabouts; followed people who care about the player write letters, which are carried by real carriers and arrive days later; the player can write back.

**Read first:** [plans README](README.md) sections 3 (truth and knowledge), 11 (N24 stub), 19 (model call kinds). Needs N24 (`playerKnows`, `playerLearns`), N33 (knowledge refs and carriers, `journey.carries`). N35 uses this list for "wake me when…"; N44 adds the nemesis; N65 shows the list in the journal.

## What exists

- **The admin's pins** (N17, [`admin/person.ts`](../../../packages/server/src/admin/person.ts) `pinned`, client [`admin/pins.ts`](../../../packages/client/src/admin/pins.ts)): pin anyone and see the truth. This phase is the player's version, bound by knowledge.
- **Life events of townsfolk** are written to the events table by [`people/events.ts`](../../../packages/server/src/game/people/events.ts) (`recordLifeEvent`: births, deaths, marriages, moves) with deterministic ids; talkers' events by `recordEvent`. N33 makes them knowable refs (`e:<id>`, `d:<personId>`).
- **Person refs** through [`people/index.ts`](../../../packages/server/src/game/people/index.ts) (`personRef`, `rowOf`, `describeRow`).
- **The journal** ([`journal.ts`](../../../packages/server/src/game/journal.ts)) has kinds for notes; no people list.
- **Carriers:** after N26 Part E, every traveller is a real person on a journey and news is swapped at inns (`exchangeNews`); N33 makes what they carry their own knowledge rows.

## Decisions made in this plan

1. **Following is a player record.** `player.follows: Record<personRef, { since: number; why: "friend" | "family" | "rival" | "nemesis" | "famous" | "chosen"; lastKnown?: { site: string | null; day: number; how: string; sure: number } }>`. The player follows by an action on any person they know (talk menu, journal); family and the nemesis (N44) are followed automatically (can be unfollowed). Cap 30.
2. **News of them is knowledge that mentions them.** Every knowledge ref has the people it's about (`aboutOf(ref)`: an event's actor and target, a death's person, a realm news item's `people`, a rumour's subject). When `playerLearns(ref)` runs and the ref is about a followed person, it's **flagged**: the player gets a notice ("Word of Ada: she married in <liege town>, a caravan driver says. (fairly sure)") with the source and how sure (accuracy → words), and `lastKnown` updates if the ref says where they are. Nothing is shown that the player hasn't learned.
3. **Passive hearing of followed people.** When the player is in a place, once a day (and on arrival) they **overhear** the place's talk of the town (N33: top refs known there): any item about a followed person is learned with source "overheard at the inn". This is what "hears weeks later from a caravan" needs: the caravan seeded the inn, the player hears it there.
4. **Letters are items carried by real travellers.** A letter: `{ id, from, to, text, written: absMinute, toSite, legs: Array<{ carrier: personRef, journey, from, to }>, arrives?, read }` in `world.letters`. It's addressed to where the writer *believes* the player is (their own last-known of the player, or the player's home, N66). It's handed to the next traveller leaving the writer's place in that direction (a Part E journey: a caravan, a market-goer, a pilgrim, a courier for a fee), rides in their pack (`journey.letters`), and **changes hands at inns** like news does when no one goes the whole way (`exchangeNews` hands letters to a traveller heading on toward `toSite`). It arrives when its last carrier does: no formula, so a letter on a quiet road waits. Letters wait at the destination's inn; the player is told on arrival or when they're there; if the player has moved on, the innkeeper forwards it once. A letter is lost if its carrier is robbed or killed (Part E's off-screen encounters: an event).
5. **Who writes to the player:** a followed talker or townsperson who has a warm relationship with the player (affection ≥ a threshold, N5/N37 axes) writes when something big happens to them (marriage, a child, illness, a new job or rank, moving, a death in their family, being wronged) or after a long silence (a season) if very close, with a cooldown. Code decides to write and what the letter is *about* (the refs); the model writes the words (`letter` kind, N19) from those facts, with a template fallback ("Dear <name>, I am married now, to <spouse>, a cooper of <place>. We are well. — Ada").
6. **The player writes back** at an inn or a messenger's post: free text (kept short) or a template, with a cost by distance. The recipient receives it on arrival (a memory for a talker; a knowledge row "a letter from the player" and a relationship nudge for a townsperson). Writing to someone the player doesn't know where they are: to their last known place.

## Data shapes

```ts
player.follows: Record<string, FollowEntry>;
world.letters: Letter[];   // kept until read + a season
interface Letter { id: string; from: string; to: string; about: string[]; text: string; written: number; toSite: string; arrives: number; legs: number; lost?: { day: number; why: string }; read?: number }
```

## Steps

### Step 1: following
- `game/follow/follow.ts`: follow, unfollow, auto-follow family; the talk-menu and journal actions; protocol fields.
- Test: following a person adds them; family are followed automatically.

### Step 2: flagged news
- `aboutOf(ref)`; a hook in `playerLearns` that flags followed refs, sets `lastKnown`, and pushes a notice.
- Overhearing at a place (decision 3), daily and on arrival.
- Test: a followed friend's marriage in the liege town is unknown to the player until a caravan from there arrives where the player is; then the player hears it with the caravan as the source.

### Step 3: letters
- `game/follow/letters.ts`: write (NPC rule, player action), handing to a traveller (`journey.letters`), hand-over at stops in `exchangeNews`, hold at the inn, forward once, loss with the carrier.
- Model call kind `letter` with fallback.
- Test (done-when): the friend marries; her letter is written that day and arrives at the player's place some days later, carried by named travellers (the legs list real people whose journeys took it there).

### Step 4: the followed list
- Protocol `FollowedView` and a panel (journal tab until N65's journal): each person, last known place and when, how sure, the latest news of them, letters.
- Test: the list shows a stale place until the player hears of a move.

### Step 5: docs
- README: following people, letters.

## Edge cases and traps

- **Knowledge only.** The followed list must never read `rowOf(...).site` for display; only `lastKnown`. A test checks a followed person who moved shows the old place until news.
- **Letters and determinism:** the decision to write is a rule with `streamFor(seed, "letter", who, day)`; the model's words don't change state (section 2).
- **Followed people who die:** the death is flagged when heard; the entry stays with "dead (heard day N)".
- **Townsfolk followed by the player** are rows; any news about them comes from N33's refs. If the player follows a townsperson, nothing new is simulated for them (they're already living).

## Tests (`packages/server/tests/n34.test.ts`)

The done-when one, as a scenario on a fixed seed: the player follows a friend (a talker with high affection) who leaves for the liege town (force a migration of her household), hears weeks later from a caravan that she married there (overheard at the inn after the caravan arrived), and gets a letter from her that arrives days after she sent it.

## Done when (mapped)

| Done-when clause | Proved by |
|---|---|
| follows a friend who leaves for Highdale | step 1 + migration in the scenario |
| hears weeks later from a caravan that she married there | step 2 test |
| gets a letter from her that arrives days after she sent it | step 3 test |

**Save:** the next save version (`player.follows`, `world.letters`).

## Slice cut

Not in the slice.

## Out of scope

"Wake me when" (N35). The journal as a whole (N65). Spies reading letters (N46 can intercept letters: leave a hook, `onLetterCarried`).
