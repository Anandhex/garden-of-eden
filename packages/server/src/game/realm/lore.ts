import { addLore, badScopes, learnLore, setDynamicLore, type Certainty, type LoreEntry } from "../../npc/knowledge.js";
import type { NpcState, WorldSnapshot } from "../../npc/types.js";
import { titled } from "./figures.js";
import { lieges, neighbours } from "./generate.js";
import type { Realm, Settlement } from "./types.js";

/**
 * The lore of a place (N25a decision 7), all made by code from the realm, one naming scheme for every place:
 *
 * - `place.<site>` is the place itself; `place.<site>.<thing>` is something in it (its inn, forge, temple, hall,
 *   market), named for the building on its map and who keeps it ("the Red Hart, kept by Odo Barrow");
 * - `realm.kingdom_<id>`, `realm.dungeon_<id>`, `realm.guild_adventurers` are the wider realm; `news.*` is news.
 *
 * Whoever lives in a place knows its `place.<site>.*` for certain, the places a road away and the lords above it
 * for certain, and the rest of the realm by rumour (`knowsFor`). News reaches them only by delivery.
 */

/** A building on a place's map, and whoever keeps it. */
export interface Thing {
  kind: "inn" | "smithy" | "temple" | "hall" | "market";
  name: string;
  keeper?: string;
}

const THING: Record<Thing["kind"], { slug: string; words: string[]; text: (name: string, place: string, keeper?: string) => string }> = {
  inn: { slug: "inn", words: ["inn", "tavern", "pub", "ale", "bed", "room", "drink"], text: (n, p, k) => `${n} is the inn of ${p}${k ? `, kept by ${k}` : ""}.` },
  smithy: { slug: "forge", words: ["forge", "smithy", "smith", "blacksmith", "anvil", "repair"], text: (n, p, k) => `${n} is the forge of ${p}${k ? `, where ${k} works the iron` : ""}.` },
  temple: { slug: "temple", words: ["temple", "priest", "shrine", "prayer"], text: (n, p, k) => `${n} is the temple of ${p}${k ? `, kept by ${k}` : ""}.` },
  hall: { slug: "hall", words: ["hall", "council", "head", "lord"], text: (n, p, k) => `${n} is where ${p} is governed${k ? `, by ${k}` : ""}.` },
  market: { slug: "market", words: ["market", "stalls", "traders"], text: (n, p) => `${n} is the market of ${p}, where traders set up.` },
};

const built = (s: Settlement) => Object.entries(s.buildings).filter(([, l]) => (l ?? 0) > 0).map(([b]) => b);

/** The place itself: what it is, who rules it, what's built. */
export function placeLore(realm: Realm, s: Settlement): LoreEntry {
  const lead = s.leader ? realm.figures[s.leader] : undefined;
  const k = s.kingdom ? realm.kingdoms[s.kingdom] : undefined;
  const liege = s.liege ? realm.settlements[s.liege] : undefined;
  return {
    id: `place.${s.id}`,
    kind: "place",
    name: s.name,
    aliases: [s.name, ...(lead ? [lead.name] : [])],
    keywords: [s.kind, "here", "this place", "town", "village"],
    text: `${s.name} is a ${s.kind}${k ? ` of ${k.name}` : ", free of any crown"}, home to about ${s.population} people${lead ? `, under ${titled(lead)}` : ""}${liege ? `; it answers to ${liege.name}` : ""}. It has ${built(s).join(", ") || "little to speak of"}.`,
  };
}

/** What is in the place: one entry for each kind of building it has, from its map. */
export function thingLore(s: Settlement, things: Thing[]): LoreEntry[] {
  const seen = new Set<string>();
  const out: LoreEntry[] = [];
  for (const t of things) {
    const def = THING[t.kind];
    if (seen.has(def.slug)) continue;
    seen.add(def.slug);
    const name = /^(the|a|an) /i.test(t.name) ? t.name : `the ${t.name}`;
    out.push({ id: `place.${s.id}.${def.slug}`, kind: "place", name, aliases: [t.name.replace(/^the /i, ""), ...(t.keeper ? [t.keeper] : [])], keywords: def.words, text: def.text(name, s.name, t.keeper) });
  }
  return out;
}

