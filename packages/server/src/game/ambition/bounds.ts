import { config } from "../../config.js";
import type { PersonRow } from "../../store/peopleStore.js";
import type { WorldStore } from "../db.js";
import type { Bound } from "../road/bounds.js";
import type { Realm } from "../realm/types.js";
import { kingdomLaws } from "../realm/townsfolk.js";
import { seasonDays } from "../weather.js";
import { CAREER, placeCareers } from "./careers.js";
import { TRADES } from "./kinds.js";
import { mayStand, seatsOf } from "./seats.js";

/**
 * N40's balance bounds (N22 gathers them into one list; until then the tests read this), over places that have been running a while.
 *
 * - `ambitions-churn`: each year a share of ambitions are had or changed (at least 3% of the grown); nobody but the content keeps one kind
 *   their whole grown life (no one grown for 20 years has held the same non-quiet ambition since they came of age).
 * - `seats-filled`: no seat stands empty longer than a season while someone qualifies for it.
 * - `shops-bounded`: no trade has more licensed shops in a place than its custom keeps (one per `demand` people, at least one, plus one:
 *   a shop passed to an heir is kept whatever the custom), and at most one opened without the masters' leave.
 */
export interface AmbitionSample {
  sites: readonly string[];
  /** Days covered: [from, to]. */
  from: number;
  to: number;
  /** Ambitions had and changed in that stretch (CareerDay totals). */
  achieved: number;
  changed: number;
}

export function checkAmbitionBounds(realm: Realm, store: WorldStore, sample: AmbitionSample): Bound[] {
  const out: Bound[] = [];
  const Y = config.daysPerYear;
  const day = sample.to;
  let grown = 0;
  let stuck = 0;
  const stuckWho: string[] = [];
  for (const site of sample.sites) {
    for (const r of store.people.loadSite(site, "full") as PersonRow[]) {
      if (r.job === "child") continue;
      grown++;
      const a = store.careers.ambitionOf(r.id);
      if (!a || a.kind === "quiet_life") continue;
      if (day - a.since >= 20 * Y && day - r.born_day >= 40 * Y && a.since <= sample.from) {
        stuck++;
        if (stuckWho.length < 3) stuckWho.push(`${r.id} (${a.kind} since day ${a.since})`);
      }
    }
  }
  const years = Math.max(1 / Y, (sample.to - sample.from) / Y);
  const perYear = (sample.achieved + sample.changed) / years;
  const share = grown > 0 ? perYear / grown : 0;
  out.push({ name: "ambitions-churn", ok: share >= 0.03 && stuck === 0, detail: `${(share * 100).toFixed(1)}% of ${grown} grown had or changed an ambition a year (${sample.achieved} had, ${sample.changed} changed in ${years.toFixed(1)} years); ${stuck} held one twenty years${stuckWho.length > 0 ? `: ${stuckWho.join(", ")}` : ""}` });

  // Seats: empty longer than a season while someone qualifies.
  let empty = 0;
  const emptyWhich: string[] = [];
  for (const site of sample.sites) {
    const s = realm.settlements[site];
    if (!s) continue;
    const rows = (store.people.loadSite(site, "full") as PersonRow[]).filter((r) => r.job !== "child");
    const place = placeCareers(realm, site, rows, store.careers, kingdomLaws(realm, s.kingdom));
    const members = new Map<string, number>();
    for (const r of rows) if (r.faction && place.guilds.has(r.faction)) members.set(r.faction, (members.get(r.faction) ?? 0) + 1);
    const holders = store.careers.seatHolders(site);
    for (const seat of seatsOf(realm, site, place.guilds, members)) {
      const job = `seat:${seat.id}`;
      if (holders.has(job)) continue;
      const left = store.careers.lastHeld(job).left ?? sample.from;
      if (day - left <= seasonDays() + CAREER.vacancyDays) continue;
      const held = (who: string) => store.careers.openJobs(who).filter((j) => j.job.startsWith("seat:")).map((j) => j.job.slice(5));
      if (!rows.some((r) => mayStand(seat, r, store.careers.ambitionOf(r.id), held(r.id), day, s.kind, true))) continue;
      empty++;
      if (emptyWhich.length < 3) emptyWhich.push(`${seat.id} (empty since day ${left})`);
    }
  }
  out.push({ name: "seats-filled", ok: empty === 0, detail: `${empty} seats empty longer than a season with candidates${emptyWhich.length > 0 ? `: ${emptyWhich.join(", ")}` : ""}` });

  // Shops: within what custom keeps.
  let over = 0;
  const overWhich: string[] = [];
  for (const site of sample.sites) {
    const rows = store.people.loadSite(site, "full") as PersonRow[];
    const shops = new Map<string, { licensed: number; unlicensed: number }>();
    for (const { row } of store.careers.holdersOf(`shop:${site}:`)) {
      const trade = row.job.split(":")[2]!;
      const n = shops.get(trade) ?? { licensed: 0, unlicensed: 0 };
      if (row.job.endsWith(":unlicensed")) n.unlicensed++;
      else n.licensed++;
      shops.set(trade, n);
    }
    for (const [trade, n] of shops) {
      const demand = TRADES[trade as keyof typeof TRADES]?.demand ?? 100;
      const cap = Math.max(1, Math.round(rows.length / demand)) + 1;
      if (n.licensed > cap || n.unlicensed > 1) {
        over++;
        if (overWhich.length < 3) overWhich.push(`${site} ${trade}: ${n.licensed} (keeps ${cap}), ${n.unlicensed} without leave`);
      }
    }
  }
  out.push({ name: "shops-bounded", ok: over === 0, detail: `${over} trades with more shops than their place keeps${overWhich.length > 0 ? `: ${overWhich.join(", ")}` : ""}` });
  return out;
}
