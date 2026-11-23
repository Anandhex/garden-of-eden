import { seedFrom, seededRng, type Rng } from "../game/dice.js";
import { housesOf } from "../game/realm/houses.js";
import type { Realm, Settlement } from "../game/realm/types.js";
import { type AreaId, type PlaceId } from "../game/schedule.js";
import { districtsOf, FOOTPRINT, type CrowdZone, type DistrictKind } from "@garden-of-eden/shared";
import { districtAt, districtRects, houseStyleOf, WALLED, type DistrictRect } from "./districtLayout.js";
import { frontsOf, grow, line, loop, march, OVER_WALL, plazaFronts, smooth, spurTo, stamp, type Canvas, type Front, type Pt, type Rect, type Road, type StampOpts } from "./streets.js";
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
    for (let k = 1; v.short > 0 && k <= 16; k++) {
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
  // Open-town layout (3D client, 1 tile = 1.5 m): wide streets, yards between houses, a plaza; buildings keep their real size, so
  // the maps are bigger instead.
  hamlet: { w: 56, h: 42 },
  village: { w: 104, h: 66 },
  town: { w: 184, h: 130 },
  city: { w: 300, h: 212 },
  capital: { w: 520, h: 352 },
};

/**
 * How open a place is, in tiles (1 tile = 1.5 m): the width of its main street (the road in from the realm and the
 * boulevards), of its side lanes and ring streets, and of its alleys; how far a house stands back from the street (a yard with a
 * footpath to the door); the gap kept between neighbouring buildings; the central square (half-widths) and the parks; and, for
 * a walled place, how much open ground lies outside the walls for the suburbs along the roads.
 */
export const OPENNESS: Record<string, { main: number; lane: number; alley: number; setback: number; gap: number; plaza: { hx: number; hy: number } | null; parks: number; margin: number }> = {
  hamlet: { main: 4, lane: 3, alley: 3, setback: 2, gap: 3, plaza: null, parks: 0, margin: 0 },
  village: { main: 4, lane: 3, alley: 3, setback: 2, gap: 2, plaza: null, parks: 0, margin: 0 },
  town: { main: 5, lane: 3, alley: 2, setback: 1, gap: 2, plaza: { hx: 9, hy: 6 }, parks: 2, margin: 8 },
  city: { main: 5, lane: 3, alley: 2, setback: 1, gap: 2, plaza: { hx: 12, hy: 8 }, parks: 4, margin: 16 },
  capital: { main: 5, lane: 3, alley: 2, setback: 1, gap: 2, plaza: { hx: 14, hy: 9 }, parks: 6, margin: 22 },
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
  /** The tile outside the door, at the top of the yard's footpath. */
  front: { x: number; y: number };
  /** The yard's footpath: from `front` out to the street. */
  walk: Array<{ x: number; y: number }>;
  /** Which side of which street (or plaza) it is on, and how far along: houses are filled in along a side, so yards stay even. */
  side: string;
  pos: number;
}

const TAU = Math.PI * 2;
const angDiff = (a: number, b: number) => Math.abs(((a - b + Math.PI * 3) % TAU) - Math.PI);

/**
 * A settlement's village map, laid out the way such places grow.
 *
 * - **Hamlet**: a well on a small green with a ring track round it; the cottages face inward from the ring (the elder's house
 *   among them), a few short, irregular lanes wander out to the farmsteads.
 * - **Village**: an oval green with a well, ringed by a lane; the headman's hall faces it, the inn and the temple stand on the
 *   ring, and a paved market square adjoins it; lanes radiate outward, curving, with cottages along both sides in
 *   their yards and cross-lanes between them; smiths and mills toward the road, orchards at the outskirts.
 * - **Town**: a paved central square (hall, temple, market hall and the best inns face it), a second square at the gate,
 *   main streets from the square to the four gates, a ring road, parks, lanes and alleys growing off them into blocks;
 *   quarters (crafts, trade, the poor end) laid round the square.
 * - **City / capital**: the same with walls and the open ground outside them for the suburbs along the roads, the
 *   castle or palace ward with its boulevard, a cathedral square, more squares, a second ring and diagonal boulevards, noble
 *   and guild quarters walled off, alleys.
 */
