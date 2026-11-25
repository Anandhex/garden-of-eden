/**
 * N24: global reporting. The player knows a piece of realm news when it has reached the place they are in (every place has
 * its own clock: `reachesAt`, N26 Part E). Their feed reads only what they know, in three scopes:
 * - **here**: what happened in the place they're in;
 * - **kingdom**: what happened anywhere in that place's kingdom (a free place: only itself);
 * - **everywhere**: all they know.
 * Each scope has an importance floor so the wider ones don't flood. The admin view (N17) shows the truth at once, with the day
 * the player learned each piece (`newsKnownSince`), so the gap between truth and knowledge can be seen.
 */
import type { PlayerState } from "../../npc/types.js";
import { playerLearns } from "../playerKnowledge.js";
import { reachesAt } from "./log.js";
import type { Realm, RealmNews } from "./types.js";

export const FEED_SCOPES = ["here", "kingdom", "everywhere"] as const;
export type FeedScope = (typeof FEED_SCOPES)[number];
/** The least important news each scope shows. */
export const FEED_FLOOR: Record<FeedScope, number> = { here: 1, kingdom: 4, everywhere: 6 };

export interface FeedItem {
  id: string;
  day: number;
  /** The day the player learned it. */
  learned: number;
  text: string;
  kind: string;
  importance: number;
  at: string | null;
  /** Its scope from the player's place now: the narrowest that holds it. */
  scope: FeedScope;
}

/** A piece of news as a knowledge ref (game/gossip/refs.ts). */
export const newsRef = (id: string) => `n:${id}`;

/**
 * The player learns what has reached the place they are in, by `day` (as news: `how: "news"`, from the place). The first learning stands;
 * a better version told by someone (N33) is kept. Returns the newly known.
 */
export function learnAt(realm: Realm, player: Pick<PlayerState, "known">, site: string, day: number): RealmNews[] {
  const out: RealmNews[] = [];
  for (const n of realm.news) {
    if (player.known?.[newsRef(n.id)]) continue;
    const r = reachesAt(realm, n, site);
    if (r === null || r > day) continue;
    if (playerLearns(player, newsRef(n.id), "news", day, { from: site })) out.push(n);
  }
  return out;
}

/** The day the player learned a piece of news, or null while they don't know it. */
export const newsKnownSince = (player: Pick<PlayerState, "known">, newsId: string): number | null => player.known?.[newsRef(newsId)]?.day ?? null;

/** The narrowest scope a piece of news is in, seen from `site`. */
export function scopeOf(realm: Realm, n: Pick<RealmNews, "at">, site: string): FeedScope {
  if (n.at === site) return "here";
  const mine = realm.settlements[site]?.kingdom ?? null;
  const theirs = n.at ? (realm.settlements[n.at]?.kingdom ?? null) : null;
  return mine !== null && mine === theirs ? "kingdom" : "everywhere";
}

const WIDTH: Record<FeedScope, number> = { here: 0, kingdom: 1, everywhere: 2 };

/**
 * The player's feed: only news they know, in the scope asked for (a wider scope holds the narrower ones), above its floor, newest first.
 * `follow`: names of people the player keeps track of (N34); news naming one of them shows whatever its importance.
 */
export function playerFeed(realm: Realm, player: Pick<PlayerState, "known">, site: string, scope: FeedScope, o: { limit?: number; follow?: string[]; minor?: boolean } = {}): FeedItem[] {
  const known = player.known ?? {};
  const follow = new Set(o.follow ?? []);
  const out: FeedItem[] = [];
  for (const n of realm.news) {
    const learned = known[newsRef(n.id)]?.day;
    if (learned === undefined) continue;
    const s = scopeOf(realm, n, site);
    if (WIDTH[s] > WIDTH[scope]) continue;
    const followed = (n.names ?? []).some((x) => follow.has(x));
    if (!o.minor && !followed && n.importance < FEED_FLOOR[scope]) continue;
    out.push({ id: n.id, day: n.day, learned, text: n.text, kind: n.kind, importance: n.importance, at: n.at, scope: s });
  }
  out.sort((a, b) => b.learned - a.learned || b.day - a.day || (a.id < b.id ? 1 : -1));
  return out.slice(0, o.limit ?? 50);
}
