import { seedFrom, seededRng, type Rng } from "../game/dice.js";
import { housesOf } from "../game/realm/houses.js";
import type { Realm, Settlement } from "../game/realm/types.js";
import { type AreaId, type PlaceId } from "../game/schedule.js";
import { districtsOf, FOOTPRINT, type CrowdZone, type DistrictKind } from "@millbrook/shared";
import { districtAt, districtRects, houseStyleOf, WALLED, type DistrictRect } from "./districtLayout.js";
import { type Building, type Den, MAP_H, MAP_W, type NpcSpot, PLAYER_START, spriteColor, type Tile } from "./map.js";

/**
 * A map for every place and what's around it (N14, N15). Every settlement's village
 * is made in code from what's built there: roads through the middle, walls with gates if it has them, its hall, inn, smithy, market, temple,
 * guild hall, barracks and granary, houses by its size, and a paddock by the farms.
 *
 * What isn't the village isn't on the village's map. Each settlement has localities
 * around it, each its own map, reached by walking off the edge of the one before:
 * - **the woods** (east of every village): beasts and game;
 * - **the road** (north, where there's anything up it): to
 *   - **the camp** of a gang seated there, and
 *   - **the mine**, the mouth of a dungeon nearby.
 *
 * Creatures roam dens on the map of their area (a den key is a den kind, or a creature
 * kind: `square`, `gate_road`, `paddock`, `woods_edge`, `deep_woods`, `camp`, `road_ambush`,
 * `mine_mouth`), and NPCs stand at the places on the map they're on. All of
 * it is seeded by the place's id, so it looks the same on every visit.
 */
export interface Exit {
  /** The edge tile you step onto to leave. */
  x: number;
  y: number;
  to: AreaId | "realm";
  /** "To the mine road". */
  label: string;
  /** Where you stand on this map when you come in from `to`. */
  inward: { x: number; y: number };
}

export interface SiteMap {
  /** The settlement's id for its village; `site:area` for a locality. */
  id: string;
  site: string;
  area: AreaId;
  name: string;
  w: number;
  h: number;
  tiles: Tile[][];
  buildings: Building[];
  /** Where the player stands when they arrive from the realm's roads. */
  start: { x: number; y: number };
  /** Where creatures roam on this map, by den key (a creature kind or a spawn rule's place). */
  dens: Record<string, Den>;
  /** The ways off this map to the areas next to it. */
  exits: Exit[];
  /** The places on this map (schedule places): who's at one of them is here. */
  places: PlaceId[];
  /** Where the townsfolk gather (N16); none on the localities' maps. */
  zones: CrowdZone[];
  /** Its districts (N26H) and the gates of the walled ones; none on the localities' maps. */
  districts: DistrictRect[];
  gates: Array<{ x: number; y: number; district: string }>;
  isSolid(x: number, y: number): boolean;
  /** Where an NPC stands at a place here, or null if the place isn't on this map. */
  spotAt(place: string, id: string): { x: number; y: number } | null;
  /** An NPC's own spot (where they work) here, or null if their workplace isn't on this map. */
  npcSpot(id: string, workplace: string): NpcSpot | null;
  /**
   * Where an NPC stands at a place during window `k` of the clock (N16): their own spot,
   * or a step or two from it (nobody stands frozen to one tile all day). `avoid` rules out tiles.
   */
  wanderSpot(place: string, id: string, k: number, avoid?: (x: number, y: number) => boolean): { x: number; y: number } | null;
  /** The place a tile belongs to. */
  placeAtTile(pos: { x: number; y: number }): PlaceId;
  /** "the square of Ashby": a place's words for the prompt. */
  placeWords(place: string): { location: string; nearby: string[] };
}

/** What a map is made from: a settlement of the realm, or a plain village for a world without a realm. */
export type SiteInfo = Pick<Settlement, "id" | "name" | "kind" | "buildings" | "terrain" | "population" | "houses"> & { leader?: string | null; mapScale?: number; mapSeat?: boolean };

/** A plain village, for worlds without a realm (and tests of the maps). */
export const PLAIN_VILLAGE: SiteInfo = {
  id: "start",
  name: "the village",
  kind: "village",
  buildings: { farms: 1, inn: 1, smithy: 1 },
  terrain: "valley",
  population: 180,
};

/** Every den kind the maps have, for checking spawn rules. */
export const DEN_KEYS = ["villager", "square", "gate_road", "paddock", "horse", "wolf", "deep_woods", "woods_edge", "bandit", "road_ambush", "camp", "mine_mouth"] as const;

/** Colour of a den's creatures when their kind has none (map.ts CREATURE_COLORS). */
export const DEN_COLORS: Record<string, string> = {
  square: "#c9b48a",
  gate_road: "#c9b48a",
  paddock: "#8b5a2b",
  woods_edge: "#8a8f96",
  deep_woods: "#8a8f96",
  road_ambush: "#6b3b2a",
  camp: "#5a4636",
  mine_mouth: "#7a6f60",
};

interface Anchor {
  x: number;
  y: number;
  location: string;
  nearby: string[];
}

interface Layout {
  name: string;
  tiles: Tile[][];
  buildings: Building[];
  anchors: Partial<Record<PlaceId, Anchor>>;
  /** Where someone stands on a tile that belongs to no place here. */
  fallback: PlaceId;
  dens: Record<string, Den>;
  exits: Exit[];
  start: { x: number; y: number };
  /** Where the townsfolk gather (N16): the square, the market, the fields, the gate, the exits. */
  zones?: CrowdZone[];
  /** Its districts (N26H), as rectangles, and the gates in the walls round the closed ones. */
  districts?: DistrictRect[];
  gates?: Array<{ x: number; y: number; district: string }>;
}

/** The localities a settlement has: the woods always; the road when a camp or a mine is up it. */
export function areasOf(realm: Realm | null | undefined, site: string): AreaId[] {
  if (!realm) return ["village", "woods"];
  // The camp, the old mine and the woods are interiors entered from the open road (N26F decision 9); the old "road out of"
  // map is gone, and the village's only way out is onto the road.
  // The old "road out of" map is the track from the open road to the camp and the old mine.
  const out: AreaId[] = ["village"];
  const camp = !!gangAt(realm, site);
  const mine = !!dungeonAt(realm, site);
  if (camp || mine) out.push("road");
  if (camp) out.push("camp");
  if (mine) out.push("mine");
  out.push("woods");
  return out;
}

