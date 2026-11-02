import type { WorldStore } from "../game/db.js";
import { totalCoin, unaccounted } from "../game/realm/ledger.js";
import type { Realm } from "../game/realm/types.js";

/**
 * One day of the world, in numbers (N22 decision 2): the runner takes one a day, and the bounds read the series. Later
 * phases add their own numbers here (N26F's territories and beasts, N26G's harvests, N26I's fallen places).
 */
export interface Sample {
  day: number;
  kingdoms: Record<string, { alive: boolean; places: number; people: number; weariness: number; atWar: boolean }>;
  population: number;
  /** Over places that are lived in (not abandoned, not fallen, not waystations). */
  food: { min: number; mean: number };
  prosperity: { min: number; mean: number };
  /** Places with food under 15 today. */
  starving: string[];
  wars: number;
  /** The longest war going on, in days. */
  longestWar: number;
  factions: number;
  factionsByKind: Record<string, number>;
  places: number;
  abandoned: number;
  /** Places held by a pack or a gang (N26I). */
  fallen: number;
  coin: { total: number; unaccounted: number };
  packs: { count: number; beasts: number; worstOverCap: number };
  journeys: number;
}

export interface SampleCtx {
  /** The realm's coin when the run began, and its book then. */
  coinStart: number;
  bookStart: { minted: number; sunk: number };
}

const lived = (realm: Realm) => Object.values(realm.settlements).filter((s) => !s.way && !s.abandoned && !s.fallen);

export function sampleWorld(realm: Realm, store: WorldStore | null, day: number, ctx: SampleCtx): Sample {
  const places = lived(realm);
  const mean = (xs: number[]) => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length);
  const kingdoms: Sample["kingdoms"] = {};
  for (const k of Object.values(realm.kingdoms)) {
    const mine = places.filter((s) => s.kingdom === k.id);
    const atWar = realm.wars.some((w) => w.end === undefined && [...w.attackers, ...w.defenders].includes(`k:${k.id}`));
    kingdoms[k.id] = { alive: !k.fallen && mine.length > 0, places: mine.length, people: mine.reduce((a, s) => a + s.population, 0), weariness: k.weariness, atWar };
  }
  const active = Object.values(realm.factions).filter((f) => f.dissolved === undefined);
  const byKind: Record<string, number> = {};
  for (const f of active) byKind[f.kind] = (byKind[f.kind] ?? 0) + 1;
  const wars = realm.wars.filter((w) => w.end === undefined);
  const packs = Object.values(realm.packs);
  return {
    day,
    kingdoms,
    population: store && store.people.count() > 0 ? places.reduce((a, s) => a + s.population, 0) : places.reduce((a, s) => a + s.population, 0),
    food: { min: Math.min(100, ...places.map((s) => s.food)), mean: mean(places.map((s) => s.food)) },
    prosperity: { min: Math.min(100, ...places.map((s) => s.prosperity)), mean: mean(places.map((s) => s.prosperity)) },
    starving: places.filter((s) => s.food < 15).map((s) => s.id),
    wars: wars.length,
    longestWar: Math.max(0, ...wars.map((w) => day - w.start)),
    factions: active.length,
    factionsByKind: byKind,
    places: places.length,
    abandoned: Object.values(realm.settlements).filter((s) => !s.way && s.abandoned).length,
    fallen: Object.values(realm.settlements).filter((s) => s.fallen).length,
    coin: { total: totalCoin(realm), unaccounted: unaccounted(realm, ctx.coinStart, ctx.bookStart) },
    packs: { count: packs.filter((p) => p.count > 0).length, beasts: packs.reduce((a, p) => a + p.count, 0), worstOverCap: Math.max(0, ...packs.map((p) => p.count / Math.max(1, p.cap))) },
    journeys: realm.journeys.length,
  };
}
