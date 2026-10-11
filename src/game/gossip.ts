import { learnName } from "../npc/names.js";
import { remember } from "../npc/memory.js";
import { adjust } from "../npc/relationship.js";
import { traitsOf } from "../npc/traits.js";
import type { NpcPersona, NpcState } from "../npc/types.js";
import type { Rng } from "./dice.js";

/**
 * The first piece of gossip (N4.3, ahead of N7): when NPCs share a place, they pass
 * on what they know about the player. The player's name spreads as a rumour, and
 * the most important things the player did (memories of importance
 * GOSSIP_IMPORTANCE or more) are retold at lower importance. Chances come from how
 * sociable the two are. All in code.
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

/** Chance the two share something in an hour together: the average of their sociability, plus a quarter. */
export function gossipChance(a: NpcPersona, b: NpcPersona): number {
  return Math.min(1, (traitsOf(a).sociability + traitsOf(b).sociability) / 2 + 0.25);
}

/** An hour together: each pair may swap what they know about the player. Returns log lines (for tests and debugging). */
export function gossipTogether(group: Gossiper[], day: number, rng: Rng): string[] {
  const log: string[] = [];
  for (const speaker of group) {
    for (const listener of group) {
      if (speaker === listener) continue;
      const chance = gossipChance(speaker.persona, listener.persona);
      const name = speaker.state.knownName;
      if (name && listener.state.knownName !== name && listener.state.nameSource?.how !== "told" && rng() < chance) {
        if (learnName(listener.state, name, "rumour", speaker.persona.name)) log.push(`${speaker.persona.name} told ${listener.persona.name} the stranger's name is ${name}.`);
      }
      for (const m of speaker.state.memories) {
        if ((m.importance ?? 0) < GOSSIP_IMPORTANCE || m.heardFrom) continue;
        const id = `heard:${speaker.id}:${m.id}`;
        if (listener.state.memories.some((x) => x.id === id) || rng() >= chance) continue;
        const text = m.text.replace(/\byou\b/g, speaker.persona.name.split(" ")[0]!).replace(/\byour\b/g, `${speaker.persona.name.split(" ")[0]!}'s`);
        remember(listener.state, { id, day, text, importance: m.importance! - RETELLING_LOSS, valence: m.valence ?? 0, heardFrom: speaker.persona.name }, traitsOf(listener.persona));
        // What they hear colours how they see the player, a little.
        if ((m.valence ?? 0) < 0) adjust(listener.state, "trust", -3);
        else if ((m.valence ?? 0) > 0) adjust(listener.state, "trust", 2);
        log.push(`${speaker.persona.name} told ${listener.persona.name}: ${text}.`);
      }
    }
  }
  return log;
}
