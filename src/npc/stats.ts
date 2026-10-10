import { z } from "zod";

/**
 * RPG stats every NPC has. Attributes use a 1-20 scale (10 = an ordinary person).
 * HP and MP maximums are authored per NPC; current HP/MP live in NpcState.
 *
 * Small models handle words better than numbers, so the prompt shows both
 * ("very strong (STR 16)") and describeCondition turns HP into "badly wounded".
 */
export const ATTRIBUTES = [
  "strength",
  "agility",
  "endurance",
  "intelligence",
  "willpower",
  "charisma",
  "perception",
  "luck",
] as const;
export type Attribute = (typeof ATTRIBUTES)[number];

const attribute = z.number().int().min(1).max(20);

export const NpcStatsSchema = z.object({
  maxHp: z.number().int().positive(),
  maxMp: z.number().int().min(0),
  attributes: z.object({
    strength: attribute,
    agility: attribute,
    endurance: attribute,
    intelligence: attribute,
    willpower: attribute,
    charisma: attribute,
    perception: attribute,
    luck: attribute,
  }),
});
export type NpcStats = z.infer<typeof NpcStatsSchema>;
export type Attributes = NpcStats["attributes"];

const SHORT: Record<Attribute, string> = {
  strength: "STR",
  agility: "AGI",
  endurance: "END",
  intelligence: "INT",
  willpower: "WIL",
  charisma: "CHA",
  perception: "PER",
  luck: "LCK",
};

/** Words for each attribute at low / high values, e.g. strength → "weak" / "strong". */
const WORDS: Record<Attribute, [low: string, high: string]> = {
  strength: ["weak", "strong"],
  agility: ["clumsy", "nimble"],
  endurance: ["frail", "tough"],
  intelligence: ["slow-witted", "clever"],
  willpower: ["easily swayed", "strong-willed"],
  charisma: ["off-putting", "charming"],
  perception: ["oblivious", "sharp-eyed"],
  luck: ["unlucky", "lucky"],
};

/** "very strong (STR 16)", "average agility (AGI 10)", "clumsy (AGI 6)". */
export function describeAttribute(name: Attribute, value: number): string {
  const [low, high] = WORDS[name];
  const label =
    value <= 4 ? `very ${low}` : value <= 8 ? low : value <= 12 ? `average ${name}` : value <= 16 ? high : `exceptionally ${high}`;
  return `${label} (${SHORT[name]} ${value})`;
}

/** All attributes in one line for the system prompt. */
export function describeAttributes(stats: NpcStats): string {
  return ATTRIBUTES.map((a) => describeAttribute(a, stats.attributes[a])).join(", ");
}

/** HP in words, e.g. "unhurt", "badly wounded". */
export function describeCondition(hp: number, maxHp: number): string {
  if (hp <= 0) return "unconscious";
  const ratio = hp / maxHp;
  if (ratio >= 1) return "unhurt";
  if (ratio >= 0.75) return "lightly hurt";
  if (ratio >= 0.4) return "wounded";
  if (ratio >= 0.15) return "badly wounded";
  return "near death";
}
