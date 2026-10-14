import type { Journey, JourneyKind, RoadData, Traveller } from "@millbrook/shared";
import type { PersonRow } from "../../../store/peopleStore.js";
import { speciesOf } from "../../../world/species.js";
import type { WorldStore } from "../../db.js";
import { streamFor, type Rng } from "../../dice.js";
import { ageFrom } from "../../people/rules.js";
import type { Realm } from "../../realm/types.js";
import { journeysOf } from "../journeys.js";

/** What every trip kind reads. */
export interface TripCtx {
  realm: Realm;
  store: WorldStore;
  data: RoadData;
  day: number;
  /** Places whose people are rows. */
  live: ReadonlySet<string>;
  /** Bring a place's people up to yesterday before reading or changing them (a lazy place; level of detail never changes outcomes). */
  ensure: (site: string) => void;
}

/** Free people: serfs and slaves travel only with or for their masters (and runaways are N59's). */
export const FREE_CLASSES: ReadonlySet<string> = new Set(["commoner", "artisan", "merchant", "gentry", "clergy"]);

/** Grown, alive, at home, free: who could set out from a place today. */
export function athome(ctx: TripCtx, site: string): PersonRow[] {
  ctx.ensure(site);
  return (ctx.store.people.loadSite(site, "full") as PersonRow[]).filter((r) => r.away === null && r.death === null && FREE_CLASSES.has(r.cls) && ageFrom(r.born_day, ctx.day) >= speciesOf(r.species).adultAge);
}

export const traveller = (r: PersonRow): Traveller => ({ person: r.id, name: r.name, role: r.job, gender: r.gender === "female" ? "female" : "male" });

export const activeOf = (realm: Realm, kind: JourneyKind): number => journeysOf(realm).filter((j: Journey) => j.kind === kind && !j.closed && !j.ended).length;

/** `n` of `xs` by the stream, none twice. */
export function take<T>(rng: Rng, xs: readonly T[], n: number): T[] {
  const pool = [...xs];
  const out: T[] = [];
  while (out.length < n && pool.length > 0) out.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]!);
  return out;
}

/** The stream of a trip kind at a place on a day: adding a kind never changes another's rolls. */
export const tripRng = (ctx: TripCtx, site: string, kind: string, ...more: Array<string | number>): Rng => streamFor(ctx.realm.seed, "trips", site, ctx.day, kind, ...more);

/** Places that stand, are live and have people in the table, in id order. */
export function sendersOf(ctx: TripCtx) {
  return Object.values(ctx.realm.settlements)
    .filter((s) => !s.way && !s.abandoned && ctx.live.has(s.id) && ctx.store.people.count(s.id) > 0)
    .sort((a, b) => a.id.localeCompare(b.id));
}

import { launch, departureOn, type Launch } from "../journeys.js";

/** Set a journey going: its people go away. */
export const go = (ctx: TripCtx, o: Launch): Journey | null => launch(ctx.realm, ctx.data, o, ctx.store.people);
export { departureOn };
