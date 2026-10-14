[← Plans](README.md) · [Stage 3: N37](../stage-3-npcs-choose.md#n37-chatter-with-consequences)

# N37 plan: Chatter with consequences

**In one line:** when two people meet, code first decides **what kind of exchange** it is (greet, bow, refuse to bow, insult, humiliate, order, refuse an order, complain, share news) from who they are and how they get on; the exchange changes their four relationship axes (a row in `relationships`) and may leave a **grievance**; witnesses gossip it (N33); a wronged person with enough pride or hate forms a **revenge goal against that person** (any person, not only the player) and carries it out by the plans N12 already has. The bubble's words are the last step and the least important.

**Read first:** [plans README](README.md) sections 2, 13 (this phase's rules become N38 actions), 15 (this phase fills `relationships` and `grievances`), 17, 19 (`chatter-line`). Needs N25b (outlooks with a grudge, townsfolk traits), N33 (venues, witnesses and gossip; knowledge refs). **Step 0:** N20 step 1 (cause refs) if missing: a revenge must be linked to the insult that caused it.

## What exists

- **Crowd chatter** ([`shared/crowd.ts`](../../../packages/shared/src/crowd.ts)): `CrowdSim.chats(day, minute, d, at)` finds pairs standing together; `chatLines(roster, a, b, d, minute, seed)` picks two lines by class gap, master/servant, child, rival or scornful factions, news, weather; `Chat.bow` says the lower bows. Cosmetic: nothing changes.
- **Relationships for talkers** ([`npc/relationship.ts`](../../../packages/server/src/npc/relationship.ts): the four axes trust, fear, respect, affection; `adjust`, grudges with `setGrudge`/`holdsGrudge`/`settleGrudge`; [`npc/social.ts`](../../../packages/server/src/npc/social.ts): NPC-to-NPC `npcRelations`, `credence`).
- **Revenge goals** ([`director/revenge.ts`](../../../packages/server/src/director/revenge.ts)): `NpcGoal { kind: "revenge", target: "player", strength, plan: ambush | confront | rumour | refuse }`, `chooseRevenge` by traits, `wantRevenge`, `actOnRevenge` the next night (ambush = a spawn rule with hired men). **Only against the player.**
- **Townsfolk outlooks** ([`people/outlook.ts`](../../../packages/server/src/game/people/outlook.ts)): `grudge { against, since, why }` and `goal { kind: "avenge", target }`, set by code reviews, against anyone, but nothing acts on them.
- **Tables:** `relationships(a, b, …)` and `grievances(id, who, against, cause_ref, weight, since, settled)`, empty.
- **Traits** for townsfolk ([`people/traits.ts`](../../../packages/server/src/game/people/traits.ts), `RowTraits`), for talkers ([`npc/traits.ts`](../../../packages/server/src/npc/traits.ts): temper, pride via bravery/honesty/…).

## Decisions made in this plan

1. **Interactions are typed.** `INTERACTIONS = greet, bow, refuse_bow, sneer, insult, humiliate, order, obey, refuse_order, complain, share_news, flatter, threaten` with an effect table `{ on the target: Δtrust, Δaffection, Δrespect, Δfear; on the actor's standing with witnesses; grievance weight }`. A refused bow costs the lower person respect in the higher's eyes and adds a small grievance *the other way* (the noble is offended); an insult gives the target a grievance; a humiliation (insult in front of many, or a beating) a big one.
2. **Code picks the kind, by a scored roll.** For a pair (a speaks to b): base kinds by class gap and relation (master/servant → order/obey; far below → bow; equals → greet/share_news), then a **hostility roll** weighted by a's temper, pride (class and traits), existing dislike (affection < 0, an open grievance), the place's mood (N36: anger), drink (evening at the inn) and b's standing. Below → insult/sneer, above → greet. A refuse-bow roll weighted by the lower's own grievances, boldness and mood (N36 anger, N56 later). Streams: `streamFor(seed, "chatter", a, b, day, minute)`.
3. **Where it runs:** in the **player's place**, hourly, on the crowd's real pairs (the server runs the same `CrowdSim.chats` the browser does, so the pair the player sees talking *is* the pair that interacted). In **other live places**, daily, on N33's venue pairs at a smaller count. In **lazy places**, in catch-up the same way. The browser is sent the player's place's interactions for the current hour (`{ a, b, minute, kind }`), and `chatLines` gains a `kind` input so the bubble matches (an insult's lines when it was an insult).
4. **Relationship rows only for people who've met** (section 15). A pair's first interaction creates the row (both directions as needed). Values decay slowly toward 0 (except grievances, which have their own decay). Prune rule: all axes |x| < 3 and older than a year.
5. **Grievances are per wrong.** `grievances` rows: `who` (the wronged), `against`, `cause_ref` (the interaction's event ref), `weight` (0..1), `since`, `settled` (null, or the day). Weight decays slowly by the wronged's forgiveness; settled by amends (an apology interaction, a gift), revenge carried out, or death. The sum of open weights against someone is how much they hate them (N56 sums across a place).
6. **Every non-trivial interaction is an event** (insult, humiliate, refuse_bow, refuse_order, threaten; not greet or bow) written with `recordLifeEvent` (cheap, to the table), with witnesses = people in the venue or within sight. Witnesses get a knowledge row (`saw`), so N33's gossip spreads it.
7. **Revenge against anyone.** `NpcGoal.target` becomes a person ref (`"player"` stays valid). `wantRevenge` is called by the grievance rule when a person's open grievance weight against someone passes a threshold by their pride/temper/forgiveness; the plan by traits: **hire men** (ambush: a spawn rule for a talker; for a townsperson, a gang member hired with coin through N38's later "hire" action; for now through the spawn-rule path when the target is in the player's place, else resolved in code at the target's place: a fight roll and an injury or death, as an event); **confront** (a public confrontation interaction, maybe a brawl: N38's violence flag); **rumour** (a false rumour about the target, `r:` ref, spread by N33); **refuse** (no dealing: trade and help refused, visible in the place's economy). Carried out once; done settles the grievance partly.
8. **Townsfolk outlook grudges become grievance rows** (one source of truth): the outlook review keeps writing `grudge`, but from now as a view of the strongest open grievance.
9. **Words last.** Insults and sneers take a line from tables by class and kind; the model (`chatter-line`, lowest priority) may write a fresh line for an insult the player can see, through the invented-name check; the table line stands otherwise.

## Data shapes

```ts
// game/chatter/types.ts
export const INTERACTIONS = ["greet", "bow", "refuse_bow", "sneer", "insult", "humiliate", "order", "obey", "refuse_order", "complain", "share_news", "flatter", "threaten", "apologise"] as const;
export interface Interaction { a: string; b: string; kind: InteractionKind; day: number; minute: number; site: string; witnesses: string[]; event?: string }
// shared/crowd.ts: Chat gains kind?: InteractionKind; chatLines(…, kind?) picks lines by kind.
```

## Steps

### Step 1: relationships for everyone
- `game/social/rel.ts`: get/adjust/prune rows in `relationships` for any two person refs (talkers keep `npcRelations` for now; a bridge reads both, writes talker pairs to both). Decay daily for touched rows.
- Test: a first interaction makes a row; decay toward 0; prune.

### Step 2: the interaction picker and effects
- `game/chatter/pick.ts` (scored roll), `effects.ts` (the table), `apply.ts` (relationships, grievances, events, witnesses' knowledge).
- Test: over many meetings, a proud, hot-tempered noble sneers at serfs far more than a gentle one does; each sneer lowers the serf's respect for him.

### Step 3: running it at the three grains
- Active place hourly on `CrowdSim.chats` pairs (server side); live places daily on N33 venues; lazy catch-up. Send the hour's interactions for the player's place to the browser; `chatLines` by kind.
- Test: same seed, same interactions (hash); live and lazy give the same rows.

### Step 4: grievances and gossip
- Grievance rows with decay and settling; outlook grudge as a view; witnesses' knowledge → N33 spreads.
- Test (done-when part): a noble who repeatedly sneers at a serf lowers the serf's respect, the serf has a grievance against that noble, and witnesses gossip about it (other people in the place know the event a few days later).

### Step 5: revenge against anyone
- `NpcGoal.target: string`; the grievance → revenge rule; plans for talkers and townsfolk; actOnRevenge generalised (the target may be anyone; ambush through spawn rules when the target is in the player's place, else resolved in code).
- Test (done-when part): a proud noble who is insulted forms a revenge goal against a named NPC and carries it out (an event with the insult as its cause).

### Step 6: words and the browser
- Line tables by kind and class; the `chatter-line` model kind; bubbles show insults differently (a red edge).
- Play: stand in the square at market time; watch an insult and its gossip; check the admin's relationship rows.

### Step 7: admin and docs
- Admin: a person's relationships (top by |axes|), their grievances, their revenge goal and plan. README.

## Balance bounds

- `insults-rare`: insults are a small share of interactions (under ~5%) except where mood is angry.
- `grievances-settle`: most grievances settle or fade within a year.
- `revenge-bounded`: revenge acts per place per season under a cap; few end in death.
- `relationships-bounded`: rows per person under ~50.

## Edge cases and traps

- **The browser and server must see the same pairs.** The server runs `CrowdSim` for the player's place already (for N16's map validation); use the same instance and minute. A shared test compares the server's chats with the client's for a fixed roster.
- **Talkers' old `npcRelations` vs the table:** keep both during this phase with one bridge function; merging them is not needed now.
- **Revenge chains:** a revenge is itself a wrong to its target, which can start another; cap the chain (a revenge carried out lowers the avenger's grievance to 0 and gives the target a grievance at half weight), or a town loops into a blood feud by itself. N45 makes feuds on purpose.
- **Violence** (ambush, brawl) obeys `config.choice.violence` once N38 adds it; until then, revenge plans that kill are allowed only through the existing ambush path (as today against the player).

## Tests (`packages/server/tests/n37.test.ts`)

The done-when ones:
- A noble who repeatedly sneers at a serf lowers the serf's respect; the serf has a grievance against that noble; witnesses gossip about it.
- A proud noble who is insulted forms a revenge goal against a named NPC and carries it out.

## Done when (mapped)

| Done-when clause | Proved by |
|---|---|
| a noble who repeatedly sneers at a serf lowers the serf's respect | step 2 test |
| the serf has a grievance against that noble | step 4 test |
| witnesses gossip about it | step 4 test |
| a proud noble who is insulted forms a revenge goal against a named NPC and carries it out | step 5 test |

**Save:** the next save version (`NpcGoal.target` widens); the tables already exist.

## Slice cut

All of it for the start town and its liege town.

## Out of scope

NPCs choosing to insult as a deliberate action (N38 makes "insult" an action with a score; here it's the chatter roll). Feuds between families (N45). Uprisings from grievances (N56).
