import { CHUNK, Ground, animalsInChunk, countryAt, plantsInChunk, seedOf, stageOf, tileOf, yearFraction, type AnimalGroup, type NatureCtx, type PlantPatch } from "@millbrook/shared";
import { config } from "../../config.js";
import { check, streamFor } from "../dice.js";
import { recordEvent } from "../events.js";
import { cure, fallIll, type IllnessId, ILLNESSES } from "../health.js";
import { itemKey, parseItem } from "../items.js";
import { formatMoney } from "../money.js";
import { skillLevel } from "../../npc/skills.js";
import type { PlayerState } from "../../npc/types.js";
import { spawnCreature, type Creature } from "../creatures.js";
import type { Realm } from "../realm/types.js";
import type { Town } from "../town.js";
import { seasonOf } from "../weather.js";
import { groundAt, landOf } from "../road/ground.js";
import { needsOf } from "../road/needs.js";
import { statePois } from "../road/wildPlaces.js";
import { lightAnimals, loadSpecies, plantSpecs, type AnimalDef, type PlantDef } from "./species.js";

/**
 * Fauna and flora for the player (N28): the light animals and plants near them (shared/nature/place.ts, with the species
 * files), animals that run from them and woods that fall quiet near a predator, hunting, fishing, gathering with the risk
 * of a lookalike, signs and tracking, taming a stray, the bestiary and herbarium, and a lord's game. What the player keeps
 * is `player.nature`; the animals and plants themselves are never saved.
 */

export interface NatureState {
  /** Species met, by id: 1 seen, 2 told of, 3 studied (hunted, caught or gathered), 4 known well (shown to an expert). */
  seen: Record<string, { level: number; day: number }>;
  /** Patches gathered (id → the day), until they regrow. */
  gathered: Record<string, number>;
  /** What the player carries believing it something else: believed item → true item → how many. Never sent to the browser. */
  mislabelled: Record<string, Record<string, number>>;
  /** A stray being tamed: its place, the days won over, the last day fed. */
  taming?: { site: string; species: string; days: number; last: number };
  /** Animals that follow the player. */
  pets: Array<{ species: string; name: string; since: number }>;
}

export const natureOf = (p: PlayerState): NatureState => (p.nature ??= { seen: {}, gathered: {}, mislabelled: {}, pets: [] });

const book = () => loadSpecies();

/** The country, season and water the placement functions need at a point. */
function ctxAt(realm: Realm, x: number, y: number, day: number): NatureCtx {
  const land = landOf(realm);
  return {
    terrain: countryAt(land.data.anchors, x, y),
    season: seasonOf(day),
    frac: yearFraction(day, config.daysPerYear),
    water: (wx, wy) => {
      for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) if (groundAt(land, wx + dx, wy + dy) === Ground.water) return true;
      return false;
    },
  };
}

/** How far a predator's lair hushes the small birds and beasts round it. */
const HUSH = 260;

/**
 * The animal groups within `radius` tiles of the player now: placed by the shared formula, less any taken today, those
 * near enough to the player run off (out to their fleeing distance and a little more), and small things fall quiet near a
 * pack's lair.
 */
export function animalsNear(town: Town, radius = 60): AnimalGroup[] {
  const realm = town.world.realm;
  const road = town.world.player.road;
  if (!realm || !road) return [];
  const day = town.world.day;
  const minute = town.world.hour * 60 + (town.world.minute ?? 0);
  const specs = lightAnimals(book());
  const defs = book().animals;
  const taken = road.taken ?? {};
  const lairs = statePois(realm, landOf(realm).data).filter((x) => x.kind === "lair");
  const out: AnimalGroup[] = [];
  const c0x = Math.floor((road.x - radius) / CHUNK);
  const c1x = Math.floor((road.x + radius) / CHUNK);
  const c0y = Math.floor((road.y - radius) / CHUNK);
  const c1y = Math.floor((road.y + radius) / CHUNK);
  for (let cy = c0y; cy <= c1y; cy++) for (let cx = c0x; cx <= c1x; cx++) {
    const ctx = ctxAt(realm, cx * CHUNK + CHUNK / 2, cy * CHUNK + CHUNK / 2, day);
    for (const g of animalsInChunk(realm.seed, specs, cx, cy, day, minute, ctx)) {
      if (taken[g.id] !== undefined) continue;
      const def = defs[g.species]!;
      if (def.small && lairs.some((l) => Math.abs(l.x - g.x) < HUSH && Math.abs(l.y - g.y) < HUSH && Math.hypot(l.x - g.x, l.y - g.y) < HUSH)) continue;
      const fled = fleeFrom(g, def, road);
      if (Math.hypot(fled.x - road.x, fled.y - road.y) <= radius) out.push(fled);
    }
  }
  return out;
}

