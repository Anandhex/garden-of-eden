import { DAY_WALK_UNITS } from "@millbrook/shared";
import { seededRng, type Rng } from "../dice.js";
import type { Tier } from "../life.js";
import { leaderRole, makeFigure, takenNames } from "./figures.js";
import { freezeHouses } from "./houses.js";
import { addWaystations } from "../road/waystations.js";
import { COLORS, dungeonName, factionName, kingdomName, pick, placeName } from "./names.js";
import type { BuildingId, Figure, Kingdom, Realm, RealmFaction, Role, Settlement, SettlementKind, Terrain } from "./types.js";

/**
 * A new realm (N13.1), rolled from a seed: three kingdoms, each a capital with a
 * city, towns, villages and hamlets under it, joined by roads; their heads and
 * notable folk; the crowns, a guild or two and a bandit gang each; dungeons and
 * beast packs in the wild. A village sits under a town under a city under a
 * kingdom's capital. Every settlement is made the same way: nothing here knows which one the
 * player will start in (game/realm/start.ts picks it afterwards, from the seed).
 */
export const REALM_W = 1000;
export const REALM_H = 700;
/** Map units a traveller covers in a day (news, migrants, armies). */
export const TRAVEL_PER_DAY = DAY_WALK_UNITS;
/** Rank of a settlement's head, by kind. */
const LEADER_TIER: Record<SettlementKind, Tier[]> = { capital: ["C", "B"], city: ["D", "C"], town: ["E", "D"], village: ["F", "E"], hamlet: ["G", "F"] };
const POPULATION: Record<SettlementKind, [number, number]> = { capital: [2600, 4200], city: [1600, 2400], town: [450, 1100], village: [70, 380], hamlet: [15, 55] };
const START_BUILDINGS: Record<SettlementKind, Partial<Record<BuildingId, number>>> = {
  capital: { farms: 3, market: 3, walls: 3, smithy: 2, inn: 2, temple: 3, barracks: 3, granary: 2 },
  city: { farms: 2, market: 2, walls: 2, smithy: 2, inn: 2, temple: 2, barracks: 1, granary: 1 },
  town: { farms: 2, market: 1, walls: 1, smithy: 1, inn: 1, temple: 1 },
  village: { farms: 1, inn: 1 },
  hamlet: { farms: 1 },
};
const TAX: Record<SettlementKind, number> = { capital: 0, city: 0.15, town: 0.15, village: 0.12, hamlet: 0.1 };

export function emptyRealm(seed: number, day: number): Realm {
  return { seed, day, kingdoms: {}, settlements: {}, figures: {}, factions: {}, treaties: [], wars: [], dungeons: {}, packs: {}, news: [], director: [], arrivals: {}, next: 1, stats: {}, casualties: [], cooldowns: {} };
}

const between = (rng: Rng, [lo, hi]: [number, number]) => Math.round(lo + rng() * (hi - lo));
const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