const gangAt = (realm: Realm, site: string) => Object.values(realm.factions).find((f) => f.kind === "gang" && f.dissolved === undefined && f.seat === site);
const dungeonAt = (realm: Realm, site: string) => Object.values(realm.dungeons).find((d) => d.near === site);

/** What each area of a settlement is called, and what's about at its place. */
export function areaWords(realm: Realm | null | undefined, s: SiteInfo, area: AreaId): Anchor & { name: string } {
  switch (area) {
    case "road":
      return { x: 0, y: 0, name: `The road out of ${s.name}`, location: `the road out of ${s.name}`, nearby: ["cart ruts", "pines on both sides"] };
    case "camp": {
      const gang = realm ? gangAt(realm, s.id) : undefined;
      const who = gang?.name ?? "outlaws";
      return { x: 0, y: 0, name: `The camp of ${who}`, location: `the camp of ${who} outside ${s.name}`, nearby: ["a smouldering campfire", "lean-tos of hide and branches"] };
    }
    case "mine": {
      const d = realm ? dungeonAt(realm, s.id) : undefined;
      const what = d?.name ?? "the old workings";
      return { x: 0, y: 0, name: cap(what), location: `the mouth of ${what}, near ${s.name}`, nearby: ["a dark entrance", "spoil heaps"] };
    }
    case "woods":
      return { x: 0, y: 0, name: `The woods around ${s.name}`, location: `the woods around ${s.name}`, nearby: ["tall trees", "a game trail"] };
    default:
      return { x: 0, y: 0, name: s.name, location: s.name, nearby: [] };
  }
}

const cap = (t: string) => t.replace(/^./, (c) => c.toUpperCase());

const cache = new Map<string, SiteMap>();

/**
 * The map of a settlement's area (its village by default). Made once per settlement,
 * area, buildings and neighbouring areas; the same every visit.
 */
export function siteMap(s0: SiteInfo, area: AreaId = "village", realm?: Realm | null): SiteMap {
  // The map is laid out from what stood when it was first made (N26H): homes and workplaces keep their buildings for good.
  const rs = realm?.settlements[s0.id];
  const s: SiteInfo = rs?.mapFrozen ? { ...s0, buildings: rs.mapFrozen.buildings, mapSeat: rs.mapFrozen.seat, kind: rs.mapFrozen.kind ?? s0.kind } : s0;
  const areas = areasOf(realm, s.id);
  const at: AreaId = areas.includes(area) ? area : "village";
  const extra = at === "camp" ? (realm ? gangAt(realm, s.id)?.name : "") : at === "mine" ? (realm ? dungeonAt(realm, s.id)?.name : "") : "";
  const key = `${realm?.seed ?? ""}:${s.id}:${at}:${s.kind}:${JSON.stringify(s.buildings)}:${areas.join(",")}:${extra ?? ""}:${s.houses ?? ""}:${realm?.settlements[s.id] ? "r" : ""}:${s.mapSeat ?? s.leader ?? ""}:${realm?.settlements[s.id]?.mapScale ?? ""}`;
  const hit = cache.get(key);
  if (hit) {
    // Another world of the same seed made this map first: this world's settlement keeps the same scale and frozen layout.
    const fixed = fixedOf.get(key);
    if (rs && fixed) {
      rs.mapScale ??= fixed.scale;
      rs.mapFrozen ??= structuredClone(fixed.frozen);
    }
    return hit;
  }
  const rng = seededRng(seedFrom(`${s.id}:${at}`));
  let layout: Layout;
  if (at === "village") {
    // Grow the map until every house fits (deterministic: each try starts the place's own stream again).
    // Sized for the houses it starts with and room for half as many again, so the houses it builds later are added where there's
    // room without moving anyone's home. Only a place that outgrows that gets a new, bigger map.
    const kept = realm?.settlements[s.id]?.mapScale ?? s.mapScale;
    const room = kept ? 0 : Math.ceil(housesOf(s) * 0.5);
    let scale = kept ?? 1;
    let v = village(s, areas, realm, rng, scale, room);
    for (let k = 1; v.short > 0 && k <= 12; k++) {
      scale = Math.round(((kept ?? 1) + 0.12 * k) * 100) / 100;
      v = village(s, areas, realm, seededRng(seedFrom(`${s.id}:${at}`)), scale, room);
    }
    if (rs) {
      rs.mapScale = scale;
      rs.mapFrozen ??= { buildings: { ...s.buildings }, seat: s.kind === "capital" || (!!s.leader && ["lord", "ruler"].includes(realm?.figures[s.leader]?.role ?? "")), kind: s.kind };
    }
    layout = v;
  } else layout = at === "road" ? road(s, areas, realm, rng) : at === "camp" ? camp(s, realm, rng) : at === "mine" ? mine(s, realm, rng) : woods(s, realm, rng);
  const made = finish(s, at, layout);
  cache.set(key, made);
  if (rs?.mapScale !== undefined && rs.mapFrozen) fixedOf.set(key, { scale: rs.mapScale, frozen: structuredClone(rs.mapFrozen) });
  return made;
}

/** What a map's first making fixed on its settlement (scale and frozen layout), by cache key. */
const fixedOf = new Map<string, { scale: number; frozen: NonNullable<Settlement["mapFrozen"]> }>();


// ---- Drawing helpers ----

function grid(fill: Tile, w = MAP_W, h = MAP_H): Tile[][] {
  return Array.from({ length: h }, () => Array<Tile>(w).fill(fill));
}

const dims = (tiles: Tile[][]) => ({ W: tiles[0]?.length ?? MAP_W, H: tiles.length });

function setter(tiles: Tile[][]) {
  return (x: number, y: number, t: Tile) => {
    if (tiles[y]?.[x] !== undefined) tiles[y]![x] = t;
  };
}

