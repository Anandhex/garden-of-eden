import { Ground, offRoad, seedOf, tileOf, wildPoisNear, type RoadData, type RoadNearby, type RoadPlace, type WildPoi } from "@millbrook/shared";
import { check, streamFor } from "../dice.js";
import { recordEvent } from "../events.js";
import { formatMoney } from "../money.js";
import { skillLevel } from "../../npc/skills.js";
import type { PlayerState } from "../../npc/types.js";
import { transfer } from "../realm/ledger.js";
import { realmNews } from "../realm/log.js";
import type { Realm } from "../realm/types.js";
import type { Town } from "../town.js";
import { weatherOn, whereOf } from "../weather.js";
import { groundAt, landOf, nearestRoad } from "./ground.js";
import { sightAt, stockTerritory } from "./hostiles.js";
import { useOldPlace } from "./roadside.js";
import { learnRoadsNear } from "./fast.js";

/**
 * The wilds (N27): places off the road and the player's map of them. Two sources: seeded places (shared/road/wilds.ts,
 * drawn in the chunks) and places from the realm's state, worked out here and sent to the browser only once known: a
 * pack's lair, a dungeon's mouth, the ruins of an abandoned place, an old battlefield. (A gang's hidden camp is N26F's,
 * `roadside.ts` `campsNear`, found the same way.) Nothing is on the player's map (`player.map`) until they find it
 * (walk within sight of it and spot it), hear of it (an innkeeper, a farmer) or read it on a bought map. Off the road
 * without a map of the country or a guide they can lose their way; finds that matter can be reported to a place's head.
 */

export type StateKind = "lair" | "dungeon" | "abandoned" | "battlefield";

/** A place in the wilds from the realm's state. */
export interface StatePoi {
  id: string;
  kind: StateKind;
  x: number;
  y: number;
  name: string;
  /** The pack, dungeon, settlement or war it comes from. */
  ref: string;
  hidden: number;
  /** For a battlefield: the settlement it was fought for, and the day. */
  at?: string;
  day?: number;
}

/** A place on the player's map. */
export interface KnownPlace {
  day: number;
  how: "found" | "told" | "map";
  kind: string;
  name: string;
  x: number;
  y: number;
  /** Reported to a place's head (its id), or sold. */
  reported?: string;
}

/** What the player keeps of the wilds (N27): the places they know, and being lost. */
export interface WildState {
  pois: Record<string, KnownPlace>;
  lost?: { since: number };
}

export const mapOf = (p: PlayerState): WildState => (p.map ??= { pois: {} });

/** Finds worth reporting to a place's head, and the copper each is worth to it. */
export const FIND_VALUE: Record<string, number> = { ore: 120, ruin: 60, cave: 30, dungeon: 150, lair: 80, battlefield: 20 };
/** A bought map of the country: its price and reach (tiles). */
export const MAP_PRICE = 60;
export const MAP_REACH = 3000;
/** How far an innkeeper or a farmer knows the country round. */
export const TOLD_REACH = 2500;
/** Off the road by this many tiles: in the wilds. */
export const WILDS = 40;

// ---------- places from the realm ----------

const h32 = (...parts: Array<string | number>) => seedOf(parts.join("|")) >>> 0;

/** A spot off the road between `lo` and `hi` tiles from a point, by a seeded bearing (tries a few). */
function spotOffRoad(data: RoadData, from: { x: number; y: number }, key: string, lo: number, hi: number): { x: number; y: number } | null {
  for (let k = 0; k < 12; k++) {
    const h = h32(key, k);
    const a = ((h % 3600) / 3600) * Math.PI * 2;
    const r = lo + ((h >>> 12) % Math.max(1, hi - lo));
    const p = { x: Math.round(from.x + Math.cos(a) * r), y: Math.round(from.y + Math.sin(a) * r) };
    if (offRoad(data, p.x, p.y)) return p;
  }
  return null;
}

const statesMemo = new WeakMap<Realm, { key: string; list: StatePoi[] }>();

/**
 * The realm's places in the wilds as it stands: a lair for every pack with beasts (in its range near the place it
 * hunts, fixed by the pack's id so it stays put while the pack lives), a mouth for every dungeon, the ruins of every
 * abandoned place, and a field for every battle of every war (by the place it was fought for).
 */
