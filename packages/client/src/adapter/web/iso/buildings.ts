/**
 * Buildings in the 2.5D view (G7): each a box with a gable roof, its walls and roof drawn from its template's own
 * tiles (massing.ts says which tile goes where) composed once into one small canvas per building. The front's
 * windows get a glowing pane when the server says the window is lit; signs and wall lamps hang on the front; a
 * chimney stands on the roof. A building that stands between the camera and the player fades. One whose template is
 * unknown is a plain block in its colour, never nothing; a roofless one (a camp's fire) stands as sprites.
 */
import * as THREE from "three";
import { dress, TEMPLATES, templateFor, type Frame } from "@millbrook/shared/view";
import { ART_TILE, warnMissing } from "../art";
import { hexColor, lighten, pixelTexture, sheetMaterial, spriteGeometry } from "./atlas";
import { Billboards, type Standing } from "./billboards";
import type { IsoCtx } from "./ctx";
import { hides, massing, OVERHANG, WALL_H, type Box, type Face, type Massing } from "./massing";

type BuildingData = NonNullable<Frame["buildings"]>[number];

const FADED = 0.22;
const T = ART_TILE;

interface Drawn {
  b: BuildingData;
  plan: Massing;
  /** The box in scene units (for fading and the doorway nudge). */
  box: Box;
  mesh: THREE.Mesh | null;
  material: THREE.MeshLambertMaterial | null;
  extras: THREE.Object3D[];
  windows: Map<string, THREE.Mesh[]>;
  alpha: number;
  /** The ground it stands on (its levelled pad). */
  base: number;
  /** Where its chimney smokes from (scene units), and its label sits. */
  chimney: { x: number; y: number; z: number };
  top: { x: number; y: number; z: number };
}

/** Triangles for one building: position, uv, normal and colour, built up face by face. */
class Builder {
  pos: number[] = [];
  uv: number[] = [];
  normal: number[] = [];
  color: number[] = [];

  tri(p: number[][], uv: number[][], n: number[], c: THREE.Color): void {
    for (let i = 0; i < 3; i++) {
      this.pos.push(...p[i]!);
      this.uv.push(...uv[i]!);
      this.normal.push(...n);
      this.color.push(c.r, c.g, c.b);
    }
  }

  /** A quad from its four corners (bottom-left, bottom-right, top-right, top-left as seen from outside). */
  quad(p: number[][], r: { u0: number; v0: number; u1: number; v1: number }, n: number[], c: THREE.Color): void {
    const uv = [
      [r.u0, r.v0],
      [r.u1, r.v0],
      [r.u1, r.v1],
      [r.u0, r.v1],
    ];
    this.tri([p[0]!, p[1]!, p[2]!], [uv[0]!, uv[1]!, uv[2]!], n, c);
    this.tri([p[0]!, p[2]!, p[3]!], [uv[0]!, uv[2]!, uv[3]!], n, c);
  }

  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(this.normal, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(this.color, 3));
    g.computeBoundingSphere();
    return g;
  }
}

export class IsoBuildings {
  private drawn: Drawn[] = [];
  private shape = "";
  readonly standing: Billboards;
  /** Door tiles the templates drew, as "x,y". */
  doors = new Set<string>();

  constructor(private readonly ctx: IsoCtx) {
    this.standing = new Billboards(ctx);
  }

  invalidate(): void {
    this.shape = "";
  }

  /** The boxes in scene units (for the doorway nudge). */
  get boxes(): Box[] {
    return this.drawn.filter((d) => d.plan.kind !== "standing").map((d) => d.box);
  }

  /** Each building's label and the point above its roof, for the overlay. */
  get labels(): Array<{ id: number; text: string; x: number; y: number; z: number }> {
    return this.drawn.filter((d) => d.b.label).map((d) => ({ id: d.b.id, text: d.b.label, ...d.top }));
  }

  /** Chimneys smoking now (scene units). */
  get smoke(): Array<{ x: number; y: number; z: number }> {
    return this.drawn.filter((d) => d.b.smoke).map((d) => d.chimney);
  }

