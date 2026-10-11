import { note } from "../game/journal.js";
import { ITEM_TIERS, itemValue, parseItem, type ItemTier } from "../game/items.js";
import type { NpcPersona, NpcState, Trigger, WorldSnapshot } from "./types.js";

/**
 * Fears and loves (N5.2): people, items, topics or places an NPC reacts to strongly.
 * A mention (keyword lists, not the model) or a sighting shifts their mood and trust
 * by amounts set here. A gift of something they love is worth more than its gold.
 * A fear in sight makes them likelier to break and run in a fight (morale).
 */

/** Trust and affection a loved thing's mention adds (once a day each). */
export const LOVE_MENTION_TRUST = 2;
/** How much harder the morale roll is with something they fear in sight. */
export const FEAR_MORALE_PENALTY = 3;

const mentions = (line: string, word: string) =>
  new RegExp(`\\b${word.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(line.toLowerCase());

/** The fears and loves a line mentions. */
export function mentionedTriggers(persona: NpcPersona, line: string): { loves: Trigger[]; fears: Trigger[] } {
  const hit = (t: Trigger) => t.words.some((w) => mentions(line, w));
  return { loves: (persona.loves ?? []).filter(hit), fears: (persona.fears ?? []).filter(hit) };
}

/** Does an item (a key or name) count as this trigger? Loved blades must be good enough (minTier). */
export function itemMatches(trigger: Trigger, item: string): boolean {
  const parsed = parseItem(item);
  if (!trigger.item || !parsed || parsed.name !== trigger.item) return false;
  if (!trigger.minTier) return true;
  return ITEM_TIERS.indexOf(parsed.tier) >= ITEM_TIERS.indexOf(trigger.minTier as ItemTier);
}

/** Fears in sight: a feared NPC present, or a feared item the player wields. */
export function fearsInSight(persona: NpcPersona, world: WorldSnapshot): Trigger[] {
  const weapon = world.player.equipment?.weapon;
  return (persona.fears ?? []).filter(
    (f) => (f.npc !== undefined && (world.present ?? []).includes(f.npc)) || (weapon !== undefined && itemMatches(f, weapon)),
  );
}

/** Extra morale difficulty in a fight from fears in sight. */
export function fearMoralePenalty(persona: NpcPersona, world: WorldSnapshot): number {
  return fearsInSight(persona, world).length > 0 ? FEAR_MORALE_PENALTY : 0;
}

/**
 * React to fears and loves in the player's line and in sight. Once a day per thing:
 * a love warms them (trust and affection), a fear frightens them. The player learns
 * of it in their journal. Returns situation lines (at most one), and the mood to take.
 */
export function reactToTriggers(
  persona: NpcPersona,
  state: NpcState,
  world: WorldSnapshot,
  line: string,
): { lines: string[]; mood: "afraid" | "happy" | null } {
  const { loves, fears } = mentionedTriggers(persona, line);
  const sighted = fearsInSight(persona, world).filter((f) => !fears.includes(f));
  const lines: string[] = [];
  let mood: "afraid" | "happy" | null = null;
  const fresh = (t: Trigger) => state.triggerDay[t.name] !== world.day;

  for (const f of [...fears, ...sighted]) {
    lines.push(fears.includes(f) ? `They mentioned ${f.name}, which frightens you.` : `${f.name[0]!.toUpperCase()}${f.name.slice(1)} is right here, and it frightens you.`);
    mood = "afraid";
    if (fresh(f)) {
      state.triggerDay[f.name] = world.day;
      note(world.player, { id: `fear:${persona.id}:${f.name}`, day: world.day, npc: persona.id, kind: "fear", text: `${persona.name} is afraid of ${f.name}.` });
    }
  }
  for (const l of loves) {
    lines.push(`They mentioned ${l.name}, which you love.`);
    if (!mood) mood = "happy";
    if (fresh(l)) {
      state.triggerDay[l.name] = world.day;
      state.relationship = Math.min(100, state.relationship + LOVE_MENTION_TRUST);
      state.affection = Math.min(100, state.affection + LOVE_MENTION_TRUST);
      note(world.player, { id: `love:${persona.id}:${l.name}`, day: world.day, npc: persona.id, kind: "love", text: `${persona.name} loves ${l.name}.` });
    }
  }
  return { lines: lines.slice(0, 1), mood };
}

// ---- Gifts ----

/** Copper of value per point of trust a gift buys. */
export const COPPER_PER_TRUST = 25;
/** Most trust one ordinary gift can buy. */
export const MAX_GIFT_TRUST = 10;
/** A loved gift is worth this many times its value in trust, and at least LOVED_GIFT_MIN. */
export const LOVED_GIFT_FACTOR = 3;
export const LOVED_GIFT_MIN = 8;

/** The love a gift item matches, if any. */
export function lovedItem(persona: NpcPersona, item: string): Trigger | undefined {
  return (persona.loves ?? []).find((l) => itemMatches(l, item));
}

/**
 * Trust a gift buys: 1 per COPPER_PER_TRUST of value (at least 1, at most MAX_GIFT_TRUST).
 * A loved item counts LOVED_GIFT_FACTOR times, at least LOVED_GIFT_MIN, uncapped by MAX_GIFT_TRUST.
 * A second gift the same day counts half.
 */
export function giftTrust(persona: NpcPersona, state: NpcState, gift: { item?: string; money?: number }, day: number): number {
  const value = gift.item ? (itemValue(gift.item) ?? 0) : (gift.money ?? 0);
  const base = Math.max(1, Math.round(value / COPPER_PER_TRUST));
  const loved = gift.item ? lovedItem(persona, gift.item) : undefined;
  const trust = loved ? Math.max(LOVED_GIFT_MIN, base * LOVED_GIFT_FACTOR) : Math.min(MAX_GIFT_TRUST, base);
  return state.lastGiftReceivedDay === day ? Math.ceil(trust / 2) : trust;
}
