[← Plans](README.md) · [Stage 4: N49](../stage-4-society.md#n49-setbacks-instead-of-game-over)

# N49 plan: Setbacks instead of game over

**In one line:** when the player would die or lose everything, code picks a **setback** from who beat them and where (robbed and left, captured for ransom, sold to slavers, imprisoned by a crown, left for dead and found, exiled, in debt to someone dangerous, maimed); each setback is a **chapter** with its own state, its own exits (escape, ransom, working it off, earning freedom, a friend's or faction's rescue) and lasting marks (a scar, a lost limb, a criminal record, a reputation); when the player really dies they come back (plans README §5a: a day later where they last slept or at a temple, what they carried left where they fell).

**Read first:** [plans README](README.md) sections 2, 3, 13. Needs N48 (prisons, sentences, records), the slave and serf laws (N16), N26 (being moved along roads). Uses N8 (injuries), N34 (friends hear and may come), N42 (rescue jobs on the board), N57 (the player's faction ransoms them), N59 (escape paths for slaves; this phase gives the player a slave's escape; N59 later gives NPC slaves the same), N66 (heirs on real death).

## What exists

- **Defeat today** ([`creatures.ts`](../../../packages/server/src/game/creatures.ts) ~line 640): `config.playerDefeat` is `knockout` (default: wake after `knockoutRecoveryHours` with `knockoutHpShare` HP, lose `knockoutMoneyShare` of money if the foe takes money) or `permadeath`. The web server ([`web/server.ts`](../../../packages/server/src/web/server.ts) ~line 1264) passes the hours and says "You were knocked out".
- **Injuries** ([`health.ts`](../../../packages/server/src/game/health.ts) `INJURIES`, `injure`), no permanent ones.
- **Jail** for the player (`surrender`, jail hours in [`crime.ts`](../../../packages/server/src/game/crime.ts)); N48 makes prisons and sentences real.
- **Slavery and serfdom** as classes with masters (`master_id`) for rows; the player has no class field.

## Decisions made in this plan

1. **A defeat goes through one chooser.** `chooseSetback(world, defeat)` where `defeat = { by: personRef | creature | "law" | "nature", kind: "fight" | "sentence" | "debt" | "starvation" | "drowning" …, where, day }`. Outcomes by who beat the player (a table, data in `data/setbacks/*.json` with conditions and weights): bandits → robbed and left (today's knockout, harsher) or **captured for ransom** if the player looks rich or famous; slavers (a gang or merchant in a slave kingdom) → **sold**; a crown's guards → **imprisoned** (N48 sentence); beasts → **left for dead** and found (by a hunter, a hermit, a passing caravan: a real journey or person near) with an injury; a nemesis (N44) → their choice (humiliation, a brand, prison in their hold); the sea or a river → washed ashore downstream; starvation → found and carried to the nearest place, in debt to the finder. **Real death** only when the rule says so: `permadeath` config, an execution sentence carried out, or a killer who kills (beasts in a frenzy, a nemesis with a strong grudge and violence on, a duel to the death) with a small chance that's shown before risky choices.
2. **A chapter is a state on the player:** `player.chapter = { kind, since, where, holder?, terms?, exits: Exit[], marks: string[] }`. While in a chapter, the game's actions are those the chapter allows (a prisoner can't trade at the market; a captive can talk to their captors and fellow captives, plan, wait; a slave works their master's day: the crowd schedule of a slave, and the player's day passes in work unless they act).
3. **Exits are mechanics, not cutscenes:**
   - **Escape:** a plan with steps (find a weakness: a guard who can be bribed (N47), a fellow prisoner or slave who knows a way, a festival when watch is thin (N30), a tool smuggled in), then a check; failure has a punishment (flogging, longer term, sold further away).
   - **Ransom:** the captor names a price; it's paid by a friend (an N38 action for followed people and friends who hear of it through gossip: N33/N34), the player's faction (N57), the player's own stash at home (N66), or the player works it off.
   - **Working it off:** debt bondage: a job for the creditor for N days; a slave can **earn freedom** where the law allows (buy themselves out with wages saved; a master's grant after good service; a manumission at a festival), the same paths N59 gives NPC slaves.
   - **Rescue:** a rescue job is posted on N42's board in the player's home place by friends or family (an NPC party may take it); the player's companions may come.
   - **Serving the sentence:** time passes (N35's engine), with things happening in prison (fellow prisoners, a chance to learn a skill: lockpicking from a thief).
   - **Exile:** leave the kingdom within N days; returning is a crime (N48).
4. **Marks last.** Permanent injuries added to `INJURIES` (lost eye: perception −; lost hand: one-handed only; limp: slower on the road; brand: recognised as a slave/criminal in kingdoms that brand, a reaction modifier), scars (cosmetic, a story), the criminal record (N48 `records`), reputation by place for what happened ("the one who was sold at Ashby market and came back"): a knowledge ref that gossip spreads (N33), so people have heard the story.
5. **The player as a slave** is a real slave in the system: their `cls` becomes `slave` (the player gains a `cls` field, default `commoner`), they have a master (a row or talker) with a master's traits (cruel masters punish; kind ones may free), their day is a slave's schedule; other slaves are people they can befriend; an **escape with another slave's help** uses the N59 run (journey toward a free kingdom, catchers on the road, sheltered or returned by the free kingdom's runaway policy: N59 builds that policy; until N59, a free kingdom shelters by default).
6. **Telling it:** coming home after a chapter, the player is greeted as people have heard (knowledge, accuracy); the journal (N65) records the chapter.

## Data shapes

```ts
player.cls: SocialClass;   // default "commoner"
player.chapter?: { kind: "captive" | "slave" | "prisoner" | "bonded" | "exiled" | "recovering"; since: number; where: string; holder?: string; terms?: { ransom?: number; days?: number; debt?: number }; exits: Array<{ kind: string; status: "open" | "tried" | "done" | "closed"; data?: unknown }>; marks: string[] }
// INJURIES gains permanent kinds (permanent: true)
```

## Steps

### Step 1: the chooser and the data
- `game/setback/choose.ts`, `data/setbacks/*.json` (schema, `check-npcs`); replace the knockout path with `chooseSetback` (knockout stays as the outcome "robbed and left").
- Test: defeats by bandits, slavers, guards and beasts pick the expected kinds on fixed seeds; `permadeath` config still kills.

### Step 2: chapters and the actions they allow
- `player.chapter`, the action filter, the UI header ("Captive of the Red Hand at their camp. Ransom: 30 silver."), time passing in a chapter.
- Test: a captive can't use the market; can talk to captors.

### Step 3: exits
- Escape plans and checks; ransom (friends' and factions' N38 actions; paying from home); working off; rescue jobs (N42); serving; exile.
- Test: a friend who hears the player is held pays a ransom (fixed seed: a close friend with coin).

### Step 4: the player as a slave
- `player.cls`, masters, the slave's schedule, other slaves, earning freedom, the escape with help (N59 run or its stand-in).
- Test (done-when): the player loses to slavers, is sold in the slave kingdom, escapes with another slave's help (a slave with a grievance and a plan, befriended), and gets home.

### Step 5: marks and the story
- Permanent injuries, brands, records, the story as a knowledge ref spread by gossip; greetings at home.
- Test (done-when part): back home with a scar, people there have heard the story (knowledge rows of the ref in the home place).

### Step 6: death and coming back
- Built code today: [migration guide](migration-2026-10-23-one-year-ageless-player.md) part B.
- When death is real: the player comes back: they wake a day later where they last slept (home, an inn) or at a temple (N50 can make it a shrine of their faith), at low HP; what they carried stays where they fell, for others to take or for them to recover; and people who saw them die talk about it ("came back from the dead"), which can make them feared or revered (plans README §5a, decided 2026-10-23). With `PLAYER_DEFEAT=permadeath`, the end screen with the world's memory (who mourned, what's said).
- Test: a player killed by bandits wakes a day later at the inn they last slept in, their pack lies at the place they fell, and a witness's gossip says they came back from the dead.
- Docs: README on setbacks.

## Balance bounds

- `setbacks-escapable`: every chapter kind has at least one exit that succeeds in a test with a reasonable player.
- `not-a-loop`: a player can't be sold twice in a row by the same slavers without having escaped and returned to danger (cooldowns on that outcome per holder).

## Edge cases and traps

- **Never trap the player:** every chapter has a timed fallback exit (ransom paid by the place's temple charity after a season; a sentence ending; a master's death freeing slaves by will) so the game can't stall.
- **Companions and gear:** captured players lose gear to the captor (stash, recognisable notable items: N43, which helps find them later).
- **Saving in a chapter** is allowed; loading resumes the chapter.
- **Old tests** of knockout must keep passing for the "robbed and left" outcome.

## Tests (`packages/server/tests/n49.test.ts`)

The done-when one, as a scenario: the player loses to slavers, is sold in the slave kingdom, escapes with another slave's help through N59's paths, and comes home with a scar and a story people have heard.

## Done when (mapped)

| Done-when clause | Proved by |
|---|---|
| the player loses to slavers, is sold in the slave kingdom | steps 1, 4 |
| escapes with another slave's help through N59's paths | step 4 test (N59's run; a stand-in until N59, noted in the stage file) |
| comes home with a scar and a story people have heard | step 5 test |

**Save:** the next save version (`player.cls`, `player.chapter`, permanent injuries).

## Slice cut

Not in the slice.

## Out of scope

Heirs (N66). The full runaway policy of free kingdoms (N59). Torture.
