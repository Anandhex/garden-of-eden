import { Ground, isSolidGround, type RoadPoint, type Territory } from "@millbrook/shared";
import { type Creature, spawnCreature } from "../creatures.js";
import { streamFor, type Rng } from "../dice.js";
import type { Life } from "../life.js";
import { formatMoney } from "../money.js";
import { GANG_DEN, MAX_ON_MAP, stockPack } from "../realm/haunts.js";
import { transfer } from "../realm/ledger.js";
import { plural } from "../realm/names.js";
import type { Realm } from "../realm/types.js";
import { gangMembers } from "../realm/who.js";
import type { Town } from "../town.js";
import { weatherOn } from "../weather.js";
import { groundAt, landOf } from "./ground.js";
import { territoriesAt } from "./territories.js";

/**
 * Hostiles on the road map (N26F decisions 4–6). While the player walks inside a pack's or a gang's territory, each game
 * hour there is a chance they come out (by kind and time of day: wolves at dusk, night and dawn; bears and boars by day;
 * gangs by day, less in rain), at most once per territory per day (`road.met`), and only while the pack is at least 60%
 * of its cap or the gang has someone about. Then the pack's own beasts (rows) or the gang's members (figures, by name)
 * are put on the road map 40 to 70 tiles off, out of sight, and come on. When they come into sight the player is told
 * (the distance is the country's: open land far, woods near, night nearer), and can turn back, go round, or fight; a gang
 * first demands a toll. Fights are the map's own combat on these creatures (`town.roadCreatures`); what happens is
 * written back as on a place's map (haunts.ts). Past UNSTOCK tiles they are gone again, the survivors back in their pack.
 */

/** Tiles out where they turn up. */
export const STOCK_NEAR = 40;
export const STOCK_FAR = 70;
/** Past this distance they go back to the wild. */
export const UNSTOCK = 120;
/** Most creatures on the road near the player at once (all territories together). */
export const MAX_ROAD_CREATURES = 8;
/** Copper a head a gang asks to let the player by. */
export const TOLL_PER_HEAD = 12;

/** Where a beast or an outlaw can go: anywhere but water and buildings (through trees, reeds and rocks). */
const roamable = (g: number) => g !== Ground.water && g !== Ground.wall && g !== Ground.farmhouse && g !== Ground.thatch && g !== Ground.bar && g !== Ground.stones && g !== Ground.ruin;

/** The chance in a game hour that a territory's owners come out now. */
export function hourlyChance(kind: "pack" | "gang", species: string | null, hour: number, weather: string): number {
  const night = hour >= 20 || hour < 5;
  const twilight = (hour >= 17 && hour < 20) || (hour >= 5 && hour < 7);
  if (kind === "gang") return (hour >= 7 && hour < 19 ? 0.3 : 0.06) * (weather === "rain" || weather === "storm" ? 0.5 : 1);
  if (species === "bear" || species === "boar") return night ? 0.08 : twilight ? 0.2 : 0.25;
  return night ? 0.35 : twilight ? 0.45 : 0.06;
}

/** How far the player sees them coming: open country far, woods and marsh near, night nearer. */
export function sightAt(ground: number, hour: number): number {
  const base = ground === Ground.tree || ground === Ground.marsh || ground === Ground.reeds ? 18 : ground === Ground.hill || ground === Ground.rock ? 30 : 45;
  return Math.round(base * (hour >= 20 || hour < 5 ? 0.5 : hour >= 18 || hour < 6 ? 0.75 : 1));
}

const compass = (from: RoadPoint, to: RoadPoint) => {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  return Math.abs(dx) > Math.abs(dy) * 2 ? (dx > 0 ? "east" : "west") : Math.abs(dy) > Math.abs(dx) * 2 ? (dy > 0 ? "south" : "north") : `${dy > 0 ? "south" : "north"}${dx > 0 ? "east" : "west"}`;
};

const words = ["one", "two", "three", "four", "five", "six", "seven", "eight"];

/** A free tile `d` tiles from the player in some direction, or null. */
function spotNear(town: Town, from: RoadPoint, rng: Rng): RoadPoint | null {
  const land = landOf(town.world.realm!);
  for (let i = 0; i < 16; i++) {
    const a = rng() * Math.PI * 2;
    const d = STOCK_NEAR + rng() * (STOCK_FAR - STOCK_NEAR);
    const x = Math.round(from.x + Math.cos(a) * d);
    const y = Math.round(from.y + Math.sin(a) * d);
    if (!isSolidGround(groundAt(land, x, y))) return { x, y };
  }
  return null;
}

