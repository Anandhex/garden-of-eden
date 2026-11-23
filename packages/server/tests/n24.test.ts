/**
 * N24: global reporting. The player's feed reads only what they know, in three scopes (here, the kingdom, everywhere); news reaches
 * every place on its own clock (a traveller brings it, N26 Part E), so the player learns far news only when it reaches the place they
 * are in, while the admin view has it at once; standing in the liege town, the feed carries its trades, not the start town's.
 */
import { describe, expect, it } from "vitest";
import { config } from "../src/config.js";
import { WorldStore } from "../src/game/db.js";
import { FEED_FLOOR, learnAt, newsKnownSince, newsRef, playerFeed, scopeOf } from "../src/game/realm/feed.js";
import { hear, reachesAt, realmNews } from "../src/game/realm/log.js";
import { advanceWorld } from "../src/game/people/world.js";
import { liveSites } from "../src/game/people/live.js";
import { materialisePeople } from "../src/store/materialise.js";
import { generateRealm } from "../src/game/realm/generate.js";
import { pickStartSite } from "../src/game/realm/start.js";
import type { Realm } from "../src/game/realm/types.js";
import { makeWorldTown, pickTestPlaces } from "./helpers.js";

const dist = (realm: Realm, a: string, b: string) => Math.hypot(realm.settlements[a]!.pos.x - realm.settlements[b]!.pos.x, realm.settlements[a]!.pos.y - realm.settlements[b]!.pos.y);

function setup(seed = 1) {
  const realm = generateRealm(seed, 1);
  const home = pickStartSite(realm, seed);
  const mine = realm.settlements[home]!.kingdom;
  const places = Object.values(realm.settlements).filter((s) => !s.way && !s.abandoned && s.id !== home);
  const far = places.filter((s) => s.kingdom && s.kingdom !== mine).sort((a, b) => dist(realm, b.id, home) - dist(realm, a.id, home))[0]!;
  const kin = places.filter((s) => s.kingdom === mine).sort((a, b) => dist(realm, a.id, home) - dist(realm, b.id, home))[0];
  return { realm, home, far, kin, player: { known: {} as Record<string, never> } as { known: Record<string, import("../src/npc/types.js").KnownEntry> } };
}

