import { beforeEach, describe, expect, it } from "vitest";
import { config } from "../src/config.js";
import { npcFightTurn, playerAbility, playerAttack } from "../src/npc/actions.js";
import { createNpcState, npcSkills, statsOf } from "../src/npc/state.js";
import { traitsOf } from "../src/npc/traits.js";
import { chooseMove, combatStyle, abilitiesFor, ABILITIES } from "../src/game/abilities.js";
import { applyStatus, describeStatuses, guardedDamage, tickStatuses } from "../src/game/status.js";
import { lootBody } from "../src/game/loot.js";
import { startCraft, RECIPES, finishCraft } from "../src/game/crafting.js";
import { acceptQuest, turnInQuests } from "../src/game/quests.js";
import { ILLNESSES, injure, spreadIllness, healOvernight, skillPenalty } from "../src/game/health.js";
import { acceptHire, companionsStrike, MAX_UNPAID_DAYS, offerHire, payWages } from "../src/game/party.js";
import { passMinutes, passTime } from "../src/game/simulation.js";
import { considerRaid } from "../src/game/underworld.js";
import { loadCreatureTemplates, spawnCreature, type Creature } from "../src/game/creatures.js";
import { skillLevel } from "../src/npc/skills.js";
import { createTestWorld } from "../src/world/world.js";
import { always, brena, ctxFor, hale, makeTown, pell } from "./helpers.js";
import type { Rng } from "../src/game/dice.js";

beforeEach(() => {
  config.director = false;
  config.planning = false;
  config.summaries = false;
});

/** Dice that return these values in turn, then repeat the last. */
const seq = (...v: number[]): Rng => {
  let i = 0;
  return () => v[Math.min(i++, v.length - 1)]!;
};

describe("N8 combat styles", () => {
  it("come from traits: Brena aggressive, Hale and Pell cowardly, Rook-like steady fighters cautious", () => {
    expect(combatStyle(traitsOf(brena))).toBe("aggressive");
    expect(combatStyle(traitsOf(hale))).toBe("cowardly");
    expect(combatStyle(traitsOf(pell))).toBe("cowardly");
    expect(combatStyle({ temper: 0.3, bravery: 0.6 })).toBe("cautious");
  });

  it("done when: a cowardly NPC begs at 50% HP (with nothing to heal with)", () => {
    const world = createTestWorld();
    const ctx = ctxFor(hale, { inCombat: true, inventory: {} }, world, always(0.5));
    ctx.state.hp = Math.floor(statsOf(hale, ctx.state).maxHp / 2);
    const turn = npcFightTurn(ctx);
    expect(turn.name).toBe("beg");
    expect(turn.begged).toBe(true);
    expect(ctx.state.inCombat).toBe(false);
    expect(world.player.hp).toBe(40); // no blow
  });

  it("a cautious fighter raises a guard when hurt; an aggressive one swings its heaviest", () => {
    const skills = { blunt: 4, evasion: 2 };
    expect(chooseMove("cautious", skills, 10, { hpShare: 0.4, round: 2, canHeal: false, begged: false, foeWeakened: false })).toMatchObject({ kind: "ability", ability: { id: "second_wind" } });
    expect(chooseMove("cautious", { evasion: 1 }, 10, { hpShare: 0.4, round: 2, canHeal: false, begged: false, foeWeakened: false })).toMatchObject({ kind: "ability", ability: { id: "guard" } });
    expect(chooseMove("aggressive", skills, 10, { hpShare: 0.9, round: 1, canHeal: false, begged: false, foeWeakened: false })).toMatchObject({ kind: "attack", ability: { id: "heavy_blow" } });
    // Out of MP: a plain blow.
    expect(chooseMove("aggressive", skills, 0, { hpShare: 0.9, round: 1, canHeal: false, begged: false, foeWeakened: false })).toEqual({ kind: "attack" });
  });

  it("an aggressive NPC opens with a war cry only against someone who outranks them", () => {
    const skills = { intimidation: 2, blunt: 4 };
    expect(chooseMove("aggressive", skills, 10, { hpShare: 1, round: 0, canHeal: false, begged: false, foeWeakened: false, foeTougher: true })).toMatchObject({ ability: { id: "war_cry" } });
    expect(chooseMove("aggressive", skills, 10, { hpShare: 1, round: 0, canHeal: false, begged: false, foeWeakened: false })).toMatchObject({ kind: "attack" });
  });
});

