/**
 * The world's layers (G6), drawn bottom to top: the ground; everything that stands (props, front walls and people)
 * y-sorted together by where its foot is; the roofs over them (faded when the player is under or behind one); the
 * near foreground and weather; then names, bubbles and hover text, never covered.
 */
export const DEPTH = {
  ground: 0,
  blend: 1,
  hover: 5,
  /** + the foot's row (tiles from the scene's origin); a sorted thing at row y is drawn over one at row y − 1. */
  sort: 10_000,
  roof: 20_000,
  roofProp: 20_001,
  porch: 20_002,
  glow: 20_500,
  fog: 21_000,
  fore: 21_500,
  weather: 22_000,
  signs: 30_000,
  labels: 30_500,
  prompt: 31_000,
  bubbles: 31_500,
  float: 32_000,
  tip: 33_000,
} as const;

/** The depth of something whose foot is at `footRow` tiles below the scene's origin. */
export const sortDepth = (footRow: number): number => DEPTH.sort + footRow;
