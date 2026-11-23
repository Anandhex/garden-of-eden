[← Plans](README.md) · [Stage 4: N70](../stage-4-society.md#n70-society-in-play-catch-up)

# N70 plan: Society in play (catch-up)

> **Built 2026-11-22** (`game/society/player.ts`, `admin/society.ts`, `tests/n70.test.ts`; no save bump). What differs from this plan is in the [stage file](../stage-4-society.md#n70-society-in-play-catch-up).

Planned 2026-11-16 from an audit of the roadmap against the code. Stages 4 and 5 were built up to N55 on 2026-11-03, then work stopped for the 3D look (the pivot of 2026-11-04) before the last part of that job was done: the player's actions, the admin cards, the README and the roadmap. The rules exist and their tests pass, but most of what the player was meant to do with them can't be reached in the game.

**In one line:** every player action of N46–N55 gets a way in (a server action, a panel row, a CLI command), the two dead ends are closed, the admin page shows Stage 4–5 state, and the one failing test is fixed. No new rules.

**Read first:** [plans README](README.md) §13 (the action menu), §18 (client work goes in layers), §28 (every phase brings its admin page); the G5 rule that a feature is added in `server/src/view/` and every client draws it.

## What the audit found (2026-11-16)

Checked by listing every exported player function of `game/{secrets,thieves,law,magic,shaping,culture,war,setback}` and searching `src/` for a caller outside its own file. "No caller" means only tests call it.

| Phase | Function (file) | Caller in play |
|---|---|---|
| N46 | `pry`, `sellSecret`, `blackmailBy`, `exposeBy` (`secrets/player.ts`) | none |
| N47 | `blackMarket`, `buyBlack`, `joinGuild`, `informOn` (`thieves/day.ts`) | none (`joinGuild` in `web/server.ts` is the adventurers' guild of `realm/wilds.ts`, a different function) |
| N48 | `bribeJudge`, `tryPlayer`, `breakOut` (`law/player.ts`) | none. `openPlayerCase` is called (by magic and by a traced rumour), so a case against the player opens and is never heard: `trialsDay` skips `accused === "player"` |
| N49 | `escapeSlavery`, `comeHome`, `recoverPack` (`setback/setback.ts`) | none. `chooseSetback`, `sell`, `leftForDead`, `dieAndReturn` and `slaveDay` are wired in `Town`, so **a player sold as a slave works every day and can never leave** |
| N51 | `learnSpell`, `playerCast`, `teacherAt` (`magic/player.ts`) | none (`borderCheck` is wired in `Town.arriveAt`) |
| N52 | `playerPlants`, `payVoice`, `frame` (`shaping/rumours.ts`) | none. `rumoursDay` is called from `society/day.ts` without its `player` argument |
| N53 | `breakTaboo`, `keepCustom`, `tonguePenalty`, `customsAt` (`culture/day.ts`) | none (`dayAmong` is wired) |
| N55 | `enlist`, `rollOfTheFallen` (`war/armies.ts`) | none |

Also found:

- `tests/n55.test.ts` fails: after the peace, 2 soldier records are still `serving` (line 82). Probable cause (not yet confirmed): in `soldiersSiteDay` the discharge loop skips a soldier whose person is dead (`r.death !== null → continue`), and a soldier who died of something other than the war never passes through the "fallen" branch, so their record stays open.
- The admin page has no Stage 4–5 state: no feuds, disputes, secrets, dens, cases, faiths, omens, gifts, cultures, peoples, armies or rolls of the fallen on any card or tab.
- `society/bounds.ts` has bounds for N45, N46, N47, N48, N50 and N51 only. N52–N55 have none, though N54's and N51's checklists ask for them.
- `config.society` has switches for `unrest`, `runaways`, `ecology`, `disasters`, `exploration` and `newKingdoms` that nothing reads, and `epidemics` is read only by `epidemic/model.ts` (the state; nothing starts an outbreak). They are harmless, but a reader of `config.ts` would think N56–N64 exist.
- The root `README.md` says nothing about Stages 4–5.

## Decisions

1. **One `society` action, not twenty.** The server gets one action family (`act` with `what: "society"`, an op and its arguments), built like N41's leisure and N42's market ops in `web/server.ts`. The CLI gets the same ops as slash commands.
2. **Offers come from the place, not a menu of everything.** A row appears only where it can be done: "pry" on a person the player is talking to, "black market" only in a place with a den that trusts the player, "learn" only where `teacherAt` finds a teacher, "enlist" only while the kingdom is at war. Each disabled row says why (the `UiAction.why` field).
3. **Offer, then confirm** (design rule 4) for anything that costs coin or freedom: bribes, blackmail, a framed witness, enlisting.
4. **The slave chapter gets three exits**, as N49's plan says: escape (the existing roll, once a day, better with a helper), being bought free or ransomed by a friend with the coin (N26J's ransom code), and N59's paths later.
5. **No new rules.** If wiring shows a rule is wrong, fix the rule's own phase and note it in the stage file's **What differs**.

## Steps

0. **Fix N55's test.** Confirm the cause above; end the record of a soldier who died away from battle (`status: "dead"`, no war-dead row, their death keeps its own cause). Run `tests/n55.test.ts`.
1. **The dead ends first.** (a) Slave chapter: an "escape" action (calls `escapeSlavery`, moves the player with `Town.arriveAt`), `comeHome` when the player next arrives at their home place, `recoverPack` where they fell. (b) Player cases: `trialsDay` hears the player's open case on the place's court day (calls `tryPlayer`), with an offer to bribe the judge first (`judgePrice`, `bribeJudge`). Tests drive both through `Town`, not the functions.
2. **The `society` ops** in `web/server.ts` and `cli.ts`: secrets (pry, sell, blackmail, expose), underworld (black market, buy, join, inform), law (accuse is already in the menu; break out), magic (learn, cast), shaping (plant, pay a voice, frame), culture (keep a custom, break a taboo: mostly raised by code when the player does the thing, e.g. eats the forbidden food, not by a button), war (enlist). Pass `player` to `rumoursDay` for the place the player is in, so a traced rumour reaches them.
3. **The panels** in `view/ui.ts`: a "Society" section on the person sheet (what the player knows about them: secrets held, faith, people, gift if shown), a place section (customs and taboos, the faith, the den if known, the court's open cases, the war and its levy), and the player's own (tongues, spells, record, chapter with its exits). Unity's HUD draws sections generically (`Hud.RenderSections`), so it needs no code; check it once.
4. **`tonguePenalty` in talk:** apply it where persuasion is rolled, and tell the model in words ("you barely share a language").
5. **Admin:** person card (kin disputes and feuds, secrets known and held, faith and devotion, gift and spells, soldier record), place card (den, cases, faith, culture, residents of other peoples), a Society tab (open feuds, cases, plots, omens and readings, armies with their levies, each war's roll by battle).
6. **Bounds** for N52 (rumours die out; the player's are traced at a steady rate), N53 (cultures don't all converge), N54 (no people wiped out, the dragon burns at most one place a season), N55 (levies stay under a share of the fighting-age; nobody serves in an ended war). Add them to `society/bounds.ts`.
7. **Tidy:** remove the unused `config.society` switches or mark them "not built" in the comment; README section for Stages 4–5; tick the stage files.

## Tests

`tests/n70.test.ts`, each through `Town` or the server's action handler with a fake model:

- A player sold as a slave escapes with a helper within a season on a fixed seed, arrives in a free place, and the story is known at home when they return.
- A player with an open sorcery case is tried on court day; with a bribe taken, the case is dropped; with an honest judge, a second case opens.
- Every op in step 2 changes the same records its phase's own test checks, and is refused with a reason where it shouldn't be offered.
- The UI model for a place with a den, a court case and a war lists the rows, and they validate against `protocol/schema`.
- `tests/n55.test.ts` passes.

**Save:** none expected (v17, schema 18 stay). *As built: none; the snapshot gained an optional `society` field and `LifeCtx` an optional `player`.*

## Done when

A new game can reach every Stage 4–5 system from the keyboard: the player pries out a secret and sells it, buys on the black market, is tried and bribes the judge, is sold and escapes, learns a spell and is caught with it at a border, plants a rumour that is traced back, breaks a taboo, and enlists. The admin page shows why each thing happened, `npm test` is green, and `sim:years` holds the new bounds.
