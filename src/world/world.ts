import type { WorldSnapshot } from "../npc/types.js";

/** Stand-in for the real game world. In Phase 2 your game engine produces this. */
export function createDemoWorld(): WorldSnapshot {
  return {
    day: 1,
    hour: 14,
    timeOfDay: "afternoon",
    location: "Millbrook forge",
    nearby: ["anvil", "glowing forge", "rack of tools", "a stray dog"],
    recentEvents: ["Bandits attacked a merchant cart on the mine road this morning."],
    player: {
      name: "Traveler",
      gold: 50,
      inventory: { "bread loaf [G]": 2, "iron ore [F]": 3, "wild herbs [F]": 2 },
      hp: 40,
      maxHp: 40,
      attributes: {
        strength: 12,
        agility: 13,
        endurance: 11,
        intelligence: 12,
        willpower: 11,
        charisma: 13,
        perception: 11,
        luck: 10,
      },
      skills: { one_handed: 2, speechcraft: 2, evasion: 2, intimidation: 1, foraging: 1, sneak: 1 },
      skillProgress: {},
      level: 1,
      xp: 0,
      quests: { active: [], completed: [] },
    },
  };
}
