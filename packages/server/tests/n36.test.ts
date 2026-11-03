/**
 * N36: the mood of a place. Six numbers worked out each day from what happened there: a raid that kills several puts the
 * start town in grief (its talk turns to it, fewer go out of an evening, drink costs more, strangers get a cooler welcome,
 * people's reviews are darker) and it fades over weeks; a festival after a good harvest makes it glad.
 */
import { CrowdSim, chatLines, MOOD_TALK, type CrowdDay } from "@millbrook/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { config } from "../src/config.js";
import { festivalOn, priceFactor } from "../src/game/events-calendar.js";
import { checkMoodBounds, dominant, moodLine, moodRealmDay, shocksOf, type Mood } from "../src/game/mood/model.js";
import { TAX_DAYS } from "../src/game/realm/politics.js";
import { review, type Season } from "../src/game/people/outlook.js";
import { generateRealm } from "../src/game/realm/generate.js";
import { pickStartSite } from "../src/game/realm/start.js";
import { rosterFor } from "../src/game/realm/townsfolk.js";
import { firstImpression } from "../src/game/reputation.js";
import { siteMap } from "../src/web/sites.js";

vi.setConfig({ testTimeout: 120_000 });
beforeEach(() => {
  config.director = false;
  config.planning = false;
});

function raided(seed = 1) {
  const realm = generateRealm(seed, 1);
  const start = pickStartSite(realm, realm.seed);
  const s = realm.settlements[start]!;
  // Day 5: raiders kill six people.
  const day = 5;
  realm.casualties.push({ site: start, cause: "raid", count: 6, event: `raid:${day}:${start}`, day });
  s.lastRaided = day;
  moodRealmDay(realm, day);
  realm.casualties = [];
  return { realm, start, s, day };
}

describe("N36 step 1: the mood model", () => {
  it("a raid that kills several puts the start town in grief, with the raid as its cause, and it fades within a season", () => {
    const { realm, s, day, start } = raided();
    const m = s.mood as Mood;
    expect(dominant(m)).toBe("grief");
    expect(m.fear).toBeGreaterThan(30);
    expect(m.causes?.some((c) => c.ref === `raid:${day}:${start}` && c.mood === "grief")).toBe(true);
    expect(moodLine(s, realm)).toMatch(/grieving \(after the raid on day 5\)/);
    // Weeks pass with nothing new.
    let d = day;
    let still = 0;
    for (d = day + 1; d <= day + config.daysPerYear / 4; d++) {
      moodRealmDay(realm, d);
      if ((s.mood as Mood).grief > 30) still = d;
    }
    expect((s.mood as Mood).grief).toBeLessThan(30);
    expect(still - day).toBeGreaterThanOrEqual(3);
  });

  it("the same events give the same mood (it reads only the realm, so a lazy place and a lived one agree)", () => {
    const a = raided(1);
    const b = raided(1);
    for (let d = 6; d < 12; d++) {
      moodRealmDay(a.realm, d);
      moodRealmDay(b.realm, d);
    }
    expect(b.s.mood).toEqual(a.s.mood);
  });

  it("a festival after a good harvest makes the place glad", () => {
    const realm = generateRealm(1, 1);
    const start = pickStartSite(realm, realm.seed);
    const s = realm.settlements[start]!;
    s.harvest = { year: 1, got: 100, could: 80, yield: "good", share: 1.25, after: 60 };
    const fest = Array.from({ length: config.daysPerYear }, (_, i) => i + 1).find((d) => festivalOn(d) === "midwinter")!;
    moodRealmDay(realm, fest);
    expect(dominant(s.mood as Mood)).toBe("joy");
  });
});

