import type { PersonRow } from "../../store/peopleStore.js";
import type { Rec } from "../../store/recordStore.js";
import { config } from "../../config.js";
import { viewOf } from "../chatter/rel.js";
import { temperOf as rowTemper } from "../chatter/person.js";
import { streamFor, unitFor } from "../dice.js";
import type { WorldStore } from "../db.js";
import { learn } from "../gossip/knowledge.js";
import { eventRef } from "../gossip/refs.js";
import { recordLifeEvent } from "../people/events.js";
import type { LifeCtx } from "../people/step.js";
import { policyAt } from "../realm/policy.js";
import type { Realm } from "../realm/types.js";
import { secretsKnownBy } from "../secrets/model.js";
import { crimes, judgeOf, temperOf } from "./sentence.js";

/**
 * Trials (N48 decisions 2–5, 7). A crime the authorities know of is a **case** (a record of kind "case"): seen by the watch or a witness
 * (N26J's justice day), exposed (N46), a false accusation (the menu's `accuse`). A trial weighs the evidence, every part named:
 *
 * - each witness's word, by their class as the kingdom's `class_weight` law weighs it, less any fondness for the accused; the watch's word
 *   counts double;
 * - the accused's own word (half: a denial is weaker than testimony), and up to three friends who speak for their character;
 * - leverage (the accused knows a secret of the judge's: the case is dropped), a bribe the judge took;
 * - the judge's temper and the place's anger, and a small roll at the edge.
 *
 * Guilty sends it to the sentence (game/law/sentence.ts, by the law book); not guilty clears them, and an accusation found false is
 * slander: the accuser is tried for it. A clerk's record of the parts is what the hearing says (the `hearing` words, with no model).
 */
export const GUILTY_AT = 0.35;

export interface CaseData {
  crime: string;
  accused: string;
  accuser?: string;
  witnesses?: string[];
  /** The event or secret it rests on. */
  event?: string;
  secret?: string;
  /** No crime was done: an accusation made up. */
  false?: boolean;
  /** Bribe the judge took (copper), by whom. */
  bribe?: { by: string; amount: number };
  verdict?: "guilty" | "not guilty" | "dropped";
  parts?: Array<[string, number]>;
  judge?: string;
  record?: string;
  text?: string;
  weight?: number;
}
export type Case = Rec<CaseData>;

const CLASS_ORDER = ["slave", "serf", "commoner", "artisan", "merchant", "clergy", "gentry", "noble", "royal"] as const;
const WEIGHTS: Record<string, number[]> = {
  strong: [0.25, 0.4, 1, 1.2, 1.3, 1.6, 2.5, 4, 5],
  some: [0.6, 0.75, 1, 1.1, 1.15, 1.3, 1.6, 2, 2.5],
  equal: [1, 1, 1, 1, 1, 1, 1, 1, 1],
};
/** How much a person's word weighs in court by their class, by the kingdom's `class_weight` law. */
export function wordWeight(realm: Realm, place: string, cls: string, day: number): number {
  const law = policyAt(realm, place, "class_weight", day);
  const i = Math.max(0, CLASS_ORDER.indexOf(cls as (typeof CLASS_ORDER)[number]));
  return (WEIGHTS[law] ?? WEIGHTS.some!)[i]!;
}

export interface Verdict {
  guilty: boolean;
  dropped: boolean;
  parts: Array<[string, number]>;
  judge: string | null;
  guilt: number;
}

