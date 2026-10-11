/**
 * Every picture in the world view, drawn once at start-up. There are no image files:
 * the look is the old canvas prototype's, made into textures Phaser can batch.
 */
import * as Phaser from "phaser";

export const TILE = 32;

/** Where each character texture's anchor point sits, as an origin (0–1). */
export const ORIGINS = {
  body: [0.5, 0.5],
  head: [8 / 16, 10 / 18],
  beast: [11 / 26, 9 / 21],
  grave: [8 / 16, 16 / 28],
} as const;

export const GRASS_VARIANTS = 4;
export const PATH_VARIANTS = 3;

/** A stable 0–1 number per tile, so the ground doesn't shimmer between redraws. */
export const tileHash = (x: number, y: number): number => {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
};

export function makeTextures(scene: Phaser.Scene): void {
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  const bake = (key: string, w: number, h: number, draw: () => void) => {
    g.clear();
    draw();
    g.generateTexture(key, w, h);
  };

  for (let i = 0; i < GRASS_VARIANTS; i++) {
    bake(`grass${i}`, TILE, TILE, () => {
      g.fillStyle(i % 2 ? 0x4a7a3f : 0x477439).fillRect(0, 0, TILE, TILE);
      g.fillStyle(0xffffff, 0.07);
      g.fillRect(4 + i * 6, 6 + ((i * 7) % 18), 2, 4);
      g.fillRect(20 - i * 3, 22 - i * 2, 2, 3);
    });
  }
  for (let i = 0; i < PATH_VARIANTS; i++) {
    bake(`path${i}`, TILE, TILE, () => {
      g.fillStyle(i % 2 ? 0xa88b5e : 0x9e8256).fillRect(0, 0, TILE, TILE);
      g.fillStyle(0x000000, 0.08).fillRect(4 + i * 8, 6 + i * 7, 4, 3);
      g.fillStyle(0xffffff, 0.05).fillRect(22 - i * 5, 20 - i * 4, 3, 2);
    });
  }
  bake("water", TILE, TILE, () => g.fillStyle(0x3b6fa5).fillRect(0, 0, TILE, TILE));
  bake("ripple", 12, 2, () => g.fillStyle(0xffffff, 0.22).fillRect(0, 0, 12, 2));
  bake("tree", TILE, TILE, () => {
    g.fillStyle(0x5b3d22).fillRect(13, 18, 6, 12);
    g.fillStyle(0x2f5a2c).fillCircle(16, 14, 12);
    g.fillStyle(0xffffff, 0.06).fillCircle(12, 10, 5);
  });
  bake("door", TILE, TILE, () => {
    g.fillStyle(0x3a2a1c).fillRect(6, 2, TILE - 12, TILE - 2);
    g.fillStyle(0xc9a24a).fillRect(TILE - 12, 16, 3, 3);
  });

  // People: a white body (tinted per NPC), a head with hair, a shadow.
  bake("body", 16, 17, () => g.fillStyle(0xffffff).fillRoundedRect(0, 0, 16, 17, 5));
  bake("head", 16, 18, () => {
    g.fillStyle(0xf0d2b0).fillCircle(8, 10, 7);
    g.fillStyle(0x000000, 0.35);
    g.beginPath();
    g.arc(8, 8, 7, Math.PI, 0, false);
    g.closePath();
    g.fillPath();
  });
  bake("shadow", 24, 10, () => g.fillStyle(0x000000, 0.3).fillEllipse(12, 5, 22, 8));
  bake("marker", 10, 7, () => g.fillStyle(0xffd27a).fillTriangle(1, 0, 9, 0, 5, 7));
  // Animals: body, head and legs in one white shape (tinted per kind).
  bake("beast", 26, 21, () => {
    g.fillStyle(0xffffff);
    g.fillRoundedRect(0, 5, 20, 11, 5);
    g.fillRoundedRect(16, 0, 9, 8, 3);
    g.fillRect(2, 14, 3, 6);
    g.fillRect(15, 14, 3, 6);
  });
  bake("grave", 16, 28, () => {
    g.fillStyle(0x8d9097).fillRect(0, 8, 16, 20);
    g.fillCircle(8, 8, 8);
    g.fillStyle(0x555555).fillRect(7, 10, 2, 8);
    g.fillRect(4, 13, 8, 2);
  });
  bake("drop", 2, 9, () => g.fillStyle(0xbfd7ff, 0.7).fillRect(0, 0, 1, 9));
  bake("flake", 4, 4, () => g.fillStyle(0xffffff, 0.9).fillCircle(2, 2, 2));
  bake("spark", 4, 4, () => g.fillStyle(0xffffff).fillRect(0, 0, 4, 4));
  g.destroy();
}

export const hexColor = (hex: string): number => Phaser.Display.Color.HexStringToColor(hex).color;
