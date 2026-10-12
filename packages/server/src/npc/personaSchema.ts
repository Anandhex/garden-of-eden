import { z } from "zod";
import { QUEST_TIERS } from "../game/levels.js";
import { parseItem } from "../game/items.js";
import { MoneySchema } from "../game/money.js";
import { carrySlots, gearLimit, slotsUsed } from "../game/gear.js";
import { SPECIES_IDS, speciesOf } from "../world/species.js";
import { SKILLS, SkillsSchema } from "./skills.js";
import { NpcStatsSchema } from "./stats.js";
import { TraitsSchema } from "./traits.js";
import { badScopes, CERTAINTY } from "./knowledge.js";
import { MOODS, type NpcPersona } from "./types.js";
import { ACTIVITIES, PLACES } from "../game/schedule.js";
import { SIGNATURE_EFFECTS, SIGNATURE_TRIGGERS } from "../game/signature.js";
import { SERVICE_KINDS } from "../game/services.js";
import { ITEM_TIERS } from "../game/items.js";
import { TRUTHS } from "../game/rumours.js";
import { DilemmaSchema } from "../game/dilemmas.js";
import { GrowthChallengeSchema } from "./growth.js";
import { ArcSchema } from "./arcs.js";
import { INJURY_IDS } from "../game/health.js";

const unit = z.number().min(0).max(1);
const itemName = z.string().refine((s) => parseItem(s) !== undefined, { message: "unknown item or tier" });

const QuestSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  tier: z.enum(QUEST_TIERS),
  minTrust: z.number().min(-100).max(100),
  minRespect: z.number().min(0).max(100).optional(),
  objective: z.discriminatedUnion("type", [
    z.object({ type: z.literal("deliver"), item: itemName, qty: z.number().int().positive() }),
    // Creature template ids and NPC ids aren't checked here (no file access in the schema); tests/quests.test.ts checks them.
    z.object({ type: z.literal("defeat"), creature: z.string().min(1), qty: z.number().int().positive() }),
    z.object({ type: z.literal("defeat_npc"), npc: z.string().min(1), qty: z.literal(1).default(1) }),
    z.object({ type: z.literal("gather"), item: itemName, qty: z.number().int().positive(), place: z.enum(PLACES) }),
    z.object({ type: z.literal("craft"), item: itemName, qty: z.number().int().positive(), minTier: z.enum(ITEM_TIERS) }),
    z.object({ type: z.literal("talk_to"), npc: z.string().min(1), message: z.string().min(1), qty: z.literal(1).default(1) }),
    z.object({ type: z.literal("escort"), who: z.string().min(1), to: z.enum(PLACES), qty: z.literal(1).default(1) }),
    z.object({ type: z.literal("clear"), dungeon: z.string().min(1), name: z.string().min(1), qty: z.literal(1).default(1) }),
  ]),
  reward: z.object({ money: MoneySchema, xp: z.number().int().min(0).optional(), trust: z.number().optional() }),
  requires: z.array(z.string().min(1)).optional(),
  deadlineHours: z.number().int().positive().optional(),
  cures: z.enum(INJURY_IDS as [string, ...string[]]).optional(),
  minStanding: z.number().min(-100).max(100).optional(),
});

const axis = z.number().min(-100).max(100);
const RelationSchema = z.object({ trust: axis, fear: z.number().min(0).max(100), respect: axis, affection: axis }).partial().strict();
const ReputationFactSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9_]+$/),
    text: z.string().min(1),
    truth: z.enum(TRUTHS),
    keywords: z.array(z.string().min(1).transform((w) => w.toLowerCase())).min(1),
    knownBy: z.array(z.string().min(1)).optional(),
    correction: z.string().min(1).optional(),
  })
  .strict();

const hour = z.number().int().min(0).max(23);
const words = z.array(z.string().min(1).transform((w) => w.toLowerCase())).min(1);

const BreakSchema = z.union([
  z.object({ item: itemName }).strict(),
  z.object({ fact: z.string().regex(/^[a-z0-9_]+\.[a-z0-9_]+$/, "npc.secret") }).strict(),
  z.object({ check: z.enum(["persuade", "intimidate"]) }).strict(),
]);