/** The verdict on a case, from its evidence. Pure but for the case's own roll. */
export function verdictOf(ctx: LifeCtx, c: { id: string; crime: string; accused: PersonRow; witnesses: PersonRow[]; place: string; day: number; false?: boolean; bribe?: number; accuser?: PersonRow | null; planted?: boolean }): Verdict {
  const { realm, store } = ctx;
  const judge = judgeOf(realm, c.place);
  const parts: Array<[string, number]> = [];
  // Leverage: the accused holds a secret of the judge's.
  if (judge && secretsKnownBy(store, c.accused.id).some((s) => s.data.about === judge.id)) {
    return { guilty: false, dropped: true, parts: [[`${c.accused.name} knows something of ${judge.name}'s`, -9]], judge: judge.id, guilt: -9 };
  }
  for (const w of c.witnesses) {
    if (w.id === c.accused.id) continue;
    const fond = Math.max(0, viewOf(store, w.id, c.accused.id, c.day).affection) / 100;
    const watch = w.job === "guard" ? 2 : 1;
    // A false accuser's word is thin: what they say doesn't hold together.
    const thin = c.false && w.id === c.accuser?.id ? 0.4 + 0.3 * rowTemper(w).honesty : 1;
    parts.push([`${w.name}'s word (${w.cls}${watch > 1 ? ", of the watch" : ""})`, wordWeight(realm, c.place, w.cls, c.day) * watch * (1 - fond) * thin]);
  }
  parts.push([`${c.accused.name}'s own word (${c.accused.cls})`, -0.5 * wordWeight(realm, c.place, c.accused.cls, c.day)]);
  if (c.false) parts.push(["nothing found on them", -0.4]);
  // Goods found in their house (planted or not: the court can't tell, N52).
  if (c.planted) parts.push(["stolen goods found in their house", 1]);
  const friends = (store.people.loadSite(c.place, "full") as PersonRow[]).filter((r) => r.death === null && r.id !== c.accused.id && !c.witnesses.some((w) => w.id === r.id) && (store.social.rel(r.id, c.accused.id)?.affection ?? 0) >= 40).slice(0, 3);
  if (friends.length > 0) parts.push([`${friends.length} spoke for ${c.accused.name}`, -0.15 * friends.length]);
  const t = temperOf(judge);
  parts.push([judge ? `${judge.name}'s temper` : "the elders' temper", (t.harsh - t.merciful) * 0.2]);
  const mood = (realm.settlements[c.place]?.mood as { anger?: number } | undefined)?.anger ?? 0;
  if (mood > 40) parts.push(["an angry place", (mood - 40) / 200]);
  if (c.bribe && judge) parts.push([`coin in ${judge.name}'s purse`, -2]);
  parts.push(["the edge", (unitFor(realm.seed, "trial", c.id) - 0.5) * 0.1]);
  const guilt = parts.reduce((a, [, v]) => a + v, 0);
  return { guilty: guilt >= GUILTY_AT, dropped: false, parts, judge: judge?.id ?? null, guilt };
}

/** The clerk's record of a trial: the parts in plain words (the hearing's words when there's no model). */
export function clerksRecord(name: string, crime: string, v: Verdict): string {
  const said = v.parts.filter(([, x]) => Math.abs(x) >= 0.05).map(([p, x]) => `${p} (${x > 0 ? "against" : "for"} them)`).join("; ");
  return `${name}, charged with ${crimes()[crime]?.words ?? crime}: ${v.dropped ? "the case was dropped" : v.guilty ? "found guilty" : "found not guilty"}. ${said}.`;
}

/**
 * Try a case now, and write the trial event. Returns the verdict. The sentence (when guilty) is the caller's: N26J's justice day sentences
 * the guilty as before; cases opened here (exposure, accusations) are sentenced by `trialsDay`.
 */
export function tryCase(ctx: LifeCtx, c: { id: string; crime: string; accused: PersonRow; witnesses: PersonRow[]; place: string; day: number; false?: boolean; bribe?: number; accuser?: PersonRow | null; planted?: boolean }): Verdict {
  const v = verdictOf(ctx, c);
  const record = clerksRecord(c.accused.name, c.crime, v);
  const e = recordLifeEvent(ctx.realm, ctx.store, {
    kind: "trial",
    actor: c.accused.id,
    target: v.judge ?? "",
    site: c.place,
    day: c.day,
    key: c.id,
    details: `${c.accused.name} was tried for ${crimes()[c.crime]?.words ?? c.crime} and ${v.dropped ? "the case was dropped" : v.guilty ? "found guilty" : "found not guilty"}`,
    importance: 3,
    why: record,
    witnesses: c.witnesses.map((w) => w.id).slice(0, 5),
  });
  for (const w of [c.accused.id, ...c.witnesses.map((x) => x.id)]) learn(ctx, w, eventRef(e.id), { day: c.day, source: "saw", accuracy: 1 });
  ctx.realm.stats[v.guilty ? "verdictGuilty" : "verdictFree"] = (ctx.realm.stats[v.guilty ? "verdictGuilty" : "verdictFree"] ?? 0) + 1;
  return v;
}

