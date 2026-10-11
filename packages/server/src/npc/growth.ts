import { z } from "zod";
import { ATTRIBUTES, type Attribute, type Attributes } from "./stats.js";
import { type Skill, SKILLS, skillLevel, type Skills, TIERS as SKILL_TIERS } from "./skills.js";
import type { Trait, Traits } from "./traits.js";

/** The trait names (kept here, not imported: traits.ts reads growth, so importing back would be circular). */
const TRAIT_NAMES = ["temper", "bravery", "honesty", "generosity", "sociability", "forgiveness"] as const;
import type { NpcPersona, NpcState, PlayerState } from "./types.js";
import { hoursToNextLevel } from "../game/training.js";
import { tierIndex, type Tier } from "../game/life.js";

/**
 * Growth (N9, N12.5): skills, attributes and traits change only by overcoming
 * something, never by the model's say-so.
 *
 * - **Skill XP and trials.** Everyday use adds XP toward a skill's next tier, up to
 *   what that tier needs. Crossing it takes a *trial*: a harder piece of that work
 *   (a fine blade, a fight won against a peer, a hard check passed). So routine alone
 *   never makes a master.
 * - **Challenges** written in the NPC file (`growth`), checked in code: "forge five
 *   C-tier pieces", "clear the debt", "survive a fight without running".
 * - **Attributes** gain +1 at a milestone, capped at 20 and at a few per rank.
 * - **Traits drift** a little after big events: at most ±0.05 an event, ±0.1 a
 *   week, ±0.2 over a lifetime from the file, and never outside 0..1.
 *
 * All saved as changes on top of the NPC file (state.growth); the file stays the
 * starting point. The model only hears words ("you've grown sharper at the forge").
 */

export interface TraitShift {
  day: number;
  trait: Trait;
  delta: number;
  reason: string;
  /** The event behind it (game/events.ts), when there is one. */
  event?: string;
}

export interface GrowthState {
  /** XP toward each skill's next tier. */
  skillXp: Partial<Record<Skill, number>>;
  /** Tiers gained on top of the file. */
  skills: Partial<Record<Skill, number>>;
  /** Attribute points gained on top of the file. */
  attributes: Partial<Attributes>;
  /** Drift on top of the file's traits. */
  traits: Partial<Traits>;
  traitLog: TraitShift[];
  /** Progress on the file's growth challenges, by id. */
  challenges: Record<string, { count: number; done?: number }>;
  /** Growth lines not yet told to the model ("you've grown braver"), with the day. */
  news: Array<{ day: number; text: string }>;
}

export const freshGrowth = (): GrowthState => ({ skillXp: {}, skills: {}, attributes: {}, traits: {}, traitLog: [], challenges: {}, news: [] });

/** Fill in a saved growth record (older saves have none). */
export function upgradeGrowth(saved: Partial<GrowthState> | undefined): GrowthState {
  return { ...freshGrowth(), ...(saved ?? {}) };
}

// ---- Caps ----

export const TRAIT_STEP_CAP = 0.05;
export const TRAIT_WEEK_CAP = 0.1;
export const TRAIT_LIFETIME_CAP = 0.2;
/** Attribute milestones allowed: 2, plus one per rank above G. */
export const milestoneCap = (rank: Tier) => 2 + tierIndex(rank);
export const ATTRIBUTE_MAX = 20;

/** XP a skill needs to be ready for its next tier: 20 for novice, up to 100 for master. */
export function skillXpNeeded(level: number): number {
  return 20 * (level + 1);
}

// ---- Schema for NPC files ----

