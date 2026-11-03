import type { PersonRow } from "../../store/peopleStore.js";
import { config } from "../../config.js";
import { addGrievance } from "../chatter/grievance.js";
import { adjustRel } from "../chatter/rel.js";
import { rankOf, temperOf } from "../chatter/person.js";
import { unitFor } from "../dice.js";
import type { GameEvent } from "../events.js";
import { learn } from "../gossip/knowledge.js";
import { eventRef } from "../gossip/refs.js";
import { recordLifeEvent } from "../people/events.js";
import { outlookOf } from "../people/outlook.js";
import type { LifeCtx } from "../people/step.js";
import { killPerson } from "../people/index.js";
import { addSecret, knowSecret, type DemandData, type SecretData } from "./model.js";

/**
 * What follows using a secret (N46 decisions 5–6). The menu's `blackmail` and `expose` (and the player's same deeds) leave events naming the
 * secret; the place's day then:
 *
 * - opens a **demand** for a blackmail (a payment every DEMAND_EVERY days), and the one it's about answers, scored from who they are (the
 *   reason is logged): **pay** (cautious, with more to lose), **refuse** (honest, brave: the knower may then expose), **flee** (the household
 *   wants to move), or **silence** the knower (ruthless, high-born): with violence on, a murder (itself a new secret, the murderer's), else
 *   a threat that leaves the knower too afraid to speak again;
 * - makes an **exposure** public: the secret is out, and its consequences follow by kind (an affair's spouse hears it through gossip, N45;
 *   a crime is a case before the law, N48; a spy is taken).
 */
export const DEMAND_EVERY = 12;
/** A demand paid this many times is weighed again (the payer's patience wears out). */
export const PATIENCE = 3;

export type Answer = NonNullable<DemandData["answer"]>;

/** How the one a secret is about answers a demand: the scores (the reason) and the pick. */
export function answerOf(ctx: LifeCtx, subject: PersonRow, knower: PersonRow, sec: SecretData, salt: string): { answer: Answer; parts: Array<[string, number]> } {
  const t = temperOf(subject);
  const k = temperOf(knower);
  const r = rankOf(subject);
  const ruthless = t.temper * 0.5 + (1 - t.honesty) * 0.5;
  const parts: Record<Answer, Array<[string, number]>> = {
    pay: [["cautious", (1 - t.temper) * 0.5], ["has the means", r * 0.06], [`what it would cost (${sec.weight})`, sec.weight * 0.05]],
    refuse: [["honest", t.honesty * 0.4], ["brave", t.bravery * 0.35], ["it isn't so bad", (10 - sec.weight) * 0.04]],
    flee: [["afraid", (1 - t.bravery) * 0.35], [`what it would cost (${sec.weight})`, sec.weight * 0.03], ["has nothing to keep them", r <= 2 ? 0.15 : -0.2]],
    silence: [["ruthless", ruthless * 0.7], ["stands above them", Math.max(0, r - k.rank) * 0.12], ["it would be the end of them", sec.weight >= 7 ? 0.2 : 0], ["blood on their hands", -0.45]],
  };
  let best: Answer = "pay";
  let top = -Infinity;
  for (const a of Object.keys(parts) as Answer[]) {
    const s = parts[a].reduce((x, [, v]) => x + v, 0) + 0.25 * unitFor(ctx.realm.seed, "answer", salt, a);
    if (s > top) [best, top] = [a, s];
  }
  return { answer: best, parts: parts[best] };
}

export function useDay(ctx: LifeCtx, site: string, day: number): { demands: number; exposed: number; silenced: number } {
  const { realm, store } = ctx;
  const out = { demands: 0, exposed: 0, silenced: 0 };
  const events = store.eventsAt(site, day, ["blackmail", "exposure"]);
  for (const e of events) {
    const secId = e.causedBy?.[0];
    const sec = secId ? store.records.get<SecretData>(secId) : undefined;
    if (!sec) continue;
    if (e.kind === "exposure") {
      if (expose(ctx, sec.id, e, day)) out.exposed++;
      continue;
    }
    const id = `demand:${sec.id}:${e.actor}`;
    if (store.records.has(id)) continue;
    const subject = store.people.get(sec.data.about);
    const knower = e.actor === "player" ? null : store.people.get(e.actor);
    if (!subject || subject.death !== null) continue;
    const amount = 10 * Math.max(1, rankOf(subject));
    store.records.put<DemandData>({ id, kind: "demand", site, a: e.actor, b: subject.id, since: day, status: "open", ended: null, data: { secret: sec.id, by: e.actor, of: subject.id, amount, every: DEMAND_EVERY, paid: 0 } });
    out.demands++;
    if (knower) out.silenced += answer(ctx, id, subject, knower, day) === "silence" ? 1 : 0;
  }
  // Demands falling due: paid again, or weighed again once patience runs out.
  for (const d of store.records.open<DemandData>("demand", (x) => x.site === site && x.data.answer === "pay" && x.data.by !== "player")) {
    if (day - (d.data.last ?? d.since) < d.data.every) continue;
    const subject = store.people.get(d.data.of);
    const knower = store.people.get(d.data.by);
    if (!subject || !knower || subject.death !== null || knower.death !== null) {
      store.records.end(d.id, day, "lapsed");
      continue;
    }
    if (d.data.paid >= PATIENCE) {
      addGrievance(store, { who: subject.id, against: knower.id, cause: `e:${d.id}`, weight: 0.4, day });
      if (answer(ctx, d.id, subject, knower, day, `again${d.data.paid}`) === "silence") out.silenced++;
    } else store.records.patch<DemandData>(d.id, { data: { paid: d.data.paid + 1, last: day } });
  }
  return out;
}

