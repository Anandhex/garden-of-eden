/**
 * Low-poly models in the 2.5D view (G7 Part B), built in code from boxes, cylinders and cones, coloured from the art
 * palette (art/palette.txt), one tile a unit with the foot at the origin. They replace the sprite of the frame they
 * are named by: rocks, barrels, furniture, milestones, signposts, shrines, the stairs, a camp's fire, and a bridge's
 * deck. People, beasts and trees stay sprites, as HD-2D has them. A frame without a model is a sprite, as before.
 */
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/** Palette colours (art/palette.txt). */
const C = {
  outline: 0x3a3240,
  stoneDark: 0x4a4a52,
  stone: 0x6e6c70,
  stoneLight: 0x96928c,
  stoneHi: 0xc2bcb0,
  offWhite: 0xf2ecdc,
  woodDarkest: 0x3d2a1e,
  woodDark: 0x5e4030,
  wood: 0x8a5e3c,
  woodLight: 0xb08050,
  straw: 0xe2cc84,
  thatch: 0xa08440,
  brick: 0x8e3e2e,
  gold: 0xf0c24e,
  fire: 0xe8782c,
  cloth: 0xb5763f,
  lilac: 0x8a72c0,
} as const;

type Part = THREE.BufferGeometry;

/** Paint a part one colour (as a vertex colour) and drop it where it goes. */
function part(g: THREE.BufferGeometry, color: number, x = 0, y = 0, z = 0): Part {
  const geo = g.index ? g.toNonIndexed() : g;
  geo.deleteAttribute("uv");
  const c = new THREE.Color(color);
  const n = geo.getAttribute("position").count;
  const colors = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) colors.set([c.r, c.g, c.b], i * 3);
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geo.translate(x, y, z);
  return geo;
}

/** A box standing on its base at (x, y, z). */
const box = (w: number, h: number, d: number, color: number, x = 0, y = 0, z = 0) => part(new THREE.BoxGeometry(w, h, d), color, x, y + h / 2, z);
const cyl = (r: number, h: number, color: number, x = 0, y = 0, z = 0, sides = 10) => part(new THREE.CylinderGeometry(r, r, h, sides), color, x, y + h / 2, z);

