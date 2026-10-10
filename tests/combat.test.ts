import { describe, expect, it } from "vitest";
import brena from "../src/data/npcs/brena.json" with { type: "json" };
import type { Rng } from "../src/game/dice.js";
import {
  type ActionContext,
  acceptOffer,
  applyAction,
  grantDiscount,
  haggle,
  MAX_FAILED_HAGGLES,
  isPleading,
  isProvoked,
  minPrice,
  PROVOKE_LIMIT,
  parseAction,
  npcAttack,
  playerAttack,
  playerFlee,
  setMood,
  socialCheck,
  toolsFor,
} from "../src/npc/actions.js";
import { createNpcState } from "../src/npc/state.js";
import type { NpcPersona, NpcState } from "../src/npc/types.js";
import { createDemoWorld } from "../src/world/world.js";
import { face, rolls } from "./dice.test.js";

const persona = brena as NpcPersona;
const ctx = (overrides: Partial<NpcState> = {}, rng: Rng = rolls(0.5)): ActionContext => ({
  persona,
  state: createNpcState(persona, overrides),
  world: createDemoWorld(),
  rng,
});
const tools = (c: ActionContext) => toolsFor(c).map((t) => t.name);
const act = (name: string, c: ActionContext) => {
  const parsed = parseAction(name, {});
  if (!parsed.ok) throw new Error(parsed.error);
  return applyAction(parsed, c);
};

describe("provocation", () => {
  it(`counts annoyed/angry moods in a row and resets on calmer ones`, () => {
    const c = ctx();
    setMood(c.state, "annoyed");
    setMood(c.state, "angry");
    expect(c.state.provocations).toBe(2);
    setMood(c.state, "neutral");
    expect(c.state.provocations).toBe(0);
  });

  it(`offers attack_player only after ${PROVOKE_LIMIT} mean comments while still hostile`, () => {
    const c = ctx();
    for (let i = 0; i < PROVOKE_LIMIT - 1; i++) setMood(c.state, "annoyed");
    expect(tools(c)).not.toContain("attack_player");
    setMood(c.state, "annoyed");
    expect(isProvoked(c.state)).toBe(true);
    expect(tools(c)).toContain("attack_player");
    c.state.mood = "afraid";
    expect(tools(c)).not.toContain("attack_player");
  });

  it("refuses attack_player when not provoked, even if the model calls it", () => {
    const c = ctx();
    expect(act("attack_player", c).ok).toBe(false);
    expect(c.world.player.hp).toBe(40);
    expect(c.state.inCombat).toBe(false);
  });
});

describe("NPC attacks", () => {
  it("a provoked NPC's hit starts a fight and damages the player", () => {
    // d20 = 15 + 3 STR + 4 blunt = 22 vs 10 + 1 (player AGI 13) + 2 evasion = 13: hit;
    // d8 = 5 → 5 + 3 STR + 2 (forge hammer is tier C) = 10 damage.
    const c = ctx({ provocations: PROVOKE_LIMIT, mood: "angry" }, rolls(face(15, 20), face(5, 8)));
    const r = act("attack_player", c);
    expect(r.ok).toBe(true);
    expect(r.message).toContain("for 10 damage");
    expect(c.world.player.hp).toBe(30);
    expect(c.state.inCombat).toBe(true);
  });

  it("a miss does no damage", () => {
    const c = ctx({ provocations: PROVOKE_LIMIT, mood: "angry" }, rolls(face(2, 20)));
    expect(act("attack_player", c).message).toContain("miss");
    expect(c.world.player.hp).toBe(40);
  });

  it("player HP never goes below 0", () => {
    const c = ctx({ inCombat: true }, rolls(face(20, 20), face(8, 8)));
    c.world.player.hp = 3;
    expect(act("attack_player", c).message).toContain("collapses");
    expect(c.world.player.hp).toBe(0);
  });
});

describe("player attacks", () => {
  it("starts a fight, angers the NPC, and costs a lot of trust", () => {
    const c = ctx({}, rolls(face(2, 20)));
    playerAttack(c);
    expect(c.state.inCombat).toBe(true);
    expect(c.state.mood).toBe("angry");
    expect(c.state.relationship).toBe(-55);
  });

  it("uses the player's best weapon", () => {
    // d20 = 15 + 1 STR + 2 one-handed = 18 vs 10 - 1 (Brena AGI 9) + 1 evasion = 10: hit;
    // d6 = 4 → 4 + 1 STR + 1 (dagger is tier E) = 6.
    const c = ctx({}, rolls(face(15, 20), face(4, 6)));
    c.world.player.inventory.dagger = 1;
    const r = playerAttack(c);
    expect(r.damage).toBe(6);
    expect(r.message).toContain("dagger");
    expect(c.state.hp).toBe(84);
  });

  it("a badly hurt NPC that fails its morale check runs", () => {
    // Hit: d20 15, d6 6 → 6 + 1 STR + 1 tier = 8 damage, 34 → 26 HP (≤ 40% of 90). Morale: d20 3 + 2 WIL = 5 vs 15 → fails.
    const c = ctx({ hp: 34 }, rolls(face(15, 20), face(6, 6), face(3, 20)));
    c.world.player.inventory.dagger = 1;
    const r = playerAttack(c);
    expect(c.state.hp).toBe(26);
    expect(c.state.outcome).toBe("fled");
    expect(c.state.mood).toBe("afraid");
    expect(r.message).toContain("lose your nerve");
    expect(tools(c)).toEqual([]);
  });

  it("a badly hurt NPC that passes its morale check keeps fighting", () => {
    const c = ctx({ hp: 34 }, rolls(face(15, 20), face(6, 6), face(18, 20)));
    c.world.player.inventory.dagger = 1;
    expect(playerAttack(c).message).toContain("hold your ground");
    expect(c.state.outcome).toBeNull();
  });

  it("no morale check while still healthy", () => {
    const c = ctx({}, rolls(face(15, 20), face(4, 4)));
    expect(playerAttack(c).message).not.toContain("morale");
  });

  it("kills the NPC at 0 HP", () => {
    const c = ctx({ hp: 2 }, rolls(face(20, 20), face(4, 4)));
    playerAttack(c);
    expect(c.state.hp).toBe(0);
    expect(c.state.outcome).toBe("dead");
    expect(c.state.conversationOver).toBe(true);
  });
});

