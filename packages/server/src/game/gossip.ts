import { learnLore, worldLore } from "../npc/knowledge.js";
import { learnName } from "../npc/names.js";
import { remember } from "../npc/memory.js";
import { adjust } from "../npc/relationship.js";
import { adjustRelation, credence, isEnemy, isFriend, relationTo } from "../npc/social.js";
import { traitsOf } from "../npc/traits.js";
import type { NpcPersona, NpcState, WorldSnapshot } from "../npc/types.js";
import type { Rng } from "./dice.js";
import { type GameEvent, knowsEvent, learnEvent } from "./events.js";
import { townLearns } from "./reputation.js";
import { hearRumour, retold } from "./rumours.js";
import { heardNews } from "./deathNews.js";

/**
 * Gossip (N4.3, N7): when NPCs share a place they pass on what they know, all in
 * code. The player's name spreads as a rumour; the important things the player did
 * (memories of GOSSIP_IMPORTANCE or more) are retold at lower importance; rumours
 * about other NPCs (game/rumours.ts) lose accuracy with every retelling; and news
 * spreads as hearsay. How likely a pair is to talk comes from how sociable they
 * are and how they get on; how much the listener believes it, from how much they
 * trust the teller. Hearing that the player hurt a friend hits hardest.
 *
 * Every NPC who learns of something the player did moves the town's view of them
 * (game/reputation.ts).
 */
export interface Gossiper {
  id: string;
  persona: NpcPersona;
  state: NpcState;
}

/** Memories at least this important are worth retelling. */
export const GOSSIP_IMPORTANCE = 6;
/** A retold memory loses this much importance. */
export const RETELLING_LOSS = 2;
/** Extra trust and affection a listener loses on hearing the player hurt a friend of theirs. */
export const FRIEND_HURT = { trust: -8, affection: -8, fear: 5 } as const;

/** Chance the two share something in an hour together: the average of their sociability, plus a quarter, more between friends. */
export function gossipChance(a: NpcPersona, b: NpcPersona, aState?: NpcState, bState?: NpcState): number {
  const base = (traitsOf(a, aState).sociability + traitsOf(b, bState).sociability) / 2 + 0.25;
  const warmth = aState && bState ? (isFriend(aState, b.id) || isFriend(bState, a.id) ? 0.1 : 0) : 0;
  return Math.min(1, base + warmth);
}

const firstName = (p: NpcPersona) => p.name.split(" ").find((w) => !/^(old|corporal)$/i.test(w)) ?? p.name;

/**
 * An hour together: each pair may swap what they know. `world` (optional) lets
 * events, the town's view and news travel too. Returns log lines (tests, debugging).
 */
export function gossipTogether(group: Gossiper[], day: number, rng: Rng, world?: Pick<WorldSnapshot, "events" | "player" | "recentEvents" | "deathNotes">): string[] {
  const log: string[] = [];
  for (const speaker of group) {
    for (const listener of group) {
      if (speaker === listener) continue;
      const chance = gossipChance(speaker.persona, listener.persona, speaker.state, listener.state);
      const belief = credence(listener.state, speaker.id);
      const name = speaker.state.knownName;
      if (name && listener.state.knownName !== name && listener.state.nameSource?.how !== "told" && rng() < chance) {
        if (learnName(listener.state, name, "rumour", speaker.persona.name)) log.push(`${speaker.persona.name} told ${listener.persona.name} the stranger's name is ${name}.`);
      }
      for (const m of speaker.state.memories) {
        if ((m.importance ?? 0) < GOSSIP_IMPORTANCE || m.heardFrom || m.summary) continue;
        const id = `heard:${speaker.id}:${m.id}`;
        if (listener.state.memories.some((x) => x.id === id) || rng() >= chance) continue;
        // A listener who saw it for themselves doesn't need telling.
        if (m.event && listener.state.memories.some((x) => x.event === m.event)) continue;
        const who = firstName(speaker.persona);
        const text = m.text.replace(/\byou\b/g, who).replace(/\byour\b/g, `${who}'s`);
        remember(listener.state, { id, day, text, importance: m.importance! - RETELLING_LOSS, valence: m.valence ?? 0, heardFrom: speaker.persona.name, ...(m.event ? { event: m.event } : {}) }, traitsOf(listener.persona, listener.state));
        // What they hear colours how they see the player: more when they believe the teller, and most when it's about a friend.
        if ((m.valence ?? 0) < 0) {
          adjust(listener.state, "trust", Math.round(-3 * belief));
          if (isFriend(listener.state, speaker.id)) {
            adjust(listener.state, "trust", Math.round(FRIEND_HURT.trust * belief));
            adjust(listener.state, "affection", Math.round(FRIEND_HURT.affection * belief));
            adjust(listener.state, "fear", Math.round(FRIEND_HURT.fear * belief));
          }
        } else if ((m.valence ?? 0) > 0) adjust(listener.state, "trust", Math.round(2 * belief));
        const event = m.event && world ? world.events?.find((e) => e.id === m.event) : undefined;
        if (event && learnEvent(event, listener.id) && world) townLearns(world.player, event);
        log.push(`${speaker.persona.name} told ${listener.persona.name}: ${text}.`);
      }
      // Rumours about others: never told to the one they're about, and less reliable each time.
      for (const r of Object.values(speaker.state.rumours)) {
        if (r.about === listener.id || rng() >= chance * belief) continue;
        const passed = retold(r, speaker.persona.name, day);
        if (passed && hearRumour(listener.state, passed)) {
          log.push(`${speaker.persona.name} told ${listener.persona.name} that ${r.text}.`);
          if (r.about === "player") adjust(listener.state, "trust", Math.round(-4 * passed.accuracy * belief));
        }
      }
      // News they know: the listener hears it as a rumour.
      if (world) {
        for (const [id, certainty] of Object.entries(speaker.state.learned)) {
          const entry = worldLore().byId.get(id);
          if (!entry || entry.kind !== "news" || listener.state.learned[id] || rng() >= chance) continue;
          const told = `${speaker.persona.name} told ${listener.persona.name} the news: ${entry.text}${certainty === "rumour" ? " (or so they heard)" : ""}`;
          // A death heard of: they react now (N13.0). From a trusted teller who knows it for certain, they believe it.
          if (world.deathNotes?.[id]) {
            if (heardNews(listener, id, { ...world, day }, certainty === "certain" && belief >= 0.5 ? "certain" : "rumour")) log.push(told);
          } else if (learnLore(listener.state, id, "rumour")) log.push(told);
        }
      }
      // Time together warms people a little, and builds a modest trust (up to FAMILIAR_TRUST) between those who aren't enemies:
      // over weeks of shared evenings, that's how two NPCs come to court (game/family.ts).
      if (rng() < chance / 2) {
        adjustRelation(listener.state, speaker.id, "affection", 1);
        if (!isEnemy(listener.state, speaker.id) && relationTo(listener.state, speaker.id).trust < FAMILIAR_TRUST) adjustRelation(listener.state, speaker.id, "trust", 1);
      }
    }
  }
  return log;
}

