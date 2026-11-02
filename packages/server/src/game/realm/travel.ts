import { transfer } from "./ledger.js";
import { lose } from "./beasts.js";
import { plural } from "./names.js";
import type { PlayerState } from "../../npc/types.js";
import type { Rng } from "../dice.js";
import { itemKey } from "../items.js";
import { tierIndex, type Tier } from "../life.js";
import { playerGainXp, QUEST_TIER_XP } from "../levels.js";
import { formatMoney } from "../money.js";
import { recordCreatureDefeat } from "../quests.js";
import { atWar } from "./economy.js";
import { figurePower, killFigure } from "./figures.js";
import { TRAVEL_PER_DAY } from "./generate.js";
import { realmNews, tally } from "./log.js";
import { gangSide } from "./military.js";
import type { Realm } from "./types.js";
import { packSide, playerPower } from "./wilds.js";
import { gangMembers } from "./who.js";

/**
 * Travel (N14): the player walks the realm's roads. Where they are is
 * `player.site` (a settlement id). A trip follows the
 * shortest road route; it takes the hours the distance takes, and the caller lets
 * the world live them. On the way, a big pack, a gang or a war may stop them:
 * fought in code like a delve, with their companions' strength added.
 */

/** Most encounters on one trip. */
export const MAX_ENCOUNTERS = 2;

/** Where the player is: a settlement id (every player has one). */
export const siteOf = (player: Pick<PlayerState, "site">): string => {
  if (!player.site) throw new Error("The player has no site.");
  return player.site;
};

export interface Route {
  /** Settlement ids from start to end, both included. */
  path: string[];
  /** Map distance. */
  distance: number;
  /** Hours on the road. */
  hours: number;
}

const dist = (realm: Realm, a: string, b: string) => {
  const x = realm.settlements[a]!.pos;
  const y = realm.settlements[b]!.pos;
  return Math.hypot(x.x - y.x, x.y - y.y);
};

/** Hours for a distance: a traveller covers TRAVEL_PER_DAY in a day. */
export const hoursFor = (distance: number) => Math.max(1, Math.round((distance / TRAVEL_PER_DAY) * 24));

/** The shortest road route between two places (Dijkstra), or null if the roads don't join them. */
export function route(realm: Realm, from: string, to: string): Route | null {
  if (!realm.settlements[from] || !realm.settlements[to]) return null;
  if (from === to) return { path: [from], distance: 0, hours: 0 };
  const best: Record<string, number> = { [from]: 0 };
  const prev: Record<string, string> = {};
  const open = new Set([from]);
  while (open.size > 0) {
    let cur = "";
    for (const id of open) if (!cur || best[id]! < best[cur]!) cur = id;
    open.delete(cur);
    if (cur === to) break;
    for (const n of realm.settlements[cur]!.roads) {
      const s = realm.settlements[n];
      if (!s || (s.abandoned && n !== to)) continue;
      const d = best[cur]! + dist(realm, cur, n);
      if (best[n] === undefined || d < best[n]!) {
        best[n] = d;
        prev[n] = cur;
        open.add(n);
      }
    }
  }
  if (best[to] === undefined) return null;
  const path = [to];
  while (path[0] !== from) path.unshift(prev[path[0]!]!);
  return { path, distance: best[to]!, hours: hoursFor(best[to]!) };
}

/** Every place the player can reach from where they are, nearest first. */
export function destinations(realm: Realm, from: string): Array<{ id: string; name: string; kind: string; hours: number; dangers: string[] }> {
  return Object.values(realm.settlements)
    .filter((s) => s.id !== from && !s.abandoned)
    .flatMap((s) => {
      const r = route(realm, from, s.id);
      return r ? [{ id: s.id, name: s.name, kind: s.kind, hours: r.hours, dangers: dangersOn(realm, r) }] : [];
    })
    .sort((a, b) => a.hours - b.hours);
}

/** What might stop a traveller on this route, in words. */
export function dangersOn(realm: Realm, r: Route): string[] {
  const out = new Set<string>();
  for (const id of r.path.slice(1)) {
    const s = realm.settlements[id]!;
    for (const p of Object.values(realm.packs)) if (p.near === id && p.count >= p.cap * 0.6) out.add(`${plural(p.species)} near ${s.name}`);
    for (const g of gangsNear(realm, id)) out.add(`${g.name} near ${s.name}`);
    if (atWar(realm, s)) out.add(`war at ${s.name}`);
  }
  return [...out];
}

export function gangsNear(realm: Realm, id: string) {
  const near = new Set([id, ...(realm.settlements[id]?.roads ?? [])]);
  return Object.values(realm.factions).filter((f) => !f.dissolved && f.kind === "gang" && f.seat && near.has(f.seat) && f.members.length > 0);
}

export interface Trip {
  ok: boolean;
  lines: string[];
  hours: number;
  route?: Route;
}

