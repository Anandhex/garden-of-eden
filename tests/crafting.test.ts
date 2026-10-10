import { describe, expect, it } from "vitest";
import brenaJson from "../src/data/npcs/brena.json" with { type: "json" };
import pellJson from "../src/data/npcs/pell.json" with { type: "json" };
import { absoluteHour } from "../src/game/clock.js";
import {
  countItem,
  finishCraft,
  hasInputs,
  knownRecipes,
  RECIPES,
  removeItem,
  rollOutputTier,
  startCraft,
  tradeRecipes,
} from "../src/game/crafting.js";
import { busyWith, passTime } from "../src/game/simulation.js";
import { createNpcState } from "../src/npc/state.js";
import type { NpcPersona } from "../src/npc/types.js";
import { createDemoWorld } from "../src/world/world.js";
import { parsePersona } from "../src/npc/personaSchema.js";

const brena = parsePersona(brenaJson);
const pell = parsePersona(pellJson);
const recipe = (id: string) => RECIPES.find((r) => r.id === id)!;
const d20 = (n: number) => () => (n - 0.5) / 20;

describe("recipes", () => {
  it("each NPC knows the recipes their skills allow", () => {
    expect(knownRecipes(brena).map((r) => r.id)).toEqual(["horseshoes", "dagger", "iron_sword", "stew"]);
    expect(knownRecipes(pell).map((r) => r.id)).toEqual(["ale", "stew", "healing_salve"]);
  });

  it("but only work at (and need materials for) what they sell", () => {
    expect(tradeRecipes(brena).map((r) => r.id)).toEqual(["horseshoes", "dagger", "iron_sword"]);
    expect(tradeRecipes(pell).map((r) => r.id)).toEqual(["ale", "stew", "healing_salve"]);
  });

  it("count and remove items across tiers, lowest tier first", () => {
    const inv = { "iron sword [D]": 1, "iron sword [B]": 1 };
    expect(countItem(inv, "iron sword")).toBe(2);
    removeItem(inv, "iron sword", 1);
    expect(inv).toEqual({ "iron sword [B]": 1 });
  });

  it("a master smith rolls better tiers", () => {
    // d20 + 2×skill: ≥ 25 → +2 tiers, ≥ 18 → +1.
    expect(rollOutputTier(recipe("iron_sword"), 5, d20(15))).toBe("B"); // 25
    expect(rollOutputTier(recipe("iron_sword"), 5, d20(8))).toBe("C"); // 18
    expect(rollOutputTier(recipe("iron_sword"), 3, d20(5))).toBe("D"); // 11
  });

  it("crafting uses the inputs up front and delivers the output when done", () => {
    const state = createNpcState(brena, { inventory: { "iron ore [F]": 4 } });
    const job = startCraft(brena, state, recipe("iron_sword"), 10 * 60, d20(15));
    expect(hasInputs(state.inventory, recipe("iron_sword"))).toBe(false);
    expect(job).toMatchObject({ output: "iron sword [B]", qty: 1, until: 14 * 60 }); // absolute minute
    expect(finishCraft(state, 14 * 60 - 1)).toBeNull();
    expect(finishCraft(state, 14 * 60)?.output).toBe("iron sword [B]");
    expect(state.inventory["iron sword [B]"]).toBe(1);
    expect(state.job).toBeNull();
  });
});

describe("time passing", () => {
  it("an NPC with materials starts crafting and is busy until done", () => {
    const world = createDemoWorld(); // Day 1, 14:00
    const state = createNpcState(brena, { inventory: { "iron ore [F]": 2 } });
    const log = passTime(brena, state, world, 1, () => 0.01); // always crafts, picks the first recipe it can
    expect(log[0]).toMatch(/started/);
    expect(busyWith(state, world)).toMatch(/until/);
    passTime(brena, state, world, 4, () => 0.99);
    expect(busyWith(state, world)).toBeNull();
    expect(log.length).toBe(1);
  });

  it("nobody crafts outside working hours", () => {
    const world = createDemoWorld();
    world.hour = 21;
    const state = createNpcState(brena, { inventory: { "iron ore [F]": 4 } });
    passTime(brena, state, world, 3, () => 0.01);
    expect(state.job).toBeNull();
  });

  it("idle NPCs sell stock to villagers for gold (which can pay down debts)", () => {
    const world = createDemoWorld();
    const state = createNpcState(pell, { money: 200, inventory: { "ale [G]": 1 } }); // no herbs: can't brew
    const before = state.debts.mayor!;
    passTime(pell, state, world, 1, () => 0.1);
    expect(state.inventory["ale [G]"]).toBeUndefined();
    expect(state.debts.mayor).toBe(before - 20); // an ale: 2 silver
  });

  it("time passes even for the dead, but they do nothing", () => {
    const world = createDemoWorld();
    const state = createNpcState(brena, { outcome: "dead", inventory: { "iron ore [F]": 4 } });
    expect(passTime(brena, state, world, 2, () => 0.01)).toEqual([]);
    expect(absoluteHour(world)).toBe(16);
  });

  it("needs and quests are refreshed after time passes", () => {
    const world = createDemoWorld();
    const state = createNpcState(brena);
    passTime(brena, state, world, 1, () => 0.99);
    expect(state.questBoard.map((q) => q.id)).toEqual(["need_brena_iron_ore"]);
  });
});