const BUILDERS: Record<string, () => Part[]> = {
  "props/rock": () => [part(new THREE.DodecahedronGeometry(0.34, 0).scale(1, 0.62, 0.9), C.stone, 0, 0.24, 0), part(new THREE.DodecahedronGeometry(0.16, 0), C.stoneLight, 0.2, 0.15, 0.12)],
  "props/barrel": () => [cyl(0.26, 0.62, C.wood), cyl(0.27, 0.05, C.woodDarkest, 0, 0.1), cyl(0.27, 0.05, C.woodDarkest, 0, 0.47), cyl(0.22, 0.02, C.woodDark, 0, 0.62)],
  "props/chest": () => [box(0.62, 0.32, 0.4, C.wood), box(0.64, 0.08, 0.42, C.woodDark, 0, 0.32), box(0.1, 0.12, 0.02, C.gold, 0, 0.22, 0.21)],
  "props/table": () => [box(0.9, 0.07, 0.6, C.woodLight, 0, 0.5), ...[-1, 1].flatMap((sx) => [-1, 1].map((sz) => box(0.07, 0.5, 0.07, C.woodDark, sx * 0.38, 0, sz * 0.24)))],
  "props/bench": () => [box(0.8, 0.06, 0.26, C.woodLight, 0, 0.3), box(0.06, 0.3, 0.22, C.woodDark, -0.32), box(0.06, 0.3, 0.22, C.woodDark, 0.32)],
  "props/bed": () => [box(0.62, 0.24, 0.95, C.wood), box(0.56, 0.1, 0.86, C.offWhite, 0, 0.24, 0.02), box(0.5, 0.08, 0.2, C.offWhite, 0, 0.34, -0.3), box(0.56, 0.06, 0.5, C.cloth, 0, 0.34, 0.18), box(0.62, 0.5, 0.06, C.woodDark, 0, 0, -0.47)],
  "props/shelf": () => [box(0.8, 1.2, 0.04, C.woodDark, 0, 0, -0.16), box(0.04, 1.2, 0.3, C.woodDark, -0.38), box(0.04, 1.2, 0.3, C.woodDark, 0.38), ...[0.05, 0.42, 0.8, 1.16].map((y) => box(0.76, 0.04, 0.3, C.wood, 0, y)), box(0.16, 0.18, 0.16, C.brick, -0.2, 0.46), box(0.12, 0.2, 0.12, C.straw, 0.15, 0.84)],
  "props/counter": () => [box(0.92, 0.6, 0.42, C.wood), box(0.96, 0.06, 0.46, C.woodLight, 0, 0.6)],
  "props/anvil": () => [box(0.22, 0.3, 0.22, C.woodDark), box(0.5, 0.14, 0.22, C.stoneDark, 0, 0.3), part(new THREE.ConeGeometry(0.08, 0.2, 6).rotateZ(Math.PI / 2), C.stoneDark, 0.33, 0.37, 0)],
  "props/altar": () => [box(0.86, 0.6, 0.42, C.stoneLight), box(0.9, 0.05, 0.46, C.lilac, 0, 0.6), box(0.06, 0.24, 0.06, C.gold, 0, 0.65)],
  "props/hearth": () => [box(0.9, 0.22, 0.6, C.stone), box(0.6, 0.06, 0.36, C.woodDarkest, 0, 0.22), box(0.9, 0.9, 0.12, C.stoneLight, 0, 0.22, -0.26), part(new THREE.ConeGeometry(0.14, 0.26, 6), C.fire, 0, 0.4, 0)],
  "props/milestone": () => [box(0.26, 0.62, 0.2, C.stoneLight), box(0.28, 0.06, 0.22, C.stoneHi, 0, 0.62)],
  "props/signpost": () => [cyl(0.04, 1.15, C.woodDark), box(0.56, 0.16, 0.04, C.woodLight, 0.12, 0.85, 0.03), box(0.5, 0.14, 0.04, C.woodLight, -0.1, 0.62, 0.03)],
  "props/shrine": () => [box(0.5, 0.5, 0.4, C.stoneLight), box(0.3, 0.32, 0.04, C.stoneDark, 0, 0.12, 0.2), part(new THREE.ConeGeometry(0.42, 0.3, 4).rotateY(Math.PI / 4), C.brick, 0, 0.65, 0), box(0.06, 0.12, 0.06, C.gold, 0, 0.28, 0.22)],
  "buildings/stairs": () => [0, 1, 2, 3, 4].map((k) => box(0.86, 0.2 + k * 0.2, 0.2, k % 2 ? C.wood : C.woodLight, 0, 0, 0.4 - k * 0.2)).concat([box(0.06, 1.2, 1, C.woodDark, -0.45, 0, 0), box(0.06, 1.2, 1, C.woodDark, 0.45, 0, 0)]),
  "buildings/campfire": () => [...[0, 1, 2, 3, 4, 5, 6].map((k) => part(new THREE.DodecahedronGeometry(0.08, 0), C.stone, Math.cos(k) * 0.3, 0.08, Math.sin(k) * 0.3)), part(new THREE.CylinderGeometry(0.04, 0.04, 0.5, 6).rotateZ(Math.PI / 2).rotateY(0.6), C.woodDark, 0, 0.06, 0), part(new THREE.CylinderGeometry(0.04, 0.04, 0.5, 6).rotateZ(Math.PI / 2).rotateY(-0.6), C.woodDark, 0, 0.1, 0), part(new THREE.ConeGeometry(0.13, 0.36, 6), C.fire, 0, 0.18, 0), part(new THREE.ConeGeometry(0.07, 0.24, 6), C.gold, 0, 0.14, 0)],
  /** A bridge tile's deck (not a frame: the ground layer asks for it on bridge tiles). */
  "model/bridge": () => [box(1.02, 0.1, 1.0, C.wood), ...[-0.35, 0, 0.35].map((z) => box(1.02, 0.02, 0.06, C.woodDark, 0, 0.1, z)), box(0.06, 0.4, 1, C.woodDark, -0.48, 0.1, 0), box(0.06, 0.4, 1, C.woodDark, 0.48, 0.1, 0)],
};

/** The frames (and model ids) that have a model. */
export const MODEL_IDS = Object.keys(BUILDERS);
export const hasModel = (id: string): boolean => id in BUILDERS;

const built = new Map<string, THREE.BufferGeometry>();

/** A model's geometry (merged, vertex-coloured), built once. */
export function modelGeometry(id: string): THREE.BufferGeometry | null {
  const hit = built.get(id);
  if (hit) return hit;
  const make = BUILDERS[id];
  if (!make) return null;
  const g = mergeGeometries(make(), false)!;
  g.computeBoundingSphere();
  built.set(id, g);
  return g;
}

let material: THREE.MeshLambertMaterial | null = null;
/** The one material every model shares: lit, coloured by its vertices. */
export const modelMaterial = (): THREE.MeshLambertMaterial => (material ??= new THREE.MeshLambertMaterial({ vertexColors: true }));
