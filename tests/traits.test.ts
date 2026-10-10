import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import brena from "../src/data/npcs/brena.json" with { type: "json" };
import hale from "../src/data/npcs/hale.json" with { type: "json" };
import { applyAction, isProvoked, parseAction, playerAttack, setMood, toolsFor, type ActionContext } from "../src/npc/actions.js";
import { buildSystemPrompt } from "../src/npc/persona.js";
import { parsePersona } from "../src/npc/personaSchema.js";
import { createNpcState } from "../src/npc/state.js";
import { describeTraits, fleeAt, moraleTarget, provokeLimit, resolveTraits, traitsOf } from "../src/npc/traits.js";
import type { NpcPersona, NpcState } from "../src/npc/types.js";
import { createDemoWorld } from "../src/world/world.js";
import type { Rng } from "../src/game/dice.js";
import { face, rolls } from "./dice.test.js";

const withTraits = (traits: NpcPersona["traits"]): NpcPersona => ({ ...(brena as NpcPersona), traits });
const ctxFor = (persona: NpcPersona, overrides: Partial<NpcState> = {}, rng: Rng = rolls(0.5)): ActionContext => ({
  persona,
  state: createNpcState(persona, overrides),
  world: createDemoWorld(),
  rng,
});

describe("trait rules", () => {
  it("default every missing trait to 0.5", () => {
    expect(resolveTraits(undefined)).toEqual({ temper: 0.5, bravery: 0.5, honesty: 0.5, generosity: 0.5, sociability: 0.5, forgiveness: 0.5 });
    expect(resolveTraits({ temper: 0.9 }).bravery).toBe(0.5);
  });

  it("keep Brena's old constants: 3 insults, flee at 40%, morale 15", () => {
    const t = traitsOf(brena as NpcPersona);
    expect([provokeLimit(t), fleeAt(t), moraleTarget(t)]).toEqual([3, 0.4, 15]);
  });

  it("map temper to 2..5 insults and bravery to flee threshold and morale", () => {
    expect([provokeLimit({ temper: 1 }), provokeLimit({ temper: 0 })]).toEqual([2, 5]);
    expect([fleeAt({ bravery: 0 }), fleeAt({ bravery: 1 })]).toEqual([0.5, 0.3]);
    expect([moraleTarget({ bravery: 0 }), moraleTarget({ bravery: 1 })]).toEqual([20, 10]);
  });
});

describe("temper", () => {
  const attacksAfter = (temper: number) => {
    const p = withTraits({ ...brena.traits, temper });
    const c = ctxFor(p);
    for (let i = 1; i <= 6; i++) {
      setMood(c.state, "angry");
      if (isProvoked(p, c.state) && toolsFor(c).some((t) => t.name === "attack_player")) return i;
    }
    return null;
  };

  it("a hothead attacks after 2 insults, a placid NPC after 5", () => {
    expect(attacksAfter(1)).toBe(2);
    expect(attacksAfter(0)).toBe(5);
  });

  it("refuses attack_player below the NPC's own limit", () => {
    const c = ctxFor(withTraits({ temper: 0 }), { provocations: 4, mood: "angry" });
    const parsed = parseAction("attack_player", {});
    if (!parsed.ok) throw new Error(parsed.error);
    expect(applyAction(parsed, c).ok).toBe(false);
  });
});

describe("bravery", () => {
  // Brena at 44 HP takes 8 (d20 15, d6 6, dagger) and drops to 36/90 = 40%.
  const hitAt = (traits: NpcPersona["traits"]) => {
    const c = ctxFor(withTraits(traits), { hp: 44 }, rolls(face(15, 20), face(6, 6), face(15, 20)));
    c.world.player.inventory.dagger = 1;
    playerAttack(c);
    return c.state;
  };

  it("a cowardly NPC flees at an HP level where a brave one fights on", () => {
    const coward = hitAt({ bravery: 0.1 }); // flees at <=46%; morale 15 + 2 = 17 vs 19: fails
    const brave = hitAt({ bravery: 0.9 }); // only checks at <=32%
    expect(coward.hp).toBe(36);
    expect(coward.outcome).toBe("fled");
    expect(brave.hp).toBe(36);
    expect(brave.outcome).toBeNull();
  });
});

describe("words in the prompt", () => {
  it("shows notable traits as words and never as numbers", () => {
    const prompt = buildSystemPrompt(hale as NpcPersona);
    expect(prompt).toContain("quick-tempered, cowardly, dishonest, stingy");
    expect(prompt).not.toMatch(/\btemper\b|bravery|\b0\.\d/i);
  });

  it("leaves out middling traits", () => {
    expect(describeTraits(resolveTraits({}))).toBe("");
  });
});

describe("PersonaSchema", () => {
  const files = readdirSync(new URL("../src/data/npcs/", import.meta.url)).filter((f) => f.endsWith(".json"));
  it.each(files)("accepts %s", (file) => {
    const raw = JSON.parse(readFileSync(new URL(`../src/data/npcs/${file}`, import.meta.url), "utf8"));
    expect(() => parsePersona(raw, file)).not.toThrow();
  });

  it("rejects out-of-range traits, unknown fields and unknown items, listing the problems", () => {
    expect(() => parsePersona({ ...brena, traits: { temper: 1.5 } })).toThrow(/traits\.temper/);
    expect(() => parsePersona({ ...brena, temperr: 1 })).toThrow(/temperr/);
    expect(() => parsePersona({ ...brena, weapon: "banana" })).toThrow(/weapon/);
  });
});
