import { z } from "zod";
import { QUEST_TIERS } from "../game/levels.js";
import { parseItem } from "../game/items.js";
import { SKILLS, SkillsSchema } from "./skills.js";
import { NpcStatsSchema } from "./stats.js";
import { TraitsSchema } from "./traits.js";
import type { NpcPersona } from "./types.js";

const unit = z.number().min(0).max(1);
const itemName = z.string().refine((s) => parseItem(s) !== undefined, { message: "unknown item or tier" });
const gold = z.number().int().min(0);

const QuestSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  tier: z.enum(QUEST_TIERS),
  minTrust: z.number().min(-100).max(100),
  objective: z.object({ type: z.literal("deliver"), item: itemName, qty: z.number().int().positive() }),
  reward: z.object({ gold: gold, xp: z.number().int().min(0).optional(), trust: z.number().optional() }),
});

/** Shape of an NPC file (src/data/npcs/*.json). Checked at startup so a typo fails loudly, not mid-conversation. */
export const PersonaSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    role: z.string().min(1),
    personality: z.array(z.string()).min(1),
    greed: unit,
    greedWhenDebtFree: unit.optional(),
    traits: TraitsSchema.optional(),
    speechStyle: z.string().min(1),
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
    weapon: itemName,
    startingInventory: z.record(itemName, z.number().int().positive()),
    startingGold: gold,
    buys: z.array(z.string()),
    debts: z.array(z.object({ id: z.string().min(1), creditor: z.string().min(1), amount: z.number().int().positive() })).optional(),
    reserveGold: gold.optional(),
    prices: z.record(z.string(), z.number().int().positive()),
  })
  .strict();

/** Parse and validate an NPC file's JSON. Throws one readable error listing every problem. */
export function parsePersona(raw: unknown, source = "NPC file"): NpcPersona {
  const result = PersonaSchema.safeParse(raw);
  if (!result.success) {
    const problems = result.error.issues.map((i) => `  ${i.path.join(".") || "(root)"}: ${i.message}`).join("\n");
    throw new Error(`${source} is invalid:\n${problems}`);
  }
  return result.data as NpcPersona;
}
