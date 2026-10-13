import type { NpcPersona, NpcState } from "./types.js";

/**
 * The social web (N7): how NPCs feel about each other, on the same four axes they
 * use for the player (npc/relationship.ts). Written in each NPC file as a starting
 * point (`relationships`), then moved by what happens: gossip from a friend counts
 * for more, a friend being hurt by the player hurts, a supper bought warms a little.
 * All in code; the model only ever sees words ("Mara is a good friend of yours").
 */
export interface RelationAxes {
  trust: number;
  fear: number;
  respect: number;
  affection: number;
}

export const NO_RELATION: RelationAxes = { trust: 0, fear: 0, respect: 0, affection: 0 };

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/** The starting relations from an NPC file, every axis filled in. */
export function authoredRelations(persona: Pick<NpcPersona, "relationships">): Record<string, RelationAxes> {
  return Object.fromEntries(Object.entries(persona.relationships ?? {}).map(([id, r]) => [id, { ...NO_RELATION, ...r }]));
}

/** How `state`'s NPC feels about another NPC (strangers are all zeros). */
export function relationTo(state: Pick<NpcState, "npcRelations">, other: string): RelationAxes {
  return state.npcRelations?.[other] ?? NO_RELATION;
}

/** Move one axis of how this NPC feels about another. */
export function adjustRelation(state: Pick<NpcState, "npcRelations">, other: string, axis: keyof RelationAxes, delta: number): void {
  const r = (state.npcRelations[other] ??= { ...NO_RELATION });
  r[axis] = axis === "fear" ? clamp(r[axis] + delta, 0, 100) : clamp(r[axis] + delta, -100, 100);
}

/** Friends: affection and trust both well up. Their news counts for more, and harm to them is felt. */
export const FRIEND_AFFECTION = 30;
export function isFriend(state: Pick<NpcState, "npcRelations">, other: string): boolean {
  const r = relationTo(state, other);
  return r.affection >= FRIEND_AFFECTION && r.trust >= 0;
}

/** Enemies: they believe the worst of each other, and are glad of the other's misfortune. */
export function isEnemy(state: Pick<NpcState, "npcRelations">, other: string): boolean {
  const r = relationTo(state, other);
  return r.affection <= -30 || r.trust <= -40;
}

/**
 * How much a listener believes what a speaker tells them, 0.2..1: trust in them,
 * nudged by liking. Gossip from a friend lands harder than gossip from a stranger.
 */
export function credence(listener: Pick<NpcState, "npcRelations">, speaker: string): number {
  const r = relationTo(listener, speaker);
  return clamp(0.6 + r.trust / 200 + r.affection / 400, 0.2, 1);
}

/** "a good friend", "someone you're wary of": how this NPC sees another, in words, or null if unremarkable. */
export function describeRelation(r: RelationAxes): string | null {
  const parts: string[] = [];
  if (r.affection >= 60) parts.push("a dear friend");
  else if (r.affection >= FRIEND_AFFECTION) parts.push("a friend");
  else if (r.affection <= -30) parts.push("someone you dislike");
  if (r.fear >= 40) parts.push("someone you're afraid of");
  else if (r.fear >= 20) parts.push("someone you're wary of");
  if (r.trust <= -40) parts.push("not to be trusted");
  if (r.respect >= 40) parts.push("someone you look up to");
  else if (r.respect <= -30) parts.push("someone you look down on");
  return parts.length > 0 ? parts.join(", ") : null;
}

/** One situation line about the NPCs here, or null: "Old Odo is here: a friend." */
export function describePresentRelations(state: Pick<NpcState, "npcRelations">, present: Array<{ id: string; name: string }>): string | null {
  const lines = present.flatMap((p) => {
    const words = describeRelation(relationTo(state, p.id));
    return words ? [`${p.name} (${words})`] : [];
  });
  return lines.length > 0 ? `Here with you: ${lines.join("; ")}.` : null;
}
