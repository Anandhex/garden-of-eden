import { CLASS_RANK, type SocialClass } from "@millbrook/shared";
import type { LifeCtx } from "../people/step.js";
import { parseDeath } from "../people/death.js";

/**
 * What can be known (N33): a ref says what. `n:<realmNewsId>` is realm news, `d:<personId>` the death of a townsperson (from their
 * record, so every death can be gossip without an event per death), `e:<eventId>` an event in the archive. More kinds come with later
 * phases (`s:` a secret: N46); `describeKnown` (describe.ts) says what a person would say of one.
 */
export type RefKind = "n" | "d" | "e" | "i" | "s" | "r";

export const newsRef = (newsId: string): string => `n:${newsId}`;
export const deathRef = (personId: string): string => `d:${personId}`;
export const eventRef = (eventId: string): string => `e:${eventId}`;
/** A notable item (N43): knowing it, to recognise it. */
export const itemRef = (itemId: string): string => `i:${itemId}`;

export function parseRef(ref: string): { kind: RefKind; id: string } | null {
  const k = ref[0];
  if ((k === "n" || k === "d" || k === "e" || k === "i" || k === "s" || k === "r") && ref[1] === ":" && ref.length > 2) return { kind: k, id: ref.slice(2) };
  return null;
}

/** How much a thing is worth telling (1..10), from what it is about. */
export function importanceOf(ctx: LifeCtx, ref: string): number {
  const r = parseRef(ref);
  if (!r) return 1;
  if (r.kind === "n") return ctx.realm.news.find((n) => n.id === r.id)?.importance ?? 0;
  // A secret (N46) is never passed on by gossip by itself: whoever knows it keeps it, or tells it on purpose (game/secrets/).
  if (r.kind === "s") return 0;
  // A rumour someone made up (N52): as juicy as its claim.
  if (r.kind === "r") return (ctx.store.records?.get(r.id)?.data as { weight?: number } | undefined)?.weight ?? 0;
  if (r.kind === "d") {
    const row = ctx.store.people.get(r.id);
    if (!row) return 0;
    const rank = CLASS_RANK[row.cls as SocialClass] ?? 2;
    // From what never changes about them (a person who later becomes a talker is no more worth telling of): the weight is cached.
    return 3 + (rank >= 5 ? 2 : 0);
  }
  // A notable item (N43): worth telling of as its fame says.
  if (r.kind === "i") {
    const it = ctx.store.notables?.get(r.id);
    return it ? Math.max(2, Math.min(9, 2 + Math.round(it.fame / 15))) : 0;
  }
  // An event: as weighty as it was (N37: an insult in the market is worth telling for a few days, a sneer barely), never less than the old flat 3.
  const ev = ctx.store.eventById(r.id);
  return ev ? Math.max(3, Math.min(9, 2 + ev.importance)) : 3;
}

/** The place a thing is about, for the listener's interest in what happened at home. */
export function placeOfRef(ctx: LifeCtx, ref: string): string | null {
  const r = parseRef(ref);
  if (!r) return null;
  if (r.kind === "n") return ctx.realm.news.find((n) => n.id === r.id)?.at ?? null;
  if (r.kind === "d") {
    const row = ctx.store.people.get(r.id);
    return row ? (parseDeath(row.death)?.site ?? row.site) : null;
  }
  if (r.kind === "i") return ctx.store.notables?.get(r.id)?.made_site ?? null;
  if (r.kind === "s" || r.kind === "r") return ctx.store.records?.get(r.id)?.site ?? null;
  // An event happens where it happened for good: asked about for every row of every speaker, so kept.
  let sites = eventSites.get(ctx.store);
  if (!sites || sites.size > 20000) eventSites.set(ctx.store, (sites = new Map()));
  let site = sites.get(r.id);
  if (site === undefined) {
    site = ctx.store.eventById(r.id)?.site ?? null;
    sites.set(r.id, site);
  }
  return site;
}

const eventSites = new WeakMap<object, Map<string, string | null>>();