describe("tools during a fight", () => {
  it("only offers fighting tools, no trading or secrets", () => {
    // Attacks are automatic in a fight; the model only chooses whether to stop (or run),
    // and stopping is only on the table when the player pleads.
    expect(tools(ctx({ inCombat: true, relationship: 80 }))).toEqual(["change_mood"]);
    expect(tools({ ...ctx({ inCombat: true }), pleading: true })).toEqual(["change_mood", "end_fight"]);
  });

  it(`offers flee once badly hurt`, () => {
    expect(tools(ctx({ inCombat: true, hp: 30 }))).toContain("flee");
    expect(tools(ctx({ inCombat: true, hp: 60 }))).not.toContain("flee");
  });

  it("flee ends the conversation, but only when hurt and fighting", () => {
    expect(act("flee", ctx({ inCombat: true, hp: 60 })).ok).toBe(false);
    expect(act("flee", ctx({ hp: 10 })).ok).toBe(false);
    const c = ctx({ inCombat: true, hp: 10 });
    expect(act("flee", c).ok).toBe(true);
    expect(c.state.outcome).toBe("fled");
    expect(c.state.conversationOver).toBe(true);
  });

  it("refuses offers during a fight", () => {
    const parsed = parseAction("offer_item", { item: "dagger [E]", price: 15 });
    expect(parsed.ok && applyAction(parsed, ctx({ inCombat: true })).ok).toBe(false);
  });

  it("accepts null arguments for no-argument tools", () => {
    expect(parseAction("flee", null).ok).toBe(true);
  });
});

describe("social checks", () => {
  // Persuade: player CHA 13 (+1) + speechcraft 2 = +3, vs 10 + Brena WIL 14 (+2) + speechcraft 1 = 13.
  // Intimidate: player STR 12 (+1) + intimidation 1 = +2, vs 10 + 2 + Brena intimidation 2 = 14.
  it("persuasion success raises trust and gives a 20% discount, shrunk by Brena's haggling to 14%", () => {
    const c = ctx({}, rolls(face(10, 20)));
    const r = socialCheck("persuade", "Your work is the best in the valley.", c);
    expect(r.success).toBe(true);
    expect(c.state.relationship).toBe(15);
    expect(c.state.discountPct).toBe(14);
    expect(minPrice(persona, c.state, "iron sword")).toBe(35);
    expect(r.message).toContain("rolled 10+3=13 vs 13");
  });

  it("skills matter: the same roll fails without speechcraft", () => {
    const c = ctx({}, rolls(face(10, 20)));
    c.world.player.skills = {};
    expect(socialCheck("persuade", "Please?", c).success).toBe(false);
  });

  it("persuasion failure annoys the NPC (and counts as a provocation)", () => {
    const c = ctx({}, rolls(face(5, 20)));
    expect(socialCheck("persuade", "Give me a deal.", c).success).toBe(false);
    expect(c.state.mood).toBe("annoyed");
    expect(c.state.provocations).toBe(1);
    expect(c.state.discountPct).toBe(0);
  });

  it("intimidation success makes the NPC afraid and gives a 30% discount, shrunk to 21%", () => {
    const c = ctx({}, rolls(face(18, 20)));
    expect(socialCheck("intimidate", "Lower your prices.", c).success).toBe(true);
    expect(c.state.mood).toBe("afraid");
    expect(c.state.discountPct).toBe(21);
  });

  it("intimidation failure makes the NPC angry", () => {
    const c = ctx({}, rolls(face(3, 20)));
    socialCheck("intimidate", "Or else.", c);
    expect(c.state.mood).toBe("angry");
  });

  it("can't be used mid-fight", () => {
    expect(socialCheck("persuade", "Let's talk.", ctx({ inCombat: true })).ok).toBe(false);
  });

  it("offers below the discounted price still fail", () => {
    const c = ctx({ discountPct: 20 });
    const parsed = parseAction("offer_item", { item: "iron sword [D]", price: 31 });
    expect(parsed.ok && applyAction(parsed, c).ok).toBe(false);
  });
});

