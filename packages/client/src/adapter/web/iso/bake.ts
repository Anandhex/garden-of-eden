/**
 * Baking a person's look (G7), on plain pixels so a test can check it: the people sheet draws a body in four layers
 * (body, clothes, hair, trim), each tinted; the 2.5D view stacks them once per look into one picture, so a crowd
 * costs one sprite a person instead of four.
 */

/** Stack RGBA layers of one size, bottom first, each multiplied by its tint (0xRRGGBB). Alpha is kept as drawn. */
export function bakeLayers(layers: Array<{ px: Uint8ClampedArray; tint: number }>, w: number, h: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(w * h * 4);
  for (const { px, tint } of layers) {
    const r = ((tint >> 16) & 255) / 255;
    const g = ((tint >> 8) & 255) / 255;
    const b = (tint & 255) / 255;
    for (let i = 0; i < w * h * 4; i += 4) {
      const a = px[i + 3]! / 255;
      if (a === 0) continue;
      out[i] = px[i]! * r * a + out[i]! * (1 - a);
      out[i + 1] = px[i + 1]! * g * a + out[i + 1]! * (1 - a);
      out[i + 2] = px[i + 2]! * b * a + out[i + 2]! * (1 - a);
      out[i + 3] = Math.max(out[i + 3]!, px[i + 3]!);
    }
  }
  return out;
}

/** A look's key: the same clothes, trim and hair bake once. */
export const lookKey = (sprite: string, tints: number[]): string => `${sprite}|${tints.join(",")}`;
