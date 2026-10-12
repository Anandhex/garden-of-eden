import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import haleJson from "../src/data/npcs/hale.json" with { type: "json" };
import { fightCreature, loadCreatureTemplates, type Creature } from "../src/game/creatures.js";
import { acceptQuest, describeObjective, questProgress, recordCreatureDefeat, turnInQuests } from "../src/game/quests.js";
import { loadWorld, newWorld, saveWorld } from "../src/game/save.js";
import {
  applySpawnRules,
  badSpawnRules,
  denKey,
  inHours,
  loadSpawnRules,
  parseSpawnRules,
  type SpawnLedger,
  type SpawnRule,
  windowKey,
} from "../src/game/spawning.js";
import { parsePersona } from "../src/npc/personaSchema.js";
import { createNpcState } from "../src/npc/state.js";
import { DEN_KEYS } from "../src/web/sites.js";
import { createDemoWorld } from "../src/world/world.js";

const templates = loadCreatureTemplates();
const hale = parsePersona(haleJson);
const rng = () => 0.5;
const alive = (creatures: Record<string, Creature>, kind: string) => Object.values(creatures).filter((c) => c.template === kind && !c.outcome);

function at(hour: number, day = 1) {
  const world = createDemoWorld();
  world.day = day;
  world.hour = hour;
  return world;
}

describe("spawn rule files", () => {
  it("the game's rules parse, and name real creatures and places", () => {
    const rules = loadSpawnRules();
    expect(rules.length).toBeGreaterThan(0);
    expect(badSpawnRules(rules, templates, [...DEN_KEYS])).toEqual([]);
  });

  it("reject unknown fields and duplicate ids; flag missing creatures and places", () => {
    expect(() => parseSpawnRules({ rules: [{ id: "a", creature: "wolf", count: 1, colour: "red" }] })).toThrow();
    const r = { id: "a", creature: "wolf", count: 1 };
    expect(() => parseSpawnRules({ rules: [r, r] })).toThrow(/duplicate/);
    expect(badSpawnRules([{ id: "x", creature: "dragon", count: 1, place: "moon" }], templates, ["forest_edge"])).toEqual([
      'x: no creature "dragon"',
      'x: no place "moon"',
    ]);
  });
});

describe("when a rule is due", () => {
  const night: SpawnRule = { id: "night", creature: "wolf", count: 2, hours: [21, 4] };

  it("hours wrap past midnight, and the small hours belong to the night before", () => {
    expect(inHours(22, [21, 4])).toBe(true);
    expect(inHours(3, [21, 4])).toBe(true);
    expect(inHours(12, [21, 4])).toBe(false);
    expect(inHours(12, [8, 18])).toBe(true);
    expect(windowKey(night, at(23, 5))).toBe(windowKey(night, at(2, 6)));
    expect(windowKey(night, at(23, 5))).not.toBe(windowKey(night, at(23, 6)));
    expect(windowKey(night, at(12, 5))).toBeNull();
  });

  it("an event rule is due while its event is news; a quest rule while the quest is active", () => {
    const world = at(12);
    expect(windowKey({ id: "e", creature: "bandit", count: 1, event: "news.cart_attack" }, world)).not.toBeNull();
    world.recentEvents = [];
    expect(windowKey({ id: "e", creature: "bandit", count: 1, event: "news.cart_attack" }, world)).toBeNull();
    const quest: SpawnRule = { id: "q", creature: "bandit", count: 3, quest: "clear_mine_road" };
    expect(windowKey(quest, world)).toBeNull();
    world.player.quests.active.push({ ...hale.quests![1]!, giverId: "hale", giverName: hale.name });
    expect(windowKey(quest, world)).not.toBeNull();
  });
});

