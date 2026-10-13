import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import brena from "./fixtures/npcs/brena.json" with { type: "json" };
import pell from "./fixtures/npcs/pell.json" with { type: "json" };
import { WorldStore } from "../src/game/db.js";
import { openWorld } from "../src/game/openWorld.js";
import { loadWorld, newWorld, saveWorld } from "../src/game/save.js";
import { parsePersona } from "../src/npc/personaSchema.js";

const personas = {
  brena: parsePersona(brena, "brena.json"),
  pell: parsePersona(pell, "pell.json"),
};

describe("world saves", () => {
  it("round-trips clock, player and every NPC state", () => {
    const file = join(mkdtempSync(join(tmpdir(), "llm-game-save-")), "world.json");
    const world = newWorld(personas);
    world.day = 4;
    world.minute = 37;
    world.player.money = 7;
    world.player.journal = [{ id: "secret", day: 3, text: "Brena trusts me." }];
    world.npcStates.pell!.relationship = 42;
    world.npcStates.pell!.debts = { loan: 13 };
    saveWorld(file, world);

    const loaded = loadWorld(file, personas);
    expect(loaded.day).toBe(4);
    expect(loaded.minute).toBe(37);
    expect(loaded.player.money).toBe(7);
    expect(loaded.player.journal).toEqual([{ id: "secret", day: 3, text: "Brena trusts me." }]);
    expect(loaded.npcStates.pell?.relationship).toBe(42);
    expect(loaded.npcStates.pell?.debts).toEqual({ loan: 13 });
  });

  it("keeps a full session: purchase, trust, quest and part-paid debt", () => {
    const file = join(mkdtempSync(join(tmpdir(), "llm-game-save-")), "world.json");
    const world = newWorld(personas);
    world.player.money = 12;
    world.player.inventory = { sword: 1 };
    world.player.quests.active = [{ id: "iron-run" } as never];
    world.player.quests.completed = ["first-delivery"];
    world.npcStates.brena!.relationship = 60;
    world.npcStates.pell!.debts = { loan: 25 };
    world.position = { x: 5, y: 9 };
    saveWorld(file, world);

    const loaded = loadWorld(file, personas);
    expect(loaded.player.inventory).toEqual({ sword: 1 });
    expect(loaded.player.quests.active).toEqual([{ id: "iron-run" }]);
    expect(loaded.player.quests.completed).toEqual(["first-delivery"]);
    expect(loaded.npcStates.brena?.relationship).toBe(60);
    expect(loaded.npcStates.pell?.debts).toEqual({ loan: 25 });
    expect(loaded.position).toEqual({ x: 5, y: 9 });
  });

  it("sets an old (v12) save aside with its deaths file, and begins a new world", () => {
    const dir = mkdtempSync(join(tmpdir(), "llm-game-save-"));
    const file = join(dir, "world.json");
    const deathsFile = join(dir, "deaths.json");
    writeFileSync(file, `${JSON.stringify({ ...newWorld(personas), version: 12 })}\n`);
    writeFileSync(deathsFile, JSON.stringify({ pell: { npcId: "pell", name: "Old Pell", day: 2, hour: 9, killedBy: "player" } }));
    const opened = openWorld({ file, deathsFile, templates: {}, store: new WorldStore(":memory:"), fresh: false });
    expect(opened.notice).toMatch(/older version \(12\)/);
    expect(opened.world.deaths).toEqual({});
    expect(existsSync(deathsFile)).toBe(false);
    expect(existsSync(`${deathsFile}.v12.bak`)).toBe(true);
    expect(existsSync(file.replace(/\.json$/, ".v12.bak.json"))).toBe(true);
  });

  it("upgrades saves without a minute or journal", () => {
    const file = join(mkdtempSync(join(tmpdir(), "llm-game-save-")), "world.json");
    const world = newWorld(personas);
    const old = { ...world, version: 0, minute: undefined };
    delete old.player.journal;
    writeFileSync(file, `${JSON.stringify(old)}\n`);
    const loaded = loadWorld(file, personas);
    expect(loaded.minute).toBe(0);
    expect(loaded.player.journal).toEqual([]);
  });
});

describe("save version 6 (N4-N6)", () => {
  it("keeps the name, memories, axes, needs, the event log and the raid day", () => {
    const file = join(mkdtempSync(join(tmpdir(), "llm-game-save-")), "world.json");
    const world = newWorld(personas);
    const b = world.npcStates.brena!;
    b.knownName = "Anand";
    b.nameSource = { how: "told" };
    b.metBefore = true;
    b.fear = 12;
    b.respect = 20;
    b.affection = 7;
    b.needs = { hunger: 33, energy: 44 };
    b.memories.push({ id: "insulted-1", day: 1, text: "they insulted you", importance: 6, valence: -1 });
    b.emotions.push({ kind: "resentment", strength: 0.5, about: "x", since: 1 });
    world.events = [{ id: "e1", day: 1, hour: 14, kind: "insulted", actor: "player", target: "brena", details: "junk", importance: 6 }];
    world.lastRaidDay = 1;
    world.player.facts = ["pell.hale_cellar"];
    saveWorld(file, world);
    const loaded = loadWorld(file, personas);
    expect(loaded.npcStates.brena).toMatchObject({ knownName: "Anand", metBefore: true, fear: 12, respect: 20, affection: 7, needs: { hunger: 33, energy: 44 } });
    expect(loaded.npcStates.brena!.emotions).toHaveLength(1);
    expect(loaded.events).toHaveLength(1);
    expect(loaded.lastRaidDay).toBe(1);
    expect(loaded.player.facts).toEqual(["pell.hale_cellar"]);
  });

  it("a version 5 save loads with the new fields at their defaults", () => {
    const file = join(mkdtempSync(join(tmpdir(), "llm-game-save-")), "world.json");
    const world = newWorld(personas) as unknown as Record<string, unknown>;
    const states = world.npcStates as Record<string, Record<string, unknown>>;
    for (const s of Object.values(states)) for (const k of ["fear", "respect", "affection", "needs", "emotions", "knownName", "commitments"]) delete s[k];
    delete world.events;
    writeFileSync(file, JSON.stringify({ ...world, version: 5 }));
    const loaded = loadWorld(file, personas);
    expect(loaded.npcStates.pell).toMatchObject({ fear: 0, respect: 0, affection: 0, emotions: [], knownName: null, commitments: [] });
    expect(loaded.npcStates.pell!.needs).toEqual({ hunger: 20, energy: 80 });
    expect(loaded.events).toEqual([]);
  });
});