export function statePois(realm: Realm, data: RoadData): StatePoi[] {
  const key = `${realm.day}|${Object.keys(realm.packs).length}|${realm.wars.length}|${Object.keys(realm.dungeons).length}`;
  const hit = statesMemo.get(realm);
  if (hit && hit.key === key) return hit.list;
  const out: StatePoi[] = [];
  const centre = (id: string) => {
    const s = realm.settlements[id];
    return s ? { x: tileOf(s.pos.x), y: tileOf(s.pos.y) } : null;
  };
  for (const p of Object.values(realm.packs).sort((a, b) => a.id.localeCompare(b.id))) {
    if (p.count <= 0) continue;
    const c = centre(p.near);
    const at = c && spotOffRoad(data, c, `lair|${realm.seed}|${p.id}`, 900, 1700);
    if (at) out.push({ id: `lair:${p.id}`, kind: "lair", ...at, name: `a ${p.species}s' lair`, ref: p.id, hidden: 0.3 });
  }
  for (const d of Object.values(realm.dungeons).sort((a, b) => a.id.localeCompare(b.id))) out.push({ id: `dungeon:${d.id}`, kind: "dungeon", x: tileOf(d.pos.x), y: tileOf(d.pos.y), name: `the mouth of ${d.name}`, ref: d.id, hidden: 0.2 });
  for (const s of Object.values(realm.settlements).sort((a, b) => a.id.localeCompare(b.id))) {
    if (!s.abandoned || s.way) continue;
    out.push({ id: `abandoned:${s.id}`, kind: "abandoned", x: tileOf(s.pos.x), y: tileOf(s.pos.y), name: `the ruins of ${s.name}`, ref: s.id, hidden: 0 });
  }
  for (const w of realm.wars) {
    w.battles.forEach((b, i) => {
      const c = centre(b.at);
      const at = c && spotOffRoad(data, c, `field|${w.id}|${i}`, 500, 1100);
      if (at) out.push({ id: `battle:${w.id}:${i}`, kind: "battlefield", ...at, name: `the battlefield before ${realm.settlements[b.at]?.name ?? b.at}`, ref: w.id, hidden: 0, at: b.at, day: b.day });
    });
  }
  statesMemo.set(realm, { key, list: out });
  return out;
}

/** Every place in the wilds near a point: seeded ones and the realm's. */
export function wildNear(realm: Realm, x: number, y: number, r: number): Array<WildPoi | StatePoi> {
  const data = landOf(realm).data;
  return [...wildPoisNear(data, x, y, r), ...statePois(realm, data).filter((p) => Math.abs(p.x - x) <= r && Math.abs(p.y - y) <= r && Math.hypot(p.x - x, p.y - y) <= r)];
}

// ---------- finding them ----------

const isFind = (kind: string) => kind in FIND_VALUE;

/** Put a place on the player's map. True if it is new to them. */
export function learnPlace(p: PlayerState, poi: { id: string; kind: string; name: string; x: number; y: number }, how: KnownPlace["how"], day: number): boolean {
  const m = mapOf(p);
  if (m.pois[poi.id]) return false;
  m.pois[poi.id] = { day, how, kind: poi.kind, name: poi.name, x: poi.x, y: poi.y };
  return true;
}

/**
 * The player looks about as they walk (each step off the road, or near it): places within sight are spotted unless
 * hidden and missed (a perception check, rolled once a day for each place, so stepping back and forth doesn't re-roll).
 * Returns lines for the log.
 */
export function spotPlaces(town: Town): string[] {
  const realm = town.world.realm;
  const p = town.world.player;
  const road = p.road;
  if (!realm || !road) return [];
  const land = landOf(realm);
  const sight = sightAt(groundAt(land, road.x, road.y), town.world.hour);
  const day = town.world.day;
  const m = mapOf(p);
  const lines: string[] = [];
  for (const poi of wildNear(realm, road.x, road.y, sight)) {
    if (m.pois[poi.id]) continue;
    const near = Math.hypot(poi.x - road.x, poi.y - road.y) <= 4;
    if (!near && poi.hidden > 0) {
      const rng = streamFor(town.world.seed, "spot", poi.id, day);
      const target = 8 + Math.round(poi.hidden * 12);
      if (!check(rng, p.attributes.perception, target, skillLevel(p.skills, "survival")).success) continue;
    }
    learnPlace(p, poi, "found", day);
    lines.push(`You come upon ${poi.name}.`);
    if (isFind(poi.kind)) recordEvent(town.world as never, { kind: "discovered", actor: "player", target: poi.id, details: `found ${poi.name}`, importance: 2, why: "exploring off the road", witnesses: [] });
  }
  return lines;
}

