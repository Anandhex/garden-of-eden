/**
 * People and beasts in the 2.5D view (G7): upright sprites that face the camera, casting the sun's shadow and a
 * soft one of their own. A person's four layers (body, clothes tinted by `look.tint`, hair by a pick from the id,
 * trim by `look.trim`) are baked once per look into one strip of all twelve walk frames (bake.ts); a beast trots
 * from its sheet. Each walks along the tiles the server gives, at the flat view's speeds; which drawing shows
 * follows the camera's turn. Someone in a doorway is drawn just outside the building (massing.ts).
 */
import * as THREE from "three";
import type { Actor as ActorData } from "@millbrook/shared/view";
import { ART_TILE, framesOf, lookOf, PERSON_LAYERS, PERSON_STEPS, warnMissing } from "../art";
import { hexColor, pixelTexture, setUv, sheetMaterial, spriteGeometry, type Atlas } from "./atlas";
import { bakeLayers, lookKey } from "./bake";
import { dirOf, screenFacing, screenSide, type Dir } from "./camera";
import type { IsoCtx } from "./ctx";
import { nudgeOut, type Box } from "./massing";

/** How long a tile's walk takes on screen, by who's walking (the flat view's). */
const WALK_MS: Record<ActorData["kind"], number> = { player: 90, npc: 150, companion: 90, creature: 200, folk: 450, traveller: 450 };
const HAIR = [0x3b2a20, 0x6a4428, 0x9a6a3a, 0xc8a060, 0x2a2a30, 0x8a3a24, 0xb0aaa0, 0x5a4a3a];
const PLAIN_TRIM = 0x6e5036;
const CYCLE = [1, 0, 2, 0];
const DIRS: Dir[] = ["s", "n", "e", "w"];
const STRIDE = 0.3;

const idHash = (id: string) => {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h;
};

/** Baked people, by look. */
const baked = new Map<string, { tex: THREE.CanvasTexture; w: number; h: number }>();

function bakePerson(atlas: Atlas, tints: number[]): { tex: THREE.CanvasTexture; w: number; h: number } | null {
  const key = lookKey("people/body", tints);
  const hit = baked.get(key);
  if (hit) return hit;
  const first = atlas.frame(`people/body/s0.${PERSON_LAYERS[0]}`);
  if (!first) return null;
  const w = first.w;
  const h = first.h;
  const canvas = document.createElement("canvas");
  canvas.width = w * DIRS.length * PERSON_STEPS;
  canvas.height = h;
  const c = canvas.getContext("2d")!;
  DIRS.forEach((d, di) => {
    for (let s = 0; s < PERSON_STEPS; s++) {
      const layers = PERSON_LAYERS.map((l, i) => ({ px: atlas.pixels(`people/body/${d}${s}.${l}`), tint: tints[i]! }));
      if (layers.some((l) => !l.px)) continue;
      const px = bakeLayers(layers as Array<{ px: Uint8ClampedArray; tint: number }>, w, h);
      c.putImageData(new ImageData(new Uint8ClampedArray(px), w, h), (di * PERSON_STEPS + s) * w, 0);
    }
  });
  const out = { tex: pixelTexture(new THREE.CanvasTexture(canvas)), w, h };
  baked.set(key, out);
  return out;
}

let shadowMaterial: THREE.MeshBasicMaterial | null = null;

export class IsoActor {
  readonly mesh: THREE.Mesh;
  private shadow: THREE.Mesh;
  private material: THREE.MeshLambertMaterial;
  private geometry: THREE.PlaneGeometry | null = null;
  private look: string | null = null;
  private mode: "person" | "beast" | "grave" | "plain" = "plain";
  private strip: { w: number; h: number; foot: [number, number] } | null = null;
  private path: Array<{ x: number; z: number }> = [];
  private speed = 1 / 250;
  private stride = 0;
  private facing: Dir = "s";
  private shown = "";
  /** Where the walk has got to (scene units, tile middles), before the doorway nudge. */
  x: number;
  z: number;
  private lungeAt: { x: number; z: number; t: number } | null = null;
  private flashUntil = 0;
  private fade: { from: number; to: number; t: number; done?: () => void } | null = null;
  private alpha = 1;
  data: ActorData;

