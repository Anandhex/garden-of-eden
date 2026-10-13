import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import brenaJson from "./fixtures/npcs/brena.json" with { type: "json" };
import haleJson from "./fixtures/npcs/hale.json" with { type: "json" };
import pellJson from "./fixtures/npcs/pell.json" with { type: "json" };
import { fightCreature, loadCreatureTemplates, spawnCreature } from "../src/game/creatures.js";
import {
  armorValue,
  carrySlots,
  equip,
  equippedWeapon,
  gearLimit,
  playerGearRank,
  repairCost,
  slotsUsed,
  soak,
  STACK_SIZE,
  unequip,
  wearGear,
} from "../src/game/gear.js";
import { itemKey, itemValue, parseItem } from "../src/game/items.js";
import { acceptQuest, turnInQuests } from "../src/game/quests.js";
import { loadWorld, newWorld } from "../src/game/save.js";
import { npcNewDay, passTime } from "../src/game/simulation.js";
import {
  acceptOffer,
  acceptPurchase,
  type ActionContext,
  applyAction,
  notForSaleReason,
  npcAttack,
  npcPrice,
  parseAction,
  repairForPlayer,
} from "../src/npc/actions.js";
import { parsePersona } from "../src/npc/personaSchema.js";
import { createNpcState, npcSlots } from "../src/npc/state.js";
import type { NpcPersona, NpcState } from "../src/npc/types.js";
import { createTestWorld } from "../src/world/world.js";

const brena = parsePersona(brenaJson);
const pell = parsePersona(pellJson);
const hale = parsePersona(haleJson);
const wolf = loadCreatureTemplates().wolf!;
const ctxFor = (persona: NpcPersona, state: NpcState = createNpcState(persona), rng = () => 0.5): ActionContext => ({
  persona,
  state,
  world: createTestWorld(),
  rng,
});

describe("gear level", () => {
  it("the player can only equip gear at or below the rank their level gives", () => {
    const { player } = createTestWorld(); // level 1: rank G
    player.inventory["dagger [E]"] = 1;
    expect(equip(player, playerGearRank(player.level), "dagger", "player")).toEqual({
      ok: false,
      message: "dagger [E] is E-tier gear: it needs level 3.",
    });
    player.level = 3;
    expect(equip(player, playerGearRank(player.level), "dagger", "player").ok).toBe(true);
    expect(player.equipment?.weapon).toBe("dagger [E]");
    expect(player.inventory["dagger [E]"]).toBeUndefined(); // worn, not packed
    expect(equippedWeapon(player).name).toBe("dagger [E]");
  });

  it("so do NPCs, by their rank: Hale (F) carries a dagger he can't wield yet", () => {
    expect(gearLimit("F", "dagger [E]")).toBe("dagger [E] is E-tier gear, above rank F.");
    expect(hale.weapon).toBe("cudgel");
    expect(createNpcState(hale).equipment).toEqual({ weapon: "cudgel [F]", armor: "leather armor [F]" });
    expect(() => parsePersona({ ...haleJson, weapon: "iron sword" })).toThrow(/above rank F/);
  });

  it("equipping swaps what was in the slot back into the pack", () => {
    const { player } = createTestWorld();
    player.level = 5;
    player.inventory["dagger [E]"] = 1;
    player.inventory["iron sword [D]"] = 1;
    equip(player, "D", "dagger", "player");
    equip(player, "D", "iron sword", "player");
    expect(player.equipment?.weapon).toBe("iron sword [D]");
    expect(player.inventory["dagger [E]"]).toBe(1);
    expect(unequip(player, "weapon", 12).ok).toBe(true);
    expect(player.inventory["iron sword [D]"]).toBe(1);
  });
});

