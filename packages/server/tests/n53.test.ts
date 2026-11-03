import { beforeEach, describe, expect, it, vi } from "vitest";
import { config } from "../src/config.js";
import { WorldStore } from "../src/game/db.js";
import { breakTaboo, cultureRealmDay, customsAt, keepCustom, tonguePenalty, tonguesOf, dayAmong } from "../src/game/culture/day.js";
import { cultureAt, cultureOfKingdom, festivalOf, greeting, innFare, templates, tongueDistance } from "../src/game/culture/model.js";
import { retell } from "../src/game/gossip/knowledge.js";
import { surnameOf, type LifeCtx } from "../src/game/people/step.js";
import { advanceWorld } from "../src/game/people/world.js";
import { generateRealm } from "../src/game/realm/generate.js";
import { pickStartSite } from "../src/game/realm/start.js";
import type { PlayerState } from "../src/npc/types.js";
import type { PersonRow } from "../src/store/peopleStore.js";
import { materialisePeople } from "../src/store/materialise.js";

/**
 * N53: cultures and languages. Each kingdom's culture generated from data templates; names, greetings, the inn's food and the festivals
 * follow it; tongues garble news told far from home; breaking a local taboo offends; border towns mix.
 */
vi.setConfig({ testTimeout: 300_000, hookTimeout: 300_000 });

beforeEach(() => {
  config.peopleLazy = "";
  config.realm = true;
  config.realmSeed = undefined;
  config.society.cultures = true;
});

describe("N53 step 1: generated cultures", () => {
  it("the templates load; the kingdoms of a seed have different cultures, the same every time", () => {
    expect(templates().length).toBeGreaterThanOrEqual(6);
    const a = generateRealm(1, 1);
    const b = generateRealm(1, 1);
    const ks = Object.keys(a.kingdoms).sort();
    const cs = ks.map((k) => cultureOfKingdom(a, k)!);
    expect(new Set(cs.map((c) => c.template)).size).toBeGreaterThan(1);
    expect(ks.map((k) => JSON.stringify(cultureOfKingdom(b, k)))).toEqual(cs.map((c) => JSON.stringify(c)));
  });
});

describe("N53 steps 2–3: names, greetings, food, festivals", () => {
  it("names, greetings, food at the inn and the festival differ between the three kingdoms", () => {
    const realm = generateRealm(1, 1);
    const store = new WorldStore(":memory:");
    materialisePeople(realm, store.people, 1);
    const capitals = Object.values(realm.kingdoms).map((k) => k.capital).sort();
    const families = capitals.map((c) => new Set((store.people.loadSite(c, "full") as PersonRow[]).map((r) => surnameOf(r.name))));
    // Little overlap of family names between kingdoms of different templates.
    for (let i = 0; i < families.length; i++)
      for (let j = i + 1; j < families.length; j++) {
        const ci = cultureAt(realm, capitals[i]!)!;
        const cj = cultureAt(realm, capitals[j]!)!;
        if (ci.template === cj.template) continue;
        const both = [...families[i]!].filter((f) => families[j]!.has(f));
        expect(both.length).toBeLessThan(Math.min(families[i]!.size, families[j]!.size) / 4);
      }
    const cs = capitals.map((c) => cultureAt(realm, c)!);
    const distinct = (f: (c: (typeof cs)[number]) => string) => new Set(cs.map(f)).size;
    expect(distinct((c) => greeting(c, 0, "commoner"))).toBeGreaterThan(1);
    expect(distinct((c) => innFare(c).join())).toBeGreaterThan(1);
    expect(distinct((c) => festivalOf(c, "summer").name)).toBeGreaterThan(1);
  });

  it("a child born in a place takes a given name of its culture", () => {
    const realm = generateRealm(1, 1);
    const store = new WorldStore(":memory:");
    materialisePeople(realm, store.people, 1);
    const start = pickStartSite(realm, realm.seed);
    advanceWorld(realm, store, 60, { live: new Set([start]) });
    const c = cultureAt(realm, start)!;
    const born = (store.people.loadSite(start, "full") as PersonRow[]).filter((r) => r.born_day > 1);
    expect(born.length).toBeGreaterThan(0);
    for (const r of born) expect([...c.female, ...c.male]).toContain(r.name.split(" ")[0]);
  });
});