const unit = z.number().min(-0.05).max(0.05);
export const GrowthChallengeSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9_]+$/),
    /** In words, for logs: "forge five C-tier pieces". */
    describe: z.string().min(1),
    trigger: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("craft"), minTier: z.string(), count: z.number().int().positive() }).strict(),
      z.object({ kind: z.literal("debt_cleared") }).strict(),
      z.object({ kind: z.literal("survive_fight"), count: z.number().int().positive() }).strict(),
      z.object({ kind: z.literal("win_fight"), count: z.number().int().positive() }).strict(),
      z.object({ kind: z.literal("sell"), count: z.number().int().positive() }).strict(),
      z.object({ kind: z.literal("quest_done"), count: z.number().int().positive() }).strict(),
    ]),
    improves: z
      .object({
        /** XP toward the skill's next tier (filled), so the next hard piece of work is the trial. */
        skill: z.enum(SKILLS).optional(),
        /** +1, if they have a milestone left. Also where a maxed skill's growth goes. */
        attribute: z.enum(ATTRIBUTES).optional(),
        trait: z.object({ trait: z.enum(TRAIT_NAMES), delta: unit }).strict().optional(),
      })
      .strict()
      .refine((i) => i.skill || i.attribute || i.trait, "improves something"),
    /** Counts again after it's met (a trait that keeps drifting, say); caps still apply. */
    repeat: z.boolean().optional(),
  })
  .strict();
export type GrowthChallenge = z.infer<typeof GrowthChallengeSchema>;
export type GrowthTrigger = GrowthChallenge["trigger"];

// ---- Effective values ----

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/** Skills with growth on top, before injuries (game/health.ts takes those off in npcSkills). */
export function grownSkills(base: Skills, growth: Pick<GrowthState, "skills"> | undefined): Skills {
  if (!growth) return base;
  const out: Skills = { ...base };
  for (const [s, d] of Object.entries(growth.skills) as Array<[Skill, number]>) out[s] = clamp(skillLevel(base, s) + d, 0, 5);
  return out;
}

/** Traits with drift on top. */
export function driftedTraits(base: Traits, growth: Pick<GrowthState, "traits"> | undefined): Traits {
  if (!growth) return base;
  const out = { ...base };
  for (const [t, d] of Object.entries(growth.traits) as Array<[Trait, number]>) out[t] = clamp(Math.round((base[t] + d) * 1000) / 1000, 0, 1);
  return out;
}

// ---- NPC skill XP and trials ----

/** XP multiplier for a skill that runs in the family (persona.talents, game/family.ts). */
export const TALENT_XP = 1.5;

/**
 * Practice: XP toward the skill's next tier, up to what it needs. A talent (a gift
 * from their parents) learns faster. Returns a line if this made them ready for a trial (once).
 */
export function addSkillXp(persona: NpcPersona, state: NpcState, skill: Skill, xp: number): string | null {
  const level = skillLevel(grownSkills(persona.skills, state.growth), skill);
  if (level >= 5 || xp <= 0) return null;
  if (persona.talents?.includes(skill)) xp *= TALENT_XP;
  const need = skillXpNeeded(level);
  const before = state.growth.skillXp[skill] ?? 0;
  const after = Math.min(need, before + xp);
  state.growth.skillXp[skill] = after;
  return before < need && after >= need ? `${persona.name} is ready to prove themselves at ${skill.replace("_", "-")}.` : null;
}

/** Is the skill's XP full, so the next hard piece of work is a trial? */
export function readyForTrial(persona: NpcPersona, state: NpcState, skill: Skill): boolean {
  const level = skillLevel(grownSkills(persona.skills, state.growth), skill);
  return level < 5 && (state.growth.skillXp[skill] ?? 0) >= skillXpNeeded(level);
}

/**
 * A hard piece of work in this skill: if they were ready, it's the trial, and the
 * skill rises a tier. Returns a line if it did.
 */
export function skillTrial(persona: NpcPersona, state: NpcState, skill: Skill, passed: boolean, day: number): string | null {
  if (!passed || !readyForTrial(persona, state, skill)) return null;
  state.growth.skills[skill] = (state.growth.skills[skill] ?? 0) + 1;
  state.growth.skillXp[skill] = 0;
  const level = skillLevel(grownSkills(persona.skills, state.growth), skill);
  const words = `you've become ${SKILL_TIERS[level]} at ${skill.replace("_", "-")}`;
  state.growth.news.push({ day, text: words });
  state.memories.push({ id: `skill-${skill}-${level}`, day, text: `${words} after a hard trial`, importance: 6, valence: 0 });
  return `${persona.name} passed a trial and is now ${SKILL_TIERS[level]} at ${skill.replace("_", "-")}.`;
}

