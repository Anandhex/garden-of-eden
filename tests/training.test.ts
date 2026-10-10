import { describe, expect, it } from "vitest";
import brena from "../src/data/npcs/brena.json" with { type: "json" };
import { advanceTime, formatTime, timeOfDayAt } from "../src/game/clock.js";
import pellJson from "../src/data/npcs/pell.json" with { type: "json" };
import {
  describeTeaching,
  feePerHour,
  isTrainingTalk,
  hoursToNextLevel,
  MAX_SESSION_HOURS,
  parseSkill,
  quoteTraining,
  teachableSkills,
  train,
  trainerSkill,
  trustCap,
} from "../src/game/training.js";
import { createNpcState } from "../src/npc/state.js";
import type { NpcPersona, NpcState } from "../src/npc/types.js";
import { createDemoWorld } from "../src/world/world.js";

const persona = brena as NpcPersona; // smithing 5, foraging 1, blunt 4, ... greed 0
const pell = pellJson as NpcPersona; // haggling 5, speechcraft 4, ... greed 0.9
const setup = (state: Partial<NpcState> = {}) => ({ state: createNpcState(persona, state), world: createDemoWorld() });

describe("clock", () => {
  it("maps hours to times of day", () => {
    expect([4, 5, 11, 12, 16, 17, 20, 21, 0].map(timeOfDayAt)).toEqual([
      "night", "morning", "morning", "afternoon", "afternoon", "evening", "evening", "night", "night",
    ]);
  });

  it("advances the clock across days and keeps timeOfDay in sync", () => {
    const world = createDemoWorld(); // Day 1, 14:00
    advanceTime(world, 12);
    expect(formatTime(world)).toBe("Day 2, 02:00 (night)");
    advanceTime(world, 7);
    expect(formatTime(world)).toBe("Day 2, 09:00 (morning)");
  });
});

describe("training", () => {
  it("each level takes longer: 4, 8, 12, 16, 20 hours", () => {
    expect([0, 1, 2, 3, 4].map(hoursToNextLevel)).toEqual([4, 8, 12, 16, 20]);
  });

  it("parses skill names loosely", () => {
    expect(parseSkill("Two Handed")).toBe("two_handed");
    expect(parseSkill("one-handed")).toBe("one_handed");
    expect(parseSkill("smithing")).toBe("smithing");
    expect(parseSkill("juggling")).toBeNull();
  });

  it("progress builds up over sessions, then the level goes up", () => {
    const { state, world } = setup();
    const first = train(persona, state, world, "smithing", 2);
    expect(first).toMatchObject({ ok: true, hoursSpent: 2, levelsGained: 0 });
    expect(world.player.skillProgress.smithing).toBe(2);
    expect(world.player.skills.smithing).toBeUndefined();

    const second = train(persona, state, world, "smithing", 2);
    expect(second.levelsGained).toBe(1);
    expect(world.player.skills.smithing).toBe(1);
    expect(world.player.skillProgress.smithing).toBe(0);
    expect(second.message).toContain("novice at smithing (0/8 hours toward apprentice)");
  });

  it("time passes, the player pays, and trust grows a little", () => {
    const { state, world } = setup();
    const r = train(persona, state, world, "smithing", 3);
    expect(r.cost).toBe(15); // 3h toward novice at 5/h
    expect(world.player.gold).toBe(35);
    expect(state.gold).toBe(persona.startingGold + 15); // the fee goes to the teacher
    expect(formatTime(world)).toBe("Day 1, 17:00 (evening)");
    expect(state.relationship).toBe(2);
  });

  it("can't go past the teacher's level, and stops the session early when reached", () => {
    // A copy of Brena who teaches her lesser skills, to test the caps.
    const forager = { ...persona, teaches: "foraging" as const }; // Brena is a novice forager (1); so is the player.
    const { state, world } = setup();
    expect(train(forager, state, world, "foraging", 2)).toMatchObject({ ok: false, hoursSpent: 0 });

    const hammer = { ...persona, teaches: "blunt" as const }; // Brena: expert (4). 16 hours to expert.
    world.player.skills.blunt = 3;
    world.player.skillProgress.blunt = 14;
    state.relationship = 40; // expert needs trust 40
    const r = train(hammer, state, world, "blunt", 8);
    expect(r).toMatchObject({ ok: true, hoursSpent: 2, levelsGained: 1 });
    expect(world.player.skills.blunt).toBe(4);
    expect(r.message).toContain("as far as you can take them");
    expect(train(hammer, state, world, "blunt", 2).ok).toBe(false);
  });

  it("can't learn a skill the teacher doesn't have", () => {
    const { state, world } = setup();
    expect(train(persona, state, world, "archery", 2).ok).toBe(false);
  });

  it("caps session length", () => {
    const { state, world } = setup();
    world.player.gold = 1000;
    expect(train(persona, state, world, "smithing", 100).hoursSpent).toBe(MAX_SESSION_HOURS);
  });

  it("refuses when angry, disliked, or fighting - and no time passes", () => {
    for (const s of [{ mood: "angry" as const }, { relationship: -5 }, { inCombat: true }]) {
      const { state, world } = setup(s);
      expect(train(persona, state, world, "smithing", 2).ok).toBe(false);
      expect(world.hour).toBe(14);
    }
  });

  it("lists what the NPC can still teach", () => {
    const { world } = setup();
    expect(teachableSkills(persona, world)).toEqual([{ skill: "smithing", upTo: 5 }]);
    world.player.skills.smithing = 5;
    expect(teachableSkills(persona, world)).toEqual([]);
  });
});

