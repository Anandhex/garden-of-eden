/** Grid paths for click-to-walk and for drawing NPCs walking between places. */
export interface Tile {
  x: number;
  y: number;
}

/**
 * Breadth-first search from `from` to the first tile that passes `goal`, stepping
 * in four directions over tiles `blocked` doesn't rule out. Returns the steps after
 * `from` (empty if `from` already passes), or null when there's no way.
 */
export function findPath(from: Tile, goal: (t: Tile) => boolean, blocked: (x: number, y: number) => boolean, maxTiles = 10_000): Tile[] | null {
  const key = (x: number, y: number) => y * 100_000 + x;
  const prev = new Map<number, Tile | null>([[key(from.x, from.y), null]]);
  const queue: Tile[] = [from];
  for (let head = 0; head < queue.length && prev.size <= maxTiles; head++) {
    const cur = queue[head]!;
    if (goal(cur)) {
      const path: Tile[] = [];
      for (let c: Tile | null = cur; c && prev.get(key(c.x, c.y)); c = prev.get(key(c.x, c.y)) ?? null) path.unshift(c);
      return path;
    }
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = cur.x + dx;
      const ny = cur.y + dy;
      if (prev.has(key(nx, ny)) || blocked(nx, ny)) continue;
      prev.set(key(nx, ny), cur);
      queue.push({ x: nx, y: ny });
    }
  }
  return null;
}

export const tileDistance = (a: Tile, b: Tile) => Math.hypot(a.x - b.x, a.y - b.y);
