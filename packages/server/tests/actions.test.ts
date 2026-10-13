import { describe, expect, it } from "vitest";
import brena from "./fixtures/npcs/brena.json" with { type: "json" };
import pellJson from "./fixtures/npcs/pell.json" with { type: "json" };
import {
  type ActionContext,
  acceptOffer,
  acceptPurchase,
  applyAction,
  declineOffer,
  declinePurchase,
  haggle,
  isTradeTalk,
  maxBuyPrice,
  npcPrice,
  parseAction,
  SECRET_TRUST,
  toolsFor,
} from "../src/npc/actions.js";
import { buildTurnMessage } from "../src/npc/persona.js";
import { createNpcState } from "../src/npc/state.js";
import type { NpcPersona, NpcState } from "../src/npc/types.js";
import { createTestWorld } from "../src/world/world.js";
import { parsePersona } from "../src/npc/personaSchema.js";

/** Dice that roll these d20/die faces in order (as fractions of the die). */
export const fixedRng = (...values: number[]) => {
  let i = 0;
  return () => values[i++ % values.length]!;
};

/** Brena with 1 dagger (1 gold 5 silver) and 1 iron sword (4 gold); the player has 5 gold. Money is in copper. */
const freshCtx = (overrides: Partial<NpcState> = {}, rng = fixedRng(0.5)): ActionContext => ({
  persona: parsePersona(brena),
  // With ore to make more, a last copy isn't dearer (N10, game/economy.ts, has its own tests).
  state: createNpcState(parsePersona(brena), { inventory: { dagger: 1, "iron sword": 1, "iron ore": 4 }, ...overrides }),
  world: createTestWorld(),
  rng,
});

const offer = (item: string, price: number) => ({ ok: true as const, name: "offer_item" as const, args: { item, price } });
const reveal = (secret: string) => ({ ok: true as const, name: "reveal_secret" as const, args: { secret } });
const mood = (m: NpcState["mood"]) => ({ ok: true as const, name: "change_mood" as const, args: { mood: m } });
const toolNames = (ctx: ActionContext) => toolsFor(ctx).map((t) => t.name);

describe("parseAction", () => {
  it("accepts valid calls", () => {
    expect(parseAction("change_mood", { mood: "angry" })).toEqual(mood("angry"));
    expect(parseAction("offer_item", { item: "dagger [E]", price: "1 gold 5 silver" })).toEqual(offer("dagger [E]", 150));
    expect(parseAction("offer_item", { item: "dagger [E]", price: "15s" })).toEqual(offer("dagger [E]", 150));
    expect(parseAction("reveal_secret", { secret: "vault_key" })).toEqual(reveal("vault_key"));
  });

  it("rejects unknown tool names, including the old sell_item", () => {
    expect(parseAction("fly_away", {}).ok).toBe(false);
    expect(parseAction("sell_item", { item: "dagger [E]", price: 15 }).ok).toBe(false);
  });

  it("rejects bad arguments", () => {
    expect(parseAction("change_mood", { mood: "ecstatic" }).ok).toBe(false);
    expect(parseAction("offer_item", { item: "dagger" }).ok).toBe(false);
    expect(parseAction("offer_item", { item: "dagger [E]", price: "15" }).ok).toBe(false); // which coin?
    expect(parseAction("offer_item", { item: "dagger [E]", price: 15 }).ok).toBe(false);
    expect(parseAction("offer_item", { item: "dagger [E]", price: "15 silver and a hug" }).ok).toBe(false);
    expect(parseAction("reveal_secret", {}).ok).toBe(false);
  });
});