describe("training fees", () => {
  it("cost 5 gold per hour per tier being taught", () => {
    expect([1, 2, 3, 4, 5].map((tier) => feePerHour(persona, createNpcState(persona, { relationship: 50 }), tier))).toEqual([5, 10, 15, 20, 25]);
  });

  it("a session crossing a level charges each hour at its own rate", () => {
    const { state, world } = setup();
    world.player.gold = 100;
    // 4h toward novice at 5/h, then 2h toward apprentice at 10/h.
    const q = quoteTraining(persona, state, world, "smithing", 6);
    expect(q).toMatchObject({ ok: true, hours: 6, cost: 40, endLevel: 1, endProgress: 2 });
  });

  it("stops when the player can't pay for the next hour", () => {
    const { state, world } = setup();
    world.player.gold = 12;
    const r = train(persona, state, world, "smithing", 8);
    expect(r).toMatchObject({ ok: true, hoursSpent: 2, cost: 10 });
    expect(world.player.gold).toBe(2);
  });

  it("refuses with the price if the player can't afford even one hour", () => {
    const { state, world } = setup();
    world.player.gold = 3;
    const r = train(persona, state, world, "smithing", 2);
    expect(r.ok).toBe(false);
    expect(r.message).toBe("One hour of smithing with Brena Ashford costs 5 gold; you have 3.");
    expect(world.hour).toBe(14);
    expect(state.gold).toBe(persona.startingGold);
  });

  it("quoting changes nothing", () => {
    const { state, world } = setup();
    quoteTraining(persona, state, world, "smithing", 4);
    expect(world.player.gold).toBe(50);
    expect(state.gold).toBe(persona.startingGold);
    expect(world.player.skillProgress.smithing).toBeUndefined();
    expect(world.hour).toBe(14);
  });
});

describe("greedy NPCs", () => {
  it("a money-hungry NPC charges far more to someone they don't trust", () => {
    // Pell, greed 0.9: at trust 0, 1.9x; at trust 50, 1.45x; at trust 100, list price.
    expect(feePerHour(pell, createNpcState(pell, { relationship: 0 }), 2)).toBe(19);
    expect(feePerHour(pell, createNpcState(pell, { relationship: 50 }), 2)).toBe(15);
    expect(feePerHour(pell, createNpcState(pell, { relationship: 100 }), 2)).toBe(10);
  });

  it("a fair NPC charges the same at any trust", () => {
    expect(feePerHour(persona, createNpcState(persona, { relationship: 0 }), 2)).toBe(10);
    expect(feePerHour(persona, createNpcState(persona, { relationship: 100 }), 2)).toBe(10);
  });

  it("the same session costs more from Pell than from Brena at trust 0", () => {
    const world = createDemoWorld();
    world.player.skills = {};
    world.player.gold = 1000;
    // Both set to teach foraging, so only greed differs.
    const brenaForager = { ...persona, teaches: "foraging" as const };
    const pellForager = { ...pell, teaches: "foraging" as const };
    const fromBrena = quoteTraining(brenaForager, createNpcState(brenaForager), world, "foraging", 2);
    const fromPell = quoteTraining(pellForager, createNpcState(pellForager), world, "foraging", 2);
    expect(fromBrena.cost).toBe(10);
    expect(fromPell.cost).toBe(20);
  });
});

