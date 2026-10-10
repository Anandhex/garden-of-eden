/**
 * The village of Millbrook as a tile map. Built in code (not a string grid) so a
 * miscounted row can't shift a wall. NPCs stand at fixed spots; the player walks.
 */
export type Tile = "grass" | "path" | "water" | "tree" | "wall" | "door";

export interface Building {
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
}

export interface NpcSpot {
  x: number;
  y: number;
  /** Colour of the NPC's sprite. */
  color: string;
  /** What the NPC's prompt says about where the conversation happens. */
  location: string;
  nearby: string[];
}

export const MAP_W = 26;
export const MAP_H = 18;
export const PLAYER_START = { x: 12, y: 9 };
/** How close (in tiles, straight line) the player must be to talk. */
export const TALK_RANGE = 1.5;
/** Game minutes one step takes. */
export const MINUTES_PER_STEP = 1;

export const BUILDINGS: Building[] = [
  { name: "Gate", x: 1, y: 7, w: 2, h: 2, color: "#7a7f87" },
  { name: "Gate", x: 1, y: 10, w: 2, h: 2, color: "#7a7f87" },
  { name: "Forge", x: 16, y: 4, w: 5, h: 3, color: "#8a4b3a" },
  { name: "Gilded Goose", x: 5, y: 12, w: 6, h: 4, color: "#a9742f" },
];

export const NPC_SPOTS: Record<string, NpcSpot> = {
  hale: {
    x: 4,
    y: 8,
    color: "#5b7fb5",
    location: "the gate of Millbrook",
    nearby: ["the village gate", "a worn dirt road", "a bored-looking mule"],
  },
  pell: {
    x: 8,
    y: 10,
    color: "#b5833f",
    location: "outside the Gilded Goose inn",
    nearby: ["the Gilded Goose door", "a hanging inn sign", "a rain barrel"],
  },
  brena: {
    x: 18,
    y: 8,
    color: "#b5503f",
    location: "Millbrook forge",
    nearby: ["anvil", "glowing forge", "rack of tools", "a stray dog"],
  },
};

/** Where each kind of creature roams (inclusive tile rectangles). Creatures never leave their area. */
export const CREATURE_DENS: Record<string, { x0: number; y0: number; x1: number; y1: number; color: string }> = {
  wolf: { x0: 15, y0: 12, x1: 23, y1: 16, color: "#8a8f96" },
  bandit: { x0: 8, y0: 1, x1: 16, y1: 2, color: "#5a4636" },
  horse: { x0: 2, y0: 12, x1: 4, y1: 16, color: "#8b5a2b" },
};

function build() {
  const tiles: Tile[][] = Array.from({ length: MAP_H }, () => Array<Tile>(MAP_W).fill("grass"));
  const set = (x: number, y: number, t: Tile) => {
    if (tiles[y]?.[x] !== undefined) tiles[y]![x] = t;
  };
  // Border forest and a pond.
  for (let x = 0; x < MAP_W; x++) {
    set(x, 0, "tree");
    set(x, MAP_H - 1, "tree");
  }
  for (let y = 0; y < MAP_H; y++) {
    set(0, y, y === 9 ? "path" : "tree");
    set(MAP_W - 1, y, y === 9 ? "path" : "tree");
  }
  for (let y = 2; y <= 5; y++) for (let x = 21; x <= 24; x++) set(x, y, "water");
  // A few scattered trees.
  for (const [x, y] of [[3, 3], [5, 2], [9, 3], [14, 2], [23, 12], [22, 15], [3, 15], [14, 15], [20, 13], [6, 5]] as const) set(x, y, "tree");
  // Roads: east-west through the gate, north-south through the crossroads.
  for (let x = 0; x < MAP_W; x++) set(x, 9, "path");
  for (let y = 3; y < MAP_H - 1; y++) set(12, y, "path");
  // Buildings, with doors on the side facing a road.
  for (const b of BUILDINGS) for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) set(x, y, "wall");
  set(18, 6, "door"); // forge, south side
  set(8, 12, "door"); // inn, north side
  for (const [x, y] of [[18, 7], [18, 8], [8, 11], [8, 10], [9, 10]] as const) set(x, y, "path");
  return tiles;
}

export const TILES: Tile[][] = build();

export function isSolid(x: number, y: number): boolean {
  const t = TILES[y]?.[x];
  return t === undefined || t === "tree" || t === "wall" || t === "water";
}

export function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
