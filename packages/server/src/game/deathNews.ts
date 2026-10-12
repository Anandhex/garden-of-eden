import { addEmotion } from "../npc/emotions.js";
import { isBaseLore, learnLore, worldLore, type Certainty } from "../npc/knowledge.js";
import { remember } from "../npc/memory.js";
import { adjust, AFFECTION } from "../npc/relationship.js";
import { isEnemy, isFriend, relationTo } from "../npc/social.js";
import { traitsOf } from "../npc/traits.js";
import type { NpcPersona, NpcState, WorldSnapshot } from "../npc/types.js";
import { learnEvent } from "./events.js";
import { spouseOf } from "./family.js";
import { townLearns } from "./reputation.js";
import { currentPlan } from "./schedule.js";

/**
 * Death is news, not telepathy (N13.0). When an NPC dies, only those who could
 * know at once do: witnesses, those at the same place, family. Everyone else
 * learns it when gossip (game/gossip.ts) or a traveller brings the news, maybe
 * only as a rumour, and until then they think the dead are alive. Grief, fear
 * and grudges come when each NPC hears, not when the death happens.
 *
 * What's needed to react later is kept in `world.deathNotes`, by news id.
 */
export interface DeathNote {
  /** The dead NPC's id. */
  dead: string;
  name: string;
  /** "of old age", "at the hands of Traveler", "violently; nobody saw who did it". */
  how: string;
  /** The player did it, and people know. */
  byPlayer: boolean;
  /** The "killed" event, if the player did it and it's known. */
  killing?: string;
  day: number;
}

export interface Mourner {
  id: string;
  persona: NpcPersona;
  state: NpcState;
}

type DeathWorld = Pick<WorldSnapshot, "day" | "player" | "events"> & { deathNotes?: Record<string, DeathNote> };

/** The news id of an NPC's death. */
export const deathNewsId = (deadId: string) => `news.death_${deadId}`;

/** Is this a death news id? */
export const isDeathNews = (id: string) => id.startsWith("news.death_");

/**
 * Who knows at once: those who saw it (the killing's witnesses), whoever was at
 * the same place awake, their spouse, parents and children, and the killer.
 */
export function knowAtOnce(members: Mourner[], world: Pick<WorldSnapshot, "day" | "hour" | "recentEvents" | "lastRaidDay" | "events" | "family">, deadId: string, killer: string | null, place: string | null): Set<string> {
  const out = new Set<string>();
  const dead = members.find((m) => m.id === deadId);
  for (const e of world.events ?? []) if (e.kind === "killed" && e.target === deadId) for (const w of e.witnesses ?? []) out.add(w);
  if (killer) {
    const k = members.find((m) => m.persona.name === killer || m.id === killer);
    if (k) out.add(k.id);
  }
  const spouse = spouseOf(world, deadId);
  if (spouse) out.add(spouse);
  for (const m of members) {
    if (m.id === deadId || m.state.outcome === "dead" || m.state.dormant) continue;
    if (dead?.persona.parents?.includes(m.id) || m.persona.parents?.includes(deadId)) out.add(m.id);
    if (!place) continue;
    const plan = currentPlan(m.persona, m.state, world as WorldSnapshot);
    if (plan.activity !== "sleep" && plan.place === place) out.add(m.id);
  }
  out.delete(deadId);
  return out;
}

/**
 * One NPC hears of a death: they learn the news (certain or a rumour), and react
 * by how they felt about the dead: grief for a friend, a little gladness for an
 * enemy, and if the player did it, fear, and for friends a grudge. Once each.
 * Returns true if it was news to them.
 */
