import { afterEach, describe, expect, it } from "vitest";
import brenaJson from "../src/data/npcs/brena.json" with { type: "json" };
import pellJson from "../src/data/npcs/pell.json" with { type: "json" };
import { config } from "../src/config.js";
import { restPlayer, isTooHurtToWork } from "../src/game/healing.js";
import { passMinutes } from "../src/game/simulation.js";
import { quoteTraining } from "../src/game/training.js";
import type { ChatMessage, ChatRequest, ChatResult, LLMProvider } from "../src/llm/provider.js";
import { estimateRequest } from "../src/llm/tokens.js";
import { applyAction, type ActionContext, isProvoked, npcFightTurn, parseAction, toolsFor } from "../src/npc/actions.js";
import { NpcAgent } from "../src/npc/NpcAgent.js";
import { buildSystemPrompt, buildTurnMessage } from "../src/npc/persona.js";
import { createNpcState, startEncounter } from "../src/npc/state.js";
import type { NpcPersona } from "../src/npc/types.js";
import { createDemoWorld } from "../src/world/world.js";
import { face, rolls } from "./dice.test.js";
import { parsePersona } from "../src/npc/personaSchema.js";

const brena = parsePersona(brenaJson);
const pell = parsePersona(pellJson);

/** Always says one line, never calls a tool. */
class QuietProvider implements LLMProvider {
  async chat(_req: ChatRequest, onText?: (delta: string) => void): Promise<ChatResult> {
    onText?.("Not now.");
    return { text: "Not now.", toolCalls: [] };
  }
}

const ctxFor = (persona: NpcPersona, world = createDemoWorld(), state = createNpcState(persona)): ActionContext => ({
  persona,
  state,
  world,
  rng: rolls(0.5),
  tradeTalk: true,
  trainingTalk: true,
});
const toolNames = (c: ActionContext) => toolsFor(c).map((t) => t.name);

