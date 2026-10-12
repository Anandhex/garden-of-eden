import type { Rng } from "../dice.js";
import { seasonOf } from "../weather.js";
import { addDeed, addRenown, residents, titled } from "./figures.js";
import { neighbours } from "./generate.js";
import { realmNews, tally } from "./log.js";
import { type BuildingId, KIND_POPULATION, type Realm, type Settlement, type SettlementKind } from "./types.js";

/**
 * Prosperity, building and moving (N13.2), a day at a time, in code.
 *
 * Food: farms and the land feed the people, more in the harvest, less in winter;
 * a granary softens winter. Coin: markets, mines, smithies and inns earn, with
 * prosperity; buildings cost upkeep. Prosperity drifts toward what food, coin,
 * safety, taxes and buildings make of it. People are born when fed and safe, and
 * starve when not. A settlement with coin builds what it needs most; one that grows
 * is promoted (hamlet → village → town → city); one that empties is abandoned.
 * People, and ambitious figures, move to better places nearby.
 */
const TERRAIN_FOOD: Record<string, number> = { valley: 1.05, plains: 1.08, coast: 1.02, forest: 0.98, hills: 0.96, marsh: 0.94 };
const SEASON_FOOD: Record<string, number> = { spring: 1.0, summer: 1.1, autumn: 1.2, winter: 0.75 };
/** How big a place is, for costs and upkeep. */
export const KIND_SCALE: Record<SettlementKind, number> = { hamlet: 0.5, village: 1, town: 2.5, city: 5, capital: 7 };
/** Highest level of a building each kind of place can have. */
export const MAX_LEVEL: Record<SettlementKind, number> = { hamlet: 1, village: 2, town: 3, city: 4, capital: 5 };
/** Buildings in words, for news. */
export const BUILDING_WORDS: Record<BuildingId, string> = { farms: "new fields", market: "a market", walls: "walls", smithy: "a smithy", inn: "an inn", temple: "a temple", guildhall: "a guild hall", barracks: "barracks", mine: "a mine", granary: "a granary" };

/** Days a raid keeps a place feeling unsafe. */
export const UNSAFE_DAYS = 12;
/** Copper a working head brings in a day, before buildings and prosperity. */
export const INCOME_PER_HEAD = 0.35;
/** Daily growth of a fed, safe place at prosperity 50. */
export const GROWTH = 0.0015;
/** Below this, people starve. */
export const FAMINE = 12;

const level = (s: Settlement, b: BuildingId) => s.buildings[b] ?? 0;
const sumLevels = (s: Settlement) => Object.values(s.buildings).reduce<number>((a, b) => a + (b ?? 0), 0);

/** Stochastic rounding, so small places still change. */
function roundBy(rng: Rng, n: number): number {
  const f = Math.floor(n);
  return f + (rng() < n - f ? 1 : 0);
}

/** Is the settlement's kingdom at war? */
export function atWar(realm: Realm, s: Settlement): boolean {
  return realm.wars.some((w) => w.end === undefined && [...w.attackers, ...w.defenders].some((p) => p === `k:${s.kingdom}` || p === `s:${s.id}`));
}

/** Trade treaties the settlement (or its kingdom) is part of, in force. */
export function tradeTreaties(realm: Realm, s: Settlement, day: number): number {
  return realm.treaties.filter((t) => t.kind === "trade" && !t.broken && t.until >= day && [t.a, t.b].some((p) => p === `s:${s.id}` || p === `k:${s.kingdom}`)).length;
}

/** Copper a settlement earns in a day. */
export function income(realm: Realm, s: Settlement, day: number): number {
  const work = (0.4 + 0.25 * level(s, "market") + 0.2 * level(s, "mine") + 0.1 * level(s, "smithy") + 0.1 * level(s, "inn")) * INCOME_PER_HEAD;
  return Math.round(s.population * work * (s.prosperity / 50) * (1 + 0.15 * tradeTreaties(realm, s, day)) * (atWar(realm, s) ? 0.8 : 1));
}

/** Copper a settlement spends in a day on its buildings and watch. */
export function upkeep(s: Settlement): number {
  return Math.round(3 * sumLevels(s) * KIND_SCALE[s.kind] + 2 * level(s, "barracks") * KIND_SCALE[s.kind]);
}

/** Food made per head, as a share of what's eaten (1 = enough). */
export function foodRatio(realm: Realm, s: Settlement, day: number): number {
  const workers = residents(realm, s.id).filter((f) => f.role === "farmer" || f.role === "hunter").length;
  return (0.92 + 0.08 * level(s, "farms") + 0.02 * workers) * (TERRAIN_FOOD[s.terrain] ?? 1) * (SEASON_FOOD[seasonOf(day)] ?? 1);
}

