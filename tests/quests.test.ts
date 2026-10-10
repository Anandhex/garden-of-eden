import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import brenaJson from "../src/data/npcs/brena.json" with { type: "json" };
import pellJson from "../src/data/npcs/pell.json" with { type: "json" };
import { craftingNeeds } from "../src/game/crafting.js";
import { ITEMS } from "../src/game/items.js";
import { canTakeQuestTier, compareTiers, gainXp, QUEST_TIERS, xpToNextLevel } from "../src/game/levels.js";
import {
  acceptQuest,
  describeQuestsForNpc,
  isQuestTalk,
  questOfferError,
  questsFor,
  refreshNeedQuests,
  turnInQuests,
} from "../src/game/quests.js";
import { createNpcState } from "../src/npc/state.js";
import type { NpcPersona } from "../src/npc/types.js";
import { createDemoWorld } from "../src/world/world.js";

const brena = brenaJson as NpcPersona;
const pell = pellJson as NpcPersona;
const NPC_DIR = new URL("../src/data/npcs/", import.meta.url);

describe("levels", () => {
  it("need more XP each level: 50, 100, 150...", () => {
    expect([1, 2, 3].map(xpToNextLevel)).toEqual([50, 100, 150]);
  });

  it("XP carries over and can level up more than once", () => {
    const p = { level: 1, xp: 0 };
    expect(gainXp(p, 175)).toBe(2); // 50 to level 2, 100 to level 3, 25 left
    expect(p).toEqual({ level: 3, xp: 25 });
  });

  it("gate quest tiers: a level 1 player can't take an SSS quest", () => {
    expect(canTakeQuestTier(1, "G")).toBe(true);
    expect(canTakeQuestTier(1, "F")).toBe(false);
    expect(canTakeQuestTier(1, "SSS")).toBe(false);
    expect(canTakeQuestTier(25, "SSS")).toBe(true);
  });
});

describe("every NPC file's quests", () => {
  const files = readdirSync(NPC_DIR).filter((f) => f.endsWith(".json"));
  it.each(files)("%s has valid quests within its max tier", (file) => {
    const npc = JSON.parse(readFileSync(new URL(file, NPC_DIR), "utf8"));
    expect(QUEST_TIERS).toContain(npc.maxQuestTier);
    for (const q of npc.quests ?? []) {
      expect(QUEST_TIERS, q.id).toContain(q.tier);
      expect(compareTiers(q.tier, npc.maxQuestTier), `${q.id} is above maxQuestTier`).toBeLessThanOrEqual(0);
      expect(ITEMS, `${q.id} asks for an unknown item`).toHaveProperty([q.objective.item]);
      expect(q.reward.gold).toBeGreaterThan(0);
    }
  });

  it("not every NPC has high-level work", () => {
    expect(brena.maxQuestTier).toBe("B");
    expect(pell.maxQuestTier).toBe("D");
  });
});

describe("who sees which quests", () => {
  it("quests above the NPC's trust are hidden entirely", () => {
    const world = createDemoWorld();
    const ids = (trust: number) => {
      const v = questsFor(brena, createNpcState(brena, { relationship: trust }), world.player);
      return [...v.available, ...v.tooHard].map((q) => q.id);
    };
    expect(ids(0)).toContain("hot_meal");
    expect(ids(0)).not.toContain("burn_poultice"); // needs trust 10
    expect(ids(0)).not.toContain("fathers_hammer"); // needs trust 60
    expect(ids(60)).toContain("fathers_hammer");
  });

  it("quests above the player's level are known but can't be taken", () => {
    const world = createDemoWorld(); // level 1
    const v = questsFor(brena, createNpcState(brena, { relationship: 60 }), world.player);
    expect(v.available.map((q) => q.id)).toEqual(["hot_meal"]);
    expect(v.tooHard.map((q) => q.id)).toEqual(["burn_poultice", "fathers_hammer"]);
    expect(questOfferError(brena, createNpcState(brena, { relationship: 60 }), world.player, "fathers_hammer")).toContain("needs 10");
  });

  it("tells the model what to offer and what to refuse as too dangerous", () => {
    const text = describeQuestsForNpc(brena, createNpcState(brena, { relationship: 60 }), createDemoWorld().player);
    expect(text).toContain('"hot_meal" [G] A hot meal: bring 1 stew for 8 gold');
    expect(text).toContain("Too dangerous for them at their level, so refuse if asked: [F] Herbs for a burn (needs level 2); [B] My father's hammer (needs level 10)");
  });

  it("recognises asking for work", () => {
    for (const l of ["Got any work?", "Any quests for me?", "Can I help you with anything?", "Need help?"]) expect(isQuestTalk(l), l).toBe(true);
    for (const l of ["Hello", "How much is a dagger?"]) expect(isQuestTalk(l), l).toBe(false);
  });
});

