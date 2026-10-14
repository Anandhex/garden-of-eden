import { TILES_PER_UNIT, cumulative, dist, pointAt, project } from "@millbrook/shared";
import { streamFor } from "../dice.js";
import { makeFigure } from "../realm/figures.js";
import { leaderRole } from "../realm/figures.js";
import { pick, placeName } from "../realm/names.js";
import type { Realm, Settlement } from "../realm/types.js";
import { WAY_EVERY, WAY_OFFSET, buildRoadData } from "./generateRoads.js";

/** The ends of a waystation's name: it is a place on the road. */
const ENDS = ["Rest", "Cross", "Ford", "Wayhouse", "Well", "Gate", "Stop"];

/**
 * Waystation inns (N26 decision 4): about every day's walk along a road, a hamlet with an inn stands a little off
 * it, joined by a lane. They are settlements like any other hamlet (`Settlement.way`), so they have people who live
 * there (N25), an innkeeper who hears every rumour, a map to walk into and news that reaches them. They have no
 * roads of their own (the road graph is unchanged: you pass them, or turn in). Made at the end of
 * `generateRealm` from a stream of their own, so nothing else in the realm changes for having them.
 */
export function addWaystations(realm: Realm, day: number): void {
  const rng = streamFor(realm.seed, "waystations");
  const roads = buildRoadData(realm, { roadsOnly: true }).roads.filter((r) => !r.id.startsWith("spur:"));
  const taken = new Set(Object.values(realm.settlements).map((s) => s.name));
  for (const road of roads) {
    // Main roads of a day's walk or more get an inn about every day and a half; lanes get none (a farm will put you up).
    const n = road.main && road.length >= WAY_EVERY ? Math.max(1, Math.floor(road.length / (WAY_EVERY * 1.6))) : 0;
    if (n === 0) continue;
    const a = realm.settlements[road.a]!;
    const b = realm.settlements[road.b]!;
    const cum = cumulative(road.pts);
    for (let k = 1; k <= n; k++) {
      // Spread along the road, with a little give.
      const t = (road.length * k) / (n + 1) + (rng() - 0.5) * 240;
      const on = pointAt(road.pts, cum, t);
      const ahead = pointAt(road.pts, cum, t + 4);
      const len = dist(on, ahead) || 1;
      const side = rng() < 0.5 ? 1 : -1;
      const x = on.x + (-(ahead.y - on.y) / len) * WAY_OFFSET * side;
      const y = on.y + ((ahead.x - on.x) / len) * WAY_OFFSET * side;
      const nearer = dist(on, road.pts[0]!) <= dist(on, road.pts[road.pts.length - 1]!) ? a : b;
      const name = `${placeName(rng, taken)} ${pick(rng, ENDS)}`;
      taken.add(name);
      const id = name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
      const s: Settlement = {
        id,
        name,
        kind: "hamlet",
        kingdom: nearer.kingdom,
        liege: nearer.id,
        leader: null,
        pos: { x: Math.round((x / TILES_PER_UNIT) * 1000) / 1000, y: Math.round((y / TILES_PER_UNIT) * 1000) / 1000 },
        terrain: nearer.terrain,
        population: 8 + Math.floor(rng() * 8),
        prosperity: Math.round(40 + rng() * 25),
        food: Math.round(50 + rng() * 25),
        treasury: Math.round(150 * (0.7 + rng() * 0.6)),
        buildings: { inn: 1, farms: 1 },
        project: null,
        taxRate: 0.1,
        arrears: 0,
        roads: [],
        way: { road: road.id, t: Math.round(project(road.pts, cum, { x, y }).t) },
      };
      realm.settlements[id] = s;
      const lead = makeFigure(realm, rng, { role: leaderRole("hamlet"), home: id, tier: pick(rng, ["G", "F"] as const), age: 30 + Math.floor(rng() * 25), superior: nearer.leader ?? null, renown: 12 }, day);
      s.leader = lead.id;
      makeFigure(realm, rng, { role: "innkeeper", home: id, tier: pick(rng, ["G", "F"] as const), age: 25 + Math.floor(rng() * 30), superior: lead.id }, day);
      makeFigure(realm, rng, { role: "farmer", home: id, tier: "G", age: 20 + Math.floor(rng() * 30), superior: lead.id }, day);
    }
  }
}