function borderTrees(tiles: Tile[][]): void {
  const set = setter(tiles);
  const { W, H } = dims(tiles);
  for (let x = 0; x < W; x++) {
    set(x, 0, "tree");
    set(x, H - 1, "tree");
  }
  for (let y = 0; y < H; y++) {
    set(0, y, "tree");
    set(W - 1, y, "tree");
  }
}

/** A path through the points, in straight runs (x first, then y). */
function carve(tiles: Tile[][], pts: Array<[number, number]>): void {
  const set = setter(tiles);
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1]!;
    const [bx, by] = pts[i]!;
    for (let x = Math.min(ax, bx); x <= Math.max(ax, bx); x++) set(x, ay, "path");
    for (let y = Math.min(ay, by); y <= Math.max(ay, by); y++) set(bx, y, "path");
  }
}

/** Trees over the grass, `density` of it, leaving tiles within `clear` of a path open. */
function forest(tiles: Tile[][], rng: Rng, density: number, clear: number, keepOpen: (x: number, y: number) => boolean = () => false): void {
  const { W, H } = dims(tiles);
  const nearPath = (x: number, y: number) => {
    for (let dy = -clear; dy <= clear; dy++) for (let dx = -clear; dx <= clear; dx++) if (tiles[y + dy]?.[x + dx] === "path") return true;
    return false;
  };
  const marks: Array<[number, number]> = [];
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) if (tiles[y]![x] === "grass" && !keepOpen(x, y) && !nearPath(x, y) && rng() < density) marks.push([x, y]);
  for (const [x, y] of marks) tiles[y]![x] = "tree";
}

function put(tiles: Tile[][], buildings: Building[], b: Building, door?: { x: number; y: number }): void {
  const set = setter(tiles);
  buildings.push(b);
  for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) set(x, y, "wall");
  if (door) set(door.x, door.y, "door");
}

/** An exit on a map's edge: the edge tile is path, and so is the tile in from it. */
function exitAt(tiles: Tile[][], x: number, y: number, to: AreaId | "realm", label: string): Exit {
  const { W, H } = dims(tiles);
  const inward = { x: x === 0 ? 1 : x === W - 1 ? W - 2 : x, y: y === 0 ? 1 : y === H - 1 ? H - 2 : y };
  const set = setter(tiles);
  set(x, y, "path");
  set(inward.x, inward.y, "path");
  return { x, y, to, label, inward };
}

const exitLabel = (realm: Realm | null | undefined, s: SiteInfo, to: AreaId) => (to === "village" ? `To ${s.name}` : `To ${areaWords(realm, s, to).location.replace(/^the /, "the ")}`);

// ---- The village ----

const INNS = ["the Red Lion", "the Golden Sheaf", "the Old Oak", "the Wayfarer's Rest", "the Black Hound", "the Plough and Star", "the Crossed Keys", "the Drowsy Ox"];
const COLORS: Record<string, string> = {
  inn: "#a9742f",
  smithy: "#8a4b3a",
  hall: "#6f5a8a",
  palace: "#8a6a2a",
  market: "#b59a3f",
  temple: "#c9c3b0",
  guildhall: "#4f6fa0",
  barracks: "#6b4a3a",
  house: "#8a7a5f",
  manor: "#7a5f7f",
  granary: "#a08a50",
};
const HALL: Record<string, string> = { hamlet: "Elder's house", village: "Village hall", town: "Town hall", city: "Lord's hall", capital: "Palace" };

/**
 * How big each kind of place's map is (N16): a hamlet is a clearing with a few
 * cottages; a capital is a walled city of streets, a palace, manors and hundreds of
 * houses, big enough for its thousands of people to walk about in.
 */
export const VILLAGE_SIZE: Record<string, { w: number; h: number }> = {
  hamlet: { w: 28, h: 20 },
  village: { w: 40, h: 28 },
  // Bigger since N26H: buildings are drawn to their real size, and the quarters need room.
  town: { w: 66, h: 46 },
  city: { w: 112, h: 76 },
  capital: { w: 160, h: 108 },
};
/** Manors for the gentry and nobles. */
const MANORS: Record<string, number> = { hamlet: 0, village: 0, town: 2, city: 7, capital: 12 };

interface Wanted {
  kind: string;
  name: string;
  w: number;
  h: number;
}

interface Lot {
  x: number;
  y: number;
  w: number;
  h: number;
  door: { x: number; y: number };
  front: { x: number; y: number };
}

