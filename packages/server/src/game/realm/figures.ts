import type { NpcStats } from "../../npc/stats.js";
import { speciesOf } from "../../world/species.js";
import type { Rng } from "../dice.js";
import { createLife, type Life, type LifeContext, newDay, overcome, type Challenge, gainXp, tierIndex, TIERS, type Tier } from "../life.js";
import { causeFromWords, type DeathRecord } from "../people/death.js";
import { personName } from "./names.js";
import type { Figure, Realm, Role } from "./types.js";

/**
 * Figures (N13.1): the realm's named people and beasts. They don't talk and cost
 * no model call; they're a stat block with a `Life`, so they age, gain XP and
 * break through only by overcoming challenges, like everyone (game/life.ts).
 * What they do (fight in raids, delve, lead, split off) is rolled in code.
 */

/** Base stats a figure grows from, by kind of being. The realm only needs them for rank growth. */
const BASE: Record<string, NpcStats> = {
  person: { maxHp: 40, maxMp: 5, attributes: { strength: 11, agility: 11, endurance: 11, intelligence: 11, willpower: 10, charisma: 11, perception: 11, luck: 10 } },
  beast: { maxHp: 30, maxMp: 0, attributes: { strength: 13, agility: 14, endurance: 12, intelligence: 3, willpower: 9, charisma: 4, perception: 14, luck: 10 } },
};

export function figureContext(f: Pick<Figure, "species">): LifeContext {
  const species = speciesOf(f.species);
  return { species, base: BASE[species.talks ? "person" : "beast"]! };
}

/** A fighting role (they go on raids, into battles and dungeons). */
export const FIGHTERS: ReadonlySet<Role> = new Set(["captain", "adventurer", "bandit chief", "bandit", "rebel", "beast", "noble", "hunter"]);

/** How much one figure adds to a fight: rank counts for most; age and fear take some off. */
export function figurePower(f: Figure): number {
  if (!f.alive) return 0;
  const rank = tierIndex(f.life.tier as Tier);
  const age = f.life.stage === "young" ? 0.5 : f.life.stage === "venerable" ? 0.4 : f.life.stage === "elder" ? 0.75 : 1;
  return (4 + rank * rank * 3) * age * (0.7 + 0.6 * f.bravery);
}

export interface NewFigure {
  role: Role;
  home: string | null;
  tier: Tier;
  /** Highest rank they may reach. */
  potential?: Tier;
  age: number;
  species?: string;
  gender?: "female" | "male";
  name?: string;
  faction?: string | null;
  superior?: string | null;
  renown?: number;
  wealth?: number;
  rose?: string;
  parents?: string[];
}

/** Every name in use, so new ones don't clash. */
export function takenNames(realm: Realm): Set<string> {
  return new Set(Object.values(realm.figures).map((f) => f.name));
}

/** A new figure, added to the realm. Traits rolled; rank and age as given. */
export function makeFigure(realm: Realm, rng: Rng, o: NewFigure, day: number): Figure {
  const species = o.species ?? "human";
  const gender = o.gender ?? (rng() < 0.5 ? "female" : "male");
  const def = speciesOf(species);
  const potentialIdx = Math.min(TIERS.indexOf(def.maxTier), Math.max(TIERS.indexOf(o.tier), TIERS.indexOf(o.potential ?? o.tier) + (o.potential ? 0 : Math.floor(rng() * 3))));
  const life = createLife(def, o.age, o.tier, day, TIERS[potentialIdx]!);
  const id = `fig-${realm.next++}`;
  const f: Figure = {
    id,
    name: o.name ?? personName(rng, gender, takenNames(realm)),
    gender,
    species,
    role: o.role,
    home: o.home,
    life: life as Figure["life"],
    ambition: round(rng()),
    loyalty: round(rng()),
    greed: round(rng()),
    bravery: round(0.2 + rng() * 0.8),
    renown: o.renown ?? Math.round(5 + tierIndex(o.tier) * 6 + rng() * 10),
    wealth: o.wealth ?? Math.round(50 + rng() * 200) * (tierIndex(o.tier) + 1),
    faction: o.faction ?? null,
    superior: o.superior ?? null,
    ...(o.parents ? { parents: o.parents } : {}),
    alive: true,
    deeds: [],
    ...(o.rose ? { rose: o.rose } : {}),
    since: day,
  };
  realm.figures[id] = f;
  return f;
}

