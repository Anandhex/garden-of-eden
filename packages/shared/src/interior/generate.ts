import { hash2, seedOf } from "../road/noise.js";

/**
 * Interiors (N32 decision 2): the inside of a building, as a pure function of the place, the building's index, its kind
 * and the household's class, trade and wealth. The layout (walls, rooms) comes from the seed and the kind; the
 * furnishing's quality from the wealth band, so a better year brings a better table without moving a wall. A serf's
 * hovel is one room with straw beds round a hearth; a merchant's house has a shop, a parlour with a strongbox and a
 * bedroom; a hall has a great hall, a solar and the servants' quarters.
 */
export const ITILE = { floor: 0, wall: 1, door: 2 } as const;

export const FURNITURE_KINDS = ["bed", "straw", "table", "hearth", "chest", "strongbox", "desk", "shelf", "anvil", "forge", "loom", "altar", "pew", "counter", "barrel", "cell", "throne", "rack", "bench"] as const;
export type FurnitureKind = (typeof FURNITURE_KINDS)[number];

export type RoomKind = "main" | "bed" | "work" | "hall" | "store" | "cell" | "chapel" | "shop";

export interface Furniture {
  id: string;
  kind: FurnitureKind;
  x: number;
  y: number;
  /** The room it stands in. */
  room: string;
  /** 0 poor .. 3 fine. */
  quality: number;
  /** Goods can be kept in it (a chest, a desk, a shelf); `hidden` slots need searching for. */
  slot?: { id: string; hidden: boolean };
}

export interface Interior {
  w: number;
  h: number;
  /** Row by row, `ITILE` kinds. */
  tiles: number[];
  rooms: Array<{ id: string; kind: RoomKind; x: number; y: number; w: number; h: number }>;
  furniture: Furniture[];
  door: { x: number; y: number };
}

/** What the generator needs to know of who lives or works there. */
export interface Household {
  /** The building's kind on the map: house, inn, smithy, temple, hall, palace... */
  kind: string;
  /** A house's style by its people's class (N26H): hovel, cottage, craft, merchant. */
  style?: string;
  /** The household's class (the head's): slave, serf, commoner, artisan, merchant, gentry, noble, royal, clergy. */
  cls?: string;
  /** Their trade, for a workroom (smith, weaver, baker...). */
  trade?: string;
  /** 0 poor .. 3 rich: changes the furnishing, never the layout. */
  wealth: number;
}

interface Plan {
  w: number;
  h: number;
  /** Rooms as [kind, share of the width] left to right; a second row of rooms where `back` is set. */
  rooms: Array<[RoomKind, number]>;
  back?: Array<[RoomKind, number]>;
}

function planOf(h: Household): Plan {
  switch (h.kind) {
    case "inn":
      return { w: 14, h: 10, rooms: [["hall", 0.65], ["store", 0.35]], back: [["bed", 0.34], ["bed", 0.33], ["bed", 0.33]] };
    case "smithy":
      return { w: 10, h: 8, rooms: [["work", 0.7], ["bed", 0.3]] };
    case "temple":
      return { w: 12, h: 14, rooms: [["chapel", 1]] };
    case "hall":
    case "manor":
      return { w: 16, h: 12, rooms: [["hall", 0.6], ["main", 0.4]], back: [["bed", 0.5], ["store", 0.5]] };
    case "palace":
    case "castle":
      return { w: 20, h: 14, rooms: [["hall", 0.6], ["main", 0.4]], back: [["bed", 0.4], ["bed", 0.3], ["store", 0.3]] };
    case "guildhall":
      return { w: 14, h: 10, rooms: [["hall", 0.6], ["main", 0.4]] };
    case "barracks":
      return { w: 14, h: 10, rooms: [["bed", 0.7], ["cell", 0.3]] };
    case "granary":
    case "market":
      return { w: 10, h: 8, rooms: [["store", 1]] };
  }
  switch (h.style) {
    case "hovel":
      return { w: 6, h: 5, rooms: [["main", 1]] };
    case "craft":
      return { w: 10, h: 7, rooms: [["shop", 0.5], ["work", 0.5]], back: [["bed", 1]] };
    case "merchant":
      return { w: 12, h: 9, rooms: [["shop", 0.4], ["main", 0.6]], back: [["bed", 0.6], ["store", 0.4]] };
    default:
      return { w: 8, h: 6, rooms: [["main", 0.65], ["bed", 0.35]] };
  }
}

