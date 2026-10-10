import { carrySlots, fitsIn } from "../game/gear.js";
import { itemKey, normalizeInventory } from "../game/items.js";
import { type Challenge, createLife, effectiveStats, gainXp, type LifeContext, overcome, TIERS, tierIndex, upgradeLife } from "../game/life.js";
import { speciesOf } from "../world/species.js";
import type { NpcStats } from "./stats.js";
import type { NpcPersona, NpcState } from "./types.js";

/** What the NPC's growth depends on: species and authored stats. (Their potential is in their life.) */
export function lifeContext(persona: NpcPersona): LifeContext {
  return { species: speciesOf(persona.species), base: persona.stats };
}

/** The NPC's stats right now: authored stats plus rank growth and age (game/life.ts). Use this, not persona.stats, in rules. */
export function statsOf(persona: NpcPersona, state: Pick<NpcState, "life">): NpcStats {
  return effectiveStats(persona.stats, state.life);
}

/** Slots of goods the NPC can keep: their pack (from strength) plus any storage (a shopkeeper's chest or bag). */
export function npcSlots(persona: NpcPersona, state: Pick<NpcState, "life">): number {
  return carrySlots(statsOf(persona, state).attributes.strength) + (persona.storage?.slots ?? 0);
}

/** Would the NPC have room after `changes` (item key → quantity, negative for taken out)? */
export function npcHasRoom(persona: NpcPersona, state: NpcState, changes: Record<string, number>): boolean {
  return fitsIn(state.inventory, npcSlots(persona, state), changes);
}

/** Give the NPC XP. Returns a line for the log if it made them ready for a breakthrough, else null. */
export function npcGainXp(persona: NpcPersona, state: NpcState, xp: number): string | null {
  if (state.outcome === "dead") return null;
  if (!gainXp(state.life, lifeContext(persona), xp)) return null;
  return `${persona.name} is ready for a breakthrough to rank ${TIERS[tierIndex(state.life.tier) + 1]}.`;
}

/**
 * The NPC got through a challenge (a fight won, a fine piece made): titles, and
 * a breakthrough to the next rank if they were ready. A breakthrough is something
 * they remember. Returns lines for the log.
 */
export function npcOvercome(persona: NpcPersona, state: NpcState, challenge: Challenge, day: number): string[] {
  if (state.outcome === "dead") return [];
  const result = overcome(persona.name, state.life, lifeContext(persona), challenge, day);
  if (result.rose) {
    state.memories.push({
      id: `rank-${result.rose}`,
      day,
      text: `On day ${day} you broke through to rank ${result.rose} by ${challenge.what.replace(persona.name, "yourself")}.`,
    });
  }
  return result.log;
}

/**
 * A fresh NPC at the start of a conversation. `day` is the world day it's made on,
 * so a new NPC is `persona.age` years old that day.
 */
export function createNpcState(persona: NpcPersona, overrides: Partial<NpcState> = {}, day = 1): NpcState {
  const fresh = createLife(speciesOf(persona.species), persona.age, persona.tier, day, persona.potential);
  const life = overrides.life ? upgradeLife(overrides.life, fresh) : fresh;
  const stats = effectiveStats(persona.stats, life);
  const state: NpcState = {
    mood: "neutral",
    relationship: 0,
    hp: stats.maxHp,
    mp: stats.maxMp,
    inventory: { ...persona.startingInventory },
    money: persona.startingMoney,
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
    deathCause: null,
    equipment: {
      weapon: itemKey(persona.weapon),
      ...(persona.armor ? { armor: itemKey(persona.armor) } : {}),
    },
    ...overrides,
    life,
  };
  // A save from before ranks and ages may hold more HP than an older body now allows.
  state.hp = Math.min(state.hp, stats.maxHp);
  state.mp = Math.min(state.mp, stats.maxMp);
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
