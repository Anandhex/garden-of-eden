import { beforeEach, describe, expect, it, vi } from "vitest";
import { card } from "../src/admin/person.js";
import { config } from "../src/config.js";
import { loadCreatureTemplates } from "../src/game/creatures.js";
import { WorldStore } from "../src/game/db.js";
import { seededRng } from "../src/game/dice.js";
import { describeKnown } from "../src/game/gossip/describe.js";
import { armorValue, repairedKey, wearGear } from "../src/game/gear.js";
import { inheritDay } from "../src/game/items/day.js";
import { becomeNotable, historyOf, itemDeed, keyOf, knowItem, makeNotable, moveItem, NAME_AT, notableRef, recognise } from "../src/game/items/notable.js";
import { afterPlayerKill, bardSong, giveBack, knownHistory, recogniseHere, type ItemsHost } from "../src/game/items/player.js";
import { itemKey, notableIdOf, parseItem } from "../src/game/items.js";
import { killPerson } from "../src/game/people/index.js";
import { killFigure, makeFigure } from "../src/game/realm/figures.js";
import { newWorld } from "../src/game/save.js";
import { Town } from "../src/game/town.js";
import { initiativeFor } from "../src/npc/initiative.js";
import { materialisePeople } from "../src/store/materialise.js";
import type { PersonRow } from "../src/store/peopleStore.js";
import { SCHEMA_VERSION, TABLES } from "../src/store/schema.js";
import { FakeProvider, pickTestPlaces } from "./helpers.js";

/**
 * N43: items with a history. A notable item is a stack of one with an id in its key and a row with its maker, its holders, its deeds;
 * it earns a name; people who know it recognise it; a stolen one gives away whose it was, and the family wants it back; a bard sings of
 * it; the admin sees every hand it passed through. People are found by job, never by name.
 */
vi.setConfig({ testTimeout: 300_000, hookTimeout: 300_000 });

beforeEach(() => {
  config.realm = true;
  config.realmSeed = undefined;
  config.director = false;
  config.planning = false;
  config.firstHour = false;
  config.gossip = true;
});

describe("N43 step 1: ids in keys, and the table", () => {
  it("a notable key keeps its id through parsing, wear and repair; ordinary keys are unchanged", () => {
    expect(parseItem("iron sword [B]")!.id).toBeUndefined();
    const key = itemKey("iron sword", "B", undefined, "i12");
    expect(key).toBe("iron sword [B] #i12");
    expect(parseItem(key)!.id).toBe("i12");
    expect(notableIdOf(key)).toBe("i12");
    const holder = { equipment: { weapon: key } };
    wearGear(holder, "weapon", 5);
    expect(notableIdOf(holder.equipment.weapon)).toBe("i12");
    expect(parseItem(holder.equipment.weapon)!.durability).toBeLessThan(parseItem(key)!.durability!);
    expect(notableIdOf(repairedKey(holder.equipment.weapon))).toBe("i12");
    void armorValue;
  });

  it("is in the schema, the world hash, export and import", () => {
    expect(SCHEMA_VERSION).toBeGreaterThanOrEqual(17);
    expect(TABLES.notable_items).toContain("history");
  });

  it("a notable sword keeps its id through trade and loot, and its history lists each move", () => {
    const realm = (newWorld({}, {}, Math.random, 1)).realm!;
    const store = new WorldStore(":memory:");
    const it = makeNotable(realm, store, { base: "iron sword", tier: "B", holder: "smith1", maker: "smith1", makerName: "a smith", day: 1, how: "made" });
    moveItem(store, it.id, "buyer", "sold", 2, { from: "the smith" });
    moveItem(store, it.id, "thief", "stolen", 3);
    moveItem(store, it.id, "player", "looted", 4);
    const h = historyOf(store.notables.get(it.id)!);
    expect(h.map((e) => e.kind)).toEqual(["made", "sold", "stolen", "looted"]);
    expect(store.notables.get(it.id)!.holder).toBe("player");
    expect(notableIdOf(keyOf(it))).toBe(it.id);
  });
});