/** The innkeeper or the farmer tells of the country round: the nearest few places the player doesn't know (seeded, and lairs and battlefields: what local people know). */
export function hearOfPlaces(town: Town, from: { x: number; y: number }, n = 3): string[] {
  const realm = town.world.realm;
  if (!realm) return [];
  const p = town.world.player;
  const m = mapOf(p);
  const near = wildNear(realm, from.x, from.y, TOLD_REACH)
    .filter((x) => !m.pois[x.id] && x.kind !== "dungeon")
    .sort((a, b) => Math.hypot(a.x - from.x, a.y - from.y) - Math.hypot(b.x - from.x, b.y - from.y) || (a.id < b.id ? -1 : 1))
    .slice(0, n);
  if (near.length === 0) return ["\"Nothing out there you don't know of already.\""];
  for (const x of near) learnPlace(p, x, "told", town.world.day);
  return [`They tell you of ${near.map((x) => `${x.name} (${bearing(from, x)})`).join(", ")}.`];
}

/** Buy a map of the country: every seeded place within MAP_REACH (not the realm's secrets). */
export function buyMap(town: Town, from: { x: number; y: number }, seller: string): string[] {
  const realm = town.world.realm;
  const p = town.world.player;
  if (!realm) return [];
  if (p.money < MAP_PRICE) return [`A map of the country costs ${formatMoney(MAP_PRICE)}.`];
  p.money -= MAP_PRICE;
  if (seller.startsWith("s:")) transfer(realm, "player", seller, MAP_PRICE, "a map of the country", p, town.world.day);
  const data = landOf(realm).data;
  let n = 0;
  for (const x of wildPoisNear(data, from.x, from.y, MAP_REACH)) if (learnPlace(p, x, "map", town.world.day)) n++;
  // The roads of the country it shows, for fast travel (N26 Part C1).
  const roads = learnRoadsNear(p, data, from, MAP_REACH * 2);
  return [`You buy a map of the country round for ${formatMoney(MAP_PRICE)}. It marks ${n} place${n === 1 ? "" : "s"} you didn't know${roads > 0 ? `, and ${roads} road${roads === 1 ? "" : "s"}` : ""}.`];
}

function bearing(from: { x: number; y: number }, to: { x: number; y: number }): string {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dir = Math.abs(dx) > Math.abs(dy) * 2 ? (dx > 0 ? "east" : "west") : Math.abs(dy) > Math.abs(dx) * 2 ? (dy > 0 ? "south" : "north") : `${dy > 0 ? "south" : "north"}${dx > 0 ? "east" : "west"}`;
  const hours = Math.max(1, Math.round(Math.hypot(dx, dy) / 420));
  return `${hours} hour${hours === 1 ? "" : "s"} ${dir}`;
}

// ---------- at a place ----------

/** The known places within reach of the player, with what can be done there. */
export function wildNearby(town: Town, radius = 8): RoadNearby[] {
  const realm = town.world.realm;
  const road = town.world.player.road;
  if (!realm || !road) return [];
  const m = mapOf(town.world.player);
  const out: RoadNearby[] = [];
  for (const poi of wildNear(realm, road.x, road.y, radius)) {
    if (!m.pois[poi.id]) continue;
    out.push({ id: poi.id, kind: poi.kind, name: poi.name, x: poi.x, y: poi.y, offers: offersOf(poi.kind) });
  }
  return out;
}

