import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import type { NpcPersona, NpcState, PlayerState, WorldSnapshot } from "../npc/types.js";
import { createNpcState } from "../npc/state.js";
import { createDemoWorld, DEMO_SPAWNS } from "../world/world.js";
import { type Creature, type CreatureTemplate, spawnGroup, upgradeCreature } from "./creatures.js";
import { DeathRegistry } from "./deaths.js";
import { bestAllowedWeapon, equip, playerGearRank } from "./gear.js";
import { defaultRng, type Rng } from "./dice.js";
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
 */
export const SAVE_VERSION = 8;

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
  return {
    ...demo,
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
export function castOf(personas: Record<string, NpcPersona>, world: Pick<SavedWorld, "family">): Record<string, NpcPersona> {
  return { ...personas, ...(world.family?.born ?? {}) };
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
  const cast = { ...personas, ...family.born };
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
  const lore = valid(LoreEntrySchema, raw.lore) as LoreEntry[];
  setDynamicLore(lore);
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
  };
}

/** Import the old standalone death file once when migrating older saves. */
export function importDeaths(world: SavedWorld, deathsFile: string): SavedWorld {
  if (Object.keys(world.deaths).length > 0) return world;
  const registry = new DeathRegistry(deathsFile);
  world.deaths = registry.all();
  return world;
}