describe("N0 healing and rest", () => {
  it("regenerates HP and MP every hour from endurance and willpower, faster asleep", () => {
    const world = createDemoWorld(); // 14:00
    const npc = new NpcAgent(brena, new QuietProvider());
    npc.state.hp = 20;
    npc.state.mp = 0;
    npc.wait(world, 1); // awake: HP 2 + END(15) +2 = 4, MP 1 + WIL(14) +2 = 3
    expect([npc.state.hp, npc.state.mp]).toEqual([24, 3]);
    world.hour = 20;
    npc.wait(world, 1); // 21:00 is asleep: HP 5 + 2 = 7, MP 3 + 2 = 5
    expect([npc.state.hp, npc.state.mp]).toEqual([31, 8]);
  });

  it("after a fight, /wait 8 brings both sides back up, and the NPC trades again", () => {
    const world = createDemoWorld(); // 14:00
    const npc = new NpcAgent(brena, new QuietProvider(), () => 0.99);
    npc.state.hp = 26; // Brena after a fight: 26/90, too hurt to trade
    world.player.hp = 10;
    expect(isTooHurtToWork(brena, npc.state)).toBe(true);

    const start = world.hour;
    npc.wait(world, 8);
    restPlayer(world.player, start, 8);
    // 15-20 awake (6 x 4) + 21-22 asleep (2 x 7) = 38 for Brena; 6 x 2 + 2 x 5 = 22 for the player.
    expect(npc.state.hp).toBe(64);
    expect(world.player.hp).toBe(32);
    expect(isTooHurtToWork(brena, npc.state)).toBe(false);
    expect(toolNames(ctxFor(brena, world, npc.state))).toContain("offer_item");
  });

  it("never heals the dead, or anyone mid-fight", () => {
    const world = createDemoWorld();
    const dead = createNpcState(brena, { hp: 0, outcome: "dead" });
    const fighting = createNpcState(brena, { hp: 30, inCombat: true });
    passMinutes(brena, dead, world, 120, () => 0.99);
    passMinutes(brena, fighting, createDemoWorld(), 120, () => 0.99, { talking: true });
    expect(dead.hp).toBe(0);
    expect(fighting.hp).toBe(30);
  });

  it("the player's healing items heal the right amount and are used up", () => {
    const world = createDemoWorld();
    const npc = new NpcAgent(brena, new QuietProvider());
    world.player.hp = 20;
    world.player.inventory["healing salve [E]"] = 1;

    const herbs = npc.useItem(world, "wild herbs");
    expect(herbs.use).toMatchObject({ ok: true, healed: 5 });
    expect(world.player.hp).toBe(25);
    expect(world.player.inventory["wild herbs [F]"]).toBe(1);

    const salve = npc.useItem(world, "healing salve");
    expect(salve.use).toMatchObject({ ok: true, healed: 15 }); // 20, capped at max HP 40
    expect(world.player.hp).toBe(40);
    expect(world.player.inventory["healing salve [E]"]).toBeUndefined();

    expect(npc.useItem(world, "wild herbs").use.ok).toBe(false); // already at full health
    expect(world.player.inventory["wild herbs [F]"]).toBe(1); // and nothing used up
    expect(npc.useItem(world, "dagger").use.ok).toBe(false);
  });

  it("using an item mid-fight costs the player their turn: the NPC strikes", () => {
    const world = createDemoWorld();
    const npc = new NpcAgent(brena, new QuietProvider(), rolls(face(15, 20), face(4, 8)));
    npc.state.inCombat = true;
    world.player.hp = 30;
    const r = npc.useItem(world, "wild herbs");
    expect(r.use.healed).toBe(5);
    expect(r.actions.map((a) => a.name)).toEqual(["attack_player"]);
    expect(world.player.hp).toBe(35 - (4 + 3 + 2 + 4)); // d8 4 + STR 3 + hammer [C] 2 + heavy blow 4 (aggressive Brena spends MP: N8)
  });

  it("hurt NPCs use their own healing items: on the hour, and instead of attacking in a fight", () => {
    const world = createDemoWorld();
    // Only his everyday salves (his strong one is hidden stock, N6.1).
    const state = createNpcState(pell, { hp: 10, inventory: { "healing salve [E]": 2 } });
    passMinutes(pell, state, world, 60, () => 0.99);
    expect(state.hp).toBe(31); // +1 regen (END 9), +20 salve
    expect(state.inventory["healing salve [E]"]).toBe(1);

    const fight = ctxFor(pell, createDemoWorld(), createNpcState(pell, { hp: 15, inCombat: true, inventory: { "healing salve [E]": 2 } }));
    const turn = npcFightTurn(fight);
    expect(turn.name).toBe("use_item");
    expect(fight.state.hp).toBe(35);
    expect(fight.world.player.hp).toBe(40); // no attack this turn
    expect(npcFightTurn(fight).name).toBe("ability"); // above half now: back to fighting, the coward's way (a dirty trick, N8)
  });

  it("an NPC below half HP won't trade or train until healed, and is told so", () => {
    const world = createDemoWorld();
    const c = ctxFor(brena, world, createNpcState(brena, { hp: 44 })); // 44/90
    expect(toolNames(c)).not.toContain("offer_item");
    expect(toolNames(c)).not.toContain("offer_to_buy");
    expect(toolNames(c)).not.toContain("offer_training");
    const offer = parseAction("offer_item", { item: "dagger [E]", price: "1 gold 5 silver" });
    if (!offer.ok) throw new Error(offer.error);
    expect(applyAction(offer, c)).toMatchObject({ ok: false, message: expect.stringContaining("no state") });
    expect(quoteTraining(brena, c.state, world, "smithing", 2)).toMatchObject({ ok: false });
    expect(buildTurnMessage(brena, c.state, world, "Hello")).toContain("in no state to trade or teach");

    c.state.hp = 45; // exactly half: fine
    expect(toolNames(c)).toContain("offer_item");
    expect(buildTurnMessage(brena, c.state, world, "Hello")).not.toContain("in no state");
  });
});