describe("quests made from the NPC's needs", () => {
  it("Brena, with no iron ore, needs 8 (two iron swords' worth)", () => {
    expect(craftingNeeds(brena, createNpcState(brena))).toEqual({ "iron ore": 8 });
  });

  it("turns a need into a quest: tier from the value, reward from her purse", () => {
    const state = createNpcState(brena); // 35 gold
    refreshNeedQuests(brena, state, createDemoWorld().player);
    expect(state.questBoard).toEqual([
      expect.objectContaining({
        id: "need_brena_iron_ore",
        tier: "E", // 8 ore × 6 gold = 48
        objective: { type: "deliver", item: "iron ore", qty: 8 },
        reward: { gold: 35 }, // 72 would be fair, but she only has 35
      }),
    ]);
  });

  it("a broke NPC posts no need quests", () => {
    const state = createNpcState(brena, { gold: 0 });
    refreshNeedQuests(brena, state, createDemoWorld().player);
    expect(state.questBoard).toEqual([]);
  });

  it("no need once the stock is there", () => {
    const state = createNpcState(brena, { inventory: { "iron ore [F]": 8 } });
    refreshNeedQuests(brena, state, createDemoWorld().player);
    expect(state.questBoard).toEqual([]);
  });
});

describe("taking and finishing a quest", () => {
  it("accept → bring the items → turn in: items to the NPC, gold and XP to the player", () => {
    const world = createDemoWorld();
    world.player.gold = 0;
    const state = createNpcState(brena, { pendingQuest: "hot_meal" });
    expect(acceptQuest(brena, state, world.player)?.id).toBe("hot_meal");
    expect(world.player.quests.active.map((q) => q.id)).toEqual(["hot_meal"]);

    expect(turnInQuests(brena, state, world).message).toContain("Not ready yet: A hot meal (0/1 stew)");

    world.player.inventory["stew [G]"] = 1;
    const r = turnInQuests(brena, state, world);
    expect(r.completed.map((q) => q.id)).toEqual(["hot_meal"]);
    expect(world.player.gold).toBe(8);
    expect(world.player.xp).toBe(25);
    expect(world.player.inventory["stew [G]"]).toBeUndefined();
    expect(state.inventory["stew [G]"]).toBe(1);
    expect(state.gold).toBe(27);
    expect(state.relationship).toBe(5);
    expect(world.player.quests.completed).toEqual(["hot_meal"]);
  });

  it("a finished quest can't be taken again", () => {
    const world = createDemoWorld();
    world.player.quests.completed.push("hot_meal");
    expect(questsFor(brena, createNpcState(brena), world.player).available.map((q) => q.id)).not.toContain("hot_meal");
  });

  it("enough XP levels the player up, opening higher tiers", () => {
    const world = createDemoWorld();
    world.player.xp = 40;
    const state = createNpcState(brena, { pendingQuest: "hot_meal" });
    acceptQuest(brena, state, world.player);
    world.player.inventory["stew [G]"] = 1;
    const r = turnInQuests(brena, state, world);
    expect(r.levelsGained).toBe(1);
    expect(world.player.level).toBe(2);
    expect(r.message).toContain("They're now level 2!");
    expect(canTakeQuestTier(world.player.level, "F")).toBe(true);
  });

  it("can't accept a quest above your level, even if it was offered", () => {
    const world = createDemoWorld();
    const state = createNpcState(brena, { relationship: 60, pendingQuest: "fathers_hammer" });
    expect(acceptQuest(brena, state, world.player)).toBeNull();
    expect(world.player.quests.active).toEqual([]);
  });
});