/** A group near the player runs from them: out to its fleeing distance and a bit. */
export function fleeFrom(g: AnimalGroup, def: Pick<AnimalDef, "flees">, from: { x: number; y: number }): AnimalGroup {
  const d = Math.hypot(g.x - from.x, g.y - from.y);
  if (def.flees <= 0 || d >= def.flees) return g;
  const ux = d === 0 ? 1 : (g.x - from.x) / d;
  const uy = d === 0 ? 0 : (g.y - from.y) / d;
  const to = def.flees + 3;
  return { ...g, x: Math.round(from.x + ux * to), y: Math.round(from.y + uy * to) };
}

/** Plant patches within `radius` tiles, at today's stage. */
export function plantsNear(town: Town, radius = 6): Array<PlantPatch & { name: string; ready: boolean }> {
  const realm = town.world.realm;
  const road = town.world.player.road;
  if (!realm || !road) return [];
  const day = town.world.day;
  const specs = plantSpecs(book());
  const gathered = natureOf(town.world.player).gathered;
  const out: Array<PlantPatch & { name: string; ready: boolean }> = [];
  const c0x = Math.floor((road.x - radius) / CHUNK);
  const c1x = Math.floor((road.x + radius) / CHUNK);
  const c0y = Math.floor((road.y - radius) / CHUNK);
  const c1y = Math.floor((road.y + radius) / CHUNK);
  for (let cy = c0y; cy <= c1y; cy++) for (let cx = c0x; cx <= c1x; cx++) {
    const ctx = ctxAt(realm, cx * CHUNK + CHUNK / 2, cy * CHUNK + CHUNK / 2, day);
    for (const p of plantsInChunk(realm.seed, specs, cx, cy, ctx)) {
      if (Math.hypot(p.x - road.x, p.y - road.y) > radius) continue;
      const def = book().plants[p.species]!;
      const last = gathered[p.id];
      const ready = (last === undefined || day - last >= def.regrowDays) && productsAt(def, p.stage).length > 0;
      out.push({ ...p, name: def.name, ready });
    }
  }
  return out;
}

const productsAt = (def: PlantDef, stage: string) => def.products.filter((x) => x.stage === stage || x.stage === "any");

// ---------- knowing them ----------

/** Note a species in the bestiary or herbarium, at least at `level`. True if it's new or better known. */
export function noteSpecies(p: PlayerState, id: string, level: number, day: number): boolean {
  const seen = natureOf(p).seen;
  if ((seen[id]?.level ?? 0) >= level) return false;
  seen[id] = { level, day: seen[id]?.day ?? day };
  return true;
}

/** Species close enough to see well go in the bestiary (each step). Returns a line for a species never seen before. */
export function noteNear(town: Town): string[] {
  const p = town.world.player;
  const road = p.road;
  if (!road) return [];
  const lines: string[] = [];
  for (const g of animalsNear(town, 15)) {
    if (natureOf(p).seen[g.species]) continue;
    noteSpecies(p, g.species, 1, town.world.day);
    const def = book().animals[g.species]!;
    lines.push(`You see ${g.n > 1 ? `${g.n} ${def.plural}` : `a ${def.name}`}${skillLevel(p.skills, "hunting") > 0 ? "" : " (new to you)"}.`);
  }
  for (const pl of plantsNear(town, 3)) if (!natureOf(p).seen[pl.species]) noteSpecies(p, pl.species, 1, town.world.day);
  return lines;
}

