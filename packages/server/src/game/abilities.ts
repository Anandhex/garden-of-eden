import { type Skill, skillLevel, type Skills } from "../npc/skills.js";
import type { Traits } from "../npc/traits.js";

/**
 * MP abilities and combat styles (N8). A few moves per skill, costing MP, rolled in
 * code and picked by a style that comes from traits, never by the model:
 * - aggressive (quick-tempered and brave): attacks every turn, opens with a war cry
 *   against a foe who outranks them, spends MP on heavy blows;
 * - cautious: fights steadily, and when hurt raises a guard, heals or catches breath;
 * - cowardly: lashes out when cornered, and begs once at half health.
 * The player picks abilities with /ability.
 */
export const ABILITY_IDS = ["heavy_blow", "quick_strike", "war_cry", "guard", "second_wind", "dirty_trick"] as const;
export type AbilityId = (typeof ABILITY_IDS)[number];

export interface Ability {
  id: AbilityId;
  name: string;
  /** Any one of these skills at the level unlocks it. */
  skills: Skill[];
  minLevel: number;
  mp: number;
  kind: "attack" | "defend" | "debuff";
  /** For attacks: extra damage and to-hit. */
  damage?: number;
  toHit?: number;
  /** On a hit (or on use, for debuffs): a status for the foe. */
  inflicts?: { kind: "stunned" | "bleeding" | "weakened"; turns: number; power?: number; chance: number };
  describe: string;
}

export const ABILITIES: Record<AbilityId, Ability> = {
  heavy_blow: { id: "heavy_blow", name: "heavy blow", skills: ["blunt", "two_handed", "smithing"], minLevel: 3, mp: 4, kind: "attack", damage: 4, inflicts: { kind: "stunned", turns: 1, chance: 0.25 }, describe: "a crushing two-handed swing" },
  quick_strike: { id: "quick_strike", name: "quick strike", skills: ["one_handed", "unarmed"], minLevel: 2, mp: 3, kind: "attack", toHit: 2, inflicts: { kind: "bleeding", turns: 3, power: 3, chance: 0.5 }, describe: "a fast cut that opens a wound" },
  war_cry: { id: "war_cry", name: "war cry", skills: ["intimidation"], minLevel: 2, mp: 3, kind: "debuff", inflicts: { kind: "weakened", turns: 2, chance: 0.7 }, describe: "a roar that shakes the foe's nerve" },
  guard: { id: "guard", name: "guard", skills: ["evasion", "one_handed", "blunt", "two_handed"], minLevel: 1, mp: 2, kind: "defend", describe: "a raised guard that halves the next blow" },
  second_wind: { id: "second_wind", name: "second wind", skills: ["evasion", "foraging", "smithing", "one_handed", "blunt"], minLevel: 2, mp: 5, kind: "defend", describe: "a deep breath and a moment's rest: heals a little" },
  dirty_trick: { id: "dirty_trick", name: "dirty trick", skills: ["sneak", "unarmed"], minLevel: 2, mp: 3, kind: "debuff", inflicts: { kind: "stunned", turns: 1, chance: 0.5 }, describe: "sand in the eyes" },
};

/** HP a second wind heals: 8 plus the willpower modifier. */
export const SECOND_WIND_HP = 8;

/** Abilities someone with these skills knows. */
export function abilitiesFor(skills: Skills): Ability[] {
  return Object.values(ABILITIES).filter((a) => a.skills.some((s) => skillLevel(skills, s) >= a.minLevel));
}

/** Abilities they can afford right now. */
export function usableAbilities(skills: Skills, mp: number): Ability[] {
  return abilitiesFor(skills).filter((a) => a.mp <= mp);
}

export const COMBAT_STYLES = ["aggressive", "cautious", "cowardly"] as const;
export type CombatStyle = (typeof COMBAT_STYLES)[number];

/** How an NPC fights, from traits. */
export function combatStyle(t: Pick<Traits, "bravery" | "temper">): CombatStyle {
  if (t.bravery < 0.35) return "cowardly";
  if (t.temper >= 0.6 && t.bravery >= 0.5) return "aggressive";
  return "cautious";
}

/** Share of max HP at or below which a cowardly fighter begs. */
export const COWARD_BEGS_AT = 0.5;
/** Share of max HP at or below which a cautious fighter looks to their defence. */
export const CAUTIOUS_DEFENDS_AT = 0.5;

export type Move = { kind: "attack"; ability?: Ability } | { kind: "ability"; ability: Ability } | { kind: "heal" } | { kind: "beg" };

/**
 * Pick a move for an NPC's turn, in code. `round` is the fight's turn count (war
 * cries open fights), `hpShare` their HP over max, `canHeal` whether they have a
 * healing item, `begged` whether they've begged before in this fight.
 */
export function chooseMove(
  style: CombatStyle,
  skills: Skills,
  mp: number,
  { hpShare, round, canHeal, begged, foeWeakened, foeTougher = false }: { hpShare: number; round: number; canHeal: boolean; begged: boolean; foeWeakened: boolean; foeTougher?: boolean },
): Move {
  const usable = usableAbilities(skills, mp);
  const find = (id: AbilityId) => usable.find((a) => a.id === id);
  const bestAttack = find("heavy_blow") ?? find("quick_strike");
  if (style === "cowardly") {
    // A salve first if they have one; with nothing left, they beg.
    if (hpShare <= COWARD_BEGS_AT && canHeal) return { kind: "heal" };
    if (hpShare <= COWARD_BEGS_AT && !begged) return { kind: "beg" };
    const trick = find("dirty_trick");
    if (trick) return { kind: "ability", ability: trick };
    return { kind: "attack" };
  }
  if (style === "cautious") {
    if (hpShare <= CAUTIOUS_DEFENDS_AT) {
      if (canHeal) return { kind: "heal" };
      const wind = find("second_wind");
      if (wind) return { kind: "ability", ability: wind };
      const guard = find("guard");
      if (guard) return { kind: "ability", ability: guard };
    }
    return bestAttack && round % 2 === 1 ? { kind: "attack", ability: bestAttack } : { kind: "attack" };
  }
  // Aggressive: open with a war cry against a dangerous foe, then hit as hard as MP allows; heal only when nearly done.
  const cry = find("war_cry");
  if (round === 0 && foeTougher && cry && !foeWeakened) return { kind: "ability", ability: cry };
  if (hpShare <= 0.2 && canHeal) return { kind: "heal" };
  return bestAttack ? { kind: "attack", ability: bestAttack } : { kind: "attack" };
}

/** Parse "/ability heavy blow" → its id. */
export function parseAbility(text: string): AbilityId | null {
  const t = text.trim().toLowerCase().replace(/[\s-]+/g, "_");
  return (ABILITY_IDS as readonly string[]).includes(t) ? (t as AbilityId) : null;
}
