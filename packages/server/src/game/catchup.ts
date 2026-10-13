import { fadeEmotions } from "../npc/emotions.js";
import { regenNpc } from "./healing.js";
import { statsOf } from "../npc/state.js";
import { traitsOf } from "../npc/traits.js";
import type { NpcPersona, NpcState } from "../npc/types.js";
import { FRESH_NEEDS } from "./needs.js";
import { parseItem } from "./items.js";

/**
 * A place's people after the player was away (N25a decision 3): the same day they would have lived, worked out
 * coarsely instead of hour by hour. Nobody is left mid-meal or mid-task: they have eaten and slept, healed, got
 * over small feelings, lost any finished job, and restocked what their trade runs on (a slice of what they
 * started with, the longer the more). It never moves the clock and never records an event, so catching a place
 * up costs almost nothing however long the player was gone.
 */

export interface Folk {
  id: string;
  persona: NpcPersona;
  state: NpcState;
}

/** Most days of rest and healing that count (a year away heals no more than a month). */
const MAX_DAYS = 30;

/** Bring one person up to date after `days` days (whole). */
export function catchUpOne(m: Folk, days: number): void {
  const { state, persona } = m;
  if (days <= 0 || state.outcome === "dead" || state.dormant) return;
  const n = Math.min(days, MAX_DAYS);
  state.needs = { ...FRESH_NEEDS };
  state.inCombat = false;
  state.job = null;
  state.conversationOver = false;
  if (state.outcome === "fled" || state.outcome === "unconscious" || state.outcome === "player fled") state.outcome = null;
  // Rested: a day's sleep heals more than an hour's, and so on; two days heals everything small.
  for (let h = 0; h < Math.min(n, 3) * 8; h++) regenNpc(persona, state, true);
  if (n >= 2) state.hp = statsOf(persona, state).maxHp;
  fadeEmotions(state, traitsOf(persona, state), n);
  // Restock a tenth of the starting stock a day, up to it (a smith's iron, an innkeeper's ale).
  for (const [key, want] of Object.entries(persona.startingInventory)) {
    const item = parseItem(key);
    if (!item) continue;
    const have = state.inventory[key] ?? 0;
    if (have >= want) continue;
    state.inventory[key] = Math.min(want, have + Math.max(1, Math.ceil((want / 10) * n)));
  }
}

/** Bring a place's people up to date. */
export function catchUp(folk: Folk[], days: number): void {
  for (const m of folk) catchUpOne(m, days);
}
