import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import brenaJson from "../src/data/npcs/brena.json" with { type: "json" };
import pellJson from "../src/data/npcs/pell.json" with { type: "json" };
import { config } from "../src/config.js";
import {
  creatureAmbush,
  creatureBeatsPlayer,
  creatureStats,
  creatureTurn,
  goHunting,
  hardWinter,
  isNotable,
  isYearTurn,
  repopulate,
  rivalryDuel,
  fightCreature,
  fleeCreature,
  loadCreatureTemplates,
  parseCreature,
  passCreatureTime,
  spawnCreature,
  spawnGroup,
  type Creature,
} from "../src/game/creatures.js";
import { createLife, xpToNextTier } from "../src/game/life.js";
import { creatureXp } from "../src/game/levels.js";
import { loadWorld, newWorld, saveWorld } from "../src/game/save.js";
import { parsePersona } from "../src/npc/personaSchema.js";
import { SPECIES } from "../src/world/species.js";
import { createDemoWorld, DEMO_SPAWNS } from "../src/world/world.js";

const templates = loadCreatureTemplates();
const wolf = templates.wolf!;
const bandit = templates.bandit!;
const horse = templates.horse!;
const personas = { brena: parsePersona(brenaJson), pell: parsePersona(pellJson) };
/** Rolls in this order, then the last one forever. */
const seq = (...values: number[]) => () => (values.length > 1 ? values.shift()! : values[0]!);
/** Rolls that always land on `n` of a d20 (and the top of smaller dice). */
const d20 = (n: number) => () => (n - 0.5) / 20;

describe("creature files", () => {
  it("all parse, with a species and a rank", () => {
    expect(Object.keys(templates).sort()).toEqual(["bandit", "horse", "wolf"]);
    expect(wolf.species).toBe("wolf");
    expect(bandit.species).toBe("human"); // people can be stat blocks too
  });

  it("reject a rank above the species cap, or no attack", () => {
    expect(() => parseCreature({ ...wolf, tier: "S" })).toThrow(/cap/);
    const { attack: _, ...noAttack } = wolf;
    expect(() => parseCreature(noAttack)).toThrow(/attack or weapon/);
    expect(() => parseCreature({ ...wolf, ageRange: [2, 40] })).toThrow(/live that long/);
  });
});

describe("spawning", () => {
  it("makes individuals with their own age in the template's range", () => {
    const young = spawnCreature(wolf, "w", 1, () => 0);
    const old = spawnCreature(wolf, "w", 1, () => 0.999);
    expect(Math.floor((1 - young.life.bornOnDay) / config.daysPerYear)).toBe(2);
    expect(Math.floor((1 - old.life.bornOnDay) / config.daysPerYear)).toBe(9);
    expect(young.life.tier).toBe("F");
    expect(young.hp).toBe(creatureStats(wolf, young).maxHp);
  });

  it("names a group in order", () => {
    const into: Record<string, Creature> = {};
    spawnGroup(wolf, 2, into, 1, () => 0.5);
    spawnGroup(wolf, 1, into, 1, () => 0.5);
    expect(Object.values(into).map((c) => c.name)).toEqual(["wolf 1", "wolf 2", "wolf 3"]);
  });
});

