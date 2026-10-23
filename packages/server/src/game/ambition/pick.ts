import { CLASS_RANK, type SocialClass } from "@millbrook/shared";
import type { PersonRow } from "../../store/peopleStore.js";
import type { Rng } from "../dice.js";
import { speciesOf } from "../../world/species.js";
import { temperOf } from "../chatter/person.js";
import { ageFrom } from "../people/rules.js";
import { traitsOfRow } from "../people/traits.js";
import type { NpcPersona } from "../../npc/types.js";
import type { Rank } from "./careers.js";
import { isTrade, TRADES, type AmbitionKind } from "./kinds.js";

/**
 * Picking what someone wants from their life (N40), in code. Weights come from class, job, traits (ambition, greed, pride, bravery), family
 * (a child to marry, a trade in the family) and age (the old want quiet); the pick is a weighted roll from their own stream. It runs at
 * coming of age, on a place's first career day for everyone grown, and whenever an ambition is had or can no longer be had (`exclude`
 * keeps someone from wanting again what they just got).
 */
export interface PickEnv {
  day: number;
  site: string;
  kind: string;
  laws: { slavery: boolean; serfdom: boolean };
  /** Guilds with a seat or a branch here. */
  guilds: ReadonlySet<string>;
  /** Their rank in a trade, and the trade. */
  rank: Rank | null;
  trade: string | null;
  /** They keep a shop already. */
  hasShop: boolean;
  /** They hold land of their own already. */
  hasLand: boolean;
  /** Seats they hold now (seat ids). */
  seats: readonly string[];
  /** Their unmarried children nearing an age to marry: id and age. */
  children: ReadonlyArray<{ id: string; age: number }>;
  /** The heaviest grievance they hold open: against whom, how heavy now. */
  grudge: { against: string; weight: number } | null;
  /** The place has barracks or a hall (somewhere knights serve). */
  knightly: boolean;
}

export interface Picked {
  kind: AmbitionKind;
  target: string | null;
  /** The rung they are on already (a journeyman who wants mastery is on 1). */
  step: number;
}

/** The class a council seat asks for in a place of this size: a village takes anyone free, a city its betters. */
export const councilClass = (kind: string): number => (kind === "city" || kind === "capital" ? 5 : kind === "town" ? 3 : 2);
/** How much a grievance must weigh to become what someone lives for. */
export const REVENGE_AT = 0.6;

/** The weight of every kind for this person. Kinds they cannot hold are left out. */
export function weightsFor(row: PersonRow, env: PickEnv): Array<[AmbitionKind, number, string | null, number]> {
  const t = traitsOfRow(row);
  const temper = temperOf(row);
  const rank = CLASS_RANK[row.cls as SocialClass] ?? 2;
  const age = ageFrom(row.born_day, env.day);
  const sp = speciesOf(row.species);
  const old = age >= sp.elderAge || row.job === "elder";
  const bound = (row.cls === "slave" && env.laws.slavery) || (row.cls === "serf" && env.laws.serfdom);
  const drive = 0.4 + t.ambition;
  const out: Array<[AmbitionKind, number, string | null, number]> = [];
  const add = (kind: AmbitionKind, w: number, target: string | null = null, step = 0) => w > 0 && out.push([kind, Math.round(w * 1000) / 1000, target, step]);

  add("quiet_life", old ? 1.6 : 0.1 + 0.35 * (1 - t.ambition));
  if (env.grudge && env.grudge.weight >= REVENGE_AT) add("revenge", (0.6 + env.grudge.weight) * (1 - temper.forgiveness) * (old ? 0.5 : 1), env.grudge.against);
  if (old) return out;

  if (bound) {
    add("freedom", 0.6 + 0.5 * t.bravery, row.master_id);
    return out;
  }
  // A trade: mastery, then a shop.
  if (env.trade && !(env.rank === "master" && env.hasShop)) add("master_trade", 0.9 * drive, env.trade, env.rank === "apprentice" ? 0 : env.rank === "journeyman" ? 1 : 2);
  // A guild's seats are for its members, and only those of a free class.
  if (row.faction && env.guilds.has(row.faction) && rank >= 2) {
    const officer = env.seats.some((s) => s.startsWith(`g:${row.faction}:`) && s.endsWith(":officer"));
    const master = env.seats.some((s) => s.startsWith(`g:${row.faction}:`) && s.endsWith(":master"));
    if (!master) add("guild_seat", (env.rank === "master" ? 0.7 : 0.3) * drive + 0.2 * temper.pride, row.faction, officer ? 1 : 0);
  }
  // Land of one's own: the free who work for others.
  if (!env.hasLand && (rank === 2 || (rank === 1 && !env.laws.serfdom)) && ["farmer", "labourer", "porter", "washer", "miner", "hunter"].includes(row.job)) add("land", 0.55 * drive + 0.2 * t.greed);
  // A say in the place.
  if (rank >= councilClass(env.kind) && env.kind !== "hamlet" && age >= sp.adultAge + 6 && env.rank !== "apprentice") {
    const sitting = env.seats.some((s) => s.startsWith("council:"));
    add("office", (rank >= 5 ? 0.7 : 0.25) * drive + 0.2 * temper.pride, env.site, sitting ? 1 : 0);
  }
  if (row.cls === "merchant" || row.job === "merchant" || row.job === "stallholder" || row.job === "innkeeper") add("wealth", 0.5 + 0.6 * t.greed);
  else if (env.trade) add("wealth", 0.15 * t.greed);
  if ((row.job === "guard" || (row.cls === "gentry" && row.job !== "knight")) && env.knightly) add("knighthood", 0.3 + 0.6 * t.bravery * drive, env.site);
  const child = [...env.children].sort((a, b) => b.age - a.age || (a.id < b.id ? -1 : 1))[0];
  if (child) add("good_match", 0.25 + 0.1 * rank + 0.3 * temper.pride, child.id);
  return out;
}

