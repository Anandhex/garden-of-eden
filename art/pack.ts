/**
 * `npm run art` (G6): the art pipeline. Reads the hand-made sources and writes everything the adapters load.
 *
 * - art/palette.txt and art/sprites/<sheet>.txt: pixel art as text, 16 px a tile, one character a pixel.
 * - packages/client/public/art/<sheet>.png + .json: texture atlases (each pixel ×4, so a tile is 64 px) with Phaser
 *   JSON-hash frames; the web adapter shows them at 32 px a tile, nearest-neighbour.
 * - packages/client/src/adapter/web/art/sheets.json: every frame's sheet, size and foot (where it stands).
 * - art/tiled/<sheet>.png + .tsj: Tiled tilesets of the 16 px tiles, with the Wang (autotile) sets, so the
 *   templates can be edited in Tiled. Tile numbers stay put: a tile keeps its place, new ones go at the end.
 * - packages/shared/src/view/templates.json: the building templates (art/tiled/templates/*.tmj), read into plain
 *   JSON that every adapter and the server's frame builder share.
 *
 * `packAll()` does it all in memory (the G6 test checks the committed files are what it makes now).
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { encodePng } from "./png.js";

export const ROOT = fileURLToPath(new URL("../", import.meta.url));
/** Logical pixels a tile, and the scale the atlases are written at (a tile is 64 px in the PNG). */
export const TILE_PX = 16;
export const SCALE = 4;
export const SHEETS = ["terrain", "buildings", "props", "people", "creatures", "fx"] as const;
/** The sheets that are grids of tiles, so Tiled can use them. */
const TILESETS = ["terrain", "buildings"] as const;
const LAYERS = ["cloth", "hair", "trim"] as const;

export interface PaletteEntry {
  rgba: [number, number, number, number];
  name: string;
  layer?: (typeof LAYERS)[number];
}

export interface Frame {
  name: string;
  sheet: string;
  w: number;
  h: number;
  /** w*h*4, logical pixels. */
  px: Uint8Array;
  /** The pixel that stands on the spot it's drawn at (bottom-middle of a tile for a 16×16). */
  foot: [number, number];
  props: Record<string, string | boolean>;
}

// ---------- reading ----------

export function readPalette(text: string): Map<string, PaletteEntry> {
  const pal = new Map<string, PaletteEntry>();
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("# ") || t === "#") continue;
    const [ch, hex, name, layer] = t.split(/\s+/);
    if (!ch || ch.length !== 1 || !hex || !/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(hex)) throw new Error(`palette: bad line "${line}"`);
    if (ch === ".") throw new Error("palette: '.' is transparent");
    if (pal.has(ch)) throw new Error(`palette: '${ch}' twice`);
    const n = (i: number) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
    if (layer && !(LAYERS as readonly string[]).includes(layer)) throw new Error(`palette: unknown layer ${layer}`);
    pal.set(ch, { rgba: [n(0), n(1), n(2), hex.length === 9 ? n(3) : 255], name: name ?? ch, layer: layer as PaletteEntry["layer"] });
  }
  return pal;
}

interface Source {
  name: string;
  sheet: string;
  w: number;
  h: number;
  rows: string[];
  opts: Record<string, string>;
  line: number;
}

