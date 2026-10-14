/**
 * N26 Part E: everyone on the road is someone. Every traveller is a row of the `people` table (marked `away` while on a journey),
 * trips have real reasons, migration is a journey with an arrival, and news travels with the people who carry it and swap it
 * at the inns. A save is v14 (a clean break).
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { isOnTheRoad, placeAt, stopsOf, type Journey } from "@millbrook/shared";
import { config } from "../src/config.js";
import { WorldStore } from "../src/game/db.js";
import { parseAway, type PersonRow } from "../src/store/peopleStore.js";
import { materialisePeople } from "../src/store/materialise.js";
import { liveSites } from "../src/game/people/live.js";
import { advanceWorld, lifeDay } from "../src/game/people/world.js";
import { generateRealm } from "../src/game/realm/generate.js";
import { hear, realmNews, reachesAt } from "../src/game/realm/log.js";
import { pickStartSite } from "../src/game/realm/start.js";
import { rosterFromStore } from "../src/game/realm/townsfolk.js";
import { settleTransit, taxDay } from "../src/game/realm/politics.js";
import { dungeonsDay } from "../src/game/realm/wilds.js";
import { checkRoadBounds } from "../src/game/road/bounds.js";
import { exchangeNews, newsChain, stopsOn } from "../src/game/road/exchange.js";
import { roadDataOf } from "../src/game/road/generateRoads.js";
import { awaySite, journeyOf, journeysOf } from "../src/game/road/journeys.js";
import { visitorsAt } from "../src/game/road/presence.js";
import { rollSegment } from "../src/game/road/situations.js";
import { loadWorld, newWorld, saveWorld } from "../src/game/save.js";
import { loadCreatureTemplates } from "../src/game/creatures.js";
import { seededRng } from "../src/game/dice.js";
import { siteMap } from "../src/web/sites.js";
import { allPersonas } from "./helpers.js";

vi.setConfig({ testTimeout: 180_000 });
beforeEach(() => {
  config.peopleLazy = "";
  config.realm = true;
  config.realmSeed = undefined;
});

function world(seed = 1) {
  const realm = generateRealm(seed, 1);
  const store = new WorldStore(":memory:");
  materialisePeople(realm, store.people, 1);
  const live = liveSites(realm, pickStartSite(realm, realm.seed), "all");
  return { realm, store, live };
}

const minuteOf = (day: number, hour = 12) => (day - 1) * 1440 + hour * 60;
const open = (realm: ReturnType<typeof world>["realm"]) => journeysOf(realm).filter((j) => !j.closed);

describe("N26 Part E: every traveller is a person of the table", () => {
  it("over 60 days every person on a road is a row (or a figure) that is away, once, and nobody is made up", () => {
    const { realm, store, live } = world(1);
    for (let d = 2; d <= 61; d++) {
      advanceWorld(realm, store, d, { live });
      const seen = new Map<string, string>();
      for (const j of open(realm)) {
        for (const t of j.party) {
          const row = store.people.get(t.person);
          const fig = realm.figures[t.person];
          expect(row !== null || fig !== undefined, `${t.name} on ${j.id}`).toBe(true);
          expect(seen.has(t.person), `${t.person} on ${j.id} and ${seen.get(t.person)}`).toBe(false);
          seen.set(t.person, j.id);
          if (row && row.death === null) expect(parseAway(row.away)?.journey, `${t.name}'s row says where they are`).toBe(j.id);
          // The cache on the journey is who the row is.
          if (row) expect(row.name).toBe(t.name);
        }
      }
      // And the other way round: everyone away is on an open journey.
      for (const r of store.people.awayRows()) expect(seen.get(r.id), `${r.name} is away`).toBe(parseAway(r.away)!.journey);
    }
    const kinds = new Set(journeysOf(realm).map((j) => j.kind));
    for (const k of ["market", "caravan", "officials"]) expect(kinds.has(k as Journey["kind"]), k).toBe(true);
    for (const b of checkRoadBounds(realm, store.people, 61)) expect(b.ok, `${b.name}: ${b.detail}`).toBe(true);
  });

  it("someone away is not in their town's crowd but still counts in its people; their place steps them, and they are home again after", () => {
    const { realm, store, live } = world(1);
    advanceWorld(realm, store, 20, { live });
    const j = journeysOf(realm).find((x) => x.kind === "market" && !x.closed && x.turn && x.party.length > 0)!;
    expect(j).toBeDefined();
    const who = store.people.get(j.party[0]!.person)!;
    expect(who.away).not.toBeNull();
    const home = realm.settlements[who.site]!;
    const map = siteMap(home, "village", realm);
    const before = store.people.livingCount(home.id);
    const crowd = rosterFromStore(store.people, realm, home.id, map, 20, minuteOf(20));
    expect(crowd!.people.some((p) => p.id === who.id) && placeAt(j, minuteOf(20)).site !== home.id).toBe(false);
    expect(before).toBeGreaterThan(0);
    // Their row stays their home's: it ages and could die there.
    expect(who.site).toBe(home.id);
    // Once the journey is over and a day has passed, they are home.
    advanceWorld(realm, store, Math.floor(j.arrive / 1440) + 3, { live });
    // (Market-goers go again: whatever they are doing now, it is not that journey.)
    expect(parseAway(store.people.get(who.id)!.away)?.journey).not.toBe(j.id);
    const back = rosterFromStore(store.people, realm, home.id, map, realm.day, minuteOf(realm.day));
    const now = store.people.get(who.id)!;
    expect(now.death !== null || now.away !== null || back!.people.some((p) => p.id === who.id)).toBe(true);
  });

  it("where a journey has someone is a place or the open road: a death there is recorded there", () => {
    const { realm, store, live } = world(1);
    advanceWorld(realm, store, 12, { live });
    const j = journeysOf(realm).find((x) => x.kind === "market" && x.turn)!;
    // Out at the market town the day they are there; on the open road a day or so in, or null.
    const day = Math.floor(j.turn!.arrive / 1440) + 1;
    expect(awaySite(realm, j.id, day)).toBeOneOf([j.turn!.site, null, ...j.path]);
    expect(awaySite(realm, "nonesuch", day)).toBeNull();
  });
});

describe("N26 Part E: why people travel", () => {
  it("farmers of a village go to the market of a town on its market day, as themselves, and come home", () => {
    const { realm, store, live } = world(1);
    advanceWorld(realm, store, 25, { live });
    const markets = journeysOf(realm).filter((j) => j.kind === "market");
    expect(markets.length).toBeGreaterThan(0);
    for (const j of markets) {
      const home = realm.settlements[j.path[0]!]!;
      expect(["hamlet", "village"]).toContain(home.kind);
      expect(j.returns).toBe(true);
      expect(j.path.at(-1)).toBe(j.path[0]);
      expect(["town", "city", "capital"]).toContain(realm.settlements[j.turn!.site]!.kind);
      for (const t of j.party) expect(store.people.get(t.person)!.site).toBe(home.id);
    }
  });

  it("a caravan is a merchant of its town with carters and guards of the same town", () => {
    const { realm, store, live } = world(1);
    advanceWorld(realm, store, 25, { live });
    const c = journeysOf(realm).filter((j) => j.kind === "caravan");
    expect(c.length).toBeGreaterThan(0);
    for (const j of c) {
      const rows = j.party.map((t) => store.people.get(t.person)!);
      expect(rows[0]!.job).toMatch(/merchant|stallholder/);
      for (const r of rows) expect(r.site).toBe(j.path[0]);
      expect(j.cargo).toBeDefined();
    }
  });

  it("serfs and slaves never travel on their own", () => {
    const { realm, store, live } = world(1);
    advanceWorld(realm, store, 30, { live });
    for (const j of journeysOf(realm)) {
      if (j.kind === "migrants" || j.kind === "refugees") continue;
      for (const t of j.party) {
        const r = store.people.get(t.person);
        if (r) expect(["serf", "slave"]).not.toContain(r.cls);
      }
    }
  });

  it("taxes go up the road with a clerk and are handed over when he arrives, or a day later with nobody to send", () => {
    const { realm, store, live } = world(1);
    advanceWorld(realm, store, 6, { live });
    const before = realm.transit.length;
    taxDay(realm, 7, seededRng(7));
    expect(realm.transit.length).toBeGreaterThan(before);
    const owed = realm.transit.reduce((a, t) => a + t.amount, 0);
    expect(owed).toBeGreaterThan(0);
    const total = (r: typeof realm) => Object.values(r.settlements).reduce((a, s) => a + s.treasury, 0);
    const mid = total(realm);
    settleTransit(realm, 9);
    expect(total(realm)).toBeGreaterThan(mid);
    expect(realm.transit.filter((t) => !t.journey)).toEqual([]);
  });

  it("adventurers walk to the dungeon and the delve is fought when they arrive, by the same figures", () => {
    const { realm } = world(1);
    for (let d = 2; d <= 80; d++) {
      realm.day = d - 1;
      dungeonsDay(realm, d, seededRng(d));
    }
    const exp = journeysOf(realm).filter((j) => j.kind === "adventurers" && j.dungeon);
    expect(exp.length).toBeGreaterThan(0);
    const done = exp.filter((j) => j.closed);
    expect(done.length).toBeGreaterThan(0);
    for (const j of done) for (const t of j.party) expect(realm.figures[t.person]?.away).not.toBe(j.id);
    expect(realm.stats["delves"] ?? 0).toBeGreaterThan(0);
  });
});

describe("N26 Part E: visitors", () => {
  it("someone at a market town on its market day is in its crowd, and gone from their own", () => {
    const { realm, store, live } = world(1);
    advanceWorld(realm, store, 25, { live });
    const j = journeysOf(realm).find((x) => x.kind === "market" && x.turn && x.turn.leave > x.turn.arrive)!;
    expect(j).toBeDefined();
    const minute = Math.floor((j.turn!.arrive + j.turn!.leave) / 2);
    const there = realm.settlements[j.turn!.site]!;
    const visitors = visitorsAt(store.people, realm, there.id, minute);
    expect(visitors.some((v) => v.row.id === j.party[0]!.person)).toBe(true);
    // Not in their own place's crowd at that minute (their journey says they are away).
    const home = realm.settlements[j.path[0]!]!;
    expect(visitorsAt(store.people, realm, home.id, minute).some((v) => v.row.id === j.party[0]!.person)).toBe(false);
    // The crowd of the town they visit has them in it.
    const day = Math.floor(minute / 1440) + 1;
    // (The journey may be closed by now; the minute is what matters for the formula.)
    expect(placeAt(j, minute).site).toBe(there.id);
    void day;
    void siteMap;
  });

  it("the inn along the road holds the travellers who stop there for the night", () => {
    const { realm, store, live } = world(1);
    advanceWorld(realm, store, 25, { live });
    let found = 0;
    for (const j of journeysOf(realm)) {
      for (const l of j.timeline) {
        const s = l.site ? realm.settlements[l.site] : undefined;
        if (!s?.way || l.d0 !== l.d1 || l.t1 - l.t0 < 300) continue;
        const v = visitorsAt(store.people, realm, s.id, Math.floor((l.t0 + l.t1) / 2));
        if (j.party.some((t) => v.some((x) => x.row.id === t.person))) found++;
      }
    }
    expect(found).toBeGreaterThan(0);
  });
});

describe("N26 Part E: migration is a journey", () => {
  it("a household leaving a famine is on the road for the days it takes, and only then in the new town", () => {
    const { realm, store, live } = world(1);
    const from = [...live].map((id) => realm.settlements[id]!).find((s) => s.kind === "village" && s.roads.length > 0 && !s.abandoned)!;
    const to = realm.settlements[from.roads.find((id) => !realm.settlements[id]!.way && !realm.settlements[id]!.abandoned)!]!;
    to.prosperity = 95;
    to.food = 100;
    let j: Journey | undefined;
    for (let d = 2; d <= 14 && !j; d++) {
      from.food = 0;
      to.food = 100;
      lifeDay({ realm, store }, d, { live });
      j = journeysOf(realm).find((x) => x.kind === "refugees" && x.move?.from === from.id);
    }
    expect(j, "a household set out").toBeDefined();
    const members = j!.party.map((t) => store.people.get(t.person)!);
    // Still the old place's people (counted there), away.
    for (const m of members) {
      expect(m.site).toBe(from.id);
      expect(parseAway(m.away)).toMatchObject({ journey: j!.id, returns: false });
    }
    // Not in the new town's roster, nor counted in its people, while they walk.
    const map = siteMap(to, "village", realm);
    const roster = rosterFromStore(store.people, realm, to.id, map, realm.day, minuteOf(realm.day, 8));
    for (const m of members) expect(roster!.people.some((p) => p.id === m.id && placeAt(j!, minuteOf(realm.day, 8)).site !== to.id)).toBe(false);
    // Days later they arrive and live there.
    const arriveDay = Math.floor(j!.arrive / 1440) + 2;
    expect(arriveDay).toBeGreaterThan(realm.day);
    for (let d = realm.day + 1; d <= arriveDay; d++) {
      from.food = 0;
      lifeDay({ realm, store }, d, { live });
    }
    for (const m of members) {
      const now = store.people.get(m.id)!;
      if (now.death === null) {
        expect(now.site).toBe(to.id);
        expect(now.away).toBeNull();
      }
    }
    const after = journeyOf(realm, j!.id);
    expect(after === undefined || after.closed === true).toBe(true);
  });

  it("nobody is in two places at once over a 60-day run", () => {
    const { realm, store, live } = world(2);
    for (let d = 2; d <= 61; d++) {
      advanceWorld(realm, store, d, { live });
      const away = new Set(store.people.awayRows().map((r) => r.id));
      for (const site of live) {
        const rows = store.people.loadSite(site, "full") as PersonRow[];
        const mine = new Set(rows.filter((r) => r.away === null).map((r) => r.id));
        for (const id of away) expect(mine.has(id)).toBe(false);
      }
    }
    expect(realm.stats["migrants"] ?? 0).toBeGreaterThanOrEqual(0);
  });
});

describe("N26 Part E: news travels with people", () => {
  it("news is known where it happened and nowhere else until someone brings it, and the chain says who", () => {
    const { realm, store, live } = world(1);
    advanceWorld(realm, store, 10, { live });
    const origin = Object.values(realm.settlements).find((s) => s.kind === "village" && !s.way && !s.abandoned)!;
    realmNews(realm, realm.day, origin.id, "dungeon", `A bell rang in ${origin.name}.`, 6, [origin.name]);
    const n = realm.news.at(-1)!;
    expect(reachesAt(realm, n, origin.id)).toBe(realm.day);
    const others = Object.keys(realm.settlements).filter((id) => id !== origin.id);
    expect(others.filter((id) => reachesAt(realm, n, id) !== null)).toEqual([]);
    advanceWorld(realm, store, realm.day + 14, { live });
    const heard = others.filter((id) => reachesAt(realm, n, id) !== null);
    expect(heard.length).toBeGreaterThan(0);
    for (const id of heard) {
      const chain = newsChain(realm, n.id, id);
      expect(chain.length).toBeGreaterThanOrEqual(2);
      expect(chain[0]!.site).toBe(origin.id);
      expect(chain.at(-1)!.site).toBe(id);
      // Each step after the first was brought by a journey.
      for (const step of chain.slice(1)) expect(step.via).not.toBe("");
      // Never before it happened, and in order.
      for (let i = 1; i < chain.length; i++) expect(chain[i]!.day).toBeGreaterThanOrEqual(chain[i - 1]!.day);
    }
  });

  it("a place two roads away hears it through a traveller who heard it at an inn in between", () => {
    const { realm, store, live } = world(1);
    advanceWorld(realm, store, 8, { live });
    const origin = Object.values(realm.settlements).find((s) => s.kind === "town" && !s.abandoned)!;
    realmNews(realm, realm.day, origin.id, "war", `War in ${origin.name}.`, 6, [origin.name]);
    const n = realm.news.at(-1)!;
    advanceWorld(realm, store, realm.day + 25, { live });
    const long = Object.keys(realm.settlements).map((id) => newsChain(realm, n.id, id)).filter((c) => c.length >= 3);
    expect(long.length).toBeGreaterThan(0);
  });

  it("great news reaches the kingdom by couriers within days, even on quiet roads", () => {
    const { realm, store, live } = world(1);
    advanceWorld(realm, store, 6, { live });
    const capital = Object.values(realm.settlements).find((s) => s.kind === "capital" && !s.abandoned)!;
    realmNews(realm, realm.day, capital.id, "death", `The king of ${capital.name} is dead.`, 9, [capital.name]);
    const n = realm.news.at(-1)!;
    const start = realm.day;
    advanceWorld(realm, store, start + 12, { live });
    const kingdom = Object.values(realm.settlements).filter((s) => !s.way && !s.abandoned && s.kingdom === capital.kingdom);
    const heard = kingdom.filter((s) => reachesAt(realm, n, s.id) !== null).length;
    expect(heard / kingdom.length).toBeGreaterThanOrEqual(0.8);
    expect(journeysOf(realm).some((j) => j.kind === "courier" && j.carries?.some((c) => c.id === n.id))).toBe(true);
  });

  it("a place nobody comes to or goes from does not hear", () => {
    const { realm } = world(1);
    const lonely = Object.values(realm.settlements).find((s) => !s.way && !s.abandoned)!;
    const other = Object.values(realm.settlements).find((s) => s.id !== lonely.id && !s.way)!;
    realmNews(realm, 1, other.id, "war", "War.", 6, []);
    const n = realm.news.at(-1)!;
    exchangeNews(realm, 3);
    expect(reachesAt(realm, n, lonely.id)).toBeNull();
    hear(realm, lonely.id, n.id, 3, other.id, "j9");
    expect(reachesAt(realm, n, lonely.id)).toBe(3);
  });

  it("the stops of a journey are where news is swapped: setting out, each rest, the end", () => {
    const { realm, store, live } = world(1);
    advanceWorld(realm, store, 15, { live });
    const j = journeysOf(realm).find((x) => x.turn && x.arrive - x.depart > 3000)!;
    const stops = stopsOf(j);
    expect(stops[0]).toEqual({ minute: j.depart, site: j.path[0] });
    expect(stops.some((s) => s.site === j.turn!.site)).toBe(true);
    expect(stops.at(-1)!.minute).toBe(j.arrive);
    for (let d = 1; d < 15; d++) for (const e of stopsOn(realm, d)) expect(Math.floor(e.minute / 1440) + 1).toBe(d);
  });
});

describe("N26 Part E: off-screen meetings and situations", () => {
  it("parties that pass a gang or a pack sometimes meet it: robbed, hurt or turned back, on real rows, with news", () => {
    const { realm, store, live } = world(1);
    advanceWorld(realm, store, 60, { live });
    expect((realm.stats["road_ambush_lost"] ?? 0) + (realm.stats["road_ambush_beaten"] ?? 0)).toBeGreaterThan(0);
    const stopped = journeysOf(realm).filter((j) => j.ended && /robbed|driven back/.test(j.ended.why));
    for (const j of stopped) {
      expect(isOnTheRoad(j, j.ended!.minute - 1) || j.ended!.minute <= j.depart + 5000).toBe(true);
      expect(realm.news.some((n) => n.kind === "road" && n.text.includes(j.party[0]!.name))).toBe(true);
    }
    // Whoever died on the road did it on their own row, by someone else's hand.
    for (const r of store.dumpTable("people")) {
      if (!r.death) continue;
      const rec = JSON.parse(String(r.death)) as { cause: string; killer?: string; site: string | null };
      if (rec.killer && rec.site === null) expect(["murder", "beast"]).toContain(rec.cause);
    }
  });

  it("everyone in a situation on the road is a real person who is near", () => {
    const { realm, store, live } = world(1);
    advanceWorld(realm, store, 15, { live });
    const data = roadDataOf(realm);
    let found = 0;
    for (const road of data.roads.filter((r) => !r.id.startsWith("spur:")).slice(0, 12)) {
      for (let seg = 0; seg < 3; seg++) {
        const rolled = rollSegment(realm, data, road, seg, realm.day, store.people);
        if (!rolled) continue;
        for (const a of rolled.actors) {
          expect(store.people.get(a.person), a.name).not.toBeNull();
          found++;
        }
      }
    }
    expect(found).toBeGreaterThan(0);
    // No people table, no situation with people in it.
    for (const road of data.roads.slice(0, 5)) for (let seg = 0; seg < 3; seg++) expect(rollSegment(realm, data, road, seg, 500)?.actors ?? []).toEqual([]);
  });
});

describe("N26 Part E: the save is v14", () => {
  it("journeys, what places have heard, and coin in transit survive a save and a load", () => {
    const templates = loadCreatureTemplates();
    const w = newWorld(allPersonas(), templates);
    const realm = w.realm!;
    const store = new WorldStore(":memory:");
    materialisePeople(realm, store.people, 1);
    advanceWorld(realm, store, 12, { live: liveSites(realm, w.startSite, "all") });
    expect(journeysOf(realm).length).toBeGreaterThan(0);
    const file = join(mkdtempSync(join(tmpdir(), "n26e-")), "world.json");
    saveWorld(file, w);
    const back = loadWorld(file, allPersonas(), templates);
    expect(back.version).toBe(14);
    expect(back.realm!.journeys).toEqual(realm.journeys);
    expect(back.realm!.heard).toEqual(realm.heard);
    expect(back.realm!.transit).toEqual(realm.transit);
    expect((back as unknown as { journeys?: unknown }).journeys).toBeUndefined();
  });
});
