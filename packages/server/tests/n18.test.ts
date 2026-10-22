/**
 * N18: scale and storage. A seed gives the same world (named dice streams, deterministic ids);
 * a pre-v11 save is set aside; every person lives in SQLite, rolled once when the world is made,
 * saved by place in batches; the save and the database share a commit point; a world can be
 * exported and imported; 50,000 people save and load fast.
 */
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { config } from "../src/config.js";
import { seedFrom, streamFor } from "../src/game/dice.js";
import { WorldStore } from "../src/game/db.js";
import { worldHash } from "../src/game/hash.js";
import { openWorld } from "../src/game/openWorld.js";
import { loadCreatureTemplates } from "../src/game/creatures.js";
import { parseTownsfolkId, rosterFor, rosterFromStore } from "../src/game/realm/townsfolk.js";
import { loadWorld, loadWorldWithNotice, newWorld, SAVE_VERSION, SaveMismatchError, saveHooks, saveWorld, type SavedWorld } from "../src/game/save.js";
import { Town } from "../src/game/town.js";
import { biggestSite, bigRealm } from "../src/store/bench.js";
import { decodeMbWorld, encodeMbWorld, exportWorld, ImportError, importWorld, parseMbWorld } from "../src/store/exchange.js";
import { acquireSaveLock, lockFileFor } from "../src/store/lock.js";
import { materialisePeople } from "../src/store/materialise.js";
import { TABLES } from "../src/store/schema.js";
import { siteMap } from "../src/web/sites.js";
import { allPersonas, FakeProvider, makeTown } from "./helpers.js";

// Whole worlds for dozens of days: slower than the unit tests, and slower still with every file running at once.
vi.setConfig({ testTimeout: 180_000 });

const dirs: string[] = [];
const tmp = (name: string) => {
  const d = mkdtempSync(join(tmpdir(), `n18-${name}-`));
  dirs.push(d);
  return d;
};
/** Slack for slow machines (N19 makes this the shared PERF_SLACK). */
const SLACK = Number(process.env.PERF_SLACK ?? 1);

