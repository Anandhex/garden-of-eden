import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import type { NpcPersona, NpcState, PlayerState, WorldSnapshot } from "../npc/types.js";
import { createNpcState } from "../npc/state.js";
import { startKit } from "../world/world.js";
import { type Creature, type CreatureTemplate, upgradeCreature } from "./creatures.js";
import type { Rng } from "./dice.js";
import { config } from "../config.js";
import { freezeHouses } from "./realm/houses.js";
import { generateRealm } from "./realm/generate.js";
import { pickStartSite } from "./realm/start.js";
import { RealmSchema, type Realm } from "./realm/types.js";
import { parseEvents } from "./events.js";
import { LoreEntrySchema, setDynamicLore, worldLore, type LoreEntry } from "../npc/knowledge.js";
import { seedRumours } from "./rumours.js";
import { SpawnRuleSchema } from "./spawning.js";
import type { DirectorLogEntry } from "../director/validator.js";
import { authoredMarriages, FamilySchema, freshFamily, type FamilyState } from "./family.js";
import { parsePersona } from "../npc/personaSchema.js";
import { BOUND_FIELDS, bindActiveSite, newSite, type SiteState } from "./site.js";
import { registerTalker, type Talker } from "./talkers.js";
import type { Journey } from "@millbrook/shared";

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
 * 10: N15 localities: every place's map is generated, and the
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
 * 12: N25 townsfolk lives. Settlements have a fixed number of `houses`, the realm queues
 *    `casualties` for the day's life step, and figures carry a typed `death` and the
 *    townsperson they rose from (`person`). The database gains `expecting`, `last_birth` and
 *    `stepped_day` on people, `site_days` and `site_seq` (schema 3).
 * 13: N25a a world without a centre, a clean break: older saves are set aside (with the old
 *    `deaths.json`) and a new world begins. No place is special: each settlement keeps its own
 *    state (`sites`: creatures, spawn rules and ledger, news, raid day), every talking person is one
 *    kind of thing in one registry (`talkers`, with the place they belong to), the world began in
 *    a start town the seed picked (`startSite`), and the player always has a `site`.
 */
export const SAVE_VERSION = 13;
/** The oldest save this build can still read (older ones are set aside: N18's clean break). */
export const MIN_SAVE_VERSION = 13;

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
  /** Where the world began (the seed picked it), and what each place keeps about its own day (game/site.ts). */
  startSite: string;
  sites: Record<string, SiteState>;
  /** Every talking person, with the place they belong to (game/talkers.ts). */
  talkers: Record<string, Talker>;
  /** The wider realm (N13, game/realm/). */
  realm?: Realm;
  /** Everyone on a journey on the open road (N26, game/road/journeys.ts), and the counter for their ids. */
  journeys?: Journey[];
  nextJourney?: number;
  /** What the road will bring later (N26): the consequences of a choice made on it, due on a day (game/road/situations.ts). */
  roadLater?: Array<{ id: string; day: number; cause: string; outcomes: unknown[]; actor?: string; actorName?: string }>;
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
  player: z.record(z.string(), z.unknown()),
  npcStates: z.record(z.string(), z.record(z.string(), z.unknown())),
  deaths: z.record(z.string(), z.unknown()),
  startSite: z.string(),
  sites: z.record(z.string(), z.record(z.string(), z.unknown())).default({}),
  talkers: z.record(z.string(), z.object({ site: z.string(), persona: z.unknown(), written: z.unknown().optional() })).default({}),
  position: z.object({ x: z.number().int(), y: z.number().int() }).optional(),
  events: z.array(z.record(z.string(), z.unknown())).optional(),
  lore: z.array(z.unknown()).optional(),
  directorLog: z.array(z.record(z.string(), z.unknown())).optional(),
  family: FamilySchema.optional(),
  realm: z.unknown().optional(),
  journeys: z.array(z.record(z.string(), z.unknown())).optional(),
  nextJourney: z.number().int().optional(),
  roadLater: z.array(z.record(z.string(), z.unknown())).optional(),
  deathNotes: z.record(z.string(), z.unknown()).optional(),
});

