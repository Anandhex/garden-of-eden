import { readdirSync, readFileSync } from "node:fs";
import { z } from "zod";
import type { NpcVoice } from "@millbrook/shared";
import { structured } from "../director/structured.js";
import { type Rng } from "../game/dice.js";
import { gearLimit } from "../game/gear.js";
import { ITEM_TIERS, parseItem } from "../game/items.js";
import { QUEST_TIERS } from "../game/levels.js";
import { formatMoney } from "../game/money.js";
import { PLACE_NAMES, workplaceOf } from "../game/schedule.js";
import { SERVICE_KINDS } from "../game/services.js";
import type { LLMProvider } from "../llm/provider.js";
import { speciesOf, SPECIES_IDS } from "../world/species.js";
import { CERTAINTY } from "./knowledge.js";
import { contradictions } from "./lint.js";
import { ScheduleBlockSchema, VoiceSchema } from "./personaSchema.js";
import { describeSkills, SKILLS, type Skills } from "./skills.js";
import { ATTRIBUTES, type Attributes } from "./stats.js";
import { describeTraits, TRAITS, type Traits } from "./traits.js";
import type { NpcPersona } from "./types.js";

/**
 * NPCs from templates (N11.1). A template (src/data/templates/*.json) gives ranges
 * for everything with a number in it: age, rank, traits, attributes, skills, stock,
 * money and prices. Code rolls those with a seeded RNG, so the same seed and template
 * always give the same NPC numbers (design rule 1). The model writes only the words
 * (name, personality, speech style, backstory, appearance, goals) through Ollama's
 * `format`, checked by a schema; on a second failure the template's own text is used.
 * The result is an ordinary NPC file, checked by the full schema and npc/lint.ts.
 */

const range = z
  .tuple([z.number(), z.number()])
  .refine(([lo, hi]) => lo <= hi, "the low end is above the high end");
const tier = z.enum(ITEM_TIERS);
const itemName = z.string().refine((s) => parseItem(s) !== undefined, { message: "unknown item or tier" });
const GENDERS = ["female", "male"] as const;
export type Gender = (typeof GENDERS)[number];

export const TemplateSchema = z
  .object({
    id: z.string().regex(/^[a-z_]+$/),
    /** What the template is for, in a few words. */
    describe: z.string().min(1),
    /** Children (design rule 7): every NPC made from it is marked `minor`. */
    minor: z.boolean().optional(),
    roles: z.array(z.string().min(1)).min(1),
    species: z.array(z.enum(SPECIES_IDS as [string, ...string[]])).min(1).default(["human"]),
    age: range,
    tier: z.array(tier).min(1),
    /** Ranks above their starting one they may still reach: 0 is at their peak. */
    growth: range,
    greed: range,
    traits: z.partialRecord(z.enum(TRAITS), range),
    /** Attributes not listed roll 8-12. */
    attributes: z.partialRecord(z.enum(ATTRIBUTES), range),
    hp: range,
    mp: range,
    /** Skill tiers; a roll below 1 leaves the skill out. */
    skills: z.partialRecord(z.enum(SKILLS), range),
    teaches: z.enum(SKILLS).optional(),
    weapon: z.array(itemName).min(1),
    armor: z.array(itemName).optional(),
    guard: z.boolean().optional(),
    /** Stock: item → quantity range. A roll of 0 leaves it out. */
    stock: z.record(itemName, range),
    /** Copper. */
    money: range,
    buys: z.array(z.string()),
    /** Copper per item, at its base tier. */
    prices: z.record(z.string(), range),
    storage: z.object({ name: z.string().min(1), slots: z.number().int().positive() }).optional(),
    services: z.array(z.object({ kind: z.enum(SERVICE_KINDS), price: z.number().int().positive().optional() }).strict()).optional(),
    schedule: z.array(ScheduleBlockSchema).min(1),
    knows: z.record(z.string(), z.enum(CERTAINTY)),
    maxQuestTier: z.enum(QUEST_TIERS),
    genders: z.array(z.enum(GENDERS)).min(1).default([...GENDERS]),
    names: z.object({ female: z.array(z.string().min(1)).min(1), male: z.array(z.string().min(1)).min(1), family: z.array(z.string().min(1)).min(1) }).strict(),
    voice: z.object({ female: VoiceSchema, male: VoiceSchema }).strict(),
    /** Text used when the model can't write it. {first}, {name}, {role}, {age}, {place} are filled in. */
    fallback: z
      .object({
        personality: z.array(z.array(z.string().min(1)).min(2)).min(1),
        speechStyle: z.array(z.string().min(1)).min(1),
        backstory: z.array(z.string().min(1)).min(1),
        appearance: z.array(z.string().min(1)).min(1),
        goals: z.array(z.array(z.string().min(1)).min(1)).min(1),
        fallbackLine: z.string().min(1),
      })
      .strict(),
  })
  .strict();
