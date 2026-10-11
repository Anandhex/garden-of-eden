/**
 * Dice and rolls. Every roll in the game happens here, in code; the model is
 * only told the outcome. Pass a fixed `Rng` in tests to make rolls predictable.
 */

/** Returns a number in [0, 1), like Math.random. */
export type Rng = () => number;

export const defaultRng: Rng = Math.random;

/** A seeded RNG (mulberry32): the same seed gives the same rolls, on every machine. */
export function seededRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A seed from text ("farmer:3"), so a name or id can seed rolls. */
export function seedFrom(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function rollDie(rng: Rng, sides: number): number {
  return Math.floor(rng() * sides) + 1;
}

/** D&D-style modifier: 10-11 → 0, 16 → +3, 6 → -2. */
export function modifier(attribute: number): number {
  return Math.floor((attribute - 10) / 2);
}

export interface CheckResult {
  roll: number;
  total: number;
  target: number;
  success: boolean;
}

/**
 * d20 + attribute modifier + bonus (usually a skill tier) against a target number.
 * A natural 20 always succeeds, a 1 always fails.
 */
export function check(rng: Rng, attribute: number, target: number, bonus = 0): CheckResult {
  const roll = rollDie(rng, 20);
  const total = roll + modifier(attribute) + bonus;
  const success = roll === 20 || (roll !== 1 && total >= target);
  return { roll, total, target, success };
}

export interface AttackResult extends CheckResult {
  damage: number;
}

/**
 * Attack roll: d20 + attacker's strength modifier + weapon skill, against
 * 10 + defender's agility modifier + evasion skill.
 * On a hit, damage is one weapon die + strength modifier + damageBonus (at least 1).
 */
export function attack(
  rng: Rng,
  attacker: { strength: number; weaponSkill: number },
  defender: { agility: number; evasion: number },
  weaponDie: number,
  /** Extra damage on a hit, e.g. from the weapon's tier. */
  damageBonus = 0,
): AttackResult {
  const result = check(rng, attacker.strength, 10 + modifier(defender.agility) + defender.evasion, attacker.weaponSkill);
  const damage = result.success ? Math.max(1, rollDie(rng, weaponDie) + modifier(attacker.strength) + damageBonus) : 0;
  return { ...result, damage };
}