/** The inside of building `index` of `site`. */
export function interiorOf(seed: number, site: string, index: number, h: Household): Interior {
  const plan = planOf(h);
  const { w, h: H } = plan;
  const tiles = new Array<number>(w * H).fill(ITILE.floor);
  const set = (x: number, y: number, t: number) => {
    if (x >= 0 && y >= 0 && x < w && y < H) tiles[y * w + x] = t;
  };
  for (let x = 0; x < w; x++) (set(x, 0, ITILE.wall), set(x, H - 1, ITILE.wall));
  for (let y = 0; y < H; y++) (set(0, y, ITILE.wall), set(w - 1, y, ITILE.wall));
  const door = { x: Math.floor(w / 2), y: H - 1 };
  set(door.x, door.y, ITILE.door);
  const rooms: Interior["rooms"] = [];
  // The front row of rooms (by the door), and a back row behind a wall.
  const split = plan.back ? Math.floor(H / 2) : 0;
  const row = (list: Array<[RoomKind, number]>, y0: number, y1: number, tag: string) => {
    let x = 1;
    list.forEach(([kind, share], k) => {
      const x1 = k === list.length - 1 ? w - 2 : Math.max(x + 1, x + Math.round((w - 2) * share) - 1);
      rooms.push({ id: `${tag}${k}`, kind, x, y: y0, w: x1 - x + 1, h: y1 - y0 + 1 });
      if (k < list.length - 1) {
        // A partition with a doorway in it.
        for (let y = y0; y <= y1; y++) set(x1 + 1, y, ITILE.wall);
        set(x1 + 1, Math.floor((y0 + y1) / 2), ITILE.floor);
      }
      x = x1 + 2;
    });
  };
  if (plan.back) {
    for (let x = 1; x < w - 1; x++) set(x, split, ITILE.wall);
    set(Math.floor(w / 2), split, ITILE.floor);
    row(plan.back, 1, split - 1, "b");
    row(plan.rooms, split + 1, H - 2, "f");
  } else row(plan.rooms, 1, H - 2, "f");

  const rng = (k: string) => hash2(seed ^ seedOf(`interior|${site}|${index}|${k}`), index, 0);
  const q = Math.max(0, Math.min(3, Math.round(h.wealth)));
  const furniture: Furniture[] = [];
  const taken = new Set<string>([`${door.x},${door.y}`, `${door.x},${door.y - 1}`]);
  const put = (room: Interior["rooms"][number], kind: FurnitureKind, where: "wall" | "middle" | "corner", slot?: { hidden: boolean }) => {
    const spots: Array<[number, number]> = [];
    for (let y = room.y; y < room.y + room.h; y++)
      for (let x = room.x; x < room.x + room.w; x++) {
        const edge = x === room.x || y === room.y || x === room.x + room.w - 1 || y === room.y + room.h - 1;
        const corner = (x === room.x || x === room.x + room.w - 1) && (y === room.y || y === room.y + room.h - 1);
        if (where === "wall" ? edge : where === "corner" ? corner : !edge) spots.push([x, y]);
      }
    const free = spots.filter(([x, y]) => !taken.has(`${x},${y}`) && tiles[y * w + x] === ITILE.floor && !nextToDoorway(tiles, w, H, x, y));
    if (free.length === 0) return;
    const [x, y] = free[rng(`${room.id}|${kind}|${furniture.length}`) % free.length]!;
    taken.add(`${x},${y}`);
    const id = `${kind}:${furniture.length}`;
    furniture.push({ id, kind, x, y, room: room.id, quality: q, ...(slot ? { slot: { id: `${room.id}:${kind}:${furniture.length}`, hidden: slot.hidden } } : {}) });
  };
  const poor = h.cls === "slave" || h.cls === "serf" || h.style === "hovel";
  const rich = h.cls === "noble" || h.cls === "royal" || h.cls === "gentry" || h.style === "merchant";
  for (const room of rooms) {
    switch (room.kind) {
      case "main":
        put(room, "hearth", "wall");
        put(room, "table", "middle");
        put(room, "bench", "middle");
        if (poor) (put(room, "straw", "corner"), put(room, "straw", "corner"));
        put(room, rich ? "strongbox" : "chest", "corner", { hidden: false });
        put(room, "shelf", "wall", { hidden: false });
        // Coin under a floorboard, letters at the back of a drawer: found only by searching.
        put(room, rich ? "desk" : "chest", rich ? "wall" : "corner", { hidden: true });
        break;
      case "bed":
        put(room, poor ? "straw" : "bed", "corner");
        put(room, poor ? "straw" : "bed", "corner");
        put(room, "chest", "wall", { hidden: false });
        if (rich) put(room, "desk", "wall", { hidden: true });
        break;
      case "hall":
        put(room, h.kind === "palace" || h.kind === "castle" ? "throne" : "table", "wall");
        put(room, "table", "middle");
        put(room, "bench", "middle");
        put(room, "hearth", "wall");
        put(room, "desk", "corner", { hidden: true });
        break;
      case "work":
        if (h.kind === "smithy" || h.trade === "smith") (put(room, "forge", "wall"), put(room, "anvil", "middle"));
        else if (h.trade === "weaver" || h.trade === "tailor") put(room, "loom", "middle");
        else put(room, "table", "middle");
        put(room, "rack", "wall", { hidden: false });
        break;
      case "shop":
        put(room, "counter", "middle");
        put(room, "shelf", "wall", { hidden: false });
        put(room, "shelf", "wall", { hidden: false });
        break;
      case "store":
        put(room, "barrel", "corner", { hidden: false });
        put(room, "barrel", "corner");
        put(room, "shelf", "wall", { hidden: false });
        break;
      case "chapel":
        put(room, "altar", "wall");
        for (let k = 0; k < 4; k++) put(room, "pew", "middle");
        put(room, "chest", "corner", { hidden: true });
        break;
      case "cell":
        put(room, "cell", "middle");
        put(room, "straw", "corner");
        break;
    }
  }
  return { w, h: H, tiles, rooms, furniture, door };
}

