import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import brena from "../src/data/npcs/brena.json" with { type: "json" };
import hale from "../src/data/npcs/hale.json" with { type: "json" };
import pell from "../src/data/npcs/pell.json" with { type: "json" };
import { acceptQuest, questRewardGold, turnInQuests } from "../src/game/quests.js";
import { passTime } from "../src/game/simulation.js";
import type { ChatRequest, ChatResult, LLMProvider } from "../src/llm/provider.js";
import { NpcAgent } from "../src/npc/NpcAgent.js";
import { applyAction, isProvoked, parseAction, playerAttack, setMood, toolsFor, type ActionContext } from "../src/npc/actions.js";
import { buildSystemPrompt, buildTurnMessage } from "../src/npc/persona.js";
import { parsePersona } from "../src/npc/personaSchema.js";
import { createNpcState } from "../src/npc/state.js";
import {
  begsWhenCornered,
  describeTraits,
  fleeAt,
  giftTrust,
  insultTrustFactor,
  lieChance,
  maxGiftValue,
  moraleTarget,
  provokeLimit,
  resolveTraits,
  traitsOf,
} from "../src/npc/traits.js";
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

describe("temper: trust cost of insults", () => {
  const trustAfterInsult = (temper: number) => {
    const c = ctxFor(withTraits({ temper }));
    const parsed = parseAction("change_mood", { mood: "angry" });
    if (!parsed.ok) throw new Error(parsed.error);
    applyAction(parsed, c);
    return c.state.relationship;
  };

  it("a hothead loses more trust per insult than a placid NPC; Brena keeps -15", () => {
    expect(trustAfterInsult(1)).toBe(-19); // -15 x 1.25
    expect(trustAfterInsult(0)).toBe(-7); // -15 x 0.5, rounded
    expect(trustAfterInsult(brena.traits.temper)).toBe(-15);
    expect(insultTrustFactor({ temper: 0.67 })).toBeCloseTo(1, 2);
  });
});

describe("bravery: a scared NPC flees, begs or fights", () => {
  // Brena at 34 HP takes 8 → 26/90; morale d20 3 fails; then the escape roll.
  const scared = (bravery: number, escapeFace: number) => {
    const c = ctxFor(withTraits({ bravery }), { hp: 34 }, rolls(face(15, 20), face(6, 6), face(3, 20), face(escapeFace, 20)));
    c.world.player.inventory.dagger = 1;
    const r = playerAttack(c);
    return { state: c.state, message: r.message };
  };

  it("escaping: flees", () => {
    expect(scared(0.1, 15).state.outcome).toBe("fled");
  });

  it("cut off: a coward begs and the fight stops; a braver NPC fights on, cornered", () => {
    const coward = scared(0.1, 2);
    expect(coward.state).toMatchObject({ outcome: null, inCombat: false, mood: "afraid" });
    expect(coward.message).toContain("beg for mercy");
    const brave = scared(0.5, 2);
    expect(brave.state).toMatchObject({ outcome: null, inCombat: true });
    expect(brave.message).toContain("Cornered, you fight on");
    expect([begsWhenCornered({ bravery: 0.49 }), begsWhenCornered({ bravery: 0.5 })]).toEqual([true, false]);
  });
});

describe("honesty: dishonest NPCs may lie about secrets", () => {
  const reveal = (persona: NpcPersona, rng: Rng, state: Partial<NpcState> = {}) => {
    const c = ctxFor(persona, { relationship: 80, ...state }, rng);
    const parsed = parseAction("reveal_secret", { secret: persona.secrets[0]!.id });
    if (!parsed.ok) throw new Error(parsed.error);
    return { c, result: applyAction(parsed, c) };
  };

  it("chance to lie comes from honesty; honest and middling NPCs never lie", () => {
    expect(lieChance({ honesty: 0 })).toBe(0.75);
    expect(lieChance(traitsOf(hale as NpcPersona))).toBeCloseTo(0.6);
    expect(lieChance({ honesty: 0.5 })).toBe(0);
    expect(reveal(brena as NpcPersona, () => 0).result.lie).toBeUndefined();
  });

  it("a lie keeps the secret, sticks for the day, and is shown to the NPC; tomorrow they may tell", () => {
    const { c, result } = reveal(hale as NpcPersona, () => 0.1);
    expect(result).toMatchObject({ ok: true, lie: true });
    expect(result.message).not.toContain("cellar");
    expect(c.state.revealedSecrets).toEqual([]);
    expect(buildTurnMessage(c.persona, c.state, c.world, "Well?")).toContain("you lied to Traveler about the night the gate was left unguarded");

    const again = parseAction("reveal_secret", { secret: "left_post" });
    if (!again.ok) throw new Error(again.error);
    c.rng = () => 0.99; // would tell the truth, but sticks to today's lie
    expect(applyAction(again, c).lie).toBe(true);
    c.world.day += 1;
    const tomorrow = applyAction(again, c);
    expect(tomorrow.lie).toBeUndefined();
    expect(tomorrow.message).toContain("cellar");
    expect(c.state.revealedSecrets).toEqual(["left_post"]);
  });
});

