import type { EventKind } from "../events.js";
import type { Axes, InteractionKind } from "./types.js";

/**
 * What each kind of exchange does (N37). `target` changes the target's view of the actor, `actor` the actor's view of the target
 * (both on the four axes), `grievance` is the weight of the grievance it leaves the target against the actor (scaled by who they are:
 * game/chatter/apply.ts), and `event` is how it is remembered, if it is.
 *
 * Plain courtesy leaves no event and no grievance; every wrong leaves both.
 */
export interface Effect {
  target: Partial<Axes>;
  actor: Partial<Axes>;
  grievance: number;
  event: { kind: EventKind; importance: number } | null;
}

export const EFFECTS: Record<InteractionKind, Effect> = {
  greet: { target: { trust: 0.5, affection: 0.5 }, actor: { affection: 0.3 }, grievance: 0, event: null },
  bow: { target: { respect: 0.3 }, actor: { fear: 0.4, respect: 0.2 }, grievance: 0, event: null },
  // A person who will not bow to someone who expects it: the higher one is offended, the lower has made their feeling known.
  refuse_bow: { target: { respect: -6, affection: -3, trust: -2 }, actor: { respect: -2, fear: 1 }, grievance: 0.15, event: { kind: "slight", importance: 2 } },
  sneer: { target: { respect: -3, affection: -3, trust: -1 }, actor: { respect: -1 }, grievance: 0.07, event: { kind: "slight", importance: 1 } },
  insult: { target: { respect: -6, affection: -8, trust: -4 }, actor: { respect: -2, affection: -2 }, grievance: 0.25, event: { kind: "affront", importance: 2 } },
  humiliate: { target: { respect: -12, affection: -14, trust: -8, fear: 4 }, actor: { respect: -4, affection: -4 }, grievance: 0.5, event: { kind: "affront", importance: 4 } },
  order: { target: { affection: -0.3 }, actor: { respect: 0.5 }, grievance: 0, event: null },
  // A servant or slave who will not do as they are told.
  refuse_order: { target: { respect: -6, trust: -4, affection: -3 }, actor: { respect: -2, fear: 2 }, grievance: 0.2, event: { kind: "slight", importance: 2 } },
  complain: { target: { affection: -0.5 }, actor: { trust: 0.5 }, grievance: 0, event: null },
  share_news: { target: { trust: 1.5, affection: 1 }, actor: { trust: 1, affection: 1 }, grievance: 0, event: null },
  flatter: { target: { affection: 2, respect: 0.5 }, actor: { respect: 0.3 }, grievance: 0, event: null },
  threaten: { target: { fear: 10, trust: -8, affection: -6 }, actor: { respect: -3, trust: -2 }, grievance: 0.4, event: { kind: "menace", importance: 3 } },
  // Amends: the feelings it earns, and the grievance it eases (apply.ts).
  apologise: { target: { trust: 4, affection: 4, respect: 1 }, actor: { affection: 1 }, grievance: 0, event: { kind: "apology", importance: 1 } },
};

/** How much of the target's grievance against the actor an apology takes away. */
export const AMENDS_SHARE = 0.7;