// ---- Attributes ----

/** +1 to an attribute at a milestone, if they have one left and aren't at 20. Returns a line, or null. */
export function attributeMilestone(persona: NpcPersona, state: NpcState, attribute: Attribute, day: number): string | null {
  const used = Object.values(state.growth.attributes).reduce((s, n) => s + (n ?? 0), 0);
  if (used >= milestoneCap(state.life.tier)) return null;
  const now = persona.stats.attributes[attribute] + (state.growth.attributes[attribute] ?? 0);
  if (now >= ATTRIBUTE_MAX) return null;
  state.growth.attributes[attribute] = (state.growth.attributes[attribute] ?? 0) + 1;
  state.growth.news.push({ day, text: `you've grown ${attribute === "strength" ? "stronger" : `in ${attribute}`}` });
  return `${persona.name}'s ${attribute} rose to ${now + 1}.`;
}

// ---- Traits ----

/** How much a trait has moved in the 7 days up to `day` (absolute). */
function weekDrift(state: NpcState, trait: Trait, day: number): number {
  return state.growth.traitLog.filter((s) => s.trait === trait && day - s.day < 7).reduce((sum, s) => sum + Math.abs(s.delta), 0);
}

/**
 * Move a trait, within every cap. Returns what actually moved (0 if a cap stopped it).
 * Code decides the size; a director proposal (director/drift.ts) goes through here too.
 */
export function driftTrait(persona: NpcPersona, state: NpcState, trait: Trait, delta: number, reason: string, day: number, event?: string): number {
  const authored = persona.traits?.[trait] ?? 0.5;
  const current = authored + (state.growth.traits[trait] ?? 0);
  let step = clamp(delta, -TRAIT_STEP_CAP, TRAIT_STEP_CAP);
  const weekLeft = TRAIT_WEEK_CAP - weekDrift(state, trait, day);
  step = clamp(step, -Math.max(0, weekLeft), Math.max(0, weekLeft));
  const lifetime = (state.growth.traits[trait] ?? 0) + step;
  step = clamp(lifetime, -TRAIT_LIFETIME_CAP, TRAIT_LIFETIME_CAP) - (state.growth.traits[trait] ?? 0);
  step = clamp(current + step, 0, 1) - current;
  step = Math.round(step * 1000) / 1000;
  if (step === 0) return 0;
  state.growth.traits[trait] = Math.round(((state.growth.traits[trait] ?? 0) + step) * 1000) / 1000;
  state.growth.traitLog.push({ day, trait, delta: step, reason, ...(event ? { event } : {}) });
  if (state.growth.traitLog.length > 50) state.growth.traitLog.shift();
  const words: Record<Trait, [string, string]> = {
    temper: ["calmer", "shorter-tempered"],
    bravery: ["more timid", "braver"],
    honesty: ["less honest", "more honest"],
    generosity: ["tighter-fisted", "more generous"],
    sociability: ["more withdrawn", "more sociable"],
    forgiveness: ["harder", "more forgiving"],
  };
  state.growth.news.push({ day, text: `you've grown a little ${words[trait][step > 0 ? 1 : 0]} (${reason})` });
  return step;
}

// ---- Challenges ----

/**
 * Something happened that a growth challenge may count: a piece made, a debt
 * cleared, a fight survived. Returns log lines for any challenge met.
 */
