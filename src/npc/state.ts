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
    socialFailures: { persuade: 0, intimidate: 0 },
    socialFailureDay: 1,
    secretLies: {},
    lastGiftDay: null,
    outcome: null,
    lastCombatNote: null,
    memories: [],
    questBoard: [],
    pendingQuest: null,
    job: null,
    ...overrides,
  };
  // Inventory keys always carry a tier ("dagger" → "dagger [E]").
  state.inventory = normalizeInventory(state.inventory);
  return state;
}

/**
 * A new encounter with an NPC (the game was restarted, or the player came back):
 * whatever ended the last conversation is over. Death is the exception: it's permanent.
 */
export function startEncounter(state: NpcState): void {
  if (state.outcome === "dead") return;
  state.outcome = null;
  state.conversationOver = false;
  state.inCombat = false;
  state.lastCombatNote = null;
  state.provocations = 0;
  state.pendingOffer = null;
  state.pendingPurchase = null;
  state.pendingTraining = null;
  state.pendingQuest = null;
}