describe("N0 social check limits", () => {
  it("each failure raises the next target by 2; after 3 the NPC refuses until the next day", async () => {
    const world = createDemoWorld();
    const npc = new NpcAgent(brena, new QuietProvider(), () => face(2, 20));
    // Brena resists persuasion at 10 + WIL(14) +2 + speechcraft 1 = 13.
    const targets: number[] = [];
    for (let i = 0; i < 3; i++) {
      const r = await npc.attempt("persuade", "Please agree.", world);
      expect(r.check).toMatchObject({ ok: true, success: false });
      targets.push(Number(r.check.message.match(/vs (\d+)/)![1]));
    }
    expect(targets).toEqual([13, 15, 17]);
    const blocked = await npc.attempt("persuade", "Please agree.", world);
    expect(blocked.check.ok).toBe(false);
    expect(blocked.check.message).toMatch(/tomorrow/);

    // Intimidation is counted separately.
    expect((await npc.attempt("intimidate", "Or else.", world)).check.ok).toBe(true);

    world.day += 1;
    const nextDay = await npc.attempt("persuade", "Please agree.", world);
    expect(nextDay.check.ok).toBe(true);
    expect(nextDay.check.message).toContain("vs 13");
  });

  it("a failed intimidation counts as a provocation, towards an attack", async () => {
    const world = createDemoWorld();
    const npc = new NpcAgent(brena, new QuietProvider(), () => face(2, 20));
    for (let i = 0; i < 3; i++) await npc.attempt("intimidate", "Hand it over.", world);
    expect(npc.state.provocations).toBe(3); // Brena's limit
    expect(isProvoked(brena, npc.state)).toBe(true);
  });
});

/** A model that alternates a mood tool call and a line, reporting a prompt size like Ollama does. */
class ChattyProvider implements LLMProvider {
  readonly requests: ChatRequest[] = [];
  private turn = 0;
  constructor(private readonly reportTokens: (req: ChatRequest) => number) {}
  async chat(req: ChatRequest, onText?: (delta: string) => void): Promise<ChatResult> {
    this.requests.push(structuredClone(req));
    const stats = { inputTokens: this.reportTokens(req), outputTokens: 20, durationMs: 1 };
    const last = req.messages.at(-1)!;
    if (last.role === "user" && this.turn++ % 2 === 0) {
      return { text: "", toolCalls: [{ name: "change_mood", arguments: { mood: "neutral" } }], stats };
    }
    const text = "Aye, the forge keeps me busy from dawn till dusk, stranger. Iron doesn't shape itself.";
    onText?.(text);
    return { text, toolCalls: [], stats };
  }
}

/** Every tool result follows the assistant message that called it, and the history starts with a player line. */
function wellFormed(messages: ChatMessage[]): boolean {
  if (messages[0]?.role !== "user") return false;
  return messages.every((m, i) => {
    if (m.role !== "tool") return true;
    let j = i - 1;
    while (j >= 0 && messages[j]!.role === "tool") j--;
    const caller = messages[j];
    return caller?.role === "assistant" && (caller.toolCalls ?? []).some((c) => c.name === m.toolName);
  });
}

describe("N0 context window", () => {
  it("a 60-turn conversation stays under budget, keeps the system prompt, and orphans no tool results", async () => {
    const llm = new ChattyProvider((req) => estimateRequest(req.system, req.messages, req.tools));
    const npc = new NpcAgent(brena, llm);
    const world = createDemoWorld();
    for (let i = 1; i <= 60; i++) await npc.respond(`Tell me about your work, line ${i}.`, world);

    const system = buildSystemPrompt(brena);
    for (const req of llm.requests) {
      expect(estimateRequest(req.system, req.messages, req.tools)).toBeLessThanOrEqual(config.contextTokenBudget);
      expect(req.system).toBe(system);
      expect(wellFormed(req.messages)).toBe(true);
    }
    const last = llm.requests.at(-1)!;
    expect(last.messages.some((m) => m.role === "user" && m.content.includes("line 60."))).toBe(true);
    expect(last.messages.some((m) => m.content.includes("line 1."))).toBe(false); // the oldest went
    expect(llm.requests.length).toBeGreaterThan(60); // tool rounds really happened
  });

  it("trusts prompt_eval_count when it's higher than the estimate, and never lets a low one hide growth", async () => {
    const run = async (report: (req: ChatRequest) => number) => {
      const llm = new ChattyProvider(report);
      const npc = new NpcAgent(brena, llm);
      const world = createDemoWorld();
      for (let i = 1; i <= 30; i++) await npc.respond(`Tell me about your work, line ${i}.`, world);
      return npc.messages.length;
    };
    const estimate = (req: ChatRequest) => estimateRequest(req.system, req.messages, req.tools);
    const honest = await run(estimate);
    const bigger = await run((req) => Math.round(estimate(req) * 1.3)); // the real tokenizer counts more
    const cached = await run(() => 50); // e.g. only uncached tokens reported
    expect(bigger).toBeLessThan(honest);
    expect(cached).toBe(honest);
  });
});

