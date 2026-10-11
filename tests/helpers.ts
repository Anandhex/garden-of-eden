import brenaJson from "../src/data/npcs/brena.json" with { type: "json" };
import haleJson from "../src/data/npcs/hale.json" with { type: "json" };
import pellJson from "../src/data/npcs/pell.json" with { type: "json" };
import rookJson from "../src/data/npcs/rook.json" with { type: "json" };
import type { Rng } from "../src/game/dice.js";
import type { ChatRequest, ChatResult, LLMProvider } from "../src/llm/provider.js";
import type { ActionContext } from "../src/npc/actions.js";
import { parsePersona } from "../src/npc/personaSchema.js";
import { createNpcState } from "../src/npc/state.js";
import type { NpcPersona, NpcState, WorldSnapshot } from "../src/npc/types.js";
import { createDemoWorld } from "../src/world/world.js";

/** Shared test helpers for the N4-N6 tests. */
export const brena = parsePersona(brenaJson);
export const hale = parsePersona(haleJson);
export const pell = parsePersona(pellJson);
export const rook = parsePersona(rookJson);

/** Returns scripted replies in order and records every request it receives. */
export class FakeProvider implements LLMProvider {
  readonly requests: ChatRequest[] = [];
  constructor(private readonly replies: ChatResult[] = []) {}
  async chat(req: ChatRequest, onText?: (delta: string) => void): Promise<ChatResult> {
    this.requests.push(structuredClone(req));
    const reply = this.replies.shift() ?? { text: "...", toolCalls: [] };
    if (reply.text) onText?.(reply.text);
    return reply;
  }
  /** The last user message the model saw. */
  lastUser(): string {
    const msgs = this.requests.at(-1)?.messages ?? [];
    return [...msgs].reverse().find((m) => m.role === "user")?.content ?? "";
  }
}

export const say = (text: string): ChatResult => ({ text, toolCalls: [] });
export const call = (name: string, args: Record<string, unknown> = {}): ChatResult => ({ text: "", toolCalls: [{ name, arguments: args }] });

/** A fixed die: always returns `n`. */
export const always = (n: number): Rng => () => n;

export function ctxFor(persona: NpcPersona, state: Partial<NpcState> = {}, world: WorldSnapshot = createDemoWorld(), rng: Rng = always(0.5)): ActionContext {
  return { persona, state: createNpcState(persona, state), world, rng };
}

/** The demo world at a given hour. */
export function worldAt(hour: number, day = 1): WorldSnapshot {
  const w = createDemoWorld();
  w.day = day;
  w.hour = hour;
  w.minute = 0;
  return w;
}