describe("trust limits how far an NPC will teach", () => {
  it("trust 0 → apprentice, 20 → adept, 40 → expert, 60 → master", () => {
    expect([0, 19, 20, 39, 40, 59, 60, 100].map(trustCap)).toEqual([2, 2, 3, 3, 4, 4, 5, 5]);
  });

  it("refuses the next tier until trust is high enough, and says what's needed", () => {
    const { state, world } = setup({ relationship: 10 });
    world.player.skills.smithing = 2;
    const r = quoteTraining(persona, state, world, "smithing", 2);
    expect(r.ok).toBe(false);
    expect(r.message).toBe("Brena Ashford won't teach you adept smithing yet. That takes more trust (10 now, 20 needed).");
  });

  it("stops a session at the trust cap and says why", () => {
    const { state, world } = setup();
    world.player.gold = 1000;
    world.player.skills.smithing = 1;
    world.player.skillProgress.smithing = 6; // 2h from apprentice; adept needs trust 20
    const r = train(persona, state, world, "smithing", 8);
    expect(r).toMatchObject({ ok: true, hoursSpent: 2, levelsGained: 1 });
    expect(r.message).toContain("You won't teach them more until you trust them more.");
  });
});


describe("training talk", () => {
  it("recognises requests for training", () => {
    for (const line of ["Can you train me?", "Teach me smithing", "I want to learn", "Take me as your apprentice"]) {
      expect(isTrainingTalk(line), line).toBe(true);
    }
    for (const line of ["Hello", "How much is a dagger?", "Your forge is junk"]) expect(isTrainingTalk(line), line).toBe(false);
  });

  it("tells the NPC what it can teach now, at what price, and what needs more trust", () => {
    const { state, world } = setup();
    const text = describeTeaching(persona, state, world)!;
    expect(text).toContain("smithing (to apprentice, 5 gold/hour)");
    expect(text).toContain("They have 50 gold.");
    world.player.skills.smithing = 2; // next would be adept: needs trust 20
    expect(describeTeaching(persona, state, world)).toContain("smithing (needs trust 20)");
  });

  it("returns null when there's nothing left to teach", () => {
    const { state, world } = setup();
    world.player.skills = { smithing: 5, blunt: 5, haggling: 5, two_handed: 5, one_handed: 5, intimidation: 5, speechcraft: 5, evasion: 5, foraging: 5 };
    expect(describeTeaching(persona, state, world)).toBeNull();
  });
});

describe("each NPC teaches one skill: their specialty", () => {
  it("uses `teaches` when set: Brena smithing, Pell haggling", () => {
    expect(trainerSkill(persona)).toBe("smithing");
    expect(trainerSkill(pell)).toBe("haggling");
  });

  it("falls back to the NPC's best skill", () => {
    const { teaches: _t, ...noTeaches } = persona;
    expect(trainerSkill(noTeaches)).toBe("smithing");
    expect(trainerSkill({ ...noTeaches, skills: { archery: 2, sneak: 4 } })).toBe("sneak");
    expect(trainerSkill({ ...noTeaches, skills: {} })).toBeUndefined();
  });

  it("refuses to teach anything else, even skills the NPC is good at", () => {
    const { state, world } = setup();
    const r = train(persona, state, world, "blunt", 2); // Brena is an expert, but blunt isn't what she teaches
    expect(r).toMatchObject({ ok: false, message: "Brena Ashford only teaches smithing." });
    expect(world.player.gold).toBe(50);
  });

  it("only mentions the specialty when asked about training", () => {
    const { state, world } = setup();
    const text = describeTeaching(persona, state, world)!;
    expect(text).toContain("smithing");
    expect(text).not.toMatch(/blunt|haggling|two-handed/);
  });
});