export interface Foe {
  name: string;
  power: number;
  tier: Tier;
  kind: "pack" | "gang" | "war";
  id: string;
  species?: string;
  /** The people met, by figure id (N26F step 0b): gang members present, deserters of a real army. Losses fall on them. */
  who?: string[];
}

/**
 * Set out for `to`: check the way, then the road's encounters, fought in code. Doesn't
 * move the clock or the player: the caller passes `hours` and then calls arrive().
 * `companions`: the strength of whoever travels with the player (game/town.ts).
 */
export function setOut(realm: Realm, player: PlayerState, to: string, day: number, rng: Rng, companions = 0): Trip {
  const from = siteOf(player);
  const dest = realm.settlements[to] ?? Object.values(realm.settlements).find((s) => s.name.toLowerCase() === to.toLowerCase() || s.name.toLowerCase().startsWith(to.toLowerCase()));
  if (!dest) return { ok: false, lines: [`There's no place called "${to}".`], hours: 0 };
  if (dest.id === from) return { ok: false, lines: [`You're already in ${dest.name}.`], hours: 0 };
  if (dest.abandoned) return { ok: false, lines: [`${dest.name} stands empty; there's nobody to go to.`], hours: 0 };
  if (player.hp <= player.maxHp * 0.25) return { ok: false, lines: ["You're in no state for the road. Rest first."], hours: 0 };
  const r = route(realm, from, dest.id);
  if (!r) return { ok: false, lines: [`No road leads from ${realm.settlements[from]!.name} to ${dest.name}.`], hours: 0 };
  const lines = [`You set out for ${dest.name} by way of ${r.path.slice(1, -1).map((id) => realm.settlements[id]!.name).join(", ") || "the open road"}: about ${describeHours(r.hours)} on the road.`];
  let met = 0;
  for (const id of r.path.slice(1)) {
    if (met >= MAX_ENCOUNTERS) break;
    const foe = encounterAt(realm, id, rng);
    if (!foe) continue;
    met += 1;
    lines.push(...fightOnRoad(realm, player, foe, realm.settlements[id]!.name, day, rng, companions));
  }
  tally(realm, "player_trips");
  return { ok: true, lines, hours: r.hours, route: r };
}

/** Something on the road near this place, maybe. */
/** The pack as a foe on the road (N26: met at its hunting ground). */
export function packFoe(realm: Realm, p: Realm["packs"][string]): Foe {
  const side = packSide(realm, p);
  return { name: side.name, power: Math.min(p.count, 4) * (3 + tierIndex(p.tier as Tier) * 3) + side.fighters.reduce((a, f) => a + figurePower(f), 0), tier: p.tier as Tier, kind: "pack", id: p.id, species: p.species };
}

/** Most of a gang out on the road at once. */
export const GANG_ON_ROAD = 4;

/**
 * The gang as a foe on the road (N26: met at its ambush): the members who are out, by name (N26F step 0b), never a
 * number. Their power is theirs; a gang with nobody about isn't met.
 */
export function gangFoe(realm: Realm, g: Realm["factions"][string], rng: Rng = () => 0.5): Foe | null {
  const about = gangMembers(realm, g.id);
  if (about.length === 0) return null;
  const n = Math.min(about.length, 2 + Math.floor(rng() * (GANG_ON_ROAD - 1)));
  const out = about.slice(about.length > n ? 1 : 0).slice(0, n); // the chief stays at the camp unless they're all there is
  return { name: `${out.map((f) => f.name).slice(0, 2).join(" and ")}${out.length > 2 ? " and their friends" : ""} of ${g.name}`, power: out.reduce((a, f) => a + figurePower(f), 0) + out.length * 3, tier: "E", kind: "gang", id: g.id, who: out.map((f) => f.id) };
}

/**
 * Deserters from a war (N26F step 0b): soldiers of the side at war with this place's kingdom, real figures of it who
 * fight, marked deserted. If none can be found, nobody is met.
 */
export function desertersNear(realm: Realm, s: Realm["settlements"][string], day: number, rng: Rng): Foe | null {
  const war = realm.wars.find((w) => w.end === undefined && [...w.attackers, ...w.defenders].some((p) => p === `k:${s.kingdom}` || p === `s:${s.id}`));
  if (!war) return null;
  const mine = (p: string) => p === `k:${s.kingdom}` || p === `s:${s.id}`;
  const enemy = war.attackers.some(mine) ? war.defenders : war.attackers;
  const kingdoms = new Set(enemy.filter((p) => p.startsWith("k:")).map((p) => p.slice(2)));
  const sites = new Set(enemy.filter((p) => p.startsWith("s:")).map((p) => p.slice(2)));
  const soldiers = Object.values(realm.figures)
    .filter((f) => f.alive && !f.talks && !f.away && (f.role === "guard" || f.role === "captain") && f.home && (sites.has(f.home) || kingdoms.has(realm.settlements[f.home]?.kingdom ?? "")))
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  if (soldiers.length === 0) return null;
  const start = Math.floor(rng() * soldiers.length);
  const out = [soldiers[start]!, ...(soldiers.length > 1 ? [soldiers[(start + 1) % soldiers.length]!] : [])];
  for (const f of out) if (!f.deeds.includes(`deserted on day ${day}`)) f.deeds.push(`deserted on day ${day}`);
  return { name: `deserters (${out.map((f) => f.name).join(" and ")})`, power: out.reduce((a, f) => a + figurePower(f), 0) + 6, tier: "E", kind: "war", id: s.id, who: out.map((f) => f.id) };
}

