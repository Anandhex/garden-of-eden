import { addLore, badScopes, learnLore, setDynamicLore, worldLore, type Certainty, type LoreEntry } from "../../npc/knowledge.js";
import { parsePersona } from "../../npc/personaSchema.js";
import { assemblePersona, fallbackIdentity, rollTemplate, type NpcTemplate } from "../../npc/templates.js";
import type { NpcPersona, NpcState, QuestDef, WorldSnapshot } from "../../npc/types.js";
import { speciesOf } from "../../world/species.js";
import { seedFrom, seededRng } from "../dice.js";
import { ITEM_TIERS } from "../items.js";
import { tierIndex, type Tier } from "../life.js";
import { ageOn } from "../life.js";
import { compareTiers } from "../levels.js";
import { chainOf, titled } from "./figures.js";
import { HOME_ID, lieges, neighbours } from "./generate.js";
import { rankIn } from "./factions.js";
import type { Figure, Realm, Role, Settlement } from "./types.js";
import { CLASS_ATTITUDE, figureClass } from "./townsfolk.js";

/**
 * The people of other places (N14). When the player arrives somewhere, its head
 * and its best-known residents become talking NPCs: a persona per figure, made
 * from a template by their role (merchant, guard, farmer or bandit), with their
 * own name, rank, age, office, superior, faction and deeds, and lore about their
 * own place. No model call: the template's words, with this place's name. Their
 * files are kept in the save (`world.visitors`), by figure id, so the same person
 * is there next time, with the same memories of the player.
 */

/** Most talking NPCs made for one place. */
export const MAX_VISITORS = 8;

/** Persona id for a figure. */
export const visitorId = (figureId: string) => `v_${figureId.replace(/[^a-z0-9]/g, "_")}`;

const TEMPLATE_FOR: Partial<Record<Role, string>> = {
  merchant: "merchant",
  smith: "merchant",
  innkeeper: "merchant",
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
    case "adventurer":
      return `an adventurer${fac ? ` of ${fac.name}` : ""}, based in ${s.name}`;
    default:
      return `a ${f.role} of ${s.name}`;
  }
}

/** Millbrook's commoners walk its map as the crowd (realm/rise.ts), not as talking NPCs. */
const CROWD_ROLES = new Set<Role>(["farmer", "miner", "carter", "hunter", "commoner"]);

/**
 * The figures of a place worth meeting: the head first, then by renown. In Millbrook
 * (N15) that's its head, the guard captain and anyone of note the realm put there:
 * not the crowd, and not the cast, who talk already.
 */
export function notablesOf(realm: Realm, site: string): Figure[] {
  const s = realm.settlements[site];
  if (!s) return [];
  const folk = Object.values(realm.figures).filter((f) => f.alive && !f.talks && f.home === site && f.role !== "beast" && speciesOf(f.species).talks && (site !== HOME_ID || !CROWD_ROLES.has(f.role)));
  folk.sort((a, b) => (b.id === s.leader ? 1 : 0) - (a.id === s.leader ? 1 : 0) || b.renown - a.renown);
  return folk.slice(0, MAX_VISITORS);
}

const HEAD_ROLES = new Set<Role>(["ruler", "lord", "mayor", "village head", "elder"]);

