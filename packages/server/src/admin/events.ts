import { type AdminEvent, type AdminEventQuery, type AdminEventsPage, atKey, compareAt } from "@millbrook/shared";
import type { GameEvent } from "../game/events.js";
import type { DirectorPush, Realm, RealmNews } from "../game/realm/types.js";
import type { AdminContext } from "./context.js";
import { nameOfRef, refOfId, siteOfRef } from "./refs.js";

/**
 * The admin event stream (N17): the three kinds of event the world keeps, made alike.
 * - game events (the player's and the cast's world): all of them, from the database;
 * - realm news: what happened out in the realm, with the figures in it and why;
 * - the director: the realm's pushes with their reasons, and the log of model proposals
 *   and admin actions (`admin-time`).
 * Newest first. Read-only.
 */

/** How the three kinds sort when they share a day and hour (and so what a cursor means). */
const RANK = { game: 0, realm: 1, push: 2, log: 3 } as const;

/** Rows a page holds at most. */
export const MAX_PAGE = 1000;
const DEFAULT_PAGE = 200;

const numberAfter = (id: string): number => {
  const m = /(\d+)$/.exec(id);
  return m ? Number(m[1]) : 0;
};

function fromGame(ctx: AdminContext, e: GameEvent): AdminEvent {
  const people = [refOfId(ctx, e.actor), refOfId(ctx, e.target)].filter((r): r is string => r !== null);
  const world = ctx.world();
  const factions = [...new Set(people.flatMap((r) => (r.startsWith("figure:") ? [world.realm?.figures[r.slice(7)]?.faction ?? ""] : [])).filter(Boolean))];
  return {
    ref: `e:${e.id}`,
    day: e.day,
    hour: e.hour,
    source: "game",
    kind: e.kind,
    text: e.details,
    importance: e.importance,
    // The event's own place is a spot in a village; the settlement is where its people live.
    site: people.map((r) => siteOfRef(ctx, r)).find((s) => s !== null) ?? null,
    people: [...new Set(people)],
    factions,
    why: e.why ?? null,
    causedBy: [],
    at: atKey(e.day, e.hour, RANK.game, numberAfter(e.id)),
  };
}

function fromNews(realm: Realm, n: RealmNews): AdminEvent {
  const people = (n.people ?? []).map((id) => `figure:${id}`);
  const named = new Set(n.names ?? []);
  const factions = Object.values(realm.factions)
    .filter((f) => named.has(f.name) || named.has(f.name.replace(/^the /, "")))
    .map((f) => f.id);
  return {
    ref: `n:${n.id}`,
    day: n.day,
    hour: 0,
    source: "realm",
    kind: n.kind,
    text: n.text,
    importance: n.importance,
    site: n.at,
    people,
    factions,
    why: n.why ?? null,
    causedBy: [],
    at: atKey(n.day, 0, RANK.realm, numberAfter(n.id)),
  };
}

function fromPush(realm: Realm, p: DirectorPush): AdminEvent {
  const target = realm.settlements[p.target] ? p.target : (realm.packs[p.target] ? realm.packs[p.target]!.near : realm.dungeons[p.target]?.near ?? null);
  return {
    ref: `d:${p.day}:${p.kind}:${p.target}`,
    day: p.day,
    hour: 0,
    source: "director",
    kind: p.kind,
    text: `${p.kind.replace(/_/g, " ")} → ${realm.settlements[p.target]?.name ?? (realm.packs[p.target] ? `${realm.packs[p.target]!.species}s near ${realm.settlements[realm.packs[p.target]!.near]?.name ?? "?"}` : undefined) ?? realm.dungeons[p.target]?.name ?? realm.factions[p.target]?.name ?? realm.figures[p.target]?.name ?? p.target}${p.ok ? "" : " (came to nothing)"}`,
    importance: p.ok ? 4 : 2,
    site: target,
    people: [],
    factions: realm.factions[p.target] ? [p.target] : [],
    why: p.reason,
    causedBy: [],
    at: atKey(p.day, 0, RANK.push, 0),
  };
}

/** Everything in the stream, unfiltered, in no particular order. */
function all(ctx: AdminContext): AdminEvent[] {
  const world = ctx.world();
  const realm = world.realm;
  const out: AdminEvent[] = [];
  // Every game event is in the database; the save holds only the latest few hundred. Take both, once each.
  const seen = new Set<string>();
  for (const e of [...(ctx.store?.recentEvents({ limit: 5000 }) ?? []), ...(world.events ?? [])]) {
    if (seen.has(e.id)) continue;
    seen.add(e.id);
    out.push(fromGame(ctx, e));
  }
  if (realm) {
    for (const n of realm.news) out.push(fromNews(realm, n));
    for (const p of realm.director) out.push(fromPush(realm, p));
  }
  (ctx.store?.directorEntries() ?? []).forEach((l, i) => {
    out.push({
      ref: `l:${i}`,
      day: l.day,
      hour: 0,
      source: "director",
      kind: l.kind,
      text: l.kind === "admin-time" ? l.proposal : `${l.kind.replace(/_/g, " ")}: ${l.proposal.slice(0, 160)}`,
      importance: l.kind === "admin-time" ? 3 : 2,
      site: null,
      people: [],
      factions: [],
      why: l.reason,
      causedBy: [],
      at: atKey(l.day, 0, RANK.log, i),
    });
  });
  return out;
}

/** The stream, filtered, newest first. `cursor` is the newest row's place in the whole stream. */
export function events(ctx: AdminContext, q: AdminEventQuery = {}): AdminEventsPage {
  const every = all(ctx).sort((a, b) => compareAt(b.at, a.at));
  const keep = every.filter(
    (e) =>
      (q.site === undefined || e.site === q.site) &&
      (q.faction === undefined || e.factions.includes(q.faction)) &&
      (q.person === undefined || e.people.includes(q.person)) &&
      (q.kind === undefined || e.kind === q.kind) &&
      (q.minImportance === undefined || e.importance >= q.minImportance) &&
      (q.source === undefined || e.source === q.source) &&
      (q.after === undefined || compareAt(e.at, q.after) > 0),
  );
  const limit = Math.max(1, Math.min(MAX_PAGE, Math.floor(q.limit ?? DEFAULT_PAGE)));
  const page = keep.slice(0, limit);
  const names: Record<string, string> = {};
  for (const e of page) for (const ref of [...e.people, ...(e.site ? [`place:${e.site}`] : [])]) names[ref] ??= nameOfRef(ctx, ref);
  return { events: page, cursor: every[0]?.at ?? null, matched: keep.length, names };
}

/** One row by its ref (for the detail panel), or null. */
export function eventByRef(ctx: AdminContext, ref: string): AdminEvent | null {
  return all(ctx).find((e) => e.ref === ref) ?? null;
}
