import { beforeEach, describe, expect, it, vi } from "vitest";
import { config } from "../src/config.js";
import { loadCreatureTemplates } from "../src/game/creatures.js";
import { addGrievance, settleAll } from "../src/game/chatter/grievance.js";
import { WorldStore } from "../src/game/db.js";
import { seededRng } from "../src/game/dice.js";
import { itemKey } from "../src/game/items.js";
import { chooseNemesis, endings, nemesisDay, nemesisPower, survivedPlayer } from "../src/game/nemesis/day.js";
import { dayWords, nemesesOf, strikeEvery } from "../src/game/nemesis/model.js";
import { checkNemesisBounds } from "../src/game/nemesis/bounds.js";
import { killFigure, makeFigure } from "../src/game/realm/figures.js";
import { playerPower } from "../src/game/realm/wilds.js";
import { newWorld } from "../src/game/save.js";
import { Town } from "../src/game/town.js";
import { materialisePeople } from "../src/store/materialise.js";
import { FakeProvider } from "./helpers.js";

/**
 * N44: a nemesis. Someone the player beat and let go remembers every meeting, learns how the player fights and prepares against it,
 * rises, strikes at what the player has, and comes back with a taunt naming the day they met. People are found by role, never by name.
 */
vi.setConfig({ testTimeout: 300_000, hookTimeout: 300_000 });

beforeEach(() => {
  config.realm = true;
  config.realmSeed = undefined;
  config.director = false;
  config.planning = false;
  config.firstHour = false;
  config.nemesis = true;
});

function game(seed = 1) {
  const templates = loadCreatureTemplates();
  const store = new WorldStore(":memory:");
  const world = newWorld({}, templates, Math.random, seed);
  materialisePeople(world.realm!, store.people, 1);
  const town = new Town({ personas: {}, creatureTemplates: templates, world, llm: new FakeProvider(), store, stories: false });
  return { town, world, store, realm: world.realm! };
}

/** A gang's man, not its chief: someone the player could beat on the road. */
function banditOf(realm: ReturnType<typeof game>["realm"]) {
  const gang = Object.values(realm.factions).filter((f) => f.kind === "gang" && f.dissolved === undefined && f.members.filter((m) => realm.figures[m]?.alive).length >= 3).sort((a, b) => a.id.localeCompare(b.id))[0]!;
  const id = gang.members.find((m) => m !== gang.leader && realm.figures[m]?.alive)!;
  return { gang, bandit: realm.figures[id]! };
}

describe("N44 step 1: spared and survived", () => {
  it("beating a bandit and letting them go records a spared event, a grievance and a meeting", () => {
    const { town, world, store, realm } = game(1);
    const site = town.site();
    world.player.equipment = { ...(world.player.equipment ?? {}), weapon: itemKey("spear") };
    // A man of a gang on the map, beaten and running.
    const c = Object.values(town.creaturesHere()).find((x) => x.figure && x.den === "camp");
    const { bandit, gang } = banditOf(realm);
    const id = c
      ? (() => {
          c.outcome = "fled";
          c.hp = 1;
          town.settleHaunts();
          return c.figure!;
        })()
      : survivedPlayer(town, { figure: bandit.id, name: bandit.name, gang: gang.id, outcome: "spared", companions: 0, site, day: world.day })!;
    const meetings = nemesesOf(realm).meetings[id]!;
    expect(meetings.length).toBe(1);
    expect(meetings[0]!.playerUsed.weapon).toBe("spear");
    expect(store.social.openBetween(id, "player").length).toBeGreaterThan(0);
    expect(store.recentEvents({ limit: 50 }).some((e) => e.kind === "spared" && e.target === id)).toBe(true);
    town.close();
  });

  it("an outlaw the realm had no name for is made a figure of their gang, so they persist", () => {
    const { town, world, realm } = game(2);
    const { gang } = banditOf(realm);
    const id = survivedPlayer(town, { name: "Scarface", gang: gang.id, outcome: "fled", companions: 1, site: town.site(), day: world.day })!;
    expect(realm.figures[id]?.name).toBe("Scarface");
    expect(realm.factions[gang.id]!.members).toContain(id);
    town.close();
  });
});

