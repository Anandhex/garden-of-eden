import { streamFor } from "../dice.js";
import { recordEvent } from "../events.js";
import { fightOnRoad, type Foe } from "../realm/travel.js";
import type { Town } from "../town.js";
import { weatherOn } from "../weather.js";
import { tickMount } from "./mounts.js";
import { needsOf, tickNeeds } from "./needs.js";

/**
 * Nights on the road (N26 C3). Walking at night is the player's choice; sleeping in the open is a camp: a fire, a
 * watch if there are companions, rest. The night has its chances: things come to a fire, and a horse with nobody on
 * watch can be taken. A bed at a waystation is safer and brings rest back faster (the lodging there).
 */

/** Chance an hour of the night in the open brings something. */
export const NIGHT_CHANCE = 0.1;

const FIRE_LINES = [
  "stares into the fire, saying nothing for a long while.",
  "tells a story about a road much like this one, and a bad end.",
  "hums something low and tuneless, then falls quiet.",
  "turns a coin over and over between their fingers.",
  "mends a strap and talks about home.",
];

/** What companions say by the fire: one line each, from who they are (code's words; no model). */
function fireside(town: Town, rngPick: (n: number) => number): string[] {
  return town.companions().map((c) => {
    const goal = c.persona.goals?.[0];
    const line = goal && rngPick(3) === 0 ? `talks of wanting to ${goal.replace(/^(to )/i, "").replace(/\.$/, "").toLowerCase()}.` : FIRE_LINES[rngPick(FIRE_LINES.length)]!;
    return `${c.persona.name} ${line}`;
  });
}

/** Sleep in the open for `hours`. Returns lines. */
export function camp(town: Town, hours: number, minute: number): string[] {
  const world = town.world;
  const p = world.player;
  const road = p.road!;
  const lines: string[] = [];
  const watch = town.companions().length > 0;
  const pickLine = (n: number) => Math.floor(streamFor(world.seed, "fireside", world.day, road.x, n)() * n);
  lines.push(`You make camp${watch ? ", and set a watch" : ""}: a fire, a cloak on the ground.`);
  lines.push(...fireside(town, pickLine));
  for (let h = 0; h < hours; h++) {
    const hour = world.hour;
    lines.push(...tickNeeds(p, 60, world.day * 1440 + hour * 60, { resting: true, weather: weatherOn(world.day) }));
    lines.push(...tickMount(p, 1, { riding: false, rng: streamFor(world.seed, "mount", world.day, hour) }));
    town.walkMinutes(60); // the place they left lives the hour; its gossip is not theirs to hear
    const night = hour >= 20 || hour < 5;
    const rng = streamFor(world.seed, "camp", world.day, hour, `${road.x}:${road.y}`);
    if (night && rng() < NIGHT_CHANCE * (watch ? 0.5 : 1) * 0.5) {
      // A thief at the horse, or a beast at the fire.
      if (p.mount && !watch && rng() < 0.4) {
        const m = p.mount;
        delete p.mount;
        recordEvent(world as never, { kind: "road", actor: "road", target: "player", details: `${m.name}, the ${m.kind}, was stolen from a camp on the road`, importance: 4, why: "nobody was on watch", witnesses: [] });
        lines.push(`You wake to an empty picket line: ${m.name} has been taken.`);
      } else {
        const foe: Foe = rng() < 0.5 ? { name: "wolves drawn by the fire", power: 12, tier: "F", kind: "pack", id: "camp", species: "wolf" } : { name: "thieves in the dark", power: 14, tier: "E", kind: "gang", id: "camp" };
        lines.push(`Something comes out of the dark: ${foe.name}.`);
        lines.push(...fightOnRoad(world.realm!, p, foe, "your camp", world.day, rng, town.companionPower()));
      }
    }
  }
  // A night's sleep: the body mends a little.
  const n = needsOf(p, minute);
  if (hours >= 4 && p.hp < p.maxHp) p.hp = Math.min(p.maxHp, p.hp + Math.round(p.maxHp * 0.05 * Math.min(hours, 8)));
  road.camp = { x: road.x, y: road.y, day: world.day };
  lines.push(`You wake rested${n.rest < 50 ? " a little" : ""}.`);
  return lines;
}

/** Hours of sleep from now to morning (at least four, at most twelve). */
export function hoursToMorning(hour: number): number {
  const h = (6 - hour + 24) % 24;
  return Math.max(4, Math.min(12, h === 0 ? 8 : h));
}