describe("toolsFor", () => {
  it("offers offer_item with only in-stock items and their prices", () => {
    const tool = toolsFor(freshCtx()).find((t) => t.name === "offer_item")!;
    expect(tool.description).toContain("dagger [E] (1 gold 5 silver)");
    expect(tool.description).toContain("iron sword [D] (4 gold)");
    expect(tool.description).not.toContain("horseshoe");
    expect((tool.parameters as any).properties.item.enum).toEqual(["dagger [E]", "iron sword [D]"]);
  });

  it("does not offer offer_item when nothing is in stock", () => {
    expect(toolNames(freshCtx({ inventory: {} }))).not.toContain("offer_item");
  });

  it(`hides reveal_secret at trust ${SECRET_TRUST} and below`, () => {
    expect(toolNames(freshCtx({ relationship: SECRET_TRUST }))).not.toContain("reveal_secret");
  });

  it("offers reveal_secret above the trust threshold, with hints but not the secret text", () => {
    const tool = toolsFor(freshCtx({ relationship: SECRET_TRUST + 1 })).find((t) => t.name === "reveal_secret")!;
    expect(tool.description).toContain("vault_key");
    expect(tool.description).toContain("a key you forged");
    expect(tool.description).not.toMatch(/mayor|vault was robbed/);
  });

  it("stops offering reveal_secret once every secret is told", () => {
    expect(toolNames(freshCtx({ relationship: 80, revealedSecrets: ["vault_key"] }))).not.toContain("reveal_secret");
  });
});

describe("change_mood", () => {
  it("sets the mood and shifts trust", () => {
    const ctx = freshCtx();
    applyAction(mood("angry"), ctx);
    expect(ctx.state.mood).toBe("angry");
    expect(ctx.state.relationship).toBe(-15);
    applyAction(mood("happy"), ctx);
    expect(ctx.state.relationship).toBe(-5);
  });

  it("keeps trust within -100..100", () => {
    const ctx = freshCtx({ relationship: 95 });
    applyAction(mood("happy"), ctx);
    expect(ctx.state.relationship).toBe(100);
  });
});

describe("offer_item", () => {
  it("records a pending offer without moving any gold or items", () => {
    const ctx = freshCtx();
    expect(applyAction(offer("dagger", 150), ctx).ok).toBe(true);
    expect(ctx.state.pendingOffer).toEqual({ item: "dagger [E]", price: 150 });
    expect(ctx.world.player.money).toBe(500);
    expect(ctx.state.inventory["dagger [E]"]).toBe(1);
  });

  it("fails for items not in stock, unpriced items, low prices, or prices the player can't pay", () => {
    const ctx = freshCtx({ inventory: { dagger: 1, "old boot": 1, "iron ore": 2 } });
    expect(applyAction(offer("horseshoe", 20), ctx).ok).toBe(false);
    expect(applyAction(offer("old boot", 50), ctx).ok).toBe(false);
    expect(applyAction(offer("dagger", 0), ctx).ok).toBe(false);
    ctx.world.player.money = 100;
    expect(applyAction(offer("dagger", 150), ctx)).toEqual({ ok: false, message: "Traveler only has 1 gold; dagger [E] costs 1 gold 5 silver." });
    expect(ctx.state.pendingOffer).toBeNull();
  });

  it("replaces an earlier offer", () => {
    const ctx = freshCtx();
    applyAction(offer("dagger", 150), ctx);
    applyAction(offer("iron sword", 400), ctx);
    expect(ctx.state.pendingOffer).toEqual({ item: "iron sword [D]", price: 400 });
  });
});

describe("acceptOffer / declineOffer", () => {
  it("accepting completes the sale, clears the offer, and raises trust", () => {
    const ctx = freshCtx({ pendingOffer: { item: "dagger [E]", price: 150 } });
    expect(acceptOffer(ctx)).toEqual({ ok: true, message: "Traveler accepted and paid 1 gold 5 silver for the dagger [E]." });
    expect(ctx.world.player.money).toBe(350);
    expect(ctx.state.money).toBe(parsePersona(brena).startingMoney + 150);
    expect(ctx.world.player.inventory["dagger [E]"]).toBe(1);
    expect(ctx.state.inventory["dagger [E]"]).toBeUndefined();
    expect(ctx.state.pendingOffer).toBeNull();
    expect(ctx.state.relationship).toBe(5);
  });

  it("accepting rechecks stock and gold", () => {
    const gone = freshCtx({ pendingOffer: { item: "dagger [E]", price: 150 }, inventory: {} });
    expect(acceptOffer(gone).ok).toBe(false);
    const broke = freshCtx({ pendingOffer: { item: "dagger [E]", price: 150 } });
    broke.world.player.money = 50;
    expect(acceptOffer(broke).ok).toBe(false);
    expect(broke.world.player.money).toBe(50);
    expect(broke.state.money).toBe(parsePersona(brena).startingMoney);
  });

  it("declining clears the offer and moves nothing", () => {
    const ctx = freshCtx({ pendingOffer: { item: "dagger [E]", price: 150 } });
    expect(declineOffer(ctx).ok).toBe(true);
    expect(ctx.state.pendingOffer).toBeNull();
    expect(ctx.world.player.money).toBe(500);
  });

  it("does nothing when there is no offer", () => {
    expect(acceptOffer(freshCtx()).ok).toBe(false);
    expect(declineOffer(freshCtx()).ok).toBe(false);
  });
});

