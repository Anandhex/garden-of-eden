import type { PersonRow } from "../../store/peopleStore.js";
import { addGrievance } from "../chatter/grievance.js";
import { adjustRel, viewOf } from "../chatter/rel.js";
import { temperOf } from "../chatter/person.js";
import { unitFor } from "../dice.js";
import { learn } from "../gossip/knowledge.js";
import { eventRef } from "../gossip/refs.js";
import { recordLifeEvent } from "../people/events.js";
import { ageFrom, closeKin, isGrown } from "../people/rules.js";
import type { LifeCtx, SiteStep } from "../people/step.js";
import { policyAt } from "../realm/policy.js";
import { addSecret, knowSecret, type SecretData } from "../secrets/model.js";
import { dailyChance } from "../weather.js";
import { siteMap } from "../../web/sites.js";

/**
 * Affairs and separation (N45 decision 6). A married person cold to their spouse, warm to someone else, and not over-honest may begin an
 * affair: a **secret** (N46) the two of them know. Each day it may be seen (by someone of either household, or a neighbour at the venue):
 * the witness knows the secret, and a witness with a loose tongue tells it, which is an event gossip carries (an `affair` event). When the
 * spouse hears it, they hold a grievance against both; then the marriage ends where the kingdom's `divorce` law allows (the one who
 * strayed moves out, to a free house or their parents'), or goes cold where it doesn't. A child born of the affair has its true father on
 * the row and the spouse as `claimed_father`: another secret.
 */
/** How often an unhappy, willing married person begins an affair, a year. */
export const AFFAIRS_A_YEAR = 0.06;
/** How likely an affair is seen on a day. */
export const SEEN_DAILY = 0.04;
/** How likely a witness tells it (a loose tongue: low honesty to keep a secret is not the point; sociability is). */
export const TELLS = 0.6;

export interface AffairData extends SecretData {
  what: "affair";
  spouse: string;
  /** The told event, once it is gossip. */
  told?: string;
  ended?: "separated" | "cold" | "over";
}

/** How warm a married person is to their spouse: their feelings where they have any, else a lean of the couple's own (most are content). */
export function marriageWarmth(ctx: LifeCtx, a: PersonRow, b: string, day: number): number {
  const rel = ctx.store.social.rel(a.id, b);
  if (rel) return viewOf(ctx.store, a.id, b, day).affection;
  const [x, y] = [a.id, b].sort();
  return 40 - 70 * unitFor(ctx.realm.seed, "wed-warmth", x!, y!);
}

/** A person's open affair, if any. */
export function affairOf(ctx: Pick<LifeCtx, "store">, who: string): ReturnType<LifeCtx["store"]["records"]["get"]> | undefined {
  return ctx.store.records.open<AffairData>("secret", (s) => s.data.what === "affair" && !s.data.ended && (s.data.about === who || s.data.others?.[0] === who))[0];
}

