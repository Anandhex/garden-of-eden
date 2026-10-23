/**
 * The web adapter's art manifest (G6): every art id the server can send, mapped to frames of the packed sheets
 * (`npm run art`, public/art/*.png) and, behind them, to a texture drawn in code at start-up (world/textures.ts).
 * The code-drawn texture is only the fallback, per id: when a sheet didn't load or has no frame for the id (and the
 * console says so once). An id with no entry at all falls back by family, so nothing is ever drawn as an empty space.
 * No Phaser here, so the tests can check the manifest.
 */
import type { ArtId } from "@millbrook/shared/view";
import sheets from "./art/sheets.json" with { type: "json" };

export const GRASS_VARIANTS = 4;
export const PATH_VARIANTS = 3;

/** The packed frames: sheet, size and foot (logical px, 16 a tile) of each. */
export const FRAMES = sheets.frames as unknown as Record<string, { sheet: string; w: number; h: number; foot: [number, number]; props?: Record<string, string | boolean> }>;
export const SHEET_NAMES = sheets.sheets as string[];
/** Logical pixels a tile in the sources, and the scale the sheets are packed at (so a frame shows at 1/scale × 2). */
export const ART_TILE = sheets.tile;
export const ART_SCALE = sheets.scale;

export interface ArtEntry {
  /** The code-drawn texture key; with `variants`, keys are `${key}${n}` picked by a stable hash of the tile. */
  key: string;
  variants?: number;
}

/** The fallbacks: textures drawn in code (world/textures.ts). */
export const MANIFEST: Record<ArtId, ArtEntry> = {
  "terrain/grass": { key: "grass", variants: GRASS_VARIANTS },
  "terrain/path": { key: "path", variants: PATH_VARIANTS },
  "terrain/water": { key: "water" },
  "terrain/sand": { key: "sand" },
  "terrain/hill": { key: "hill" },
  "terrain/marsh": { key: "marsh" },
  "terrain/field": { key: "field" },
  "terrain/ford": { key: "ford" },
  "terrain/bridge": { key: "bridge" },
  "terrain/town": { key: "town" },
  "terrain/yard": { key: "yard" },
  "terrain/road": { key: "rpath", variants: 3 },
  "props/tree": { key: "tree" },
  "props/rock": { key: "rock" },
  "props/reeds": { key: "reeds" },
  "props/milestone": { key: "milestone" },
  "props/signpost": { key: "signpost" },
  "props/shrine": { key: "shrine" },
  "props/farmhouse": { key: "farmhouse" },
  "props/bar": { key: "bar" },
  "props/thatch": { key: "thatch" },
  "buildings/wall": { key: "stonewall" },
  "buildings/door": { key: "door" },
  "buildings/gate": { key: "gate" },
  "people/body": { key: "body" },
  "people/player": { key: "body" },
  "creature/wolf": { key: "beast" },
  "creature/bear": { key: "beast" },
  "creature/boar": { key: "beast" },
  "creature/spider": { key: "beast" },
  "creature/horse": { key: "beast" },
  "creature/beast": { key: "beast" },
  "fx/grave": { key: "grave" },
  "fx/shadow": { key: "shadow" },
  "fx/marker": { key: "marker" },
  "fx/drop": { key: "drop" },
  "fx/flake": { key: "flake" },
  "fx/ripple": { key: "ripple" },
  "fx/glow": { key: "lantern" },
  "fx/firefly": { key: "spark" },
  "fx/dust": { key: "spark" },
  "fx/fog": { key: "flake" },
  "fx/shaft": { key: "spark" },
  "fx/leaves": { key: "tree" },
};

const FALLBACK: Record<string, ArtEntry> = { terrain: { key: "grass", variants: GRASS_VARIANTS }, props: { key: "rock" }, buildings: { key: "stonewall" }, people: { key: "body" }, creature: { key: "beast" }, fx: { key: "spark" } };

const v = (base: string, n: number) => Array.from({ length: n }, (_, i) => `${base}_${i}`);
const dirs = (base: string, steps: number) => ["s", "n", "e", "w"].flatMap((d) => Array.from({ length: steps }, (_, i) => `${base}/${d}${i}`));

/**
 * How each id is drawn from the sheets: `frames` (variants by tile hash, or the one frame), `person` (a base name
 * whose `<dir><step>.<layer>` frames make a four-way walk), `side` (a creature's `e<n>`/`w<n>` trot) or `wall`
 * (the face, and the top for a wall with wall to its south).
 */
export interface SheetArt {
  frames?: string[];
  person?: string;
  side?: string;
  wall?: { face: string; top: string };
}

