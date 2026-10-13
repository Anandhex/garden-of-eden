import { streamFor } from "../../game/dice.js";
import { parsePersona } from "../personaSchema.js";
import type { NpcPersona, NpcState } from "../types.js";
import { factsFor, type FactsCtx, type FactsSheet } from "./facts.js";
import { fallbackDepth, type Depth } from "./fallback.js";

export { factsFor, type FactsCtx, type FactsSheet } from "./facts.js";
export { fallbackDepth, type Depth } from "./fallback.js";

/** The groups of fields depth fills, in the order they are dropped when a persona fails its schema. */
const GROUPS = ["dilemmas", "arcs", "quirks", "secrets", "reputationFacts", "fears", "loves"] as const;

/** Put a depth on a persona: a new persona, checked by the schema. A group that fails it is left out; the rest stay. */
export function applyDepth(persona: NpcPersona, depth: Depth): NpcPersona {
  const base: NpcPersona = { ...persona };
  const merged = (a: unknown[] | undefined, b: unknown[]) => [...(a ?? []), ...b];
  const build = (skip: ReadonlySet<string>): NpcPersona => {
    const p: NpcPersona = { ...base };
    if (!skip.has("quirks") && depth.quirks.length > 0) p.quirks = merged(p.quirks, depth.quirks) as NpcPersona["quirks"];
    if (!skip.has("fears") && depth.fears.length > 0) p.fears = merged(p.fears, depth.fears) as NpcPersona["fears"];
    if (!skip.has("loves") && depth.loves.length > 0) p.loves = merged(p.loves, depth.loves) as NpcPersona["loves"];
    if (!skip.has("secrets") && depth.secrets.length > 0) {
      p.secrets = [...p.secrets, ...depth.secrets];
      if (depth.debts.length > 0) p.debts = merged(p.debts, depth.debts) as NpcPersona["debts"];
    }
    if (!skip.has("dilemmas") && depth.dilemmas.length > 0) p.dilemmas = merged(p.dilemmas, depth.dilemmas) as NpcPersona["dilemmas"];
    if (!skip.has("arcs") && depth.arcs.length > 0) p.arcs = merged(p.arcs, depth.arcs) as NpcPersona["arcs"];
    if (!skip.has("reputationFacts") && depth.reputationFacts.length > 0) p.reputationFacts = merged(p.reputationFacts, depth.reputationFacts) as NpcPersona["reputationFacts"];
    if (depth.goals && depth.goals.length > 0) p.goals = depth.goals.slice(0, 3);
    if (Object.keys(depth.relationships).length > 0) p.relationships = { ...p.relationships, ...depth.relationships };
    if (depth.signature && !p.signature) p.signature = depth.signature;
    if (depth.hire && !p.hire) p.hire = depth.hire;
    if (depth.backstory) p.backstory = depth.backstory;
    if (depth.personality) p.personality = depth.personality;
    if (depth.speechStyle) p.speechStyle = depth.speechStyle;
    if (depth.appearance) p.appearance = depth.appearance;
    return p;
  };
  const skip = new Set<string>();
  for (let i = 0; i <= GROUPS.length; i++) {
    try {
      return parsePersona(JSON.parse(JSON.stringify(build(skip))), `depth ${persona.id}`);
    } catch {
      if (i < GROUPS.length) skip.add(GROUPS[i]!);
    }
  }
  return persona;
}

/**
 * A talker's depth, from code alone (the code fallback, now): the facts sheet and the pools, drawn from the
 * person's own stream of the world's seed, so the same person is the same in every run. Returns the sheet too:
 * the model's call is built from it and its reply is checked against it.
 */
export function deepen(ctx: FactsCtx, persona: NpcPersona, seed: number): { persona: NpcPersona; sheet: FactsSheet; depth: Depth } {
  const sheet = factsFor(ctx, persona);
  const depth = fallbackDepth(sheet, persona, ctx.day, streamFor(seed, "depth", persona.id));
  return { persona: applyDepth(persona, depth), sheet, depth };
}


/**
 * The model's accepted fields over a persona who already has code's (N25a step 5e). A group the player has already
 * played with (a secret told, a dilemma settled, an arc moved) stays as it is, so nothing they know changes under them.
 */
export function applyStory(persona: NpcPersona, depth: Depth, accepted: readonly string[], state: Pick<NpcState, "revealedSecrets" | "dilemmasDone" | "arcs">): NpcPersona {
  const p: NpcPersona = { ...persona };
  const has = (f: string) => accepted.includes(f);
  if (has("backstory") && depth.backstory) p.backstory = depth.backstory;
  if (has("personality") && depth.personality) p.personality = depth.personality;
  if (has("speechStyle") && depth.speechStyle) p.speechStyle = depth.speechStyle;
  if (has("appearance") && depth.appearance) p.appearance = depth.appearance;
  if (has("goals") && depth.goals) p.goals = depth.goals.slice(0, 3);
  if (has("quirks")) p.quirks = depth.quirks;
  if (has("fears")) p.fears = depth.fears;
  if (has("loves")) p.loves = depth.loves;
  if (has("reputationFacts")) p.reputationFacts = depth.reputationFacts;
  if (has("secrets") && state.revealedSecrets.length === 0) {
    p.secrets = depth.secrets;
    p.debts = depth.debts.length > 0 ? depth.debts : undefined;
    if (!p.debts) delete p.debts;
  }
  if (has("dilemmas") && Object.keys(state.dilemmasDone).length === 0) p.dilemmas = depth.dilemmas;
  if (has("arcs") && Object.keys(state.arcs).length === 0) p.arcs = depth.arcs;
  try {
    return parsePersona(JSON.parse(JSON.stringify(p)), `story ${persona.id}`);
  } catch {
    return persona;
  }
}
