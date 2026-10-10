import { z } from "zod";
import { QUEST_TIERS } from "../game/levels.js";
import { parseItem } from "../game/items.js";
import { MoneySchema } from "../game/money.js";
import { carrySlots, gearLimit, slotsUsed } from "../game/gear.js";
import { SPECIES_IDS, speciesOf } from "../world/species.js";
import { SKILLS, SkillsSchema } from "./skills.js";
import { NpcStatsSchema } from "./stats.js";
import { TraitsSchema } from "./traits.js";
import type { NpcPersona } from "./types.js";

const unit = z.number().min(0).max(1);
const itemName = z.string().refine((s) => parseItem(s) !== undefined, { message: "unknown item or tier" });

const QuestSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  tier: z.enum(QUEST_TIERS),
  minTrust: z.number().min(-100).max(100),
  objective: z.object({ type: z.literal("deliver"), item: itemName, qty: z.number().int().positive() }),
  reward: z.object({ money: MoneySchema, xp: z.number().int().min(0).optional(), trust: z.number().optional() }),
});

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
    backstory: z.string().min(1),
    goals: z.array(z.string()),
    knowledge: z.array(z.string()),
    secrets: z.array(
      z.object({ id: z.string().min(1), debt: z.string().optional(), about: z.string().min(1), text: z.string().min(1) }),
    ),
    stats: NpcStatsSchema,
    skills: SkillsSchema,
    teaches: z.enum(SKILLS).optional(),
    maxQuestTier: z.enum(QUEST_TIERS),
    quests: z.array(QuestSchema).optional(),
    weapon: itemName.refine((s) => parseItem(s)?.def.weapon !== undefined, { message: "not a weapon" }),
    storage: z.object({ name: z.string().min(1), slots: z.number().int().positive() }).optional(),
    armor: itemName.refine((s) => parseItem(s)?.def.armor !== undefined, { message: "not armour" }).optional(),
    startingInventory: z.record(itemName, z.number().int().positive()),
    startingMoney: MoneySchema,
    buys: z.array(z.string()),
    debts: z.array(z.object({ id: z.string().min(1), creditor: z.string().min(1), amount: MoneySchema.refine((n) => n > 0, "must be more than nothing") })).optional(),
    reserveMoney: MoneySchema.optional(),
    prices: z.record(z.string(), MoneySchema.refine((n) => n > 0, "must be more than nothing")),
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
    if (QUEST_TIERS.indexOf(p.potential) < QUEST_TIERS.indexOf(p.tier)) {
      ctx.addIssue({ code: "custom", path: ["potential"], message: "below their starting rank" });
    }
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