describe("N44 step 2: candidates and the record", () => {
  it("the strongest grudge among those who survived becomes the nemesis, and there are never more than two", () => {
    const { town, world, store, realm } = game(3);
    const site = town.site();
    const foes = [0, 1, 2, 3].map((i) => makeFigure(realm, seededRng(100 + i), { role: "bandit", home: null, tier: "E", age: 25 }, 1));
    foes.forEach((f, i) => {
      f.ambition = 0.3 + i * 0.2;
      f.bravery = 0.5;
      f.renown = 0;
      survivedPlayer(town, { figure: f.id, name: f.name, outcome: "spared", companions: 0, site, day: 1 });
      addGrievance(store, { who: f.id, against: "player", cause: `test:${i}`, weight: 0.2 * i, day: 1 });
    });
    const first = chooseNemesis(town, 2)!;
    expect(first.who).toBe(foes[3]!.id);
    for (let d = 3; d < 10; d++) chooseNemesis(town, d);
    expect(nemesesOf(realm).list.length).toBeLessThanOrEqual(2);
    // They are followed: the player will hear of them.
    expect(world.player.follows?.[first.who]?.why).toBe("nemesis");
    town.close();
  });
});

describe("N44 steps 3-6: the done-when", () => {
  it("a bandit the player beat with a spear and let go returns months later as a lieutenant with a shield against the spear, names the day they met, and has hired men to burn the player's room", () => {
    const { town, world, store, realm } = game(1);
    const site = town.site();
    world.player.equipment = { ...(world.player.equipment ?? {}), weapon: itemKey("spear") };
    const { bandit, gang } = banditOf(realm);
    // Twice beaten with a spear, twice let go.
    survivedPlayer(town, { figure: bandit.id, name: bandit.name, gang: gang.id, outcome: "spared", companions: 0, site, day: 1 });
    survivedPlayer(town, { figure: bandit.id, name: bandit.name, gang: gang.id, outcome: "spared", companions: 0, site, day: 3 });
    let n = nemesesOf(realm).list[0];
    for (let d = 3; d <= 3 + strikeEvery() * 4 && !n?.taunt; d++) {
      world.day = d;
      nemesisDay(town, d);
      n = nemesesOf(realm).list[0];
    }
    n = nemesesOf(realm).list.find((x) => x.who === bandit.id)!;
    expect(n).toBeDefined();
    // Prepared: a shield against the spear (a real item they carry).
    expect(n.knows.weapons.spear).toBe(2);
    expect(n.prepared).toContain("shield");
    const shield = (bandit.items ?? []).map((id) => store.notables.get(id)).find((r) => r?.base === "wooden shield");
    expect(shield).toBeDefined();
    // Risen: their gang's lieutenant (N55's sergeant later).
    expect(n.rank).toContain("lieutenant");
    // Struck: hired men set fire to the player's room at the inn.
    expect(n.struck.length).toBeGreaterThan(0);
    expect([...store.marks.of(n.struck[0]!.site!).values()].some((m) => m.kind === "burned" && m.label?.includes(bandit.name))).toBe(true);
    expect(store.recentEvents({ limit: 100 }).some((e) => e.kind === "revenge" && e.details.includes("set fire"))).toBe(true);
    // Coming back, with a taunt that names the day and the place they first met.
    expect(n.taunt).toContain(dayWords(1));
    expect(n.taunt).toContain(realm.settlements[site]!.name);
    expect(world.sites[site]!.rules.some((r) => r.who?.some((w) => w.figure === bandit.id))).toBe(true);
    // Prepared, not overwhelming.
    expect(nemesisPower(realm, n, world.player)).toBeLessThanOrEqual(playerPower(world.player) * 2);
    expect(checkNemesisBounds(realm).every((b) => b.ok)).toBe(true);
    town.close();
  });
});

describe("N44 step 7: endings", () => {
  it("a nemesis can be won over, or killed for good", () => {
    const { town, store, realm } = game(4);
    const site = town.site();
    const a = makeFigure(realm, seededRng(7), { role: "bandit", home: null, tier: "E", age: 25 }, 1);
    survivedPlayer(town, { figure: a.id, name: a.name, outcome: "spared", companions: 0, site, day: 1 });
    chooseNemesis(town, 2);
    expect(nemesesOf(realm).list[0]!.stage).toBe("rising");
    settleAll(store, a.id, "player", 3);
    endings(town, 3);
    expect(nemesesOf(realm).list[0]!.stage).toBe("won_over");
    const b = makeFigure(realm, seededRng(8), { role: "bandit", home: null, tier: "E", age: 25 }, 1);
    survivedPlayer(town, { figure: b.id, name: b.name, outcome: "spared", companions: 0, site, day: 4 });
    chooseNemesis(town, 5);
    killFigure(realm, b, 6, "killed by the player");
    endings(town, 6);
    expect(nemesesOf(realm).list.find((x) => x.who === b.id)!.stage).toBe("dead");
    town.close();
  });
});
