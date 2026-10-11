import { type Rng, rollDie } from "./dice.js";

/**
 * Status effects (N8): bleeding, stunned, weakened, and a raised guard. Each lasts
 * a few turns, is applied and ticked in code, and reaches the model only as words
 * ("you're bleeding"). Shared by NPCs, the player and creatures.
 */
export const STATUS_KINDS = ["bleeding", "stunned", "weakened", "guarding"] as const;
export type StatusKind = (typeof STATUS_KINDS)[number];

export interface StatusEffect {
  kind: StatusKind;
  /** Turns left, counted down at the start of the holder's turn. */
  turns: number;
  /** Bleeding: damage die per turn. */
  power?: number;
}

export interface HasStatuses {
  statuses?: StatusEffect[];
  hp: number;
}

/** Damage and to-hit lost while weakened. */
export const WEAKENED_PENALTY = 2;

/** Add (or refresh) a status: the longer duration and the stronger power win. */
export function applyStatus(holder: HasStatuses, kind: StatusKind, turns: number, power?: number): void {
  const list = (holder.statuses ??= []);
  const had = list.find((s) => s.kind === kind);
  if (had) {
    had.turns = Math.max(had.turns, turns);
    if (power !== undefined) had.power = Math.max(had.power ?? 0, power);
    return;
  }
  list.push({ kind, turns, ...(power !== undefined ? { power } : {}) });
}

export function hasStatus(holder: Pick<HasStatuses, "statuses">, kind: StatusKind): boolean {
  return (holder.statuses ?? []).some((s) => s.kind === kind && s.turns > 0);
}

/** Drop a status at once (a guard used up by a blow). */
export function clearStatus(holder: Pick<HasStatuses, "statuses">, kind: StatusKind): void {
  if (holder.statuses) holder.statuses = holder.statuses.filter((s) => s.kind !== kind);
}

/**
 * The start of the holder's turn: bleeding hurts (never below 1 HP: it weakens, it
 * doesn't finish anyone), and every status counts down. Returns whether they lose
 * this turn (stunned) and lines for the log.
 */
export function tickStatuses(holder: HasStatuses, name: string, rng: Rng): { skip: boolean; log: string[] } {
  const log: string[] = [];
  let skip = false;
  for (const s of holder.statuses ?? []) {
    if (s.turns <= 0) continue;
    if (s.kind === "bleeding") {
      const dmg = Math.min(Math.max(0, holder.hp - 1), rollDie(rng, s.power ?? 3));
      holder.hp -= dmg;
      if (dmg > 0) log.push(`${name} bleeds for ${dmg}.`);
    }
    if (s.kind === "stunned") {
      skip = true;
      log.push(`${name} is stunned and loses the turn.`);
    }
    if (s.kind !== "guarding") s.turns -= 1;
  }
  holder.statuses = (holder.statuses ?? []).filter((s) => s.turns > 0);
  return { skip, log };
}

/** A blow that lands on a guarded holder is halved, and the guard is spent. */
export function guardedDamage(holder: Pick<HasStatuses, "statuses">, damage: number): number {
  if (!hasStatus(holder, "guarding")) return damage;
  clearStatus(holder, "guarding");
  return Math.floor(damage / 2);
}

/** Statuses in words, for the situation block: "bleeding, stunned". Null when none. */
export function describeStatuses(holder: Pick<HasStatuses, "statuses">): string | null {
  const words: Record<StatusKind, string> = { bleeding: "bleeding", stunned: "stunned", weakened: "weakened", guarding: "on guard" };
  const active = (holder.statuses ?? []).filter((s) => s.turns > 0).map((s) => words[s.kind]);
  return active.length > 0 ? active.join(", ") : null;
}

/** Fights over: statuses wear off. */
export function clearStatuses(holder: Pick<HasStatuses, "statuses">): void {
  holder.statuses = [];
}
