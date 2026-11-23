import type { Rng } from "../game/dice.js";
import type { Tile } from "./map.js";

/**
 * Streets for the settlement maps: curved or straight lines drawn onto the tile grid at a width, with the frontage they
 * leave (where a building can stand, facing the street, with a yard and a footpath), and a way of growing side lanes and
 * alleys off the streets already there. Everything is seeded by the caller's `rng`.
 */
export interface Pt {
  x: number;
  y: number;
}

/** A street once drawn: its centre-line, tile by tile with the direction of travel, and its width. */
export interface Road {
  id: number;
  kind: "main" | "ring" | "lane" | "alley" | "spur";
  width: number;
  samples: Array<{ x: number; y: number; tx: number; ty: number }>;
}

export interface Canvas {
  W: number;
  H: number;
  tiles: Tile[][];
  /** Tiles kept free of streets and buildings (greens, plazas, parks, zones). */
  reserved: Uint8Array;
  roads: Road[];
  /** Plazas and squares, whose edges are frontage too. */
  plazas: Rect[];
}

export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/** A smooth curve through the points (Catmull-Rom), as dense points a half tile apart. */
export function smooth(ctrl: Pt[]): Pt[] {
  if (ctrl.length < 3) return line(ctrl[0]!, ctrl[ctrl.length - 1]!);
  const out: Pt[] = [];
  const at = (i: number) => ctrl[clamp(i, 0, ctrl.length - 1)]!;
  for (let i = 0; i < ctrl.length - 1; i++) {
    const [p0, p1, p2, p3] = [at(i - 1), at(i), at(i + 1), at(i + 2)];
    const n = Math.max(2, Math.ceil(Math.hypot(p2.x - p1.x, p2.y - p1.y) * 2));
    for (let k = 0; k < n; k++) {
      const t = k / n;
      const t2 = t * t;
      const t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push({ x: f(p0.x, p1.x, p2.x, p3.x), y: f(p0.y, p1.y, p2.y, p3.y) });
    }
  }
  out.push({ ...ctrl[ctrl.length - 1]! });
  return out;
}

/** A straight line as dense points. */
export function line(a: Pt, b: Pt): Pt[] {
  const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) * 2));
  return Array.from({ length: n + 1 }, (_, i) => ({ x: a.x + ((b.x - a.x) * i) / n, y: a.y + ((b.y - a.y) * i) / n }));
}

/** A closed loop round (cx, cy): an ellipse for exp 2, a rounded rectangle as it grows, with a little irregularity. */
export function loop(rng: Rng, cx: number, cy: number, rx: number, ry: number, exp = 2, wobble = 0.04): Pt[] {
  const n = Math.max(48, Math.ceil(Math.PI * (rx + ry)));
  const ph = [rng() * 6.28, rng() * 6.28, rng() * 6.28];
  const out: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * Math.PI * 2;
    const c = Math.cos(t);
    const s = Math.sin(t);
    const k = 1 + wobble * (Math.sin(2 * t + ph[0]!) + 0.6 * Math.sin(3 * t + ph[1]!) + 0.4 * Math.sin(5 * t + ph[2]!));
    out.push({ x: cx + rx * k * Math.sign(c) * Math.abs(c) ** (2 / exp), y: cy + ry * k * Math.sign(s) * Math.abs(s) ** (2 / exp) });
  }
  return out;
}

/**
 * A path that sets off from `from` heading `ang` for `len` tiles, turning gently as it goes (an S-curve, never a zigzag),
 * stopping where `ok` fails.
 */
export function march(rng: Rng, from: Pt, ang: number, len: number, bend = 0.05, ok: (x: number, y: number) => boolean = () => true): Pt[] {
  const out: Pt[] = [{ ...from }];
  let a = ang;
  let curv = 0;
  let p = { ...from };
  for (let i = 0; i < len; i++) {
    curv = clamp(curv + (rng() - 0.5) * bend * 0.6, -bend, bend);
    a += curv + (ang - a) * 0.025;
    p = { x: p.x + Math.cos(a), y: p.y + Math.sin(a) };
    if (!ok(Math.round(p.x), Math.round(p.y))) break;
    out.push(p);
  }
  return out;
}

export interface StampOpts {
  kind: Road["kind"];
  width: number;
  /** Paves over these tiles (default grass and trees); walls too where a street goes through a gate. */
  over?: ReadonlySet<Tile>;
  /** Streets leave reserved ground alone unless this is set. */
  through?: boolean;
}

