import { check, modifier, type Rng } from "./dice.js";
import { recordEvent } from "./events.js";
import { note } from "./journal.js";
import { addEmotion } from "../npc/emotions.js";
import { certaintyOf, worldLore } from "../npc/knowledge.js";
import { remember } from "../npc/memory.js";
import { adjust, AFFECTION } from "../npc/relationship.js";
import { skillLevel } from "../npc/skills.js";
import { statsOf } from "../npc/state.js";
import { traitsOf } from "../npc/traits.js";
import type { NpcPersona, NpcState, WorldSnapshot } from "../npc/types.js";

/**
 * The player can lie (N5.4). `/lie <claim>` rolls the player's charisma + speechcraft
 * against 10 + the NPC's perception modifier + an insight bonus (liars spot liars:
 * dishonest NPCs are harder to fool), easier if they trust the player.
 * - Believed: the claim is stored as a belief, marked false where the NPC can't see.
 * - Spotted: trust and respect drop, and it's remembered.
 * - Found out later: each night a believed lie may come apart, likelier when it names
 *   someone the NPC knows well enough to ask. Then trust and respect drop harder.
 */
export interface Belief {
  id: string;
  /** What the player claimed, in their words. */
  claim: string;
  day: number;
  /** Always true for /lie: the game knows. Never shown to the NPC. */
  false: true;
  /** Lore ids of people the claim names (who the NPC could check with). */
  names: string[];
  foundOut: boolean;
}

/** Insight bonus from traits: up to +4 for the least honest. */
export function insight(persona: Pick<NpcPersona, "traits">, state?: Pick<NpcState, "growth">): number {
  return Math.round(4 * (1 - traitsOf(persona, state).honesty));
}

/** Target to beat for a lie to this NPC. */
export function lieTarget(persona: NpcPersona, state: NpcState): number {
  const trustShift = state.relationship > 50 ? -2 : state.relationship < 0 ? 2 : 0;
  return 10 + modifier(statsOf(persona, state).attributes.perception) + insight(persona, state) + trustShift;
}

/** Nightly chance a believed lie comes out: higher when it names someone they know for certain. */
export const EXPOSE_CHANCE = { checkable: 0.25, other: 0.05 } as const;

/** People (lore person entries) a claim names. */
export function namedPeople(claim: string): string[] {
  const lower = claim.toLowerCase();
  return worldLore()
    .entries.filter((e) => e.kind === "person" && [e.name.replace(/^the /i, ""), ...e.aliases, ...e.keywords].some((w) => new RegExp(`\\b${w.toLowerCase()}\\b`).test(lower)))
    .map((e) => e.id);
}

export interface LieResult {
  ok: boolean;
  believed: boolean;
  /** For the NPC, as an event. */
  message: string;
  roll?: string;
}

let beliefCounter = 0;

/** The player tells a lie. Rolled in code; changes state either way. */
export function tellLie(persona: NpcPersona, state: NpcState, world: WorldSnapshot, claim: string, rng: Rng): LieResult {
  const player = world.player;
  const text = claim.trim().replace(/^["']|["']$/g, "");
  if (!text) return { ok: false, believed: false, message: "Say what you claim: /lie <claim>." };
  if (state.inCombat) return { ok: false, believed: false, message: "Nobody's listening to stories mid-fight." };
  const target = lieTarget(persona, state);
  const result = check(rng, player.attributes.charisma, target, skillLevel(player.skills, "speechcraft"));
  const roll = `rolled ${result.roll}${result.total - result.roll >= 0 ? "+" : ""}${result.total - result.roll}=${result.total} vs ${target}`;
  if (result.success) {
    state.beliefs.push({ id: `lie-${world.day}-${++beliefCounter}`, claim: text, day: world.day, false: true, names: namedPeople(text), foundOut: false });
    recordEvent(world, { kind: "lied-to", actor: "player", target: persona.id, details: text, importance: 3 });
    note(player, { id: `lie:${persona.id}:${text}`, day: world.day, npc: persona.id, kind: "lie", text: `${persona.name} believed your lie: "${text}"` });
    return { ok: true, believed: true, roll, message: `${player.name} told you: "${text}". You believe them (${roll}). Take it as true.` };
  }
  adjust(state, "trust", -10);
  adjust(state, "respect", -5);
  adjust(state, "affection", AFFECTION.insult);
  remember(state, { id: `lie-spotted-${world.day}`, day: world.day, text: `they lied to your face: "${text}"`, importance: 6, valence: -1 }, traitsOf(persona, state));
  addEmotion(state, "resentment", 0.4, "them lying to your face", world.day, true);
  recordEvent(world, { kind: "lie-spotted", actor: "player", target: persona.id, details: text, importance: 6 });
  note(player, { id: `lie:${persona.id}:${text}`, day: world.day, npc: persona.id, kind: "lie", text: `${persona.name} saw through your lie: "${text}"` });
  return { ok: true, believed: false, roll, message: `${player.name} told you: "${text}". You can tell it's a lie (${roll}). Call it out.` };
}

/** A believed lie comes out: the penalty, the memory, the journal. Returns a line for the log. */
export function exposeLie(persona: NpcPersona, state: NpcState, belief: Belief, world: Pick<WorldSnapshot, "day" | "hour" | "location" | "player"> & { events?: WorldSnapshot["events"] }): string {
  belief.foundOut = true;
  adjust(state, "trust", -20);
  adjust(state, "respect", -10);
  adjust(state, "affection", AFFECTION.betrayal);
  remember(state, { id: `lie-found-${belief.id}`, day: world.day, text: `you found out they lied to you: "${belief.claim}" was false`, importance: 8, valence: -1 }, traitsOf(persona, state));
  addEmotion(state, "resentment", 0.6, `being lied to ("${belief.claim}")`, world.day, true);
  recordEvent(world, { kind: "lie-found-out", actor: persona.id, target: "player", details: belief.claim, importance: 7 });
  note(world.player, { id: `lie:${persona.id}:${belief.claim}`, day: world.day, npc: persona.id, kind: "lie", text: `${persona.name} found out you lied: "${belief.claim}"` });
  return `${persona.name} found out that "${belief.claim}" was a lie.`;
}

/** Each night: believed lies may come apart. Returns lines for the log. */
export function exposeLies(
  persona: NpcPersona,
  state: NpcState,
  world: Pick<WorldSnapshot, "day" | "hour" | "location" | "player"> & { events?: WorldSnapshot["events"] },
  rng: Rng,
): string[] {
  const log: string[] = [];
  for (const b of state.beliefs) {
    if (b.foundOut || b.day >= world.day) continue;
    const checkable = b.names.some((id) => certaintyOf(persona, id) === "certain");
    if (rng() < (checkable ? EXPOSE_CHANCE.checkable : EXPOSE_CHANCE.other)) log.push(exposeLie(persona, state, b, world));
  }
  return log;
}

/** Situation lines: what they believe from the player (the last two, not found out). */
export function describeBeliefs(state: NpcState, playerName: string): string | null {
  const live = state.beliefs.filter((b) => !b.foundOut).slice(-2);
  if (live.length === 0) return null;
  return `${playerName} told you (and you believe it): ${live.map((b) => `"${b.claim}"`).join("; ")}.`;
}
