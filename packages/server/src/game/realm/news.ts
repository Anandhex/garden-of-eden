import { addLore, knownNameWords, learnLore, setDynamicLore, unknownNames, worldLore, type LoreEntry } from "../../npc/knowledge.js";
import type { NpcPersona, NpcState, WorldSnapshot } from "../../npc/types.js";
import { z } from "zod";
import { pushNews } from "../../director/chronicle.js";
import { structured } from "../../director/structured.js";
import type { LLMProvider } from "../../llm/provider.js";
import { currentPlan } from "../schedule.js";
import { titled } from "./figures.js";
import { HOME_ID, lieges, neighbours } from "./generate.js";
import type { Realm, RealmNews } from "./types.js";

/**
 * Realm news reaching Millbrook (N13.8, N13.0). News travels at a traveller's pace
 * (game/realm/generate.ts TRAVEL_PER_DAY), so a war three days away is three days
 * old when it gets here. When it arrives it becomes lore made in play (`realm.*`),
 * news of the day for a few days, and who knows it is set in code:
 * - what happened in Millbrook itself, everyone awake knows for certain;
 * - news from away comes in with travellers: whoever hears every rumour (Pell, at
 *   the inn) and whoever is at the inn or the gate hear it as a rumour; the guard
 *   hears of raids and wars. Gossip (game/gossip.ts) carries it on from there.
 *
 * Only the most important few arrive as lore each day (design rule 3); the rest
 * stay in the realm's record for the Realm tab.
 */
export const DELIVER_PER_DAY = 4;
/** News below this isn't worth carrying to Millbrook. */
export const DELIVER_IMPORTANCE = 4;
/** Realm news kept as lore (the oldest go). */
export const KEEP_LORE = 60;
/** News this important from away is retold by the model (when the director is on). */
export const RETELL_IMPORTANCE = 7;

export interface Listener {
  id: string;
  persona: NpcPersona;
  state: NpcState;
}

/** Lore id for a piece of realm news. */
export const realmNewsId = (n: Pick<RealmNews, "id">) => `realm.${n.id}`;

/** Names lore should know, minus Millbrook and what it already knows. */
function newNames(names: string[] = []): string[] {
  return [...new Set(names.map((n) => n.replace(/^the /i, "")))].filter((n) => n && n !== "Millbrook");
}

/**
 * News whose day has come reaches Millbrook. Returns lines for the player (the
 * important ones, as the town would hear them).
 */
export function deliverNews(realm: Realm, world: WorldSnapshot, listeners: Listener[]): string[] {
  const due = realm.news.filter((n) => !n.delivered && n.reaches <= world.day);
  for (const n of due) if (n.importance < DELIVER_IMPORTANCE) n.delivered = true;
  const worth = due.filter((n) => !n.delivered).sort((a, b) => b.importance - a.importance);
  const lines: string[] = [];
  for (const n of worth.slice(0, DELIVER_PER_DAY)) {
    n.delivered = true;
    const id = realmNewsId(n);
    const entry: LoreEntry = { id, kind: "news", name: shortName(n.text), aliases: newNames(n.names), keywords: keywordsFor(n), text: n.text, event: true };
    if (!addLore(world, entry)) continue;
    pushNews(world, id);
    const local = n.at === HOME_ID;
    for (const l of listeners) {
      if (l.state.outcome === "dead" || l.state.dormant) continue;
      const plan = currentPlan(l.persona, l.state, world);
      const awake = plan.activity !== "sleep";
      if (local && awake) learnLore(l.state, id, "certain");
      else if (!local && (hearsRumours(l.persona) || (awake && (plan.place === "inn" || plan.place === "gate")) || (l.persona.guard && /raid|war|battle/.test(n.kind)))) learnLore(l.state, id, "rumour");
    }
    lines.push(local ? n.text : `Travellers bring news: ${n.text}`);
  }
  // Older realm news drops out of the lore after a while (it's still in the realm's record).
  const realmLore = (world.lore ?? []).filter((e) => e.id.startsWith("realm.rn"));
  if (realmLore.length > KEEP_LORE) {
    const gone = new Set(realmLore.slice(0, realmLore.length - KEEP_LORE).map((e) => e.id));
    world.lore = (world.lore ?? []).filter((e) => !gone.has(e.id));
    setDynamicLore(world.lore);
    for (const l of listeners) for (const id of gone) delete l.state.learned[id];
  }
  return lines;
}