  /** Build the buildings again if their shapes changed; false when only their tips or lights did. */
  draw(list: BuildingData[]): boolean {
    const shape = JSON.stringify(list.map((b) => [b.id, b.x, b.y, b.w, b.h, b.template, b.door, b.color, b.label]));
    if (shape === this.shape && this.drawn.length === list.length) {
      list.forEach((b, i) => (this.drawn[i]!.b = b));
      return false;
    }
    this.shape = shape;
    this.clear();
    const m = this.ctx.core.frame;
    const standing: Standing[] = [];
    for (const b of list) {
      const id = b.template ?? templateFor(b.kind, b.label, `${m.map?.id}:${b.id}`);
      const t = TEMPLATES[id];
      if (!t) warnMissing(`template/${id}`);
      const door = b.door !== undefined ? b.door : findDoor(m, b);
      const dressed = t ? dress(t, { x: b.x, y: b.y, w: b.w, h: b.h, door }) : null;
      if (dressed?.door) this.doors.add(`${dressed.door.x},${dressed.door.y}`);
      const plan = massing(b, t, dressed);
      const o = this.ctx.origin;
      const box: Box = { x0: plan.box.x0 - o.x, x1: plan.box.x1 - o.x, z0: plan.box.z0 - o.y, z1: plan.box.z1 - o.y, top: plan.box.top };
      const cx = (box.x0 + box.x1) / 2;
      const cz = (box.z0 + box.z1) / 2;
      const base = this.ctx.height.scene(cx, cz);
      const d: Drawn = { b, plan, box, base, mesh: null, material: null, extras: [], windows: new Map(), alpha: 1, chimney: { x: cx, y: base + box.top, z: cz }, top: { x: cx, y: base + box.top + 0.4, z: cz } };
      for (const s of plan.standing) {
        // A box's props stand on it (its pad); a roofless thing's on the ground where each is.
        const ground = plan.kind === "box" ? base : this.ctx.height.at(s.x, s.z);
        const st = { frame: s.frame, x: s.x - o.x, y: ground + s.y, z: s.z - o.y };
        standing.push(st);
        if (s.frame.startsWith("props/chimney")) d.chimney = { x: st.x, y: st.y + 0.6, z: st.z };
      }
      if (plan.kind === "box") this.buildBox(d, t!.roofTint ? lighten(hexColor(b.color), 0.35) : 0xffffff);
      else if (plan.kind === "plain") this.buildPlain(d);
      this.drawn.push(d);
    }
    this.standing.set(standing);
    return true;
  }

  private buildPlain(d: Drawn): void {
    const { box } = d;
    const g = new THREE.BoxGeometry(box.x1 - box.x0, box.top, box.z1 - box.z0).translate((box.x0 + box.x1) / 2, box.top / 2, (box.z0 + box.z1) / 2);
    const material = new THREE.MeshLambertMaterial({ color: hexColor(d.b.color) });
    d.mesh = new THREE.Mesh(g, material);
    d.mesh.position.y = d.base;
    d.material = material;
    d.mesh.castShadow = d.mesh.receiveShadow = true;
    this.ctx.scene.add(d.mesh);
    this.plinth(d);
  }

  /** A stone footing under a building, reaching down into the slope round its pad. */
  private plinth(d: Drawn): void {
    const { box } = d;
    const depth = 1.2;
    const m = new THREE.Mesh(new THREE.BoxGeometry(box.x1 - box.x0 + 0.12, depth, box.z1 - box.z0 + 0.12), plinthMaterial());
    m.position.set((box.x0 + box.x1) / 2, d.base - depth / 2 + 0.04, (box.z0 + box.z1) / 2);
    m.receiveShadow = true;
    this.ctx.scene.add(m);
    d.extras.push(m);
  }

