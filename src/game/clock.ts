import type { WorldSnapshot } from "../npc/types.js";

export type TimeOfDay = WorldSnapshot["timeOfDay"];

/** 5:00-11:59 morning, 12:00-16:59 afternoon, 17:00-20:59 evening, else night. */
export function timeOfDayAt(hour: number): TimeOfDay {
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 17) return "afternoon";
  if (hour >= 17 && hour < 21) return "evening";
  return "night";
}

/** Hours since the start of day 1, for comparing times. */
export function absoluteHour(world: { day: number; hour: number }): number {
  return (world.day - 1) * 24 + world.hour;
}

/** "16:00", or "Day 2, 09:00" when it's not today. */
export function formatHour(absolute: number, today: number): string {
  const day = Math.floor(absolute / 24) + 1;
  const time = `${String(absolute % 24).padStart(2, "0")}:00`;
  return day === today ? time : `Day ${day}, ${time}`;
}

/** Move the world clock forward, rolling over into new days. */
export function advanceTime(world: WorldSnapshot, hours: number): void {
  const total = world.hour + hours;
  world.day += Math.floor(total / 24);
  world.hour = total % 24;
  world.timeOfDay = timeOfDayAt(world.hour);
}

/** "Day 2, 09:00 (morning)" */
export function formatTime(world: WorldSnapshot): string {
  return `Day ${world.day}, ${String(world.hour).padStart(2, "0")}:00 (${world.timeOfDay})`;
}
