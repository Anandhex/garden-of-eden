import type { RoadPoint } from "./types.js";

/** Straight-line distance between two points. */
export const dist = (a: RoadPoint, b: RoadPoint): number => Math.sqrt((a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y));

/** Total length of a polyline. */
export function lengthOf(pts: RoadPoint[]): number {
  let n = 0;
  for (let i = 1; i < pts.length; i++) n += dist(pts[i - 1]!, pts[i]!);
  return n;
}

/** Cumulative distance at each point of a polyline. */
export function cumulative(pts: RoadPoint[]): number[] {
  const out = [0];
  for (let i = 1; i < pts.length; i++) out.push(out[i - 1]! + dist(pts[i - 1]!, pts[i]!));
  return out;
}

/** The point `d` tiles along a polyline (clamped to its ends), with the index of the segment it is on. */
export function pointAt(pts: RoadPoint[], cum: number[], d: number): RoadPoint & { seg: number } {
  if (pts.length === 0) return { x: 0, y: 0, seg: 0 };
  if (d <= 0 || pts.length === 1) return { ...pts[0]!, seg: 0 };
  const total = cum[cum.length - 1]!;
  if (d >= total) return { ...pts[pts.length - 1]!, seg: Math.max(0, pts.length - 2) };
  let lo = 0;
  let hi = cum.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid]! <= d) lo = mid;
    else hi = mid;
  }
  const span = cum[hi]! - cum[lo]!;
  const f = span === 0 ? 0 : (d - cum[lo]!) / span;
  const a = pts[lo]!;
  const b = pts[hi]!;
  return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, seg: lo };
}

/** The nearest point on a segment to p: its distance along the segment (0..1) and how far p is from it. */
export function nearestOnSegment(a: RoadPoint, b: RoadPoint, p: RoadPoint): { f: number; d: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const f = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  const ex = a.x + dx * f - p.x;
  const ey = a.y + dy * f - p.y;
  return { f, d: Math.sqrt(ex * ex + ey * ey) };
}

/** The nearest point on a polyline: how far along it and how far off. */
export function project(pts: RoadPoint[], cum: number[], p: RoadPoint): { t: number; d: number } {
  let best = { t: 0, d: Infinity };
  for (let i = 1; i < pts.length; i++) {
    const n = nearestOnSegment(pts[i - 1]!, pts[i]!, p);
    if (n.d < best.d) best = { t: cum[i - 1]! + n.f * (cum[i]! - cum[i - 1]!), d: n.d };
  }
  return best;
}

/** Where two segments cross, if they do. */
export function intersect(a: RoadPoint, b: RoadPoint, c: RoadPoint, d: RoadPoint): RoadPoint | null {
  const r = { x: b.x - a.x, y: b.y - a.y };
  const s = { x: d.x - c.x, y: d.y - c.y };
  const den = r.x * s.y - r.y * s.x;
  if (den === 0) return null;
  const t = ((c.x - a.x) * s.y - (c.y - a.y) * s.x) / den;
  const u = ((c.x - a.x) * r.y - (c.y - a.y) * r.x) / den;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { x: a.x + r.x * t, y: a.y + r.y * t };
}

/** The box a polyline lies in, grown by `pad`. */
export function boundsOf(pts: RoadPoint[], pad = 0): { x0: number; y0: number; x1: number; y1: number } {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pts) {
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  }
  return { x0: x0 - pad, y0: y0 - pad, x1: x1 + pad, y1: y1 + pad };
}

/** The same line with a point about every `step` tiles: for following a road with a short look-ahead. */
export function resample(pts: RoadPoint[], step: number): RoadPoint[] {
  const out: RoadPoint[] = pts.length > 0 ? [{ ...pts[0]! }] : [];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const n = Math.max(1, Math.round(dist(a, b) / step));
    for (let k = 1; k <= n; k++) out.push({ x: Math.round(a.x + ((b.x - a.x) * k) / n), y: Math.round(a.y + ((b.y - a.y) * k) / n) });
  }
  return out;
}
