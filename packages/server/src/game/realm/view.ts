import type { RealmView } from "@millbrook/shared";
import { formatMoney } from "../money.js";
import { ongoing, partyName } from "./diplomacy.js";
import { atWar, income } from "./economy.js";
import { chainOf, titled } from "./figures.js";
import { membersOf, rankIn } from "./factions.js";
import { REALM_H, REALM_W } from "./generate.js";
import type { Realm, Settlement } from "./types.js";

/**
 * The realm in words (CLI: /realm, /factions) and as data for the browser's
 * Realm tab (N13.9). Read-only.
 */

const leaderWords = (realm: Realm, s: Settlement) => {
  const f = s.leader ? realm.figures[s.leader] : undefined;
  return f ? titled(f) : "no one";
};

/** A few lines on the whole realm. */
export function describeRealm(realm: Realm, here?: string): string[] {
  const lines: string[] = [];
  for (const k of Object.values(realm.kingdoms)) {
    const ruler = k.ruler ? realm.figures[k.ruler] : undefined;
    const places = Object.values(realm.settlements).filter((s) => s.kingdom === k.id && !s.abandoned);
    const pop = places.reduce((a, s) => a + s.population, 0);
    lines.push(`${k.name}: ${ruler ? titled(ruler) : "no ruler"}, ${places.length} places, ${pop} people, weariness ${Math.round(k.weariness)}.`);
  }
  const free = Object.values(realm.settlements).filter((s) => s.kingdom === null && !s.abandoned);
  if (free.length > 0) lines.push(`Free of any crown: ${free.map((s) => s.name).join(", ")}.`);
  const wars = ongoing(realm);
  lines.push(wars.length > 0 ? `At war: ${wars.map((w) => `${w.attackers.map((p) => partyName(realm, p)).join(" & ")} against ${w.defenders.map((p) => partyName(realm, p)).join(" & ")} (score ${w.score})`).join("; ")}.` : "No wars.");
  const ended = realm.wars.filter((w) => w.end !== undefined).slice(-3);
  for (const w of ended) lines.push(`Ended: ${partyName(realm, w.attackers[0]!)} vs ${partyName(realm, w.defenders[0]!)}: ${w.outcome}.`);
  const facs = Object.values(realm.factions).filter((f) => !f.dissolved);
  lines.push(`Factions (${facs.length}): ${facs.map((f) => `${f.name} [${f.kind}${f.parent ? `, split from ${realm.factions[f.parent]?.name ?? "?"}` : ""}] ${f.members.length}`).join("; ")}.`);
  const treaties = realm.treaties.filter((t) => !t.broken && t.until >= realm.day);
  lines.push(`Treaties in force (${treaties.length}): ${treaties.slice(0, 8).map((t) => `${t.kind.replace("_", "-")} ${partyName(realm, t.a)} / ${partyName(realm, t.b)}`).join("; ")}${treaties.length > 8 ? "; ..." : ""}.`);
  const home = here ? realm.settlements[here] : undefined;
  if (home) lines.push(...describeSettlement(realm, home.id));
  return lines;
}

/** One settlement in a few lines. */
export function describeSettlement(realm: Realm, id: string): string[] {
  const s = realm.settlements[id] ?? Object.values(realm.settlements).find((x) => x.name.toLowerCase() === id.toLowerCase() || x.name.toLowerCase().startsWith(id.toLowerCase()));
  if (!s) return [`No place called "${id}".`];
  const liege = s.liege ? realm.settlements[s.liege] : undefined;
  const lead = s.leader ? realm.figures[s.leader] : undefined;
  const chain = lead ? chainOf(realm, lead.id).map(titled) : [];
  const buildings = Object.entries(s.buildings).filter(([, l]) => (l ?? 0) > 0).map(([b, l]) => `${b} ${l}`).join(", ");
  const branches = Object.values(realm.factions).filter((f) => !f.dissolved && (f.seat === s.id || f.branches.includes(s.id))).map((f) => f.name);
  return [
    `${s.name} (${s.abandoned ? "abandoned " : ""}${s.kind}${s.kingdom ? `, ${realm.kingdoms[s.kingdom]?.name}` : ", free"}): ${s.population} people, prosperity ${Math.round(s.prosperity)}, food ${Math.round(s.food)}, coffers ${formatMoney(s.treasury)} (+${formatMoney(income(realm, s, realm.day))} a day).`,
    `  Head: ${leaderWords(realm, s)}${chain.length > 0 ? `, who answers to ${chain.join(", then ")}` : ""}. Pays ${Math.round(s.taxRate * 100)}% to ${liege?.name ?? "no one"}${s.arrears > 0 ? ` (${s.arrears} tax days behind)` : ""}.`,
    `  Buildings: ${buildings || "none"}${s.project ? `; building ${s.project.building} (done day ${s.project.done})` : ""}.${atWar(realm, s) ? " At war." : ""}`,
    branches.length > 0 ? `  Here: ${branches.join(", ")}.` : "",
  ].filter(Boolean);
}