function offersOf(kind: string): RoadNearby["offers"] {
  switch (kind) {
    case "cave":
    case "ruin":
      return [{ op: "search", label: kind === "cave" ? "Go in and look about" : "Search the ruin" }];
    case "herbs":
      return [{ op: "gather", label: "Gather herbs" }];
    case "ore":
      return [{ op: "dig", label: "Dig ore (needs a pick)" }];
    case "stones":
      return [{ op: "look", label: "Look at the stones" }];
    case "grove":
      return [{ op: "rest", label: "Rest a while in the grove" }];
    case "hut":
      return [{ op: "look", label: "Look in at the hut" }];
    case "lair":
      return [{ op: "look", label: "Creep close and look" }];
    case "dungeon":
      return [{ op: "look", label: "Look into the dark" }];
    case "abandoned":
      return [{ op: "search", label: "Walk the ruins" }];
    case "battlefield":
      return [{ op: "graves", label: "Read the graves" }];
    default:
      return [];
  }
}

/** Do something at a known place in the wilds. */
export function useWild(town: Town, id: string, op: string, minute: number): string[] {
  const realm = town.world.realm;
  const p = town.world.player;
  const road = p.road;
  if (!realm || !road) return ["You're not out in the country."];
  const poi = wildNear(realm, road.x, road.y, 10).find((x) => x.id === id);
  if (!poi || !mapOf(p).pois[id]) return ["That is out of reach."];
  const day = town.world.day;
  switch (poi.kind) {
    case "cave":
    case "ruin":
    case "herbs":
    case "ore":
    case "stones":
      // The same as their roadside kin (N26F).
      return useOldPlace(town, { id: poi.id, kind: poi.kind, name: poi.name, road: "", t: 0, at: { x: poi.x, y: poi.y }, on: { x: poi.x, y: poi.y } } as RoadPlace, op === "look" && poi.kind === "stones" ? "look" : op, minute);
    case "grove": {
      const used = (road.used ??= {});
      if (used[poi.id] === day) return ["You've rested here today already."];
      used[poi.id] = day;
      town.walkMinutes(30);
      p.hp = Math.min(p.maxHp, p.hp + Math.max(1, Math.round(p.maxHp * 0.08)));
      return ["You sit a while under the old trees. It's very quiet."];
    }
    case "hut":
      return ["A hermit's hut: a cold hearth, a pallet, dried herbs hung from the beam. Whoever lives here is out. A roof for the night, if you need one."];
    case "lair": {
      const pack = realm.packs[poi.ref];
      if (!pack || pack.count <= 0) return ["Old bones and a stale smell. Nothing lives here now."];
      const made = road.met[`lair:${pack.id}`] === day ? [] : stockTerritory(town, { id: `lair:${pack.id}`, kind: "pack", owner: pack.id, road: "", t0: 0, t1: 0, width: 0, near: pack.near }, streamFor(town.world.seed, "lair", pack.id, day));
      road.met[`lair:${pack.id}`] = day;
      for (const c of made) c.pos = { x: poi.x + ((c.uid.length % 5) - 2), y: poi.y + 2 };
      return [made.length > 0 ? `${pack.count} ${pack.species}s den here. They've smelled you: ${made.length} come out.` : `${pack.count} ${pack.species}s den here. You back away before they know you were near.`];
    }
    case "dungeon": {
      const d = realm.dungeons[poi.ref];
      return [d ? `The mouth of ${d.name}: steps going down into the dark. ${d.danger > 60 ? "Something moves far below." : "It's quiet."} (The adventurers' guild sends delvers here.)` : "A hole in the ground."];
    }
    case "abandoned":
      return ruinsOf(town, poi as StatePoi);
    case "battlefield":
      return gravesOf(town, poi as StatePoi);
  }
  return ["Nothing to be done here."];
}

/** Walking an abandoned place's ruins: its last people's graves, and what emptied it (from the realm's record). */
function ruinsOf(town: Town, poi: StatePoi): string[] {
  const realm = town.world.realm!;
  const s = realm.settlements[poi.ref];
  if (!s) return ["Fallen walls and nettles."];
  const dead = (town.store?.people.diedAt(s.id, Math.max(0, town.world.day - 200)) ?? []).slice(-4);
  const why = [...realm.news].reverse().find((n) => n.at === s.id);
  const lines = [`The ruins of ${s.name}: roofless houses, a well choked with leaves.`];
  if (why) lines.push(`Scratched on a doorpost, or remembered by the stones: ${why.text}`);
  if (dead.length > 0) lines.push(`Graves by the old chapel: ${dead.map((r) => r.name).join(", ")}.`);
  return lines;
}