beforeEach(() => {
  config.director = false;
  config.planning = false;
  config.summaries = false;
  config.realm = true;
  config.realmSeed = 1;
  saveHooks.afterDbCommit = undefined;
});
afterAll(() => {
  config.realmSeed = undefined;
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/** The town the world being tested began in. */
let current: Town;
const HOME = () => current.world.startSite!;

/** A fresh world with its people in a database, played by a Town on its own streams. */
function startTown(seed: number, store = new WorldStore(":memory:")): Town {
  config.realmSeed = seed;
  const personas = allPersonas();
  const templates = loadCreatureTemplates();
  const opened = openWorld({ file: "/nonexistent/world.json", deathsFile: "/nonexistent/deaths.json", personas, templates, store, fresh: true });
  current = new Town({ personas, creatureTemplates: templates, world: opened.world, llm: new FakeProvider(), store });
  return current;
}
const play = (town: Town, days: number) => {
  for (let d = 0; d < days; d++) town.passHours(24);
};
const hashOf = (town: Town) => worldHash(town.world, town.store);

describe("N18.1 a seed gives the same world", () => {
  it("streams: same keys, same rolls; different keys, different rolls; drawing from one leaves another alone", () => {
    const a = streamFor(5, "realm", 3, "economy");
    const first = [a(), a(), a()];
    expect(first).toEqual([streamFor(5, "realm", 3, "economy")(), (() => { const s = streamFor(5, "realm", 3, "economy"); s(); return s(); })(), (() => { const s = streamFor(5, "realm", 3, "economy"); s(); s(); return s(); })()]);
    expect(streamFor(5, "realm", 3, "packs")()).not.toBe(first[0]);
    const noisy = streamFor(5, "other");
    for (let i = 0; i < 100; i++) noisy();
    expect(streamFor(5, "realm", 3, "economy")()).toBe(first[0]);
    expect(seedFrom("a:b")).toBe(seedFrom("a:b"));
  });

  it("two fresh worlds of one seed are the same after 30 days, down to the database", () => {
    const a = startTown(3);
    const b = startTown(3);
    expect(hashOf(a)).toBe(hashOf(b));
    play(a, 30);
    play(b, 30);
    expect(a.world.day).toBe(31);
    expect(hashOf(a)).toBe(hashOf(b));
    // And a different seed is a different world.
    expect(hashOf(startTown(4))).not.toBe(hashOf(startTown(3)));
  });

  it("event ids are the same on every run: e<day>-<hour>-<seq>", () => {
    const a = startTown(3);
    const b = startTown(3);
    play(a, 12);
    play(b, 12);
    const ids = (t: Town) => (t.world.events ?? []).map((e) => e.id);
    expect(ids(a)).toEqual(ids(b));
    for (const id of ids(a)) expect(id).toMatch(/^e\d+-\d+-\d+$/);
    expect(new Set(ids(a)).size).toBe(ids(a).length);
  });

  it("a new roll in one system leaves the realm and the village as they were", () => {
    // (One world at a time: the lore the realm teaches the cast is shared by every Town in a process.)
    const a = startTown(3);
    play(a, 6);
    const snapshot = (t: Town) => worldHash({ realm: t.world.realm, creatures: t.creaturesHere(), npcStates: t.world.npcStates, family: t.world.family });
    const expected = snapshot(a);
    const b = startTown(3);
    for (let d = 0; d < 6; d++) {
      // A brand new system takes rolls of its own, every day.
      const extra = b.rngFor("a-brand-new-system");
      for (let i = 0; i < 50; i++) extra();
      b.passHours(24);
    }
    expect(snapshot(b)).toBe(expected);
  });

  it("the world's seed is saved, and a loaded world goes on rolling the same", () => {
    const file = join(tmp("seed"), "world.json");
    const a = startTown(3);
    play(a, 3);
    saveWorld(file, a.world, a.store);
    const loaded = loadWorld(file, allPersonas(), loadCreatureTemplates(), a.store);
    expect(loaded.seed).toBe(3);
    expect(loaded.rolls).toEqual(a.world.rolls);
    expect(loaded.nextEventSeq).toBe(a.world.nextEventSeq);
  });
});

describe("N18.2 the v11 break", () => {
  it("a save from an older version is set aside, the database is reset, and a new world begins", () => {
    const dir = tmp("break");
    const file = join(dir, "world.json");
    const store = new WorldStore(":memory:");
    store.archiveEvent({ id: "e1-1-1", day: 1, hour: 1, kind: "gift", actor: "player", target: "brena", details: "old", importance: 3 });
    const old = JSON.parse(JSON.stringify(newWorld(allPersonas(), loadCreatureTemplates())));
    old.version = 10;
    writeFileSync(file, JSON.stringify(old));
    const r = loadWorldWithNotice(file, allPersonas(), loadCreatureTemplates(), store);
    expect(r.notice).toMatch(/older version/);
    expect(r.notice).toContain("world.v10.bak.json");
    expect(existsSync(file)).toBe(false);
    expect(readdirSync(dir)).toEqual(["world.v10.bak.json"]);
    expect(r.world.version).toBe(SAVE_VERSION);
    expect(store.eventCount()).toBe(0);
    // A second old save doesn't overwrite the first aside.
    writeFileSync(file, JSON.stringify(old));
    loadWorldWithNotice(file, allPersonas(), loadCreatureTemplates(), store);
    expect(readdirSync(dir).sort()).toEqual(["world.v10.bak.json", "world.v10.bak2.json"]);
  });

  it("openWorld on an old save leaves a new world with its people in the database", () => {
    const dir = tmp("break2");
    const file = join(dir, "world.json");
    writeFileSync(file, JSON.stringify({ ...newWorld(allPersonas(), loadCreatureTemplates()), version: 9 }));
    const store = new WorldStore(":memory:");
    const opened = openWorld({ file, deathsFile: join(dir, "deaths.json"), personas: allPersonas(), templates: loadCreatureTemplates(), store, fresh: false });
    expect(opened.notice).toMatch(/new world has begun/);
    expect(store.people.count()).toBeGreaterThan(20_000);
  });
});

describe("N18.3 everyone is in the database, rolled once", () => {
  it("every settlement's living count equals what the generator rolled, and reading a place back gives the same people", () => {
    // Open the world (which rolls everyone), and roll again at once with the generator: the same people.
    // (Later the realm moves on, and a re-roll would not be the same people: that is why the table is the truth.)
    config.realmSeed = 1;
    const store = new WorldStore(":memory:");
    const { world } = openWorld({ file: "/nonexistent/w.json", deathsFile: "/nonexistent/d.json", personas: allPersonas(), templates: loadCreatureTemplates(), store, fresh: true });
    const realm = world.realm!;
    let total = 0;
    for (const s of Object.values(realm.settlements)) {
      if (s.abandoned) continue;
      const map = siteMap(s, "village", realm);
      const rolled = rosterFor(realm, s.id, map, 1)!;
      expect(store.people.count(s.id), s.name).toBe(rolled.people.length);
      const back = rosterFromStore(store.people, realm, s.id, map, 1)!;
      expect(back.people.length).toBe(rolled.people.length);
      for (const [i, p] of rolled.people.entries()) expect(back.people[i], `${s.name} #${i}`).toEqual(p);
      expect({ ...back, people: [] }).toEqual({ ...rolled, people: [] });
      total += rolled.people.length;
    }
    expect(store.people.count()).toBe(total);
    expect(total).toBeGreaterThan(20_000);
  });

  it("ids keep N16's form, and ages follow the days", () => {
    const store = new WorldStore(":memory:");
    const town = startTown(1, store);
    const row = store.people.loadSite(HOME())[10]!;
    expect(parseTownsfolkId(row.id)).toEqual({ site: HOME(), n: 10 });
    const realm = town.world.realm!;
    const map = siteMap(realm.settlements[HOME()]!, "village", realm);
    const young = rosterFromStore(store.people, realm, HOME(), map, 1)!.people[10]!;
    const later = rosterFromStore(store.people, realm, HOME(), map, 1 + 5 * config.daysPerYear)!.people[10]!;
    expect(later.age).toBe(young.age + 5);
  });

  it("the roster keeps its identity until someone in the place changes, so the crowd is not rebuilt", () => {
    const store = new WorldStore(":memory:");
    const town = startTown(1, store);
    const realm = town.world.realm!;
    const map = siteMap(realm.settlements[HOME()]!, "village", realm);
    const a = rosterFromStore(store.people, realm, HOME(), map, 1)!;
    expect(rosterFromStore(store.people, realm, HOME(), map, 2)!.people).toBe(a.people);
    store.people.update(a.people[3]!.id, { persona: "someone" }); // talked to: the roster does not show it
    expect(rosterFromStore(store.people, realm, HOME(), map, 2)!.people).toBe(a.people);
    store.people.update(a.people[3]!.id, { job: "beggar" });
    const b = rosterFromStore(store.people, realm, HOME(), map, 2)!;
    expect(b.people).not.toBe(a.people);
    expect(b.people[3]!.job).toBe("beggar");
  });

  it("a house that is not on the map any more is replaced by one that is", () => {
    const store = new WorldStore(":memory:");
    const town = startTown(1, store);
    const realm = town.world.realm!;
    const map = siteMap(realm.settlements[HOME()]!, "village", realm);
    const gone = map.buildings.length + 7;
    const who = store.people.loadSite(HOME())[4]!.id;
    store.people.update(who, { home: gone, work: `front:${gone}` });
    const p = rosterFromStore(store.people, realm, HOME(), map, 1)!.people[4]!;
    expect(p.home).toBeLessThan(map.buildings.length);
    expect(map.buildings[p.home]!.kind).toBe("house");
    expect(p.work).toBe("streets");
  });

  it("meeting a townsperson sets their persona in the row, and the row and the file agree", () => {
    const store = new WorldStore(":memory:");
    const town = startTown(1, store);
    const realm = town.world.realm!;
    const map = siteMap(realm.settlements[HOME()]!, "village", realm);
    const roster = town.rosterAt(HOME(), map)!;
    const p = roster.people.find((x) => x.cls === "commoner" && x.job === "labourer")!;
    const id = town.meetTownsperson(roster, p)!;
    expect(id).toBe(p.id);
    expect(store.people.get(p.id)!.persona).toBe(p.id);
    const persona = town.personas[id]!;
    expect(persona.name).toBe(store.people.get(p.id)!.name);
  });
});

describe("N18.4 batch writes", () => {
  it("changing three people and flushing writes exactly three rows, in one transaction, and nothing before", () => {
    const store = new WorldStore(":memory:");
    store.people.insertMany(
      Array.from({ length: 10 }, (_, n) => ({ id: `t_x_${n}`, site: "x", n, name: `P${n}`, gender: "female", species: "human", born_day: -100, cls: "commoner", job: "labourer", home: 0, work: "streets", master: null, master_id: null, faction: null, mother: null, father: null, spouse: null, figure: null, persona: null, traits: null, death: null, expecting: null, last_birth: null, stepped_day: 0, outlook: null, away: null, rev: 0 })),
    );
    const before = store.people.commits;
    store.people.update("t_x_1", { job: "farmer" });
    store.people.update("t_x_4", { job: "smith" });
    store.people.update("t_x_4", { cls: "artisan" }); // the same person twice is one row
    store.people.update("t_x_7", { death: '{"day":3}' });
    expect(store.people.pending).toBe(3);
    // Nothing on disk yet: the table still has the old rows, rev 0.
    const raw = () => store.dumpTable("people").map((r) => [r.id, r.job, r.rev]);
    expect(store.people.commits).toBe(before);
    expect(store.people.get("t_x_1")!.job).toBe("farmer"); // reads see the pending change
    expect(store.people.flush(9)).toBe(3);
    expect(store.people.commits).toBe(before + 1);
    expect(store.people.pending).toBe(0);
    const rows = Object.fromEntries(store.dumpTable("people").map((r) => [String(r.id), r]));
    expect(rows.t_x_1).toMatchObject({ job: "farmer", rev: 1 });
    expect(rows.t_x_4).toMatchObject({ job: "smith", cls: "artisan", rev: 1 });
    expect(rows.t_x_7).toMatchObject({ rev: 1 });
    expect(rows.t_x_0).toMatchObject({ rev: 0 });
    expect(Object.values(rows).filter((r) => Number(r.rev) === 1)).toHaveLength(3);
    expect(store.savedTick()).toBe(9);
    // The dead are not "the living people of the place".
    expect(store.people.loadSite("x")).toHaveLength(9);
    void raw;
  });

  it("a transaction that throws is rolled back", () => {
    const store = new WorldStore(":memory:");
    expect(() =>
      store.people.transaction(() => {
        store.people.insertMany([{ id: "t_y_0", site: "y", n: 0, name: "A", gender: "male", species: "human", born_day: 0, cls: "serf", job: "farmer", home: 0, work: null, master: null, master_id: null, faction: null, mother: null, father: null, spouse: null, figure: null, persona: null, traits: null, death: null, expecting: null, last_birth: null, stepped_day: 0, outlook: null, away: null, rev: 0 }]);
        throw new Error("boom");
      }),
    ).toThrow("boom");
    expect(store.people.count()).toBe(0);
  });

  it("the save file is compact JSON, and the people are not in it", () => {
    const file = join(tmp("compact"), "world.json");
    const town = startTown(1);
    saveWorld(file, town.world, town.store);
    const text = readFileSync(file, "utf8");
    expect(text.trim().split("\n")).toHaveLength(1);
    expect(text).not.toContain("t_millbrook");
    expect(JSON.parse(text).saveTick).toBe(1);
  });

  it("the schema has the tables later phases need, and a version", () => {
    const store = new WorldStore(":memory:");
    for (const t of Object.keys(TABLES)) expect(() => store.dumpTable(t as keyof typeof TABLES)).not.toThrow();
    store.archiveEvent({ id: "e2-3-17", day: 2, hour: 3, kind: "gift", actor: "player", target: "brena", details: "x", importance: 2, causedBy: ["e1-1-1"], site: "millbrook", kingdom: "k1" });
    const row = store.dumpTable("events")[0]!;
    expect(row).toMatchObject({ seq: 17, site: "millbrook", kingdom: "k1" });
    expect(store.recentEvents()[0]).toMatchObject({ causedBy: ["e1-1-1"], site: "millbrook", kingdom: "k1" });
  });
});

describe("N18.5 one commit point", () => {
  it("a crash between the database commit and the file rename is reported on load, not guessed", () => {
    const dir = tmp("crash");
    const file = join(dir, "world.json");
    const store = new WorldStore(join(dir, "world.db"));
    const town = startTown(1, store);
    saveWorld(file, town.world, store);
    expect(store.savedTick()).toBe(1);
    store.people.update(store.people.loadSite(HOME())[0]!.id, { job: "beggar" });
    saveHooks.afterDbCommit = () => {
      throw new Error("power cut");
    };
    expect(() => saveWorld(file, town.world, store)).toThrow("power cut");
    expect(store.savedTick()).toBe(2);
    expect(JSON.parse(readFileSync(file, "utf8")).saveTick).toBe(1); // the old file is whole, not half-written
    expect(readdirSync(dir).filter((f) => f.endsWith(".tmp"))).toEqual([]);
    saveHooks.afterDbCommit = undefined;
    let err: unknown;
    try {
      loadWorld(file, allPersonas(), loadCreatureTemplates(), store);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SaveMismatchError);
    expect((err as SaveMismatchError).message).toMatch(/different moment/);
    // A save that went through loads fine.
    const ok = join(tmp("ok"), "world.json");
    const town2 = startTown(1);
    saveWorld(ok, town2.world, town2.store);
    expect(loadWorld(ok, allPersonas(), loadCreatureTemplates(), town2.store).seed).toBe(1);
  });

  it("a second game on the same saves is refused while the first is running", async () => {
    const dir = tmp("lock");
    const file = join(dir, "world.json");
    acquireSaveLock(file);
    expect(readFileSync(lockFileFor(file), "utf8")).toBe(String(process.pid));
    // A lock left by a process that is gone is taken over.
    writeFileSync(lockFileFor(file), "999999");
    acquireSaveLock(file);
    expect(readFileSync(lockFileFor(file), "utf8")).toBe(String(process.pid));
  });
});

describe("N18.6 export and import", () => {
  it("a world exported at day 5 and imported elsewhere goes on to the same world", () => {
    const dir = tmp("exchange");
    const a = startTown(3, new WorldStore(join(dir, "a.db")));
    play(a, 4);
    const mb = encodeMbWorld(exportWorld(a.world, a.store!));
    expect(mb.length).toBeGreaterThan(1000);

    // Into a new path.
    const saveFile = join(dir, "b", "world.json");
    const storeB = new WorldStore(join(dir, "b", "world.db"));
    const doc = decodeMbWorld(mb);
    expect(doc.saveVersion).toBe(SAVE_VERSION);
    importWorld(doc, { saveFile, store: storeB });
    expect(worldHash(doc.world, storeB)).toBe(worldHash(a.world, a.store));

    // Played on from a loaded save, both go the same way. (One after the other: the lore the realm teaches the
    // cast is shared by every Town in a process, and loading a save sets it.)
    play(a, 10);
    const loaded = loadWorld(saveFile, allPersonas(), loadCreatureTemplates(), storeB);
    const b = new Town({ personas: allPersonas(), creatureTemplates: loadCreatureTemplates(), world: loaded, llm: new FakeProvider(), store: storeB });
    play(b, 10);
    expect(b.world.day).toBe(a.world.day);
    expect(hashOf(b)).toBe(hashOf(a));
  });

  it("people not yet flushed are exported too", () => {
    const a = startTown(3);
    const id = a.store!.people.loadSite(HOME())[2]!.id;
    a.store!.people.update(id, { job: "beggar" });
    const doc = exportWorld(a.world, a.store!);
    expect(doc.tables.people.find((r) => r.id === id)!.job).toBe("beggar");
  });

  it("refuses what it should: another format, a newer container, another save version, a bad row, an existing save", () => {
    const a = startTown(3);
    const good = JSON.parse(JSON.stringify(exportWorld(a.world, a.store!)));
    expect(() => parseMbWorld({ ...good, format: "zip" })).toThrow(ImportError);
    expect(() => parseMbWorld({ ...good, version: 99 })).toThrow(/newer/);
    expect(() => parseMbWorld({ ...good, saveVersion: 10 })).toThrow(/save version 10/);
    expect(() => parseMbWorld({ ...good, world: { ...good.world, day: "x" } })).toThrow(/not sound/);
    const bad = JSON.parse(JSON.stringify(good));
    bad.tables.people[0].rogue = 1;
    expect(() => parseMbWorld(bad)).toThrow(/people/);
    expect(() => decodeMbWorld(Buffer.from("not gzip"))).toThrow(/Not a mbworld/);
    const dir = tmp("refuse");
    const file = join(dir, "world.json");
    writeFileSync(file, "{}");
    expect(() => importWorld(parseMbWorld(good), { saveFile: file, store: new WorldStore(":memory:") })).toThrow(/already exists/);
    importWorld(parseMbWorld(good), { saveFile: file, store: new WorldStore(":memory:"), force: true });
    expect((JSON.parse(readFileSync(file, "utf8")) as SavedWorld).seed).toBe(3);
  });
});

describe("N18.7 scale", () => {
  it("a realm of the size the game makes saves and loads fast", () => {
    const dir = tmp("scale");
    const realm = bigRealm(Number(process.env.LONG ? 50_000 : 25_000));
    const world = { ...newWorld({}, {}, () => 0.5, 1), realm };
    const store = new WorldStore(join(dir, "world.db"));
    const t0 = performance.now();
    const n = materialisePeople(realm, store.people, world.day);
    const made = performance.now() - t0;
    expect(n).toBeGreaterThan(process.env.LONG ? 49_000 : 24_000);
    expect(made).toBeLessThan(4000 * SLACK);

    // An hour's changes: a few hundred people.
    const site = biggestSite(realm);
    for (const r of store.people.loadSite(site).slice(0, 300)) store.people.update(r.id, { job: "labourer" });
    const file = join(dir, "world.json");
    const t1 = performance.now();
    saveWorld(file, world, store);
    expect(performance.now() - t1).toBeLessThan(1000 * SLACK);
    store.close();

    const cold = new WorldStore(join(dir, "world.db"));
    const map = siteMap(realm.settlements[site]!, "village", realm);
    const t2 = performance.now();
    const roster = rosterFromStore(cold.people, realm, site, map, world.day)!;
    expect(performance.now() - t2).toBeLessThan(2000 * SLACK);
    expect(roster.people.length).toBeGreaterThan(1000);
    expect(roster.people.filter((p) => p.job === "labourer").length).toBeGreaterThanOrEqual(300);
    cold.close();
  });
});
