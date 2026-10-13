import { npcSkills } from "../npc/state.js";
import { type Skill, skillLevel } from "../npc/skills.js";
import type { CraftJob, NpcPersona, NpcState } from "../npc/types.js";
import { type Rng, rollDie } from "./dice.js";
import { fitsIn } from "./gear.js";
import { ITEM_TIERS, ITEMS, itemKey, parseItem } from "./items.js";

/**
 * What NPCs can make. Inputs are plain item names (any tier is used up);
 * the output's tier is rolled from the crafter's skill (rollOutputTier).
 */
export interface Recipe {
  id: string;
  /** Item name made. */
  output: string;
  qty: number;
  inputs: Record<string, number>;
  skill: Skill;
  /** Skill level needed to make it at all. */
  minLevel: number;
  hours: number;
  /** For messages: "forging a dagger". */
  doing: string;
}

export const RECIPES: Recipe[] = [
  { id: "horseshoes", output: "horseshoe", qty: 2, inputs: { "iron ore": 1 }, skill: "smithing", minLevel: 1, hours: 1, doing: "shoeing iron into horseshoes" },
  { id: "dagger", output: "dagger", qty: 1, inputs: { "iron ore": 2 }, skill: "smithing", minLevel: 2, hours: 2, doing: "forging a dagger" },
  { id: "iron_sword", output: "iron sword", qty: 1, inputs: { "iron ore": 4 }, skill: "smithing", minLevel: 3, hours: 4, doing: "forging an iron sword" },
  { id: "ale", output: "ale", qty: 3, inputs: { "wild herbs": 1 }, skill: "alchemy", minLevel: 1, hours: 2, doing: "brewing ale" },
  { id: "stew", output: "stew", qty: 2, inputs: { "bread loaf": 1, "wild herbs": 1 }, skill: "foraging", minLevel: 1, hours: 1, doing: "cooking stew" },
  { id: "healing_salve", output: "healing salve", qty: 1, inputs: { "wild herbs": 2 }, skill: "alchemy", minLevel: 2, hours: 2, doing: "mixing a healing salve" },
];

/** How many of an item (any tier) are in an inventory. */
export function countItem(inventory: Record<string, number>, name: string): number {
  let n = 0;
  for (const [key, qty] of Object.entries(inventory)) if (parseItem(key)?.name === name) n += qty;
  return n;
}

/** Take `qty` of an item from an inventory, lowest tiers first. Assumes there are enough. */
export function removeItem(inventory: Record<string, number>, name: string, qty: number): void {
  takeItems(inventory, name, qty);
}

/**
 * Take `qty` of an item, lowest tiers first (or best first), and return the keys
 * taken, one per copy. Takes what there is if there aren't enough.
 */
export function takeItems(inventory: Record<string, number>, name: string, qty: number, best = false): string[] {
  const keys = Object.keys(inventory)
    .filter((k) => parseItem(k)?.name === name)
    .sort((a, b) => (ITEM_TIERS.indexOf(parseItem(a)!.tier) - ITEM_TIERS.indexOf(parseItem(b)!.tier)) * (best ? -1 : 1));
  const taken: string[] = [];
  for (const key of keys) {
    const take = Math.min(qty, inventory[key] ?? 0);
    inventory[key] = (inventory[key] ?? 0) - take;
    if (inventory[key] === 0) delete inventory[key];
    for (let i = 0; i < take; i++) taken.push(key);
    qty -= take;
    if (qty === 0) break;
  }
  return taken;
}

/**
 * What the materials add to a piece (N10): the average tier steps the inputs stand
 * above (or below) their usual tier, rounded down, from -1 to +2. Ore [C] for a
 * sword usually made from ore [F] adds up to two tiers; poor stuff takes one off.
 */
export function inputBonus(taken: string[]): number {
  if (taken.length === 0) return 0;
  const steps = taken.map((k) => {
    const p = parseItem(k)!;
    return ITEM_TIERS.indexOf(p.tier) - ITEM_TIERS.indexOf(p.def.tier);
  });
  const avg = steps.reduce((a, b) => a + b, 0) / steps.length;
  return Math.max(-1, Math.min(2, Math.floor(avg)));
}