/** The graves at a battlefield: the names of those of the place fought for who died in battle about that day. */
export function gravesOf(town: Town, poi: StatePoi): string[] {
  const at = poi.at ?? "";
  const day = poi.day ?? 0;
  const rows = (town.store?.people.diedAt(at, Math.max(0, day - 2)) ?? []).filter((r) => {
    const d = r.death ? (JSON.parse(r.death) as { cause?: string; day?: number }) : null;
    return d && (d.cause === "battle" || d.cause === "siege") && (d.day ?? 0) <= day + 2;
  });
  const realm = town.world.realm!;
  const text = realm.wars.find((w) => w.id === poi.ref)?.battles.find((b) => b.at === at && b.day === day)?.text;
  if (rows.length === 0) return [`Grassed-over mounds where the battle was fought${text ? `: ${text}` : ""}. No names you can read.`];
  return [`Rows of graves where the battle was fought${text ? ` (${text})` : ""}.`, `Names cut in the boards: ${rows.slice(0, 6).map((r) => r.name).join(", ")}${rows.length > 6 ? ` and ${rows.length - 6} more` : ""}.`];
}

// ---------- getting lost ----------

/** Is the player off the road, in the wilds? */
export function inWilds(town: Town): boolean {
  const realm = town.world.realm;
  const road = town.world.player.road;
  if (!realm || !road) return false;
  return !nearestRoad(landOf(realm), road, WILDS);
}

/** Someone with them who knows the country: a companion with skill in survival or hunting. */
export function hasGuide(town: Town): boolean {
  return town.companions().some((c) => Math.max(skillLevel(c.persona.skills, "survival"), skillLevel(c.persona.skills, "hunting")) >= 2);
}

/** A bought or drawn map that covers here. */
function mapCovers(town: Town): boolean {
  const road = town.world.player.road!;
  return Object.values(mapOf(town.world.player).pois).some((k) => k.how === "map" && Math.hypot(k.x - road.x, k.y - road.y) <= MAP_REACH);
}

/**
 * Once a game hour off the road: without a map of the country or a guide, the player may lose their bearings (a
 * perception check helped by survival, harder at night, in fog, storm or snow, and in marsh and forest). Lost, they find
 * the way again by reaching the road, a place they know, water to follow, or a later check.
 */
export function lostHour(town: Town): string[] {
  const p = town.world.player;
  const road = p.road;
  const realm = town.world.realm;
  if (!road || !realm) return [];
  const m = mapOf(p);
  const land = landOf(realm);
  const ground = groundAt(land, road.x, road.y);
  const weather = weatherOn(town.world.day, whereOf(town.world));
  const night = town.world.hour >= 20 || town.world.hour < 5;
  const thick = ground === Ground.marsh || ground === Ground.reeds || ground === Ground.tree;
  const target = 9 + (night ? 5 : 0) + (weather === "fog" || weather === "storm" || weather === "snow" ? 4 : 0) + (thick ? 3 : 0);
  const rng = streamFor(town.world.seed, "lost", town.world.day, town.world.hour);
  const r = check(rng, p.attributes.perception, target, 2 * skillLevel(p.skills, "survival"));
  if (m.lost) {
    if (!inWilds(town)) {
      delete m.lost;
      return ["You strike the road again, and know where you are."];
    }
    if (knownWithin(town, 12) || waterWithin(town, 3)) {
      delete m.lost;
      return ["You know this place: you have your bearings again."];
    }
    if (r.success && r.total >= target + 3) {
      delete m.lost;
      return ["The lie of the land comes clear: you know which way the road is."];
    }
    return [];
  }
  if (!inWilds(town) || hasGuide(town) || mapCovers(town)) return [];
  if (r.success) return [];
  m.lost = { since: town.world.day * 1440 + town.world.hour * 60 };
  return [thick ? "The ground looks the same every way you turn. You're not sure where you are." : "You've lost your bearings. You're not sure where you are."];
}

function knownWithin(town: Town, r: number): boolean {
  const road = town.world.player.road!;
  return Object.values(mapOf(town.world.player).pois).some((k) => Math.hypot(k.x - road.x, k.y - road.y) <= r);
}