/** Pick someone's ambition. */
export function pickAmbition(row: PersonRow, env: PickEnv, rng: Rng, exclude?: AmbitionKind): Picked {
  const all = weightsFor(row, env).filter(([k]) => k !== exclude);
  const total = all.reduce((s, [, w]) => s + w, 0);
  if (all.length === 0 || total <= 0) return { kind: "quiet_life", target: null, step: 0 };
  let r = rng() * total;
  for (const [kind, w, target, step] of all) {
    if (r < w) return { kind, target, step };
    r -= w;
  }
  const [kind, , target, step] = all[all.length - 1]!;
  return { kind, target, step };
}

/** A talker who has no row (a notable of the realm): picked from their role and traits, and their best skill (0..5) gives the rung. */
export function pickForTalker(persona: Pick<NpcPersona, "role" | "greed" | "traits" | "skills" | "age">, site: string, rng: Rng): Picked {
  const role = persona.role.toLowerCase();
  const trade = Object.keys(TRADES).find((j) => role.includes(j));
  const best = Math.max(0, ...Object.values(persona.skills ?? {}).map((v) => Number(v) || 0));
  const drive = 0.4 + (persona.traits?.bravery ?? 0.5) * 0.3 + (persona.greed ?? 0.5) * 0.3;
  const options: Array<[AmbitionKind, number, string | null, number]> = [["quiet_life", persona.age >= 60 ? 1.5 : 0.2, null, 0]];
  if (trade) options.push(["master_trade", 1 * drive, trade, best >= 4 ? 2 : best >= 2 ? 1 : 0]);
  if (/\b(merchant|trader|innkeeper)\b/.test(role)) options.push(["wealth", 0.6 + 0.6 * (persona.greed ?? 0.5), null, 0]);
  if (/\b(guard|squire|soldier|captain)\b/.test(role)) options.push(["knighthood", 0.6 * drive, site, 0]);
  if (/\b(mayor|reeve|elder|steward|clerk|lord|lady)\b/.test(role)) options.push(["office", 0.7 * drive, site, /\b(mayor|reeve|elder|lord|lady)\b/.test(role) ? 1 : 0]);
  const total = options.reduce((s, [, w]) => s + w, 0);
  let r = rng() * total;
  for (const [kind, w, target, step] of options) {
    if (r < w) return { kind, target, step };
    r -= w;
  }
  return { kind: "quiet_life", target: null, step: 0 };
}

export { isTrade };
