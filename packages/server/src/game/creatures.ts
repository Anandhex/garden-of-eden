import { readdirSync, readFileSync } from "node:fs";
import { z } from "zod";
import { config } from "../config.js";
import { QUEST_TIERS } from "./levels.js";
import { WEAPON_SKILLS, skillLevel, SkillsSchema, type Skills } from "../npc/skills.js";
import { NpcStatsSchema, type NpcStats } from "../npc/stats.js";
import type { WorldSnapshot } from "../npc/types.js";
import { SPECIES_IDS, speciesOf } from "../world/species.js";
import { absoluteHour } from "./clock.js";
import { attack, check, modifier, type Rng } from "./dice.js";
import { regenPerHour, isSleepingHour } from "./healing.js";
import { type ItemKey, itemKey, itemLabel, parseItem, tierDamageBonus, type Weapon, weaponFor } from "./items.js";
import {
  createLife,
  describeLife,
  effectiveStats,
  gainXp,
  growthStatus,
  type Challenge,
  type Life,
  type LifeContext,
  NEAR_DEATH_SHARE,
  newDay,
  overcome,
  TIERS,
  tierIndex,
  upgradeLife,
  XP,
} from "./life.js";
import { creatureXp, playerGainXp as gainPlayerXp, rankForLevel } from "./levels.js";
import { playerProgressTitles, playerWonFight } from "./titles.js";
import { type Equipment, equippedWeapon, gearLimit, isBroken, playerHasRoom, soak, wearGear } from "./gear.js";
import { formatMoney, MoneySchema } from "./money.js";

/**
 * Creatures: non-talking NPCs. Wolves, bandits, horses, crowds. A stat block
 * with no persona and no model calls; every roll and line is code. They live
 * by the same rules as talking NPCs (game/life.ts): they age, earn XP, and
 * rise in rank only by overcoming challenges, and can die of old age.
 *
 * Their challenges, all rolled in code:
 * - fighting the player (fightCreature, fleeCreature, creatureAmbush);
 * - a daily hunt or raid (`hunts`): success is a challenge at the prey's rank,
 *   failure an injury;
 * - rivalry duels with their own kind (`rivalry`): the winner overcame the loser's rank;
 * - a hard winter at the turn of some years: surviving it is a challenge at
 *   their own rank, and it can kill the very old.
 *
 * A template (src/data/creatures/*.json) describes a kind; spawnCreature makes
 * an individual with its own age, HP and rank, kept in the world save.
 */
const unit = z.number().min(0).max(1);
const itemName = z.string().refine((s) => parseItem(s) !== undefined, { message: "unknown item or tier" });
const lines = z.array(z.string().min(1));

