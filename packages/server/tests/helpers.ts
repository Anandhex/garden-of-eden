import brenaJson from "./fixtures/npcs/brena.json" with { type: "json" };
import haleJson from "./fixtures/npcs/hale.json" with { type: "json" };
import pellJson from "./fixtures/npcs/pell.json" with { type: "json" };
import pipJson from "./fixtures/npcs/pip.json" with { type: "json" };
import rookJson from "./fixtures/npcs/rook.json" with { type: "json" };
import wrenJson from "./fixtures/npcs/wren.json" with { type: "json" };
import spawnsJson from "./fixtures/spawns.json" with { type: "json" };
import { loadCreatureTemplates } from "../src/game/creatures.js";
import type { WorldStore } from "../src/game/db.js";
import type { Rng } from "../src/game/dice.js";
import { newWorld, type SavedWorld } from "../src/game/save.js";
import { parseSpawnRules } from "../src/game/spawning.js";
import { Town } from "../src/game/town.js";
import type { ChatRequest, ChatResult, LLMProvider } from "../src/llm/provider.js";
import type { ActionContext } from "../src/npc/actions.js";
import { parsePersona } from "../src/npc/personaSchema.js";
import { createNpcState } from "../src/npc/state.js";
import type { NpcPersona, NpcState, WorldSnapshot } from "../src/npc/types.js";
import { createTestWorld } from "../src/world/world.js";

/**
 * Shared test helpers. The game has no hand-written people (N25a); the six NPC files in tests/fixtures/npcs are
 * fixtures for the tests of one NPC's mechanics (the agent loop, tools, lies, secrets, trade, crafting, fights),
 * and tests/fixtures/world.json is the lore they know (installed for every test file by tests/setup.ts). Tests about the world (places, the realm, people, travel)
 * use generated worlds (`makeWorld`), and pick people by job, never by name.
 */

export const brena = parsePersona(brenaJson);
export const hale = parsePersona(haleJson);
export const pell = parsePersona(pellJson);
export const rook = parsePersona(rookJson);
export const wren = parsePersona(wrenJson);
export const pip = parsePersona(pipJson);

/** The fixture NPC files, by id. Everything that uses one is a test of that NPC's mechanics, not of the world. */
export const fixtureNpc = (id: "brena" | "hale" | "pell" | "rook" | "wren" | "pip"): NpcPersona => ({ brena, hale, pell, rook, wren, pip })[id];
/** Every fixture NPC file, by id. */
export const allPersonas = (): Record<string, NpcPersona> => ({ brena, hale, pell, rook, wren, pip });
/** The spawn rules the fixtures' quests refer to (the quarry of "hammer_rook" and "clear_mine_road"). */
export const fixtureSpawnRules = () => parseSpawnRules(spawnsJson, "tests/fixtures/spawns.json");

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

export function ctxFor(persona: NpcPersona, state: Partial<NpcState> = {}, world: WorldSnapshot = createTestWorld(), rng: Rng = always(0.5)): ActionContext {
  return { persona, state: createNpcState(persona, state), world, rng };
}

/** The bare test world at a given hour. */
export function worldAt(hour: number, day = 1): WorldSnapshot {
  const w = createTestWorld();
  w.day = day;
  w.hour = hour;
  w.minute = 0;
  return w;
}

/** The fixtures' tests were written for an afternoon (a new game begins at 08:00). */
function afternoon(world: SavedWorld): SavedWorld {
  const bare = createTestWorld();
  world.hour = bare.hour;
  world.timeOfDay = bare.timeOfDay;
  world.location = bare.location;
  world.nearby = bare.nearby;
  delete world.player.place;
  return world;
}

/**
 * A whole town of the six fixture NPCs, in the start town of a generated world, with a fake model (no Ollama).
 * Nothing else is generated for it (no notables, no opening): it is a test of those people's mechanics. The dice
 * are fixed (always 0.5) unless you pass `rng`; pass `rng: null` for the real thing, every system rolling from its
 * own stream of the world's seed (N18).
 */
export function makeTown({ llm = new FakeProvider(), backgroundLlm, rng = always(0.5), store, world, seed, generate = false }: { llm?: LLMProvider; backgroundLlm?: LLMProvider; rng?: Rng | null; store?: WorldStore; world?: SavedWorld; seed?: number; generate?: boolean } = {}): Town {
  const personas = allPersonas();
  const creatureTemplates = loadCreatureTemplates();
  const given = world ?? afternoon(newWorld(personas, creatureTemplates, rng ?? always(0.5), seed));
  return new Town({ personas, creatureTemplates, world: given, llm, generate, ...(backgroundLlm ? { backgroundLlm } : {}), ...(rng ? { rng } : {}), ...(store ? { store } : {}) });
}

/**
 * A town of generated people only: the start town of a generated world with its notables made, as a new game has
 * it. Pick its people by job (`talkerByJob`).
 */
export function makeWorldTown({ llm = new FakeProvider(), rng = always(0.5), store, seed = 1 }: { llm?: LLMProvider; rng?: Rng | null; store?: WorldStore; seed?: number } = {}): Town {
  const creatureTemplates = loadCreatureTemplates();
  return new Town({ personas: {}, creatureTemplates, world: newWorld({}, creatureTemplates, always(0.5), seed), llm, ...(rng ? { rng } : {}), ...(store ? { store } : {}) });
}

/** A generated person of the player's place, by what they do: "smith", "innkeeper", "guard", "head", "merchant"... */
export function talkerByJob(town: Town, job: string): NpcPersona | undefined {
  const site = town.site();
  const head = town.world.realm?.settlements[site]?.leader;
  const headId = head ? town.world.realm?.figures[head]?.talks : undefined;
  if (job === "head") return headId ? town.personas[headId] : undefined;
  const words = new RegExp(`\\b${job}\\b`, "i");
  return town.talkersAt(site).map((id) => town.personas[id]!).find((p) => p.template === job || words.test(p.role));
}
