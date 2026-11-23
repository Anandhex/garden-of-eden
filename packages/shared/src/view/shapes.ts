/**
 * Regional building shapes (G10): how a place's buildings stand in 3D, from who lives there and where. styles.ts
 * gives a building its materials (slate, tiles, logs, whitewash...); this gives it its shape. The server sends a
 * place's `locale` with each frame (its culture's template, its land, how well it lives and how big it is); this works
 * out, for each building, the roof's form and pitch, the walls' height, the eaves, a footing or stilts. A building
 * the server sent unstyled (no `~style` on its template) also gets its materials here, swapped among the plain
 * templates' own tiles and tinted, so an older server still shows regional towns. Pure and the same for every
 * adapter; drawing only, never the game's.
 *
 * Three things decide a style, in this order:
 *  1. the culture: highland stone and slate, river half-timber and thatch, coastal whitewash and terracotta, forest
 *     logs and steep mossy shakes, steppe felt yurts and mud-brick, imperial stucco and red-tiled hipped roofs;
 *  2. the land: stilts in the marsh, stone footings on the hills, deep eaves under the trees, salt-whitened walls on
 *     the coast;
 *  3. wealth and size: thatch and low walls in a poor hamlet, a storey more and better walls in a rich town or city,
 *     and the halls and temples always the grandest building in the place.
 * Each building then varies a little by a stable hash of its id, so a street is never a row of copies.
 */
import { z } from "zod";

export const LocaleSchema = z.object({
  /** The culture's template id (highland, river, coastal, forest, steppe, imperial); an unknown one is styled by its land. */
  culture: z.string(),
  /** The place's land: valley, hills, forest, plains, coast or marsh. */
  terrain: z.string(),
  /** 0..1: how well the place lives (its prosperity). */
  wealth: z.number().min(0).max(1),
  /** hamlet, village, town, city or capital. */
  size: z.string(),
  /** The culture's colours (its dress), for trim. */
  colours: z.array(z.string()).optional(),
});
export type Locale = z.infer<typeof LocaleSchema>;

export type WallMaterial = "plank" | "plaster" | "stone";
export type RoofMaterial = "thatch" | "shingle";
/** gable: two slopes and gable ends; hip: four slopes; flat: a flat roof behind a parapet; round: a yurt's drum and cone. */
export type RoofForm = "gable" | "hip" | "flat" | "round";

export interface BuildShape {
  /** Whether this shape recolours the building (true only when styles.ts didn't already give it its materials). */
  materials: boolean;
  /** The style's name (the culture template it came from, or the land's fallback). */
  id: string;
  /** Walls rebuilt in this material (null: the template's own). */
  walls: WallMaterial | null;
  /** The ground floor in another material than the storey above (imperial stone under stucco), or null for the same. */
  base: WallMaterial | null;
  /** Roof re-laid in this material (null: the template's own). */
  roof: RoofMaterial | null;
  form: RoofForm;
  /** The roof's rise over half the building's depth. */
  pitch: number;
  /** The walls' height (tiles; a person is 1¼). */
  wallH: number;
  /** How far the eaves reach past the walls. */
  overhang: number;
  /** The walls' tint, multiplied into their art, and a gain over 1 for whitewash. */
  wallTint: string;
  wallGain: number;
  /** A shingle roof's colour (slate, terracotta, moss...) and a thatch roof's (weathered or fresh straw). */
  shingleTint: string;
  thatchTint: string;
  /** A stone footing showing above the ground (tiles), and its colour. */
  plinth: number;
  plinthTint: string;
  /** The floor raised on posts this high (the marsh), 0 for none. */
  stilts: number;
  /** An accent colour: a yurt's band, the parapet's coping. */
  trim: string;
}

type Base = Omit<BuildShape, "id" | "materials">;

