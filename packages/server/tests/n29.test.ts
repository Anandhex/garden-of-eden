/**
 * N29: the frame carries the facts of what can be heard (where, the hour, the weather, the crowd near by what they do,
 * the buildings near, hostiles near, the mood, the day's events); the adapter's `soundscape()` makes the mix from them.
 */
import { CrowdSim } from "@millbrook/shared";
import { soundscape } from "@millbrook/shared/view";
import { describe, expect, it } from "vitest";
import { generateRealm } from "../src/game/realm/generate.js";
import { pickStartSite } from "../src/game/realm/start.js";
import { rosterFor } from "../src/game/realm/townsfolk.js";
import { soundOf } from "../src/view/frame.js";
import { siteMap } from "../src/web/sites.js";

describe("N29: the sound facts in the frame", () => {
  it("say where the player is, the hour and weather, who's about, what stands near, and danger near", () => {
    const realm = generateRealm(7);
    const s = realm.settlements[pickStartSite(realm, realm.seed)]!;
    const m = siteMap(s, "village", realm);
    const r = rosterFor(realm, s.id, m, 1)!;
    const sim = new CrowdSim({ id: m.id, w: m.w, h: m.h, tiles: m.tiles, buildings: m.buildings, zones: m.zones }, r);
    const at = { x: Math.floor(m.w / 2), y: Math.floor(m.h / 2) };
    const pos = sim.all(3, 11 * 60, { weather: "rain", festival: false });
    const snap = {
      position: at,
      time: { hour: 11, minute: 0, season: "spring", weather: "rain", events: ["market"], festival: null },
      map: m,
      road: null,
      inside: null,
      site: { area: { id: "village" }, moodLevels: { grief: 50, fear: 0, joy: 0 } },
      creatures: [{ kind: "wolf", x: at.x + 10, y: at.y, aggressive: true, growth: "grown" }],
    } as never;
    const facts = soundOf(snap, sim, pos, null);
    expect(facts.where.kind).toBe("site");
    expect(facts.minute).toBe(11 * 60);
    expect(facts.weather).toBe("rain");
    expect(facts.near.people).toBeGreaterThan(0);
    expect(facts.buildings.length).toBeGreaterThan(0);
    expect(facts.predatorsNear).toBe(true);
    expect(facts.mood?.grief).toBe(50);
    expect(facts.events).toContain("market");
    const mix = soundscape(facts);
    expect(mix.beds.rain_roof).toBeGreaterThan(0);
    expect(mix.beds.birds_day ?? 0).toBeLessThan(0.1);
  });
});