export const CreatureSchema = z
  .object({
    id: z.string().min(1),
    /** "wolf": individuals are named "wolf 1", "wolf 2", ... */
    name: z.string().min(1),
    species: z.enum(SPECIES_IDS as [string, ...string[]]),
    /** Rank a new one spawns at. */
    tier: z.enum(QUEST_TIERS),
    /** Each spawn rolls its own potential in this range: some never grow past their starting rank. */
    potential: z.tuple([z.enum(QUEST_TIERS), z.enum(QUEST_TIERS)]),
    /** Age range in years for new spawns. */
    ageRange: z.tuple([z.number().int().min(0), z.number().int().min(0)]),
    stats: NpcStatsSchema,
    skills: SkillsSchema,
    /** A natural attack (bite, kick) ... */
    attack: z.object({ name: z.string().min(1), die: z.number().int().min(2), skill: z.enum(WEAPON_SKILLS) }).optional(),
    /** ... or a weapon from ITEMS (at or below the creature's rank). */
    weapon: itemName.optional(),
    /** Armour it wears, if any (at or below its rank): soaks damage like the player's. */
    armor: itemName.refine((s) => parseItem(s)?.def.armor !== undefined, { message: "not armour" }).optional(),
    /** Below this share of max HP, a failed morale roll makes them run. */
    fleeAt: unit,
    loot: z.array(z.object({ item: itemName, qty: z.number().int().positive(), chance: unit })),
    /** Coins carried, a [min, max] range rolled on a kill (e.g. ["2 silver", "1 gold"]). */
    money: z.tuple([MoneySchema, MoneySchema]).optional(),
    /** Pre-written lines (or sounds) instead of a model. */
    barks: z.object({ idle: lines, attack: lines, hurt: lines, flee: lines }).partial(),
    /** Attacks a player who comes close. */
    aggressive: z.boolean().default(false),
    /**
     * Daily outings, e.g. { activity: "hunting a deer", rank: "F", chance: 0.5 }. Tried in order with
     * their chance, at most one a day; `rank` is how hard it is.
     */
    hunts: z.array(z.object({ activity: z.string().min(1), rank: z.enum(QUEST_TIERS), chance: unit })).default([]),
    /** Daily chance two of this kind fight for dominance. */
    rivalry: unit.default(0),
    /** Bands together to raid the village at night when strong enough (game/underworld.ts). */
    raids: z.boolean().default(false),
    /**
     * Breeds (N13.6): with two grown ones about and fewer than `cap` alive, a daily `chance`
     * (in spring and summer) of a litter of young. Rolled at midnight (game/realm/rise.ts).
     */
    breeding: z.object({ chance: unit, litter: z.tuple([z.number().int().min(1), z.number().int().min(1)]), cap: z.number().int().min(2) }).strict().optional(),
  })
  .strict()
  .superRefine((c, ctx) => {
    const species = speciesOf(c.species);
    if (!c.attack === !c.weapon) ctx.addIssue({ code: "custom", path: ["attack"], message: "give exactly one of attack or weapon" });
    for (const field of ["weapon", "armor"] as const) {
      const limit = c[field] ? gearLimit(c.tier, c[field]!) : null;
      if (limit) ctx.addIssue({ code: "custom", path: [field], message: limit });
    }
    if (c.ageRange[0] > c.ageRange[1]) ctx.addIssue({ code: "custom", path: ["ageRange"], message: "min is above max" });
    if (c.ageRange[1] >= species.maxAge) ctx.addIssue({ code: "custom", path: ["ageRange"], message: `${species.name} can't live that long` });
    if (QUEST_TIERS.indexOf(c.tier) > QUEST_TIERS.indexOf(species.maxTier)) {
      ctx.addIssue({ code: "custom", path: ["tier"], message: `above the ${species.maxTier} cap for ${species.name}` });
    }
    const [low, high] = c.potential.map((p) => QUEST_TIERS.indexOf(p));
    if (low! < QUEST_TIERS.indexOf(c.tier) || low! > high!) {
      ctx.addIssue({ code: "custom", path: ["potential"], message: "must run from the starting rank (or higher) up" });
    }
    if (high! > QUEST_TIERS.indexOf(species.maxTier)) {
      ctx.addIssue({ code: "custom", path: ["potential"], message: `above the ${species.maxTier} cap for ${species.name}` });
    }
  });
export type CreatureTemplate = z.infer<typeof CreatureSchema> & { skills: Skills; stats: NpcStats };

/** One creature in the world. Saved. */
export interface Creature {
  uid: string;
  template: string;
  name: string;
  hp: number;
  life: Life;
  outcome: "dead" | "fled" | null;
  /** "old age", or who killed it. */
  deathCause: string | null;
  /** Where it is on the browser map (web/server.ts places it). */
  pos?: { x: number; y: number };
  /**
   * Gear it wields and wears (bandits): its own copies, which wear with every
   * blow and drop when it dies. Natural attacks (bites, kicks) aren't gear.
   */
  equipment?: Equipment;
  /** Coins it carries (copper): from the template's range, plus what raids bring in. Dropped on death. */
  money?: number;
  /** Goods it carries off (stolen in raids). Dropped on death. */
  pack?: Record<ItemKey, number>;
  /** Made a name for itself (N13.7): it's a realm figure now (that figure's id). */
  figure?: string;
  /** One of a realm pack's beasts, on another place's map (N15): the pack's id. */
  packId?: string;
  /** Where it roams when that isn't its kind's or its spawn rule's den (N15: another place's woods or camp). */
  den?: string;
}

/** Natural weapons never mend: teeth and claws dull with age instead. Damage lost by age stage. */
export const DULLING: Record<Life["stage"], number> = { young: 0, adult: 0, elder: 1, venerable: 2 };

/** XP for a successful hunt or raid. */
export const HUNT_XP = 10;
/** Share of max HP lost to a failed hunt. */
export const HUNT_INJURY_SHARE = 0.2;
/** Chance a new year starts with a hard winter. */
export const HARD_WINTER_CHANCE = 0.35;
/** Daily chance a thinned-out kind gets a young newcomer. */
export const NEWCOMER_CHANCE = 0.25;

