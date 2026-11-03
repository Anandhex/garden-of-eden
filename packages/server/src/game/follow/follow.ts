import type { PlayerState } from "../../npc/types.js";
import type { WorldStore } from "../db.js";
import { describeKnown } from "../gossip/describe.js";
import { parseRef } from "../gossip/refs.js";
import { note } from "../journal.js";
import { parseDeath } from "../people/death.js";
import { playerLearns } from "../playerKnowledge.js";
import type { Realm } from "../realm/types.js";
import { journeyOf } from "../road/journeys.js";

/**
 * Following people (N34): the player's own version of the admin's pin, bound by what the player knows. Following someone
 * means news of them is noticed and kept when it reaches the player (overheard where the player is, told by someone, or
 * in a letter), with its source and how sure; the followed list shows each person's last *known* whereabouts, never the
 * truth of where they are.
 */
export type FollowWhy = "friend" | "family" | "rival" | "nemesis" | "famous" | "chosen";

export interface FollowEntry {
  name: string;
  since: number;
  why: FollowWhy;
  /** Where the player last heard they were, when, how, and how sure (0..1). */
  lastKnown?: { site: string | null; day: number; how: string; sure: number; dead?: boolean };
  /** The refs heard of them, newest last (a few). */
  heard: Array<{ ref: string; day: number; text: string; from: string; sure: number }>;
}

/** Most people followed at once. */
export const MAX_FOLLOWS = 30;

export const followsOf = (p: PlayerState): Record<string, FollowEntry> => (p.follows ??= {});

/** Follow someone (a person row's id, or a talker's). */
export function follow(p: PlayerState, id: string, name: string, why: FollowWhy, day: number, at?: { site: string | null; how: string }): string {
  const f = followsOf(p);
  if (f[id]) return `You already keep track of ${name}.`;
  if (Object.keys(f).length >= MAX_FOLLOWS) return "You can't keep track of anyone more.";
  f[id] = { name, since: day, why, heard: [], ...(at ? { lastKnown: { site: at.site, day, how: at.how, sure: 1 } } : {}) };
  return `You'll keep an ear out for news of ${name}.`;
}

export function unfollow(p: PlayerState, id: string): string {
  const f = followsOf(p);
  const name = f[id]?.name;
  delete f[id];
  return name ? `You stop keeping track of ${name}.` : "You weren't following them.";
}

/** The people a ref is about: an event's actor and target, a death's person, a realm news item's people. */
export function aboutOf(realm: Realm, store: WorldStore, ref: string): string[] {
  const r = parseRef(ref);
  if (!r) return [];
  if (r.kind === "d") return [r.id];
  if (r.kind === "e") {
    const ev = store.eventById(r.id);
    return ev ? [ev.actor, ev.target].filter(Boolean) : [];
  }
  return realm.news.find((n) => n.id === r.id)?.people ?? [];
}

/** Where a ref puts someone, as far as it says: an event's place, a death (and where). */
function whereOf(realm: Realm, store: WorldStore, ref: string, who: string): { site: string | null; dead?: boolean } | null {
  const r = parseRef(ref);
  if (!r) return null;
  if (r.kind === "d") return { site: parseDeath(store.people.get(r.id)?.death ?? null)?.site ?? null, dead: true };
  if (r.kind === "e") {
    const ev = store.eventById(r.id);
    if (!ev) return null;
    // A move says where they went.
    if (ev.kind === "migration" && ev.actor === who) {
      const to = /to ([A-Z][\w' ]+)/.exec(ev.details)?.[1];
      const site = Object.values(realm.settlements).find((s) => s.name === to?.trim())?.id;
      if (site) return { site };
    }
    return ev.site ? { site: ev.site } : null;
  }
  const n = realm.news.find((x) => x.id === r.id);
  return n ? { site: n.at } : null;
}

const sureWords = (a: number) => (a >= 0.95 ? "sure" : a >= 0.8 ? "fairly sure" : a >= 0.6 ? "not sure" : "a rumour");

/** Words for where a piece of knowledge came from: a traveller's party by its kind, a person by name. */
function sourceWords(realm: Realm, store: WorldStore, source: string): string {
  if (source.startsWith("carrier:")) {
    const j = journeyOf(realm, source.slice(8));
    return j ? `from ${j.kind === "caravan" ? "a caravan" : j.kind === "courier" ? "a courier" : `travellers (${j.kind})`} out of ${realm.settlements[j.path[0]!]?.name ?? "elsewhere"}` : "from travellers";
  }
  if (source === "saw") return "seen";
  const row = store.people.get(source);
  return row ? `from ${row.name}` : "overheard";
}

/**
 * The player notices news of a followed person (a ref they now know): kept in the entry, a journal line, and their last
 * known whereabouts if it says where. Returns the line for the feed, or null if it's not about anyone followed.
 */
export function noticeFollowed(realm: Realm, store: WorldStore, p: PlayerState, ref: string, day: number, from: string, sure: number): string | null {
  const f = followsOf(p);
  const lines: string[] = [];
  for (const who of aboutOf(realm, store, ref)) {
    const e = f[who];
    if (!e || e.heard.some((h) => h.ref === ref)) continue;
    const text = describeKnown({ realm, store }, ref, sure, 0) ?? "something";
    e.heard.push({ ref, day, text, from, sure });
    if (e.heard.length > 8) e.heard.shift();
    const at = whereOf(realm, store, ref, who);
    if (at && (!e.lastKnown || e.lastKnown.day <= day)) e.lastKnown = { site: at.site, day, how: from, sure, ...(at.dead ? { dead: true } : {}) };
    const line = `Word of ${e.name}: ${text} (${from}; ${sureWords(sure)}).`;
    note(p, { id: `follow:${who}:${ref}`, day, kind: "rumour", text: line });
    lines.push(line);
  }
  return lines.length > 0 ? lines.join(" ") : null;
}

/** Everything that could be said of a followed person: the events about them and their death. */
function refsAbout(store: WorldStore, who: string): string[] {
  return [...store.eventsAbout(who, 20).map((e) => `e:${e.id}`), `d:${who}`];
}

/**
 * Overhearing at a place (N34 decision 3): once a day and on arrival, anything about a followed person that someone living
 * here knows reaches the player, with that person's source (a caravan that brought it, a neighbour). Never anything nobody
 * here knows.
 */
export function overhear(realm: Realm, store: WorldStore, p: PlayerState, site: string, day: number): string[] {
  const out: string[] = [];
  for (const who of Object.keys(followsOf(p))) {
    for (const ref of refsAbout(store, who)) {
      if (p.known?.[ref] || followsOf(p)[who]!.heard.some((h) => h.ref === ref)) continue;
      const here = store.knowledge.holders(ref).filter((r) => r.learned_day <= day && store.people.get(r.who)?.site === site && store.people.get(r.who)?.death === null);
      const best = here.sort((a, b) => b.accuracy - a.accuracy || (a.who < b.who ? -1 : 1))[0];
      if (!best) continue;
      const from = `overheard in ${realm.settlements[site]?.name ?? "town"}, ${sourceWords(realm, store, best.source)}`;
      playerLearns(p, ref, "told", day, { from: best.who, accuracy: best.accuracy });
      const line = noticeFollowed(realm, store, p, ref, day, from, best.accuracy);
      if (line) out.push(line);
    }
  }
  return out;
}