  constructor(
    private readonly ctx: IsoCtx,
    a: ActorData,
  ) {
    this.data = a;
    this.x = a.x - ctx.origin.x + 0.5;
    this.z = a.y - ctx.origin.y + 0.5;
    this.material = new THREE.MeshLambertMaterial({ alphaTest: 0.5, side: THREE.DoubleSide, emissive: 0x000000 });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.material);
    this.mesh.castShadow = true;
    this.mesh.userData.actor = a.id;
    shadowMaterial ??= new THREE.MeshBasicMaterial({ map: ctx.atlas.texture("fx"), transparent: true, opacity: 0.55, depthWrite: false, color: 0x000000 });
    const sf = ctx.atlas.frame("fx/shadow");
    this.shadow = new THREE.Mesh(sf ? spriteGeometry(ctx.atlas, "fx/shadow").clone().rotateX(-Math.PI / 2).center() : new THREE.CircleGeometry(0.3, 12).rotateX(-Math.PI / 2), sf ? shadowMaterial : new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false }));
    this.shadow.renderOrder = 1;
    ctx.scene.add(this.mesh, this.shadow);
    this.facing = a.facing ?? "s";
    this.set(a);
  }

  /** New facts from the server: how it looks, which way it faces. */
  set(a: ActorData): void {
    this.data = a;
    if (a.facing && !this.walking) this.facing = a.facing;
    const key = `${a.look.sprite}|${a.look.tint ?? ""}|${a.look.trim ?? ""}`;
    if (key !== this.look) {
      this.look = key;
      this.build(a);
    }
    this.pose(true);
  }

  private build(a: ActorData): void {
    const atlas = this.ctx.atlas;
    const kind = lookOf(a.look.sprite);
    const tint = a.look.tint ? hexColor(a.look.tint) : 0xffffff;
    const frames = framesOf(a.look.sprite);
    const art = frames.length > 0 && frames.every((f) => atlas.frame(f));
    if (!art) warnMissing(a.look.sprite);
    this.material.color.set(0xffffff);
    if (kind === "person" && art) {
      const b = bakePerson(atlas, [0xffffff, tint, HAIR[idHash(a.id) % HAIR.length]!, a.look.trim ? hexColor(a.look.trim) : PLAIN_TRIM]);
      if (b) {
        this.mode = "person";
        this.material.map = b.tex;
        const f = atlas.frame(`people/body/s0.${PERSON_LAYERS[0]}`)!;
        this.strip = { w: b.w, h: b.h, foot: f.foot };
        this.setPlane(b.w, b.h, f.foot);
      }
    } else if ((kind === "beast" || kind === "grave") && art) {
      this.mode = kind;
      const f = atlas.frame(frames[0]!)!;
      this.material.map = sheetMaterial(atlas, f.sheet).map;
      if (a.look.sprite === "creature/beast") this.material.color.set(tint);
      this.strip = null;
      this.setPlane(f.w, f.h, f.foot);
    } else {
      // No art: a plain upright shape in the actor's colour.
      this.mode = "plain";
      this.material.map = null;
      this.material.color.set(tint);
      this.setPlane(10, kind === "beast" ? 10 : 18, [5, kind === "beast" ? 10 : 18]);
    }
    this.material.needsUpdate = true;
    this.shown = "";
  }

  private setPlane(w: number, h: number, foot: [number, number]): void {
    this.geometry?.dispose();
    const pw = w / ART_TILE;
    const ph = h / ART_TILE;
    const g = new THREE.PlaneGeometry(pw, ph);
    g.translate(pw / 2 - foot[0] / ART_TILE, ph / 2 - (h - foot[1]) / ART_TILE, 0);
    const n = g.getAttribute("normal") as THREE.BufferAttribute;
    for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 0.8, 0.6);
    this.geometry = g;
    this.mesh.geometry = g;
  }

  /** Show the drawing for the facing (turned by the camera) and the stride. */
  private pose(force = false): void {
    const step = this.walking ? CYCLE[Math.floor(this.stride / STRIDE) % CYCLE.length]! : 0;
    const atlas = this.ctx.atlas;
    if (this.mode === "person" && this.strip && this.geometry) {
      const d = screenFacing(this.ctx.yaw, this.facing);
      const name = `${d}${step}`;
      if (!force && name === this.shown) return;
      this.shown = name;
      const i = DIRS.indexOf(d) * PERSON_STEPS + step;
      const n = DIRS.length * PERSON_STEPS;
      setUv(this.geometry, { u0: i / n, u1: (i + 1) / n, v0: 0, v1: 1 });
    } else if (this.mode === "beast" && this.geometry) {
      const name = `${this.data.look.sprite}/${screenSide(this.ctx.yaw, this.facing)}${this.walking ? Math.floor(this.stride / 0.35) % 2 : 0}`;
      if (!force && name === this.shown) return;
      this.shown = name;
      const f = atlas.frame(name);
      if (f) setUv(this.geometry, atlas.uv(f));
    } else if (this.mode === "grave" && this.geometry && (force || this.shown !== "grave")) {
      this.shown = "grave";
      const f = atlas.frame("fx/grave");
      if (f) setUv(this.geometry, atlas.uv(f));
    }
  }

  /** Walk to where the server says, along its route if it gave one; far jumps are instant. */
  goTo(a: ActorData, jump = false): void {
    const o = this.ctx.origin;
    const to = { x: a.x - o.x + 0.5, z: a.y - o.y + 0.5 };
    const far = Math.hypot(to.x - this.x, to.z - this.z);
    if (jump || (far > 6 && !a.route)) {
      this.path = [];
      this.x = to.x;
      this.z = to.z;
      return;
    }
    this.path = (a.route ?? [{ x: a.x, y: a.y }]).map((t) => ({ x: t.x - o.x + 0.5, z: t.y - o.y + 0.5 }));
    this.speed = 1 / (this.data.kind === "player" ? Math.min(WALK_MS.player, this.ctx.core.frame.stepMs) : WALK_MS[this.data.kind]);
  }

  get walking(): boolean {
    return this.path.length > 0;
  }

  /** The point above the head (scene units), for names and bubbles. */
  head(): { x: number; y: number; z: number } {
    const size = this.data.look.size ?? 1;
    const h = this.mode === "beast" ? 0.85 : 1.35;
    return { x: this.mesh.position.x, y: this.ctx.height.scene(this.mesh.position.x, this.mesh.position.z) + h * size + 0.1, z: this.mesh.position.z };
  }

  update(delta: number, now: number, boxes: Box[]): void {
    let budget = this.speed * delta;
    const was = this.walking;
    while (this.path.length > 0 && budget > 0) {
      const next = this.path[0]!;
      const dx = next.x - this.x;
      const dz = next.z - this.z;
      const d = Math.hypot(dx, dz);
      if (d > 0.01) this.facing = dirOf(dx, dz);
      if (d <= budget) {
        this.x = next.x;
        this.z = next.z;
        this.path.shift();
        budget -= d;
        this.stride += d;
      } else {
        this.x += (dx / d) * budget;
        this.z += (dz / d) * budget;
        this.stride += budget;
        budget = 0;
      }
    }
    if (!this.walking) {
      this.stride = 0;
      if (was && this.data.facing) this.facing = this.data.facing;
    }
    const bob = this.walking ? Math.abs(Math.sin((this.stride / STRIDE) * Math.PI)) * 0.06 : 0;
    const p = nudgeOut(boxes, this.x, this.z);
    let lx = 0;
    let lz = 0;
    if (this.lungeAt) {
      const k = (now - this.lungeAt.t) / 140;
      if (k >= 1) this.lungeAt = null;
      else {
        const s = Math.sin(k * Math.PI) * 0.2;
        const dx = this.lungeAt.x - p.x;
        const dz = this.lungeAt.z - p.z;
        const d = Math.hypot(dx, dz) || 1;
        lx = (dx / d) * s;
        lz = (dz / d) * s;
      }
    }
    const size = this.data.look.size ?? 1;
    const ground = this.ctx.height.scene(p.x, p.z);
    this.mesh.position.set(p.x + lx, ground + bob, p.z + lz);
    this.mesh.rotation.y = this.ctx.yaw;
    this.mesh.scale.setScalar(size);
    this.shadow.position.set(p.x + lx, ground + 0.03, p.z + lz);
    this.shadow.scale.setScalar(size);
    this.pose();
    this.material.emissive.setHex(now < this.flashUntil ? 0xffffff : 0x000000);
    if (this.fade) {
      const k = Math.min(1, (now - this.fade.t) / 300);
      this.setAlpha(this.fade.from + (this.fade.to - this.fade.from) * k);
      if (k >= 1) {
        const done = this.fade.done;
        this.fade = null;
        done?.();
      }
    }
  }

  private setAlpha(a: number): void {
    this.alpha = a;
    const t = a < 0.999;
    if (this.material.transparent !== t) {
      this.material.transparent = t;
      this.material.needsUpdate = true;
    }
    this.material.opacity = a;
    this.shadow.visible = a > 0.3;
  }

  get opacity(): number {
    return this.alpha;
  }

  flash(): void {
    this.flashUntil = performance.now() + 90;
  }

  lunge(to: { x: number; z: number }): void {
    this.lungeAt = { ...to, t: performance.now() };
  }

  fadeIn(): void {
    this.setAlpha(0);
    this.fade = { from: 0, to: 1, t: performance.now() };
  }

  fadeOut(done: () => void): void {
    this.fade = { from: this.alpha, to: 0, t: performance.now(), done };
  }

  destroy(): void {
    this.ctx.scene.remove(this.mesh, this.shadow);
    this.geometry?.dispose();
    this.material.dispose();
    if (this.shadow.material !== shadowMaterial) (this.shadow.material as THREE.Material).dispose();
    this.shadow.geometry.dispose();
  }
}