/** The one a demand is made of answers it. */
function answer(ctx: LifeCtx, demandId: string, subject: PersonRow, knower: PersonRow, day: number, salt = ""): Answer {
  const { realm, store } = ctx;
  const d = store.records.get<DemandData>(demandId)!;
  const sec = store.records.get<SecretData>(d.data.secret)!;
  const { answer: a, parts } = answerOf(ctx, subject, knower, sec.data, `${demandId}${salt}`);
  const why = parts.map(([n, v]) => `${n} ${v.toFixed(2)}`).join(", ");
  if (a === "pay") {
    store.records.patch<DemandData>(demandId, { data: { answer: "pay", paid: d.data.paid + 1, last: day } });
    recordLifeEvent(realm, store, { kind: "blackmail", actor: subject.id, target: knower.id, site: subject.site, day, key: `${demandId}:pay${salt}`, details: `${subject.name} paid ${knower.name} to keep quiet`, importance: 2, why });
  } else if (a === "refuse") {
    store.records.patch<DemandData>(demandId, { status: "refused", data: { answer: "refuse" } });
    adjustRel(store, knower.id, subject.id, { affection: -10 }, day);
    // A refusal is a grudge the knower holds: the menu's `expose` reads it (and that they had a demand).
    addGrievance(store, { who: knower.id, against: subject.id, cause: `e:${demandId}`, weight: 0.4, day });
  } else if (a === "flee") {
    const o = outlookOf(subject);
    if (!o.goal) o.goal = { kind: "move", since: day };
    store.people.update(subject.id, { outlook: JSON.stringify(o) });
    store.records.end(demandId, day, "fled", { answer: "flee" });
  } else {
    silence(ctx, subject, knower, sec.id, demandId, day, why);
  }
  return a;
}

/** Someone is silenced by the one their secret is about: a murder with violence on (a new secret), else a threat that shuts them up. */
export function silence(ctx: LifeCtx, subject: PersonRow, knower: PersonRow, secretId: string, demandId: string | null, day: number, why: string): void {
  const { realm, store } = ctx;
  const sec = store.records.get<SecretData>(secretId)!;
  if (config.choice.violence) {
    killPerson(realm, store, knower.id, { cause: "murder", day, killer: subject.id, note: "silenced" } as never);
    const e = recordLifeEvent(realm, store, { kind: "silenced", actor: subject.id, target: knower.id, site: subject.site, day, key: `${secretId}:${knower.id}`, details: `${knower.name} was found dead`, importance: 6, why });
    // The murder is a secret of its own: only the murderer knows who did it.
    const m = addSecret(store, { site: subject.site, day, key: e.id, data: { what: "crime", about: subject.id, others: [knower.id], text: `${subject.name} had ${knower.name} killed to keep them quiet`, weight: 10, event: e.id } });
    knowSecret(ctx, subject.id, m.id, day, "did");
  } else {
    adjustRel(store, knower.id, subject.id, { fear: 45 }, day);
    const e = recordLifeEvent(realm, store, { kind: "silenced", actor: subject.id, target: knower.id, site: subject.site, day, key: `${secretId}:${knower.id}`, details: `${subject.name} made it plain to ${knower.name} what speaking would cost them`, importance: 3, why, witnesses: [knower.id] });
    learn(ctx, knower.id, eventRef(e.id), { day, source: "saw", accuracy: 1 });
  }
  store.records.patch<SecretData & { silenced?: string[] }>(secretId, { data: { silenced: [...new Set([...((sec.data as { silenced?: string[] }).silenced ?? []), knower.id])] } as never });
  // A silenced knower no longer counts as holding it.
  store.knowledge.remove(knower.id, `s:${secretId}`);
  if (demandId) store.records.end(demandId, day, "silenced", { answer: "silence" });
}

/** A secret made public by an event: who it shames, and what follows by kind. Returns true if it was news. */
export function expose(ctx: LifeCtx, secretId: string, e: Pick<GameEvent, "id" | "actor" | "day">, day: number): boolean {
  const { realm, store } = ctx;
  const sec = store.records.get<SecretData>(secretId);
  if (!sec || sec.data.exposed) return false;
  store.records.patch<SecretData>(secretId, { status: "exposed", data: { exposed: { day, event: e.id, by: e.actor } } });
  const subject = store.people.get(sec.data.about);
  if (subject) {
    // Their name suffers by what it was.
    store.people.update(subject.id, { renown: Math.max(-100, (subject.renown ?? 0) - Math.round(sec.data.weight * 1.5)) });
  }
  // By kind: an affair's spouse hears it as gossip does (N45 reads `told`); a crime is a case before the law (N48).
  if (sec.data.what === "affair") store.records.patch(secretId, { data: { told: e.id } });
  if (sec.data.what === "crime" && subject) {
    const cases = (store.records.get(`case:${secretId}`) ? [] : [1]).length;
    if (cases) store.records.put({ id: `case:${secretId}`, kind: "case", site: subject.site, a: e.actor, b: subject.id, since: day, status: "open", ended: null, data: { crime: sec.data.event ?? secretId, accused: subject.id, accuser: e.actor, secret: secretId, text: sec.data.text, weight: sec.data.weight } });
  }
  void realm;
  return true;
}
