import type { NpcPersona, NpcState, WorldSnapshot } from "../npc/types.js";
import { EXHAUSTED, STARVING } from "./needs.js";
import { townEventsOn } from "./events-calendar.js";
import { weatherOn } from "./weather.js";
import { absoluteHour } from "./clock.js";

/**
 * Daily life (N6): where an NPC is at each hour, and why. Schedules come from the
 * NPC file; urgent needs override them (a starving NPC goes to eat, an exhausted one
 * to bed, a broke one works late), and so do storms and festivals. All in code:
 * no model calls in the simulation.
 */
export const ACTIVITIES = ["work", "eat", "socialise", "sleep", "travel"] as const;
export type Activity = (typeof ACTIVITIES)[number];

/**
 * Places in and around any settlement. "home" is each NPC's own home: nobody else is there.
 * The first five are in the village; the rest are out in its localities (N15): the
 * road out, the camp of a gang off it, the mouth of a dungeon at its end and the woods
 * to the east. Each locality is its own map (web/sites.ts).
 */
export const PLACES = ["forge", "inn", "square", "gate", "camp", "home", "road", "woods", "mine"] as const;
export type PlaceId = (typeof PLACES)[number];

/** The areas around a settlement (N15): the village itself, and its localities. */
export const AREAS = ["village", "road", "camp", "woods", "mine"] as const;
export type AreaId = (typeof AREAS)[number];

/** The map (area) a place is on. */
export function areaOfPlace(place: PlaceId): AreaId {
  return place === "camp" || place === "road" || place === "woods" || place === "mine" ? place : "village";
}

export const PLACE_NAMES: Record<PlaceId, string> = {
  forge: "the forge",
  inn: "the inn",
  square: "the square",
  gate: "the gate",
  camp: "the camp in the woods",
  home: "home",
  road: "the road out",
  woods: "the woods",
  mine: "the mouth of the old workings",
};

/** What's around at each place, for the NPC's situation ("Nearby: ..."), when the place's own map says nothing. */
export const PLACE_NEARBY: Record<PlaceId, string[]> = {
  forge: ["anvil", "glowing forge", "rack of tools", "a stray dog"],
  inn: ["the bar", "a crackling hearth", "regulars at their ale"],
  square: ["the well", "market stalls", "villagers passing"],
  gate: ["the gate", "a worn dirt road", "a bored-looking mule"],
  camp: ["a smouldering campfire", "lean-tos of hide and branches"],
  home: [],
  road: ["cart ruts", "pines on both sides"],
  woods: ["tall pines", "a game trail", "tracks in the mud"],
  mine: ["the dark mine mouth", "rusted rails", "spoil heaps"],
};

/** Walking minutes between any two places in the village. Out to a locality, one more stretch each way. */
export const WALK_MINUTES = 10;

/** Out in the weather: nobody works here in a storm. */
export const OUTDOOR: ReadonlySet<PlaceId> = new Set(["gate", "square", "camp", "road", "woods", "mine"]);

export interface ScheduleBlock {
  /** Hour it starts (0-23), inclusive. */
  from: number;
  /** Hour it ends, exclusive. A block may wrap past midnight (21 → 6). */
  to: number;
  activity: Activity;
  place: PlaceId;
}

/** Hours worked by NPCs whose file has no schedule (the old fixed working day). */
export const DEFAULT_WORK = { from: 6, to: 20 };

/** The schedule an NPC follows: their own, or work 6-20, supper at home, sleep 21-6. */
export function scheduleOf(persona: Pick<NpcPersona, "schedule">): ScheduleBlock[] {
  return (
    persona.schedule ?? [
      { from: DEFAULT_WORK.from, to: DEFAULT_WORK.to, activity: "work", place: "home" },
      { from: 20, to: 21, activity: "eat", place: "home" },
      { from: 21, to: 6, activity: "sleep", place: "home" },
    ]
  );
}

/** Does the hour fall in [from, to), wrapping past midnight? */
export function inHours(hour: number, from: number, to: number): boolean {
  return from <= to ? hour >= from && hour < to : hour >= from || hour < to;
}