describe("reveal_secret", () => {
  it("is refused at low trust even if the model calls it anyway", () => {
    const ctx = freshCtx({ relationship: 10 });
    const result = applyAction(reveal("vault_key"), ctx);
    expect(result.ok).toBe(false);
    expect(result.message).not.toMatch(/mayor/);
    expect(ctx.state.revealedSecrets).toEqual([]);
  });

  it("hands the secret text to the model at high trust and records it", () => {
    const ctx = freshCtx({ relationship: 80 });
    const result = applyAction(reveal("vault_key"), ctx);
    expect(result.ok).toBe(true);
    expect(result.message).toContain("mayor's vault");
    expect(ctx.state.revealedSecrets).toEqual(["vault_key"]);
  });

  it("fails for a secret that doesn't exist", () => {
    expect(applyAction(reveal("made_up"), freshCtx({ relationship: 80 })).ok).toBe(false);
  });
});

describe("selling to the NPC", () => {
  const buy = (item: string, price: number) => ({ ok: true as const, name: "offer_to_buy" as const, args: { item, price } });
  const persona = parsePersona(brena); // buys iron ore (worth 6 silver), weapons, horseshoes; 3 gold 5 silver; greed 0
  const pell = parsePersona(pellJson); // buys food, herbs, pelts; greed 0.9

  it("pays half an item's value, less from a greedy NPC who doesn't trust you", () => {
    expect(maxBuyPrice(persona, freshCtx().state, "iron ore")).toBe(30);
    expect(maxBuyPrice(persona, freshCtx().state, "iron sword")).toBe(200);
    const pellState = createNpcState(pell);
    expect(maxBuyPrice(pell, pellState, "rabbit pelt")).toBe(16); // 50 * 0.5 * (1 - 0.36) = 16 copper
    pellState.relationship = 100;
    expect(maxBuyPrice(pell, pellState, "rabbit pelt")).toBe(25);
  });

  it("doesn't buy things outside its trade", () => {
    expect(maxBuyPrice(persona, freshCtx().state, "wild herbs")).toBeUndefined();
    expect(maxBuyPrice(persona, freshCtx().state, "stew")).toBeUndefined();
  });

  const trading = (overrides: Partial<NpcState> = {}) => ({ ...freshCtx(overrides), tradeTalk: true });

  it("offers offer_to_buy only for things the player carries and the NPC buys", () => {
    const tool = toolsFor(trading()).find((t) => t.name === "offer_to_buy")!;
    expect((tool.parameters as any).properties.item.enum).toEqual(["iron ore [F]"]);
    expect(tool.description).toContain("iron ore [F] (up to 3 silver)");
    const empty = trading();
    empty.world.player.inventory = { "wild herbs": 2 };
    expect(toolNames(empty)).not.toContain("offer_to_buy");
  });

  it("only offers offer_to_buy when the player is talking about trade", () => {
    expect(toolNames(freshCtx())).not.toContain("offer_to_buy");
    expect(toolNames(trading())).toContain("offer_to_buy");
  });

  it("recognises trade talk", () => {
    for (const line of ["Want to buy some ore?", "I'd like to sell this.", "What's it worth?", "Any coin for these?", "Can I afford a sword?"]) {
      expect(isTradeTalk(line), line).toBe(true);
    }
    for (const line of ["Hello there.", "Is something troubling you about a key?", "Your forge is junk."]) {
      expect(isTradeTalk(line), line).toBe(false);
    }
  });

  it("an offer to buy waits for the player; nothing moves yet", () => {
    const ctx = freshCtx();
    expect(applyAction(buy("iron ore", 30), ctx).ok).toBe(true);
    expect(ctx.state.pendingPurchase).toEqual({ item: "iron ore [F]", price: 30 });
    expect(ctx.world.player.inventory["iron ore [F]"]).toBe(3);
    expect(ctx.state.money).toBe(350);
  });

  it("rejects offers that are too high, for things the player lacks, or that the NPC can't afford", () => {
    const ctx = freshCtx();
    expect(applyAction(buy("iron ore", 40), ctx).ok).toBe(false);
    expect(applyAction(buy("iron sword", 100), ctx).ok).toBe(false); // player has none
    expect(applyAction(buy("wild herbs", 10), ctx).ok).toBe(false); // Brena doesn't buy herbs
    expect(applyAction(buy("iron ore", 0), ctx).ok).toBe(false);
    ctx.state.money = 20;
    expect(applyAction(buy("iron ore", 30), ctx)).toEqual({ ok: false, message: "You only have 2 silver." });
    expect(ctx.state.pendingPurchase).toBeNull();
  });

  it("accepting moves the item to the NPC and the gold to the player", () => {
    const ctx = freshCtx({ pendingPurchase: { item: "iron ore [F]", price: 30 } });
    expect(acceptPurchase(ctx)).toEqual({ ok: true, message: "Traveler sold you the iron ore [F] for 3 silver." });
    expect(ctx.world.player.money).toBe(530);
    expect(ctx.world.player.inventory["iron ore [F]"]).toBe(2);
    expect(ctx.state.money).toBe(320);
    expect(ctx.state.inventory["iron ore [F]"]).toBe(5); // her 4, plus the one she bought
    expect(ctx.state.relationship).toBe(2);
  });

  it("accepting rechecks the player's item and the NPC's gold", () => {
    const gone = freshCtx({ pendingPurchase: { item: "iron ore [F]", price: 30 } });
    gone.world.player.inventory = {};
    expect(acceptPurchase(gone).ok).toBe(false);
    const broke = freshCtx({ pendingPurchase: { item: "iron ore [F]", price: 30 }, money: 10 });
    expect(acceptPurchase(broke).ok).toBe(false);
    expect(broke.world.player.money).toBe(500);
  });

  it("declining clears the offer and moves nothing", () => {
    const ctx = freshCtx({ pendingPurchase: { item: "iron ore [F]", price: 30 } });
    expect(declinePurchase(ctx).ok).toBe(true);
    expect(ctx.state.pendingPurchase).toBeNull();
    expect(ctx.world.player.money).toBe(500);
  });

  it("a won haggle raises the NPC's pending buy offer", () => {
    // d20 19: big win → 24% → 17% after Brena's haggling. Iron sword: 20 → floor(20 * 1.17) = 23.
    const ctx = freshCtx({ pendingPurchase: { item: "iron sword [D]", price: 150 } }, () => 18.5 / 20);
    ctx.world.player.inventory["iron sword [D]"] = 1;
    const r = haggle("It's worth more than that.", ctx);
    expect(ctx.state.pendingPurchase).toEqual({ item: "iron sword [D]", price: 234 });
    expect(r.message).toContain("You now offer 2 gold 3 silver 4 copper for their iron sword [D].");
  });

  it("a fight cancels a pending buy offer", () => {
    const parsed = parseAction("attack_player", {});
    const ctx = freshCtx({ pendingPurchase: { item: "iron ore [F]", price: 30 }, provocations: 3, mood: "angry" });
    if (parsed.ok) applyAction(parsed, ctx);
    expect(ctx.state.pendingPurchase).toBeNull();
  });
});

