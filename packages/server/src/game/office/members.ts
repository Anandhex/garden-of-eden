import type { FactionKind, Realm, RealmFaction } from "../realm/types.js";

/**
 * Members are figures and rows (N69 decision 5). A faction's named members are figures in `members`; townsfolk sworn to it are
 * `people` rows with `faction` set, counted each day from the store into `fac.rows` (a riser is counted once, as the figure). Income,
 * the minimum, ranks and prestige read `memberCount`.
 */
export function memberCount(realm: Realm, fac: Pick<RealmFaction, "members" | "rows">): number {
  return fac.members.filter((m) => realm.figures[m]?.alive).length + (fac.rows ?? 0);
}

/** Factions that must be chartered and must keep a minimum: guilds, associations, orders and cults. */
export const CHARTERED: ReadonlySet<FactionKind> = new Set(["guild", "association", "order", "cult"]);

/** Members a guild-like faction needs (decision 5): three, and one more for each size of its seat above a village. */
export function minMembers(realm: Realm, fac: Pick<RealmFaction, "kind" | "seat">): number {
  if (fac.kind === "crown") return 0;
  const kind = fac.seat ? realm.settlements[fac.seat]?.kind : undefined;
  return 3 + (kind === "town" ? 1 : kind === "city" ? 2 : kind === "capital" ? 3 : 0);
}
