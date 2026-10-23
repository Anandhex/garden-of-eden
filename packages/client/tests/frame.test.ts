/**
 * N19: the frame budget, in CI by proxy (since G5 the minute burst runs in the server's frame builder, the walking and names in the web adapter). Real frames per second need a GPU and a browser, so
 * this times the work the browser does for a capital's crowd outside drawing: the walkers'
 * positions and the nearest names every frame, and everyone's place once a game minute (one
 * minute is TIME_FLOW_SECONDS of real time, so a burst every ~120 frames). The real 60 fps
 * check is `?fps=1` in the browser (README: "Checking the frame rate").
 */
import { CrowdSim, type CrowdDay, type CrowdPos } from "@millbrook/shared";
import { describe, expect, it } from "vitest";
import { budgets, perfSlack } from "../../server/src/budgets.js";
import { generateRealm } from "../../server/src/game/realm/generate.js";
import { rosterFor } from "../../server/src/game/realm/townsfolk.js";
import { siteMap } from "../../server/src/web/sites.js";
import { gossipBubble } from "../../server/src/view/frame.js";
import { FrameMeter, fpsWanted, nearestShown, walkAt, type Walker } from "../src/adapter/web/world/fps";

const CLEAR: CrowdDay = { weather: "clear", festival: false };
/** 60 frames a second, and a game minute every 2 real seconds (config.timeFlowSeconds). */
const FRAME_MS = 1000 / 60;
const FRAMES_PER_MINUTE = 120;
const STEP_MS = 250;

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;

function capital() {
  const realm = generateRealm(7);
  const s = Object.values(realm.settlements).find((x) => x.kind === "capital" && !x.home)!;
  const m = siteMap(s, "village", realm);
  const roster = rosterFor(realm, s.id, m, 1)!;
  return { sim: new CrowdSim({ id: m.id, w: m.w, h: m.h, tiles: m.tiles, buildings: m.buildings, zones: m.zones }, roster), roster };
}

describe("N19 the capital's crowd, per frame", () => {
  const { sim, roster } = capital();

  it("is a real capital: thousands of people", () => {
    expect(roster.people.length).toBeGreaterThan(2000);
  });

  it("stays inside the frame budget over 600 frames", () => {
    const day = 3;
    let minute = 10 * 60;
    // Warm the code up first (the first calls are the slowest and aren't what a player's frame sees).
    for (let m = 0; m < 3; m++) sim.all(day, minute - 5 - m, CLEAR);
    let pos: CrowdPos[] = sim.all(day, minute, CLEAR);
    const sprites = pos.map((p) => ({ shown: p.visible, x: p.x, y: p.y }));
    const walkers = new Map<number, Walker>();
    const player = { x: Math.floor(sim.map.w / 2), y: Math.floor(sim.map.h / 2) };
    const perFrame: number[] = [];
    const bursts: number[] = [];
    let sink = 0;
    for (let f = 0; f < 600; f++) {
      const start = performance.now();
      const now = f * FRAME_MS;
      if (f > 0 && f % FRAMES_PER_MINUTE === 0) {
        // A new minute: everyone's place, and who has to walk where.
        const t0 = performance.now();
        minute++;
        const next = sim.all(day, minute, CLEAR);
        next.forEach((p, i) => {
          const sp = sprites[i]!;
          if (p.visible && (p.x !== sp.x || p.y !== sp.y)) walkers.set(i, { fx: sp.x * 32, fy: sp.y * 32, tx: p.x * 32, ty: p.y * 32, t0: now, dur: STEP_MS });
          sp.shown = p.visible;
          sp.x = p.x;
          sp.y = p.y;
        });
        pos = next;
        bursts.push(performance.now() - t0);
      }
      for (const [i, w] of walkers) {
        const r = walkAt(w, now);
        sink += r.x + r.y + r.bob;
        if (r.done) walkers.delete(i);
      }
      sink += nearestShown(sprites, player, 3, 6).length;
      perFrame.push(performance.now() - start - (f > 0 && f % FRAMES_PER_MINUTE === 0 ? bursts.at(-1)! : 0));
    }
    expect(Number.isFinite(sink)).toBe(true);
    expect(pos.length).toBe(roster.people.length);
    const limit = budgets.frame.capitalCrowdMs * perfSlack();
    // Never a single sample: the median frame, and the minute's burst (spread over the two seconds it covers).
    expect(median(perFrame)).toBeLessThan(limit);
    expect(median(bursts) / FRAMES_PER_MINUTE).toBeLessThan(limit);
    // And the burst itself is one dropped frame a game minute, so it must stay about a frame's worth. The best of
    // the bursts, not the median: other tests running at the same time slow a burst, and can't make it faster.
    for (let m = 0; m < 12; m++) {
      const t0 = performance.now();
      sim.all(day, minute + 1 + m, CLEAR);
      bursts.push(performance.now() - t0);
    }
    expect(Math.min(...bursts)).toBeLessThan(budgets.frame.capitalMinuteMs * perfSlack());
    console.log(`capital ${roster.people.length} people: frame median ${median(perFrame).toFixed(3)} ms, minute burst best ${Math.min(...bursts).toFixed(2)} ms, median ${median(bursts).toFixed(2)} ms (budget ${limit} ms)`);
  });
});

describe("N33 gossip bubbles", () => {
  it("say what was told, short and in a speaker's words", () => {
    expect(gossipBubble("Wenna Tanner died of an illness")).toBe("Did you hear? Wenna Tanner died of an illness.");
    expect(gossipBubble("x".repeat(200)).length).toBeLessThanOrEqual(70);
  });
});

describe("N19 the frame meter", () => {
  it("counts frames over the last second and the worst frame in the last 10 s", () => {
    const m = new FrameMeter();
    for (let t = 0; t < 12_000; t += 16) m.push(t, t === 3000 ? 80 : 16);
    // The 80 ms frame at 3 s is out of the 10 s window by 12 s.
    expect(m.worst()).toBeLessThan(80);
    m.push(12_016, 90);
    expect(m.worst()).toBe(90);
    expect(m.fps(12_016)).toBeGreaterThan(55);
    expect(m.fps(12_016)).toBeLessThan(65);
  });

  it("is asked for with ?fps=1", () => {
    expect(fpsWanted("?fps=1")).toBe(true);
    expect(fpsWanted("?x=1")).toBe(false);
    expect(fpsWanted("")).toBe(false);
  });

  it("walks along a step and stops at its end", () => {
    const w: Walker = { fx: 0, fy: 0, tx: 100, ty: 50, t0: 1000, dur: 200 };
    expect(walkAt(w, 1100)).toMatchObject({ x: 50, y: 25, done: false });
    expect(walkAt(w, 1300)).toMatchObject({ x: 100, y: 50, bob: 0, done: true });
  });

  it("shows the nearest names only, nearest first", () => {
    const people = [4, 1, 9, 2].map((x) => ({ shown: true, x, y: 0 }));
    people.push({ shown: false, x: 0, y: 0 });
    expect(nearestShown(people, { x: 0, y: 0 }, 5, 2)).toEqual([1, 3]);
    expect(nearestShown(people, { x: 0, y: 0 }, 0.5, 2)).toEqual([]);
  });
});
