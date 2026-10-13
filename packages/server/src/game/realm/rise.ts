import { parsePersona } from "../../npc/personaSchema.js";
import { assemblePersona, fallbackIdentity, rollTemplate, SOMEWHERE, type NpcTemplate, type Where } from "../../npc/templates.js";
import type { NpcPersona } from "../../npc/types.js";
import { speciesOf } from "../../world/species.js";
import { type Creature, type CreatureTemplate, spawnGroup } from "../creatures.js";
import type { Rng } from "../dice.js";
import { tierIndex, type Life, type Tier } from "../life.js";
import { seasonOf } from "../weather.js";
import { addDeed, addRenown, killFigure, makeFigure, takenNames } from "./figures.js";
import { realmNews, tally } from "./log.js";
import { figureTalkerId } from "./notables.js";
import { beastName, epithet, personName } from "./names.js";
import type { Figure, Realm } from "./types.js";

/**
 * Rising from the crowd (N13.6, N13.7), on the map of the place the player is in.
 *
 * - Creatures breed: two grown ones and room (the template's `breeding`) make young.
 * - The villagers on the map are the place's commoners from the realm (named folk
 *   with a life), not faceless spawns: a villager who turns up is one of them, and
 *   what happens to it happens to them.
 * - A creature that breaks through a rank or wins enough fights earns a name and
 *   becomes a realm figure (a wolf becomes "Greyfang"); it stays in the world.
 * - A person of the place who rises far enough becomes a talking NPC, made from a
 *   template (N11.1) with their own rank, age and deeds.
 */

/** Fights won that earn a creature a name. */
export const NAMED_AFTER_WINS = 3;
/** Renown at which a person of a place is worth talking to. */
export const TALKER_RENOWN = 30;

/** Kinds whose individuals stand for a place's commoners. */
const CROWD = new Set(["villager"]);
const COMMONER_ROLES = new Set(["farmer", "miner", "carter", "hunter", "commoner"]);

/** Midnight: litters for kinds that breed, while there's room. Returns lines. */
export function breedCreatures(templates: Record<string, CreatureTemplate>, creatures: Record<string, Creature>, day: number, rng: Rng): string[] {
  const season = seasonOf(day);
  if (season !== "spring" && season !== "summer") return [];
  const log: string[] = [];
  for (const t of Object.values(templates)) {
    const b = t.breeding;
    if (!b) continue;
    const alive = Object.values(creatures).filter((c) => c.template === t.id && !c.outcome);
    const grown = alive.filter((c) => c.life.stage === "adult" || c.life.stage === "elder");
    if (grown.length < 2 || alive.length >= b.cap || rng() >= b.chance) continue;
    const litter = Math.min(b.cap - alive.length, b.litter[0] + Math.floor(rng() * (b.litter[1] - b.litter[0] + 1)));
    const young = spawnGroup(t, litter, creatures, day, rng, 0);
    for (const c of young) c.name = `${t.name} cub ${c.uid.split("-").pop()}`;
    log.push(`${grown[0]!.name} has ${litter === 1 ? "a young one" : `${litter} young`} (${young.map((c) => c.name).join(", ")}).`);
  }
  return log;
}

/**
 * The crowd on a map are the place's commoners: each villager without one takes
 * a free commoner's name and life. Before that, what happened to villagers flows
 * back to their figures (rank, wins; a death is a death).
 */
export function castCrowd(realm: Realm, creatures: Record<string, Creature>, day: number, site: string): string[] {
  const log = syncCrowd(realm, creatures, day, site);
  const used = new Set(Object.values(creatures).map((c) => c.figure).filter(Boolean));
  const free = Object.values(realm.figures).filter((f) => f.alive && f.home === site && !f.talks && COMMONER_ROLES.has(f.role) && !used.has(f.id));
  for (const c of Object.values(creatures)) {
    if (!CROWD.has(c.template) || c.figure || c.outcome) continue;
    const f = free.shift();
    if (!f) break;
    c.figure = f.id;
    c.name = f.name;
    c.life = structuredClone(f.life) as Life;
  }
  return log;
}

/**
 * What happened to the creatures that are figures goes back to the figures: rank, wins,
 * death. A commoner who rose above their own rank, or kept winning fights, has made a
 * name (once). Returns lines for the player.
 */
export function syncCrowd(realm: Realm, creatures: Record<string, Creature>, day: number, site: string): string[] {
  const place = realm.settlements[site]?.name ?? "the village";
  const log: string[] = [];
  for (const c of Object.values(creatures)) {
    const f = c.figure ? realm.figures[c.figure] : undefined;
    if (!f || !f.alive) continue;
    const rose = tierIndex(c.life.tier as Tier) > tierIndex(f.life.tier as Tier);
    const won = c.life.fightsWon >= NAMED_AFTER_WINS;
    f.life = structuredClone(c.life) as Figure["life"];
    if ((rose || won) && f.role !== "beast" && !f.deeds.some((d) => d.startsWith("made a name"))) {
      addRenown(f, TALKER_RENOWN);
      addDeed(f, `made a name for themselves in ${place}`);
      tally(realm, "named");
      realmNews(realm, day, site, "risen", `${f.name}, a ${f.role} of ${place}, has made a name: rank ${c.life.tier}, ${c.life.fightsWon} fights won.`, 5, [f.name]);
      log.push(`${f.name} has made a name for themselves.`);
    }
    if (c.outcome === "dead") {
      killFigure(realm, f, day, c.deathCause ?? "unknown");
      if (f.renown >= 10 || f.role === "beast") realmNews(realm, day, site, "death", `${f.name} of ${place} is dead (${c.deathCause === "old age" ? "of old age" : `killed by ${c.deathCause ?? "someone"}`}).`, 5, [f.name]);
    }
  }
  return log;
}

