import {
  type Anchor,
  type Crossing,
  type Footprint,
  type RiverPath,
  type RoadData,
  type RoadPath,
  type RoadPlace,
  type RoadPoint,
  TILES_PER_UNIT,
  boundsOf,
  cumulative,
  dist,
  intersect,
  lengthOf,
  nearestOnSegment,
  pointAt,
  project,
  seedOf,
  tileOf,
  valueNoise,
} from "@millbrook/shared";
import { seededRng } from "../dice.js";
import type { Realm, Settlement } from "../realm/types.js";

/**
 * The land between places, as data (N26 decision 4). `buildRoadData(realm)` turns the realm into what `chunkAt`
 * needs: every settlement's footprint on the global tile grid, every road bent to the land as a polyline from gate
 * to gate, rivers from the hills to the coast, where they cross (a bridge on a main road, a ford or a ferry on a
 * lane), and what stands beside the road: waystation inns about every day's walk, milestones, signposts,
 * farmsteads, shrines, toll gates at the kingdoms' borders, keepers at bridges and ferries.
 *
 * It is a pure function of the realm's seed, its settlements' positions and its road list, so it is made again
 * (and cached) rather than saved: there is nothing to migrate, and the browser gets it once from the server.
 * Waystations are the one thing the realm itself keeps (they are hamlets, `Settlement.way`), because people live in
 * them (`addWaystations`, called when the realm is made).
 */

/** Footprint sizes in tiles, by kind: how big a place looks from the road. */
const FOOTPRINT: Record<string, [number, number]> = { hamlet: [13, 9], village: [17, 12], town: [25, 17], city: [35, 23], capital: [47, 31] };
/** Roads are bent by up to this share of their length (and no more than `MAX_BEND` tiles). */
const BEND = 0.07;
const MAX_BEND = 320;
/** Distance between the points of a polyline. */
const SPACING = 48;
/** A waystation is this many tiles off the road's middle. */
export const WAY_OFFSET = 22;
/** Waystations are placed about this far apart along a road. */
export const WAY_EVERY = 4300;
/** Tolls, in copper. */
export const TOLL = { bridge: 5, ferry: 10, border: 20 } as const;

const MAIN_KINDS = new Set(["town", "city", "capital"]);
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

const RIVER_A = ["Alder", "Brindle", "Calder", "Dunmere", "Elder", "Fenwater", "Grey", "Harrow", "Iron", "Kestrel", "Linden", "Marl", "Otter", "Rush", "Silver", "Teal"];
const RIVER_B = ["Water", "Beck", "Burn", "River", "Brook"];
const KEEPERS = ["Old Tam", "Mother Ashe", "Brannock", "Widow Marsh", "Dunstan", "Ollie Reed", "Garrick", "Sela Fenn"];

interface Cached {
  key: string;
  data: RoadData;
}
const cache = new WeakMap<Realm, Cached>();

/** The realm's road data, made once (and again if its roads or settlements change). */
export function roadDataOf(realm: Realm): RoadData {
  const key = `${realm.seed}:${Object.values(realm.settlements).map((s) => `${s.id}${s.pos.x},${s.pos.y}[${[...s.roads].sort().join(",")}]${s.way ? "w" : ""}`).join(";")}`;
  const hit = cache.get(realm);
  if (hit && hit.key === key) return hit.data;
  const data = buildRoadData(realm);
  cache.set(realm, { key, data });
  return data;
}

const centre = (s: Settlement): RoadPoint => ({ x: tileOf(s.pos.x), y: tileOf(s.pos.y) });

function footprintOf(s: Settlement): Footprint {
  const [w, h] = FOOTPRINT[s.kind] ?? FOOTPRINT.village!;
  const c = centre(s);
  const x0 = c.x - Math.floor(w / 2);
  const y0 = c.y - Math.floor(h / 2);
  return { id: s.id, name: s.name, kind: s.kind, terrain: s.terrain, x0, y0, x1: x0 + w - 1, y1: y0 + h - 1, gates: {}, walled: MAIN_KINDS.has(s.kind) };
}