function encounterAt(realm: Realm, id: string, rng: Rng): Foe | null {
  for (const p of Object.values(realm.packs)) {
    if (p.near !== id || p.count < p.cap * 0.6 || rng() >= 0.35) continue;
    return packFoe(realm, p);
  }
  for (const g of gangsNear(realm, id)) {
    if (rng() >= 0.3) continue;
    const foe = gangFoe(realm, g, rng);
    if (foe) return foe;
  }
  const s = realm.settlements[id]!;
  if (atWar(realm, s) && rng() < 0.15) return desertersNear(realm, s, realm.day, rng);
  return null;
}

export function fightOnRoad(realm: Realm, player: PlayerState, foe: Foe, near: string, day: number, rng: Rng, companions: number): string[] {
  const ours = playerPower(player) + companions;
  const lines = [`Near ${near}, ${foe.kind === "pack" ? `${foe.name} comes out of the trees` : foe.kind === "gang" ? `${foe.name} block the road` : `${foe.name} rush you`}.`];
  if (rng() < ours / (ours + foe.power)) {
    const xp = Math.round(QUEST_TIER_XP[foe.tier] * 0.3);
    const levels = playerGainXp(player, xp);
    player.renown = Math.min(100, (player.renown ?? 0) + 2);
    lines.push(`You win through (+${xp} XP${levels > 0 ? `, level ${player.level}!` : ""}).`);
    if (foe.kind === "pack") {
      const p = realm.packs[foe.id];
      if (p) lose(p, 1 + Math.floor(rng() * 2), day, `killed by ${player.name} on the road near ${near}`, "player");
      if (foe.species === "wolf") {
        const k = itemKey("wolf pelt");
        player.inventory[k] = (player.inventory[k] ?? 0) + 1;
        lines.push("You take a wolf pelt.", ...recordCreatureDefeat(player, "wolf"));
      }
    } else if (foe.kind === "gang") {
      const g = realm.factions[foe.id];
      const coin = g ? transfer(realm, `f:${g.id}`, "player", 20 + Math.floor(rng() * 60), "dropped by outlaws on the road", player, day) : 0;
      if (coin > 0) lines.push(`They leave ${formatMoney(coin)} behind as they scatter.`);
      lines.push(...recordCreatureDefeat(player, "bandit"));
    }
    // The losses fall on the people who were there: one of them may not get up again.
    const fallen = (foe.who ?? []).map((id) => realm.figures[id]).filter((f) => f?.alive);
    if (fallen.length > 0 && rng() < 0.5) {
      const f = fallen[Math.floor(rng() * fallen.length)]!;
      if (killFigure(realm, f, day, `killed by ${player.name} on the road near ${near}`)) lines.push(`${f.name} doesn't get up again.`);
    }
    tally(realm, "road_wins");
    realmNews(realm, day, null, "road", `${player.name} beat off ${foe.name} on the road near ${near}.`, 3, [player.name, near]);
    return lines;
  }
  const hurt = Math.ceil(player.maxHp * 0.3);
  player.hp = Math.max(1, player.hp - hurt);
  lines.push(`It goes badly: you take a beating (−${hurt} HP) and get away.`);
  if (foe.kind === "gang") {
    const g = realm.factions[foe.id];
    const taken = g ? transfer(realm, "player", `f:${g.id}`, Math.floor(player.money * 0.3), "robbed on the road", player, day) : 0;
    if (taken > 0) lines.push(`They take ${formatMoney(taken)} from your purse.`);
  }
  tally(realm, "road_losses");
  return lines;
}

/** "5 hours", "a day and a half", "3 days". */
export function describeHours(h: number): string {
  if (h < 20) return `${h} hour${h === 1 ? "" : "s"}`;
  const days = h / 24;
  if (days < 1.25) return "a day";
  if (days < 1.75) return "a day and a half";
  return `${Math.round(days)} days`;
}

export function arrive(player: PlayerState, to: string): void {
  player.site = to;
  // Into the village (N15): the roads in from the realm end there.
  delete player.area;
}

