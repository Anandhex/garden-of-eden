import { beforeEach, describe, expect, it, vi } from "vitest";
import { config } from "../src/config.js";
import { WorldStore } from "../src/game/db.js";
import { parseDeath } from "../src/game/people/death.js";
import type { LifeCtx } from "../src/game/people/step.js";
import { advanceWorld } from "../src/game/people/world.js";
import { declareWar } from "../src/game/realm/diplomacy.js";
import { generateRealm } from "../src/game/realm/generate.js";
import { pickStartSite } from "../src/game/realm/start.js";
import { enlist, peekArmies, rollOfTheFallen, type SoldierData, type WarDeadData } from "../src/game/war/armies.js";
import { hateOn } from "../src/game/chatter/grievance.js";
import type { PlayerState } from "../src/npc/types.js";
import type { PersonRow } from "../src/store/peopleStore.js";
import { materialisePeople } from "../src/store/materialise.js";

/**
 * N55: armies, soldiers and the war dead. A war levies real townsfolk who march away; they rise in rank with battles survived; the fallen
 * are on the war's roll with their battle; families grieve and blame the enemy; the missing turn up after the peace; war dead are their own.
 */
vi.setConfig({ testTimeout: 600_000, hookTimeout: 600_000 });

beforeEach(() => {
  config.peopleLazy = "";
  config.realm = true;
  config.realmSeed = undefined;
  config.society.armies = true;
});

describe("N55: a war fought by real people", () => {
  it("levies real townsfolk, promotes survivors, rolls the fallen by battle, and brings the missing home after the peace", () => {
    const realm = generateRealm(1, 1);
    const store = new WorldStore(":memory:");
    materialisePeople(realm, store.people, 1);
    const ctx: LifeCtx = { realm, store };
    const start = pickStartSite(realm, realm.seed);
    const mine = realm.settlements[start]!.kingdom!;
    const foe = Object.keys(realm.kingdoms).find((k) => k !== mine)!;
    // Both kingdoms' capitals and the start town live: the front is somewhere among them.
    const live = new Set([start, realm.kingdoms[mine]!.capital, realm.kingdoms[foe]!.capital]);
    advanceWorld(realm, store, 2, { live });
    const w = declareWar(realm, [`k:${foe}`], [`k:${mine}`], 3, "a test war");
    advanceWorld(realm, store, 40, { live });
    // Levies: real people of the start town, marched away.
    const soldiers = store.records.list<SoldierData>("soldier", (s) => s.data.war === w.id);
    const fromStart = soldiers.filter((s) => s.site === start);
    expect(fromStart.length).toBeGreaterThan(0);
    for (const s of fromStart) {
      const r = store.people.get(s.a!)!;
      expect(r.site).toBe(start);
      if (r.death === null && s.data.status === "serving") expect(JSON.parse(r.away!).purpose).toBe("war");
    }
    if (realm.kingdoms[mine]!.laws.serfdom) expect(fromStart.some((s) => store.people.get(s.a!)!.cls === "serf")).toBe(true);
    expect(peekArmies(realm).some((a) => a.war === w.id && a.party === `k:${mine}`)).toBe(true);
    // Battles: some survive three and are made sergeant.
    expect(w.battles.length).toBeGreaterThanOrEqual(3);
    expect(soldiers.some((s) => ["sergeant", "lieutenant", "captain"].includes(s.data.rank))).toBe(true);
    // The fallen: on the roll, with their battle; their deaths carry the war; families grieve and one blames the enemy.
    const roll = rollOfTheFallen(store, w.id);
    expect(roll.length).toBeGreaterThan(0);
    for (const d of roll) expect(d.data.battle).toMatch(/^battle:/);
    const fallen = roll.filter((d) => d.status === "fallen");
    const dead = fallen.map((d) => parseDeath(store.people.get(d.a!)!.death)!);
    for (const rec of dead) {
      expect(rec.war).toBe(w.id);
      expect(["battle", "siege"]).toContain(rec.cause);
    }
    const rulers = [realm.kingdoms[foe]!.ruler, realm.kingdoms[mine]!.ruler].filter((x): x is string => !!x);
    const kinOf = (id: string) => {
      const r = store.people.get(id)!;
      return [r.spouse, r.mother, r.father, ...store.people.childrenOf(r.id).map((c) => c.id)].filter((x): x is string => !!x).filter((k) => store.people.get(k)?.job !== "child");
    };
    const mourned = fallen.filter((d) => kinOf(d.a!).length > 0);
    expect(mourned.length).toBeGreaterThan(0);
    expect(mourned.some((d) => kinOf(d.a!).some((k) => rulers.some((ru) => hateOn(store, k, ru, realm.day) > 0)))).toBe(true);
    // War dead are never counted as plague or famine.
    for (const rec of dead) expect(["illness", "famine"]).not.toContain(rec.cause);
    // The peace: the living come home; some of the missing turn up.
    w.end = realm.day;
    w.winner = "none";
    advanceWorld(realm, store, realm.day + 80, { live });
    const after = store.records.list<SoldierData>("soldier", (s) => s.data.war === w.id);
    expect(after.filter((s) => s.data.status === "serving").length).toBe(0);
    expect(after.some((s) => s.data.status === "discharged")).toBe(true);
    const missing = store.records.list<WarDeadData>("war_dead", (d) => d.data.war === w.id && d.data.cause === "missing");
    if (missing.length > 0) expect(missing.some((m) => m.status === "came home") || missing.every((m) => store.people.get(m.a!)!.death !== null)).toBe(true);
  });

  it("the player can enlist in a war", () => {
    const realm = generateRealm(1, 1);
    const [a, b] = Object.keys(realm.kingdoms);
    declareWar(realm, [`k:${a}`], [`k:${b}`], 2, "test");
    realm.society = { armies: [{ id: `army:x:${a}`, war: "x", party: `k:${a}`, side: "attackers", since: 2, levy: {}, raised: {}, status: "fighting" }] };
    const p = { name: "Wren" } as unknown as PlayerState;
    expect(enlist(realm, p, a!, 3)[0]).toMatch(/soldier/);
    expect(p.society!.army.rank).toBe("soldier");
  });
});

void ({} as PersonRow);