/** What the bestiary and herbarium say of a species at a level of knowing. */
export function entryOf(id: string, level: number): { name: string; kind: string; text: string } | null {
  const a = book().animals[id];
  const pl = book().plants[id];
  const def = a ?? pl;
  if (!def) return null;
  const where = Object.entries(def.biomes)
    .filter(([, w]) => (w ?? 0) >= 0.6)
    .map(([b]) => b)
    .join(", ");
  const parts = [level >= 2 ? `Found in ${where || "villages"}.` : ""];
  if (level >= 3) parts.push(def.products.length ? `Gives ${[...new Set(def.products.map((x) => x.item))].join(", ")}.` : "Nothing to take from it.");
  if (level >= 3 && pl) for (const e of pl.effects) parts.push(`${e.when === "eaten" ? "Eaten" : e.when === "brewed" ? "Brewed" : "On a wound"}: ${e.cures ? `cures ${ILLNESSES[e.cures as IllnessId]?.name ?? e.cures}` : e.causes ? `brings on ${ILLNESSES[e.causes as IllnessId]?.name ?? e.causes}` : e.heals ? "heals" : "feeds"}.`);
  if (level >= 4 && pl?.lookalike) parts.push(`Easily mistaken for ${book().plants[pl.lookalike]?.name ?? pl.lookalike}.`);
  for (const [k, v] of Object.entries(def.lore)) if (v && level >= 2) parts.push(`(${k}: ${v})`);
  return { name: def.name, kind: a ? "animal" : "plant", text: parts.filter(Boolean).join(" ") };
}

// ---------- hunting ----------

/** The lord's game near a lord's seat, or out of season: hunting it is poaching (N48 gives this its trials). */
export function isForbidden(realm: Realm, def: AnimalDef, at: { x: number; y: number }, day: number): string | null {
  if (def.closedSeason?.includes(seasonOf(day))) return `${def.plural} are out of season`;
  if (!def.lordsGame) return null;
  for (const s of Object.values(realm.settlements)) {
    if (s.way || s.abandoned || !(s.kind === "town" || s.kind === "city" || s.kind === "capital")) continue;
    if (Math.hypot(tileOf(s.pos.x) - at.x, tileOf(s.pos.y) - at.y) <= 1500) return `${def.plural} here are the lord's of ${s.name}`;
  }
  return null;
}

/**
 * Go after an animal group near the player. One with a creature template becomes a creature on the road map (a fight);
 * the rest are a single hunting check that brings home its products. Either way the group is taken for the day. Hunting
 * the lord's game, or out of season, is poaching: a crime if someone sees.
 */
export function huntAnimal(town: Town, id: string): { creature?: Creature; lines: string[] } {
  const realm = town.world.realm;
  const p = town.world.player;
  if (!realm || !p.road) return { lines: ["You're not out in the country."] };
  const g = animalsNear(town, 80).find((x) => x.id === id);
  if (!g) return { lines: ["Whatever it was is gone."] };
  const def = book().animals[g.species]!;
  const taken = (p.road.taken ??= {});
  taken[g.id] = town.world.day;
  const lines: string[] = [];
  const day = town.world.day;
  const rng = streamFor(town.world.seed, "hunt", g.id, day);
  const banned = isForbidden(realm, def, g, day);
  if (banned) {
    lines.push(`(${banned}: this is poaching.)`);
    if (rng() < 0.3) {
      recordEvent(town.world as never, { kind: "crime", actor: "player", target: def.id, details: `poaching ${def.plural}`, importance: 3, why: banned, witnesses: [] });
      lines.push("A forester's horn, somewhere behind you: you've been seen.");
    }
  }
  noteSpecies(p, def.id, 3, day);
  const t = def.creature ? town.templates[def.creature] : undefined;
  if (t) {
    const c = spawnCreature(t, g.id, day, rng);
    c.pos = { x: g.x, y: g.y };
    town.roadCreatures[c.uid] = c;
    return { creature: c, lines: [...lines, `You go after the ${def.name}.`] };
  }
  if (!def.hunt) return { lines: [...lines, `You can't hunt ${def.plural}.`] };
  town.walkMinutes(40);
  const r = check(rng, p.attributes.agility, def.hunt.difficulty, skillLevel(p.skills, "hunting") + (hasPet(p, "dog") ? 2 : 0));
  if (!r.success) return { lines: [...lines, `You stalk the ${def.plural} for the best part of an hour; they're away before you're close.`] };
  return { lines: [...lines, `You take ${give(p, def.products, rng)}.`] };
}

/** Put products in the pack; their words. */
function give(p: PlayerState, products: AnimalDef["products"], rng: () => number): string {
  const got: string[] = [];
  for (const x of products) {
    if (x.chance !== undefined && rng() >= x.chance) continue;
    const n = x.qty[0] + Math.floor(rng() * (x.qty[1] - x.qty[0] + 1));
    const k = itemKey(x.item);
    p.inventory[k] = (p.inventory[k] ?? 0) + n;
    got.push(`${n} ${x.item}`);
  }
  return got.join(" and ") || "nothing worth keeping";
}

