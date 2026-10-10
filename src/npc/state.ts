import { normalizeInventory } from "../game/items.js";
import type { NpcPersona, NpcState } from "./types.js";

/** A fresh NPC at the start of a conversation. */
export function createNpcState(persona: NpcPersona, overrides: Partial<NpcState> = {}): NpcState {
  const state: NpcState = {
    mood: "neutral",
    relationship: 0,
    hp: persona.stats.maxHp,
    mp: persona.stats.maxMp,
    inventory: { ...persona.startingInventory },
    gold: persona.startingGold,
    following: false,
    conversationOver: false,
    pendingOffer: null,
    pendingPurchase: null,
    pendingTraining: null,
    revealedSecrets: [],
    debts: Object.fromEntries((persona.debts ?? []).map((d) => [d.id, d.amount])),
    provocations: 0,
    inCombat: false,
    discountPct: 0,
    failedHaggles: 0,
    outcome: null,
    lastCombatNote: null,
    questBoard: [],
    pendingQuest: null,
    job: null,
    ...overrides,
  };
  // Inventory keys always carry a tier ("dagger" → "dagger [E]").
  state.inventory = normalizeInventory(state.inventory);
  return state;
}
