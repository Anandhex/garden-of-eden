import { describe, expect, it } from "vitest";
import brenaJson from "../src/data/npcs/brena.json" with { type: "json" };
import haleJson from "../src/data/npcs/hale.json" with { type: "json" };
import pellJson from "../src/data/npcs/pell.json" with { type: "json" };
import {
  type Creature,
  creatureDamageBonus,
  creatureWeapon,
  describeCreature,
  fightCreature,
  goHunting,
  loadCreatureTemplates,
  needsWeapon,
  rivalryDuel,
  spawnCreature,
  spawnGroup,
  upgradeCreature,
} from "../src/game/creatures.js";
import { createLife } from "../src/game/life.js";
import { blackMarket, BLACK_MARKET_MARKUP, considerRaid, RAID_MIN, RAID_NEWS, type VillageNpc } from "../src/game/underworld.js";
import { buildTurnMessage } from "../src/npc/persona.js";
import { parsePersona } from "../src/npc/personaSchema.js";
import { createNpcState } from "../src/npc/state.js";
import { SPECIES } from "../src/world/species.js";
import { createDemoWorld } from "../src/world/world.js";

const templates = loadCreatureTemplates();
const wolf = templates.wolf!;
const bandit = templates.bandit!;
const brena = parsePersona(brenaJson);
const hale = parsePersona(haleJson);
const pell = parsePersona(pellJson);
const villageOf = (...people: Array<[string, ReturnType<typeof parsePersona>]>): VillageNpc[] =>
  people.map(([id, persona]) => ({ id, persona, state: createNpcState(persona) }));
/** Rolls in this order, then the last one forever. */
const seq = (...values: number[]) => () => (values.length > 1 ? values.shift()! : values[0]!);
const gang = (n: number, rng = () => 0.5) => {
  const into: Record<string, Creature> = {};
  spawnGroup(bandit, n, into, 1, rng);
  return into;
};

describe("creatures' gear", () => {
  it("bandits carry their own copies of their gear, and a purse", () => {
    const b = spawnCreature(bandit, "bandit-1", 1, () => 0.5, "bandit 1");
    expect(b.equipment).toEqual({ weapon: "cudgel [F]", armor: "leather armor [F]" });
    expect(b.money).toBeGreaterThan(0);
    expect(spawnCreature(wolf, "wolf-1", 1, () => 0.5).equipment).toBeUndefined(); // teeth aren't gear
  });

  it("a bandit's cudgel wears with every blow, until it breaks and he fights bare-handed", () => {
    const world = createDemoWorld();
    const b = spawnCreature(bandit, "bandit-1", 1, () => 0.5, "bandit 1");
    b.hp = 1000;
    b.equipment!.weapon = "cudgel [F] (1/25)";
    const round = fightCreature(bandit, b, world, () => 0.999); // every blow lands
    expect(round.log).toContain("bandit 1's cudgel [F] broke!");
    expect(creatureWeapon(bandit, b).name).toBe("fists");
    expect(needsWeapon(bandit, b)).toBe(true);
  });

  it("the player's blows wear a bandit's armour, and it soaks damage", () => {
    const world = createDemoWorld();
    const b = spawnCreature(bandit, "bandit-1", 1, () => 0.5, "bandit 1");
    b.hp = 1000;
    fightCreature(bandit, b, world, () => 0.999);
    expect(b.equipment!.armor).toBe("leather armor [F] (39/40)");
  });

  it("rivals' duels wear their gear too", () => {
    const into = gang(2);
    const [a, b] = Object.values(into);
    rivalryDuel(bandit, a!, b!, 3, () => 0.999);
    expect(a!.equipment!.weapon).not.toBe("cudgel [F]");
  });

  it("a raid on a cart pays, and blunts the blade", () => {
    const b = spawnCreature(bandit, "bandit-1", 1, () => 0.5, "bandit 1");
    const before = b.money!;
    goHunting(bandit, b, 2, seq(0.1, 0.999, 0.5)); // goes out, a natural 20, then the take
    expect(b.money!).toBeGreaterThan(before);
    expect(b.equipment!.weapon).toBe("cudgel [F] (24/25)");
  });

  it("teeth don't wear and can't be mended, but they dull with age", () => {
    const young = spawnCreature(wolf, "wolf-1", 1, () => 0.5);
    const old = spawnCreature(wolf, "wolf-2", 1, () => 0.5);
    old.life = createLife(SPECIES.wolf!, 12, "F", 1); // venerable
    expect(creatureDamageBonus(wolf, young)).toBe(0);
    expect(creatureDamageBonus(wolf, old)).toBe(-2);
  });

  it("killing a bandit drops his actual gear, worn as it is, and his purse", () => {
    const world = createDemoWorld();
    const b = spawnCreature(bandit, "bandit-1", 1, () => 0.5, "bandit 1");
    b.equipment!.weapon = "cudgel [F] (7/25)";
    b.money = 33;
    b.hp = 1;
    const round = fightCreature(bandit, b, world, () => 0.999);
    expect(round.loot["cudgel [F] (7/25)"]).toBe(1);
    expect(Object.keys(round.loot).some((k) => k.startsWith("leather armor [F]"))).toBe(true); // worn by your blow
    expect(round.money).toBe(33);
  });

  it("old saves get gear and a purse", () => {
    const b = spawnCreature(bandit, "bandit-1", 1, () => 0.5);
    delete b.equipment;
    delete b.money;
    const up = upgradeCreature(bandit, b);
    expect(up.equipment).toEqual({ weapon: "cudgel [F]", armor: "leather armor [F]" });
    expect(up.money).toBeGreaterThan(0);
    expect(describeCreature(bandit, up, 1)).toContain("with cudgel [F] and leather armor [F]");
  });
});

