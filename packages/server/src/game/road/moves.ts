import type { Traveller } from "@millbrook/shared";
import type { Realm } from "../realm/types.js";

/**
 * Households that moved between places today (N25's migration), kept until the road makes their journeys (N26).
 * The people are rows that moved at once; on the road they walk the days between, as the same people.
 */
export interface Move {
  day: number;
  from: string;
  to: string;
  kind: "migrants" | "refugees";
  party: Traveller[];
}

const pending = new WeakMap<Realm, Move[]>();

export function recordMove(realm: Realm, m: Move): void {
  const list = pending.get(realm) ?? [];
  list.push(m);
  pending.set(realm, list);
}

/** The moves since last asked. */
export function takeMoves(realm: Realm): Move[] {
  const list = pending.get(realm) ?? [];
  pending.delete(realm);
  return list;
}