/** Keep the valid entries of a list (a bad one is dropped, not trusted). */
function valid<T>(schema: z.ZodType<T>, raw: unknown[] | undefined): T[] {
  return (raw ?? []).flatMap((x) => {
    const r = schema.safeParse(x);
    return r.success ? [r.data] : [];
  });
}

/**
 * A new world. `seed` fixes everything that follows (the realm, the start town, every system's dice); without
 * one it is REALM_SEED, or rolled once from `rng`: the only `Math.random` left in setup. The world begins at
 * 08:00 on day 1 at the gate of the start town the seed picked (game/realm/start.ts). `personas` are people to
 * register as that town's talkers from the start (tests bring hand-written files; the game passes none: the
 * town's notables are made when it is first activated).
 */
export function newWorld(
  personas: Record<string, NpcPersona> = {},
  _creatureTemplates: Record<string, CreatureTemplate> = {},
  rng: Rng = Math.random, // real time, not simulation: it picks the seed, and the seed does the rest
  seed?: number,
): SavedWorld {
  setDynamicLore([]);
  const worldSeed = seed ?? config.realmSeed ?? Math.floor(rng() * 1_000_000_000);
  const day = 1;
  const realm = config.realm ? generateRealm(worldSeed, day) : undefined;
  const startSite = realm ? pickStartSite(realm, worldSeed) : "start";
  const place = realm?.settlements[startSite]?.name ?? "the village";
  const family = freshFamily();
  family.marriages = authoredMarriages(personas);
  const player = startKit();
  player.site = startSite;
  player.place = "gate";
  const world = bindActiveSite({
    day,
    hour: 8,
    minute: 0,
    timeOfDay: "morning" as const,
    location: `the gate of ${place}`,
    nearby: ["the road in", "a milestone"],
    player,
    ...(realm ? { realm } : {}),
    seed: worldSeed,
    rolls: {},
    nextEventSeq: 0,
    version: SAVE_VERSION,
    startSite,
    sites: { [startSite]: newSite() },
    talkers: {},
    npcStates: {},
    deaths: {},
    events: [],
    lore: [],
    directorLog: [],
    family,
  } as unknown as SavedWorld) as SavedWorld;
  for (const p of Object.values(personas)) {
    registerTalker(world, p, startSite);
    world.npcStates[p.id] = createNpcState(p, {}, day);
  }
  // What folk already say about each other (N7.1).
  seedRumours(personas, world.npcStates, day);
  return world;
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
  // "Today in town" is the player's place's own state, which is in `sites`; the working copies are not saved twice.
  const out: Record<string, unknown> = { ...world, version: SAVE_VERSION, saveTick: tick };
  for (const key of BOUND_FIELDS) delete out[key];
  const text = `${JSON.stringify(out)}\n`;
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
  /** The old save was set aside and a new world begun (so the old death record goes too). */
  setAside?: boolean;
}

export function loadWorld(file: string, personas: Record<string, NpcPersona>, creatureTemplates: Record<string, CreatureTemplate> = {}, store?: SaveStore): SavedWorld {
  return loadWorldWithNotice(file, personas, creatureTemplates, store).world;
}

/**
 * Load the world. A save from before v13 is not migrated (the user's call, 2026-10-13): the file is
 * renamed aside, the database is reset and a new world begins, with a notice. A file whose tick isn't
 * the database's throws SaveMismatchError; nothing is guessed.
 */
