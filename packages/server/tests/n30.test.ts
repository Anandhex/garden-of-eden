/**
 * N30: seasons and the farming year. One calendar says where in the year a day falls; the weather is regional (colder
 * north and high up); a place's food follows the farming year with the harvest in autumn and a lean late winter; food
 * prices follow the stores; the crowd's day follows the light; high roads close with snow and open again; four
 * festivals a year fill the square; and the map shows the season.
 */
import { CrowdSim, closedRoads, daylight, overrideWeather, regionOf, roadClosed, seasonAt, seasonDay, shortestWay, weatherAt, yearFraction, yearNumber, type CrowdDay } from "@millbrook/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { config } from "../src/config.js";
import { crowdDayAt, festivalOn, priceFactor, storesFactor, townEventsOn } from "../src/game/events-calendar.js";
import { judgeHarvest } from "../src/game/realm/harvest.js";
import { packsDay, WINTER_HUNGER } from "../src/game/realm/wilds.js";
import { realmDay } from "../src/game/realm/day.js";
import { generateRealm } from "../src/game/realm/generate.js";
import { checkSeasonBounds } from "../src/game/realm/seasonBounds.js";
import { pickStartSite } from "../src/game/realm/start.js";
import { rosterFor } from "../src/game/realm/townsfolk.js";
import type { Realm } from "../src/game/realm/types.js";
import { roadDataOf } from "../src/game/road/generateRoads.js";
import { launch } from "../src/game/road/journeys.js";
import { closedOn, pathAround } from "../src/game/road/snow.js";
import { seededRng } from "../src/game/dice.js";
import { seasonOf, weatherAtSite } from "../src/game/weather.js";
import { siteMap } from "../src/web/sites.js";

vi.setConfig({ testTimeout: 300_000 });
beforeEach(() => {
  config.director = false;
  config.planning = false;
});
afterEach(() => overrideWeather(null));

const DPY = config.daysPerYear;

describe("N30 step 1: the calendar", () => {
  it("day 1 is spring day 1, day 13 is summer day 1, the year turns on day 49", () => {
    expect(seasonAt(1, 48)).toBe("spring");
    expect(seasonDay(1, 48)).toBe(1);
    expect(seasonAt(13, 48)).toBe("summer");
    expect(seasonDay(13, 48)).toBe(1);
    expect(seasonDay(24, 48)).toBe(12);
    expect(seasonAt(37, 48)).toBe("winter");
    expect(yearNumber(48, 48)).toBe(1);
    expect(yearNumber(49, 48)).toBe(2);
    expect(seasonAt(49, 48)).toBe("spring");
  });

  it("the share of the year steps evenly, at 48 days a year and at 12", () => {
    for (const dpy of [12, 48]) {
      const steps = Array.from({ length: dpy }, (_, i) => yearFraction(i + 2, dpy) - yearFraction(i + 1, dpy)).slice(0, dpy - 1);
      for (const s of steps) expect(s).toBeCloseTo(1 / dpy);
      expect(yearFraction(dpy + 1, dpy)).toBe(0);
    }
  });

  it("the day is longest at midsummer and shortest at midwinter, and swings more in the north", () => {
    const len = (day: number, north = 0.5) => {
      const d = daylight(day, 48, north);
      return d.set - d.rise;
    };
    const lengths = Array.from({ length: 48 }, (_, i) => len(i + 1));
    expect(lengths.indexOf(Math.max(...lengths)) + 1).toBeGreaterThanOrEqual(18);
    expect(lengths.indexOf(Math.max(...lengths)) + 1).toBeLessThanOrEqual(20);
    expect(lengths.indexOf(Math.min(...lengths)) + 1).toBeGreaterThanOrEqual(42);
    expect(len(19, 1) - len(43, 1)).toBeGreaterThan(len(19, 0) - len(43, 0));
  });
});