describe("N8 MP abilities and statuses", () => {
  it("a heavy blow costs MP and hits harder", () => {
    const world = createTestWorld();
    const plain = ctxFor(brena, { inCombat: true }, world, seq(0.7, 0.5));
    const before = world.player.hp;
    npcFightTurn({ ...plain, state: { ...plain.state, mp: 0 } } as typeof plain);
    const plainDamage = before - world.player.hp;
    const w2 = createTestWorld();
    const heavy = ctxFor(brena, { inCombat: true }, w2, seq(0.7, 0.5));
    const mp = heavy.state.mp;
    npcFightTurn(heavy);
    expect(heavy.state.mp).toBe(mp - ABILITIES.heavy_blow.mp);
    expect(40 - w2.player.hp).toBe(plainDamage + ABILITIES.heavy_blow.damage!);
  });

  it("bleeding hurts each turn but never kills; a stun loses a turn; a guard halves one blow", () => {
    const who = { hp: 10, statuses: [] as Parameters<typeof applyStatus>[0]["statuses"] };
    applyStatus(who, "bleeding", 2, 4);
    applyStatus(who, "stunned", 1);
    const t = tickStatuses(who, "Brena", always(0.99));
    expect(t.skip).toBe(true);
    expect(who.hp).toBe(6);
    expect(describeStatuses(who)).toBe("bleeding");
    who.hp = 2;
    tickStatuses(who, "Brena", always(0.99));
    expect(who.hp).toBe(1);
    expect(describeStatuses(who)).toBeNull();
    applyStatus(who, "guarding", 1);
    expect(guardedDamage(who, 9)).toBe(4);
    expect(guardedDamage(who, 9)).toBe(9); // spent
  });

  it("the player knows abilities from their skills, and a war cry can weaken the foe", () => {
    const world = createTestWorld();
    world.player.skills.intimidation = 2;
    expect(abilitiesFor(world.player.skills).map((a) => a.id)).toContain("war_cry");
    const ctx = ctxFor(brena, { inCombat: true }, world, always(0.1));
    const r = playerAbility("war_cry", ctx);
    expect(r.ok).toBe(true);
    expect(world.player.mp).toBe(10 - 3);
    expect(describeStatuses(ctx.state)).toBe("weakened");
  });
});

describe("N8 subdue and loot", () => {
  it("done when: subduing leaves an NPC alive with lootable stock, and it's a crime if seen", () => {
    const world = createTestWorld();
    const ctx = ctxFor(pell, {}, world, always(0.99));
    ctx.state.hp = 2;
    const r = playerAttack(ctx, { subdue: true });
    expect(r.subdued).toBe(true);
    expect(ctx.state.outcome).toBe("unconscious");
    expect(ctx.state.deathCause).toBeNull();
    const loot = lootBody(pell, ctx.state, world, ["hale"]);
    expect(loot.ok).toBe(true);
    expect(world.player.inventory["ale [G]"]).toBeGreaterThan(0);
    expect(loot.event!.kind).toBe("looted");
    expect(loot.event!.witnesses).toEqual(["hale"]);
  });

  it("the knocked-out come round hours later, with a grudge and a mind for revenge", () => {
    const world = createTestWorld();
    const ctx = ctxFor(pell, {}, world, always(0.99));
    ctx.state.hp = 2;
    playerAttack(ctx, { subdue: true });
    passMinutes(pell, ctx.state, world, 5 * 60, always(0.99));
    expect(ctx.state.outcome).toBeNull();
    expect(ctx.state.hp).toBeGreaterThan(0);
    expect(ctx.state.grudge?.reason).toMatch(/senseless/);
    expect(ctx.state.goals[0]?.kind).toBe("revenge");
  });
});

