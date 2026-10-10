import { modifier } from "./dice.js";
import {
  FISTS,
  ITEM_TIERS,
  type ItemKey,
  type ItemTier,
  isGear,
  itemKey,
  itemLabel,
  itemValue,
  parseItem,
  resolveItem,
  type Weapon,
  weaponFor,
} from "./items.js";
import { QUEST_TIER_MIN_LEVEL, rankForLevel } from "./levels.js";

/**
 * Gear and burden, with the same rules for the player and for NPCs.
 *
 * - **Equipment:** a weapon slot and an armour slot. Fights use what's equipped.
 * - **Gear level:** nobody can equip gear above their own rank. An NPC's rank is
 *   their life tier; the player's comes from their level (rankForLevel), so an
 *   E-tier dagger needs level 3 and a D-tier sword level 5.
 * - **Durability:** each hit wears the weapon that lands it and the armour that
 *   takes it. A broken weapon is as good as fists; broken armour stops nothing.
 *   A smith repairs gear for a fee (repairCost); smith NPCs mend their own.
 * - **Burden:** a pack has slots. A piece of gear takes a slot of its own;
 *   other goods stack, STACK_SIZE to a slot. Pack slots come from strength.
 *   Shopkeepers also have storage (a chest or bag, in their NPC file) with
 *   slots of its own, which is where their stock lives. Equipped gear is worn,
 *   not packed. When everything is full, nothing more goes in.
 */
export type Slot = "weapon" | "armor";
export const SLOTS: readonly Slot[] = ["weapon", "armor"];

export interface Equipment {
  weapon?: ItemKey;
  armor?: ItemKey;
}

/** Anyone who carries things and wears gear: the player, an NPC. */
export interface Holder {
  inventory: Record<ItemKey, number>;
  equipment?: Equipment;
}

/** Goods of one kind that fit in a pack slot. Gear never stacks. */
export const STACK_SIZE = 20;
/** A repair costs this share of the value lost to wear. */
export const REPAIR_SHARE = 0.5;

/** Pack slots for a strength: 10, plus 2 per point of strength modifier (STR 8: 8, STR 12: 12, STR 16: 16). At least 4. */
export function carrySlots(strength: number): number {
  return Math.max(4, 10 + 2 * modifier(strength));
}

/** Slots an inventory fills. */
export function slotsUsed(inventory: Record<ItemKey, number>): number {
  let slots = 0;
  for (const [key, qty] of Object.entries(inventory)) {
    if (qty <= 0) continue;
    slots += isGear(key) ? qty : Math.ceil(qty / STACK_SIZE);
  }
  return slots;
}

/**
 * Would everything still fit in `slots` after `changes` (item key → quantity
 * added, negative for taken out)? Taking things out always fits.
 */
export function fitsIn(inventory: Record<ItemKey, number>, slots: number, changes: Record<ItemKey, number>): boolean {
  const after = { ...inventory };
  let adding = false;
  for (const [key, qty] of Object.entries(changes)) {
    after[key] = (after[key] ?? 0) + qty;
    if (qty > 0) adding = true;
  }
  return !adding || slotsUsed(after) <= slots;
}

/** fitsIn for someone with only a pack (the player): slots from strength. */
export function fitsAfter(inventory: Record<ItemKey, number>, strength: number, changes: Record<ItemKey, number>): boolean {
  return fitsIn(inventory, carrySlots(strength), changes);
}

/** The player's pack slots, from their strength. */
export function playerSlots(player: { attributes: { strength: number } }): number {
  return carrySlots(player.attributes.strength);
}

/** Would the player's pack fit after `changes`? */
export function playerHasRoom(player: { inventory: Record<ItemKey, number>; attributes: { strength: number } }, changes: Record<ItemKey, number>): boolean {
  return fitsIn(player.inventory, playerSlots(player), changes);
}

/** "5/12 slots" */
export function describeBurden(inventory: Record<ItemKey, number>, slots: number): string {
  return `${slotsUsed(inventory)}/${slots} slots`;
}

/** The slot an item goes in, or null if it isn't gear. */
export function slotFor(keyOrName: string): Slot | null {
  const def = parseItem(keyOrName)?.def;
  if (def?.weapon) return "weapon";
  if (def?.armor !== undefined) return "armor";
  return null;
}

/** Player level needed for gear of a tier (the same steps as quests). */
export function levelForTier(tier: ItemTier): number {
  return QUEST_TIER_MIN_LEVEL[tier];
}

/** The player's rank for gear, from their level. */
export function playerGearRank(level: number): ItemTier {
  return rankForLevel(level);
}

/** Why someone of `rank` can't use this piece, or null if they can. */
export function gearLimit(rank: ItemTier, keyOrName: string, who: "player" | "npc" = "npc"): string | null {
  const item = parseItem(keyOrName);
  if (!item) return `There's no such item as "${keyOrName}".`;
  if (ITEM_TIERS.indexOf(item.tier) <= ITEM_TIERS.indexOf(rank)) return null;
  return who === "player"
    ? `${item.key} is ${item.tier}-tier gear: it needs level ${levelForTier(item.tier)}.`
    : `${item.key} is ${item.tier}-tier gear, above rank ${rank}.`;
}

export interface GearResult {
  ok: boolean;
  message: string;
}

/**
 * Equip a piece from the pack. Whatever was in that slot goes back in the pack
 * (gear for gear, so it always fits). Checks the gear level.
 */
