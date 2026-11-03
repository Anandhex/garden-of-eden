import { beforeEach, describe, expect, it, vi } from "vitest";
import { config } from "../src/config.js";
import { WorldStore } from "../src/game/db.js";
import { seededRng } from "../src/game/dice.js";
import { dragonWakes, peoplesRealmDay, residentsSiteDay } from "../src/game/peoples/day.js";
import { generatePeoples, peoplesOf } from "../src/game/peoples/generate.js";
import type { LifeCtx } from "../src/game/people/step.js";
import { generateRealm } from "../src/game/realm/generate.js";
import { policyOf, policyRealmDay, setPolicy } from "../src/game/realm/policy.js";
import { pickStartSite } from "../src/game/realm/start.js";
import { speciesOf, stanceOf } from "../src/world/species.js";
import type { PersonRow } from "../src/store/peopleStore.js";
import { materialisePeople } from "../src/store/materialise.js";

/**
 * N54: peoples and monsters. Species as data; a goblin warren near the start town with an ogre bound to it, an orc kingdom in the east, a
 * dwarf hold, a centaur herd that moves with the seasons, a dragon in the northern peaks; raids, a war of old hatred and a call for help,
 * goblins living among people where the law lets them, orcs kept only as slaves in the slave kingdom, and a dragon's fire and tribute.
 */
vi.setConfig({ testTimeout: 300_000, hookTimeout: 300_000 });

beforeEach(() => {
  config.realm = true;
  config.realmSeed = undefined;
  config.society.peoples = true;
});

describe("N54 Part A: species as data", () => {
  it("the peoples load into the species table with their lives, minds and stances; humans are as they were", () => {
    expect(speciesOf("human").adultAge).toBe(16);
    expect(speciesOf("goblin").maxAge).toBeGreaterThan(30);
    expect(speciesOf("dragon").maxTier).toBe("SSS");
    expect(stanceOf("dwarf", "goblin")).toBeLessThan(-50);
    expect(stanceOf("goblin", "ogre")).toBeGreaterThan(0);
  });
});

describe("N54 Part B: the realm generates its peoples", () => {
  it("a goblin warren in the hills near the start town, an orc kingdom in the east, a herd that moves with the seasons, a dragon in the northern peaks", () => {
    const realm = generateRealm(1, 1);
    const humans = Object.values(realm.settlements).filter((s) => !s.way);
    const st = generatePeoples(realm, 1)!;
    const warren = realm.settlements[st.warren!]!;
    const start = realm.settlements[pickStartSite(realm, realm.seed)]!;
    expect(warren.species).toBe("goblin");
    expect(warren.terrain).toBe("hills");
    // Near: closer to the start town than most places are.
    const d = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
    const farther = humans.filter((s) => d(s.pos, start.pos) > d(warren.pos, start.pos)).length;
    expect(farther / humans.length).toBeGreaterThan(0.5);
    const orcs = realm.kingdoms[st.orcs!]!;
    expect(orcs.species).toBe("orc");
    expect(realm.settlements[orcs.capital]!.pos.x).toBeGreaterThan(Math.max(...humans.map((s) => s.pos.x)));
    expect(realm.figures[orcs.ruler!]!.species).toBe("orc");
    const lair = st.lairs[st.dragon!]!;
    expect(lair.y).toBeLessThan(Math.min(...humans.map((s) => s.pos.y)));
    expect(realm.figures[st.dragon!]!.species).toBe("dragon");
    // The herd moves with the seasons.
    const herd = realm.settlements[st.herd!]!;
    const seen = new Set<string>();
    for (let day = 1; day <= 48; day++) {
      peoplesRealmDay(realm, day);
      seen.add(`${herd.pos.x},${herd.pos.y}`);
    }
    expect(seen.size).toBe(4);
  });
});

