/**
 * What the road world is made of (N26). The server makes `RoadData` once from the realm (game/road/generateRoads.ts)
 * and sends it to the browser; both then make every chunk from it with `chunkAt`, so a stretch of road is
 * the same every time and on both sides. Coordinates are global tiles (`TILES_PER_UNIT` per realm map unit).
 */

/** The kinds of tile on the road. The numbers are what a chunk holds. */
export const Ground = {
  grass: 0,
  tree: 1,
  rock: 2,
  reeds: 3,
  water: 4,
  sand: 5,
  road: 6,
  bridge: 7,
  ford: 8,
  field: 9,
  hill: 10,
  marsh: 11,
  town: 12,
  wall: 13,
  milestone: 14,
  signpost: 15,
  shrine: 16,
  farmhouse: 17,
  yard: 18,
  bar: 19,
  gate: 20,
  thatch: 21,
} as const;
export type GroundKind = (typeof Ground)[keyof typeof Ground];

/** A tile a walker can't enter. */
const SOLID = new Set<number>([Ground.tree, Ground.rock, Ground.water, Ground.wall, Ground.milestone, Ground.signpost, Ground.shrine, Ground.farmhouse, Ground.bar, Ground.thatch]);
export const isSolidGround = (g: number): boolean => SOLID.has(g);

/** Names of tiles for hover text. */
export const GROUND_NAMES: Record<number, string> = {
  [Ground.grass]: "grass",
  [Ground.tree]: "trees",
  [Ground.rock]: "rocks",
  [Ground.reeds]: "reeds",
  [Ground.water]: "water",
  [Ground.sand]: "sand",
  [Ground.road]: "the road",
  [Ground.bridge]: "a bridge",
  [Ground.ford]: "a ford",
  [Ground.field]: "a field",
  [Ground.hill]: "rough hill",
  [Ground.marsh]: "marsh",
  [Ground.town]: "a town",
  [Ground.wall]: "a wall",
  [Ground.milestone]: "a milestone",
  [Ground.signpost]: "a signpost",
  [Ground.shrine]: "a shrine",
  [Ground.farmhouse]: "a farmhouse",
  [Ground.yard]: "a farmyard",
  [Ground.bar]: "a toll bar",
  [Ground.gate]: "a gate",
  [Ground.thatch]: "a roof",
};

export interface RoadPoint {
  x: number;
  y: number;
}

/** A settlement's footprint on the global grid: a block of tiles with a gate for each road. */
export interface Footprint {
  /** The settlement's id. */
  id: string;
  name: string;
  kind: string;
  terrain: string;
  /** Inclusive tile rectangle. */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Where each road meets it, by road id: the gate tile on its border. */
  gates: Record<string, RoadPoint>;
  /** Walled or not (towns and cities are). */
  walled: boolean;
}

/** One road between two places (a realm road, bent to the land). */
export interface RoadPath {
  /** "a~b", the ids in order. */
  id: string;
  a: string;
  b: string;
  /** A main road is wide, with a bridge over rivers; a lane is narrow, with fords. */
  main: boolean;
  /** Points from a's gate to b's gate. */
  pts: RoadPoint[];
  /** Length in tiles. */
  length: number;
}

export interface RiverPath {
  id: string;
  name: string;
  /** Half the width, in tiles. */
  half: number;
  pts: RoadPoint[];
}

export interface Crossing {
  id: string;
  kind: "bridge" | "ford" | "ferry";
  road: string;
  river: string;
  at: RoadPoint;
  /** Distance along the road, in tiles. */
  t: number;
  /** A keeper who takes a toll, by name; none at a plain ford. */
  keeper?: string;
  toll?: number;
}

export type PlaceKind = "waystation" | "farmstead" | "shrine" | "milestone" | "signpost" | "tollgate" | "bridge" | "ferry";

/** Something beside the road. */
export interface RoadPlace {
  id: string;
  kind: PlaceKind;
  name: string;
  /** The road it is on, and how far along it (tiles from a's gate). */
  road: string;
  t: number;
  /** The tile at the heart of it: the door, the stone, the bar. */
  at: RoadPoint;
  /** The road tile beside it (where the road is nearest). */
  on: RoadPoint;
  /** For a waystation: the settlement (hamlet) id whose map is its inn. */
  site?: string;
  /** A toll in copper. */
  toll?: number;
  /** The kingdom whose border it marks, for a toll gate. */
  kingdom?: string;
}

/** A settlement's terrain, as the land around it. */
export interface Anchor {
  x: number;
  y: number;
  terrain: string;
}

export interface RoadData {
  seed: number;
  footprints: Footprint[];
  roads: RoadPath[];
  rivers: RiverPath[];
  crossings: Crossing[];
  places: RoadPlace[];
  anchors: Anchor[];
}

export const emptyRoadData = (seed = 0): RoadData => ({ seed, footprints: [], roads: [], rivers: [], crossings: [], places: [], anchors: [] });
