import { z } from "zod";
import { note } from "../game/journal.js";
import { addEmotion } from "./emotions.js";
import { remember } from "./memory.js";
import { traitsOf } from "./traits.js";
import type { NpcPersona, NpcState, PlayerState, WorldSnapshot } from "./types.js";

/**
 * Personal goal arcs (N9.1): an NPC goal as a tracked arc with stages, e.g. a smith's
 * "find out what happened to Tomas": no news → heard a rumour → found a clue →
 * learned the truth. A stage advances only when code sees its requirement: the
 * player passes on a fact they learned (from another NPC or a secret), a quest is
 * done, or a day comes. Stages unlock quests and secrets, and give the NPC a line
 * to speak from. Each stage fires once.
 */
const RequiresSchema = z
  .object({
    /** The player tells them something they know (a fact in player.facts) and their line mentions one of `words`. */
    told: z.object({ fact: z.string().min(1), words: z.array(z.string().min(1)).min(1) }).strict().optional(),
    /** A fact the player holds (they found out for themselves). */
    fact: z.string().min(1).optional(),
    /** A quest the player finished. */
    quest: z.string().min(1).optional(),
    /** A day reached. */
    day: z.number().int().positive().optional(),
  })
  .strict();

export const ArcSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9_]+$/),
    name: z.string().min(1),
    stages: z
      .array(
        z
          .object({
            id: z.string().regex(/^[a-z0-9_]+$/),
            /** The situation line at this stage, written to the NPC. */
            line: z.string().min(1),
            /** What moves the arc to this stage (none for the first). */
            requires: RequiresSchema.optional(),
            /** Quests and secrets (ids in this NPC's file) that open up at this stage. */
            unlocks: z.object({ quests: z.array(z.string()).optional(), secrets: z.array(z.string()).optional() }).strict().optional(),
            /** For the player's journal. */
            journal: z.string().min(1).optional(),
          })
          .strict(),
      )
      .min(2),
  })
  .strict()
  .refine((a) => !a.stages[0]!.requires, "the first stage has no requirement");
export type Arc = z.infer<typeof ArcSchema>;

export interface ArcProgress {
  stage: number;
  day: number;
}

/** Where they are in an arc (the first stage until something moves it). */
export function arcStage(state: Pick<NpcState, "arcs">, arc: Arc): number {
  return state.arcs[arc.id]?.stage ?? 0;
}

const mentions = (line: string, words: string[]) => words.some((w) => new RegExp(`\\b${w.toLowerCase()}`).test(line.toLowerCase()));

function met(req: NonNullable<Arc["stages"][number]["requires"]>, player: PlayerState, day: number, line: string | undefined): boolean {
  const facts = player.facts ?? [];
  if (req.told && !(line && facts.includes(req.told.fact) && mentions(line, req.told.words))) return false;
  if (req.fact && !facts.includes(req.fact)) return false;
  if (req.quest && !player.quests.completed.includes(req.quest)) return false;
  if (req.day && day < req.day) return false;
  return true;
}

/**
 * Move every arc on as far as its requirements are met (one stage per arc per
 * call: news lands one step at a time). Returns event lines for the model, which
 * the caller adds to the situation ("You just learned ...").
 */
export function advanceArcs(persona: NpcPersona, state: NpcState, world: Pick<WorldSnapshot, "day" | "player">, line?: string): string[] {
  const out: string[] = [];
  for (const arc of persona.arcs ?? []) {
    const at = arcStage(state, arc);
    const next = arc.stages[at + 1];
    if (!next?.requires || !met(next.requires, world.player, world.day, line)) continue;
    state.arcs[arc.id] = { stage: at + 1, day: world.day };
    const t = traitsOf(persona, state);
    remember(state, { id: `arc-${arc.id}-${next.id}`, day: world.day, text: next.line.replace(/^You /, "you "), importance: 7, valence: 0 }, t);
    addEmotion(state, "worry", 0.4, arc.name, world.day);
    if (next.journal) note(world.player, { id: `arc:${persona.id}:${arc.id}`, day: world.day, npc: persona.id, kind: "quest", text: next.journal });
    out.push(`Something just changed: ${next.line} React to it.`);
  }
  return out;
}

/** Quest and secret ids an arc keeps locked until its stage is reached. */
function locked(persona: NpcPersona, state: Pick<NpcState, "arcs">, kind: "quests" | "secrets"): Set<string> {
  const ids = new Set<string>();
  for (const arc of persona.arcs ?? []) {
    const at = arcStage(state, arc);
    arc.stages.forEach((s, i) => {
      if (i > at) for (const id of s.unlocks?.[kind] ?? []) ids.add(id);
    });
  }
  return ids;
}

export const lockedQuests = (persona: NpcPersona, state: Pick<NpcState, "arcs">) => locked(persona, state, "quests");
export const lockedSecrets = (persona: NpcPersona, state: Pick<NpcState, "arcs">) => locked(persona, state, "secrets");

/** The situation lines for each arc's current stage. */
export function describeArcs(persona: NpcPersona, state: Pick<NpcState, "arcs">): string[] {
  return (persona.arcs ?? []).map((arc) => arc.stages[arcStage(state, arc)]!.line);
}
