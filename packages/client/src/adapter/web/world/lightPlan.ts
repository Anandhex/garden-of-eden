/**
 * The light, worked out without Phaser (G6) so a test can check it: the ambient colour for the frame's `ambience`
 * (dawn warm, noon white, dusk orange, night blue; weather dims it), how each kind of light glows, and which few
 * lights get a real Light2D light (the nearest the player that are on; the rest glow without one).
 */
import type { Frame } from "@millbrook/shared/view";

export type Rgb = [number, number, number];

const NIGHT: Rgb = [0.2, 0.25, 0.45];
const DAWN: Rgb = [1.0, 0.8, 0.66];
const DUSK: Rgb = [1.0, 0.66, 0.42];
const NOON: Rgb = [1, 1, 1];
/** Weather's dimming (and a little colour). */
const WEATHER: Record<string, Rgb> = { clear: [1, 1, 1], rain: [0.8, 0.82, 0.88], storm: [0.62, 0.64, 0.72], snow: [0.94, 0.96, 1.0] };

const mix = (a: Rgb, b: Rgb, k: number): Rgb => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];

/** The ambient light, each channel 0–1: daylight from `light`, warm by morning or evening, dimmed by weather. */
export function ambientOf(a: Frame["ambience"]): Rgb {
  const warm = a.timeOfDay === "morning" ? DAWN : DUSK;
  const k = Math.max(0, Math.min(1, a.light));
  let c = k < 0.6 ? mix(NIGHT, warm, k / 0.6) : mix(warm, NOON, (k - 0.6) / 0.4);
  // Full day still leans warm early in the morning and through the evening.
  if (k >= 1 && a.timeOfDay === "evening") c = mix(c, DUSK, 0.18);
  if (k >= 1 && a.timeOfDay === "morning") c = mix(c, DAWN, 0.08);
  const w = WEATHER[a.weather] ?? WEATHER.clear!;
  return [c[0] * w[0], c[1] * w[1], c[2] * w[2]];
}

export const rgbToInt = (c: Rgb): number => (Math.round(Math.min(1, c[0]) * 255) << 16) | (Math.round(Math.min(1, c[1]) * 255) << 8) | Math.round(Math.min(1, c[2]) * 255);

/** How a kind of light looks: colour, reach (tiles), strength, and whether it flickers. */
export const LIGHT_LOOK: Record<NonNullable<Frame["lights"]>[number]["kind"], { color: number; radius: number; intensity: number; flicker: number }> = {
  window: { color: 0xffc46a, radius: 2.4, intensity: 1.1, flicker: 0 },
  lamp: { color: 0xffd890, radius: 3.2, intensity: 1.3, flicker: 0.04 },
  fire: { color: 0xff8a3a, radius: 3.6, intensity: 1.6, flicker: 0.22 },
  torch: { color: 0xffa050, radius: 2.8, intensity: 1.4, flicker: 0.18 },
  forge: { color: 0xff6a2a, radius: 3.4, intensity: 1.7, flicker: 0.16 },
  magic: { color: 0x8ab8ff, radius: 3.0, intensity: 1.2, flicker: 0.1 },
};

/** How much a light shows against the daylight: a little by day (a forge), fully at night. */
export const darkness = (light: number): number => 0.15 + 0.85 * (1 - Math.max(0, Math.min(1, light)));

/** The lights that are on, nearest `to` first, at most `budget`: the ones that get a real light. */
export function nearestLights(lights: NonNullable<Frame["lights"]>, to: { x: number; y: number }, budget: number): NonNullable<Frame["lights"]> {
  return lights
    .filter((l) => l.on)
    .map((l) => ({ l, d: (l.x - to.x) ** 2 + (l.y - to.y) ** 2 }))
    .sort((a, b) => a.d - b.d || (a.l.id < b.l.id ? -1 : 1))
    .slice(0, budget)
    .map((x) => x.l);
}

/** A fire's flicker, 1 ± `amount`, smooth and different per light. */
export function flicker(time: number, seed: number, amount: number): number {
  if (amount === 0) return 1;
  const t = time / 1000;
  return 1 + amount * (0.55 * Math.sin(t * 9.1 + seed) + 0.3 * Math.sin(t * 23.7 + seed * 2.3) + 0.15 * Math.sin(t * 3.3 + seed * 0.7));
}