describe("N30 step 2: regional weather", () => {
  it("over a year the north sees snow and the south hardly any; the same seed gives the same weather", () => {
    const north = { x: 500, y: 40 };
    const south = { x: 500, y: 660 };
    let n = 0;
    let s = 0;
    for (let d = 1; d <= DPY; d++) {
      if (weatherAt(3, d, north, "plains", DPY) === "snow") n++;
      if (weatherAt(3, d, south, "plains", DPY) === "snow") s++;
      expect(weatherAt(3, d, north, "hills", DPY)).toBe(weatherAt(3, d, north, "hills", DPY));
    }
    expect(n).toBeGreaterThanOrEqual(4);
    expect(s).toBeLessThan(n / 3);
  });

  it("two neighbouring places share the weather on most days, and a storm can lie over one region and not another", () => {
    const a = { x: 300, y: 300 };
    const b = { x: 320, y: 310 };
    expect(regionOf(a)).toBe(regionOf(b));
    let same = 0;
    let differs = 0;
    for (let d = 1; d <= DPY * 3; d++) {
      if (weatherAt(5, d, a, "plains", DPY) === weatherAt(5, d, b, "plains", DPY)) same++;
      if (weatherAt(5, d, a, "plains", DPY) !== weatherAt(5, d, { x: 900, y: 650 }, "plains", DPY)) differs++;
    }
    expect(same / (DPY * 3)).toBeGreaterThan(0.8);
    expect(differs).toBeGreaterThan(0);
  });
});

/** Run a realm for `days` days from day 2, noting each day's food at a place. */
function run(realm: Realm, days: number, site: string): number[] {
  const food = [realm.settlements[site]!.food];
  for (let d = 2; d <= days + 1; d++) {
    realmDay(realm, d, seededRng(d));
    food.push(realm.settlements[site]!.food);
  }
  return food;
}

describe("N30 step 3: the farming year", () => {
  it("over a year the stores rise through autumn and fall through winter, in most places", () => {
    const realm = generateRealm(1, 1);
    const ids = Object.values(realm.settlements).filter((s) => !s.way).map((s) => s.id);
    const series = new Map<string, number[]>(ids.map((id) => [id, []]));
    for (let d = 2; d <= DPY + 1; d++) {
      realmDay(realm, d, seededRng(d));
      for (const id of ids) series.get(id)!.push(realm.settlements[id]!.food);
    }
    const at = (id: string, day: number) => series.get(id)![day - 2]!;
    const autumn0 = 25;
    const winter0 = 37;
    const living = ids.filter((id) => !realm.settlements[id]!.abandoned && !realm.settlements[id]!.fallen);
    const rose = living.filter((id) => at(id, winter0 - 1) > at(id, autumn0) || at(id, winter0 - 1) >= 99);
    const fell = living.filter((id) => at(id, DPY) < at(id, winter0));
    expect(rose.length / living.length).toBeGreaterThan(0.75);
    expect(fell.length / living.length).toBeGreaterThan(0.75);
    // Every place's harvest was judged on the first day of winter.
    expect(living.filter((id) => realm.settlements[id]!.harvest?.yield).length / living.length).toBeGreaterThan(0.9);
  });

  it("a storm on the harvest days gives a poor year, with news of it", () => {
    const fair = generateRealm(2, 1);
    const stormy = generateRealm(2, 1);
    const id = Object.values(fair.settlements).find((s) => !s.way && s.kind === "village")!.id;
    overrideWeather((d) => (seasonOf(d) === "autumn" ? "storm" : "clear"));
    for (let d = 2; d <= 37; d++) realmDay(stormy, d, seededRng(d));
    overrideWeather((d) => (seasonOf(d) === "autumn" ? "clear" : undefined));
    for (let d = 2; d <= 37; d++) realmDay(fair, d, seededRng(d));
    const a = fair.settlements[id]!.harvest!;
    const b = stormy.settlements[id]!.harvest!;
    expect(b.share!).toBeLessThan(a.share!);
    expect(b.yield).toBe("poor");
    expect(stormy.news.some((n) => n.kind === "harvest" && n.at === id && n.text.includes("poor"))).toBe(true);
  });

  it("the harvest is judged only on the first day of winter", () => {
    const realm = generateRealm(1, 1);
    const s = Object.values(realm.settlements).find((x) => !x.way)!;
    s.harvest = { year: 1, got: 10, could: 20 };
    expect(judgeHarvest(realm, s, 30)).toBeNull();
    expect(judgeHarvest(realm, s, 37)).toBe("poor");
    expect(judgeHarvest(realm, s, 38)).toBeNull();
  });
});

describe("N30 step 4: prices follow the stores", () => {
  it("bread costs more on the last winter day than just after the harvest", () => {
    const realm = generateRealm(1, 1);
    const start = pickStartSite(realm, realm.seed);
    overrideWeather(() => "clear");
    const food = run(realm, DPY - 1, start);
    const world = (day: number) => ({ day, recentEvents: [], realm, player: { site: start } }) as never;
    const afterHarvest = food[37 - 1]!;
    const lateWinter = food[DPY - 1]!;
    realm.settlements[start]!.food = afterHarvest;
    const cheap = priceFactor("bread loaf", world(37));
    realm.settlements[start]!.food = lateWinter;
    const dear = priceFactor("bread loaf", world(DPY));
    expect(lateWinter).toBeLessThan(afterHarvest);
    expect(dear).toBeGreaterThan(cheap);
    expect(storesFactor(0)).toBe(2);
    expect(storesFactor(50)).toBe(1);
    expect(priceFactor("iron sword", world(DPY))).toBe(1);
  });
});