const round = (n: number) => Math.round(n * 100) / 100;

/** The figure got through something hard: XP, titles, maybe a breakthrough. Returns log lines. */
export function figureOvercomes(f: Figure, xp: number, challenge: Challenge, day: number): string[] {
  if (!f.alive) return [];
  const ctx = figureContext(f);
  gainXp(f.life as Life, ctx, xp);
  const out = overcome(f.name, f.life as Life, ctx, challenge, day);
  if (out.rose) addRenown(f, 6);
  return out.log;
}

export function addRenown(f: Figure, n: number): void {
  f.renown = Math.max(0, Math.min(100, Math.round(f.renown + n)));
}

/** A deed for their record (the last eight are kept). */
export function addDeed(f: Figure, deed: string): void {
  f.deeds.push(deed);
  if (f.deeds.length > 8) f.deeds.shift();
}

/** Dead: kept in the record, out of every office. Returns true if they were alive. */
export function killFigure(realm: Realm, f: Figure, day: number, cause: string, record: Partial<DeathRecord> = {}): boolean {
  if (!f.alive) return false;
  f.alive = false;
  f.deathDay = day;
  // The words stay as they were said; the typed record (N25) says how, when and where the same way for everyone.
  f.deathCause = cause;
  f.death = { cause: causeFromWords(cause), day, site: f.home, note: cause, ...record };
  for (const fac of Object.values(realm.factions)) {
    fac.members = fac.members.filter((m) => m !== f.id);
    if (fac.leader === f.id) fac.leader = null;
  }
  for (const s of Object.values(realm.settlements)) if (s.leader === f.id) s.leader = null;
  for (const k of Object.values(realm.kingdoms)) if (k.ruler === f.id) k.ruler = null;
  for (const p of Object.values(realm.packs)) if (p.alpha === f.id) p.alpha = null;
  for (const o of Object.values(realm.figures)) if (o.superior === f.id) o.superior = null;
  realm.stats.deaths = (realm.stats.deaths ?? 0) + 1;
  return true;
}

/** A day older for everyone alive: aging, a day's XP, and the natural-death roll. Returns those who died. */
export function ageFigures(realm: Realm, day: number, rng: Rng): Figure[] {
  const died: Figure[] = [];
  for (const f of Object.values(realm.figures)) {
    if (!f.alive || f.talks) continue;
    const r = newDay(f.name, f.life as Life, figureContext(f), day, rng);
    if (r.died && killFigure(realm, f, day, "old age")) died.push(f);
  }
  return died;
}

/** "Queen Maud Reed", "Lord Edric Pike", "Elder Ada Lowe", "Greyfang". */
export function titled(f: Figure): string {
  switch (f.role) {
    case "ruler":
      return `${f.gender === "female" ? "Queen" : "King"} ${f.name}`;
    case "lord":
      return `${f.gender === "female" ? "Lady" : "Lord"} ${f.name}`;
    case "mayor":
      return `Mayor ${f.name}`;
    case "elder":
      return `Elder ${f.name}`;
    case "captain":
      return `Captain ${f.name}`;
    case "guildmaster":
      return `Guildmaster ${f.name}`;
    default:
      return f.name;
  }
}

/** The office that goes with heading each kind of settlement. */
export function leaderRole(kind: string): Role {
  return kind === "capital" ? "ruler" : kind === "city" ? "lord" : kind === "town" ? "mayor" : kind === "village" ? "village head" : "elder";
}

/** Alive figures living somewhere (not counting beasts). */
export function residents(realm: Realm, settlement: string): Figure[] {
  return Object.values(realm.figures).filter((f) => f.alive && f.home === settlement && f.role !== "beast");
}

/** The chain of command above a figure, nearest first (stops at loops). */
export function chainOf(realm: Realm, id: string): Figure[] {
  const out: Figure[] = [];
  const seen = new Set([id]);
  let cur = realm.figures[id]?.superior ?? null;
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    const f = realm.figures[cur];
    if (!f) break;
    out.push(f);
    cur = f.superior;
  }
  return out;
}