function village(s: SiteInfo, areas: AreaId[], realm: Realm | null | undefined, rng: Rng, scale = 1, room = 0): Layout & { short: number } {
  const size = VILLAGE_SIZE[s.kind] ?? VILLAGE_SIZE.village!;
  // A place with more houses than its kind's map holds gets a bigger map (N26H: houses are at their real size).
  const W = Math.round(size.w * scale);
  const H = Math.round(size.h * scale);
  const big = s.kind === "town" || s.kind === "city" || s.kind === "capital";
  const hamlet = s.kind === "hamlet";
  const open = OPENNESS[s.kind] ?? OPENNESS.village!;
  const tiles = grid("grass", W, H);
  const set = setter(tiles);
  borderTrees(tiles);
  const reserved = new Uint8Array(W * H);
  const cv: Canvas = { W, H, tiles, reserved, roads: [], plazas: [] };
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
  const pave = (r: Rect) => {
    for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) {
      if (x < 1 || y < 1 || x > W - 2 || y > H - 2) continue;
      if (tiles[y]![x] === "grass" || tiles[y]![x] === "tree") set(x, y, "path");
      reserved[y * W + x] = 1;
    }
    cv.plazas.push(r);
  };
  // Walls, with the open country outside them (suburbs along the roads).
  const walled = (s.buildings.walls ?? 0) > 0;
  const M = walled ? open.margin : 0;
  const [w0, w1, v0, v1] = [M + 2, W - 3 - M, M + 2, H - 3 - M];
  if (walled) {
    for (let x = w0; x <= w1; x++) {
      set(x, v0, "wall");
      set(x, v1, "wall");
    }
    for (let y = v0; y <= v1; y++) {
      set(w0, y, "wall");
      set(w1, y, "wall");
    }
  }
  // Inside the walls (or the trees).
  const lo = walled ? w0 + 1 : 2;
  const hiX = walled ? w1 - 1 : W - 3;
  const hiY = walled ? v1 - 1 : H - 3;
  const mx = Math.floor(W / 2) - 1;
  const my = Math.floor(H / 2);
  const ccx = (lo + hiX) / 2;
  const ccy = (lo + hiY) / 2;
  const inner: Rect = { x0: lo + 2, y0: lo + 2, x1: hiX - 2, y1: hiY - 2 };
  const road = (dense: Pt[], kind: Road["kind"], width: number, o: Partial<StampOpts> = {}) => stamp(cv, dense, { kind, width, ...o });
  const within = (x: number, y: number) => x >= inner.x0 && y >= inner.y0 && x <= inner.x1 && y <= inner.y1;
  const eastExit = !realm?.settlements[s.id] && areas.includes("woods");

  // ---- Where each quarter lies, and the castle or palace's ward ----
  const seatHere = s.mapSeat ?? (s.kind === "capital" || (!!s.leader && ["lord", "ruler"].includes(realm?.figures[s.leader]?.role ?? "")));
  const districts = districtsOf({ kind: s.kind, name: s.name, buildings: s.buildings, terrain: s.terrain, seat: seatHere });
  // Small places: the green's centre and the ring round it (decided here, since the quarters are drawn round it).
  const flip = rng() < 0.5 ? 1 : -1;
  const gR = { rx: (hamlet ? 6 : 10) + Math.floor(rng() * (hamlet ? 2 : 3)), ry: (hamlet ? 4 : 6) + Math.floor(rng() * (hamlet ? 2 : 3)) };
  const gC = { x: mx + Math.round((rng() - 0.5) * (hamlet ? 2 : 6)), y: my + Math.round((rng() - 0.5) * (hamlet ? 2 : 6)) };
  const ringR = { x: gR.rx + 2.6, y: gR.ry + 2.6 };
  const boxOf = (cx: number, cy: number, rx: number, ry: number): Rect => ({ x0: Math.floor(cx - rx), y0: Math.floor(cy - ry), x1: Math.ceil(cx + rx), y1: Math.ceil(cy + ry) });
  const rects = districtRects(districts, { lo, hiX, hiY, mx, my, big, green: boxOf(gC.x, gC.y, ringR.x + 6, ringR.y + 6), core: boxOf(gC.x, gC.y, ringR.x + 17, ringR.y + 13) });
  const dAt = (x: number, y: number) => districtAt(rects, x, y);
  const ward = rects.find((r) => r.district.kind === "palace" || r.district.kind === "castle");
  const wardKind = ward ? (ward.district.kind === "palace" ? "palace" : "castle") : null;
  let comp: { x: number; y: number; w: number; h: number; gate: { x: number; y: number } } | null = null;
  if (ward && wardKind) {
    const fp = FOOTPRINT[wardKind]!;
    const cw = Math.min(fp.compound!.w, ward.x1 - ward.x0 - 3);
    const ch = Math.min(fp.compound!.h, ward.y1 - ward.y0 - 3);
    const cx = Math.floor((ward.x0 + ward.x1 - cw) / 2) + 1;
    const cy = Math.floor((ward.y0 + ward.y1 - ch) / 2) + 1;
    comp = { x: cx, y: cy, w: cw, h: ch, gate: { x: cx + Math.floor(cw / 2), y: cy + ch - 1 } };
  }

  // ---- The plan ----
  const goals: Record<string, Pt> = {};
  let square: Rect;
  let market: Rect | null = null;
  const hasMarket = (s.buildings.market ?? 0) > 0;
  const plazaSides: Array<{ id: string; kind: string; r: Rect }> = [];
  if (!big) {
    // The green: grass kept open, a well in the middle and trees round the edge; a lane rings it.
    for (let y = gC.y - gR.ry - 1; y <= gC.y + gR.ry + 1; y++) for (let x = gC.x - gR.rx - 1; x <= gC.x + gR.rx + 1; x++) {
      if (((x - gC.x) / (gR.rx + 0.4)) ** 2 + ((y - gC.y) / (gR.ry + 0.4)) ** 2 <= 1) reserved[y * W + x] = 1;
    }
    set(gC.x, gC.y, "water");
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * TAU + 0.2;
      if (rng() < 0.5) set(Math.round(gC.x + (gR.rx - 1) * Math.cos(a)), Math.round(gC.y + (gR.ry - 1) * Math.sin(a)), "tree");
    }
    // The market square (paved, adjoining the ring) on the side away from the road in: east, north or south.
    let plazaAng: number | null = null;
    if (!hamlet) {
      const hx = hasMarket ? 6 : 4;
      const hy = hasMarket ? 4 : 3;
      const side = [0, -Math.PI / 2 * flip, Math.PI / 2 * flip][Math.floor(rng() * 3)]!;
      plazaAng = side;
      const r: Rect = side === 0 ? { x0: Math.round(gC.x + ringR.x), y0: gC.y - hy, x1: Math.round(gC.x + ringR.x) + 2 * hx, y1: gC.y + hy } : Math.sin(side) < 0 ? { x0: gC.x - hx, y0: Math.round(gC.y - ringR.y) - 2 * hy, x1: gC.x + hx, y1: Math.round(gC.y - ringR.y) } : { x0: gC.x - hx, y0: Math.round(gC.y + ringR.y), x1: gC.x + hx, y1: Math.round(gC.y + ringR.y) + 2 * hy };
      pave(r);
      market = r;
      plazaSides.push({ id: "market", kind: "market", r });
    }
    road(loop(rng, gC.x, gC.y, ringR.x, ringR.y, 2, 0.03), "ring", open.lane);
    // The road in from the west bends toward the ring; lanes leave the ring like spokes, curving, some short, some long.
    const ringW = { x: gC.x - ringR.x, y: gC.y };
    const ctrl: Pt[] = [{ x: 1, y: my }, { x: 8, y: my }];
    if (ringW.x > 20) ctrl.push({ x: 14, y: my }, { x: (14 + ringW.x) / 2, y: (my + ringW.y) / 2 + (rng() - 0.5) * 4 });
    ctrl.push(ringW);
    road(smooth(ctrl), "main", open.main, { over: OVER_WALL });
    const spokes = hamlet ? 3 + Math.floor(rng() * 2) : 5 + Math.floor(rng() * 3);
    const turn = rng() * 0.4;
    for (let k = 1; k < spokes; k++) {
      const a = Math.PI + (k * TAU) / spokes + (rng() - 0.5) * 0.45 + turn * (k % 2 ? 1 : -1) * 0.5;
      if (plazaAng !== null && angDiff(a, plazaAng) < 0.5) continue;
      if (eastExit && angDiff(a, 0) < 0.6) continue;
      const start = { x: gC.x + ringR.x * Math.cos(a), y: gC.y + ringR.y * Math.sin(a) };
      const len = hamlet ? 9 + rng() * 8 : 30 + rng() * 20;
      road(march(rng, start, a, len, 0.07, within), "lane", open.lane);
    }
    if (eastExit) {
      const e0 = { x: gC.x + ringR.x + (market && plazaAng === 0 ? 2 * (hasMarket ? 6 : 4) : 0), y: gC.y };
      road(smooth([e0, { x: (e0.x + W - 2) / 2, y: (gC.y + my) / 2 + (rng() - 0.5) * 3 }, { x: W - 2, y: my }]), "lane", open.lane, { over: OVER_WALL });
    }
    // Square zones: the green is the village square; the market is the paved square.
    square = { x0: Math.round(gC.x - gR.rx * 0.6), y0: Math.round(gC.y - gR.ry * 0.6), x1: Math.round(gC.x + gR.rx * 0.6), y1: Math.round(gC.y + gR.ry * 0.6) };
    // Where the leading buildings go: the hall on the green (away from the plaza), the inn toward the road, the temple on the ring.
    const rp = (a: number, out: number): Pt => ({ x: gC.x + (ringR.x + out) * Math.cos(a), y: gC.y + (ringR.y + out) * Math.sin(a) });
    let hallA = -Math.PI / 2 * flip;
    if (plazaAng !== null && angDiff(hallA, plazaAng) < 1) hallA = -hallA;
    let templeA = hallA + 1.1;
    if (plazaAng !== null && angDiff(templeA, plazaAng) < 0.7) templeA = hallA - 1.1;
    const innA = Math.sin(hallA) < 0 ? Math.PI - 0.9 : Math.PI + 0.9;
    goals.hall = rp(hallA, 2.5);
    goals.temple = rp(templeA, 2.5);
    goals.inn = rp(innA, 2.5);
    goals.guildhall = rp(-hallA, 2.5);
    goals.smithy = { x: Math.max(16, gC.x - ringR.x - 12), y: my + 4 * flip };
    goals.far = rp(hallA + Math.PI, 16);
    if (market) goals.market = { x: (market.x0 + market.x1) / 2 + (plazaAng === 0 ? 8 : 0), y: (market.y0 + market.y1) / 2 + (plazaAng === 0 ? 0 : Math.sin(plazaAng!) * 7) };
    // Cross-lanes between the spokes, and a few spurs.
    grow(cv, rng, { kind: "lane", width: open.lane, spacing: hamlet ? [12, 18] : [18, 26], maxLen: hamlet ? 12 : 26, minLen: hamlet ? 5 : 8, deadEnds: true, bend: 0.07, inner, from: (r) => r.kind !== "ring", cap: hamlet ? 3 : 10, skip: (x, y) => ((x - gC.x) / ringR.x) ** 2 + ((y - gC.y) / ringR.y) ** 2 < (hamlet ? 2.2 : 2.6) ** 2 });
    // Back alleys off the lanes, where the farmsteads and cottages crowd.
    grow(cv, rng, { kind: "alley", width: 2, spacing: hamlet ? [9, 13] : [10, 15], maxLen: hamlet ? 8 : 16, minLen: 5, deadEnds: true, bend: 0.06, inner, from: (r) => r.kind === "lane", cap: hamlet ? 3 : 14, clear: 4, skip: (x, y) => ((x - gC.x) / ringR.x) ** 2 + ((y - gC.y) / ringR.y) ** 2 < 2.2 ** 2 });
  } else {
    const pz = open.plaza!;
    square = { x0: mx - pz.hx, y0: my - pz.hy, x1: mx + pz.hx, y1: my + pz.hy };
    pave(square);
    plazaSides.push({ id: "square", kind: "square", r: square });
    // Secondary squares along the main streets: at the gate; a craft square south; the temple or cathedral square north.
    const nSq = (id: string, cx: number, cy: number, hx: number, hy: number) => {
      const r: Rect = { x0: cx - hx, y0: cy - hy, x1: cx + hx, y1: cy + hy };
      pave(r);
      plazaSides.push({ id, kind: "plaza", r });
      return r;
    };
    const gateSq = nSq("plaza_gate", lo + Math.round((mx - lo) * 0.42), my, 5, 3);
    const northSq = s.kind === "town" ? null : nSq("plaza_north", mx, my - Math.round((my - lo) * 0.46), s.kind === "capital" ? 9 : 7, s.kind === "capital" ? 7 : 5);
    const southSq = s.kind === "town" ? null : nSq("plaza_south", mx, my + Math.round((hiY - my) * 0.46), 6, 4);
    const eastSq = s.kind === "capital" ? nSq("plaza_east", mx + Math.round((hiX - mx) * 0.46), my, 6, 4) : null;
    const rrx = (hiX - lo + 1) / 2 - 9;
    const rry = (hiY - lo + 1) / 2 - 9;
    // The main streets: west is the road in (straight, to the exit tile), the others to the gates in the walls and out to the roads.
    const axis = (from: Pt, to: Pt, wig: number): Pt[] => {
      const n = Math.max(1, Math.floor(Math.hypot(to.x - from.x, to.y - from.y) / 12));
      const ctrl: Pt[] = [from];
      const nx = -(to.y - from.y);
      const ny = to.x - from.x;
      const nl = Math.hypot(nx, ny) || 1;
      for (let i = 1; i < n; i++) {
        const p = { x: from.x + ((to.x - from.x) * i) / n, y: from.y + ((to.y - from.y) * i) / n };
        const inside = p.x > w0 - 4 && p.x < w1 + 4 && p.y > v0 - 4 && p.y < v1 + 4;
        const off = inside || !walled ? 0 : (rng() - 0.5) * 2 * wig;
        ctrl.push({ x: p.x + (nx / nl) * off, y: p.y + (ny / nl) * off });
      }
      ctrl.push(to);
      return smooth(ctrl);
    };
    road(line({ x: 1, y: my }, { x: square.x0 - 1, y: my }), "main", open.main, { over: OVER_WALL });
    road(axis({ x: square.x1 + 1, y: my }, { x: W - 2, y: my }, 3), "main", open.main, { over: OVER_WALL });
    road(axis({ x: mx, y: square.y0 - 1 }, { x: mx, y: 1 }, 3), "main", open.main, { over: OVER_WALL });
    road(axis({ x: mx, y: square.y1 + 1 }, { x: mx, y: H - 2 }, 3), "main", open.main, { over: OVER_WALL });
    // A ring road inside the walls; in the big cities a second ring round the middle; boulevards across the corners.
    road(loop(rng, ccx, ccy, rrx, rry, 3.2, 0.025), "ring", open.lane);
    if (s.kind !== "town") road(loop(rng, mx, my, rrx * 0.5, rry * 0.5, 2.6, 0.03), "ring", open.lane);
    const ringPt = (t: number, k = 1): Pt => ({ x: ccx + rrx * k * Math.sign(Math.cos(t)) * Math.abs(Math.cos(t)) ** (2 / 3.2), y: ccy + rry * k * Math.sign(Math.sin(t)) * Math.abs(Math.sin(t)) ** (2 / 3.2) });
    for (const [sx, sy] of [[1, -1], [-1, -1], [1, 1], [-1, 1]] as const) {
      const from = { x: mx + sx * (pz.hx + 1), y: my + sy * (pz.hy + 1) };
      if (sx === 1 && sy === -1 && comp) {
        // The boulevard to the castle's or the palace's gate.
        const g = comp.gate;
        road(smooth([from, { x: (from.x + g.x) / 2 + (rng() - 0.5) * 3, y: (from.y + g.y + 8) / 2 }, { x: g.x, y: g.y + 8 }, { x: g.x, y: g.y + 1 }]), "main", open.main, { over: OVER_WALL });
      } else if (s.kind !== "town") {
        const to = ringPt(Math.atan2(sy * rry, sx * rrx));
        road(smooth([from, { x: (from.x + to.x) / 2 + (rng() - 0.5) * 4, y: (from.y + to.y) / 2 + (rng() - 0.5) * 4 }, to]), "main", open.main);
      }
    }
    // Parks: patches kept open (grass, trees, a pond), the streets bending round them.
    for (let i = 0, tried = 0; i < open.parks && tried < 200; tried++) {
      const pw = 11 + Math.floor(rng() * 4);
      const ph = 8 + Math.floor(rng() * 3);
      const px = lo + 4 + Math.floor(rng() * Math.max(1, hiX - lo - pw - 8));
      const py = lo + 4 + Math.floor(rng() * Math.max(1, hiY - lo - ph - 8));
      let free = true;
      for (let yy = py - 3; yy <= py + ph + 2 && free; yy++) for (let xx = px - 3; xx <= px + pw + 2; xx++) {
        const t = tiles[yy]?.[xx];
        if ((t !== "grass" && t !== "tree") || reserved[yy * W + xx]) { free = false; break; }
      }
      if (!free || rects.some((r) => WALLED.has(r.district.kind) && px + pw > r.x0 - 2 && px < r.x1 + 2 && py + ph > r.y0 - 2 && py < r.y1 + 2)) continue;
      i++;
      const pond = rng() < 0.3;
      for (let yy = py; yy < py + ph; yy++) for (let xx = px; xx < px + pw; xx++) {
        reserved[yy * W + xx] = 1;
        const rim = xx === px || yy === py || xx === px + pw - 1 || yy === py + ph - 1;
        const mid = Math.abs(xx - (px + pw / 2)) < 2 && Math.abs(yy - (py + ph / 2)) < 1.2;
        if (pond && mid) set(xx, yy, "water");
        else if (rim ? rng() < 0.5 && (xx + yy) % 2 === 0 : rng() < 0.08) set(xx, yy, "tree");
        else if (tiles[yy]![xx] === "tree") set(xx, yy, "grass");
      }
    }
    // The central square's well, trees at its corners; the market is its southern half.
    set(mx + 3, my - 3, "water");
    for (const [tx, ty] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) set(mx + tx * (pz.hx - 1), my + ty * (pz.hy - 1), "tree");
    if (hasMarket) market = { x0: mx - pz.hx + 2, y0: my + 1, x1: mx + pz.hx - 2, y1: my + pz.hy - 1 };
    // Where each leading building goes: on the central square (hall north, temple east, market hall south, inns west), the
    // cathedral on its own square, the rest by quarter.
    const cs = (side: "n" | "e" | "s" | "w", off = 0): Pt => (side === "n" ? { x: mx - 2 + off, y: square.y0 - 5 } : side === "s" ? { x: mx + 3 + off, y: square.y1 + 5 } : side === "e" ? { x: square.x1 + 6, y: my + off } : { x: square.x0 - 6, y: my + off });
    goals.hall = cs("n");
    goals.chancellor = cs("s", -4);
    goals.market = cs("s");
    goals.temple = northSq ? { x: (northSq.x0 + northSq.x1) / 2, y: northSq.y0 - 5 } : cs("e", -7);
    goals.cathedral = northSq ? { x: (northSq.x0 + northSq.x1) / 2, y: northSq.y0 - 7 } : cs("e", -7);
    goals.inn0 = cs("w", -7);
    goals.inn1 = cs("w", 7);
    goals.gateInn = { x: (gateSq.x0 + gateSq.x1) / 2, y: gateSq.y0 - 4 };
    void southSq;
    void eastSq;
    // Spurs, so every quarter has a street through it, then lanes and alleys growing off the streets into blocks.
    for (const r of rects) if (r.district.kind !== "palace" && r.district.kind !== "castle") spurTo(cv, { x: Math.round((r.x0 + r.x1) / 2), y: Math.round((r.y0 + r.y1) / 2) }, open.lane);
    const nearPlaza = (x: number, y: number, dx: number, dy: number) => cv.plazas.some((r) => x >= r.x0 - dx && x <= r.x1 + dx && y >= r.y0 - dy && y <= r.y1 + dy);
    const bounds: Rect = { x0: lo + 1, y0: lo + 1, x1: hiX - 1, y1: hiY - 1 };
    grow(cv, rng, { kind: "lane", width: open.lane, spacing: [16, 24], maxLen: 44, minLen: 10, deadEnds: true, bend: 0.05, inner: bounds, from: (r) => r.kind !== "alley", clear: 8, skip: (x, y) => nearPlaza(x, y, 16, 14) });
    grow(cv, rng, { kind: "alley", width: open.alley, spacing: [14, 20], maxLen: 26, minLen: 7, deadEnds: true, bend: 0.05, inner: bounds, from: (r) => r.kind !== "alley", clear: 6, skip: (x, y) => nearPlaza(x, y, 10, 9) });
  }
  // Where folk gather: the square, the market, the fields, the gate.
  zone("square", "square", square.x0, square.y0, square.x1, square.y1);
  if (market) zone("market", "market", market.x0, market.y0, market.x1, market.y1);
  for (const p of plazaSides) if (p.kind === "plaza") zone(p.id, "plaza", p.r.x0, p.r.y0, p.r.x1, p.r.y1);
  const gx = walled ? w0 + 1 : 2;
  zone("gate", "gate", gx, my - 2, gx + 3, my + 2);
  // The fields are outside, in the open country (N26G); inside are only gardens and a pinfold, kept as the "fields" zone.
  const fieldW = big ? 6 : 4;
  const fields = walled ? zone("fields", "fields", lo + 1, hiY - 4, lo + fieldW, hiY - 1) : zone("fields", "fields", 2, H - (big ? 6 : 4), 2 + fieldW, H - 2);
  for (let y = fields.y0; y <= fields.y1; y++) for (let x = fields.x0; x <= fields.x1; x++) if (tiles[y]![x] === "tree") set(x, y, "grass");
  if (s.terrain === "marsh" || s.terrain === "coast") {
    const px = walled ? hiX - 5 : W - 7;
    const py = walled ? hiY - 3 : H - 5;
    for (let y = py; y <= py + 2; y++) for (let x = px; x <= px + 3; x++) if (tiles[y]![x] === "grass") {
      set(x, y, "water");
      reserved[y * W + x] = 1;
    }
  }
  // The ways out: east into the woods (a world without a realm); the west road leads to the realm (travel).
  const exits: Exit[] = [];
  if (realm?.settlements[s.id]) exits.push(exitAt(tiles, 0, my, "realm", "To the open road"));
  else if (areas.includes("woods")) exits.push(exitAt(tiles, W - 1, my, "woods", exitLabel(realm, s, "woods")));
  // The townsfolk who work outside (miners, hunters) still leave by these zones; where they go is the road's (road/commute.ts).
  zone("exit_road", "exit_road", 1, my - 2, 2, my + 2);
  zone("exit_woods", "exit_woods", 1, my - 2, 2, my + 2);
  if (!exits.some((e) => e.x === W - 1)) set(W - 1, my, "tree");

  // ---- Walls round the closed quarters, and the castle or palace compound ----
  const gates: Array<{ x: number; y: number; district: string }> = [];
  const compounds: Building[] = [];
  const doors: Array<{ x: number; y: number; district: string }> = [];
  for (const r of rects) {
    if (!WALLED.has(r.district.kind) || (r.district.kind === "manor" && !big)) continue;
    // A wall a tile inside the quarter's edge, and a gate wherever a street crosses it.
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
      doors.push({ x, y, district });
    } else if (t !== "water" && t !== "door") set(x, y, "wall");
    reserved[y * W + x] = 1;
  }
  // A wide street crosses a wall in one gap with one post: the posts are in the middle of each gap.
  for (const d of doors) {
    if (gates.some((g) => g.district === d.district && Math.abs(g.x - d.x) <= 3 && Math.abs(g.y - d.y) <= 3)) continue;
    const gap = doors.filter((o) => o.district === d.district && Math.abs(o.x - d.x) <= 3 && Math.abs(o.y - d.y) <= 3);
    const mid = gap[Math.floor(gap.length / 2)]!;
    gates.push({ x: mid.x, y: mid.y, district: d.district });
  }
  // The castle (a keep in a walled bailey with a gatehouse) or the palace (a compound of courts), in its own ward.
  if (ward && wardKind && comp) {
    const fp = FOOTPRINT[wardKind]!;
    const { x: cx, y: cy, w: cw, h: ch, gate } = comp;
    for (let y = cy; y < cy + ch; y++) for (let x = cx; x < cx + cw; x++) {
      const edge = x === cx || y === cy || x === cx + cw - 1 || y === cy + ch - 1;
      set(x, y, edge ? "wall" : "path");
      reserved[y * W + x] = 1;
    }
    set(gate.x, gate.y, "door");
    for (let y = gate.y + 1; y <= Math.min(ward.y1 - 1, gate.y + 3); y++) if (tiles[y]![gate.x] === "grass") set(gate.x, y, "path");
    const bw = Math.min(fp.w, cw - 4);
    const bh = Math.min(fp.h, ch - 5);
    const keep: Building = { name: wardKind === "palace" ? "Palace" : "Castle", x: cx + Math.floor((cw - bw) / 2), y: cy + 2, w: bw, h: bh, color: COLORS.palace!, kind: wardKind, front: { x: gate.x, y: cy + 2 + bh }, district: ward.district.id, compound: { x: cx, y: cy, w: cw, h: ch, gate } };
    compounds.push(keep);
  }

  // ---- The buildings ----
  const level = (b: keyof SiteInfo["buildings"]) => s.buildings[b] ?? 0;
  // Buildings at their real size (N26H decision 3: shared town/districts.ts FOOTPRINT); the long side lies along the street.
  const sized = (kind: string, name: string, fpKind = kind): Wanted => {
    const f = FOOTPRINT[fpKind] ?? { w: 4, h: 3 };
    const [w, h] = f.h > f.w ? [f.h, f.w] : [f.w, f.h];
    return { kind, name, w, h };
  };
  const wanted: Wanted[] = [];
  if (!compounds.some((c) => c.kind === "palace")) wanted.push(s.kind === "capital" ? sized("palace", "Palace", "hall") : hamlet ? sized("hall", HALL.hamlet!, "merchant") : sized("hall", HALL[s.kind] ?? "Hall"));
  if (s.kind === "capital") wanted.push(sized("hall", "Lord chancellor's hall"));
  if (s.kind === "capital") wanted.push(sized("temple", "Cathedral", "cathedral"));
  const innNames = [...INNS].sort(() => rng() - 0.5).map((n) => n.replace(/^the /, "").replace(/^./, (c) => c.toUpperCase()));
  const inns = hamlet && level("inn") === 0 ? 0 : Math.max(1, Math.min(4, level("inn") + (big ? 1 : 0)));
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

  // Frontage: along every street and round every square, a building faces the street with a yard and a footpath to its door.
  const built = new Uint8Array(W * H);
  const sb = open.setback;
  const fronts: Front[] = [];
  for (const r of cv.roads) fronts.push(...frontsOf(cv, r));
  cv.plazas.forEach((p, i) => fronts.push(...plazaFronts(i, p)));
  const gapAt = (x: number, y: number) => {
    const k = dAt(x, y)?.kind;
    return big && (k === "slums" || k === "poor_end" || k === "craft" || k === "foreign") ? 1 : open.gap;
  };
  const fits = (x: number, y: number, w: number, h: number, gap: number): boolean => {
    if (x < 2 || y < 2 || x + w - 1 > W - 3 || y + h - 1 > H - 3) return false;
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) {
      const t = tiles[yy]![xx];
      if ((t !== "grass" && t !== "tree") || reserved[yy * W + xx]) return false;
    }
    // A yard's width of open ground between neighbours, and no street, plaza or wall hard against the building.
    for (let yy = Math.max(0, y - gap); yy <= Math.min(H - 1, y + h - 1 + gap); yy++) for (let xx = Math.max(0, x - gap); xx <= Math.min(W - 1, x + w - 1 + gap); xx++) {
      if (built[yy * W + xx]) return false;
      const inside = xx >= x && xx < x + w && yy >= y && yy < y + h;
      const near = xx >= x - 1 && xx < x + w + 1 && yy >= y - 1 && yy < y + h + 1;
      const t = tiles[yy]![xx];
      if (near && !inside && (t === "path" || t === "wall" || t === "door")) return false;
    }
    return true;
  };
  // A lot is usable when the building fits and its yard's footpath runs over open ground to the street.
  const fitsLot = (l: Lot): boolean => fits(l.x, l.y, l.w, l.h, gapAt(l.door.x, l.door.y)) && l.walk.every((p) => { const t = tiles[p.y]?.[p.x]; return (t === "grass" || t === "tree") && !built[p.y * W + p.x]; });
  /** Lots for a building of this size along every front. `jitter`: plots a little irregular (houses), never smaller than the footprint. */
  const lotsFor = (w: number, h: number, jitter = false, around?: { at: Pt; r: number }): Lot[] => {
    const out: Lot[] = [];
    const base: [number, number] = w >= h ? [w, h] : [h, w];
    for (const f of fronts) {
      if (around && Math.abs(f.px - around.at.x) + Math.abs(f.py - around.at.y) > around.r) continue;
      // A curved street leaves the corner of an axis-aligned building closer than its door: try a deeper yard too.
      for (const extra of [0, 1, 2]) {
        let [len, dep] = base;
        if (jitter) {
          if (rng() < 0.3) len++;
          if (rng() < 0.2) dep++;
        }
        const yard = sb + extra;
        const off = len >= 3 ? 1 + Math.floor(rng() * (len - 2)) : Math.floor(rng() * len);
        const front = { x: f.px + f.dx * yard, y: f.py + f.dy * yard };
        const door = { x: f.px + f.dx * (yard + 1), y: f.py + f.dy * (yard + 1) };
        const walk = Array.from({ length: yard }, (_, k) => ({ x: f.px + f.dx * (k + 1), y: f.py + f.dy * (k + 1) }));
        let x: number, y: number, bw: number, bh: number;
        if (f.dx !== 0) {
          bw = dep;
          bh = len;
          y = f.py - off;
          x = f.dx > 0 ? f.px + yard + 1 : f.px - yard - dep;
        } else {
          bw = len;
          bh = dep;
          x = f.px - off;
          y = f.dy > 0 ? f.py + yard + 1 : f.py - yard - dep;
        }
        out.push({ x, y, w: bw, h: bh, door, front, walk, side: f.side, pos: f.pos });
      }
    }
    return out;
  };
  // Lots in the order houses fill them: one side of one street at a time from the middle outward (a little shuffled), front to
  // back, so houses stand at an uneven pitch with their yards between, thick near the centre and thinning toward the edge.
  const fillCentre = big ? { x: mx, y: my } : gC;
  const reach = Math.max(W, H) * 0.07;
  const filling = (lots: Lot[]): Lot[] => {
    const sides = new Map<string, Lot[]>();
    for (const l of lots) (sides.get(l.side) ?? sides.set(l.side, []).get(l.side)!).push(l);
    const ordered = [...sides.entries()].map(([k, v]) => {
      v.sort((p, q) => p.pos - q.pos);
      const mid = v[Math.floor(v.length / 2)]!;
      return { v, r: Math.hypot(mid.front.x - fillCentre.x, (mid.front.y - fillCentre.y) * 1.3) + rng() * reach, k };
    });
    return ordered.sort((p, q) => p.r - q.r).flatMap((o) => o.v);
  };
  const buildings: Building[] = [];
  const place = (b: Wanted, lot: Lot) => {
    put(tiles, buildings, { name: b.name, x: lot.x, y: lot.y, w: lot.w, h: lot.h, color: COLORS[b.kind] ?? COLORS.house!, kind: b.kind, front: lot.front }, lot.door);
    for (const p of lot.walk) set(p.x, p.y, "path");
    for (let y = lot.y; y < lot.y + lot.h; y++) for (let x = lot.x; x < lot.x + lot.w; x++) built[y * W + x] = 1;
  };
  const near = (lot: Lot, at: { x: number; y: number }) => Math.abs(lot.front.x - at.x) + Math.abs(lot.front.y - at.y);
  // Each building goes to its own quarter where the place has it (N26H decision 1), and the leading ones to their squares.
  const HOME_DISTRICT: Record<string, DistrictKind[]> = { manor: ["noble", "manor", "high_street"], temple: ["cathedral", "temple_close"], barracks: ["barracks", "gate"], guildhall: ["guild", "craft"], inn: ["gate", "market", "high_street"], smithy: ["craft", "gate"], market: ["market"], granary: ["craft", "market"], hall: ["market", "high_street", "green"], palace: ["palace", "market"] };
  const centreOf = (kinds: DistrictKind[] | undefined) => {
    const r = kinds?.map((k) => rects.find((x) => x.district.kind === k)).find(Boolean);
    return r ? { x: (r.x0 + r.x1) / 2, y: (r.y0 + r.y1) / 2 } : null;
  };
  let innsPlaced = 0;
  const goalOf = (b: Wanted): { at: Pt; spread: number } => {
    const here = { x: mx, y: my };
    if (!big) {
      const g = b.kind === "hall" ? goals.hall : b.kind === "temple" ? (b.name === "Shrine" ? goals.far : goals.temple) : b.kind === "inn" ? goals.inn : b.kind === "smithy" ? goals.smithy : b.kind === "market" ? goals.market : b.kind === "guildhall" ? goals.guildhall : goals.far;
      return { at: g ?? here, spread: b.kind === "hall" || b.kind === "inn" || b.kind === "temple" ? 0 : 3 };
    }
    if (b.name === "Lord chancellor's hall") return { at: goals.chancellor!, spread: 0 };
    if (b.kind === "hall") return { at: goals.hall!, spread: 0 };
    if (b.name === "Cathedral") return { at: goals.cathedral!, spread: 0 };
    if (b.kind === "temple" && b.name === "Temple") return { at: goals.temple!, spread: 0 };
    if (b.kind === "market") return { at: goals.market!, spread: 0 };
    if (b.kind === "inn") {
      const i = innsPlaced++;
      if (i < 2) return { at: i === 0 ? goals.inn0! : goals.inn1!, spread: 0 };
      if (i === 2) return { at: goals.gateInn!, spread: 2 };
    }
    return { at: centreOf(HOME_DISTRICT[b.kind]) ?? here, spread: b.kind === "manor" ? 6 : 4 };
  };
  for (const b of wanted) {
    const { at, spread } = goalOf(b);
    let lots = lotsFor(b.w, b.h, false, { at, r: 70 }).filter(fitsLot);
    if (lots.length === 0) lots = lotsFor(b.w, b.h).filter(fitsLot);
    if (lots.length === 0) continue;
    lots.sort((p, q) => near(p, at) + rng() * spread - (near(q, at) + rng() * spread));
    place(b, lots[0]!);
  }
  // The compounds (castle, palace) go in before the houses, so the houses a place builds later never move their index.
  for (const c of compounds) {
    buildings.push(c);
    for (let y = c.y; y < c.y + c.h; y++) for (let x = c.x; x < c.x + c.w; x++) set(x, y, "wall");
    set(c.front!.x, c.y + c.h - 1, "door");
  }
  // Houses by the district they stand in (N26H decision 4): hovels in the slums, the poor end and the farmsteads, a craftsman's
  // house over the shop in the craft lanes, a merchant's on the high street, cottages elsewhere; outside the walls, the suburbs
  // are poor.
  let made = 0;
  const styles = ["merchant", "craft", "cottage", "hovel"] as const;
  const styleAt = (l: Lot): (typeof styles)[number] => {
    const d = dAt(l.door.x, l.door.y);
    if (d) return houseStyleOf(d.kind);
    return (l.x * 7 + l.y * 13) % 3 === 0 ? "cottage" : "hovel";
  };
  // Each kind of house fills its own quarters from the middle outward; the kinds take turns by their share of the place.
  const SHARE: Record<(typeof styles)[number], number> = big ? { merchant: 0.22, craft: 0.28, cottage: 0.3, hovel: 0.2 } : { merchant: 0.1, craft: 0.1, cottage: 0.65, hovel: 0.25 };
  const queues = styles.map((st) => ({ st, lots: filling(lotsFor(FOOTPRINT[st]!.w, FOOTPRINT[st]!.h, true).filter((l) => styleAt(l) === st)), i: 0, n: 0 }));
  while (made < houses) {
    const live = queues.filter((q) => q.i < q.lots.length);
    if (live.length === 0) break;
    live.sort((p, q) => (p.n + 1) / SHARE[p.st] - (q.n + 1) / SHARE[q.st]);
    const q = live[0]!;
    const lot = q.lots[q.i++]!;
    if (!fitsLot(lot) || (big && rng() < 0.08)) continue;
    place({ kind: "house", name: "", w: lot.w, h: lot.h }, lot);
    buildings[buildings.length - 1]!.style = q.st;
    q.n++;
    made++;
  }
  // Still short: any house that fits, anywhere (a small place has room to spare; a crowded one builds where it can).
  for (const st of ["hovel", "cottage"] as const) {
    if (made >= houses) break;
    for (const lot of filling(lotsFor(FOOTPRINT[st]!.w, FOOTPRINT[st]!.h, true))) {
      if (made >= houses) break;
      const dk = dAt(lot.door.x, lot.door.y)?.kind;
      if (!fitsLot(lot) || (dk && (WALLED.has(dk) || dk === "noble"))) continue;
      place({ kind: "house", name: "", w: lot.w, h: lot.h }, lot);
      buildings[buildings.length - 1]!.style = st;
      made++;
    }
  }
  // How many more houses would still fit (a place builds more as it grows: its map has room for them from the start).
  let spare = 0;
  if (room > 0) for (const st of ["cottage", "hovel"] as const) for (const lot of lotsFor(FOOTPRINT[st]!.w, FOOTPRINT[st]!.h)) {
    if (spare >= room) break;
    if (fitsLot(lot)) {
      spare++;
      for (let y = lot.y; y < lot.y + lot.h; y++) for (let x = lot.x; x < lot.x + lot.w; x++) built[y * W + x] = 1;
    }
  }
  // Every building knows its district (outside the walls: the poor quarter, or the gate's).
  const outside = districts.find((d) => d.kind === "poor_end" || d.kind === "slums" || d.kind === "farmsteads") ?? districts.find((d) => d.kind === "gate") ?? districts[0]!;
  for (const b of buildings) b.district ??= dAt(b.front?.x ?? b.x, b.front?.y ?? b.y)?.id ?? outside.id;
  // Trees along the main streets, on the grass between the street and the houses (never on a footpath or against a door).
  for (const r of cv.roads) {
    if (r.kind !== "main") continue;
    for (let i = 2; i < r.samples.length - 2; i += 4) for (const sgn of [1, -1]) {
      const sp = r.samples[i]!;
      const nx = -sp.ty * sgn;
      const ny = sp.tx * sgn;
      const [dx, dy] = Math.abs(nx) >= Math.abs(ny) ? [Math.sign(nx), 0] : [0, Math.sign(ny)];
      let px = sp.x;
      let py = sp.y;
      for (let k = 0; k < r.width + 3 && tiles[py + dy]?.[px + dx] === "path"; k++) {
        px += dx;
        py += dy;
      }
      const x = px + dx;
      const y = py + dy;
      if (tiles[y]?.[x] !== "grass" || reserved[y * W + x] || built[y * W + x]) continue;
      let ok = true;
      let paths = 0;
      for (let yy = -1; yy <= 1; yy++) for (let xx = -1; xx <= 1; xx++) {
        const t = tiles[y + yy]?.[x + xx];
        if (t === "door") ok = false;
        if (t === "path" && (xx === 0 || yy === 0) && (xx || yy)) paths++;
      }
      if (ok && paths <= 1) set(x, y, "tree");
    }
  }
  // Orchards at the outskirts of a village or hamlet: rows of fruit trees in a patch of ground clear of everything.
  if (!big) {
    for (let i = 0, tried = 0; i < (hamlet ? 1 : 3) && tried < 80; tried++) {
      const ow = 9 + Math.floor(rng() * 5);
      const oh = 6 + Math.floor(rng() * 3);
      const ox = 4 + Math.floor(rng() * Math.max(1, W - ow - 8));
      const oy = 4 + Math.floor(rng() * Math.max(1, H - oh - 8));
      if (Math.hypot((ox + ow / 2 - gC.x) / 1.4, oy + oh / 2 - gC.y) < (hamlet ? 12 : 20)) continue;
      let free = true;
      for (let yy = oy - 2; yy <= oy + oh + 1 && free; yy++) for (let xx = ox - 2; xx <= ox + ow + 1; xx++) {
        const t = tiles[yy]?.[xx];
        if ((t !== "grass" && t !== "tree") || reserved[yy * W + xx] || built[yy * W + xx]) { free = false; break; }
      }
      if (!free) continue;
      i++;
      for (let yy = oy; yy < oy + oh; yy++) for (let xx = ox; xx < ox + ow; xx++) {
        reserved[yy * W + xx] = 1;
        if ((xx - ox) % 3 === 1 && (yy - oy) % 3 === 1) set(xx, yy, "tree");
      }
    }
  }
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
  const sq: Anchor = { x: big ? mx + 1 : Math.floor((square.x0 + square.x1) / 2) + 1, y: big ? my + 1 : Math.floor((square.y0 + square.y1) / 2) + 1, location: `the square of ${s.name}`, nearby: ["the well", hall ? `the ${hall.building.toLowerCase()}` : "a few stalls", "folk passing"] };
  const placeAnchors: Partial<Record<PlaceId, Anchor>> = {
    square: sq,
    gate: ({ x: gx + 2, y: my - 1, location: `the ${walled ? "gate" : "edge"} of ${s.name}`, nearby: [walled ? "the town gate" : "the road in", "a milestone"] }),
    inn: inn ? ({ x: inn.x, y: inn.y, location: `outside ${inn.building}, the inn of ${s.name}`, nearby: [`${inn.building}'s door`, "a hanging inn sign"] }) : sq,
    forge: smithy ? ({ x: smithy.x, y: smithy.y, location: `the smithy of ${s.name}`, nearby: ["an anvil", "a glowing forge"] }) : sq,
  };
  // Where creatures go in the village: the crowd in the square and on the road in, horses in the paddock by the farms.
  const sqDen = { x0: square.x0, y0: square.y0, x1: square.x1, y1: square.y1 };
  const paddock = { x0: fields.x0, y0: fields.y0, x1: fields.x1, y1: fields.y1 };
  const dens: Record<string, Den> = {
    square: sqDen,
    villager: sqDen,
    gate_road: walled ? { x0: Math.max(1, w0 - 9), y0: my - 2, x1: Math.max(2, w0 - 2), y1: my + 2 } : { x0: 5, y0: my - 2, x1: 10, y1: my + 2 },
    paddock,
    horse: paddock,
  };
  // Each district is a zone too, so the crowd and the player's map know which quarter a tile is in (N26H).
  for (const r of rects) zones.push({ id: r.district.id, kind: `district:${r.district.kind}`, x0: r.x0, y0: r.y0, x1: r.x1, y1: r.y1 });
  return { name: s.name, tiles, buildings, anchors: placeAnchors, fallback: "square", dens, exits, start: { x: walled ? Math.max(PLAYER_START.x, w0 - 3) : PLAYER_START.x, y: my }, zones, districts: rects, gates, short: Math.max(0, houses - made) + Math.max(0, room - spare) };
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
