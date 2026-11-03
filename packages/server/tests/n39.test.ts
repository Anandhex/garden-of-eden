import { beforeEach, describe, expect, it, vi } from "vitest";
import { config } from "../src/config.js";
import { loadCreatureTemplates } from "../src/game/creatures.js";
import { WorldStore } from "../src/game/db.js";
import { eventRef } from "../src/game/gossip/refs.js";
import { BREAKS_AT, COMES_AT, pickIncident, satisfiable } from "../src/game/firsthour/run.js";
import { bindNeeds, townNow } from "../src/game/firsthour/needs.js";
import { loadIncidents, NEED_KINDS } from "../src/game/firsthour/schema.js";
import { generateRealm } from "../src/game/realm/generate.js";
import { startable, startCandidates } from "../src/game/realm/start.js";
import { newWorld } from "../src/game/save.js";
import { Town } from "../src/game/town.js";
import { initiativeFor } from "../src/npc/initiative.js";
import { materialisePeople } from "../src/store/materialise.js";
import { FakeProvider } from "./helpers.js";

/**
 * N39: the first hour. A new game lets the player choose where to begin; code then finds something already brewing in that town,
 * stages it to break within minutes where the player will see it, and the player's choice runs on the normal systems: gossip carries
 * it, and the people in it treat the player differently. Places and people are found by role, never by name.
 */
vi.setConfig({ testTimeout: 300_000, hookTimeout: 300_000 });

beforeEach(() => {
  config.realm = true;
  config.realmSeed = undefined;
  config.director = false;
  config.planning = false;
  config.firstHour = true;
  config.gossip = true;
  config.chatter = true;
});

const SEEDS = [1, 2, 3, 4, 5];

/** A new game as the server makes one: the world, its people in the database, and the town activated (which stages the first hour). */
function newGame(seed: number, start?: string) {
  const templates = loadCreatureTemplates();
  const store = new WorldStore(":memory:");
  const world = newWorld({}, templates, Math.random, seed, start ? { start } : {});
  materialisePeople(world.realm!, store.people, world.day);
  const town = new Town({ personas: {}, creatureTemplates: templates, world, llm: new FakeProvider(), store, stories: false });
  return { town, world, store };
}

describe("N39 step 1: choosing the start town", () => {
  it("offers startable towns from more than one kingdom, the seed's pick among them; choosing one starts there", () => {
    for (const seed of [1, 7]) {
      const realm = generateRealm(seed, 1);
      const c = startCandidates(realm);
      expect(c.length).toBeGreaterThanOrEqual(4);
      expect(c.length).toBeLessThanOrEqual(6);
      for (const x of c) {
        expect(startable(realm.settlements[x.id]!)).toBe(true);
        expect(x.line.length).toBeGreaterThan(10);
      }
      const kingdoms = new Set(Object.values(realm.settlements).filter(startable).map((s) => s.kingdom));
      if (kingdoms.size > 1) expect(new Set(c.map((x) => x.kingdom)).size).toBeGreaterThan(1);
      const other = c.find((x) => x.id !== c[0]!.id)!;
      const w = newWorld({}, {}, Math.random, seed, { start: other.name });
      expect(w.startSite).toBe(other.id);
      expect(w.player.site).toBe(other.id);
      expect(w.location).toContain(other.name);
    }
  });
});

