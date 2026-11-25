/**
 * N23 (the cut): snapshots with their checks, a replay from any snapshot day that checks itself against them, and the realm's history as
 * recorded text in the export, truth or as the player knew it. The input journal that makes a played world replayable is the next step.
 */
import { afterEach, describe, expect, it } from "vitest";
import { config } from "../src/config.js";
import { WorldStore } from "../src/game/db.js";
import { liveSites } from "../src/game/people/live.js";
import { advanceWorld } from "../src/game/people/world.js";
import { generateRealm } from "../src/game/realm/generate.js";
import { realmNews } from "../src/game/realm/log.js";
import { pickStartSite } from "../src/game/realm/start.js";
import { chronicleHtml, chronicleOf } from "../src/game/share/chronicle.js";
import { checksOf, hashOf, replay, snapshotDue } from "../src/game/share/snapshots.js";
import { newWorld } from "../src/game/save.js";
import { decodeMbWorld, encodeMbWorld, exportWorld } from "../src/store/exchange.js";
import { materialisePeople } from "../src/store/materialise.js";

const was = { snapshotEvery: config.snapshotEvery, realm: config.realm };
afterEach(() => Object.assign(config, was));

function run(days: number) {
  config.realm = true;
  config.snapshotEvery = 5;
  const realm = generateRealm(3, 1);
  const store = new WorldStore(":memory:");
  materialisePeople(realm, store.people, 1);
  const live = liveSites(realm, pickStartSite(realm, 3));
  advanceWorld(realm, store, days, { live });
  return { realm, store, live };
}

describe("N23: snapshots and replay", () => {
  it("snapshots fall on day 1 and every fifth day, each with the world's hash", () => {
    expect([1, 2, 5, 9, 10, 15].filter((d) => snapshotDue(d, 5))).toEqual([1, 5, 10, 15]);
    expect(snapshotDue(5, 0)).toBe(false);
  });

  it("a replay from day 5 matches every later snapshot, and ends where the original did", () => {
    const { realm, store, live } = run(11);
    // (A world starts on day 1, already begun: its first snapshot is day 5.)
    expect(checksOf(store).map((c) => c.day)).toEqual([5, 10]);
    const r = replay(store, 7, 12, { live });
    expect(r.diverged).toBeUndefined();
    expect(r.from).toBe(5);
    expect(r.matched).toEqual([5, 10]);
    expect(r.realm.day).toBe(realm.day);
    expect(hashOf(r.realm, r.store)).toBe(hashOf(realm, store));
  });

  it("a replay that doesn't match a recorded check says on which day", () => {
    const { store, live } = run(11);
    store.sql("UPDATE snapshots SET hash = 'tampered' WHERE day = 10").run();
    const r = replay(store, 5, 12, { live });
    expect(r.diverged).toMatchObject({ day: 10, expected: "tampered" });
    expect(r.matched).toEqual([5]);
  });
});

describe("N23: the shareable chronicle", () => {
  it("the export carries the checks and the chronicle; the player's view holds only what they learned, dated when they learned it", () => {
    const { realm, store } = run(6);
    const home = pickStartSite(realm, 3);
    realmNews(realm, 6, home, "war", "War is declared in the north.", 8);
    const war = realm.news.at(-1)!;
    realmNews(realm, 6, home, "plague", "A plague in the south.", 8);
    const world = newWorld();
    world.realm = realm;
    world.day = realm.day;
    world.player.known = { [`n:${war.id}`]: { day: 9, how: "news" } };
    const doc = decodeMbWorld(encodeMbWorld(exportWorld(world, store)));
    expect(doc.checks!.map((c) => c.day)).toEqual([5]);
    expect(doc.chronicle!.map((e) => e.text)).toEqual(expect.arrayContaining(["War is declared in the north.", "A plague in the south."]));
    const mine = chronicleOf(realm, store, { view: "player", known: world.player.known });
    expect(mine.filter((e) => e.kind !== "story")).toEqual([{ day: 9, kind: "war", text: "War is declared in the north." }]);
    // Recorded text: the same world writes the same page.
    const a = chronicleHtml("A chronicle of the realm", chronicleOf(realm, store, { view: "truth" }), "truth");
    expect(a).toBe(chronicleHtml("A chronicle of the realm", doc.chronicle!, "truth"));
    expect(a).toContain("<h2>Day 6</h2>");
    expect(a).not.toContain("<script");
  });
});