export const SHEET_ART: Record<ArtId, SheetArt> = {
  "terrain/grass": { frames: v("terrain/grass", 4) },
  "terrain/path": { frames: v("terrain/path", 3) },
  "terrain/water": { frames: v("terrain/water", 2) },
  "terrain/sand": { frames: ["terrain/sand_0"] },
  "terrain/hill": { frames: ["terrain/hill_0"] },
  "terrain/marsh": { frames: ["terrain/marsh_0"] },
  "terrain/field": { frames: ["terrain/field_0"] },
  "terrain/ford": { frames: ["terrain/ford_0"] },
  "terrain/bridge": { frames: ["terrain/bridge_0"] },
  "terrain/town": { frames: ["terrain/town_0"] },
  "terrain/yard": { frames: ["terrain/yard_0"] },
  "terrain/road": { frames: v("terrain/road", 3) },
  "props/tree": { frames: ["props/tree_0", "props/tree_0", "props/tree_1"] },
  "props/rock": { frames: ["props/rock"] },
  "props/reeds": { frames: ["props/reeds"] },
  "props/milestone": { frames: ["props/milestone"] },
  "props/signpost": { frames: ["props/signpost"] },
  "props/shrine": { frames: ["props/shrine"] },
  "props/farmhouse": { frames: ["props/farmhouse"] },
  "props/bar": { frames: ["props/bar"] },
  "props/thatch": { frames: ["props/thatch"] },
  "buildings/wall": { wall: { face: "buildings/wall_face", top: "buildings/wall_top" } },
  "buildings/door": { frames: ["buildings/door"] },
  "buildings/gate": { frames: ["buildings/gate"] },
  "people/body": { person: "people/body" },
  "people/player": { person: "people/body" },
  "creature/wolf": { side: "creature/wolf" },
  "creature/bear": { side: "creature/bear" },
  "creature/boar": { side: "creature/boar" },
  "creature/spider": { side: "creature/spider" },
  "creature/horse": { side: "creature/horse" },
  "creature/beast": { side: "creature/beast" },
  "fx/grave": { frames: ["fx/grave"] },
  "fx/shadow": { frames: ["fx/shadow"] },
  "fx/marker": { frames: ["fx/marker"] },
  "fx/drop": { frames: ["fx/drop"] },
  "fx/flake": { frames: ["fx/flake"] },
  "fx/ripple": { frames: ["fx/ripple"] },
  "fx/glow": { frames: ["fx/glow"] },
  "fx/firefly": { frames: ["fx/firefly"] },
  "fx/dust": { frames: ["fx/dust"] },
  "fx/fog": { frames: ["fx/fog"] },
  "fx/shaft": { frames: ["fx/shaft"] },
  "fx/leaves": { frames: ["fx/leaves"] },
};

/** The layers of a person, bottom to top. */
export const PERSON_LAYERS = ["body", "cloth", "hair", "trim"] as const;
export const PERSON_STEPS = 3;
export const SIDE_STEPS = 2;

/** Every frame name an id's sheet art uses. */
export function framesOf(id: string): string[] {
  const s = (SHEET_ART as Record<string, SheetArt>)[id];
  if (!s) return [];
  if (s.frames) return s.frames;
  if (s.wall) return [s.wall.face, s.wall.top];
  if (s.person) return dirs(s.person, PERSON_STEPS).flatMap((f) => PERSON_LAYERS.map((l) => `${f}.${l}`));
  if (s.side) return ["e", "w"].flatMap((d) => Array.from({ length: SIDE_STEPS }, (_, i) => `${s.side}/${d}${i}`));
  return [];
}

/** Sheets that loaded (set by the scene); until then everything is the fallback. */
const loaded = new Set<string>();
export function sheetsLoaded(names: Iterable<string>): void {
  loaded.clear();
  for (const n of names) loaded.add(n);
}

/** Has this frame been packed, and did its sheet load? */
export const hasFrame = (frame: string): boolean => !!FRAMES[frame] && loaded.has(FRAMES[frame]!.sheet);

const warned = new Set<string>();
/** Say once that an id is drawn by its fallback (the G6 replay check looks for these). */
export function warnMissing(id: string): void {
  if (warned.has(id)) return;
  warned.add(id);
  console.warn(`[art] no sheet art for ${id}: drawing the fallback`);
}

/** What to draw: a sheet's frame (`sheet` set) or a code-drawn texture (`sheet` null), and its origin and scale. */
export interface Pick {
  sheet: string | null;
  frame: string;
  ox: number;
  oy: number;
  scale: number;
}

/** A sheet frame as a pick: its foot as the origin, at the scale that shows 16 px as half a 64 px cell. */
export function pickFrame(frame: string): Pick | null {
  const f = FRAMES[frame];
  if (!f || !loaded.has(f.sheet)) return null;
  return { sheet: f.sheet, frame, ox: f.foot[0] / f.w, oy: f.foot[1] / f.h, scale: 2 / ART_SCALE };
}

/** The code-drawn texture for an art id at a tile (`hash` 0–1 picks a variant). */
export function textureFor(id: string, hash = 0): string {
  const e = (MANIFEST as Record<string, ArtEntry>)[id] ?? FALLBACK[id.split("/")[0]!] ?? { key: "spark" };
  return e.variants ? `${e.key}${Math.min(e.variants - 1, Math.floor(hash * e.variants))}` : e.key;
}

/** The art for an id with `frames` (terrain, props, doors, fx): a variant by `hash`, else the fallback (origin top-left). */
export function pickArt(id: string, hash = 0): Pick {
  const frames = (SHEET_ART as Record<string, SheetArt>)[id]?.frames;
  if (frames && frames.length > 0) {
    const p = pickFrame(frames[Math.min(frames.length - 1, Math.floor(hash * frames.length))]!);
    if (p) return p;
  }
  warnMissing(id);
  return { sheet: null, frame: textureFor(id, hash), ox: 0, oy: 0, scale: 1 };
}

/** The ids (of those given) that would be drawn by their fallback with every sheet loaded. */
export function missingArt(ids: Iterable<string>): string[] {
  const out = new Set<string>();
  for (const id of ids) {
    const frames = framesOf(id);
    if (frames.length === 0 || frames.some((f) => !FRAMES[f])) out.add(id);
  }
  return [...out];
}

/** How an actor's sprite is drawn: a person (layered body), a beast, or a grave. */
export const lookOf = (sprite: string): "person" | "beast" | "grave" => (sprite === "fx/grave" ? "grave" : sprite.startsWith("creature/") ? "beast" : "person");
