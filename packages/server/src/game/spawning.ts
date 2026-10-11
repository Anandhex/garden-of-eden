import { readFileSync } from "node:fs";
import { z } from "zod";
import type { WorldSnapshot } from "../npc/types.js";
import { type Creature, type CreatureTemplate, spawnCreature } from "./creatures.js";
import type { Rng } from "./dice.js";

/**
 * Spawn rules: creatures that turn up by place, time, event or quest
 * (src/data/spawns.json), on top of each kind's usual numbers (DEMO_SPAWNS).
 *
 * - `hours: [from, to]`: around only in those hours (wrapping past midnight, e.g. [21, 4]).
 * - `event`: around while that lore event id is in world.recentEvents.
 * - `quest`: around while the player has that quest active, e.g. the bandits a
 *   "defeat" quest sends them after.
 * - `place`: where they show up (a den key in web/map.ts); defaults to the kind's own den.
 *
 * Every condition given must hold. A rule spawns its group once each time it
 * comes due (each night, each event, each time the quest is taken); ones that
 * are killed stay dead until the next time. When it stops being due, whoever is
 * left moves on and is removed from the world. Which creatures came from which
 * rule is kept in the save (world.spawns).
 */
export const SpawnRuleSchema = z
  .object({
    id: z.string().min(1),
    /** Creature template id. */
    creature: z.string().min(1),
    count: z.number().int().positive(),
    place: z.string().min(1).optional(),
    hours: z.tuple([z.number().int().min(0).max(23), z.number().int().min(0).max(23)]).optional(),
    event: z.string().min(1).optional(),
    quest: z.string().min(1).optional(),
    /** Around until the end of this day, then gone for good (rules made in play: director quests, revenge). */
    untilDay: z.number().int().positive().optional(),
    /** They're lying in wait for the player: they jump them on arrival (revenge ambushes, director/revenge.ts). */
    ambush: z.boolean().optional(),
  })
  .strict();
export type SpawnRule = z.infer<typeof SpawnRuleSchema>;

const SpawnFileSchema = z.object({ rules: z.array(SpawnRuleSchema) }).strict();

/** What each rule has out in the world: when it last spawned (its window key) and which creatures. Saved. */
export type SpawnLedger = Record<string, { key: string; uids: string[] }>;

export function parseSpawnRules(raw: unknown, source = "spawn file"): SpawnRule[] {
  const result = SpawnFileSchema.safeParse(raw);
  if (!result.success) {
    const problems = result.error.issues.map((i) => `  ${i.path.join(".") || "(root)"}: ${i.message}`).join("\n");
    throw new Error(`${source} is invalid:\n${problems}`);
  }
  const ids = new Set<string>();
  for (const r of result.data.rules) {
    if (ids.has(r.id)) throw new Error(`${source} is invalid:\n  duplicate rule id "${r.id}"`);
    ids.add(r.id);
  }
  return result.data.rules;
}

/** The rules in src/data/spawns.json. */
export function loadSpawnRules(file: URL = new URL("../data/spawns.json", import.meta.url)): SpawnRule[] {
  return parseSpawnRules(JSON.parse(readFileSync(file, "utf8")), "src/data/spawns.json");
}

/** Is `hour` inside [from, to], wrapping past midnight? */
export function inHours(hour: number, [from, to]: [number, number]): boolean {
  return from <= to ? hour >= from && hour <= to : hour >= from || hour <= to;
}

/**
 * The key of the window a rule is due in now, or null if it isn't due. A new key
 * means a new group. For hours that wrap past midnight, the small hours belong to
 * the night that started the day before.
 */
export function windowKey(rule: SpawnRule, world: Pick<WorldSnapshot, "day" | "hour" | "recentEvents" | "player">): string | null {
  const parts: string[] = [];
  if (rule.untilDay !== undefined && world.day > rule.untilDay) return null;
  if (rule.hours) {
    if (!inHours(world.hour, rule.hours)) return null;
    const wrapped = rule.hours[0] > rule.hours[1] && world.hour <= rule.hours[1];
    parts.push(`day ${wrapped ? world.day - 1 : world.day}`);
  }
  if (rule.event) {
    if (!world.recentEvents.includes(rule.event)) return null;
    parts.push(rule.event);
  }
  if (rule.quest) {
    if (!world.player.quests.active.some((q) => q.id === rule.quest)) return null;
    // Each time the quest is taken is a new group (it can't be taken twice today, but saves may differ).
    parts.push(`quest ${rule.quest}`);
  }
  return parts.join(", ") || "always";
}