describe("tiered copies in trade", () => {
  const persona = parsePersona(brena);

  it("NPC prices scale with tier: a masterwork iron sword [B] costs 2.25x", () => {
    expect(npcPrice(persona, "iron sword [D]")).toBe(400);
    expect(npcPrice(persona, "iron sword [B]")).toBe(900);
  });

  it("Brena stocks both an ordinary and a masterwork sword, offered separately", () => {
    const ctx: ActionContext = { persona, state: createNpcState(persona), world: createTestWorld(), rng: () => 0.5 };
    const tool = toolsFor(ctx).find((t) => t.name === "offer_item")!;
    expect((tool.parameters as any).properties.item.enum).toEqual(expect.arrayContaining(["iron sword [D]", "iron sword [B]"]));
    expect(tool.description).toContain("iron sword [B] (9 gold)");
  });

  it("lists stock cheapest first, in the tool and the situation", () => {
    const state = createNpcState(persona); // iron sword [D] 40, [B] 90, dagger [E] 15, horseshoe [G] 2
    const ctx: ActionContext = { persona, state, world: createTestWorld(), rng: () => 0.5 };
    const tool = toolsFor(ctx).find((t) => t.name === "offer_item")!;
    expect((tool.parameters as any).properties.item.enum).toEqual(["horseshoe [G]", "dagger [E]", "iron sword [D]", "iron sword [B]"]);
    const msg = buildTurnMessage(persona, state, createTestWorld(), "What do you sell?");
    expect(msg.indexOf("iron sword [D]")).toBeLessThan(msg.indexOf("iron sword [B]"));
  });

  it("an offer naming just 'iron sword' resolves to the only copy in stock", () => {
    const ctx = freshCtx({ inventory: { "iron sword [B]": 1, "iron ore": 4 } });
    ctx.world.player.money = 1000;
    expect(applyAction(offer("iron sword", 900), ctx).ok).toBe(true);
    expect(ctx.state.pendingOffer).toEqual({ item: "iron sword [B]", price: 900 });
  });

  it("can't undercut a masterwork's price with the ordinary price", () => {
    const ctx = freshCtx({ inventory: { "iron sword [B]": 1 } });
    expect(applyAction(offer("iron sword [B]", 400), ctx).ok).toBe(false);
  });

  it("selling a better copy pays more", () => {
    const ctx = freshCtx();
    expect(maxBuyPrice(persona, ctx.state, "iron sword [D]")).toBe(200);
    expect(maxBuyPrice(persona, ctx.state, "iron sword [B]")).toBe(450);
  });

  it("buying moves the exact copy", () => {
    const ctx = freshCtx({ inventory: { "iron sword [D]": 1, "iron sword [B]": 1 }, pendingOffer: { item: "iron sword [B]", price: 900 } });
    ctx.world.player.money = 1000;
    expect(acceptOffer(ctx).ok).toBe(true);
    expect(ctx.state.inventory).toEqual({ "iron sword [D]": 1 });
    expect(ctx.world.player.inventory["iron sword [B]"]).toBe(1);
  });
});

