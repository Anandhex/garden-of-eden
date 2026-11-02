import { graphOf, isOnTheRoad } from "@millbrook/shared";
import type { PeopleStore } from "../../store/peopleStore.js";
import { parseAway } from "../../store/peopleStore.js";
import type { Realm } from "../realm/types.js";
import { roadDataOf } from "./generateRoads.js";
import { journeysOf, MAX_JOURNEYS } from "./journeys.js";
import { coverOf, GATE_CLEAR, MAX_COVER } from "@millbrook/shared";
import { territoriesNow } from "./territories.js";
import { beatsAlong, spaced } from "./beats.js";

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

/** A person on a map who isn't someone (N26F step 0b): where, and what. */
export interface MadeUp {
  site: string;
  uid: string;
  name: string;
  why: string;
}

/**
 * Nobody made up (plans README section 21): every creature of a person kind on any place's maps carries a figure or a
 * `people` row that exists and is alive (or died there, on the map). `personKinds`: the template ids that are people.
 */
export function madeUpPeople(
  realm: Realm,
  sites: Record<string, { creatures: Record<string, { uid: string; name: string; template: string; figure?: string; person?: string; outcome: string | null }> }>,
  personKinds: ReadonlySet<string>,
  people?: PeopleStore,
): MadeUp[] {
  const out: MadeUp[] = [];
  for (const [site, st] of Object.entries(sites)) {
    for (const c of Object.values(st.creatures)) {
      if (!personKinds.has(c.template)) continue;
      const f = c.figure ? realm.figures[c.figure] : undefined;
      const r = c.person && people ? people.get(c.person) : null;
      if (!c.figure && !c.person) out.push({ site, uid: c.uid, name: c.name, why: "no figure or person" });
      else if (c.figure && !f) out.push({ site, uid: c.uid, name: c.name, why: `figure ${c.figure} doesn't exist` });
      else if (c.person && people && !r) out.push({ site, uid: c.uid, name: c.name, why: `person ${c.person} doesn't exist` });
      else if (c.outcome !== "dead" && ((f && !f.alive) || (r && r.death !== null))) out.push({ site, uid: c.uid, name: c.name, why: "walks about though dead" });
    }
  }
  return out;
}

/** The bound over a saved world's places. */
export function nobodyMadeUpBound(realm: Realm, sites: Parameters<typeof madeUpPeople>[1], personKinds: ReadonlySet<string>, people?: PeopleStore): Bound {
  const bad = madeUpPeople(realm, sites, personKinds, people);
  return { name: "nobody-made-up", ok: bad.length === 0, detail: bad.length === 0 ? "everyone on the maps is someone" : `${bad.length} made up: ${bad.slice(0, 3).map((b) => `${b.name} at ${b.site} (${b.why})`).join("; ")}` };
}

/**
 * N26F's bounds: `territories-sane` (no road more than 40% covered; every live pack and gang that has a road long enough
 * holds a stretch), `watch-paid` (no treasury below nothing; hired swords never more than there are sellswords),
 * `road-beats` (a day's walk between two places has 5 to 10 things on it, spaced: road/beats.ts).
 */
export function checkN26fBounds(realm: Realm, people?: PeopleStore): Bound[] {
  const data = roadDataOf(realm);
  const ts = territoriesNow(realm, data);
  const cover = Math.max(0, ...coverOf(data, ts).values());
  const packsOut = Object.values(realm.packs).filter((p) => p.count > 0 && realm.settlements[p.near] && !ts.some((t) => t.owner === p.id) && data.roads.some((r) => (r.a === p.near || r.b === p.near) && r.length >= 2 * GATE_CLEAR + 200));
  const out: Bound[] = [{ name: "territories-sane", ok: cover <= MAX_COVER + 1e-9 && packsOut.length === 0, detail: `most of a road covered: ${Math.round(cover * 100)}%; packs with no stretch: ${packsOut.length}` }];
  const negative = Object.values(realm.settlements).filter((s) => s.treasury < 0);
  const hired = Object.values(realm.settlements).reduce((a, s) => a + (s.watch?.hired.length ?? 0), 0);
  const swords = people ? Object.keys(realm.settlements).reduce((a, id) => a + (people.loadSite(id, "coarse") as Array<{ job: string }>).filter((r) => r.job === "sellsword").length, 0) : Infinity;
  out.push({ name: "watch-paid", ok: negative.length === 0 && hired <= swords, detail: `${negative.length} treasuries below nothing; ${hired} swords hired of ${swords === Infinity ? "?" : swords}` });
  return out;
}

/** `road-beats` over a few days of walking from one place to another. */
export function roadBeatsBound(realm: Realm, from: string, to: string, days: number[], people?: PeopleStore): Bound {
  const data = roadDataOf(realm);
  const counts = days.map((d) => spaced(beatsAlong(realm, data, from, to, d, people)).length);
  const ok = counts.every((n) => n >= 5 && n <= 10);
  return { name: "road-beats", ok, detail: `beats on a day's walk: ${counts.join(", ")}` };
}

/** The road data, for the news bound (the neighbours of a place). */
function journeysRoads(realm: Realm) {
  return roadDataOf(realm);
}