  /** Compose the building's tiles into one canvas and build its walls, gables and roof from it. */
  private buildBox(d: Drawn, roofTint: number): void {
    const { plan, box } = d;
    const roof = plan.roof!;
    const faceCols = Math.max(...plan.faces.map((f) => f.lower.length));
    const cols = Math.max(faceCols, roof.rows[0]!.length);
    const canvas = document.createElement("canvas");
    canvas.width = cols * T;
    // Faces (two bands each), the roof's rows, and a row of the gable's art.
    canvas.height = plan.faces.length * 2 * T + roof.rows.length * T + T;
    const c = canvas.getContext("2d")!;
    const atlas = this.ctx.atlas;
    plan.faces.forEach((f, i) => {
      f.upper.forEach((fr, k) => atlas.draw(c, fr, k * T, i * 2 * T, T, T));
      f.lower.forEach((fr, k) => atlas.draw(c, fr, k * T, i * 2 * T + T, T, T));
    });
    const roofY = plan.faces.length * 2 * T;
    roof.rows.forEach((row, j) => row.forEach((fr, k) => atlas.draw(c, fr, k * T, roofY + j * T, T, T)));
    const gableY = roofY + roof.rows.length * T;
    for (let k = 0; k < cols; k++) atlas.draw(c, roof.gable, k * T, gableY, T, T);
    const W = canvas.width;
    const H = canvas.height;
    const region = (x: number, y: number, w: number, h: number) => ({ u0: x / W, u1: (x + w) / W, v0: 1 - (y + h) / H, v1: 1 - y / H });
    const white = new THREE.Color(1, 1, 1);
    const tint = new THREE.Color(roofTint);
    const B = new Builder();
    const o = this.ctx.origin;
    const P = (x: number, y: number, z: number) => [x - o.x, y, z - o.y];
    plan.faces.forEach((f: Face, i) => {
      const ex = f.bl.x + f.dir.x * f.width;
      const ez = f.bl.z + f.dir.z * f.width;
      const n = [f.normal.x, 0, f.normal.z];
      const r = region(0, i * 2 * T, f.lower.length * T, 2 * T);
      B.quad([P(f.bl.x, 0, f.bl.z), P(ex, 0, ez), P(ex, WALL_H, ez), P(f.bl.x, WALL_H, f.bl.z)], r, n, white);
      // The gable over the left and right walls, in the gable's art (a tile of it per tile of wall, a tile high).
      if (f.name === "left" || f.name === "right") {
        const rise = roof.ridge - WALL_H;
        const up = region(0, gableY, Math.max(1, Math.round(f.width)) * T, Math.min(T, rise * T));
        const mx = (f.bl.x + ex) / 2;
        const mz = (f.bl.z + ez) / 2;
        B.tri(
          [P(f.bl.x, WALL_H, f.bl.z), P(ex, WALL_H, ez), P(mx, roof.ridge, mz)],
          [
            [up.u0, up.v0],
            [up.u1, up.v0],
            [(up.u0 + up.u1) / 2, up.v1],
          ],
          n,
          white,
        );
      }
    });
    // Two slopes, the ridge along the front; the eave overhangs the walls a little.
    const pb = plan.box;
    const zc = (pb.z0 + pb.z1) / 2;
    const half = (pb.z1 - pb.z0) / 2;
    const drop = OVERHANG * ((roof.ridge - roof.eave) / half);
    const x0 = pb.x0 - OVERHANG;
    const x1 = pb.x1 + OVERHANG;
    const rr = region(0, roofY, roof.rows[0]!.length * T, roof.rows.length * T);
    const slope = (dir: 1 | -1) => {
      const ez = dir > 0 ? pb.z1 + OVERHANG : pb.z0 - OVERHANG;
      const ny = half;
      const nz = (roof.ridge - roof.eave) * dir;
      const len = Math.hypot(ny, nz);
      const n = [0, ny / len, nz / len];
      const corners = dir > 0 ? [P(x0, roof.eave - drop, ez), P(x1, roof.eave - drop, ez), P(x1, roof.ridge, zc), P(x0, roof.ridge, zc)] : [P(x1, roof.eave - drop, ez), P(x0, roof.eave - drop, ez), P(x0, roof.ridge, zc), P(x1, roof.ridge, zc)];
      B.quad(corners, rr, n, tint);
    };
    slope(1);
    slope(-1);
    const material = new THREE.MeshLambertMaterial({ map: pixelTexture(new THREE.CanvasTexture(canvas)), vertexColors: true, side: THREE.DoubleSide, alphaTest: 0.5 });
    const mesh = new THREE.Mesh(B.geometry(), material);
    mesh.position.y = d.base;
    mesh.castShadow = mesh.receiveShadow = true;
    this.ctx.scene.add(mesh);
    d.mesh = mesh;
    d.material = material;
    this.plinth(d);
    // Signs, lamps and the forge's mouth on the front wall.
    for (const dc of plan.decals) {
      const f = atlas.frame(dc.frame);
      if (!f) continue;
      const m = new THREE.Mesh(spriteGeometry(atlas, dc.frame), sheetMaterial(atlas, f.sheet));
      m.position.set(dc.x - o.x, d.base + Math.min(WALL_H - 0.2, dc.y), dc.z - o.y + 0.02);
      this.ctx.scene.add(m);
      d.extras.push(m);
    }
    // Window panes, lit by the server's window lights.
    for (const w of plan.windows) {
      const f = atlas.frame(w.glow);
      if (!f) continue;
      const tex = atlas.texture(f.sheet);
      const m = new THREE.Mesh(spriteGeometry(atlas, w.glow), glowMaterial(tex));
      m.position.set(w.x - o.x, d.base + Math.floor(w.y), w.z - o.y + 0.025);
      m.visible = false;
      this.ctx.scene.add(m);
      d.extras.push(m);
      const list = d.windows.get(w.id) ?? [];
      list.push(m);
      d.windows.set(w.id, list);
    }
  }