describe("N53 step 4: tongues", () => {
  it("a start-town rumour told in a far kingdom loses accuracy faster than one told next door", () => {
    const realm = generateRealm(1, 1);
    const store = new WorldStore(":memory:");
    materialisePeople(realm, store.people, 1);
    const ctx: LifeCtx = { realm, store };
    const start = pickStartSite(realm, realm.seed);
    const home = cultureAt(realm, start)!;
    const near = realm.settlements[start]!.roads.find((id) => cultureAt(realm, id)?.id === home.id && !realm.settlements[id]!.way)!;
    const far = Object.values(realm.settlements).find((s) => !s.way && tongueDistance(home, cultureAt(realm, s.id)) >= 0.35)!;
    const speaker = (store.people.loadSite(start, "full") as PersonRow[])[0]!;
    const toNear = (store.people.loadSite(near, "full") as PersonRow[])[0]!;
    const toFar = (store.people.loadSite(far.id, "full") as PersonRow[])[0]!;
    const item = { ref: "n:x", accuracy: 1, variant: 0 };
    const a = retell(ctx, item, toNear.id, 5, 1, () => 0.99, speaker.id)!;
    const b = retell(ctx, item, toFar.id, 5, 1, () => 0.99, speaker.id)!;
    expect(b.accuracy).toBeLessThan(a.accuracy);
  });

  it("the player speaks their home tongue and learns another by living among its people", () => {
    const realm = generateRealm(1, 1);
    const start = pickStartSite(realm, realm.seed);
    const far = Object.values(realm.settlements).find((s) => !s.way && cultureAt(realm, s.id)!.id !== cultureAt(realm, start)!.id)!;
    const p = { name: "Wren", site: start } as unknown as PlayerState;
    expect(tonguesOf(realm, p)[cultureAt(realm, start)!.id]).toBe(1);
    const before = tonguePenalty(realm, p, far.id);
    for (let d = 0; d < 20; d++) dayAmong(realm, p, far.id);
    expect(tonguePenalty(realm, p, far.id)).toBeLessThan(before);
  });
});

describe("N53 step 5: customs and taboos", () => {
  it("breaking a local taboo lowers how people there treat the player; keeping a custom earns respect", () => {
    const realm = generateRealm(1, 1);
    const store = new WorldStore(":memory:");
    materialisePeople(realm, store.people, 1);
    const ctx: LifeCtx = { realm, store };
    const start = pickStartSite(realm, realm.seed);
    const { taboos, customs } = customsAt(realm, start);
    const rows = (store.people.loadSite(start, "full") as PersonRow[]).slice(0, 5).map((r) => r.id);
    const p = { name: "Wren", site: start } as unknown as PlayerState;
    expect(breakTaboo(ctx, p, start, taboos[0]!, rows, 3, 12)[0]).toMatch(/not done/);
    for (const w of rows) expect(store.social.rel(w, "player")!.affection).toBeLessThan(0);
    expect(p.reputation!.respect).toBeLessThan(0);
    expect(breakTaboo(ctx, p, start, "not_a_taboo_here", rows, 3, 13)).toEqual([]);
    keepCustom(ctx, p, start, customs[0]!, rows, 4);
    expect(store.social.rel(rows[0]!, "player")!.respect).toBeGreaterThan(-10);
  });
});

describe("N53 step 6: mixing", () => {
  it("a town on many roads leans toward its neighbours' cultures, and may take up a custom", () => {
    const realm = generateRealm(1, 1);
    for (let d = 1; d <= 48 * 4; d++) cultureRealmDay(realm, d);
    const mixes = realm.society!.cultureMix as Record<string, { mix: Record<string, number>; adopted: string[] }>;
    const mixed = Object.values(mixes).filter((m) => Object.values(m.mix).some((v) => v > 0));
    expect(mixed.length).toBeGreaterThan(0);
    for (const k of Object.values(realm.kingdoms)) expect(k.culture).toBeDefined();
  });
});
