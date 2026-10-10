import type { NpcPersona, NpcState, PlayerState } from "../npc/types.js";
import type { Attributes } from "../npc/stats.js";
import { modifier } from "./dice.js";
import { healAmount, itemLabel, type ItemKey } from "./items.js";

/**
 * Healing. HP and MP come back a little every hour (faster asleep), and healing
 * items restore HP at once. A badly hurt NPC won't trade or teach until healed.
 */

/** Hours everyone counts as asleep, for healing. Until N6 schedules, the same for everyone. */
export function isSleepingHour(hour: number): boolean {
  return hour >= 21 || hour < 6;
}

/** HP and MP regained per hour: a base rate (higher asleep) plus the endurance / willpower modifier, at least 1. */
export function regenPerHour(attributes: Pick<Attributes, "endurance" | "willpower">, asleep: boolean): { hp: number; mp: number } {
  return {
    hp: Math.max(1, (asleep ? 5 : 2) + modifier(attributes.endurance)),
    mp: Math.max(1, (asleep ? 3 : 1) + modifier(attributes.willpower)),
  };
}

/** One hour of rest for an NPC. Nobody heals mid-fight, and the dead stay dead. */
export function regenNpc(persona: NpcPersona, state: NpcState, asleep: boolean): void {
  if (state.outcome === "dead" || state.inCombat) return;
  const rate = regenPerHour(persona.stats.attributes, asleep);
  state.hp = Math.min(persona.stats.maxHp, state.hp + rate.hp);
  state.mp = Math.min(persona.stats.maxMp, state.mp + rate.mp);
}

/** `hours` of rest for the player, starting at `startHour`. The player has no MP yet. */
export function restPlayer(player: PlayerState, startHour: number, hours: number): number {
  const before = player.hp;
  for (let h = 1; h <= hours && player.hp > 0; h++) {
    const rate = regenPerHour(player.attributes, isSleepingHour((startHour + h) % 24));
    player.hp = Math.min(player.maxHp, player.hp + rate.hp);
  }
  return player.hp - before;
}

/** Below half HP an NPC won't trade or teach ("I'm in no state for this") until healed. */
export function isTooHurtToWork(persona: NpcPersona, state: NpcState): boolean {
  return state.hp < persona.stats.maxHp / 2;
}

/** Healing items in an inventory, strongest first. */
export function healingItems(inventory: Record<string, number>): ItemKey[] {
  return Object.keys(inventory)
    .filter((key) => (inventory[key] ?? 0) > 0 && healAmount(key) > 0)
    .sort((a, b) => healAmount(b) - healAmount(a));
}

export interface UseResult {
  ok: boolean;
  healed: number;
  message: string;
}

/** Use up one healing item from `inventory` on `who`. Rechecks everything; changes nothing on failure. */
export function useHealingItem(
  inventory: Record<string, number>,
  who: { hp: number },
  maxHp: number,
  item: ItemKey,
): UseResult {
  const label = itemLabel(item);
  if (!inventory[item]) return { ok: false, healed: 0, message: `No ${label} to use.` };
  const amount = healAmount(item);
  if (amount === 0) return { ok: false, healed: 0, message: `${label} doesn't heal anything.` };
  if (who.hp <= 0) return { ok: false, healed: 0, message: "Too late for that." };
  if (who.hp >= maxHp) return { ok: false, healed: 0, message: "Already at full health." };
  inventory[item] -= 1;
  if (inventory[item] === 0) delete inventory[item];
  const healed = Math.min(amount, maxHp - who.hp);
  who.hp += healed;
  return { ok: true, healed, message: `Used ${label} and healed ${healed} HP (${who.hp}/${maxHp}).` };
}

/** A hurt NPC uses their strongest healing item, if they have one. Returns what happened, or null if nothing. */
export function npcSelfHeal(persona: NpcPersona, state: NpcState): UseResult | null {
  if (state.outcome === "dead" || !isTooHurtToWork(persona, state)) return null;
  const item = healingItems(state.inventory)[0];
  return item ? useHealingItem(state.inventory, state, persona.stats.maxHp, item) : null;
}
