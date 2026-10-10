import { mkdtempSync } from "node:fs";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import brena from "../src/data/npcs/brena.json" with { type: "json" };
import pell from "../src/data/npcs/pell.json" with { type: "json" };
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
    world.player.gold = 7;
    world.player.journal = [{ id: "secret", day: 3, text: "Brena trusts me." }];
    world.npcStates.pell!.relationship = 42;
    world.npcStates.pell!.debts = { loan: 13 };
    saveWorld(file, world);

    const loaded = loadWorld(file, personas);
    expect(loaded.day).toBe(4);
    expect(loaded.minute).toBe(37);
    expect(loaded.player.gold).toBe(7);
    expect(loaded.player.journal).toEqual([{ id: "secret", day: 3, text: "Brena trusts me." }]);
    expect(loaded.npcStates.pell?.relationship).toBe(42);
    expect(loaded.npcStates.pell?.debts).toEqual({ loan: 13 });
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