export function parseCreature(raw: unknown, source = "creature file"): CreatureTemplate {
  const result = CreatureSchema.safeParse(raw);
  if (!result.success) {
    const problems = result.error.issues.map((i) => `  ${i.path.join(".") || "(root)"}: ${i.message}`).join("\n");
    throw new Error(`${source} is invalid:\n${problems}`);
  }
  return result.data as CreatureTemplate;
}

/** Every template in a folder (src/data/creatures by default), by id. */
export function loadCreatureTemplates(dir: URL = new URL("../data/creatures/", import.meta.url)): Record<string, CreatureTemplate> {
  const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  return Object.fromEntries(
    files.map((f) => {
      const t = parseCreature(JSON.parse(readFileSync(new URL(f, dir), "utf8")), f);
      return [t.id, t];
    }),
  );
}

export function creatureContext(t: CreatureTemplate): LifeContext {
  return { species: speciesOf(t.species), base: t.stats };
}

export function creatureStats(t: CreatureTemplate, c: Creature): NpcStats {
  return effectiveStats(t.stats, c.life);
}

/**
 * What it fights with. A creature that uses gear fights with its own (worn)
 * copy, and with fists if that's broken or gone. Without `c`, the template's.
 */
export function creatureWeapon(t: CreatureTemplate, c?: Creature): Weapon {
  if (t.weapon) return c ? equippedWeapon(c) : weaponFor(t.weapon)!;
  return { name: t.attack!.name, die: t.attack!.die, skill: t.attack!.skill, tier: t.tier };
}

/** Extra damage on a hit: a weapon's tier, or for a natural attack its rank, less what age has dulled. */
export function creatureDamageBonus(t: CreatureTemplate, c: Creature, weapon: Weapon = creatureWeapon(t, c)): number {
  if (t.weapon) return tierDamageBonus(weapon.tier);
  return tierDamageBonus(t.tier) - DULLING[c.life.stage];
}

/** Does it use gear and have no working weapon? Such creatures look for one (game/underworld.ts). */
export function needsWeapon(t: CreatureTemplate, c: Creature): boolean {
  return t.weapon !== undefined && (!c.equipment?.weapon || isBroken(c.equipment.weapon));
}

/** A roll in the template's money range, or 0. */
function rollMoney(t: CreatureTemplate, rng: Rng): number {
  return t.money ? t.money[0] + Math.floor(rng() * (t.money[1] - t.money[0] + 1)) : 0;
}

/** The gear a new one of this kind starts with: fresh copies of the template's weapon and armour. */
function startingGear(t: CreatureTemplate): Equipment {
  return { ...(t.weapon ? { weapon: itemKey(t.weapon) } : {}), ...(t.armor ? { armor: itemKey(t.armor) } : {}) };
}

/** A new individual of a kind: random age in the template's range (or `age`), full HP. */
export function spawnCreature(t: CreatureTemplate, uid: string, day: number, rng: Rng, name = t.name, age?: number): Creature {
  const [min, max] = t.ageRange;
  age ??= min + Math.floor(rng() * (max - min + 1));
  const [low, high] = t.potential.map((p) => QUEST_TIERS.indexOf(p));
  const potential = QUEST_TIERS[low! + Math.floor(rng() * (high! - low! + 1))]!;
  const life = createLife(speciesOf(t.species), age, t.tier, day, potential);
  const c: Creature = { uid, template: t.id, name, hp: effectiveStats(t.stats, life).maxHp, life, outcome: null, deathCause: null };
  if (t.weapon || t.armor) c.equipment = startingGear(t);
  if (t.money) c.money = rollMoney(t, rng);
  return c;
}

/** Spawn `count` of a kind, named "wolf 1", "wolf 2", ... after any already in `into`. */
export function spawnGroup(
  t: CreatureTemplate,
  count: number,
  into: Record<string, Creature>,
  day: number,
  rng: Rng,
  age?: number,
): Creature[] {
  const made: Creature[] = [];
  let n = Object.values(into).filter((c) => c.template === t.id).length;
  for (let i = 0; i < count; i++) {
    n += 1;
    const c = spawnCreature(t, `${t.id}-${n}`, day, rng, `${t.name} ${n}`, age);
    into[c.uid] = c;
    made.push(c);
  }
  return made;
}