/** The tile on a footprint's border where the line to `toward` leaves it. */
function gateToward(f: Footprint, toward: RoadPoint, taken: RoadPoint[]): RoadPoint {
  const cx = (f.x0 + f.x1) / 2;
  const cy = (f.y0 + f.y1) / 2;
  const dx = toward.x - cx;
  const dy = toward.y - cy;
  const hw = (f.x1 - f.x0) / 2;
  const hh = (f.y1 - f.y0) / 2;
  const scale = Math.min(hw / (Math.abs(dx) || 1e-9), hh / (Math.abs(dy) || 1e-9));
  let g = { x: Math.round(cx + dx * scale), y: Math.round(cy + dy * scale) };
  g = { x: Math.max(f.x0, Math.min(f.x1, g.x)), y: Math.max(f.y0, Math.min(f.y1, g.y)) };
  // Keep off the corners, and a few tiles from another road's gate.
  const onVertical = g.x === f.x0 || g.x === f.x1;
  const clampAlong = (v: number, lo: number, hi: number) => Math.max(lo + 2, Math.min(hi - 2, v));
  g = onVertical ? { x: g.x, y: clampAlong(g.y, f.y0, f.y1) } : { x: clampAlong(g.x, f.x0, f.x1), y: g.y };
  for (let tries = 0; tries < 12 && taken.some((t) => Math.abs(t.x - g.x) + Math.abs(t.y - g.y) < 4); tries++) {
    const step = (tries % 2 === 0 ? 1 : -1) * Math.ceil((tries + 1) / 2) * 3;
    g = onVertical ? { x: g.x, y: clampAlong(g.y + step, f.y0, f.y1) } : { x: clampAlong(g.x + step, f.x0, f.x1), y: g.y };
  }
  return g;
}

/** Push a point out of every footprint (and `margin` tiles around it) that it is in. */
function avoid(p: RoadPoint, footprints: Footprint[], margin: number): RoadPoint {
  let q = p;
  for (let pass = 0; pass < 3; pass++) {
    for (const f of footprints) {
      const x0 = f.x0 - margin, x1 = f.x1 + margin, y0 = f.y0 - margin, y1 = f.y1 + margin;
      if (q.x < x0 || q.x > x1 || q.y < y0 || q.y > y1) continue;
      // The nearest way out: left, right, up or down.
      const outs = [
        { x: x0 - 1, y: q.y, d: q.x - x0 },
        { x: x1 + 1, y: q.y, d: x1 - q.x },
        { x: q.x, y: y0 - 1, d: q.y - y0 },
        { x: q.x, y: y1 + 1, d: y1 - q.y },
      ].sort((a, b) => a.d - b.d);
      q = { x: outs[0]!.x, y: outs[0]!.y };
    }
  }
  return q;
}

/** A wandering line from a to b: points about `SPACING` apart, bent sideways by smooth noise, never through a footprint. */
function wander(seed: number, a: RoadPoint, b: RoadPoint, bend: number, avoidFp: Footprint[], margin: number, wiggle = true): RoadPoint[] {
  const L = dist(a, b);
  const n = Math.max(1, Math.round(L / SPACING));
  const nx = -(b.y - a.y) / (L || 1);
  const ny = (b.x - a.x) / (L || 1);
  const rng = seededRng(seed);
  const pts: RoadPoint[] = [{ ...a }];
  for (let k = 1; k < n; k++) {
    const f = k / n;
    const x = a.x + (b.x - a.x) * f;
    const y = a.y + (b.y - a.y) * f;
    // Broad bends (noise over ~1,500 tiles) that fade to nothing at both ends, plus a small jitter.
    const broad = ((valueNoise(seed, Math.round(x), Math.round(y), 1500) - 512) / 512) * bend * Math.min(1, 4 * f * (1 - f) * 2);
    const jitter = wiggle ? (rng() - 0.5) * 10 : 0;
    const off = broad + jitter;
    pts.push(avoid({ x: Math.round(x + nx * off), y: Math.round(y + ny * off) }, avoidFp, margin));
  }
  pts.push({ ...b });
  return pts;
}

