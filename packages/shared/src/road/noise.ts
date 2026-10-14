/**
 * Seeded noise made only of integer arithmetic (N26): the same input gives the same number on every
 * machine, so the server and the browser draw the same chunk. No Math.random, no trigonometry, and nothing
 * where a floating-point rounding could tip a threshold.
 */

/** A 32-bit hash of a seed and two integers. */
export function hash2(seed: number, x: number, y: number): number {
  let h = (seed | 0) ^ Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/** 0..1023 from a hash: an integer, for thresholds. */
export const rand1024 = (seed: number, x: number, y: number): number => hash2(seed, x, y) >>> 22;

/** A seed from text. */
export function seedOf(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

/**
 * Smooth value noise, 0..1023, over a lattice `cell` tiles wide (a whole number of tiles).
 * Corners are hashed; between them the value is blended in fixed point with a smoothstep.
 */
export function valueNoise(seed: number, x: number, y: number, cell: number): number {
  const cx = Math.floor(x / cell);
  const cy = Math.floor(y / cell);
  const fx = x - cx * cell;
  const fy = y - cy * cell;
  // Smoothstep in 0..1024 fixed point: t² (3 − 2t).
  const sx = smooth((fx * 1024) / cell);
  const sy = smooth((fy * 1024) / cell);
  const a = rand1024(seed, cx, cy);
  const b = rand1024(seed, cx + 1, cy);
  const c = rand1024(seed, cx, cy + 1);
  const d = rand1024(seed, cx + 1, cy + 1);
  const top = a + (((b - a) * sx) >> 10);
  const bottom = c + (((d - c) * sx) >> 10);
  return top + (((bottom - top) * sy) >> 10);
}

/** Smoothstep on an integer 0..1024. */
function smooth(t: number): number {
  const u = Math.floor(t);
  return (u * u * (3 * 1024 - 2 * u)) >> 20;
}

/** Two octaves of value noise, 0..1023: broad shapes with a little detail. */
export function fractal(seed: number, x: number, y: number, cell: number): number {
  return (valueNoise(seed, x, y, cell) * 2 + valueNoise(seed + 101, x, y, Math.max(2, cell >> 2)) + 1) / 3 | 0;
}