/** A free uid for a new one of this kind ("bandit-7"), and its name ("bandit 7"). */
function freshId(t: CreatureTemplate, creatures: Record<string, Creature>): { uid: string; name: string } {
  let n = Object.values(creatures).filter((c) => c.template === t.id).length + 1;
  while (creatures[`${t.id}-${n}`]) n++;
  return { uid: `${t.id}-${n}`, name: `${t.name} ${n}` };
}

/** "wolves", "bandits", "villagers": for log lines. */
function plural(name: string, n: number): string {
  if (n === 1) return `A ${name}`;
  return `${n} ${name.endsWith("f") ? `${name.slice(0, -1)}ves` : `${name}s`}`;
}

/**
 * Bring the world in line with the rules at the current time: spawn the groups
 * that just came due, and remove what's left of the ones that ended. Creatures in
 * `keep` (e.g. the one fighting the player) are never removed. Returns news lines.
 */
export function applySpawnRules(
  rules: SpawnRule[],
  templates: Record<string, CreatureTemplate>,
  creatures: Record<string, Creature>,
  ledger: SpawnLedger,
  world: Pick<WorldSnapshot, "day" | "hour" | "recentEvents" | "player">,
  rng: Rng,
  keep: ReadonlySet<string> = new Set(),
): string[] {
  const log: string[] = [];
  for (const rule of rules) {
    const t = templates[rule.creature];
    if (!t) continue;
    const key = windowKey(rule, world);
    const out = ledger[rule.id];
    if (out && out.key !== key) {
      // The window ended (or a new one began): whoever is left moves on.
      const stay = out.uids.filter((uid) => keep.has(uid) && creatures[uid] && !creatures[uid]!.outcome);
      const leaving = out.uids.filter((uid) => !stay.includes(uid));
      const alive = leaving.filter((uid) => creatures[uid] && !creatures[uid]!.outcome).length;
      for (const uid of leaving) delete creatures[uid];
      if (alive > 0) log.push(`${plural(t.name, alive)} ${alive === 1 ? "moves" : "move"} on.`);
      if (stay.length > 0) ledger[rule.id] = { key: out.key, uids: stay };
      else delete ledger[rule.id];
      if (stay.length > 0) continue; // the new group waits until the fight is over
    }
    if (key === null || ledger[rule.id]) continue;
    const uids: string[] = [];
    for (let i = 0; i < rule.count; i++) {
      const { uid, name } = freshId(t, creatures);
      creatures[uid] = spawnCreature(t, uid, world.day, rng, name);
      uids.push(uid);
    }
    ledger[rule.id] = { key, uids };
    log.push(`${plural(t.name, rule.count)} ${rule.count === 1 ? "turns" : "turn"} up${rule.place ? ` (${rule.place.replace(/_/g, " ")})` : ""}.`);
  }
  return log;
}

/** Where a creature roams: the place of the rule that spawned it, else its kind's own den (both keys of CREATURE_DENS). */
export function denKey(rules: SpawnRule[], ledger: SpawnLedger, c: Creature): string {
  for (const [id, out] of Object.entries(ledger)) {
    if (!out.uids.includes(c.uid)) continue;
    const place = rules.find((r) => r.id === id)?.place;
    if (place) return place;
  }
  return c.template;
}

/** Every rule in play: the file's, plus the ones made during play (world.extraSpawnRules), dropping expired ones. */
export function allSpawnRules(fileRules: SpawnRule[], world: { extraSpawnRules?: SpawnRule[]; day: number }): SpawnRule[] {
  if (world.extraSpawnRules) world.extraSpawnRules = world.extraSpawnRules.filter((r) => r.untilDay === undefined || world.day <= r.untilDay + 1);
  return [...fileRules, ...(world.extraSpawnRules ?? [])];
}

/** Creatures lying in wait for the player (ambush rules) still alive and out. */
export function ambushers(rules: SpawnRule[], ledger: SpawnLedger, creatures: Record<string, Creature>): Creature[] {
  return rules
    .filter((r) => r.ambush)
    .flatMap((r) => ledger[r.id]?.uids ?? [])
    .map((uid) => creatures[uid])
    .filter((c): c is Creature => !!c && !c.outcome);
}

/** Rule creature kinds and places that don't exist: a typo in spawns.json. */
export function badSpawnRules(rules: SpawnRule[], templates: Record<string, CreatureTemplate>, places: readonly string[]): string[] {
  const problems: string[] = [];
  for (const r of rules) {
    if (!templates[r.creature]) problems.push(`${r.id}: no creature "${r.creature}"`);
    if (r.place && !places.includes(r.place)) problems.push(`${r.id}: no place "${r.place}"`);
  }
  return problems;
}