function village(s: SiteInfo, areas: AreaId[], realm: Realm | null | undefined, rng: Rng, scale = 1, room = 0): Layout & { short: number } {
  const size = VILLAGE_SIZE[s.kind] ?? VILLAGE_SIZE.village!;
  // A place with more houses than its kind's map holds gets a bigger map (N26H: houses are at their real size).
  const W = Math.round(size.w * scale);
  const H = Math.round(size.h * scale);
  const big = s.kind === "town" || s.kind === "city" || s.kind === "capital";
  const tiles = grid("grass", W, H);
  const set = setter(tiles);
  borderTrees(tiles);
  const reserved = new Uint8Array(W * H);
  const zones: CrowdZone[] = [];
  const zone = (id: string, kind: string, x0: number, y0: number, x1: number, y1: number, pave = false): CrowdZone => {
    const z = { id, kind, x0: Math.max(1, x0), y0: Math.max(1, y0), x1: Math.min(W - 2, x1), y1: Math.min(H - 2, y1) };
    for (let y = z.y0; y <= z.y1; y++) for (let x = z.x0; x <= z.x1; x++) {
      reserved[y * W + x] = 1;
      if (pave && tiles[y]![x] === "grass") set(x, y, "path");
    }
    zones.push(z);
    return z;
  };
  // Walls, with gates where the roads go through.
  const walled = (s.buildings.walls ?? 0) > 0;
  if (walled) {
    for (let x = 2; x <= W - 3; x++) {
      set(x, 2, "wall");
      set(x, H - 3, "wall");
    }
    for (let y = 2; y <= H - 3; y++) {
      set(2, y, "wall");
      set(W - 3, y, "wall");
    }
  }
  // Inside the walls (or the trees).
  const lo = walled ? 3 : 1;
  const hiX = walled ? W - 4 : W - 2;
  const hiY = walled ? H - 4 : H - 2;
  // Roads: east-west through the middle (the west end is the road out to the realm), north-south through the crossroads.
  const mx = Math.floor(W / 2) - 1;
  const my = Math.floor(H / 2);
  for (let x = 0; x < W; x++) set(x, my, "path");
  for (let y = 1; y < H - 1; y++) set(mx, y, "path");
  // Towns and bigger: a grid of streets, and a street round the inside of the walls.
  const rows = [my];
  const cols = [mx];
  if (big) {
    // Streets far enough apart for buildings at their real size (N26H): a hall or an inn one side, houses the other.
    for (let r = my - 12; r >= lo + 3; r -= 12) rows.push(r);
    for (let r = my + 12; r <= hiY - 3; r += 12) rows.push(r);
    for (let c = mx - 16; c >= lo + 4; c -= 16) cols.push(c);
    for (let c = mx + 16; c <= hiX - 4; c += 16) cols.push(c);
    rows.push(lo, hiY);
    cols.push(lo, hiX);
    for (const r of rows) for (let x = lo; x <= hiX; x++) set(x, r, "path");
    for (const c of cols) for (let y = lo; y <= hiY; y++) set(c, y, "path");
  } else {
    // Lanes off the road for the cottages and farmsteads (N26H: houses at their real size need the frontage).
    for (const r of [my - 7, my + 7]) if (r > lo + 2 && r < hiY - 2) {
      rows.push(r);
      for (let x = lo + 2; x <= hiX - 2; x++) set(x, r, "path");
    }
  }
  // Where folk gather: the square (a paved plaza in a town), the market, the fields, the gate.
  const square = big ? zone("square", "square", mx - 4, my - 3, mx + 4, my + 3, true) : zone("square", "square", mx + 1, my + 1, mx + 5, my + 2);
  if (big) set(mx + 2, my - 2, "water"); // the well
  const market = (s.buildings.market ?? 0) > 0 ? (big ? zone("market", "market", mx + 6, my - 2, mx + 9, my + 2, true) : zone("market", "market", mx - 6, my + 1, mx - 2, my + 2)) : null;
  const gx = walled ? 3 : 2;
  zone("gate", "gate", gx, my - 1, gx + 3, my + 1);
  // The fields are outside, in the open country (N26G); inside are only gardens and a pinfold, kept as the "fields" zone.
  const fieldW = big ? 6 : 4;
  const fields = walled ? zone("fields", "fields", lo + 1, hiY - (big ? 4 : 2), lo + fieldW, hiY - 1) : zone("fields", "fields", 2, H - (big ? 6 : 4), 2 + fieldW, H - 2);
  for (let y = fields.y0; y <= fields.y1; y++) for (let x = fields.x0; x <= fields.x1; x++) if (tiles[y]![x] === "tree") set(x, y, "grass");
  if (s.terrain === "marsh" || s.terrain === "coast") {
    const px = walled ? hiX - 5 : W - 7;
    const py = walled ? hiY - 3 : H - 5;
    for (let y = py; y <= py + 2; y++) for (let x = px; x <= px + 3; x++) if (tiles[y]![x] === "grass") {
      set(x, y, "water");
      reserved[y * W + x] = 1;
    }
  }
  // The ways out: north up the road, east into the woods. The west road leads to the realm (travel).
  const exits: Exit[] = [];
  // The west road leads out into the realm (N26): walk off the edge and you're on the open road.
  if (realm?.settlements[s.id]) exits.push(exitAt(tiles, 0, my, "realm", "To the open road"));
  else if (areas.includes("woods")) exits.push(exitAt(tiles, W - 1, my, "woods", exitLabel(realm, s, "woods")));
  // The townsfolk who work outside (miners, hunters) still leave by these zones; where they go is the road's (road/commute.ts).
  zone("exit_road", "exit_road", 1, my - 1, 2, my + 1);
  zone("exit_woods", "exit_woods", 1, my - 1, 2, my + 1);
  if (!exits.some((e) => e.x === W - 1)) set(W - 1, my, "tree");

  // The districts (N26H): where each quarter lies, walls and a gate round the ones that are closed, and the castle or
  // palace as a compound on the high ground. They go in before the buildings so nothing is built across a wall.
  const seatHere = s.mapSeat ?? (s.kind === "capital" || (!!s.leader && ["lord", "ruler"].includes(realm?.figures[s.leader]?.role ?? "")));
  const districts = districtsOf({ kind: s.kind, name: s.name, buildings: s.buildings, terrain: s.terrain, seat: seatHere });
  const rects = districtRects(districts, { lo, hiX, hiY, mx, my, big });
  const dAt = (x: number, y: number) => districtAt(rects, x, y);
  const gates: Array<{ x: number; y: number; district: string }> = [];
  const compounds: Building[] = [];
  for (const r of rects) {
    if (!WALLED.has(r.district.kind) || r.district.kind === "manor" && !big) continue;
    // A wall a tile inside the quarter's edge, and a gate wherever a street crosses it (not where one runs along it).
    const [x0, y0, x1, y1] = [r.x0 + 1, r.y0 + 1, r.x1 - 1, r.y1 - 1];
    for (let x = x0; x <= x1; x++) for (const y of [y0, y1]) wallOrGate(x, y, r.district.id, "h");
    for (let y = y0 + 1; y < y1; y++) for (const x of [x0, x1]) wallOrGate(x, y, r.district.id, "v");
  }
  function wallOrGate(x: number, y: number, district: string, side: "h" | "v"): void {
    if (x <= lo || y <= lo || x >= hiX || y >= hiY) return;
    const t = tiles[y]![x];
    const isPath = (xx: number, yy: number) => tiles[yy]?.[xx] === "path";
    const crosses = side === "h" ? isPath(x, y - 1) && isPath(x, y + 1) : isPath(x - 1, y) && isPath(x + 1, y);
    if (t === "path" && crosses) {
      set(x, y, "door");
      gates.push({ x, y, district });
    } else if (t !== "water" && t !== "door") set(x, y, "wall");
    reserved[y * W + x] = 1;
  }
  // The castle (a keep in a walled bailey with a gatehouse) or the palace (a compound of courts), in its own ward.
  const ward = rects.find((r) => r.district.kind === "palace" || r.district.kind === "castle");
  if (ward) {
    const kind = ward.district.kind === "palace" ? "palace" : "castle";
    const fp = FOOTPRINT[kind]!;
    const cw = Math.min(fp.compound!.w, ward.x1 - ward.x0 - 3);
    const ch = Math.min(fp.compound!.h, ward.y1 - ward.y0 - 3);
    const cx = Math.floor((ward.x0 + ward.x1 - cw) / 2) + 1;
    const cy = Math.floor((ward.y0 + ward.y1 - ch) / 2) + 1;
    for (let y = cy; y < cy + ch; y++) for (let x = cx; x < cx + cw; x++) {
      const edge = x === cx || y === cy || x === cx + cw - 1 || y === cy + ch - 1;
      set(x, y, edge ? "wall" : "path");
      reserved[y * W + x] = 1;
    }
    const gate = { x: cx + Math.floor(cw / 2), y: cy + ch - 1 };
    set(gate.x, gate.y, "door");
    for (let y = gate.y + 1; y <= Math.min(ward.y1 - 1, gate.y + 3); y++) if (tiles[y]![gate.x] === "grass") set(gate.x, y, "path");
    const bw = Math.min(fp.w, cw - 4);
    const bh = Math.min(fp.h, ch - 5);
    const keep: Building = { name: kind === "palace" ? "Palace" : "Castle", x: cx + Math.floor((cw - bw) / 2), y: cy + 2, w: bw, h: bh, color: COLORS.palace!, kind, front: { x: gate.x, y: cy + 2 + bh }, district: ward.district.id, compound: { x: cx, y: cy, w: cw, h: ch, gate } };
    compounds.push(keep);
  }
  // What's built here, most important first; houses fill the rest by size.
  const level = (b: keyof SiteInfo["buildings"]) => s.buildings[b] ?? 0;
  // Buildings at their real size (N26H decision 3: shared town/districts.ts FOOTPRINT), clamped so the biggest still fit between streets.
  const tall = big ? 10 : 5;
  const sized = (kind: string, name: string, fpKind = kind): Wanted => {
    const f = FOOTPRINT[fpKind] ?? { w: 4, h: 3 };
    // Long buildings lie along the street.
    const [w, h] = f.h > f.w ? [f.h, f.w] : [f.w, f.h];
    return { kind, name, w: Math.min(w, big ? 15 : 12), h: Math.min(h, tall) };
  };
  const wanted: Wanted[] = [];
  if (!compounds.some((c) => c.kind === "palace")) wanted.push(s.kind === "capital" ? sized("palace", "Palace", "hall") : sized("hall", HALL[s.kind] ?? "Hall"));
  if (s.kind === "capital") wanted.push(sized("hall", "Lord chancellor's hall"));
  if (s.kind === "capital") wanted.push(sized("temple", "Cathedral", "cathedral"));
  const innNames = [...INNS].sort(() => rng() - 0.5).map((n) => n.replace(/^the /, "").replace(/^./, (c) => c.toUpperCase()));
  const inns = s.kind === "hamlet" && level("inn") === 0 ? 0 : Math.max(1, Math.min(4, level("inn") + (big ? 1 : 0)));
  for (let i = 0; i < inns; i++) wanted.push(sized("inn", innNames[i % innNames.length]!));
  for (let i = 0; i < Math.min(3, level("smithy")); i++) wanted.push(sized("smithy", "Forge"));
  if (market) wanted.push(sized("market", "Market hall"));
  if (level("temple") > 0) wanted.push(sized("temple", "Temple"));
  if (level("temple") >= 3) wanted.push(sized("temple", "Shrine", "craft"));
  if (level("guildhall") > 0) wanted.push(sized("guildhall", "Guild hall"));
  if (level("barracks") > 0) wanted.push(sized("barracks", "Barracks"));
  if (level("granary") > 0) wanted.push(sized("granary", "Granary"));
  for (let i = 0; i < (MANORS[s.kind] ?? 0); i++) wanted.push(sized("manor", "Manor"));
  // Exactly the houses the place has (N25): it only grows when the place builds one, so people keep their homes.
  const houses = housesOf(s);

  // Lots: along every street, either side, door onto the street.
  const built = new Uint8Array(W * H);
  const fits = (x: number, y: number, w: number, h: number): boolean => {
    if (x < lo || y < lo || x + w - 1 > hiX || y + h - 1 > hiY) return false;
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) {
      const t = tiles[yy]![xx];
      if ((t !== "grass" && t !== "tree") || reserved[yy * W + xx]) return false;
    }
    for (let yy = y - 1; yy <= y + h; yy++) for (let xx = x - 1; xx <= x + w; xx++) if (built[yy * W + xx]) return false;
    return true;
  };
  const lotsFor = (w: number, h: number): Lot[] => {
    const out: Lot[] = [];
    const doorAlong = (a: number, len: number) => a + (len >= 3 ? 1 + Math.floor(rng() * (len - 2)) : Math.floor(rng() * len));
    for (const r of rows) {
      for (let x = lo; x + w - 1 <= hiX; x++) {
        const dx = doorAlong(x, w);
        out.push({ x, y: r - h, w, h, door: { x: dx, y: r - 1 }, front: { x: dx, y: r } });
        out.push({ x, y: r + 1, w, h, door: { x: dx, y: r + 1 }, front: { x: dx, y: r } });
      }
    }
    for (const c of cols) {
      for (let y = lo; y + h - 1 <= hiY; y++) {
        const dy = doorAlong(y, h);
        out.push({ x: c - w, y, w, h, door: { x: c - 1, y: dy }, front: { x: c, y: dy } });
        out.push({ x: c + 1, y, w, h, door: { x: c + 1, y: dy }, front: { x: c, y: dy } });
      }
    }
    return out.filter((l) => tiles[l.front.y]?.[l.front.x] === "path");
  };
  const buildings: Building[] = [];
  const place = (b: Wanted, lot: Lot) => {
    put(tiles, buildings, { name: b.name, x: lot.x, y: lot.y, w: lot.w, h: lot.h, color: COLORS[b.kind] ?? COLORS.house!, kind: b.kind, front: lot.front }, lot.door);
    for (let y = lot.y; y < lot.y + lot.h; y++) for (let x = lot.x; x < lot.x + lot.w; x++) built[y * W + x] = 1;
  };
  const near = (lot: Lot, at: { x: number; y: number }) => Math.abs(lot.front.x - at.x) + Math.abs(lot.front.y - at.y);
  // Each building goes to its own quarter where the place has it (N26H decision 1).
  const HOME_DISTRICT: Record<string, DistrictKind[]> = { manor: ["noble", "manor", "high_street"], temple: ["cathedral", "temple_close"], barracks: ["barracks", "gate"], guildhall: ["guild", "craft"], inn: ["gate", "market", "high_street"], smithy: ["craft", "gate"], market: ["market"], granary: ["craft", "market"], hall: ["market", "high_street", "green"], palace: ["palace", "market"] };
  const centreOf = (kinds: DistrictKind[] | undefined) => {
    const r = kinds?.map((k) => rects.find((x) => x.district.kind === k)).find(Boolean);
    return r ? { x: (r.x0 + r.x1) / 2, y: (r.y0 + r.y1) / 2 } : null;
  };
  for (const b of wanted) {
    const goal = (b.kind === "market" && market ? { x: (market.x0 + market.x1) / 2, y: (market.y0 + market.y1) / 2 } : null) ?? centreOf(HOME_DISTRICT[b.name === "Cathedral" ? "temple" : b.kind]) ?? { x: mx, y: my };
    const spread = b.kind === "manor" ? 6 : b.kind === "palace" || b.kind === "hall" ? 0 : 4;
    const lots = lotsFor(b.w, b.h).filter((l) => fits(l.x, l.y, l.w, l.h));
    if (lots.length === 0) continue;
    lots.sort((p, q) => near(p, goal) + rng() * spread - (near(q, goal) + rng() * spread));
    place(b, lots[0]!);
  }
  // The compounds (castle, palace) go in before the houses, so the houses a place builds later never move their index.
  for (const c of compounds) {
    buildings.push(c);
    for (let y = c.y; y < c.y + c.h; y++) for (let x = c.x; x < c.x + c.w; x++) set(x, y, "wall");
    set(c.front!.x, c.y + c.h - 1, "door");
  }
  // Houses by the district they stand in (N26H decision 4): hovels in the slums, the poor end and the farmsteads, a craftsman's
  // house over the shop in the craft lanes, a merchant's on the high street, cottages elsewhere.
  let made = 0;
  const styles = ["merchant", "craft", "cottage", "hovel"] as const;
  const styleLots = styles.map((st) => ({ st, lots: lotsFor(FOOTPRINT[st]!.w, FOOTPRINT[st]!.h).sort(() => rng() - 0.5) }));
  const longest = Math.max(...styleLots.map((x) => x.lots.length));
  for (let i = 0; i < longest && made < houses; i++) {
    for (const { st, lots } of styleLots) {
      const lot = lots[i];
      if (!lot || made >= houses) continue;
      if (houseStyleOf(dAt(lot.door.x, lot.door.y)?.kind) !== st || !fits(lot.x, lot.y, lot.w, lot.h)) continue;
      place({ kind: "house", name: "", w: lot.w, h: lot.h }, lot);
      buildings[buildings.length - 1]!.style = st;
      made++;
    }
  }
  // Still short: any house that fits, anywhere (a small place has room to spare; a crowded one builds where it can).
  for (const st of ["hovel", "cottage"] as const) {
    if (made >= houses) break;
    for (const lot of lotsFor(FOOTPRINT[st]!.w, FOOTPRINT[st]!.h).sort(() => rng() - 0.5)) {
      if (made >= houses) break;
      const dk = dAt(lot.door.x, lot.door.y)?.kind;
      if (!fits(lot.x, lot.y, lot.w, lot.h) || (dk && (WALLED.has(dk) || dk === "noble"))) continue;
      place({ kind: "house", name: "", w: lot.w, h: lot.h }, lot);
      buildings[buildings.length - 1]!.style = st;
      made++;
    }
  }
  // How many more houses would still fit (a place builds more as it grows: its map has room for them from the start).
  let spare = 0;
  if (room > 0) for (const st of ["cottage", "hovel"] as const) for (const lot of lotsFor(FOOTPRINT[st]!.w, FOOTPRINT[st]!.h)) {
    if (spare >= room) break;
    if (fits(lot.x, lot.y, lot.w, lot.h)) {
      spare++;
      for (let y = lot.y; y < lot.y + lot.h; y++) for (let x = lot.x; x < lot.x + lot.w; x++) built[y * W + x] = 1;
    }
  }
  // Every building knows its district.
  for (const b of buildings) b.district ??= dAt(b.front?.x ?? b.x, b.front?.y ?? b.y)?.id ?? districts[0]!.id;
  // A few trees where nothing's built, more in the forest; none against a door or a path.
  const trees = (s.terrain === "forest" ? 18 : s.terrain === "plains" ? 4 : 9) * (big ? 2 : 1);
  for (let i = 0; i < trees; i++) {
    const x = 1 + Math.floor(rng() * (W - 2));
    const y = 1 + Math.floor(rng() * (H - 2));
    if (tiles[y]![x] !== "grass" || reserved[y * W + x]) continue;
    let clear = true;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (["path", "door", "wall"].includes(tiles[y + dy]?.[x + dx] ?? "")) clear = false;
    if (clear) set(x, y, "tree");
  }

  const first = (kind: string) => buildings.find((b) => b.kind === kind);
  const at = (b: Building | undefined) => (b?.front ? { x: b.front.x, y: b.front.y, building: b.name } : undefined);
  const inn = at(first("inn"));
  const smithy = at(first("smithy"));
  const hall = at(first("palace") ?? first("hall"));
  const sq: Anchor = { x: big ? mx + 1 : mx + 2, y: my + 1, location: `the square of ${s.name}`, nearby: ["the well", hall ? `the ${hall.building.toLowerCase()}` : "a few stalls", "folk passing"] };
  const placeAnchors: Partial<Record<PlaceId, Anchor>> = {
    square: sq,
    gate: ({ x: walled ? 4 : 3, y: my - 1, location: `the ${walled ? "gate" : "edge"} of ${s.name}`, nearby: [walled ? "the town gate" : "the road in", "a milestone"] }),
    inn: inn ? ({ x: inn.x, y: inn.y, location: `outside ${inn.building}, the inn of ${s.name}`, nearby: [`${inn.building}'s door`, "a hanging inn sign"] }) : sq,
    forge: smithy ? ({ x: smithy.x, y: smithy.y, location: `the smithy of ${s.name}`, nearby: ["an anvil", "a glowing forge"] }) : sq,
  };
  // Where creatures go in the village: the crowd in the square and on the road in, horses in the paddock by the farms.
  const sqDen = { x0: square.x0, y0: square.y0, x1: square.x1, y1: square.y1 };
  const paddock = { x0: fields.x0, y0: fields.y0, x1: fields.x1, y1: fields.y1 };
  const dens: Record<string, Den> = {
    square: sqDen,
    villager: sqDen,
    gate_road: { x0: 5, y0: my - 1, x1: 10, y1: my + 1 },
    paddock,
    horse: paddock,
  };
  // Each district is a zone too, so the crowd and the player's map know which quarter a tile is in (N26H).
  for (const r of rects) zones.push({ id: r.district.id, kind: `district:${r.district.kind}`, x0: r.x0, y0: r.y0, x1: r.x1, y1: r.y1 });
  return { name: s.name, tiles, buildings, anchors: placeAnchors, fallback: "square", dens, exits, start: { x: PLAYER_START.x, y: my }, zones, districts: rects, gates, short: Math.max(0, houses - made) + Math.max(0, room - spare) };
}