/** Build everything the road needs from the realm. */
/** `roadsOnly`: just the roads between places (what placing the waystation inns needs). */
export function buildRoadData(realm: Realm, opts: { roadsOnly?: boolean } = {}): RoadData {
  const seed = (realm.seed ^ 0x5bd1e995) | 0;
  const all = Object.values(realm.settlements).sort((a, b) => a.id.localeCompare(b.id));
  const ordinary = all.filter((s) => !s.way);
  const ways = all.filter((s) => s.way);
  const prints = new Map(all.map((s) => [s.id, footprintOf(s)]));
  const fpOrdinary = ordinary.map((s) => prints.get(s.id)!);
  const anchors: Anchor[] = all.map((s) => ({ ...centre(s), terrain: s.terrain }));

  // Roads between ordinary places, bent by noise and kept out of other places.
  const roads: RoadPath[] = [];
  const seen = new Set<string>();
  for (const s of ordinary) {
    for (const o of [...s.roads].sort()) {
      const t = realm.settlements[o];
      if (!t || t.way) continue;
      const [a, b] = s.id < o ? [s, t] : [t, s];
      const id = `${a.id}~${b.id}`;
      if (seen.has(id)) continue;
      seen.add(id);
      const fa = prints.get(a.id)!;
      const fb = prints.get(b.id)!;
      const ga = gateToward(fa, centre(b), Object.values(fa.gates));
      const gb = gateToward(fb, centre(a), Object.values(fb.gates));
      fa.gates[id] = ga;
      fb.gates[id] = gb;
      const L = dist(ga, gb);
      const others = fpOrdinary.filter((f) => f.id !== a.id && f.id !== b.id);
      const pts = wander(seedOf(`${seed}:${id}`), ga, gb, Math.min(MAX_BEND, BEND * L), others, 28);
      roads.push({ id, a: a.id, b: b.id, main: MAIN_KINDS.has(a.kind) || MAIN_KINDS.has(b.kind), pts, length: lengthOf(pts) });
    }
  }
  roads.sort((a, b) => a.id.localeCompare(b.id));
  const cums = new Map(roads.map((r) => [r.id, cumulative(r.pts)]));

  if (opts.roadsOnly) return { seed, footprints: [...prints.values()], roads, rivers: [], crossings: [], places: [], anchors };

  // Waystations: the hamlet beside the road, joined to it by a short lane.
  const places: RoadPlace[] = [];
  for (const w of ways) {
    const road = roads.find((r) => r.id === w.way!.road);
    const fp = prints.get(w.id)!;
    if (!road) continue;
    const cum = cums.get(road.id)!;
    const c = centre(w);
    const near = project(road.pts, cum, c);
    const on = pointAt(road.pts, cum, near.t);
    const gate = gateToward(fp, on, []);
    const spur: RoadPath = { id: `spur:${w.id}`, a: w.id, b: road.id, main: false, pts: [gate, { x: on.x, y: on.y }], length: dist(gate, on) };
    fp.gates[spur.id] = gate;
    roads.push(spur);
    // A signpost where the lane leaves the road.
    const side = c.x * 0 + (gate.y >= on.y ? 1 : -1);
    places.push({ id: `way:${w.id}`, kind: "waystation", name: w.name, road: road.id, t: Math.round(near.t), at: { x: Math.round(on.x), y: Math.round(on.y + side * 3) }, on: { x: Math.round(on.x), y: Math.round(on.y) }, site: w.id });
  }

  // Rivers: from the hills to the coast, never through a place.
  const rng = seededRng(seedOf(`${seed}:rivers`));
  const hills = ordinary.filter((s) => s.terrain === "hills" || s.terrain === "forest");
  const coasts = ordinary.filter((s) => s.terrain === "coast");
  const rivers: RiverPath[] = [];
  const sources = [...hills].sort((a, b) => seedOf(`${seed}:${a.id}`) - seedOf(`${seed}:${b.id}`)).slice(0, Math.min(5, Math.max(2, Math.floor(hills.length / 2))));
  const everyPrint = [...prints.values()];
  for (const s of sources) {
    const from = centre(s);
    const target = coasts.length > 0 ? [...coasts].sort((a, b) => dist(centre(a), from) - dist(centre(b), from))[0]! : null;
    const to = target ? centre(target) : { x: from.x < tileOf(500) ? 0 : tileOf(1000), y: from.y };
    const half = 3 + Math.floor(rng() * 3);
    const L = dist(from, to);
    // Start a little off the source place so the river doesn't begin inside it.
    const start = { x: from.x + 400 + Math.round(rng() * 300), y: from.y - 300 - Math.round(rng() * 200) };
    const margin = half + 18;
    const pts = wander(seedOf(`${seed}:river:${s.id}`), avoid(start, everyPrint, margin), avoid(to, everyPrint, margin), Math.min(900, 0.12 * L), everyPrint, margin, false);
    rivers.push({ id: `river:${s.id}`, name: `the ${RIVER_A[Math.floor(rng() * RIVER_A.length)]!} ${RIVER_B[Math.floor(rng() * RIVER_B.length)]!}`, half, pts });
  }

  // Where roads cross rivers.
  const crossings: Crossing[] = [];
  for (const road of roads) {
    if (road.id.startsWith("spur:")) continue;
    const cum = cums.get(road.id)!;
    const rb = boundsOf(road.pts, 4);
    for (const river of rivers) {
      for (let i = 1; i < road.pts.length; i++) {
        for (let j = 1; j < river.pts.length; j++) {
          const a = river.pts[j - 1]!;
          const b = river.pts[j]!;
          if (Math.max(a.x, b.x) < rb.x0 || Math.min(a.x, b.x) > rb.x1 || Math.max(a.y, b.y) < rb.y0 || Math.min(a.y, b.y) > rb.y1) continue;
          const x = intersect(road.pts[i - 1]!, road.pts[i]!, river.pts[j - 1]!, river.pts[j]!);
          if (!x) continue;
          const t = cum[i - 1]! + dist(road.pts[i - 1]!, x);
          if (crossings.some((c) => c.road === road.id && c.river === river.id && Math.abs(c.t - t) < 40)) continue;
          const r = seededRng(seedOf(`${seed}:${road.id}:${river.id}:${Math.round(t)}`));
          const kind: Crossing["kind"] = road.main ? "bridge" : river.half >= 5 && r() < 0.5 ? "ferry" : "ford";
          crossings.push({
            id: `x:${road.id}:${river.id}:${Math.round(t)}`,
            kind,
            road: road.id,
            river: river.id,
            at: { x: Math.round(x.x), y: Math.round(x.y) },
            t: Math.round(t),
            ...(kind !== "ford" ? { keeper: KEEPERS[Math.floor(r() * KEEPERS.length)]!, toll: kind === "ferry" ? TOLL.ferry : TOLL.bridge } : {}),
          });
        }
      }
    }
  }
  // A ferry has no deck to walk: the lane's tiles over the river are a ford, and the ferryman takes a toll for the crossing.
  for (const c of crossings) {
    if (c.kind === "bridge" && c.keeper && c.toll) {
      const road = roads.find((r) => r.id === c.road)!;
      places.push({ id: `br:${c.id}`, kind: "bridge", name: `the keeper of the bridge over ${rivers.find((rv) => rv.id === c.river)?.name ?? "the river"}`, road: road.id, t: c.t, at: sideOf(road, cums.get(road.id)!, c.t, 9, 1), on: { ...c.at }, toll: c.toll });
    } else if (c.kind === "ferry") {
      const road = roads.find((r) => r.id === c.road)!;
      places.push({ id: `fy:${c.id}`, kind: "ferry", name: `the ferryman at ${rivers.find((rv) => rv.id === c.river)?.name ?? "the river"}`, road: road.id, t: c.t, at: sideOf(road, cums.get(road.id)!, c.t, 9, -1), on: { ...c.at }, toll: c.toll! });
    }
  }

  // Things beside the road: stones, signposts, farms, shrines, toll gates.
  const nearCrossing = (road: RoadPath, t: number, within: number) => crossings.some((c) => c.road === road.id && Math.abs(c.t - t) < within);
  for (const road of roads) {
    if (road.id.startsWith("spur:")) continue;
    const cum = cums.get(road.id)!;
    const a = realm.settlements[road.a]!;
    const b = realm.settlements[road.b]!;
    const r = seededRng(seedOf(`${seed}:places:${road.id}`));
    const add = (kind: RoadPlace["kind"], name: string, t: number, off: number, side: number, extra: Partial<RoadPlace> = {}) => {
      if (t < 60 || t > road.length - 60 || nearCrossing(road, t, 26)) return;
      if (places.some((p) => p.road === road.id && Math.abs(p.t - t) < 14)) return;
      const on = pointAt(road.pts, cum, t);
      places.push({ id: `${kind}:${road.id}:${Math.round(t)}`, kind, name, road: road.id, t: Math.round(t), at: sideOf(road, cum, t, off, side), on: { x: Math.round(on.x), y: Math.round(on.y) }, ...extra });
    };
    // A milestone every couple of hours' walk, a signpost out from each gate.
    const mileEvery = 1050;
    for (let t = mileEvery, k = 0; t < road.length - 120; t += mileEvery, k++) add("milestone", "a milestone", t + Math.round(r() * 30), road.main ? 4 : 3, k % 2 === 0 ? 1 : -1);
    add("signpost", `a signpost`, 70, road.main ? 4 : 3, 1);
    add("signpost", `a signpost`, road.length - 70, road.main ? 4 : 3, -1);
    // Farms near the villages and towns, a shrine now and then in the open.
    for (const [place, from] of [[a, 0], [b, road.length]] as const) {
      if (place.kind === "capital" || place.kind === "city") continue;
      if (r() < 0.65) add("farmstead", "a farmstead", from === 0 ? 260 + r() * 500 : road.length - 260 - r() * 500, 10, r() < 0.5 ? 1 : -1);
    }
    for (let t = 1800; t < road.length - 600; t += 2400) if (r() < 0.45) add("shrine", "a wayside shrine", t + r() * 600, 6, r() < 0.5 ? 1 : -1);
    // A toll gate where the road crosses a kingdom's border.
    if (a.kingdom && b.kingdom && a.kingdom !== b.kingdom) add("tollgate", `the border post of ${realm.kingdoms[b.kingdom]?.name ?? "the next kingdom"}`, road.length / 2, 3, 1, { toll: TOLL.border, kingdom: b.kingdom });
  }
  places.sort((x, y) => x.id.localeCompare(y.id));
  return { seed, footprints: everyPrint.sort((x, y) => x.id.localeCompare(y.id)), roads, rivers, crossings, places, anchors };
}

/** A point `off` tiles to one side of a road at `t` (side 1 or -1). */
function sideOf(road: RoadPath, cum: number[], t: number, off: number, side: number): RoadPoint {
  const a = pointAt(road.pts, cum, t - 3);
  const b = pointAt(road.pts, cum, t + 3);
  const len = dist(a, b) || 1;
  const nx = -(b.y - a.y) / len;
  const ny = (b.x - a.x) / len;
  const on = pointAt(road.pts, cum, t);
  return { x: Math.round(on.x + nx * off * side), y: Math.round(on.y + ny * off * side) };
}

/** Where a tile is, in realm map units (a settlement's position). */
export const unitAt = (tile: RoadPoint): RoadPoint => ({ x: tile.x / TILES_PER_UNIT, y: tile.y / TILES_PER_UNIT });

export { nearestOnSegment };
