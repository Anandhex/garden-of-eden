import { carrySlots, fitsIn } from "../game/gear.js";
import { itemKey, normalizeInventory } from "../game/items.js";
import { type Challenge, createLife, effectiveStats, gainXp, type LifeContext, overcome, TIERS, tierIndex, upgradeLife } from "../game/life.js";
import { speciesOf } from "../world/species.js";
import { FRESH_NEEDS } from "../game/needs.js";
import type { NpcStats } from "./stats.js";
import type { NpcPersona, NpcState } from "./types.js";
import type { Skills } from "./skills.js";
import { authoredRelations } from "./social.js";
import { freshGrowth, grownSkills, upgradeGrowth } from "./growth.js";
import { injuredAttributes, injuredSkills, type InjuryId, INJURIES } from "../game/health.js";

/** What the NPC's growth depends on: species and authored stats. (Their potential is in their life.) */
export function lifeContext(persona: NpcPersona): LifeContext {
  return { species: speciesOf(persona.species), base: persona.stats };
}

/**
 * The NPC's stats right now: authored stats plus rank growth and age (game/life.ts),
 * attribute milestones (npc/growth.ts), less injuries and illness (game/health.ts).
 * Use this, not persona.stats, in rules.
 */
export function statsOf(persona: NpcPersona, state: Pick<NpcState, "life"> & Partial<Pick<NpcState, "growth" | "injuries" | "illness">>): NpcStats {
  const stats = effectiveStats(persona.stats, state.life);
  const grown = state.growth?.attributes;
  const attributes = { ...stats.attributes };
  if (grown) for (const [a, d] of Object.entries(grown) as Array<[keyof typeof attributes, number]>) attributes[a] = Math.min(20, attributes[a] + d);
  return { ...stats, attributes: injuredAttributes(attributes, state) };
}

/** The NPC's skills right now: the file's, plus growth, less injuries. Use this, not persona.skills, in rules. */
export function npcSkills(persona: Pick<NpcPersona, "skills">, state?: Partial<Pick<NpcState, "growth" | "injuries">> | null): Skills {
  if (!state) return persona.skills;
  return injuredSkills(grownSkills(persona.skills, state.growth), state);
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
    moodHours: 0,
    relationship: 0,
    fear: 0,
    respect: 0,
    affection: 0,
    romanceStage: 0,
    knownName: null,
    nameSource: null,
    metBefore: false,
    lastMetDay: null,
    noticed: null,
    wonCheckDay: {},
    grudge: null,
    pendingAmends: null,
    emotions: [],
    beliefs: [],
    commitments: [],
    owedFavours: [],
    pendingFavour: null,
    keptForPlayer: {},
    pendingService: null,
    commission: null,
    needs: { ...FRESH_NEEDS },
    activity: null,
    tipsyUntil: null,
    goodDay: null,
    initiative: {},
    triggerDay: {},
    lastGiftReceivedDay: null,
    vouchedDay: {},
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
    npcRelations: authoredRelations(persona),
    rumours: {},
    pendingDilemma: null,
    dilemmasDone: {},
    statuses: [],
    injuries: (persona.injuries ?? []).filter((id): id is InjuryId => id in INJURIES).map((id) => ({ id, day, daysLeft: INJURIES[id].days })),
    illness: null,
    unconsciousUntil: null,
    companion: null,
    pendingHire: null,
    pendingCommission: null,
    growth: freshGrowth(),
    arcs: {},
    goals: [],
    plan: null,
    dormant: persona.successorOf !== undefined,
    learned: {},
    ...overrides,
    life,
  };
  // Saves from before these fields: fill in what's missing.
  state.npcRelations = { ...authoredRelations(persona), ...(overrides.npcRelations ?? {}) };
  state.growth = upgradeGrowth(overrides.growth);
  state.statuses ??= [];
  state.injuries ??= [];
  state.rumours ??= {};
  state.learned ??= {};
  state.goals ??= [];
  state.arcs ??= {};
  state.dilemmasDone ??= {};
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
  state.pendingFavour = null;
  state.pendingService = null;
  state.pendingAmends = null;
  // They'll remark on how the player looks afresh.
  state.noticed = null;
  state.statuses = [];
  state.pendingDilemma = null;
  state.pendingHire = null;
  state.pendingCommission = null;
}
