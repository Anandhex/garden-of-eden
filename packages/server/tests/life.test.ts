import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import brenaJson from "./fixtures/npcs/brena.json" with { type: "json" };
import haleJson from "./fixtures/npcs/hale.json" with { type: "json" };
import pellJson from "./fixtures/npcs/pell.json" with { type: "json" };
import { config } from "../src/config.js";
import { finishCraft } from "../src/game/crafting.js";
import {
  ageOn,
  ageStage,
  createLife,
  dailyDeathChance,
  DAILY_XP,
  describeLife,
  atPeak,
  effectiveStats,
  gainXp,
  growthStatus,
  isReady,
  liveDay,
  overcome,
  xpToNextTier,
} from "../src/game/life.js";
import { loadWorld, newWorld } from "../src/game/save.js";
import { npcNewDay, passTime } from "../src/game/simulation.js";
import { train } from "../src/game/training.js";
import { parsePersona } from "../src/npc/personaSchema.js";
import { buildTurnMessage } from "../src/npc/persona.js";
import { createNpcState, lifeContext, npcGainXp, npcOvercome, statsOf } from "../src/npc/state.js";
import type { NpcPersona } from "../src/npc/types.js";
import { SPECIES } from "../src/world/species.js";
import { createTestWorld } from "../src/world/world.js";

const brena = parsePersona(brenaJson, "brena.json");
const pell = parsePersona(pellJson, "pell.json");
const hale = parsePersona(haleJson, "hale.json");
const human = SPECIES.human!;
const wolf = SPECIES.wolf!;
const never = () => 0.999999;
const always = () => 0;

describe("ranks", () => {
  it("cost more XP at every rank", () => {
    expect(xpToNextTier("G")).toBe(100);
    expect(xpToNextTier("F")).toBe(200);
    expect(xpToNextTier("SS")).toBe(900);
  });

  it("XP alone only makes them ready; a challenge breaks them through", () => {
    const life = createLife(human, 30, "G");
    const ctx = { species: human, base: brena.stats };
    expect(gainXp(life, ctx, 99)).toBe(false);
    expect(gainXp(life, ctx, 5000)).toBe(true); // now ready
    expect(life.tier).toBe("G");
    expect(life.xp).toBe(100); // XP stops at what the next rank needs
    expect(isReady(life, human)).toBe(true);
    expect(gainXp(life, ctx, 50)).toBe(false); // already ready: no news

    const result = overcome("Brena", life, ctx, { kind: "fight", rank: "G", what: "beating a bandit" }, 3);
    expect(result.rose).toBe("F");
    expect(result.log).toEqual(["Brena broke through to rank F by beating a bandit."]);
    expect(life.xp).toBe(0);
    expect(life.growth.maxHp).toBe(9); // 10% of 90
    // +1 to her two best attributes: strength 16 and endurance 15.
    expect(life.growth.attributes).toEqual({ strength: 1, endurance: 1 });
    expect(effectiveStats(brena.stats, life).attributes.strength).toBe(17);
  });

  it("a challenge below their rank doesn't count, nor does one before they're ready", () => {
    const ctx = { species: human, base: brena.stats };
    const life = createLife(human, 30, "C");
    expect(overcome("Brena", life, ctx, { kind: "craft", rank: "C", what: "making a sword" }, 1).rose).toBeNull();
    gainXp(life, ctx, 5000);
    expect(overcome("Brena", life, ctx, { kind: "craft", rank: "D", what: "making a sword" }, 1).rose).toBeNull();
    expect(overcome("Brena", life, ctx, { kind: "craft", rank: "C", what: "making a sword" }, 1).rose).toBe("B");
  });

  it("not everyone can grow: potential and species cap where they stop", () => {
    expect(createLife(wolf, 3, "C", 1, "SSS").potential).toBe("B"); // wolves cap at B

    const innkeeper = createNpcState(pell); // potential E = his rank: at his peak
    expect(atPeak(innkeeper.life, human)).toBe(true);
    expect(npcGainXp(pell, innkeeper, 10_000)).toBeNull();
    expect(innkeeper.life.xp).toBe(0);
    expect(npcOvercome(pell, innkeeper, { kind: "fight", rank: "SSS", what: "beating a dragon" }, 1)).not.toContain(
      expect.stringContaining("broke through"),
    );
    expect(innkeeper.life.tier).toBe("E");

    const guard = createNpcState(hale); // F, potential D
    for (const rank of ["F", "E", "D"] as const) {
      npcGainXp(hale, guard, 10_000);
      npcOvercome(hale, guard, { kind: "fight", rank: "SSS", what: "a fight" }, 1);
    }
    expect(guard.life.tier).toBe("D");
    expect(growthStatus(guard.life, human)).toBe("at their peak");
  });

  it("a breakthrough is remembered", () => {
    const state = createNpcState(brena);
    npcGainXp(brena, state, 10_000);
    const log = npcOvercome(brena, state, { kind: "craft", rank: "B", what: "making a iron sword [B]" }, 4);
    expect(log[0]).toBe(`${brena.name} broke through to rank B by making a iron sword [B].`);
    expect(state.memories.at(-1)?.text).toBe("On day 4 you broke through to rank B by making a iron sword [B].");
  });

  it("are faster to earn for the young and slower for the old", () => {
    const young = createLife(human, 10, "G");
    const old = createLife(human, 70, "G");
    gainXp(young, { species: human, base: brena.stats }, 10);
    gainXp(old, { species: human, base: brena.stats }, 10);
    expect(young.xp).toBe(15);
    expect(old.xp).toBe(5);
  });
});

