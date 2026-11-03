/**
 * What the 2.5D view's layers share (G7): the scene, the art, the core's frame state, the origin (the tile at the
 * scene's 0, 0: the road's tiles are far out and the GPU wants small numbers) and the camera's turn.
 */
import type * as THREE from "three";
import type { Core } from "../../../core";
import type { Atlas } from "./atlas";
import type { HeightField } from "./terrain";

export interface IsoCtx {
  scene: THREE.Scene;
  atlas: Atlas;
  core: Core;
  origin: { x: number; y: number };
  /** The camera's yaw now (it eases while turning). */
  yaw: number;
  /** The land's surface (G7 Part B): how high the ground is anywhere. */
  height: HeightField;
}

/** The scene position of a point given in tiles (x across, y down the map), `up` tiles above the ground. */
export const at = (ctx: IsoCtx, x: number, y: number, up = 0): { x: number; y: number; z: number } => ({ x: x - ctx.origin.x, y: ctx.height.at(x, y) + up, z: y - ctx.origin.y });
