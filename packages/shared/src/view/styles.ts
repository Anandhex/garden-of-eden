/**
 * Regional building styles (G8): a place is built the way its people build, with what its land gives them. The same
 * templates (templates.ts) dress every building; a style swaps their materials, frame by frame, and may give a kind
 * of building another template (the steppe's felt tents for houses, a goblin's hut).
 *
 * A style id has up to three parts, `<culture>.<terrain>[.rich]`, or names another people outright (`dwarf`, `orc`...):
 * - the **culture** (the kingdom's way of life, N53) picks the roofs and what its people insist on: tiled roofs and
 *   whitewashed walls on the coast, sod roofs in the northern forests, felt tents on the steppe, brick halls in the
 *   imperial south;
 * - the **terrain** picks the walls of ordinary houses from what is to hand: fieldstone in the hills, logs in the forest,
 *   wattle and daub in the marsh, timber and plaster on the plains;
 * - **rich** places (cities and capitals) roof their cottages in the culture's fine roof instead of straw.
 *
 * The server sends a building's template as `<template>~<style>` (frame.ts); `templateById` makes the styled template
 * on demand, so the templates file and the art packer know nothing of styles beyond the material frames themselves.
 */
import { TEMPLATES, templateFor, type BuildingTemplate } from "./templates.js";

export const CULTURE_STYLES = ["highland", "river", "coastal", "forest", "steppe", "imperial"] as const;
export const TERRAIN_STYLES = ["valley", "hills", "forest", "plains", "coast", "marsh"] as const;
/** Other peoples build their own way wherever they live. */
export const PEOPLE_STYLES = ["dwarf", "orc", "goblin", "elf", "centaur", "lizardfolk", "ogre"] as const;

type Swap = Record<string, string>;

interface Part {
  /** Frame (or frame-name prefix ending `_`) → its replacement. */
  swap: Swap;
  /** A building kind → the template it wears here instead. */
  kinds?: Record<string, string>;
  /** Words for the place's look (the tip on the place, the admin view). */
  words: string;
}

// ---- materials, as swaps ----
const ROOF = {
  reed: { "buildings/thatch_": "buildings/reed_" },
  slate: { "buildings/thatch_": "buildings/slate_", "buildings/shingle_": "buildings/slate_" },
  tile: { "buildings/thatch_": "buildings/tile_", "buildings/shingle_": "buildings/tile_" },
  turf: { "buildings/thatch_": "buildings/turf_" },
  bark: { "buildings/shingle_": "buildings/bark_" },
  felt: { "buildings/thatch_": "buildings/felt_", "buildings/shingle_": "buildings/felt_", "buildings/canvas_": "buildings/felt_", "buildings/tent_": "buildings/yurt_" },
  hide: { "buildings/thatch_": "buildings/hide_", "buildings/shingle_": "buildings/hide_" },
} satisfies Record<string, Swap>;

const WALL = {
  stone: { "buildings/plaster_": "buildings/stone_", "buildings/door_wood": "buildings/door_stone" },
  log: { "buildings/plaster_": "buildings/log_", "buildings/plank_": "buildings/log_", "buildings/door_wood": "buildings/log_door", "buildings/door_barn": "buildings/log_door" },
  white: { "buildings/plaster_": "buildings/white_", "buildings/door_wood": "buildings/white_door" },
  daub: { "buildings/plaster_": "buildings/daub_", "buildings/door_wood": "buildings/daub_door" },
  ochre: { "buildings/plaster_": "buildings/ochre_", "buildings/door_wood": "buildings/ochre_door" },
  brick: { "buildings/stone_": "buildings/brick_", "buildings/door_stone": "buildings/brick_door", "buildings/forge_mouth": "buildings/brick_forge" },
  sand: { "buildings/stone_": "buildings/sand_", "buildings/door_stone": "buildings/sand_door", "buildings/forge_mouth": "buildings/sand_forge" },
  dark: {
    "buildings/plaster_": "buildings/darkstone_",
    "buildings/plank_": "buildings/darkstone_",
    "buildings/stone_": "buildings/darkstone_",
    "buildings/door_wood": "buildings/darkstone_door",
    "buildings/door_barn": "buildings/darkstone_door",
    "buildings/door_stone": "buildings/darkstone_door",
    "buildings/forge_mouth": "buildings/darkstone_forge",
  },
  skin: { "buildings/plaster_": "buildings/skin_", "buildings/plank_": "buildings/skin_", "buildings/door_wood": "buildings/skin_door", "buildings/door_barn": "buildings/skin_door" },
} satisfies Record<string, Swap>;

