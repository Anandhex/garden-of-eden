import { countItem } from "../game/crafting.js";
import { note } from "../game/journal.js";
import { lieChance, traitsOf } from "./traits.js";
import type { BreakCondition, NpcPersona, NpcSecret, NpcState, PlayerState } from "./types.js";

/**
 * Layered secrets (N4.1). A secret can have a cover story: the NPC tells the cover
 * first, and the truth only comes out under pressure. Code decides which they tell:
 * - no cover: as before (trust above SECRET_TRUST, and a dishonest NPC may still lie that day).
 * - a cover, and the NPC is dishonest: the cover, until something breaks it.
 * - a cover, and the NPC is honest: the cover only until they trust the player.
 * What breaks a cover: an item the player carries, a fact they've learned (another
 * NPC's secret), or beating the NPC in a /persuade or /intimidate check today.
 * Once broken, the truth is reachable at any trust: they've been caught out.
 */

/** Trust needed before reveal_secret is offered (and accepted) without pressure. */
export const SECRET_TRUST = 50;

/** The fact a revealed secret gives the player: "pell.hale_cellar". */
export const factId = (npcId: string, secretId: string) => `${npcId}.${secretId}`;

function meets(cond: BreakCondition, state: NpcState, player: PlayerState, day: number): boolean {
  if ("item" in cond) return countItem(player.inventory, cond.item) > 0;
  if ("fact" in cond) return (player.facts ?? []).includes(cond.fact);
  return state.wonCheckDay[cond.check] === day;
}

/** The break condition the player meets for this secret, if any. */
export function breaker(secret: NpcSecret, state: NpcState, player: PlayerState, day: number): BreakCondition | null {
  return (secret.breaksWith ?? []).find((c) => meets(c, state, player, day)) ?? null;
}

/** Has the player broken this secret's cover? */
export function isBroken(secret: NpcSecret, state: NpcState, player: PlayerState, day: number): boolean {
  return breaker(secret, state, player, day) !== null;
}

/** Would the NPC tell the cover story instead of the truth right now? */
export function usesCover(persona: NpcPersona, secret: NpcSecret, state: NpcState, player: PlayerState, day: number): boolean {
  if (!secret.cover || isBroken(secret, state, player, day)) return false;
  const honest = lieChance(traitsOf(persona, state)) === 0;
  return !honest || state.relationship <= SECRET_TRUST;
}

/** Secrets the NPC could be brought to talk about now: trusted enough, or caught out. */
export function reachableSecrets(persona: NpcPersona, state: NpcState, player: PlayerState, day: number): NpcSecret[] {
  return persona.secrets.filter(
    (s) => !state.revealedSecrets.includes(s.id) && (state.relationship > SECRET_TRUST || isBroken(s, state, player, day)),
  );
}

/** Does the player's line touch the secret's subject? */
export function touchesSecret(secret: NpcSecret, line: string): boolean {
  const lower = line.toLowerCase();
  return (secret.keywords ?? []).some((w) => new RegExp(`\\b${w.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(lower));
}

/** What gave them away, in words for the model. */
function describeBreaker(cond: BreakCondition): string {
  if ("item" in cond) return `they're carrying ${cond.item}, which proves it`;
  if ("fact" in cond) return "they know what really happened; someone told them";
  return cond.check === "intimidate" ? "they've frightened the truth out of you" : "they've talked you round";
}

/**
 * Situation lines about secrets when the player's line touches them: for a covered
 * secret, the cover story to stick to (or, once broken, that it won't hold); for one
 * they trust the player with, a nudge to tell it through reveal_secret.
 */
export function describeSecretPressure(persona: NpcPersona, state: NpcState, player: PlayerState, day: number, line: string): string[] {
  const lines: string[] = [];
  for (const secret of persona.secrets) {
    if (state.revealedSecrets.includes(secret.id) || !touchesSecret(secret, line)) continue;
    // A secret they'd tell: a nudge to use the tool (the model tended to make up its own story instead).
    if (!secret.cover) {
      if (state.relationship > SECRET_TRUST) lines.push(`They're asking about ${secret.about}. You trust them enough to tell: call reveal_secret first.`);
      continue;
    }
    const broke = breaker(secret, state, player, day);
    if (broke) lines.push(`About ${secret.about}: ${describeBreaker(broke)}. Your story won't hold; use reveal_secret to come clean.`);
    else if (usesCover(persona, secret, state, player, day)) lines.push(`If they ask about ${secret.about}, stick to your story: ${secret.cover}`);
  }
  return lines.slice(0, 1);
}

/** The secret is out: the player learns it (a fact that can break other covers) and it goes in their journal. */
export function learnSecret(persona: NpcPersona, secret: NpcSecret, player: PlayerState, day: number): void {
  const fact = factId(persona.id, secret.id);
  const facts = (player.facts ??= []);
  if (!facts.includes(fact)) facts.push(fact);
  note(player, { id: `secret:${fact}`, day, npc: persona.id, kind: "secret", text: `${persona.name}'s secret: ${secret.text}` });
}

/** The player heard the cover story: noted, so they can see later that it was a lie. */
export function noteCover(persona: NpcPersona, secret: NpcSecret, player: PlayerState, day: number): void {
  if (!secret.cover) return;
  note(player, { id: `cover:${factId(persona.id, secret.id)}`, day, npc: persona.id, kind: "secret", text: `${persona.name}'s story about ${secret.about}: "${secret.cover}"` });
}
