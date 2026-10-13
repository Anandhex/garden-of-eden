import { type Dilemma } from "../../game/dilemmas.js";
import type { Rng } from "../../game/dice.js";
import type { ReputationFact } from "../../game/rumours.js";
import type { Arc } from "../arcs.js";
import type { RelationAxes } from "../social.js";
import type { NpcDebt, NpcPersona, NpcSecret, Quirk, Signature, Trigger } from "../types.js";
import type { FactsSheet, SecretCandidate } from "./facts.js";
import { holds, loadPools, tagsOf, type When } from "./pools.js";

/**
 * The code fallback (N25a step 5c): the same fields the model writes, drawn from seeded pools by what the facts
 * sheet bears out. It is what a talker has the moment they exist, what they keep when the model is off or over
 * budget, and what replaces any field of the model's that fails its check. Mechanical fields (relationships,
 * signature, hire, debts) are always code's, never the model's.
 */

/** Everything depth adds to a persona. `written` says which fields the model wrote (the rest are code's). */
export interface Depth {
  backstory?: string;
  personality?: string[];
  speechStyle?: string;
  appearance?: string;
  quirks: Quirk[];
  fears: Trigger[];
  loves: Trigger[];
  secrets: NpcSecret[];
  debts: NpcDebt[];
  dilemmas: Dilemma[];
  arcs: Arc[];
  goals?: string[];
  reputationFacts: ReputationFact[];
  /** Mechanical, code's: feelings for kin who are already talkers. */
  relationships: Record<string, Partial<RelationAxes>>;
  signature?: Signature;
  hire?: NonNullable<NpcPersona["hire"]>;
  /** Which fields the model wrote, for the admin view and the journal. */
  written: string[];
}

const pick = <T>(rng: Rng, xs: T[]): T => xs[Math.floor(rng() * xs.length)]!;
const pickSome = <T>(rng: Rng, xs: T[], n: number): T[] => {
  const left = [...xs];
  const out: T[] = [];
  while (out.length < n && left.length > 0) out.push(left.splice(Math.floor(rng() * left.length), 1)[0]!);
  return out;
};

/** "Odo Barrow" + "{name} owes {creditor}" → filled. */
export function fillFacts(text: string, vars: Record<string, string | undefined>): string {
  return text.replace(/\{(\w+)\}/g, (m, k: string) => vars[k] ?? m);
}

const JOB_PLACE: Record<string, string> = { smith: "forge", innkeeper: "inn", merchant: "stall", farmer: "farm" };
const MINOR_KINDS = new Set(["loss"]);

/** Which candidates are fit to be someone's secret: not a minor's crimes. */
export function fit(c: SecretCandidate, persona: NpcPersona): boolean {
  return !persona.minor || MINOR_KINDS.has(c.kind);
}

/** Priority among candidates when code picks: what hurts most to be found out. */
const SECRET_ORDER = ["hidden_tie", "crime", "debt", "witnessed", "past", "loss", "vice"];

/** A secret (and the debt behind it, for a debt) from a candidate, in the pool's words. */
export function secretFrom(c: SecretCandidate, sheet: FactsSheet, rng: Rng): { secret: NpcSecret; debt?: NpcDebt } {
  const entries = loadPools().secrets.filter((e) => e.kind === c.kind);
  const e = pick(rng, entries);
  const vars = { name: sheet.name, first: sheet.name.split(" ")[0], creditor: c.creditor, subject: c.subject, fact: c.fact.replace(/\.$/, ""), job: sheet.job, place: sheet.siteName };
  const debt: NpcDebt | undefined = c.kind === "debt" ? { id: "debt", creditor: c.creditor ?? "the head of the town", amount: 400 + Math.round(rng() * 900) } : undefined;
  const secret: NpcSecret = {
    id: c.id,
    about: fillFacts(e.about, vars),
    text: fillFacts(e.text, vars),
    cover: fillFacts(e.cover, vars),
    keywords: [...e.keywords],
    breaksWith: [{ check: "persuade" }, { check: "intimidate" }],
    ...(debt ? { debt: debt.id } : {}),
  };
  return { secret, ...(debt ? { debt } : {}) };
}

/** Mechanical: how they feel about kin who are talkers already. */
export function relationsFor(sheet: FactsSheet): Record<string, Partial<RelationAxes>> {
  const out: Record<string, Partial<RelationAxes>> = {};
  for (const r of sheet.family) {
    if (!r.id || !r.alive) continue;
    out[r.id] = r.kind === "spouse" ? { trust: 60, affection: 70, respect: 40 } : r.kind === "sibling" ? { trust: 40, affection: 40, respect: 20 } : { trust: 50, affection: 60, respect: r.kind === "parent" ? 50 : 20 };
  }
  return out;
}

/** Mechanical: the one thing a trade is known for. */
export function signatureFor(persona: NpcPersona, sheet: FactsSheet): Signature | undefined {
  if (persona.minor) return undefined;
  if (sheet.job === "smith") return { trigger: "good_work_day", effect: "masterwork", describe: "a masterwork" };
  if (sheet.job === "innkeeper") {
    const item = Object.keys(persona.startingInventory).find((i) => /^(ale|stew)\b/.test(i)) ?? Object.keys(persona.prices).find((i) => /^(ale|stew)\b/.test(i));
    if (item) return { trigger: "trusted_regular", effect: "hidden_stock", items: [item], minTrust: 40, describe: "the good bottle kept under the bar" };
  }
  return undefined;
}

