/**
 * Big events (N25b step 6, decision 7): how hard something hits a person's life. Each kind of event has a weight; the
 * impact on a person is the weight times how close they are to it: themselves 1, their household and family 0.8, their
 * close friends and master 0.6, for a town-wide event anyone in the town 1, for a kingdom-wide one the kingdom's people 1.
 * An impact at or above `config.review.shockImpact` (5) is a **shock**: the person is reviewed that day, with the bigger limits.
 * A neighbour's death (0.5 x 9 = 4.5) is not a shock; a friend's (0.6 x 9 = 5.4) is.
 */
export const SHOCK_WEIGHTS = {
  "family-death": 9,
  enslaved: 9,
  war: 8,
  siege: 8,
  famine: 8,
  plague: 8,
  raid: 7,
  attacked: 7,
  robbed: 7,
  "lost-post": 7,
  "ruler-changed": 6,
  wedding: 6,
  birth: 6,
  crackdown: 6,
} as const;
export type ShockKind = keyof typeof SHOCK_WEIGHTS;

export const CLOSENESS = { self: 1, family: 0.8, friend: 0.6, master: 0.6, neighbour: 0.5, kingdom: 0.3, scope: 1 } as const;

export interface Shock {
  /** Cited by the review that follows ("s:<kind>:<where>:<day>"). */
  ref: string;
  kind: ShockKind;
  /** A plain third-person sentence. */
  text: string;
  day: number;
  /** "person": it happened to `victims`. "town": to a place. "kingdom": to everyone in a kingdom. */
  scope: "person" | "town" | "kingdom";
  site?: string;
  kingdom?: string | null;
  /** For a personal event: who it happened to (persona ids or townsperson ids). */
  victims: string[];
}

/** Who a person is, for working out how close an event is. */
export interface Closeness {
  /** Every id they go by (persona id, townsperson id, figure id). */
  ids: string[];
  site: string;
  kingdom: string | null;
  /** Household and close family. */
  family: ReadonlySet<string>;
  /** Close friends and their master. */
  friends: ReadonlySet<string>;
}

/** How hard a shock hits one person (0 if it doesn't touch them). */
export function impactOn(shock: Shock, who: Closeness): number {
  const w = SHOCK_WEIGHTS[shock.kind];
  if (shock.scope === "town") return who.site === shock.site ? w * CLOSENESS.scope : 0;
  if (shock.scope === "kingdom") return who.kingdom !== null && who.kingdom === shock.kingdom ? w * CLOSENESS.scope : who.site === shock.site ? w * CLOSENESS.scope : 0;
  const mine = who.ids.some((id) => shock.victims.includes(id));
  if (mine) return w * CLOSENESS.self;
  if (shock.victims.some((v) => who.family.has(v))) return w * CLOSENESS.family;
  if (shock.victims.some((v) => who.friends.has(v))) return w * CLOSENESS.friend;
  if (shock.site !== undefined && who.site === shock.site) return w * CLOSENESS.neighbour;
  return 0;
}
