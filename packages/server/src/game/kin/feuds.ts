import type { PersonRow } from "../../store/peopleStore.js";
import type { Rec } from "../../store/recordStore.js";
import { addGrievance, settleAll, weightOn } from "../chatter/grievance.js";
import { adjustRel } from "../chatter/rel.js";
import { temperOf } from "../chatter/person.js";
import { unitFor } from "../dice.js";
import { learn } from "../gossip/knowledge.js";
import { eventRef } from "../gossip/refs.js";
import { recordLifeEvent } from "../people/events.js";
import { surnameOf, type LifeCtx, type SiteStep } from "../people/step.js";
import { perDay } from "../weather.js";

/**
 * Feuds (N45 decision 5). Grudges pass down: when someone dies, or when a child of theirs comes of age, part of the parent's open grievances
 * of weight ≥ 0.4 pass to their grown children (weight × INHERIT_SHARE), and a grudge against the dead passes to the dead's grown children
 * at half that. A **feud** is two families (a surname line in a place) with grievances both ways across at least two people each. While it
 * stands its members insult each other more readily, and it **flares**: a young hot-tempered member just come of age, or a grudge of a new
 * day, does a wrong to the other family (an affront that leaves a fresh grievance). It ends by a marriage between the families, by one line
 * dying out, or by fading (no grievance left).
 */
export const INHERIT_SHARE = 0.6;
export const AGAINST_DEAD_SHARE = 0.3;
export const PASS_AT = 0.4;
/** A feud flares about this often a year of its own accord. */
export const FLARES_A_YEAR = 1.5;
/** How often the families of a place are looked at for new feuds (days). */
export const FEUD_SCAN_DAYS = 6;

export interface FeudData {
  /** The two families: `<site>:<surname>`. */
  names: [string, string];
  cause: string;
  flares: number;
  lastFlare?: number;
  settledBy?: string;
}

export type Feud = Rec<FeudData>;

export const familyOf = (r: Pick<PersonRow, "site" | "name">): string => `${r.site}:${surnameOf(r.name)}`;

/** Grudges handed down today: by the dead to their children, against the dead to theirs, and by parents to a child just grown. */
export function inheritGrudges(ctx: LifeCtx, step: Pick<SiteStep, "deaths" | "grownUp">, day: number): number {
  const { store } = ctx;
  let passed = 0;
  const grownKids = (id: string) => store.people.childrenOf(id).filter((c) => c.death === null && c.job !== "child");
  for (const d of step.deaths) {
    for (const g of store.social.openOf(d.id)) {
      const w = weightOn(g, day);
      if (w < PASS_AT || g.against === "player") continue;
      for (const c of grownKids(d.id)) if (c.id !== g.against && addGrievance(store, { who: c.id, against: g.against, cause: `inherited:${g.cause_ref}`, weight: w * INHERIT_SHARE, day })) passed++;
    }
    for (const g of store.social.openAgainst(d.id)) {
      const w = weightOn(g, day);
      if (w < PASS_AT || g.who === "player") continue;
      for (const c of grownKids(d.id)) if (c.id !== g.who && addGrievance(store, { who: g.who, against: c.id, cause: `inherited:${g.cause_ref}`, weight: w * AGAINST_DEAD_SHARE, day })) passed++;
    }
  }
  for (const id of step.grownUp) {
    const r = store.people.get(id);
    if (!r) continue;
    for (const p of [r.mother, r.father]) {
      if (!p) continue;
      for (const g of store.social.openOf(p)) {
        const w = weightOn(g, day);
        if (w < PASS_AT || g.against === id || g.against === "player") continue;
        if (addGrievance(store, { who: id, against: g.against, cause: `inherited:${g.cause_ref}`, weight: w * INHERIT_SHARE * 0.8, day })) passed++;
      }
    }
  }
  return passed;
}

/** The open feud between two families, if any. */
export function feudBetween(ctx: Pick<LifeCtx, "store">, famA: string, famB: string): Feud | undefined {
  const [x, y] = [famA, famB].sort();
  return ctx.store.records.get<FeudData>(`feud:${x}|${y}`) && ctx.store.records.get<FeudData>(`feud:${x}|${y}`)!.ended === null ? ctx.store.records.get<FeudData>(`feud:${x}|${y}`) : undefined;
}

/** Are two people of families at feud? */
export const atFeud = (ctx: Pick<LifeCtx, "store">, a: Pick<PersonRow, "site" | "name">, b: Pick<PersonRow, "site" | "name">): boolean => familyOf(a) !== familyOf(b) && !!feudBetween(ctx, familyOf(a), familyOf(b));

/**
 * The feuds of a place today: new ones recognised (every FEUD_SCAN_DAYS), flares, and endings. Returns the events written.
 */