const OVER: ReadonlySet<Tile> = new Set<Tile>(["grass", "tree", "path"]);
export const OVER_WALL: ReadonlySet<Tile> = new Set<Tile>(["grass", "tree", "path", "wall"]);

/** Draws a street along dense points. Returns it (and keeps it on the canvas) with the tiles of its centre-line. */
export function stamp(c: Canvas, dense: Pt[], o: StampOpts): Road {
  const { W, H, tiles, reserved } = c;
  const over = o.over ?? OVER;
  const e = o.width % 2 === 0 ? 0.5 : 0;
  const r = o.width / 2 + 0.2;
  const R = Math.ceil(r) + 1;
  const samples: Road["samples"] = [];
  const seen = new Set<number>();
  for (let i = 0; i < dense.length; i++) {
    const p = dense[i]!;
    const ix = Math.round(p.x);
    const iy = Math.round(p.y);
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
      const x = ix + dx;
      const y = iy + dy;
      if (x < 1 || y < 1 || x > W - 2 || y > H - 2) continue;
      if (Math.hypot(x - (p.x + e), y - (p.y + e)) > r) continue;
      if (reserved[y * W + x] && !o.through) continue;
      if (over.has(tiles[y]![x]!)) tiles[y]![x] = "path";
    }
    if (ix < 1 || iy < 1 || ix > W - 2 || iy > H - 2) continue;
    const key = iy * W + ix;
    if (seen.has(key)) continue;
    seen.add(key);
    const a = dense[Math.max(0, i - 3)]!;
    const b = dense[Math.min(dense.length - 1, i + 3)]!;
    const d = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    samples.push({ x: ix, y: iy, tx: (b.x - a.x) / d, ty: (b.y - a.y) / d });
  }
  const road: Road = { id: c.roads.length, kind: o.kind, width: o.width, samples };
  c.roads.push(road);
  return road;
}

/** Where a building can stand: a tile of street (or plaza), the way out from it, and where it sits in the run along the street. */
export interface Front {
  px: number;
  py: number;
  dx: number;
  dy: number;
  side: string;
  pos: number;
}

/** Frontage along both sides of a street: at every tile of its centre-line, out to the edge of the paving, on each side. */
export function frontsOf(c: Canvas, road: Road): Front[] {
  const out: Front[] = [];
  const seen = new Set<number>();
  for (let i = 0; i < road.samples.length; i++) {
    const s = road.samples[i]!;
    for (const sgn of [1, -1]) {
      const nx = -s.ty * sgn;
      const ny = s.tx * sgn;
      const [dx, dy] = Math.abs(nx) >= Math.abs(ny) ? [Math.sign(nx), 0] : [0, Math.sign(ny)];
      let px = s.x;
      let py = s.y;
      let k = 0;
      while (k < road.width + 3 && c.tiles[py + dy]?.[px + dx] === "path") {
        px += dx;
        py += dy;
        k++;
      }
      if (k === 0 && road.width > 1) continue;
      const key = ((py * c.W + px) << 2) | (dx === 0 ? (dy > 0 ? 1 : 0) : dx > 0 ? 3 : 2);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ px, py, dx, dy, side: `${road.id}:${sgn}`, pos: i });
    }
  }
  return out;
}

/** Frontage round the edge of a plaza (its paving), looking out. */
export function plazaFronts(id: number, r: Rect): Front[] {
  const out: Front[] = [];
  for (let x = r.x0 + 1; x < r.x1; x++) out.push({ px: x, py: r.y0, dx: 0, dy: -1, side: `z${id}:n`, pos: x }, { px: x, py: r.y1, dx: 0, dy: 1, side: `z${id}:s`, pos: x });
  for (let y = r.y0 + 1; y < r.y1; y++) out.push({ px: r.x0, py: y, dx: -1, dy: 0, side: `z${id}:w`, pos: y }, { px: r.x1, py: y, dx: 1, dy: 0, side: `z${id}:e`, pos: y });
  return out;
}

export interface GrowOpts {
  kind: "lane" | "alley";
  width: number;
  /** Tiles between branches along a street, from..to (random). */
  spacing: [number, number];
  maxLen: number;
  minLen: number;
  /** May end at nothing (a dead-end lane), if it's long enough. */
  deadEnds: boolean;
  bend: number;
  /** Where lanes may run. */
  inner: Rect;
  /** Streets to branch from. */
  from: (r: Road) => boolean;
  /** At most this many lanes. */
  cap?: number;
  /** Leave this much ground between a lane and another street running beside it. */
  clear?: number;
  /** Points of a street where no lane should leave from. */
  skip?: (x: number, y: number) => boolean;
}