/** `== name [WxH] [key=value | flag]...` then the rows; a blank line or the next `==` ends a sprite. */
export function readSources(sheet: string, text: string, file = `${sheet}.txt`): Source[] {
  const out: Source[] = [];
  let cur: Source | null = null;
  const lines = text.split("\n");
  const end = () => {
    if (!cur) return;
    if (cur.rows.length > 0) {
      if (!cur.w) cur.w = cur.rows[0]!.length;
      if (!cur.h) cur.h = cur.rows.length;
      cur.rows.forEach((r, i) => {
        if (r.length !== cur!.w) throw new Error(`${file}:${cur!.line + 1 + i}: ${cur!.name} row ${i} is ${r.length} wide, not ${cur!.w}`);
      });
      if (cur.rows.length !== cur.h && !cur.opts.base) throw new Error(`${file}:${cur.line}: ${cur.name} has ${cur.rows.length} rows, not ${cur.h}`);
    }
    out.push(cur);
    cur = null;
  };
  lines.forEach((raw, i) => {
    const line = raw.replace(/\s+$/, "");
    if (line.startsWith("==")) {
      end();
      const [name, ...rest] = line.slice(2).trim().split(/\s+/);
      if (!name) throw new Error(`${file}:${i + 1}: a sprite needs a name`);
      const opts: Record<string, string> = {};
      let w = 0;
      let h = 0;
      for (const r of rest) {
        const size = /^(\d+)x(\d+)$/.exec(r);
        if (size) [w, h] = [Number(size[1]), Number(size[2])];
        else if (r.includes("=")) opts[r.slice(0, r.indexOf("="))] = r.slice(r.indexOf("=") + 1);
        else opts[r] = "true";
      }
      cur = { name, sheet, w, h, rows: [], opts, line: i + 1 };
    } else if (cur && line.length > 0 && !line.startsWith("#")) cur.rows.push(line);
    else if (cur && line.length === 0 && cur.rows.length > 0) end();
  });
  end();
  return out;
}

// ---------- making frames ----------

function blank(w: number, h: number): Uint8Array {
  return new Uint8Array(w * h * 4);
}

function paint(src: Source, pal: Map<string, PaletteEntry>, only?: string): Uint8Array {
  const px = blank(src.w, src.h);
  src.rows.forEach((row, y) =>
    [...row].forEach((ch, x) => {
      if (ch === ".") return;
      const c = pal.get(ch);
      if (!c) throw new Error(`${src.sheet}.txt:${src.line + 1 + y}: ${src.name} uses '${ch}', which isn't in the palette`);
      if (only !== undefined && (c.layer ?? "body") !== only) return;
      px.set(c.rgba, (y * src.w + x) * 4);
    }),
  );
  return px;
}

function mirror(px: Uint8Array, w: number, h: number): Uint8Array {
  const out = blank(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out.set(px.subarray((y * w + x) * 4, (y * w + x) * 4 + 4), (y * w + (w - 1 - x)) * 4);
  return out;
}

/** A small stable noise in -1..1 per pixel (so the generated edges are ragged, and the same every run). */
function noise(x: number, y: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (((h ^ (h >>> 16)) >>> 0) / 4294967295) * 2 - 1;
}

/** Wang corner bits: which corners are the overlay terrain. */
export const WANG = { TL: 1, TR: 2, BR: 4, BL: 8 } as const;

/**
 * The 16 corner tiles between a base terrain and an overlay (grass and path, say): each pixel takes the overlay
 * where the corners' blend says so, with a ragged edge drawn in `edge` (and `rim` on the base side, if given).
 */
function wangTiles(over: Uint8Array, base: Uint8Array, edge: PaletteEntry, rim: PaletteEntry | undefined, seed: number): Uint8Array[] {
  const n = TILE_PX;
  const tiles: Uint8Array[] = [];
  for (let mask = 0; mask < 16; mask++) {
    const inside = new Uint8Array(n * n);
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const u = (x + 0.5) / n;
        const v = (y + 0.5) / n;
        const c = (b: number) => (mask & b ? 1 : 0);
        const val = c(WANG.TL) * (1 - u) * (1 - v) + c(WANG.TR) * u * (1 - v) + c(WANG.BR) * u * v + c(WANG.BL) * (1 - u) * v;
        inside[y * n + x] = mask === 15 || (mask !== 0 && val + noise(x, y, seed) * 0.09 > 0.5) ? 1 : 0;
      }
    }
    const px = blank(n, n);
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const at = y * n + x;
        const near = (dx: number, dy: number) => {
          const xx = x + dx;
          const yy = y + dy;
          return xx < 0 || yy < 0 || xx >= n || yy >= n ? inside[at] : inside[yy * n + xx];
        };
        const border = near(1, 0) !== inside[at] || near(-1, 0) !== inside[at] || near(0, 1) !== inside[at] || near(0, -1) !== inside[at];
        if (inside[at]) px.set(border ? edge.rgba : over.subarray(at * 4, at * 4 + 4), at * 4);
        else px.set(border && rim ? rim.rgba : base.subarray(at * 4, at * 4 + 4), at * 4);
      }
    }
    tiles.push(px);
  }
  return tiles;
}