// ---------- fishing ----------

/** Fish in the water by the player: a rod, a fishing check against the fish that live here this season, half an hour. */
export function fish(town: Town): string[] {
  const realm = town.world.realm;
  const p = town.world.player;
  const road = p.road;
  if (!realm || !road) return ["Find some water first."];
  const land = landOf(realm);
  let water = false;
  for (let dy = -2; dy <= 2 && !water; dy++) for (let dx = -2; dx <= 2 && !water; dx++) water = groundAt(land, road.x + dx, road.y + dy) === Ground.water;
  if (!water) return ["There's no water here to fish."];
  if (!Object.keys(p.inventory).some((k) => (p.inventory[k] ?? 0) > 0 && parseItem(k)?.name === "fishing rod")) return ["You'd need a fishing rod."];
  const day = town.world.day;
  const ctx = ctxAt(realm, road.x, road.y, day);
  const minute = town.world.hour * 60 + (town.world.minute ?? 0);
  const fishes = Object.values(book().animals).filter((a) => a.class === "fish");
  const weights = fishes.map((f) => (f.biomes[ctx.terrain as keyof typeof f.biomes] ?? 0) * (f.seasons[ctx.season as keyof typeof f.seasons] ?? 1) * f.abundance * (f.active === "night" && minute > 7 * 60 && minute < 19 * 60 ? 0.2 : 1));
  const total = weights.reduce((a, b) => a + b, 0);
  const rng = streamFor(town.world.seed, "fish", road.x, road.y, day, minute);
  town.walkMinutes(30);
  if (total <= 0) return ["Half an hour with a line in, and not a bite: nothing lives in this water."];
  let r = rng() * total;
  let i = 0;
  for (; i < fishes.length - 1; i++) {
    if (r < weights[i]!) break;
    r -= weights[i]!;
  }
  const f = fishes[i]!;
  const hit = check(rng, p.attributes.agility, f.hunt?.difficulty ?? 10, skillLevel(p.skills, "fishing"));
  if (!hit.success) return ["Half an hour with a line in. Something takes the bait and is gone."];
  noteSpecies(p, f.id, 3, day);
  return [`You land a ${f.name}: ${give(p, f.products, rng)}.`];
}

// ---------- gathering ----------

/**
 * Gather from a plant patch next to the player: identifying it is a herbalism check (foraging helps); a plant someone
 * easily mistakes for another may, on a failed check, give the other's product, believed to be this one's. The patch is
 * bare until it regrows.
 */
export function gatherPlant(town: Town, id: string): string[] {
  const p = town.world.player;
  const patch = plantsNear(town, 3).find((x) => x.id === id);
  if (!patch) return ["That is out of reach."];
  if (!patch.ready) return [`The ${patch.name} here is picked over, or not ready.`];
  const def = book().plants[patch.species]!;
  const day = town.world.day;
  const rng = streamFor(town.world.seed, "gather", patch.id, day);
  natureOf(p).gathered[patch.id] = day;
  town.walkMinutes(20);
  const known = (natureOf(p).seen[def.id]?.level ?? 0) >= 4;
  const r = check(rng, p.attributes.perception, def.identify.difficulty, skillLevel(p.skills, "herbalism") + Math.floor(skillLevel(p.skills, "foraging") / 2));
  noteSpecies(p, def.id, 3, day);
  const products = productsAt(def, patch.stage);
  // Taken for its lookalike: what they pick is the other plant's, believed to be this one's.
  const twin = def.lookalike ? book().plants[def.lookalike] : undefined;
  if (twin && !known && !r.success) {
    const fake = productsAt(twin, stageOf(twin.calendar, yearFraction(day, config.daysPerYear)))[0] ?? twin.products[0];
    const want = products[0];
    if (fake && want) {
      const n = want.qty[0];
      const k = itemKey(want.item);
      p.inventory[k] = (p.inventory[k] ?? 0) + n;
      const mis = (natureOf(p).mislabelled[want.item] ??= {});
      mis[fake.item] = (mis[fake.item] ?? 0) + n;
      return [`You gather ${n} ${want.item}.`];
    }
  }
  if (!r.success && !known) return [`You can't be sure it's ${def.name}, and leave it.`];
  const got: string[] = [];
  for (const x of products) {
    const n = x.qty[0] + Math.floor(rng() * (x.qty[1] - x.qty[0] + 1));
    const k = itemKey(x.item);
    p.inventory[k] = (p.inventory[k] ?? 0) + n;
    got.push(`${n} ${x.item}`);
  }
  return [`You gather ${got.join(" and ")}.`];
}