describe("haggling", () => {
  // Player CHA 13 (+1) + haggling 0, vs 10 + Brena INT 11 (0) + haggling 3 = 13 (+2 per earlier failure).
  it("a win by more gives a bigger discount, then Brena's haggling shrinks it", () => {
    const c = ctx({}, rolls(face(12, 20))); // 12 + 1 = 13 vs 13: win by 0 → 10% → 7%
    expect(haggle("Ten off?", c).success).toBe(true);
    expect(c.state.discountPct).toBe(7);

    const big = ctx({}, rolls(face(19, 20))); // 19 + 1 = 20 vs 13: win by 7 → 24% → 17%
    haggle("Come on.", big);
    expect(big.state.discountPct).toBe(17);
  });

  it("a pending offer gets cheaper right away", () => {
    const c = ctx({ pendingOffer: { item: "iron sword [D]", price: 40 } }, rolls(face(19, 20)));
    const r = haggle("That's steep.", c);
    expect(c.state.pendingOffer).toEqual({ item: "iron sword [D]", price: 34 });
    expect(r.message).toContain("Your offer is now iron sword [D] for 34 gold.");
  });

  it("each failure makes the next harder, and she stops after three", () => {
    const c = ctx({}, rolls(face(5, 20)));
    for (let i = 0; i < MAX_FAILED_HAGGLES; i++) expect(haggle("Please?", c).success).toBe(false);
    expect(c.state.failedHaggles).toBe(MAX_FAILED_HAGGLES);
    expect(c.state.mood).toBe("annoyed");
    expect(haggle("Pretty please?", c).ok).toBe(false);
  });

  it("the target rises by 2 per earlier failure", () => {
    const c = ctx({ failedHaggles: 2 }, rolls(face(12, 20))); // 13 vs 17
    expect(haggle("Again?", c).message).toContain("vs 17");
  });

  it("a sale resets the discount and failed haggles", () => {
    const c = ctx({ pendingOffer: { item: "dagger [E]", price: 13 }, discountPct: 14, failedHaggles: 2 });
    acceptOffer(c);
    expect(c.state.discountPct).toBe(0);
    expect(c.state.failedHaggles).toBe(0);
  });

  it("an NPC with no haggling skill keeps the full discount; a master gives half", () => {
    const noSkill = { ...persona, skills: {} };
    const st = createNpcState(noSkill);
    expect(grantDiscount(noSkill, st, 20)).toBe(20);
    const master = { ...persona, skills: { haggling: 5 } };
    expect(grantDiscount(master, createNpcState(master), 20)).toBe(10);
  });

  it("never lowers an existing discount", () => {
    const st = createNpcState(persona, { discountPct: 20 });
    expect(grantDiscount(persona, st, 10)).toBe(20);
  });

  it("can't haggle mid-fight", () => {
    expect(haggle("Discount?", ctx({ inCombat: true })).ok).toBe(false);
  });
});

describe("pleading", () => {
  it("recognises begging and giving up, but not taunts", () => {
    for (const l of ["I'm sorry!", "Stop, please!", "I yield", "I give up", "Mercy!", "Spare me"]) expect(isPleading(l), l).toBe(true);
    for (const l of ["Is that all you've got?", "Take this!", "Hello"]) expect(isPleading(l), l).toBe(false);
  });
});

describe("fights go on until they end", () => {
  it("npcAttack starts a fight, damages the player, and notes the exchange", () => {
    const c = ctx({}, rolls(face(15, 20), face(5, 8)));
    const r = npcAttack(c);
    expect(r.ok).toBe(true);
    expect(c.state.inCombat).toBe(true);
    expect(c.world.player.hp).toBe(30);
    expect(c.state.lastCombatNote).toBe("You hit Traveler for 10. Traveler has 30/40 HP left.");
  });

  it("end_fight stops the fight", () => {
    const c = ctx({ inCombat: true, lastCombatNote: "x" });
    expect(act("end_fight", c).ok).toBe(true);
    expect(c.state.inCombat).toBe(false);
    expect(act("end_fight", c).ok).toBe(false); // nothing left to end
  });

  it("the player can run: escaping ends the conversation", () => {
    // Player AGI 13 (+1) + evasion 2 vs 10 + Brena AGI 9 (-1) = 9.
    const c = ctx({ inCombat: true }, rolls(face(10, 20)));
    const r = playerFlee(c);
    expect(r.escaped).toBe(true);
    expect(c.state.outcome).toBe("player fled");
    expect(c.state.conversationOver).toBe(true);
  });

  it("failing to run gives the NPC a free hit", () => {
    const c = ctx({ inCombat: true }, rolls(face(2, 20), face(15, 20), face(5, 8)));
    const r = playerFlee(c);
    expect(r.escaped).toBe(false);
    expect(c.world.player.hp).toBe(30);
    expect(c.state.inCombat).toBe(true);
  });

  it("can't run when there's no fight", () => {
    expect(playerFlee(ctx()).ok).toBe(false);
  });
});
