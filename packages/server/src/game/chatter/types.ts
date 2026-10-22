import type { InteractionKind } from "@millbrook/shared";

export { HOSTILE, INTERACTIONS, isInteraction, type InteractionKind } from "@millbrook/shared";

/** One exchange between two people (N37): `a` did it to `b`. */
export interface Interaction {
  a: string;
  b: string;
  kind: InteractionKind;
  day: number;
  /** Minute of the day, for an exchange on the player's map; -1 where it only happened that day. */
  minute: number;
  site: string;
  /** Who else saw it. */
  witnesses: string[];
  /** The event it left behind (a hostile exchange is one), once applied. */
  event?: string;
  /** What kind of place it was in (the inn is where drink makes tempers worse). */
  venue?: string;
}

/** The four feelings a relationship row keeps (the same as a talker's: npc/relationship.ts). */
export interface Axes {
  trust: number;
  affection: number;
  respect: number;
  fear: number;
}

export const NO_AXES: Axes = { trust: 0, affection: 0, respect: 0, fear: 0 };
