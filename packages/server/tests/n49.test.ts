import { beforeEach, describe, expect, it, vi } from "vitest";
import { config } from "../src/config.js";
import { addGrievance } from "../src/game/chatter/grievance.js";
import { adjustRel } from "../src/game/chatter/rel.js";
import { WorldStore } from "../src/game/db.js";
import { seededRng } from "../src/game/dice.js";
import { eventRef } from "../src/game/gossip/refs.js";
import { isHeld } from "../src/game/law/taken.js";
import type { LifeCtx } from "../src/game/people/step.js";
import { advanceWorld } from "../src/game/people/world.js";
import { generateRealm } from "../src/game/realm/generate.js";
import { chooseSetback, comeHome, dieAndReturn, escapeSlavery, helperFor, recoverPack, sell, setbacks, slaveDay, slaveMarket } from "../src/game/setback/setback.js";
import type { PlayerState } from "../src/npc/types.js";
import type { PersonRow } from "../src/store/peopleStore.js";
import { materialisePeople } from "../src/store/materialise.js";
import { pickTestPlaces } from "./helpers.js";

/**
 * N49: setbacks instead of game over. One chooser from who beat the player and where; the player sold as a slave and escaping with another
 * slave's help; lasting marks and a story people at home have heard; death, and waking where they last slept.
 */
vi.setConfig({ testTimeout: 240_000, hookTimeout: 240_000 });

beforeEach(() => {
  config.peopleLazy = "";
  config.realm = true;
  config.realmSeed = undefined;
  config.playerDefeat = "knockout";
});

/** A realm with a slave kingdom, its market place living as well as the start town. */
function world(seed = 1) {
  const realm = generateRealm(seed, 1);
  const store = new WorldStore(":memory:");
  materialisePeople(realm, store.people, 1);
  const { start, liege } = pickTestPlaces(realm);
  const market = slaveMarket(realm, start)!;
  const live = new Set([start, liege, market]);
  const ctx: LifeCtx = { realm, store };
  advanceWorld(realm, store, 2, { live });
  return { realm, store, live, ctx, start, liege, market };
}
const player = (site: string): PlayerState => ({ name: "Wren", money: 200, hp: 30, maxHp: 30, renown: 0, site, inventory: { bread: 2 }, attributes: { strength: 12 } }) as unknown as PlayerState;

describe("N49 step 1: the chooser", () => {
  it("the data loads, and defeats by gangs, guards and beasts pick the outcomes their table allows", () => {
    expect(Object.keys(setbacks().by)).toEqual(expect.arrayContaining(["gang", "slavers", "guards", "beasts"]));
    const realm = generateRealm(1, 1);
    const site = Object.keys(realm.settlements)[0]!;
    const kinds = (by: "gang" | "slavers" | "guards" | "beasts") => new Set(Array.from({ length: 60 }, (_, i) => chooseSetback(realm, player(site), { by, site, day: 1 }, seededRng(i))));
    expect([...kinds("guards")]).toEqual(["imprisoned"]);
    expect(kinds("beasts").has("left_for_dead")).toBe(true);
    expect(kinds("slavers").has("sold")).toBe(true);
    expect(kinds("gang").has("robbed")).toBe(true);
  });

  it("permadeath still kills", () => {
    config.playerDefeat = "permadeath";
    const realm = generateRealm(1, 1);
    const site = Object.keys(realm.settlements)[0]!;
    expect(chooseSetback(realm, player(site), { by: "beasts", site, day: 1 }, seededRng(1))).toBe("death");
  });
});

