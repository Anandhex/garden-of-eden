/**
 * What every map shares (N15): tiles, buildings, spots, sizes and ranges. The maps
 * themselves are made in code by web/sites.ts: Millbrook's village like every other
 * settlement's, and the localities around each (the mine road, the bandit camp, the
 * old mine, the woods), seeded so a place looks the same on every visit.
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
/** Where a new game starts: by the west gate of Millbrook's village (generated maps keep the gate road on row 9). */
export const PLAYER_START = { x: 3, y: 9 };
/** How close (in tiles, straight line) the player must be to talk. */
export const TALK_RANGE = 1.5;
/** Game minutes one step takes. */
export const MINUTES_PER_STEP = 1;
/** Game minutes the walk between two areas takes (village → mine road, mine road → camp). */
export const AREA_WALK_MINUTES = 15;

/**
 * The authored cast's looks on the map and the words for their own spot. Where they
 * stand comes from the generated map (their workplace's spot); these only keep each
 * of them recognisable and their prompts as written.
 */
export const NPC_LOOKS: Record<string, { color: string; nearby: string[] }> = {
  hale: { color: "#5b7fb5", nearby: ["the village gate", "a worn dirt road", "a bored-looking mule"] },
  pell: { color: "#b5833f", nearby: ["the Gilded Goose door", "a hanging inn sign", "a rain barrel"] },
  rook: { color: "#3d3228", nearby: ["a smouldering campfire", "a stolen ore cart", "his men watching from the trees"] },
  brena: { color: "#b5503f", nearby: ["anvil", "glowing forge", "rack of tools", "a stray dog"] },
  // Brena's apprentice: only in the world once she takes over the forge (game/succession.ts).
  wren: { color: "#c9734f", nearby: ["anvil", "the forge, banked low", "rack of tools", "Brena's old apron on a hook"] },
  // The errand girl (N11.2): about the square all day.
  pip: { color: "#d9a441", nearby: ["the well", "market stalls", "a dog nosing for scraps"] },
};

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
};

export function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
