import { z } from "zod";

/**
 * A soundscape (N29): what should be heard where the player stands, as a pure function of plain facts the server puts in
 * the frame (`frame.sound`): the place, the hour, the weather, who is about and doing what, the buildings near, the wildlife,
 * the mood, the day's events. Beds are looping layers with a target volume; spots are short sounds at a place on the map,
 * placed by a seeded rule (the same for everyone standing there). An adapter plays the result; nothing here plays anything.
 */
export const BEDS = ["wind", "rain_roof", "rain_open", "storm", "snow_hush", "river", "sea", "crowd_murmur", "market", "insects_night", "frogs", "birds_day", "birds_dawn", "fire_hearth", "tavern", "music"] as const;
export type BedId = (typeof BEDS)[number];

export const SPOT_SOURCES = ["hammer", "bell", "owl", "dog", "cart", "horse", "thunder", "watch", "woodpecker", "crow", "hawk", "wolf_howl", "cheer", "shout", "children", "livestock"] as const;
export type SpotSource = (typeof SPOT_SOURCES)[number];

export const ScapeInputSchema = z.object({
  where: z.object({ kind: z.enum(["site", "road", "interior"]), area: z.string().optional(), biome: z.string().optional(), building: z.string().optional() }),
  minute: z.number(),
  season: z.string(),
  weather: z.string(),
  near: z.object({ people: z.number(), working: z.record(z.string(), z.number()), chatting: z.number(), children: z.number() }),
  /** Buildings within 20 tiles: kind, distance, and how far left (−) or right (+). */
  buildings: z.array(z.object({ kind: z.string(), d: z.number(), dx: z.number() })),
  wildlife: z.array(z.object({ species: z.string(), d: z.number(), dx: z.number() })).optional(),
  water: z.enum(["river", "sea"]).optional(),
  predatorsNear: z.boolean().optional(),
  mood: z.object({ grief: z.number(), fear: z.number(), joy: z.number() }).optional(),
  curfew: z.boolean().optional(),
  events: z.array(z.string()).optional(),
});
export type ScapeInput = z.infer<typeof ScapeInputSchema>;

export interface SpotRule {
  /** Stable while its source stands there. */
  id: string;
  source: SpotSource;
  /** Seconds between plays: [least, most]. */
  every: [number, number];
  gain: number;
  /** Where, from the player: distance in tiles and how far to the side. */
  d: number;
  dx: number;
}

export interface Scape {
  beds: Partial<Record<BedId, number>>;
  spots: SpotRule[];
}

const band = (minute: number): "dawn" | "day" | "dusk" | "night" => {
  const h = minute / 60;
  return h >= 4 && h < 7 ? "dawn" : h >= 7 && h < 18 ? "day" : h >= 18 && h < 21 ? "dusk" : "night";
};

const clamp = (v: number) => Math.max(0, Math.min(1, Math.round(v * 100) / 100));
/** Louder the nearer: full within 3 tiles, nothing past `reach`. */
const fall = (d: number, reach = 20) => Math.max(0, Math.min(1, 1 - (d - 3) / (reach - 3)));

