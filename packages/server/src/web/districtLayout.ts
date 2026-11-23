import type { District, DistrictKind } from "@garden-of-eden/shared";

/**
 * Where a place's districts lie on its map (N26H decisions 1 and 2), as rectangles. Small places (a hamlet, a village) are
 * a green in the middle with the built-up core round it, farmsteads round about and the manor in a corner; towns and up are
 * a grid of quarters centred on the market square, each where it would be: the castle or palace ward on the high ground (the north-east), the noble
 * quarter next to it, the market at the crossroads, the gate where the road comes in (the west), the slums and the poor
 * end at the far, downwind side (the south), the docks on the water.
 */
export interface DistrictRect {
  district: District;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Districts that are walled off, with a gate (a post) where a street comes in. */
export const WALLED: ReadonlySet<DistrictKind> = new Set(["noble", "castle", "palace", "manor", "barracks"]);

export interface RectOpts {
  lo: number;
  hiX: number;
  hiY: number;
  mx: number;
  my: number;
  big: boolean;
  /** Small places: the green and its ring road, and the village's built-up core round it (both rectangles of tiles). */
  green?: { x0: number; y0: number; x1: number; y1: number };
  core?: { x0: number; y0: number; x1: number; y1: number };
}

export function districtRects(districts: District[], o: RectOpts): DistrictRect[] {
  const by = (k: DistrictKind) => districts.find((d) => d.kind === k);
  const out: DistrictRect[] = [];
  const add = (k: DistrictKind, x0: number, y0: number, x1: number, y1: number) => {
    const d = by(k);
    if (d && x1 > x0 && y1 > y0) out.push({ district: d, x0, y0, x1, y1 });
  };
  if (!o.big) {
    // A manor in the north-east corner; the green with its ring road; the built-up core round it; farmsteads all about.
    if (by("manor")) add("manor", o.hiX - 11, o.lo, o.hiX, o.lo + 7);
    const g = o.green ?? { x0: o.mx - 10, y0: o.my - 4, x1: o.mx + 11, y1: o.my + 9 };
    add("green", g.x0, g.y0, g.x1, g.y1);
    const c = o.core ?? { x0: o.lo, y0: o.my - 4, x1: o.hiX, y1: o.my + 4 };
    add("street", Math.max(o.lo, c.x0), Math.max(o.lo, c.y0), Math.min(o.hiX, c.x1), Math.min(o.hiY, c.y1));
    add("farmsteads", o.lo, o.lo, o.hiX, o.hiY);
    return out;
  }
  // A grid of quarters centred on the crossroads: three columns (five in the big cities), three rows; the middle one is the
  // market square's.
  const cols = districts.length > 9 ? 5 : 3;
  const rows = 3;
  const split = (lo: number, hi: number, mid: number, n: number): number[] => {
    // n cells with the middle one centred on `mid`.
    const total = hi - lo + 1;
    const cw = Math.floor(total / n);
    const side = Math.floor((n - 1) / 2);
    const m0 = Math.max(lo + side * 8, Math.min(hi - side * 8 - cw + 1, mid - Math.floor(cw / 2)));
    const bounds: number[] = [];
    for (let i = 0; i < side; i++) bounds.push(Math.round(lo + ((m0 - lo) * i) / side));
    bounds.push(m0, m0 + cw);
    for (let i = 1; i <= side; i++) bounds.push(Math.round(m0 + cw + ((hi + 1 - (m0 + cw)) * i) / side));
    return bounds;
  };
  const bx = split(o.lo, o.hiX, o.mx, cols);
  const by2 = split(o.lo, o.hiY, o.my, rows);
  const cell = (r: number, c: number) => ({ x0: bx[c]!, y0: by2[r]!, x1: bx[c + 1]! - 1, y1: by2[r + 1]! - 1 });
  // Where each kind wants to be, best first: [row, column] with columns named from the west: W, WM (west middle), C (centre), EM, E.
  const col = (name: string): number => {
    if (cols === 3) return { W: 0, WM: 0, C: 1, EM: 2, E: 2 }[name]!;
    return { W: 0, WM: 1, C: 2, EM: 3, E: 4 }[name]!;
  };
  const want: Array<[DistrictKind, Array<[number, string]>]> = [
    ["palace", [[0, "E"]]],
    ["castle", [[0, "E"]]],
    ["noble", [[0, "EM"], [1, "E"], [0, "C"]]],
    ["cathedral", [[0, "C"]]],
    ["market", [[1, "C"]]],
    ["gate", [[1, "W"]]],
    ["temple_close", [[0, "C"], [0, "WM"], [0, "W"]]],
    ["high_street", [[1, "EM"], [1, "E"], [1, "WM"]]],
    ["guild", [[0, "WM"], [2, "C"], [1, "EM"]]],
    ["barracks", [[2, "W"], [1, "W"]]],
    ["craft", [[2, "C"], [2, "WM"], [2, "EM"]]],
    ["docks", [[2, "E"]]],
    ["slums", [[2, "E"], [2, "EM"]]],
    ["poor_end", [[2, "E"], [2, "EM"], [2, "WM"], [2, "W"]]],
    ["foreign", [[2, "WM"], [1, "WM"], [2, "EM"]]],
  ];
  const used = new Set<string>();
  for (const [k, spots] of want) {
    if (!by(k)) continue;
    for (const [r, name] of spots) {
      const c = col(name);
      const key = `${r},${c}`;
      if (used.has(key)) continue;
      used.add(key);
      const b = cell(r, c);
      add(k, b.x0, b.y0, b.x1, b.y1);
      break;
    }
  }
  // A quarter with no cell it likes takes any free one.
  for (const d of districts) {
    if (out.some((r) => r.district.id === d.id)) continue;
    for (let r = rows - 1, done = false; r >= 0 && !done; r--) for (let c = cols - 1; c >= 0 && !done; c--) {
      if (used.has(`${r},${c}`)) continue;
      used.add(`${r},${c}`);
      const b = cell(r, c);
      add(d.kind, b.x0, b.y0, b.x1, b.y1);
      done = true;
    }
  }
  // Whatever cell is left is more of the town's ordinary streets.
  const filler: DistrictKind = by("high_street") ? "high_street" : by("craft") ? "craft" : districts[0]!.kind;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if (!used.has(`${r},${c}`)) add(filler, cell(r, c).x0, cell(r, c).y0, cell(r, c).x1, cell(r, c).y1);
  return out;
}

/** The district a tile is in: the first rectangle that holds it (small places' rectangles nest, the most particular first). */
export function districtAt(rects: DistrictRect[], x: number, y: number): District | null {
  for (const r of rects) if (x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1) return r.district;
  return null;
}

/** The kind of house a district has (N26H decision 3: by its people's class and trade). */
export function houseStyleOf(k: DistrictKind | undefined): "hovel" | "cottage" | "craft" | "merchant" {
  switch (k) {
    case "slums":
    case "poor_end":
    case "farmsteads":
      return "hovel";
    case "craft":
    case "guild":
    case "docks":
      return "craft";
    case "high_street":
    case "market":
    case "noble":
      return "merchant";
    default:
      return "cottage";
  }
}
