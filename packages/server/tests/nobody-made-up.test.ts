/**
 * N26F step 0b: nobody made up (plans README section 21). Every raider, ambusher, lookout, deserter and outlaw met on a
 * map or on the road is a realm figure or a row of the `people` table, by name. A spawn rule for a person kind that names
 * nobody spawns nobody, and a guard (`madeUpPeople`, the `nobody-made-up` bound) checks every map.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { config } from "../src/config.js";
import { WorldStore } from "../src/game/db.js";
import { loadCreatureTemplates } from "../src/game/creatures.js";
import { seededRng } from "../src/game/dice.js";
import { applyArrivals, sendArrival } from "../src/game/realm/arrivals.js";
import { rulesFor } from "../src/game/realm/spawnrules.js";
import { desertersNear, gangFoe } from "../src/game/realm/travel.js";
import type { Realm } from "../src/game/realm/types.js";
import { gangMembers, pickFighters } from "../src/game/realm/who.js";
import { madeUpPeople, nobodyMadeUpBound } from "../src/game/road/bounds.js";
import { newWorld } from "../src/game/save.js";
import { applySpawnRules, isPersonKind, type SpawnRule } from "../src/game/spawning.js";
import { Town } from "../src/game/town.js";
import type { PersonRow } from "../src/store/peopleStore.js";
import { materialisePeople } from "../src/store/materialise.js";
import { always, FakeProvider } from "./helpers.js";

vi.setConfig({ testTimeout: 120_000 });
beforeEach(() => {
  config.director = false;
  config.planning = false;
  config.summaries = false;
  config.realm = true;
  config.realmSeed = undefined;
});

const templates = loadCreatureTemplates();
const personKinds = new Set(Object.values(templates).filter(isPersonKind).map((t) => t.id));

/** A town with the people table, every place's people made. */
const peopleTown = (seed = 1): Town => {
  const store = new WorldStore(":memory:");
  const world = newWorld({}, templates, always(0.5), seed);
  materialisePeople(world.realm!, store.people, world.day);
  return new Town({ personas: {}, creatureTemplates: templates, world, llm: new FakeProvider(), store });
};

/** A gang with at least `n` members about, anywhere. */
const gangWith = (realm: Realm, n: number) => Object.values(realm.factions).find((f) => f.kind === "gang" && f.dissolved === undefined && gangMembers(realm, f.id).length >= n);

/** Night on the place's map, so raiders' rules are due. */
function atNight(town: Town): void {
  town.world.hour = 22;
  town.world.minute = 0;
}

const madeUp = (town: Town) => madeUpPeople(town.world.realm!, town.world.sites ?? {}, personKinds, town.store?.people);