/** What should be heard now. Pure. */
export function soundscape(i: ScapeInput): Scape {
  const beds: Partial<Record<BedId, number>> = {};
  const spots: SpotRule[] = [];
  const b = band(i.minute);
  const inside = i.where.kind === "interior";
  const outdoors = !inside;
  const roofs = i.where.kind === "site" || inside;
  const ev = new Set(i.events ?? []);
  const grief = (i.mood?.grief ?? 0) / 100;
  const fear = (i.mood?.fear ?? 0) / 100;
  const joy = (i.mood?.joy ?? 0) / 100;

  // Weather: on the roofs in a place, in the open on the road; a storm's thunder.
  if (i.weather === "rain" || i.weather === "storm") {
    if (roofs) beds.rain_roof = i.weather === "storm" ? 0.9 : 0.6;
    if (i.where.kind === "road") beds.rain_open = i.weather === "storm" ? 0.9 : 0.55;
    if (i.weather === "storm") {
      beds.storm = 0.7;
      spots.push({ id: "thunder", source: "thunder", every: [12, 40], gain: 0.8, d: 30, dx: 0 });
    }
  }
  if (i.weather === "snow" && outdoors) beds.snow_hush = 0.4;
  beds.wind = outdoors ? (i.weather === "storm" ? 0.7 : i.where.biome === "hills" || i.where.biome === "coast" ? 0.35 : i.weather === "snow" ? 0.3 : 0.12) : 0.05;
  if (i.water === "river" && outdoors) beds.river = 0.4;
  if ((i.water === "sea" || i.where.biome === "coast") && outdoors) beds.sea = 0.45;

  // People: the murmur of a crowd (rising slowly with how many), the market on its day, quieter in grief and fear.
  const hush = Math.max(0, 1 - grief * 0.7 - fear * 0.6);
  if (i.near.people > 0 && !i.curfew) beds.crowd_murmur = clamp(Math.log2(1 + i.near.people) / 6 * (outdoors ? 1 : 0.4) * hush * (b === "night" ? 0.3 : 1));
  if (ev.has("market") && b === "day" && outdoors && i.near.people > 5 && !i.curfew) beds.market = clamp(0.5 * hush);
  // The inn of an evening, and inside it.
  const inn = i.buildings.find((x) => x.kind === "inn");
  if (!i.curfew && ((inside && i.where.building === "inn") || (inn && inn.d <= 6 && (b === "dusk" || b === "night")))) beds.tavern = clamp((inside ? 0.7 : 0.4 * fall(inn?.d ?? 0, 8)) * (1 - grief * 0.8) * (1 + joy * 0.3));
  if (inside) beds.fire_hearth = 0.35;
  // Festival music; cheers in joy.
  if (ev.has("festival") && (b === "dusk" || b === "night" || b === "day") && !i.curfew) beds.music = 0.5;
  if (joy > 0.4 && outdoors && i.near.people > 3) spots.push({ id: "cheer", source: "cheer", every: [20, 60], gain: 0.4, d: 8, dx: 0 });

  // The country: birds at dawn and by day (hushed when a predator is near), insects and frogs at night, owls.
  const country = i.where.kind === "road" || i.where.area === "woods" || i.where.kind === "site";
  if (country && outdoors) {
    const hushed = i.predatorsNear ? 0.1 : 1;
    if (b === "dawn") beds.birds_dawn = clamp(0.7 * hushed * (i.season === "winter" ? 0.4 : 1));
    if (b === "day") beds.birds_day = clamp((i.where.kind === "road" ? 0.5 : 0.25) * hushed * (i.season === "winter" ? 0.4 : 1));
    if (b === "night" || b === "dusk") beds.insects_night = clamp((i.season === "summer" ? 0.5 : i.season === "winter" ? 0 : 0.3) * (b === "night" ? 1 : 0.5));
    if ((b === "night" || b === "dusk") && (i.where.biome === "marsh" || i.water === "river") && i.season !== "winter") beds.frogs = 0.4;
    if (b === "night" && (i.where.biome === "forest" || i.where.area === "woods" || i.where.kind === "site")) spots.push({ id: "owl", source: "owl", every: [25, 70], gain: 0.5, d: 15, dx: -6 });
    if (b === "day" && i.where.biome === "forest" && !i.predatorsNear) spots.push({ id: "woodpecker", source: "woodpecker", every: [30, 90], gain: 0.4, d: 18, dx: 5 });
    if (b === "day" && i.where.biome === "hills") spots.push({ id: "hawk", source: "hawk", every: [40, 120], gain: 0.4, d: 25, dx: 0 });
    if (i.predatorsNear && (b === "night" || b === "dusk")) spots.push({ id: "wolf_howl", source: "wolf_howl", every: [30, 80], gain: 0.5, d: 30, dx: 8 });
  }
  for (const w of i.wildlife ?? []) if (w.species.includes("crow") && w.d < 25) spots.push({ id: `crow:${Math.round(w.dx)}`, source: "crow", every: [15, 45], gain: 0.4 * fall(w.d, 25), d: w.d, dx: w.dx });

  // Buildings: the smith's hammer while the smith works, the temple bell on the hour by day, the stable's horses.
  if (!i.curfew) {
    for (const x of i.buildings) {
      if (x.kind === "smithy" && (i.near.working.smith ?? 0) > 0 && x.d <= 20) spots.push({ id: `hammer:${x.dx}`, source: "hammer", every: [1.2, 2.5], gain: 0.6 * fall(x.d), d: x.d, dx: x.dx });
      if (x.kind === "temple" && i.minute % 60 === 0 && i.minute >= 6 * 60 && i.minute <= 20 * 60) spots.push({ id: `bell:${i.minute}`, source: "bell", every: [0, 0], gain: 0.7 * Math.max(0.3, fall(x.d, 40)), d: x.d, dx: x.dx });
    }
    // Children at play out of doors by day, wherever they are near.
    if (outdoors && b === "day" && i.near.children > 0) spots.push({ id: "children", source: "children", every: [i.near.children > 3 ? 12 : 25, 60], gain: 0.3 * Math.min(1, 0.4 + i.near.children / 6) * hush, d: 8, dx: -3 });
    // Stock in the pastures and yards by the road through open farm country, by day.
    if (i.where.kind === "road" && b === "day" && (i.where.biome === "plains" || i.where.biome === "valley")) spots.push({ id: "livestock", source: "livestock", every: [40, 110], gain: 0.3, d: 20, dx: 7 });
    if (i.where.kind === "site" && outdoors && b !== "night" && i.near.people > 3) spots.push({ id: "dog", source: "dog", every: [40, 120], gain: 0.35, d: 12, dx: 4 }, { id: "cart", source: "cart", every: [50, 150], gain: 0.3, d: 10, dx: -5 });
  }
  // A curfew: empty streets but for the watch.
  if (i.curfew) {
    beds.crowd_murmur = 0;
    beds.tavern = 0;
    beds.market = 0;
    spots.push({ id: "watch", source: "watch", every: [30, 90], gain: 0.5, d: 10, dx: 3 });
  }
  if (ev.has("raid")) spots.push({ id: "shout", source: "shout", every: [10, 30], gain: 0.5, d: 15, dx: -3 });
  for (const k of Object.keys(beds) as BedId[]) beds[k] = clamp(beds[k]!);
  return { beds, spots };
}