/** Mechanical: who can be hired to come along, and for what wage a day. */
export function hireFor(persona: NpcPersona, sheet: FactsSheet): Depth["hire"] | undefined {
  if (persona.minor || persona.age < 18 || persona.age > 55 || !persona.weapon) return undefined;
  if (!["guard", "bandit"].includes(sheet.job) && !persona.guard) return undefined;
  if (sheet.cls === "slave") return undefined;
  const tierBump = ["G", "F", "E", "D", "C", "B", "A", "S", "SS", "SSS"].indexOf(persona.tier);
  return { wage: 60 + 40 * Math.max(0, tierBump), minTrust: 40, minRespect: 20 };
}

function triggers(entries: Array<{ when: When; name: string; words: string[]; item?: string; because?: string }>, sheet: FactsSheet, persona: NpcPersona, rng: Rng, n: number): Trigger[] {
  const tags = tagsOf(sheet);
  // The most specific entries (more conditions) first: a fear with a reason in their history beats a trade's usual one.
  const hits = entries.filter((e) => holds(e.when, sheet, persona, tags));
  const specific = hits.filter((e) => Object.keys(e.when).length > 0);
  const chosen = [...pickSome(rng, specific.filter((e) => e.when.fact), 1), ...pickSome(rng, specific.filter((e) => !e.when.fact), n), ...pickSome(rng, hits.filter((e) => Object.keys(e.when).length === 0), 1)];
  const seen = new Set<string>();
  return chosen
    .filter((e) => (seen.has(e.name) ? false : (seen.add(e.name), true)))
    .slice(0, n)
    .map((e) => ({ name: e.name, words: [...e.words], ...(e.item ? { item: e.item } : {}) }));
}

function lostWords(sheet: FactsSheet): string {
  const r = sheet.family.find((x) => !x.alive && x.cause);
  return r ? r.name : "someone";
}

/** Every field, from the pools and the facts. Deterministic for a given sheet and stream. */
export function fallbackDepth(sheet: FactsSheet, persona: NpcPersona, day: number, rng: Rng): Depth {
  const pools = loadPools();
  const tags = tagsOf(sheet);
  const vars = { name: sheet.name, first: sheet.name.split(" ")[0], place: sheet.siteName, job: sheet.job, job_place: JOB_PLACE[sheet.job] ?? "trade", lost: lostWords(sheet) };

  const fears = triggers(pools.fears, sheet, persona, rng, 2);
  const loves = triggers(pools.loves, sheet, persona, rng, 2);

  const quirks = pickSome(rng, pools.quirks.filter((q) => holds(q.when, sheet, persona, tags)), 2).map((q) => ({ when: q.quirk.when as Quirk["when"], line: q.quirk.line }));

  // Secrets: up to two true things, the ones that would hurt most to be found out first. Not everyone has one.
  const secrets: NpcSecret[] = [];
  const debts: NpcDebt[] = [];
  const candidates = sheet.secrets.filter((c) => fit(c, persona)).sort((a, b) => SECRET_ORDER.indexOf(a.kind) - SECRET_ORDER.indexOf(b.kind));
  for (const c of candidates) {
    if (secrets.length >= 2) break;
    if (secrets.length > 0 && rng() < 0.5) continue;
    const made = secretFrom(c, sheet, rng);
    secrets.push(made.secret);
    if (made.debt) debts.push(made.debt);
  }

  // Dilemmas: what their station and trouble give them to ask of the player.
  const dilemmas = pickSome(rng, pools.dilemmas.filter((d) => holds(d.requires, sheet, persona, tags)), 1).map((d) => ({ id: d.id, offer: fillFacts(d.offer, vars), keywords: d.keywords, ...(d.minTrust !== undefined ? { minTrust: d.minTrust } : {}), options: d.options }) as Dilemma);

  // One arc, staged by days from now.
  const arcs: Arc[] = pickSome(rng, pools.arcs.filter((a) => holds(a.requires, sheet, persona, tags)), 1).map((a) => ({
    id: a.id,
    name: a.name,
    stages: a.stages.map((s, i) => ({
      id: s.id,
      line: fillFacts(s.line, vars),
      ...(i > 0 ? { requires: { day: day + (s.after ?? 10 * i) } } : {}),
      ...(s.journal ? { journal: fillFacts(s.journal, vars) } : {}),
    })),
  }));

  // What the town says: only what their deeds and station bear out.
  const reputationFacts: ReputationFact[] = pickSome(rng, pools.reputation.filter((r) => holds(r.when, sheet, persona, tags)), 2).map((r, i) => ({ id: `rep${i + 1}`, text: fillFacts(r.text, vars), truth: r.truth, keywords: r.keywords }));

  const goals: string[] = [];
  const lost = sheet.family.find((r) => !r.alive && r.cause);
  if (lost) goals.push(`Honour the memory of ${lost.name}`);
  if (sheet.law === "slave") goals.push("Keep out of trouble, and someday be free");
  if (sheet.feelings.some((f) => /thinking of leaving/.test(f))) goals.push(`Find somewhere better than ${sheet.siteName}`);
  if (sheet.feelings.some((f) => /grudge/.test(f))) goals.push("See the wrong done to them put right");
  if (debts.length > 0) goals.push(`Pay off what is owed to ${debts[0]!.creditor}`);
  const owes = debts.length > 0;
  for (const g of persona.goals) if (goals.length < 3 && !goals.includes(g) && !(owes && /\b(pay|debt|owe)/i.test(g))) goals.push(g);

  const relationships = relationsFor(sheet);
  const signature = signatureFor(persona, sheet);
  const hire = hireFor(persona, sheet);
  return { quirks, fears, loves, secrets, debts, dilemmas, arcs, goals, reputationFacts, relationships, ...(signature ? { signature } : {}), ...(hire ? { hire } : {}), written: [] };
}
