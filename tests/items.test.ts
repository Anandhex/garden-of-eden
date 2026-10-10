import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { attack } from "../src/game/dice.js";
import {
  ITEM_TIERS,
  ITEMS,
  itemKey,
  itemLabel,
  itemValue,
  normalizeInventory,
  parseItem,
  resolveItem,
  tierDamageBonus,
  tierMultiplier,
  weaponFor,
} from "../src/game/items.js";

const NPC_DIR = new URL("../src/data/npcs/", import.meta.url);

describe("item tiers", () => {
  it("run G to SSS", () => {
    expect(ITEM_TIERS).toEqual(["G", "F", "E", "D", "C", "B", "A", "S", "SS", "SSS"]);
  });

  it("every item has a valid tier and a positive value", () => {
    for (const [name, def] of Object.entries(ITEMS)) {
      expect(ITEM_TIERS, name).toContain(def.tier);
      expect(def.value, name).toBeGreaterThan(0);
    }
  });

  it("labels items with their tier", () => {
    expect(itemLabel("iron sword")).toBe("iron sword [D]");
    expect(itemLabel("not an item")).toBe("not an item");
  });

  it("weapons hit harder at higher tiers: +0 at G/F up to +4 at SS/SSS", () => {
    expect(ITEM_TIERS.map(tierDamageBonus)).toEqual([0, 0, 1, 1, 2, 2, 3, 3, 4, 4]);
  });

  it("the tier bonus is added to damage", () => {
    const roll = () => {
      const values = [14.5 / 20, 3.5 / 8];
      let i = 0;
      return () => values[i++]!;
    };
    const plain = attack(roll(), { strength: 10, weaponSkill: 0 }, { agility: 10, evasion: 0 }, 8);
    const sss = attack(roll(), { strength: 10, weaponSkill: 0 }, { agility: 10, evasion: 0 }, 8, tierDamageBonus("SSS"));
    expect(sss.damage - plain.damage).toBe(4);
  });

  it("only weapons have weapon stats", () => {
    expect(weaponFor("forge hammer")).toEqual({ name: "forge hammer [C]", die: 8, skill: "blunt", tier: "C" });
    expect(weaponFor("iron sword [B]")).toEqual({ name: "iron sword [B]", die: 8, skill: "one_handed", tier: "B" });
    expect(weaponFor("bread loaf")).toBeUndefined();
  });
});

describe("every NPC file only mentions known items", () => {
  const files = readdirSync(NPC_DIR).filter((f) => f.endsWith(".json"));
  it.each(files)("%s", (file) => {
    const npc = JSON.parse(readFileSync(new URL(file, NPC_DIR), "utf8"));
    const mentioned = [
      ...Object.keys(npc.startingInventory),
      ...Object.keys(npc.prices),
      ...npc.buys,
      npc.weapon,
    ];
    for (const item of mentioned) expect(parseItem(item), `"${item}" in ${file} is not a known item and tier`).toBeDefined();
  });
});

describe("copies of the same item at different tiers", () => {
  it("are separate inventory entries, keyed by name and tier", () => {
    expect(itemKey("iron sword")).toBe("iron sword [D]");
    expect(itemKey("iron sword", "B")).toBe("iron sword [B]");
    expect(parseItem("iron sword [B]")).toMatchObject({ name: "iron sword", tier: "B" });
    expect(parseItem("iron sword")).toMatchObject({ key: "iron sword [D]", tier: "D" });
    expect(parseItem("iron sword [Z]")).toBeUndefined();
    expect(parseItem("magic carpet")).toBeUndefined();
  });

  it("plain names in data files become base-tier keys, merging duplicates", () => {
    expect(normalizeInventory({ dagger: 1, "dagger [E]": 2, "dagger [S]": 1 })).toEqual({ "dagger [E]": 3, "dagger [S]": 1 });
  });

  it("are worth 1.5x more per tier above the base, and less below", () => {
    expect(tierMultiplier("B", "D")).toBe(2.25);
    expect(itemValue("iron sword [D]")).toBe(400);
    expect(itemValue("iron sword [B]")).toBe(900);
    expect(itemValue("iron sword [E]")).toBe(267); // 4 gold / 1.5
    expect(itemValue("bread loaf [G]")).toBe(10);
  });

  it("higher tiers of a weapon hit harder", () => {
    expect(tierDamageBonus(weaponFor("iron sword [D]")!.tier)).toBe(1);
    expect(tierDamageBonus(weaponFor("iron sword [SSS]")!.tier)).toBe(4);
  });

  it("resolve a bare name the model sends to the right copy", () => {
    expect(resolveItem({ "iron sword [B]": 1 }, "iron sword")).toBe("iron sword [B]"); // only copy
    expect(resolveItem({ "iron sword [D]": 2, "iron sword [B]": 1 }, "iron sword")).toBe("iron sword [D]"); // several: base tier
    expect(resolveItem({ "iron sword [D]": 2, "iron sword [B]": 1 }, "iron sword [B]")).toBe("iron sword [B]"); // exact
    expect(resolveItem({}, "magic carpet")).toBeUndefined();
  });
});
