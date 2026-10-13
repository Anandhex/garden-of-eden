import { note } from "./journal.js";
import type { NpcPersona, NpcState, PlayerState } from "../npc/types.js";

/**
 * Rumours about NPCs (N7.1): what folk say about someone before you meet them,
 * which may be wrong. Each NPC file lists `reputationFacts` about that NPC: true,
 * exaggerated or false, and who starts out knowing them. Gossip (game/gossip.ts)
 * passes them on, and every retelling makes them less reliable. Rumours about the
 * player (a revenge, director/revenge.ts) travel the same way.
 *
 * The model never decides what's true: code tells a teller "you heard this, you're
 * not sure", and tells the subject "it's a lie: deny it" or "it's true".
 */
export const TRUTHS = ["true", "exaggerated", "false"] as const;
export type Truth = (typeof TRUTHS)[number];

export interface ReputationFact {
  id: string;
  /** What's said, naming them: "Mara Ashford is a thief". */
  text: string;
  truth: Truth;
  /** Lower-case words that bring it up in the player's line. */
  keywords: string[];
  /** NPC ids who know it when a world starts. */
  knownBy?: string[];
  /** For the subject, when asked: what really happened, if it isn't simply true or false. */
  correction?: string;
}

/** A rumour someone heard. Saved per NPC, by key "about.fact". */
export interface HeardRumour {
  /** Who it's about: an NPC id, or "player". */
  about: string;
  fact: string;
  text: string;
  truth: Truth;
  /** 1 = heard first hand; each retelling loses RETELL_LOSS. */
  accuracy: number;
  heardFrom?: string;
  day: number;
  /** They've passed it on to the player. */
  toldPlayer?: boolean;
}

/** Accuracy lost each time a rumour is passed on. */
export const RETELL_LOSS = 0.2;
/** Below this accuracy a rumour is too garbled to pass on. */
export const MIN_ACCURACY = 0.3;

export const rumourKey = (about: string, fact: string) => `${about}.${fact}`;

/** The rumours every NPC starts a world knowing (reputationFacts' knownBy). */
export function seedRumours(personas: Record<string, NpcPersona>, states: Record<string, NpcState>, day: number): void {
  for (const subject of Object.values(personas)) {
    for (const f of subject.reputationFacts ?? []) {
      for (const listener of f.knownBy ?? []) {
        const s = states[listener];
        if (!s || listener === subject.id) continue;
        s.rumours[rumourKey(subject.id, f.id)] ??= { about: subject.id, fact: f.id, text: f.text, truth: f.truth, accuracy: 1, day };
      }
    }
  }
}

/** Hear a rumour (gossip, or a revenge rumour started about the player). Returns true if it's news to them. */
export function hearRumour(state: NpcState, rumour: Omit<HeardRumour, "toldPlayer">): boolean {
  const key = rumourKey(rumour.about, rumour.fact);
  const known = state.rumours[key];
  if (known && known.accuracy >= rumour.accuracy) return false;
  state.rumours[key] = { ...rumour };
  return true;
}

/** A rumour as the teller passes it on: less reliable, or null if it's too garbled to bother with. */
export function retold(r: HeardRumour, teller: string, day: number): Omit<HeardRumour, "toldPlayer"> | null {
  const accuracy = Math.round((r.accuracy - RETELL_LOSS) * 100) / 100;
  if (accuracy < MIN_ACCURACY) return null;
  return { about: r.about, fact: r.fact, text: r.text, truth: r.truth, accuracy, heardFrom: teller, day };
}