/** Give a creature XP. Returns a log line if it's now ready for a breakthrough. */
export function creatureGainXp(t: CreatureTemplate, c: Creature, xp: number): string | null {
  if (c.outcome === "dead") return null;
  if (!gainXp(c.life, creatureContext(t), xp)) return null;
  return `${c.name} is ready for a breakthrough to rank ${TIERS[tierIndex(c.life.tier) + 1]}.`;
}

/**
 * The creature came out on top of a fight with the player: XP, and a challenge
 * at the player's rank (titles, and a breakthrough if it was ready).
 */
function creatureWins(t: CreatureTemplate, c: Creature, world: WorldSnapshot, xp: number, what: string): string[] {
  const ready = creatureGainXp(t, c, xp);
  const nearDeath = c.hp <= creatureStats(t, c).maxHp * NEAR_DEATH_SHARE;
  const challenge = { kind: "fight" as const, rank: rankForLevel(world.player.level), nearDeath, what };
  return [...(ready ? [ready] : []), ...overcome(c.name, c.life, creatureContext(t), challenge, world.day).log];
}

/** A creature got through a challenge of its own: XP, titles, maybe a breakthrough. */
export function creatureOvercomes(t: CreatureTemplate, c: Creature, xp: number, challenge: Challenge, day: number): string[] {
  const ready = creatureGainXp(t, c, xp);
  return [...(ready ? [ready] : []), ...overcome(c.name, c.life, creatureContext(t), challenge, day).log];
}

/** The day's hunt or raid, if it goes out: success is a challenge at the prey's rank, failure an injury. */
export function goHunting(t: CreatureTemplate, c: Creature, day: number, rng: Rng): string[] {
  for (const hunt of t.hunts) {
    if (rng() >= hunt.chance) continue;
    const stats = creatureStats(t, c);
    const roll = check(rng, stats.attributes.agility, 10 + 2 * tierIndex(hunt.rank), skillLevel(t.skills, "hunting"));
    if (!roll.success) {
      c.hp = Math.max(1, c.hp - Math.ceil(stats.maxHp * HUNT_INJURY_SHARE));
      return [`${c.name} came back hurt from ${hunt.activity}.`];
    }
    // Raiders come back with coin, and blunter blades.
    const take = rollMoney(t, rng);
    if (take > 0) c.money = (c.money ?? 0) + take;
    const broke = c.equipment ? wearGear(c, "weapon") : null;
    return [
      ...creatureOvercomes(t, c, HUNT_XP, { kind: "hunt", rank: hunt.rank, what: hunt.activity }, day),
      ...(broke ? [`${c.name}'s ${broke}`] : []),
    ];
  }
  return [];
}

/** One hour of life: healing, and at midnight aging, a day's XP, maybe death, coming back if it fled, and a hunt. */
export function creatureHour(t: CreatureTemplate, c: Creature, world: Pick<WorldSnapshot, "day" | "hour">, rng: Rng): string[] {
  if (c.outcome === "dead") return [];
  const log: string[] = [];
  if (world.hour === 0) {
    const day = newDay(c.name, c.life, creatureContext(t), world.day, rng);
    log.push(...day.log);
    if (day.died) {
      c.outcome = "dead";
      c.deathCause = "old age";
      return log;
    }
    if (c.outcome === "fled") c.outcome = null; // back by the next day
    log.push(...goHunting(t, c, world.day, rng));
  }
  const stats = creatureStats(t, c);
  c.hp = Math.min(stats.maxHp, c.hp + regenPerHour(stats.attributes, isSleepingHour(world.hour)).hp);
  return log;
}

/** One strike in a duel between two creatures. Never kills: duels for dominance end when one yields. Gear wears. */
function duelStrike(t: CreatureTemplate, from: Creature, to: Creature, rng: Rng): void {
  const a = creatureStats(t, from);
  const d = creatureStats(t, to);
  const weapon = creatureWeapon(t, from);
  const hit = attack(
    rng,
    { strength: a.attributes.strength, weaponSkill: skillLevel(t.skills, weapon.skill) },
    { agility: d.attributes.agility, evasion: skillLevel(t.skills, "evasion") },
    weapon.die,
    creatureDamageBonus(t, from, weapon),
  );
  if (!hit.success) return;
  to.hp = Math.max(1, to.hp - soak(hit.damage, to));
  if (from.equipment) wearGear(from, "weapon");
  if (to.equipment) wearGear(to, "armor");
}

