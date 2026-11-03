/**
 * N35: moving through time, and N26 Part C (quiet travel is quick). One engine passes time an hour at a time and stops at
 * the first wake condition (news of someone followed, the season turning, danger always); a skip ends with what was heard;
 * fast travel stops for a gang on the road and goes on roads the player has been told of; on a quiet road the walk runs
 * faster in real time and drops back as soon as a party comes into view.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { config } from "../src/config.js";
import { loadCreatureTemplates } from "../src/game/creatures.js";
import { WorldStore } from "../src/game/db.js";
import { follow } from "../src/game/follow/follow.js";
import { learn } from "../src/game/gossip/knowledge.js";
import { worldHash } from "../src/game/hash.js";
import { recordLifeEvent } from "../src/game/people/events.js";
import { syncBeasts } from "../src/game/realm/beasts.js";
import { canFast, fastTravel, knownRoad, learnRoadsNear } from "../src/game/road/fast.js";
import { roadDataOf } from "../src/game/road/generateRoads.js";
import { launch } from "../src/game/road/journeys.js";
import { territoriesNow } from "../src/game/road/territories.js";
import { newWorld } from "../src/game/save.js";
import { maxSkipHours, passUntil, summaryLines } from "../src/game/time/pass.js";
import { Town } from "../src/game/town.js";
import { materialisePeople } from "../src/store/materialise.js";
import type { PersonRow } from "../src/store/peopleStore.js";
import { besideRoad } from "@millbrook/shared";
import { FakeProvider, always } from "./helpers.js";

vi.setConfig({ testTimeout: 300_000 });
beforeEach(() => {
  config.director = false;
  config.planning = false;
  config.realm = true;
});

const templates = loadCreatureTemplates();

function town(seed = 1, withStore = true): Town {
  const store = withStore ? new WorldStore(":memory:") : undefined;
  const world = newWorld({}, templates, always(0.5), seed);
  if (store) {
    materialisePeople(world.realm!, store.people, world.day);
    syncBeasts(world.realm!, store.beasts, world.day);
  }
  return new Town({ personas: {}, creatureTemplates: templates, world, llm: new FakeProvider(), ...(store ? { store } : {}) });
}

describe("N35 step 1: the engine", () => {
  it("waiting 24 hours through the engine is the same world as passing 24 hours", () => {
    const a = town(1, false);
    const b = town(1, false);
    for (let h = 0; h < 24; h++) a.passHours(1);
    const r = passUntil(b, { maxHours: 24, conditions: [] });
    expect(r.hours).toBe(24);
    expect(worldHash(b.world)).toBe(worldHash(a.world));
  });

  it("a raid on the player's place stops a long wait at once", () => {
    const t = town(1, false);
    const s = t.world.realm!.settlements[t.site()]!;
    let n = 0;
    const r = passUntil(t, {
      maxHours: 100,
      conditions: [],
      step: (h) => {
        const lines = t.passHours(h);
        if (++n === 5) s.lastRaided = t.world.day;
        return lines;
      },
    });
    expect(r.hours).toBe(5);
    expect(r.stoppedBy?.kind).toBe("danger");
  });
});

describe("N35 step 2: wake me when something happens to someone I follow", () => {
  it("woken when the news of her illness reaches the player's place, not when she fell ill", () => {
    const t = town(1);
    const realm = t.world.realm!;
    const store = t.store!;
    const home = t.site();
    const there = Object.values(realm.settlements).find((s) => !s.way && s.id !== home && store.people.count(s.id) > 0)!.id;
    const friend = (store.people.loadSite(there, "full") as PersonRow[]).find((r) => r.job !== "child")!;
    follow(t.world.player, friend.id, friend.name, "friend", t.world.day, { site: there, how: "you knew her there" });
    const day0 = t.world.day;
    const ill = recordLifeEvent(realm, store, { kind: "illness", actor: friend.id, site: there, day: day0, key: friend.id, details: `${friend.name} fell ill with a fever`, importance: 3 });
    // The news comes to the player's place three days later, with a traveller from there.
    const neighbour = (store.people.loadSite(home, "full") as PersonRow[]).find((r) => r.job !== "child")!;
    learn({ realm, store }, neighbour.id, `e:${ill.id}`, { day: day0 + 3, source: "saw", accuracy: 0.9, variant: 0 });
    // Danger wakes the player too (a raid here); they go back to waiting.
    let r = passUntil(t, { maxHours: maxSkipHours(), conditions: [{ kind: "followed", what: ["ill"] }] });
    for (let k = 0; k < 5 && r.stoppedBy?.kind === "danger"; k++) r = passUntil(t, { maxHours: maxSkipHours(), conditions: [{ kind: "followed", what: ["ill"] }] });
    expect(r.stoppedBy?.kind).toBe("followed");
    expect(r.stoppedBy?.ref).toBe(`e:${ill.id}`);
    expect(t.world.day).toBe(day0 + 3);
    expect(r.heard.some((h) => h.followed && h.ref === `e:${ill.id}`)).toBe(true);
  });
});

describe("N35 step 3: a season skip and what was heard", () => {
  it("skipping until the season turns ends there, with a short list of the news heard, each with source and sureness", () => {
    const t = town(1);
    const realm = t.world.realm!;
    const store = t.store!;
    const home = t.site();
    const friend = (store.people.loadSite(home, "full") as PersonRow[]).find((r) => r.job !== "child")!;
    follow(t.world.player, friend.id, friend.name, "friend", t.world.day, { site: home, how: "you saw her" });
    const ev = recordLifeEvent(realm, store, { kind: "marriage", actor: friend.id, site: home, day: t.world.day + 1, key: friend.id, details: `${friend.name} married`, importance: 3 });
    const teller = (store.people.loadSite(home, "full") as PersonRow[]).find((r) => r.job !== "child" && r.id !== friend.id)!;
    learn({ realm, store }, teller.id, `e:${ev.id}`, { day: t.world.day + 2, source: "saw", accuracy: 1, variant: 0 });
    const season0 = Math.floor((t.world.day - 1) / 12);
    let r = passUntil(t, { maxHours: maxSkipHours(), conditions: [{ kind: "season" }] });
    const heard = [...r.heard];
    for (let k = 0; k < 5 && r.stoppedBy?.kind === "danger"; k++) {
      r = passUntil(t, { maxHours: maxSkipHours(), conditions: [{ kind: "season" }] });
      heard.push(...r.heard);
    }
    r = { ...r, heard };
    expect(r.stoppedBy?.kind).toBe("season");
    expect(Math.floor((t.world.day - 1) / 12)).toBe(season0 + 1);
    expect(r.heard.length).toBeGreaterThan(0);
    expect(r.heard.length).toBeLessThanOrEqual(12);
    expect(r.heard[0]!.followed).toBe(true);
    const words = summaryLines(r).join(" ");
    expect(words).toContain("What you heard");
    expect(words).toMatch(/sure/);
  });
});

describe("N35 step 4: fast travel stops for a gang on the road", () => {
  it("along a known road through a gang's stretch, fast travel stops before it", () => {
    const t = town(1);
    const realm = t.world.realm!;
    const data = roadDataOf(realm);
    const gang = territoriesNow(realm, data).find((x) => x.kind === "gang")!;
    const road = data.roads.find((r) => r.id === gang.road)!;
    // Stand on the road before the gang's stretch, bound for the far end; the road is known.
    const start = besideRoad(road, Math.max(5, gang.t0 - 900), 0);
    t.world.player.road = { x: start.x, y: start.y, steps: 0, from: road.a, dest: road.b, paid: {}, met: {}, seen: {} };
    t.world.player.knownRoads = [road.id];
    t.world.hour = 7;
    expect(canFast(t)).toBe(true);
    const lines = fastTravel(t, (t.world.day - 1) * 1440 + 7 * 60).lines.join(" ");
    expect(lines).toMatch(/You stop|You slow/);
  });
});

describe("N26 Part C1: fast travel on roads the player knows of", () => {
  it("a road told of (not walked) can be fast-travelled, and it still stops for what's on the road; stretches crossed are walked", () => {
    const t = town(1);
    const realm = t.world.realm!;
    const data = roadDataOf(realm);
    const road = data.roads.find((r) => !r.id.startsWith("spur:") && r.length > 3000)!;
    const p = t.world.player;
    const at = besideRoad(road, 200, 0);
    p.road = { x: at.x, y: at.y, steps: 0, from: road.a, dest: road.b, paid: {}, met: {}, seen: {} };
    t.world.hour = 7;
    expect(knownRoad(p, road.id)).toBe(false);
    expect(canFast(t)).toBe(false);
    expect(learnRoadsNear(p, data, at, 50)).toBeGreaterThan(0);
    expect(knownRoad(p, road.id)).toBe(true);
    expect(canFast(t)).toBe(true);
    const before = { x: p.road.x, y: p.road.y };
    const r = fastTravel(t, (t.world.day - 1) * 1440 + 7 * 60);
    expect(r.ok).toBe(true);
    expect(r.lines.join(" ")).toContain("You take the road you know");
    // It stops for what's there (a situation rolled on this stretch), or goes on to the end of the known road.
    expect(r.lines.join(" ")).toMatch(/You stop|You are there/);
    const moved = !p.road || Math.hypot(p.road.x - before.x, p.road.y - before.y) > 10;
    expect(moved).toBe(true);
    // Every stretch it crossed whole is walked now.
    const walked = (p.walked ?? []).filter((x) => x.startsWith(`${road.id}#`));
    if (!p.road || Math.hypot(p.road.x - before.x, p.road.y - before.y) > 2000) expect(walked.length).toBeGreaterThan(0);
  });
});

describe("N35: the other waits", () => {
  it("until a set time stops on that hour; until someone arrives stops the hour they come", () => {
    const t = town(1);
    const now = (t.world.day - 1) * 24 + t.world.hour;
    const r = passUntil(t, { maxHours: 48, conditions: [{ kind: "time", at: now + 5 }] });
    expect(r.hours).toBe(5);
    expect(r.stoppedBy?.kind).toBe("time");
    // Someone of another place comes to the player's.
    const store = t.store!;
    const here = t.site();
    const other = Object.keys(t.world.realm!.settlements).find((x) => x !== here && store.people.count(x) > 0)!;
    const who = (store.people.loadSite(other, "full") as PersonRow[]).find((x) => x.job !== "child")!;
    let n = 0;
    const r2 = passUntil(t, {
      maxHours: 24,
      conditions: [{ kind: "arrives", who: who.id }],
      step: (h) => {
        const out = t.passHours(h);
        if (++n === 3) store.people.update(who.id, { site: here });
        return out;
      },
    });
    expect(r2.hours).toBe(3);
    expect(r2.stoppedBy?.kind).toBe("arrives");
    expect(r2.stoppedBy?.text).toContain(who.name);
  });
});

describe("N26 Part C: told the way", () => {
  it("a trader tells the roads out of their own place, and those roads can then be fast-travelled; a farmer tells none", () => {
    const t = town(1);
    const store = t.store!;
    const realm = t.world.realm!;
    const here = t.site();
    const data = roadDataOf(realm);
    const rows = store.people.loadSite(here, "full") as PersonRow[];
    const trader = rows.find((r) => r.job === "merchant") ?? rows.find((r) => r.job === "porter");
    const farmer = rows.find((r) => r.job === "farmer")!;
    expect(t.toldTheWay(farmer.id)).toBeNull();
    if (!trader) return;
    const out = data.roads.filter((r) => !r.id.startsWith("spur:") && (r.a === here || r.b === here));
    expect(out.length).toBeGreaterThan(0);
    const line = t.toldTheWay(trader.id)!;
    expect(line).toContain("tells you the way");
    for (const r of out) expect(knownRoad(t.world.player, r.id)).toBe(true);
    // Told once: nothing new the second time.
    expect(t.toldTheWay(trader.id)).toBeNull();
  });
});

describe("N26 Part C2: quick walking", () => {
  it("on a quiet stretch the walk runs faster in real time; a party coming into view brings it back to normal", () => {
    const t = town(1);
    const realm = t.world.realm!;
    const data = roadDataOf(realm);
    // A quiet spot: on a long road, away from places, territories and anything beside the road.
    let spot: { x: number; y: number; road: (typeof data.roads)[number] } | null = null;
    t.world.hour = 12;
    for (const r of data.roads.filter((x) => !x.id.startsWith("spur:") && x.length > 4000)) {
      for (let along = 1200; along < r.length - 1200 && !spot; along += 150) {
        const at = besideRoad(r, along, 0);
        t.world.player.road = { x: at.x, y: at.y, steps: 0, from: r.a, paid: {}, met: {}, seen: {} };
        if (t.road.quiet() > 1) spot = { ...at, road: r };
      }
      if (spot) break;
    }
    expect(spot).toBeTruthy();
    expect(t.road.quiet()).toBe(config.quietFactor);
    expect(t.road.view()!.quiet).toBe(config.quietFactor);
    // A party walks into view.
    const store = t.store!;
    const walker = (store.people.loadSite(spot!.road.a, "full") as PersonRow[]).find((r) => r.job !== "child")!;
    const j = launch(realm, data, { kind: "kin", party: [{ person: walker.id, name: walker.name, role: "visitor", gender: walker.gender as "female" | "male" }], path: [spot!.road.a, spot!.road.b], depart: (t.world.day - 1) * 1440, purpose: "a visit" })!;
    // Set the clock to when the party is beside the player.
    for (let m = j.depart; m < j.arrive; m += 10) {
      t.world.day = Math.floor(m / 1440) + 1;
      t.world.hour = Math.floor((m % 1440) / 60);
      t.world.minute = m % 60;
      if (t.road.quiet() === 1) break;
    }
    expect(t.road.quiet()).toBe(1);
  });
});