/** The block covering an hour. Gaps in a schedule count as free time at home. */
export function blockAt(schedule: ScheduleBlock[], hour: number): ScheduleBlock {
  return schedule.find((b) => inHours(hour, b.from, b.to)) ?? { from: hour, to: (hour + 1) % 24, activity: "socialise", place: "home" };
}

/** Where the NPC works: the place of their first work block. */
export function workplaceOf(persona: Pick<NpcPersona, "schedule">): PlaceId {
  return scheduleOf(persona).find((b) => b.activity === "work")?.place ?? "home";
}

/** Below this much money (copper) an NPC is broke and works through their free time. */
export function brokeBelow(persona: Pick<NpcPersona, "reserveMoney">): number {
  return Math.round((persona.reserveMoney ?? 200) / 2);
}

export interface Plan {
  activity: Activity;
  place: PlaceId;
  /** Why they're off schedule, if they are: "starving", "exhausted", "broke", "storm", "festival". */
  why?: string;
}

/**
 * What the NPC does this hour. The schedule, unless something more urgent wins:
 * 1. exhausted → sleep at home (unless already asleep)
 * 2. starving → eat (at the inn if their schedule ever eats there, else at home)
 * 3. a storm → no outdoor work: they stay home
 * 4. broke → work through eating and socialising time
 * 5. a long working day (8 hours or more) has an hour's break in the middle, to eat
 *    (where they eat out, else at the inn): not for guards on watch, nor for whoever
 *    works at the inn already (N16)
 * 6. the midsummer festival → the evening (18-21) is spent in the square
 */
export function planHour(
  persona: Pick<NpcPersona, "schedule" | "reserveMoney"> & Partial<Pick<NpcPersona, "guard">>,
  state: Pick<NpcState, "needs" | "money"> & Partial<Pick<NpcState, "companion" | "dormant" | "outcome">>,
  world: Pick<WorldSnapshot, "day" | "hour" | "recentEvents" | "lastRaidDay"> & { player?: { place?: PlaceId } },
): Plan {
  // A successor not yet in the world, and the knocked-out, are nowhere to be found.
  if (state.dormant) return { activity: "sleep", place: "home", why: "not here yet" };
  if (state.outcome === "unconscious") return { activity: "sleep", place: "home", why: "out cold" };
  const schedule = scheduleOf(persona);
  const block = blockAt(schedule, world.hour);
  // A baby's whole day is at home (game/family.ts): no festival, work or meal takes them out.
  if (schedule.every((b) => b.place === "home")) return { activity: block.activity, place: "home" };
  // A hired companion goes where the player goes, except to eat and sleep (N8.2).
  if (state.companion && block.activity !== "sleep" && state.needs.energy > EXHAUSTED && state.needs.hunger < STARVING) {
    return { activity: "travel", place: world.player?.place ?? block.place, why: "with you" };
  }
  if (state.needs.energy <= EXHAUSTED && block.activity !== "sleep") return { activity: "sleep", place: "home", why: "exhausted" };
  if (state.needs.hunger >= STARVING && block.activity !== "sleep" && block.activity !== "eat") {
    const eatsOut = schedule.find((b) => b.activity === "eat" && b.place !== "home");
    return { activity: "eat", place: eatsOut?.place ?? "home", why: "starving" };
  }
  if (block.activity === "work" && OUTDOOR.has(block.place) && weatherOn(world.day) === "storm") {
    return { activity: "socialise", place: "home", why: "storm" };
  }
  if ((block.activity === "eat" || block.activity === "socialise") && state.money < brokeBelow(persona)) {
    const work = schedule.find((b) => b.activity === "work");
    if (work) return { activity: "work", place: work.place, why: "broke" };
  }
  if (block.activity === "work" && world.hour === breakHour(block) && !persona.guard && block.place !== "inn" && state.money >= brokeBelow(persona)) {
    const eatsOut = schedule.find((b) => b.activity === "eat" && b.place !== "home");
    return { activity: "eat", place: eatsOut?.place ?? "inn", why: "midday break" };
  }
  if (block.activity !== "sleep" && world.hour >= 18 && world.hour < 21 && townEventsOn(world).includes("festival")) {
    return { activity: "socialise", place: "square", why: "festival" };
  }
  return { activity: block.activity, place: block.place };
}

