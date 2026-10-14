import type { AdminGossip, AdminKnowers } from "@millbrook/shared";
import { config } from "../config.js";
import { describeKnown } from "../game/gossip/describe.js";
import { parseRef } from "../game/gossip/refs.js";
import type { AdminContext } from "./context.js";

/**
 * Gossip, for the admin view (N33): the things most people know, and for one thing who knows it, where, and in whose version. The
 * truth is always shown beside what someone says. Reads only.
 */

export function gossipOverview(ctx: AdminContext): AdminGossip {
  const world = ctx.world();
  const store = ctx.store;
  if (!store || !world.realm) return { popular: [], rows: 0, mostHeld: 0, people: 0, on: config.gossip };
  const life = { realm: world.realm, store };
  const popular = store.knowledge.popular(25).map((p) => ({ ref: p.ref, text: describeKnown(life, p.ref, 1, 0) ?? "(no longer on record)", count: p.n }));
  return { popular, rows: store.knowledge.total(), mostHeld: store.knowledge.mostHeld(), people: store.people.count(), on: config.gossip };
}

export function knowersOf(ctx: AdminContext, ref: string): AdminKnowers | null {
  const world = ctx.world();
  const store = ctx.store;
  if (!store || !world.realm || !parseRef(ref)) return null;
  const life = { realm: world.realm, store };
  const rows = store.knowledge.holders(ref);
  const truth = describeKnown(life, ref, 1, 0);
  const sites = new Map<string, { count: number; firstDay: number }>();
  const who = new Map(rows.map((r) => [r.who, store.people.get(r.who)]));
  for (const r of rows) {
    const site = who.get(r.who)?.site ?? "?";
    const at = sites.get(site) ?? { count: 0, firstDay: r.learned_day };
    at.count++;
    at.firstDay = Math.min(at.firstDay, r.learned_day);
    sites.set(site, at);
  }
  const name = (id: string) => world.realm!.settlements[id]?.name ?? id;
  const places = [...sites.entries()].map(([site, v]) => ({ site, name: name(site), count: v.count, people: store.people.livingCount(site), firstDay: v.firstDay })).sort((a, b) => a.firstDay - b.firstDay || b.count - a.count || (a.site < b.site ? -1 : 1));
  const holders = rows.slice(0, 60).map((r) => {
    const p = who.get(r.who);
    const told = describeKnown(life, ref, r.accuracy, r.variant);
    return {
      ref: `town:${r.who}`,
      name: p?.name ?? r.who,
      site: p?.site ?? "?",
      siteName: name(p?.site ?? "?"),
      day: r.learned_day,
      accuracy: r.accuracy,
      from: r.source === "saw" ? "saw it" : r.source.startsWith("carrier:") ? "a traveller" : (store.people.get(r.source)?.name ?? r.source),
      told,
      wrong: r.variant !== 0,
    };
  });
  return { ref, truth, total: rows.length, places, holders };
}
