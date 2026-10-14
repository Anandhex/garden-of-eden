import { stopsOf, type Carry } from "@millbrook/shared";
import { config } from "../../config.js";
import { timed } from "../../metrics/timing.js";
import type { LifeCtx } from "../people/step.js";
import { meetAtStop } from "../gossip/meet.js";
import { hear } from "../realm/log.js";
import { tally } from "../realm/log.js";
import type { Realm } from "../realm/types.js";
import { dayStartMinute, journeysOf } from "./journeys.js";

/**
 * How news travels (N26 Part E, decision 6): by people, through the places they stop at. A place hears of something when it
 * happens there, or when a traveller (or a courier) brings it. A traveller setting out carries what the place knows that is
 * recent and weighty enough; at every stop (an inn for the night, a town they pass, the one they came to see) the place learns
 * what they carry and they pick up what it knows. Once a day, realm-wide and after the day's journeys are launched, every stop of
 * every journey that falls in the day is applied in time order (then journey id), so it is deterministic, lazy places hear
 * all the same, and nothing predicts the future.
 */
export const CARRY_MAX = 6;
/** News below this importance isn't worth carrying. */
export const CARRY_IMPORTANCE = 3;
/** News older than this many days isn't carried. */
export const STALE_DAYS = 20;

export interface Exchange {
  minute: number;
  journey: string;
  site: string;
}

/** The stops that fall on a day, in order. */
export function stopsOn(realm: Realm, day: number): Exchange[] {
  const lo = dayStartMinute(day);
  const hi = lo + 1440;
  const out: Exchange[] = [];
  for (const j of journeysOf(realm)) {
    if (j.closed && !(j.ended && j.ended.minute >= lo)) continue;
    for (const s of stopsOf(j)) if (s.minute >= lo && s.minute < hi && realm.settlements[s.site]) out.push({ minute: s.minute, journey: j.id, site: s.site });
  }
  return out.sort((a, b) => a.minute - b.minute || (a.journey < b.journey ? -1 : a.journey > b.journey ? 1 : 0));
}

/** Apply the day's stops. Returns how many places heard something new. */
export function exchangeNews(realm: Realm, day: number, store?: LifeCtx["store"], ensure?: (site: string) => void): number {
  const byId = new Map(realm.news.map((n) => [n.id, n]));
  // News that has dropped out of the record is forgotten by the places too.
  if (day % 5 === 0) for (const known of Object.values(realm.heard)) for (const id of Object.keys(known)) if (!byId.has(id)) delete known[id];
  const jobs = new Map(journeysOf(realm).map((j) => [j.id, j]));
  let learned = 0;
  for (const e of stopsOn(realm, day)) {
    const j = jobs.get(e.journey);
    if (!j) continue;
    const carries = (j.carries ??= []);
    // The place learns what they carry.
    for (const c of carries) if (byId.has(c.id) && hear(realm, e.site, c.id, Math.floor(e.minute / 1440) + 1, c.from, j.id)) learned++;
    // They pick up what the place knows, the weightiest and freshest first.
    const here = realm.heard[e.site] ?? {};
    const have = new Set(carries.map((c) => c.id));
    // What was dropped from the realm's record isn't carried any more.
    const pool: Carry[] = carries.filter((c) => byId.has(c.id));
    for (const id of Object.keys(here)) {
      const n = byId.get(id);
      if (!n || have.has(id) || n.importance < CARRY_IMPORTANCE || here[id]![0] < day - STALE_DAYS) continue;
      pool.push({ id, from: e.site });
    }
    if (pool.length !== carries.length || pool.length > have.size) {
      pool.sort((a, b) => byId.get(b.id)!.importance - byId.get(a.id)!.importance || (here[b.id]?.[0] ?? 0) - (here[a.id]?.[0] ?? 0) || (a.id < b.id ? -1 : 1));
      j.carries = pool.slice(0, CARRY_MAX);
    }
    // And the people: the party talks with some of the place's people (N33), who then know what they were told.
    // A place that has not lived its days yet lives them first, so that the people who meet the party are the same whenever it is worked out.
    if (store && config.gossip) ensure?.(e.site);
    if (store && config.gossip) timed("gossip.meet", () => meetAtStop({ realm, store }, j, e.site, e.minute, day));
  }
  if (learned > 0) tally(realm, "news_carried", learned);
  return learned;
}

/** Who carried a piece of news to a place, back to where it happened: the places in order, with the day each heard and the journey that brought it. */
export function newsChain(realm: Realm, newsId: string, site: string): Array<{ site: string; day: number; via: string }> {
  const out: Array<{ site: string; day: number; via: string }> = [];
  let at: string | undefined = site;
  const seen = new Set<string>();
  while (at && !seen.has(at)) {
    seen.add(at);
    const h: [number, string, string] | undefined = realm.heard[at]?.[newsId];
    if (!h) break;
    out.unshift({ site: at, day: h[0], via: h[2] });
    at = h[1] || undefined;
  }
  return out;
}
