import { skillLevel } from "../../npc/skills.js";
import type { NpcPersona } from "../../npc/types.js";
import { speciesOf } from "../../world/species.js";
import type { Tier } from "../life.js";
import type { Talking } from "./arrivals.js";
import { killFigure, makeFigure } from "./figures.js";
import { parseTownsfolkId } from "./townsfolk.js";
import type { Figure, Realm, Role } from "./types.js";

/**
 * The talking people are realm figures too (N13.5, N25a): the hierarchy runs through them, so a guard answers
 * to their captain, and the head of a place to the town above. Their rank and death follow the NPC. The
 * notables of a place are made from figures, so they have one already; anyone else who talks (a child born to
 * talkers, a hand-written file in a test) gets one the first time.
 */

/** The roles `roleOf` gives: a figure with one of these follows its NPC's file; any other is an office the realm gave. */
const FOLLOWS_FILE = new Set<Role>(["child", "guard", "bandit chief", "bandit", "apprentice", "innkeeper", "smith", "farmer", "commoner", "miner", "carter", "hunter"]);

/** A talking NPC's place in the realm's roles. */
export function roleOf(p: NpcPersona): Role {
  if (p.minor) return "child";
  if (p.guard) return "guard";
  if (p.faction === "gang" || p.template === "bandit") return /\b(chief|leader|captain)\b/i.test(p.role) ? "bandit chief" : "bandit";
  if (/apprentice/i.test(p.role)) return "apprentice";
  if (p.prices.ale !== undefined || /inn/i.test(p.role)) return "innkeeper";
  if (skillLevel(p.skills, "smithing") > 0) return "smith";
  if (/farm|smallholder/i.test(p.role)) return "farmer";
  return "commoner";
}

/**
 * Keep the realm's figures for the talkers of a place in step: one per NPC (added the first time), with their name,
 * rank, age and death.
 */
export function syncTalkers(realm: Realm, folk: Talking[], site: string, day: number): void {
  const byNpc = new Map(Object.values(realm.figures).filter((f) => f.talks).map((f) => [f.talks!, f]));
  for (const m of folk) {
    // A talking townsperson is a row in the people table (N25), not a figure.
    if (parseTownsfolkId(m.id)) continue;
    let f = byNpc.get(m.id);
    if (!f) {
      if (m.state.dormant) continue;
      const gang = m.persona.faction === "gang" ? Object.values(realm.factions).find((x) => x.kind === "gang" && x.dissolved === undefined && (x.seat === site || x.branches.includes(site))) : undefined;
      f = makeFigure(realm, () => 0.5, { role: roleOf(m.persona), home: gang ? null : site, tier: m.state.life.tier as Tier, age: 20, species: m.persona.species ?? "human", gender: m.persona.voice?.gender === "male" ? "male" : "female", name: m.persona.name, renown: 18, faction: gang?.id ?? null }, day);
      f.talks = m.id;
      if (gang) gang.members.push(f.id);
      byNpc.set(m.id, f);
    }
    f.name = m.persona.name;
    // An office the realm gave them (a place's head, its guard captain) stays theirs.
    if (FOLLOWS_FILE.has(f.role)) f.role = roleOf(m.persona);
    f.life = structuredClone(m.state.life) as Figure["life"];
    if (m.state.outcome === "dead" && f.alive) killFigure(realm, f, day, m.state.deathCause ?? "unknown");
  }
}

/** Can this figure's species talk? (Beasts never become talking NPCs.) */
export const canTalk = (f: Figure) => speciesOf(f.species).talks;