export function loadWorldWithNotice(file: string, personas: Record<string, NpcPersona>, creatureTemplates: Record<string, CreatureTemplate> = {}, store?: SaveStore): LoadedWorld {
  if (!existsSync(file)) return { world: newWorld(personas, creatureTemplates), notice: null };
  const json = JSON.parse(readFileSync(file, "utf8")) as { version?: unknown; saveTick?: unknown };
  if (typeof json.version !== "number" || json.version < MIN_SAVE_VERSION) {
    const aside = asideName(file, json.version);
    renameSync(file, aside);
    store?.reset();
    return { world: newWorld(personas, creatureTemplates), notice: `Your old save is from an older version (${String(json.version ?? "unknown")}); a new world has begun. The old file is kept as ${aside}.`, setAside: true };
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
  player.site ??= raw.startSite;
  // Lore grown in play first: NPC files in the save may know it, and the schema checks that.
  const lore = valid(LoreEntrySchema, raw.lore) as LoreEntry[];
  setDynamicLore(lore);
  const family: FamilyState = raw.family ? (raw.family as FamilyState) : freshFamily();
  // Everyone who talks (checked like any NPC file; a bad one is dropped).
  const talkers: Record<string, Talker> = Object.fromEntries(
    Object.entries(raw.talkers).flatMap(([id, t]) => {
      try {
        return [[id, { site: t.site, persona: parsePersona(t.persona, `NPC ${id} in the save`), ...(t.written ? { written: t.written as Talker["written"] } : {}) }]];
      } catch {
        return [];
      }
    }),
  );
  // What each place keeps: its creatures are brought up to their templates.
  const sites: Record<string, SiteState> = Object.fromEntries(
    Object.entries(raw.sites).map(([id, r]) => {
      const site = r as unknown as Partial<SiteState>;
      return [
        id,
        {
          ...newSite(),
          ...site,
          creatures: Object.fromEntries(Object.entries(site.creatures ?? {}).flatMap(([uid, c]) => (creatureTemplates[c.template] ? [[uid, upgradeCreature(creatureTemplates[c.template]!, c)]] : []))),
          rules: valid(SpawnRuleSchema, site.rules as unknown[] | undefined),
          // Today's news as lore ids: kept if the lore still has them.
          recentEvents: (site.recentEvents ?? []).filter((e) => lore.some((l) => l.id === e) || worldHas(e)),
        } satisfies SiteState,
      ];
    }),
  );
  sites[raw.startSite] ??= newSite();
  const cast = { ...personas, ...Object.fromEntries(Object.entries(talkers).map(([id, t]) => [id, t.persona])) };
  const npcStates = Object.fromEntries(
    Object.entries(cast).map(([id, persona]) => {
      const saved = raw.npcStates[id] as Partial<NpcState> | undefined;
      // An NPC file added since the save was made starts fresh (createNpcState).
      return [id, createNpcState(persona, saved, raw.day)];
    }),
  );
  const world = {
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
    player,
    npcStates,
    deaths: raw.deaths,
    ...(raw.position ? { position: raw.position } : {}),
    events: parseEvents(raw.events),
    lore,
    directorLog: (raw.directorLog ?? []) as unknown as DirectorLogEntry[],
    family,
    startSite: raw.startSite,
    sites,
    talkers,
    ...(raw.journeys ? { journeys: raw.journeys as unknown as Journey[] } : {}),
    ...(raw.nextJourney !== undefined ? { nextJourney: raw.nextJourney } : {}),
    ...(raw.roadLater ? { roadLater: raw.roadLater as unknown as SavedWorld["roadLater"] } : {}),
    ...(raw.deathNotes ? { deathNotes: raw.deathNotes as SavedWorld["deathNotes"] } : {}),
    ...loadRealm(raw.realm, raw.day, raw.seed),
  } as unknown as SavedWorld;
  return bindActiveSite(world) as SavedWorld;
}

const worldHas = (id: string) => worldLore().byId.has(id);

/** The saved realm if it's sound; otherwise (an older save, or a bad one) a new one. Off: none. */
function loadRealm(raw: unknown, day: number, seed: number): { realm?: Realm } {
  if (!config.realm) return raw ? { realm: raw as Realm } : {};
  const r = RealmSchema.safeParse(raw);
  if (r.success) {
    // A realm from before v12 has no houses on record: each place keeps the number its people gave it.
    freezeHouses(r.data);
    return { realm: r.data };
  }
  return { realm: generateRealm(seed, day) };
}
