import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import type { NpcPersona, NpcState, PlayerState, WorldSnapshot } from "../npc/types.js";
import { createNpcState } from "../npc/state.js";
import { createDemoWorld, DEMO_SPAWNS } from "../world/world.js";
import { type Creature, type CreatureTemplate, spawnGroup, upgradeCreature } from "./creatures.js";
import type { Haunts } from "./realm/haunts.js";
import { DeathRegistry } from "./deaths.js";
import { streamFor, type Rng } from "./dice.js";
import { config } from "../config.js";
import { generateRealm } from "./realm/generate.js";
import { RealmSchema, type Realm } from "./realm/types.js";
import { eventIdFor } from "../npc/knowledge.js";
import type { SpawnLedger } from "./spawning.js";
import { parseEvents } from "./events.js";
import { LoreEntrySchema, setDynamicLore, type LoreEntry } from "../npc/knowledge.js";
import { seedRumours } from "./rumours.js";
import { SpawnRuleSchema } from "./spawning.js";
import type { DirectorLogEntry } from "../director/validator.js";
import { authoredMarriages, FamilySchema, freshFamily, type FamilyState } from "./family.js";
import { parsePersona } from "../npc/personaSchema.js";

/**
 * 2: crafting jobs end at an absolute minute (was an absolute hour).
 * 3: NPCs have a life (rank, XP, age), and the world holds creatures.
 * 4: money is copper/silver/gold, counted in copper, in `money` fields (was whole `gold`).
 * 5: equipment slots (weapon, armour) with durability; fights use what's equipped.
 * 6: N4-N6: the event log, the raid day, and NPC memory, relationships, needs and schedules.
 *    Older NPC states get the new fields' defaults on load (createNpcState).
 * 7: N7-N12: NPC-to-NPC relations, rumours, factions and crime, injuries, companions, growth,
 *    arcs, revenge goals; lore grown in play, news dates, spawn rules made in play and the
 *    director's log. Events are checked against EventSchema on load. Older saves get defaults.
 * 8: N11.3 families: marriages, courtships, children on the way, and the NPC files of
 *    those born in play (checked by the persona schema on load). Older saves start with
 *    the marriages the NPC files name.
 * 9: N13 the wider realm (`realm`, checked by RealmSchema; older saves get one generated),
 *    NPC files of people who rose from the crowd (`risen`), and what each death's news
 *    means to those who hear it later (`deathNotes`).
 * 10: N15 localities: Millbrook's map is generated like every other place's, and the
 *    mine road, the bandit camp, the old mine and the woods are maps of their own
 *    (`player.area`). Older saves at home lose their map position (the old hand-made
 *    map's tiles mean nothing now): the player is back at the village gate and the
 *    creatures find their dens again.
 * 11: N18 scale and storage, a clean break: older saves are set aside and a new world
 *    begins (no migrations from v10 or before). Every settlement's people live in the
 *    database (`people`, saved by place in batches), not in the save; the save is compact
 *    JSON written atomically and carries `seed`, `rolls`, `nextEventSeq` (a seed gives the
 *    same world) and `saveTick` (which database moment it goes with). Migrations start
 *    again from here.
 */
export const SAVE_VERSION = 11;

export interface SavedWorld extends WorldSnapshot {
  version: number;
  /** The world's seed: the realm, and every system's dice, come from it (N18). */
  seed: number;
  /** Which database moment this file goes with (N18): `meta.save_tick` in world.db must match. */
  saveTick?: number;
  npcStates: Record<string, NpcState>;
  deaths: Record<string, unknown>;
  /** Where the player stands on the web client's map. Absent in CLI-only saves. */
  position?: { x: number; y: number };
  /** Non-talking NPCs (game/creatures.ts), by uid. */
  creatures: Record<string, Creature>;
  /** Which creatures each spawn rule has out (game/spawning.ts). */
  spawns?: SpawnLedger;
  /** The wider realm (N13, game/realm/). */
  realm?: Realm;
  /** NPC files of people who rose from the crowd to talk (N13.7), by id. */
  risen?: Record<string, NpcPersona>;
  /** NPC files of the people of other places the player has met (N14), by persona id. */
  visitors?: Record<string, NpcPersona>;
  /** The beasts and outlaws of other places' woods and camps (N15), by place, as they were last seen. */
  haunts?: Haunts;
}