const mentions = (line: string, words: string[]) => {
  const lower = line.toLowerCase();
  return words.some((w) => new RegExp(`\\b${w.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(lower));
};

/** Name words for an NPC: "Mara Ashford" → ["mara", "ashford"]. */
const nameWords = (name: string) => name.toLowerCase().split(/\s+/).filter((w) => w.length > 2 && !["old", "the", "corporal"].includes(w));

/**
 * A rumour this NPC could pass on to the player now: one about someone the player
 * named, or any if they asked for gossip. Strongest (most accurate) first.
 */
export function rumourToShare(state: NpcState, line: string, names: Record<string, string>, askedForGossip: boolean): HeardRumour | null {
  const candidates = Object.values(state.rumours)
    .filter((r) => r.about !== "player" && r.accuracy >= MIN_ACCURACY)
    .filter((r) => askedForGossip || mentions(line, nameWords(names[r.about] ?? r.about)))
    .sort((a, b) => Number(a.toldPlayer ?? false) - Number(b.toldPlayer ?? false) || b.accuracy - a.accuracy);
  return candidates[0] ?? null;
}

/** "Folk are saying", "You've heard, though you're not sure,": how sure the teller sounds. */
function hedge(r: HeardRumour): string {
  if (r.accuracy >= 0.9) return "You know for a fact";
  if (r.accuracy >= 0.6) return `You've heard${r.heardFrom ? ` from ${r.heardFrom}` : ""}`;
  return `There's a garbled tale going round${r.heardFrom ? ` (${r.heardFrom} told you)` : ""}, and you're not sure of it,`;
}

/**
 * The situation line for a teller, and the journal note: the player has now heard
 * it. Code notes it, since the line is in front of the NPC the moment they're asked.
 */
export function shareRumour(persona: NpcPersona, state: NpcState, rumour: HeardRumour, player: PlayerState, names: Record<string, string>, day: number): string {
  rumour.toldPlayer = true;
  note(player, { id: `rumour:${rumour.about}.${rumour.fact}`, day, npc: rumour.about, kind: "rumour", text: `${persona.name} says ${rumour.text}. (Unconfirmed)` });
  return `${hedge(rumour)} that ${rumour.text}. If the talk turns to ${names[rumour.about] ?? "it"}, pass it on in your own words.`;
}

/**
 * The subject hears the player bring up a rumour about them: code says whether it's
 * true. Returns the situation line, the mood it puts them in, and updates the
 * player's journal (the rumour turned out true or false).
 */
export function confrontRumour(persona: NpcPersona, line: string, player: PlayerState, day: number): { line: string; mood: "angry" | "annoyed" | null; fact: ReputationFact } | null {
  const fact = (persona.reputationFacts ?? []).find((f) => mentions(line, f.keywords));
  if (!fact) return null;
  const heard = (player.journal ?? []).find((e) => e.id === `rumour:${persona.id}.${fact.id}`);
  const verdict = fact.truth === "true" ? "turned out to be true" : fact.truth === "false" ? "is a lie" : "has grown in the telling";
  if (heard) note(player, { id: heard.id, day, npc: persona.id, kind: "rumour", text: `${heard.text.replace(/\. \(Unconfirmed\)$/, "")}: it ${verdict}${fact.correction ? ` (${fact.correction})` : ""}.` });
  else note(player, { id: `rumour:${persona.id}.${fact.id}`, day, npc: persona.id, kind: "rumour", text: `Asked ${persona.name} whether ${fact.text}: it ${verdict}.` });
  if (fact.truth === "false") {
    return { fact, mood: "angry", line: `They're repeating a rumour about you: "${fact.text}". It's a lie, and it makes you angry. Deny it hotly${fact.correction ? `: ${fact.correction}` : ""}.` };
  }
  if (fact.truth === "exaggerated") {
    return { fact, mood: "annoyed", line: `They're repeating a rumour about you: "${fact.text}". There's a grain of truth in it, but it's been blown up${fact.correction ? `: ${fact.correction}` : ""}. Set it straight.` };
  }
  return { fact, mood: null, line: `They're repeating something folk say about you: "${fact.text}". It's true. You can admit it, grudgingly or not.` };
}

/** A rumour about the player that this NPC believes: a line for their situation, or null. */
export function describePlayerRumours(state: NpcState): string | null {
  const about = Object.values(state.rumours).filter((r) => r.about === "player" && r.accuracy >= MIN_ACCURACY);
  if (about.length === 0) return null;
  const best = about.sort((a, b) => b.accuracy - a.accuracy)[0]!;
  return `You've heard${best.heardFrom ? ` from ${best.heardFrom}` : ""} that ${best.text}.`;
}