/**
 * Two of a kind fight for dominance until one is down to its flee point and
 * yields. The winner overcame a challenge at the loser's rank; the loser still learns a little.
 */
export function rivalryDuel(t: CreatureTemplate, a: Creature, b: Creature, day: number, rng: Rng): string[] {
  const yields = (c: Creature) => c.hp <= Math.max(1, creatureStats(t, c).maxHp * t.fleeAt);
  let winner: Creature | null = null;
  let loser: Creature | null = null;
  for (let round = 0; round < 40 && !winner; round++) {
    for (const [atk, def] of [[a, b], [b, a]] as const) {
      duelStrike(t, atk, def, rng);
      if (yields(def)) {
        winner = atk;
        loser = def;
        break;
      }
    }
  }
  if (!winner || !loser) return [`${a.name} and ${b.name} fought to a standstill.`];
  const log = [`${winner.name} beat ${loser.name} in a fight for dominance.`];
  const nearDeath = winner.hp <= creatureStats(t, winner).maxHp * NEAR_DEATH_SHARE;
  log.push(...creatureOvercomes(t, winner, XP.winFight, { kind: "fight", rank: loser.life.tier, nearDeath, what: `beating ${loser.name}` }, day));
  const ready = creatureGainXp(t, loser, XP.surviveFight);
  if (ready) log.push(ready);
  return log;
}

/** The first day of a year (not the very first day). */
export function isYearTurn(day: number): boolean {
  return day > 1 && (day - 1) % config.daysPerYear === 0;
}

/** How hard a hard winter is to get through, by age. */
const WINTER_TARGET: Record<Life["stage"], number> = { young: 12, adult: 10, elder: 12, venerable: 14 };

/**
 * A hard winter: every creature rolls endurance. Surviving well is a challenge at
 * their own rank; failing costs half their HP, and kills the very old.
 */
export function hardWinter(templates: Record<string, CreatureTemplate>, creatures: Record<string, Creature>, day: number, rng: Rng): string[] {
  const log = ["A hard winter grips the land."];
  for (const c of Object.values(creatures)) {
    const t = templates[c.template];
    if (!t || c.outcome === "dead") continue;
    const roll = check(rng, creatureStats(t, c).attributes.endurance, WINTER_TARGET[c.life.stage]);
    if (roll.success) {
      log.push(...creatureOvercomes(t, c, 0, { kind: "survival", rank: c.life.tier, what: "surviving a hard winter" }, day));
    } else if (c.life.stage === "venerable") {
      c.outcome = "dead";
      c.deathCause = "the hard winter";
      log.push(`${c.name} didn't survive the winter.`);
    } else {
      c.hp = Math.max(1, Math.floor(c.hp / 2));
      log.push(`${c.name} barely made it through the winter.`);
    }
  }
  return log;
}

/** A kind below its usual numbers may get a young newcomer. */
export function repopulate(
  templates: Record<string, CreatureTemplate>,
  creatures: Record<string, Creature>,
  usual: Record<string, number>,
  day: number,
  rng: Rng,
): string[] {
  const log: string[] = [];
  for (const [id, count] of Object.entries(usual)) {
    const t = templates[id];
    if (!t) continue;
    const alive = Object.values(creatures).filter((c) => c.template === id && c.outcome !== "dead").length;
    if (alive >= count || rng() >= NEWCOMER_CHANCE) continue;
    const [c] = spawnGroup(t, 1, creatures, day, rng, t.ageRange[0]);
    log.push(`A young ${t.name} has come to the area (${c!.name}).`);
  }
  return log;
}

/**
 * Let `hours` pass for every creature, starting from `from` (the clock isn't moved).
 * Runs each hour boundary crossed, like NPC time. At midnight: rivalry duels,
 * a hard winter at the turn of some years, and newcomers if `usual` numbers are given.
 */
