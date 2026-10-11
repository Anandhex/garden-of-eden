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
  rook: {
    x: 16,
    y: 2,
    color: "#3d3228",
    location: "the bandit camp at the north end of the mine road",
    nearby: ["a smouldering campfire", "a stolen ore cart", "his men watching from the trees"],
  },
  brena: {
    x: 18,
    y: 8,
    color: "#b5503f",
    location: "Millbrook forge",
    nearby: ["anvil", "glowing forge", "rack of tools", "a stray dog"],
  },
  // Brena's apprentice: only in the world once she takes over the forge (game/succession.ts).
  wren: {
    x: 20,
    y: 8,
    color: "#c9734f",
    location: "Millbrook forge",
    nearby: ["anvil", "the forge, banked low", "rack of tools", "Brena's old apron on a hook"],
  },
  // The errand girl (N11.2): about the square all day.
  pip: {
    x: 11,
    y: 12,
    color: "#d9a441",
    location: "the village square",
    nearby: ["the well", "market stalls", "a dog nosing for scraps"],
  },
};

/**
 * Where each NPC stands at each place they go (N6 schedules). Their own spot (NPC_SPOTS)
 * is where they work; these are the others. "home" isn't on the map: they're indoors.
 */
export const PLACE_SPOTS: Record<string, Record<string, { x: number; y: number }>> = {
  forge: { brena: { x: 18, y: 8 }, pell: { x: 17, y: 8 }, hale: { x: 19, y: 8 }, rook: { x: 19, y: 7 }, wren: { x: 20, y: 8 }, pip: { x: 17, y: 10 } },
  inn: { pell: { x: 8, y: 10 }, brena: { x: 9, y: 11 }, hale: { x: 7, y: 10 }, rook: { x: 10, y: 10 }, wren: { x: 10, y: 11 }, pip: { x: 7, y: 11 } },
  gate: { hale: { x: 4, y: 8 }, brena: { x: 4, y: 10 }, pell: { x: 5, y: 8 }, rook: { x: 5, y: 10 }, wren: { x: 3, y: 8 }, pip: { x: 3, y: 10 } },
  square: { brena: { x: 11, y: 10 }, pell: { x: 11, y: 11 }, hale: { x: 10, y: 11 }, rook: { x: 11, y: 8 }, wren: { x: 10, y: 10 }, pip: { x: 11, y: 12 } },
  camp: { rook: { x: 16, y: 2 }, brena: { x: 17, y: 3 }, pell: { x: 15, y: 3 }, hale: { x: 18, y: 3 }, wren: { x: 17, y: 2 }, pip: { x: 16, y: 3 } },
};

/** Where each place is centred, for NPCs with no authored spot (generated or born in play). */
const PLACE_ANCHORS: Record<string, { x: number; y: number; location: string; nearby: string[] }> = {
  forge: { x: 18, y: 8, location: "Millbrook forge", nearby: ["anvil", "glowing forge", "rack of tools"] },
  inn: { x: 9, y: 10, location: "outside the Gilded Goose inn", nearby: ["the Gilded Goose door", "a hanging inn sign"] },
  square: { x: 13, y: 11, location: "the village square", nearby: ["the well", "market stalls", "villagers passing"] },
  gate: { x: 4, y: 9, location: "the gate of Millbrook", nearby: ["the village gate", "a worn dirt road"] },
  camp: { x: 17, y: 3, location: "the bandit camp on the mine road", nearby: ["a smouldering campfire"] },
};
const SPOT_COLORS = ["#7a9b57", "#a0607a", "#5f8f9b", "#b59a3f", "#8a6fb5", "#6b8f6b", "#b5763f", "#4f6fa0"];
/** Spots handed out to NPCs with no authored one, by place then id. Stable for a session. */
const extraSpots: Record<string, Record<string, { x: number; y: number }>> = {};

function taken(place: string, x: number, y: number): boolean {
  if (Object.values(PLACE_SPOTS[place] ?? {}).some((p) => p.x === x && p.y === y)) return true;
  if (Object.values(NPC_SPOTS).some((p) => p.x === x && p.y === y)) return true;
  return Object.values(extraSpots[place] ?? {}).some((p) => p.x === x && p.y === y);
}

/**
 * Where an NPC stands at a place: their authored spot there, or (for an NPC made from a
 * template or born in play) the nearest free open tile to the place's centre.
 */
export function spotAt(place: string, id: string): { x: number; y: number } | null {
  const authored = PLACE_SPOTS[place]?.[id];
  if (authored) return authored;
  const anchor = PLACE_ANCHORS[place];
  if (!anchor) return null;
  const mine = extraSpots[place]?.[id];
  if (mine) return mine;
  for (let r = 1; r <= 4; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = anchor.x + dx;
        const y = anchor.y + dy;
        if (isSolid(x, y) || TILES[y]?.[x] === "door" || taken(place, x, y)) continue;
        return ((extraSpots[place] ??= {})[id] = { x, y });
      }
    }
  }
  return null;
}

/** An NPC's own spot (where they work): authored, or made from their workplace. */
export function npcSpot(id: string, workplace: string): NpcSpot {
  const authored = NPC_SPOTS[id];
  if (authored) return authored;
  const anchor = PLACE_ANCHORS[workplace] ?? PLACE_ANCHORS.square!;
  const at = spotAt(workplace, id) ?? { x: anchor.x, y: anchor.y };
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return { ...at, color: SPOT_COLORS[h % SPOT_COLORS.length]!, location: anchor.location, nearby: anchor.nearby };
}

/** The place a tile belongs to, for the player's location: the nearest place spot within reach, else the square. */
export function placeAtTile(pos: { x: number; y: number }): string {
  let best = { place: "square", d: Infinity };
  for (const [place, spots] of Object.entries(PLACE_SPOTS)) {
    for (const spot of Object.values(spots)) {
      const d = Math.hypot(pos.x - spot.x, pos.y - spot.y);
      if (d < best.d) best = { place, d };
    }
  }
  return best.d <= 4 ? best.place : "square";
}

/** Where each kind of creature roams (inclusive tile rectangles). Creatures never leave their area. */
export const CREATURE_DENS: Record<string, { x0: number; y0: number; x1: number; y1: number; color: string }> = {
  wolf: { x0: 15, y0: 12, x1: 23, y1: 16, color: "#8a8f96" },
  bandit: { x0: 8, y0: 1, x1: 16, y1: 2, color: "#5a4636" },
  horse: { x0: 2, y0: 12, x1: 4, y1: 16, color: "#8b5a2b" },
  // Places spawn rules can put creatures (src/data/spawns.json), on top of each kind's own den.
  villager: { x0: 13, y0: 10, x1: 15, y1: 12, color: "#c9b48a" },
  village_square: { x0: 13, y0: 10, x1: 15, y1: 12, color: "#c9b48a" },
  bandit_camp: { x0: 14, y0: 1, x1: 19, y1: 3, color: "#5a4636" },
  forest_edge: { x0: 20, y0: 10, x1: 23, y1: 11, color: "#8a8f96" },
  // Where hired men lie in wait for the player (director/revenge.ts): by the north road.
  road_ambush: { x0: 11, y0: 4, x1: 13, y1: 7, color: "#6b3b2a" },
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