describe("N0 finer clock", () => {
  it("30 conversation turns move the clock about an hour", async () => {
    const world = createDemoWorld(); // 14:00
    const npc = new NpcAgent(brena, new QuietProvider());
    for (let i = 0; i < 30; i++) await npc.respond("Hm.", world);
    expect([world.hour, world.minute]).toEqual([15, 0]);
  });

  it("a trade takes ~5 minutes and a fight round ~1", async () => {
    const world = createDemoWorld();
    const npc = new NpcAgent(brena, new QuietProvider(), () => face(2, 20)); // everyone misses
    npc.state.pendingOffer = { item: "dagger [E]", price: 150 };
    await npc.acceptOffer(world);
    expect(world.minute).toBe(5);
    await npc.attackedByPlayer(world);
    expect(world.minute).toBe(6);
    await npc.respond("Take that!", world); // still fighting
    expect(world.minute).toBe(7);
  });

  it("a job that ends at 16:00 frees the NPC at 16:00, not before", async () => {
    const world = createDemoWorld();
    world.hour = 15;
    world.minute = 58;
    const npc = new NpcAgent(brena, new QuietProvider());
    npc.state.job = { recipeId: "dagger", output: "dagger [E]", qty: 1, until: 16 * 60, doing: "forging a dagger" };
    expect((await npc.respond("Hello?", world)).busy).toBe("forging a dagger until 16:00");
    expect(world.minute).toBe(58); // no time spent talking to someone who's busy

    const log = passMinutes(brena, npc.state, world, 2, () => 0.99);
    expect([world.hour, world.minute]).toEqual([16, 0]);
    expect(log[0]).toMatch(/finished/);
    expect(npc.state.inventory["dagger [E]"]).toBe(4);
    expect(npc.busyWith(world)).toBeNull();
  });

  it("a job that ends mid-hour finishes at that minute", () => {
    const world = createDemoWorld(); // 14:00
    const state = createNpcState(brena, {
      job: { recipeId: "dagger", output: "dagger [E]", qty: 1, until: 14 * 60 + 30, doing: "forging a dagger" },
    });
    passMinutes(brena, state, world, 29, () => 0.99);
    expect(state.job).not.toBeNull();
    passMinutes(brena, state, world, 1, () => 0.99);
    expect(state.job).toBeNull();
    expect([world.hour, world.minute]).toEqual([14, 30]);
  });

  it("an NPC doesn't start new work while the player is talking to them", async () => {
    const world = createDemoWorld();
    const npc = new NpcAgent(brena, new QuietProvider(), () => 0.01); // would always start crafting
    npc.state.inventory["iron ore [F]"] = 8;
    for (let i = 0; i < 31; i++) await npc.respond("Hm.", world); // crosses 15:00
    expect(npc.state.job).toBeNull();
    npc.wait(world, 1); // left alone, she gets to work
    expect(npc.state.job).not.toBeNull();
  });
});

