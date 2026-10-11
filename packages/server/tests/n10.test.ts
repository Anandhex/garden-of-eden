import { describe, expect, it } from "vitest";
import { applyAction, npcPrice, parseAction, toolsFor } from "../src/npc/actions.js";
import { createNpcState } from "../src/npc/state.js";
import { inputBonus, RECIPES, startCraft } from "../src/game/crafting.js";
import { demandOf, pickDemanded, restock, stockFactor } from "../src/game/economy.js";
import { NpcAgent } from "../src/npc/NpcAgent.js";
import { createDemoWorld } from "../src/world/world.js";
import { always, brena, call, FakeProvider, hale, pell, say } from "./helpers.js";

const sword = RECIPES.find((r) => r.id === "iron_sword")!;

describe("N10 input tiers", () => {
  it("materials add (or take off) tiers: better ore, better sword", () => {
    expect(inputBonus(["iron ore [F]", "iron ore [F]"])).toBe(0);
    expect(inputBonus(["iron ore [D]", "iron ore [D]"])).toBe(2);
    expect(inputBonus(["iron ore [G]"])).toBe(-1);
  });

  it("done when: bringing Brena better ore gets you a better sword", () => {
    const plain = createNpcState(brena, { inventory: { "iron ore [F]": 4 }, injuries: [] });
    const fine = createNpcState(brena, { inventory: { "iron ore [E]": 4 }, injuries: [] });
    const a = startCraft(brena, plain, sword, 0, always(0.3)); // d20 7 + 10 = 17: no bump
    const b = startCraft(brena, fine, sword, 0, always(0.3), { best: true });
    expect(a.output).toBe("iron sword [D]");
    expect(b.output).toBe("iron sword [C]");
    expect(b.inputBonus).toBe(1);
  });

  it("an order gets the best ore in the chest; routine work uses the poorest", () => {
    const s = createNpcState(brena, { inventory: { "iron ore [F]": 4, "iron ore [D]": 4 }, injuries: [] });
    startCraft(brena, s, sword, 0, always(0.3));
    expect(s.inventory["iron ore [D]"]).toBe(4);
    startCraft(brena, s, sword, 0, always(0.3), { best: true });
    expect(s.inventory["iron ore [D]"]).toBeUndefined();
  });
});

describe("N10 supply and demand", () => {
  it("done when: iron sword prices rise when she's down to her last and out of ore", () => {
    const stocked = createNpcState(brena, { inventory: { "iron sword [D]": 3 } });
    const last = createNpcState(brena, { inventory: { "iron sword [D]": 1 } });
    const lastWithOre = createNpcState(brena, { inventory: { "iron sword [D]": 1, "iron ore [F]": 4 } });
    const base = npcPrice(brena, "iron sword [D]", undefined, stocked)!;
    expect(base).toBe(400);
    expect(npcPrice(brena, "iron sword [D]", undefined, last)!).toBe(500);
    expect(npcPrice(brena, "iron sword [D]", undefined, lastWithOre)!).toBe(400);
    expect(stockFactor(brena, createNpcState(brena, { inventory: { "horseshoe [G]": 14 } }), "horseshoe")).toBe(0.9);
  });

  it("village demand differs by item, and weights what villagers buy", () => {
    expect(demandOf("horseshoe")).toBeGreaterThan(demandOf("iron sword"));
    let shoes = 0;
    let seed = 11;
    const rng = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 1000; i++) if (pickDemanded(["horseshoe [G]", "iron sword [D]"], rng) === "horseshoe [G]") shoes++;
    expect(shoes).toBeGreaterThan(700);
  });
});

describe("N10 restocking and trade between NPCs", () => {
  it("an NPC short of materials buys them from someone at the same place who has them", () => {
    const world = createDemoWorld();
    world.hour = 12;
    const herbSeller = { ...hale, buys: [...hale.buys, "wild herbs"] };
    const p = createNpcState(pell, { inventory: { "ale [G]": 2 } });
    const h = createNpcState(herbSeller, { inventory: { "wild herbs [F]": 5 } });
    const log = restock([{ id: "pell", persona: pell, state: p }, { id: "hale", persona: herbSeller, state: h }], () => "inn", world, always(0.5));
    expect(log[0]).toMatch(/Old Pell bought \d wild herbs \[F\] from Corporal Hale/);
    expect(p.inventory["wild herbs [F]"]).toBeGreaterThan(0);
    expect(p.npcRelations.hale!.affection).toBeGreaterThan(-100);
    expect(world.events!.at(-1)!.kind).toBe("trade");
  });

  it("on market day a travelling trader sells ore, unless the mine road is shut", () => {
    const world = createDemoWorld();
    world.day = 7; // market day
    world.hour = 10;
    world.recentEvents = [];
    const b = createNpcState(brena);
    const log = restock([{ id: "brena", persona: brena, state: b }], () => "forge", world, always(0.5));
    expect(log[0]).toMatch(/travelling trader/);
    expect(b.inventory["iron ore [F]"]).toBeGreaterThan(0);

    const raided = createDemoWorld();
    raided.day = 7;
    raided.hour = 10;
    raided.lastRaidDay = 7;
    const b2 = createNpcState(brena);
    expect(restock([{ id: "brena", persona: brena, state: b2 }], () => "forge", raided, always(0.5))).toEqual([]);
  });
});

describe("N10 offer_commission", () => {
  it("is offered on trade talk; the game sets the terms; the player's yes pays the deposit", async () => {
    const world = createDemoWorld();
    const npc = new NpcAgent(brena, new FakeProvider([call("offer_commission", { item: "iron sword" }), say("Four gold. Half now."), say("Done.")]), always(0.5));
    const tools = toolsFor({ persona: brena, state: npc.state, world, rng: always(0.5), tradeTalk: true });
    expect(tools.map((t) => t.name)).toContain("offer_commission");
    await npc.respond("Could you forge me a sword to order? I'll pay.", world);
    expect(npc.state.pendingCommission).toBe("iron sword");
    const r = await npc.acceptCommissionOffer(world);
    expect(r.order.ok).toBe(true);
    expect(npc.state.commission?.item).toBe("iron sword");
    expect(world.player.money).toBeLessThan(500);
  });

  it("refused when she already has an order of yours on the go", () => {
    const world = createDemoWorld();
    const s = createNpcState(brena, { commission: { item: "dagger", recipeId: "dagger", price: 150, deposit: 75, due: 99999, status: "waiting", commitment: "c1" } });
    const parsed = parseAction("offer_commission", { item: "iron sword" });
    if (!parsed.ok) throw new Error(parsed.error);
    expect(applyAction(parsed, { persona: brena, state: s, world, rng: always(0.5), tradeTalk: true }).ok).toBe(false);
  });
});