/** The hour of a working block's break (its middle), or -1 for blocks under 8 hours. */
export function breakHour(block: ScheduleBlock): number {
  const len = (block.to - block.from + 24) % 24 || 24;
  return len >= 8 ? (block.from + Math.floor(len / 2)) % 24 : -1;
}

/** What the NPC is doing now: what this hour's tick decided, or the plan if the tick hasn't run for this hour. */
export function currentPlan(
  persona: Pick<NpcPersona, "schedule" | "reserveMoney"> & Partial<Pick<NpcPersona, "guard">>,
  state: Pick<NpcState, "needs" | "money" | "activity"> & Partial<Pick<NpcState, "companion" | "dormant" | "outcome">>,
  world: Pick<WorldSnapshot, "day" | "hour" | "recentEvents" | "lastRaidDay"> & { player?: { place?: PlaceId } },
): Plan {
  if (state.dormant || state.outcome === "unconscious") return planHour(persona, state, world);
  const a = state.activity;
  // A companion's place follows the player within the hour, too.
  if (state.companion && a?.activity === "travel" && a.at === absoluteHour(world)) return planHour(persona, state, world);
  if (a && a.at === absoluteHour(world)) return { activity: a.activity, place: a.place, ...(a.why ? { why: a.why } : {}) };
  return planHour(persona, state, world);
}

/** The hour the current block ends, for "asleep until 06:00". */
export function blockEnds(persona: Pick<NpcPersona, "schedule">, hour: number): number {
  return blockAt(scheduleOf(persona), hour).to;
}

const DOING: Record<Activity, string> = {
  work: "working",
  eat: "eating",
  socialise: "taking their ease",
  sleep: "asleep",
  travel: "on the road",
};

/** "working", "eating (starving)": what they're doing, without where. */
export function activityWords(plan: Plan): string {
  return `${DOING[plan.activity]}${plan.why ? ` (${plan.why})` : ""}`;
}

/** "working at the forge", "asleep at home (exhausted)". */
export function describePlan(plan: Plan): string {
  return `${DOING[plan.activity]} ${plan.place === "home" ? "at home" : `at ${PLACE_NAMES[plan.place]}`}${plan.why ? ` (${plan.why})` : ""}`;
}

/** Can the player talk to them now? Null if so, else why not ("asleep at home until 06:00"). */
export function unavailable(
  persona: Pick<NpcPersona, "schedule" | "reserveMoney" | "name">,
  state: Pick<NpcState, "needs" | "money" | "activity" | "outcome">,
  world: Pick<WorldSnapshot, "day" | "hour" | "recentEvents" | "lastRaidDay">,
): string | null {
  if (state.outcome === "dead") return `${persona.name} is dead`;
  const plan = currentPlan(persona, state, world);
  if (plan.activity === "sleep") return `${persona.name} is asleep at home until ${String(blockEnds(persona, world.hour)).padStart(2, "0")}:00`;
  if (plan.place === "home") return `${persona.name} is at home`;
  return null;
}

/** Where an NPC is now (null when dead). */
export function placeOf(
  persona: Pick<NpcPersona, "schedule" | "reserveMoney">,
  state: Pick<NpcState, "needs" | "money" | "activity" | "outcome">,
  world: Pick<WorldSnapshot, "day" | "hour" | "recentEvents" | "lastRaidDay">,
): PlaceId | null {
  if (state.outcome === "dead") return null;
  return currentPlan(persona, state, world).place;
}

/** Parse "/go inn", "the forge", "the inn" to a place id. */
export function parsePlace(text: string): PlaceId | null {
  const t = text.trim().toLowerCase().replace(/^the\s+/, "");
  for (const p of PLACES) if (t === p || PLACE_NAMES[p].toLowerCase().replace(/^the\s+/, "") === t) return p;
  if (/goose|tavern|pub/.test(t)) return "inn";
  if (/smith|anvil/.test(t)) return "forge";
  if (/bandit|camp/.test(t)) return "camp";
  if (/road/.test(t)) return "road";
  if (/mine/.test(t)) return "mine";
  if (/wood|forest/.test(t)) return "woods";
  return null;
}
