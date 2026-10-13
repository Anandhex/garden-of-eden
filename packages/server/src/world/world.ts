import type { PlayerState, WorldSnapshot } from "../npc/types.js";

/**
 * What a new player starts with: coin, a little food and ore, middling stats. Nothing here names a place or a person.
 * (The world is generated from a seed: game/save.ts `newWorld`.)
 */
export function startKit(): PlayerState {
  return {
    name: "Traveler",
    money: 500, // 5 gold
    inventory: { "bread loaf [G]": 2, "iron ore [F]": 3, "wild herbs [F]": 2 },
    hp: 40,
    maxHp: 40,
    mp: 10,
    maxMp: 10,
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
    titles: [],
    fightsWon: 0,
    equipment: {},
    journal: [],
  };
}

/**
 * A bare world for tests and tools that need only a clock, a scene and a player: afternoon on day 1, at a forge,
 * with no place, no realm and no people. Real games begin in a generated one (`newWorld`).
 */
export function createTestWorld(): WorldSnapshot {
  return {
    day: 1,
    hour: 14,
    minute: 0,
    timeOfDay: "afternoon",
    location: "the forge",
    nearby: ["anvil", "glowing forge", "rack of tools", "a stray dog"],
    recentEvents: [],
    player: startKit(),
  };
}