// ---- The localities ----

function road(s: SiteInfo, areas: AreaId[], realm: Realm | null | undefined, rng: Rng): Layout {
  const tiles = grid("grass");
  borderTrees(tiles);
  const buildings: Building[] = [];
  // Up from the village, a bend, and on north to the mine; the camp's track turns off east.
  const north = areas.includes("mine");
  carve(tiles, [[12, MAP_H - 1], [12, 12], [10, 12], [10, 6], [12, 6], [12, north ? 0 : 2]]);
  if (areas.includes("camp")) carve(tiles, [[12, 6], [MAP_W - 1, 6]]);
  // The track's far end comes out on the open road (N26F decision 9), where its sign stands.
  const exits: Exit[] = [exitAt(tiles, 12, MAP_H - 1, "realm", "Back to the road")];
  if (north) exits.push(exitAt(tiles, 12, 0, "mine", exitLabel(realm, s, "mine")));
  if (areas.includes("camp")) exits.push(exitAt(tiles, MAP_W - 1, 6, "camp", exitLabel(realm, s, "camp")));
  put(tiles, buildings, { name: "Cart", x: 14, y: 14, w: 2, h: 1, color: "#6b4a3a" });
  forest(tiles, rng, 0.45, 2);
  const w = areaWords(realm, s, "road");
  return {
    name: w.name,
    tiles,
    buildings,
    anchors: { road: { x: 11, y: 9, location: w.location, nearby: w.nearby } },
    fallback: "road",
    // The gang that works the road, and where hired men wait (director/revenge.ts) or raiders come by night.
    dens: { bandit: { x0: 8, y0: 2, x1: 15, y1: 7 }, road_ambush: { x0: 8, y0: 9, x1: 15, y1: 14 } },
    exits,
    start: { x: 12, y: MAP_H - 2 },
  };
}