describe("age", () => {
  it("counts years from the birth day on the world calendar", () => {
    const life = createLife(human, 34, "C", 1);
    expect(ageOn(life, 1)).toBe(34);
    expect(ageOn(life, 1 + config.daysPerYear - 1)).toBe(34);
    expect(ageOn(life, 1 + config.daysPerYear)).toBe(35);
  });

  it("has stages per species", () => {
    expect(ageStage(human, 10)).toBe("young");
    expect(ageStage(human, 34)).toBe("adult");
    expect(ageStage(human, 68)).toBe("elder");
    expect(ageStage(human, 80)).toBe("venerable");
    expect(ageStage(wolf, 10)).toBe("elder");
  });

  it("weakens the body of elders", () => {
    const state = createNpcState(pell); // 68: an elder
    expect(state.life.stage).toBe("elder");
    const stats = statsOf(pell, state);
    expect(stats.attributes.strength).toBe(pell.stats.attributes.strength - 2);
    expect(stats.attributes.willpower).toBe(pell.stats.attributes.willpower + 1);
    expect(stats.maxHp).toBe(Math.round(pell.stats.maxHp * 0.85));
    expect(state.hp).toBe(stats.maxHp);
  });

  it("is described to the NPC in words", () => {
    expect(describeLife(human.name, createNpcState(brena).life, 1)).toBe("34-year-old human, rank C");
    expect(describeLife(human.name, createNpcState(pell).life, 1)).toBe("68-year-old human (getting old), rank E");
    const msg = buildTurnMessage(brena, createNpcState(brena), createTestWorld(), "Hello");
    expect(msg).toContain("You: 34-year-old human, rank C.");
  });
});

describe("natural death", () => {
  it("can't happen before old age, and is certain at the species' max age", () => {
    expect(dailyDeathChance(human, 59)).toBe(0);
    expect(dailyDeathChance(human, 95)).toBe(1);
    const a = dailyDeathChance(human, 65);
    const b = dailyDeathChance(human, 85);
    expect(a).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(a);
  });

  it("is rolled each midnight with the day's XP", () => {
    const life = createLife(human, 40, "E");
    const day = liveDay(life, { species: human, base: brena.stats }, 2, always);
    expect(day.died).toBe(false);
    expect(life.xp).toBe(DAILY_XP);
  });

  it("takes an NPC in their sleep, permanently", () => {
    const state = createNpcState(pell, { life: createLife(human, 94, "E", 1 - config.daysPerYear + 1) });
    // Turns 95 within the day; at 95 death is certain.
    const world = createTestWorld();
    world.day = 2;
    world.hour = 23;
    const log = passTime(pell, state, world, 2, never);
    expect(state.outcome).toBe("dead");
    expect(state.deathCause).toBe("old age");
    expect(log.some((l) => l.includes("died in their sleep"))).toBe(true);
    expect(world.hour).toBe(1); // the clock still ran
  });

  it("leaves younger NPCs alone, but they still age and grow", () => {
    const state = createNpcState(brena);
    const world = createTestWorld();
    passTime(brena, state, world, 24 * 3, never);
    expect(state.outcome).toBeNull();
    expect(state.life.xp).toBeGreaterThanOrEqual(3 * DAILY_XP);
  });

  it("lowers HP to fit a frailer body", () => {
    // 77 on day 1 (an elder); 78 a year later (venerable).
    const state = createNpcState(pell, { life: createLife(human, 77, "E", 1) });
    expect(state.life.stage).toBe("elder");
    state.hp = statsOf(pell, state).maxHp;
    npcNewDay(pell, state, 1 + config.daysPerYear, never);
    expect(state.life.stage).toBe("venerable");
    expect(state.hp).toBe(statsOf(pell, state).maxHp);
    expect(state.hp).toBeLessThan(Math.round(pell.stats.maxHp * 0.85));
  });
});