describe("N36 steps 2–4: what the mood does", () => {
  const realm = generateRealm(7);
  const s = realm.settlements[pickStartSite(realm, realm.seed)]!;
  const m = siteMap(s, "village", realm);
  const r = rosterFor(realm, s.id, m, 1)!;
  const sim = () => new CrowdSim({ id: m.id, w: m.w, h: m.h, tiles: m.tiles, buildings: m.buildings, zones: m.zones }, r);

  it("talk turns to the grief, and fewer go out of an evening", () => {
    const grief: CrowdDay = { weather: "clear", festival: false, mood: "grief" };
    const lines = Array.from({ length: 40 }, (_, k) => chatLines(r, r.people[0]!, r.people[1]!, grief, 600, k * 13 + 1));
    const fromTable = lines.filter(([a]) => MOOD_TALK.grief!.some(([x]) => x === a)).length;
    expect(fromTable).toBeGreaterThan(20);
    const out = (d: CrowdDay) => [3, 4, 5, 6].reduce((n, day) => n + sim().all(day, 20 * 60, d).filter((p) => p.doing === "taking their ease").length, 0);
    expect(out(grief)).toBeLessThan(out({ weather: "clear", festival: false }));
  });

  it("after the raid ale and blades cost more, and a stranger gets a cooler welcome", () => {
    const { realm: rr, start, s: town } = raided();
    const world = () => ({ day: 6, recentEvents: [], realm: rr, player: { site: start } }) as never;
    const mood = town.mood;
    const dear = priceFactor("ale", world());
    town.mood = undefined;
    const usual = priceFactor("ale", world());
    town.mood = mood;
    expect(dear).toBeGreaterThan(usual);
    const st = { metBefore: false, triggerDay: {} as Record<string, number>, relationship: 0, fear: 0, respect: 0, affection: 0 };
    firstImpression(st as never, { reputation: undefined, titles: [] } as never, 6, mood as never);
    expect(st.relationship).toBeLessThan(0);
    // Once: a second meeting isn't another first impression.
    firstImpression(st as never, { reputation: undefined, titles: [] } as never, 7, mood as never);
    expect(st.relationship).toBe(-6);
  });

  it("people reviewed while the place grieves come out lower than in glad times", () => {
    const row = { id: "t_x_1", cls: "commoner" } as never;
    const old = { r: 0, mood: 0, lord: { t: 0, f: 0, e: 0, a: 0 } };
    const base: Season = { days: 6, famine: 0, raided: 0, war: 0, plague: 0 };
    const sad = review(row, old as never, { ...base, gloom: 0.8 }, [], [], 10, 1);
    const glad = review(row, old as never, { ...base, cheer: 0.8 }, [], [], 10, 1);
    expect(sad.mood).toBeLessThan(glad.mood);
  });
});

describe("N36 bounds", () => {
  it("no place is pinned in one mood for more than a season without fresh shocks", () => {
    const realm = generateRealm(1, 1);
    for (let d = 2; d <= config.daysPerYear; d++) moodRealmDay(realm, d);
    for (const b of checkMoodBounds(realm, config.daysPerYear)) expect(b.ok, `${b.name}: ${b.detail}`).toBe(true);
  });
});

describe("N36: victories and taxes", () => {
  it("a war won gladdens the winners' places and angers the losers'; a war levy or a heavy share on tax day angers a place", () => {
    const realm = generateRealm(1, 1);
    const s = realm.settlements[pickStartSite(realm, realm.seed)]!;
    const other = Object.keys(realm.kingdoms).find((k) => k !== s.kingdom)!;
    const loser = Object.values(realm.settlements).find((x) => x.kingdom === other && !x.way && !x.abandoned)!;
    const day = 10;
    realm.wars.push({ id: "w_test", attackers: [`k:${s.kingdom}`], defenders: [`k:${other}`], cause: "a test", start: 2, score: 80, battles: [], end: day, outcome: "won", winner: "attackers" });
    expect(shocksOf(realm, s, day, false)).toContainEqual(expect.objectContaining({ ref: "victory:w_test", mood: "joy" }));
    expect(shocksOf(realm, loser, day, false)).toContainEqual(expect.objectContaining({ ref: "defeat:w_test", mood: "anger" }));
    // The day after, it's over: no new shock.
    expect(shocksOf(realm, s, day + 1, false).some((x) => x.ref === "victory:w_test")).toBe(false);
    // A heavy share on tax day.
    const payer = Object.values(realm.settlements).find((x) => x.liege && !x.way && !x.abandoned)!;
    payer.taxRate = 0.1;
    expect(shocksOf(realm, payer, TAX_DAYS, false).some((x) => x.ref.startsWith("tax:"))).toBe(false);
    payer.taxRate = 0.4;
    expect(shocksOf(realm, payer, TAX_DAYS, false)).toContainEqual(expect.objectContaining({ ref: `tax:${TAX_DAYS}:${payer.id}`, mood: "anger" }));
    expect(shocksOf(realm, payer, TAX_DAYS + 1, false).some((x) => x.ref.startsWith("tax:"))).toBe(false);
  });
});