function parseFoot(s: string | undefined, w: number, h: number): [number, number] {
  if (!s) return [w / 2, h];
  const [x, y] = s.split(",").map(Number);
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error(`bad foot "${s}"`);
  return [x!, y!];
}

const RESERVED = new Set(["foot", "mirror", "split", "wang", "over", "base", "edge", "rim", "seed"]);

/** An overlay on an earlier frame: `.` keeps the base pixel, `,` clears it, and the last row repeats to the bottom. */
function overlay(s: Source, base: Frame, pal: Map<string, PaletteEntry>): Uint8Array {
  if (s.w !== base.w) throw new Error(`${s.sheet}.txt:${s.line}: ${s.name} is ${s.w} wide, its base ${base.name} ${base.w}`);
  const px = base.px.slice();
  for (let y = 0; y < base.h; y++) {
    const row = s.rows[Math.min(y, s.rows.length - 1)]!;
    [...row].forEach((ch, x) => {
      if (ch === ".") return;
      const at = (y * base.w + x) * 4;
      if (ch === ",") return void px.fill(0, at, at + 4);
      const c = pal.get(ch);
      if (!c) throw new Error(`${s.sheet}.txt:${s.line}: ${s.name} uses '${ch}', which isn't in the palette`);
      px.set(c.rgba, at);
    });
  }
  return px;
}

/** Every frame of every sheet, in source order. */
export function makeFrames(pal: Map<string, PaletteEntry>, sources: Source[]): Frame[] {
  const frames: Frame[] = [];
  const byName = new Map<string, Frame>();
  const add = (f: Frame) => {
    if (byName.has(f.name)) throw new Error(`two frames called ${f.name}`);
    byName.set(f.name, f);
    frames.push(f);
  };
  for (const s of sources) {
    const props: Record<string, string | boolean> = {};
    for (const [k, v] of Object.entries(s.opts)) if (!RESERVED.has(k)) props[k] = v === "true" ? true : v;
    if (s.opts.wang) {
      const over = byName.get(s.opts.over ?? "");
      const base = byName.get(s.opts.base ?? "");
      const edge = pal.get(s.opts.edge ?? "");
      if (!over || !base || !edge) throw new Error(`${s.name}: a wang set needs over=, base= (earlier frames) and edge= (a palette colour)`);
      const rim = s.opts.rim ? pal.get(s.opts.rim) : undefined;
      wangTiles(over.px, base.px, edge, rim, Number(s.opts.seed ?? s.name.length)).forEach((px, mask) =>
        add({ name: `${s.name}_${mask}`, sheet: s.sheet, w: TILE_PX, h: TILE_PX, px, foot: [TILE_PX / 2, TILE_PX], props: { ...props, wang: s.name, mask: String(mask) } }),
      );
      continue;
    }
    if (s.opts.mirror) {
      const prefix = s.opts.mirror;
      const from = byName.get(prefix);
      // A split sprite mirrors layer by layer.
      const parts = from ? [from] : frames.filter((f) => f.name.startsWith(`${prefix}.`));
      if (parts.length === 0) throw new Error(`${s.name}: mirror of unknown ${prefix}`);
      for (const p of parts) add({ ...p, name: s.name + p.name.slice(prefix.length), px: mirror(p.px, p.w, p.h), foot: [p.w - p.foot[0], p.foot[1]], props: { ...p.props, ...props } });
      continue;
    }
    if (s.rows.length === 0) throw new Error(`${s.sheet}.txt:${s.line}: ${s.name} has no pixels`);
    if (s.opts.base) {
      const base = byName.get(s.opts.base);
      if (!base) throw new Error(`${s.sheet}.txt:${s.line}: ${s.name}'s base ${s.opts.base} isn't an earlier frame`);
      add({ name: s.name, sheet: s.sheet, w: base.w, h: base.h, px: overlay(s, base, pal), foot: s.opts.foot ? parseFoot(s.opts.foot, base.w, base.h) : base.foot, props: { ...base.props, ...props } });
      continue;
    }
    const foot = parseFoot(s.opts.foot, s.w, s.h);
    if (s.opts.split) {
      for (const layer of ["body", ...LAYERS]) add({ name: `${s.name}.${layer}`, sheet: s.sheet, w: s.w, h: s.h, px: paint(s, pal, layer), foot, props });
    } else add({ name: s.name, sheet: s.sheet, w: s.w, h: s.h, px: paint(s, pal), foot, props });
  }
  return frames;
}