describe("N30 step 5: the crowd's seasons", () => {
  const realm = generateRealm(7);
  const s = realm.settlements[pickStartSite(realm, realm.seed)]!;
  const m = siteMap(s, "village", realm);
  const r = rosterFor(realm, s.id, m, 1)!;
  const sim = () => new CrowdSim({ id: m.id, w: m.w, h: m.h, tiles: m.tiles, buildings: m.buildings, zones: m.zones }, r);
  const dayAt = (day: number): CrowdDay => ({ ...crowdDayAt({ day, recentEvents: [], realm } as never, s.id), weather: "clear", festival: false });

  it("the first worker leaves home later in winter than in summer", () => {
    const firstOut = (day: number) => {
      const c = sim();
      for (let t = 4 * 60; t < 11 * 60; t += 5) if (c.all(day, t, dayAt(day)).some((p, i) => r.people[i]!.job !== "guard" && p.doing !== "asleep" && p.visible)) return t;
      return 11 * 60;
    };
    expect(firstOut(43)).toBeGreaterThan(firstOut(19));
  });

  it("fewer people are out on a winter evening than a summer one", () => {
    const out = (day: number) => sim().all(day, 20 * 60, dayAt(day)).filter((p) => p.doing === "taking their ease").length;
    const summer = [14, 15, 16, 17, 18].reduce((a, d) => a + out(d), 0);
    const winter = [38, 39, 40, 41, 42].reduce((a, d) => a + out(d), 0);
    expect(winter).toBeLessThan(summer);
  });
});

/** A realm with a high road on it. */
function realmWithHighRoad(): { realm: Realm; road: ReturnType<typeof roadDataOf>["roads"][number] } {
  for (let seed = 1; seed < 40; seed++) {
    const realm = generateRealm(seed, 1);
    const road = roadDataOf(realm).roads.find((r) => r.high);
    if (road) return { realm, road };
  }
  throw new Error("no high road on seeds 1-39");
}

describe("N30 step 6: roads that close", () => {
  it("a high road closes after two days of snow at its pass and opens after two days without", () => {
    const { realm, road } = realmWithHighRoad();
    const snow = new Set([40, 41, 42]);
    overrideWeather((d, pos) => (pos && snow.has(d) ? "snow" : "clear"));
    expect(roadClosed(realm.seed, road, 40, DPY)).toBe(false);
    expect(roadClosed(realm.seed, road, 41, DPY)).toBe(true);
    expect(roadClosed(realm.seed, road, 43, DPY)).toBe(true);
    expect(roadClosed(realm.seed, road, 44, DPY)).toBe(false);
    // A low road never closes.
    const low = roadDataOf(realm).roads.find((r) => !r.high && !r.id.startsWith("spur:"))!;
    expect(roadClosed(realm.seed, low, 41, DPY)).toBe(false);
  });

  it("a journey setting out over a closed pass goes another way or waits; one on an open day takes the pass", () => {
    const { realm, road } = realmWithHighRoad();
    const data = roadDataOf(realm);
    overrideWeather((d, pos) => (pos && d >= 40 && d <= 44 ? "snow" : "clear"));
    expect(closedOn(realm, data, 42).has(road.id)).toBe(true);
    const path = [road.a, road.b];
    const around = pathAround(realm, data, path, [{ id: road.id }], 42);
    if (around) {
      expect(around.path[0]).toBe(road.a);
      expect(around.path.at(-1)).toBe(road.b);
      expect(around.path.length).toBeGreaterThan(2);
    }
    const shut = closedRoads(realm.seed, data.roads, 42, DPY);
    const way = shortestWay(data, road.a, road.b, undefined, shut);
    expect(way?.roads.some((r) => r.id === road.id) ?? false).toBe(false);
    const party = [{ person: "p_test_1", role: "walker" }] as never;
    const j = launch(realm, data, { kind: "kin", party, path, depart: (42 - 1) * 1440 + 6 * 60, purpose: "a visit" });
    if (j) expect(j.roads.some((r) => r.id === road.id)).toBe(false);
    const open = launch(realm, data, { kind: "kin", party, path, depart: (20 - 1) * 1440 + 6 * 60, purpose: "a visit" });
    expect(open?.roads.map((r) => r.id)).toEqual([road.id]);
  });

  it("news from beyond a snowed-in pass arrives later than on an open day: its carriers go the long way round, or wait", () => {
    const { realm, road } = realmWithHighRoad();
    const data = roadDataOf(realm);
    overrideWeather((d, pos) => (pos && d >= 40 && d <= 44 ? "snow" : "clear"));
    const party = [{ person: "p_test_1", role: "walker" }] as never;
    const carries = [{ id: "n_test", from: road.a }];
    const go = (day: number) => launch(realm, data, { kind: "kin", party, path: [road.a, road.b], depart: (day - 1) * 1440 + 6 * 60, purpose: "a visit", carries });
    const open = go(20)!;
    const shut = go(42);
    const took = (j: { depart: number; arrive: number }) => j.arrive - j.depart;
    // Shut: they don't set out today (the news waits with them), or the way round takes longer.
    if (shut) expect(took(shut)).toBeGreaterThan(took(open));
    expect(open.carries?.map((c) => c.id)).toEqual(["n_test"]);
  });

  it("over two years no high road stays shut for more than a season", () => {
    const { realm } = realmWithHighRoad();
    realm.day = DPY * 2;
    const b = checkSeasonBounds(realm, DPY * 2).find((x) => x.name === "roads-reopen")!;
    expect(b.ok).toBe(true);
  });
});

