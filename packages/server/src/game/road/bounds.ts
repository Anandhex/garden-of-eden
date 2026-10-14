import { graphOf, isOnTheRoad } from "@millbrook/shared";
import type { PeopleStore } from "../../store/peopleStore.js";
import { parseAway } from "../../store/peopleStore.js";
import type { Realm } from "../realm/types.js";
import { roadDataOf } from "./generateRoads.js";
import { journeysOf, MAX_JOURNEYS } from "./journeys.js";

/**
 * N26's balance bounds (and Part E's): numbers the road must stay inside once the realm has been running a while. N22's
 * long-run tests read this list; tests/n26.test.ts does too.
 */
export interface Bound {
  name: string;
  ok: boolean;
  detail: string;
}

/** Days after which news should have spread. */
const SPREAD_DAYS = 15;

export function checkRoadBounds(realm: Realm, people?: PeopleStore, day = realm.day): Bound[] {
  const now = (day - 1) * 1440 + 12 * 60;
  const all = journeysOf(realm);
  const active = all.filter((j) => isOnTheRoad(j, now));
  // Roads are neither empty nor clogged: some are on them, none is crowded.
  const perRoad = new Map<string, number>();
  for (const j of active) for (const r of j.roads) perRoad.set(r.id, (perRoad.get(r.id) ?? 0) + 1);
  const busiest = Math.max(0, ...perRoad.values());
  const out: Bound[] = [
    { name: "roads-not-empty", ok: all.length < MAX_JOURNEYS && (day < 8 || active.length >= 3), detail: `${active.length} on the road now, ${all.length} kept` },
    { name: "roads-not-clogged", ok: busiest <= 40, detail: `busiest road has ${busiest} journeys on it` },
  ];
  // Great news (a ruler's death, a war) reaches the kingdom, by couriers; weighty news reaches the neighbours, by travellers.
  const hears = (site: string, id: string) => !!realm.heard[site]?.[id];
  const places = Object.values(realm.settlements).filter((s) => !s.way && !s.abandoned);
  // Great news that has reached a capital or a city is sent on by couriers: within SPREAD_DAYS of that it is known across the kingdom.
  const posts = places.filter((x) => x.kind === "capital" || x.kind === "city");
  const sent = realm.news.filter((n) => n.importance >= 8 && n.at && posts.some((post) => (realm.heard[post.id]?.[n.id]?.[0] ?? Infinity) <= day - SPREAD_DAYS));
  const shortfalls = sent.map((n) => {
    const at = realm.settlements[n.at!];
    const origin = at?.way && at.liege ? realm.settlements[at.liege] : at;
    const kingdom = origin?.kingdom ? places.filter((s) => s.kingdom === origin.kingdom) : [];
    return kingdom.length === 0 ? 1 : kingdom.filter((s) => hears(s.id, n.id)).length / kingdom.length;
  });
  const worst = Math.min(1, ...shortfalls);
  const g = graphOf(journeysRoads(realm));
  const weighty = realm.news.filter((n) => n.importance >= 5 && n.at && n.day <= day - SPREAD_DAYS && g.has(n.at));
  const neighbourShare = weighty.length === 0 ? 1 : weighty.reduce((a, n) => a + (g.get(n.at!) ?? []).filter((e) => hears(e.to, n.id)).length / Math.max(1, (g.get(n.at!) ?? []).length), 0) / weighty.length;
  out.push({ name: "news-reaches", ok: worst >= 0.8 && neighbourShare >= 0.5, detail: `great news that reached a post reached ${Math.round(worst * 100)}% of its kingdom at worst; weighty news reached ${Math.round(neighbourShare * 100)}% of the neighbours` });
  // Nobody is on two journeys, and nobody is away on a journey that is over.
  const seen = new Map<string, string>();
  let twice = 0;
  for (const j of all) if (!j.closed) for (const t of j.party) {
    if (seen.has(t.person) && seen.get(t.person) !== j.id) twice++;
    seen.set(t.person, j.id);
  }
  let stuck = 0;
  if (people) for (const r of people.awayRows()) {
    const a = parseAway(r.away)!;
    const j = all.find((x) => x.id === a.journey);
    if (!j || j.closed) stuck++;
  }
  out.push({ name: "nobody-twice", ok: twice === 0, detail: `${twice} people on two journeys at once` });
  out.push({ name: "trips-return", ok: stuck === 0, detail: `${stuck} people away on a journey that is over` });
  const up = realm.stats["migrants_up"] ?? 0;
  const down = realm.stats["migrants_down"] ?? 0;
  out.push({ name: "migration-follows-need", ok: up + down < 20 || up >= down, detail: `${up} arrivals went to a better place, ${down} to a worse` });
  return out;
}

/** The road data, for the news bound (the neighbours of a place). */
function journeysRoads(realm: Realm) {
  return roadDataOf(realm);
}
