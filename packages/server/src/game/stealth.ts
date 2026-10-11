import { addEmotion } from "../npc/emotions.js";
import { remember } from "../npc/memory.js";
import { adjust, AFFECTION, setGrudge } from "../npc/relationship.js";
import { isFriend } from "../npc/social.js";
import { skillLevel } from "../npc/skills.js";
import { statsOf } from "../npc/state.js";
import { traitsOf } from "../npc/traits.js";
import type { NpcPersona, NpcState, PlayerState, WorldSnapshot } from "../npc/types.js";
import { absoluteMinute } from "./clock.js";
import { check, modifier, type Rng } from "./dice.js";
import { recordEvent, type GameEvent } from "./events.js";
import { playerHasRoom } from "./gear.js";
import { itemLabel, itemValue, resolveItem } from "./items.js";
import { standingForDeed, STANDING } from "./factions.js";
import { witnessesLearn } from "./reputation.js";
import { setMood } from "../npc/actions.js";

/**
 * Theft and stealth (N7.5). /steal takes something from an NPC's stock, /sneak
 * moves unseen. Rolled in code: the player's agility + sneak against 10 + the
 * NPC's perception, with modifiers for what they're doing (busy at work is easier,
 * asleep easier still, face to face harder) and for anyone else watching. Getting
 * caught means anger, a grudge, and a crime the guard will hear of (game/crime.ts).
 * Stolen goods are remembered: carry them in front of the owner, or try to sell
 * them to the owner or a friend, and they may be recognised.
 */

/** Modifiers to the target, by what the victim is doing. */
export const STEAL_MODS = { busy: -4, asleep: -8, faceToFace: 4, sneaking: -3, perWitness: 2 } as const;
/** Minutes a successful /sneak keeps the player unseen at a place. */
export const SNEAK_MINUTES = 60;

export interface StealContext {
  persona: NpcPersona;
  state: NpcState;
  world: WorldSnapshot;
  rng: Rng;
  /** What the victim is doing: busy at a job, asleep, or with the player. */
  victim: "busy" | "asleep" | "face to face";
  /** Others here and awake who might see (NPC ids). */
  witnesses: string[];
}

export interface StealResult {
  ok: boolean;
  success: boolean;
  message: string;
  roll?: string;
  event?: GameEvent;
}

/** Is the player sneaking at their current place right now? */
export function isSneaking(player: PlayerState, world: Pick<WorldSnapshot, "day" | "hour" | "minute">): boolean {
  return !!player.sneaking && player.sneaking.place === player.place && absoluteMinute(world) < player.sneaking.until;
}

/** The target to beat to lift something from this NPC. */
export function stealTarget(ctx: Pick<StealContext, "persona" | "state" | "world" | "victim" | "witnesses">): number {
  const per = statsOf(ctx.persona, ctx.state).attributes.perception;
  const mod = ctx.victim === "busy" ? STEAL_MODS.busy : ctx.victim === "asleep" ? STEAL_MODS.asleep : STEAL_MODS.faceToFace;
  const sneaking = isSneaking(ctx.world.player, ctx.world) ? STEAL_MODS.sneaking : 0;
  return 10 + modifier(per) + mod + sneaking + STEAL_MODS.perWitness * ctx.witnesses.length;
}

const describeRoll = (r: { roll: number; total: number; target: number }) => `rolled ${r.roll}${r.total - r.roll >= 0 ? "+" : ""}${r.total - r.roll}=${r.total} vs ${r.target}`;

/** Try to steal one `item` from the NPC's stock. */
export function steal(item: string, ctx: StealContext): StealResult {
  const { persona, state, world, rng } = ctx;
  const player = world.player;
  if (state.outcome === "dead") return { ok: false, success: false, message: `${persona.name} is dead; that's looting (/loot).` };
  if (state.inCombat) return { ok: false, success: false, message: "Not in the middle of a fight." };
  const key = resolveItem(state.inventory, item);
  if (!key || !state.inventory[key]) return { ok: false, success: false, message: `${persona.name} has no ${item}.` };
  if (!playerHasRoom(player, { [key]: 1 })) return { ok: false, success: false, message: "No room in your pack." };
  const target = stealTarget(ctx);
  const r = check(rng, player.attributes.agility, target, skillLevel(player.skills, "sneak"));
  const roll = describeRoll(r);
  const value = itemValue(key) ?? 0;
  if (r.success) {
    state.inventory[key] -= 1;
    if (state.inventory[key] === 0) delete state.inventory[key];
    player.inventory[key] = (player.inventory[key] ?? 0) + 1;
    (player.stolen ??= []).push({ item: key, from: persona.id, day: world.day });
    // Nobody saw: the event is known to no one until it's found out.
    const event = recordEvent(world, { kind: "theft", actor: "player", target: persona.id, details: `${itemLabel(key)} worth ${value}c`, importance: 5, witnesses: [] });
    return { ok: true, success: true, roll, event, message: `You lift a ${itemLabel(key)} from ${persona.name} unseen (${roll}).` };
  }
  const event = caughtStealing(persona, state, world, key, ctx.witnesses, value);
  return { ok: true, success: false, roll, event, message: `${persona.name} catches you reaching for the ${itemLabel(key)} (${roll})!` };
}

