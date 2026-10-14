import { addLore, knownNameWords, learnLore, setDynamicLore, unknownNames, worldLore, type LoreEntry } from "../../npc/knowledge.js";
import type { NpcPersona, NpcState, WorldSnapshot } from "../../npc/types.js";
import { z } from "zod";
import { pushNews } from "../../director/chronicle.js";
import { structured } from "../../director/structured.js";
import type { LLMProvider } from "../../llm/provider.js";
import { currentPlan } from "../schedule.js";
import { siteState, type SiteWorld } from "../site.js";
import { reachesAt } from "./log.js";
import type { Realm, RealmNews } from "./types.js";

/**
 * Realm news reaching a place (N13.8, N13.0, N24 2b). News travels at a traveller's pace
 * (game/realm/generate.ts TRAVEL_PER_DAY), so a war three days away is three days old when it gets
 * there, and every place has its own clock (`reachesAt`, `SiteState.newsSeen`). When it arrives it becomes
 * lore made in play (`realm.*`), news of the day for a few days, and who knows it is set in code:
 * - what happened in the place itself, everyone awake knows for certain;
 * - news from away comes in with travellers: whoever hears every rumour (the innkeeper) and whoever is at the
 *   inn or the gate hear it as a rumour; the guard hears of raids and wars. Gossip (game/gossip.ts) carries it
 *   on from there.
 *
 * Only the most important few arrive as lore each day (design rule 3); the rest stay in the realm's record
 * for the Realm tab.
 */
export const DELIVER_PER_DAY = 4;
/** News below this isn't worth carrying to a place. */
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

/** Names lore should know, minus the place itself. */
function newNames(names: string[] = [], site?: string): string[] {
  return [...new Set(names.map((n) => n.replace(/^the /i, "")))].filter((n) => n && n !== site);
}

/** Has this piece of news reached this place yet, and been told? (For the Realm tab: "heard here".) */
export const heardAt = (world: SiteWorld, site: string, n: Pick<RealmNews, "id">) => !!world.sites?.[site]?.newsSeen.includes(n.id);

/**
 * News whose day has come reaches a place. Returns lines for the player (the important ones, as the place
 * would hear them). After a long absence the place catches up on what it missed (up to a few days' worth).
 */
export function deliverNews(realm: Realm, world: WorldSnapshot & SiteWorld, site: string, listeners: Listener[]): string[] {
  const state = siteState(world, site);
  const seen = new Set(state.newsSeen);
  const place = realm.settlements[site]?.name;
  const due = realm.news.filter((n) => !seen.has(n.id) && (reachesAt(realm, n, site) ?? Infinity) <= world.day);
  for (const n of due) if (n.importance < DELIVER_IMPORTANCE) state.newsSeen.push(n.id);
  const worth = due.filter((n) => n.importance >= DELIVER_IMPORTANCE).sort((a, b) => b.importance - a.importance);
  const lines: string[] = [];
  const perDay = DELIVER_PER_DAY * Math.max(1, Math.min(5, world.day - (state.lastActive !== undefined ? Math.floor(state.lastActive / 24) : world.day) + 1));
  for (const n of worth.slice(0, perDay)) {
    state.newsSeen.push(n.id);
    const id = realmNewsId(n);
    const entry: LoreEntry = { id, kind: "news", name: shortName(n.text), aliases: newNames(n.names, place), keywords: keywordsFor(n), text: n.text, event: true };
    addLore(world, entry);
    if (!worldLoreHas(id)) continue;
    pushNews(world, id);
    const local = n.at === site;
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
    for (const s of Object.values(world.sites ?? {})) s.recentEvents = s.recentEvents.filter((id) => !gone.has(id));
  }
  return lines;
}

const worldLoreHas = (id: string) => worldLore().byId.has(id);

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
  const known = knownNameWords([], [...(n.names ?? []), ...(n.at ? [realm.settlements[n.at]?.name ?? ""] : [])]);
  if (unknownNames(out.text, known).length > 0) return false;
  entry.text = out.text.trim();
  setDynamicLore(world.lore);
  return true;
}

/** Hears every rumour: whoever keeps the inn, and anyone whose lore says so. */
function hearsRumours(persona: NpcPersona): boolean {
  return persona.template === "innkeeper" || /\b(innkeeper|landlord)\b/i.test(persona.role) || worldLore().entries.some((e) => e.npc === persona.id && e.hearsRumours);
}
