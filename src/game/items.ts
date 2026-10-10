import type { WeaponSkill } from "../npc/skills.js";

/** Item tiers, worst to best. */
export const ITEM_TIERS = ["G", "F", "E", "D", "C", "B", "A", "S", "SS", "SSS"] as const;
export type ItemTier = (typeof ITEM_TIERS)[number];

export interface ItemDef {
  /** What a base-tier copy is worth, in copper (game/money.ts). Other tiers scale by TIER_VALUE_STEP. */
  value: number;
  /** The usual tier for this item, e.g. iron swords are normally D. */
  tier: ItemTier;
  /** Set for weapons: damage die (8 = 1d8) and the skill used to hit with it. */
  weapon?: { die: number; skill: WeaponSkill };
  /** Set for healing items: HP restored by one base-tier copy (see healAmount). */
  heal?: number;
  /** Set for armour: damage taken off every hit (see armorValue in game/gear.ts). */
  armor?: number;
  /** Set for gear (weapons, armour): hits it lasts at its base tier before breaking. Higher tiers last longer. */
  durability?: number;
}

/** Every kind of item in the game, at its base tier. NPC files may only mention these (checked by a test). */
export const ITEMS: Record<string, ItemDef> = {
  // Weapons
  dagger: { value: 150, tier: "E", weapon: { die: 6, skill: "one_handed" }, durability: 30 },
  "iron sword": { value: 400, tier: "D", weapon: { die: 8, skill: "one_handed" }, durability: 50 },
  cudgel: { value: 80, tier: "F", weapon: { die: 6, skill: "blunt" }, durability: 25 },
  "forge hammer": { value: 600, tier: "C", weapon: { die: 8, skill: "blunt" }, durability: 80 },
  // Armour
  "leather armor": { value: 300, tier: "F", armor: 1, durability: 40 },
  "chain mail": { value: 1500, tier: "D", armor: 3, durability: 80 },
  // Smithing
  horseshoe: { value: 20, tier: "G" },
  "iron ore": { value: 60, tier: "F" },
  // Food and drink
  "bread loaf": { value: 10, tier: "G" },
  ale: { value: 20, tier: "G" },
  stew: { value: 40, tier: "G" },
  // Foraged and hunted
  "wild herbs": { value: 30, tier: "F", heal: 5 },
  "rabbit pelt": { value: 50, tier: "F" },
  "wolf pelt": { value: 100, tier: "E" },
  // Medicine
  "healing salve": { value: 120, tier: "E", heal: 20 },
};

/**
 * Inventories hold item *keys*: the name plus a tier, e.g. "iron sword [B]".
 * So an ordinary iron sword [D] and a masterwork iron sword [B] are different
 * entries. A bare name ("iron sword") means the item's base tier.
 *
 * Worn gear carries its durability in the key: "iron sword [D] (12/50)". A copy
 * in perfect shape has no suffix, so worn and new copies are separate stacks,
 * and a worn copy sells for less (itemValue).
 */
export type ItemKey = string;

export interface ParsedItem {
  key: ItemKey;
  name: string;
  tier: ItemTier;
  def: ItemDef;
  /** Gear only: hits left, and the most it can have at this tier. */
  durability?: number;
  maxDurability?: number;
}

/** Each tier above an item's base multiplies its value (and NPC prices) by this; each tier below divides. */
export const TIER_VALUE_STEP = 1.5;

/** Most durability a piece of gear has at `tier`: the base amount, scaled like value. Undefined if it isn't gear. */
export function maxDurability(def: ItemDef, tier: ItemTier): number | undefined {
  return def.durability === undefined ? undefined : Math.max(1, Math.round(def.durability * tierMultiplier(tier, def.tier)));
}

/**
 * "iron sword" + "B" → "iron sword [B]". Defaults to the item's base tier.
 * With `durability` below the maximum: "iron sword [B] (12/112)".
 */
export function itemKey(name: string, tier?: ItemTier, durability?: number): ItemKey {
  const t = tier ?? ITEMS[name]?.tier ?? "G";
  const def = ITEMS[name];
  const max = def ? maxDurability(def, t) : undefined;
  const worn = max !== undefined && durability !== undefined && durability < max;
  return `${name} [${t}]${worn ? ` (${Math.max(0, durability)}/${max})` : ""}`;
}

/** Parse "iron sword [B]", "iron sword [B] (12/112)" or "iron sword". Undefined if it isn't a known item or tier. */
export function parseItem(keyOrName: string): ParsedItem | undefined {
  const m = keyOrName.trim().match(/^(.*?)\s*\[(\w+)\](?:\s*\((\d+)\/\d+\))?$/);
  const name = (m ? m[1]! : keyOrName).trim();
  const def = ITEMS[name];
  if (!def) return undefined;
  const tier = (m ? m[2]! : def.tier) as ItemTier;
  if (!ITEM_TIERS.includes(tier)) return undefined;
  const max = maxDurability(def, tier);
  if (max === undefined) return { key: itemKey(name, tier), name, tier, def };
  const durability = m?.[3] !== undefined ? Math.min(max, Number(m[3])) : max;
  return { key: itemKey(name, tier, durability), name, tier, def, durability, maxDurability: max };
}

