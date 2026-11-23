/**
 * A building as a 3D mass (G7), worked out without Three.js so a test can check it. The template (shared
 * templates.ts) still decides how it is dressed: the front wall row gives the lower band of every wall (the door
 * and windows on the front), the roof rows give the slopes of a gable roof along the front. The box stands a little
 * inset in the building's rectangle; a template with no roof (a camp's fire, a cart) stands its tiles up as sprites.
 * Also here: stepping someone in a doorway out of the box, and whether a building hides the player from the camera.
 *
 * With a regional style (G8, shared architecture.ts) the same template is built in the place's own way: its wall and
 * roof tiles swapped to the style's materials, the walls as tall as the style says, the roof hipped, flat or round
 * (a yurt) as well as gabled, at the style's pitch and with its eaves, and the whole raised on a footing or stilts.
 */
import { restyleDoor, restyleFrame, sliceAxis, WINDOW_TILES, type BuildShape, type BuildingTemplate, type Dressed, type RoofForm } from "@millbrook/shared/view";
import { FRAMES } from "../art.js";
import { PITCH } from "./camera.js";

/** How far the box stands in from the building's rectangle, each side (tiles). */
export const INSET = 0.2;
/** Wall height: the template's row below, a plain band above (a person is 1¼ tiles). */
export const WALL_H = 2;
/** A building with no template: a plain block this high. */
export const PLAIN_H = 1.5;
/** The roof's rise over half the box's depth, and how far it overhangs the walls. */
export const ROOF_PITCH = 0.75;
export const OVERHANG = 0.18;

export type FaceName = "front" | "back" | "left" | "right";

/**
 * One wall: its bottom-left corner as seen from outside, the ground direction it runs to the viewer's right, its
 * length, and its frames by column, left to right as seen from outside, for the lower band and the upper.
 */
export interface Face {
  name: FaceName;
  bl: { x: number; z: number };
  dir: { x: number; z: number };
  /** The way the face looks (out of the box). */
  normal: { x: number; z: number };
  width: number;
  lower: string[];
  upper: string[];
}

export interface Box {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  /** The tallest point: the ridge (or the block's top). */
  top: number;
}

export interface Massing {
  kind: "box" | "standing" | "plain";
  box: Box;
  /** The walls' height, the roof's form and its eaves (the defaults without a style). */
  wallH: number;
  form: RoofForm;
  overhang: number;
  /** How far the floor stands above its pad: a footing showing (`plinth`) plus any stilts. */
  lift: number;
  plinth: number;
  style: BuildShape | null;
  faces: Face[];
  /** Gable roof slopes: frames by row (ridge first, eave last) and column (left to right seen from the front). */
  roof: { rows: string[][]; ridge: number; eave: number; tint: boolean; gable: string } | null;
  /** Flat art on a wall (a sign, a wall lamp, a forge's mouth): where its foot is, on which face. */
  decals: Array<{ frame: string; face: FaceName; x: number; z: number; y: number }>;
  /** Sprites standing on the ground or the roof (an anvil, a chimney, a camp's fire). */
  standing: Array<{ frame: string; x: number; z: number; y: number }>;
  /** Window panes that glow when the server says the window is lit: id as the frame's light id. */
  windows: Array<{ id: string; glow: string; x: number; z: number; y: number }>;
}

