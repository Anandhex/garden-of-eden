import type { KnownEntry, PlayerState } from "../npc/types.js";

/**
 * What the player knows of the wider world (N24 step 1, built with N33): one map, `player.known`, from a ref to when and how they
 * learned it. The player's feed, journal and map only ever show what is here (plans README section 3); a person is
 * never told something the player does not know by a player-facing function reading the truth.
 *
 * Refs are the ones gossip uses (game/gossip/refs.ts): `n:<realmNewsId>`, `d:<personId>` (a death), `e:<eventId>`.
 * The map is capped: the oldest entries go first.
 */
export const KNOWN_MAX = 400;

export const playerKnows = (player: Pick<PlayerState, "known">, ref: string): boolean => !!player.known?.[ref];

/** The day they first learned it, or null. */
export const knownSince = (player: Pick<PlayerState, "known">, ref: string): number | null => player.known?.[ref]?.day ?? null;

export const knownEntry = (player: Pick<PlayerState, "known">, ref: string): KnownEntry | null => player.known?.[ref] ?? null;

/**
 * The player learns something. Returns true if it is new to them, or a better version than they had (more accurate); the day they first
 * learned it stands.
 */
export function playerLearns(player: Pick<PlayerState, "known">, ref: string, how: KnownEntry["how"], day: number, extra: Partial<Pick<KnownEntry, "from" | "accuracy" | "variant" | "text">> = {}): boolean {
  const known = (player.known ??= {});
  const had = known[ref];
  const accuracy = extra.accuracy ?? (how === "told" ? 0.8 : 1);
  if (had && (had.accuracy ?? 1) >= accuracy) return false;
  known[ref] = { day: had?.day ?? day, how: had && had.how === "saw" ? "saw" : how, ...extra, accuracy, variant: extra.variant ?? 0 };
  const refs = Object.keys(known);
  if (refs.length > KNOWN_MAX) for (const r of refs.sort((a, b) => known[a]!.day - known[b]!.day || (a < b ? -1 : 1)).slice(0, refs.length - KNOWN_MAX)) delete known[r];
  return true;
}

/** The refs learned on or after a day, newest first. */
export function knownRefs(player: Pick<PlayerState, "known">, opts: { sinceDay?: number } = {}): string[] {
  const known = player.known ?? {};
  return Object.keys(known)
    .filter((r) => known[r]!.day >= (opts.sinceDay ?? 0))
    .sort((a, b) => known[b]!.day - known[a]!.day || (a < b ? -1 : 1));
}