const SecretSchema = z
  .object({
    id: z.string().min(1),
    debt: z.string().optional(),
    about: z.string().min(1),
    text: z.string().min(1),
    cover: z.string().min(1).optional(),
    breaksWith: z.array(BreakSchema).optional(),
    keywords: z.array(z.string().min(1)).optional(),
  })
  .strict();

const QuirkSchema = z
  .object({
    when: z
      .object({
        activity: z.array(z.enum(ACTIVITIES)).optional(),
        place: z.array(z.enum(PLACES)).optional(),
        topic: words.optional(),
        nearby: z.array(z.string().min(1)).optional(),
        mood: z.array(z.enum(MOODS)).optional(),
        hours: z.tuple([hour, hour]).optional(),
        hurt: z.boolean().optional(),
      })
      .strict()
      .refine((w) => Object.keys(w).length > 0, "a quirk needs at least one condition"),
    line: z.string().min(1),
  })
  .strict();

const TriggerSchema = z
  .object({
    name: z.string().min(1),
    words,
    item: z.string().refine((s) => parseItem(s) !== undefined, { message: "unknown item" }).optional(),
    minTier: z.enum(ITEM_TIERS).optional(),
    npc: z.string().optional(),
  })
  .strict();

export const ScheduleBlockSchema = z.object({ from: hour, to: hour, activity: z.enum(ACTIVITIES), place: z.enum(PLACES) }).strict();