/** Jail (N48 decision 6): a row locked up until a day, in the place's cell. */
export function jail(store: Pick<WorldStore, "records">, row: Pick<PersonRow, "id" | "site">, until: number, day: number, why: string): void {
  store.records.put({ id: `jail:${row.id}:${day}`, kind: "jail", site: row.site, a: row.id, b: null, since: day, status: "held", ended: null, data: { until, why } });
}

export const jailedNow = (store: Pick<WorldStore, "records">, id: string, day: number): Rec<{ until: number; why: string }> | undefined =>
  store.records.open<{ until: number; why: string }>("jail", (j) => j.a === id && j.data.until > day)[0];

/**
 * A place's cases on a day: those opened by exposure (N46) and accusations, tried; the guilty sentenced (`sentence` is the caller's
 * sentencePerson, passed in to avoid a cycle); a false accusation becomes slander against its accuser; jail terms end.
 */
export function trialsDay(ctx: LifeCtx, site: string, day: number, sentence: (row: PersonRow, crime: string, witnesses: string[]) => void): number {
  if (!config.society.trials) return 0;
  const { realm, store } = ctx;
  let n = 0;
  // Accusations made today (the menu's `accuse`): a case each.
  for (const e of store.eventsAt(site, day, ["accusation"])) {
    const id = `case:${e.id}`;
    if (store.records.has(id) || !e.target) continue;
    store.records.put<CaseData>({ id, kind: "case", site, a: e.actor, b: e.target, since: day, status: "open", ended: null, data: { crime: "theft", accused: e.target, accuser: e.actor, witnesses: [e.actor], event: e.id, false: true } });
  }
  for (const c of store.records.open<CaseData>("case", (x) => x.site === site && x.data.accused !== "player")) {
    const accused = store.people.get(c.data.accused);
    if (!accused || accused.death !== null) {
      store.records.end(c.id, day, "lapsed");
      continue;
    }
    const witnesses = [...new Set([c.data.accuser, ...(c.data.witnesses ?? [])].filter((x): x is string => !!x && x !== "player"))].map((id) => store.people.get(id)).filter((r): r is PersonRow => !!r && r.death === null);
    const crime = crimes()[c.data.crime] ? c.data.crime : "theft";
    const v = tryCase(ctx, { id: c.id, crime, accused, witnesses, place: site, day, ...(c.data.false ? { false: true } : {}), ...((c.data as { planted?: boolean }).planted ? { planted: true } : {}), ...(c.data.bribe ? { bribe: c.data.bribe.amount } : {}), accuser: c.data.accuser ? store.people.get(c.data.accuser) : null });
    store.records.end(c.id, day, v.dropped ? "dropped" : v.guilty ? "guilty" : "not guilty", { verdict: v.dropped ? "dropped" : v.guilty ? "guilty" : "not guilty", parts: v.parts, judge: v.judge ?? "", record: clerksRecord(accused.name, crime, v) });
    if (v.guilty) sentence(accused, crime, witnesses.map((w) => w.id));
    // Found false: the accuser answers for it.
    if (!v.guilty && c.data.false && c.data.accuser) {
      const accuser = store.people.get(c.data.accuser);
      if (accuser && accuser.death === null) sentence(accuser, "slander", [accused.id]);
    }
    n++;
  }
  // Terms served.
  for (const j of store.records.open<{ until: number }>("jail", (x) => x.site === site && x.data.until <= day)) store.records.end(j.id, day, "served");
  void streamFor;
  return n;
}

/** A ruler who would pardon this one (N48 decision 5): mercy (low harshness), the condemned's name, and the dice. */
export function pardonOf(realm: Realm, row: Pick<PersonRow, "id" | "renown">, place: string, day: number): { id: string; name: string } | null {
  const k = realm.settlements[place]?.kingdom;
  const ruler = k ? realm.kingdoms[k]?.ruler : null;
  const f = ruler ? realm.figures[ruler] : undefined;
  if (!f?.alive) return null;
  const t = temperOf(f);
  const p = 0.05 + 0.25 * t.merciful + Math.max(0, row.renown ?? 0) / 200 - (policyAt(realm, place, "punishments", day) === "harsh" ? 0.1 : 0);
  return unitFor(realm.seed, "pardon", row.id, day) < p ? { id: f.id, name: f.name } : null;
}
