/**
 * N29: the soundscape. What should be heard is a pure function of the facts the frame carries: the square changes from
 * dawn to night and with the crowd; rain is heard on the roofs in a storm; the woods have birdsong by day and owls by
 * night and go quiet when wolves are near; a curfew night is silent but for the watch.
 */
import { describe, expect, it } from "vitest";
import { soundscape, type ScapeInput } from "../src/view/sound.js";

const square = (minute: number, people = 20, o: Partial<ScapeInput> = {}): ScapeInput => ({
  where: { kind: "site", area: "village" },
  minute,
  season: "summer",
  weather: "clear",
  near: { people, working: {}, chatting: 4, children: 2 },
  buildings: [{ kind: "smithy", d: 8, dx: 5 }, { kind: "temple", d: 12, dx: -6 }, { kind: "inn", d: 5, dx: 2 }],
  ...o,
});

describe("N29: the square from dawn to night", () => {
  it("birds at dawn, the crowd and the market by day (rising with the crowd), insects and owls at night", () => {
    const dawn = soundscape(square(5 * 60 + 30, 3));
    const noon = soundscape(square(12 * 60, 20, { events: ["market"] }));
    const busy = soundscape(square(12 * 60, 80, { events: ["market"] }));
    const night = soundscape(square(23 * 60, 2));
    expect(dawn.beds.birds_dawn).toBeGreaterThan(0.3);
    expect(noon.beds.birds_dawn ?? 0).toBe(0);
    expect(noon.beds.crowd_murmur).toBeGreaterThan(0);
    expect(noon.beds.market).toBeGreaterThan(0);
    expect(busy.beds.crowd_murmur!).toBeGreaterThan(noon.beds.crowd_murmur!);
    expect(night.beds.insects_night).toBeGreaterThan(0);
    expect(night.spots.some((s) => s.source === "owl")).toBe(true);
    expect(noon.spots.some((s) => s.source === "owl")).toBe(false);
    // The inn of an evening; the smith's hammer only while the smith is at work; the temple bell on the hour.
    expect(soundscape(square(20 * 60)).beds.tavern).toBeGreaterThan(0);
    expect(noon.spots.some((s) => s.source === "hammer")).toBe(false);
    expect(soundscape(square(12 * 60, 20, { near: { people: 20, working: { smith: 1 }, chatting: 0, children: 0 } })).spots.some((s) => s.source === "hammer")).toBe(true);
    expect(soundscape(square(9 * 60)).spots.some((s) => s.source === "bell")).toBe(true);
    expect(soundscape(square(9 * 60 + 17)).spots.some((s) => s.source === "bell")).toBe(false);
  });

  it("rain is on the roofs in a place in a storm, and in the open on the road", () => {
    const storm = soundscape(square(14 * 60, 10, { weather: "storm" }));
    expect(storm.beds.rain_roof).toBeGreaterThan(0.7);
    expect(storm.spots.some((s) => s.source === "thunder")).toBe(true);
    const road = soundscape({ ...square(14 * 60, 0, { weather: "rain" }), where: { kind: "road" }, buildings: [] });
    expect(road.beds.rain_open).toBeGreaterThan(0);
    expect(road.beds.rain_roof ?? 0).toBe(0);
  });

  it("the woods: birdsong by day, owls by night, quiet when wolves are near", () => {
    const woods = (minute: number, predatorsNear = false) => soundscape({ where: { kind: "road", biome: "forest" }, minute, season: "spring", weather: "clear", near: { people: 0, working: {}, chatting: 0, children: 0 }, buildings: [], ...(predatorsNear ? { predatorsNear } : {}) });
    expect(woods(11 * 60).beds.birds_day).toBeGreaterThan(0.3);
    expect(woods(23 * 60).spots.some((s) => s.source === "owl")).toBe(true);
    expect(woods(11 * 60, true).beds.birds_day!).toBeLessThan(woods(11 * 60).beds.birds_day! / 4);
    expect(woods(22 * 60, true).spots.some((s) => s.source === "wolf_howl")).toBe(true);
  });

  it("a curfew night is silent but for the watch", () => {
    const c = soundscape(square(22 * 60, 30, { curfew: true }));
    expect(c.beds.crowd_murmur ?? 0).toBe(0);
    expect(c.beds.tavern ?? 0).toBe(0);
    expect(c.spots.map((s) => s.source).filter((x) => x !== "owl")).toEqual(["watch"]);
  });

  it("grief hushes the crowd and the inn; a festival brings music", () => {
    expect(soundscape(square(12 * 60, 30, { mood: { grief: 80, fear: 0, joy: 0 } })).beds.crowd_murmur!).toBeLessThan(soundscape(square(12 * 60, 30)).beds.crowd_murmur!);
    expect(soundscape(square(19 * 60, 30, { events: ["festival"] })).beds.music).toBeGreaterThan(0);
  });
});
