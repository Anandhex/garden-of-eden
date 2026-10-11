import { describe, expect, it } from "vitest";
import brenaJson from "../src/data/npcs/brena.json" with { type: "json" };
import pellJson from "../src/data/npcs/pell.json" with { type: "json" };
import { DEFAULT_RESERVE, debtStatus, effectiveGreed, isDebtFree, payDebts } from "../src/game/debts.js";
import { feePerHour } from "../src/game/training.js";
import { maxBuyPrice } from "../src/npc/actions.js";
import { train } from "../src/game/training.js";
import { acceptOffer, applyAction, parseAction } from "../src/npc/actions.js";
import { buildSystemPrompt, buildTurnMessage } from "../src/npc/persona.js";
import { createNpcState } from "../src/npc/state.js";
import type { NpcPersona } from "../src/npc/types.js";
import { createDemoWorld } from "../src/world/world.js";
import { parsePersona } from "../src/npc/personaSchema.js";

const pell = parsePersona(pellJson); // owes the mayor 20 gold, keeps 2 gold in reserve, starts with 12 gold (money is in copper)
const brena = parsePersona(brenaJson); // no debts

describe("debts", () => {
  it("start at the full amount", () => {
    expect(createNpcState(pell).debts).toEqual({ mayor: 2000 });
    expect(createNpcState(brena).debts).toEqual({});
  });

  it("are paid with money above the reserve", () => {
    const state = createNpcState(pell); // 12 gold
    expect(payDebts(pell, state)).toEqual([{ debtId: "mayor", creditor: "the mayor", amount: 1000, remaining: 1000 }]);
    expect(state.money).toBe(200);
    expect(state.debts.mayor).toBe(1000);
    expect(payDebts(pell, state)).toEqual([]); // nothing spare
  });

  it("never pay more than is owed", () => {
    const state = createNpcState(pell, { money: 5000, debts: { mayor: 300 } });
    payDebts(pell, state);
    expect(state.debts.mayor).toBe(0);
    expect(state.money).toBe(4700);
  });

  it("an NPC without debts keeps everything", () => {
    const state = createNpcState(brena, { money: 5000 });
    expect(payDebts(brena, state)).toEqual([]);
    expect(state.money).toBe(5000);
  });

  it("reserve defaults to 2 gold", () => {
    expect(DEFAULT_RESERVE).toBe(200);
  });

  it("are paid down when the NPC sells something", () => {
    const world = createDemoWorld();
    const state = createNpcState(pell, { money: 200, pendingOffer: { item: "stew [G]", price: 40 } });
    acceptOffer({ persona: pell, state, world, rng: Math.random });
    expect(state.money).toBe(200);
    expect(state.debts.mayor).toBe(1960);
  });

  it("are paid down from training fees", () => {
    const world = createDemoWorld();
    const state = createNpcState(pell, { money: 200 });
    const r = train(pell, state, world, "haggling", 2); // 2h toward novice at 95 copper/h (Pell's greed at trust 0)
    expect(r.cost).toBe(190);
    expect(state.debts.mayor).toBe(1810);
    expect(state.money).toBe(200);
  });

  it("are never shown to the model, in the system prompt or the situation", () => {
    const state = createNpcState(pell);
    const text = buildSystemPrompt(pell) + buildTurnMessage(pell, state, createDemoWorld(), "How's business?");
    expect(text).not.toMatch(/\b(mayor|debts?|owes?|owed)\b/i);
  });

  it("revealing the secret tells the model how much is still owed", () => {
    const state = createNpcState(pell, { relationship: 80, debts: { mayor: 1200 } });
    const parsed = parseAction("reveal_secret", { secret: "debts" });
    const r = parsed.ok ? applyAction(parsed, { persona: pell, state, world: createDemoWorld(), rng: () => 0.99 }) : null; // 0.99: no lie (Pell may lie, see traits.ts)
    expect(r?.message).toContain("You've paid back 8 gold so far; you still owe the mayor 12 gold.");
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
    // Toward apprentice at trust 0: 100 copper * (1 + greed).
    expect(feePerHour(pell, createNpcState(pell), 2)).toBe(190);
    expect(feePerHour(pell, createNpcState(pell, { debts: { mayor: 0 } }), 2)).toBe(130);
  });

  it("he pays more for what you sell him once he's paid up", () => {
    // Rabbit pelt (5 silver): 25 copper * (1 - 0.4 * greed).
    expect(maxBuyPrice(pell, createNpcState(pell), "rabbit pelt")).toBe(16);
    expect(maxBuyPrice(pell, createNpcState(pell, { debts: { mayor: 0 } }), "rabbit pelt")).toBe(22);
  });

  it("the switch happens as soon as a sale clears the debt", () => {
    const world = createDemoWorld();
    const state = createNpcState(pell, { money: 200, debts: { mayor: 40 }, pendingOffer: { item: "stew [G]", price: 40 } });
    expect(effectiveGreed(pell, state)).toBe(0.9);
    acceptOffer({ persona: pell, state, world, rng: Math.random });
    expect(state.debts.mayor).toBe(0);
    expect(effectiveGreed(pell, state)).toBe(0.3);
  });
});