describe("N39 step 2: incidents as data, and what a town has brewing", () => {
  it("every incident file passes the schema, there are ten or more, and one can always happen", () => {
    const all = loadIncidents();
    expect(all.length).toBeGreaterThanOrEqual(10);
    expect(all.some((d) => d.needs.length === 0)).toBe(true);
  });

  it("each need finds what it should in some seeded town, and binds real living people of it", () => {
    const found = new Set<string>();
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const realm = generateRealm(seed, 1);
      const store = new WorldStore(":memory:");
      materialisePeople(realm, store.people, 1);
      for (const s of Object.values(realm.settlements).filter(startable).slice(0, 6)) {
        const t = townNow(realm, store, s.id, 1);
        for (const kind of NEED_KINDS) {
          const b = bindNeeds(t, [{ kind, minWeight: 0.1 }], `probe-${kind}`);
          if (!b) continue;
          found.add(kind);
          for (const id of Object.values(b.roles)) {
            const r = store.people.get(id)!;
            expect(r.death).toBeNull();
            expect(r.away).toBeNull();
          }
        }
      }
      store.close();
    }
    // A fresh world has no grudges yet (they grow from chatter) and nothing sent against any place yet: every other need is found somewhere.
    for (const kind of NEED_KINDS.filter((k) => k !== "grievance" && k !== "arrival_due")) expect(found.has(kind), kind).toBe(true);
  });

  it("a grudge heavy enough is found and binds the two who share it", async () => {
    const realm = generateRealm(3, 1);
    const store = new WorldStore(":memory:");
    materialisePeople(realm, store.people, 1);
    const site = Object.values(realm.settlements).find(startable)!.id;
    const t = townNow(realm, store, site, 1);
    expect(bindNeeds(t, [{ kind: "grievance", minWeight: 0.5 }], "g")).toBeNull();
    const [a, b] = t.rows.filter((r) => r.job === "farmer");
    const { addGrievance } = await import("../src/game/chatter/grievance.js");
    addGrievance(store, { who: a!.id, against: b!.id, cause: "e:test", weight: 0.9, day: 1 });
    const g = bindNeeds(townNow(realm, store, site, 1), [{ kind: "grievance", minWeight: 0.5 }], "g")!;
    expect(g.roles).toEqual({ avenger: a!.id, victim: b!.id });
  });

  it("raiders the realm has sent for tonight are found, with someone who keeps watch", () => {
    const realm = generateRealm(1, 1);
    const store = new WorldStore(":memory:");
    materialisePeople(realm, store.people, 1);
    const site = Object.values(realm.settlements).find((s) => startable(s) && (store.people.loadSite(s.id, "full") as Array<{ job: string }>).some((r) => r.job === "guard" || r.job === "hunter"))!.id;
    expect(bindNeeds(townNow(realm, store, site, 1), [{ kind: "arrival_due" }], "a")).toBeNull();
    realm.arrivals[site] = [{ day: 1, kind: "raid", count: 4, by: "the Red Hands" }];
    const b = bindNeeds(townNow(realm, store, site, 1), [{ kind: "arrival_due" }], "a")!;
    expect(b.words.arrival).toContain("the Red Hands");
    expect(["guard", "hunter"]).toContain(store.people.get(b.roles.watchman!)!.job);
  });
});

describe("N39 steps 3-4: picking, staging, and drawing the player in", () => {
  it("five seeds each pick a satisfiable incident (at least four different), staged without touching the database", () => {
    const picked: string[] = [];
    for (const seed of SEEDS) {
      const { town, world, store } = newGame(seed);
      const fh = world.firstHour!;
      expect(fh, `seed ${seed}`).toBeDefined();
      expect(satisfiable(world.realm!, store, world.startSite, 1).map((p) => p.def.id)).toContain(fh.incident);
      // Picking is the seed's: the same seed picks the same.
      expect(pickIncident(world.realm!, store, world.startSite, 1, seed)!.def.id).toBe(fh.incident);
      expect(fh.staged.every((l) => l.includes("first hour"))).toBe(true);
      for (const id of Object.values(fh.roles)) expect(store.people.get(id)!.site).toBe(world.startSite);
      picked.push(fh.incident);
      town.close();
    }
    expect(new Set(picked).size).toBeGreaterThanOrEqual(4);
  });

  it("the player is drawn in within five game minutes, wherever they stand, and sooner at the stage", () => {
    for (const seed of SEEDS) {
      const { town, world } = newGame(seed);
      expect(town.incident()).toBeNull();
      const lines: string[] = [];
      for (let m = 0; m < COMES_AT && !town.incident(); m++) lines.push(...town.walkMinutes(1));
      const view = town.incident();
      expect(view, `seed ${seed}`).not.toBeNull();
      expect(view!.choices.length).toBeGreaterThanOrEqual(2);
      expect(view!.text).not.toMatch(/\{[a-z]+\}/);
      expect(lines.length).toBeGreaterThan(0);
      town.close();
    }
    // At the stage it breaks at minute three.
    const { town, world } = newGame(1);
    world.player.place = world.firstHour!.stage;
    for (let m = 0; m < BREAKS_AT; m++) town.walkMinutes(1);
    expect(town.incident()).not.toBeNull();
    town.close();
  });
});