  /** The window lights the server says are on light their panes. */
  setLights(lights: NonNullable<Frame["lights"]>): void {
    const on = new Set(lights.filter((l) => l.on && l.kind === "window").map((l) => l.id));
    for (const d of this.drawn) for (const [id, panes] of d.windows) for (const p of panes) p.visible = on.has(id);
  }

  /** Each frame: fade a building between the camera and the player (drawing only), and turn the sprites. */
  update(me: { x: number; y: number; z: number } | null, delta: number): void {
    this.standing.update();
    const ease = Math.min(1, delta / 160);
    for (const d of this.drawn) {
      if (!d.material) continue;
      // Heights measured from the ground the player stands on.
      const want = me && hides({ ...d.box, top: d.box.top + d.base - me.y }, this.ctx.yaw, me) ? FADED : 1;
      if (Math.abs(d.alpha - want) < 0.005) continue;
      d.alpha += (want - d.alpha) * ease;
      if (Math.abs(d.alpha - want) < 0.01) d.alpha = want;
      const fading = d.alpha < 0.999;
      if (d.material.transparent !== fading) {
        d.material.transparent = fading;
        d.material.depthWrite = !fading;
        d.material.needsUpdate = true;
      }
      d.material.opacity = d.alpha;
      if (d.mesh) d.mesh.castShadow = !fading || d.alpha > 0.6;
    }
  }

  clear(): void {
    for (const d of this.drawn) {
      if (d.mesh) {
        this.ctx.scene.remove(d.mesh);
        d.mesh.geometry.dispose();
        (d.material?.map as THREE.Texture | null)?.dispose();
        d.material?.dispose();
      }
      for (const e of d.extras) this.ctx.scene.remove(e);
    }
    this.drawn = [];
    this.doors.clear();
  }
}

let stone: THREE.MeshLambertMaterial | null = null;
const plinthMaterial = () => (stone ??= new THREE.MeshLambertMaterial({ color: 0x6e6c70 }));

const glows = new Map<THREE.Texture | null, THREE.MeshBasicMaterial>();

/** A lit window's pane: additive, unlit, so it glows at night. */
function glowMaterial(tex: THREE.Texture | null): THREE.MeshBasicMaterial {
  let m = glows.get(tex);
  if (!m) {
    m = new THREE.MeshBasicMaterial({ map: tex, color: 0xffd9a0, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    glows.set(tex, m);
  }
  return m;
}

/** A building's door from the patches (frames from before G6 don't say). */
function findDoor(m: IsoCtx["core"]["frame"], b: BuildingData): { x: number; y: number } | null {
  for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) if (m.tileAt(x, y)?.object === "buildings/door") return { x, y };
  return null;
}