/** Every faction with its hierarchy. */
export function describeFactions(realm: Realm): string[] {
  return Object.values(realm.factions)
    .filter((f) => !f.dissolved)
    .map((f) => {
      const ms = membersOf(realm, f).slice(0, 6).map((m) => `${m.name} (${rankIn(realm, f, m.id)})`);
      return `${f.name} [${f.kind}${f.trade ? `, ${f.trade}` : ""}]: "${f.creed}". ${ms.join(", ")}${f.members.length > 6 ? `, and ${f.members.length - 6} more` : ""}. Halls: ${f.branches.map((b) => realm.settlements[b]?.name ?? b).join(", ") || "none"}.`;
    });
}

/** The realm for the browser (N13.9): small enough to send with every state. */
/** `sworn`: the townsfolk sworn to each faction (from the people store), counted with its named members in `size`. */
export function realmView(realm: Realm, opts: { here?: string; heard?: (newsId: string) => boolean; sworn?: ReadonlyMap<string, number> } = {}): RealmView {
  const fig = (id: string | null) => (id && realm.figures[id] ? titled(realm.figures[id]!) : null);
  return {
    day: realm.day,
    size: { w: REALM_W, h: REALM_H },
    kingdoms: Object.values(realm.kingdoms).map((k) => ({ id: k.id, name: k.name, color: k.color, ruler: fig(k.ruler), capital: k.capital, weariness: Math.round(k.weariness) })),
    settlements: Object.values(realm.settlements).map((s) => ({
      id: s.id,
      name: s.name,
      kind: s.kind,
      kingdom: s.kingdom,
      liege: s.liege,
      x: s.pos.x,
      y: s.pos.y,
      population: s.population,
      prosperity: Math.round(s.prosperity),
      food: Math.round(s.food),
      treasury: s.treasury,
      leader: fig(s.leader),
      buildings: Object.fromEntries(Object.entries(s.buildings).filter(([, l]) => (l ?? 0) > 0)) as Record<string, number>,
      project: s.project ? `${s.project.building} (day ${s.project.done})` : null,
      roads: s.roads,
      here: s.id === opts.here,
      abandoned: !!s.abandoned,
      atWar: atWar(realm, s),
      raided: s.lastRaided !== undefined && realm.day - s.lastRaided <= 5,
      arrears: s.arrears,
      taxRate: s.taxRate,
    })),
    factions: Object.values(realm.factions)
      .filter((f) => !f.dissolved)
      .map((f) => ({
        id: f.id,
        name: f.name,
        kind: f.kind,
        creed: f.creed,
        leader: fig(f.leader),
        members: membersOf(realm, f).slice(0, 8).map((m) => `${m.name} (${rankIn(realm, f, m.id)})`),
        size: f.members.length + (opts.sworn?.get(f.id) ?? 0),
        named: f.members.length,
        sworn: opts.sworn?.get(f.id) ?? 0,
        branches: f.branches.map((b) => realm.settlements[b]?.name ?? b),
        wealth: f.wealth,
        parent: f.parent ? (realm.factions[f.parent]?.name ?? null) : null,
        founded: f.founded,
      })),
    treaties: realm.treaties.filter((t) => !t.broken && t.until >= realm.day).map((t) => ({ kind: t.kind, a: partyName(realm, t.a), b: partyName(realm, t.b), until: t.until, why: t.why })),
    wars: realm.wars.slice(-6).map((w) => ({ attackers: w.attackers.map((p) => partyName(realm, p)), defenders: w.defenders.map((p) => partyName(realm, p)), cause: w.cause, start: w.start, score: w.score, battles: w.battles.length, end: w.end ?? null, outcome: w.outcome ?? null })),
    dungeons: Object.values(realm.dungeons).map((d) => ({ id: d.id, name: d.name, near: realm.settlements[d.near]?.name ?? d.near, x: d.pos.x, y: d.pos.y, tier: d.tier, depth: d.depth, danger: Math.round(d.danger), bounty: d.bounty, cleared: d.clearedUntil !== undefined && realm.day < d.clearedUntil })),
    packs: Object.values(realm.packs).filter((p) => p.count > 0).map((p) => ({ species: p.species, near: realm.settlements[p.near]?.name ?? p.near, count: p.count, cap: p.cap, alpha: fig(p.alpha), bounty: p.bounty })),
    notables: Object.values(realm.figures)
      .filter((f) => f.alive && (f.renown >= 30 || f.talks || f.rose))
      .sort((a, b) => b.renown - a.renown)
      .slice(0, 30)
      .map((f) => ({ name: titled(f), role: f.role, rank: f.life.tier, renown: f.renown, home: f.home ? (realm.settlements[f.home]?.name ?? null) : null, faction: f.faction ? (realm.factions[f.faction]?.name ?? null) : null, superior: fig(f.superior), deeds: f.deeds.slice(-3), talks: !!f.talks, rose: !!f.rose })),
    news: realm.news.slice(-40).reverse().map((n) => ({ day: n.day, text: n.text, importance: n.importance, heard: opts.heard ? opts.heard(n.id) : false })),
    director: realm.director.slice(-10).reverse(),
    stats: realm.stats,
  };
}