function nextToDoorway(tiles: number[], w: number, h: number, x: number, y: number): boolean {
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
    const nx = x + dx;
    const ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
    // A gap in a partition: a floor tile with walls on both sides along one axis.
    const t = tiles[ny * w + nx]!;
    if (t === ITILE.door) return true;
    if (t === ITILE.floor) {
      const wallsH = (tiles[ny * w + nx - 1] === ITILE.wall && tiles[ny * w + nx + 1] === ITILE.wall);
      const wallsV = ny > 0 && ny < h - 1 && tiles[(ny - 1) * w + nx] === ITILE.wall && tiles[(ny + 1) * w + nx] === ITILE.wall;
      if (wallsH || wallsV) return true;
    }
  }
  return false;
}

/** Can a walker stand on a tile of an interior (floor or the door, no furniture)? */
export function interiorWalkable(int: Interior, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= int.w || y >= int.h) return false;
  const t = int.tiles[y * int.w + x]!;
  if (t === ITILE.wall) return false;
  return !int.furniture.some((f) => f.x === x && f.y === y);
}

/** The spot where someone doing something stands or lies: asleep in a bed, eating at the table, at work at the forge. */
export function spotFor(int: Interior, doing: string, k: number): { x: number; y: number } {
  const want: FurnitureKind[] = /asleep/.test(doing) ? ["bed", "straw"] : /eat|meal|dining/.test(doing) ? ["table", "bench"] : /work|forge|loom|baking|at the|toiling/.test(doing) ? ["anvil", "forge", "loom", "counter", "table"] : ["hearth", "bench", "table"];
  const f = int.furniture.filter((x) => want.includes(x.kind));
  const at = f[k % Math.max(1, f.length)] ?? int.furniture[k % Math.max(1, int.furniture.length)];
  if (!at) return { x: Math.floor(int.w / 2), y: Math.floor(int.h / 2) };
  // Beside it on the floor (a bed is lain in: on it).
  if (at.kind === "bed" || at.kind === "straw") return { x: at.x, y: at.y };
  for (const [dx, dy] of [[0, 1], [1, 0], [-1, 0], [0, -1]] as const) if (interiorWalkable(int, at.x + dx, at.y + dy)) return { x: at.x + dx, y: at.y + dy };
  return { x: at.x, y: at.y };
}