export function growthEvent(persona: NpcPersona, state: NpcState, event: { kind: GrowthTrigger["kind"]; tier?: string; event?: string }, day: number, tierOrder: readonly string[] = ["G", "F", "E", "D", "C", "B", "A", "S", "SS", "SSS"]): string[] {
  const log: string[] = [];
  for (const c of persona.growth ?? []) {
    if (c.trigger.kind !== event.kind) continue;
    const progress = (state.growth.challenges[c.id] ??= { count: 0 });
    if (progress.done !== undefined && !c.repeat) continue;
    if (c.trigger.kind === "craft" && tierOrder.indexOf(event.tier ?? "G") < tierOrder.indexOf(c.trigger.minTier)) continue;
    progress.count += 1;
    const need = "count" in c.trigger ? c.trigger.count : 1;
    if (progress.count < need) continue;
    progress.done = day;
    progress.count = 0;
    log.push(`${persona.name} met a challenge: ${c.describe}.`);
    const i = c.improves;
    let grewSkill = false;
    if (i.skill) {
      const level = skillLevel(grownSkills(persona.skills, state.growth), i.skill);
      if (level < 5) {
        const ready = addSkillXp(persona, state, i.skill, skillXpNeeded(level));
        grewSkill = true;
        if (ready) log.push(ready);
      }
    }
    if (i.attribute && (!i.skill || !grewSkill)) {
      const line = attributeMilestone(persona, state, i.attribute, day);
      if (line) log.push(line);
    }
    if (i.trait) {
      const moved = driftTrait(persona, state, i.trait.trait, i.trait.delta, c.describe, day, event.event);
      if (moved !== 0) log.push(`${persona.name} grew a little ${moved > 0 ? "more" : "less"} ${i.trait.trait === "bravery" ? "brave" : i.trait.trait}.`);
    }
  }
  return log;
}

/** For the situation block: recent growth, in words, then forgotten after a few days. */
export function describeGrowth(state: NpcState, day: number): string | null {
  const recent = state.growth.news.filter((n) => day - n.day <= 3);
  state.growth.news = recent;
  if (recent.length === 0) return null;
  return `Lately ${recent.map((n) => n.text).join("; ")}.`;
}

// ---- The player ----

/** Skill practice from use for the player: toward the next tier, capped until a trial. */
export function playerPractice(player: PlayerState, skill: Skill, hours: number): void {
  const level = skillLevel(player.skills, skill);
  if (level >= 5) return;
  const need = hoursToNextLevel(level);
  player.skillProgress[skill] = Math.min(need, Math.round(((player.skillProgress[skill] ?? 0) + hours) * 100) / 100);
}

/** A hard use of a skill: if the player's practice is full, it's their trial and the skill rises. Returns a line, or null. */
export function playerTrial(player: PlayerState, skill: Skill, passed: boolean): string | null {
  const level = skillLevel(player.skills, skill);
  if (!passed || level >= 5 || (player.skillProgress[skill] ?? 0) < hoursToNextLevel(level)) return null;
  player.skills[skill] = level + 1;
  player.skillProgress[skill] = 0;
  return `Your ${skill.replace("_", "-")} rose to ${SKILL_TIERS[level + 1]} through hard use.`;
}

/** Use a skill: practice, and if the use was hard, a trial. Returns a line if it rose. */
export function playerUsesSkill(player: PlayerState, skill: Skill, hard: boolean, hours = 0.5): string | null {
  playerPractice(player, skill, hours);
  return playerTrial(player, skill, hard);
}

/** Level-ups give attribute points: spend one with /raise. Endurance also adds max HP. */
export function raiseAttribute(player: PlayerState, attribute: string): { ok: boolean; message: string } {
  const a = ATTRIBUTES.find((x) => x === attribute.toLowerCase() || x.startsWith(attribute.toLowerCase().slice(0, 3)));
  if (!a) return { ok: false, message: `Raise what? ${ATTRIBUTES.join(", ")}.` };
  if ((player.attributePoints ?? 0) <= 0) return { ok: false, message: "You have no points to spend. You get one each level." };
  if (player.attributes[a] >= ATTRIBUTE_MAX) return { ok: false, message: `Your ${a} is already ${ATTRIBUTE_MAX}.` };
  player.attributePoints = (player.attributePoints ?? 0) - 1;
  player.attributes[a] += 1;
  if (a === "endurance") {
    player.maxHp += 3;
    player.hp += 3;
  }
  return { ok: true, message: `Your ${a} is now ${player.attributes[a]}${a === "endurance" ? ` (max HP ${player.maxHp})` : ""}. Points left: ${player.attributePoints}.` };
}