/** An NPC's voice (T14): browser speech settings, and optionally a Piper voice model. */
export const VoiceSchema = z
  .object({
    lang: z.string().regex(/^[a-z]{2,3}(-[A-Z]{2})?$/, "a language tag like en-GB").default("en-GB"),
    pitch: z.number().min(0).max(2).default(1),
    rate: z.number().min(0.5).max(2).default(1),
    browser: z.array(z.string().min(1)).default([]),
    gender: z.enum(["female", "male", "neutral"]).optional(),
    piper: z
      .object({
        model: z.string().regex(/^[A-Za-z0-9_.-]+$/, "a Piper model name like en_GB-alan-medium"),
        speaker: z.number().int().min(0).optional(),
        lengthScale: z.number().min(0.5).max(2).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

/** Shape of an NPC file (src/data/npcs/*.json). Checked at startup so a typo fails loudly, not mid-conversation. */
export const PersonaSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    role: z.string().min(1),
    species: z.enum(SPECIES_IDS as [string, ...string[]]).optional(),
    age: z.number().int().min(0),
    tier: z.enum(QUEST_TIERS),
    potential: z.enum(QUEST_TIERS),
    personality: z.array(z.string()).min(1),
    greed: unit,
    greedWhenDebtFree: unit.optional(),
    traits: TraitsSchema.optional(),
    speechStyle: z.string().min(1),
    fallbackLine: z.string().min(1).optional(),
    /** Short lines said while the model is slow to answer ("Hmm."), picked at random (G2). */
    fillerLines: z.array(z.string().min(1).max(60)).min(1).optional(),
    /** How the NPC sounds when spoken aloud (T14). */
    voice: VoiceSchema.optional(),
    backstory: z.string().min(1),
    goals: z.array(z.string()),
    /** Which world lore they know (npc/knowledge.ts), and how sure they are: { "millbrook.*": "certain" }. */
    knows: z.record(z.string(), z.enum(CERTAINTY)),
    secrets: z.array(SecretSchema),
    stats: NpcStatsSchema,
    skills: SkillsSchema,
    teaches: z.enum(SKILLS).optional(),
    maxQuestTier: z.enum(QUEST_TIERS),
    quests: z.array(QuestSchema).optional(),
    weapon: itemName.refine((s) => parseItem(s)?.def.weapon !== undefined, { message: "not a weapon" }),
    guard: z.boolean().optional(),
    dropsOnDeath: z.boolean().optional(),
    storage: z.object({ name: z.string().min(1), slots: z.number().int().positive() }).optional(),
    armor: itemName.refine((s) => parseItem(s)?.def.armor !== undefined, { message: "not armour" }).optional(),
    startingInventory: z.record(itemName, z.number().int().positive()),
    startingMoney: MoneySchema,
    buys: z.array(z.string()),
    debts: z.array(z.object({ id: z.string().min(1), creditor: z.string().min(1), amount: MoneySchema.refine((n) => n > 0, "must be more than nothing") })).optional(),
    reserveMoney: MoneySchema.optional(),
    prices: z.record(z.string(), MoneySchema.refine((n) => n > 0, "must be more than nothing")),
    appearance: z.string().min(1).optional(),
    quirks: z.array(QuirkSchema).optional(),
    fears: z.array(TriggerSchema).optional(),
    loves: z.array(TriggerSchema).optional(),
    minor: z.boolean().optional(),
    romance: z
      .object({ open: z.boolean(), minAffection: z.number().min(0).max(100).optional(), minTrust: z.number().min(-100).max(100).optional() })
      .strict()
      .optional(),
    schedule: z.array(ScheduleBlockSchema).min(1).optional(),
    signature: z
      .object({
        trigger: z.enum(SIGNATURE_TRIGGERS),
        effect: z.enum(SIGNATURE_EFFECTS),
        items: z.array(itemName).optional(),
        minTrust: z.number().min(-100).max(100).optional(),
        describe: z.string().min(1),
      })
      .strict()
      .optional(),
    services: z.array(z.object({ kind: z.enum(SERVICE_KINDS), price: MoneySchema.optional() }).strict()).optional(),
    relationships: z.record(z.string(), RelationSchema).optional(),
    reputationFacts: z.array(ReputationFactSchema).optional(),
    dilemmas: z.array(DilemmaSchema).optional(),
    faction: z.string().optional(),
    successor: z.string().optional(),
    successorOf: z.string().optional(),
    hire: z.object({ wage: MoneySchema, minTrust: axis.optional(), minRespect: axis.optional() }).strict().optional(),
    growth: z.array(GrowthChallengeSchema).optional(),
    arcs: z.array(ArcSchema).optional(),
    injuries: z.array(z.enum(INJURY_IDS as [string, ...string[]])).optional(),
    spouse: z.string().min(1).optional(),
    parents: z.array(z.string().min(1)).max(2).optional(),
    talents: z.array(z.enum(SKILLS)).optional(),
    inherited: z.partialRecord(z.enum(SKILLS), z.number().int().min(0).max(5)).optional(),
    template: z.string().min(1).optional(),
    bornOnDay: z.number().int().optional(),
  })
  .strict()
  .superRefine((p, ctx) => {
    const species = speciesOf(p.species);
    if (!species.talks) ctx.addIssue({ code: "custom", path: ["species"], message: `${p.species} can't talk; make it a creature instead` });
    if (p.age >= species.maxAge) ctx.addIssue({ code: "custom", path: ["age"], message: `older than ${species.name} can live (${species.maxAge})` });
    if (QUEST_TIERS.indexOf(p.tier) > QUEST_TIERS.indexOf(species.maxTier)) {
      ctx.addIssue({ code: "custom", path: ["tier"], message: `above the ${species.maxTier} cap for ${species.name}` });
    }
    // Gear level: nobody wields gear above their rank.
    for (const field of ["weapon", "armor"] as const) {
      const limit = p[field] ? gearLimit(p.tier, p[field]!) : null;
      if (limit) ctx.addIssue({ code: "custom", path: [field], message: limit });
    }
    // Burden: the starting inventory has to fit their pack and storage.
    const room = carrySlots(p.stats.attributes.strength) + (p.storage?.slots ?? 0);
    if (slotsUsed(p.startingInventory) > room) {
      ctx.addIssue({ code: "custom", path: ["startingInventory"], message: `fills ${slotsUsed(p.startingInventory)} slots; they have room for ${room}` });
    }
    for (const pattern of badScopes(p.knows)) {
      ctx.addIssue({ code: "custom", path: ["knows", pattern], message: "matches nothing in src/data/world.json" });
    }
    if (QUEST_TIERS.indexOf(p.potential) < QUEST_TIERS.indexOf(p.tier)) {
      ctx.addIssue({ code: "custom", path: ["potential"], message: "below their starting rank" });
    }
    // Content rule (design rule 7): never romance with a minor.
    if (p.minor && p.romance?.open) ctx.addIssue({ code: "custom", path: ["romance", "open"], message: "a minor can never be open to romance" });
    if (p.minor && p.spouse) ctx.addIssue({ code: "custom", path: ["spouse"], message: "a minor can never be married" });
    if (p.minor && p.age >= species.adultAge) ctx.addIssue({ code: "custom", path: ["minor"], message: `${species.name} is grown at ${species.adultAge}` });
    if (p.spouse && p.spouse === p.id) ctx.addIssue({ code: "custom", path: ["spouse"], message: "can't marry themselves" });
    // Every hour of the day is covered exactly once.
    if (p.schedule) {
      const covered = Array<number>(24).fill(0);
      // A block runs from `from` up to `to`, wrapping past midnight; from === to is all day.
      for (const b of p.schedule) {
        let h = b.from;
        do {
          covered[h] = covered[h]! + 1;
          h = (h + 1) % 24;
        } while (h !== b.to);
      }
      const bad = covered.map((n, h) => (n === 1 ? -1 : h)).filter((h) => h >= 0);
      if (bad.length > 0) ctx.addIssue({ code: "custom", path: ["schedule"], message: `hours covered zero or several times: ${bad.join(", ")}` });
    }
    // Hidden stock must be things they sell, and a hidden_stock signature needs items.
    if (p.signature?.effect === "hidden_stock" && !(p.signature.items ?? []).length) {
      ctx.addIssue({ code: "custom", path: ["signature", "items"], message: "hidden_stock needs items" });
    }
    if (p.services?.some((s) => (s.kind === "heal" || s.kind === "lodging") && s.price === undefined)) {
      ctx.addIssue({ code: "custom", path: ["services"], message: "heal and lodging need a price" });
    }
    // Arcs may only unlock this NPC's own quests and secrets.
    for (const arc of p.arcs ?? []) {
      for (const st of arc.stages) {
        for (const q of st.unlocks?.quests ?? []) if (!(p.quests ?? []).some((x) => x.id === q)) ctx.addIssue({ code: "custom", path: ["arcs", arc.id], message: `unlocks unknown quest "${q}"` });
        for (const sec of st.unlocks?.secrets ?? []) if (!p.secrets.some((x) => x.id === sec)) ctx.addIssue({ code: "custom", path: ["arcs", arc.id], message: `unlocks unknown secret "${sec}"` });
      }
    }
    // A chain's links must be this NPC's quests.
    for (const q of p.quests ?? []) for (const r of q.requires ?? []) if (!(p.quests ?? []).some((x) => x.id === r)) ctx.addIssue({ code: "custom", path: ["quests", q.id, "requires"], message: `no quest "${r}" in this file` });
    for (const d of p.dilemmas ?? []) if (d.afterSecret && !p.secrets.some((x) => x.id === d.afterSecret)) ctx.addIssue({ code: "custom", path: ["dilemmas", d.id], message: `no secret "${d.afterSecret}"` });
    if (p.successor && p.successorOf) ctx.addIssue({ code: "custom", path: ["successor"], message: "a successor-in-waiting can't name a successor yet" });
    if (QUEST_TIERS.indexOf(p.potential) > QUEST_TIERS.indexOf(species.maxTier)) {
      ctx.addIssue({ code: "custom", path: ["potential"], message: `above the ${species.maxTier} cap for ${species.name}` });
    }
  });

/** Parse and validate an NPC file's JSON. Throws one readable error listing every problem. */
export function parsePersona(raw: unknown, source = "NPC file"): NpcPersona {
  const result = PersonaSchema.safeParse(raw);
  if (!result.success) {
    const problems = result.error.issues.map((i) => `  ${i.path.join(".") || "(root)"}: ${i.message}`).join("\n");
    throw new Error(`${source} is invalid:\n${problems}`);
  }
  return result.data as NpcPersona;
}
