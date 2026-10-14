[← Plans](README.md) · [Stage 4: N48](../stage-4-society.md#n48-law-and-trials)

# N48 plan: Law and trials

**In one line:** each kingdom has a **law book** (which acts are crimes, the punishment range for each, who judges, and how much a person's word weighs by class), kept as kingdom policies; a crime known to the authorities becomes a **case** for anyone (NPCs and the player, not only the player as today); a **trial** is decided in code from the evidence (witnesses and their credibility, documents and secrets, the accused's and accuser's class and standing, the judge's traits and relationships, bribes, leverage) and a sentence is carried out (fine, flogging, stocks, prison, exile, execution, forced labour) unless pardoned; the model only writes the hearing.

**Read first:** [plans README](README.md) sections 2, 13, 14 (the law book is policies), 19 (`hearing`). Needs N45 (the policy mechanism), N46 (secrets as evidence and leverage), N47 (bribery, corruption, arrests from crackdowns). Uses N32 (prison interiors), N37 (false accusation as a wrong), N49 (sentences on the player become setbacks), N58 (harsh rulers punish more).

## What exists

- **Crime for the player only** ([`crime.ts`](../../../packages/server/src/game/crime.ts)): `CRIME_KINDS` (assault, murder, theft, looting), `crimeFor(event)` (player as actor only), fines, a bounty, arrest by force at `ARREST_BOUNTY`, `payFine`, `surrender` (jail hours: `JAIL_HOURS_PER_GOLD`), guards know through witnesses or gossip (`reportCrimes`), `describeWanted`.
- **NPC crimes** happen (N38 steal/attack, N47 theft batches, N46 hidden crimes) but nobody judges them.
- **Heads of places and lords** (figures with roles; `isHead` in [`realm/needs.ts`](../../../packages/server/src/game/realm/needs.ts)); rulers with traits (ambition, loyalty, greed, bravery: [`realm/types.ts`](../../../packages/server/src/game/realm/types.ts)).
- **Class** on every person (`cls`, `CLASS_RANK` in [`shared/crowd.ts`](../../../packages/shared/src/crowd.ts)); kingdoms' `laws.slavery/serfdom`.

## Decisions made in this plan

1. **The law book is policies** (section 14), keys:
   - `crime:<kind>` → `{ punish: Array<"fine" | "flogging" | "stocks" | "prison" | "exile" | "execution" | "labour" | "enslavement">, severity: 1..10 }` for kinds `theft, assault, murder, trespass, poaching (N28), smuggling (N47), bribery, sorcery (N51), heresy (N50), sedition (N56/N58), desertion (N55), runaway (N59: in slave kingdoms), slander, blackmail`. A kingdom may not make some acts crimes (heresy where there's no state faith; runaway where there's no slavery).
   - `word_weight` → per class weights (how much a witness's word counts: a serf's word vs a noble's), from `equal` to `steep` (the noble's word ×4).
   - `judge` → who judges: `head` (the place's head), `lord`, `magistrate` (an appointed judge: a talker/row of clergy or gentry), `crown` (only for severe crimes or nobles).
   - `harshness` → a multiplier the ruler's traits set (cruel/fearful rulers harsh, kind/pragmatic lenient), moved by N58's repression.
   - The generator gives each kingdom a coherent book from its laws and ruler (the free kingdom: equal words, magistrates, no enslavement; the slave kingdom: steep word weights, enslavement for debt and theft).
2. **Cases for everyone.** `cases(id, kind, accused, accuser, victim, place, kingdom, event_ref, evidence JSON, status, opened, tried, verdict, sentence JSON, judge, why)`. A case opens when the authorities **know** a crime: a guard witnessed it, a victim or witness reported it (an N38 action `report`, scored by the reporter's grievance, honesty, fear of the accused, and the accused's power), or exposure (N46). The player's crimes become cases too; today's fines and bounties become the **pre-trial** path (pay the fine on the spot for minor crimes where the book allows, as now).
3. **Evidence is a list of things with weights:** witnesses (each with `credibility = word_weight[cls] × (accuracy of what they know) × (1 − bias)`, bias from relationships with the accused), documents (N32/N46: a letter with the secret), stolen goods found on the accused (N43), a confession (from a threat, a bribe gone wrong, or torture where the book allows: a check), and **false** evidence (N52: planted). The accused's defence: their own word (weighted), character witnesses (friends, their guild), a counter-secret (leverage over the judge or the accuser), a bribe.
4. **The verdict is a sum, then a roll.** `guilt = Σ evidence − Σ defence`, adjusted by the judge's traits (a cruel judge leans to guilty; a just one weighs credibility more), the judge's relationships (friend or enemy of either side), the place's mood (N36: angry crowds), a bribe accepted (N47's threshold for the judge), leverage (a secret the accused holds over the judge drops the case). A small roll at the edge (`streamFor(seed, "trial", caseId)`). All parts named, as N38 does, for the admin and the hearing.
5. **Sentences** from the book's options for that crime, scaled by harshness, the guilt margin, class (some books punish nobles with fines where commoners hang), priors (a record per person: past verdicts), and the victim's class. Carried out: fines (coin, else labour or debt-slavery where allowed), flogging (an injury, N8; public: witnesses and mood), stocks (a day in the square: humiliation interaction with everyone who passes), prison (days in a cell: N32's prison interior; for rows, a status that removes them from work), exile (they must leave the kingdom: a forced migration; returning is a crime), execution (a typed death `execution` with the case ref; public), labour (works for the crown: a job change for a term), enslavement (only where slavery is law). **Pardons:** the ruler may pardon (traits, the convicted's renown, a petition, a bribe to the crown, a festival amnesty).
6. **Prisons are real:** each town with walls/barracks has a jail building (N32 interior with cells); prisoners are people at the jail; the player can be held there (a setback: N49), visit, bribe the jailer, or break someone out (a crime: escape and aiding escape).
7. **False accusation** is an N38 action (`accuse` with a false case: a lie, N5's lies) by people with a grievance and low honesty; if the trial finds it false (evidence thin, the accuser's credibility low, a counter-witness), the accuser is charged with slander/perjury.
8. **The hearing** is words from the parts: the `hearing` call kind writes the judge's words, a witness's statement and the verdict speech from the named parts; the clerk's record (the parts in plain words) is the fallback. The player watching a trial in the place sees it as a scene; trials elsewhere are news.

## Data shapes

```ts
// policy keys: "crime:theft", …, "word_weight", "judge", "harshness"
// SQLite cases(...), records(person, case, verdict, sentence, day)  — a person's criminal record
interface Evidence { kind: "witness" | "document" | "goods" | "confession" | "character" | "leverage" | "bribe" | "planted"; who?: string; ref?: string; weight: number; side: "prosecution" | "defence"; why: string }
```

## Steps

### Step 1: the law book
- Policy keys, the generator's coherent books, the admin's table of laws by kingdom.
- Test: the free kingdom and the slave kingdom (section 12's helper) have different punishments for theft and different word weights.

### Step 2: cases for everyone
- `game/law/cases.ts`; opening by guards, reports (`report` action), exposure; the player's crime path through cases (fines on the spot kept where allowed); N47's arrests open cases.
- Test: an NPC theft seen by a guard opens a case; one seen only by a fearful neighbour may not be reported.

### Step 3: evidence and the verdict
- `evidence.ts`, `verdict.ts` with named parts; judges from the book; bribes and leverage.
- Tests (done-when parts): a noble accused by a commoner walks free unless the witnesses are many (word weights); the player bribes a judge and it works (a greedy judge) or doesn't and they're charged for it (an honest judge: bribery case).

### Step 4: sentences and pardons
- Carrying out each sentence kind through the normal systems; records; pardons.
- Test (done-when part): a serf who stole bread is sentenced harshly in the start town's kingdom and lightly in the free kingdom (choose seeds so the start kingdom is harsh; or assert across two kingdoms by their books).

### Step 5: prisons
- Jail buildings and interiors; prisoners; visiting, bribing the jailer, breaking out (and the case that follows).
- Test: a prisoner broken out is free and the breaker has a case.

### Step 6: false accusation; hearings
- The `accuse` action with lies; slander cases; `hearing` call kind and the clerk's record; the trial scene when the player is there.
- Test: a false accusation with thin evidence turns into a slander case against the accuser.

### Step 7: admin and docs
- Admin: open cases, trials with parts, records, prisons. README: the law.

## Balance bounds

- `justice-not-random`: guilty verdicts track evidence (most cases with strong evidence convict; most with none acquit).
- `executions-bounded` per kingdom per year.
- `prisons-not-full`: prisoners per jail under capacity (overflow → harsher or lighter sentences, by the book).

## Edge cases and traps

- **The player's existing crime tests** (`crime.ts`'s fines, bounties, arrest by force) must keep working: cases wrap them; fines on the spot are the book's "minor" path.
- **Rows in prison** are not working and not at home: the crowd and the daily step must know (`status: "jailed"` on the row until a day).
- **Executions of talkers** the player knows are big events; protected people (N38) are protected from NPC violence, not from the law.
- **Determinism:** reports and verdicts come from streams named by case id.

## Tests (`packages/server/tests/n48.test.ts`)

The done-when ones:
- A serf who stole bread is sentenced harshly in the start town's kingdom and lightly in the free kingdom.
- A noble accused by a commoner walks free unless the witnesses are many.
- The player bribes a judge and it works, or doesn't and they're charged for it.

## Done when (mapped)

| Done-when clause | Proved by |
|---|---|
| a serf who stole bread is sentenced harshly in Millbrook's kingdom and lightly in the free kingdom | step 4 test |
| a noble accused by a commoner walks free unless the witnesses are many | step 3 test |
| the player bribes a judge and it works, or doesn't and they're charged for it | step 3 test |

**Save:** the next save version (policies); the next schema version (`cases`, `records`, `people.status`).

## Slice cut

Not in the slice.

## Out of scope

The player's setbacks after a sentence (N49). Sedition and rebel trials in bulk (N58 uses this). Appeals to higher courts (later, if wanted).