export function passCreatureTime(
  templates: Record<string, CreatureTemplate>,
  creatures: Record<string, Creature>,
  from: Pick<WorldSnapshot, "day" | "hour">,
  hours: number,
  rng: Rng,
  usual?: Record<string, number>,
): string[] {
  const log: string[] = [];
  const start = absoluteHour(from);
  for (let h = 1; h <= hours; h++) {
    const abs = start + h;
    const at = { day: Math.floor(abs / 24) + 1, hour: abs % 24 };
    for (const c of Object.values(creatures)) {
      const t = templates[c.template];
      if (t) log.push(...creatureHour(t, c, at, rng));
    }
    if (at.hour !== 0) continue;
    for (const t of Object.values(templates)) {
      const pack = Object.values(creatures).filter((c) => c.template === t.id && !c.outcome && c.life.stage !== "young");
      if (pack.length < 2 || rng() >= t.rivalry) continue;
      const a = pack.splice(Math.floor(rng() * pack.length), 1)[0]!;
      const b = pack[Math.floor(rng() * pack.length)]!;
      log.push(...rivalryDuel(t, a, b, at.day, rng));
    }
    if (isYearTurn(at.day) && rng() < HARD_WINTER_CHANCE) log.push(...hardWinter(templates, creatures, at.day, rng));
    if (usual) log.push(...repopulate(templates, creatures, usual, at.day, rng));
  }
  return log;
}

/** Creature news worth telling the player: rank-ups, titles, deaths, winters and newcomers. */
export function isNotable(line: string): boolean {
  return /broke through|earned the title|didn't survive|died in their sleep|hard winter grips|has come to the area/.test(line);
}

/** A pre-written line for the moment, or null if the template has none. */
export function bark(t: CreatureTemplate, kind: keyof CreatureTemplate["barks"], rng: Rng): string | null {
  const options = t.barks[kind];
  return options && options.length > 0 ? options[Math.floor(rng() * options.length)]! : null;
}

export interface CreatureRound {
  /** What happened, for the player. */
  log: string[];
  /** How the fight ended this round, or null if it goes on. */
  over: "creature dead" | "creature fled" | "player down" | "player fled" | null;
  /** Items and money (copper) the player took, on a kill. */
  loot: Record<string, number>;
  money: number;
}

/** The player beat a creature (killed, or `routed` it): XP, maybe a level, and any titles. Returns lines for them. */
function playerBeatCreature(c: Creature, world: WorldSnapshot, routed: boolean): string[] {
  const player = world.player;
  const xp = creatureXp(c.life.tier, player.level, routed);
  const levels = gainPlayerXp(player, xp);
  return [
    `You gain ${xp} XP.${levels > 0 ? ` You're now level ${player.level}!` : ""}`,
    ...playerWonFight(player, c.life.tier, world.day),
    ...(levels > 0 ? playerProgressTitles(player, world.day) : []),
  ];
}

/**
 * What the player takes from a kill: its gear (as worn as it is), whatever it
 * carried off, its purse, and a roll on the template's loot table. What doesn't
 * fit in the player's pack is left behind.
 */
function takeLoot(t: CreatureTemplate, c: Creature, world: WorldSnapshot, rng: Rng): { loot: Record<string, number>; money: number; left: string[] } {
  const found: Array<[ItemKey, number]> = [
    ...Object.values(c.equipment ?? {}).map((key): [ItemKey, number] => [key, 1]),
    ...Object.entries(c.pack ?? {}),
  ];
  for (const drop of t.loot) if (rng() < drop.chance) found.push([parseItem(drop.item)?.key ?? itemKey(drop.item), drop.qty]);
  const loot: Record<string, number> = {};
  const left: string[] = [];
  for (const [key, qty] of found) {
    if (qty <= 0) continue;
    if (!playerHasRoom(world.player, { [key]: qty })) {
      left.push(key);
      continue;
    }
    loot[key] = (loot[key] ?? 0) + qty;
    world.player.inventory[key] = (world.player.inventory[key] ?? 0) + qty;
  }
  c.equipment = {};
  c.pack = {};
  const money = c.money ?? 0;
  c.money = 0;
  world.player.money += money;
  return { loot, money, left };
}

