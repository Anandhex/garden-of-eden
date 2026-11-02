import type { District, DistrictKind } from "@millbrook/shared";

/**
 * Where a place's districts lie on its map (N26H decisions 1 and 2), as rectangles. Small places (a hamlet, a village) are
 * a green in the middle with the street along the road, farmsteads round about and the manor in a corner; towns and up are
 * a grid of quarters, each where it would be: the castle or palace ward on the high ground (the north-east), the noble
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

export function districtRects(districts: District[], o: { lo: number; hiX: number; hiY: number; mx: number; my: number; big: boolean }): DistrictRect[] {
  const by = (k: DistrictKind) => districts.find((d) => d.kind === k);
  const out: DistrictRect[] = [];
  const add = (k: DistrictKind, x0: number, y0: number, x1: number, y1: number) => {
    const d = by(k);
    if (d && x1 > x0 && y1 > y0) out.push({ district: d, x0, y0, x1, y1 });
  };
  if (!o.big) {
    // A manor in the north-east corner; the green round the middle; the street along the road; farmsteads all about.
    if (by("manor")) add("manor", o.hiX - 11, o.lo, o.hiX, o.lo + 7);
    add("green", o.mx - 6, o.my - 4, o.mx + 7, o.my + 4);
    add("street", o.lo, o.my - 3, o.hiX, o.my + 3);
    add("farmsteads", o.lo, o.lo, o.hiX, o.hiY);
    return out;
  }
  const cols = districts.length > 12 ? 5 : districts.length > 9 ? 4 : 3;
  const rows = 3;
  const cw = Math.floor((o.hiX - o.lo + 1) / cols);
  const ch = Math.floor((o.hiY - o.lo + 1) / rows);
  const cell = (r: number, c: number) => ({ x0: o.lo + c * cw, y0: o.lo + r * ch, x1: c === cols - 1 ? o.hiX : o.lo + (c + 1) * cw - 1, y1: r === rows - 1 ? o.hiY : o.lo + (r + 1) * ch - 1 });
  // Where each kind wants to be, best first: [row, col] with negative cols from the east.
  const want: Array<[DistrictKind, Array<[number, number]>]> = [
    ["palace", [[0, -1]]],
    ["castle", [[0, -1]]],
    ["noble", [[0, -2], [1, -1]]],
    ["cathedral", [[0, 1], [0, 0]]],
    ["market", [[1, 1]]],
    ["gate", [[1, 0]]],
    ["temple_close", [[0, 0], [0, 1]]],
    ["high_street", [[1, 2], [1, -1], [0, 1]]],
    ["guild", [[0, 1], [1, 2], [2, 1]]],
    ["barracks", [[2, 0], [1, 0]]],
    ["craft", [[2, 1], [2, 2]]],
    ["docks", [[2, -1]]],
    ["slums", [[2, -1], [2, -2]]],
    ["poor_end", [[2, -1], [2, 2], [2, 0]]],
    ["foreign", [[2, 2], [1, 2], [2, 1]]],
  ];
  const used = new Set<string>();
  for (const [k, spots] of want) {
    if (!by(k)) continue;
    for (const [r, c0] of spots) {
      const c = c0 < 0 ? cols + c0 : c0;
      const key = `${r},${c}`;
      if (c < 0 || c >= cols || used.has(key)) continue;
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
