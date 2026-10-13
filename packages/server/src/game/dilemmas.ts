import { z } from "zod";
import { remember } from "../npc/memory.js";
import { adjust, type Axis } from "../npc/relationship.js";
import { traitsOf } from "../npc/traits.js";
import type { NpcPersona, NpcState, WorldSnapshot } from "../npc/types.js";
import { recordEvent } from "./events.js";
import { parseItem, resolveItem } from "./items.js";
import { note } from "./journal.js";
import { formatMoney, MoneySchema } from "./money.js";
import { playerHasRoom } from "./gear.js";
import { NO_REPUTATION } from "./reputation.js";
import { addEmotion } from "../npc/emotions.js";

/**
 * Moral dilemmas (N7.2): an NPC puts a choice to the player with a cost on each
 * side. A guard offers a cut to look the other way; a smith asks you to lie to the mayor
 * for her. Every effect is set in the NPC file and applied in code; the model only
 * puts the offer in words (the gated present_dilemma tool) and reacts to the choice.
 * The choice is logged (N5) and remembered.
 */
const axis = z.number().min(-100).max(100);
export const DilemmaEffectsSchema = z
  .object({
    /** How this NPC's feelings for the player move. */
    trust: axis.optional(),
    fear: axis.optional(),
    respect: axis.optional(),
    affection: axis.optional(),
    /** Coins to the player (from the NPC's purse, as far as it goes), or taken from them if negative. */
    money: z.union([MoneySchema, z.number().int().max(0)]).optional(),
    /** Items to the player (from the NPC's stock), by name. */
    items: z.record(z.string(), z.number().int().positive()).optional(),
    /** Standing with factions (game/factions.ts): "the captain's regard" is the guard's. */
    standing: z.record(z.string(), z.number().min(-100).max(100)).optional(),
    /** How the town sees the player. */
    reputation: z.object({ trust: axis, fear: axis, respect: axis, affection: axis }).partial().optional(),
    /** What the NPC remembers, written to them: "they took your bribe". */
    memory: z.string().min(1),
  })
  .strict();

export const DilemmaSchema = z
  .object({
    id: z.string().min(1),
    /** What the NPC asks, written to them: "offer them a cut to look away while you wave a cart through". */
    offer: z.string().min(1),
    /** Words in the player's line that bring it up. */
    keywords: z.array(z.string().min(1)).min(1),
    minTrust: z.number().min(-100).max(100).optional(),
    /** Only after this secret of theirs has been told to the player. */
    afterSecret: z.string().optional(),
    options: z
      .array(z.object({ id: z.string().regex(/^[a-z_]+$/), label: z.string().min(1), effects: DilemmaEffectsSchema }).strict())
      .min(2),
  })
  .strict();
export type Dilemma = z.infer<typeof DilemmaSchema>;

const mentions = (line: string, words: string[]) => words.some((w) => line.toLowerCase().includes(w.toLowerCase()));

/** Dilemmas this NPC could put to the player on this line: not yet settled, trusted enough, secret told. */
export function dilemmasFor(persona: NpcPersona, state: NpcState, line: string): Dilemma[] {
  return (persona.dilemmas ?? []).filter(
    (d) =>
      state.dilemmasDone[d.id] === undefined &&
      state.relationship >= (d.minTrust ?? -100) &&
      (!d.afterSecret || state.revealedSecrets.includes(d.afterSecret)) &&
      mentions(line, d.keywords),
  );
}

/** The NPC puts a dilemma (present_dilemma): it waits for /choose. */
export function presentDilemma(persona: NpcPersona, state: NpcState, id: string): { ok: boolean; message: string } {
  const d = (persona.dilemmas ?? []).find((x) => x.id === id);
  if (!d) return { ok: false, message: `You have no such proposal "${id}".` };
  if (state.dilemmasDone[d.id] !== undefined) return { ok: false, message: "That's already settled between you." };
  state.pendingDilemma = d.id;
  const options = d.options.map((o) => `${o.id} (${o.label})`).join(" or ");
  return { ok: true, message: `Put it to them in your own words: ${d.offer}. They'll choose: ${options}.` };
}

