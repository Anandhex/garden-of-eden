import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import brenaJson from "../src/data/npcs/brena.json" with { type: "json" };
import pellJson from "../src/data/npcs/pell.json" with { type: "json" };
import { formatMoney, formatMoneyShort, MoneySchema, parseMoney, PriceArgSchema, toCoins } from "../src/game/money.js";
import { loadWorld, newWorld, SAVE_VERSION } from "../src/game/save.js";
import { parsePersona } from "../src/npc/personaSchema.js";
import { buildTurnMessage } from "../src/npc/persona.js";
import { createNpcState } from "../src/npc/state.js";
import { createDemoWorld } from "../src/world/world.js";

const brena = parsePersona(brenaJson);
const pell = parsePersona(pellJson);

describe("coins", () => {
  it("1 gold = 10 silver = 100 copper, shown with the fewest coins", () => {
    expect(toCoins(1234)).toEqual({ gold: 12, silver: 3, copper: 4 });
    expect(formatMoney(1234)).toBe("12 gold 3 silver 4 copper");
    expect(formatMoney(150)).toBe("1 gold 5 silver");
    expect(formatMoney(15)).toBe("1 silver 5 copper");
    expect(formatMoney(7)).toBe("7 copper");
    expect(formatMoney(0)).toBe("0 copper");
    expect(formatMoneyShort(1234)).toBe("12g 3s 4c");
  });

  it("reads coin phrases, however they're written", () => {
    expect(parseMoney("1 gold 5 silver")).toBe(150);
    expect(parseMoney("1g 5s")).toBe(150);
    expect(parseMoney("15 silver")).toBe(150);
    expect(parseMoney("2 gold, 3 silver and 4 copper")).toBe(234);
    expect(parseMoney("3 coppers")).toBe(3);
    expect(parseMoney("5 gold coins")).toBe(500);
    expect(parseMoney("10 gp")).toBe(1000);
  });

  it("refuses anything that isn't clearly coins", () => {
    expect(parseMoney("15")).toBeNull(); // which coin?
    expect(parseMoney("cheap")).toBeNull();
    expect(parseMoney("15 silver and a hug")).toBeNull();
    expect(parseMoney("")).toBeNull();
  });

  it("data files may use coin phrases or whole copper", () => {
    expect(MoneySchema.parse("2 gold")).toBe(200);
    expect(MoneySchema.parse(200)).toBe(200);
    expect(MoneySchema.safeParse("lots").success).toBe(false);
    expect(MoneySchema.safeParse(1.5).success).toBe(false);
  });

  it("the model names prices in coins; a bare number or nothing is sent back", () => {
    expect(PriceArgSchema.parse("4 gold")).toBe(400);
    expect(PriceArgSchema.safeParse("40").success).toBe(false);
    expect(PriceArgSchema.safeParse("0 copper").success).toBe(false);
  });
});

describe("the economy in coins", () => {
  it("NPC files are read into copper", () => {
    expect(brena.startingMoney).toBe(350); // "3 gold 5 silver"
    expect(brena.prices["iron sword"]).toBe(400);
    expect(pell.debts?.[0]?.amount).toBe(2000);
  });

  it("the model sees prices and purses in coins, never raw copper", () => {
    const msg = buildTurnMessage(brena, createNpcState(brena), createDemoWorld(), "What do you sell?");
    expect(msg).toContain("dagger [E] x3 (1 gold 5 silver each)");
    expect(msg).toContain("Your purse: 3 gold 5 silver.");
    expect(msg).toContain("Traveler has 5 gold and carries");
  });
});

describe("old saves", () => {
  it("convert whole gold to coins: 1 old gold becomes 1 silver", () => {
    const file = join(mkdtempSync(join(tmpdir(), "llm-game-money-")), "world.json");
    const personas = { brena, pell };
    const world = newWorld(personas) as unknown as Record<string, any>;
    // A v3 save: `gold` fields counting whole gold pieces.
    world.version = 3;
    world.player = { ...world.player, gold: 42, quests: { active: [{ id: "q", reward: { gold: 8 } }], completed: [] } };
    delete world.player.money;
    for (const s of Object.values(world.npcStates) as Array<Record<string, any>>) {
      s.gold = 35;
      delete s.money;
    }
    world.npcStates.pell.debts = { mayor: 150 };
    world.npcStates.brena.pendingOffer = { item: "dagger [E]", price: 15 };
    world.npcStates.brena.pendingTraining = { skill: "smithing", hours: 2, cost: 10 };
    writeFileSync(file, `${JSON.stringify(world)}\n`);

    const loaded = loadWorld(file, personas);
    expect(loaded.version).toBe(SAVE_VERSION);
    expect(loaded.player.money).toBe(420); // 4 gold 2 silver
    expect(loaded.player.quests.active[0]!.reward.money).toBe(80);
    expect(loaded.npcStates.brena!.money).toBe(350);
    expect(loaded.npcStates.pell!.debts).toEqual({ mayor: 1500 });
    expect(loaded.npcStates.brena!.pendingOffer).toEqual({ item: "dagger [E]", price: 150 });
    expect(loaded.npcStates.brena!.pendingTraining?.cost).toBe(100);
    expect("gold" in loaded.player).toBe(false);
  });
});