export type NpcTemplate = z.infer<typeof TemplateSchema>;

/**
 * Where a person is from, for the template text and the model's prompt (N25a): the place's name, what it is
 * ("village", "town"), and its kingdom. Templates say `{place}` and `{placeKind}`; nothing here knows a name.
 */
export interface Where {
  place: string;
  kind: string;
  kingdom?: string;
}
export const SOMEWHERE: Where = { place: "the village", kind: "village" };

const TEMPLATE_DIR = new URL("../data/templates/", import.meta.url);

/** Every template file, checked. Throws on the first bad one, naming it. */
export function loadTemplates(dir: URL = TEMPLATE_DIR): Record<string, NpcTemplate> {
  const out: Record<string, NpcTemplate> = {};
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
    const r = TemplateSchema.safeParse(JSON.parse(readFileSync(new URL(f, dir), "utf8")));
    if (!r.success) throw new Error(`${f} is invalid:\n${r.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n")}`);
    out[r.data.id] = r.data;
  }
  return out;
}

// ---- Rolling the numbers (code) ----

/** The numbers and picks, before any words. */
export interface Rolled {
  gender: Gender;
  species: string;
  role: string;
  age: number;
  tier: (typeof ITEM_TIERS)[number];
  potential: (typeof ITEM_TIERS)[number];
  greed: number;
  traits: Traits;
  attributes: Attributes;
  maxHp: number;
  maxMp: number;
  skills: Skills;
  weapon: string;
  armor?: string;
  stock: Record<string, number>;
  money: number;
  prices: Record<string, number>;
  voice: NpcVoice;
  /** Template text picks, in case the model fails. */
  fallbackName: { first: string; family: string };
}

const pick = <T>(rng: Rng, xs: readonly T[]): T => xs[Math.floor(rng() * xs.length)]!;
const int = (rng: Rng, [lo, hi]: readonly [number, number]) => Math.floor(lo + rng() * (hi - lo + 1));
const unit = (rng: Rng, [lo, hi]: readonly [number, number]) => Math.round((lo + rng() * (hi - lo)) * 100) / 100;

/**
 * Roll every number a template leaves open. The order of rolls is fixed, so the same
 * seed always gives the same NPC.
 */
export function rollTemplate(t: NpcTemplate, rng: Rng): Rolled {
  const gender = pick(rng, t.genders);
  const species = pick(rng, t.species);
  const sp = speciesOf(species);
  const role = pick(rng, t.roles);
  const age = Math.min(int(rng, t.age), sp.maxAge - 1);
  const startTier = pick(rng, t.tier);
  const cap = ITEM_TIERS.indexOf(sp.maxTier);
  const tierIx = Math.min(ITEM_TIERS.indexOf(startTier), cap);
  const potential = ITEM_TIERS[Math.min(cap, tierIx + int(rng, t.growth))]!;
  const greed = unit(rng, t.greed);
  const traits = Object.fromEntries(TRAITS.map((tr) => [tr, unit(rng, t.traits[tr] ?? [0.3, 0.7])])) as Traits;
  const attributes = Object.fromEntries(ATTRIBUTES.map((a) => [a, Math.max(1, Math.min(20, int(rng, t.attributes[a] ?? [8, 12])))])) as Attributes;
  const maxHp = int(rng, t.hp);
  const maxMp = int(rng, t.mp);
  const skills: Skills = {};
  for (const s of SKILLS) {
    const r = t.skills[s];
    if (!r) continue;
    const level = Math.max(0, Math.min(5, int(rng, r)));
    if (level > 0) skills[s] = level;
  }
  if (t.teaches && !skills[t.teaches]) skills[t.teaches] = 1;
  // Nobody carries gear above their rank: only what the rolled rank allows (the first is the fallback).
  const rank = ITEM_TIERS[tierIx]!;
  const allowed = (items: string[]) => items.filter((i) => gearLimit(rank, i) === null);
  const weapon = pick(rng, allowed(t.weapon).length > 0 ? allowed(t.weapon) : t.weapon);
  const armorChoices = t.armor ? allowed(t.armor) : [];
  const armor = armorChoices.length > 0 ? pick(rng, armorChoices) : undefined;
  const stock: Record<string, number> = {};
  for (const [item, r] of Object.entries(t.stock)) {
    const qty = int(rng, r);
    if (qty > 0) stock[item] = qty;
  }
  const money = int(rng, t.money);
  const prices = Object.fromEntries(Object.entries(t.prices).map(([item, r]) => [item, int(rng, r)]));
  const base = t.voice[gender];
  const voice: NpcVoice = { ...base, pitch: Math.round((base.pitch + (rng() - 0.5) * 0.2) * 100) / 100, rate: Math.round((base.rate + (rng() - 0.5) * 0.1) * 100) / 100 };
  const fallbackName = { first: pick(rng, t.names[gender]), family: pick(rng, t.names.family) };
  return { gender, species, role, age, tier: rank, potential, greed, traits, attributes, maxHp, maxMp, skills, weapon, ...(armor ? { armor } : {}), stock, money, prices, voice, fallbackName };
}