/** Each culture's way of building, before the land and its wealth change it. */
const CULTURES: Record<string, Base> = {
  // Low, thick stone houses under steep slate, built against the wind.
  highland: { walls: "stone", roof: "shingle", base: null, form: "gable", pitch: 1.05, wallH: 1.65, overhang: 0.1, wallTint: "#ebe6dc", wallGain: 1.04, shingleTint: "#7c8894", thatchTint: "#b3a586", plinth: 0.12, plinthTint: "#5d5b5f", stilts: 0, trim: "#3c4f6b" },
  // Half-timbered plaster and thatch along the rivers: the old look, kept.
  river: { walls: null, roof: null, base: null, form: "gable", pitch: 0.8, wallH: 2, overhang: 0.2, wallTint: "#ffffff", wallGain: 1, shingleTint: "#8a5a3c", thatchTint: "#ffffff", plinth: 0.06, plinthTint: "#6e6c70", stilts: 0, trim: "#5a7a4a" },
  // Whitewashed walls under low terracotta hipped roofs, against the sun.
  coastal: { walls: "plaster", roof: "shingle", base: null, form: "hip", pitch: 0.5, wallH: 2, overhang: 0.24, wallTint: "#fbf6ea", wallGain: 1.14, shingleTint: "#cf6a3e", thatchTint: "#d8c48e", plinth: 0.1, plinthTint: "#d6cdbb", stilts: 0, trim: "#2a6b8a" },
  // Dark log walls, steep mossy shakes and deep eaves under the trees.
  forest: { walls: "plank", roof: "shingle", base: null, form: "gable", pitch: 1.12, wallH: 1.85, overhang: 0.3, wallTint: "#a5764e", wallGain: 1, shingleTint: "#5a6640", thatchTint: "#9a8c66", plinth: 0.1, plinthTint: "#4f4d50", stilts: 0, trim: "#3a5a2a" },
  // Felt yurts for homes; flat-roofed mud-brick for the rest.
  steppe: { walls: "plaster", roof: "shingle", base: null, form: "flat", pitch: 0, wallH: 1.9, overhang: 0, wallTint: "#d8a868", wallGain: 1, shingleTint: "#b08a58", thatchTint: "#c8aa70", plinth: 0.06, plinthTint: "#9a7a50", stilts: 0, trim: "#a83a2a" },
  // Tall cream stucco under red-tiled hipped roofs on stone footings.
  imperial: { walls: "plaster", roof: "shingle", base: "stone", form: "hip", pitch: 0.55, wallH: 2.35, overhang: 0.16, wallTint: "#f4ddb0", wallGain: 1.06, shingleTint: "#b5452c", thatchTint: "#c9b27a", plinth: 0.28, plinthTint: "#bdb6aa", stilts: 0, trim: "#8a2a2a" },
};

/** A culture this doesn't know is built the way its land suggests. */
/** The cultures whose poorer homes go thatched. */
const THATCHED = new Set(["highland", "river", "forest", "coastal"]);

const BY_LAND: Record<string, string> = { hills: "highland", forest: "forest", coast: "coastal", marsh: "coastal", plains: "river", valley: "river" };

export const SHAPE_STYLES = Object.keys(CULTURES);

export type BuildingRole = "home" | "civic" | "work" | "other";

/** What a building is for, by its kind: homes, the place's great buildings, workshops and barns, and the rest (stalls, tents, carts). */
export function roleOf(kind: string | undefined): BuildingRole {
  const k = kind ?? "house";
  if (k === "house" || k === "hut") return "home";
  if (["hall", "palace", "temple", "guildhall", "barracks", "manor", "inn"].includes(k)) return "civic";
  if (["smithy", "farm", "granary", "mine"].includes(k)) return "work";
  return "other";
}

const SIZE_BONUS: Record<string, number> = { hamlet: -0.15, village: -0.05, town: 0.05, city: 0.15, capital: 0.25 };

/** How grand a place is: its wealth, lifted by its size (0..~1.2). */
export const standingOf = (l: Locale): number => l.wealth + (SIZE_BONUS[l.size] ?? 0);

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967295;
}

/** A colour scaled towards black (k < 1) or white (k > 1), as hex. */
export function shade(hex: string, k: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const n = m ? parseInt(m[1]!, 16) : 0xffffff;
  const ch = (s: number) => {
    const c = (n >> s) & 255;
    const v = k <= 1 ? c * k : c + (255 - c) * (k - 1);
    return Math.max(0, Math.min(255, Math.round(v)));
  };
  return `#${((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, "0")}`;
}

export interface StyledBuilding {
  id: number | string;
  kind?: string;
  /** The template it wears (a market's stalls and a camp's tents keep theirs). */
  template?: string;
}

/**
 * The style a building is built in, or null to draw it as its template has it (no locale; a stall, tent or cart).
 * `key` makes the per-building variation stable across visits (the map and the building's id).
 */
