import { adjust } from "../npc/relationship.js";
import type { NpcState, PlayerState } from "../npc/types.js";
import type { GameEvent, EventKind } from "./events.js";
import { TITLES } from "./titles.js";

/**
 * Reputation (N7): how the town sees the player, one score per axis, built from
 * what people saw and heard. Every time an NPC first learns of something the
 * player did (as a witness, or through gossip), a share of its weight goes into the
 * town's view. Strangers start from it: a player known for violence meets wary
 * faces, one known for good work meets warmer ones. All in code.
 */
export type Reputation = NonNullable<PlayerState["reputation"]>;
export const NO_REPUTATION: Reputation = { trust: 0, fear: 0, respect: 0, affection: 0 };

/** What each kind of deed by the player does to the town's view, per NPC who learns of it. */
export const IMPACT: Partial<Record<EventKind, Partial<Reputation>>> = {
  attacked: { trust: -8, fear: 6, affection: -6 },
  killed: { trust: -15, fear: 15, affection: -10, respect: -4 },
  subdued: { trust: -4, fear: 8, respect: 2 },
  looted: { trust: -6, affection: -3 },
  "theft-caught": { trust: -10, affection: -4, respect: -3 },
  threatened: { trust: -2, fear: 3 },
  insulted: { affection: -1 },
  "lie-found-out": { trust: -4 },
  "lie-spotted": { trust: -2 },
  "promise-broken": { trust: -3 },
  "promise-kept": { trust: 2 },
  "quest-done": { trust: 2, respect: 4, affection: 2 },
  "quest-failed": { respect: -2 },
  gift: { affection: 1 },
  amends: { trust: 2 },
  "fine-paid": { trust: 3 },
  "raid-repelled": { trust: 4, respect: 6, affection: 3 },
  dilemma: {},
};

/** Share of an event's weight added per NPC who learns of it. */
export const LEARNER_SHARE = 0.5;

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/** An NPC just learned of an event: if the player did it, the town's view moves. */
export function townLearns(player: PlayerState, event: Pick<GameEvent, "actor" | "kind">, scale = 1): void {
  if (event.actor !== "player") return;
  const impact = IMPACT[event.kind];
  if (!impact) return;
  const rep = (player.reputation ??= { ...NO_REPUTATION });
  for (const [axis, v] of Object.entries(impact) as Array<[keyof Reputation, number]>) {
    rep[axis] = axis === "fear" ? clamp(rep[axis] + v * LEARNER_SHARE * scale, 0, 100) : clamp(rep[axis] + v * LEARNER_SHARE * scale, -100, 100);
    rep[axis] = Math.round(rep[axis] * 10) / 10;
  }
}

/** Every witness of a new event learns it at once. Call after recordEvent. */
export function witnessesLearn(player: PlayerState, event: GameEvent): void {
  for (const _ of event.witnesses ?? []) townLearns(player, event);
}

/** Respect a stranger gives for the player's deed titles: Giant-slayer, Veteran... */
export function titleRespect(player: PlayerState): number {
  return (player.titles ?? []).filter((t) => "bonus" in TITLES[t.id]).length * 5;
}

/**
 * A stranger meets the player: their starting feelings come from the town's view
 * (half of it), plus respect for any titles. Once per NPC.
 */
export function firstImpression(state: NpcState, player: PlayerState, day: number): boolean {
  if (state.metBefore || state.triggerDay["reputation"] !== undefined) return false;
  const rep = player.reputation ?? NO_REPUTATION;
  // Nothing said about them yet: nothing to colour the meeting (and nothing to mark).
  if (Object.values(rep).every((v) => Math.round(v / 2) === 0) && titleRespect(player) === 0) return false;
  state.triggerDay["reputation"] = day;
  adjust(state, "trust", Math.round(rep.trust / 2));
  adjust(state, "fear", Math.round(rep.fear / 2));
  adjust(state, "respect", Math.round(rep.respect / 2) + titleRespect(player));
  adjust(state, "affection", Math.round(rep.affection / 2));
  return true;
}

/** How the town sees the player, in words (for the player and for strangers' situations), or null if unremarkable. */
export function describeReputation(rep: Reputation | undefined): string | null {
  if (!rep) return null;
  const parts: string[] = [];
  if (rep.fear >= 20) parts.push("feared");
  if (rep.trust <= -15) parts.push("not to be trusted");
  else if (rep.trust >= 15) parts.push("trustworthy");
  if (rep.respect >= 15) parts.push("capable");
  if (rep.affection >= 15) parts.push("well liked");
  else if (rep.affection <= -15) parts.push("disliked");
  return parts.length > 0 ? parts.join(", ") : null;
}