export function affairsDay(ctx: LifeCtx, step: Pick<SiteStep, "site" | "births">, day: number): string[] {
  const { realm, store } = ctx;
  const site = step.site;
  const rows = (store.people.loadSite(site, "full") as PersonRow[]).filter((r) => r.death === null && !r.away);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const events: string[] = [];
  const parentsOf = (id: string) => {
    const r = store.people.get(id);
    return r ? [r.mother, r.father].filter((x): x is string => !!x) : [];
  };

  // ---- Affairs begun ----
  for (const r of rows) {
    if (!r.spouse || !isGrown(r.species, ageFrom(r.born_day, day)) || affairOf(ctx, r.id)) continue;
    const t = temperOf(r);
    const cold = marriageWarmth(ctx, r, r.spouse, day);
    if (cold > 0) continue;
    const p = dailyChance(AFFAIRS_A_YEAR) * (1.4 - t.honesty) * (1 + Math.min(1, -cold / 40));
    if (unitFor(realm.seed, "affair", r.id, day) >= p) continue;
    // Whom: someone they are warm to, of the other sex, grown, not kin, not their spouse; else nobody.
    const lover = rows
      .filter((x) => x.id !== r.id && x.id !== r.spouse && x.gender !== r.gender && x.job !== "child" && !closeKin(parentsOf, r.id, x.id, 2) && !affairOf(ctx, x.id))
      .map((x) => ({ x, w: viewOf(store, r.id, x.id, day).affection + 30 * unitFor(realm.seed, "lover", r.id, x.id) - 8 * Math.abs(temperOf(x).rank - t.rank) }))
      .sort((a, b) => b.w - a.w || a.x.id.localeCompare(b.x.id))[0]?.x;
    if (!lover) continue;
    const data: AffairData = { what: "affair", about: r.id, others: [lover.id], spouse: r.spouse, text: `${r.name} is seeing ${lover.name} behind their spouse's back`, weight: 6 };
    const sec = addSecret(store, { site, day, key: `${r.id}:${day}`, data });
    knowSecret(ctx, r.id, sec.id, day, "did");
    knowSecret(ctx, lover.id, sec.id, day, "did");
    adjustRel(store, r.id, lover.id, { affection: 20 }, day);
    adjustRel(store, lover.id, r.id, { affection: 15 }, day);
  }

  // ---- Affairs seen, told, heard by the spouse ----
  for (const s of store.records.open<AffairData>("secret", (x) => x.site === site && x.data.what === "affair" && !x.data.ended)) {
    const a = byId.get(s.data.about) ?? store.people.get(s.data.about);
    const lover = s.data.others?.[0] ? store.people.get(s.data.others[0]) : null;
    const spouse = store.people.get(s.data.spouse);
    if (!a || !lover || !spouse || a.death !== null || lover.death !== null || spouse.death !== null || a.spouse !== spouse.id) {
      store.records.patch<AffairData>(s.id, { data: { ended: "over" }, status: "over", ended: day });
      continue;
    }
    // Seen: by someone of either household (not the spouse: they would know at once), who now knows the secret.
    if (!s.data.told && unitFor(realm.seed, "affair-seen", s.id, day) < SEEN_DAILY) {
      const near = rows.filter((x) => x.id !== a.id && x.id !== lover.id && x.id !== spouse.id && x.job !== "child" && (x.home === a.home || x.home === lover.home || x.work === a.work));
      const witness = near[Math.floor(unitFor(realm.seed, "affair-witness", s.id, day) * near.length)];
      if (witness) {
        knowSecret(ctx, witness.id, s.id, day, "saw");
        // A loose tongue tells it: now it is gossip.
        if (unitFor(realm.seed, "affair-tell", s.id, day) < TELLS * (1.2 - temperOf(witness).honesty * 0.4)) {
          const e = recordLifeEvent(realm, store, { kind: "affair", actor: a.id, target: lover.id, site, day, key: s.id, details: `${a.name} and ${lover.name} were seen together, though ${a.name} is married to ${spouse.name}`, importance: 5, why: `${witness.name} saw them and told it`, witnesses: [witness.id] });
          learn(ctx, witness.id, eventRef(e.id), { day, source: "saw", accuracy: 1 });
          store.records.patch<AffairData>(s.id, { status: "told", data: { told: e.id, exposed: { day, event: e.id, by: witness.id } } });
          events.push(e.id);
        }
      }
    }
    const told = store.records.get<AffairData>(s.id)!.data.told;
    if (!told || !store.knowledge.has(spouse.id, eventRef(told))) continue;
    // The spouse has heard: a grievance against both, and the marriage ends or goes cold by the law.
    addGrievance(store, { who: spouse.id, against: a.id, cause: `e:${told}`, weight: 1.0, day });
    addGrievance(store, { who: spouse.id, against: lover.id, cause: `e:${told}`, weight: 0.7, day });
    adjustRel(store, spouse.id, a.id, { affection: -50, trust: -50 }, day);
    const law = policyAt(realm, site, "divorce", day);
    const ends = law === "allowed" || (law === "church" && unitFor(realm.seed, "annul", s.id) < 0.6);
    if (ends) {
      store.people.update(a.id, { spouse: null, home: freeHouse(ctx, site, a) });
      store.people.update(spouse.id, { spouse: null });
    }
    const e = recordLifeEvent(realm, store, {
      kind: "separation",
      actor: spouse.id,
      target: a.id,
      site,
      day,
      key: s.id,
      details: ends ? `${spouse.name} and ${a.name} have parted: ${a.name} has moved out` : `${spouse.name} will not forgive ${a.name}, but the law holds them married`,
      importance: 5,
      why: `the affair with ${lover.name} came out`,
      causedBy: [told],
      witnesses: [spouse.id, a.id],
    });
    for (const w of [spouse.id, a.id]) learn(ctx, w, eventRef(e.id), { day, source: "saw", accuracy: 1 });
    store.records.patch<AffairData>(s.id, { status: "exposed", ended: day, data: { ended: ends ? "separated" : "cold" } });
    events.push(e.id);
  }

  // ---- Children of affairs ----
  for (const id of step.births) {
    const baby = store.people.get(id);
    if (!baby?.mother) continue;
    const s = affairOf(ctx, baby.mother) as { id: string; data: AffairData } | undefined;
    if (!s || s.data.about !== baby.mother || baby.father !== s.data.spouse) continue;
    if (unitFor(realm.seed, "true-father", id) >= 0.4) continue;
    const lover = s.data.others![0]!;
    store.people.update(id, { father: lover, claimed_father: s.data.spouse });
    addSecret(store, { site, day, key: id, data: { what: "bastard", about: baby.mother, others: [lover, id], text: `${baby.name}'s true father is not the man who raises them`, weight: 7 } });
  }
  return events;
}

/** The emptiest other house of the place (as N26H's moves pick one), or their parents', or where they are. */
export function freeHouse(ctx: LifeCtx, site: string, r: PersonRow): number | null {
  const rows = (ctx.store.people.loadSite(site, "full") as PersonRow[]).filter((x) => x.death === null);
  const occupancy = new Map<number, number>();
  for (const x of rows) if (x.home !== null) occupancy.set(x.home, (occupancy.get(x.home) ?? 0) + 1);
  const s = ctx.realm.settlements[site];
  if (s && !s.way) {
    const map = siteMap(s, "village", ctx.realm);
    const houses = map.buildings.map((x, i) => ({ x, i })).filter((o) => o.x.kind === "house" && o.i !== r.home);
    const free = houses.sort((a, b) => (occupancy.get(a.i) ?? 0) - (occupancy.get(b.i) ?? 0) || a.i - b.i)[0];
    if (free && (occupancy.get(free.i) ?? 0) === 0) return free.i;
  }
  const parent = [r.mother, r.father].map((p) => (p ? ctx.store.people.get(p) : null)).find((p) => p && p.death === null && p.site === site);
  return parent?.home ?? r.home;
}
