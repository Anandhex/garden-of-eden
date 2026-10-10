import { describe, expect, it } from "vitest";
import { attack, check, modifier, rollDie } from "../src/game/dice.js";
import { bestWeapon } from "../src/game/items.js";

/** rng value that makes a die of `sides` land on `face`. */
export const face = (n: number, sides: number) => (n - 0.5) / sides;
/** Dice that return these values in order, then repeat. */
export const rolls = (...values: number[]) => {
  let i = 0;
  return () => values[i++ % values.length]!;
};

describe("dice", () => {
  it("rolls the face the rng points at", () => {
    expect(rollDie(rolls(face(1, 20)), 20)).toBe(1);
    expect(rollDie(rolls(face(20, 20)), 20)).toBe(20);
    expect(rollDie(rolls(face(3, 6)), 6)).toBe(3);
  });

  it("uses D&D-style modifiers", () => {
    expect([1, 6, 9, 10, 11, 12, 16, 20].map(modifier)).toEqual([-5, -2, -1, 0, 0, 1, 3, 5]);
  });

  it("check: total = roll + modifier, compared to the target", () => {
    expect(check(rolls(face(11, 20)), 13, 12)).toEqual({ roll: 11, total: 12, target: 12, success: true });
    expect(check(rolls(face(10, 20)), 13, 12)).toEqual({ roll: 10, total: 11, target: 12, success: false });
  });

  it("a natural 20 always succeeds and a natural 1 always fails", () => {
    expect(check(rolls(face(20, 20)), 1, 30).success).toBe(true);
    expect(check(rolls(face(1, 20)), 20, 2).success).toBe(false);
  });

  it("attack: hits roll weapon damage + STR modifier (at least 1); misses do 0", () => {
    const hit = attack(rolls(face(15, 20), face(5, 8)), { strength: 16, weaponSkill: 0 }, { agility: 9, evasion: 0 }, 8);
    expect(hit).toMatchObject({ success: true, damage: 5 + 3 });
    const weakHit = attack(rolls(face(19, 20), face(1, 4)), { strength: 4, weaponSkill: 0 }, { agility: 10, evasion: 0 }, 4);
    expect(weakHit.damage).toBe(1);
    const miss = attack(rolls(face(2, 20)), { strength: 16, weaponSkill: 0 }, { agility: 9, evasion: 0 }, 8);
    expect(miss).toMatchObject({ success: false, damage: 0 });
  });

  it("check adds a skill bonus to the roll", () => {
    expect(check(rolls(face(9, 20)), 10, 12, 3)).toEqual({ roll: 9, total: 12, target: 12, success: true });
  });

  it("attack: weapon skill helps hit, evasion makes you harder to hit", () => {
    // d20 = 10, STR 10: total 10 vs 10 + AGI 10 (0) = 10 → hit.
    const r = rolls(face(10, 20), face(1, 6));
    expect(attack(r, { strength: 10, weaponSkill: 0 }, { agility: 10, evasion: 0 }, 6).success).toBe(true);
    // Same roll against an expert dodger (evasion 4): 10 vs 14 → miss.
    expect(attack(rolls(face(10, 20)), { strength: 10, weaponSkill: 0 }, { agility: 10, evasion: 4 }, 6).success).toBe(false);
    // An expert swordsman (skill 4) hits them anyway: 14 vs 14.
    expect(attack(rolls(face(10, 20), face(1, 6)), { strength: 10, weaponSkill: 4 }, { agility: 10, evasion: 4 }, 6).success).toBe(true);
  });
});

describe("bestWeapon", () => {
  it("picks the strongest weapon carried, or fists", () => {
    expect(bestWeapon({})).toEqual({ name: "fists", die: 4, skill: "unarmed", tier: "G" });
    expect(bestWeapon({ "bread loaf [G]": 2, "dagger [E]": 1 })).toEqual({ name: "dagger [E]", die: 6, skill: "one_handed", tier: "E" });
    expect(bestWeapon({ "dagger [E]": 1, "iron sword [D]": 1 })).toMatchObject({ name: "iron sword [D]", tier: "D" });
    // A higher-tier copy of a weaker weapon can beat a stronger one: dagger [S] (d6 + 3) > iron sword [D] (d8 + 1).
    expect(bestWeapon({ "dagger [S]": 1, "iron sword [D]": 1 })).toMatchObject({ name: "dagger [S]" });
    expect(bestWeapon({ "iron sword": 0 })).toMatchObject({ name: "fists" });
  });
});
