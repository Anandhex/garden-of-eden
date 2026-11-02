import { Ground, wildlifeAt, type Wild } from "@millbrook/shared";
import { spawnCreature, type Creature } from "../creatures.js";
import { streamFor } from "../dice.js";
import type { Town } from "../town.js";
import { seasonOf, weatherOn } from "../weather.js";
import { groundAt, landOf, nearestRoad } from "./ground.js";

/**
 * Light wildlife on the road (N26F decision 7), server side. The animals are the shared `wildlifeAt` of the road the player
 * is on; nothing is kept per animal except, once one is hunted, that it was taken that day (`road.taken`), so it isn't drawn
 * again. Hunting one makes it a creature on the road map (`promoteWild`), checked against `wildlifeAt` so the browser can't
 * hunt a deer that isn't there.
 */

/** Days a taken animal is remembered. */
export const TAKEN_DAYS = 2;

/** The animals within `radius` tiles of the player now (not the ones already taken). */
export function wildNear(town: Town, radius = 60): Wild[] {
  const realm = town.world.realm;
  const road = town.world.player.road;
  if (!realm || !road) return [];
  const land = landOf(realm);
  const near = nearestRoad(land, road, radius);
  if (!near || near.road.id.startsWith("spur:")) return [];
  const day = town.world.day;
  const season = seasonOf(day);
  const weather = weatherOn(day);
  const water = (x: number, y: number) => {
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) if (groundAt(land, x + dx, y + dy) === Ground.water) return true;
    return false;
  };
  const taken = road.taken ?? {};
  return wildlifeAt(realm.seed, near.road, near.t - radius, near.t + radius, day, town.world.hour, { water, warm: (season === "summer" || season === "spring") && weather === "clear", winter: season === "winter" })
    .filter((w) => taken[w.id] === undefined && Math.hypot(w.x - road.x, w.y - road.y) <= radius);
}

/** The player goes after an animal: it becomes a creature on the road map, if it's really there. */
export function promoteWild(town: Town, id: string): { creature?: Creature; line: string } {
  const p = town.world.player;
  if (!p.road) return { line: "You're not on the road." };
  const w = wildNear(town, 80).find((x) => x.id === id);
  if (!w) return { line: "Whatever it was is gone." };
  const t = town.templates[w.kind];
  if (!t) return { line: "It's gone." };
  const taken = (p.road.taken ??= {});
  taken[w.id] = town.world.day;
  for (const [k, d] of Object.entries(taken)) if (d < town.world.day - TAKEN_DAYS) delete taken[k];
  const c = spawnCreature(t, w.id, town.world.day, streamFor(town.world.seed, "wild", w.id));
  c.pos = { x: w.x, y: w.y };
  town.roadCreatures[c.uid] = c;
  return { creature: c, line: `You go after the ${t.name}.` };
}
