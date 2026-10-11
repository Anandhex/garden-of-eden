import { z } from "zod";

/**
 * Skill proficiencies. Each skill has a tier from 0 (untrained) to 5 (master);
 * the tier is added to d20 rolls that use the skill. Skills not listed are 0.
 *
 * Used in rolls today: the weapon skills and evasion (combat), speechcraft and
 * intimidation (social checks). The rest shape how the NPC is described to the
 * model and are ready for future mechanics (foraging, crafting, stealth...).
 */
export const SKILLS = [
  // Combat
  "one_handed",
  "two_handed",
  "blunt",
  "archery",
  "unarmed",
  "evasion",
  // Social
  "speechcraft",
  "intimidation",
  "haggling",
  // Crafting and survival
  "smithing",
  "alchemy",
  "foraging",
  "hunting",
  // Stealth
  "sneak",
  "lockpicking",
] as const;
export type Skill = (typeof SKILLS)[number];

/** Skills a weapon can use. */
export type WeaponSkill = Extract<Skill, "one_handed" | "two_handed" | "blunt" | "archery" | "unarmed">;
export const WEAPON_SKILLS = ["one_handed", "two_handed", "blunt", "archery", "unarmed"] as const satisfies readonly WeaponSkill[];

export const TIERS = ["untrained", "novice", "apprentice", "adept", "expert", "master"] as const;

const tier = z.number().int().min(0).max(5);
/** Only known skill names are allowed, so a typo like "forraging" fails validation. */
export const SkillsSchema = z.partialRecord(z.enum(SKILLS), tier);
export type Skills = z.infer<typeof SkillsSchema>;

/** The tier of a skill, 0 if not listed. Also its bonus to rolls. */
export function skillLevel(skills: Skills, skill: Skill): number {
  return skills[skill] ?? 0;
}

const LABELS: Record<Skill, string> = {
  one_handed: "one-handed weapons",
  two_handed: "two-handed weapons",
  blunt: "blunt weapons",
  archery: "archery",
  unarmed: "unarmed fighting",
  evasion: "dodging",
  speechcraft: "speechcraft",
  intimidation: "intimidation",
  haggling: "haggling",
  smithing: "smithing",
  alchemy: "alchemy",
  foraging: "foraging",
  hunting: "hunting",
  sneak: "sneaking",
  lockpicking: "lockpicking",
};

/** "master at smithing, expert at blunt weapons, novice at foraging" - best first, untrained left out. */
export function describeSkills(skills: Skills): string {
  const known = SKILLS.filter((s) => skillLevel(skills, s) > 0).sort((a, b) => skillLevel(skills, b) - skillLevel(skills, a));
  if (known.length === 0) return "no special training";
  return known.map((s) => `${TIERS[skillLevel(skills, s)]} at ${LABELS[s]}`).join(", ");
}
