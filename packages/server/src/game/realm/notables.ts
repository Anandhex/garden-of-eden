import { parsePersona } from "../../npc/personaSchema.js";
import { assemblePersona, fallbackIdentity, rollTemplate, type NpcTemplate } from "../../npc/templates.js";
import type { NpcPersona, QuestDef } from "../../npc/types.js";
import { speciesOf } from "../../world/species.js";
import { seedFrom, seededRng } from "../dice.js";
import { ITEM_TIERS } from "../items.js";
import { tierIndex, type Tier } from "../life.js";
import { ageOn } from "../life.js";
import { compareTiers } from "../levels.js";
import { chainOf, titled } from "./figures.js";
import { lieges } from "./generate.js";
import { FACTION_OF_TEMPLATE } from "../factions.js";
import { rankIn } from "./factions.js";
import { knowsFor } from "./lore.js";
import type { Figure, Realm, Role, Settlement } from "./types.js";
import { CLASS_ATTITUDE, figureClass } from "./townsfolk.js";

/**
 * The notable people of a place (N14, N25a): its head and its best-known residents are talking NPCs, made the same
 * way for every place from a template by their role (smith, innkeeper, merchant, guard, farmer or bandit), with
 * their own name, rank, age, office, superior, faction and deeds, and lore about their own place. No model call
 * here: the template's words, with this place's name (the model rewrites their story in the background:
 * npc/depth). They are kept in the talkers registry (game/talkers.ts), by figure id, so the same person is there
 * next time, with the same memories of the player.
 */

/** Most talking NPCs made for one place. */
export const MAX_NOTABLES = 8;

/** Persona id for a figure. */
export const figureTalkerId = (figureId: string) => `f_${figureId.replace(/[^a-z0-9]/g, "_")}`;

const TEMPLATE_FOR: Partial<Record<Role, string>> = {
  merchant: "merchant",
  smith: "smith",
  innkeeper: "innkeeper",
  guildmaster: "merchant",
  captain: "guard",
  guard: "guard",
  noble: "guard",
  adventurer: "guard",
  ruler: "guard",
  lord: "guard",
  mayor: "guard",
  bandit: "bandit",
  "bandit chief": "bandit",
  rebel: "bandit",
};

/** "the mayor of Ashby", "a farmer of Ashby", "the queen of Corveth". */
export function roleWords(realm: Realm, f: Figure, s: Settlement): string {
  const fac = f.faction ? realm.factions[f.faction] : undefined;
  switch (f.role) {
    case "ruler":
      return `the ${f.gender === "female" ? "queen" : "king"} of ${s.kingdom ? (realm.kingdoms[s.kingdom]?.name ?? s.name) : s.name}, who rules from ${s.name}`;
    case "lord":
      return `the ${f.gender === "female" ? "lady" : "lord"} of ${s.name}`;
    case "mayor":
      return `the mayor of ${s.name}`;
    case "village head":
      return `the head of the village of ${s.name}`;
    case "elder":
      return `the elder of ${s.name}`;
    case "guildmaster":
      return `the guildmaster of ${fac?.name ?? "a guild"} in ${s.name}`;
    case "captain":
      return `the captain of the watch of ${s.name}`;
    case "innkeeper":
      return `the innkeeper of ${s.name}`;
    case "smith":
      return `the smith of ${s.name}`;
    case "adventurer":
      return `an adventurer${fac ? ` of ${fac.name}` : ""}, based in ${s.name}`;
    default:
      return `a ${f.role} of ${s.name}`;
  }
}

/**
 * The figures of a place worth meeting: the head first, then by renown. Not the beasts, and not the ones who
 * talk already.
 */
export function notablesOf(realm: Realm, site: string): Figure[] {
  const s = realm.settlements[site];
  if (!s) return [];
  const folk = Object.values(realm.figures).filter((f) => f.alive && !f.talks && f.home === site && f.role !== "beast" && speciesOf(f.species).talks);
  folk.sort((a, b) => (b.id === s.leader ? 1 : 0) - (a.id === s.leader ? 1 : 0) || b.renown - a.renown);
  return folk.slice(0, MAX_NOTABLES);
}

const HEAD_ROLES = new Set<Role>(["ruler", "lord", "mayor", "village head", "elder"]);