/** What a culture's people build: roofs, and the walls they insist on whatever the land (`walls`, applied over the terrain's). */
const CULTURE: Record<(typeof CULTURE_STYLES)[number], Part & { walls?: Swap; fine: Swap }> = {
  highland: { swap: { ...ROOF.reed, "buildings/shingle_": "buildings/slate_" }, fine: ROOF.slate, words: "dark heather thatch, and slate on the great houses" },
  river: { swap: {}, fine: { "buildings/thatch_": "buildings/shingle_" }, words: "straw thatch over timber and plaster" },
  coastal: { swap: ROOF.tile, walls: WALL.white, fine: ROOF.tile, words: "red tiled roofs over whitewashed walls" },
  forest: { swap: { ...ROOF.turf, ...ROOF.bark }, fine: { ...ROOF.turf, ...ROOF.bark }, words: "sod roofs and bark shingles" },
  steppe: { swap: ROOF.felt, walls: { ...WALL.daub, ...WALL.sand }, fine: ROOF.felt, kinds: { house: "tent", hut: "tent" }, words: "round felt tents, and halls of sun-dried brick" },
  imperial: { swap: ROOF.tile, walls: { ...WALL.ochre, ...WALL.brick }, fine: ROOF.tile, words: "tiled roofs, ochre stucco houses and brick halls" },
};

/** What the land gives for ordinary walls. */
const TERRAIN: Record<(typeof TERRAIN_STYLES)[number], Part> = {
  valley: { swap: {}, words: "timber and plaster" },
  plains: { swap: {}, words: "timber and plaster" },
  hills: { swap: WALL.stone, words: "fieldstone walls" },
  forest: { swap: WALL.log, words: "log walls" },
  coast: { swap: WALL.white, words: "whitewashed walls" },
  marsh: { swap: { ...WALL.daub, ...ROOF.reed }, words: "wattle and daub under reed thatch" },
};

const PEOPLE: Record<(typeof PEOPLE_STYLES)[number], Part> = {
  dwarf: { swap: { ...WALL.dark, ...ROOF.slate }, words: "dark dressed stone and slate, built to outlast the hill" },
  orc: { swap: { ...WALL.skin, "buildings/stone_": "buildings/log_", "buildings/door_stone": "buildings/log_door", ...ROOF.hide }, words: "hide-hung lodges on rough logs" },
  goblin: { swap: { ...WALL.daub, ...ROOF.turf, ...ROOF.bark }, kinds: { house: "house_c", inn: "house_c" }, words: "mud huts under turf" },
  elf: { swap: { ...WALL.log, ...ROOF.turf, ...ROOF.bark }, words: "living roofs on hewn logs" },
  centaur: { swap: ROOF.felt, kinds: { house: "tent", hut: "tent", inn: "tent", hall: "tent" }, words: "felt tents, struck and pitched with the seasons" },
  lizardfolk: { swap: { ...WALL.daub, ...ROOF.reed }, words: "reed and mud on the marsh" },
  ogre: { swap: { ...WALL.skin, ...ROOF.hide }, kinds: { house: "house_c" }, words: "a heap of hides and logs" },
};

export interface ArchStyle {
  id: string;
  swap: Swap;
  kinds: Record<string, string>;
  words: string;
}

const isOf = <T extends string>(xs: readonly T[], x: string | undefined): x is T => !!x && (xs as readonly string[]).includes(x);

/**
 * The style id of a place: other peoples build their own way; otherwise its culture's way with the land's walls, and
 * rich places roof in the culture's fine roof. Undefined when nothing is known (the plain look).
 */