export function shapeFor(locale: Locale | null | undefined, b: StyledBuilding, key = String(b.id)): BuildShape | null {
  if (!locale) return null;
  const role = roleOf(b.kind);
  // `<template>~<style>`: styles.ts has dressed it already; another people's hold (`~dwarf`) keeps the plain shape.
  const [template, look] = (b.template ?? "").split("~");
  if (look && !look.includes(".")) return null;
  const id = CULTURES[locale.culture] ? locale.culture : (BY_LAND[locale.terrain] ?? "river");
  const yurt = id === "steppe" && role === "home";
  if (role === "other" || template === "market" || template === "camp" || (template === "tent" && !yurt)) return null;
  const s: BuildShape = { id, materials: !look, ...CULTURES[id]! };
  const standing = standingOf(locale);
  const poor = standing < 0.42;
  const rich = standing > 0.66;
  if (locale.colours?.[0]) s.trim = locale.colours[0];

  // ---- the land ----
  if (locale.terrain === "marsh") {
    if (role === "civic") s.plinth = Math.max(s.plinth, 0.35);
    else s.stilts = 0.45;
    if (role !== "civic" && s.walls !== "stone") s.walls = "plank";
  }
  if (locale.terrain === "hills") {
    s.plinth = Math.max(s.plinth, 0.3);
    s.pitch += 0.1;
  }
  if (locale.terrain === "forest") {
    s.overhang += 0.1;
    if (role === "home" && s.walls === "plaster" && !rich) s.walls = "plank";
  }
  if (locale.terrain === "coast") {
    s.wallGain += 0.06;
    s.pitch = Math.max(0.35, s.pitch - 0.05);
  }

  // ---- what the building is for, and how well the place lives ----
  if (role === "home") {
    if (id === "steppe") {
      s.form = "round";
      s.wallH = 1.25;
      s.pitch = 0.55;
      s.overhang = 0.08;
      s.walls = null;
      s.base = null;
      s.wallTint = "#ece2cc";
      s.stilts = 0;
      s.plinth = 0.04;
    } else if (poor || (THATCHED.has(id) && hash(`${key}:thatch`) < Math.min(0.7, (0.62 - standing) * 1.6))) {
      // A poor place's homes, and in middling places some of them: lower, thatched, plainer.
      s.wallH -= 0.2;
      if (id !== "imperial" && id !== "steppe") s.roof = "thatch";
      if (s.form === "hip" && id !== "imperial") s.form = "gable";
      if (id === "river") s.walls = "plank";
      s.base = null;
    } else if (rich) {
      s.wallH += 0.35;
      if (s.walls === "plank" && id !== "forest") s.walls = "plaster";
      if (id === "river" && hash(`${key}:tile`) < 0.5) s.roof = "shingle";
    }
  } else if (role === "civic") {
    const great = b.kind !== "inn" && b.kind !== "barracks";
    s.wallH += great ? 0.55 : 0.3;
    if (great && id !== "steppe" && id !== "coastal") s.walls = "stone";
    if (s.walls === s.base) s.base = null;
    if (s.roof === "thatch" || (id === "river" && great)) s.roof = "shingle";
    s.plinth = Math.max(s.plinth, great ? 0.3 : 0.16);
    s.stilts = 0;
  } else {
    // Workshops and barns: a smithy stays stone; a barn is boards, thatched where the place is poor or rustic.
    if (b.kind === "smithy") s.walls = "stone";
    else if (id !== "steppe") s.walls = "plank";
    s.base = null;
    if ((b.kind === "farm" || b.kind === "granary") && (poor || id === "river")) s.roof = "thatch";
    if (b.kind === "farm" || b.kind === "granary") s.wallTint = id === "steppe" ? s.wallTint : shade(s.wallTint, 0.95);
  }

  // ---- each building its own: a little taller or lower, steeper or shallower, darker or lighter ----
  const u = (k: string) => hash(`${key}:${k}`) - 0.5;
  if (role === "home") s.wallH += u("h") * 0.24;
  if (s.form === "gable" || s.form === "hip") s.pitch = Math.max(0.3, s.pitch + u("p") * 0.16);
  const tone = 1 + u("t") * 0.14;
  s.wallTint = shade(s.wallTint, tone);
  s.shingleTint = shade(s.shingleTint, 1 + u("r") * 0.18);
  s.thatchTint = shade(s.thatchTint, 1 + u("r") * 0.12);
  s.wallH = Math.max(1.2, Math.min(3, s.wallH));
  if (!s.materials && s.form !== "round") {
    // styles.ts chose the materials: no tile swaps, and only the per-building tone, never the culture's tints.
    s.walls = s.roof = s.base = null;
    s.wallTint = shade("#ffffff", Math.min(1, tone));
    s.wallGain = 1;
    s.shingleTint = s.thatchTint = shade("#ffffff", Math.min(1, 1 + u("r") * 0.18));
  }
  return s;
}

const WALL_RE = /^buildings\/(plank|plaster|stone)_(l|m|r|win|side|gable)$/;
const ROOF_RE = /^buildings\/(thatch|shingle)_(top|mid|near)_(l|m|r)$/;

/** A wall or roof tile in the style's materials (anything else unchanged): `plank_win` → `stone_win`, `thatch_top_l` → `shingle_top_l`. */
export function restyleFrame(frame: string, s: BuildShape | null): string {
  if (!s) return frame;
  const w = s.walls ? WALL_RE.exec(frame) : null;
  if (w) return `buildings/${s.walls}_${w[2]}`;
  const r = s.roof ? ROOF_RE.exec(frame) : null;
  if (r) return `buildings/${s.roof}_${r[2]}_${r[3]}`;
  return frame;
}

/** The door that goes with the walls: a stone house gets the stone doorway, a timber one the wooden door (barn doors stay). */
export function restyleDoor(door: string, s: BuildShape | null): string {
  if (!s?.walls) return door;
  if (s.walls === "stone" && door === "buildings/door_wood") return "buildings/door_stone";
  if (s.walls !== "stone" && door === "buildings/door_stone") return "buildings/door_wood";
  return door;
}

/** Is this roof tile shingle (tinted by the style) or thatch (tinted only a little)? */
export const isShingle = (frame: string): boolean => frame.startsWith("buildings/shingle_");