export function hearOfDeath(m: Mourner, note: DeathNote, world: DeathWorld, certainty: Certainty): boolean {
  if (m.id === note.dead || m.state.outcome === "dead") return false;
  const newsId = deathNewsId(note.dead);
  const had = m.state.learned[newsId];
  learnLore(m.state, newsId, certainty);
  // A rumour confirmed doesn't make them grieve twice.
  if (had) return false;
  const player = world.player;
  const t = traitsOf(m.persona, m.state);
  const killing = note.killing ? (world.events ?? []).find((e) => e.id === note.killing) : undefined;
  if (killing && learnEvent(killing, m.id)) townLearns(player, killing);
  const friend = isFriend(m.state, note.dead);
  // A rumour hits softer than the certain news.
  const weight = certainty === "certain" ? 1 : 0.6;
  if (friend) {
    addEmotion(m.state, "grief", 0.8 * weight, `${note.name}'s death`, world.day);
    if (note.byPlayer) {
      adjust(m.state, "trust", Math.round(-40 * weight));
      adjust(m.state, "affection", Math.round(AFFECTION.attack * weight));
      adjust(m.state, "fear", Math.round(15 * weight));
      addEmotion(m.state, "resentment", 0.8 * weight, `them killing ${note.name}`, world.day, true);
      m.state.grudge = { reason: `they killed ${note.name}, your friend`, day: world.day, until: world.day + 30, blood: relationTo(m.state, note.dead).affection >= 60 };
    }
  } else if (isEnemy(m.state, note.dead)) {
    addEmotion(m.state, "joy", 0.2, `${note.name} being gone`, world.day);
  }
  const heard = certainty === "rumour" ? " (or so you heard)" : "";
  if (note.byPlayer) {
    adjust(m.state, "fear", Math.round(10 * weight));
    remember(m.state, { id: `death-${note.dead}`, day: world.day, text: `they killed ${note.name}${heard}`, importance: 9, valence: -1, ...(killing ? { event: killing.id } : {}) }, t);
  } else {
    remember(m.state, { id: `death-${note.dead}`, day: world.day, text: `${note.name} died ${note.how}${heard}`, importance: friend ? 7 : 4, valence: 0 }, t);
  }
  return true;
}

/** Gossip passed a news id on: if it's a death, the listener reacts as they hear it. */
export function heardNews(m: Mourner, newsId: string, world: DeathWorld, certainty: Certainty): boolean {
  const note = world.deathNotes?.[newsId];
  return note ? hearOfDeath(m, note, world, certainty) : false;
}

/**
 * News for the prompt: news from the world file (raids, the cart attack) is
 * village-wide, so everyone hears it; news made in play (deaths, weddings, the
 * realm) only reaches those who have learned it.
 */
export function newsHeard(state: Pick<NpcState, "learned">, recent: readonly string[], fromAway = false): string[] {
  // Someone from another place (N14) only knows Millbrook's news if it reached them.
  return recent.filter((id) => (!fromAway && !isPlayMadeNews(id)) || state.learned[id] !== undefined);
}

/** A persona for someone of another place (game/realm/visitors.ts: "v_" ids), not Millbrook's cast. */
export const isFromAway = (persona: { id: string }) => persona.id.startsWith("v_");

/** News made in play (deaths, weddings, the realm), rather than in src/data/world.json. */
function isPlayMadeNews(id: string): boolean {
  return !isBaseLore(id);
}

/**
 * When the player brings up someone who's dead: what this NPC believes. They
 * heard (certain or a rumour), or as far as they know the person is alive.
 * Gated to lines that name the dead (design rule 3). Null when nobody dead is named.
 */
export function describeDeathBeliefs(state: Pick<NpcState, "learned">, world: { deathNotes?: Record<string, DeathNote> }, playerLine: string, selfId: string): string | null {
  const lines: string[] = [];
  for (const [newsId, note] of Object.entries(world.deathNotes ?? {})) {
    if (note.dead === selfId || !namesTheDead(playerLine, note)) continue;
    const knows = state.learned[newsId];
    if (knows === "certain") lines.push(`${note.name} is dead: they died ${note.how}.`);
    else if (knows === "rumour") lines.push(`You've heard a rumour that ${note.name} died ${note.how}, but you don't know it for sure.`);
    else lines.push(`As far as you know, ${note.name} is alive and well; you've heard nothing to say otherwise.`);
  }
  return lines.length > 0 ? lines.join(" ") : null;
}

/** Does the line name the dead person (their name, a part of it, or a lore alias)? */
function namesTheDead(line: string, note: DeathNote): boolean {
  const words = new Set(note.name.split(/\s+/).filter((w) => w.length > 2 && !/^(old|the|corporal|captain)$/i.test(w)));
  for (const e of worldLore().entries) if (e.npc === note.dead) for (const a of e.aliases) words.add(a);
  const lower = line.toLowerCase();
  return [...words].some((w) => new RegExp(`\\b${w.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(lower));
}
