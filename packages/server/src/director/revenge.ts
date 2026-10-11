import { remember } from "../npc/memory.js";
import { setGrudge } from "../npc/relationship.js";
import { provokeLimit, traitsOf } from "../npc/traits.js";
import type { NpcPersona, NpcState, WorldSnapshot } from "../npc/types.js";
import { recordEvent } from "../game/events.js";
import { factionOf } from "../game/factions.js";
import type { SpawnRule } from "../game/spawning.js";
import { hearRumour } from "../game/rumours.js";

/**
 * Revenge and grudges as goals (N12.2). Being attacked, robbed or humiliated gives
 * an NPC a revenge goal, in code, with a strength that fades at their forgiveness.
 * Their traits decide what they do with it, the next night:
 * - a gang leader sends men to ambush the player (a spawn rule, game/spawning.ts);
 * - the brave and hot-tempered confront them (an opening line, and their patience gone);
 * - the dishonest spread a lie about them (a rumour that travels by gossip);
 * - anyone else refuses to deal with them for a while.
 * Making amends (npc/relationship.ts settleGrudge) clears it.
 */
export const REVENGE_PLANS = ["ambush", "confront", "rumour", "refuse"] as const;
export type RevengePlan = (typeof REVENGE_PLANS)[number];

export interface NpcGoal {
  kind: "revenge";
  target: "player";
  /** 0..1. Fades nightly by forgiveness; below FADED it's dropped. */
  strength: number;
  reason: string;
  day: number;
  plan: RevengePlan;
  /** Day they acted on it, once. */
  acted?: number;
  /** The event behind it. */
  event?: string;
}

/** Strength by what was done. */
export const REVENGE_STRENGTH = { attacked: 0.8, robbed: 0.6, humiliated: 0.4 } as const;
/** Below this a goal is forgotten. */
export const FADED = 0.15;
/** At least this strong and they act on it. */
export const ACT_AT = 0.3;

/** What they'd do about it, decided by who they are. */
export function chooseRevenge(persona: NpcPersona, state?: NpcState): RevengePlan {
  const t = traitsOf(persona, state);
  if (factionOf({ persona })?.id === "bandits" && t.bravery >= 0.5) return "ambush";
  if (t.bravery >= 0.5 && t.temper >= 0.5) return "confront";
  if (t.honesty < 0.4) return "rumour";
  return "refuse";
}

/** Something was done to them: a revenge goal (or a stronger one). Very forgiving NPCs take it half as hard. */
export function wantRevenge(persona: NpcPersona, state: NpcState, what: keyof typeof REVENGE_STRENGTH, reason: string, day: number, event?: string): NpcGoal {
  const t = traitsOf(persona, state);
  const strength = Math.min(1, REVENGE_STRENGTH[what] * (t.forgiveness >= 0.8 ? 0.5 : 1));
  const had = state.goals.find((g) => g.kind === "revenge");
  if (had) {
    had.strength = Math.min(1, Math.max(had.strength, strength) + 0.1);
    had.reason = reason;
    delete had.acted;
    return had;
  }
  const goal: NpcGoal = { kind: "revenge", target: "player", strength, reason, day, plan: chooseRevenge(persona, state), ...(event ? { event } : {}) };
  state.goals.push(goal);
  return goal;
}

/** A night passes: revenge cools, faster for the forgiving. */
export function fadeRevenge(persona: NpcPersona, state: NpcState): void {
  const t = traitsOf(persona, state);
  for (const g of state.goals) g.strength = Math.round((g.strength - (0.05 + 0.25 * t.forgiveness)) * 100) / 100;
  state.goals = state.goals.filter((g) => g.strength >= FADED);
}

/** Amends made: revenge is off. */
export function forgive(state: NpcState): void {
  state.goals = state.goals.filter((g) => g.kind !== "revenge");
}

export interface RevengeAct {
  npc: string;
  plan: RevengePlan;
  log: string[];
  /** For an ambush: the spawn rule to add (world.extraSpawnRules). */
  spawn?: SpawnRule;
}

/** Hours an ambush waits for the player. */
export const AMBUSH_DAYS = 2;

/**
 * Midnight: act on a revenge goal strong enough, once. Returns what they did, or null.
 * The caller adds any spawn rule to the world.
 */
export function actOnRevenge(persona: NpcPersona, state: NpcState, world: WorldSnapshot): RevengeAct | null {
  if (state.outcome === "dead" || state.dormant) return null;
  const goal = state.goals.find((g) => g.kind === "revenge" && g.acted === undefined && g.strength >= ACT_AT);
  if (!goal) return null;
  goal.acted = world.day;
  const t = traitsOf(persona, state);
  const player = world.player;
  const log: string[] = [];
  let spawn: SpawnRule | undefined;
  switch (goal.plan) {
    case "ambush": {
      spawn = { id: `revenge_${persona.id}_${world.day}`, creature: "bandit", count: 2, place: "road_ambush", hours: [6, 21], untilDay: world.day + AMBUSH_DAYS, ambush: true };
      log.push(`${persona.name} has sent men to settle the score with you.`);
      remember(state, { id: `revenge-${world.day}`, day: world.day, text: `you sent your men after them for what they did: ${goal.reason}`, importance: 6, valence: -1 }, t);
      break;
    }
    case "confront": {
      // Their patience is gone: one more slight and they'll fight. They'll say so first (npc/initiative.ts).
      state.provocations = Math.max(state.provocations, provokeLimit(t) - 1);
      state.mood = "angry";
      remember(state, { id: `revenge-${world.day}`, day: world.day, text: `you mean to have it out with them: ${goal.reason}`, importance: 6, valence: -1 }, t);
      log.push(`${persona.name} means to have it out with you.`);
      break;
    }
    case "rumour": {
      hearRumour(state, { about: "player", fact: `revenge_${persona.id}_${world.day}`, text: `${player.name} is a thief and a liar who can't be trusted`, truth: "false", accuracy: 1, day: world.day });
      log.push(`${persona.name} has started telling tales about you.`);
      break;
    }
    case "refuse": {
      setGrudge(state, t, goal.reason, world.day);
      log.push(`${persona.name} wants nothing more to do with you.`);
      break;
    }
  }
  recordEvent(world, { kind: "revenge", actor: persona.id, target: "player", details: `${goal.plan}: ${goal.reason}`, importance: 6, witnesses: [] });
  return { npc: persona.id, plan: goal.plan, log, ...(spawn ? { spawn } : {}) };
}

/** For their situation: what they mean to do about the player, or null. */
export function describeRevenge(state: NpcState): string | null {
  const g = state.goals.find((x) => x.kind === "revenge" && x.strength >= ACT_AT);
  if (!g) return null;
  const how: Record<RevengePlan, string> = {
    ambush: "you've a mind to have your men teach them a lesson",
    confront: "you mean to have it out with them, face to face",
    rumour: "you'd like the whole village to know what they're really like",
    refuse: "you want nothing to do with them",
  };
  return `You want revenge on them (${g.reason}): ${how[g.plan]}.`;
}
