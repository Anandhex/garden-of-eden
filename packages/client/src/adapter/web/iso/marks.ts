/**
 * Marks on a place's map (N31) in the 2.5D view (G7), all drawing: soot on the ground of a burned house or a ruin,
 * scaffold poles round one being built, a stone for each grave, an empty trestle, a banner on its pole in its
 * colour, a box drawn round the rest. The words are the frame's (shown on hover).
 */
import * as THREE from "three";
import type { Frame } from "@millbrook/shared/view";
import { hexColor } from "./atlas";
import type { IsoCtx } from "./ctx";

type Mark = NonNullable<Frame["marks"]>[number];

const mat = (color: number, opacity = 1) => new THREE.MeshLambertMaterial({ color, transparent: opacity < 1, opacity, depthWrite: opacity >= 1 });

export class IsoMarks {
  private group = new THREE.Group();

  constructor(private readonly ctx: IsoCtx) {
    ctx.scene.add(this.group);
  }

  draw(marks: Mark[]): void {
    this.group.traverse((c) => {
      const m = c as THREE.Mesh;
      m.geometry?.dispose();
      (m.material as THREE.Material | undefined)?.dispose();
    });
    this.group.clear();
    const o = this.ctx.origin;
    const add = (g: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, shadow = true) => {
      const mesh = new THREE.Mesh(g, m);
      mesh.position.set(x, y, z);
      mesh.castShadow = shadow;
      mesh.receiveShadow = true;
      this.group.add(mesh);
      return mesh;
    };
    for (const m of marks) {
      const lift = new THREE.Group();
      lift.position.y = this.ctx.height.at(m.x + m.w / 2, m.y + m.h / 2);
      const parent = this.group;
      this.group = lift;
      parent.add(lift);
      const x = m.x - o.x;
      const z = m.y - o.y;
      const ground = (color: number, opacity: number) => add(new THREE.PlaneGeometry(m.w, m.h).rotateX(-Math.PI / 2), mat(color, opacity), x + m.w / 2, 0.008, z + m.h / 2, false);
      switch (m.kind) {
        case "burned":
        case "ruin": {
          ground(0x1a1410, m.kind === "ruin" ? 0.8 : 0.6);
          // Charred stumps of the walls.
          for (let k = 0; k < m.w; k++) add(new THREE.BoxGeometry(0.18, 0.5 + ((k * 37) % 5) / 10, 0.18), mat(0x2a201a), x + k + 0.5, 0.3, z + m.h - 0.3);
          break;
        }
        case "scaffold":
          for (const [px, pz] of [
            [0, 0],
            [m.w, 0],
            [0, m.h],
            [m.w, m.h],
          ] as const)
            add(new THREE.BoxGeometry(0.08, 2.2, 0.08), mat(0x9a7a4a), x + px, 1.1, z + pz);
          add(new THREE.BoxGeometry(m.w, 0.06, 0.08), mat(0x9a7a4a), x + m.w / 2, 1.2, z + m.h);
          add(new THREE.BoxGeometry(m.w, 0.06, 0.08), mat(0x9a7a4a), x + m.w / 2, 1.2, z);
          break;
        case "grave":
          add(new THREE.BoxGeometry(0.4, 0.55, 0.14), mat(m.label?.startsWith("an old grave") ? 0x6f6a5c : 0x8f8a7e), x + 0.5, 0.275, z + 0.4);
          ground(0x4a5a32, 0.6).scale.set(0.6 / m.w, 1, 0.5 / m.h);
          break;
        case "stall_empty":
          add(new THREE.BoxGeometry(m.w - 0.2, 0.08, 0.4), mat(0x7a5a3a), x + m.w / 2, 0.7, z + 0.6);
          break;
        case "banner": {
          add(new THREE.BoxGeometry(0.06, 2, 0.06), mat(0x5a4a3a), x + 0.5, 1, z + 0.5);
          const flag = add(new THREE.PlaneGeometry(0.45, 0.6), new THREE.MeshLambertMaterial({ color: hexColor(m.colour ?? "#b5763f"), side: THREE.DoubleSide }), x + 0.75, 1.6, z + 0.5);
          flag.rotation.y = this.ctx.yaw;
          break;
        }
        default:
          ground(0xc0b090, 0.25);
      }
      this.group = parent;
    }
  }
}