describe("applySpawnRules", () => {
  const night: SpawnRule = { id: "night", creature: "wolf", count: 2, hours: [21, 4], place: "forest_edge" };

  it("spawns a group when its window opens, once; the dead stay dead until the next window", () => {
    const creatures: Record<string, Creature> = {};
    const ledger: SpawnLedger = {};
    expect(applySpawnRules([night], templates, creatures, ledger, at(12), rng)).toEqual([]);
    expect(applySpawnRules([night], templates, creatures, ledger, at(21), rng)).toEqual(["2 wolves turn up (forest edge)."]);
    expect(alive(creatures, "wolf")).toHaveLength(2);
    creatures[ledger.night!.uids[0]!]!.outcome = "dead";
    applySpawnRules([night], templates, creatures, ledger, at(23), rng);
    expect(alive(creatures, "wolf")).toHaveLength(1); // no top-up the same night
    // Morning: the survivor moves on, and the dead one is cleared away.
    expect(applySpawnRules([night], templates, creatures, ledger, at(8, 2), rng)).toEqual(["A wolf moves on."]);
    expect(Object.keys(creatures)).toHaveLength(0);
    expect(ledger.night).toBeUndefined();
    applySpawnRules([night], templates, creatures, ledger, at(22, 2), rng);
    expect(alive(creatures, "wolf")).toHaveLength(2);
  });

  it("never removes the creature the player is fighting, and leaves other creatures alone", () => {
    const creatures: Record<string, Creature> = {};
    const ledger: SpawnLedger = {};
    applySpawnRules([night], templates, creatures, ledger, at(22), rng);
    creatures.resident = { ...creatures[ledger.night!.uids[0]!]!, uid: "resident", name: "old wolf" };
    const fighting = ledger.night!.uids[1]!;
    applySpawnRules([night], templates, creatures, ledger, at(8, 2), rng, new Set([fighting]));
    expect(Object.keys(creatures).sort()).toEqual(["resident", fighting].sort());
    // Once the fight's over it goes too.
    applySpawnRules([night], templates, creatures, ledger, at(9, 2), rng);
    expect(Object.keys(creatures)).toEqual(["resident"]);
  });

  it("new creatures never take an existing uid", () => {
    const creatures: Record<string, Creature> = {};
    const ledger: SpawnLedger = {};
    const two = [night, { ...night, id: "other", hours: [20, 4] as [number, number] }];
    applySpawnRules(two, templates, creatures, ledger, at(22), rng);
    expect(Object.keys(creatures)).toHaveLength(4);
    delete creatures["wolf-1"];
    applySpawnRules([{ ...night, id: "third", hours: undefined }], templates, creatures, ledger, at(22), rng);
    expect(Object.keys(creatures)).toHaveLength(5);
  });

  it("roams the rule's place, else its kind's den", () => {
    const creatures: Record<string, Creature> = {};
    const ledger: SpawnLedger = {};
    const rules = [night, { id: "plain", creature: "wolf", count: 1 }];
    applySpawnRules(rules, templates, creatures, ledger, at(22), rng);
    expect(denKey(rules, ledger, creatures[ledger.night!.uids[0]!]!)).toBe("forest_edge");
    expect(denKey(rules, ledger, creatures[ledger.plain!.uids[0]!]!)).toBe("wolf");
  });

  it("the ledger survives a save", () => {
    const file = join(mkdtempSync(join(tmpdir(), "llm-game-spawns-")), "world.json");
    const world = newWorld({ hale }, templates);
    applySpawnRules([night], templates, world.creatures, (world.spawns ??= {}), { ...world, hour: 22 }, rng);
    saveWorld(file, world);
    const loaded = loadWorld(file, { hale }, templates);
    expect(loaded.spawns).toEqual(world.spawns);
  });
});

describe("defeat quests", () => {
  /** Hale's "Trouble on the mine road": kill or drive off 3 bandits. */
  function takeIt() {
    const world = createDemoWorld();
    world.player.level = 5;
    const state = createNpcState(hale);
    state.relationship = 20;
    state.pendingQuest = "clear_mine_road";
    const quest = acceptQuest(hale, state, world.player);
    return { world, state, quest: quest! };
  }

  it("taking one brings out its quarry, through the spawn rules", () => {
    const { world, quest } = takeIt();
    expect(describeObjective(quest)).toBe("kill or drive off 3 bandits");
    const creatures: Record<string, Creature> = {};
    const log = applySpawnRules(loadSpawnRules(), templates, creatures, {}, { ...world, hour: 12, recentEvents: [] }, rng);
    expect(log).toContain("3 bandits turn up.");
    expect(alive(creatures, "bandit")).toHaveLength(3);
  });

  it("counts kills and routs of that kind only, up to the target", () => {
    const { world, quest } = takeIt();
    expect(recordCreatureDefeat(world.player, "wolf")).toEqual([]);
    expect(recordCreatureDefeat(world.player, "bandit")).toEqual(['Quest "Trouble on the mine road": 1/3.']);
    recordCreatureDefeat(world.player, "bandit");
    expect(recordCreatureDefeat(world.player, "bandit")).toEqual(['Quest "Trouble on the mine road": 3/3. Done: report back to Corporal Hale.']);
    expect(recordCreatureDefeat(world.player, "bandit")).toEqual([]);
    expect(questProgress(world.player, world.player.quests.active[0]!)).toEqual({ have: 3, need: 3, done: true });
  });

  it("can't be turned in early; once done, pays out in code with no items handed over", () => {
    const { world, state } = takeIt();
    recordCreatureDefeat(world.player, "bandit");
    expect(turnInQuests(hale, state, world).message).toBe("Not ready yet: Trouble on the mine road (1/3 bandits).");
    recordCreatureDefeat(world.player, "bandit");
    recordCreatureDefeat(world.player, "bandit");
    const before = { money: world.player.money, items: { ...world.player.inventory } };
    const r = turnInQuests(hale, state, world);
    expect(r.completed.map((q) => q.id)).toEqual(["clear_mine_road"]);
    expect(r.message).toMatch(/finished "Trouble on the mine road": killed or drove off 3 bandits; you paid 2 gold/);
    expect(world.player.money).toBe(before.money + 200);
    expect(world.player.inventory).toEqual(before.items);
  });

  it("a kill in a real creature fight counts", () => {
    const { world } = takeIt();
    const creatures: Record<string, Creature> = {};
    applySpawnRules(loadSpawnRules(), templates, creatures, {}, { ...world, hour: 12, recentEvents: [] }, rng);
    const target = alive(creatures, "bandit")[0]!;
    target.hp = 1;
    const round = fightCreature(templates.bandit!, target, world, () => 0.99);
    expect(round.over).toBe("creature dead");
    recordCreatureDefeat(world.player, target.template);
    expect(questProgress(world.player, world.player.quests.active[0]!).have).toBe(1);
  });
});