describe("N26F step 0b: nobody made up", () => {
  it("a spawn rule for a person kind with nobody named spawns nobody; one with people spawns exactly them", () => {
    const creatures = {};
    const world = { day: 1, hour: 12, recentEvents: [], player: { quests: { active: [] } } } as never;
    const nameless: SpawnRule = { id: "x", creature: "bandit", count: 3 };
    applySpawnRules([nameless], templates, creatures, {}, world, seededRng(1));
    expect(Object.keys(creatures)).toHaveLength(0);
    const named: SpawnRule = { id: "y", creature: "bandit", count: 9, who: [{ name: "Hob Tanner", figure: "hob" }, { name: "Ada Reed", person: "p1" }] };
    applySpawnRules([named], templates, creatures, {}, world, seededRng(1));
    const made = Object.values(creatures) as Array<{ name: string; figure?: string; person?: string }>;
    expect(made.map((c) => c.name).sort()).toEqual(["Ada Reed", "Hob Tanner"]);
    expect(made.find((c) => c.name === "Hob Tanner")!.figure).toBe("hob");
    expect(made.find((c) => c.name === "Ada Reed")!.person).toBe("p1");
    // Beasts aren't people: a wolf rule needs no names.
    applySpawnRules([{ id: "w", creature: "wolf", count: 2 }], templates, creatures, {}, world, seededRng(1));
    expect(Object.values(creatures).filter((c) => (c as { template: string }).template === "wolf")).toHaveLength(2);
  });

  it("a raid on the start town brings named members of the raiding gang", () => {
    const town = peopleTown(1);
    const realm = town.world.realm!;
    const site = town.site();
    const gang = gangWith(realm, 2)!;
    expect(gang).toBeDefined();
    const ids = gangMembers(realm, gang.id).map((f) => f.id);
    sendArrival(realm, site, { day: town.world.day, kind: "raid", count: 3, by: gang.name, who: ids });
    atNight(town);
    const lines = applyArrivals(realm, town.world, site, [], Object.keys(templates));
    expect(lines.join(" ")).toContain(realm.figures[ids[0]!]!.name);
    town.respawn();
    const raiders = Object.values(town.creaturesHere()).filter((c) => c.template === "bandit" && !c.packId);
    expect(raiders.length).toBeGreaterThan(0);
    for (const c of raiders) {
      expect(ids).toContain(c.figure);
      expect(c.name).toBe(realm.figures[c.figure!]!.name);
    }
    expect(madeUp(town)).toEqual([]);
  });

  it("raiders from a settlement are its own people, rows of the table", () => {
    const town = peopleTown(1);
    const realm = town.world.realm!;
    const site = town.site();
    const from = realm.settlements[site]!.roads.find((id) => realm.settlements[id] && !realm.settlements[id]!.way)!;
    sendArrival(realm, site, { day: town.world.day, kind: "raid", count: 4, by: realm.settlements[from]!.name, from });
    atNight(town);
    applyArrivals(realm, town.world, site, [], Object.keys(templates), (f, n, k) => pickFighters(town.store!.people, f, n, town.world.day, k));
    town.respawn();
    const raiders = Object.values(town.creaturesHere()).filter((c) => c.template === "bandit" && c.person);
    expect(raiders.length).toBe(4);
    for (const c of raiders) {
      const row = town.store!.people.get(c.person!) as PersonRow;
      expect(row.site).toBe(from);
      expect(row.name).toBe(c.name);
      expect(row.death).toBeNull();
    }
    expect(madeUp(town)).toEqual([]);
  });

  it("refugees at the gate aren't made up: nobody is spawned for them", () => {
    const town = peopleTown(1);
    const realm = town.world.realm!;
    const site = town.site();
    sendArrival(realm, site, { day: town.world.day, kind: "refugees", count: 4, by: "Somewhere" });
    const lines = applyArrivals(realm, town.world, site, [], Object.keys(templates));
    expect(lines.join(" ")).toMatch(/come up the road/);
    town.respawn();
    expect(Object.values(town.creaturesHere()).filter((c) => c.template === "villager")).toHaveLength(0);
  });

  it("a gang's night lookout is one of its members, by name", () => {
    const town = peopleTown(1);
    const realm = town.world.realm!;
    const gang = gangWith(realm, 3)!;
    gang.seat ??= town.site();
    const rules = rulesFor(realm, gang.seat);
    const lookout = rules.find((r) => r.id === `gen_lookout_${gang.id}`)!;
    expect(lookout.who).toHaveLength(1);
    expect(gang.members).toContain(lookout.who![0]!.figure);
  });

  it("a revenge ambush is led by the person who wants revenge, with real helpers", () => {
    const town = peopleTown(1);
    const store = town.store!;
    // A grown townsperson of the start town with kin at home.
    const rows = store.people.loadSite(town.site(), "full") as PersonRow[];
    const grown = rows.filter((r) => r.death === null && !r.away && r.persona === null && (town.world.day - r.born_day) / config.daysPerYear >= 25);
    const avenger = grown[0]!;
    // Families form as people live (N25); on day 1 nobody is wed yet, so wed them to a neighbour.
    store.people.update(avenger.id, { spouse: grown[1]!.id });
    store.people.update(grown[1]!.id, { spouse: avenger.id });
    // Make them a talker (their persona id is their row id, as for every townsperson who talks).
    (town.personas as Record<string, unknown>)[avenger.id] ??= { id: avenger.id, name: avenger.name };
    const party = town.revengeParty(avenger.id);
    expect(party.length).toBeGreaterThan(1);
    expect(party[0]).toMatchObject({ name: avenger.name, person: avenger.id });
    expect(party[1]).toMatchObject({ name: grown[1]!.name, person: grown[1]!.id });
    for (const w of party.slice(1)) {
      if (w.person) expect(store.people.get(w.person)!.death).toBeNull();
      if (w.figure) expect(town.world.realm!.figures[w.figure]!.alive).toBe(true);
    }
  });

  it("a gang met on the road is its members, by name, and deserters are soldiers of the enemy or nobody", () => {
    const town = peopleTown(1);
    const realm = town.world.realm!;
    const gang = gangWith(realm, 2)!;
    const foe = gangFoe(realm, gang, seededRng(3))!;
    expect(foe.who!.length).toBeGreaterThanOrEqual(2);
    for (const id of foe.who!) expect(gang.members).toContain(id);
    // With nobody about, no gang is met.
    for (const id of gang.members) realm.figures[id]!.alive = false;
    expect(gangFoe(realm, gang, seededRng(3))).toBeNull();
    // Deserters: only where a war is on, and only real soldiers of the other side.
    const s = realm.settlements[town.site()]!;
    const d = desertersNear(realm, s, 1, seededRng(1));
    if (d) for (const id of d.who!) expect(["guard", "captain"]).toContain(realm.figures[id]!.role);
    // Not at war: nobody deserts.
    realm.wars = [];
    expect(desertersNear(realm, s, 1, seededRng(1))).toBeNull();
  });

  it("three days of play, raids and all, leave nobody made up on any map", () => {
    const town = peopleTown(2);
    const realm = town.world.realm!;
    const gang = gangWith(realm, 2);
    if (gang) sendArrival(realm, town.site(), { day: town.world.day, kind: "raid", count: 3, by: gang.name, who: gang.members });
    for (let i = 0; i < 6; i++) town.passHours(12);
    const b = nobodyMadeUpBound(realm, town.world.sites ?? {}, personKinds, town.store?.people);
    expect(b.detail).toBe("everyone on the maps is someone");
    expect(b.ok).toBe(true);
  });
});