export interface BuildingIn {
  id: number | string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The frame of a wall that is neither a window nor a door: the template's middle wall piece. */
function plainOf(t: BuildingTemplate, row: string[]): string {
  const mid = row.find((f) => f.endsWith("_m") && !WINDOW_TILES[f]) ?? row.find((f) => !WINDOW_TILES[f] && f !== t.door) ?? row[0] ?? t.door;
  return mid;
}

/** Plan a building's mass from its template and how the template dressed it. */
export function massing(b: BuildingIn, template: BuildingTemplate | undefined, given: Dressed | null, style: BuildShape | null = null): Massing {
  const box: Box = { x0: b.x + INSET, x1: b.x + b.w - INSET, z0: b.y + INSET, z1: b.y + b.h - INSET, top: PLAIN_H };
  const out: Massing = { kind: "plain", box, faces: [], roof: null, decals: [], standing: [], windows: [], wallH: WALL_H, form: "gable", overhang: OVERHANG, lift: 0, plinth: 0, style: null };
  if (!template || !given) return out;
  // The style's materials: the same template, its wall and roof tiles (and its door) swapped.
  const { t, dressed } = restyled(template, given, style);
  const front = b.y + b.h - 1;
  if (dressed.roof.length === 0) {
    // Nothing to roof: every tile the template stands is a sprite on its tile.
    out.kind = "standing";
    box.top = 1;
    for (const w of dressed.walls) out.standing.push({ frame: w.frame, x: w.x + 0.5, z: w.y + 0.5, y: 0 });
    for (const p of dressed.props) out.standing.push({ frame: p.frame, x: p.x, z: Math.min(p.y, front + 1) - 0.01, y: 0 });
    return out;
  }
  out.kind = "box";
  const wallH = style?.wallH ?? WALL_H;
  out.style = style;
  out.wallH = wallH;
  out.form = style?.form ?? "gable";
  out.overhang = style?.overhang ?? OVERHANG;
  out.plinth = style?.plinth ?? 0;
  out.lift = out.plinth + (style?.stilts ?? 0);
  // The front wall's row, left to right; the door goes on whichever wall it is in.
  const row = dressed.walls.filter((w) => w.y === front).sort((p, q) => p.x - q.x).map((w) => w.frame);
  const lowerFront = row.length === b.w ? row : Array.from({ length: b.w }, (_, i) => row[Math.min(row.length - 1, i)] ?? t.door);
  const plain = plainOf(t, lowerFront);
  const edgeL = lowerFront[0]!;
  const edgeR = lowerFront[lowerFront.length - 1]!;
  const noDoor = (f: string) => (f === t.door ? plain : f);
  const upperFront = lowerFront.map(noDoor);
  // The side walls and gables take the material's own side art (G7 Part B), when it has some.
  const material = plain.endsWith("_m") ? plain.slice(0, -2) : null;
  const own = (part: string) => (material && FRAMES[`${material}_${part}`] ? `${material}_${part}` : plain);
  const sidePiece = own("side");
  const side = (n: number) => Array.from({ length: n }, (_, i) => (i === 0 && n > 1 ? edgeL : i === n - 1 && n > 1 ? edgeR : sidePiece));
  const door = dressed.door;
  const w = box.x1 - box.x0;
  const d = box.z1 - box.z0;
  // Front (looking south, +z): left to right is +x. Back: −x. Left wall (looking west): +z. Right wall: −z.
  const back = [...lowerFront].reverse().map(noDoor);
  const left = side(b.h);
  const right = side(b.h);
  if (door && !door.front) {
    if (door.y === b.y) back[b.x + b.w - 1 - door.x] = t.door;
    else if (door.x === b.x) left[door.y - b.y] = t.door;
    else if (door.x === b.x + b.w - 1) right[b.y + b.h - 1 - door.y] = t.door;
  }
  out.faces = [
    { name: "front", bl: { x: box.x0, z: box.z1 }, dir: { x: 1, z: 0 }, normal: { x: 0, z: 1 }, width: w, lower: lowerFront, upper: upperFront },
    { name: "back", bl: { x: box.x1, z: box.z0 }, dir: { x: -1, z: 0 }, normal: { x: 0, z: -1 }, width: w, lower: back, upper: [...upperFront].reverse() },
    { name: "left", bl: { x: box.x0, z: box.z0 }, dir: { x: 0, z: 1 }, normal: { x: -1, z: 0 }, width: d, lower: left, upper: side(b.h) },
    { name: "right", bl: { x: box.x1, z: box.z1 }, dir: { x: 0, z: -1 }, normal: { x: 1, z: 0 }, width: d, lower: right, upper: side(b.h) },
  ];
  // The roof: the template's roof rows (ridge, middle, eave) stretched to the building like G6's 9-slice.
  const roofRows = t.roof.filter((r) => r.some(Boolean));
  const cols = sliceAxis(b.w, t.w, t.slice.left, t.slice.right);
  const pick = (r: Array<string | null>) => cols.map((c) => r[c] ?? r.find(Boolean) ?? plain);
  const n = Math.max(2, Math.ceil(b.h / 2));
  const rows: string[][] = [];
  for (let i = 0; i < n; i++) {
    const src = i === 0 ? roofRows[0]! : i === n - 1 ? roofRows[roofRows.length - 1]! : (roofRows[Math.min(roofRows.length - 2, 1)] ?? roofRows[0]!);
    rows.push(pick(src));
  }
  // A ground floor in another material than the storey above: the lower band of every wall swapped to it.
  if (style?.base && style.walls) {
    const lower = { ...style, walls: style.base };
    for (const f of out.faces) f.lower = f.lower.map((fr) => (fr === t.door ? restyleDoor(fr, lower) : restyleFrame(fr, lower)));
  }
  // A round roof (a yurt's cone) rises over its radius; a flat one not at all, its parapet a little over the walls.
  const rise = out.form === "flat" ? 0 : out.form === "round" ? (Math.min(w, d) / 2) * (style?.pitch ?? ROOF_PITCH) : (d / 2) * (style?.pitch ?? ROOF_PITCH);
  out.roof = { rows, ridge: wallH + rise, eave: wallH, tint: t.roofTint, gable: own("gable") };
  box.top = wallH + Math.max(rise, out.form === "flat" ? PARAPET : 0);
  // The front wall's window panes, both bands.
  lowerFront.forEach((f, i) => {
    const glow = WINDOW_TILES[f];
    if (!glow || out.form === "round") return;
    const x = box.x0 + ((i + 0.5) / b.w) * w;
    const k = dressed.windows.findIndex((win) => Math.floor(win.x) === b.x + i);
    const id = `win:${b.id}:${k < 0 ? i : k}`;
    out.windows.push({ id, glow, x, z: box.z1, y: 0.55 * (wallH / WALL_H) });
    out.windows.push({ id, glow, x, z: box.z1, y: 1.55 * (wallH / WALL_H) });
  });
  // Props: on the roof they stand on its slope; against the front wall they hang on it, or stand before it.
  const ridgeY = b.y - 1;
  for (const p of dressed.props) {
    const x = box.x0 + ((p.x - b.x) / b.w) * w;
    if (p.layer === "roof") {
      // A yurt has a smoke hole, not a chimney.
      if (out.form === "round") continue;
      const k = Math.max(0, Math.min(1, (p.y - ridgeY) / Math.max(1, front - ridgeY)));
      out.standing.push({ frame: p.frame, x, z: (box.z0 + box.z1) / 2 + (k * d) / 2, y: out.roof.ridge - k * rise - 0.05 });
      continue;
    }
    const up = front + 1 - p.y;
    if (up > 0.1 || p.frame.startsWith("buildings/")) out.decals.push({ frame: p.frame, face: "front", x, z: box.z1, y: Math.max(0, up) });
    else out.standing.push({ frame: p.frame, x, z: box.z1 + 0.3, y: 0 });
  }
  return out;
}

/** A flat roof's parapet over the walls. */
export const PARAPET = 0.22;

/** A template and its dressing in a style's materials (unchanged without one). */
function restyled(t: BuildingTemplate, dressed: Dressed, style: BuildShape | null): { t: BuildingTemplate; dressed: Dressed } {
  if (!style) return { t, dressed };
  const door = restyleDoor(t.door, style);
  const tile = (f: string) => (f === t.door ? door : restyleFrame(f, style));
  return {
    t: { ...t, door, walls: t.walls.map((r) => r.map((f) => (f ? tile(f) : f))), roof: t.roof.map((r) => r.map((f) => (f ? restyleFrame(f, style) : f))) },
    dressed: { ...dressed, walls: dressed.walls.map((w) => ({ ...w, frame: tile(w.frame) })), roof: dressed.roof.map((r) => ({ ...r, frame: restyleFrame(r.frame, style) })) },
  };
}

/**
 * Where to draw someone whose tile is inside a box (a doorway, mid-step through a wall): just outside the nearest
 * face. Drawing only; the tile is the server's. Returns the point unchanged when it is outside every box.
 */
export function nudgeOut(boxes: Iterable<Box>, x: number, z: number, margin = 0.14): { x: number; z: number } {
  for (const b of boxes) {
    if (x <= b.x0 - margin || x >= b.x1 + margin || z <= b.z0 - margin || z >= b.z1 + margin) continue;
    const gaps = [
      { d: x - (b.x0 - margin), x: b.x0 - margin, z },
      { d: b.x1 + margin - x, x: b.x1 + margin, z },
      { d: z - (b.z0 - margin), x, z: b.z0 - margin },
      { d: b.z1 + margin - z, x, z: b.z1 + margin },
    ];
    // The front first when it's as near: that's where doors are.
    gaps.sort((p, q) => p.d - q.d || (q.z > p.z ? 1 : -1));
    return { x: gaps[0]!.x, z: gaps[0]!.z };
  }
  return { x, z };
}

/**
 * Does this box stand between the camera (at `yaw`, looking down at PITCH) and a point on the ground? Walk the
 * ground towards the camera from the point; the box hides it if the sight line enters the box lower than its top.
 */
export function hides(box: Box, yaw: number, at: { x: number; z: number }, height = 0.6): boolean {
  if (at.x > box.x0 && at.x < box.x1 && at.z > box.z0 && at.z < box.z1) return false;
  const dx = Math.sin(yaw);
  const dz = Math.cos(yaw);
  // The slab method: the stretch of the ray inside the box's footprint.
  let t0 = 0;
  let t1 = Infinity;
  for (const [p, v, lo, hi] of [
    [at.x, dx, box.x0, box.x1],
    [at.z, dz, box.z0, box.z1],
  ] as const) {
    if (Math.abs(v) < 1e-9) {
      if (p < lo || p > hi) return false;
      continue;
    }
    const a = (lo - p) / v;
    const c = (hi - p) / v;
    t0 = Math.max(t0, Math.min(a, c));
    t1 = Math.min(t1, Math.max(a, c));
  }
  if (t0 > t1) return false;
  return height + t0 * Math.tan(PITCH) < box.top;
}