function camp(s: SiteInfo, realm: Realm | null | undefined, rng: Rng): Layout {
  const tiles = grid("grass");
  borderTrees(tiles);
  const buildings: Building[] = [];
  carve(tiles, [[0, 9], [8, 9]]);
  const exits = [exitAt(tiles, 0, 9, "road", exitLabel(realm, s, "road"))];
  put(tiles, buildings, { name: "Chief's tent", x: 14, y: 4, w: 4, h: 2, color: "#6b4a3a" });
  put(tiles, buildings, { name: "Tent", x: 8, y: 4, w: 3, h: 2, color: "#7a5a40" });
  put(tiles, buildings, { name: "Tent", x: 8, y: 13, w: 3, h: 2, color: "#7a5a40" });
  put(tiles, buildings, { name: "Loot", x: 16, y: 13, w: 3, h: 1, color: "#8a6a3a" });
  put(tiles, buildings, { name: "Fire", x: 13, y: 9, w: 1, h: 1, color: "#d9772b" });
  // The clearing stays open; the woods close in around it.
  forest(tiles, rng, 0.6, 1, (x, y) => x >= 6 && x <= 21 && y >= 3 && y <= 15);
  const w = areaWords(realm, s, "camp");
  return {
    name: w.name,
    tiles,
    buildings,
    anchors: { camp: { x: 14, y: 8, location: w.location, nearby: w.nearby } },
    fallback: "camp",
    dens: { camp: { x0: 9, y0: 7, x1: 19, y1: 11 } },
    exits,
    start: { x: 1, y: 9 },
  };
}