/** A short label for the news: its first clause, cut at a word, never mid-name. */
export function shortName(text: string): string {
  const first = text.split(/[:;(]/)[0]!.trim().replace(/[.,]$/, "");
  if (first.length <= 60) return first;
  return `${first.slice(0, 60).replace(/\s+\S*$/, "")}...`;
}

function keywordsFor(n: RealmNews): string[] {
  const base: Record<string, string[]> = {
    war: ["war", "army", "armies", "fighting"],
    battle: ["battle", "war", "fighting"],
    peace: ["peace", "war", "treaty"],
    raid: ["raid", "raided", "raiders"],
    treaty: ["treaty", "pact", "alliance", "trade"],
    faction: ["guild", "gang", "faction", "rebels"],
    split: ["split", "guild", "gang", "faction"],
    breakaway: ["rebellion", "rebels", "taxes", "broke away"],
    succession: ["new lord", "new king", "new queen", "heir", "ruler"],
    leader: ["leader", "guild", "gang"],
    dungeon: ["dungeon", "delve", "adventurers", "treasure"],
    beast: ["wolves", "beasts", "pack"],
    building: ["building", "walls", "market"],
    famine: ["hunger", "famine", "food"],
    tax: ["tax", "taxes"],
    risen: ["name", "hero"],
    death: ["death", "dead", "died"],
  };
  return [...(base[n.kind] ?? []), "news", "realm", "travellers"];
}

export const RetoldSchema = z.object({ text: z.string().min(10).max(220) });

/**
 * Big news, as the village would tell it (N13.8): the model rewrites a delivered
 * piece of realm news in one plain sentence. Only words: it may use only the names
 * already in it (the invented-name check), and nothing changes but the lore's text;
 * code's sentence stands if it fails.
 */
export async function retellNews(llm: LLMProvider, realm: Realm, world: WorldSnapshot, newsId: string): Promise<boolean> {
  const n = realm.news.find((x) => realmNewsId(x) === newsId);
  const entry = (world.lore ?? []).find((e) => e.id === newsId);
  if (!n || !entry) return false;
  const system = "You are a village crier in a small fantasy realm. Retell one piece of news from far away in one or two plain sentences, as folk at the inn would say it. Use only the names in it. Invent no names, places or numbers.";
  const out = await structured(llm, RetoldSchema, { kind: "retell", system, prompt: `The news: ${n.text}`, maxTokens: 90, temperature: 0.7 });
  if (!out) return false;
  const known = knownNameWords([], [...(n.names ?? []), "Millbrook"]);
  if (unknownNames(out.text, known).length > 0) return false;
  entry.text = out.text.trim();
  setDynamicLore(world.lore);
  return true;
}

/** Hears every rumour (the lore says so: Pell). */
function hearsRumours(persona: NpcPersona): boolean {
  return worldLore().entries.some((e) => e.npc === persona.id && e.hearsRumours);
}

/**
 * Place lore for the realm around Millbrook: its kingdom and crown, its liege town,
 * the city ("the city", as everyone calls it), the places a road away, the dungeon
 * by the mine and the adventurers' guild. Added once; every Millbrook NPC knows them.
 */
export function realmPlaceLore(realm: Realm, world: WorldSnapshot, listeners: Listener[]): void {
  const home = realm.settlements[HOME_ID];
  if (!home) return;
  const entries: LoreEntry[] = [];
  const kingdom = home.kingdom ? realm.kingdoms[home.kingdom] : undefined;
  if (kingdom) {
    const ruler = kingdom.ruler ? realm.figures[kingdom.ruler] : undefined;
    entries.push({ id: `realm.kingdom_${kingdom.id}`, kind: "place", name: kingdom.name, aliases: [kingdom.name, ...(ruler ? [ruler.name] : [])], keywords: ["kingdom", "king", "queen", "crown", "realm"], text: `Millbrook lies in the kingdom of ${kingdom.name}${ruler ? `, ruled by ${titled(ruler)} from ${realm.settlements[kingdom.capital]?.name ?? "the capital"}` : ""}.` });
  }
  const chain = lieges(realm, HOME_ID);
  for (const s of chain) {
    const lead = s.leader ? realm.figures[s.leader] : undefined;
    const isCity = s.kind === "capital";
    entries.push({ id: `realm.place_${s.id}`, kind: "place", name: s.name, aliases: [s.name, ...(lead ? [lead.name] : [])], keywords: isCity ? ["city", "capital"] : ["town", "taxes"], text: `${s.name} is ${isCity ? "the walled city down the valley, the kingdom's capital, that Millbrook folk just call \"the city\"" : `the ${s.kind} Millbrook answers to and pays its taxes to`}${lead ? `; ${titled(lead)} rules there` : ""}.` });
  }
  for (const s of neighbours(realm, HOME_ID).filter((n) => !chain.includes(n))) {
    entries.push({ id: `realm.place_${s.id}`, kind: "place", name: s.name, aliases: [s.name], keywords: ["village", "neighbours"], text: `${s.name} is a ${s.kind} a road away from Millbrook.` });
  }
  for (const d of Object.values(realm.dungeons).filter((x) => x.near === HOME_ID)) {
    entries.push({ id: `realm.dungeon_${d.id}`, kind: "place", name: d.name, aliases: [d.name.replace(/^the /, "")], keywords: ["dungeon", "old mine", "deeps", "monsters", "treasure"], text: `${cap(d.name)}: old workings past the iron mine, deep and dark, where things live now. Adventurers go down for treasure.` });
  }
  const guild = realm.factions.adventurers_guild;
  if (guild) entries.push({ id: "realm.guild_adventurers", kind: "place", name: guild.name, aliases: [guild.name.replace(/^the /, "")], keywords: ["guild", "adventurers", "adventurer"], text: `${cap(guild.name)} has halls in the towns; its members delve dungeons and hunt beasts for coin.` });
  for (const e of entries) {
    addLore(world, e);
    for (const l of listeners) learnLore(l.state, e.id, "certain");
  }
}

const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1);
