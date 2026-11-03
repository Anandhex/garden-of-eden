/**
 * The art in the 2.5D view (G7): the same packed sheets as the flat view (`npm run art`, public/art), as Three.js
 * textures kept crisp (nearest-neighbour, no mipmaps). A frame is found by its art name; its logical size and foot
 * come from sheets.json (16 px a tile, so a frame is w/16 by h/16 tiles), its place in the sheet from the sheet's
 * atlas JSON. Frames are also drawn into canvases at their own pixel size, for building faces and baked people. A
 * frame that isn't there is warned about once and drawn as a plain colour, never as nothing.
 */
import * as THREE from "three";
import { ART_TILE, FRAMES, SHEET_NAMES, sheetsLoaded, warnMissing } from "../art";

export interface FrameInfo {
  name: string;
  sheet: string;
  /** Logical size (art pixels) and foot. */
  w: number;
  h: number;
  foot: [number, number];
  /** Where it is in the packed sheet (packed pixels). */
  rect: { x: number; y: number; w: number; h: number };
}

/** The same hash as the flat view's (world/textures.ts), so a tile shows the same variant in both views. */
export const tileHash = (x: number, y: number): number => {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
};

export const hexColor = (hex: string): number => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  return m ? parseInt(m[1]!, 16) : 0xffffff;
};