/** Where prosperity is heading: food, coin, safety, taxes and buildings. */
export function prosperityTarget(realm: Realm, s: Settlement, day: number): number {
  const perHead = s.population > 0 ? income(realm, s, day) / s.population : 0;
  const unsafe = s.lastRaided !== undefined && day - s.lastRaided <= UNSAFE_DAYS ? 15 : 0;
  const war = atWar(realm, s) ? 10 : 0;
  return Math.max(0, Math.min(100, 28 + s.food * 0.25 + Math.min(20, perHead * 15) - unsafe - war - s.taxRate * 40 + Math.min(15, sumLevels(s) * 1.5)));
}

/** What a settlement would build next, and why (null: nothing needed). */
export function neededBuilding(realm: Realm, s: Settlement, day: number): { building: BuildingId; why: string } | null {
  const max = MAX_LEVEL[s.kind];
  const can = (b: BuildingId) => level(s, b) < max;
  const raided = s.lastRaided !== undefined && day - s.lastRaided <= UNSAFE_DAYS * 2;
  const beasts = Object.values(realm.packs).some((p) => p.near === s.id && p.count >= p.cap * 0.7);
  if ((raided || beasts || atWar(realm, s)) && can("walls")) return { building: "walls", why: raided ? "after the raid" : beasts ? "against the beasts" : "for the war" };
  if (s.food < 45 && can("farms")) return { building: "farms", why: "to feed its people" };
  if (atWar(realm, s) && s.kind !== "hamlet" && can("barracks")) return { building: "barracks", why: "for the war" };
  if (s.food < 35 && level(s, "farms") >= 2 && can("granary")) return { building: "granary", why: "against lean winters" };
  const guild = Object.values(realm.factions).find((f) => !f.dissolved && f.kind === "guild" && f.branches.includes(s.id));
  if (guild && level(s, "guildhall") === 0 && can("guildhall")) return { building: "guildhall", why: `for ${guild.name}` };
  if (s.prosperity > 55 && can("market")) return { building: "market", why: "for its trade" };
  if (s.prosperity > 65 && can("temple")) return { building: "temple", why: "to give thanks" };
  if (s.terrain === "hills" && can("mine")) return { building: "mine", why: "for the ore in the hills" };
  if (s.prosperity > 50 && can("inn")) return { building: "inn", why: "for travellers" };
  if (s.prosperity > 50 && can("smithy")) return { building: "smithy", why: "for tools and blades" };
  return null;
}

export function buildCost(s: Settlement, b: BuildingId): number {
  return Math.round((level(s, b) + 1) ** 2 * 250 * KIND_SCALE[s.kind]);
}

const NEXT_KIND: Partial<Record<SettlementKind, Exclude<SettlementKind, "capital" | "hamlet">>> = { hamlet: "village", village: "town", town: "city" };

/** One day of economy for every settlement. Returns lines worth telling. */
export function economyDay(realm: Realm, day: number, rng: Rng): void {
  for (const s of Object.values(realm.settlements)) {
    if (s.abandoned) continue;
    // Food.
    const ratio = foodRatio(realm, s, day);
    let delta = (ratio - 1) * 40;
    if (seasonOf(day) === "winter") delta += level(s, "granary") * 1.5;
    s.food = clamp(s.food + delta);
    // Short of food, a place with coin buys it from its neighbours.
    if (s.food < 30 && s.treasury > s.population) {
      const cost = Math.round(s.population * 0.8);
      s.treasury -= cost;
      s.food = clamp(s.food + 8);
    }
    // Coin.
    s.treasury = Math.max(0, s.treasury + income(realm, s, day) - upkeep(s));
    // Prosperity drifts toward its target, 2 points a day at most.
    const target = prosperityTarget(realm, s, day);
    s.prosperity = clamp(s.prosperity + Math.max(-2, Math.min(2, (target - s.prosperity) * 0.2)));
    // People.
    if (s.food < FAMINE) {
      const lost = roundBy(rng, s.population * 0.015);
      s.population = Math.max(0, s.population - lost);
      if (lost > 0 && rng() < 0.15) realmNews(realm, day, s.id, "famine", `Hunger in ${s.name}: people are going without bread.`, 4, [s.name]);
      tally(realm, "starved", lost);
    } else if (s.food > 30 && s.prosperity > 35) {
      s.population += roundBy(rng, s.population * GROWTH * (s.prosperity / 50));
    }
    build(realm, s, day);
    growOrEmpty(realm, s, day);
  }
  migrate(realm, day, rng);
}

