import { parseItem } from "../game/items.js";
import { QUEST_TIERS } from "../game/levels.js";
import { skillLevel } from "./skills.js";
import { resolveTraits, type Trait } from "./traits.js";
import type { NpcPersona } from "./types.js";

/**
 * The NPC authoring check (T5): what the schema can't see because it needs the whole
 * cast, or common sense. Run by `npm run check-npcs`, at CLI startup, in CI (through
 * the tests) and on every generated NPC (N11). Returns readable problems; none is good.
 */

/** Personality words and the trait (or greed) they promise. A file that says "cowardly" with bravery 0.8 is lying to the model. */
const PROMISES: Array<{ words: RegExp; trait: Trait | "greed"; atLeast?: number; atMost?: number }> = [
  { words: /\b(cowardly|timid|fearful)\b/i, trait: "bravery", atMost: 0.45 },
  { words: /\b(brave|fearless|bold)\b/i, trait: "bravery", atLeast: 0.55 },
  { words: /\b(greedy|money-hungry|grasping|miserly)\b/i, trait: "greed", atLeast: 0.55 },
  { words: /\b(dishonest|liar|deceitful|sly)\b/i, trait: "honesty", atMost: 0.45 },
  { words: /\b(honest|truthful|earnest)\b/i, trait: "honesty", atLeast: 0.55 },
  { words: /\b(chatty|talkative|gregarious)\b/i, trait: "sociability", atLeast: 0.55 },
  { words: /\b(shy|withdrawn|solitary|quiet|reserved)\b/i, trait: "sociability", atMost: 0.5 },
  { words: /\b(hot-headed|short-tempered|quick to anger)\b/i, trait: "temper", atLeast: 0.55 },
  { words: /\b(generous|open-handed)\b/i, trait: "generosity", atLeast: 0.55 },
  { words: /\b(stingy|tight-fisted)\b/i, trait: "generosity", atMost: 0.45 },
];

/** Personality words that promise a trait the numbers don't have: "earnest" with honesty 0.4. */
export function contradictions(personality: string[], traits: Partial<Record<Trait, number>> | undefined, greed: number): string[] {
  const t = resolveTraits(traits);
  const out: string[] = [];
  for (const word of personality) {
    for (const rule of PROMISES) {
      const m = word.match(rule.words);
      if (!m) continue;
      const value = rule.trait === "greed" ? greed : t[rule.trait];
      if ((rule.atLeast !== undefined && value < rule.atLeast) || (rule.atMost !== undefined && value > rule.atMost)) out.push(`personality says "${m[0]}" but ${rule.trait} is ${value}`);
    }
  }
  return out;
}

export function lintPersona(p: NpcPersona, cast: Record<string, NpcPersona>): string[] {
  const problems: string[] = [];
  const known = (id: string) => id === "player" || cast[id] !== undefined;

  // Teaching a skill they don't have.
  if (p.teaches && skillLevel(p.skills, p.teaches) === 0) problems.push(`teaches ${p.teaches}, which they don't have`);

  // Trade: every price and every thing they buy is a real item.
  for (const name of Object.keys(p.prices)) if (!parseItem(name)) problems.push(`prices: unknown item "${name}"`);
  for (const name of p.buys) if (!parseItem(name)) problems.push(`buys: unknown item "${name}"`);

  // Quests they can never give: above their own highest tier.
  const max = QUEST_TIERS.indexOf(p.maxQuestTier);
  for (const q of p.quests ?? []) {
    if (QUEST_TIERS.indexOf(q.tier) > max) problems.push(`quest "${q.id}" is tier ${q.tier}, above their maxQuestTier ${p.maxQuestTier}: it's never offered`);
    if (q.objective.type === "defeat_npc" && !cast[q.objective.npc]) problems.push(`quest "${q.id}" targets unknown NPC "${q.objective.npc}"`);
  }

  // Secrets: breakers must point at something real.
  for (const s of p.secrets) {
    if (s.debt && !(p.debts ?? []).some((d) => d.id === s.debt)) problems.push(`secret "${s.id}" names unknown debt "${s.debt}"`);
    for (const b of s.breaksWith ?? []) {
      if ("fact" in b) {
        const [npc, secret] = b.fact.split(".") as [string, string];
        if (!cast[npc]?.secrets.some((x) => x.id === secret)) problems.push(`secret "${s.id}" breaks with unknown fact "${b.fact}"`);
      }
    }
  }

  // Personality words that contradict the traits.
  problems.push(...contradictions(p.personality, p.traits, p.greed));

  // The cast: everyone they name exists, and ties go both ways.
  for (const id of Object.keys(p.relationships ?? {})) if (!cast[id]) problems.push(`relationships: unknown NPC "${id}"`);
  if (p.successor && cast[p.successor]?.successorOf !== p.id) problems.push(`successor "${p.successor}" doesn't name them back (successorOf)`);
  if (p.successorOf && !cast[p.successorOf]) problems.push(`successorOf unknown NPC "${p.successorOf}"`);
  if (p.spouse) {
    if (!cast[p.spouse]) problems.push(`spouse: unknown NPC "${p.spouse}"`);
    else if (cast[p.spouse]!.spouse !== p.id) problems.push(`spouse "${p.spouse}" doesn't name them back`);
    else if (cast[p.spouse]!.minor) problems.push(`spouse "${p.spouse}" is a minor`);
  }
  for (const parent of p.parents ?? []) if (!known(parent)) problems.push(`parents: unknown NPC "${parent}"`);
  if (p.parents?.includes(p.id)) problems.push("is their own parent");

  // Content limits (design rule 7): a child isn't a guard, a hireling or a fighter for pay.
  if (p.minor) {
    if (p.guard) problems.push("a minor can't be a guard");
    if (p.hire) problems.push("a minor can't be hired as a companion");
    if (p.armor) problems.push("a minor doesn't wear armour");
    if (p.dropsOnDeath) problems.push("a minor's death is never a looting matter (dropsOnDeath)");
  }
  return problems;
}

/** Every NPC in the cast, checked: { id: problems } for those with any. */
export function lintCast(cast: Record<string, NpcPersona>): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [id, p] of Object.entries(cast)) {
    const problems = lintPersona(p, cast);
    if (problems.length > 0) out[id] = problems;
  }
  return out;
}
