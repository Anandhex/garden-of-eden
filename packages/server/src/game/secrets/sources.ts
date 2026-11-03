import type { PersonRow } from "../../store/peopleStore.js";
import { rankOf, temperOf } from "../chatter/person.js";
import { unitFor } from "../dice.js";
import type { LifeCtx } from "../people/step.js";
import { addSecret, knowSecret, type SecretData } from "./model.js";

/**
 * Where secrets come from and how they are found (N46 steps 1–2). Systems that do hidden things make one: a crime nobody was seen to see
 * (`crime`), N45's affairs (`affair`) and true fathers (`bastard`), hidden debts (`debt`). Found by:
 *
 * - **Witnessing:** for an unwitnessed crime, everyone near (of the doer's household, street or work) rolls their perception: a few see it
 *   after all, and know the secret without the doer knowing they do.
 * - **Servants:** those who serve a household (its slaves, serfs and hands living under its roof, N16's `master_id`) learn its secrets
 *   about once a season, and tell them more readily when they hold a grudge against the master.
 */
export const CRIME_KINDS = ["theft", "attacked", "killed", "bribe", "crime", "trespass"] as const;
/** The chance each person near an unseen crime saw it after all. */
export const PERCEIVE = 0.05;
/** Servants learn a household's secret about this often a day. */
export const SERVANT_DAILY = 0.08;

/** Today's hidden crimes in a place become secrets, and the unseen witnesses roll to have seen them. Returns the secrets made. */
export function crimeSecrets(ctx: LifeCtx, site: string, day: number): string[] {
  const { realm, store } = ctx;
  const out: string[] = [];
  const events = store.eventsAt(site, day, CRIME_KINDS as unknown as string[]);
  if (events.length === 0) return out;
  const rows = (store.people.loadSite(site, "full") as PersonRow[]).filter((r) => r.death === null && !r.away && r.job !== "child");
  for (const e of events) {
    if ((e.witnesses ?? []).length > 0 || !e.actor || e.actor === "player") continue;
    const doer = store.people.get(e.actor);
    if (!doer || doer.death !== null) continue;
    const victim = e.target ? store.people.get(e.target) : null;
    const weight = Math.min(10, 3 + (e.kind === "killed" ? 6 : e.kind === "attacked" ? 3 : e.kind === "bribe" ? 2 : 1) + (rankOf(doer) >= 5 ? 2 : 0));
    const data: SecretData = { what: "crime", about: doer.id, ...(victim ? { others: [victim.id] } : {}), text: `${doer.name} ${e.details.replace(doer.name, "").trim() || `did ${e.kind}`}, and no one saw`, weight, event: e.id };
    const sec = addSecret(store, { site, day, key: e.id, data });
    knowSecret(ctx, doer.id, sec.id, day, "did");
    out.push(sec.id);
    // Unseen witnesses: a household, a street, a workplace.
    for (const r of rows) {
      if (r.id === doer.id || r.id === victim?.id) continue;
      const near = r.home === doer.home || r.work === doer.work || (victim && (r.home === victim.home || r.work === victim.work));
      if (!near && unitFor(realm.seed, "far-see", e.id, r.id) >= 0.2) continue;
      if (unitFor(realm.seed, "perceive", e.id, r.id) < PERCEIVE * (near ? 3 : 1)) knowSecret(ctx, r.id, sec.id, day, "saw");
    }
  }
  return out;
}

/** A household's servants come to know its secrets. Returns how many learned something. */
export function servantsLearn(ctx: LifeCtx, site: string, day: number): number {
  const { realm, store } = ctx;
  const secrets = store.records.open<SecretData>("secret", (s) => s.site === site);
  if (secrets.length === 0) return 0;
  const rows = (store.people.loadSite(site, "full") as PersonRow[]).filter((r) => r.death === null && !r.away);
  const byHome = new Map<number, PersonRow[]>();
  for (const r of rows) if (r.home !== null) byHome.set(r.home, [...(byHome.get(r.home) ?? []), r]);
  let n = 0;
  for (const s of secrets) {
    const about = store.people.get(s.data.about);
    if (!about || about.home === null) continue;
    for (const r of byHome.get(about.home) ?? []) {
      if (r.id === about.id || r.job === "child" || (r.master_id !== about.id && r.cls !== "slave" && r.cls !== "serf")) continue;
      if (store.knowledge.has(r.id, `s:${s.id}`)) continue;
      if (unitFor(realm.seed, "servant", s.id, r.id, day) < SERVANT_DAILY * (1 + (1 - temperOf(r).honesty) * 0.5) && knowSecret(ctx, r.id, s.id, day, "served")) n++;
    }
  }
  return n;
}
