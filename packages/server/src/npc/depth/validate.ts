import type { Dilemma } from "../../game/dilemmas.js";
import type { ReputationFact } from "../../game/rumours.js";
import type { Rng } from "../../game/dice.js";
import type { Arc } from "../arcs.js";
import { knownNameWords, unknownNames } from "../knowledge.js";
import { contradictions } from "../lint.js";
import { ADULT_WORDS } from "../templates.js";
import type { NpcPersona, NpcSecret, Quirk, Trigger } from "../types.js";
import type { FactsSheet } from "./facts.js";
import { fit, secretFrom, type Depth } from "./fallback.js";
import { holds, loadPools, tagsOf } from "./pools.js";
import type { Story } from "./story.js";

/**
 * Checks on what the model wrote (N25a step 5b), before any of it is applied. A field that fails is replaced by the
 * code fallback's for that field only; the rest of the reply stands. The checks:
 *  - every capitalised name is on the facts sheet (the invented-name check);
 *  - a secret is a real candidate by id, and chosen at most once;
 *  - a dilemma or arc is of a known kind that holds for this person, and its target (if any) is on the sheet;
 *  - no fact is contradicted: a living relative is not described as dead, nor a dead one as alive;
 *  - the content rules: a minor's words have nothing adult in them;
 *  - what the town says of them is bounded by their deeds: no crime they have not got;
 *  - lengths are in the schema; personality words must agree with the numbers.
 */
const DEAD_WORDS = /\b(dead|died|late|killed|buried|widow\w*|passed away|lost (?:his|her|their))\b/i;
const ALIVE_WORDS = /\b(alive|lives with|living with|still lives)\b/i;
const CRIME_WORDS = /\b(thief|thieves|murder\w*|killer|traitor|smuggler|poacher|adulter\w*|bandit|cheat\w*)\b/i;
const ROMANCE = /\b(romance|romantic|lover|flirt\w*|seduc\w*|kiss\w*|sweetheart|courting|brothel)\b/i;

export interface Checked {
  depth: Depth;
  /** Fields the model wrote that passed. */
  accepted: string[];
  /** Fields that failed, with why: code's stand in for them. */
  rejected: Record<string, string>;
}

/** What is wrong with a piece of the model's text, or null. */
export function textProblem(text: string, sheet: FactsSheet, persona: NpcPersona, known: Set<string>): string | null {
  const unknown = unknownNames(text, known);
  if (unknown.length > 0) return `names someone not in the facts: ${unknown.join(", ")}`;
  if (persona.minor && (ADULT_WORDS.test(text) || ROMANCE.test(text))) return "adult words for a child";
  for (const r of sheet.family) {
    const first = r.name.split(" ")[0]!;
    for (const sentence of text.split(/(?<=[.!?])\s+/)) {
      if (!sentence.includes(first)) continue;
      if (r.alive && DEAD_WORDS.test(sentence)) return `says ${r.name} is dead`;
      if (!r.alive && ALIVE_WORDS.test(sentence)) return `says ${r.name} is alive`;
    }
  }
  if (/\b(widow\w*)\b/i.test(text) && sheet.family.some((r) => r.kind === "spouse" && r.alive)) return "calls a married person a widow";
  return null;
}

const lower = (xs: string[]) => [...new Set(xs.map((w) => w.trim().toLowerCase()).filter(Boolean))];