describe("fighting a creature", () => {
  it("runs entirely in code and drops loot on a kill", () => {
    const world = createDemoWorld();
    world.player.inventory["iron sword [D]"] = 1;
    const c = spawnCreature(wolf, "wolf-1", 1, () => 0.5, "wolf 1");
    c.hp = 1;
    const round = fightCreature(wolf, c, world, d20(15));
    expect(round.over).toBe("creature dead");
    expect(c.outcome).toBe("dead");
    expect(c.deathCause).toBe(world.player.name);
    expect(round.loot).toEqual({ "wolf pelt [E]": 1 });
    expect(world.player.inventory["wolf pelt [E]"]).toBe(1);
  });

  it("bandits carry gold", () => {
    const world = createDemoWorld();
    const gold = world.player.money;
    const c = spawnCreature(bandit, "bandit-1", 1, () => 0.5);
    c.hp = 1;
    const round = fightCreature(bandit, c, world, d20(15));
    expect(round.money).toBeGreaterThanOrEqual(2);
    expect(world.player.money).toBe(gold + round.money);
  });

  it("strikes back with barks instead of a model", () => {
    const world = createDemoWorld();
    const c = spawnCreature(wolf, "wolf-1", 1, () => 0.5, "wolf 1");
    const round = fightCreature(wolf, c, world, d20(1)); // player misses; wolf rolls a 1 too
    expect(round.over).toBeNull();
    expect(round.log.some((l) => /wolf 1: \*/.test(l))).toBe(true);
  });

  it("a ready creature that downs a player of its rank breaks through", () => {
    const world = createDemoWorld();
    world.player.hp = 1;
    world.player.level = 2; // rank F, same as the wolf
    const c = spawnCreature(wolf, "wolf-1", 1, () => 0.999, "wolf 1"); // potential C
    c.life.xp = xpToNextTier("F");
    c.hp = 1000; // survives anything
    const round = fightCreature(wolf, c, world, d20(20));
    expect(round.over).toBe("player down");
    expect(c.life.tier).toBe("E");
    expect(round.log).toContain("wolf 1 broke through to rank E by bringing down Traveler.");
  });

  it("but a weaker player is no challenge", () => {
    const world = createDemoWorld();
    world.player.hp = 1; // level 1: rank G, below the wolf
    const c = spawnCreature(wolf, "wolf-1", 1, () => 0.999, "wolf 1");
    c.life.xp = xpToNextTier("F");
    c.hp = 1000;
    expect(fightCreature(wolf, c, world, d20(20)).over).toBe("player down");
    expect(c.life.tier).toBe("F");
  });

  it("some never grow: each spawn rolls its potential", () => {
    expect(spawnCreature(wolf, "w", 1, () => 0).life.potential).toBe("F"); // at its peak from birth
    expect(spawnCreature(wolf, "w", 1, () => 0.999).life.potential).toBe("C");
    expect(() => parseCreature({ ...wolf, potential: ["G", "C"] })).toThrow(/starting rank/);
    expect(() => parseCreature({ ...wolf, potential: ["F", "A"] })).toThrow(/cap/);
  });

  it("badly hurt creatures may run", () => {
    const world = createDemoWorld();
    const c = spawnCreature(horse, "horse-1", 1, () => 0.5);
    c.hp = 30; // below 90%: skittish
    const round = fightCreature(horse, c, world, d20(2)); // player misses, morale fails
    expect(round.over).toBe("creature fled");
    expect(c.outcome).toBe("fled");
  });

  it("the player can run", () => {
    const world = createDemoWorld();
    const c = spawnCreature(wolf, "wolf-1", 1, () => 0.5, "wolf 1");
    expect(fleeCreature(wolf, c, world, d20(20)).over).toBe("player fled");
  });
});

describe("creature lives", () => {
  it("age, grow each day, and die of old age", () => {
    const old = spawnCreature(wolf, "wolf-1", 1, () => 0.5, "wolf 1");
    old.life = createLife(SPECIES.wolf!, 13, "F", 1 - config.daysPerYear + 1); // turns 14 (wolf max) on day 2
    const rolls = [0, 0.999]; // youngest age, highest potential: it can still grow
    const young = spawnCreature(wolf, "wolf-2", 1, () => rolls.shift() ?? 0);
    const creatures = { [old.uid]: old, [young.uid]: young };
    const log = passCreatureTime(templates, creatures, { day: 1, hour: 23 }, 2, () => 0.999999);
    expect(old.outcome).toBe("dead");
    expect(old.deathCause).toBe("old age");
    expect(log).toContain("wolf 1 died in their sleep, aged 14.");
    expect(young.outcome).toBeNull();
    expect(young.life.xp).toBeGreaterThan(0);
  });
});

