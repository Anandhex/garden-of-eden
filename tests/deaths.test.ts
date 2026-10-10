import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DeathRegistry } from "../src/game/deaths.js";

const tempFile = () => join(mkdtempSync(join(tmpdir(), "llm-game-")), "saves", "deaths.json");
const brenaDeath = { npcId: "brena", name: "Brena Ashford", day: 1, hour: 15, killedBy: "Traveler" };

describe("death is permanent", () => {
  it("nobody is dead in a new game", () => {
    expect(new DeathRegistry(tempFile()).isDead("brena")).toBe(false);
  });

  it("a recorded death survives a restart (a new registry reading the same file)", () => {
    const file = tempFile();
    new DeathRegistry(file).record(brenaDeath);
    const afterRestart = new DeathRegistry(file);
    expect(afterRestart.isDead("brena")).toBe(true);
    expect(afterRestart.get("brena")).toEqual(brenaDeath);
    expect(afterRestart.isDead("pell")).toBe(false);
  });

  it("the first death record wins: the dead can't die again", () => {
    const file = tempFile();
    const reg = new DeathRegistry(file);
    reg.record(brenaDeath);
    reg.record({ ...brenaDeath, day: 9, killedBy: "someone else" });
    expect(reg.get("brena")).toEqual(brenaDeath);
  });
});