describe("offer_training", () => {
  const persona = parsePersona(brena);
  const ctx = (overrides: Partial<NpcState> = {}, trainingTalk = true): ActionContext => ({
    persona,
    state: createNpcState(persona, overrides),
    world: createTestWorld(),
    rng: () => 0.5,
    trainingTalk,
  });
  const offerTraining = (skill: string, hours: number) => {
    const p = parseAction("offer_training", { skill, hours });
    if (!p.ok) throw new Error(p.error);
    return p;
  };

  it("is only offered when the player talks about training", () => {
    expect(toolNames(ctx({}, false))).not.toContain("offer_training");
    expect(toolNames(ctx())).toContain("offer_training");
  });

  it("only offers the NPC's specialty, and only within the trust limit", () => {
    const c = ctx();
    const tool = toolsFor(c).find((t) => t.name === "offer_training")!;
    expect((tool.parameters as any).properties.skill.enum).toEqual(["smithing"]);
    c.world.player.skills.smithing = 2; // adept needs trust 20
    expect(toolNames(c)).not.toContain("offer_training");
  });

  it("records a priced offer without charging anything", () => {
    const c = ctx();
    const r = applyAction(offerTraining("smithing", 2), c);
    expect(r.ok).toBe(true);
    expect(c.state.pendingTraining).toEqual({ skill: "smithing", hours: 2, cost: 100 });
    expect(c.world.player.money).toBe(500);
  });

  it("rejects offers the game wouldn't allow", () => {
    expect(applyAction(offerTraining("archery", 2), ctx()).ok).toBe(false); // Brena can't teach it
    expect(applyAction(offerTraining("blunt", 2), ctx()).ok).toBe(false); // she knows it, but only teaches smithing
    expect(applyAction(offerTraining("smithing", 2), ctx({ mood: "angry" })).ok).toBe(false);
  });

  it("rejects unknown skills at parse time", () => {
    expect(parseAction("offer_training", { skill: "juggling", hours: 2 }).ok).toBe(false);
  });
});