/** Put a territory's owners on the road map. Returns the creatures (none if nobody comes). */
export function stockTerritory(town: Town, t: Territory, rng: Rng): Creature[] {
  const realm = town.world.realm!;
  const here = town.roadCreatures;
  const day = town.world.day;
  const at = town.world.player.road!;
  const room = Math.max(0, MAX_ROAD_CREATURES - Object.values(here).filter((c) => !c.outcome).length);
  if (room === 0) return [];
  let made: Creature[] = [];
  if (t.kind === "pack") {
    const p = realm.packs[t.owner];
    if (!p) return [];
    made = stockPack(realm, here, p, `road-${t.owner}`, town.templates, day, rng, town.store?.beasts, "road", Math.min(MAX_ON_MAP, room));
  } else {
    const g = realm.factions[t.owner];
    const tpl = town.templates.bandit;
    if (!g || !tpl) return [];
    const about = gangMembers(realm, g.id).filter((f) => f.id !== g.leader || gangMembers(realm, g.id).length === 1);
    const n = Math.min(room, about.length, 2 + Math.floor(rng() * 3));
    for (const f of about.slice(0, n)) {
      if (Object.values(here).some((c) => c.figure === f.id && !c.outcome)) continue;
      const c = spawnCreature(tpl, `road-${g.id}-${f.id}`, day, rng, f.name);
      c.figure = f.id;
      c.den = GANG_DEN;
      c.life = structuredClone(f.life) as Life;
      here[c.uid] = c;
    }
    made = Object.values(here).filter((c) => c.figure && g.members.includes(c.figure));
  }
  for (const c of made) {
    if (c.pos) continue;
    const spot = spotNear(town, at, rng);
    if (spot) c.pos = spot;
    else delete here[c.uid];
  }
  const out = made.filter((c) => here[c.uid]);
  for (const c of out) town.roadTerritoryOf.set(c.uid, t.id);
  return out;
}

/**
 * Each step on the road: maybe they come out, they come on, the player sees them, a gang asks its toll, the far ones go.
 * Returns lines for the player.
 */