/** The creature strikes the player. If that drops them, the creature won and grows from it. */
function creatureStrikes(t: CreatureTemplate, c: Creature, world: WorldSnapshot, rng: Rng, log: string[]): boolean {
  const player = world.player;
  const stats = creatureStats(t, c);
  const weapon = creatureWeapon(t, c);
  const hit = attack(
    rng,
    { strength: stats.attributes.strength, weaponSkill: skillLevel(t.skills, weapon.skill) },
    { agility: player.attributes.agility, evasion: skillLevel(player.skills, "evasion") },
    weapon.die,
    creatureDamageBonus(t, c, weapon),
  );
  const line = bark(t, "attack", rng);
  if (line) log.push(`${c.name}: ${line}`);
  if (!hit.success) {
    log.push(`${c.name}'s ${weapon.name} misses you.`);
    return false;
  }
  // The player's armour soaks some of it, and wears.
  const damage = soak(hit.damage, player);
  player.hp = Math.max(0, player.hp - damage);
  log.push(`${c.name}'s ${weapon.name} hits you for ${damage} (${player.hp}/${player.maxHp} HP).`);
  const broke = wearGear(player, "armor");
  if (broke) log.push(`Your ${broke}`);
  const blunted = c.equipment ? wearGear(c, "weapon") : null;
  if (blunted) log.push(`${c.name}'s ${blunted}`);
  if (player.hp > 0) return false;
  log.push(...creatureWins(t, c, world, XP.winFight + 5 * player.level, `bringing down ${player.name}`));
  return true;
}

/**
 * One round of the player fighting a creature, all in code: the player swings
 * with their best weapon; a creature that survives may lose its nerve and run
 * (morale), otherwise it strikes back. Kills drop loot.
 */
export function fightCreature(t: CreatureTemplate, c: Creature, world: WorldSnapshot, rng: Rng): CreatureRound {
  const none = { loot: {}, money: 0 };
  if (c.outcome) return { log: [`${c.name} is ${c.outcome === "dead" ? "dead" : "gone"}.`], over: null, ...none };
  const player = world.player;
  const log: string[] = [];
  const stats = creatureStats(t, c);
  const weapon = equippedWeapon(player);
  const hit = attack(
    rng,
    { strength: player.attributes.strength, weaponSkill: skillLevel(player.skills, weapon.skill) },
    { agility: stats.attributes.agility, evasion: skillLevel(t.skills, "evasion") },
    weapon.die,
    tierDamageBonus(weapon.tier),
  );
  if (hit.success) {
    const damage = soak(hit.damage, c);
    c.hp = Math.max(0, c.hp - damage);
    log.push(`You hit ${c.name} with your ${weapon.name} for ${damage} (${c.hp}/${stats.maxHp} HP).`);
    const broke = wearGear(player, "weapon");
    if (broke) log.push(`Your ${broke}`);
    const torn = c.equipment ? wearGear(c, "armor") : null;
    if (torn) log.push(`${c.name}'s ${torn}`);
  } else {
    log.push(`You swing at ${c.name} and miss.`);
  }

  if (c.hp === 0) {
    c.outcome = "dead";
    c.deathCause = player.name;
    log.push(`${c.name} is dead.`);
    const spoils = takeLoot(t, c, world, rng);
    const got = [...Object.entries(spoils.loot).map(([k, q]) => `${k} x${q}`), ...(spoils.money > 0 ? [`${formatMoney(spoils.money)}`] : [])];
    if (got.length > 0) log.push(`You take: ${got.join(", ")}.`);
    if (spoils.left.length > 0) log.push(`No room in your pack for: ${spoils.left.join(", ")}. You leave it.`);
    log.push(...playerBeatCreature(c, world, false));
    return { log, over: "creature dead", loot: spoils.loot, money: spoils.money };
  }

  if (hit.success) {
    const hurt = bark(t, "hurt", rng);
    if (hurt) log.push(`${c.name}: ${hurt}`);
  }
  if (c.hp <= stats.maxHp * t.fleeAt && !check(rng, stats.attributes.willpower, 10).success) {
    c.outcome = "fled";
    const line = bark(t, "flee", rng);
    if (line) log.push(`${c.name}: ${line}`);
    log.push(`${c.name} runs off.`);
    log.push(...playerBeatCreature(c, world, true));
    const rose = creatureGainXp(t, c, XP.surviveFight);
    if (rose) log.push(rose);
    return { log, over: "creature fled", ...none };
  }

  const down = creatureStrikes(t, c, world, rng, log);
  return { log, over: down ? "player down" : null, ...none };
}

/**
 * The player let a fight turn pass (they didn't act within the combat tick):
 * the creature gets a free strike.
 */
export function creatureTurn(t: CreatureTemplate, c: Creature, world: WorldSnapshot, rng: Rng): CreatureRound {
  const none = { loot: {}, money: 0 };
  if (c.outcome) return { log: [], over: null, ...none };
  const log = ["You hesitate."];
  const down = creatureStrikes(t, c, world, rng, log);
  return { log, over: down ? "player down" : null, ...none };
}