/** The wider realm around a place: its kingdom, the dungeons by it, the adventurers' guild. */
export function realmLore(realm: Realm, s: Settlement): LoreEntry[] {
  const out: LoreEntry[] = [];
  const kingdom = s.kingdom ? realm.kingdoms[s.kingdom] : undefined;
  if (kingdom) {
    const ruler = kingdom.ruler ? realm.figures[kingdom.ruler] : undefined;
    out.push({ id: `realm.kingdom_${kingdom.id}`, kind: "place", name: kingdom.name, aliases: [kingdom.name, ...(ruler ? [ruler.name] : [])], keywords: ["kingdom", "king", "queen", "crown", "realm"], text: `${s.name} lies in the kingdom of ${kingdom.name}${ruler ? `, ruled by ${titled(ruler)} from ${realm.settlements[kingdom.capital]?.name ?? "the capital"}` : ""}.` });
  }
  for (const d of Object.values(realm.dungeons).filter((x) => x.near === s.id)) {
    out.push({ id: `realm.dungeon_${d.id}`, kind: "place", name: d.name, aliases: [d.name.replace(/^the /, "")], keywords: ["dungeon", "deeps", "ruins", "monsters", "treasure"], text: `${cap(d.name)} lies a day from ${s.name}: old workings, deep and dark, where things live now. Adventurers go down for treasure.` });
  }
  const guild = realm.factions.adventurers_guild;
  if (guild) out.push({ id: "realm.guild_adventurers", kind: "place", name: guild.name, aliases: [guild.name.replace(/^the /, "")], keywords: ["guild", "adventurers", "adventurer"], text: `${cap(guild.name)} has halls in the towns; its members delve dungeons and hunt beasts for coin.` });
  return out;
}

/** The places whose names folk of a place know for certain: itself, a road away, and the lords above. */
export function knownPlaces(realm: Realm, s: Settlement): Settlement[] {
  const seen = new Set<string>();
  return [s, ...neighbours(realm, s.id), ...lieges(realm, s.id)].filter((x) => !seen.has(x.id) && !!seen.add(x.id));
}

/** What a person of a place knows (decision 7): their place for certain, near places and lords for certain, the realm by rumour. */
export function knowsFor(realm: Realm, s: Settlement): Record<string, Certainty> {
  const knows: Record<string, Certainty> = { [`place.${s.id}.*`]: "certain", "realm.*": "rumour", "people.*": "rumour" };
  for (const p of knownPlaces(realm, s)) knows[`place.${p.id}`] = "certain";
  for (const d of Object.values(realm.dungeons).filter((x) => x.near === s.id)) knows[`realm.dungeon_${d.id}`] = "certain";
  // Only lore that exists: the schema refuses a scope that matches nothing.
  for (const bad of badScopes(knows)) delete knows[bad];
  return knows;
}

/** Make sure a place's lore exists (its own with what's in it; near places; lords; the realm around it), and that its folk know it. */
export function ensurePlaceLore(realm: Realm, world: Pick<WorldSnapshot, "lore">, site: string, folk: Array<{ state: Pick<NpcState, "learned"> }>, things: Thing[] = []): void {
  const s = realm.settlements[site];
  if (!s) return;
  const entries = [...knownPlaces(realm, s).map((x) => placeLore(realm, x)), ...thingLore(s, things), ...realmLore(realm, s)];
  for (const e of entries) {
    const at = (world.lore ?? []).findIndex((x) => x.id === e.id);
    if (at >= 0) {
      world.lore![at] = { ...world.lore![at]!, text: e.text, ...(e.aliases.length > 0 ? { aliases: e.aliases } : {}) };
      setDynamicLore(world.lore);
    } else addLore(world, e);
    for (const v of folk) learnLore(v.state, e.id, "certain");
  }
}

const cap = (t: string) => t[0]!.toUpperCase() + t.slice(1);
