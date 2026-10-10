import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import brenaJson from "../src/data/npcs/brena.json" with { type: "json" };
import { fightCreature, loadCreatureTemplates, spawnCreature } from "../src/game/creatures.js";
import { rankForLevel } from "../src/game/levels.js";
import { acceptQuest, turnInQuests } from "../src/game/quests.js";
import { loadWorld, newWorld } from "../src/game/save.js";
import { awardPlayerTitle, playerProgressTitles, playerWonFight } from "../src/game/titles.js";
import type { ChatResult, LLMProvider } from "../src/llm/provider.js";
import { NpcAgent } from "../src/npc/NpcAgent.js";
import { buildTurnMessage } from "../src/npc/persona.js";
import { parsePersona } from "../src/npc/personaSchema.js";
import { createNpcState } from "../src/npc/state.js";
import { createDemoWorld } from "../src/world/world.js";

const brena = parsePersona(brenaJson);
const wolf = loadCreatureTemplates().wolf!;
const top = () => 0.999; // natural 20s and top damage

class FakeProvider implements LLMProvider {
  requests = 0;
  async chat(): Promise<ChatResult> {
    this.requests += 1;
    return { text: "...", toolCalls: [] };
  }
}

describe("player rank", () => {
  it("comes from level, like quest tiers", () => {
    expect(rankForLevel(1)).toBe("G");
    expect(rankForLevel(4)).toBe("E");
    expect(rankForLevel(10)).toBe("B");
    expect(rankForLevel(30)).toBe("SSS");
  });
});

describe("player titles", () => {
  it("are given once, and their bonus goes onto the player's attributes", () => {
    const { player } = createDemoWorld();
    const willpower = player.attributes.willpower;
    expect(awardPlayerTitle(player, "giant_slayer", 3)).toBe(
      'You earned the title "Giant-slayer" (beat a foe two or more ranks above them): +1 willpower.',
    );
    expect(player.attributes.willpower).toBe(willpower + 1);
    expect(awardPlayerTitle(player, "giant_slayer", 4)).toBeNull();
    expect(player.attributes.willpower).toBe(willpower + 1);
    expect(player.titles).toEqual([{ id: "giant_slayer", day: 3 }]);
  });

  it("come from winning fights: Giant-slayer, Death-cheater, Veteran", () => {
    const { player } = createDemoWorld(); // level 1: rank G
    expect(playerWonFight(player, "F", 1)).toEqual([]); // one rank up: no title
    player.hp = 5; // 5/40: on the brink
    expect(playerWonFight(player, "D", 1).map((l) => l.match(/"(.+?)"/)?.[1])).toEqual(["Giant-slayer", "Death-cheater"]);
    player.hp = 40;
    playerWonFight(player, "G", 1);
    playerWonFight(player, "G", 1);
    expect(playerWonFight(player, "G", 1)).toEqual([expect.stringContaining('"Veteran"')]);
    expect(player.fightsWon).toBe(5);
  });

  it("come from progress: the Reliable after five quests, rank titles from level", () => {
    const { player } = createDemoWorld();
    player.quests.completed = ["a", "b", "c", "d"];
    expect(playerProgressTitles(player, 1)).toEqual([]);
    player.quests.completed.push("e");
    expect(playerProgressTitles(player, 1)).toEqual([expect.stringContaining('"the Reliable"')]);
    player.level = 16; // rank S
    expect(playerProgressTitles(player, 1).map((l) => l.match(/"(.+?)"/)?.[1])).toEqual(["the Renowned", "the Hero"]);
  });

  it("killing a higher-ranked NPC earns Giant-slayer", async () => {
    const llm = new FakeProvider();
    const npc = new NpcAgent(brena, llm, top);
    npc.state.hp = 1;
    const world = createDemoWorld(); // the player is rank G, Brena C
    const r = await npc.attackedByPlayer(world);
    expect(npc.isDead).toBe(true);
    expect(r.titles).toEqual([expect.stringContaining('"Giant-slayer"')]);
    expect(world.player.fightsWon).toBe(1);
  });

  it("a fight that's still going isn't a win", async () => {
    const npc = new NpcAgent(brena, new FakeProvider(), () => 0.5);
    const world = createDemoWorld();
    const r = await npc.attackedByPlayer(world);
    expect(r.titles).toBeUndefined();
    expect(world.player.fightsWon).toBe(0);
  });

  it("killing a creature counts too", () => {
    const world = createDemoWorld();
    world.player.hp = 4; // near death
    const c = spawnCreature(wolf, "wolf-1", 1, () => 0.5, "wolf 1");
    c.hp = 1;
    const round = fightCreature(wolf, c, world, top);
    expect(round.over).toBe("creature dead");
    expect(round.log).toContain('You earned the title "Death-cheater" (won a fight on the brink of death): +1 endurance.');
  });

  it("finishing a fifth quest earns the Reliable", () => {
    const world = createDemoWorld();
    world.player.quests.completed = ["a", "b", "c", "d"];
    const state = createNpcState(brena, { pendingQuest: "hot_meal" });
    acceptQuest(brena, state, world.player);
    world.player.inventory["stew [G]"] = 1;
    expect(turnInQuests(brena, state, world).titles).toEqual([expect.stringContaining('"the Reliable"')]);
  });

  it("NPCs hear them, so they can react", () => {
    const world = createDemoWorld();
    expect(buildTurnMessage(brena, createNpcState(brena), world, "Hi")).not.toContain("known as");
    awardPlayerTitle(world.player, "veteran", 1);
    expect(buildTurnMessage(brena, createNpcState(brena), world, "Hi")).toContain("Traveler is known as Veteran.");
  });

  it("old saves get an empty title list", () => {
    const file = join(mkdtempSync(join(tmpdir(), "llm-game-titles-")), "world.json");
    const personas = { brena };
    const world = newWorld(personas);
    delete world.player.titles;
    delete world.player.fightsWon;
    writeFileSync(file, `${JSON.stringify(world)}\n`);
    const loaded = loadWorld(file, personas);
    expect(loaded.player.titles).toEqual([]);
    expect(loaded.player.fightsWon).toBe(0);
  });
});