describe("saving creatures", () => {
  it("a new world spawns the starting creatures, and they survive a save", () => {
    const file = join(mkdtempSync(join(tmpdir(), "llm-game-creatures-")), "world.json");
    const world = newWorld(personas, templates, () => 0.5);
    const total = Object.values(DEMO_SPAWNS).reduce((a, b) => a + b, 0);
    expect(Object.keys(world.creatures)).toHaveLength(total);
    world.creatures["wolf-1"]!.hp = 3;
    world.npcStates.brena!.life.xp = 42;
    saveWorld(file, world);
    const loaded = loadWorld(file, personas, templates);
    expect(loaded.creatures["wolf-1"]!.hp).toBe(3);
    expect(loaded.npcStates.brena!.life.xp).toBe(42);
    expect(loaded.npcStates.pell!.life.tier).toBe("E");
  });
});

describe("creatures grow by themselves", () => {
  const ready = (c: Creature) => {
    c.life.potential = "C";
    c.life.xp = xpToNextTier(c.life.tier);
    return c;
  };

  it("a hunt that works is a challenge at the prey's rank", () => {
    const c = ready(spawnCreature(wolf, "wolf-1", 1, () => 0.5, "wolf 1"));
    // Goes out on the deer hunt (0.1 < 0.5), then a natural 20.
    const log = goHunting(wolf, c, 3, seq(0.1, 0.999));
    expect(c.life.tier).toBe("E");
    expect(log).toContain("wolf 1 broke through to rank E by hunting a deer.");
  });

  it("a failed hunt hurts", () => {
    const c = spawnCreature(wolf, "wolf-1", 1, () => 0.5, "wolf 1");
    const max = creatureStats(wolf, c).maxHp;
    expect(goHunting(wolf, c, 3, seq(0.1, 0))).toEqual(["wolf 1 came back hurt from hunting a deer."]);
    expect(c.hp).toBe(max - Math.ceil(max * 0.2));
  });

  it("some days they don't go out", () => {
    const c = spawnCreature(wolf, "wolf-1", 1, () => 0.5, "wolf 1");
    expect(goHunting(wolf, c, 3, () => 0.99)).toEqual([]);
    expect(goHunting(horse, spawnCreature(horse, "h", 1, () => 0.5), 3, () => 0)).toEqual([]); // horses don't hunt
  });

  it("a rivalry duel: the winner overcame the loser's rank, and nobody dies", () => {
    const a = ready(spawnCreature(wolf, "wolf-1", 1, () => 0.5, "wolf 1"));
    const b = spawnCreature(wolf, "wolf-2", 1, () => 0.5, "wolf 2");
    const log = rivalryDuel(wolf, a, b, 5, () => 0.999); // every strike lands; wolf 1 strikes first
    expect(log[0]).toBe("wolf 1 beat wolf 2 in a fight for dominance.");
    expect(a.life.tier).toBe("E");
    expect(b.outcome).toBeNull();
    expect(b.hp).toBeGreaterThanOrEqual(1);
    expect(a.life.fightsWon).toBe(1);
  });

  it("a hard winter: survivors overcame it, the very old may die", () => {
    const strong = ready(spawnCreature(wolf, "wolf-1", 1, () => 0.5, "wolf 1"));
    const ancient = spawnCreature(wolf, "wolf-2", 1, () => 0.5, "wolf 2");
    ancient.life = createLife(SPECIES.wolf!, 12, "F", 1); // venerable
    const creatures = { [strong.uid]: strong, [ancient.uid]: ancient };
    const log = hardWinter(templates, creatures, 13, seq(0.999, 0));
    expect(log[0]).toBe("A hard winter grips the land.");
    expect(strong.life.tier).toBe("E");
    expect(ancient.outcome).toBe("dead");
    expect(ancient.deathCause).toBe("the hard winter");
  });

  it("comes at the turn of a year", () => {
    expect(isYearTurn(1)).toBe(false);
    expect(isYearTurn(1 + config.daysPerYear)).toBe(true);
    expect(isYearTurn(2 + config.daysPerYear)).toBe(false);
  });

  it("thinned-out kinds get young newcomers", () => {
    const creatures: Record<string, Creature> = {};
    spawnGroup(wolf, 1, creatures, 1, () => 0.5);
    const log = repopulate(templates, creatures, { wolf: 2, horse: 0 }, 4, () => 0);
    expect(log).toEqual(["A young wolf has come to the area (wolf 2)."]);
    expect(Math.floor((4 - creatures["wolf-2"]!.life.bornOnDay) / config.daysPerYear)).toBe(wolf.ageRange[0]);
    expect(repopulate(templates, creatures, { wolf: 2 }, 5, () => 0)).toEqual([]); // back to full
  });

  it("a creature that ran off is back the next day", () => {
    const c = spawnCreature(wolf, "wolf-1", 1, () => 0.5, "wolf 1");
    c.outcome = "fled";
    passCreatureTime(templates, { [c.uid]: c }, { day: 1, hour: 22 }, 3, () => 0.99);
    expect(c.outcome).toBeNull();
  });

  it("their news is shown, the everyday stuff isn't", () => {
    expect(isNotable("wolf 1 broke through to rank E by hunting a deer.")).toBe(true);
    expect(isNotable("A young wolf has come to the area (wolf 4).")).toBe(true);
    expect(isNotable("wolf 1 came back hurt from hunting a deer.")).toBe(false);
  });
});

