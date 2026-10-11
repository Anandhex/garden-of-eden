import { playerUsesSkill } from "../npc/growth.js";
import { skillLevel, type Skill } from "../npc/skills.js";
import type { PlayerState } from "../npc/types.js";
import { check, type Rng } from "./dice.js";
import { hasInputs, inputBonus, RECIPES, type Recipe, rollOutputTier, takeItems } from "./crafting.js";
import { playerHasRoom } from "./gear.js";
import { ITEM_TIERS, ITEMS, itemKey, itemLabel } from "./items.js";
import { recordCraft, recordGather } from "./quests.js";
import type { PlaceId } from "./schedule.js";

/**
 * The player's own work (N9): gathering where things grow (/forage) and making
 * things where there are tools (/craft). Both are rolled in code, take time, practise
 * the skill (a fine result is the trial for its next tier: npc/growth.ts) and count
 * for gather and craft quests.
 */
export interface Find {
  item: string;
  skill: Skill;
  /** Target for the roll (perception + skill). */
  target: number;
}

/** What can be found at each place. */
export const FINDS: Partial<Record<PlaceId, Find[]>> = {
  gate: [
    { item: "wild herbs", skill: "foraging", target: 10 },
    { item: "rabbit pelt", skill: "hunting", target: 13 },
  ],
  square: [{ item: "wild herbs", skill: "foraging", target: 14 }],
  camp: [{ item: "iron ore", skill: "foraging", target: 15 }],
};

/** Hours one go at gathering takes. */
export const FORAGE_HOURS = 1;

export interface WorkResult {
  ok: boolean;
  message: string;
  /** Hours the caller should let pass. */
  hours: number;
  /** Quest progress and skill lines. */
  notes: string[];
}

/** Gather at the player's place: one roll per find there; a great roll finds a better one. */
export function forage(player: PlayerState, rng: Rng, day = 0): WorkResult {
  const place = (player.place ?? "square") as PlaceId;
  const finds = FINDS[place];
  if (!finds) return { ok: false, hours: 0, notes: [], message: "Nothing grows or turns up here worth gathering. Try the roads by the gate." };
  const got: string[] = [];
  const notes: string[] = [];
  for (const f of finds) {
    const r = check(rng, player.attributes.perception, f.target, skillLevel(player.skills, f.skill));
    const great = r.success && r.total >= f.target + 6;
    const base = ITEMS[f.item]!.tier;
    const key = itemKey(f.item, great ? ITEM_TIERS[Math.min(ITEM_TIERS.length - 1, ITEM_TIERS.indexOf(base) + 1)] : base);
    const rose = playerUsesSkill(player, f.skill, great, 0.5);
    if (rose) notes.push(rose);
    if (!r.success || !playerHasRoom(player, { [key]: 1 })) continue;
    player.inventory[key] = (player.inventory[key] ?? 0) + 1;
    (player.gathered ??= []).push({ item: f.item, place, day });
    if (player.gathered.length > 50) player.gathered.shift();
    notes.push(...recordGather(player, f.item, place));
    got.push(itemLabel(key));
  }
  return { ok: true, hours: FORAGE_HOURS, notes, message: got.length > 0 ? `You gather: ${got.join(", ")}.` : "You search for an hour and find nothing." };
}

/** Where each craft needs to be done: a smith's work needs the forge, brewing and cooking the inn's kitchen. */
export const WORKPLACE: Partial<Record<Skill, PlaceId>> = { smithing: "forge", alchemy: "inn", foraging: "inn" };

/** Find a recipe by id or output name. */
export function findRecipe(text: string): Recipe | undefined {
  const t = text.trim().toLowerCase().replace(/s$/, "");
  return RECIPES.find((r) => r.id === t.replace(/\s+/g, "_") || r.output === t || r.output.replace(/s$/, "") === t);
}

/** The player makes something (/craft): their skill, the right place, the materials. Better materials, better work. */
export function playerCraft(player: PlayerState, what: string, rng: Rng, day = 0): WorkResult {
  const recipe = findRecipe(what);
  if (!recipe) return { ok: false, hours: 0, notes: [], message: `You don't know how to make that. Recipes: ${RECIPES.map((r) => r.output).join(", ")}.` };
  const level = skillLevel(player.skills, recipe.skill);
  if (level < recipe.minLevel) return { ok: false, hours: 0, notes: [], message: `Making ${recipe.output} takes ${recipe.skill} at ${recipe.minLevel}; you're at ${level}. Train first.` };
  const where = WORKPLACE[recipe.skill];
  if (where && player.place !== where) return { ok: false, hours: 0, notes: [], message: `You need the ${where === "forge" ? "forge" : "inn's kitchen"} for that.` };
  if (!hasInputs(player.inventory, recipe)) return { ok: false, hours: 0, notes: [], message: `You need ${Object.entries(recipe.inputs).map(([n, q]) => `${q} ${n}`).join(" and ")}.` };
  if (!playerHasRoom(player, { [itemKey(recipe.output)]: recipe.qty })) return { ok: false, hours: 0, notes: [], message: "No room in your pack for what you'd make." };
  const taken = Object.entries(recipe.inputs).flatMap(([name, qty]) => takeItems(player.inventory, name, qty, true));
  const tier = rollOutputTier(recipe, level, rng, inputBonus(taken));
  const key = itemKey(recipe.output, tier);
  player.inventory[key] = (player.inventory[key] ?? 0) + recipe.qty;
  (player.crafted ??= []).push({ item: recipe.output, tier, day });
  if (player.crafted.length > 50) player.crafted.shift();
  const notes: string[] = [];
  for (let i = 0; i < recipe.qty; i++) notes.push(...recordCraft(player, key));
  const fine = ITEM_TIERS.indexOf(tier) > ITEM_TIERS.indexOf(ITEMS[recipe.output]!.tier);
  const rose = playerUsesSkill(player, recipe.skill, fine, recipe.hours / 2);
  if (rose) notes.push(rose);
  return { ok: true, hours: recipe.hours, notes, message: `You spend ${recipe.hours} hour${recipe.hours > 1 ? "s" : ""} and make ${recipe.qty > 1 ? `${recipe.qty} ` : "a "}${itemLabel(key)}.` };
}