/** A persona for a figure of another place. Null if the template's missing or the file doesn't pass the schema. */
export function visitorPersona(realm: Realm, f: Figure, templates: Record<string, NpcTemplate>, day: number, id = visitorId(f.id)): NpcPersona | null {
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
  const words = fallbackIdentity(t, r, rng, f.name.replace(/ (the \w+|Ironhand|Quickblade|Oathkeeper|Stonearm|Halfhand|Brightspear)$/i, ""));
  if (!/^[A-Z][a-z'-]+( [A-Z][a-z'-]+){0,2}$/.test(words.name)) words.name = `${r.fallbackName.first} ${r.fallbackName.family}`;
  const here = (text: string) => text.replaceAll("Millbrook", s.name).replaceAll("the mine road", "the roads");
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
  words.speechStyle = here(words.speechStyle);
  words.goals = words.goals.map(here);
  if (HEAD_ROLES.has(f.role)) words.goals = [`Keep ${s.name} fed, safe and paying its way`, ...words.goals].slice(0, 3);
  const persona = assemblePersona(t, r, words, id);
  persona.role = role;
  // What they know: the realm by rumour and their own place for certain; Millbrook's news only if it reaches them.
  persona.knows = s.id === HOME_ID ? homeKnows(f) : { "realm.*": "rumour", [`realm.place_${s.id}`]: "certain" };
  for (const n of neighbours(realm, s.id)) persona.knows[`realm.place_${n.id}`] = "certain";
  // Only lore that exists (the schema refuses a scope that matches nothing).
  for (const bad of badScopes(persona.knows)) delete persona.knows[bad];
  if (HEAD_ROLES.has(f.role)) persona.schedule = [{ from: 6, to: 20, activity: "work", place: "square" }, { from: 20, to: 6, activity: "sleep", place: "home" }];
  if (f.role === "bandit" || f.role === "bandit chief" || f.role === "rebel") persona.schedule = [{ from: 6, to: 21, activity: "work", place: "square" }, { from: 21, to: 6, activity: "sleep", place: "home" }];
  persona.quests = jobsFor(realm, f, s, persona);
  delete persona.faction;
  try {
    return parsePersona(persona, `visitor ${persona.id}`);
  } catch {
    // Gear above their rank (a green captain): they make do without armour, with the template's plainest weapon.
    delete persona.armor;
    persona.weapon = t.weapon.at(-1)!;
    try {
      return parsePersona(persona, `visitor ${persona.id}`);
    } catch (e) {
      void e;
      return null;
    }
  }
}

/**
 * What one of Millbrook's own notables knows (N15): the village and its news for
 * certain, its people and the realm by rumour, and the lore written about them (the
 * mayor's vault, the captain's questions about the tax money) for certain.
 */
function homeKnows(f: Figure): Record<string, Certainty> {
  const knows: Record<string, Certainty> = { "millbrook.*": "certain", mine_road: "certain", "mine_road.*": "rumour", "news.*": "certain", "people.*": "rumour", "realm.*": "rumour" };
  for (const e of worldLore().entries) {
    if (e.kind !== "person" || !(e.aliases ?? []).includes(f.name)) continue;
    knows[e.id] = "certain";
    knows[`${e.id}.*`] = "certain";
  }
  return knows;
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

/** Lore about a place, for those who live there and travellers: what it is, who rules it, what's built. */
export function placeLore(realm: Realm, s: Settlement): LoreEntry {
  const lead = s.leader ? realm.figures[s.leader] : undefined;
  const k = s.kingdom ? realm.kingdoms[s.kingdom] : undefined;
  const liege = s.liege ? realm.settlements[s.liege] : undefined;
  const built = Object.entries(s.buildings).filter(([, l]) => (l ?? 0) > 0).map(([b]) => b);
  return {
    id: `realm.place_${s.id}`,
    kind: "place",
    name: s.name,
    aliases: [s.name, ...(lead ? [lead.name] : [])],
    keywords: [s.kind, "here", "this place", "town", "village"],
    text: `${s.name} is a ${s.kind}${k ? ` of ${k.name}` : ", free of any crown"}, home to about ${s.population} people${lead ? `, under ${titled(lead)}` : ""}${liege ? `; it answers to ${liege.name}` : ""}. It has ${built.join(", ") || "little to speak of"}.`,
  };
}

export interface Visitor {
  id: string;
  persona: NpcPersona;
  state: NpcState;
}

/** Make sure a place's lore exists and its people know it (and the lore of the places a road away). */
export function ensurePlaceLore(realm: Realm, world: WorldSnapshot, site: string, folk: Visitor[]): void {
  const s = realm.settlements[site];
  if (!s || site === HOME_ID) return;
  const entries = [s, ...neighbours(realm, site)].map((x) => placeLore(realm, x));
  for (const e of entries) {
    const at = (world.lore ?? []).findIndex((x) => x.id === e.id);
    if (at >= 0) {
      world.lore![at] = { ...world.lore![at]!, text: e.text };
      setDynamicLore(world.lore);
    } else addLore(world, e);
    for (const v of folk) learnLore(v.state, e.id, "certain");
  }
}