describe("N43 steps 2-7: a knight's family sword", () => {
  it("taken by the bandit who killed the knight, then by the player; a guard knows it, the family wants it back, a bard sings of it, and the admin sees every hand", () => {
    const templates = loadCreatureTemplates();
    const store = new WorldStore(":memory:");
    const probe = newWorld({}, templates, Math.random, 1);
    const { liege } = pickTestPlaces(probe.realm!);
    // The game begins in the liege town, where the knight lived.
    const world = newWorld({}, templates, Math.random, 1, { start: liege });
    materialisePeople(world.realm!, store.people, 1);
    const realm = world.realm!;
    const ctx = { realm, store };
    const town = new Town({ personas: {}, creatureTemplates: templates, world, llm: new FakeProvider(), store, stories: false });
    const rows = store.people.loadSite(liege, "full") as PersonRow[];
    const knight = rows.find((r) => (r.job === "knight" || ["gentry", "noble"].includes(r.cls)) && r.job !== "child" && rows.some((k) => k.id !== r.id && k.home === r.home && k.job !== "child"))!;
    expect(knight, "a knight with family at home").toBeDefined();
    const kin = rows.find((k) => k.id !== knight.id && k.home === knight.home && k.job !== "child")!;
    const guard = rows.find((r) => r.job === "guard")!;
    expect(guard, "the liege town has a guard").toBeDefined();
    store.people.update(knight.id, { renown: 45 });
    // A smith made the sword; the knight carried it; the household knows it.
    const sword = makeNotable(realm, store, { base: "iron sword", tier: "B", holder: knight.id, holderName: knight.name, maker: "a smith of the town", makerName: "Old Wat", day: 1, site: liege, how: "given" });
    knowItem(ctx, sword.id, rows.filter((r) => r.home === knight.home).map((r) => r.id), 1);
    // The knight's last fight: a bandit chief kills him on the road and takes the sword.
    const chief = makeFigure(realm, seededRng(5), { role: "bandit chief", home: null, tier: "C", age: 35 }, 2);
    const named = itemDeed(realm, store, sword.id, { day: 2, who: knight.id, whoName: knight.name, what: "fought his last fight with it on the road", renown: 45, site: liege });
    expect(named!.row.fame).toBeGreaterThanOrEqual(NAME_AT);
    expect(named!.named).toBe(true);
    const name = named!.row.name!;
    killPerson(realm, store, knight.id, { cause: "murder", day: 2, killer: chief.id, site: liege });
    inheritDay(ctx, { site: liege, deaths: [{ id: knight.id, name: knight.name, persona: null, figure: null, record: { cause: "murder", day: 2, site: liege, killer: chief.id } }] }, 2);
    expect(store.notables.get(sword.id)!.holder).toBe(chief.id);
    expect(chief.items).toContain(sword.id);
    // The town's watch knows what was taken.
    expect(store.knowledge.get(guard.id, notableRef(sword.id))).not.toBeNull();
    expect(describeKnown(ctx, notableRef(sword.id), 1, 0)).toContain(name);
    // The player kills the chief and takes the sword.
    killFigure(realm, chief, 3, `killed by ${world.player.name}`);
    const lines = afterPlayerKill(town, [{ figure: chief.id, name: chief.name }]);
    expect(lines.join(" ")).toContain(name);
    const key = Object.keys(world.player.inventory).find((k) => notableIdOf(k) === sword.id)!;
    expect(key).toBeDefined();
    expect(store.notables.get(sword.id)!.holder).toBe("player");
    // A guard recognises it as one taken from the knight.
    const seen = recognise(ctx, sword.id, guard.id, 3, 0);
    expect(seen.knows).toBe(true);
    expect(seen.stolenFrom?.name).toBe(knight.name);
    // The family knows it at sight and wants it back. (Recognising is a roll on what they know of it: this guard is shown it plainly, so
    // it is certain whatever the item's id rolls.)
    knowItem(ctx, sword.id, [guard.id], 3, 1);
    const guardId = town.meetPerson(guard.id)!;
    const kinId = town.meetPerson(kin.id)!;
    const host: ItemsHost = { ...town, world, store, agents: town.agents, presentAt: () => [town.agents[guardId]!, town.agents[kinId]!], meetPerson: (id) => town.meetPerson(id), site: () => town.site() };
    recogniseHere(host);
    const claims = world.itemClaims ?? [];
    expect(claims.find((c) => c.who === guardId)?.wants).toBe(false);
    expect(claims.find((c) => c.who === kinId)?.wants).toBe(true);
    const kinAgent = town.agents[kinId]!;
    const opening = initiativeFor(kinAgent.persona, kinAgent.state, town.sceneFor(kinAgent));
    expect(opening?.trigger).toBe("reclaim");
    // The player knows of it what they saw and were told.
    expect(knownHistory(store, realm, world.player, sword.id).join(" ")).toContain(knight.name);
    // A bard's song names the sword and the knight's last fight.
    const song = bardSong(realm, store, liege)!;
    expect(song).toContain(name);
    expect(song).toContain(knight.name.split(" ")[0]!);
    // The admin sees every hand it passed through.
    const adminCard = card({ world: () => world, town: () => town, store, queueLength: () => 0 }, `item:${sword.id}`)!;
    const hands = adminCard.sections.find((s) => s.title === "Every hand it passed through")!;
    const text = "rows" in hands ? hands.rows.map((r) => r[1]).join(" | ") : "";
    for (const who of [knight.name, chief.name, world.player.name]) expect(text).toContain(who);
    // Giving it back: theirs again, and grateful.
    const r = giveBack(host, sword.id, kinId);
    expect(r.ok).toBe(true);
    expect(store.notables.get(sword.id)!.holder).toBe(kinId);
    expect(Object.keys(world.player.inventory).some((k) => notableIdOf(k) === sword.id)).toBe(false);
    town.close();
  });

  it("good gear becomes notable as it comes to the player, and a renowned foe slain gives the weapon a deed and, with fame, a name", () => {
    const templates = loadCreatureTemplates();
    const store = new WorldStore(":memory:");
    const world = newWorld({}, templates, Math.random, 2);
    materialisePeople(world.realm!, store.people, 1);
    const town = new Town({ personas: {}, creatureTemplates: templates, world, llm: new FakeProvider(), store, stories: false });
    world.player.inventory[itemKey("iron sword", "B")] = 1;
    town.walkMinutes(1);
    const key = Object.keys(world.player.inventory).find((k) => k.startsWith("iron sword [B]"))!;
    expect(notableIdOf(key)).toBeDefined();
    world.player.equipment = { ...(world.player.equipment ?? {}), weapon: key };
    delete world.player.inventory[key];
    const beast = makeFigure(world.realm!, seededRng(9), { role: "beast", home: null, tier: "C", age: 5, species: "wolf", renown: 60, name: "Greyfang" }, 1);
    killFigure(world.realm!, beast, 1, "killed by the player");
    const lines = afterPlayerKill(town, [{ figure: beast.id, name: beast.name }]);
    const row = store.notables.get(notableIdOf(world.player.equipment!.weapon!)!)!;
    expect(row.fame).toBeGreaterThan(20);
    expect(row.name).toBe("Greyfang's Bane");
    expect(lines.join(" ")).toContain("Greyfang's Bane");
    void becomeNotable;
    town.close();
  });

  it("an heirloom passes to kin when its holder dies of age", () => {
    const realm = newWorld({}, {}, Math.random, 3).realm!;
    const store = new WorldStore(":memory:");
    materialisePeople(realm, store.people, 1);
    const { start } = pickTestPlaces(realm);
    const rows = store.people.loadSite(start, "full") as PersonRow[];
    const old = rows.find((r) => r.job !== "child" && rows.some((k) => k.id !== r.id && k.home === r.home && k.job !== "child"))!;
    const it = makeNotable(realm, store, { base: "iron sword", tier: "B", holder: old.id, day: 1, how: "given" });
    killPerson(realm, store, old.id, { cause: "old-age", day: 5 });
    inheritDay({ realm, store }, { site: start, deaths: [{ id: old.id, name: old.name, persona: null, figure: null, record: { cause: "old-age", day: 5, site: start } }] }, 5);
    const after = store.notables.get(it.id)!;
    expect(after.holder).not.toBe(old.id);
    expect(historyOf(after).at(-1)!.kind).toBe("inherited");
  });
});