export interface ChoiceResult {
  ok: boolean;
  message: string;
  /** For the player: what changed, in words. */
  effects: string[];
}

/** The player chooses (/choose <option>): every effect applies exactly once. */
export function chooseDilemma(persona: NpcPersona, state: NpcState, world: WorldSnapshot, optionId: string): ChoiceResult {
  const d = (persona.dilemmas ?? []).find((x) => x.id === state.pendingDilemma);
  if (!d) return { ok: false, message: `${persona.name} hasn't put anything to you.`, effects: [] };
  const option = d.options.find((o) => o.id === optionId || o.label.toLowerCase() === optionId.toLowerCase());
  if (!option) return { ok: false, message: `Choose one of: ${d.options.map((o) => o.id).join(", ")}.`, effects: [] };
  const player = world.player;
  const e = option.effects;
  const effects: string[] = [];

  for (const a of ["trust", "fear", "respect", "affection"] as Axis[]) {
    if (e[a]) {
      adjust(state, a, e[a]!);
      effects.push(`${persona.name}'s ${a} ${e[a]! > 0 ? "+" : ""}${e[a]}`);
    }
  }
  if (e.money) {
    if (e.money > 0) {
      const paid = Math.min(e.money, state.money);
      state.money -= paid;
      player.money += paid;
      if (paid > 0) effects.push(`you get ${formatMoney(paid)}`);
    } else {
      const cost = Math.min(-e.money, player.money);
      player.money -= cost;
      state.money += cost;
      if (cost > 0) effects.push(`you pay ${formatMoney(cost)}`);
    }
  }
  for (const [name, qty] of Object.entries(e.items ?? {})) {
    const key = resolveItem(state.inventory, name) ?? parseItem(name)?.key;
    if (!key || (state.inventory[key] ?? 0) < qty || !playerHasRoom(player, { [key]: qty })) continue;
    state.inventory[key] = (state.inventory[key] ?? 0) - qty;
    if (state.inventory[key] === 0) delete state.inventory[key];
    player.inventory[key] = (player.inventory[key] ?? 0) + qty;
    effects.push(`you get ${qty} ${key}`);
  }
  for (const [faction, delta] of Object.entries(e.standing ?? {})) {
    const standing = (player.standing ??= {});
    standing[faction] = Math.max(-100, Math.min(100, (standing[faction] ?? 0) + delta));
    effects.push(`standing with ${faction} ${delta > 0 ? "+" : ""}${delta}`);
  }
  if (e.reputation) {
    const rep = (player.reputation ??= { ...NO_REPUTATION });
    for (const [a, v] of Object.entries(e.reputation) as Array<[keyof typeof rep, number]>) rep[a] = Math.max(a === "fear" ? 0 : -100, Math.min(100, rep[a] + v));
    effects.push("the town's view of you shifts");
  }

  state.dilemmasDone[d.id] = option.id;
  state.pendingDilemma = null;
  const t = traitsOf(persona, state);
  remember(state, { id: `dilemma-${d.id}`, day: world.day, text: e.memory, importance: 6, valence: (e.trust ?? 0) + (e.affection ?? 0) >= 0 ? 1 : -1 }, t);
  if ((e.affection ?? 0) + (e.trust ?? 0) > 0) addEmotion(state, "gratitude", 0.3, e.memory, world.day, true);
  recordEvent(world, { kind: "dilemma", actor: "player", target: persona.id, details: `${d.id}: ${option.id}`, importance: 6 });
  note(player, { id: `dilemma:${persona.id}:${d.id}`, day: world.day, npc: persona.id, kind: "promise", text: `${persona.name} asked you to ${d.offer.replace(/^(ask|offer) (them|the player) /, "")}. You chose: ${option.label}.` });
  return { ok: true, effects, message: `${player.name} chose: ${option.label}. ${e.memory[0]!.toUpperCase()}${e.memory.slice(1)}.` };
}

/** The pending dilemma, for the situation line. */
export function describeDilemma(persona: NpcPersona, state: NpcState): string | null {
  const d = (persona.dilemmas ?? []).find((x) => x.id === state.pendingDilemma);
  return d ? `You put a proposal to them (${d.offer}) and are waiting for their answer.` : null;
}