// ---- The words (model, or template text) ----

/** What the model may write. Checked before use; anything else is ignored. */
export const IdentitySchema = z
  .object({
    name: z.string().regex(/^[A-Z][a-z'-]+( [A-Z][a-z'-]+){0,2}$/, "a plain name: one to three capitalised words"),
    personality: z.array(z.string().min(2).max(40)).min(3).max(5),
    speechStyle: z.string().min(20).max(300),
    backstory: z.string().min(40).max(500),
    appearance: z.string().min(20).max(300),
    goals: z.array(z.string().min(5).max(100)).min(2).max(3),
  })
  .strict();
export type Identity = z.infer<typeof IdentitySchema>;

/** Words that have no place in a child's file (design rule 7). */
export const ADULT_WORDS = /\b(romance|romantic|lover|flirt\w*|seduc\w*|kiss\w*|wife|husband|married|sweetheart|courting|drunk|ale|wine|brothel)\b/i;

/** Fill a template's tokens: {first} {name} {role} {age}, {place} and {placeKind} (where they are from), {work} (where they work). */
export function fill(text: string, r: Pick<Rolled, "role" | "age">, name: string, work: string, where: Where = SOMEWHERE): string {
  return text
    .replaceAll("{first}", name.split(" ")[0]!)
    .replaceAll("{name}", name)
    .replaceAll("{role}", r.role)
    .replaceAll("{age}", String(r.age))
    .replaceAll("{placeKind}", where.kind)
    .replaceAll("{place}", where.place)
    .replaceAll("{work}", work);
}

/** The template's own words, for when the model can't write them. */
export function fallbackIdentity(t: NpcTemplate, r: Rolled, rng: Rng, name = `${r.fallbackName.first} ${r.fallbackName.family}`, where: Where = SOMEWHERE): Identity {
  const work = PLACE_NAMES[workplaceOf({ schedule: t.schedule })];
  const set = pick(rng, t.fallback.personality);
  return {
    name,
    personality: agreeing(set, r, t.fallback.personality.flat()),
    speechStyle: fill(pick(rng, t.fallback.speechStyle), r, name, work, where),
    backstory: fill(pick(rng, t.fallback.backstory), r, name, work, where),
    appearance: fill(pick(rng, t.fallback.appearance), r, name, work, where),
    goals: pick(rng, t.fallback.goals).map((g) => fill(g, r, name, work, where)),
  };
}

/**
 * Personality words that agree with the rolled traits: any word that promises what the
 * numbers don't ("earnest" with low honesty) is dropped, and the list topped back up to
 * three from `spares` that agree.
 */
export function agreeing(words: string[], r: Pick<Rolled, "traits" | "greed">, spares: string[]): string[] {
  const ok = (w: string) => contradictions([w], r.traits, r.greed).length === 0;
  const out = words.filter(ok);
  for (const w of spares) if (out.length < 3 && ok(w) && !out.includes(w)) out.push(w);
  return out;
}