/**
 * Side lanes off the streets already there: from points along them, either side, a lane sets off at right angles, curving a
 * little, until it meets another street (and joins it), or runs out of room (a dead end, if allowed).
 */
export function grow(c: Canvas, rng: Rng, o: GrowOpts): number {
  const { W, tiles, reserved } = c;
  const clear = o.clear ?? 4;
  const half = Math.ceil(o.width / 2);
  const isPath = (x: number, y: number) => tiles[y]?.[x] === "path";
  const blocked = (x: number, y: number): boolean => {
    if (x < o.inner.x0 || y < o.inner.y0 || x > o.inner.x1 || y > o.inner.y1) return true;
    for (let dy = -half; dy <= half; dy++) for (let dx = -half; dx <= half; dx++) {
      const t = tiles[y + dy]?.[x + dx];
      if (t === undefined || t === "wall" || t === "water" || t === "door") return true;
      if (reserved[(y + dy) * W + x + dx] && t !== "path") return true;
    }
    return false;
  };
  const nearest = (x: number, y: number, rad: number): number => {
    let best = Infinity;
    const R = Math.ceil(rad);
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) if (isPath(x + dx, y + dy)) best = Math.min(best, Math.hypot(dx, dy));
    return best;
  };
  let made = 0;
  for (const parent of c.roads.slice()) {
    if (!o.from(parent)) continue;
    const ph = Math.ceil(parent.width / 2);
    for (const sgn of [1, -1]) {
      let idx = Math.floor(rng() * o.spacing[1]);
      for (; idx < parent.samples.length; idx += o.spacing[0] + Math.floor(rng() * (o.spacing[1] - o.spacing[0] + 1))) {
        if (o.cap !== undefined && made >= o.cap) return made;
        const s = parent.samples[idx]!;
        if (o.skip?.(s.x, s.y)) continue;
        const nx = -s.ty * sgn;
        const ny = s.tx * sgn;
        // Not hard by another lane's mouth.
        const qx = Math.round(s.x + nx * (ph + 3));
        const qy = Math.round(s.y + ny * (ph + 3));
        if (tiles[qy]?.[qx] === undefined || nearest(qx, qy, o.width <= 2 ? 1.5 : 2.2) < Infinity) continue;
        const base = Math.atan2(ny, nx);
        const pts: Pt[] = [{ x: s.x, y: s.y }];
        let a = base;
        let curv = 0;
        let p = { x: s.x, y: s.y };
        let joined = false;
        let closing = 0;
        let dead = false;
        for (let step = 1; step <= o.maxLen + ph + 6; step++) {
          if (closing === 0) {
            curv = Math.max(-o.bend, Math.min(o.bend, curv + (rng() - 0.5) * o.bend * 0.6));
            a += curv + (base - a) * 0.03;
          }
          p = { x: p.x + Math.cos(a), y: p.y + Math.sin(a) };
          const ix = Math.round(p.x);
          const iy = Math.round(p.y);
          if (step > ph + 2 && blocked(ix, iy)) {
            dead = true;
            break;
          }
          pts.push({ ...p });
          if (step > ph + 3) {
            const d = nearest(ix, iy, clear);
            if (d <= 1.5) {
              joined = true;
              break;
            }
            if (d <= clear) closing++;
            if (closing > 6) {
              dead = true;
              break;
            }
          }
          if (step === o.maxLen + ph) dead = true;
          if (dead) break;
        }
        const len = pts.length - ph;
        if (!joined && !(o.deadEnds && len >= o.minLen)) continue;
        if (joined && len < Math.min(o.minLen, 5)) continue;
        stamp(c, pts, { kind: o.kind, width: o.width });
        made++;
        // Skip past the lane's own mouth.
        idx += Math.floor(o.width);
      }
    }
  }
  return made;
}

/** An L-shaped lane from a point to the nearest street (so every quarter has a way into it). */
export function spurTo(c: Canvas, from: Pt, width: number): boolean {
  const { W, H, tiles } = c;
  let best: Pt | null = null;
  let bd = Infinity;
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    if (tiles[y]![x] !== "path") continue;
    const d = Math.abs(x - from.x) + Math.abs(y - from.y);
    if (d < bd) {
      bd = d;
      best = { x, y };
    }
  }
  if (!best || bd <= width) return false;
  const bendAt = { x: from.x, y: best.y };
  stamp(c, [...line(from, bendAt), ...line(bendAt, best)], { kind: "spur", width, over: OVER_WALL, through: true });
  return true;
}