describe("meeting creatures", () => {
  it("wolves and bandits jump the player, horses don't", () => {
    expect(wolf.aggressive).toBe(true);
    expect(bandit.aggressive).toBe(true);
    expect(horse.aggressive).toBe(false);
    const world = createDemoWorld();
    const c = spawnCreature(wolf, "wolf-1", 1, () => 0.5, "wolf 1");
    const round = creatureAmbush(wolf, c, world, d20(20));
    expect(round.log).toContain("wolf 1 attacks you!");
    expect(world.player.hp).toBeLessThan(40);
  });

  it("losing to one knocks you out; bandits rob you, wolves don't", () => {
    const world = createDemoWorld();
    world.player.hp = 0;
    const w = spawnCreature(wolf, "wolf-1", 1, () => 0.5, "wolf 1");
    const byWolf = creatureBeatsPlayer(wolf, w, world);
    expect(byWolf.rule).toBe("knockout");
    expect(byWolf.moneyTaken).toBe(0);
    expect(world.player.hp).toBe(10);
    expect(w.outcome).toBe("fled"); // it leaves with its prize

    world.player.hp = 0;
    const b = spawnCreature(bandit, "bandit-1", 1, () => 0.5, "bandit 1");
    const byBandit = creatureBeatsPlayer(bandit, b, world);
    expect(byBandit.moneyTaken).toBe(125); // a quarter of 5 gold
    expect(world.player.money).toBe(375);
  });
});

describe("player XP from creatures", () => {
  it("is a share of a quest of the creature's rank, less for weaklings, half for routing", () => {
    expect(creatureXp("F", 1)).toBe(20); // 40% of 50
    expect(creatureXp("E", 1)).toBe(40);
    expect(creatureXp("F", 5)).toBe(5); // rank D player: a wolf is two ranks below
    expect(creatureXp("F", 1, true)).toBe(10);
    expect(creatureXp("G", 30)).toBeGreaterThanOrEqual(1);
  });

  it("a kill pays XP and can level the player up", () => {
    const world = createDemoWorld();
    world.player.xp = 45;
    const c = spawnCreature(wolf, "wolf-1", 1, () => 0.5, "wolf 1");
    c.hp = 1;
    const round = fightCreature(wolf, c, world, d20(15));
    expect(round.log).toContain("You gain 20 XP. You're now level 2!");
    expect(world.player.level).toBe(2);
    expect(world.player.xp).toBe(15);
  });

  it("running it off pays half", () => {
    const world = createDemoWorld();
    const c = spawnCreature(horse, "horse-1", 1, () => 0.5, "horse 1");
    c.hp = 30;
    const round = fightCreature(horse, c, world, d20(2));
    expect(round.over).toBe("creature fled");
    expect(round.log).toContain("You gain 5 XP."); // 40% of a G quest (25) is 10, halved
  });
});

describe("the combat clock", () => {
  it("a lost turn gives the creature a free strike", () => {
    const world = createDemoWorld();
    const c = spawnCreature(wolf, "wolf-1", 1, () => 0.5, "wolf 1");
    const round = creatureTurn(wolf, c, world, d20(20));
    expect(round.log[0]).toBe("You hesitate.");
    expect(world.player.hp).toBeLessThan(40);
  });
});
