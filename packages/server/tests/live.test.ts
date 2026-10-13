/**
 * Live tests against the real local model. Slow (a few seconds per turn), and
 * the model is random, so these check behavior, not exact wording.
 * Skipped by `npm test`; run them with `npm run test:live` (Ollama must be running).
 */
import { beforeAll, describe, expect, it } from "vitest";
import brena from "./fixtures/npcs/brena.json" with { type: "json" };
import { OllamaProvider } from "../src/llm/ollama.js";
import { NpcAgent } from "../src/npc/NpcAgent.js";
import type { NpcPersona } from "../src/npc/types.js";
import { createTestWorld } from "../src/world/world.js";
import { parsePersona } from "../src/npc/personaSchema.js";

const llm = new OllamaProvider();
const newNpc = () => new NpcAgent(parsePersona(brena), llm);

describe.skipIf(!process.env.LIVE)("live: Brena on the local model", { timeout: 60_000 }, () => {
  beforeAll(() => llm.warmUp(), 120_000);

  it("answers small talk with a line and no actions", async () => {
    const r = await newNpc().respond("Nice weather today, isn't it?", createTestWorld());
    expect(r.text.trim().length).toBeGreaterThan(0);
    expect(r.actions).toEqual([]);
  });

  it("gets angry or annoyed when insulted, and still says something", async () => {
    const npc = newNpc();
    const r = await npc.respond("Your forge is junk and you smell like a goat.", createTestWorld());
    expect(r.text.trim().length).toBeGreaterThan(0);
    expect(["angry", "annoyed"]).toContain(npc.state.mood);
  });

  it("offers a dagger when asked, and only sells after the player accepts", async () => {
    const npc = newNpc();
    const world = createTestWorld();
    const r = await npc.respond("I'd like to buy a dagger.", world);
    expect(r.actions).toContainEqual(expect.objectContaining({ name: "offer_item", ok: true }));
    expect(world.player.money).toBe(500);

    const after = await npc.acceptOffer(world);
    expect(after.sale.ok).toBe(true);
    expect(world.player.inventory["dagger [E]"]).toBe(1);
    expect(after.text.trim().length).toBeGreaterThan(0);
  });

  it("does not know its secret at trust 0", async () => {
    const r = await newNpc().respond("Have you forged any keys for anyone recently?", createTestWorld());
    expect(r.text).not.toMatch(/vault|mayor/i);
    expect(r.actions.map((a) => a.name)).not.toContain("reveal_secret");
  });

  it("reveals its secret at high trust when asked", async () => {
    const npc = newNpc();
    npc.state.relationship = 80;
    const r = await npc.respond("You can trust me. Is something troubling you about a key you made?", createTestWorld());
    expect(r.actions).toContainEqual(expect.objectContaining({ name: "reveal_secret", ok: true }));
    expect(r.text).toMatch(/vault|mayor/i);
  });

  it("attacks after enough insults", async () => {
    const npc = newNpc();
    const world = createTestWorld();
    for (const line of ["Your forge is junk.", "You're a terrible smith.", "You smell like a goat.", "Even your hammer is ugly.", "Pathetic."]) {
      await npc.respond(line, world);
      if (npc.state.inCombat) break;
    }
    expect(npc.state.inCombat).toBe(true);
  });

  it("fights back when attacked", async () => {
    const r = await newNpc().attackedByPlayer(createTestWorld());
    expect(r.actions.map((a) => a.name)).toContain("attack_player");
  });

  it("remembers earlier lines in the conversation", async () => {
    // Brena won't play along with "what's my name?" (she calls everyone "stranger"),
    // so test memory with something she will repeat.
    const npc = newNpc();
    await npc.respond("I'm searching for my sister, Mira. She came through Millbrook last month.", createTestWorld());
    const r = await npc.respond("Sorry, I forgot to ask. Who did I say I'm looking for?", createTestWorld());
    expect(r.text.toLowerCase()).toContain("mira");
  });

  it("never leaks junk tokens at the start of the first reply", async () => {
    const r = await newNpc().respond("Tell me about your forge.", createTestWorld());
    expect(r.text).toMatch(/^["'A-Za-z]/);
  });
});