export function styleIdFor(o: { culture?: string | null; terrain?: string | null; species?: string | null; kind?: string | null }): string | undefined {
  if (o.species && o.species !== "human") return isOf(PEOPLE_STYLES, o.species) ? o.species : undefined;
  if (!isOf(CULTURE_STYLES, o.culture ?? undefined)) return undefined;
  const terrain = isOf(TERRAIN_STYLES, o.terrain ?? undefined) ? o.terrain : "plains";
  const rich = o.kind === "city" || o.kind === "capital";
  return `${o.culture}.${terrain}${rich ? ".rich" : ""}`;
}

const cache = new Map<string, ArchStyle | null>();

/** A style by id (null for an id this build doesn't know: the building wears its plain template). */
export function archStyle(id: string): ArchStyle | null {
  if (cache.has(id)) return cache.get(id)!;
  let out: ArchStyle | null = null;
  const [a, b, c] = id.split(".");
  if (isOf(PEOPLE_STYLES, a) && b === undefined) {
    const p = PEOPLE[a];
    out = { id, swap: { ...p.swap }, kinds: { ...(p.kinds ?? {}) }, words: p.words };
  } else if (isOf(CULTURE_STYLES, a) && isOf(TERRAIN_STYLES, b) && (c === undefined || c === "rich")) {
    const cu = CULTURE[a];
    const te = TERRAIN[b];
    // The land's walls, then what the culture insists on, then its roofs (the fine roof in a rich place).
    out = { id, swap: { ...te.swap, ...(cu.walls ?? {}), ...cu.swap, ...(c === "rich" ? cu.fine : {}) }, kinds: { ...(cu.kinds ?? {}) }, words: `${cu.words}; ${te.words}${c === "rich" ? ", and the fine roofs of a rich place" : ""}` };
  }
  cache.set(id, out);
  return out;
}

/** A frame in a style: the longest matching prefix in the swap wins (a whole family `buildings/thatch_`, or one frame). */
export function styledFrame(style: ArchStyle, frame: string): string {
  if (style.swap[frame]) return style.swap[frame]!;
  let best = "";
  for (const k of Object.keys(style.swap)) if (k.endsWith("_") && frame.startsWith(k) && k.length > best.length) best = k;
  return best ? style.swap[best]! + frame.slice(best.length) : frame;
}

const styled = new Map<string, BuildingTemplate | undefined>();

/**
 * A template by id, styled when the id says `<template>~<style>`. An unknown style leaves the template plain; an
 * unknown template is undefined (as `TEMPLATES[id]` is). A roof whose material the style changed is not tinted by
 * the building's colour (slate and tiles have their own); one it kept (a market's canvas, river shingles) still is.
 */
export function templateById(id: string): BuildingTemplate | undefined {
  if (styled.has(id)) return styled.get(id);
  const at = id.indexOf("~");
  if (at < 0) return TEMPLATES[id];
  const base = TEMPLATES[id.slice(0, at)];
  const style = archStyle(id.slice(at + 1));
  let out: BuildingTemplate | undefined = base;
  if (base && style) {
    const f = (x: string | null) => (x ? styledFrame(style, x) : x);
    const roof = base.roof.map((r) => r.map(f));
    const roofChanged = roof.some((r, i) => r.some((x, j) => x !== base.roof[i]![j]));
    out = {
      ...base,
      roof,
      walls: base.walls.map((r) => r.map(f)),
      door: f(base.door)!,
      porch: base.porch,
      roofTint: base.roofTint && !roofChanged,
      props: base.props.map((p) => (p.art ? { ...p, art: f(p.art)! } : p)),
    };
  }
  styled.set(id, out);
  return out;
}

/**
 * The template a building wears in a place of `styleId` (G8): `templateFor`'s pick (the style's own template for its
 * kind where it has one), as `<template>~<style>` when the style is known. No style: exactly `templateFor`.
 */
export function templateForStyle(kind: string | undefined, name: string, key: string, styleId: string | undefined): string {
  const plain = templateFor(kind, name, key);
  const style = styleId ? archStyle(styleId) : null;
  if (!style) return plain;
  const own = kind ? style.kinds[kind] : undefined;
  return `${own && TEMPLATES[own] ? own : plain}~${style.id}`;
}
