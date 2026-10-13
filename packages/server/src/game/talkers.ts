import type { NpcPersona, WorldSnapshot } from "../npc/types.js";

/**
 * Every talking person is one kind of thing (N25a decision 4): a persona with a place it belongs to, in one
 * registry (`world.talkers`), whoever made them: a place's notables on first activation, a townsperson the
 * player spoke to, someone who rose from the crowd, a child born to talkers. `site` is where they live (home);
 * companions travel with the player but still belong to it. Off-screen talkers don't run hourly; they catch up
 * when their place is next the player's.
 */
export interface Talker {
  site: string;
  persona: NpcPersona;
  /** The model wrote their story (N25a step 5): when, which fields passed the checks, and which didn't (code's words stand there). */
  written?: { day: number; fields: string[]; rejected: Record<string, string> };
}

type HasTalkers = Pick<WorldSnapshot, "talkers">;

/** The registry (made on first use). */
export function talkersOf(world: HasTalkers): Record<string, Talker> {
  return (world.talkers ??= {});
}

/** Add a persona to the registry (or replace their file: a child grew up, a model wrote their words). */
export function registerTalker(world: HasTalkers, persona: NpcPersona, site: string): Talker {
  const t = (talkersOf(world)[persona.id] = { site, persona });
  return t;
}

/** The place a talker belongs to, or undefined for someone not in the registry. */
export const talkerSite = (world: HasTalkers, id: string): string | undefined => world.talkers?.[id]?.site;

/** Persona ids of the talkers who belong to a place. */
export function talkerIdsAt(world: HasTalkers, site: string): string[] {
  return Object.entries(world.talkers ?? {}).filter(([, t]) => t.site === site).map(([id]) => id);
}

/** Every talker's persona, by id. */
export function talkerPersonas(world: HasTalkers): Record<string, NpcPersona> {
  return Object.fromEntries(Object.entries(world.talkers ?? {}).map(([id, t]) => [id, t.persona]));
}
