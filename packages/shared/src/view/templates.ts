/**
 * Building templates (G6): how a generated building is dressed, the same for the server and every adapter. The
 * templates are Tiled maps (art/tiled/templates/*.tmj) that `npm run art` reads into templates.json. A template
 * stretches to any building like a 9-slice (its edge rows and columns kept, its middle repeated), so one house
 * template fits a 3×2 cottage and a 5×4 manor. Templates only dress: the map's tiles (walls, the door) and so where
 * anyone can walk are the town generator's, never a template's.
 */
import data from "./templates.json" with { type: "json" };

export interface TemplateObject {
  art?: string;
  kind?: string;
  x: number;
  y: number;
  layer?: "roof" | "walls";
  anchor?: "door" | "grid";
}

export interface BuildingTemplate {
  kinds: string[];
  w: number;
  h: number;
  slice: { left: number; right: number; top: number; bottom: number };
  roofTint: boolean;
  roof: Array<Array<string | null>>;
  walls: Array<Array<string | null>>;
  door: string;
  porch: string;
  doorAt: { x: number; y: number };
  props: TemplateObject[];
  lights: TemplateObject[];
}

export const TEMPLATES = data.templates as Record<string, BuildingTemplate>;
/** Template ids by building kind (and the pseudo-kinds named buildings get: fire, tent, cart, loot, heap, hut). */
export const TEMPLATE_KINDS = data.kinds as Record<string, string[]>;
/** Each window tile and the lit-window frame drawn over it. */
export const WINDOW_TILES = data.windows as Record<string, string>;
export const TEMPLATE_IDS = Object.keys(TEMPLATES);

const NAMED: Array<[RegExp, string]> = [
  [/\bfire\b/i, "fire"],
  [/\btent\b/i, "tent"],
  [/\bcart\b/i, "cart"],
  [/\bloot\b/i, "loot"],
  [/\b(heap|spoil)\b/i, "heap"],
];

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/**
 * The template a building wears: by kind, or for the localities' unkinded things (a camp's fire and tents, a cart, a
 * spoil heap) by name; a kind with several picks one by a stable hash of `key` (map and building), so a town looks
 * the same on every visit.
 */
export function templateFor(kind: string | undefined, name: string, key: string): string {
  const k = kind ?? NAMED.find(([re]) => re.test(name))?.[1] ?? "hut";
  const list = TEMPLATE_KINDS[k] ?? TEMPLATE_KINDS.house!;
  return list[hash(key) % list.length]!;
}

/** Which source row or column each of `n` target ones takes: `head` and `tail` kept, the middle repeated. */
export function sliceAxis(n: number, len: number, head: number, tail: number): number[] {
  const out: number[] = [];
  if (n >= head + tail) {
    const mid = len - head - tail;
    for (let i = 0; i < head; i++) out.push(i);
    // With no middle to repeat, the first of the tail repeats (a camp's one row of fire, stretched).
    for (let i = 0; i < n - head - tail; i++) out.push(mid > 0 ? head + (i % mid) : tail > 0 ? len - tail : Math.max(0, head - 1));
    for (let i = len - tail; i < len; i++) out.push(i);
  } else {
    const keep = Math.max(0, n - tail);
    for (let i = 0; i < keep; i++) out.push(i);
    for (let i = len - Math.min(tail, n); i < len; i++) out.push(i);
  }
  return out;
}

/** Where a template coordinate lands on the stretched axis (the first target that took its source, else the nearest). */
function place(at: number, axis: number[]): number {
  const c = Math.floor(at);
  let j = axis.indexOf(c);
  if (j < 0) j = axis.reduce((best, s, i) => (Math.abs(s - c) < Math.abs(axis[best]! - c) ? i : best), 0);
  return j + (at - c);
}

export interface Dressed {
  /** Tiles at whole world tiles (x, y the tile's top-left). Roof tiles start a row above the building. */
  roof: Array<{ frame: string; x: number; y: number }>;
  walls: Array<{ frame: string; x: number; y: number }>;
  /** A frame standing at (x, y) (its foot), on the roof or against the front wall. */
  props: Array<{ frame: string; x: number; y: number; layer: "roof" | "walls" }>;
  lights: Array<{ kind: string; x: number; y: number }>;
  windows: Array<{ x: number; y: number; glow: string }>;
  /** The door's tile and whether it is in the front wall (else it gets a porch over the roof). */
  door: { x: number; y: number; front: boolean } | null;
}

export interface BuildingBox {
  x: number;
  y: number;
  w: number;
  h: number;
  door?: { x: number; y: number } | null;
}

/** A building dressed in a template: every tile, prop, light and window, in world tiles. */
export function dress(t: BuildingTemplate, b: BuildingBox): Dressed {
  const cols = sliceAxis(b.w, t.w, t.slice.left, t.slice.right);
  // The template's first row is the roof's ridge, standing on the row behind the building.
  const rows = sliceAxis(b.h + 1, t.h, t.slice.top, t.slice.bottom);
  const y0 = b.y - 1;
  const out: Dressed = { roof: [], walls: [], props: [], lights: [], windows: [], door: null };
  const front = b.y + b.h - 1;
  const door = b.door ? { x: b.door.x, y: b.door.y, front: b.door.y === front } : null;
  out.door = door;
  rows.forEach((sr, j) =>
    cols.forEach((sc, i) => {
      const x = b.x + i;
      const y = y0 + j;
      const r = t.roof[sr]?.[sc];
      if (r) out.roof.push({ frame: r, x, y });
      let w = t.walls[sr]?.[sc];
      if (door?.front && x === door.x && y === door.y && w !== undefined) w = t.door;
      if (w) {
        out.walls.push({ frame: w, x, y });
        const glow = WINDOW_TILES[w];
        if (glow) out.windows.push({ x: x + 0.5, y: y + 0.4, glow });
      }
    }),
  );
  // A door where a window was: the window moves along the wall (the middle first), so a lit house always shows it.
  const displaced = door?.front ? t.walls[rows[door.y - y0]!]?.[cols[door.x - b.x]!] : undefined;
  if (displaced && WINDOW_TILES[displaced] && !out.windows.length) {
    const spot = [...out.walls].sort((p, q) => edge(p.x) - edge(q.x)).find((w) => w.y === door!.y && w.x !== door!.x && !WINDOW_TILES[w.frame]);
    if (spot) {
      spot.frame = displaced;
      out.windows.push({ x: spot.x + 0.5, y: spot.y + 0.4, glow: WINDOW_TILES[displaced]! });
    }
  }
  function edge(x: number): number {
    return x === b.x || x === b.x + b.w - 1 ? 1 : 0;
  }
  const at = (o: TemplateObject) => {
    const x = o.anchor === "door" && door ? door.x + (o.x - (t.doorAt.x + 0.5)) + 0.5 : b.x + place(o.x, cols);
    return { x, y: y0 + place(o.y, rows) };
  };
  for (const p of t.props) {
    if (!p.art) continue;
    const { x, y } = at(p);
    // Nothing leans on the front wall where the door is.
    if ((p.layer ?? "walls") === "walls" && door?.front && Math.floor(x) === door.x && Math.floor(y - 0.01) === door.y && p.anchor !== "door") continue;
    if (x < b.x || x > b.x + b.w) continue;
    out.props.push({ frame: p.art, x, y, layer: p.layer ?? "walls" });
  }
  for (const l of t.lights) {
    const { x, y } = at(l);
    if (x < b.x || x > b.x + b.w) continue;
    out.lights.push({ kind: l.kind ?? "lamp", x, y });
  }
  return out;
}
