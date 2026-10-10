import type { WorldSnapshot } from "../npc/types.js";

/** Stand-in for the real game world. In Phase 2 your game engine produces this. */
export function createDemoWorld(): WorldSnapshot {
  return {
    timeOfDay: "afternoon",
    location: "Millbrook forge",
    nearby: ["anvil", "glowing forge", "rack of tools", "a stray dog"],
    recentEvents: ["Bandits attacked a merchant cart on the mine road this morning."],
    player: { name: "Traveler", gold: 50, inventory: { "bread loaf": 2 } },
  };
}