/** A colour moved towards white, so a tinted roof keeps its shading (as the flat view does). */
export function lighten(c: number, k: number): number {
  const ch = (s: number) => Math.round(((c >> s) & 255) + (255 - ((c >> s) & 255)) * k);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

/** A texture for pixel art: sRGB, nearest-neighbour, no mipmaps. */
export function pixelTexture<T extends THREE.Texture>(t: T): T {
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}

export class Atlas {
  private images = new Map<string, HTMLImageElement>();
  private textures = new Map<string, THREE.Texture>();
  private rects = new Map<string, FrameInfo["rect"]>();
  private sizes = new Map<string, { w: number; h: number }>();
  private pixelCache = new Map<string, Uint8ClampedArray>();
  private scratch = document.createElement("canvas").getContext("2d", { willReadFrequently: true })!;

  /** Load every sheet; a sheet that fails leaves its frames missing (and drawn plain). */
  static async load(): Promise<Atlas> {
    const a = new Atlas();
    const ok: string[] = [];
    await Promise.all(
      SHEET_NAMES.map(async (sheet) => {
        try {
          const [img, json] = await Promise.all([loadImage(`art/${sheet}.png`), fetch(`art/${sheet}.json`).then((r) => r.json() as Promise<{ frames: Record<string, { frame: FrameInfo["rect"] }>; meta?: { size?: { w: number; h: number } } }>)]);
          a.images.set(sheet, img);
          a.sizes.set(sheet, { w: img.naturalWidth, h: img.naturalHeight });
          for (const [name, f] of Object.entries(json.frames)) a.rects.set(name, f.frame);
          a.textures.set(sheet, pixelTexture(new THREE.Texture(img)));
          ok.push(sheet);
        } catch {
          console.warn(`[art] sheet ${sheet} did not load; its frames are drawn plain`);
        }
      }),
    );
    sheetsLoaded(ok);
    return a;
  }

  /** A frame by name, or null (warned once) when it isn't packed or its sheet didn't load. */
  frame(name: string): FrameInfo | null {
    const f = FRAMES[name];
    const rect = this.rects.get(name);
    if (!f || !rect || !this.images.has(f.sheet)) {
      warnMissing(name);
      return null;
    }
    return { name, sheet: f.sheet, w: f.w, h: f.h, foot: f.foot, rect };
  }

  texture(sheet: string): THREE.Texture | null {
    return this.textures.get(sheet) ?? null;
  }

  /** A frame's UV rectangle in its sheet's texture (v up, as Three.js has it). */
  uv(f: FrameInfo): { u0: number; v0: number; u1: number; v1: number } {
    const s = this.sizes.get(f.sheet)!;
    return { u0: f.rect.x / s.w, u1: (f.rect.x + f.rect.w) / s.w, v0: 1 - (f.rect.y + f.rect.h) / s.h, v1: 1 - f.rect.y / s.h };
  }

  /** Draw a frame into a canvas at (x, y), at its own pixel size (or `w`×`h` art pixels). */
  draw(ctx: CanvasRenderingContext2D, name: string, x: number, y: number, w?: number, h?: number): boolean {
    const f = this.frame(name);
    if (!f) {
      ctx.fillStyle = "#8a8478";
      ctx.fillRect(x, y, w ?? ART_TILE, h ?? ART_TILE);
      return false;
    }
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.images.get(f.sheet)!, f.rect.x, f.rect.y, f.rect.w, f.rect.h, x, y, w ?? f.w, h ?? f.h);
    return true;
  }

  /** A frame's pixels (RGBA) at its own size, or null. */
  pixels(name: string): Uint8ClampedArray | null {
    const hit = this.pixelCache.get(name);
    if (hit) return hit;
    const f = this.frame(name);
    if (!f) return null;
    const c = this.scratch.canvas;
    c.width = f.w;
    c.height = f.h;
    this.scratch.clearRect(0, 0, f.w, f.h);
    this.draw(this.scratch, name, 0, 0);
    const px = this.scratch.getImageData(0, 0, f.w, f.h).data;
    this.pixelCache.set(name, px);
    return px;
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((ok, fail) => {
    const img = new Image();
    img.onload = () => ok(img);
    img.onerror = () => fail(new Error(src));
    img.src = src;
  });
}

const geometries = new Map<string, THREE.BufferGeometry>();

/**
 * A standing frame as a quad in the x–y plane, its foot at the origin, w/16 by h/16 tiles, with normals pointing
 * up so the sun and lamps light it like the ground round it (as HD-2D sprites are lit). Cached by frame.
 */
export function spriteGeometry(atlas: Atlas, name: string): THREE.BufferGeometry {
  const hit = geometries.get(name);
  if (hit) return hit;
  const f = atlas.frame(name);
  const w = (f?.w ?? ART_TILE) / ART_TILE;
  const h = (f?.h ?? ART_TILE) / ART_TILE;
  const fx = (f?.foot[0] ?? ART_TILE / 2) / ART_TILE;
  const fy = (f ? f.h - f.foot[1] : 0) / ART_TILE;
  const g = new THREE.PlaneGeometry(w, h);
  g.translate(w / 2 - fx, h / 2 - fy, 0);
  if (f) setUv(g, atlas.uv(f));
  const n = g.getAttribute("normal") as THREE.BufferAttribute;
  for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 0.8, 0.6);
  geometries.set(name, g);
  return g;
}

/** Set a plane's four UVs to a rectangle (PlaneGeometry's order: top-left, top-right, bottom-left, bottom-right). */
export function setUv(g: THREE.BufferGeometry, r: { u0: number; v0: number; u1: number; v1: number }): void {
  const uv = g.getAttribute("uv") as THREE.BufferAttribute;
  uv.setXY(0, r.u0, r.v1);
  uv.setXY(1, r.u1, r.v1);
  uv.setXY(2, r.u0, r.v0);
  uv.setXY(3, r.u1, r.v0);
  uv.needsUpdate = true;
}

const materials = new Map<string, THREE.MeshLambertMaterial>();

/** The lit, alpha-tested material for a sheet (shared by every sprite drawn from it); grey when the sheet is missing. */
export function sheetMaterial(atlas: Atlas, sheet: string): THREE.MeshLambertMaterial {
  let m = materials.get(sheet);
  if (!m) {
    const map = atlas.texture(sheet);
    m = new THREE.MeshLambertMaterial({ map, color: map ? 0xffffff : 0x8a8478, alphaTest: 0.5, side: THREE.DoubleSide });
    materials.set(sheet, m);
  }
  return m;
}