/**
 * Eat, brew or put on a wound something gathered. What it really is decides what it does: a stack the player believes
 * is one thing may be another (a death cap taken for a field mushroom), used first.
 */
export function useWildItem(town: Town, item: string, how: "eaten" | "brewed" | "applied"): string[] {
  const p = town.world.player;
  const name = parseItem(item)?.name ?? item;
  const key = Object.keys(p.inventory).find((k) => (p.inventory[k] ?? 0) > 0 && parseItem(k)?.name === name);
  if (!key) return [`You have no ${name}.`];
  const mis = natureOf(p).mislabelled[name];
  const trueItem = mis ? Object.keys(mis).find((k) => (mis[k] ?? 0) > 0) : undefined;
  const real = trueItem ?? name;
  const def = Object.values(book().plants).find((pl) => pl.products.some((x) => x.item === real));
  const effects = def?.effects.filter((e) => e.when === how) ?? [];
  if (effects.length === 0) return [how === "eaten" ? `You can't eat ${name}.` : how === "brewed" ? `${name} makes no brew worth drinking.` : `${name} does nothing for a wound.`];
  p.inventory[key] = (p.inventory[key] ?? 1) - 1;
  if ((p.inventory[key] ?? 0) <= 0) delete p.inventory[key];
  if (trueItem && mis) {
    mis[trueItem] = (mis[trueItem] ?? 1) - 1;
    if ((mis[trueItem] ?? 0) <= 0) delete mis[trueItem];
    if (Object.keys(mis).length === 0) delete natureOf(p).mislabelled[name];
  }
  if (how === "brewed") town.walkMinutes(20);
  const minute = (town.world.day - 1) * 1440 + town.world.hour * 60 + (town.world.minute ?? 0);
  const lines = [how === "eaten" ? `You eat the ${name}.` : how === "brewed" ? `You brew the ${name} and drink it down.` : `You press the ${name} to your wounds.`];
  for (const e of effects) {
    if (e.cures && p.illness?.id === e.cures) {
      cure(p, e.cures);
      lines.push("You feel the sickness lift.");
    }
    if (e.causes && e.causes in ILLNESSES) {
      p.illness = null;
      fallIll(p, e.causes as IllnessId, town.world.day);
      lines.push(e.causes === "poisoned" ? "Within the hour your belly knots and your sight swims. That was no good thing to eat." : "Your belly turns over.");
    }
    if (e.heals) p.hp = Math.min(p.maxHp, p.hp + e.heals);
    const n = needsOf(p, minute);
    if (e.food) n.food = Math.min(100, n.food + e.food);
    if (e.water) n.water = Math.min(100, n.water + e.water);
    if (e.rest) n.rest = Math.min(100, n.rest + e.rest);
  }
  return lines;
}

/** A herbalist looks over what the player has gathered: anything mistaken is put right, and its species known well. Costs a few coppers. */
export const IDENTIFY_FEE = 5;
export function showToHerbalist(p: PlayerState, herbalist: string): string[] {
  if (p.money < IDENTIFY_FEE) return [`${herbalist} wants ${formatMoney(IDENTIFY_FEE)} to look over your gatherings.`];
  p.money -= IDENTIFY_FEE;
  const mis = natureOf(p).mislabelled;
  const lines: string[] = [];
  for (const [believed, truths] of Object.entries(mis)) {
    for (const [truth, n] of Object.entries(truths)) {
      const bk = Object.keys(p.inventory).find((k) => parseItem(k)?.name === believed);
      if (!bk) continue;
      const moved = Math.min(n, p.inventory[bk] ?? 0);
      p.inventory[bk] = (p.inventory[bk] ?? 0) - moved;
      if ((p.inventory[bk] ?? 0) <= 0) delete p.inventory[bk];
      const tk = itemKey(truth);
      p.inventory[tk] = (p.inventory[tk] ?? 0) + moved;
      lines.push(`${herbalist} takes one look: "That's no ${believed}. That's ${truth}. Don't you eat it."`);
      const plant = Object.values(book().plants).find((pl) => pl.products.some((x) => x.item === truth));
      if (plant) noteSpecies(p, plant.id, 4, 0);
    }
    delete mis[believed];
  }
  for (const id of Object.keys(natureOf(p).seen)) if (book().plants[id] && natureOf(p).seen[id]!.level >= 3) natureOf(p).seen[id]!.level = 4;
  return lines.length > 0 ? lines : [`${herbalist} looks over your gatherings. "All as you think they are."`];
}