/** The numbers, as words for the model (design rule 2). */
export function describeRolled(t: NpcTemplate, r: Rolled, where: Where = SOMEWHERE): string {
  const sp = speciesOf(r.species).name;
  const work = PLACE_NAMES[workplaceOf({ schedule: t.schedule })];
  const stock = Object.keys(r.stock);
  return [
    `Role: ${fill(r.role, r, "", work, where)} in the ${where.kind} of ${where.place}${where.kingdom ? `, in the kingdom of ${where.kingdom}` : ""} (works at ${work}).`,
    `${t.minor ? "A child" : "A person"}: ${sp}, ${r.gender}, ${r.age} years old.`,
    `Temperament: ${describeTraits(r.traits) || "even-tempered"}${r.greed >= 0.6 ? ", fond of money" : r.greed <= 0.25 ? ", not much moved by money" : ""}.`,
    `Skills: ${describeSkills(r.skills)}.`,
    stock.length > 0 ? `Sells: ${stock.join(", ")}.` : null,
    `Purse: ${formatMoney(r.money)}.`,
  ]
    .filter((l): l is string => l !== null)
    .join("\n");
}

/**
 * Ask the model for the words. Retries once (structured()); null on failure. A name
 * that's already taken, or (for a child) any adult word, counts as a failure.
 */
export async function writeIdentity(llm: LLMProvider, t: NpcTemplate, r: Rolled, takenNames: string[] = [], where: Where = SOMEWHERE): Promise<Identity | null> {
  const system =
    `You write characters for a ${where.kind} called ${where.place}${where.kingdom ? ` in the kingdom of ${where.kingdom}` : ""}. Reply with JSON only. Keep it grounded and plain: ` +
    "no magic powers, no royalty, no famous ancestors. Never invent other named people or places." +
    (t.minor ? " This is a child: keep everything gentle and age-appropriate; no romance, drink or violence." : "");
  const prompt = `Write this villager's name (a first name and a family name), personality (3-5 short words), how they speak (one or two sentences, with a habit of speech), backstory (two sentences), appearance (one sentence) and 2-3 goals.\n\n${describeRolled(t, r, where)}`;
  for (let i = 0; i < 2; i++) {
    const out = await structured(llm, IdentitySchema, { kind: "identity", system, prompt, maxTokens: 400, temperature: 0.9 }, 1);
    if (!out) continue;
    const taken = takenNames.some((n) => n.toLowerCase() === out.name.toLowerCase() || n.split(" ")[0]!.toLowerCase() === out.name.split(" ")[0]!.toLowerCase());
    const text = [out.speechStyle, out.backstory, out.appearance, ...out.personality, ...out.goals].join(" ");
    if (taken || (t.minor && ADULT_WORDS.test(text))) continue;
    return out;
  }
  return null;
}

// ---- The NPC file ----

/** "Tam Hollis" → "tam", or "tam_hollis" if "tam" is taken. */
export function idFor(name: string, taken: string[]): string {
  const words = name.toLowerCase().replace(/[^a-z ]/g, "").split(" ").filter(Boolean);
  for (const candidate of [words[0]!, words.join("_")]) if (!taken.includes(candidate)) return candidate;
  for (let n = 2; ; n++) if (!taken.includes(`${words[0]}${n}`)) return `${words[0]}${n}`;
}

/** Put the rolls and the words together into an NPC file. */
export function assemblePersona(t: NpcTemplate, r: Rolled, words: Identity, id: string, where: Where = SOMEWHERE): NpcPersona {
  return {
    id,
    name: words.name,
    role: fill(r.role, r, words.name, PLACE_NAMES[workplaceOf({ schedule: t.schedule })], where),
    species: r.species,
    age: r.age,
    tier: r.tier,
    potential: r.potential,
    personality: words.personality,
    greed: r.greed,
    traits: r.traits,
    speechStyle: words.speechStyle,
    fallbackLine: t.fallback.fallbackLine,
    voice: r.voice,
    backstory: words.backstory,
    goals: words.goals,
    knows: { ...t.knows },
    secrets: [],
    stats: { maxHp: r.maxHp, maxMp: r.maxMp, attributes: r.attributes },
    skills: r.skills,
    ...(t.teaches ? { teaches: t.teaches } : {}),
    maxQuestTier: t.maxQuestTier,
    quests: [],
    weapon: r.weapon,
    ...(r.armor ? { armor: r.armor } : {}),
    ...(t.guard ? { guard: true } : {}),
    ...(t.storage ? { storage: { ...t.storage } } : {}),
    startingInventory: r.stock,
    startingMoney: r.money,
    buys: [...t.buys],
    prices: r.prices,
    appearance: words.appearance,
    // A child never works through supper for want of money (game/schedule.ts brokeBelow).
    ...(t.minor ? { minor: true, reserveMoney: 0 } : {}),
    schedule: t.schedule.map((b) => ({ ...b })),
    ...(t.services ? { services: t.services.map((s) => ({ ...s })) } : {}),
    template: t.id,
  };
}

