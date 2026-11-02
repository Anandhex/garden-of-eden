/**
 * What every map shares (N15): tiles, buildings, spots, sizes and ranges. The maps
 * themselves are made in code by web/sites.ts: every settlement's village, and the
 * localities around each (the road, a gang's camp, a dungeon's mouth, the woods),
 * seeded so a place looks the same on every visit.
 */
export type Tile = "grass" | "path" | "water" | "tree" | "wall" | "door";

export interface Building {
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  /** What it is (N16): "house", "manor", "inn", "smithy", "hall", "temple", "market", "palace"... */
  kind?: string;
  /** The tile outside its door, where people come and go (N16). */
  front?: { x: number; y: number };
  /** The district it stands in (N26H): `d:<kind>`. */
  district?: string;
  /** A house's kind by its people's class (N26H): hovel, cottage, craft (house and shop), merchant. */
  style?: string;
  /** A compound (N26H): its outer wall and the gate in it (a post), for a castle, a palace or a manor. */
  compound?: { x: number; y: number; w: number; h: number; gate: { x: number; y: number } };
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

/** Where creatures of a kind (or of a spawn rule's place) roam: an inclusive tile rectangle. */
export interface Den {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Size of the localities' maps (the woods, the road, the camp, the mine) and of a hamlet. Bigger places have bigger maps (web/sites.ts VILLAGE_SIZE). */
export const MAP_W = 26;
export const MAP_H = 18;
/** Where a new game starts: by the west gate of the start town's village (generated maps keep the gate road on row 9). */
export const PLAYER_START = { x: 3, y: 9 };
/** How close (in tiles, straight line) the player must be to talk. */
export const TALK_RANGE = 1.5;
/** Game minutes one step takes. */
export const MINUTES_PER_STEP = 1;
/** Game minutes the walk between two areas takes (village → mine road, mine road → camp). */
export const AREA_WALK_MINUTES = 15;

/** Sprite colours for people: a seeded pick from these by their id, so everyone is recognisable and the same every time. */
export const SPRITE_COLORS = ["#7a9b57", "#a0607a", "#5f8f9b", "#b59a3f", "#8a6fb5", "#6b8f6b", "#b5763f", "#4f6fa0", "#b5503f", "#5b7fb5", "#c9734f", "#d9a441"];

/** A person's sprite colour, from their id. */
export function spriteColor(id: string): string {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return SPRITE_COLORS[h % SPRITE_COLORS.length]!;
}

/** Sprite colour by creature kind (others take their den's). */
export const CREATURE_COLORS: Record<string, string> = {
  wolf: "#8a8f96",
  bandit: "#5a4636",
  horse: "#8b5a2b",
  villager: "#c9b48a",
  // The beasts of other places' woods (N15).
  bear: "#5b3a24",
  boar: "#7a5a40",
  spider: "#3a3a46",
  // Light wildlife by the road (N26F).
  deer: "#a0703c",
  hare: "#9c8a6a",
  fox: "#c4622d",
  crow: "#26262c",
  heron: "#9aa4ad",
  adder: "#5c5a32",
};

export function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