/** Finish a building that's done, or start the one needed if the coffers allow. */
function build(realm: Realm, s: Settlement, day: number): void {
  if (s.project && day >= s.project.done) {
    const b = s.project.building;
    s.buildings[b] = Math.min(MAX_LEVEL[s.kind], level(s, b) + 1);
    s.project = null;
    tally(realm, "buildings");
    const lead = s.leader ? realm.figures[s.leader] : undefined;
    if (lead) {
      addRenown(lead, 2);
      addDeed(lead, `raised the ${b} of ${s.name}`);
    }
    realmNews(realm, day, s.id, "building", `${s.name} finished ${b === "farms" ? "clearing new fields" : `building ${BUILDING_WORDS[b]}`} (level ${s.buildings[b]}).`, b === "walls" || b === "guildhall" ? 4 : 3, [s.name]);
    return;
  }
  if (s.project) return;
  const need = neededBuilding(realm, s, day);
  if (!need) return;
  const cost = buildCost(s, need.building);
  if (s.treasury < cost * 1.2) return;
  s.treasury -= cost;
  s.project = { building: need.building, done: day + 4 + level(s, need.building) * 3, cost };
  tally(realm, "projects");
  realmNews(realm, day, s.id, "building", `${s.name} has started ${need.building === "farms" ? "clearing new fields" : `building ${BUILDING_WORDS[need.building]}`} ${need.why}.`, 2, [s.name]);
}

/** A place that grew enough is promoted; one that emptied is abandoned (its people and figures go elsewhere). */
function growOrEmpty(realm: Realm, s: Settlement, day: number): void {
  const next = NEXT_KIND[s.kind];
  if (next && s.population >= KIND_POPULATION[next]) {
    const was = s.kind;
    s.kind = next;
    tally(realm, "promotions");
    realmNews(realm, day, s.id, "growth", `${s.name} has grown from a ${was} into a ${next}.`, 5, [s.name]);
  }
  if (s.population < 8 && s.kind !== "capital" && !s.home) {
    s.abandoned = true;
    const to = neighbours(realm, s.id).sort((a, b) => b.prosperity - a.prosperity)[0];
    if (to) to.population += s.population;
    s.population = 0;
    for (const f of residents(realm, s.id)) f.home = to?.id ?? null;
    tally(realm, "abandoned");
    realmNews(realm, day, s.id, "abandoned", `${s.name} stands empty: the last of its people have left${to ? ` for ${to.name}` : ""}.`, 6, [s.name, ...(to ? [to.name] : [])]);
  }
}

/** People move to better places one road away; ambitious figures too. */
function migrate(realm: Realm, day: number, rng: Rng): void {
  for (const s of Object.values(realm.settlements)) {
    if (s.abandoned || s.population < 10) continue;
    const fleeing0 = s.food < FAMINE || (s.lastRaided !== undefined && day - s.lastRaided <= 2);
    // A small place only empties out when it has to.
    if (!fleeing0 && s.population < 30) continue;
    const better = neighbours(realm, s.id)
      .filter((n) => n.prosperity - s.prosperity > 15 && n.food > 30)
      .sort((a, b) => b.prosperity - a.prosperity)[0];
    const fleeing = s.food < FAMINE || (s.lastRaided !== undefined && day - s.lastRaided <= 2);
    if (!better && !fleeing) continue;
    const to = better ?? neighbours(realm, s.id).sort((a, b) => b.prosperity - a.prosperity)[0];
    if (!to) continue;
    const share = fleeing ? 0.02 : 0.003 * ((to.prosperity - s.prosperity) / 15);
    const moving = Math.min(s.population - 5, roundBy(rng, s.population * share));
    if (moving <= 0) continue;
    s.population -= moving;
    to.population += moving;
    tally(realm, "migrants", moving);
    if (to.home && moving >= 3) realm.home.push({ day, kind: "refugees", count: Math.min(4, Math.ceil(moving / 3)), by: s.name });
    if (fleeing && moving >= 5 && rng() < 0.3) realmNews(realm, day, s.id, "refugees", `Folk are leaving ${s.name} for ${to.name}: ${moving} gone this week.`, 3, [s.name, to.name]);
  }
  // An ambitious figure in a poor place looks for better.
  for (const f of Object.values(realm.figures)) {
    if (!f.alive || f.talks || !f.home || f.role === "beast" || f.ambition < 0.6) continue;
    const home = realm.settlements[f.home];
    if (!home || home.leader === f.id || home.prosperity >= 35 || rng() >= 0.08) continue;
    const to = neighbours(realm, home.id).filter((n) => n.prosperity - home.prosperity >= 20).sort((a, b) => b.prosperity - a.prosperity)[0];
    if (!to) continue;
    f.home = to.id;
    f.superior = to.leader;
    tally(realm, "movers");
    realmNews(realm, day, home.id, "moved", `${titled(f)} has left ${home.name} to seek a better life in ${to.name}.`, 2, [f.name, home.name, to.name]);
  }
}

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n * 10) / 10));
