import type { Journey, Traveller } from "@millbrook/shared";
import { loadTemplates, type NpcTemplate } from "../../npc/templates.js";
import type { NpcPersona } from "../../npc/types.js";
import { seededRng, seedFrom } from "../dice.js";
import { makeFigure } from "../realm/figures.js";
import { notablePersona } from "../realm/notables.js";
import type { Realm, Role } from "../realm/types.js";

/**
 * People met on the road are talkers like anyone (N26 B3): the first time the player speaks to one of a journey's party
 * they are made a file (from the same templates the notables of a place use, by what they are on this journey),
 * kept in the registry under the pseudo-place "road", and they remember the player after. Their id is
 * `v_<journey>_<n>`: the journey and where they stand in its party.
 */
export const ROAD_SITE = "road";

export const travellerId = (journey: string, k: number) => `v_${journey}_${k}`;

export function parseTravellerId(id: string): { journey: string; k: number } | null {
  const m = /^v_(j\d+)_(\d+)$/.exec(id);
  return m ? { journey: m[1]!, k: Number(m[2]) } : null;
}

const ROLE: Record<string, { role: Role; tier: "G" | "F" | "E" }> = {
  merchant: { role: "merchant", tier: "F" },
  carter: { role: "carter", tier: "G" },
  guard: { role: "guard", tier: "F" },
  captain: { role: "captain", tier: "E" },
  adventurer: { role: "adventurer", tier: "E" },
  messenger: { role: "commoner", tier: "G" },
  pilgrim: { role: "commoner", tier: "G" },
  commoner: { role: "commoner", tier: "G" },
  child: { role: "child", tier: "G" },
};

/** A file for one of a journey's party, or null if the templates can't make one. */
export function travellerPersona(realm: Realm, j: Journey, k: number, day: number, templates?: Record<string, NpcTemplate>): NpcPersona | null {
  const t = j.party[k];
  if (!t) return null;
  return personaOnRoad(realm, travellerId(j.id, k), t, j.path[0]!, j.path.at(-1)!, j.purpose, day, templates);
}

/** A file for anyone on the road: a journey's traveller, or a person met in a situation. */
export function personaOnRoad(realm: Realm, id: string, t: Traveller, fromId: string, toId: string, purpose: string, day: number, templates?: Record<string, NpcTemplate>): NpcPersona | null {
  let tpl = templates;
  if (!tpl) {
    try {
      tpl = loadTemplates();
    } catch {
      return null;
    }
  }
  const kind = ROLE[t.role] ?? ROLE.commoner!;
  // A scratch realm: the figure is made to give the template its rank, age and traits, and kept nowhere.
  const scratch = { ...realm, figures: {}, next: 1 } as Realm;
  const rng = seededRng(seedFrom(`${id}:${t.name}`));
  const age = t.role === "child" ? 8 + Math.floor(rng() * 6) : 20 + Math.floor(rng() * 35);
  const f = makeFigure(scratch, rng, { role: kind.role, home: fromId, tier: kind.tier, age, name: t.name, gender: t.gender, renown: 3 }, day);
  const persona = notablePersona(scratch, f, tpl, day, id);
  if (!persona) return null;
  const from = realm.settlements[fromId]?.name ?? "far away";
  const to = realm.settlements[toId]?.name ?? "somewhere";
  const what: Record<string, string> = { merchant: "a merchant", carter: "a carter", guard: "a caravan guard", captain: "a captain of the watch", adventurer: "an adventurer", messenger: "a messenger", pilgrim: "a pilgrim", child: "a child", farmer: "a farmer" };
  persona.role = `${what[t.role] ?? "a traveller"} of ${from}, on the road to ${to}`;
  persona.backstory = `${persona.backstory} They are on the road: ${purpose}.`.slice(0, 500);
  persona.quests = [];
  return persona;
}
