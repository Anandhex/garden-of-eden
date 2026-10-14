/** The land between places (N26), made in the browser from the road data the server sends once. */
import { CHUNK, chunkAt, chunkOf, isSolidGround, type Chunk, type RoadData } from "@millbrook/shared";

export const land = { origin: { x: 0, y: 0 }, data: null as RoadData | null, loading: null as Promise<void> | null, chunks: new Map<string, Chunk>() };
const KEEP = 60;

/** Fetch the road data once. */
export function loadRoadData(): Promise<void> {
  if (land.data) return Promise.resolve();
  land.loading ??= fetch("/api/road/data")
    .then((r) => r.json() as Promise<RoadData | null>)
    .then((d) => {
      land.data = d;
      land.chunks.clear();
    })
    .finally(() => (land.loading = null));
  return land.loading;
}

/** A chunk if it is made already. */
export const chunkIfMade = (cx: number, cy: number): Chunk | undefined => land.chunks.get(`${cx},${cy}`);

/** Make a chunk (about 5 ms), keeping the recent ones. */
export function makeChunk(cx: number, cy: number): Chunk | undefined {
  if (!land.data) return undefined;
  const key = `${cx},${cy}`;
  let c = land.chunks.get(key);
  if (!c) {
    c = chunkAt(land.data, cx, cy);
    land.chunks.set(key, c);
    if (land.chunks.size > KEEP) land.chunks.delete(land.chunks.keys().next().value!);
  }
  return c;
}

/** The ground at a global tile, or undefined if its chunk isn't made yet (not blocking: callers make the ones near the player). */
export function groundAt(x: number, y: number): number | undefined {
  const c = chunkIfMade(chunkOf(x), chunkOf(y));
  return c ? c.tiles[(y - c.cy * CHUNK) * CHUNK + (x - c.cx * CHUNK)] : undefined;
}

/** A tile that can't be walked (unknown tiles count as open: the server decides). */
export const solidAt = (x: number, y: number): boolean => {
  const g = groundAt(x, y);
  return g !== undefined && isSolidGround(g);
};