// ---------- atlases ----------

export interface Atlas {
  w: number;
  h: number;
  rgba: Uint8Array;
  json: { frames: Record<string, unknown>; meta: Record<string, unknown> };
}

/** Shelf-pack a sheet's frames, each pixel SCALE×SCALE, with a gap so neighbours never bleed. */
export function packAtlas(sheet: string, frames: Frame[], maxW = 1024): Atlas {
  const gap = 2;
  const sorted = [...frames].sort((a, b) => b.h - a.h || b.w - a.w || (a.name < b.name ? -1 : 1));
  const spots = new Map<string, { x: number; y: number }>();
  let x = 0;
  let y = 0;
  let shelf = 0;
  let width = 0;
  for (const f of sorted) {
    const fw = f.w * SCALE;
    const fh = f.h * SCALE;
    if (x + fw > maxW) {
      x = 0;
      y += shelf + gap;
      shelf = 0;
    }
    spots.set(f.name, { x, y });
    x += fw + gap;
    width = Math.max(width, x - gap);
    shelf = Math.max(shelf, fh);
  }
  const W = Math.max(4, Math.ceil(width / 4) * 4);
  const H = Math.max(4, Math.ceil((y + shelf) / 4) * 4);
  const rgba = new Uint8Array(W * H * 4);
  const json: Atlas["json"] = { frames: {}, meta: { app: "millbrook art/pack.ts", version: "1", image: `${sheet}.png`, format: "RGBA8888", size: { w: W, h: H }, scale: "1" } };
  for (const f of frames) {
    const at = spots.get(f.name)!;
    for (let py = 0; py < f.h; py++) {
      for (let px = 0; px < f.w; px++) {
        const c = f.px.subarray((py * f.w + px) * 4, (py * f.w + px) * 4 + 4);
        if (c[3] === 0) continue;
        for (let dy = 0; dy < SCALE; dy++) for (let dx = 0; dx < SCALE; dx++) rgba.set(c, ((at.y + py * SCALE + dy) * W + at.x + px * SCALE + dx) * 4);
      }
    }
    const fw = f.w * SCALE;
    const fh = f.h * SCALE;
    json.frames[f.name] = { frame: { x: at.x, y: at.y, w: fw, h: fh }, rotated: false, trimmed: false, spriteSourceSize: { x: 0, y: 0, w: fw, h: fh }, sourceSize: { w: fw, h: fh } };
  }
  return { w: W, h: H, rgba, json };
}

// ---------- Tiled tilesets ----------

interface TsjTile {
  id: number;
  properties: Array<{ name: string; type: string; value: string | boolean }>;
}
interface Tsj {
  tiles?: TsjTile[];
}

const artOf = (t: TsjTile) => t.properties.find((p) => p.name === "art")?.value as string | undefined;