describe("durability", () => {
  it("worn gear carries its durability in its key; new gear has none", () => {
    expect(itemKey("iron sword", "D")).toBe("iron sword [D]");
    expect(itemKey("iron sword", "D", 12)).toBe("iron sword [D] (12/50)");
    expect(parseItem("iron sword [D] (12/50)")).toMatchObject({ name: "iron sword", tier: "D", durability: 12, maxDurability: 50 });
    expect(parseItem("iron sword [B]")?.maxDurability).toBe(113); // 50 × 1.5²: better tiers last longer
    expect(parseItem("bread loaf")?.durability).toBeUndefined();
  });

  it("each blow wears the weapon; a broken one is as good as fists", () => {
    const holder = { equipment: { weapon: "dagger [E]" } };
    for (let i = 0; i < 29; i++) expect(wearGear(holder, "weapon")).toBeNull();
    expect(holder.equipment.weapon).toBe("dagger [E] (1/30)");
    expect(wearGear(holder, "weapon")).toBe("dagger [E] broke!");
    expect(equippedWeapon(holder).name).toBe("fists");
  });

  it("armour soaks damage until it breaks", () => {
    const holder = { equipment: { armor: "chain mail [D]" } };
    expect(armorValue(holder)).toBe(3);
    expect(soak(5, holder)).toBe(2);
    expect(soak(2, holder)).toBe(1); // a hit always does at least 1
    holder.equipment.armor = "chain mail [D] (0/80)";
    expect(armorValue(holder)).toBe(0);
  });

  it("NPC fights wear both sides' gear", () => {
    const c = ctxFor(hale, createNpcState(hale, { inCombat: true }), () => 0.999);
    c.world.player.equipment = { armor: "leather armor [F]" };
    npcAttack(c);
    expect(c.state.equipment.weapon).toBe("cudgel [F] (24/25)");
    expect(c.world.player.equipment.armor).toBe("leather armor [F] (39/40)");
  });

  it("worn gear is worth less, and smiths charge to mend it", () => {
    expect(itemValue("iron sword [D]")).toBe(400);
    expect(itemValue("iron sword [D] (25/50)")).toBe(250); // 25% + 75% × half
    expect(itemValue("iron sword [D] (0/50)")).toBe(100);
    expect(repairCost("iron sword [D] (25/50)")).toBe(75); // half the 1 gold 5 silver lost
    expect(repairCost("iron sword [D]")).toBe(0);
    expect(npcPrice(brena, "iron sword [D] (25/50)")).toBe(250);
  });

  it("a smith mends the player's gear for a fee; others can't", () => {
    const c = ctxFor(brena);
    c.world.player.equipment = { weapon: "dagger [E] (10/30)" };
    expect(repairForPlayer("weapon", ctxFor(pell)).message).toBe("Old Pell doesn't repair gear.");
    const quote = repairForPlayer("weapon", c, { quote: true });
    expect(quote).toMatchObject({ ok: true, cost: 38 }); // worth 75 copper less than new; half of that
    expect(c.world.player.equipment.weapon).toBe("dagger [E] (10/30)"); // a quote changes nothing
    const r = repairForPlayer("weapon", c);
    expect(r.ok).toBe(true);
    expect(c.world.player.equipment.weapon).toBe("dagger [E]");
    expect(c.world.player.money).toBe(462);
    expect(c.state.money).toBe(brena.startingMoney + 38);
    expect(repairForPlayer("weapon", c).message).toContain("doesn't need mending");
  });

  it("smith NPCs mend their own gear overnight; others don't", () => {
    const smith = createNpcState(brena);
    smith.equipment.weapon = "forge hammer [C] (3/80)";
    expect(npcNewDay(brena, smith, 2, () => 0.99)).toContain(`${brena.name} mended their forge hammer [C].`);
    expect(smith.equipment.weapon).toBe("forge hammer [C]");
    const guard = createNpcState(hale);
    guard.equipment.weapon = "cudgel [F] (3/25)";
    npcNewDay(hale, guard, 2, () => 0.99);
    expect(guard.equipment.weapon).toBe("cudgel [F] (3/25)");
  });
});