describe("N24: the player's feed reads only what they know", () => {
  it("a war in a far kingdom is in the admin record at once, and in the player's everywhere feed only once its news reaches their place", () => {
    const { realm, home, far, player } = setup();
    const day = 5;
    realmNews(realm, day, far.id, "war", `War! ${far.name} is burned by the armies of the east.`, 8, [far.name]);
    const war = realm.news.at(-1)!;
    // The truth (the admin view reads realm.news): there at once, and known where it happened.
    expect(reachesAt(realm, war, far.id)).toBe(day);
    // The player at home: nothing yet, in any scope.
    learnAt(realm, player, home, day);
    expect(newsKnownSince(player, war.id)).toBeNull();
    expect(playerFeed(realm, player, home, "everywhere").map((x) => x.id)).not.toContain(war.id);
    // A traveller brings it home three days later: not a day before.
    hear(realm, home, war.id, day + 3, "a carter", "the road");
    learnAt(realm, player, home, day + 2);
    expect(newsKnownSince(player, war.id)).toBeNull();
    learnAt(realm, player, home, day + 3);
    expect(newsKnownSince(player, war.id)).toBe(day + 3);
    expect(player.known[newsRef(war.id)]!.how).toBe("news");
    const everywhere = playerFeed(realm, player, home, "everywhere");
    expect(everywhere.find((x) => x.id === war.id)).toMatchObject({ scope: "everywhere", learned: day + 3, day });
    // Not "here", and not "the kingdom": it happened in another kingdom.
    expect(playerFeed(realm, player, home, "here").map((x) => x.id)).not.toContain(war.id);
    expect(playerFeed(realm, player, home, "kingdom").map((x) => x.id)).not.toContain(war.id);
  });

  it("scopes are the narrowest that hold the news, each with its floor; a followed name shows whatever its importance", () => {
    const { realm, home, kin, far, player } = setup();
    realmNews(realm, 3, home, "fire", "A barn burned down at the edge of the green.", 2);
    const fire = realm.news.at(-1)!;
    if (kin) realmNews(realm, 3, kin.id, "fair", `${kin.name} holds a horse fair.`, 5, [kin.name]);
    realmNews(realm, 3, far.id, "beast", `Wolves were seen near ${far.name}, a tinker named Odo says.`, 3, [far.name, "Odo"]);
    const wolves = realm.news.at(-1)!;
    for (const n of realm.news) hear(realm, home, n.id, 3);
    learnAt(realm, player, home, 3);
    expect(scopeOf(realm, fire, home)).toBe("here");
    if (kin) expect(scopeOf(realm, realm.news.find((n) => n.kind === "fair")!, home)).toBe("kingdom");
    expect(scopeOf(realm, wolves, home)).toBe("everywhere");
    // The barn fire (importance 2) is here, above here's floor, but under the kingdom's and everywhere's.
    expect(FEED_FLOOR.here).toBeLessThanOrEqual(2);
    expect(playerFeed(realm, player, home, "here").map((x) => x.id)).toContain(fire.id);
    expect(playerFeed(realm, player, home, "everywhere").map((x) => x.id)).not.toContain(fire.id);
    expect(playerFeed(realm, player, home, "everywhere", { minor: true }).map((x) => x.id)).toContain(fire.id);
    // Minor news from far away shows when it names someone the player follows.
    expect(playerFeed(realm, player, home, "everywhere").map((x) => x.id)).not.toContain(wolves.id);
    expect(playerFeed(realm, player, home, "everywhere", { follow: ["Odo"] }).map((x) => x.id)).toContain(wolves.id);
  });

  it("every place has its own clock: known where it happened that day, elsewhere only when a traveller brings it, never predicted", () => {
    const realm = generateRealm(2, 1);
    const store = new WorldStore(":memory:");
    materialisePeople(realm, store.people, 1);
    const home = pickStartSite(realm, 2);
    const live = liveSites(realm, home);
    advanceWorld(realm, store, 3, { live });
    realmNews(realm, 3, home, "death", `The head of ${realm.settlements[home]!.name} is dead.`, 8, [realm.settlements[home]!.name]);
    const n = realm.news.at(-1)!;
    expect(reachesAt(realm, n, home)).toBe(3);
    const others = Object.values(realm.settlements).filter((s) => !s.way && !s.abandoned && s.id !== home);
    // Nobody else knows it on the day, and nothing gives them a day in advance.
    for (const s of others) expect(reachesAt(realm, n, s.id)).toBeNull();
    // Travellers carry it out over the following days; each place that hears it says who brought it.
    advanceWorld(realm, store, 30, { live });
    const heard = others.filter((s) => reachesAt(realm, n, s.id) !== null);
    expect(heard.length).toBeGreaterThan(0);
    for (const s of heard) expect(reachesAt(realm, n, s.id)!).toBeGreaterThan(3);
    // On the whole, nearer places heard it before farther ones did.
    const byDist = heard.sort((a, b) => dist(realm, a.id, home) - dist(realm, b.id, home));
    const half = Math.max(1, Math.floor(byDist.length / 2));
    const mean = (xs: typeof heard) => xs.reduce((t, s) => t + reachesAt(realm, n, s.id)!, 0) / xs.length;
    if (byDist.length >= 4) expect(mean(byDist.slice(0, half))).toBeLessThanOrEqual(mean(byDist.slice(half)));
  });
});

describe("N24: the player's place, in play", () => {
  it("arriving in the liege town the player learns what has reached it; its trades are reported there, not the start town's", () => {
    const prev = config.realm;
    config.realm = true;
    try {
      const store = new WorldStore(":memory:");
      const town = makeWorldTown({ store, seed: 1 });
      const realm = town.world.realm!;
      const start = town.site();
      const { liege } = pickTestPlaces(realm, start);
      const homeTalkers = new Set(town.talkersAt(start).map((id) => town.personas[id]?.name.split(" ")[0]).filter((x): x is string => !!x));
      // News that happened in the liege town before the player set out: it isn't theirs until they get there (unless it reached home).
      realmNews(realm, town.world.day, liege, "building", `${realm.settlements[liege]!.name} raised a new market hall.`, 5, [realm.settlements[liege]!.name]);
      const hall = realm.news.at(-1)!;
      const reachedHome = reachesAt(realm, hall, start) !== null;
      const trip = town.setOutFor(liege);
      expect(trip.ok).toBe(true);
      town.passHours(trip.hours);
      town.arriveAt(liege);
      expect(town.site()).toBe(liege);
      expect(newsKnownSince(town.world.player, hall.id)).not.toBeNull();
      if (!reachedHome) expect(town.world.player.known![newsRef(hall.id)]!.from).toBe(liege);
      // A day in the liege town: whoever trades in the feed is one of its people, never a start-town talker who stayed home.
      const here = new Set(town.talkersAt(liege).map((id) => town.personas[id]?.name.split(" ")[0]));
      const lines = [...town.passHours(24), ...town.takeNews()].filter((l) => /\b(bought|sold|restock)/i.test(l));
      for (const l of lines) {
        const who = l.split(" ")[0]!;
        if (homeTalkers.has(who) && !here.has(who)) expect.fail(`a start-town trade reported in the liege town: ${l}`);
      }
    } finally {
      config.realm = prev;
    }
  });
});