export interface Generated {
  persona: NpcPersona;
  /** Who wrote the words: the model, or the template's fallback text. */
  words: "model" | "template";
}

/**
 * A whole NPC from a template: code rolls the numbers from `rng`, the model writes the
 * words (or the template does, if it fails or there is no model).
 */
export async function generateNpc(
  t: NpcTemplate,
  rng: Rng,
  { llm, takenIds = [], takenNames = [], where = SOMEWHERE }: { llm?: LLMProvider; takenIds?: string[]; takenNames?: string[]; where?: Where } = {},
): Promise<Generated> {
  const rolled = rollTemplate(t, rng);
  // Roll the fallback text now as well, so the numbers never depend on whether the model answered.
  const fallbackRng = rng;
  let name = `${rolled.fallbackName.first} ${rolled.fallbackName.family}`;
  if (takenNames.some((n) => n.toLowerCase() === name.toLowerCase())) name = `${rolled.fallbackName.first} ${pick(fallbackRng, t.names.family)}`;
  const fallback = fallbackIdentity(t, rolled, fallbackRng, name, where);
  const written = llm ? await writeIdentity(llm, t, rolled, takenNames, where).catch(() => null) : null;
  const words = written ? { ...written, personality: agreeing(written.personality, rolled, fallback.personality) } : fallback;
  return { persona: assemblePersona(t, rolled, words, idFor(words.name, takenIds), where), words: written ? "model" : "template" };
}

/** What the model may rewrite for a child born in play when they start talking: not the name. */
export const ChildWordsSchema = IdentitySchema.omit({ name: true });

/**
 * A child born in play reaches talking age: the model writes their personality, voice,
 * looks and goals from the numbers they inherited (code's). Null if it fails twice or
 * slips in anything adult (design rule 7); the template's words stay.
 */
export async function writeChildWords(llm: LLMProvider, t: NpcTemplate, p: NpcPersona, parents: string, where: Where = SOMEWHERE): Promise<z.infer<typeof ChildWordsSchema> | null> {
  const r = { ...rollTemplate(t, () => 0.5), traits: resolveTraitsFrom(p), greed: p.greed, skills: p.skills, age: p.age };
  const system = `You write characters for a ${where.kind} called ${where.place}. Reply with JSON only. This is a child: keep everything gentle and age-appropriate; no romance, drink or violence. Never invent other named people or places.`;
  const prompt = `Write how this child is: personality (3-5 short words), how they speak (one or two sentences, with a habit of speech), backstory (two sentences), appearance (one sentence) and 2-3 goals.\n\nName: ${p.name}. Parents: ${parents}.\n${describeRolled(t, { ...r, gender: p.voice?.gender === "male" ? "male" : "female" }, where)}${p.talents?.length ? `\nA gift for: ${p.talents.join(", ").replaceAll("_", "-")} (from their parents).` : ""}`;
  for (let i = 0; i < 2; i++) {
    const out = await structured(llm, ChildWordsSchema, { kind: "child-words", system, prompt, maxTokens: 350, temperature: 0.9 }, 1);
    if (!out) continue;
    if (ADULT_WORDS.test([out.speechStyle, out.backstory, out.appearance, ...out.personality, ...out.goals].join(" "))) continue;
    return { ...out, personality: agreeing(out.personality, { traits: resolveTraitsFrom(p), greed: p.greed }, t.fallback.personality.flat()) };
  }
  return null;
}

const resolveTraitsFrom = (p: Pick<NpcPersona, "traits">): Traits => Object.fromEntries(TRAITS.map((t) => [t, p.traits?.[t] ?? 0.5])) as Traits;
