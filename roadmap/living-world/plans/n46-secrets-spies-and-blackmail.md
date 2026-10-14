[← Plans](README.md) · [Stage 4: N46](../stage-4-society.md#n46-secrets-spies-and-blackmail)

# N46 plan: Secrets, spies and blackmail

**In one line:** a secret becomes a record in code (a true fact that someone wants hidden, with a ref to what makes it true, who it shames and who knows); secrets are made by the systems that do hidden things (crimes unseen, affairs, debts, hidden runaways, true loyalties, a child's real father); people **discover** them (witnessing, prying, gossip, documents in a drawer) and **use** them through N38 actions (keep, tell, sell, **blackmail**, **expose**); blackmail victims pay, flee or **silence** the witness; kingdoms run **spies** who learn courts' plans and report them; a disputed succession can end in an **assassination plot**.

**Read first:** [plans README](README.md) sections 2, 3, 13, 14, 15. Needs N33 (knowledge rows: a secret is a ref `s:<id>`), N38 (the menu), N45 (affairs, claimed fathers, disputes, policies). Uses N32 (documents in drawers), N34 (letters can be intercepted), N47 (the underworld buys secrets), N48 (exposure feeds trials), N59 (hidden runaways).

## What exists

- **Talkers' secrets** ([`npc/secrets.ts`](../../../packages/server/src/npc/secrets.ts)): `NpcSecret` on the persona with cover stories and break conditions; `reachableSecrets`, `learnSecret`, `player.facts` (`factId(npc, secret)`). Words only: nothing in the world is *made true* by them.
- **Depth facts** ([`npc/depth/facts.ts`](../../../packages/server/src/npc/depth/facts.ts)): `secretCandidates` finds things that could be secrets because they're true in the data (a crime, a debt, a witness, a lover), for the model to write about (N25a).
- **Deception** ([`deception.ts`](../../../packages/server/src/game/deception.ts)): lies, exposure chance, beliefs.
- **Crime** ([`crime.ts`](../../../packages/server/src/game/crime.ts)): witnessed crimes, bounties; unwitnessed crimes simply happen.
- **Realm politics:** succession (`successionDay`), wars declared (`declareWar` in [`realm/diplomacy.ts`](../../../packages/server/src/game/realm/diplomacy.ts)), opinions between kingdoms; courts are implicit (the ruler figure and the crown faction).

## Decisions made in this plan

1. **A secret is a record:** `secrets(id, kind, subject, about_ref, shames, severity, made_day, exposed_day, cover)`. `subject` is whose secret it is (a person ref or a faction or a court), `about_ref` the event/row/realm ref that makes it true, `severity` 1..10 (how bad exposure is: a fine, a ruin, a death sentence). Kinds: `crime` (an unwitnessed or covered crime), `affair`, `parentage`, `debt` (hidden), `loyalty` (a member secretly of another faction; a spy), `runaway` (sheltering one), `plan` (a court's war plan, a plot), `identity` (someone isn't who they say), `magic` (a hidden gift where banned: N51), `cult` (secret faith: N50).
2. **Systems make secrets when they do hidden things.** Each source is one call to `makeSecret`: a crime with no witnesses (or witnesses who were paid or are loyal) → `crime`; N45's affair → `affair`, a child with `claimed_father` → `parentage`; a debt to a moneylender kept from the family → `debt`; a spy placed by a court → `loyalty`; a household hiding a runaway (N59) → `runaway`; a court deciding to go to war in N days → `plan`; a plot → `plan`. The talker's persona secrets (N4) become **views** of their records (the words the model wrote stay as the cover/truth wording), so talkers' secrets are now real.
3. **Who knows is knowledge rows** (`knowledge(who, "s:<id>", …)`, N33): the subject, accomplices, witnesses. Secrets **don't spread by ordinary gossip** (they're not tellable by default); a person who knows a secret decides what to do with it via N38.
4. **Discovery:**
   - **Witnessing:** the hidden act had witnesses the actor didn't see (a perception roll for each person in sight, N37's witness logic) → they know.
   - **Prying:** an N38 action `pry` (search a house: N32's hidden slots hold documents with `s:` refs; read letters: N34; follow someone at night), by curious, nosy, ambitious or spying people; the player does the same.
   - **Gossip of servants:** servants and slaves in a household have a chance per season to learn household secrets (they see everything) and may tell (their grievances against the master raise it).
   - **Deduction:** a few rules infer secrets from public facts (a child who looks like the neighbour: the `parentage` secret is found by those who know both well, low chance).
5. **Using a secret, as N38 actions:** `keep` (default), `tell` (pass it as gossip to a chosen person: it becomes tellable for them), `sell` (to the underworld N47, a rival, a court), `blackmail` (demand coin, a favour, silence on something, a vote; scored by greed, low honesty, the knower's power vs the subject's, the severity), `expose` (tell many: the town crier, the priest, the court; exposure is an event with consequences by kind: a crime → a case (N48); an affair → N45's separation; a spy → arrest; a plan → the other court learns).
6. **The blackmailed respond** (N38 for them): `pay` (a recurring demand, a debt), `refuse` (the knower may expose), `flee` (N25 migration of the household), `silence` (a violent action against the knower, `attack`/`murder` with violence on, or hire it: N47), `counter` (find a secret of theirs). A silenced witness is a death (`murder`) that may itself become a secret.
7. **Spies are people.** A court with intrigue (ruler's traits and wealth) places a **spy** in another kingdom's court or capital: a person (a figure or row of a suitable class) with a `loyalty` secret, reporting each season. A spy learns `plan` secrets of the court they're in (chance by their skill and the court's guard) and reports by a **letter** carried home (N34's letters; interceptable). The home court acts on the report (N58-style decision: prepare, strike first, seek allies), logged with the report as cause.
8. **Succession crises and assassination.** When an heir is disputed (N45 at the crown level: a ruler dies with rival claimants, or a ruler's heir is weak and an ambitious relative or noble wants the throne), the claimant may form a **plot** (a `plan` secret with conspirators who know it); plots grow by recruiting (N38 `recruit` with the plot's risk), can be discovered by spies or servants, and resolve in an assassination attempt (a fight roll against guards, with the ruler's death possible), or exposure (the conspirators are tried: N48; executed where the law says).

## Data shapes

```ts
// SQLite secrets(id, kind, subject, about_ref, shames JSON, severity, made_day, exposed_day, cover); demands(id, secret, by, of, what JSON, every_days, since, ended)
// spies: figures/rows with a loyalty secret; realm.spies: Array<{ person, for: kingdom, in: kingdom|settlement, since, reports: number }>
// plots: secrets of kind plan with data { target, aim: "throne" | "kill" | "war", conspirators: string[], strength }
```

## Steps

### Step 1: secret records and sources
- `game/secrets/` (records, `makeSecret`, sources from crime, affairs, parentage, debts); talker secrets as views (the N4 tests keep passing).
- Test: an unwitnessed theft makes a `crime` secret known only to the thief.

### Step 2: discovery
- Witnessing with perception; `pry` (houses, letters, following); servants' knowledge; deduction rules.
- Test (done-when part): an NPC witnesses a noble's crime (a theft or assault the noble thought unseen) and knows the secret.

### Step 3: using secrets
- Actions `tell`, `sell`, `blackmail`, `expose`; demand records; exposure consequences by kind.
- Test (done-when part): the witness blackmails the noble; the noble pays (a fixed seed with a cautious, rich noble) or has the witness silenced (a fixed seed with a ruthless one, violence on: a `murder` death of the witness, itself a new secret).

### Step 4: spies
- Placing spies; learning plans; reports by letter; the home court acting on them.
- Test (done-when part): a kingdom's spy learns of a neighbour's war plans and the court acts on it (prepares or strikes first, logged with the report as cause).

### Step 5: plots and assassination
- Crown-level disputes (from N45's heirs at the crown), plots, recruitment, discovery, the attempt.
- Test (done-when part): a disputed succession ends in an assassination plot (discovered or attempted, on fixed seeds).

### Step 6: the player
- The player can pry, keep, sell, blackmail, expose like anyone (the same actions); talkers react to being blackmailed by the player through their own N38 choices.
- Test: the player sells a secret to a rival who then uses it.

### Step 7: admin and docs
- Admin: secrets by place (truth), who knows, demands, spies, plots. README.

## Balance bounds

- `secrets-bounded`: secret rows per person under a cap; old exposed ones pruned.
- `blackmail-rare`; `assassinations-rare` (a plot reaches an attempt at most every few years per kingdom).

## Edge cases and traps

- **Secrets must not leak through gossip** by default (the `tellable` flag in knowledge rows, false for `s:` refs until someone chooses `tell`).
- **The player's facts** (`player.facts`) become knowledge refs of `s:` kind; migrate.
- **Model words for secrets** (N25a depth) must stay consistent with the record: the record is the truth; the depth story is generated *from* it.
- **Determinism of hidden things:** prying and witnessing rolls come from per-person streams.

## Tests (`packages/server/tests/n46.test.ts`)

The done-when ones:
- An NPC witnesses a noble's crime, blackmails them, and the noble pays or has the witness silenced.
- A kingdom's spy learns of a neighbour's war plans and the court acts on it.
- A disputed succession ends in an assassination plot.

## Done when (mapped)

| Done-when clause | Proved by |
|---|---|
| an NPC witnesses a noble's crime, blackmails them, and the noble pays or has the witness silenced | steps 2–3 tests |
| a kingdom's spy learns of a neighbour's war plans and the court acts on it | step 4 test |
| a disputed succession ends in an assassination plot | step 5 test |

**Save:** the next schema version (`secrets`, `demands`); the next save version (`realm.spies`, `player.facts` migrated).

## Slice cut

Not in the slice.

## Out of scope

Trials of exposed people (N48). The underworld's market in secrets (N47 buys them). The player planting false secrets (N52 frames people).
