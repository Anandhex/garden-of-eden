import type { PlayerState } from "../../npc/types.js";
import type { PersonRow } from "../../store/peopleStore.js";
import { streamFor, unitFor } from "../dice.js";
import { recordLifeEvent } from "../people/events.js";
import type { LifeCtx } from "../people/step.js";
import { transfer } from "../realm/ledger.js";
import { sentencePlayer, type PlayerSentence } from "./justice.js";
import { crimes, judgeOf } from "./sentence.js";
import { clerksRecord, jailedNow, wordWeight, GUILTY_AT, type CaseData, type Verdict } from "./trial.js";

/**
 * The player before the law (N48): a case against them like anyone's, tried by the same weights (their word as a commoner's); a judge
 * they can try to buy (a greedy one takes it and the case is dropped; an honest one charges them with bribery as well); prisoners they can
 * break out (and a case for aiding an escape follows them).
 */
export function openPlayerCase(ctx: LifeCtx, p: PlayerState | null, crime: string, site: string, day: number, witnesses: string[]): string {
  const id = `case:player:${crime}:${site}:${day}`;
  if (!ctx.store.records.has(id)) ctx.store.records.put<CaseData>({ id, kind: "case", site, a: witnesses[0] ?? null, b: "player", since: day, status: "open", ended: null, data: { crime, accused: "player", witnesses } });
  // Opened from a place's own day (a trail that led to the player) there is no player at hand: `playerCases` finds it all the same.
  if (p) (p.society ??= {}).cases = [...new Set([...(p.society.cases ?? []), id])];
  return id;
}

/** Every open case against the player, wherever it was opened. */
export const playerCases = (ctx: Pick<LifeCtx, "store">): string[] => ctx.store.records.open<CaseData>("case", (c) => c.data.accused === "player").map((c) => c.id);

/** What a judge wants to be bought: nothing from an honest one (Infinity), less from a greedy one. */
export function judgePrice(ctx: LifeCtx, site: string): number {
  const j = judgeOf(ctx.realm, site);
  if (!j) return 60;
  if (j.greed < 0.35 && j.loyalty > 0.5) return Infinity;
  return Math.round(40 + 260 * (1 - j.greed));
}

/** Offer the judge of a case coin. Taken: the case is dropped. Refused by an honest one: a bribery case, tried at once. */
export function bribeJudge(ctx: LifeCtx, p: PlayerState, caseId: string, amount: number, day: number): { ok: boolean; lines: string[]; sentence?: PlayerSentence } {
  const { realm, store } = ctx;
  const c = store.records.get<CaseData>(caseId);
  if (!c || c.ended !== null || c.data.accused !== "player" || !c.site) return { ok: false, lines: ["There's no case against you to settle."] };
  const judge = judgeOf(realm, c.site);
  if (p.money < amount) return { ok: false, lines: ["You haven't that much."] };
  const need = judgePrice(ctx, c.site);
  if (judge && amount >= need) {
    transfer(realm, "player", `p:${judge.id}`, amount, `a bribe to drop a case against ${p.name}`, p, day);
    store.records.end(caseId, day, "dropped", { verdict: "dropped", bribe: { by: "player", amount }, judge: judge.id });
    recordLifeEvent(realm, store, { kind: "bribe", actor: judge.id, target: "player", site: c.site, day, key: `${caseId}:judge`, details: `${judge.name} took ${amount} copper and found no case`, importance: 4 });
    return { ok: true, lines: [`${judge.name} weighs the purse, then the case. "On reflection, there is nothing here."`] };
  }
  if (need === Infinity || (judge && amount < need && unitFor(realm.seed, "judge-insulted", caseId) < 0.5)) {
    // An honest judge (or an insulted one): bribery on top.
    store.records.patch<CaseData>(caseId, { data: { record: "the accused tried to bribe the judge" } });
    const s = sentencePlayer(realm, p, "bribery", c.site, day, streamFor(realm.seed, "bribe-judge", caseId));
    openPlayerCase(ctx, p, "bribery", c.site, day, judge ? [judge.id] : []);
    return { ok: false, lines: [`${judge?.name ?? "The judge"} looks at the coin and calls the guard. You're charged with bribery.`, ...s.lines], sentence: s };
  }
  return { ok: false, lines: [`${judge?.name ?? "The judge"} pushes the purse back. "Not enough to forget what I've heard."`] };
}

/** Try the player's case now, by the same weights as anyone's. Guilty: sentenced (N26J's player sentences). */
export function tryPlayer(ctx: LifeCtx, p: PlayerState, caseId: string, day: number): { verdict: Verdict; sentence?: PlayerSentence } {
  const { realm, store } = ctx;
  const c = store.records.get<CaseData>(caseId)!;
  const place = c.site!;
  const parts: Array<[string, number]> = [];
  for (const id of c.data.witnesses ?? []) {
    const w = store.people.get(id);
    if (w) parts.push([`${w.name}'s word (${w.cls}${w.job === "guard" ? ", of the watch" : ""})`, wordWeight(realm, place, w.cls, day) * (w.job === "guard" ? 2 : 1)]);
  }
  parts.push([`${p.name}'s own word`, -0.5 * wordWeight(realm, place, "commoner", day)]);
  parts.push(["the edge", (unitFor(realm.seed, "trial", caseId) - 0.5) * 0.1]);
  const guilt = parts.reduce((a, [, v]) => a + v, 0);
  const verdict: Verdict = { guilty: guilt >= GUILTY_AT, dropped: false, parts, judge: judgeOf(realm, place)?.id ?? null, guilt };
  store.records.end(caseId, day, verdict.guilty ? "guilty" : "not guilty", { verdict: verdict.guilty ? "guilty" : "not guilty", parts, record: clerksRecord(p.name, c.data.crime, verdict) });
  recordLifeEvent(realm, store, { kind: "trial", actor: "player", site: place, day, key: caseId, details: `${p.name} was tried for ${crimes()[c.data.crime]?.words ?? c.data.crime} and found ${verdict.guilty ? "guilty" : "not guilty"}`, importance: 4, why: clerksRecord(p.name, c.data.crime, verdict) });
  if (!verdict.guilty) return { verdict };
  return { verdict, sentence: sentencePlayer(realm, p, c.data.crime, place, day, streamFor(realm.seed, "player-trial", caseId)) };
}

/** Break someone out of a cell: they go free, and the player has a case for aiding an escape. */
export function breakOut(ctx: LifeCtx, p: PlayerState, prisoner: PersonRow, day: number, hour: number): string[] {
  const { realm, store } = ctx;
  const j = jailedNow(store, prisoner.id, day);
  if (!j) return [`${prisoner.name} isn't held anywhere you know of.`];
  const guards = (store.people.loadSite(prisoner.site, "full") as PersonRow[]).filter((r) => r.death === null && r.job === "guard");
  const seen = streamFor(realm.seed, "breakout", prisoner.id, day, hour)() < 0.5;
  store.records.end(j.id, day, "broken out");
  const witnesses = seen ? guards.slice(0, 2).map((g) => g.id) : [];
  recordLifeEvent(realm, store, { kind: "jailbreak", actor: "player", target: prisoner.id, site: prisoner.site, day, hour, key: `${prisoner.id}:out`, details: `${p.name} broke ${prisoner.name} out of the cell`, importance: 5, witnesses });
  const id = openPlayerCase(ctx, p, "aiding_escape", prisoner.site, day, witnesses);
  return [`You get ${prisoner.name} out.${seen ? " The watch saw your face: there'll be a case against you." : " Nobody saw, this time."}`, ...(seen ? [`(${id})`] : [])];
}
