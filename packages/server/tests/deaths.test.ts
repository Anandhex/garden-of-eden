import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadCreatureTemplates } from "../src/game/creatures.js";
import { describeDeath } from "../src/game/deaths.js";
import { loadWorld, saveWorld } from "../src/game/save.js";
import { allPersonas, makeTown } from "./helpers.js";

describe("death is permanent", () => {
  it("nobody is dead in a new game", () => {
    expect(makeTown().world.deaths).toEqual({});
  });

  it("a recorded death is in the world's record, and survives a restart", () => {
    const town = makeTown();
    town.agents.brena!.state.outcome = "dead";
    town.agents.brena!.state.deathCause = "Traveler";
    town.recordDeath("brena");
    expect(town.world.deaths.brena).toMatchObject({ npcId: "brena", name: "Brena Ashford", killedBy: "Traveler", cause: "murder" });
    const file = join(mkdtempSync(join(tmpdir(), "llm-game-")), "saves", "world.json");
    saveWorld(file, town.world);
    const afterRestart = loadWorld(file, allPersonas(), loadCreatureTemplates());
    expect(afterRestart.deaths.brena).toEqual(town.world.deaths.brena);
    expect(afterRestart.deaths.pell).toBeUndefined();
  });

  it("the first death record wins: the dead can't die again", () => {
    const town = makeTown();
    town.agents.brena!.state.outcome = "dead";
    town.agents.brena!.state.deathCause = "Traveler";
    town.recordDeath("brena");
    const first = structuredClone(town.world.deaths.brena);
    town.agents.brena!.state.deathCause = "someone else";
    town.world.day = 9;
    town.recordDeath("brena");
    expect(town.world.deaths.brena).toEqual(first);
  });

  it("is told in words for the player", () => {
    expect(describeDeath({ killedBy: "old age", day: 40 })).toBe("died of old age on day 40");
    expect(describeDeath({ killedBy: "Traveler", day: 2 })).toBe("was killed by Traveler on day 2");
  });
});