/** Generate a realm. `day`: today (figures' ages count back from it). */
export function generateRealm(seed: number, day = 1): Realm {
  const rng = seededRng(seed);
  const realm = emptyRealm(seed, day);
  const placeNames = new Set<string>();
  const kingdomNames = new Set<string>();
  const factionNames = new Set<string>();

  const add = (name: string, kind: SettlementKind, kingdom: string, liege: string | null, pos: { x: number; y: number }, terrain: Terrain, id = slug(name)): Settlement => {
    const s: Settlement = {
      id,
      name,
      kind,
      kingdom,
      liege,
      leader: null,
      pos: { x: Math.round(pos.x), y: Math.round(pos.y) },
      terrain,
      population: between(rng, POPULATION[kind]),
      prosperity: Math.round(40 + rng() * 25),
      food: Math.round(45 + rng() * 30),
      treasury: Math.round((kind === "capital" ? 40000 : kind === "city" ? 15000 : kind === "town" ? 4000 : kind === "village" ? 900 : 200) * (0.7 + rng() * 0.6)),
      buildings: { ...START_BUILDINGS[kind], ...(terrain === "hills" ? { mine: 1 } : {}) },
      project: null,
      taxRate: TAX[kind],
      arrears: 0,
      roads: liege ? [liege] : [],
    };
    realm.settlements[id] = s;
    if (liege) realm.settlements[liege]!.roads.push(id);
    return s;
  };
  const near = (from: { x: number; y: number }, r: number, angle: number) => ({
    x: Math.max(30, Math.min(REALM_W - 30, from.x + Math.cos(angle) * r)),
    y: Math.max(30, Math.min(REALM_H - 30, from.y + Math.sin(angle) * r)),
  });

  // Three kingdoms across the map.
  const centres = [
    { x: 250, y: 380 },
    { x: 620, y: 200 },
    { x: 720, y: 540 },
  ];
  const kingdoms: Kingdom[] = centres.map((c, i) => {
    const name = kingdomName(rng, kingdomNames);
    const id = slug(name);
    const capitalName = placeName(rng, placeNames);
    const capital = add(capitalName, "capital", id, null, c, pick(rng, ["valley", "plains", "coast"] as const));
    capital.taxRate = 0;
    // One kingdom keeps serfs, the next slaves, the third neither.
    const k: Kingdom = { id, name, capital: capital.id, crown: `crown_${id}`, ruler: null, color: COLORS[i % COLORS.length]!, opinion: {}, weariness: 0, laws: { serfdom: i % 3 === 0, slavery: i % 3 === 1 } };
    realm.kingdoms[id] = k;
    return k;
  });

  const terrains: Terrain[] = ["valley", "hills", "forest", "plains", "coast", "marsh"];
  for (const [i, k] of kingdoms.entries()) {
    const cap = realm.settlements[k.capital]!;
    const base = rng() * Math.PI * 2;
    const city = add(placeName(rng, placeNames), "city", k.id, cap.id, near(cap.pos, 150 + rng() * 40, base), pick(rng, terrains));
    // Towns: one under the capital, one under the city.
    const townA = add(placeName(rng, placeNames), "town", k.id, cap.id, near(cap.pos, 80 + rng() * 20, base + 2.2), pick(rng, terrains));
    const townB = add(placeName(rng, placeNames), "town", k.id, city.id, near(city.pos, 90 + rng() * 30, base + 0.9), pick(rng, terrains));
    for (const town of [townA, townB, city]) {
      const villages = town === city ? 1 : 2;
      for (let v = 0; v < villages; v++) {
        const village = add(placeName(rng, placeNames), "village", k.id, town.id, near(town.pos, 60 + rng() * 40, rng() * Math.PI * 2), pick(rng, terrains));
        // Half the villages have a smith of their own.
        if (rng() < 0.5) village.buildings.smithy = 1;
      }
      add(placeName(rng, placeNames), "hamlet", k.id, town.id, near(town.pos, 50 + rng() * 40, rng() * Math.PI * 2), pick(rng, ["forest", "hills", "marsh", "plains"] as const));
    }
  }
  // Roads between neighbours that aren't joined yet (trade routes across borders, too).
  const all = Object.values(realm.settlements);
  for (const s of all) {
    const others = all.filter((o) => o !== s && !s.roads.includes(o.id)).sort((a, b) => dist(a.pos, s.pos) - dist(b.pos, s.pos));
    const n = others[0];
    if (n && dist(n.pos, s.pos) < 140) {
      s.roads.push(n.id);
      n.roads.push(s.id);
    }
  }
  // Every village and town has at least two roads (a place nobody can leave isn't a place to start).
  for (const s of all.filter((x) => x.kind === "village" || x.kind === "town")) {
    if (s.roads.length >= 2) continue;
    const other = all.filter((o) => o !== s && !s.roads.includes(o.id) && o.kind !== "hamlet").sort((a, b) => dist(a.pos, s.pos) - dist(b.pos, s.pos))[0];
    if (other) {
      s.roads.push(other.id);
      other.roads.push(s.id);
    }
  }
  for (let i = 0; i < kingdoms.length; i++) {
    const a = realm.settlements[kingdoms[i]!.capital]!;
    const b = realm.settlements[kingdoms[(i + 1) % kingdoms.length]!.capital]!;
    if (!a.roads.includes(b.id)) {
      a.roads.push(b.id);
      b.roads.push(a.id);
    }
  }
  // How the kingdoms feel about each other.
  for (const a of kingdoms) for (const b of kingdoms) if (a !== b) a.opinion[b.id] = Math.round(-30 + rng() * 50);

  // Heads of every settlement, from the crown down: each answers to the head of their liege.
  const order: SettlementKind[] = ["capital", "city", "town", "village", "hamlet"];
  for (const kind of order) {
    for (const s of Object.values(realm.settlements).filter((x) => x.kind === kind)) {
      const lead = makeFigure(realm, rng, { role: leaderRole(kind), home: s.id, tier: pick(rng, LEADER_TIER[kind]), age: 30 + Math.floor(rng() * 30), renown: 20 + order.length * 10 - order.indexOf(kind) * 10 }, day);
      s.leader = lead.id;
      lead.superior = s.liege ? (realm.settlements[s.liege]!.leader ?? null) : null;
      if (kind === "capital") realm.kingdoms[s.kingdom!]!.ruler = lead.id;
      // Notable folk: more in bigger places.
      const folk: Array<[Role, Tier[]]> =
        kind === "capital" || kind === "city"
          ? [["noble", ["E", "D"]], ["captain", ["D", "C"]], ["merchant", ["F", "E"]], ["smith", ["E", "D"]], ["priest", ["F", "E"]], ["adventurer", ["E", "D"]], ["adventurer", ["F", "E"]]]
          : kind === "town"
            ? [["captain", ["E", "D"]], ["merchant", ["F", "E"]], ["smith", ["F", "E"]], ["adventurer", ["F", "E"]], ["hunter", ["F"]]]
            : kind === "village"
              ? [["farmer", ["G", "F"]], ["hunter", ["G", "F"]], ["farmer", ["G"]]]
              : [["farmer", ["G"]], ["hunter", ["G", "F"]]];
      // Whoever keeps the inn and the forge, where there are ones (towns and cities have their smith above).
      if (kind !== "hamlet" && (s.buildings.inn ?? 0) > 0) folk.push(["innkeeper", ["G", "F"]]);
      if (kind === "village" && (s.buildings.smithy ?? 0) > 0) folk.push(["smith", ["G", "F"]]);
      for (const [role, tiers] of folk) makeFigure(realm, rng, { role, home: s.id, tier: pick(rng, tiers), age: 18 + Math.floor(rng() * 40), superior: lead.id }, day);
    }
  }

  // Crowns: each ruler with their lords, mayors, nobles and captains.
  for (const k of kingdoms) {
    const members = Object.values(realm.figures).filter((f) => f.alive && realm.settlements[f.home ?? ""]?.kingdom === k.id && ["ruler", "lord", "mayor", "noble", "captain"].includes(f.role));
    addFaction(realm, { id: k.crown, name: factionName(rng, "crown", { place: realm.settlements[k.capital]!.name, kingdom: k.name }, factionNames), kind: "crown", creed: `the rule of ${k.name}`, leader: k.ruler, members: members.map((f) => f.id), seat: k.capital, branches: [k.capital], wealth: 20000, founded: day - 400, kingdom: k.id, stances: {} });
    for (const f of members) f.faction = k.crown;
  }
  // An adventurers' guild with halls in the first kingdom; a merchants' league in the second.
  const k0 = kingdoms[0]!;
  const adv = Object.values(realm.figures).filter((f) => f.role === "adventurer" && realm.settlements[f.home ?? ""]?.kingdom === k0.id);
  const guildSeat = realm.settlements[k0.capital]!;
  const guildBranches = [guildSeat.id, ...Object.values(realm.settlements).filter((s) => s.kingdom === k0.id && s.kind === "town").map((s) => s.id)];
  const guild = addFaction(realm, { id: "adventurers_guild", name: factionName(rng, "guild", { place: guildSeat.name, kingdom: k0.name, trade: "adventurers" }, factionNames), kind: "guild", trade: "adventurers", creed: "coin and glory from the deep places", leader: null, members: adv.map((f) => f.id), seat: guildSeat.id, branches: guildBranches, wealth: 3000, founded: day - 120, stances: {} });
  const gm = makeFigure(realm, rng, { role: "guildmaster", home: guildSeat.id, tier: "C", age: 47, faction: guild.id, renown: 45 }, day);
  guild.leader = gm.id;
  guild.members.unshift(gm.id);
  for (const f of adv) {
    f.faction = guild.id;
    f.superior = gm.id;
  }
  for (const b of guildBranches) realm.settlements[b]!.buildings.guildhall = Math.max(1, realm.settlements[b]!.buildings.guildhall ?? 0);
  const k1 = kingdoms[1]!;
  const merchants = Object.values(realm.figures).filter((f) => f.role === "merchant" && realm.settlements[f.home ?? ""]?.kingdom === k1.id);
  if (merchants.length > 0) {
    const seat = realm.settlements[k1.capital]!;
    const league = addFaction(realm, { id: "merchants_league", name: factionName(rng, "guild", { place: seat.name, kingdom: k1.name, trade: "merchants" }, factionNames), kind: "guild", trade: "merchants", creed: "free roads and fair scales", leader: merchants[0]!.id, members: merchants.map((f) => f.id), seat: seat.id, branches: [...new Set(merchants.map((f) => f.home!))], wealth: 6000, founded: day - 300, stances: {} });
    for (const f of merchants) f.faction = league.id;
    merchants[0]!.role = "guildmaster";
  }
  // A bandit gang in every kingdom's wild places.
  for (const k of kingdoms) {
    const lair = Object.values(realm.settlements).find((s) => s.kingdom === k.id && s.kind === "hamlet") ?? realm.settlements[k.capital]!;
    const chief = makeFigure(realm, rng, { role: "bandit chief", home: null, tier: "D", age: 35, renown: 25 }, day);
    const gang = addFaction(realm, { id: `gang_${k.id}`, name: factionName(rng, "gang", { place: lair.name, kingdom: k.name }, factionNames), kind: "gang", creed: "take what the roads carry", leader: chief.id, members: [chief.id], seat: lair.id, branches: [], wealth: 600, founded: day - 60, stances: { [k.crown]: -70 } });
    chief.faction = gang.id;
    for (let i = 0; i < 3; i++) {
      const b = makeFigure(realm, rng, { role: "bandit", home: null, tier: pick(rng, ["G", "F", "E"] as Tier[]), age: 18 + Math.floor(rng() * 20), faction: gang.id, superior: chief.id }, day);
      gang.members.push(b.id);
    }
  }
  // Crowns don't like gangs; gangs don't like anyone.
  for (const f of Object.values(realm.factions)) {
    for (const g of Object.values(realm.factions)) {
      if (f === g || f.stances[g.id] !== undefined) continue;
      f.stances[g.id] = f.kind === "gang" || g.kind === "gang" ? -60 : f.kind === "crown" && g.kind === "crown" ? (realm.kingdoms[f.kingdom!]!.opinion[g.kingdom!] ?? 0) : 10;
    }
  }

  // Dungeons out in the wild.
  const dnames = new Set<string>();
  const addDungeon = (near: Settlement, tier: Tier, depth: number, name = dungeonName(rng, dnames)) => {
    const id = slug(name);
    realm.dungeons[id] = { id, name, near: near.id, pos: { x: near.pos.x + Math.round(rng() * 60 - 30), y: near.pos.y - 25 - Math.round(rng() * 20) }, tier, depth, danger: Math.round(40 + rng() * 30), treasure: Math.round(300 * depth * (1 + ["G", "F", "E", "D", "C", "B", "A"].indexOf(tier))), bounty: 0, delves: 0 };
  };
  const wild = Object.values(realm.settlements).filter((s) => s.kind === "hamlet" || s.kind === "village");
  for (let i = 0; i < 9 && wild.length > 0; i++) {
    const s = wild.splice(Math.floor(rng() * wild.length), 1)[0]!;
    addDungeon(s, pick(rng, ["F", "E", "D", "C"] as Tier[]), 1 + Math.floor(rng() * 4));
  }
  // Beast packs: wolves in the forests and hills, bears in the hills, boars on the plains, spiders in the marshes.
  const packFor: Partial<Record<Terrain, [string, Tier, number]>> = { forest: ["wolf", "F", 10], hills: ["bear", "E", 4], plains: ["boar", "G", 8], marsh: ["spider", "E", 6], valley: ["wolf", "F", 8] };
  for (const s of Object.values(realm.settlements)) {
    const kind = packFor[s.terrain];
    if (!kind || s.kind === "capital" || s.kind === "city" || rng() < 0.45) continue;
    const [species, tier, cap] = kind;
    const id = `pack_${s.id}`;
    realm.packs[id] = { id, species, near: s.id, count: Math.max(2, Math.round(cap * (0.3 + rng() * 0.4))), cap, tier, alpha: null, bounty: 0 };
  }
  // Two kingdoms trade; the first two have promised not to fight.
  const [a, b, c] = kingdoms;
  if (a && b) realm.treaties.push({ id: `t${realm.next++}`, kind: "trade", a: `k:${a.id}`, b: `k:${b.id}`, since: day - 50, until: day + 90, why: "the old trade road", amount: undefined });
  if (b && c) realm.treaties.push({ id: `t${realm.next++}`, kind: "non_aggression", a: `k:${b.id}`, b: `k:${c.id}`, since: day - 20, until: day + 60, why: "a truce after the border quarrels" });
  void takenNames;
  // Inns beside the roads, about a day's walk apart (N26): hamlets with an inn, made last from a stream of their own.
  addWaystations(realm, day);
  // The houses each place has, fixed from here on (game/realm/houses.ts).
  freezeHouses(realm);
  return realm;
}

export function addFaction(realm: Realm, f: RealmFaction): RealmFaction {
  realm.factions[f.id] = f;
  return f;
}

/** Map distance between two settlements. */
export function distance(realm: Realm, a: string, b: string): number {
  const sa = realm.settlements[a];
  const sb = realm.settlements[b];
  return sa && sb ? dist(sa.pos, sb.pos) : Infinity;
}

/** Days for news or travellers to go from a to b. */
export function travelDays(realm: Realm, a: string | null, b: string): number {
  if (!a) return 1;
  return Math.max(0, Math.ceil(distance(realm, a, b) / TRAVEL_PER_DAY));
}

/** Settlements one road away. */
export function neighbours(realm: Realm, id: string): Settlement[] {
  return (realm.settlements[id]?.roads ?? []).map((r) => realm.settlements[r]!).filter((s) => s && !s.abandoned);
}

/** The settlement's liege chain, nearest first. */
export function lieges(realm: Realm, id: string): Settlement[] {
  const out: Settlement[] = [];
  const seen = new Set([id]);
  let cur = realm.settlements[id]?.liege ?? null;
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    const s = realm.settlements[cur];
    if (!s) break;
    out.push(s);
    cur = s.liege;
  }
  return out;
}

export type { Figure };