export function equip(holder: Holder, rank: ItemTier, keyOrName: string, who: "player" | "npc" = "npc"): GearResult {
  const key = resolveItem(holder.inventory, keyOrName) ?? keyOrName;
  if (!holder.inventory[key]) return { ok: false, message: `You don't have ${itemLabel(keyOrName)}.` };
  const slot = slotFor(key);
  if (!slot) return { ok: false, message: `${itemLabel(key)} isn't something you can equip.` };
  const limit = gearLimit(rank, key, who);
  if (limit) return { ok: false, message: limit };
  holder.equipment ??= {};
  const old = holder.equipment[slot];
  take(holder.inventory, key);
  if (old) holder.inventory[old] = (holder.inventory[old] ?? 0) + 1;
  holder.equipment[slot] = key;
  return { ok: true, message: `Equipped ${itemLabel(key)}${old ? ` (put away ${itemLabel(old)})` : ""}.` };
}

/** Take off what's in a slot and pack it, if there's room in `slots`. */
export function unequip(holder: Holder, slot: Slot, slots: number): GearResult {
  const key = holder.equipment?.[slot];
  if (!key) return { ok: false, message: `Nothing in your ${slot} slot.` };
  if (!fitsIn(holder.inventory, slots, { [key]: 1 })) return { ok: false, message: `No room in your pack for ${itemLabel(key)}.` };
  holder.inventory[key] = (holder.inventory[key] ?? 0) + 1;
  delete holder.equipment![slot];
  return { ok: true, message: `Put away ${itemLabel(key)}.` };
}

function take(inventory: Record<ItemKey, number>, key: ItemKey): void {
  inventory[key] = (inventory[key] ?? 0) - 1;
  if (inventory[key]! <= 0) delete inventory[key];
}

/** Durability left in a piece (Infinity for things that don't wear). */
export function durabilityOf(key: ItemKey): number {
  return parseItem(key)?.durability ?? Infinity;
}

export function isBroken(key: ItemKey | undefined): boolean {
  return key !== undefined && durabilityOf(key) <= 0;
}

/** What they fight with: the equipped weapon, or fists if there's none or it's broken. */
export function equippedWeapon(holder: Pick<Holder, "equipment">): Weapon {
  const key = holder.equipment?.weapon;
  if (!key || isBroken(key)) return FISTS;
  return weaponFor(key) ?? FISTS;
}

/** Damage the equipped armour takes off each hit: its armour rating, +1 per two tiers above its usual tier. 0 if none or broken. */
export function armorValue(holder: Pick<Holder, "equipment">): number {
  const key = holder.equipment?.armor;
  const item = key ? parseItem(key) : undefined;
  if (!item?.def.armor || isBroken(key)) return 0;
  const above = ITEM_TIERS.indexOf(item.tier) - ITEM_TIERS.indexOf(item.def.tier);
  return item.def.armor + Math.max(0, Math.floor(above / 2));
}

/** A hit's damage after armour: never below 1. */
export function soak(damage: number, holder: Pick<Holder, "equipment">): number {
  return damage > 0 ? Math.max(1, damage - armorValue(holder)) : 0;
}

/**
 * Wear the gear in a slot by `amount`. Returns a line when it breaks, else null.
 * Nothing happens if the slot is empty or already broken.
 */
export function wearGear(holder: Pick<Holder, "equipment">, slot: Slot, amount = 1): string | null {
  const key = holder.equipment?.[slot];
  const item = key ? parseItem(key) : undefined;
  if (!item || item.durability === undefined || item.durability <= 0) return null;
  const left = Math.max(0, item.durability - amount);
  holder.equipment![slot] = itemKey(item.name, item.tier, left);
  return left === 0 ? `${itemLabel(`${item.name} [${item.tier}]`)} broke!` : null;
}

/** The same piece, good as new. */
export function repairedKey(key: ItemKey): ItemKey {
  const item = parseItem(key);
  return item ? itemKey(item.name, item.tier) : key;
}

/** What a smith charges to mend a piece: REPAIR_SHARE of the value it lost. 0 if it isn't worn. */
export function repairCost(key: ItemKey): number {
  const lost = (itemValue(repairedKey(key)) ?? 0) - (itemValue(key) ?? 0);
  return lost > 0 ? Math.max(1, Math.ceil(lost * REPAIR_SHARE)) : 0;
}

/** Mend everything they have equipped (smith NPCs do this for themselves). Returns what was mended. */
export function mendEquipment(holder: Pick<Holder, "equipment">): ItemKey[] {
  const mended: ItemKey[] = [];
  for (const slot of SLOTS) {
    const key = holder.equipment?.[slot];
    if (key && repairCost(key) > 0) {
      holder.equipment![slot] = repairedKey(key);
      mended.push(repairedKey(key));
    }
  }
  return mended;
}

/** Pick the best weapon they're allowed to equip from their pack (for upgrading old saves). */
export function bestAllowedWeapon(inventory: Record<ItemKey, number>, rank: ItemTier): ItemKey | undefined {
  let best: ItemKey | undefined;
  let bestScore = -1;
  for (const [key, qty] of Object.entries(inventory)) {
    const w = qty > 0 && !isBroken(key) ? weaponFor(key) : undefined;
    if (!w || gearLimit(rank, key)) continue;
    const score = (w.die + 1) / 2 + Math.floor(ITEM_TIERS.indexOf(w.tier) / 2);
    if (score > bestScore) {
      best = key;
      bestScore = score;
    }
  }
  return best;
}

export { isGear };
