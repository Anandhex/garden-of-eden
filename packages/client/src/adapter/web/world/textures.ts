/**
 * The fallback pictures (G6): drawn in code once at start-up, the old canvas prototype's look. The art is the packed
 * sheets (public/art, `npm run art`); these are drawn only for an id whose sheet or frame is missing (art.ts).
 */
import * as Phaser from "phaser";
import { GRASS_VARIANTS, PATH_VARIANTS } from "../art";

export const TILE = 32;

/** Where each character texture's anchor point sits, as an origin (0–1). */
export const ORIGINS = {
  body: [0.5, 0.5],
  head: [8 / 16, 10 / 18],
  beast: [11 / 26, 9 / 21],
  grave: [8 / 16, 16 / 28],
} as const;


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
  // Town walls (N16): grey stone, with the mortar lines showing.
  bake("stonewall", TILE, TILE, () => {
    g.fillStyle(0x7d7a72).fillRect(0, 0, TILE, TILE);
    g.fillStyle(0x000000, 0.22);
    for (const y of [0, 10, 21]) g.fillRect(0, y, TILE, 2);
    for (const [x, y] of [[8, 2], [24, 2], [2, 12], [17, 12], [10, 23], [26, 23]] as const) g.fillRect(x, y, 2, 8);
    g.fillStyle(0xffffff, 0.08).fillRect(0, 2, TILE, 2);
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

  // ---- The open road (N26): ground and the things beside it ----
  const speckle = (n: number, seed: number, color: number, alpha: number, size = 2) => {
    g.fillStyle(color, alpha);
    for (let i = 0; i < n; i++) g.fillRect(((i * 7 + seed * 13) * 5) % (TILE - size), ((i * 11 + seed * 5) * 3) % (TILE - size), size, size);
  };
  for (let i = 0; i < 3; i++) {
    bake(`rpath${i}`, TILE, TILE, () => {
      g.fillStyle(i % 2 ? 0xb39b6b : 0xa98f60).fillRect(0, 0, TILE, TILE);
      speckle(5, i + 1, 0x000000, 0.1, 3);
      speckle(4, i + 4, 0xffffff, 0.07, 2);
    });
  }
  bake("sand", TILE, TILE, () => {
    g.fillStyle(0xd2bf8a).fillRect(0, 0, TILE, TILE);
    speckle(6, 2, 0x8a7a50, 0.18, 2);
  });
  bake("hill", TILE, TILE, () => {
    g.fillStyle(0x5f7a45).fillRect(0, 0, TILE, TILE);
    g.fillStyle(0x000000, 0.1).fillEllipse(16, 22, 30, 12);
    speckle(4, 3, 0x8d8a80, 0.5, 3);
  });
  bake("marsh", TILE, TILE, () => {
    g.fillStyle(0x4d6a45).fillRect(0, 0, TILE, TILE);
    g.fillStyle(0x3b5a52, 0.55).fillEllipse(11, 20, 15, 7);
    g.fillStyle(0x3b5a52, 0.4).fillEllipse(24, 9, 9, 5);
    speckle(3, 1, 0x2a3f2a, 0.5, 2);
  });
  bake("field", TILE, TILE, () => {
    g.fillStyle(0x8a8f45).fillRect(0, 0, TILE, TILE);
    g.fillStyle(0x6f7435, 0.8);
    for (let y = 2; y < TILE; y += 6) g.fillRect(0, y, TILE, 2);
  });
  bake("reeds", TILE, TILE, () => {
    g.lineStyle(2, 0x6b8a3a);
    for (const [x, h] of [[8, 14], [14, 18], [21, 12], [25, 16]] as const) g.lineBetween(x, 28, x - 1, 28 - h);
    g.fillStyle(0x8a6a3a).fillRect(13, 8, 3, 5);
  });
  bake("rock", TILE, TILE, () => {
    g.fillStyle(0x000000, 0.25).fillEllipse(16, 25, 24, 7);
    g.fillStyle(0x8d8a84).fillEllipse(15, 19, 22, 15);
    g.fillStyle(0xb3b0a8).fillEllipse(12, 15, 10, 6);
  });
  bake("ford", TILE, TILE, () => {
    g.fillStyle(0x6a9bb8).fillRect(0, 0, TILE, TILE);
    g.fillStyle(0xd2bf8a, 0.6);
    for (const [x, y] of [[4, 6], [20, 4], [10, 18], [25, 22], [16, 28]] as const) g.fillEllipse(x, y, 9, 5);
  });
  bake("bridge", TILE, TILE, () => {
    g.fillStyle(0x7a5a38).fillRect(0, 0, TILE, TILE);
    g.fillStyle(0x4b351f);
    for (let x = 0; x < TILE; x += 8) g.fillRect(x, 0, 2, TILE);
    g.fillStyle(0x4b351f).fillRect(0, 0, TILE, 3).fillRect(0, TILE - 3, TILE, 3);
  });
  bake("town", TILE, TILE, () => {
    g.fillStyle(0x8f8a7e).fillRect(0, 0, TILE, TILE);
    g.fillStyle(0x000000, 0.14);
    for (let i = 0; i < TILE; i += 8) g.fillRect(i, 0, 1, TILE).fillRect(0, i, TILE, 1);
  });
  bake("thatch", TILE, TILE, () => {
    g.fillStyle(0x8f8a7e).fillRect(0, 0, TILE, TILE);
    g.fillStyle(0xa0693a).fillRect(3, 6, TILE - 6, TILE - 9);
    g.fillStyle(0x6c4526).fillRect(3, 6, TILE - 6, 5);
    g.lineStyle(1, 0x000000, 0.25).strokeRect(3, 6, TILE - 6, TILE - 9);
  });
  bake("yard", TILE, TILE, () => {
    g.fillStyle(0x7a7f45).fillRect(0, 0, TILE, TILE);
    speckle(7, 2, 0x5b4a2a, 0.35, 2);
  });
  bake("farmhouse", TILE, TILE, () => {
    g.fillStyle(0x000000, 0.22).fillRect(1, 24, TILE - 2, 6);
    g.fillStyle(0xcdb78a).fillRect(1, 12, TILE - 2, 16);
    g.fillStyle(0x9a4a32).fillTriangle(-2, 14, TILE + 2, 14, TILE / 2, 0);
  });
  bake("milestone", TILE, TILE, () => {
    g.fillStyle(0x000000, 0.25).fillEllipse(16, 27, 14, 5);
    g.fillStyle(0xa9a59b).fillRoundedRect(10, 10, 12, 18, 4);
    g.fillStyle(0x4b4a44).fillRect(13, 14, 6, 1).fillRect(13, 18, 6, 1);
  });
  bake("signpost", TILE, TILE, () => {
    g.fillStyle(0x5b3d22).fillRect(15, 6, 3, 22);
    g.fillStyle(0xc9a56a).fillRect(6, 7, 14, 6).fillRect(13, 15, 14, 6);
    g.fillStyle(0x000000, 0.3).fillRect(8, 9, 9, 1).fillRect(15, 17, 9, 1);
  });
  bake("shrine", TILE, TILE, () => {
    g.fillStyle(0x000000, 0.25).fillEllipse(16, 27, 20, 6);
    g.fillStyle(0xc9c3b0).fillRect(8, 14, 16, 13).fillTriangle(5, 15, 27, 15, 16, 4);
    g.fillStyle(0x3a2a1c).fillRect(13, 18, 6, 9);
    g.fillStyle(0xffd27a).fillRect(15, 6, 2, 5);
  });
  bake("bar", TILE, TILE, () => {
    g.fillStyle(0x5b3d22).fillRect(2, 8, 4, 20).fillRect(26, 8, 4, 20);
    g.fillStyle(0xb8423a).fillRect(2, 11, TILE - 4, 4);
    g.fillStyle(0xf3e9d2).fillRect(8, 11, 4, 4).fillRect(18, 11, 4, 4);
  });
  bake("gate", TILE, TILE, () => {
    g.fillStyle(0x7d7a72).fillRect(0, 0, TILE, TILE);
    g.fillStyle(0x3a2a1c).fillRect(5, 6, TILE - 10, TILE - 6);
    g.fillStyle(0xc9a24a).fillRect(TILE - 11, 18, 3, 3);
  });
  bake("lantern", 8, 8, () => g.fillStyle(0xffd27a, 0.9).fillCircle(4, 4, 4));
  g.destroy();
}

export const hexColor = (hex: string): number => Phaser.Display.Color.HexStringToColor(hex).color;