describe("N0 losing a fight", () => {
  const defaultRule = config.playerDefeat;
  afterEach(() => {
    config.playerDefeat = defaultRule;
  });

  it("knockout (default): the NPC takes some gold, time passes, the player wakes with 25% HP, and the NPC remembers", async () => {
    expect(defaultRule).toBe("knockout");
    const world = createDemoWorld(); // 14:00, 5 gold, 40 HP
    world.player.hp = 1;
    const npc = new NpcAgent(brena, new QuietProvider(), () => 0.99); // natural 20s
    npc.state.inCombat = true;
    npc.state.hp = 50;
    const r = await npc.respond("I can still fight!", world);

    expect(r.defeat).toMatchObject({ rule: "knockout", moneyTaken: 125, hoursOut: 8 });
    expect(world.player.money).toBe(375);
    expect(npc.state.money).toBe(350 + 125);
    expect(world.player.hp).toBe(10);
    expect(world.hour).toBe(22); // 8 hours out cold
    expect(npc.state.hp).toBeGreaterThan(50); // she healed meanwhile
    expect(npc.state).toMatchObject({ outcome: "knocked out", conversationOver: true, inCombat: false });
    expect(npc.state.memories).toEqual([{ id: "beat-player-day-1", day: 1, text: "You beat Traveler in a fight on day 1 and took 1 gold 2 silver 5 copper off them." }]);

    // Next time they meet, it's a new encounter, and she remembers.
    startEncounter(npc.state);
    expect(npc.state).toMatchObject({ outcome: null, conversationOver: false });
    expect(buildTurnMessage(brena, npc.state, world, "Hello again")).toContain("You remember: You beat Traveler");
  });

  it("permadeath (config option): the player dies and the save records it", async () => {
    config.playerDefeat = "permadeath";
    const world = createDemoWorld();
    world.player.hp = 1;
    const npc = new NpcAgent(brena, new QuietProvider(), () => 0.99);
    npc.state.inCombat = true;
    const r = await npc.respond("I can still fight!", world);
    expect(r.defeat).toMatchObject({ rule: "permadeath", moneyTaken: 0 });
    expect(world.player.hp).toBe(0);
    expect(world.player.death).toEqual({ day: 1, hour: 14, killedBy: "Brena Ashford" });
    expect(npc.state.outcome).toBe("killed player");
  });

  it("a failed escape can also knock the player out", async () => {
    const world = createDemoWorld();
    world.player.hp = 1;
    // Escape roll 2 fails; Brena hits with natural 20s after that.
    const seq = [face(2, 20)];
    const npc = new NpcAgent(brena, new QuietProvider(), () => seq.shift() ?? 0.99);
    npc.state.inCombat = true;
    const r = await npc.playerFlees(world);
    expect(r.flee.escaped).toBe(false);
    expect(r.defeat?.rule).toBe("knockout");
    expect(npc.state.outcome).toBe("knocked out");
  });

  it("starting a new encounter clears fled and knocked-out endings, but never death", () => {
    for (const outcome of ["fled", "player fled", "knocked out"] as const) {
      const s = createNpcState(brena, { outcome, conversationOver: true, inCombat: true, provocations: 3 });
      startEncounter(s);
      expect(s).toMatchObject({ outcome: null, conversationOver: false, inCombat: false, provocations: 0 });
    }
    const dead = createNpcState(brena, { outcome: "dead", conversationOver: true });
    startEncounter(dead);
    expect(dead.outcome).toBe("dead");
  });
});

describe("model failures", () => {
  it("retries a failed call, then says a fallback line without changing state", async () => {
    let calls = 0;
    const failing: LLMProvider = {
      async chat(): Promise<ChatResult> {
        calls++;
        throw new Error("offline");
      },
    };
    const npc = new NpcAgent(brena, failing);
    const before = structuredClone(npc.state);
    const result = await npc.respond("Hello", createDemoWorld());
    expect(calls).toBe(2);
    expect(result.actions).toEqual([]);
    expect(npc.state).toEqual(before);
    expect(result.text).toContain("moment");
  });

  it("a retry after a clean failure isn't noticed", async () => {
    let calls = 0;
    const flaky: LLMProvider = {
      async chat(_req, onText): Promise<ChatResult> {
        if (calls++ === 0) throw new Error("timeout");
        onText?.("Welcome.");
        return { text: "Welcome.", toolCalls: [] };
      },
    };
    const r = await new NpcAgent(brena, flaky).respond("Hello", createDemoWorld());
    expect(r.text).toBe("Welcome.");
  });

  it("doesn't retry once words have reached the player, so nothing is said twice", async () => {
    let calls = 0;
    const dropped: LLMProvider = {
      async chat(_req, onText): Promise<ChatResult> {
        calls++;
        onText?.("Well, ");
        throw new Error("connection reset");
      },
    };
    let shown = "";
    const r = await new NpcAgent(brena, dropped).respond("Hello", createDemoWorld(), (d) => (shown += d));
    expect(calls).toBe(1);
    expect(shown).toBe("Well,  I need a moment before I can answer that.");
    expect(r.text).toBe(shown);
  });
});