/** The tileset for a grid sheet: every 16×16 frame keeps the place it had in the old .tsj; new frames go at the end. */
export function makeTileset(sheet: string, frames: Frame[], old: Tsj | null): { order: Array<Frame | null>; tsj: Record<string, unknown>; png: { w: number; h: number; rgba: Uint8Array } } {
  const tiles = frames.filter((f) => f.w === TILE_PX && f.h === TILE_PX);
  const byName = new Map(tiles.map((f) => [f.name, f]));
  const order: Array<Frame | null> = [];
  for (const t of [...(old?.tiles ?? [])].sort((a, b) => a.id - b.id)) {
    while (order.length < t.id) order.push(null);
    const name = artOf(t);
    order.push(name && byName.has(name) ? byName.get(name)! : null);
  }
  const placed = new Set(order.filter((f): f is Frame => !!f).map((f) => f.name));
  for (const f of tiles) if (!placed.has(f.name)) order.push(f);
  const cols = 16;
  const cell = TILE_PX * SCALE;
  const rows = Math.ceil(order.length / cols);
  const W = cols * cell;
  const H = Math.max(1, rows) * cell;
  const rgba = new Uint8Array(W * H * 4);
  order.forEach((f, i) => {
    if (!f) return;
    const ox = (i % cols) * cell;
    const oy = Math.floor(i / cols) * cell;
    for (let py = 0; py < TILE_PX; py++) for (let px = 0; px < TILE_PX; px++) {
      const c = f.px.subarray((py * TILE_PX + px) * 4, (py * TILE_PX + px) * 4 + 4);
      for (let dy = 0; dy < SCALE; dy++) for (let dx = 0; dx < SCALE; dx++) rgba.set(c, ((oy + py * SCALE + dy) * W + ox + px * SCALE + dx) * 4);
    }
  });
  const index = new Map(order.map((f, i) => [f?.name ?? "", i]));
  // Wang sets: the generated corner tiles (grass with path, road, water, sand) and the walls' edge set.
  const wangsets: unknown[] = [];
  const sets = [...new Set(tiles.map((f) => f.props.wang as string | undefined).filter((x): x is string => !!x))];
  for (const set of sets) {
    const name = set.split("/").pop()!;
    const members = tiles.filter((f) => f.props.wang === set);
    wangsets.push({
      name: `grass-${name}`,
      type: "corner",
      tile: index.get(`${set}_15`) ?? -1,
      colors: [
        { name: "grass", color: "#4a823a", tile: index.get(`${set}_0`) ?? -1, probability: 1 },
        { name, color: "#b49668", tile: index.get(`${set}_15`) ?? -1, probability: 1 },
      ],
      wangtiles: members.map((f) => {
        const m = Number(f.props.mask);
        const c = (b: number) => (m & b ? 2 : 1);
        return { tileid: index.get(f.name)!, wangid: [0, c(WANG.TR), 0, c(WANG.BR), 0, c(WANG.BL), 0, c(WANG.TL)] };
      }),
    });
  }
  const walls = tiles.filter((f) => typeof f.props.wall === "string");
  if (walls.length > 0) {
    // Edge set: a wall tile with wall to its south shows its top; one with open ground south shows its face.
    wangsets.push({
      name: "walls",
      type: "edge",
      tile: index.get(walls[0]!.name) ?? -1,
      colors: [{ name: "wall", color: "#6e6c70", tile: index.get(walls[0]!.name) ?? -1, probability: 1 }],
      wangtiles: walls.map((f) => ({ tileid: index.get(f.name)!, wangid: f.props.wall === "top" ? [1, 0, 1, 0, 1, 0, 1, 0] : [1, 0, 1, 0, 0, 0, 1, 0] })),
    });
  }
  const tsj = {
    type: "tileset",
    version: "1.10",
    tiledversion: "1.11.0",
    name: sheet,
    image: `${sheet}.png`,
    imagewidth: W,
    imageheight: H,
    tilewidth: cell,
    tileheight: cell,
    margin: 0,
    spacing: 0,
    columns: cols,
    tilecount: order.length,
    tiles: order.flatMap((f, id) =>
      f ? [{ id, properties: [{ name: "art", type: "string", value: f.name }, ...Object.entries(f.props).map(([k, v]) => ({ name: k, type: typeof v === "boolean" ? "bool" : "string", value: v }))] }] : [],
    ),
    wangsets,
  };
  return { order, tsj, png: { w: W, h: H, rgba } };
}