/** Weapons and armour: they're equipped, wear out, and each takes a whole pack slot. */
export function isGear(keyOrName: string): boolean {
  const def = parseItem(keyOrName)?.def;
  return def?.weapon !== undefined || def?.armor !== undefined;
}

/** Share of its value a worn copy keeps: 1 when perfect, down to 0.25 when broken. */
export function wearFactor(key: ItemKey): number {
  const item = parseItem(key);
  if (!item?.maxDurability || item.durability === undefined) return 1;
  return 0.25 + 0.75 * (item.durability / item.maxDurability);
}

/** Rewrite an inventory so every key has a tier ("dagger" → "dagger [E]"), merging duplicates. */
export function normalizeInventory(inventory: Record<string, number>): Record<ItemKey, number> {
  const out: Record<ItemKey, number> = {};
  for (const [k, qty] of Object.entries(inventory)) {
    const key = parseItem(k)?.key ?? k;
    out[key] = (out[key] ?? 0) + qty;
  }
  return out;
}

/**
 * Find the inventory key the model meant. Exact keys win; a bare name
 * ("iron sword") matches the only copy in stock, or the base tier if there are several.
 */
export function resolveItem(inventory: Record<ItemKey, number>, keyOrName: string): ItemKey | undefined {
  const parsed = parseItem(keyOrName);
  if (!parsed) return undefined;
  if (/\[\w+\]/.test(keyOrName)) return parsed.key;
  const copies = Object.keys(inventory).filter((k) => (inventory[k] ?? 0) > 0 && parseItem(k)?.name === parsed.name);
  return copies.length === 1 ? copies[0] : parsed.key;
}

/** How much a tier is worth relative to an item's base tier: 1.5x per step up. */
export function tierMultiplier(tier: ItemTier, baseTier: ItemTier): number {
  return TIER_VALUE_STEP ** (ITEM_TIERS.indexOf(tier) - ITEM_TIERS.indexOf(baseTier));
}

/** Value of one copy in copper, e.g. iron sword [B] = 400 * 1.5^2 = 900 (9 gold). Worn gear is worth less (wearFactor). */
export function itemValue(key: ItemKey): number | undefined {
  const item = parseItem(key);
  return item ? Math.max(1, Math.round(item.def.value * tierMultiplier(item.tier, item.def.tier) * wearFactor(key))) : undefined;
}

/** "iron sword [B]" - the canonical key doubles as the display label. */
export function itemLabel(keyOrName: string): string {
  return parseItem(keyOrName)?.key ?? keyOrName;
}

/** Extra damage from a weapon's tier: G/F +0, E/D +1, C/B +2, A/S +3, SS/SSS +4. */
export function tierDamageBonus(tier: ItemTier): number {
  return Math.floor(ITEM_TIERS.indexOf(tier) / 2);
}

export interface Weapon {
  /** The item key, e.g. "iron sword [B]", or "fists". */
  name: string;
  /** Damage die, e.g. 8 for 1d8. */
  die: number;
  /** The skill used to hit with it. */
  skill: WeaponSkill;
  tier: ItemTier;
}

export const FISTS: Weapon = { name: "fists", die: 4, skill: "unarmed", tier: "G" };

/** The weapon stats for an item, or undefined if it isn't a weapon. */
export function weaponFor(keyOrName: string): Weapon | undefined {
  const item = parseItem(keyOrName);
  return item?.def.weapon ? { name: item.key, ...item.def.weapon, tier: item.tier } : undefined;
}

/** Average damage before strength: what bestWeapon compares. */
function averageDamage(w: Weapon): number {
  return (w.die + 1) / 2 + tierDamageBonus(w.tier);
}

/** The player's best weapon from their inventory, or fists. */
export function bestWeapon(inventory: Record<string, number>): Weapon {
  let best = FISTS;
  for (const [item, qty] of Object.entries(inventory)) {
    const weapon = weaponFor(item);
    if (qty > 0 && weapon && averageDamage(weapon) > averageDamage(best)) best = weapon;
  }
  return best;
}

/** HP one copy restores, scaled by tier like value (a salve [C] heals 45), or 0 if it doesn't heal. */
export function healAmount(key: ItemKey): number {
  const item = parseItem(key);
  if (!item?.def.heal) return 0;
  return Math.round(item.def.heal * tierMultiplier(item.tier, item.def.tier));
}
