/**
 * Buildings in the 2.5D view (G7): each a box with a gable roof, its walls and roof drawn from its template's own
 * tiles (massing.ts says which tile goes where) composed once into one small canvas per building. The front's
 * windows get a glowing pane when the server says the window is lit; signs and wall lamps hang on the front; a
 * chimney stands on the roof. A building that stands between the camera and the player fades. One whose template is
 * unknown is a plain block in its colour, never nothing; a roofless one (a camp's fire) stands as sprites.
 *
 * G10: a place built in a regional style (the frame's `locale`, shared shapes.ts) gets its walls and roof tinted
 * in the style's colours, a hipped, flat or round (yurt) roof as well as a gabled one, and a footing or stilts.
 */
import * as THREE from "three";
import { dress, isShingle, shapeFor, templateById, templateFor, type BuildShape, type Frame } from "@garden-of-eden/shared/view";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { ART_TILE, warnMissing } from "../art";
import { hexColor, lighten, pixelTexture, sheetMaterial, spriteGeometry } from "./atlas";
import { Billboards, type Standing } from "./billboards";
import type { IsoCtx } from "./ctx";
import { hides, massing, PARAPET, type Box, type Face, type Massing } from "./massing";

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
    const locale = this.ctx.core.frame.map?.locale ?? null;
    const shape = JSON.stringify([locale, list.map((b) => [b.id, b.x, b.y, b.w, b.h, b.template, b.door, b.color, b.label])]);
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
      const t = templateById(id);
      if (!t) warnMissing(`template/${id}`);
      const door = b.door !== undefined ? b.door : findDoor(m, b);
      const dressed = t ? dress(t, { x: b.x, y: b.y, w: b.w, h: b.h, door }) : null;
      if (dressed?.door) this.doors.add(`${dressed.door.x},${dressed.door.y}`);
      const style = shapeFor(locale, { id: b.id, kind: b.kind, template: id }, `${m.map?.id}:${b.id}`);
      const plan = massing(b, t, dressed, style);
      const o = this.ctx.origin;
      const box: Box = { x0: plan.box.x0 - o.x, x1: plan.box.x1 - o.x, z0: plan.box.z0 - o.y, z1: plan.box.z1 - o.y, top: plan.box.top + plan.lift };
      const cx = (box.x0 + box.x1) / 2;
      const cz = (box.z0 + box.z1) / 2;
      const base = this.ctx.height.scene(cx, cz);
      const d: Drawn = { b, plan, box, base, mesh: null, material: null, extras: [], windows: new Map(), alpha: 1, chimney: { x: cx, y: base + box.top, z: cz }, top: { x: cx, y: base + box.top + 0.4, z: cz } };
      for (const s of plan.standing) {
        // A box's props stand on it (its pad, or its raised floor when up on the roof); a roofless thing's on the ground where each is.
        const ground = plan.kind === "box" ? base + (s.y > 0.01 ? plan.lift : 0) : this.ctx.height.at(s.x, s.z);
        const st = { frame: s.frame, x: s.x - o.x, y: ground + s.y, z: s.z - o.y };
        standing.push(st);
        if (s.frame.startsWith("props/chimney")) d.chimney = { x: st.x, y: st.y + 0.6, z: st.z };
      }
      if (plan.kind === "box" && plan.form === "round") this.buildRound(d, plan.style!);
      else if (plan.kind === "box") this.buildBox(d, t!.roofTint ? lighten(hexColor(b.color), 0.35) : 0xffffff);
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
    const { box, plan } = d;
    const up = plan.plinth;
    const depth = 1.2 + up;
    const m = new THREE.Mesh(new THREE.BoxGeometry(box.x1 - box.x0 + 0.12, depth, box.z1 - box.z0 + 0.12), plinthMaterial(plan.style?.plinthTint));
    m.position.set((box.x0 + box.x1) / 2, d.base + up - depth / 2 + 0.04, (box.z0 + box.z1) / 2);
    m.receiveShadow = true;
    m.castShadow = up > 0.05;
    this.ctx.scene.add(m);
    d.extras.push(m);
    if (plan.lift > up + 0.01) this.stilts(d);
  }

  /** Posts under a floor raised over the marsh, and steps up to its door. */
  private stilts(d: Drawn): void {
    const { box, plan } = d;
    const from = d.base + plan.plinth;
    const h = plan.lift - plan.plinth;
    const g = new THREE.BoxGeometry(0.14, h, 0.14);
    const posts: number[][] = [];
    const nx = Math.max(2, Math.round(box.x1 - box.x0) + 1);
    const nz = Math.max(2, Math.round(box.z1 - box.z0) + 1);
    for (let i = 0; i < nx; i++) for (const z of [box.z0 + 0.07, box.z1 - 0.07]) posts.push([box.x0 + 0.07 + (i / (nx - 1)) * (box.x1 - box.x0 - 0.14), z]);
    for (let j = 1; j < nz - 1; j++) for (const x of [box.x0 + 0.07, box.x1 - 0.07]) posts.push([x, box.z0 + 0.07 + (j / (nz - 1)) * (box.z1 - box.z0 - 0.14)]);
    const mat = woodMaterial();
    const mesh = new THREE.InstancedMesh(g, mat, posts.length);
    const t = new THREE.Matrix4();
    posts.forEach(([x, z], i) => mesh.setMatrixAt(i, t.makeTranslation(x!, from + h / 2, z!)));
    mesh.castShadow = true;
    this.ctx.scene.add(mesh);
    d.extras.push(mesh);
    // A deck along the front, and steps down from the door.
    const deck = new THREE.Mesh(new THREE.BoxGeometry(box.x1 - box.x0 + 0.1, 0.08, 0.42), mat);
    deck.position.set((box.x0 + box.x1) / 2, d.base + plan.lift - 0.04, box.z1 + 0.2);
    deck.castShadow = deck.receiveShadow = true;
    this.ctx.scene.add(deck);
    d.extras.push(deck);
    const door = d.b.door;
    if (door && door.y === d.b.y + d.b.h - 1) {
      const o = this.ctx.origin;
      const steps = new THREE.Mesh(new THREE.BoxGeometry(0.5, plan.lift, 0.36), mat);
      steps.position.set(door.x + 0.5 - o.x, d.base + plan.lift / 2 - 0.02, box.z1 + 0.58);
      steps.castShadow = steps.receiveShadow = true;
      this.ctx.scene.add(steps);
      d.extras.push(steps);
    }
  }

  /** A yurt (G10, the steppe's homes): a felt drum under a low cone, the door on the front, a smoke ring on top. */
  private buildRound(d: Drawn, style: BuildShape): void {
    const { plan, box } = d;
    const roof = plan.roof!;
    const cx = (box.x0 + box.x1) / 2;
    const cz = (box.z0 + box.z1) / 2;
    const r = (Math.min(box.x1 - box.x0, box.z1 - box.z0) / 2) * 0.98;
    const tex = yurtTexture(style.wallTint, style.trim);
    // The drum in the canvas's top half, the cone in its bottom half (one texture, one material, so it fades as one).
    const drum = new THREE.CylinderGeometry(r, r, plan.wallH, 20, 1, true, -Math.PI, Math.PI * 2).translate(0, plan.wallH / 2, 0);
    remapV(drum, 0.5, 1);
    const coneH = roof.ridge - roof.eave;
    const cone = new THREE.ConeGeometry(r + plan.overhang, coneH + plan.overhang * (coneH / r), 20, 1, true, -Math.PI, Math.PI * 2).translate(0, plan.wallH + (coneH - plan.overhang * (coneH / r)) / 2, 0);
    remapV(cone, 0, 0.5);
    const g = mergeGeometries([drum.toNonIndexed(), cone.toNonIndexed()])!;
    const material = new THREE.MeshLambertMaterial({ map: tex, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(g, material);
    mesh.position.set(cx, d.base + plan.lift, cz);
    mesh.castShadow = mesh.receiveShadow = true;
    this.ctx.scene.add(mesh);
    d.mesh = mesh;
    d.material = material;
    // The crown ring the smoke goes out of.
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.1, 10), woodMaterial());
    ring.position.set(cx, d.base + plan.lift + roof.ridge + 0.02, cz);
    this.ctx.scene.add(ring);
    d.extras.push(ring);
    d.chimney = { x: cx, y: d.base + plan.lift + roof.ridge + 0.1, z: cz };
    // A low round footing of beaten earth.
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(r + 0.08, r + 0.12, 0.6, 20), plinthMaterial(style.plinthTint));
    pad.position.set(cx, d.base + plan.lift - 0.3 + 0.02, cz);
    pad.receiveShadow = true;
    this.ctx.scene.add(pad);
    d.extras.push(pad);
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
    const style = plan.style;
    const WH = plan.wallH;
    const OH = plan.overhang;
    // Walls and roof in the style's colours (whitewash brightens past white); the template's own without a style.
    const white = style ? new THREE.Color(style.wallTint).multiplyScalar(style.wallGain) : new THREE.Color(1, 1, 1);
    const tint = !style ? new THREE.Color(roofTint) : style.materials ? new THREE.Color(isShingle(roof.rows[0]![0]!) ? style.shingleTint : style.thatchTint) : new THREE.Color(roofTint).multiply(new THREE.Color(style.shingleTint));
    const B = new Builder();
    const o = this.ctx.origin;
    const P = (x: number, y: number, z: number) => [x - o.x, y, z - o.y];
    plan.faces.forEach((f: Face, i) => {
      const ex = f.bl.x + f.dir.x * f.width;
      const ez = f.bl.z + f.dir.z * f.width;
      const n = [f.normal.x, 0, f.normal.z];
      const r = region(0, i * 2 * T, f.lower.length * T, 2 * T);
      // A flat roof's walls rise past it into a parapet.
      const top = plan.form === "flat" ? WH + PARAPET : WH;
      B.quad([P(f.bl.x, 0, f.bl.z), P(ex, 0, ez), P(ex, top, ez), P(f.bl.x, top, f.bl.z)], r, n, white);
      // The gable over the left and right walls, in the gable's art (a tile of it per tile of wall, a tile high).
      if (plan.form === "gable" && (f.name === "left" || f.name === "right")) {
        const rise = roof.ridge - WH;
        const up = region(0, gableY, Math.max(1, Math.round(f.width)) * T, Math.min(T, rise * T));
        const mx = (f.bl.x + ex) / 2;
        const mz = (f.bl.z + ez) / 2;
        B.tri(
          [P(f.bl.x, WH, f.bl.z), P(ex, WH, ez), P(mx, roof.ridge, mz)],
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
    const drop = OH * ((roof.ridge - roof.eave) / half);
    const x0 = pb.x0 - OH;
    const x1 = pb.x1 + OH;
    // The ridge row's art stands half a tile over the ridge in the flat view; here that empty half is left off.
    const rr = region(0, roofY + T / 2, roof.rows[0]!.length * T, roof.rows.length * T - T / 2);
    const slope = (dir: 1 | -1) => {
      const ez = dir > 0 ? pb.z1 + OH : pb.z0 - OH;
      const ny = half;
      const nz = (roof.ridge - roof.eave) * dir;
      const len = Math.hypot(ny, nz);
      const n = [0, ny / len, nz / len];
      const corners = dir > 0 ? [P(x0, roof.eave - drop, ez), P(x1, roof.eave - drop, ez), P(x1, roof.ridge, zc), P(x0, roof.ridge, zc)] : [P(x1, roof.eave - drop, ez), P(x0, roof.eave - drop, ez), P(x0, roof.ridge, zc), P(x1, roof.ridge, zc)];
      B.quad(corners, rr, n, tint);
    };
    if (plan.form === "flat") {
      // A flat roof of beaten earth or tiles just under the parapet's top.
      const y = WH + 0.04;
      B.quad([P(pb.x0, y, pb.z1), P(pb.x1, y, pb.z1), P(pb.x1, y, pb.z0), P(pb.x0, y, pb.z0)], rr, [0, 1, 0], tint);
    } else if (plan.form === "hip") {
      // The ridge row's cap would draw a dark band round a short hipped ridge: the slopes take the rows below it.
      const rh = roof.rows.length > 1 ? region(0, roofY + T, roof.rows[0]!.length * T, (roof.rows.length - 1) * T) : rr;
      Object.assign(rr, rh);
      // Four slopes: front and back to a shorter ridge, the ends to its tips (a pyramid on a square house).
      const e = roof.eave - drop;
      const z0 = pb.z0 - OH;
      const z1 = pb.z1 + OH;
      const hd = (z1 - z0) / 2;
      const mid = (x0 + x1) / 2;
      const rx0 = Math.min(mid, x0 + hd);
      const rx1 = Math.max(mid, x1 - hd);
      const corners = { fl: P(x0, e, z1), fr: P(x1, e, z1), bl: P(x0, e, z0), br: P(x1, e, z0), r0: P(rx0, roof.ridge, zc), r1: P(rx1, roof.ridge, zc) };
      B.quad([corners.fl, corners.fr, corners.r1, corners.r0], rr, upNormal(corners.fl, corners.fr, corners.r1), tint);
      B.quad([corners.br, corners.bl, corners.r0, corners.r1], rr, upNormal(corners.br, corners.bl, corners.r0), tint);
      const endUv = [
        [rr.u0, rr.v0],
        [rr.u1, rr.v0],
        [(rr.u0 + rr.u1) / 2, rr.v1],
      ];
      B.tri([corners.bl, corners.fl, corners.r0], endUv, upNormal(corners.bl, corners.fl, corners.r0), tint);
      B.tri([corners.fr, corners.br, corners.r1], endUv, upNormal(corners.fr, corners.br, corners.r1), tint);
    } else {
      slope(1);
      slope(-1);
    }
    const material = new THREE.MeshLambertMaterial({ map: pixelTexture(new THREE.CanvasTexture(canvas)), vertexColors: true, side: THREE.DoubleSide, alphaTest: 0.5 });
    const mesh = new THREE.Mesh(B.geometry(), material);
    mesh.position.y = d.base + plan.lift;
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
      m.position.set(dc.x - o.x, d.base + plan.lift + Math.min(WH - 0.2, dc.y), dc.z - o.y + 0.02);
      this.ctx.scene.add(m);
      d.extras.push(m);
    }
    // Window panes, lit by the server's window lights.
    for (const w of plan.windows) {
      const f = atlas.frame(w.glow);
      if (!f) continue;
      const tex = atlas.texture(f.sheet);
      const m = new THREE.Mesh(spriteGeometry(atlas, w.glow), glowMaterial(tex));
      m.position.set(w.x - o.x, d.base + plan.lift + (w.y > WH / 2 ? WH / 2 : 0), w.z - o.y + 0.025);
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

const plinths = new Map<string, THREE.MeshLambertMaterial>();
/** A footing's stone, in the style's colour (the old grey without one). */
function plinthMaterial(colour = "#6e6c70"): THREE.MeshLambertMaterial {
  let m = plinths.get(colour);
  if (!m) plinths.set(colour, (m = new THREE.MeshLambertMaterial({ color: hexColor(colour) })));
  return m;
}
let wood: THREE.MeshLambertMaterial | null = null;
const woodMaterial = () => (wood ??= new THREE.MeshLambertMaterial({ color: 0x5a4330 }));

/** A roof face's normal, turned to face up. */
function upNormal(a: number[], b: number[], c: number[]): number[] {
  const u = new THREE.Vector3(b[0]! - a[0]!, b[1]! - a[1]!, b[2]! - a[2]!);
  const v = new THREE.Vector3(c[0]! - a[0]!, c[1]! - a[1]!, c[2]! - a[2]!);
  const n = u.cross(v).normalize();
  if (n.y < 0) n.negate();
  return [n.x, n.y, n.z];
}

/** Squeeze a geometry's v into [lo, hi] (two parts sharing one canvas). */
function remapV(g: THREE.BufferGeometry, lo: number, hi: number): void {
  const uv = g.getAttribute("uv") as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setY(i, lo + uv.getY(i) * (hi - lo));
  uv.needsUpdate = true;
}

const yurts = new Map<string, THREE.Texture>();
/**
 * A yurt's felt, drawn once per colour pair: the drum (top half) with its lattice showing through, a band in the
 * culture's colour and a painted door at the front; the cone (bottom half) in stripes radiating from the crown.
 */
function yurtTexture(felt: string, trim: string): THREE.Texture {
  const key = `${felt}|${trim}`;
  const have = yurts.get(key);
  if (have) return have;
  const W = 128;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = 64;
  const g = c.getContext("2d")!;
  // The drum: felt, a darker lattice, a band near the top and the foot, the door at u = ½ (the front).
  g.fillStyle = felt;
  g.fillRect(0, 0, W, 32);
  g.fillStyle = "rgba(90,70,50,0.18)";
  for (let x = 0; x < W; x += 6) for (let y = 4; y < 28; y += 6) g.fillRect(x + ((y / 6) % 2) * 3, y, 2, 2);
  g.fillStyle = trim;
  g.fillRect(0, 4, W, 3);
  g.fillRect(0, 27, W, 2);
  g.fillStyle = "#5a3a22";
  g.fillRect(W / 2 - 5, 9, 10, 23);
  g.fillStyle = trim;
  g.fillRect(W / 2 - 4, 11, 8, 3);
  g.fillStyle = "#3a2616";
  g.fillRect(W / 2 - 1, 15, 2, 17);
  // The cone: felt with stripes in the trim colour (v runs up the cone, so stripes are columns).
  g.fillStyle = shadeCss(felt, 0.92);
  g.fillRect(0, 32, W, 32);
  g.fillStyle = trim;
  for (let x = 0; x < W; x += 16) g.fillRect(x, 32, 2, 32);
  g.fillStyle = "rgba(60,40,30,0.25)";
  g.fillRect(0, 60, W, 4);
  const t = pixelTexture(new THREE.CanvasTexture(c));
  yurts.set(key, t);
  return t;
}

function shadeCss(hex: string, k: number): string {
  const n = hexColor(hex);
  const ch = (s: number) => Math.round(((n >> s) & 255) * k);
  return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
}

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