function mine(s: SiteInfo, realm: Realm | null | undefined, rng: Rng): Layout {
  const tiles = grid("grass");
  borderTrees(tiles);
  const buildings: Building[] = [];
  // The rails run from the mine mouth down the hill to the road.
  carve(tiles, [[12, MAP_H - 1], [12, 5]]);
  const exits = [exitAt(tiles, 12, MAP_H - 1, "road", exitLabel(realm, s, "road"))];
  const w = areaWords(realm, s, "mine");
  put(tiles, buildings, { name: w.name, x: 9, y: 2, w: 8, h: 3, color: "#5a5550" }, { x: 12, y: 4 });
  put(tiles, buildings, { name: "Spoil heap", x: 4, y: 6, w: 3, h: 2, color: "#7a6f60" });
  put(tiles, buildings, { name: "Spoil heap", x: 18, y: 7, w: 3, h: 2, color: "#7a6f60" });
  put(tiles, buildings, { name: "Miners' hut", x: 16, y: 12, w: 4, h: 2, color: "#8a7a5f" }, { x: 17, y: 12 });
  setter(tiles)(17, 11, "path");
  forest(tiles, rng, 0.3, 2, (x, y) => y >= 5 && y <= 10 && x >= 8 && x <= 16);
  return {
    name: w.name,
    tiles,
    buildings,
    anchors: { mine: { x: 13, y: 7, location: w.location, nearby: w.nearby } },
    fallback: "mine",
    dens: { mine_mouth: { x0: 9, y0: 5, x1: 15, y1: 9 } },
    exits,
    start: { x: 12, y: MAP_H - 2 },
  };
}