export const SaveSchema = z.object({
  version: z.number().int().nonnegative(),
  seed: z.number().int(),
  rolls: z.record(z.string(), z.number().int()).optional(),
  nextEventSeq: z.number().int().optional(),
  saveTick: z.number().int().optional(),
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
  creatures: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
  spawns: z.record(z.string(), z.object({ key: z.string(), uids: z.array(z.string()) })).optional(),
  events: z.array(z.record(z.string(), z.unknown())).optional(),
  lastRaidDay: z.number().int().optional(),
  lore: z.array(z.unknown()).optional(),
  newsDays: z.record(z.string(), z.number()).optional(),
  extraSpawnRules: z.array(z.unknown()).optional(),
  directorLog: z.array(z.record(z.string(), z.unknown())).optional(),
  chronicleDay: z.number().int().optional(),
  family: FamilySchema.optional(),
  realm: z.unknown().optional(),
  risen: z.record(z.string(), z.unknown()).optional(),
  visitors: z.record(z.string(), z.unknown()).optional(),
  haunts: z.record(z.string(), z.record(z.string(), z.record(z.string(), z.unknown()))).optional(),
  deathNotes: z.record(z.string(), z.unknown()).optional(),
});

/** Keep the valid entries of a list (a bad one is dropped, not trusted). */
function valid<T>(schema: z.ZodType<T>, raw: unknown[] | undefined): T[] {
  return (raw ?? []).flatMap((x) => {
    const r = schema.safeParse(x);
    return r.success ? [r.data] : [];
  });
}

/** The starting creatures (DEMO_SPAWNS) for the templates given. Unknown template ids are skipped. */
export function spawnStartingCreatures(templates: Record<string, CreatureTemplate>, day: number, rng: Rng): Record<string, Creature> {
  const creatures: Record<string, Creature> = {};
  for (const [id, count] of Object.entries(DEMO_SPAWNS)) {
    const t = templates[id];
    if (t) spawnGroup(t, count, creatures, day, rng);
  }
  return creatures;
}

/**
 * A new world. `seed` fixes everything that follows (the realm, every system's dice); without
 * one it is REALM_SEED, or rolled once from `rng`: the only `Math.random` left in setup.
 */
export function newWorld(
  personas: Record<string, NpcPersona>,
  creatureTemplates: Record<string, CreatureTemplate> = {},
  rng: Rng = Math.random, // real time, not simulation: it picks the seed, and the seed does the rest
  seed?: number,
): SavedWorld {
  const demo = createDemoWorld();
  setDynamicLore([]);
  const worldSeed = seed ?? config.realmSeed ?? Math.floor(rng() * 1_000_000_000);
  const npcStates = Object.fromEntries(Object.entries(personas).map(([id, persona]) => [id, createNpcState(persona, {}, demo.day)]));
  // What folk already say about each other (N7.1).
  seedRumours(personas, npcStates, demo.day);
  const family = freshFamily();
  family.marriages = authoredMarriages(personas);
  const realm = config.realm ? generateRealm(worldSeed, demo.day) : undefined;
  return {
    ...demo,
    ...(realm ? { realm } : {}),
    seed: worldSeed,
    rolls: {},
    nextEventSeq: 0,
    risen: {},
    visitors: {},
    version: SAVE_VERSION,
    npcStates,
    deaths: {},
    creatures: spawnStartingCreatures(creatureTemplates, demo.day, streamFor(worldSeed, "start", "creatures")),
    spawns: {},
    events: [],
    lore: [],
    newsDays: {},
    extraSpawnRules: [],
    directorLog: [],
    family,
  };
}

/**
 * Everyone in the world: the NPC files, plus those born in play, with grown-up children's
 * files over the originals (all kept in the save). A child born last session is back.
 */
export function castOf(personas: Record<string, NpcPersona>, world: Pick<SavedWorld, "family" | "risen">): Record<string, NpcPersona> {
  // Visitors (N14) aren't the town's cast: the town keeps them apart (game/town.ts).
  return { ...personas, ...(world.family?.born ?? {}), ...(world.risen ?? {}) };
}

/** What the database can do for a save: commit its pending changes at a tick, say which tick it holds, start over. */
export interface SaveStore {
  /** Write the pending changes and `meta.save_tick = tick` in one transaction. */
  commit(tick: number): void;
  /** The tick the last commit stored, or null for a database nothing was committed to. */
  savedTick(): number | null;
  /** Forget the old world. */
  reset(): void;
}