export function hostilesStep(town: Town, rng: Rng): string[] {
  const realm = town.world.realm;
  const p = town.world.player;
  const road = p.road;
  if (!realm || !road) return [];
  const land = landOf(realm);
  const day = town.world.day;
  const hour = town.world.hour;
  const lines: string[] = [];
  // Out: a roll a game hour, made once the hour turns (the step that crosses into it).
  const hourKey = `${day}:${hour}`;
  if (town.roadHourRolled !== hourKey) {
    town.roadHourRolled = hourKey;
    for (const { t } of territoriesAt(realm, land.data, road)) {
      if (road.met[t.id] === day) continue;
      if (!strongEnough(realm, t)) continue;
      const species = t.kind === "pack" ? (realm.packs[t.owner]?.species ?? null) : null;
      const roll = streamFor(realm.seed, "hostiles", t.id, day, hour)();
      if (roll >= hourlyChance(t.kind, species, hour, weatherOn(day, { realm, tile: road }))) continue;
      road.met[t.id] = day;
      const made = stockTerritory(town, t, rng);
      if (made.length > 0) town.roadSighted.delete(t.id);
    }
  }
  // On: each comes a tile closer (most steps), unless it's holding back.
  const creatures = Object.values(town.roadCreatures).filter((c) => !c.outcome && c.pos);
  for (const c of creatures) {
    if (town.roadHeld.has(c.uid) || c.uid === town.roadEngaged) continue;
    const t = town.templates[c.template];
    const d = Math.hypot(c.pos!.x - road.x, c.pos!.y - road.y);
    // A bear or a boar by day minds its own business unless you come close.
    if ((c.template === "bear" || c.template === "boar") && hour >= 7 && hour < 19 && d > 8) continue;
    if (!t?.aggressive || d <= 1.5 || rng() >= (c.den === GANG_DEN ? 0.8 : 0.9)) continue;
    // The step that brings it nearest, through the woods if need be (beasts and outlaws go where the player can't).
    const steps = ([[1, 0], [-1, 0], [0, 1], [0, -1]] as const)
      .map(([dx, dy]) => ({ x: c.pos!.x + dx, y: c.pos!.y + dy }))
      .filter((q) => roamable(groundAt(land, q.x, q.y)) && !creatures.some((o) => o !== c && o.pos?.x === q.x && o.pos?.y === q.y) && !(q.x === road.x && q.y === road.y))
      .sort((a, b) => Math.hypot(a.x - road.x, a.y - road.y) - Math.hypot(b.x - road.x, b.y - road.y));
    if (steps[0] && Math.hypot(steps[0].x - road.x, steps[0].y - road.y) < d) c.pos = steps[0];
  }
  // Seen: once per group, when the first of them comes into sight.
  const sight = sightAt(groundAt(land, road.x, road.y), hour);
  const groups = new Map<string, Creature[]>();
  for (const c of creatures) {
    const tid = town.roadTerritoryOf.get(c.uid);
    if (tid) groups.set(tid, [...(groups.get(tid) ?? []), c]);
  }
  for (const [tid, group] of groups) {
    const near = group.filter((c) => Math.hypot(c.pos!.x - road.x, c.pos!.y - road.y) <= sight);
    if (near.length === 0 || town.roadSighted.has(tid)) continue;
    town.roadSighted.add(tid);
    const first = near[0]!;
    const where = groundAt(land, first.pos!.x, first.pos!.y) === Ground.tree ? "in the trees" : "on the road";
    if (group[0]!.den === GANG_DEN) {
      const gang = realm.factions[tid.slice(5)];
      const ask = TOLL_PER_HEAD * Math.max(1, group.length);
      lines.push(`${group.map((c) => c.name).slice(0, 2).join(" and ")}${group.length > 2 ? ` and ${words[group.length - 3] ?? group.length - 2} more` : ""} of ${gang?.name ?? "a gang"} step out ${where} to the ${compass(road, first.pos!)}. "Toll," says ${group[0]!.name}. "${formatMoney(ask)}, and you go on whole."`);
      for (const c of group) town.roadHeld.add(c.uid);
      if (!road.pending) road.pending = { kind: "toll", key: tid, id: gang?.id ?? tid, amount: ask };
    } else {
      const kind = first.template;
      const named = group.find((c) => c.figure);
      lines.push(`${group.length === 1 ? `A ${kind}` : `${plural(kind)[0]!.toUpperCase()}${plural(kind).slice(1)}, ${words[group.length - 1] ?? group.length} of them`}, ${where} to the ${compass(road, first.pos!)}${named ? `; ${named.name} among them` : ""}.`);
    }
  }
  // Gone: far behind, back to the wild (rows and figures stay as they are, hurt and all).
  for (const c of Object.values(town.roadCreatures)) {
    if (c.uid === town.roadEngaged || !c.pos) continue;
    if (c.outcome || Math.hypot(c.pos.x - road.x, c.pos.y - road.y) > UNSTOCK) town.dropRoadCreature(c.uid);
  }
  return lines;
}

/** A pack below 60% of its cap or a gang with nobody about doesn't come out. */
export function strongEnough(realm: Realm, t: Territory): boolean {
  if (t.kind === "pack") {
    const p = realm.packs[t.owner];
    return !!p && p.count >= Math.ceil(p.cap * 0.6);
  }
  const g = realm.factions[t.owner];
  return !!g && g.dissolved === undefined && gangMembers(realm, g.id).length > 0;
}

/** The player answers a gang's toll: pay it, refuse (they come on), or turn back (they let you go the way you came). */
export function answerToll(town: Town, choice: string): { ok: boolean; lines: string[] } {
  const realm = town.world.realm;
  const p = town.world.player;
  const pend = p.road?.pending;
  if (!realm || !pend || pend.kind !== "toll") return { ok: false, lines: ["Nobody is asking you for anything."] };
  const group = Object.values(town.roadCreatures).filter((c) => town.roadTerritoryOf.get(c.uid) === pend.key && !c.outcome);
  delete p.road!.pending;
  if (choice === "pay") {
    if (p.money < pend.amount) {
      p.road!.pending = pend;
      return { ok: false, lines: [`You haven't ${formatMoney(pend.amount)}.`] };
    }
    transfer(realm, "player", `f:${pend.id}`, pend.amount, "a toll on the road", p, town.world.day);
    for (const c of group) town.dropRoadCreature(c.uid);
    return { ok: true, lines: [`You pay ${formatMoney(pend.amount)}. They step back into the trees.`] };
  }
  if (choice === "back") {
    // They watch you go; they're still there if you come back today.
    return { ok: true, lines: ["You turn back the way you came. They watch you go."] };
  }
  for (const c of group) town.roadHeld.delete(c.uid);
  return { ok: true, lines: [`"Have it your way." ${group[0]?.name ?? "They"} draw${group.length === 1 ? "s" : ""} steel.`] };
}