function woods(s: SiteInfo, realm: Realm | null | undefined, rng: Rng): Layout {
  const tiles = grid("grass");
  borderTrees(tiles);
  // A game trail in from the village, winding east.
  carve(tiles, [[0, 9], [6, 9], [6, 5], [14, 5], [14, 12], [21, 12]]);
  const exits = [realm?.settlements[s.id] ? exitAt(tiles, 0, 9, "realm", "Back to the road") : exitAt(tiles, 0, 9, "village", exitLabel(realm, s, "village"))];
  for (let y = 2; y <= 3; y++) for (let x = 19; x <= 22; x++) tiles[y]![x] = "water";
  forest(tiles, rng, 0.5, 1, (x, y) => (x >= 16 && x <= 22 && y >= 6 && y <= 10) || (x >= 2 && x <= 5 && y >= 7 && y <= 11));
  const w = areaWords(realm, s, "woods");
  return {
    name: w.name,
    tiles,
    buildings: [],
    anchors: { woods: { x: 8, y: 6, location: w.location, nearby: w.nearby } },
    fallback: "woods",
    // Wolves deep in; at night some come to the edge nearest the village. Elsewhere, the pack the realm says is there (game/realm/haunts.ts).
    dens: { wolf: { x0: 12, y0: 3, x1: 22, y1: 14 }, deep_woods: { x0: 12, y0: 3, x1: 22, y1: 14 }, woods_edge: { x0: 1, y0: 7, x1: 6, y1: 11 } },
    exits,
    start: { x: 1, y: 9 },
  };
}

// ---- Spots ----

function finish(s: SiteInfo, area: AreaId, L: Layout): SiteMap {
  const { tiles } = L;
  const spots: Record<string, Record<string, { x: number; y: number }>> = {};
  const solid = (x: number, y: number) => {
    const t = tiles[y]?.[x];
    return t === undefined || t === "tree" || t === "wall" || t === "water";
  };
  const exitTile = (x: number, y: number) => L.exits.some((e) => (e.x === x && e.y === y) || (e.inward.x === x && e.inward.y === y));
  const takenAt = (x: number, y: number) => Object.values(spots).some((m) => Object.values(m).some((p) => p.x === x && p.y === y));
  const spotAt = (place: string, id: string) => {
    const anchor = L.anchors[place as PlaceId];
    if (!anchor) return null;
    const mine = spots[place]?.[id];
    if (mine) return mine;
    // Every other tile, so people (and their names) don't stand on top of each other.
    for (let r = 0; r <= 6; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r || dx % 2 !== 0) continue;
          const x = anchor.x + dx;
          const y = anchor.y + dy;
          if (solid(x, y) || tiles[y]?.[x] === "door" || takenAt(x, y) || exitTile(x, y) || (x === L.start.x && y === L.start.y)) continue;
          return ((spots[place] ??= {})[id] = { x, y });
        }
      }
    }
    return null;
  };
  return {
    id: area === "village" ? s.id : `${s.id}:${area}`,
    site: s.id,
    area,
    name: L.name,
    w: dims(tiles).W,
    h: dims(tiles).H,
    tiles,
    buildings: L.buildings,
    start: L.start,
    dens: L.dens,
    exits: L.exits,
    places: Object.keys(L.anchors) as PlaceId[],
    zones: L.zones ?? [],
    districts: L.districts ?? [],
    gates: L.gates ?? [],
    isSolid: solid,
    spotAt,
    wanderSpot: (place, id, k, avoid) => {
      const base = spotAt(place, id);
      if (!base) return null;
      let h = 2166136261;
      for (const c of `${id}|${k}`) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
      h >>>= 0;
      // Half the time at their own spot; otherwise a step or two off it, where nobody else stands.
      if (h % 2 === 0) return base;
      const cands: Array<{ x: number; y: number }> = [];
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const x = base.x + dx;
          const y = base.y + dy;
          if ((!dx && !dy) || solid(x, y) || tiles[y]?.[x] === "door" || takenAt(x, y) || exitTile(x, y) || avoid?.(x, y)) continue;
          cands.push({ x, y });
        }
      }
      return cands.length > 0 ? cands[(h >>> 1) % cands.length]! : base;
    },
    npcSpot: (id, workplace) => {
      const anchor = L.anchors[workplace as PlaceId];
      if (!anchor) return null;
      const at = spotAt(workplace, id) ?? { x: anchor.x, y: anchor.y };
      return { ...at, color: spriteColor(id), location: anchor.location, nearby: anchor.nearby };
    },
    placeAtTile: (pos) => {
      let best: { place: PlaceId; d: number } = { place: L.fallback, d: Infinity };
      for (const [place, a] of Object.entries(L.anchors) as Array<[PlaceId, Anchor]>) {
        const d = Math.hypot(pos.x - a.x, pos.y - a.y);
        if (d < best.d) best = { place, d };
      }
      return best.d <= 4 ? best.place : L.fallback;
    },
    placeWords: (place) => {
      const a = L.anchors[place as PlaceId] ?? L.anchors[L.fallback]!;
      return { location: a.location, nearby: a.nearby };
    },
  };
}

/** The exit on `map` that leads to `to`, if there is one. */
export const exitTo = (map: SiteMap, to: AreaId | "realm"): Exit | undefined => map.exits.find((e) => e.to === to);

/** The exit the player is standing on, if any. */
export const exitUnder = (map: SiteMap, pos: { x: number; y: number }): Exit | undefined => map.exits.find((e) => e.x === pos.x && e.y === pos.y);

/** The plain village's map, for worlds without a realm (and tests). */
export const PLAIN: SiteMap = siteMap(PLAIN_VILLAGE);