/** The model's story, field by field, over code's depth. */
export function checkStory(story: Story, sheet: FactsSheet, persona: NpcPersona, base: Depth, day: number, rng: Rng): Checked {
  const depth: Depth = { ...base, written: [] };
  const accepted: string[] = [];
  const rejected: Record<string, string> = {};
  const known = knownNameWords([{ name: persona.name }, ...sheet.names.map((name) => ({ name }))], [sheet.siteName]);
  const take = (field: string, problem: string | null): boolean => {
    if (problem) {
      rejected[field] = problem;
      return false;
    }
    accepted.push(field);
    return true;
  };
  const pools = loadPools();
  const tags = tagsOf(sheet);

  if (story.backstory !== undefined && take("backstory", textProblem(story.backstory, sheet, persona, known))) depth.backstory = story.backstory;
  if (story.speechStyle !== undefined && take("speechStyle", textProblem(story.speechStyle, sheet, persona, known))) depth.speechStyle = story.speechStyle;
  if (story.appearance !== undefined && take("appearance", textProblem(story.appearance, sheet, persona, known))) depth.appearance = story.appearance;
  if (story.personality !== undefined) {
    const clash = contradictions(story.personality, persona.traits, persona.greed)[0] ?? textProblem(story.personality.join(" "), sheet, persona, known);
    if (take("personality", clash ?? null)) depth.personality = story.personality;
  }
  if (story.goals !== undefined && take("goals", textProblem(story.goals.join(". "), sheet, persona, known))) depth.goals = story.goals;

  if (story.quirks.length > 0) {
    const quirks: Quirk[] = story.quirks.filter((q) => !textProblem(q.line, sheet, persona, known)).map((q) => ({ when: { topic: lower(q.topic) }, line: q.line }));
    if (take("quirks", quirks.length === 0 ? "none passed" : null)) depth.quirks = quirks;
  }

  // Fears and loves: the model's words; code's loves that are items stay (a gift of one is worth more than gold).
  const trig = (list: Story["fears"]): Trigger[] => list.filter((t) => !textProblem(`${t.name}. ${t.because}`, sheet, persona, known)).map((t) => ({ name: t.name, words: lower(t.words) }));
  if (story.fears.length > 0) {
    const fears = trig(story.fears);
    if (take("fears", fears.length === 0 ? "none passed" : null)) depth.fears = fears;
  }
  if (story.loves.length > 0) {
    const loves = trig(story.loves);
    if (take("loves", loves.length === 0 ? "none passed" : null)) depth.loves = [...loves, ...base.loves.filter((l) => l.item)].slice(0, 3);
  }

  // Secrets: chosen by id from the real candidates, phrased by the model; the mechanics (what breaks them, the debt) are code's.
  if (story.secrets.length > 0) {
    const secrets: NpcSecret[] = [];
    const debts = [];
    const problems: string[] = [];
    for (const s of story.secrets) {
      const c = sheet.secrets.find((x) => x.id === s.candidate);
      if (!c) problems.push(`no such secret "${s.candidate}"`);
      else if (!fit(c, persona)) problems.push(`"${s.candidate}" doesn't suit them`);
      else if (secrets.some((x) => x.id === c.id)) problems.push(`"${s.candidate}" twice`);
      else {
        const bad = textProblem(`${s.about}. ${s.text}. ${s.cover}`, sheet, persona, known);
        if (bad) problems.push(bad);
        else {
          const made = secretFrom(c, sheet, rng);
          secrets.push({ ...made.secret, about: s.about, text: s.text, cover: s.cover });
          if (made.debt) debts.push(made.debt);
        }
      }
    }
    if (take("secrets", secrets.length === 0 ? problems[0] ?? "none passed" : null)) {
      depth.secrets = secrets;
      depth.debts = debts;
    }
  }

  // Dilemmas: a known kind that holds for them; the effects are the pool's, the words the model's.
  if (story.dilemmas.length > 0) {
    const dilemmas: Dilemma[] = [];
    let problem = "none passed";
    for (const d of story.dilemmas) {
      const entry = pools.dilemmas.find((p) => p.kind === d.kind && holds(p.requires, sheet, persona, tags));
      if (!entry) problem = `${d.kind} doesn't hold for them`;
      else if (d.target && !sheet.names.includes(d.target)) problem = `target "${d.target}" is not on the sheet`;
      else {
        const bad = textProblem(`${d.offer}. ${d.yes}. ${d.no}`, sheet, persona, known);
        if (bad) problem = bad;
        else dilemmas.push({ id: entry.id, offer: d.offer, keywords: entry.keywords, ...(entry.minTrust !== undefined ? { minTrust: entry.minTrust } : {}), options: (entry.options as Dilemma["options"]).map((o, i) => (i === 0 ? { ...o, label: d.yes } : i === 1 ? { ...o, label: d.no } : o)) });
      }
    }
    if (take("dilemmas", dilemmas.length === 0 ? problem : null)) depth.dilemmas = dilemmas;
  }

  // Arcs: a known kind that holds; the stages and their days are the pool's, the lines the model's.
  if (story.arcs.length > 0) {
    const a = story.arcs[0]!;
    const entry = pools.arcs.find((p) => p.kind === a.kind && holds(p.requires, sheet, persona, tags));
    const bad = !entry ? `${a.kind} doesn't hold for them` : (textProblem(`${a.name}. ${a.lines.join(" ")}`, sheet, persona, known) ?? (a.about && !sheet.names.includes(a.about) ? `"${a.about}" is not on the sheet` : null));
    if (take("arcs", bad) && entry) {
      const arc: Arc = {
        id: entry.id,
        name: a.name,
        stages: entry.stages.slice(0, Math.min(entry.stages.length, a.lines.length)).map((s, i) => ({ id: s.id, line: a.lines[i]!, ...(i > 0 ? { requires: { day: day + (s.after ?? 10 * i) } } : {}), ...(s.journal ? { journal: s.journal.replace(/\{name\}/g, persona.name).replace(/\{\w+\}/g, "") } : {}) })),
      };
      if (arc.stages.length >= 2) depth.arcs = [arc];
      else {
        accepted.pop();
        rejected.arcs = "too few stages";
      }
    }
  }

  // What the town says: only what their deeds and station bear out.
  if (story.reputationFacts.length > 0) {
    const supported = sheet.secrets.some((c) => ["crime", "hidden_tie", "vice"].includes(c.kind)) || sheet.deeds.some((d) => CRIME_WORDS.test(d));
    const facts: ReputationFact[] = [];
    let problem = "none passed";
    story.reputationFacts.forEach((r, i) => {
      const bad = textProblem(r.text, sheet, persona, known) ?? (!r.text.includes(persona.name.split(" ")[0]!) ? "doesn't name them" : null) ?? (!supported && CRIME_WORDS.test(r.text) ? "claims a crime their record doesn't bear out" : null);
      if (bad) problem = bad;
      else facts.push({ id: `rep${i + 1}`, text: r.text, truth: "true", keywords: lower(r.keywords) });
    });
    if (take("reputationFacts", facts.length === 0 ? problem : null)) depth.reputationFacts = facts;
  }

  depth.written = accepted;
  return { depth, accepted, rejected };
}