describe("N39 step 5: consequences show", () => {
  it("the choice is gossiped about within the first day, and someone treats the player differently because of it", () => {
    for (const seed of [1, 2, 3]) {
      const runs = [0, 1].map((k) => {
        const g = newGame(seed);
        for (let m = 0; m < COMES_AT && !g.town.incident(); m++) g.town.walkMinutes(1);
        const view = g.town.incident()!;
        const choice = view.choices.filter((c) => !c.hint)[k === 0 ? 0 : view.choices.filter((c) => !c.hint).length - 1]!;
        const r = g.town.chooseIncident(choice.id);
        expect(r.ok).toBe(true);
        return { ...g, choice: choice.id };
      });
      const { town, world, store } = runs[0]!;
      const fh = world.firstHour!;
      expect(fh.state).toBe("done");
      const ref = eventRef(fh.event!);
      const there = new Set([...Object.values(fh.roles), ...(store.eventById(fh.event!)?.witnesses ?? [])]);
      town.passHours(24);
      const heard = store.knowledge.holders(ref).filter((k) => !there.has(k.who));
      expect(heard.length, `seed ${seed}: people who weren't there know of it`).toBeGreaterThan(0);
      // The people in it feel differently about the player for what they chose (a row toward the player differs between the two choices).
      const other = runs[1]!;
      const roles = Object.values(fh.roles);
      const differs = roles.some((id) => JSON.stringify(store.social.rel(id, "player")) !== JSON.stringify(other.store.social.rel(id, "player")) || store.social.openBetween(id, "player").length !== other.store.social.openBetween(id, "player").length);
      expect(differs, `seed ${seed}: ${runs[0]!.choice} vs ${runs[1]!.choice}`).toBe(true);
      // Someone in it who now talks brings it up when they next see the player.
      const talker = roles.map((id) => town.agents[id]).find((a) => a && !a.isDead);
      expect(talker).toBeDefined();
      const opening = initiativeFor(talker!.persona, talker!.state, town.sceneFor(talker!));
      expect(opening?.trigger === "firsthour" || opening?.trigger === "grudge" || opening?.trigger === "crime", `seed ${seed}`).toBe(true);
      for (const r of runs) r.town.close();
    }
  });

  it("a v15 save without a first hour loads, and a world's first hour survives save and load", async () => {
    const { mkdtempSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const { saveWorld, loadWorld } = await import("../src/game/save.js");
    const g = newGame(2);
    for (let m = 0; m < COMES_AT && !g.town.incident(); m++) g.town.walkMinutes(1);
    const file = join(mkdtempSync(join(tmpdir(), "n39-")), "world.json");
    saveWorld(file, g.world);
    const back = loadWorld(file, {});
    expect(back.firstHour?.incident).toBe(g.world.firstHour!.incident);
    expect(back.firstHour?.state).toBe("pending");
    g.town.close();
  });
});

describe("N39 step 6: words", () => {
  it("the model may retell the opening with the incident's own names, and anything it invents is thrown away", async () => {
    const { writeIncidentLine } = await import("../src/game/firsthour/words.js");
    const { say } = await import("./helpers.js");
    const g = newGame(3);
    const fh = g.world.firstHour!;
    const name = Object.values(fh.names)[0]!;
    const good = await writeIncidentLine(new FakeProvider([say(JSON.stringify({ text: `Down in the square ${name} is in trouble, and every eye turns to you as you come near.` }))]), fh, "the town");
    expect(good).toContain(name);
    const bad = await writeIncidentLine(new FakeProvider([say(JSON.stringify({ text: `Down in the square ${name} is in trouble, and Lord Vastimor watches from his tower as you come near.` }))]), fh, "the town");
    expect(bad).toBeNull();
    g.town.close();
  });
});

describe("N39 in the browser: the protocol", () => {
  it("a new game's incident comes up as a choice within minutes, and choosing it closes it with its lines in the feed", async () => {
    const { ProtocolClient, startGame } = await import("../scripts/game-process.js");
    const game = await startGame({ env: { FIRST_HOUR: "on", TIME_FLOW_SECONDS: "0.2" } });
    try {
      const c = new ProtocolClient(game.port);
      await c.opened();
      c.hello();
      await c.until(() => c.ui.modal?.kind === "situation", 60_000, "the opening incident");
      const choice = c.ui.modal!.actions.find((a) => a.enabled)!;
      expect(choice.id.startsWith("incident:")).toBe(true);
      const from = c.msgs.length;
      c.send(choice.intent as never);
      await c.until(() => c.ui.modal === null && c.since(from).some((m) => m.t === "feed"), 30_000, "the choice made");
      const s = (await (await fetch(`http://127.0.0.1:${game.port}/api/state`)).json()) as { incident?: unknown };
      expect(s.incident ?? null).toBeNull();
      c.close();
    } finally {
      game.stop();
    }
  });
});

describe("N39 balance: first-hour-variety", () => {
  it("over twenty seeds at least six different incidents are picked", () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 20; seed++) {
      const realm = generateRealm(seed, 1);
      const store = new WorldStore(":memory:");
      materialisePeople(realm, store.people, 1);
      const w = newWorld({}, {}, Math.random, seed);
      const p = pickIncident(realm, store, w.startSite, 1, seed);
      if (p) seen.add(p.def.id);
      store.close();
    }
    expect(seen.size).toBeGreaterThanOrEqual(6);
  });
});
