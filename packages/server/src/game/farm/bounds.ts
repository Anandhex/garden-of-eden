import { config } from "../../config.js";
import type { WorldStore } from "../db.js";
import { EATEN_PER_YEAR } from "../realm/economy.js";
import type { Realm } from "../realm/types.js";
import type { Bound } from "../road/bounds.js";
import { pointsFor } from "./day.js";
import { householdsAt, holderExists, plotsOf } from "./fields.js";

/**
 * N26G's bounds, over each place whose fields are kept, for the last whole year (folded into `plot_years`):
 * `fields-feed` (its harvest is at least FEED_SHARE of what it eats from its stores in a year), `losses-band` (beasts,
 * weather, fire and theft take LOSSES of the tiles sown), `no-orphan-plots` (every plot's holder exists).
 */
export const FEED_SHARE = 0.85;
/** Smaller than this isn't "a normal place" for `fields-feed`: a hamlet of twenty lives or starves by a few plots and hands. */
export const NORMAL_PLACE = 40;
export const LOSSES: [number, number] = [0.03, 0.3];

export function checkFieldBounds(realm: Realm, store: WorldStore, day: number): Bound[] {
  const year = Math.floor((day - 1) / config.daysPerYear) - 1;
  const kept = Object.values(realm.settlements).filter((s) => s.fields?.kept && !s.abandoned && !s.fallen && s.population > 0);
  const feed: string[] = [];
  const losses: number[] = [];
  let orphans = 0;
  for (const s of kept) {
    const plots = plotsOf(realm, s, day);
    const size = new Map(plots.map((p) => [p.id, p.w * p.h]));
    const rows = store.farm.yearOfSite(s.id, year);
    if (year >= 0 && rows.length > 0) {
      const reaped = rows.reduce((a, r) => a + r.reaped, 0);
      const points = pointsFor(reaped, s.population);
      if (points < EATEN_PER_YEAR * FEED_SHARE && s.population >= NORMAL_PLACE) feed.push(`${s.name} ${Math.round(points)}`);
      const lost = rows.reduce((a, r) => a + Object.values(JSON.parse(r.lost) as Record<string, number>).reduce((x, y) => x + y, 0), 0);
      const sown = [...size.keys()].filter((id) => store.farm.sowingOf(s.id, id, year)).reduce((a, id) => a + size.get(id)!, 0);
      if (sown > 0 && s.population >= NORMAL_PLACE) losses.push(lost / sown);
    }
    const hh = householdsAt(store, s.id, day).all;
    // A lord who died today, after the place's field work, is handed back on its next field day: not an orphan yet.
    const diedToday = (h: string) => h.startsWith("lord:") && realm.figures[h.slice(5)]?.deathDay === day;
    // A place that isn't worked out daily (not live; a journey caught it up once) hands plots back on its next field day, whenever that
    // is: a lord who died since isn't an orphan of it yet.
    const behind = store.people.seq(s.id).stepped < day - 1;
    if (!behind) for (const r of store.farm.plotsOf(s.id).values()) if (!holderExists(realm, s, r.holder, hh) && !diedToday(r.holder)) orphans++;
  }
  const lo = losses.length ? Math.min(...losses) : null;
  const hi = losses.length ? Math.max(...losses) : null;
  return [
    { name: "fields-feed", ok: feed.length === 0, detail: feed.length === 0 ? `${kept.length} places' fields fed them last year` : `short last year: ${feed.slice(0, 4).join(", ")} (of ${Math.round(EATEN_PER_YEAR)} eaten)` },
    { name: "losses-band", ok: lo === null || (lo >= LOSSES[0] && hi! <= LOSSES[1]), detail: lo === null ? "no whole year yet" : `losses ${Math.round(lo * 100)}%..${Math.round(hi! * 100)}% of tiles sown` },
    { name: "no-orphan-plots", ok: orphans === 0, detail: `${orphans} plots held by someone who isn't there` },
  ];
}
