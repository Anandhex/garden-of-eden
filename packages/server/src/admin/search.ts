import type { AdminCardKind, AdminSearchHit, AdminSearchResult } from "@millbrook/shared";
import { titled } from "../game/realm/figures.js";
import { HOME_ID } from "../game/realm/generate.js";
import { parseTownsfolkId } from "../game/realm/townsfolk.js";
import type { AdminContext } from "./context.js";
import { folkOf } from "./folk.js";

/**
 * Search (N17): anyone by name, class, job, role, place or faction: the cast, the realm's
 * figures (alive and dead), the townsfolk of every settlement, and beasts.
 *
 * The townsfolk are in the database (N18), so searching them is a SQL LIKE on the indexed
 * name column and is always complete. Without a database (a test world), a lazy index is
 * built per settlement from `rosterFor` a few places per request within a time budget; the
 * answer says `complete: false` until all are in, and the page asks again.
 */

interface Entry {
  ref: string;
  name: string;
  /** Everything else that can match, lower case. */
  words: string;
  detail: string;
  site: string;
}

/** Most hits returned. */
export const MAX_HITS = 50;
/** Milliseconds a request may spend listing townsfolk before answering with what it has. */
export const INDEX_BUDGET_MS = 250;

const index = new Map<string, { key: string; entries: Entry[] }>();

/** Drop the townsfolk index (tests; a new game). */
export function resetSearchIndex(): void {
  index.clear();
}

function townsfolkEntries(ctx: AdminContext, site: string, key: string): Entry[] | null {
  const hit = index.get(site);
  if (hit?.key === key) return hit.entries;
  const folk = folkOf(ctx, site);
  if (!folk) return null;
  const placeName = ctx.world().realm!.settlements[site]!.name;
  const entries = folk.roster.people.map((p) => ({
    ref: `town:${p.id}`,
    name: p.name,
    words: `${p.cls} ${p.job} ${placeName} ${p.factionName ?? ""}`.toLowerCase(),
    detail: `${p.cls} ${p.job} of ${placeName}${p.factionName ? `, ${p.factionName}` : ""}`,
    site,
  }));
  index.set(site, { key, entries });
  return entries;
}

/** 0 best .. 3 weakest; null when it doesn't match. */
function score(name: string, words: string, q: string): number | null {
  const n = name.toLowerCase();
  if (n === q) return 0;
  if (n.startsWith(q)) return 1;
  if (n.includes(q)) return 2;
  return words.includes(q) ? 3 : null;
}