// ---------- signs and tracking ----------

/** The signs a group leaves: a trail of a few marks behind it from where it was earlier. */
export interface Sign {
  id: string;
  group: string;
  species: string;
  step: number;
  x: number;
  y: number;
  text: string;
}

const TRAIL = 4;

/** Where a group's trail starts: well back along its morning's way. */
function trailStart(g: AnimalGroup): { x: number; y: number } {
  const h = seedOf(`trail|${g.id}`) >>> 0;
  const a = ((h % 628) / 100);
  return { x: Math.round(g.home.x + Math.cos(a) * 70), y: Math.round(g.home.y + Math.sin(a) * 70) };
}

export function signOf(g: AnimalGroup, def: AnimalDef, step: number): Sign {
  const s = trailStart(g);
  const k = step / TRAIL;
  return { id: `sg:${g.id}:${step}`, group: g.id, species: g.species, step, x: Math.round(s.x + (g.x - s.x) * k), y: Math.round(s.y + (g.y - s.y) * k), text: def.signs[step % Math.max(1, def.signs.length)] ?? "tracks" };
}

/** Signs within a few tiles that the player notices (perception and hunting; a dog helps). */
export function signsNear(town: Town, radius = 8): Sign[] {
  const p = town.world.player;
  const road = p.road;
  if (!road) return [];
  const out: Sign[] = [];
  for (const g of animalsNear(town, 160)) {
    const def = book().animals[g.species]!;
    if (def.small || def.signs.length === 0 || def.class === "bird") continue;
    for (let step = 0; step < TRAIL; step++) {
      const s = signOf(g, def, step);
      if (Math.hypot(s.x - road.x, s.y - road.y) > radius) continue;
      const rng = streamFor(town.world.seed, "sign", s.id, town.world.day);
      if (!check(rng, p.attributes.perception, 10, skillLevel(p.skills, "hunting") + (hasPet(p, "dog") ? 3 : 0)).success) continue;
      out.push(s);
    }
  }
  return out;
}

/**
 * Read a sign and follow it: what made it, how many, which way they went, and where the next mark is (the last leads to
 * the animals). The player is walked to the next mark.
 */
export function track(town: Town, signId: string): string[] {
  const p = town.world.player;
  const road = p.road;
  if (!road) return ["You're not out in the country."];
  const [, gid, stepS] = signId.match(/^sg:(.+):(\d+)$/) ?? [];
  const g = animalsNear(town, 200).find((x) => x.id === gid);
  if (!g || stepS === undefined) return ["The trail has gone cold."];
  const def = book().animals[g.species]!;
  const step = Number(stepS);
  const here = signOf(g, def, step);
  if (Math.hypot(here.x - road.x, here.y - road.y) > 10) return ["You're not near that sign."];
  const next = step + 1 < TRAIL ? signOf(g, def, step + 1) : null;
  const to = next ?? g;
  const dx = to.x - here.x;
  const dy = to.y - here.y;
  const dir = Math.abs(dx) > Math.abs(dy) * 2 ? (dx > 0 ? "east" : "west") : Math.abs(dy) > Math.abs(dx) * 2 ? (dy > 0 ? "south" : "north") : `${dy > 0 ? "south" : "north"}${dx > 0 ? "east" : "west"}`;
  noteSpecies(p, def.id, 2, town.world.day);
  const n = skillLevel(p.skills, "hunting") >= 1 ? `${g.n === 1 ? "one" : g.n}` : "some";
  road.x = Math.round(here.x + dx * 0.85);
  road.y = Math.round(here.y + dy * 0.85);
  town.walkMinutes(Math.max(5, Math.round(Math.hypot(dx, dy) / 7)));
  return [`${here.text[0]!.toUpperCase()}${here.text.slice(1)}: ${n} ${g.n === 1 ? def.name : def.plural}, heading ${dir}. You follow.`, ...(next ? [] : [`There: ${g.n > 1 ? `${g.n} ${def.plural}` : `a ${def.name}`}, close ahead.`])];
}