describe("burden", () => {
  it("gear takes a slot each; goods stack 20 to a slot", () => {
    expect(STACK_SIZE).toBe(20);
    expect(slotsUsed({ "ale [G]": 20, "stew [G]": 21, "dagger [E]": 2 })).toBe(1 + 2 + 2);
  });

  it("pack slots come from strength; shopkeepers add storage", () => {
    expect(carrySlots(12)).toBe(12);
    expect(carrySlots(8)).toBe(8);
    expect(carrySlots(16)).toBe(16);
    expect(npcSlots(brena, createNpcState(brena))).toBe(16 + 12); // pack + forge chest
    expect(npcSlots(pell, createNpcState(pell))).toBe(6 + 16); // age has his strength down to 6; plus the storeroom
  });

  it("every NPC's starting stock fits", () => {
    for (const p of [brena, pell, hale]) expect(slotsUsed(p.startingInventory), p.id).toBeLessThanOrEqual(npcSlots(p, createNpcState(p)));
    expect(() => parsePersona({ ...haleJson, storage: undefined, startingInventory: { cudgel: 13 } })).toThrow(/room for 12/);
  });

  it("a full pack can't take a purchase", () => {
    const c = ctxFor(brena, createNpcState(brena, { pendingOffer: { item: "dagger [E]", price: 150 } }));
    // 12 slots: fill them with gear.
    c.world.player.inventory = { "cudgel [F]": 12 };
    expect(acceptOffer(c)).toEqual({ ok: false, message: "Traveler has no room in their pack for the dagger [E]." });
    const offer = parseAction("offer_item", { item: "dagger [E]", price: "1 gold 5 silver" });
    if (!offer.ok) throw new Error(offer.error);
    expect(applyAction(offer, c).message).toBe("Traveler can't carry any more; their pack is full.");
    c.world.player.inventory = { "cudgel [F]": 11 };
    expect(acceptOffer({ ...c, state: createNpcState(brena, { pendingOffer: { item: "dagger [E]", price: 150 } }) }).ok).toBe(true);
  });

  it("a full shop can't buy from the player", () => {
    const state = createNpcState(brena, { inventory: { "cudgel [F]": 28 }, pendingPurchase: { item: "iron ore [F]", price: 30 } });
    const c = ctxFor(brena, state);
    expect(acceptPurchase(c)).toEqual({ ok: false, message: "You've no room left for the iron ore [F]." });
  });

  it("loot that doesn't fit is left behind", () => {
    const world = createTestWorld();
    world.player.inventory = { "cudgel [F]": 12 };
    const c = spawnCreature(wolf, "wolf-1", 1, () => 0.5, "wolf 1");
    c.hp = 1;
    const round = fightCreature(wolf, c, world, () => 0.7);
    expect(round.over).toBe("creature dead");
    expect(round.log).toContain("No room in your pack for: wolf pelt [E]. You leave it.");
    expect(world.player.inventory["wolf pelt [E]"]).toBeUndefined();
  });

  it("an NPC with no room doesn't start crafting", () => {
    // 28 slots, already full: even after using up the ore, nothing she makes would fit.
    const state = createNpcState(brena, { inventory: { "iron ore [F]": 4, "cudgel [F]": 28 } });
    const world = createTestWorld();
    world.hour = 9;
    passTime(brena, state, world, 3, () => 0.01);
    expect(state.job).toBeNull();
  });

  it("a quest hand-in waits until the giver has room", () => {
    const world = createTestWorld();
    const state = createNpcState(brena, { pendingQuest: "hot_meal", inventory: { "cudgel [F]": 28 } });
    acceptQuest(brena, state, world.player);
    world.player.inventory["stew [G]"] = 1;
    const r = turnInQuests(brena, state, world);
    expect(r.completed).toEqual([]);
    expect(r.message).toBe("You've no room to take the goods for A hot meal right now.");
    expect(world.player.inventory["stew [G]"]).toBe(1);
  });
});

describe("what NPCs buy goes back on sale", () => {
  it("at full value, unless it's a material for their work", () => {
    expect(npcPrice(pell, "rabbit pelt")).toBe(50); // he paid at most half
    expect(npcPrice(brena, "iron ore")).toBeUndefined();
    expect(notForSaleReason(brena, "iron ore [F]")).toBe("kept for their work");
    expect(notForSaleReason(pell, "wild herbs [F]")).toBe("kept for their work"); // he brews with them
    expect(notForSaleReason(pell, "rabbit pelt [F]")).toBeNull();
  });

  it("a pelt sold to Pell shows up in his wares", () => {
    const c = ctxFor(pell, createNpcState(pell, { pendingPurchase: { item: "rabbit pelt [F]", price: 16 } }));
    c.world.player.inventory["rabbit pelt [F]"] = 1;
    expect(acceptPurchase(c).ok).toBe(true);
    expect(c.state.inventory["rabbit pelt [F]"]).toBe(1);
    expect(npcPrice(pell, "rabbit pelt [F]")).toBe(50);
  });
});