/** Recipes the NPC has the skill for (whether or not they have the materials). */
export function knownRecipes(persona: NpcPersona): Recipe[] {
  return RECIPES.filter((r) => skillLevel(persona.skills, r.skill) >= r.minLevel);
}

/**
 * Recipes for the NPC's trade: ones they know whose output they sell. These are
 * what they actually make in their working hours, and what their needs come from.
 * (A smith knows how to cook stew, but she's a smith: she doesn't sell it.)
 */
export function tradeRecipes(persona: NpcPersona): Recipe[] {
  return knownRecipes(persona).filter((r) => persona.prices[r.output] !== undefined);
}

export function hasInputs(inventory: Record<string, number>, recipe: Recipe): boolean {
  return Object.entries(recipe.inputs).every(([name, qty]) => countItem(inventory, name) >= qty);
}

/**
 * Tier of a crafted item: the item's base tier, plus 1 if d20 + 2×skill ≥ 18,
 * plus 2 if ≥ 25. A master smith (skill 5, +10) often makes iron sword [C] or [B].
 */
export function rollOutputTier(recipe: Recipe, skill: number, rng: Rng, materials = 0) {
  const base = ITEMS[recipe.output]!.tier;
  const roll = rollDie(rng, 20) + 2 * skill;
  const bump = roll >= 25 ? 2 : roll >= 18 ? 1 : 0;
  return ITEM_TIERS[Math.max(0, Math.min(ITEM_TIERS.length - 1, ITEM_TIERS.indexOf(base) + bump + materials))]!;
}

/**
 * Start making something: uses the inputs now, rolls the output tier, and makes the NPC busy.
 * `now` is the absolute game minute (absoluteMinute in clock.ts).
 */
export function startCraft(persona: NpcPersona, state: NpcState, recipe: Recipe, now: number, rng: Rng, { best = false }: { best?: boolean } = {}): CraftJob {
  // Routine work uses up the poorest stock; an order gets the best materials (N10).
  const taken = Object.entries(recipe.inputs).flatMap(([name, qty]) => takeItems(state.inventory, name, qty, best));
  const materials = inputBonus(taken);
  const tier = rollOutputTier(recipe, skillLevel(npcSkills(persona, state), recipe.skill), rng, materials);
  const job: CraftJob = { recipeId: recipe.id, output: itemKey(recipe.output, tier), qty: recipe.qty, until: now + recipe.hours * 60, doing: recipe.doing, ...(materials !== 0 ? { inputBonus: materials } : {}) };
  state.job = job;
  return job;
}

/** Would the NPC have room for what a recipe makes, once its inputs are used up? */
export function fitsCraft(inventory: Record<string, number>, slots: number, recipe: Recipe): boolean {
  const after = { ...inventory };
  for (const [name, qty] of Object.entries(recipe.inputs)) removeItem(after, name, qty);
  return fitsIn(after, slots, { [itemKey(recipe.output)]: recipe.qty });
}

/** Finish the job if its time has come (`now` in absolute minutes): the output goes into stock. Returns the finished job, if any. */
export function finishCraft(state: NpcState, now: number): CraftJob | null {
  const job = state.job;
  if (!job || now < job.until) return null;
  state.inventory[job.output] = (state.inventory[job.output] ?? 0) + job.qty;
  state.job = null;
  return job;
}

/**
 * What the NPC is short of: for each trade recipe, enough input for two batches.
 * E.g. a smith (smithing 5) with no iron ore needs 8 (two iron swords' worth).
 */
export function craftingNeeds(persona: NpcPersona, state: NpcState): Record<string, number> {
  const needs: Record<string, number> = {};
  for (const recipe of tradeRecipes(persona)) {
    for (const [name, qty] of Object.entries(recipe.inputs)) {
      const short = qty * 2 - countItem(state.inventory, name);
      if (short > (needs[name] ?? 0)) needs[name] = short;
    }
  }
  return Object.fromEntries(Object.entries(needs).filter(([, n]) => n > 0));
}
