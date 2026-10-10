import { describe, expect, it } from "vitest";
import brena from "../src/data/npcs/brena.json" with { type: "json" };
import { buildEventMessage, buildSystemPrompt, buildTurnMessage } from "../src/npc/persona.js";
import { createNpcState } from "../src/npc/state.js";
import type { NpcPersona, NpcState } from "../src/npc/types.js";
import { createDemoWorld } from "../src/world/world.js";

const persona = brena as NpcPersona;

describe("buildSystemPrompt", () => {
  it("names the character and their role", () => {
    const prompt = buildSystemPrompt(persona);
    expect(prompt).toContain(persona.name);
    expect(prompt).toContain(persona.role);
  });

  it("is identical every time (so Ollama can reuse the processed prompt)", () => {
    expect(buildSystemPrompt(persona)).toBe(buildSystemPrompt(structuredClone(persona)));
  });

  it("stays short enough for a small model", () => {
    const words = buildSystemPrompt(persona).split(/\s+/).length;
    expect(words).toBeLessThan(400);
  });

  it("includes the personality and speech style", () => {
    const prompt = buildSystemPrompt(persona);
    for (const trait of persona.personality) expect(prompt).toContain(trait);
    expect(prompt).toContain(persona.speechStyle);
  });

  it("tells the NPC that actions only happen through tool calls", () => {
    expect(buildSystemPrompt(persona)).toMatch(/only happen through tools/i);
  });

  it("tells the NPC not to write the situation block itself", () => {
    // Without this, qwen3:4b-instruct copied the block into every reply.
    expect(buildSystemPrompt(persona)).toMatch(/never write one yourself/i);
  });

  it("never contains secrets - those only reach the model through reveal_secret", () => {
    const prompt = buildSystemPrompt(persona);
    for (const secret of persona.secrets) {
      expect(prompt).not.toContain(secret.text);
      expect(prompt).not.toContain(secret.about);
    }
    expect(prompt).not.toMatch(/mayor|vault/i);
  });

  it("does not include changing state (mood, stock) - that goes in the turn message", () => {
    const prompt = buildSystemPrompt(persona);
    expect(prompt).not.toMatch(/Your mood:|Your stock:|gold each/);
  });
});

const state = (overrides: Partial<NpcState> = {}): NpcState =>
  createNpcState(persona, { inventory: { dagger: 2 }, ...overrides });

describe("buildTurnMessage", () => {
  it("wraps the situation in a block and ends with the player's line", () => {
    const msg = buildTurnMessage(persona, state(), createDemoWorld(), "Hello there.");
    expect(msg).toMatch(/^<situation>\n[\s\S]*\n<\/situation>\n\nTraveler says: "Hello there\."$/);
  });

  it("includes mood, stock with prices, and the player's gold and items", () => {
    const msg = buildTurnMessage(persona, state({ mood: "angry" }), createDemoWorld(), "What would you pay for this?");
    expect(msg).toContain("Your mood: angry.");
    expect(msg).toContain("dagger [E] x2 (15 gold each). Your purse: 35 gold.");
    expect(msg).toContain("Traveler has 50 gold and carries: bread loaf [G] x2, iron ore [F] x3, wild herbs [F] x2.");
  });

  it("includes time, place, and recent news", () => {
    const msg = buildTurnMessage(persona, state(), createDemoWorld(), "x");
    expect(msg).toContain("Time: Day 1, 14:00 (afternoon). Place: Millbrook forge.");
    expect(msg).toContain("Bandits attacked");
  });

  it("lists stock and the player's items only when they're talking trade (or for game events)", () => {
    const chat = buildTurnMessage(persona, state(), createDemoWorld(), "Is something troubling you?");
    expect(chat).toContain("Traveler has 50 gold.");
    expect(chat).not.toContain("iron ore");
    expect(chat).not.toContain("Your stock");
    expect(buildTurnMessage(persona, state(), createDemoWorld(), "Want to buy some ore?")).toContain("carries: bread loaf [G] x2, iron ore [F] x3");
    expect(buildEventMessage(persona, state(), createDemoWorld(), "A sale happened.", true)).toContain("carries:");
    expect(buildEventMessage(persona, state(), createDemoWorld(), "Something else happened.")).not.toContain("carries:");
  });

  it("on trade turns, says what the player can afford (worked out in code)", () => {
    const msg = buildTurnMessage(persona, createNpcState(persona), createDemoWorld(), "Can I afford a sword?");
    expect(msg).toContain("With 50 gold, they can afford: horseshoe [G], dagger [E], iron sword [D]. Too dear for them: iron sword [B].");
    expect(buildTurnMessage(persona, createNpcState(persona), createDemoWorld(), "Hello.")).not.toContain("can afford");
  });

  it("describes trust in words as well as numbers", () => {
    const at = (relationship: number) => buildTurnMessage(persona, state({ relationship }), createDemoWorld(), "x");
    expect(at(0)).toContain("a stranger to you (trust 0)");
    expect(at(-60)).toContain("you despise them");
    expect(at(80)).toContain("you trust them deeply");
  });

  it("says 'nothing' for empty inventories", () => {
    const world = createDemoWorld();
    world.player.inventory = {};
    const msg = buildTurnMessage(persona, state({ inventory: {} }), world, "Anything to trade?");
    expect(msg).toContain("Your stock: nothing.");
    expect(msg).toContain("carries: nothing.");
  });
});

describe("offers and events", () => {
  it("shows a pending offer in the situation", () => {
    const msg = buildTurnMessage(persona, state({ pendingOffer: { item: "dagger [E]", price: 15 } }), createDemoWorld(), "x");
    expect(msg).toContain("You offered Traveler a dagger [E] for 15 gold and are waiting for their answer.");
  });

  it("leaves the offer line out when there is none", () => {
    expect(buildTurnMessage(persona, state(), createDemoWorld(), "x")).not.toContain("You offered");
  });

  it("builds an event message with the situation and the event in parentheses", () => {
    const msg = buildEventMessage(persona, state(), createDemoWorld(), "Traveler accepted and paid 15 gold for the dagger [E].");
    expect(msg).toMatch(/^<situation>[\s\S]*<\/situation>\n\n\(Traveler accepted and paid 15 gold for the dagger \[E\]\.\)$/);
  });
});
