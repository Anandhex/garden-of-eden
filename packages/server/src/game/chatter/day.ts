import { config } from "../../config.js";
import { timed } from "../../metrics/timing.js";
import type { PersonRow } from "../../store/peopleStore.js";
import { streamFor, type Rng } from "../dice.js";
import { venuesOf, type Venue, type VenueKind } from "../gossip/venues.js";
import type { LifeCtx, SiteStep } from "../people/step.js";
import { applyInteraction } from "./apply.js";
import { FADED_BELOW, hateOn, weightOn } from "./grievance.js";
import { pickInteraction, type Party } from "./pick.js";
import { temperOf } from "./person.js";
import { vendettaDay, type VendettaResult } from "./revenge.js";
import { viewOf } from "./rel.js";
import { HOSTILE, type Interaction } from "./types.js";

/**
 * A place's day of chatter (N37), after its people's day and reviews and before its gossip (so what happened today can be told today).
 * Not every pair meets: a few pairs a day, picked from the places people gather in (the venues of N33), each pair's exchange decided by
 * `pickInteraction`; then grievances that have faded are settled, and revenge is formed and carried out (revenge.ts). The place the player is
 * watching skips the pairs (the crowd the player can see does its own, by the hour: hours.ts) but keeps the rest.
 */
export const CHATTER = {
  /** Pairs a day as a share of adults, with a least and a most. */
  pairRate: 0.03,
  least: 2,
  most: 24,
  /** How much each kind of venue is where a quarrel happens, before its size. */
  venueWeight: { household: 1, work: 1.4, inn: 1.2, market: 1.2, temple: 0.8 } as Record<VenueKind, number>,
  /** Others who see a public exchange (at most). */
  witnesses: 5,
} as const;

export interface DayResult {
  pairs: number;
  hostile: number;
  vendetta: VendettaResult;
}

const NONE: VendettaResult = { formed: 0, acted: 0, forgotten: 0 };

const sameFamily = (a: PersonRow, b: PersonRow): boolean =>
  a.spouse === b.id || b.spouse === a.id || a.mother === b.id || a.father === b.id || b.mother === a.id || b.father === a.id || (!!a.mother && a.mother === b.mother) || (!!a.father && a.father === b.father);

export function chatterDay(ctx: LifeCtx, step: Pick<SiteStep, "site">, day: number, opts: { hourly?: boolean } = {}): DayResult {
  if (!config.chatter) return { pairs: 0, hostile: 0, vendetta: NONE };
  return timed("chatter.day", () => {
    const out: DayResult = { pairs: 0, hostile: 0, vendetta: NONE };
    ctx.store.social.transaction(() => {
      if (!opts.hourly) {
        const r = timed("chatter.pairs", () => pairsDay(ctx, step.site, day));
        out.pairs = r.pairs;
        out.hostile = r.hostile;
      }
      timed("chatter.fade", () => fadeDay(ctx, step.site, day));
      out.vendetta = timed("chatter.vendetta", () => vendettaDay(ctx, step.site, day));
    });
    return out;
  });
}

/** Settle what has faded to nothing. */
export function fadeDay(ctx: LifeCtx, site: string, day: number): number {
  let n = 0;
  for (const g of ctx.store.social.openAt(site)) {
    if (weightOn(g, day) < FADED_BELOW) {
      ctx.store.social.settle(g.id, day);
      n++;
    }
  }
  return n;
}

/** Everything the picker needs to know about a pair, read from the stores. */
export function partyIn(ctx: LifeCtx, row: PersonRow): Party {
  return { row, t: temperOf(row) };
}

export function pickFor(ctx: LifeCtx, rx: PersonRow, ry: PersonRow, day: number, rng: Rng, env: { witnesses: number; drink: boolean; bowing: boolean }) {
  const { store } = ctx;
  const x = partyIn(ctx, rx);
  const y = partyIn(ctx, ry);
  return pickInteraction(
    {
      x,
      y,
      viewXofY: viewOf(store, rx.id, ry.id, day),
      viewYofX: viewOf(store, ry.id, rx.id, day),
      hateXofY: hateOn(store, rx.id, ry.id, day),
      hateYofX: hateOn(store, ry.id, rx.id, day),
      kin: sameFamily(rx, ry),
      ...env,
    },
    rng,
  );
}

function pairsDay(ctx: LifeCtx, site: string, day: number): { pairs: number; hostile: number } {
  const out = { pairs: 0, hostile: 0 };
  const rows = ctx.store.people.loadSite(site, "full") as PersonRow[];
  const byId = new Map(rows.map((r) => [r.id, r]));
  const adults = rows.filter((r) => r.job !== "child" && !r.away);
  if (adults.length < 2) return out;
  // Only venues with at least two grown people in them.
  const venues = venuesOf(ctx, site, rows, day)
    .map((v): Venue => ({ ...v, members: v.members.filter((m) => byId.get(m)!.job !== "child") }))
    .filter((v) => v.members.length >= 2);
  if (venues.length === 0) return out;
  const weights = venues.map((v) => CHATTER.venueWeight[v.kind] * Math.sqrt(v.members.length));
  const total = weights.reduce((s, w) => s + w, 0);
  const rng = streamFor(ctx.realm.seed, "chatter", site, day);
  const n = Math.max(CHATTER.least, Math.min(CHATTER.most, Math.round(adults.length * CHATTER.pairRate)));
  for (let i = 0; i < n; i++) {
    let at = rng() * total;
    let vi = 0;
    while (vi < venues.length - 1 && at >= weights[vi]!) at -= weights[vi++]!;
    const v = venues[vi]!;
    const xi = Math.floor(rng() * v.members.length);
    let yi = Math.floor(rng() * (v.members.length - 1));
    if (yi >= xi) yi++;
    const rx = byId.get(v.members[xi]!)!;
    const ry = byId.get(v.members[yi]!)!;
    const crowd = v.kind === "household" ? 0 : Math.min(CHATTER.witnesses, v.members.length - 2);
    const picked = pickFor(ctx, rx, ry, day, rng, { witnesses: crowd, drink: v.kind === "inn", bowing: v.kind !== "household" });
    const hostile = HOSTILE.has(picked.kind);
    // Only a notable exchange has onlookers worth picking.
    const witnesses: string[] = [];
    if (hostile && crowd > 0) {
      const pool = v.members.filter((m) => m !== rx.id && m !== ry.id);
      for (let k = 0; k < crowd && pool.length > 0; k++) witnesses.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]!);
      witnesses.sort();
    }
    const it: Interaction = { a: picked.actor.row.id, b: picked.target.row.id, kind: picked.kind, day, minute: -1, site, witnesses, venue: v.kind };
    if (courtesyWithoutRows(ctx, it)) {
      out.pairs++;
      continue;
    }
    if (applyInteraction(ctx, it, i)) {
      out.pairs++;
      if (hostile) out.hostile++;
    }
  }
  return out;
}

/**
 * A plain greeting between two people who have no feelings about each other written down changes nothing worth a row: skip it (the row
 * for a pair is made by their first notable exchange, or by courtesy once they already have one).
 */
export function courtesyWithoutRows(ctx: LifeCtx, it: Pick<Interaction, "a" | "b" | "kind">): boolean {
  if (HOSTILE.has(it.kind) || it.kind === "apologise" || it.kind === "threaten") return false;
  const s = ctx.store.social;
  return !s.holders().has(it.a) && !s.holders().has(it.b);
}
