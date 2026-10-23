/**
 * Every art id the frame can send (G6 step 1), by family. Ids name art, never an engine's keys: each adapter
 * keeps its own manifest from these ids to its sheets, with a fallback per family.
 */

/** Ground under everything: patch `ground` values index this list. */
export const TERRAIN_IDS = [
  "terrain/grass",
  "terrain/path",
  "terrain/water",
  "terrain/sand",
  "terrain/hill",
  "terrain/marsh",
  "terrain/field",
  "terrain/ford",
  "terrain/bridge",
  "terrain/town",
  "terrain/yard",
  "terrain/road",
] as const;

/** What stands on the ground: patch `objects` values index this list (0 is nothing). */
export const OBJECT_IDS = [
  null,
  "props/tree",
  "props/rock",
  "props/reeds",
  "props/milestone",
  "props/signpost",
  "props/shrine",
  "props/farmhouse",
  "props/bar",
  "props/thatch",
  "buildings/wall",
  "buildings/door",
  "buildings/gate",
] as const;

export const PEOPLE_IDS = ["people/body", "people/player"] as const;
export const CREATURE_IDS = ["creature/wolf", "creature/bear", "creature/boar", "creature/spider", "creature/horse", "creature/beast"] as const;
/** Graves, shadows, markers and weather; and the atmosphere an adapter adds (glows, fireflies, dust, fog, light shafts, near leaves). */
export const FX_IDS = ["fx/grave", "fx/shadow", "fx/marker", "fx/drop", "fx/flake", "fx/ripple", "fx/glow", "fx/firefly", "fx/dust", "fx/fog", "fx/shaft", "fx/leaves"] as const;

export type ArtId = (typeof TERRAIN_IDS)[number] | NonNullable<(typeof OBJECT_IDS)[number]> | (typeof PEOPLE_IDS)[number] | (typeof CREATURE_IDS)[number] | (typeof FX_IDS)[number];

export const ART_IDS: readonly string[] = [...TERRAIN_IDS, ...OBJECT_IDS.filter((x): x is NonNullable<typeof x> => x !== null), ...PEOPLE_IDS, ...CREATURE_IDS, ...FX_IDS];

export const terrainIndex = (id: (typeof TERRAIN_IDS)[number]): number => TERRAIN_IDS.indexOf(id);
export const objectIndex = (id: NonNullable<(typeof OBJECT_IDS)[number]>): number => OBJECT_IDS.indexOf(id);