function waterWithin(town: Town, r: number): boolean {
  const realm = town.world.realm!;
  const road = town.world.player.road!;
  const land = landOf(realm);
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (groundAt(land, road.x + dx, road.y + dy) === Ground.water) return true;
  return false;
}

/** Lost, a step can go astray: a turn left or right of where they meant (seeded by where they are and the minute). */
export function driftStep(town: Town, dx: number, dy: number): { dx: number; dy: number; astray: boolean } {
  const p = town.world.player;
  if (!mapOf(p).lost || !p.road) return { dx, dy, astray: false };
  const rng = streamFor(town.world.seed, "drift", p.road.x, p.road.y, town.world.day, town.world.hour, town.world.minute ?? 0);
  const roll = rng();
  if (roll >= 0.3) return { dx, dy, astray: false };
  return roll < 0.15 ? { dx: -dy, dy: dx, astray: true } : { dx: dy, dy: -dx, astray: true };
}

// ---------- reporting finds ----------

/** Finds on the player's map not yet reported, that a place would pay for. */
export function unreported(p: PlayerState): Array<{ id: string } & KnownPlace> {
  return Object.entries(mapOf(p).pois)
    .filter(([, k]) => k.how === "found" && !k.reported && isFind(k.kind))
    .map(([id, k]) => ({ id, ...k }));
}

/** The finds a place's coffers can answer: what it pays, and the find books (N63 turns these into mines and expeditions). */
export interface Find {
  poi: string;
  kind: string;
  name: string;
  reportedTo: string;
  day: number;
  paid: number;
}

/**
 * Report a find to the head of the place the player is in: paid from its coffers by what it is worth (as far as they
 * can pay), recorded in the realm's finds and as news of the place. The ruler hears of it; N63 makes something of it.
 */
export function reportFind(town: Town, poiId: string): string[] {
  const realm = town.world.realm;
  const p = town.world.player;
  if (!realm || p.road) return ["Report it in a town or village, to whoever runs it."];
  const site = town.site();
  const s = realm.settlements[site];
  const k = mapOf(p).pois[poiId];
  if (!s || !k) return ["You have nothing to report."];
  if (k.reported) return [`You've already reported ${k.name}.`];
  if (k.how !== "found") return ["You can only vouch for what you've seen with your own eyes."];
  const head = s.leader ? realm.figures[s.leader] : undefined;
  if (!head) return [`Nobody in ${s.name} to report it to.`];
  const value = FIND_VALUE[k.kind] ?? 0;
  const paid = transfer(realm, `s:${site}`, "player", value, `a find reported: ${k.name}`, p, town.world.day);
  k.reported = site;
  const finds = (realm.finds ??= []);
  finds.push({ poi: poiId, kind: k.kind, name: k.name, reportedTo: site, day: town.world.day, paid });
  realmNews(realm, town.world.day, site, "find", `${p.name} brought word to ${s.name} of ${k.name} out in the wilds.`, k.kind === "ore" || k.kind === "dungeon" ? 3 : 2, [s.name]);
  return [`You tell ${head.name} of ${k.name}. ${paid > 0 ? `${s.name} pays you ${formatMoney(paid)} for it.` : `${s.name}'s coffers are empty, but it's noted.`}`];
}

// ---------- bounds ----------

/** Most lairs near one place (N27's `pois-band`): no realm covered in lairs. */
export const MAX_LAIRS = 4;

/** N27's bounds: `pois-band` (lairs per place), and the finds reported (a count, never failing). */
export function checkWildBounds(realm: Realm): Array<{ name: string; ok: boolean; detail: string }> {
  const lairs = new Map<string, number>();
  for (const p of Object.values(realm.packs)) if (p.count > 0) lairs.set(p.near, (lairs.get(p.near) ?? 0) + 1);
  const worst = [...lairs.entries()].sort((a, b) => b[1] - a[1])[0];
  return [
    { name: "pois-band", ok: !worst || worst[1] <= MAX_LAIRS, detail: worst ? `at most ${worst[1]} lairs near ${realm.settlements[worst[0]]?.name ?? worst[0]}` : "no lairs" },
    { name: "finds-reported", ok: true, detail: `${realm.finds?.length ?? 0} finds reported` },
  ];
}