/** Test hooks: `afterDbCommit` runs between the database commit and the file rename (throw in it to simulate a crash). */
export const saveHooks: { afterDbCommit?: () => void } = {};

/** world.json and world.db are from different moments (a crash between the two writes, or one was copied or deleted). */
export class SaveMismatchError extends Error {
  constructor(
    readonly fileTick: number,
    readonly dbTick: number | null,
  ) {
    super(`The save file is from a different moment than the database (file tick ${fileTick}, database tick ${dbTick ?? "none"}). They were saved apart: a crash between the two writes, or one of them was copied or deleted. Start a new world (--new) or put the matching pair back.`);
    this.name = "SaveMismatchError";
  }
}

/**
 * Save the world. With a store, its pending changes are committed first (one transaction that also
 * records the tick), then the file is written to a temp name and renamed over the old one, which is
 * atomic on one disk. The file carries the same tick, and load checks they agree.
 */
export function saveWorld(file: string, world: SavedWorld, store?: SaveStore): void {
  mkdirSync(dirname(file), { recursive: true });
  const tick = (world.saveTick ?? 0) + 1;
  const text = `${JSON.stringify({ ...world, version: SAVE_VERSION, saveTick: tick })}\n`;
  if (store) {
    store.commit(tick);
    saveHooks.afterDbCommit?.();
  }
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, file);
  world.saveTick = tick;
}

/** A name for an old save kept aside: `world.v10.bak.json`, then `.bak2`, ... */
function asideName(file: string, version: unknown): string {
  const base = file.replace(/\.json$/, "");
  const tag = typeof version === "number" ? `v${version}` : "old";
  let name = `${base}.${tag}.bak.json`;
  for (let n = 2; existsSync(name); n++) name = `${base}.${tag}.bak${n}.json`;
  return name;
}

export interface LoadedWorld {
  world: SavedWorld;
  /** One line for the player, when something happened to their save. */
  notice: string | null;
}

export function loadWorld(file: string, personas: Record<string, NpcPersona>, creatureTemplates: Record<string, CreatureTemplate> = {}, store?: SaveStore): SavedWorld {
  return loadWorldWithNotice(file, personas, creatureTemplates, store).world;
}

/**
 * Load the world. A save from before v11 is not migrated (the user's call, 2026-10-13): the file is
 * renamed aside, the database is reset and a new world begins, with a notice. A file whose tick isn't
 * the database's throws SaveMismatchError; nothing is guessed.
 */
export function loadWorldWithNotice(file: string, personas: Record<string, NpcPersona>, creatureTemplates: Record<string, CreatureTemplate> = {}, store?: SaveStore): LoadedWorld {
  if (!existsSync(file)) return { world: newWorld(personas, creatureTemplates), notice: null };
  const json = JSON.parse(readFileSync(file, "utf8")) as { version?: unknown; saveTick?: unknown };
  if (typeof json.version !== "number" || json.version < SAVE_VERSION) {
    const aside = asideName(file, json.version);
    renameSync(file, aside);
    store?.reset();
    return { world: newWorld(personas, creatureTemplates), notice: `Your old save is from an older version (${String(json.version ?? "unknown")}); a new world has begun. The old file is kept as ${aside}.` };
  }
  const parsed = SaveSchema.parse(json);
  if (store && parsed.saveTick !== undefined) {
    const dbTick = store.savedTick();
    if (dbTick !== parsed.saveTick) throw new SaveMismatchError(parsed.saveTick, dbTick);
  }
  return { world: upgradeSave(parsed, personas, creatureTemplates), notice: null };
}