describe("N30 step 7: festivals", () => {
  it("four festivals a year, on the second day of each season", () => {
    const days = Array.from({ length: DPY }, (_, i) => i + 1).filter((d) => festivalOn(d));
    expect(days).toEqual([2, 14, 26, 38]);
    expect(days.map((d) => festivalOn(d))).toEqual(["planting", "midsummer", "harvest home", "midwinter"]);
    for (const d of days) expect(townEventsOn({ day: d, recentEvents: [] } as never)).toContain("festival");
  });

  it("each season's festival fills the square in the evening", () => {
    const realm = generateRealm(7);
    const s = realm.settlements[pickStartSite(realm, realm.seed)]!;
    const m = siteMap(s, "village", realm);
    const r = rosterFor(realm, s.id, m, 1)!;
    for (const d of [2, 14, 26, 38]) {
      const day = { ...crowdDayAt({ day: d, recentEvents: [], realm } as never, s.id), weather: "clear" };
      expect(day.festival).toBe(true);
      const at = new CrowdSim({ id: m.id, w: m.w, h: m.h, tiles: m.tiles, buildings: m.buildings, zones: m.zones }, r).all(d, 19 * 60 + 30, day);
      expect(at.filter((p) => p.doing === "at the festival").length).toBeGreaterThan(r.people.length * 0.3);
    }
  });
});

describe("N30 bounds", () => {
  it("over a year of the realm no place is hungry for more than a season, and the harvest matters", () => {
    const realm = generateRealm(1, 1);
    for (let d = 2; d <= DPY + 1; d++) realmDay(realm, d, seededRng(d));
    const bounds = checkSeasonBounds(realm, DPY + 1);
    for (const b of bounds) expect(b.ok, `${b.name}: ${b.detail}`).toBe(true);
    expect(weatherAtSite(realm, Object.keys(realm.settlements)[0]!, 5)).toBeTruthy();
  });
});

describe("N30: beasts hungrier in winter", () => {
  it("full packs fall on their places more often in winter than in summer (WINTER_HUNGER)", () => {
    expect(WINTER_HUNGER).toBeGreaterThan(1);
    const attacks = (day: number) => {
      const realm = generateRealm(1, 1);
      const packs = Object.values(realm.packs).filter((p) => realm.settlements[p.near]);
      let n = 0;
      for (let k = 0; k < 120; k++) {
        for (const p of packs) {
          p.count = p.cap;
          delete p.lastAttack;
        }
        packsDay(realm, day, seededRng(k + 1));
        n += packs.filter((p) => p.lastAttack === day).length;
      }
      return n;
    };
    expect(seasonOf(17)).toBe("summer");
    expect(seasonOf(41)).toBe("winter");
    const summer = attacks(17);
    const winter = attacks(41);
    expect(summer).toBeGreaterThan(10);
    expect(winter).toBeGreaterThan(summer * 1.15);
  });
});
