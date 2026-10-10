import { describe, expect, it } from "vitest";
import { applyAction } from "../src/npc/actions.js";
import type { NpcState } from "../src/npc/types.js";
import { createDemoWorld } from "../src/world/world.js";

const freshState = (): NpcState => ({
  mood: "neutral",
  relationship: 0,
  inventory: { dagger: 1 },
  following: false,
  conversationOver: false,
});

describe("NPC actions", () => {
  it("changes mood", () => {
    const state = freshState();
    const result = applyAction({ ok: true, name: "change_mood", args: { mood: "angry" } }, state, createDemoWorld());
    expect(result.ok).toBe(true);
    expect(state.mood).toBe("angry");
  });

  // TODO(Step 7): turn these into real tests as you implement them.
  it.todo("parseAction rejects unknown tool names");
  it.todo("parseAction rejects bad arguments (e.g. mood: 'ecstatic')");
  it.todo("sell_item fails if the NPC doesn't have the item");
  it.todo("sell_item fails if the player can't afford it");
  it.todo("sell_item fails if the price is below the persona's price");
  it.todo("sell_item moves the item to the player and the gold to nobody (or the NPC)");
});