describe("N8.1 lasting injuries and illness", () => {
  it("done when: Brena's burned hand makes her work worse until the herbs come, then it improves", () => {
    const burned = createNpcState(brena, { inventory: { "iron ore [F]": 8 } });
    expect(skillLevel(npcSkills(brena, burned), "smithing")).toBe(3);
    const sword = RECIPES.find((r) => r.id === "iron_sword")!;
    const worse = startCraft(brena, burned, sword, 0, always(0.7)); // d20 15: 15 + 6 = 21 → +1 tier
    finishCraft(burned, 1000);
    // Bring the herbs: the poultice quest cures the burn.
    const world = createTestWorld();
    world.player.level = 2;
    burned.relationship = 20;
    burned.pendingQuest = "burn_poultice";
    acceptQuest(brena, burned, world.player, world);
    world.player.inventory["wild herbs [F]"] = 3;
    turnInQuests(brena, burned, world);
    expect(burned.injuries).toEqual([]);
    expect(skillLevel(npcSkills(brena, burned), "smithing")).toBe(5);
    const better = startCraft(brena, burned, sword, 0, always(0.7)); // 15 + 10 = 25 → +2 tiers
    expect(worse.output).toBe("iron sword [C]");
    expect(better.output).toBe("iron sword [B]");
  });

  it("injuries heal a day at a time, twice as fast when tended", () => {
    const who = { injuries: [] as Parameters<typeof injure>[0]["injuries"] };
    injure(who, "sprained_ankle", 1);
    expect(skillPenalty(who, "evasion")).toBe(-1);
    healOvernight(who);
    who.injuries![0]!.cared = true;
    expect(healOvernight(who)).toEqual(["a sprained ankle"]);
    expect(who.injuries).toEqual([]);
  });

  it("illness spreads to those who share a place at its set rate", () => {
    let caught = 0;
    const trials = 2000;
    let seed = 7;
    const rng: Rng = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < trials; i++) {
      const sick = { name: "Pell", who: { illness: { id: "fever" as const, day: 1, daysLeft: 4 } } };
      const well = { name: "Brena", who: { illness: null } };
      caught += spreadIllness([sick, well], 1, rng).length;
    }
    expect(caught / trials).toBeGreaterThan(ILLNESSES.fever.spread - 0.02);
    expect(caught / trials).toBeLessThan(ILLNESSES.fever.spread + 0.02);
  });

  it("a sufferer posts a quest for the cure", () => {
    const s = createNpcState(hale);
    injure(s, "deep_cut", 1);
    const world = createTestWorld();
    passTime(hale, s, world, 1, always(0.99));
    expect(s.questBoard.some((q) => q.cures === "deep_cut")).toBe(true);
  });
});

describe("N8.2 companions", () => {
  it("done when: Hale comes for 10 silver a day, helps in a fight, and walks off after two unpaid days", () => {
    const world = createTestWorld();
    const s = createNpcState(hale, { relationship: 40 });
    expect(offerHire(hale, s, world).ok).toBe(true);
    expect(s.pendingHire!.wage).toBe(Math.round(100 * (1 + 0.5 * 0.6 * 0.6)));
    world.player.money = 1000;
    expect(acceptHire(hale, s, world).ok).toBe(true);
    expect(s.companion).not.toBeNull();
    // He fights: a wolf takes his blows.
    const wolfT = loadCreatureTemplates().wolf!;
    const wolf: Creature = spawnCreature(wolfT, "wolf-1", 1, always(0.5));
    const hp = wolf.hp;
    const lines = companionsStrike([{ persona: hale, state: s }], { name: "wolf 1", hp: () => wolf.hp, setHp: (h) => (wolf.hp = h), agility: 10, evasion: 0, holder: wolf, spare: false }, always(0.99));
    expect(lines[0]).toMatch(/Corporal Hale hits wolf 1/);
    expect(wolf.hp).toBeLessThan(hp);
    // Two midnights with no money: he goes.
    world.player.money = 0;
    const members = [{ id: "hale", persona: hale, state: s }];
    payWages(members, world);
    expect(s.companion).not.toBeNull();
    const out = payWages(members, world);
    expect(MAX_UNPAID_DAYS).toBe(2);
    expect(s.companion).toBeNull();
    expect(out.join(" ")).toMatch(/walks off/);
  });

  it("follows the player between places", () => {
    const town = makeTown();
    const h = town.agents.hale!.state;
    h.companion = { hiredDay: 1, wage: 100, loyalty: 50, unpaidDays: 0, lastPaidDay: 1 };
    town.world.player.place = "inn";
    town.world.hour = 10;
    expect(town.placeOf("hale")).toBe("inn");
    town.world.player.place = "forge";
    expect(town.placeOf("hale")).toBe("forge");
  });
});

describe("N8 raids in the player's sight", () => {
  it("a raid on the shop where the player is becomes a fight they're in", () => {
    const templates = loadCreatureTemplates();
    const creatures: Record<string, Creature> = {};
    for (let i = 1; i <= 4; i++) creatures[`bandit-${i}`] = spawnCreature(templates.bandit!, `bandit-${i}`, 1, always(0.5));
    const world = { ...createTestWorld(), events: [] as never[] };
    world.player.place = "inn";
    world.player.attributes.strength = 20;
    const p = createNpcState(pell);
    p.money = 100_000; // the richest shop
    const village = [{ id: "pell", persona: pell, state: p }];
    let raided = false;
    for (let i = 0; i < 40 && !raided; i++) {
      const r = considerRaid(templates, creatures, village, world, seq(0.01, 0.01, 0.6, 0.4, 0.7, 0.3));
      raided = r.raid !== null;
      if (raided) expect(r.log.join(" ")).toMatch(/Traveler|too many/);
    }
    expect(raided).toBe(true);
  });
});
