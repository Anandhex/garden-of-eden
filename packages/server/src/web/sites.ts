import { seedFrom, seededRng, type Rng } from "../game/dice.js";
import { HOME_ID } from "../game/realm/generate.js";
import type { Realm, Settlement } from "../game/realm/types.js";
import { AREAS, type AreaId, PLACE_NAMES, PLACE_NEARBY, type PlaceId } from "../game/schedule.js";
import type { CrowdZone } from "@millbrook/shared";
import { type Building, type Den, MAP_H, MAP_W, NPC_LOOKS, type NpcSpot, PLAYER_START, type Tile } from "./map.js";

/**
 * A map for every place and what's around it (N14, N15). Every settlement's village
 * is made in code from what's built there, Millbrook's included: roads through the
 * middle, walls with gates if it has them, its hall, inn, smithy, market, temple,
 * guild hall, barracks and granary, houses by its size, and a paddock by the farms.
 *
 * What isn't the village isn't on the village's map. Each settlement has localities
 * around it, each its own map, reached by walking off the edge of the one before:
 * - **the woods** (east of every village): beasts and game;
 * - **the road** (north, where there's anything up it): to
 *   - **the camp** of a gang seated there (Millbrook: Rook's, on the mine road), and
 *   - **the mine**, the mouth of a dungeon nearby (Millbrook: the Old Mine Deeps).
 *
 * Creatures roam dens on the map of their area (a den key is a creature kind or a
 * spawn rule's place), and NPCs stand at the places on the map they're on. All of
 * it is seeded by the place's id, so it looks the same on every visit.
 */
