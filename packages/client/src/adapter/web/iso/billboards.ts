/**
 * Things that stand on the ground in the 2.5D view (G7): trees, rocks, signposts, doors, furniture, chimneys. Each
 * frame is one instanced mesh, so a forest is one draw; every sprite turns to face the camera's yaw and casts a
 * shadow (alpha-tested, so the shadow has the sprite's shape). A frame with a low-poly model (models.ts, Part B) is
 * drawn as the model instead, turned its own way, not the camera's.
 */
import * as THREE from "three";
import { sheetMaterial, spriteGeometry } from "./atlas";
import { modelGeometry, modelMaterial } from "./models";
import type { IsoCtx } from "./ctx";

export interface Standing {
  frame: string;
  /** Scene position of the foot. */
  x: number;
  y: number;
  z: number;
  scale?: number;
  /** A model's turn about its foot (radians); sprites always face the camera. */
  rot?: number;
}

/** Frames drawn bigger in 2.5D than their tile: trees stand over people. */
const SCALE: Record<string, number> = { "props/tree_0": 1.7, "props/tree_1": 1.7 };

export class Billboards {
  private groups = new Map<string, { mesh: THREE.InstancedMesh; cap: number; model: boolean }>();
  private items: Standing[] = [];
  private shownYaw = Number.NaN;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly s = new THREE.Vector3();
  private readonly p = new THREE.Vector3();
  private static readonly UP = new THREE.Vector3(0, 1, 0);

  constructor(
    private readonly ctx: IsoCtx,
    private readonly shadows = true,
  ) {}

  /** Replace what stands. */
  set(items: Standing[]): void {
    this.items = items;
    this.shownYaw = Number.NaN;
    const by = new Map<string, number>();
    for (const it of items) by.set(it.frame, (by.get(it.frame) ?? 0) + 1);
    for (const [frame, g] of this.groups) {
      if ((by.get(frame) ?? 0) <= g.cap) continue;
      this.ctx.scene.remove(g.mesh);
      g.mesh.dispose();
      this.groups.delete(frame);
    }
    for (const [frame, n] of by) {
      if (this.groups.has(frame)) continue;
      const cap = Math.max(8, Math.ceil(n * 1.5));
      const model = modelGeometry(frame);
      const mesh = model ? new THREE.InstancedMesh(model, modelMaterial(), cap) : new THREE.InstancedMesh(spriteGeometry(this.ctx.atlas, frame), sheetMaterial(this.ctx.atlas, this.ctx.atlas.frame(frame)?.sheet ?? "missing"), cap);
      mesh.castShadow = this.shadows;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      this.ctx.scene.add(mesh);
      this.groups.set(frame, { mesh, cap, model: !!model });
    }
    this.place();
  }

  /** Turn every sprite to the camera (cheap enough to do while the camera turns). */
  update(): void {
    if (this.ctx.yaw !== this.shownYaw) this.place();
  }

  private place(): void {
    this.shownYaw = this.ctx.yaw;
    const face = new THREE.Quaternion().setFromAxisAngle(Billboards.UP, this.ctx.yaw);
    const count = new Map<string, number>();
    for (const it of this.items) {
      const g = this.groups.get(it.frame)!;
      const k = count.get(it.frame) ?? 0;
      count.set(it.frame, k + 1);
      const sc = it.scale ?? SCALE[it.frame] ?? 1;
      if (g.model) this.q.setFromAxisAngle(Billboards.UP, it.rot ?? 0);
      else this.q.copy(face);
      this.m.compose(this.p.set(it.x, it.y, it.z), this.q, this.s.set(sc, sc, sc));
      g.mesh.setMatrixAt(k, this.m);
    }
    for (const [frame, g] of this.groups) {
      g.mesh.count = count.get(frame) ?? 0;
      g.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  dispose(): void {
    for (const g of this.groups.values()) {
      this.ctx.scene.remove(g.mesh);
      g.mesh.dispose();
    }
    this.groups.clear();
  }
}