describe("N54 Part C: relations and intentions", () => {
  it("the goblins raid toward the mine road and have a pact with an ogre", () => {
    const realm = generateRealm(1, 1);
    const st = generatePeoples(realm, 1)!;
    expect(realm.treaties.some((t) => t.kind === "service" && t.a === `s:${st.warren}` && t.b === `p:${st.ogre}`)).toBe(true);
    for (let day = 1; day <= 96; day++) peoplesRealmDay(realm, day);
    expect(realm.news.some((n) => n.kind === "raid" && n.text.includes("Goblins") && /mine road/.test(n.text))).toBe(true);
  });

  it("the orc kingdom wars with the dwarves, and the dwarves seek help from a human crown", () => {
    const realm = generateRealm(1, 1);
    const st = generatePeoples(realm, 1)!;
    for (let day = 1; day <= 200 && st.asked.length === 0; day++) peoplesRealmDay(realm, day);
    expect(realm.wars.some((w) => w.attackers.includes(`k:${st.orcs}`) && w.defenders.includes(`k:${st.dwarves}`))).toBe(true);
    expect(st.asked.length).toBeGreaterThan(0);
    const ask = st.asked[0]!;
    expect(realm.kingdoms[ask.of]!.species).toBeUndefined();
    expect(realm.news.some((n) => n.text.includes("asked") && n.text.includes("for help against"))).toBe(true);
  });

  it("a clever goblin lives in the liege town's outer quarter because its kingdom tolerates goblins, while the slave kingdom keeps orcs only as slaves", () => {
    const realm = generateRealm(1, 1);
    const store = new WorldStore(":memory:");
    materialisePeople(realm, store.people, 1);
    const ctx: LifeCtx = { realm, store };
    const st = generatePeoples(realm, 1)!;
    policyRealmDay(realm, 1);
    const warren = realm.settlements[st.warren!]!;
    const town = Object.values(realm.settlements).filter((s) => !s.species && !s.way && s.kingdom).sort((a, b) => Math.hypot(a.pos.x - warren.pos.x, a.pos.y - warren.pos.y) - Math.hypot(b.pos.x - warren.pos.x, b.pos.y - warren.pos.y))[0]!;
    setPolicy(realm, town.kingdom!, "species:goblin", "limited", 1, "test");
    let id: string | null = null;
    for (let day = 1; day <= 200 && !id; day++) id = residentsSiteDay(ctx, town.id, day);
    expect(id).not.toBeNull();
    const row = store.people.get(id!)!;
    expect(row.species).toBe("goblin");
    expect(JSON.parse(row.origin!).site).toBe(warren.id);
    const map = (await_map(realm, town.id));
    expect(["d:noble", "d:castle", "d:palace", "d:manor"]).not.toContain(map[row.home!] ?? "");
    // Some of the goblins who come can talk with anyone.
    expect(st.residents.find((r) => r.id === id)).toBeDefined();
    // The slave kingdom: orcs only as slaves.
    const slaveK = Object.values(realm.kingdoms).find((k) => k.laws.slavery && !k.species)!;
    setPolicy(realm, slaveK.id, "species:orc", "slaves_only", 1, "test");
    expect(policyOf(realm, slaveK.id, "species:orc")).toBe("slaves_only");
    const place = Object.values(realm.settlements).find((s) => s.kingdom === slaveK.id && !s.way)!;
    const someone = (store.people.loadSite(place.id, "full") as PersonRow[]).find((r) => r.job !== "child" && r.cls !== "slave")!;
    store.people.update(someone.id, { species: "orc" });
    residentsSiteDay(ctx, place.id, 2);
    expect(store.people.get(someone.id)!.cls).toBe("slave");
  });
});

import { siteMap } from "../src/web/sites.js";
function await_map(realm: ReturnType<typeof generateRealm>, site: string): string[] {
  return siteMap(realm.settlements[site]!, "village", realm).buildings.map((b) => b.district ?? "");
}

describe("N54 Part D: the dragon", () => {
  it("the dragon burns a hamlet, demands tribute, and the hamlet's head pays", () => {
    const realm = generateRealm(1, 1);
    const st = generatePeoples(realm, 1)!;
    const dragon = st.dragon!;
    const pops = Object.fromEntries(Object.values(realm.settlements).map((x) => [x.id, x.population]));
    const burned = dragonWakes(realm, st, dragon, st.lairs[dragon]!, 10, seededRng(3))!;
    const s = realm.settlements[burned]!;
    expect(s.kind === "hamlet" || s.kind === "village").toBe(true);
    expect(s.lastRaided).toBe(10);
    expect(realm.treaties.some((t) => t.kind === "tribute" && t.a === `s:${burned}` && t.b === `p:${dragon}`)).toBe(true);
    expect(realm.news.some((n) => n.kind === "dragon" && /burned/.test(n.text))).toBe(true);
    expect(realm.news.some((n) => n.kind === "dragon" && /paid/.test(n.text)) || realm.news.some((n) => /could not pay/.test(n.text))).toBe(true);
    // Its dead (a number where its people aren't rows; orders for the people's day where they are).
    expect(s.population < pops[burned]! || realm.casualties.some((c) => c.site === burned && c.killer === dragon)).toBe(true);
    // A dragon is slow to wake again.
    for (let day = 11; day <= 40; day++) peoplesRealmDay(realm, day);
    expect(realm.news.filter((n) => n.kind === "dragon" && /burned/.test(n.text)).length).toBe(1);
    void peoplesOf;
  });
});