export function feudsDay(ctx: LifeCtx, step: Pick<SiteStep, "site" | "grownUp" | "marriages">, day: number): string[] {
  const { realm, store } = ctx;
  const site = step.site;
  const events: string[] = [];
  const rows = (store.people.loadSite(site, "full") as PersonRow[]).filter((r) => r.death === null);
  const fam = new Map<string, PersonRow[]>();
  for (const r of rows) {
    const f = familyOf(r);
    let l = fam.get(f);
    if (!l) fam.set(f, (l = []));
    l.push(r);
  }
  const famOf = new Map(rows.map((r) => [r.id, familyOf(r)]));

  // ---- New feuds ----
  if (day % FEUD_SCAN_DAYS === 0) {
    // For each person, the families they hold something against (weight ≥ 0.2), and who.
    const holds = new Map<string, Map<string, Set<string>>>();
    for (const r of rows) {
      if (!store.social.hasOpen(r.id)) continue;
      for (const g of store.social.openOf(r.id)) {
        const other = famOf.get(g.against);
        if (!other || other === famOf.get(r.id) || weightOn(g, day) < 0.2) continue;
        const mine = famOf.get(r.id)!;
        let m = holds.get(mine);
        if (!m) holds.set(mine, (m = new Map()));
        let s = m.get(other);
        if (!s) m.set(other, (s = new Set()));
        s.add(r.id);
      }
    }
    for (const [a, m] of [...holds].sort((x, y) => x[0].localeCompare(y[0]))) {
      for (const [b, who] of [...m].sort((x, y) => x[0].localeCompare(y[0]))) {
        if (a > b || who.size < 2) continue;
        const back = holds.get(b)?.get(a);
        if (!back || back.size < 2) continue;
        const [x, y] = [a, b].sort() as [string, string];
        const id = `feud:${x}|${y}`;
        const have = store.records.get<FeudData>(id);
        if (have && have.ended === null) continue;
        store.records.put<FeudData>({ id, kind: "feud", site, a: x, b: y, since: day, status: "open", ended: null, data: { names: [x, y], cause: `grudges both ways between the ${x.split(":")[1]}s and the ${y.split(":")[1]}s`, flares: 0 } });
        const e = recordLifeEvent(realm, store, { kind: "feud", actor: [...who][0]!, target: [...back][0]!, site, day, key: id, details: `The ${x.split(":")[1]}s and the ${y.split(":")[1]}s are at feud`, importance: 5, why: "grievances held both ways by several of each family" });
        for (const w of [...who, ...back]) learn(ctx, w, eventRef(e.id), { day, source: "saw", accuracy: 1 });
        events.push(e.id);
      }
    }
  }

  // ---- Flares, endings ----
  const wed = (step.marriages ?? []).map(([h, w]) => [famOf.get(h), famOf.get(w)] as const);
  for (const f of store.records.open<FeudData>("feud", (x) => x.site === site)) {
    const [fa, fb] = f.data.names;
    const A = fam.get(fa) ?? [];
    const B = fam.get(fb) ?? [];
    // A marriage between the families ends it, and most of what they held against each other.
    const match = wed.find(([p, q]) => (p === fa && q === fb) || (p === fb && q === fa));
    if (match || A.length === 0 || B.length === 0) {
      if (match) for (const x of A) for (const y of B) {
        settleAll(store, x.id, y.id, day);
        settleAll(store, y.id, x.id, day);
      }
      store.records.end(f.id, day, match ? "wed" : "died out", { settledBy: match ? "a marriage between the families" : "one line died out" });
      continue;
    }
    // Faded: nobody holds anything any more.
    const live = A.some((x) => store.social.openOf(x.id).some((g) => famOf.get(g.against) === fb && weightOn(g, day) >= 0.05)) || B.some((y) => store.social.openOf(y.id).some((g) => famOf.get(g.against) === fa && weightOn(g, day) >= 0.05));
    if (!live) {
      store.records.end(f.id, day, "faded", { settledBy: "time" });
      continue;
    }
    // A flare: one just come of age with a temper, or the feud's own year.
    const young = step.grownUp.map((id) => rows.find((r) => r.id === id)).find((r): r is PersonRow => !!r && (famOf.get(r.id) === fa || famOf.get(r.id) === fb) && temperOf(r).temper >= 0.45);
    const due = unitFor(realm.seed, "flare", f.id, day) < perDay(FLARES_A_YEAR);
    if (!young && !due) continue;
    const doer = young ?? pickHot(A.concat(B), (r) => store.social.openOf(r.id).length);
    if (!doer) continue;
    const mineIsA = famOf.get(doer.id) === fa;
    const targets = (mineIsA ? B : A).filter((r) => r.job !== "child");
    if (targets.length === 0) continue;
    const victim = targets[Math.floor(unitFor(realm.seed, "flare-target", f.id, day) * targets.length)]!;
    addGrievance(store, { who: victim.id, against: doer.id, cause: `feud:${f.id}`, weight: 0.45, day });
    adjustRel(store, victim.id, doer.id, { affection: -12, trust: -8 }, day);
    const e = recordLifeEvent(realm, store, {
      kind: "feud",
      actor: doer.id,
      target: victim.id,
      site,
      day,
      key: `${f.id}:flare:${f.data.flares + 1}`,
      details: `${doer.name} picked a fight with ${victim.name}: the feud between the ${fa.split(":")[1]}s and the ${fb.split(":")[1]}s flared again`,
      importance: 4,
      why: young ? `${doer.name} came of age holding the family's grudge` : "the old feud",
      causedBy: [f.id],
      witnesses: [victim.id],
    });
    learn(ctx, victim.id, eventRef(e.id), { day, source: "saw", accuracy: 1 });
    learn(ctx, doer.id, eventRef(e.id), { day, source: "did", accuracy: 1 });
    store.records.patch<FeudData>(f.id, { data: { flares: f.data.flares + 1, lastFlare: day } });
    events.push(e.id);
  }
  return events;
}

const pickHot = (rows: PersonRow[], grudges: (r: PersonRow) => number): PersonRow | undefined =>
  [...rows].filter((r) => r.job !== "child").sort((a, b) => grudges(b) + temperOf(b).temper - grudges(a) - temperOf(a).temper || a.id.localeCompare(b.id))[0];