/** An aggressive creature jumps the player who came too close: a free strike to start the fight. */
export function creatureAmbush(t: CreatureTemplate, c: Creature, world: WorldSnapshot, rng: Rng): CreatureRound {
  const log = [`${c.name} attacks you!`];
  const idle = bark(t, "idle", rng);
  if (idle) log.unshift(`${c.name}: ${idle}`);
  const down = creatureStrikes(t, c, world, rng, log);
  return { log, over: down ? "player down" : null, loot: {}, money: 0 };
}

export interface CreatureDefeat {
  rule: "knockout" | "permadeath";
  moneyTaken: number;
  /** Hours the player is out; the caller lets that time pass. */
  hoursOut: number;
  message: string;
}

/**
 * A creature dropped the player to 0 HP: config.playerDefeat, as with NPCs.
 * Knocked out, they wake with a quarter of their HP; creatures that carry money
 * (bandits) rob them. The creature leaves with its prize and is back the next day.
 */
export function creatureBeatsPlayer(t: CreatureTemplate, c: Creature, world: WorldSnapshot): CreatureDefeat {
  const player = world.player;
  if (config.playerDefeat === "permadeath") {
    player.death = { day: world.day, hour: world.hour, killedBy: c.name };
    return { rule: "permadeath", moneyTaken: 0, hoursOut: 0, message: `${c.name} killed you.` };
  }
  const moneyTaken = t.money ? Math.floor(player.money * config.knockoutMoneyShare) : 0;
  player.money -= moneyTaken;
  player.hp = Math.max(1, Math.ceil(player.maxHp * config.knockoutHpShare));
  c.outcome = "fled";
  const hoursOut = config.knockoutRecoveryHours;
  return {
    rule: "knockout",
    moneyTaken,
    hoursOut,
    message: `${c.name} left you for dead. You come to ${hoursOut} hours later with ${player.hp}/${player.maxHp} HP${moneyTaken > 0 ? `, ${formatMoney(moneyTaken)} lighter` : ""}.`,
  };
}

/** The player runs: agility + evasion against 10 + the creature's agility modifier. Failing gives it a free strike. */
export function fleeCreature(t: CreatureTemplate, c: Creature, world: WorldSnapshot, rng: Rng): CreatureRound {
  const none = { loot: {}, money: 0 };
  const player = world.player;
  const stats = creatureStats(t, c);
  const escape = check(rng, player.attributes.agility, 10 + modifier(stats.attributes.agility), skillLevel(player.skills, "evasion"));
  if (escape.success) {
    const log = [`You get away from ${c.name}.`, ...creatureWins(t, c, world, XP.surviveFight, `driving off ${player.name}`)];
    return { log, over: "player fled", ...none };
  }
  const log = [`${c.name} cuts you off.`];
  const down = creatureStrikes(t, c, world, rng, log);
  return { log, over: down ? "player down" : null, ...none };
}

/**
 * Fill in what a creature saved by an older version lacks: its potential (then
 * its current rank), fresh gear from the template, and a middling purse.
 */
export function upgradeCreature(t: CreatureTemplate, c: Creature): Creature {
  const up: Creature = { ...c, life: upgradeLife(c.life, createLife(speciesOf(t.species), 0, c.life.tier, 1, c.life.tier)) };
  if (!up.equipment && (t.weapon || t.armor)) up.equipment = startingGear(t);
  if (up.money === undefined && t.money) up.money = Math.round((t.money[0] + t.money[1]) / 2);
  return up;
}

/** "wolf 2: 5-year-old wolf, rank E, 18/22 HP" */
export function describeCreature(t: CreatureTemplate, c: Creature, day: number): string {
  const status = c.outcome === "dead" ? `dead (${c.deathCause})` : c.outcome === "fled" ? "fled" : `${c.hp}/${creatureStats(t, c).maxHp} HP`;
  const gear = Object.values(c.equipment ?? {}).map(itemLabel);
  const kit = gear.length > 0 ? `, with ${gear.join(" and ")}` : t.weapon ? ", unarmed" : "";
  const species = speciesOf(t.species);
  return `${c.name}: ${describeLife(species.name, c.life, day)}, ${growthStatus(c.life, species)}, ${status}${kit}`;
}