describe("N49 steps 2–5: sold, escape, marks and the story", () => {
  it("the player loses to slavers, is sold in the slave kingdom, escapes with another slave's help, and comes home with a scar and a story people have heard", () => {
    const w = world(1);
    let day = w.realm.day + 1;
    const p = player(w.start);
    const r = sell(w.ctx, p, { by: "slavers", site: w.start, day })!;
    expect(r).not.toBeNull();
    expect(w.realm.kingdoms[w.realm.settlements[r.chapter.site]!.kingdom!]!.laws.slavery).toBe(true);
    expect(p.chapter?.kind).toBe("slave");
    expect(isHeld(p)).toBe(true);
    expect(p.society!.marks).toContain("brand");
    // Another slave of the same master, who holds a grudge against them.
    const other = (w.store.people.loadSite(r.chapter.site, "full") as PersonRow[]).find((x) => x.death === null && x.job !== "child" && x.id !== r.master.id)!;
    w.store.people.update(other.id, { cls: "slave", master_id: r.master.id, job: "slave" });
    addGrievance(w.store, { who: other.id, against: r.master.id, cause: "the lash", weight: 0.9, day });
    expect(helperFor(w.ctx, p, day)).toBeNull();
    // Days of work beside them: they come to trust the player.
    for (let i = 0; i < 6; i++) slaveDay(w.ctx, p, day++);
    adjustRel(w.store, other.id, "player", { affection: 10 }, day);
    expect(helperFor(w.ctx, p, day)?.id).toBe(other.id);
    let out = escapeSlavery(w.ctx, p, day, seededRng(1));
    for (let i = 2; !out.ok && i < 30; i++) {
      // A failed run is flogged and watched closer; the helper is still there.
      p.chapter!.watch = 0;
      out = escapeSlavery(w.ctx, p, ++day, seededRng(i));
    }
    expect(out.ok).toBe(true);
    expect(p.chapter).toBeUndefined();
    expect(out.lines[0]).toMatch(new RegExp(other.name));
    // Home, with marks and a story.
    const lines = comeHome(w.ctx, p, w.start, day + 3);
    expect(lines[0]).toMatch(/sold as a slave/);
    expect(p.society!.marks).toEqual(expect.arrayContaining(["brand"]));
    const story = p.society!.story.event as string;
    const knowers = w.store.knowledge.holders(eventRef(story)).map((k) => k.who);
    expect(knowers.length).toBeGreaterThan(2);
    for (const k of knowers) expect(w.store.people.get(k)!.site).toBe(w.start);
  });

  it("the same slavers don't sell the player twice running without an escape between", () => {
    const realm = generateRealm(1, 1);
    const site = Object.keys(realm.settlements)[0]!;
    const p = player(site);
    p.society = { setbacks: [{ kind: "sold", holder: "fac9", day: 1, site }] };
    for (let i = 0; i < 40; i++) expect(chooseSetback(realm, p, { by: "slavers", holder: "fac9", site, day: 2 }, seededRng(i))).not.toBe("sold");
  });
});

describe("N49 step 6: death and coming back", () => {
  it("a player killed wakes a day later where they last slept, their pack lies where they fell, and a witness says they came back from the dead", () => {
    const w = world(1);
    const day = w.realm.day + 1;
    const p = player(w.start);
    p.society = { slept: w.liege };
    const witness = (w.store.people.loadSite(w.start, "full") as PersonRow[]).find((r) => r.death === null && r.job !== "child")!;
    const r = dieAndReturn(w.ctx, p, { by: "gang", site: w.start, day }, [witness.id]);
    expect(r.wakeAt).toBe(w.liege);
    expect(p.inventory).toEqual({});
    expect(p.hp).toBeLessThan(p.maxHp / 2);
    const pack = w.store.records.open("pack", (x) => x.site === w.start)[0]!;
    expect(pack).toBeDefined();
    const known = w.store.knowledge.rowsOf(witness.id).map((k) => w.store.eventById(k.ref.slice(2))).find((e) => e?.details.includes("came back from the dead"));
    expect(known).toBeDefined();
    expect(recoverPack(w.ctx, p, w.start, day + 2)[0]).toMatch(/take them back/);
    expect(p.inventory).toEqual({ bread: 2 });
  });
});