function upgradeSave(
  raw: z.infer<typeof SaveSchema>,
  personas: Record<string, NpcPersona>,
  creatureTemplates: Record<string, CreatureTemplate>,
): SavedWorld {
  const player = raw.player as unknown as PlayerState;
  // Lore grown in play first: NPC files in the save (visitors, N14) may know it, and the schema checks that.
  const lore = valid(LoreEntrySchema, raw.lore) as LoreEntry[];
  setDynamicLore(lore);
  // Families (v8): files in the save (born in play, or grown up) are checked like any NPC file; a bad one is dropped.
  const family: FamilyState = raw.family ? (raw.family as FamilyState) : freshFamily();
  family.born = Object.fromEntries(
    Object.entries(family.born).flatMap(([id, p]) => {
      try {
        return [[id, parsePersona(p, `NPC ${id} in the save`)]];
      } catch {
        return [];
      }
    }),
  );
  if (!raw.family) family.marriages = authoredMarriages(personas);
  // Risen NPCs (v9) are checked like any file too.
  const risen: Record<string, NpcPersona> = Object.fromEntries(
    Object.entries(raw.risen ?? {}).flatMap(([id, p]) => {
      try {
        return [[id, parsePersona(p, `NPC ${id} in the save`)]];
      } catch {
        return [];
      }
    }),
  );
  const visitors: Record<string, NpcPersona> = Object.fromEntries(
    Object.entries(raw.visitors ?? {}).flatMap(([id, p]) => {
      try {
        return [[id, parsePersona(p, `NPC ${id} in the save`)]];
      } catch {
        return [];
      }
    }),
  );
  const cast = { ...personas, ...family.born, ...risen, ...visitors };
  const npcStates = Object.fromEntries(
    Object.entries(cast).map(([id, persona]) => {
      const saved = raw.npcStates[id] as Partial<NpcState> | undefined;
      // An NPC file added since the save was made starts fresh (createNpcState).
      return [id, createNpcState(persona, saved, raw.day)];
    }),
  );
  return {
    version: SAVE_VERSION,
    seed: raw.seed,
    ...(raw.rolls ? { rolls: raw.rolls } : {}),
    nextEventSeq: raw.nextEventSeq ?? 0,
    ...(raw.saveTick !== undefined ? { saveTick: raw.saveTick } : {}),
    day: raw.day,
    hour: raw.hour,
    minute: raw.minute ?? 0,
    timeOfDay: raw.timeOfDay,
    location: raw.location,
    nearby: raw.nearby,
    // Older saves kept event text: map it to its lore id, and drop what isn't in the lore.
    recentEvents: raw.recentEvents.map((e) => eventIdFor(e)).filter((id): id is string => id !== null),
    player,
    npcStates,
    deaths: raw.deaths,
    creatures: raw.creatures
      ? Object.fromEntries(
          Object.entries(raw.creatures as unknown as Record<string, Creature>).map(([uid, c]) => {
            const t = creatureTemplates[c.template];
            return [uid, t ? upgradeCreature(t, c) : c];
          }),
        )
      : spawnStartingCreatures(creatureTemplates, raw.day, streamFor(raw.seed, "start", "creatures")),
    ...(raw.position ? { position: raw.position } : {}),
    spawns: raw.spawns ?? {},
    events: parseEvents(raw.events),
    ...(raw.lastRaidDay !== undefined ? { lastRaidDay: raw.lastRaidDay } : {}),
    lore,
    newsDays: raw.newsDays ?? {},
    extraSpawnRules: valid(SpawnRuleSchema, raw.extraSpawnRules),
    directorLog: (raw.directorLog ?? []) as unknown as DirectorLogEntry[],
    ...(raw.chronicleDay !== undefined ? { chronicleDay: raw.chronicleDay } : {}),
    family,
    risen,
    visitors,
    ...(raw.haunts
      ? {
          haunts: Object.fromEntries(
            Object.entries(raw.haunts as unknown as Haunts).map(([site, cs]) => [
              site,
              Object.fromEntries(Object.entries(cs).flatMap(([uid, c]) => (creatureTemplates[c.template] ? [[uid, upgradeCreature(creatureTemplates[c.template]!, c)]] : []))),
            ]),
          ),
        }
      : {}),
    ...(raw.deathNotes ? { deathNotes: raw.deathNotes as SavedWorld["deathNotes"] } : {}),
    ...loadRealm(raw.realm, raw.day, raw.seed),
  };
}

/** The saved realm if it's sound; otherwise (an older save, or a bad one) a new one. Off: none. */
function loadRealm(raw: unknown, day: number, seed: number): { realm?: Realm } {
  if (!config.realm) return raw ? { realm: raw as Realm } : {};
  const r = RealmSchema.safeParse(raw);
  if (r.success) return { realm: r.data };
  return { realm: generateRealm(seed, day) };
}

/** Import the old standalone death file once when migrating older saves. */
export function importDeaths(world: SavedWorld, deathsFile: string): SavedWorld {
  if (Object.keys(world.deaths).length > 0) return world;
  const registry = new DeathRegistry(deathsFile);
  world.deaths = registry.all();
  return world;
}