export function search(ctx: AdminContext, query: string, filters: { kind?: AdminCardKind; site?: string } = {}): AdminSearchResult {
  const q = query.trim().toLowerCase();
  const world = ctx.world();
  const realm = world.realm;
  const town = ctx.town();
  const found: Array<{ s: number; hit: AdminSearchHit }> = [];
  const seen = new Set<string>();
  const add = (hit: AdminSearchHit, name: string, words: string) => {
    if (seen.has(hit.ref) || (filters.kind && hit.kind !== filters.kind) || (filters.site && hit.site !== filters.site)) return;
    const s = q === "" ? 3 : score(name, words, q);
    if (s === null) return;
    seen.add(hit.ref);
    found.push({ s, hit });
  };
  const siteName = (site: string | null) => (site ? (realm?.settlements[site]?.name ?? site) : "");

  // The player, and places (to pin them).
  add({ ref: "player", kind: "player", name: world.player.name, detail: `the player, in ${siteName(world.player.site ?? HOME_ID)}`, site: world.player.site ?? HOME_ID }, world.player.name, "player you");
  for (const s of Object.values(realm?.settlements ?? {})) add({ ref: `place:${s.id}`, kind: "place", name: s.name, detail: `${s.abandoned ? "abandoned " : ""}${s.kind}${s.kingdom ? ` of ${realm!.kingdoms[s.kingdom]?.name}` : ", free"}, ${s.population} people`, site: s.id }, s.name, `${s.kind} place settlement ${s.kingdom ? realm!.kingdoms[s.kingdom]?.name ?? "" : "free"}`.toLowerCase());
  // The cast, the people of other places the player has met, and townsfolk who became talking NPCs.
  for (const [id, persona] of Object.entries(town.personas)) {
    const folk = parseTownsfolkId(id);
    const figure = folk ? undefined : town.figureOf(id);
    const site = folk ? folk.site : figure ? figure.home : HOME_ID;
    const dead = world.npcStates[id]?.outcome === "dead";
    add(
      { ref: folk ? `town:${id}` : `cast:${id}`, kind: folk ? "townsperson" : "cast", name: persona.name, detail: `${persona.role}${site ? ` of ${siteName(site)}` : ""}${dead ? " (dead)" : ""}`, site },
      persona.name,
      `${persona.role} ${siteName(site)} ${persona.faction ?? ""}`.toLowerCase(),
    );
  }
  // The realm's figures, alive and dead; beasts with names among them.
  for (const f of Object.values(realm?.figures ?? {})) {
    const faction = f.faction ? (realm!.factions[f.faction]?.name ?? "") : "";
    const where = f.home ? siteName(f.home) : "the wilds";
    add(
      { ref: `figure:${f.id}`, kind: f.role === "beast" ? "beast" : "figure", name: f.name, detail: `${titled(f)}, ${f.role} of ${where}${faction ? `, ${faction}` : ""}${f.alive ? "" : " (dead)"}`, site: f.home },
      f.name,
      `${f.role} ${where} ${faction} ${f.life.tier}`.toLowerCase(),
    );
  }
  // Creatures: Millbrook's own, and the beasts and outlaws of other places' woods and camps.
  for (const c of Object.values(world.creatures)) add({ ref: `beast:${c.uid}`, kind: "beast", name: c.name, detail: `${c.template}${c.outcome === "dead" ? " (dead)" : ""}`, site: HOME_ID }, c.name, `${c.template} beast`);
  for (const [site, group] of Object.entries(world.haunts ?? {})) for (const c of Object.values(group)) add({ ref: `beast:${c.uid}`, kind: "beast", name: c.name, detail: `${c.template} near ${siteName(site)}${c.outcome === "dead" ? " (dead)" : ""}`, site }, c.name, `${c.template} beast ${siteName(site)}`);

  // The townsfolk, place by place, within the time budget.
  let indexed = 0;
  let places = 0;
  const stored = ctx.store && ctx.store.people.count() > 0 ? ctx.store.people : null;
  if (realm && stored && (filters.kind === undefined || filters.kind === "townsperson")) {
    const sites = q === "" ? [] : Object.values(realm.settlements).filter((s) => s.name.toLowerCase().includes(q)).map((s) => s.id);
    const factions = q === "" ? [] : Object.values(realm.factions).filter((f) => f.name.toLowerCase().includes(q)).map((f) => f.id);
    for (const p of stored.search(q, { ...(filters.site ? { site: filters.site } : {}), sites, factions, limit: MAX_HITS * 2 })) {
      const place = siteName(p.site);
      const faction = p.faction ? (realm.factions[p.faction]?.name ?? "") : "";
      add({ ref: `town:${p.id}`, kind: "townsperson", name: p.name, detail: `${p.cls} ${p.job} of ${place}${faction ? `, ${faction}` : ""}`, site: p.site }, p.name, `${p.cls} ${p.job} ${place} ${faction}`.toLowerCase());
    }
    indexed = places = Object.keys(realm.settlements).length;
  } else if (realm && (filters.kind === undefined || filters.kind === "townsperson")) {
    const started = performance.now();
    const order = Object.values(realm.settlements)
      .filter((s) => !s.abandoned && (!filters.site || s.id === filters.site))
      .sort((a, b) => Number(q !== "" && b.name.toLowerCase().includes(q)) - Number(q !== "" && a.name.toLowerCase().includes(q)) || Number(b.id === HOME_ID) - Number(a.id === HOME_ID) || a.population - b.population);
    places = order.length;
    for (const s of order) {
      const key = `${s.population}|${world.day}|${s.leader ?? ""}`;
      const cached = index.get(s.id)?.key === key;
      if (!cached && performance.now() - started > INDEX_BUDGET_MS) continue;
      const entries = townsfolkEntries(ctx, s.id, key);
      indexed++;
      for (const e of entries ?? []) add({ ref: e.ref, kind: "townsperson", name: e.name, detail: e.detail, site: e.site }, e.name, e.words);
    }
  }
  found.sort((a, b) => a.s - b.s || a.hit.name.localeCompare(b.hit.name));
  return { hits: found.slice(0, MAX_HITS).map((f) => f.hit), complete: indexed >= places, indexed, places };
}