// ---------- templates ----------

export interface TemplateObject {
  art?: string;
  kind?: string;
  /** Where, in template tiles (fractions allowed), before the template is stretched to a building. */
  x: number;
  y: number;
  layer?: "roof" | "walls";
  anchor?: "door" | "grid";
}

export interface Template {
  kinds: string[];
  w: number;
  h: number;
  slice: { left: number; right: number; top: number; bottom: number };
  roofTint: boolean;
  roof: Array<Array<string | null>>;
  walls: Array<Array<string | null>>;
  /** The tile a door on the front wall gets, and the porch drawn over the roof for a door on another side. */
  door: string;
  porch: string;
  doorAt: { x: number; y: number };
  props: TemplateObject[];
  lights: TemplateObject[];
}

interface Tmj {
  width: number;
  height: number;
  properties?: Array<{ name: string; value: unknown }>;
  tilesets: Array<{ firstgid: number; source: string }>;
  layers: Array<{ name: string; type: string; data?: number[]; objects?: Array<{ name?: string; type?: string; class?: string; x: number; y: number; properties?: Array<{ name: string; value: unknown }> }> }>;
}

/** A Tiled template map as a plain template: tile numbers become frame names. */
export function readTemplate(file: string, tmj: Tmj, tilesets: Map<string, Array<string | null>>): Template {
  const prop = (name: string) => tmj.properties?.find((p) => p.name === name)?.value;
  const sets = [...tmj.tilesets].sort((a, b) => b.firstgid - a.firstgid);
  const tileName = (gid: number): string | null => {
    if (gid === 0) return null;
    const set = sets.find((s) => gid >= s.firstgid);
    const sheet = set?.source.replace(/^.*\//, "").replace(/\.tsj$/, "");
    const name = sheet ? tilesets.get(sheet)?.[gid - set!.firstgid] : undefined;
    if (!name) throw new Error(`${file}: tile ${gid} is in no tileset`);
    return name;
  };
  const grid = (layer: string) => {
    const l = tmj.layers.find((x) => x.name === layer && x.type === "tilelayer");
    if (!l?.data) throw new Error(`${file}: no tile layer "${layer}"`);
    return Array.from({ length: tmj.height }, (_, y) => l.data!.slice(y * tmj.width, (y + 1) * tmj.width).map(tileName));
  };
  const objects = (layer: string): TemplateObject[] => {
    const l = tmj.layers.find((x) => x.name === layer && x.type === "objectgroup");
    return (l?.objects ?? []).map((o) => {
      const p = (n: string) => o.properties?.find((q) => q.name === n)?.value as string | undefined;
      const out: TemplateObject = { x: o.x / (TILE_PX * SCALE), y: o.y / (TILE_PX * SCALE) };
      if (p("art")) out.art = p("art");
      const kind = o.class || o.type;
      if (kind && layer === "lights") out.kind = kind;
      if (p("layer")) out.layer = p("layer") as TemplateObject["layer"];
      if (p("anchor")) out.anchor = p("anchor") as TemplateObject["anchor"];
      return out;
    });
  };
  const [left, right, top, bottom] = String(prop("slice") ?? "1,1,1,1").split(",").map(Number);
  const marks = tmj.layers.find((x) => x.name === "marks")?.objects ?? [];
  const door = marks.find((o) => (o.class || o.type) === "door");
  return {
    kinds: String(prop("kinds") ?? "").split(",").map((k) => k.trim()).filter(Boolean),
    w: tmj.width,
    h: tmj.height,
    slice: { left: left!, right: right!, top: top!, bottom: bottom! },
    roofTint: prop("roofTint") === true,
    roof: grid("roof"),
    walls: grid("walls"),
    door: String(prop("door") ?? "buildings/door_wood"),
    porch: String(prop("porch") ?? "buildings/porch"),
    doorAt: door ? { x: Math.floor(door.x / (TILE_PX * SCALE)), y: Math.floor(door.y / (TILE_PX * SCALE)) } : { x: Math.floor(tmj.width / 2), y: tmj.height - 1 },
    props: objects("props"),
    lights: objects("lights"),
  };
}

// ---------- all of it ----------

export interface Packed {
  /** Repo-relative path → contents. */
  files: Map<string, Buffer | string>;
  frames: Frame[];
  templates: { templates: Record<string, Template>; kinds: Record<string, string[]>; windows: Record<string, string> };
}

const json = (x: unknown) => `${JSON.stringify(x, null, 1)}\n`;

export function packAll(root = ROOT): Packed {
  const pal = readPalette(readFileSync(join(root, "art/palette.txt"), "utf8"));
  const sources = SHEETS.flatMap((s) => readSources(s, readFileSync(join(root, `art/sprites/${s}.txt`), "utf8")));
  const frames = makeFrames(pal, sources);
  const files = new Map<string, Buffer | string>();
  const index: Record<string, { sheet: string; w: number; h: number; foot: [number, number]; props?: Record<string, string | boolean> }> = {};
  for (const sheet of SHEETS) {
    const mine = frames.filter((f) => f.sheet === sheet);
    const atlas = packAtlas(sheet, mine);
    files.set(`packages/client/public/art/${sheet}.png`, encodePng(atlas.w, atlas.h, atlas.rgba));
    files.set(`packages/client/public/art/${sheet}.json`, json(atlas.json));
    for (const f of mine) index[f.name] = { sheet, w: f.w, h: f.h, foot: f.foot, ...(Object.keys(f.props).length ? { props: f.props } : {}) };
  }
  files.set("packages/client/src/adapter/web/art/sheets.json", json({ tile: TILE_PX, scale: SCALE, sheets: SHEETS, frames: index }));

  const tilesets = new Map<string, Array<string | null>>();
  for (const sheet of TILESETS) {
    const path = join(root, `art/tiled/${sheet}.tsj`);
    const old = existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as Tsj) : null;
    const ts = makeTileset(sheet, frames.filter((f) => f.sheet === sheet), old);
    tilesets.set(sheet, ts.order.map((f) => f?.name ?? null));
    files.set(`art/tiled/${sheet}.tsj`, json(ts.tsj));
    files.set(`art/tiled/${sheet}.png`, encodePng(ts.png.w, ts.png.h, ts.png.rgba));
  }

  const dir = join(root, "art/tiled/templates");
  const templates: Record<string, Template> = {};
  const kinds: Record<string, string[]> = {};
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".tmj")).sort()) {
    const id = f.replace(/\.tmj$/, "");
    const t = readTemplate(f, JSON.parse(readFileSync(join(dir, f), "utf8")) as Tmj, tilesets);
    templates[id] = t;
    for (const k of t.kinds) (kinds[k] ??= []).push(id);
  }
  // Each window tile and the lit-window frame drawn over it after dark.
  const windows = Object.fromEntries(frames.filter((f) => f.props.window === true).map((f) => [f.name, String(f.props.glow ?? "fx/window_glow")]));
  const tpl = { templates, kinds, windows };
  files.set("packages/shared/src/view/templates.json", json({ tile: TILE_PX, ...tpl }));
  return { files, frames, templates: tpl };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const packed = packAll();
  for (const [path, body] of packed.files) {
    const full = join(ROOT, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, body);
  }
  const count = (s: string) => packed.frames.filter((f) => f.sheet === s).length;
  console.log(`Packed ${packed.frames.length} frames (${SHEETS.map((s) => `${s} ${count(s)}`).join(", ")}) and ${Object.keys(packed.templates.templates).length} templates.`);
}
