/**
 * The 2.5D camera's geometry (G7), without Three.js so a test can check it. World units are tiles: tile (x, y) is
 * the square x..x+1 by z = y..y+1 on the ground, y up. The camera looks down at PITCH from the yaw of its turn (one
 * of four quarter turns, 45° off the grid so the view is isometric). "Up the screen" and "right" as ground
 * directions turn with it, so the keys (W is always up-right) and the sprites' facings follow the screen.
 */

export const PITCH = (35 * Math.PI) / 180;
/** How far the camera sits from what it looks at (orthographic, so only the clipping planes care). */
export const CAMERA_DISTANCE = 80;
/** Tiles from the bottom of the view to the top at zoom 1. */
export const VIEW_TILES = 13;
export const ZOOM_MIN = 0.6;
export const ZOOM_MAX = 2.2;

export type Turn = 0 | 1 | 2 | 3;
export type Dir = "n" | "e" | "s" | "w";
type Step = -1 | 0 | 1;

/** The camera's yaw for a turn: 45° at turn 0, the camera south-east of the player looking north-west. */
export const yawOf = (turn: number): number => Math.PI / 4 + (turn * Math.PI) / 2;

/** Where the camera sits from the point it looks at. */
export function cameraOffset(yaw: number, distance = CAMERA_DISTANCE): { x: number; y: number; z: number } {
  const flat = Math.cos(PITCH) * distance;
  return { x: Math.sin(yaw) * flat, y: Math.sin(PITCH) * distance, z: Math.cos(yaw) * flat };
}

/** The ground directions (x, z) that point right and up the screen. */
export function screenAxes(yaw: number): { right: { x: number; z: number }; up: { x: number; z: number } } {
  return { right: { x: Math.cos(yaw), z: -Math.sin(yaw) }, up: { x: -Math.sin(yaw), z: -Math.cos(yaw) } };
}

/** A ground direction (grid dx, dy) as a screen direction (sx right, sy up). */
export function toScreen(yaw: number, dx: number, dy: number): { sx: number; sy: number } {
  const a = screenAxes(yaw);
  return { sx: dx * a.right.x + dy * a.right.z, sy: dx * a.up.x + dy * a.up.z };
}

const sign = (v: number): Step => (v > 0 ? 1 : v < 0 ? -1 : 0);

/**
 * A key's screen direction (dx right, dy down, as the keys send them) as one grid step. The screen direction is
 * turned 45° clockwise first, so W is up-right, D down-right, S down-left and A up-left: four different grid steps
 * on every turn, never a tie.
 */
export function stepFor(yaw: number, dx: Step, dy: Step): { dx: Step; dy: Step } {
  if (dx === 0 && dy === 0) return { dx: 0, dy: 0 };
  const sx = dx;
  const sy = -dy;
  const c = Math.SQRT1_2;
  const rx = sx * c + sy * c;
  const ry = -sx * c + sy * c;
  const a = screenAxes(yaw);
  const gx = rx * a.right.x + ry * a.up.x;
  const gz = rx * a.right.z + ry * a.up.z;
  return Math.abs(gx) >= Math.abs(gz) ? { dx: sign(gx), dy: 0 } : { dx: 0, dy: sign(gz) };
}

/**
 * Which of a person's four drawings shows someone facing grid direction `d` from this camera: going up-right on
 * screen shows their back (n), down-right their right side (e), down-left their front (s), up-left their left (w).
 */
export function screenFacing(yaw: number, d: Dir): Dir {
  const v = DIR_VEC[d];
  const s = toScreen(yaw, v.x, v.y);
  if (s.sy >= 0) return s.sx >= 0 ? "n" : "w";
  return s.sx >= 0 ? "e" : "s";
}

/** A beast trots right or left across the screen. */
export const screenSide = (yaw: number, d: Dir): "e" | "w" => (toScreen(yaw, DIR_VEC[d].x, DIR_VEC[d].y).sx >= 0 ? "e" : "w");

export const DIR_VEC: Record<Dir, { x: number; y: number }> = { n: { x: 0, y: -1 }, e: { x: 1, y: 0 }, s: { x: 0, y: 1 }, w: { x: -1, y: 0 } };

/** The grid direction of a move (the larger part wins), for a sprite walking between two points. */
export function dirOf(dx: number, dy: number): Dir {
  return Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? "e" : "w") : dy > 0 ? "s" : "n";
}

export const clampZoom = (z: number): number => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z));
