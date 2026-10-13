import { readdirSync, readFileSync } from "node:fs";
import { MoneySchema } from "../src/game/money.js";
import { describe, expect, it } from "vitest";
import brena from "./fixtures/npcs/brena.json" with { type: "json" };
import { buildSystemPrompt, buildTurnMessage } from "../src/npc/persona.js";
import { ITEM_TIERS, ITEMS, weaponFor } from "../src/game/items.js";
import { describeSkills, SKILLS, SkillsSchema, skillLevel, WEAPON_SKILLS } from "../src/npc/skills.js";
import { describeAttribute, describeCondition, NpcStatsSchema } from "../src/npc/stats.js";
import { createNpcState } from "../src/npc/state.js";
import type { NpcPersona, NpcState } from "../src/npc/types.js";
import { createTestWorld } from "../src/world/world.js";
import { parsePersona } from "../src/npc/personaSchema.js";

const NPC_DIR = new URL("./fixtures/npcs/", import.meta.url);

describe("every NPC file", () => {
  const files = readdirSync(NPC_DIR).filter((f) => f.endsWith(".json"));

  it("exists", () => expect(files.length).toBeGreaterThan(0));

  it.each(files)("%s has a greed between 0 and 1", (file) => {
    const npc = JSON.parse(readFileSync(new URL(file, NPC_DIR), "utf8"));
    expect(npc.greed).toBeGreaterThanOrEqual(0);
    expect(npc.greed).toBeLessThanOrEqual(1);
  });

  it.each(files)("%s has a valid startingMoney (coins, or whole copper)", (file) => {
    const npc = JSON.parse(readFileSync(new URL(file, NPC_DIR), "utf8"));
    expect(MoneySchema.safeParse(npc.startingMoney).success).toBe(true);
  });

  it.each(files)("%s has valid stats", (file) => {
    const npc = JSON.parse(readFileSync(new URL(file, NPC_DIR), "utf8"));
    const result = NpcStatsSchema.safeParse(npc.stats);
    expect(result.success, result.success ? "" : JSON.stringify(result.error.issues)).toBe(true);
  });
});

describe("NpcStatsSchema", () => {
  const valid = {
    maxHp: 50,
    maxMp: 0,
    attributes: { strength: 10, agility: 10, endurance: 10, intelligence: 10, willpower: 10, charisma: 10, perception: 10, luck: 10 },
  };

  it("accepts a complete stat block", () => expect(NpcStatsSchema.safeParse(valid).success).toBe(true));

  it("rejects missing attributes and out-of-range values", () => {
    const { luck: _luck, ...missingLuck } = valid.attributes;
    expect(NpcStatsSchema.safeParse({ ...valid, attributes: missingLuck }).success).toBe(false);
    expect(NpcStatsSchema.safeParse({ ...valid, attributes: { ...valid.attributes, strength: 21 } }).success).toBe(false);
    expect(NpcStatsSchema.safeParse({ ...valid, maxHp: 0 }).success).toBe(false);
  });
});

describe("describeAttribute", () => {
  it("turns numbers into words a small model can use", () => {
    expect(describeAttribute("strength", 3)).toBe("very weak (STR 3)");
    expect(describeAttribute("strength", 7)).toBe("weak (STR 7)");
    expect(describeAttribute("agility", 10)).toBe("average agility (AGI 10)");
    expect(describeAttribute("strength", 16)).toBe("strong (STR 16)");
    expect(describeAttribute("willpower", 19)).toBe("exceptionally strong-willed (WIL 19)");
  });
});

describe("describeCondition", () => {
  it("describes HP in words", () => {
    expect(describeCondition(90, 90)).toBe("unhurt");
    expect(describeCondition(70, 90)).toBe("lightly hurt");
    expect(describeCondition(45, 90)).toBe("wounded");
    expect(describeCondition(20, 90)).toBe("badly wounded");
    expect(describeCondition(5, 90)).toBe("near death");
    expect(describeCondition(0, 90)).toBe("unconscious");
  });
});

describe("stats in the prompts", () => {
  const persona = parsePersona(brena);
  const state: NpcState = createNpcState(persona, { hp: 30, mp: 4, inventory: {} });

  it("puts the attributes (static) in the system prompt", () => {
    expect(buildSystemPrompt(persona)).toContain("strong (STR 16)");
    expect(buildSystemPrompt(persona)).toContain("off-putting (CHA 8)");
  });

  it("puts current HP/MP (changing) in the situation, not the system prompt", () => {
    expect(buildTurnMessage(persona, state, createTestWorld(), "x")).toContain(
      "Your condition: badly wounded (HP 30/90, MP 4/10).",
    );
    expect(buildSystemPrompt(persona)).not.toContain("HP");
  });
});

describe("skills", () => {
  it.each(readdirSync(NPC_DIR).filter((f) => f.endsWith(".json")))("%s has valid skills and a weapon skill", (file) => {
    const npc = JSON.parse(readFileSync(new URL(file, NPC_DIR), "utf8"));
    const result = SkillsSchema.safeParse(npc.skills);
    expect(result.success, result.success ? "" : JSON.stringify(result.error.issues)).toBe(true);
    const weapon = weaponFor(npc.weapon);
    expect(weapon, `weapon "${npc.weapon}" must be a weapon in ITEMS`).toBeDefined();
    expect(WEAPON_SKILLS).toContain(weapon!.skill);
  });

  it.each(readdirSync(NPC_DIR).filter((f) => f.endsWith(".json")))("%s teaches a skill it actually has", (file) => {
    const npc = JSON.parse(readFileSync(new URL(file, NPC_DIR), "utf8"));
    if (npc.teaches === undefined) return; // falls back to their best skill
    expect(SKILLS).toContain(npc.teaches);
    expect(npc.skills[npc.teaches] ?? 0).toBeGreaterThan(0);
  });

  it("rejects unknown skill names and out-of-range tiers", () => {
    expect(SkillsSchema.safeParse({ forraging: 2 }).success).toBe(false);
    expect(SkillsSchema.safeParse({ foraging: 6 }).success).toBe(false);
    expect(SkillsSchema.safeParse({}).success).toBe(true);
  });

  it("treats unlisted skills as untrained", () => {
    expect(skillLevel({ smithing: 5 }, "archery")).toBe(0);
  });

  it("describes skills best first and leaves out untrained ones", () => {
    expect(describeSkills({ foraging: 1, smithing: 5, blunt: 4, archery: 0 })).toBe(
      "master at smithing, expert at blunt weapons, novice at foraging",
    );
    expect(describeSkills({})).toBe("no special training");
  });

  it("puts the NPC's skills in the system prompt", () => {
    expect(buildSystemPrompt(parsePersona(brena))).toContain("Skills: master at smithing, expert at blunt weapons, adept at haggling");
  });
});