// ---------- taming ----------

/** A stray hangs about a place (some places): which, by the place. */
export function strayAt(site: string): string | null {
  return (seedOf(`stray|${site}`) >>> 0) % 3 === 0 ? null : "stray_dog";
}

const FOOD_FOR_STRAYS = ["venison", "hare meat", "goat meat", "bread loaf", "stew", "pigeon meat", "duck meat"];

export function hasPet(p: PlayerState, species: string): boolean {
  return (p.nature?.pets ?? []).some((x) => x.species === species || (species === "dog" && x.species === "stray_dog"));
}

/** Feed the place's stray and win it over, a day at a time (an animal handling check each day); after enough days it's the player's. */
export function tameStray(town: Town): string[] {
  const p = town.world.player;
  const site = town.site();
  const species = strayAt(site);
  if (!species) return ["There's no stray here to win over."];
  const def = book().animals[species]!;
  if (!def.tame) return [`You can't tame a ${def.name}.`];
  const n = natureOf(p);
  if (n.pets.some((x) => x.species === species)) return [`You already have a ${def.name.replace("stray ", "")}.`];
  const food = Object.keys(p.inventory).find((k) => (p.inventory[k] ?? 0) > 0 && FOOD_FOR_STRAYS.includes(parseItem(k)?.name ?? ""));
  if (!food) return ["You've nothing it would eat. Meat, or bread."];
  const day = town.world.day;
  if (n.taming?.site === site && n.taming.last === day) return ["You've fed it today. Come back tomorrow."];
  p.inventory[food] = (p.inventory[food] ?? 1) - 1;
  if ((p.inventory[food] ?? 0) <= 0) delete p.inventory[food];
  const rng = streamFor(town.world.seed, "tame", site, day);
  const r = check(rng, p.attributes.charisma, def.tame.difficulty, skillLevel(p.skills, "animal_handling"));
  const t = n.taming?.site === site ? n.taming : (n.taming = { site, species, days: 0, last: 0 });
  t.last = day;
  if (!r.success) return ["The dog snatches the food and backs off, watching you."];
  t.days += 1;
  noteSpecies(p, species, 3, day);
  if (t.days < def.tame.days) return [`The dog eats from your hand${t.days > 1 ? " and lets you scratch its ears" : ""}. (${t.days} of ${def.tame.days} days)`];
  const name = ["Brindle", "Patch", "Fly", "Soot", "Moss", "Jess"][(seedOf(`${site}|dog`) >>> 0) % 6]!;
  n.pets.push({ species, name, since: day });
  delete n.taming;
  return [`The dog follows you when you go. You call it ${name}. (A dog finds tracks and signs you'd miss.)`];
}

// ---------- the people who live off the land ----------

/**
 * What a herbalist brings home on a day (N28 decision 7): out to the land their place's country holds, they gather what is
 * in season there; a rare root only in its season and only where it grows. Pure, from the species files and the day.
 */
export function herbalistHaul(realm: Realm, site: string, person: string, day: number): Record<string, number> {
  const s = realm.settlements[site];
  if (!s) return {};
  const frac = yearFraction(day, config.daysPerYear);
  const rng = streamFor(realm.seed, "herbalist", person, day);
  const out: Record<string, number> = {};
  for (const pl of Object.values(book().plants)) {
    if ((pl.biomes[s.terrain] ?? 0) < 0.5 || pl.effects.some((e) => e.causes)) continue;
    const stage = stageOf(pl.calendar, frac);
    const products = productsAt(pl, stage);
    if (products.length === 0) continue;
    const chance = pl.rarity === "rare" ? 0.5 : pl.rarity === "uncommon" ? 0.4 : 0.25;
    if (rng() >= chance) continue;
    for (const x of products) if (x.item !== "reeds" && x.item !== "moss") out[x.item] = (out[x.item] ?? 0) + x.qty[0];
  }
  return out;
}

// ---------- for the browser ----------