/** A persona for a figure of a place. Null if the template's missing or the file doesn't pass the schema. */
export function notablePersona(realm: Realm, f: Figure, templates: Record<string, NpcTemplate>, day: number, id = figureTalkerId(f.id)): NpcPersona | null {
  const s = f.home ? realm.settlements[f.home] : undefined;
  if (!s) return null;
  const t = templates[TEMPLATE_FOR[f.role] ?? "farmer"] ?? templates.farmer;
  if (!t) return null;
  const rng = seededRng(seedFrom(f.id));
  const r = rollTemplate(t, rng);
  r.gender = f.gender;
  r.species = f.species;
  r.tier = f.life.tier as Tier;
  r.potential = (tierIndex(f.life.potential as Tier) >= tierIndex(r.tier) ? f.life.potential : r.tier) as Tier;
  r.age = Math.max(speciesOf(f.species).adultAge, ageOn(f.life as never, day));
  r.voice = { ...t.voice[f.gender], pitch: r.voice.pitch, rate: r.voice.rate };
  // Nobody carries gear above their rank (the schema checks it).
  const kingdom = s.kingdom ? realm.kingdoms[s.kingdom]?.name : undefined;
  const where = { place: s.name, kind: s.kind, ...(kingdom ? { kingdom } : {}) };
  const words = fallbackIdentity(t, r, rng, f.name.replace(/ (the \w+|Ironhand|Quickblade|Oathkeeper|Stonearm|Halfhand|Brightspear)$/i, ""), where);
  if (!/^[A-Z][a-z'-]+( [A-Z][a-z'-]+){0,2}$/.test(words.name)) words.name = `${r.fallbackName.first} ${r.fallbackName.family}`;
  const role = roleWords(realm, f, s);
  const chain = chainOf(realm, f.id).slice(0, 2).map(titled);
  const fac = f.faction ? realm.factions[f.faction] : undefined;
  const liege = lieges(realm, s.id)[0];
  words.backstory = [
    `${words.name} is ${role}.`,
    chain.length > 0 ? `They answer to ${chain.join(", and above them ")}.` : "They answer to no one.",
    fac ? `They are a ${rankIn(realm, fac, f.id)} of ${fac.name} ("${fac.creed}").` : null,
    liege ? `${s.name} pays its taxes to ${liege.name}.` : null,
    f.deeds.length > 0 ? `Folk know them for this: ${f.deeds.slice(-3).join("; ")}.` : null,
    // Their station (N16): what they make of those above and below them.
    CLASS_ATTITUDE[figureClass(f.role)],
  ]
    .filter(Boolean)
    .join(" ")
    .slice(0, 500);
  if (HEAD_ROLES.has(f.role)) words.goals = [`Keep ${s.name} fed, safe and paying its way`, ...words.goals].slice(0, 3);
  const persona = assemblePersona(t, r, words, id, where);
  persona.role = role;
  // The head of a place has a head's purse: it pays for the work they post.
  if (HEAD_ROLES.has(f.role)) persona.startingMoney = Math.max(persona.startingMoney, Math.min(f.wealth, 4000));
  // What they know: their place for certain, the places near it and the lords above it, the realm by rumour. News only when it reaches them.
  persona.knows = knowsFor(realm, s);
  if (HEAD_ROLES.has(f.role)) persona.schedule = [{ from: 6, to: 20, activity: "work", place: "square" }, { from: 20, to: 6, activity: "sleep", place: "home" }];
  if (f.role === "bandit" || f.role === "bandit chief" || f.role === "rebel") persona.schedule = [{ from: 6, to: 21, activity: "work", place: "square" }, { from: 21, to: 6, activity: "sleep", place: "home" }];
  persona.quests = jobsFor(realm, f, s, persona);
  const kind = FACTION_OF_TEMPLATE[t.id];
  if (kind) persona.faction = kind;
  else delete persona.faction;
  try {
    return parsePersona(persona, `notable ${persona.id}`);
  } catch {
    // Gear above their rank (a green captain): they make do without armour, with the template's plainest weapon.
    delete persona.armor;
    persona.weapon = t.weapon.at(-1)!;
    try {
      return parsePersona(persona, `notable ${persona.id}`);
    } catch (e) {
      void e;
      return null;
    }
  }
}

/** A head with a dungeon nearby wants it cleared; one with too many beasts about wants them thinned (as a clear job, for the dungeon only). */
function jobsFor(realm: Realm, f: Figure, s: Settlement, persona: NpcPersona): QuestDef[] {
  if (!HEAD_ROLES.has(f.role) && f.role !== "captain") return [];
  const d = Object.values(realm.dungeons).find((x) => x.near === s.id);
  if (!d) return [];
  const tier = ITEM_TIERS[Math.min(ITEM_TIERS.length - 1, ITEM_TIERS.indexOf(d.tier) + (d.depth >= 3 ? 1 : 0))]!;
  if (compareTiers(tier, persona.maxQuestTier) > 0) persona.maxQuestTier = tier;
  return [{ id: `clear_${d.id}`, title: `Clear out ${d.name}`, description: `${d.name} near ${s.name} is full of things that come out at night. Go down and clear it, every level.`, tier, minTrust: 0, objective: { type: "clear", dungeon: d.id, name: d.name, qty: 1 }, reward: { money: 120 * (ITEM_TIERS.indexOf(d.tier) + 1) * d.depth } }];
}

export interface Notable {
  id: string;
  persona: NpcPersona;
  state: import("../../npc/types.js").NpcState;
}
