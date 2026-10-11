import { config } from "../config.js";
import { note } from "../game/journal.js";
import type { NpcPersona, NpcState, PlayerState } from "./types.js";

/**
 * Learning the player's name (N4.3). The player has a name; each NPC knows it only
 * once told (detected in code from "I'm ..." or "my name is ...", or /introduce) or
 * through gossip, as a rumour (game/gossip.ts). Until then the model never sees the
 * real name: NpcAgent swaps it for what the NPC knows (maskPlayerName). Below
 * NAME_TRUST they still call the player "stranger"; above it, by name.
 */

/** Trust before an NPC uses the player's name rather than their word for a stranger. */
export const NAME_TRUST = 20;
/** Days away before a return visit counts as "back after a while". */
export const RETURN_GAP_DAYS = 2;

/** Capitalised words that follow "I'm" without being names. */
const NOT_NAMES = new Set(
  (
    "Fine Good Okay Ok Sorry Here There Not Just Looking Hungry Tired Glad Happy Sad Afraid Scared Sure Ready Done Back " +
    "New Lost Busy Leaving Going Coming Interested Curious Serious Joking Kidding A An The From In On Out Of Your Yours Only Still " +
    "Traveler Traveller Stranger Friend Citizen Nobody Somebody Someone No Yes Well Very So Really Afraid Alone Late Early"
  ).split(" "),
);

/**
 * The name in an introduction, or null: "I'm Anand", "my name is Anand Patil",
 * "call me Ash", "name's Ash". Only capitalised words count, so "I'm hungry" isn't a name.
 */
export function detectIntroduction(line: string): string | null {
  const m = line.match(/\b(?:i'?m|i am|my name(?:'s| is)|call me|name's|they call me)\s+([A-Z][a-z'-]+(?:\s+[A-Z][a-z'-]+)?)/i);
  if (!m) return null;
  const words = m[1]!.split(/\s+/);
  if (!/^[A-Z]/.test(words[0]!) || NOT_NAMES.has(words[0]!)) return null;
  // A second word only if it's capitalised too ("Anand Patil", not "Anand from").
  const name = words.length > 1 && /^[A-Z]/.test(words[1]!) && !NOT_NAMES.has(words[1]!) ? words.join(" ") : words[0]!;
  return name;
}

/**
 * The NPC learns a name. Being told beats a rumour; a rumour never overwrites what
 * they were told. Returns true if they learned something new.
 */
export function learnName(state: NpcState, name: string, how: "told" | "rumour", from?: string): boolean {
  if (state.knownName === name && (how === "rumour" || state.nameSource?.how === "told")) return false;
  if (how === "rumour" && state.nameSource?.how === "told") return false;
  state.knownName = name;
  state.nameSource = { how, ...(from ? { from } : {}) };
  return true;
}

/** The player introduced themselves: the NPC learns the name, and the journal notes who knows it. */
export function introduce(persona: NpcPersona, state: NpcState, player: PlayerState, name: string, day: number): boolean {
  const learned = learnName(state, name, "told");
  if (learned) note(player, { id: `name:${persona.id}`, day, npc: persona.id, kind: "name", text: `${persona.name} knows you as ${name}.` });
  return learned;
}

/** What the NPC calls the player in the prompt: the name they know, or the generic one if they don't. */
export function nameKnownToNpc(state: Pick<NpcState, "knownName">): string {
  return state.knownName ?? config.defaultPlayerName;
}

/**
 * Swap the player's real name for what this NPC knows them as, in anything the model
 * will read. A no-op when the NPC knows the real name or the player has no name of their own.
 */
export function maskPlayerName(text: string, player: Pick<PlayerState, "name">, state: Pick<NpcState, "knownName">): string {
  const shown = nameKnownToNpc(state);
  if (player.name === shown) return text;
  return text.replace(new RegExp(`\\b${player.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g"), shown);
}

/** The situation line on who the player is to them. */
export function describeWhoTheyAre(state: NpcState, day: number): string {
  const name = state.knownName;
  const last = state.lastMetDay;
  const back = state.metBefore && last !== null && day - last >= RETURN_GAP_DAYS ? ` You last saw them ${day - last} days ago; greet them as someone you know.` : "";
  if (!name) {
    if (state.metBefore) return `You've met them before but never learned their name.${back}`;
    // "A stranger you've never met" next to high trust confused the model (it stopped sharing secrets).
    return state.relationship > 10 ? "You don't know their name." : "They're a stranger you've never met; you don't know their name.";
  }
  const source = state.nameSource?.how === "rumour" ? `You've heard${state.nameSource.from ? ` from ${state.nameSource.from}` : ""} that their name is ${name}` : `They told you their name is ${name}`;
  const use = state.relationship >= NAME_TRUST ? "Call them by name." : "You don't know them well enough to use it; call them your word for a stranger.";
  return `${source}. ${use}${back}`;
}

/** The conversation happened: they've met, today. */
export function markMet(state: NpcState, day: number): void {
  state.metBefore = true;
  state.lastMetDay = day;
}
