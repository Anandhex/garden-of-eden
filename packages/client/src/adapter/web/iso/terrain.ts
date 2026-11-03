/**
 * The land's surface in the 2.5D view (G7 Part B), from the heights the server sends with each patch. Each tile
 * corner stands at the average of the four tiles round it, so the land is one smooth surface without steps; a point
 * between corners is blended (bilinear). Everything that stands on the land asks here how high the ground is. The
 * corners round the player are worked out once a redraw; a tile whose patch hasn't come takes the last height
 * known, so the edge of what is loaded never drops into a cliff.
 */

/** Tiles of a tile's height (in tiles) at a map tile, or undefined when its patch hasn't come. */
export type TileHeight = (x: number, y: number) => number | undefined;

export class HeightField {
  private x0 = 0;
  private y0 = 0;
  private n = 0;
  private corners = new Float32Array(0);
  private fallback = 0;

  constructor(
    private readonly tile: TileHeight,
    /** The tile at the scene's 0, 0. */
    private readonly origin: () => { x: number; y: number },
  ) {}

  private tileH(x: number, y: number): number {
    const h = this.tile(x, y);
    if (h === undefined) return this.fallback;
    return h;
  }

  /** A corner's height (map tiles; the corner at (x, y) is the top-left of tile x, y). */
  cornerAt(x: number, y: number): number {
    const i = x - this.x0;
    const j = y - this.y0;
    if (i >= 0 && j >= 0 && i < this.n && j < this.n) return this.corners[j * this.n + i]!;
    return (this.tileH(x - 1, y - 1) + this.tileH(x, y - 1) + this.tileH(x - 1, y) + this.tileH(x, y)) / 4;
  }

  /** Work out the corners of the square of tiles `r` each way from (cx, cy). */
  build(cx: number, cy: number, r: number): void {
    const here = this.tile(cx, cy);
    if (here !== undefined) this.fallback = here;
    this.x0 = cx - r - 1;
    this.y0 = cy - r - 1;
    this.n = 2 * r + 4;
    if (this.corners.length !== this.n * this.n) this.corners = new Float32Array(this.n * this.n);
    const n = this.n;
    // Tiles first (one lookup each), then corners from them.
    const tiles = new Float32Array((n + 1) * (n + 1));
    for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) tiles[j * (n + 1) + i] = this.tileH(this.x0 - 1 + i, this.y0 - 1 + j);
    for (let j = 0; j < n; j++)
      for (let i = 0; i < n; i++) {
        const a = j * (n + 1) + i;
        this.corners[j * n + i] = (tiles[a]! + tiles[a + 1]! + tiles[a + n + 1]! + tiles[a + n + 2]!) / 4;
      }
  }

  /** The ground's height at a point in map tiles. */
  at(x: number, y: number): number {
    const cx = Math.floor(x);
    const cy = Math.floor(y);
    const fx = x - cx;
    const fy = y - cy;
    const a = this.cornerAt(cx, cy);
    const b = this.cornerAt(cx + 1, cy);
    const c = this.cornerAt(cx, cy + 1);
    const d = this.cornerAt(cx + 1, cy + 1);
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
  }

  /** The ground's height at a point in scene units. */
  scene(x: number, z: number): number {
    const o = this.origin();
    return this.at(x + o.x, z + o.y);
  }

  /** The ground's slope (rise per tile) at a corner, for its normal. */
  slopeAt(x: number, y: number): { dx: number; dy: number } {
    return { dx: (this.cornerAt(x + 1, y) - this.cornerAt(x - 1, y)) / 2, dy: (this.cornerAt(x, y + 1) - this.cornerAt(x, y - 1)) / 2 };
  }
}
