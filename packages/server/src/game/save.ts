import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import type { NpcPersona, NpcState, PlayerState, WorldSnapshot } from "../npc/types.js";
import { createNpcState } from "../npc/state.js";
import { createDemoWorld, DEMO_SPAWNS } from "../world/world.js";
import { type Creature, type CreatureTemplate, spawnGroup, upgradeCreature } from "./creatures.js";
import type { Haunts } from "./realm/haunts.js";
import { DeathRegistry } from "./deaths.js";
import { bestAllowedWeapon, equip, playerGearRank } from "./gear.js";
import { defaultRng, seedFrom, type Rng } from "./dice.js";
import { config } from "../config.js";
import { generateRealm, HOME_ID } from "./realm/generate.js";
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
 */
export const SAVE_VERSION = 10;

/** Copper per old "gold": the old unit became a silver coin, so every price keeps its place. */
const COPPER_PER_OLD_GOLD = 10;

type Loose = Record<string, unknown>;

/** Move a v3 money field (`gold`) to `money`, in copper. */
function moveMoney(o: Loose | undefined | null, from = "gold", to = "money"): void {
  if (!o || typeof o[from] !== "number") return;
  o[to] = (o[from] as number) * COPPER_PER_OLD_GOLD;
  delete o[from];
}

function scale(o: Loose | undefined | null, key: string): void {
  if (o && typeof o[key] === "number") o[key] = (o[key] as number) * COPPER_PER_OLD_GOLD;
}

/** Saves before v4 counted whole gold pieces: convert every amount to copper. */
function upgradeMoney(raw: { player: Loose; npcStates: Record<string, Loose> }): void {
  moveMoney(raw.player);
  const quests = raw.player.quests as { active?: Array<{ reward?: Loose }> } | undefined;
  for (const q of quests?.active ?? []) moveMoney(q.reward);
  for (const s of Object.values(raw.npcStates)) {
    moveMoney(s);
    const debts = s.debts as Loose | undefined;
    for (const id of Object.keys(debts ?? {})) scale(debts, id);
    scale(s.pendingOffer as Loose, "price");
    scale(s.pendingPurchase as Loose, "price");
    scale(s.pendingTraining as Loose, "cost");
    for (const q of (s.questBoard as Array<{ reward?: Loose }> | undefined) ?? []) moveMoney(q.reward);
  }
}

export interface SavedWorld extends WorldSnapshot {
  version: number;
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
export function spawnStartingCreatures(templates: Record<string, CreatureTemplate>, day: number, rng: Rng = defaultRng): Record<string, Creature> {
  const creatures: Record<string, Creature> = {};
  for (const [id, count] of Object.entries(DEMO_SPAWNS)) {
    const t = templates[id];
    if (t) spawnGroup(t, count, creatures, day, rng);
  }
  return creatures;
}

export function newWorld(
  personas: Record<string, NpcPersona>,
  creatureTemplates: Record<string, CreatureTemplate> = {},
  rng: Rng = defaultRng,
): SavedWorld {
  const demo = createDemoWorld();
  setDynamicLore([]);
  const npcStates = Object.fromEntries(Object.entries(personas).map(([id, persona]) => [id, createNpcState(persona, {}, demo.day)]));
  // What folk already say about each other (N7.1).
  seedRumours(personas, npcStates, demo.day);
  const family = freshFamily();
  family.marriages = authoredMarriages(personas);
  const realm = config.realm ? generateRealm(config.realmSeed ?? Math.floor(rng() * 1_000_000_000), demo.day) : undefined;
  return {
    ...demo,
    ...(realm ? { realm } : {}),
    risen: {},
    version: SAVE_VERSION,
    npcStates,
    deaths: {},
    creatures: spawnStartingCreatures(creatureTemplates, demo.day, rng),
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

export function saveWorld(file: string, world: SavedWorld): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify({ ...world, version: SAVE_VERSION }, null, 2)}\n`);
}

export function loadWorld(
  file: string,
  personas: Record<string, NpcPersona>,
  creatureTemplates: Record<string, CreatureTemplate> = {},
): SavedWorld {
  if (!existsSync(file)) return newWorld(personas, creatureTemplates);
  const parsed = SaveSchema.parse(JSON.parse(readFileSync(file, "utf8")));
  const world = upgradeSave(parsed, personas, creatureTemplates);
  return world;
}

function upgradeSave(
  raw: z.infer<typeof SaveSchema>,
  personas: Record<string, NpcPersona>,
  creatureTemplates: Record<string, CreatureTemplate>,
): SavedWorld {
  if (raw.version < 4) upgradeMoney(raw);
  const player = raw.player as unknown as PlayerState;
  if (!player.journal) player.journal = [];
  player.titles ??= [];
  player.fightsWon ??= 0;
  player.maxMp ??= 10;
  player.mp ??= player.maxMp;
  player.quests.failed ??= [];
  if (!player.equipment) {
    // Fights used to pick the best weapon in the pack: equip it (if they're allowed to), so nothing changes for them.
    player.equipment = {};
    const best = bestAllowedWeapon(player.inventory, playerGearRank(player.level));
    if (best) equip(player, playerGearRank(player.level), best, "player");
  }
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
      if (raw.version < 2 && saved?.job) saved.job = { ...saved.job, until: saved.job.until * 60 };
      // Saves before v3 have no life: the NPC is their authored age on the day the save is loaded.
      return [id, createNpcState(persona, saved, raw.day)];
    }),
  );
  // Before v7 nobody had heard any rumours: seed what folk already say.
  if (raw.version < 7) seedRumours(personas, npcStates, raw.day);
  // Before v10 Millbrook had a hand-made map: positions on it mean nothing on the generated one.
  const oldMap = raw.version < 10 && (player.site === undefined || player.site === HOME_ID);
  if (oldMap) {
    delete raw.position;
    delete player.area;
    player.place = "gate";
    for (const c of Object.values((raw.creatures ?? {}) as Record<string, { pos?: unknown }>)) delete c.pos;
  }
  return {
    version: SAVE_VERSION,
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
      : spawnStartingCreatures(creatureTemplates, raw.day),
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
    ...loadRealm(raw.realm, raw.day),
  };
}

/** The saved realm if it's sound; otherwise (an older save, or a bad one) a new one. Off: none. */
function loadRealm(raw: unknown, day: number): { realm?: Realm } {
  if (!config.realm) return raw ? { realm: raw as Realm } : {};
  const r = RealmSchema.safeParse(raw);
  if (r.success) return { realm: r.data };
  return { realm: generateRealm(config.realmSeed ?? seedFrom(`realm-${day}`), day) };
}

/** Import the old standalone death file once when migrating older saves. */
export function importDeaths(world: SavedWorld, deathsFile: string): SavedWorld {
  if (Object.keys(world.deaths).length > 0) return world;
  const registry = new DeathRegistry(deathsFile);
  world.deaths = registry.all();
  return world;
}