describe("generosity: gifts and quest bonuses", () => {
  const gift = (item: string) => {
    const parsed = parseAction("give_item", { item });
    if (!parsed.ok) throw new Error(parsed.error);
    return parsed;
  };

  it("offers give_item only to players trusted enough, on trade talk, for cheap enough items", () => {
    const generous = withTraits({ generosity: 1 }); // trust 30, up to 20 gold
    const c = { ...ctxFor(generous, { relationship: 30 }), tradeTalk: true };
    const tool = toolsFor(c).find((t) => t.name === "give_item");
    expect(tool).toBeDefined();
    expect(JSON.stringify(tool!.parameters)).toContain("dagger [E]");
    expect(JSON.stringify(tool!.parameters)).not.toContain("iron sword");
    expect(toolsFor({ ...c, tradeTalk: false }).some((t) => t.name === "give_item")).toBe(false);
    c.state.relationship = 29;
    expect(toolsFor(c).some((t) => t.name === "give_item")).toBe(false);
    expect([giftTrust({ generosity: 0 }), maxGiftValue({ generosity: 0.4 })]).toEqual([90, 8]);
  });

  it("a gift moves the item for free, once a day, and is rechecked in code", () => {
    const c = ctxFor(withTraits({ generosity: 1 }), { relationship: 50 });
    expect(applyAction(gift("iron sword [B]"), c).ok).toBe(false); // too valuable
    expect(applyAction(gift("dagger [E]"), c).ok).toBe(true);
    expect(c.world.player.inventory["dagger [E]"]).toBe(1);
    expect(c.state.inventory["dagger [E]"]).toBe(2);
    expect(c.world.player.gold).toBe(50);
    expect(applyAction(gift("dagger [E]"), c).ok).toBe(false); // one a day
    c.world.day += 1;
    expect(applyAction(gift("horseshoe"), c).ok).toBe(true);

    const stingy = ctxFor(withTraits({ generosity: 0.2 }), { relationship: 50 }); // needs trust 78
    expect(applyAction(gift("horseshoe"), stingy).ok).toBe(false);
  });

  it("a generous NPC adds a bonus to quest rewards, fixed when the quest is taken and paid on turn-in", () => {
    const generous = withTraits({ generosity: 1 });
    const meal = generous.quests!.find((q) => q.id === "hot_meal")!;
    expect(questRewardGold(generous, meal)).toBe(10); // 8 + 25%
    expect(questRewardGold(brena as NpcPersona, meal)).toBe(8); // generosity 0.4: no bonus

    const c = ctxFor(generous);
    c.state.pendingQuest = "hot_meal";
    const active = acceptQuest(generous, c.state, c.world.player)!;
    expect(active.reward.gold).toBe(10);
    c.world.player.inventory["stew [G]"] = 1;
    turnInQuests(generous, c.state, c.world);
    expect(c.world.player.gold).toBe(60);
  });
});

describe("sociability: how much they talk", () => {
  class Recorder implements LLMProvider {
    maxTokens: number | undefined;
    async chat(req: ChatRequest): Promise<ChatResult> {
      this.maxTokens = req.maxTokens;
      return { text: "Hm.", toolCalls: [] };
    }
  }
  const replyBudget = async (persona: NpcPersona) => {
    const llm = new Recorder();
    await new NpcAgent(persona, llm).respond("Hello", createDemoWorld());
    return llm.maxTokens;
  };

  it("sociable NPCs get a longer reply budget and are told they may say more", async () => {
    expect(await replyBudget(brena as NpcPersona)).toBe(150);
    expect(await replyBudget(pell as NpcPersona)).toBe(210); // sociability 0.9: x1.4
    expect(buildSystemPrompt(pell as NpcPersona)).toContain("in 2-3 short sentences");
    expect(buildSystemPrompt(brena as NpcPersona)).toContain("in 1-2 short sentences");
  });
});

describe("forgiveness: grudges fade", () => {
  const afterOneNight = (forgiveness: number, relationship: number) => {
    const persona = withTraits({ forgiveness });
    const state = createNpcState(persona, { relationship });
    passTime(persona, state, createDemoWorld(), 12, () => 0.99); // 14:00 → 02:00, past midnight once
    return state.relationship;
  };

  it("negative trust recovers each night, faster for forgiving NPCs, never past 0", () => {
    expect(afterOneNight(1, -50)).toBe(-30);
    expect(afterOneNight(0, -50)).toBe(-46);
    expect(afterOneNight(1, -5)).toBe(0);
    expect(afterOneNight(1, 20)).toBe(20); // goodwill doesn't fade
  });
});
