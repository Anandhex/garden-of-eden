import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import type { NpcPersona, NpcState, PlayerState, WorldSnapshot } from "../npc/types.js";
import { createNpcState } from "../npc/state.js";
import { createDemoWorld } from "../world/world.js";
import { DeathRegistry } from "./deaths.js";

/** 2: crafting jobs end at an absolute minute (was an absolute hour). */
export const SAVE_VERSION = 2;

export interface SavedWorld extends WorldSnapshot {
  version: number;
  npcStates: Record<string, NpcState>;
  deaths: Record<string, unknown>;
  /** Where the player stands on the web client's map. Absent in CLI-only saves. */
  position?: { x: number; y: number };
}

const SaveSchema = z.object({
  version: z.number().int().nonnegative(),
  day: z.number().int().positive(),
  hour: z.number().int().min(0).max(23),
  minute: z.number().int().min(0).max(59).optional(),
  timeOfDay: z.enum(["morning", "afternoon", "evening", "night"]),
  location: z.string(),
  nearby: z.array(z.string()),
  recentEvents: z.array(z.string()),
  player: z.record(z.string(), z.unknown()),
  npcStates: z.record(z.string(), z.record(z.string(), z.unknown())),
  deaths: z.record(z.string(), z.unknown()),
  position: z.object({ x: z.number().int(), y: z.number().int() }).optional(),
});

export function newWorld(personas: Record<string, NpcPersona>): SavedWorld {
  const demo = createDemoWorld();
  return {
    ...demo,
    version: SAVE_VERSION,
    npcStates: Object.fromEntries(Object.entries(personas).map(([id, persona]) => [id, createNpcState(persona)])),
    deaths: {},
  };
}

export function saveWorld(file: string, world: SavedWorld): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify({ ...world, version: SAVE_VERSION }, null, 2)}\n`);
}

export function loadWorld(file: string, personas: Record<string, NpcPersona>): SavedWorld {
  if (!existsSync(file)) return newWorld(personas);
  const parsed = SaveSchema.parse(JSON.parse(readFileSync(file, "utf8")));
  const world = upgradeSave(parsed, personas);
  return world;
}

function upgradeSave(raw: z.infer<typeof SaveSchema>, personas: Record<string, NpcPersona>): SavedWorld {
  const player = raw.player as unknown as PlayerState;
  if (!player.journal) player.journal = [];
  const npcStates = Object.fromEntries(
    Object.entries(personas).map(([id, persona]) => {
      const saved = raw.npcStates[id] as Partial<NpcState> | undefined;
      if (raw.version < 2 && saved?.job) saved.job = { ...saved.job, until: saved.job.until * 60 };
      return [id, createNpcState(persona, saved)];
    }),
  );
  return {
    version: SAVE_VERSION,
    day: raw.day,
    hour: raw.hour,
    minute: raw.minute ?? 0,
    timeOfDay: raw.timeOfDay,
    location: raw.location,
    nearby: raw.nearby,
    recentEvents: raw.recentEvents,
    player,
    npcStates,
    deaths: raw.deaths,
    ...(raw.position ? { position: raw.position } : {}),
  };
}

/** Import the old standalone death file once when migrating older saves. */
export function importDeaths(world: SavedWorld, deathsFile: string): SavedWorld {
  if (Object.keys(world.deaths).length > 0) return world;
  const registry = new DeathRegistry(deathsFile);
  world.deaths = registry.all();
  return world;
}