/** What the player's panels show of fauna and flora: never the true name of a mistaken gathering. */
export function natureView(p: PlayerState, site: string | null, store: { people: { loadSite(site: string, detail: "coarse"): unknown } } | null): NonNullable<import("@millbrook/shared").PlayerView["nature"]> {
  const n = natureOf(p);
  const entries = Object.entries(n.seen)
    .map(([id, s]) => {
      const e = entryOf(id, s.level);
      return e ? { ...e, level: s.level } : null;
    })
    .filter((x): x is NonNullable<typeof x> => !!x)
    .sort((a, b) => (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : a.name < b.name ? -1 : 1));
  const uses: Record<string, Array<"eat" | "brew" | "apply">> = {};
  for (const k of Object.keys(p.inventory)) {
    const name = parseItem(k)?.name ?? k;
    // What they believe it is decides the buttons: the believed plant's uses.
    const plant = Object.values(book().plants).find((pl) => pl.products.some((x) => x.item === name));
    if (!plant) continue;
    const ways = new Set(plant.effects.map((e) => (e.when === "eaten" ? "eat" : e.when === "brewed" ? "brew" : "apply")));
    if (ways.size > 0) uses[name] = [...ways] as Array<"eat" | "brew" | "apply">;
  }
  const stray = site ? strayAt(site) : null;
  const herb = site && store ? (store.people.loadSite(site, "coarse") as Array<{ name: string; job: string }>).find((r) => r.job === "herbalist") : undefined;
  return {
    entries,
    pets: n.pets.map((x) => `${x.name} (${book().animals[x.species]?.name.replace("stray ", "") ?? x.species})`),
    uses,
    stray: stray && !n.pets.some((x) => x.species === stray) ? stray : null,
    taming: n.taming && n.taming.site === site ? `${n.taming.days} days won over` : null,
    herbalist: herb?.name ?? null,
  };
}

/** What a fisher brings home on a day: fish of the water their place's country holds, in season. */
export function fisherHaul(realm: Realm, site: string, person: string, day: number): Record<string, number> {
  const s = realm.settlements[site];
  if (!s) return {};
  const season = seasonOf(day);
  const rng = streamFor(realm.seed, "fisher", person, day);
  const out: Record<string, number> = {};
  for (const f of Object.values(book().animals).filter((a) => a.class === "fish")) {
    const w = (f.biomes[s.terrain] ?? 0) * (f.seasons[season] ?? 1) * f.abundance;
    if (rng() < w * 0.8) for (const x of f.products) out[x.item] = (out[x.item] ?? 0) + x.qty[0] + (rng() < 0.4 ? 1 : 0);
  }
  return out;
}

// ---------- bounds ----------

/** Most copper's worth a herbalist brings home on an average day (N28's `herbalist-income`). */
export const HERBALIST_DAY_MAX = 120;

/**
 * N28's bounds: `wildlife-not-empty` (a sample of each country has animals in every season) and `herbalist-income` (what
 * herbalists bring home is worth a living, not a fortune: the economy isn't flooded with rare roots).
 */
export function checkNatureBounds(realm: Realm): Array<{ name: string; ok: boolean; detail: string }> {
  const specs = lightAnimals(book());
  const empty: string[] = [];
  for (const terrain of ["valley", "hills", "forest", "plains", "coast", "marsh"]) {
    for (const [season, frac] of [["spring", 0.1], ["summer", 0.35], ["autumn", 0.6], ["winter", 0.85]] as const) {
      let n = 0;
      for (let cy = 0; cy < 10; cy++) for (let cx = 0; cx < 10; cx++) n += animalsInChunk(realm.seed, specs, cx, cy, 3, 8 * 60, { terrain, season, frac, water: () => true }).length;
      if (n === 0) empty.push(`${terrain} in ${season}`);
    }
  }
  const values: number[] = [];
  for (const s of Object.values(realm.settlements).filter((x) => !x.way).slice(0, 20)) {
    let total = 0;
    for (let d = 1; d <= config.daysPerYear; d++) for (const [item, n] of Object.entries(herbalistHaul(realm, s.id, `t_${s.id}_0`, d))) total += (itemValueOf(item) ?? 0) * n;
    values.push(total / config.daysPerYear);
  }
  const top = values.length ? Math.max(...values) : 0;
  return [
    { name: "wildlife-not-empty", ok: empty.length === 0, detail: empty.length === 0 ? "animals in every country in every season" : `empty: ${empty.join(", ")}` },
    { name: "herbalist-income", ok: top <= HERBALIST_DAY_MAX, detail: `a herbalist brings home at most ${Math.round(top)} copper's worth a day on average` },
  ];
}

const itemValueOf = (item: string): number | undefined => parseItem(item)?.def.value;