/** The player was caught (in the act, or with the goods later): anger, a grudge, a crime for the guard. */
export function caughtStealing(persona: NpcPersona, state: NpcState, world: WorldSnapshot, key: string, witnesses: string[], value = itemValue(key) ?? 0, owner = persona.id): GameEvent {
  const t = traitsOf(persona, state);
  setMood(state, "angry", t);
  adjust(state, "trust", -25);
  adjust(state, "affection", AFFECTION.betrayal);
  const whose = owner === persona.id ? "your" : "your friend's";
  setGrudge(state, t, `they stole ${whose} ${itemLabel(key)}`, world.day);
  addEmotion(state, "resentment", 0.5, "them stealing from you", world.day, true);
  const event = recordEvent(world, { kind: "theft-caught", actor: "player", target: owner, details: `${itemLabel(key)} worth ${value}c`, importance: 7, witnesses: [...new Set([persona.id, ...witnesses])] });
  remember(state, { id: `theft-${world.day}`, day: world.day, text: `they stole ${whose} ${itemLabel(key)}`, importance: 7, valence: -1, event: event.id }, t);
  witnessesLearn(world.player, event);
  standingForDeed(world.player, { persona }, STANDING.theft);
  return event;
}

/** Try to move unseen at the player's place (/sneak): against the sharpest eyes there. */
export function sneak(world: WorldSnapshot, watchers: Array<{ persona: NpcPersona; state: NpcState }>, rng: Rng): StealResult {
  const player = world.player;
  const sharpest = Math.max(10, ...watchers.map((w) => statsOf(w.persona, w.state).attributes.perception));
  const target = 10 + modifier(sharpest) + Math.max(0, watchers.length - 1) * STEAL_MODS.perWitness;
  const r = check(rng, player.attributes.agility, target, skillLevel(player.skills, "sneak"));
  const roll = describeRoll(r);
  if (r.success) {
    player.sneaking = { place: player.place ?? "square", until: absoluteMinute(world) + SNEAK_MINUTES };
    return { ok: true, success: true, roll, message: `You keep to the shadows; nobody here notices you (${roll}).` };
  }
  player.sneaking = null;
  for (const w of watchers) {
    remember(w.state, { id: `creeping-${world.day}`, day: world.day, text: "they were creeping about, up to no good", importance: 3, valence: -1 }, traitsOf(w.persona, w.state));
    adjust(w.state, "trust", -3);
  }
  return { ok: true, success: false, roll, message: `You try to slip by unseen, but ${watchers.length > 0 ? "you're spotted" : "you stumble"} (${roll}).` };
}

/** Stolen goods the player carries that this NPC would recognise as theirs or a friend's. */
export function recognisableLoot(persona: NpcPersona, state: NpcState, player: PlayerState): Array<{ item: string; from: string }> {
  return (player.stolen ?? []).filter((s) => (player.inventory[s.item] ?? 0) > 0 && (s.from === persona.id || isFriend(state, s.from)));
}

/**
 * Selling (or showing) a stolen piece to its owner or a friend of theirs: the owner
 * always knows it; a friend recognises it half the time. Returns the event if caught.
 */
export function recognisesStolen(persona: NpcPersona, state: NpcState, world: WorldSnapshot, item: string, rng: Rng): GameEvent | null {
  const stolen = (world.player.stolen ?? []).find((s) => s.item === item);
  if (!stolen) return null;
  const owner = stolen.from === persona.id;
  if (!owner && !(isFriend(state, stolen.from) && rng() < 0.5)) return null;
  world.player.stolen = (world.player.stolen ?? []).filter((s) => s !== stolen);
  return caughtStealing(persona, state, world, item, [], itemValue(item) ?? 0, stolen.from);
}