export interface Exit {
  /** The edge tile you step onto to leave. */
  x: number;
  y: number;
  to: AreaId;
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

/** What a map is made from: a settlement (a realm one, or Millbrook's own when there's no realm). */
export type SiteInfo = Pick<Settlement, "id" | "name" | "kind" | "buildings" | "terrain" | "population">;

/** Millbrook as the realm makes it (realm/generate.ts), for worlds without a realm. */
export const MILLBROOK_INFO: SiteInfo = {
  id: HOME_ID,
  name: "Millbrook",
  kind: "village",
  buildings: { farms: 1, inn: 1, smithy: 1, walls: 0, mine: 1 },
  terrain: "valley",
  population: 180,
};

/** Every den key Millbrook's maps have, for checking spawn rules (src/data/spawns.json). */
export const DEN_KEYS = ["villager", "village_square", "west_road", "horse", "wolf", "deep_woods", "forest_edge", "bandit", "road_ambush", "bandit_camp", "mine_mouth"] as const;

/** Colour of a den's creatures when their kind has none (map.ts CREATURE_COLORS). */
export const DEN_COLORS: Record<string, string> = {
  village_square: "#c9b48a",
  west_road: "#c9b48a",
  forest_edge: "#8a8f96",
  deep_woods: "#8a8f96",
  road_ambush: "#6b3b2a",
  bandit_camp: "#5a4636",
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
}

/** The localities a settlement has: the woods always; the road when a camp or a mine is up it. */
export function areasOf(realm: Realm | null | undefined, site: string): AreaId[] {
  if (site === HOME_ID) return [...AREAS];
  if (!realm) return ["village", "woods"];
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
  if (s.id === HOME_ID && area !== "village") return { x: 0, y: 0, name: cap(PLACE_NAMES[area]), location: PLACE_NAMES[area], nearby: PLACE_NEARBY[area] };
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
export function siteMap(s: SiteInfo, area: AreaId = "village", realm?: Realm | null): SiteMap {
  const areas = areasOf(realm, s.id);
  const at: AreaId = areas.includes(area) ? area : "village";
  const extra = at === "camp" ? (realm ? gangAt(realm, s.id)?.name : "") : at === "mine" ? (realm ? dungeonAt(realm, s.id)?.name : "") : "";
  const key = `${s.id}:${at}:${s.kind}:${JSON.stringify(s.buildings)}:${areas.join(",")}:${extra ?? ""}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const rng = seededRng(seedFrom(`${s.id}:${at}`));
  const layout = at === "village" ? village(s, areas, realm, rng) : at === "road" ? road(s, areas, realm, rng) : at === "camp" ? camp(s, realm, rng) : at === "mine" ? mine(s, realm, rng) : woods(s, realm, rng);
  const made = finish(s, at, layout);
  cache.set(key, made);
  return made;
}


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
function exitAt(tiles: Tile[][], x: number, y: number, to: AreaId, label: string): Exit {
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
  hamlet: { w: 26, h: 18 },
  village: { w: 34, h: 24 },
  town: { w: 50, h: 34 },
  city: { w: 72, h: 48 },
  capital: { w: 96, h: 64 },
};
/** People to a house, by kind of place (cottages in a hamlet, crowded tenements in a city). */
const PER_HOUSE: Record<string, number> = { hamlet: 4, village: 5, town: 8, city: 11, capital: 13 };
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

function village(s: SiteInfo, areas: AreaId[], realm: Realm | null | undefined, rng: Rng): Layout {
  const home = s.id === HOME_ID;
  const size = VILLAGE_SIZE[s.kind] ?? VILLAGE_SIZE.village!;
  const W = size.w;
  const H = size.h;
  const big = W >= 46;
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
    for (let r = my - 7; r >= lo + 3; r -= 7) rows.push(r);
    for (let r = my + 7; r <= hiY - 3; r += 7) rows.push(r);
    for (let c = mx - 10; c >= lo + 4; c -= 10) cols.push(c);
    for (let c = mx + 10; c <= hiX - 4; c += 10) cols.push(c);
    rows.push(lo, hiY);
    cols.push(lo, hiX);
    for (const r of rows) for (let x = lo; x <= hiX; x++) set(x, r, "path");
    for (const c of cols) for (let y = lo; y <= hiY; y++) set(c, y, "path");
  }
  // Where folk gather: the square (a paved plaza in a town), the market, the fields, the gate.
  const square = big ? zone("square", "square", mx - 4, my - 3, mx + 4, my + 3, true) : zone("square", "square", mx + 1, my + 1, mx + 5, my + 2);
  if (big) set(mx + 2, my - 2, "water"); // the well
  const market = (s.buildings.market ?? 0) > 0 ? (big ? zone("market", "market", mx + 6, my - 2, mx + 9, my + 2, true) : zone("market", "market", mx - 6, my + 1, mx - 2, my + 2)) : null;
  const gx = walled ? 3 : 2;
  zone("gate", "gate", gx, my - 1, gx + 3, my + 1);
  const fieldW = big ? Math.max(8, Math.floor(W / 5)) : 9;
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
  if (areas.includes("road")) {
    exits.push(exitAt(tiles, mx, 0, "road", exitLabel(realm, s, "road")));
    zone("exit_road", "exit_road", mx - 1, 1, mx + 1, 2);
  }
  if (areas.includes("woods")) {
    exits.push(exitAt(tiles, W - 1, my, "woods", exitLabel(realm, s, "woods")));
    zone("exit_woods", "exit_woods", W - 3, my - 1, W - 2, my + 1);
  } else set(W - 1, my, "tree");

  // What's built here, most important first; houses fill the rest by size. Millbrook's keep their names.
  const level = (b: keyof SiteInfo["buildings"]) => s.buildings[b] ?? 0;
  const sized = (kind: string, name: string, w = 4, h = 3): Wanted => ({ kind, name, w, h });
  const wanted: Wanted[] = [];
  wanted.push(s.kind === "capital" ? sized("palace", "Palace", 7, 4) : sized("hall", HALL[s.kind] ?? "Hall", big ? 5 : 4));
  if (s.kind === "capital") wanted.push(sized("hall", "Lord chancellor's hall", 5));
  const innNames = [...INNS].sort(() => rng() - 0.5).map((n) => n.replace(/^the /, "").replace(/^./, (c) => c.toUpperCase()));
  const inns = s.kind === "hamlet" && level("inn") === 0 ? 0 : Math.max(1, Math.min(4, level("inn") + (big ? 1 : 0)));
  for (let i = 0; i < inns; i++) wanted.push(sized("inn", home && i === 0 ? "Gilded Goose" : innNames[i % innNames.length]!));
  for (let i = 0; i < Math.min(3, level("smithy")); i++) wanted.push(sized("smithy", home && i === 0 ? "Forge" : i === 0 ? "Smithy" : "Smithy"));
  if (market) wanted.push(sized("market", "Market hall", big ? 5 : 4));
  if (level("temple") > 0) wanted.push(sized("temple", "Temple", big ? 5 : 4));
  if (level("temple") >= 3) wanted.push(sized("temple", "Shrine", 4, 3));
  if (level("guildhall") > 0) wanted.push(sized("guildhall", "Guild hall"));
  if (level("barracks") > 0) wanted.push(sized("barracks", "Barracks", big ? 5 : 4));
  if (level("granary") > 0) wanted.push(sized("granary", "Granary"));
  for (let i = 0; i < (MANORS[s.kind] ?? 0); i++) wanted.push(sized("manor", "Manor", 5, 3));
  const houseW = big ? 4 : 3;
  const houseH = W >= 70 ? 3 : 2;
  const houses = Math.max(2, Math.ceil(s.population / (PER_HOUSE[s.kind] ?? 5)));

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
  for (const b of wanted) {
    const goal = b.kind === "market" && market ? { x: (market.x0 + market.x1) / 2, y: (market.y0 + market.y1) / 2 } : { x: mx, y: my };
    const spread = b.kind === "manor" ? 14 : b.kind === "palace" || b.kind === "hall" ? 0 : 4;
    const lots = lotsFor(b.w, b.h).filter((l) => fits(l.x, l.y, l.w, l.h));
    if (lots.length === 0) continue;
    lots.sort((p, q) => near(p, goal) + rng() * spread - (near(q, goal) + rng() * spread));
    place(b, lots[0]!);
  }
  let made = 0;
  const houseLots = lotsFor(houseW, houseH).sort(() => rng() - 0.5);
  for (const lot of houseLots) {
    if (made >= houses) break;
    if (!fits(lot.x, lot.y, lot.w, lot.h)) continue;
    place({ kind: "house", name: "", w: houseW, h: houseH }, lot);
    made++;
  }
  // Small places with room to spare: cottages along the lanes too.
  if (made < houses && !big) {
    for (const lot of lotsFor(3, 2).sort(() => rng() - 0.5)) {
      if (made >= houses) break;
      if (!fits(lot.x, lot.y, lot.w, lot.h)) continue;
      place({ kind: "house", name: "", w: 3, h: 2 }, lot);
      made++;
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
  const words = (place: PlaceId, fallback: Anchor): Anchor => (home ? { ...fallback, location: PLACE_NAMES[place], nearby: PLACE_NEARBY[place] } : fallback);
  const sq = words("square", { x: big ? mx + 1 : mx + 2, y: my + 1, location: `the square of ${s.name}`, nearby: ["the well", hall ? `the ${hall.building.toLowerCase()}` : "a few stalls", "folk passing"] });
  const placeAnchors: Partial<Record<PlaceId, Anchor>> = {
    square: sq,
    gate: words("gate", { x: walled ? 4 : 3, y: my - 1, location: `the ${walled ? "gate" : "edge"} of ${s.name}`, nearby: [walled ? "the town gate" : "the road in", "a milestone"] }),
    inn: inn ? words("inn", { x: inn.x, y: inn.y, location: `outside ${inn.building}, the inn of ${s.name}`, nearby: [`${inn.building}'s door`, "a hanging inn sign"] }) : sq,
    forge: smithy ? words("forge", { x: smithy.x, y: smithy.y, location: `the smithy of ${s.name}`, nearby: ["an anvil", "a glowing forge"] }) : sq,
  };
  // Where creatures go in the village: the crowd in the square and on the road in, horses in the paddock by the farms.
  const sqDen = { x0: square.x0, y0: square.y0, x1: square.x1, y1: square.y1 };
  const dens: Record<string, Den> = {
    village_square: sqDen,
    villager: sqDen,
    west_road: { x0: 5, y0: my - 1, x1: 10, y1: my + 1 },
    horse: { x0: fields.x0, y0: fields.y0, x1: fields.x1, y1: fields.y1 },
  };
  return { name: s.name, tiles, buildings, anchors: placeAnchors, fallback: "square", dens, exits, start: { x: PLAYER_START.x, y: my }, zones };
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
  const exits: Exit[] = [exitAt(tiles, 12, MAP_H - 1, "village", exitLabel(realm, s, "village"))];
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
  const home = s.id === HOME_ID;
  put(tiles, buildings, { name: home ? "Rook's tent" : "Chief's tent", x: 14, y: 4, w: 4, h: 2, color: "#6b4a3a" });
  put(tiles, buildings, { name: "Tent", x: 8, y: 4, w: 3, h: 2, color: "#7a5a40" });
  put(tiles, buildings, { name: "Tent", x: 8, y: 13, w: 3, h: 2, color: "#7a5a40" });
  put(tiles, buildings, { name: home ? "Stolen carts" : "Loot", x: 16, y: 13, w: 3, h: 1, color: "#8a6a3a" });
  put(tiles, buildings, { name: "Fire", x: 13, y: 9, w: 1, h: 1, color: "#d9772b" });
  // The clearing stays open; the woods close in around it.
  forest(tiles, rng, 0.6, 1, (x, y) => x >= 6 && x <= 21 && y >= 3 && y <= 15);
  const w = areaWords(realm, s, "camp");
  return {
    name: w.name,
    tiles,
    buildings,
    anchors: { camp: { x: 14, y: 8, location: home ? "the bandit camp at the north end of the mine road" : w.location, nearby: w.nearby } },
    fallback: "camp",
    dens: { bandit_camp: { x0: 9, y0: 7, x1: 19, y1: 11 } },
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
  const exits = [exitAt(tiles, 0, 9, "village", exitLabel(realm, s, "village"))];
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
    dens: { wolf: { x0: 12, y0: 3, x1: 22, y1: 14 }, deep_woods: { x0: 12, y0: 3, x1: 22, y1: 14 }, forest_edge: { x0: 1, y0: 7, x1: 6, y1: 11 } },
    exits,
    start: { x: 1, y: 9 },
  };
}

// ---- Spots ----

const SPOT_COLORS = ["#7a9b57", "#a0607a", "#5f8f9b", "#b59a3f", "#8a6fb5", "#6b8f6b", "#b5763f", "#4f6fa0"];

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
  const home = s.id === HOME_ID;
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
      let h = 0;
      for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
      const looks = home ? NPC_LOOKS[id] : undefined;
      return { ...at, color: looks?.color ?? SPOT_COLORS[h % SPOT_COLORS.length]!, location: anchor.location, nearby: looks?.nearby ?? anchor.nearby };
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
export const exitTo = (map: SiteMap, to: AreaId): Exit | undefined => map.exits.find((e) => e.to === to);

/** The exit the player is standing on, if any. */
export const exitUnder = (map: SiteMap, pos: { x: number; y: number }): Exit | undefined => map.exits.find((e) => e.x === pos.x && e.y === pos.y);

/** Millbrook's village, for worlds without a realm (and tests). */
export const MILLBROOK: SiteMap = siteMap(MILLBROOK_INFO);