/**
 * Creatures that broke through a rank or won enough fights earn a name and a place
 * in the realm (a beast leads the place's pack, if it has no leader). Returns lines.
 */
export function nameRisers(realm: Realm, templates: Record<string, CreatureTemplate>, creatures: Record<string, Creature>, day: number, rng: Rng, site: string): string[] {
  const place = realm.settlements[site]?.name ?? "the village";
  const log = syncCrowd(realm, creatures, day, site);
  for (const c of Object.values(creatures)) {
    const t = templates[c.template];
    if (!t || c.outcome) continue;
    const rose = tierIndex(c.life.tier as Tier) > tierIndex(t.tier as Tier);
    const won = c.life.fightsWon >= NAMED_AFTER_WINS;
    // Already a figure (a commoner of the place): syncCrowd keeps them, and notices when they rise.
    if (c.figure) continue;
    if (!rose && !won) continue;
    const human = speciesOf(t.species).talks;
    const gang = Object.values(realm.factions).find((f) => f.kind === "gang" && f.dissolved === undefined && (f.seat === site || f.branches.includes(site)));
    const name = human ? `${personName(rng, rng() < 0.5 ? "female" : "male", takenNames(realm)).split(" ")[0]} ${epithet(rng)}` : beastName(rng, t.species, takenNames(realm));
    const fig = makeFigure(
      realm,
      rng,
      { role: human ? (t.id === "bandit" ? "bandit" : "commoner") : "beast", home: human && t.id !== "bandit" ? site : null, tier: c.life.tier as Tier, age: 1, species: t.species, renown: 25, rose: c.uid, name, ...(t.id === "bandit" && gang ? { faction: gang.id } : {}) },
      day,
    );
    fig.life = structuredClone(c.life) as Figure["life"];
    addDeed(fig, rose ? `broke through to rank ${c.life.tier}` : `won ${c.life.fightsWon} fights`);
    if (t.id === "bandit" && gang) gang.members.push(fig.id);
    c.figure = fig.id;
    const old = c.name;
    c.name = name;
    if (!human) {
      const pack = Object.values(realm.packs).find((p) => p.near === site && p.species === t.species);
      if (pack && !pack.alpha) pack.alpha = fig.id;
    }
    tally(realm, "named");
    realmNews(realm, day, site, "risen", `${old} is nameless no more: folk call it ${name} now${rose ? `, after it broke through to rank ${c.life.tier}` : `, after ${c.life.fightsWon} fights won`}.`, 5, [name]);
    log.push(`${old} has earned a name: ${name}.`);
  }
  return log;
}

/** Figures of a place who are now worth talking to: people, not yet talking, risen far enough. */
export function readyToTalk(realm: Realm, creatures: Record<string, Creature>, site: string): Figure[] {
  return Object.values(realm.figures).filter((f) => {
    if (!f.alive || f.talks || !speciesOf(f.species).talks) return false;
    const onMap = Object.values(creatures).some((c) => c.figure === f.id && !c.outcome);
    // Someone who lives in the place, or a gang member on its map; a person who grew up as a townsperson (N25) can talk wherever they live.
    const local = f.home === site || !!f.person || (!!f.faction && realm.factions[f.faction]?.kind === "gang" && onMap);
    return local && f.renown >= TALKER_RENOWN && (onMap || COMMONER_ROLES.has(f.role)) && tierIndex(f.life.tier as Tier) >= 1;
  });
}

/**
 * A figure becomes a talking NPC: a persona from a template (bandits from the bandit
 * template, everyone else a farmer's), with the figure's own name, rank and age,
 * and their deeds in the backstory. Checked by the persona schema.
 */
export function personaFor(f: Figure, templates: Record<string, NpcTemplate>, day: number, rng: Rng, takenIds: string[], where: Where = SOMEWHERE): NpcPersona | null {
  const t = (f.role === "bandit" || f.role === "bandit chief" || f.faction?.startsWith("gang_") ? templates.bandit : templates.farmer) ?? Object.values(templates).find((x) => !x.minor);
  if (!t) return null;
  const r = rollTemplate(t, rng);
  r.tier = f.life.tier as Tier;
  r.potential = (tierIndex(f.life.potential as Tier) >= tierIndex(r.tier) ? f.life.potential : r.tier) as Tier;
  r.age = Math.max(speciesOf(f.species).adultAge, Math.floor((day - f.life.bornOnDay) / 12));
  r.gender = f.gender;
  r.voice = { ...t.voice[f.gender], pitch: r.voice.pitch, rate: r.voice.rate };
  const plain = f.name.replace(/ (the \w+|Ironhand|Quickblade|Oathkeeper|Stonearm|Halfhand|Brightspear)$/i, "");
  const words = fallbackIdentity(t, r, rng, /^[A-Z][a-z'-]+( [A-Z][a-z'-]+){0,2}$/.test(plain) ? plain : `${r.fallbackName.first} ${r.fallbackName.family}`, where);
  words.backstory = `${words.backstory} Folk know them now: ${f.deeds.slice(-3).join("; ")}.`.slice(0, 500);
  const persona = assemblePersona(t, r, words, figureTalkerId(f.id), where);
  void takenIds;
  try {
    return parsePersona(persona, `risen NPC ${persona.id}`);
  } catch {
    return null;
  }
}
