import { config } from "../config.js";
import { WorldStore } from "../game/db.js";
import { worldHash } from "../game/hash.js";
import { liveSites } from "../game/people/live.js";
import { advanceWorld } from "../game/people/world.js";
import { generateRealm } from "../game/realm/generate.js";
import { bookOf, totalCoin } from "../game/realm/ledger.js";
import { pickStartSite } from "../game/realm/start.js";
import type { Realm } from "../game/realm/types.js";
import { checkN26fBounds, checkRoadBounds } from "../game/road/bounds.js";
import { checkFieldBounds } from "../game/farm/bounds.js";
import { checkDistrictBounds } from "../game/town/bounds.js";
import { captivesAccounted } from "../game/realm/fall.js";
import type { PersonRow } from "../store/peopleStore.js";
import { materialisePeople } from "../store/materialise.js";
import { type BoundResult, checkAll } from "./bounds.js";
import { type Sample, sampleWorld } from "./sample.js";

/**
 * The long-run runner (N22 step 1): a fresh world from a seed, run a day at a time through the same entry point the
 * game and the sims use (`advanceWorld`: the realm's day, then everyone's), sampled every day, with no model
 * (director and planning off). `sim:years` prints what it returns; tests/n22.test.ts runs a short one.
 */
export interface RunOptions {
  seed: number;
  years: number;
  /** Where people live as rows: "slice" (the start town and its neighbour; fast), "all", or a list (config.peopleLive's forms). */
  live?: string;
  /** Called after each day (for progress). */
  onDay?: (day: number, sample: Sample) => void;
}

export interface RunResult {
  seed: number;
  days: number;
  series: Sample[];
  bounds: BoundResult[];
  hash: string;
  ms: number;
  realm: Realm;
  store: WorldStore;
}

export function runYears(o: RunOptions): RunResult {
  const director = config.director;
  const planning = config.planning;
  config.director = false;
  config.planning = false;
  try {
    const realm = generateRealm(o.seed, 1);
    const store = new WorldStore(":memory:");
    const live = liveSites(realm, pickStartSite(realm, realm.seed), o.live ?? "slice");
    materialisePeople(realm, store.people, 1);
    const ctx = { coinStart: totalCoin(realm), bookStart: { ...bookOf(realm) } };
    const series: Sample[] = [sampleWorld(realm, store, realm.day, ctx)];
    const days = o.years * config.daysPerYear;
    const t0 = performance.now();
    for (let d = realm.day + 1; d <= days + 1; d++) {
      advanceWorld(realm, store, d, { live });
      const s = sampleWorld(realm, store, d, ctx);
      series.push(s);
      o.onDay?.(d, s);
    }
    const bounds = [...checkAll(series, { daysPerYear: config.daysPerYear, seed: o.seed }), ...endBounds(realm, store, (o.live ?? "slice") === "all")];
    return { seed: o.seed, days, series, bounds, hash: worldHash({ realm }, store), ms: performance.now() - t0, realm, store };
  } finally {
    config.director = director;
    config.planning = planning;
  }
}

/** Bounds the phases check on the world as it stands at the end (N26 Part E's road bounds). */
function endBounds(realm: Realm, store: WorldStore, everyone: boolean): BoundResult[] {
  const n26f = checkN26fBounds(realm, store.people).map((b) => ({ id: b.name, phase: "N26F", ok: b.ok, detail: b.detail }));
  const n26g = checkFieldBounds(realm, store, realm.day).map((b) => ({ id: b.name, phase: "N26G", ok: b.ok, detail: b.detail }));
  const live = Object.keys(realm.settlements).filter((id) => store.people.count(id) > 0);
  const n26h = checkDistrictBounds(realm, store, live, realm.day).map((b) => ({ id: b.name, phase: "N26H", ok: b.ok, detail: b.detail }));
  // N26I: places that fell are won back and resettled within the run; every captive is held by a gang that exists.
  const fell = realm.stats.fallen ?? 0;
  const back = realm.stats.retaken ?? 0;
  const rows = Object.keys(realm.settlements).flatMap((id) => (store.people.count(id) > 0 ? (store.people.loadSite(id, "full") as PersonRow[]) : []));
  const cap = captivesAccounted(realm, rows);
  const n26i: BoundResult[] = [
    { id: "fallen-turn-over", phase: "N26I", ok: fell === 0 || back > 0, detail: `${fell} places fell, ${back} were won back, ${realm.stats.resettled ?? 0} resettled` },
    { id: "captives-accounted", phase: "N26I", ok: cap.lost === 0, detail: `${cap.held} held captive, ${cap.lost} by a gang that's gone` },
  ];
  return [...n26f, ...n26g, ...n26h, ...n26i, ...checkRoadBounds(realm, store.people)].map((b) =>
    // Traffic and news travel with people: where most places don't live as rows (a slice run), there's hardly anyone on the
    // roads to carry it, so don't judge them.
    "phase" in b ? b : (b.name === "news-reaches" || b.name === "roads-not-empty") && !everyone ? { id: b.name, phase: "N26", ok: true, detail: `not judged in a slice run (${b.detail})` } : { id: b.name, phase: "N26", ok: b.ok, detail: b.detail },
  );
}