/** Trust that time together alone can build; more takes deeds. */
export const FAMILIAR_TRUST = 40;

/** How an event looks to someone who saw it: "they attacked Mara Ashford". */
export function witnessedText(event: GameEvent, names: Record<string, string>): string | null {
  const target = names[event.target] ?? event.target;
  switch (event.kind) {
    case "attacked":
      return `you saw them attack ${target}`;
    case "killed":
      return `you saw them kill ${target}`;
    case "subdued":
      return `you saw them beat ${target} senseless`;
    case "theft-caught":
      return `you saw them caught stealing from ${target}`;
    case "looted":
      return `you saw them rob ${target}'s body`;
    case "threatened":
      return `you saw them threaten ${target}`;
    case "raid-repelled":
      return `you saw them fight off bandits at ${target}'s place`;
    case "quest-done":
      return `you saw them finish a job for ${target}`;
    default:
      return null;
  }
}

/**
 * Witnesses remember what they saw the player do to someone else (the victim
 * remembers it from their own hook). Run after turns and each village hour; each
 * witness remembers each event once. Returns log lines.
 */
export function absorbWitnessed(members: Gossiper[], world: Pick<WorldSnapshot, "events" | "player">): string[] {
  const names = Object.fromEntries(members.map((m) => [m.id, m.persona.name]));
  const log: string[] = [];
  for (const e of world.events ?? []) {
    if (e.actor !== "player" || e.importance < 5) continue;
    const text = witnessedText(e, names);
    if (!text) continue;
    for (const w of e.witnesses ?? []) {
      if (w === e.target) continue;
      const m = members.find((x) => x.id === w);
      if (!m || m.state.outcome === "dead" || m.state.memories.some((x) => x.event === e.id)) continue;
      const bad = ["attacked", "killed", "subdued", "theft-caught", "looted", "threatened"].includes(e.kind);
      remember(m.state, { id: `saw:${e.id}`, day: e.day, text, importance: e.importance, valence: bad ? -1 : 1, event: e.id }, traitsOf(m.persona, m.state));
      if (bad) {
        adjust(m.state, "trust", -10);
        adjust(m.state, "fear", 8);
        if (isFriend(m.state, e.target)) {
          adjust(m.state, "affection", -15);
          adjust(m.state, "trust", -10);
        }
      } else adjust(m.state, "respect", 3);
      log.push(`${m.persona.name} saw it.`);
    }
  }
  return log;
}

/** Does this NPC know the player did `kind` to anyone? (For tests and the guard.) */
export function knowsOfDeed(world: Pick<WorldSnapshot, "events">, npcId: string, kind: GameEvent["kind"]): boolean {
  return (world.events ?? []).some((e) => e.actor === "player" && e.kind === kind && knowsEvent(e, npcId));
}