describe("NPCs grow by working", () => {
  it("crafting earns XP", () => {
    const state = createNpcState(brena, {
      job: { recipeId: "dagger", output: "dagger [E]", qty: 1, until: 60, doing: "forging a dagger" },
    });
    const world = createTestWorld();
    world.day = 1;
    world.hour = 0;
    world.minute = 0;
    const before = state.life.xp;
    passTime(brena, state, world, 1, never);
    expect(finishCraft(state, 999)).toBeNull();
    expect(state.life.xp).toBeGreaterThan(before);
  });

  it("crafting a piece at their rank is a challenge", () => {
    const state = createNpcState(brena, {
      job: { recipeId: "iron_sword", output: "iron sword [B]", qty: 1, until: 60, doing: "forging an iron sword" },
    });
    state.life.xp = xpToNextTier("C");
    const world = createTestWorld();
    world.hour = 0;
    world.minute = 0;
    const log = passTime(brena, state, world, 1, never);
    expect(state.life.tier).toBe("B");
    expect(log).toContain(`${brena.name} broke through to rank B by making a iron sword [B].`);
  });

  it("teaching earns XP but can't raise their rank", () => {
    const state = createNpcState(brena, { relationship: 60 });
    state.life.xp = xpToNextTier("C") - 1;
    const world = createTestWorld();
    world.player.money = 500;
    const result = train(brena, state, world, "smithing", 2);
    expect(result.ok).toBe(true);
    expect(result.npcNote).toBe(`${brena.name} is ready for a breakthrough to rank B.`);
    expect(state.life.tier).toBe("C");
    expect(result.message).not.toContain("rank");
  });
});

describe("titles", () => {
  const ctx = { species: human, base: brena.stats };

  it("are earned by deeds and add their bonus", () => {
    const life = createLife(human, 30, "D");
    const before = effectiveStats(brena.stats, life).attributes;
    const r = overcome("Brena", life, ctx, { kind: "fight", rank: "B", nearDeath: true, what: "beating a knight" }, 2);
    expect(r.titles).toEqual(["giant_slayer", "death_cheater"]);
    expect(r.log).toContain('Brena earned the title "Giant-slayer".');
    const after = effectiveStats(brena.stats, life).attributes;
    expect(after.willpower).toBe(before.willpower + 1);
    expect(after.endurance).toBe(before.endurance + 1);
    expect(describeLife(human.name, life, 1)).toBe("30-year-old human, rank D, known as Giant-slayer, Death-cheater");
  });

  it("are given once", () => {
    const life = createLife(human, 30, "D");
    overcome("Brena", life, ctx, { kind: "fight", rank: "A", what: "a fight" }, 1);
    expect(overcome("Brena", life, ctx, { kind: "fight", rank: "A", what: "a fight" }, 2).titles).toEqual([]);
    expect(life.titles).toHaveLength(1);
  });

  it("Veteran after five wins, Master Artisan for an A-tier piece", () => {
    const life = createLife(human, 30, "D");
    for (let i = 0; i < 4; i++) overcome("Hale", life, ctx, { kind: "fight", rank: "G", what: "a scuffle" }, 1);
    expect(life.titles).toEqual([]);
    expect(overcome("Hale", life, ctx, { kind: "fight", rank: "G", what: "a scuffle" }, 1).titles).toEqual(["veteran"]);
    expect(overcome("Brena", life, ctx, { kind: "craft", rank: "A", what: "a blade" }, 1).titles).toEqual(["master_artisan"]);
  });

  it("come with the highest ranks", () => {
    const life = createLife(human, 30, "S");
    gainXp(life, ctx, 100_000);
    expect(overcome("Brena", life, ctx, { kind: "fight", rank: "S", what: "a duel" }, 1).titles).toEqual(["rank_SS"]);
    expect(describeLife(human.name, life, 1)).toContain("rank SS, known as the Legend");
  });

  it("the NPC hears its titles", () => {
    const state = createNpcState(brena);
    state.life.titles.push({ id: "veteran", day: 1 });
    expect(buildTurnMessage(brena, state, createTestWorld(), "Hi")).toContain("You: 34-year-old human, rank C, known as Veteran.");
  });
});

describe("persona files", () => {
  it("every NPC has a talking species, a sane age and a rank within the cap", () => {
    for (const p of [brena, pell, hale]) {
      const ctx = lifeContext(p);
      expect(ctx.species.talks, p.id).toBe(true);
      expect(p.age, p.id).toBeLessThan(ctx.species.maxAge);
    }
  });

  it("rejects animals, impossible ages and ranks above the species cap", () => {
    expect(() => parsePersona({ ...brenaJson, species: "wolf" })).toThrow(/can't talk/);
    expect(() => parsePersona({ ...brenaJson, age: 120 })).toThrow(/older than/);
    expect(() => parsePersona({ ...brenaJson, species: "halfling", tier: "SS" })).toThrow(/cap/);
    expect(() => parsePersona({ ...brenaJson, species: "dragon" })).toThrow();
    expect(() => parsePersona({ ...brenaJson, potential: "D" })).toThrow(/below their starting rank/);
    const { potential: _, ...noPotential } = parsePersona(brenaJson);
    expect(() => parsePersona(noPotential)).toThrow(/potential/);
  });

  it("species defaults to human", () => {
    const { species: _, ...noSpecies } = parsePersona(brenaJson);
    expect(lifeContext(parsePersona(noSpecies)).species).toBe(human);
  });
});
