import { describe, expect, it } from "vitest";
import brenaJson from "../src/data/npcs/brena.json" with { type: "json" };
import pellJson from "../src/data/npcs/pell.json" with { type: "json" };
import { DEFAULT_RESERVE_GOLD, debtStatus, effectiveGreed, isDebtFree, payDebts } from "../src/game/debts.js";
import { feePerHour } from "../src/game/training.js";
import { maxBuyPrice } from "../src/npc/actions.js";
import { train } from "../src/game/training.js";
import { acceptOffer, applyAction, parseAction } from "../src/npc/actions.js";
import { buildSystemPrompt, buildTurnMessage } from "../src/npc/persona.js";
import { createNpcState } from "../src/npc/state.js";
import type { NpcPersona } from "../src/npc/types.js";
import { createDemoWorld } from "../src/world/world.js";

const pell = pellJson as NpcPersona; // owes the mayor 200, keeps 20 in reserve, starts with 120
const brena = brenaJson as NpcPersona; // no debts

describe("debts", () => {
  it("start at the full amount", () => {
    expect(createNpcState(pell).debts).toEqual({ mayor: 200 });
    expect(createNpcState(brena).debts).toEqual({});
  });

  it("are paid with gold above the reserve", () => {
    const state = createNpcState(pell); // 120 gold
    expect(payDebts(pell, state)).toEqual([{ debtId: "mayor", creditor: "the mayor", amount: 100, remaining: 100 }]);
    expect(state.gold).toBe(20);
    expect(state.debts.mayor).toBe(100);
    expect(payDebts(pell, state)).toEqual([]); // nothing spare
  });

  it("never pay more than is owed", () => {
    const state = createNpcState(pell, { gold: 500, debts: { mayor: 30 } });
    payDebts(pell, state);
    expect(state.debts.mayor).toBe(0);
    expect(state.gold).toBe(470);
  });

  it("an NPC without debts keeps everything", () => {
    const state = createNpcState(brena, { gold: 500 });
    expect(payDebts(brena, state)).toEqual([]);
    expect(state.gold).toBe(500);
  });

  it("reserve defaults to 20", () => {
    expect(DEFAULT_RESERVE_GOLD).toBe(20);
  });

  it("are paid down when the NPC sells something", () => {
    const world = createDemoWorld();
    const state = createNpcState(pell, { gold: 20, pendingOffer: { item: "stew [G]", price: 4 } });
    acceptOffer({ persona: pell, state, world, rng: Math.random });
    expect(state.gold).toBe(20);
    expect(state.debts.mayor).toBe(196);
  });

  it("are paid down from training fees", () => {
    const world = createDemoWorld();
    const state = createNpcState(pell, { gold: 20 });
    const r = train(pell, state, world, "haggling", 2); // 2h toward novice at 10/h (Pell's greed at trust 0)
    expect(r.cost).toBe(20);
    expect(state.debts.mayor).toBe(180);
    expect(state.gold).toBe(20);
  });

  it("are never shown to the model, in the system prompt or the situation", () => {
    const state = createNpcState(pell);
    const text = buildSystemPrompt(pell) + buildTurnMessage(pell, state, createDemoWorld(), "How's business?");
    expect(text).not.toMatch(/\b(mayor|debts?|owes?|owed)\b/i);
  });

  it("revealing the secret tells the model how much is still owed", () => {
    const state = createNpcState(pell, { relationship: 80, debts: { mayor: 120 } });
    const parsed = parseAction("reveal_secret", { secret: "debts" });
    const r = parsed.ok ? applyAction(parsed, { persona: pell, state, world: createDemoWorld(), rng: Math.random }) : null;
    expect(r?.message).toContain("You've paid back 80 gold so far; you still owe the mayor 120.");
  });

  it("describes a debt that is fully paid", () => {
    const state = createNpcState(pell, { debts: { mayor: 0 } });
    expect(debtStatus(pell, state, "mayor")).toContain("paid the mayor back in full");
  });
});

describe("greed eases once debts are paid", () => {
  it("Pell is greedy (0.9) while in debt and easier (0.3) once it's paid", () => {
    expect(effectiveGreed(pell, createNpcState(pell))).toBe(0.9);
    expect(effectiveGreed(pell, createNpcState(pell, { debts: { mayor: 1 } }))).toBe(0.9);
    const free = createNpcState(pell, { debts: { mayor: 0 } });
    expect(isDebtFree(pell, free)).toBe(true);
    expect(effectiveGreed(pell, free)).toBe(0.3);
  });

  it("an NPC who never had debts isn't 'debt-free' and keeps their greed", () => {
    expect(isDebtFree(brena, createNpcState(brena))).toBe(false);
    expect(effectiveGreed(brena, createNpcState(brena))).toBe(0);
  });

  it("training gets cheaper once he's paid up", () => {
    // Toward apprentice at trust 0: 10 * (1 + greed).
    expect(feePerHour(pell, createNpcState(pell), 2)).toBe(19);
    expect(feePerHour(pell, createNpcState(pell, { debts: { mayor: 0 } }), 2)).toBe(13);
  });

  it("he pays more for what you sell him once he's paid up", () => {
    // Rabbit pelt (5): 2.5 * (1 - 0.4 * greed).
    expect(maxBuyPrice(pell, createNpcState(pell), "rabbit pelt")).toBe(1);
    expect(maxBuyPrice(pell, createNpcState(pell, { debts: { mayor: 0 } }), "rabbit pelt")).toBe(2);
  });

  it("the switch happens as soon as a sale clears the debt", () => {
    const world = createDemoWorld();
    const state = createNpcState(pell, { gold: 20, debts: { mayor: 4 }, pendingOffer: { item: "stew [G]", price: 4 } });
    expect(effectiveGreed(pell, state)).toBe(0.9);
    acceptOffer({ persona: pell, state, world, rng: Math.random });
    expect(state.debts.mayor).toBe(0);
    expect(effectiveGreed(pell, state)).toBe(0.3);
  });
});