describe("the black market", () => {
  it("an unarmed bandit buys a weapon from a dishonest villager, over the odds, in secret", () => {
    const creatures = gang(1);
    const b = Object.values(creatures)[0]!;
    b.equipment!.weapon = "cudgel [F] (0/25)";
    b.money = 1000;
    const village = villageOf(["brena", brena], ["hale", hale]);
    const { deals, log } = blackMarket(templates, creatures, village, 4);
    // Hale (honesty 0.1) sells; Brena (0.9) won't.
    expect(deals).toEqual([{ seller: "hale", buyer: b.uid, item: "dagger [E]", price: Math.ceil(180 * BLACK_MARKET_MARKUP) }]);
    expect(b.equipment!.weapon).toBe("dagger [E]");
    const haleState = village[1]!.state;
    expect(haleState.inventory["dagger [E]"]).toBeUndefined();
    expect(haleState.money).toBe(hale.startingMoney + 270);
    expect(haleState.memories.at(-1)?.text).toContain("secretly sold a dagger [E] to the bandits");
    expect(log).toEqual(["Rumour has it someone in Millbrook is selling weapons to the bandits."]);
  });

  it("no deal if nobody dishonest has a weapon they can use, or they can't pay", () => {
    const creatures = gang(1);
    const b = Object.values(creatures)[0]!;
    b.equipment = {};
    b.money = 1000;
    expect(blackMarket(templates, creatures, villageOf(["brena", brena]), 4).deals).toEqual([]); // honest
    expect(blackMarket(templates, creatures, villageOf(["pell", pell]), 4).deals).toEqual([]); // no weapons
    b.money = 10;
    expect(blackMarket(templates, creatures, villageOf(["hale", hale]), 4).deals).toEqual([]); // too poor
  });

  it("an armed bandit doesn't go shopping", () => {
    expect(blackMarket(templates, gang(1), villageOf(["hale", hale]), 4).deals).toEqual([]);
  });
});

describe("raids", () => {
  it("need enough armed bandits", () => {
    const creatures = gang(RAID_MIN - 1);
    const world = createDemoWorld();
    expect(considerRaid(templates, creatures, villageOf(["brena", brena], ["hale", hale]), world, () => 0).raid).toBeNull();
  });

  it("don't happen when the defenders are too strong", () => {
    const creatures = gang(3);
    for (const c of Object.values(creatures)) c.hp = 2; // battered: they don't feel strong
    const world = createDemoWorld();
    expect(considerRaid(templates, creatures, villageOf(["brena", brena], ["hale", hale]), world, () => 0).raid).toBeNull();
  });

  it("a winning raid carries off gear and coin from the richest shop", () => {
    const creatures = gang(6);
    for (const c of Object.values(creatures)) c.hp = 500; // tough lot
    const village = villageOf(["brena", brena], ["hale", hale], ["pell", pell]);
    const world = createDemoWorld();
    // They decide to go (0.1), then every blow lands.
    const { raid, log } = considerRaid(templates, creatures, village, world, seq(0.1, 0.999));
    expect(raid).toMatchObject({ target: "brena", winner: "bandits" });
    expect(raid!.taken).toHaveLength(3);
    expect(raid!.taken[0]).toMatch(/iron sword \[B\]/); // dearest gear first
    const carried = Object.values(creatures).flatMap((c) => Object.keys(c.pack ?? {}));
    expect(carried.length).toBeGreaterThan(0);
    expect(village[0]!.state.mood).toBe("afraid");
    expect(village[0]!.state.memories.at(-1)?.text).toContain("bandits raided Brena Ashford's place");
    expect(log[0]).toContain("Bandits raided Brena Ashford's place in the night");
    for (const v of village) expect(v.state.outcome).not.toBe("dead"); // villagers are beaten, not killed
  });

  it("the news reaches every NPC, not just the people involved", () => {
    const creatures = gang(6);
    for (const c of Object.values(creatures)) c.hp = 500;
    const village = villageOf(["brena", brena], ["hale", hale], ["pell", pell]);
    const world = createDemoWorld();
    considerRaid(templates, creatures, village, world, seq(0.1, 0.999));
    expect(world.recentEvents).toContain(RAID_NEWS.raided);
    // Pell wasn't there, but he hears about it.
    const msg = buildTurnMessage(pell, village[2]!.state, world, "Evening.");
    expect(msg).toContain("Bandits raided a shop in Millbrook during the night");
  });

  it("a beaten raid runs off, and the defenders learn from it", () => {
    // Bandits who rate themselves above two rank-G defenders, but are one blow from breaking.
    const creatures = gang(3);
    for (const c of Object.values(creatures)) c.hp = 13; // they break at 12
    const village = villageOf(["brena", brena], ["hale", hale]);
    village[0]!.state.life.tier = "G";
    village[1]!.state.life.tier = "G";
    const world = createDemoWorld();
    const { raid } = considerRaid(templates, creatures, village, world, seq(0.1, 0.999));
    expect(raid?.winner).toBe("village");
    for (const c of Object.values(creatures)) expect(c.outcome === "fled" || c.outcome === "dead").toBe(true);
    expect(village[1]!.state.memories.at(-1)?.text).toContain("helped drive a bandit raid off");
    expect(world.recentEvents).toContain(RAID_NEWS.repelled);
  });
});
