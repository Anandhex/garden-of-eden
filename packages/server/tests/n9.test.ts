import { beforeEach, describe, expect, it } from "vitest";
import { config } from "../src/config.js";
import { createNpcState, npcSkills, statsOf } from "../src/npc/state.js";
import { traitsOf } from "../src/npc/traits.js";
import { skillLevel } from "../src/npc/skills.js";
import {
  acceptQuest,
  checkEscorts,
  deliverMessages,
  describeObjective,
  failOverdueQuests,
  questOfferError,
  questProgress,
  questsFor,
  recordNpcDefeat,
  turnInQuests,
} from "../src/game/quests.js";
import { forage, playerCraft } from "../src/game/gathering.js";
import { generateQuestFlavor } from "../src/director/flavor.js";
import { addSkillXp, driftTrait, growthEvent, playerUsesSkill, raiseAttribute, skillTrial, skillXpNeeded, TRAIT_LIFETIME_CAP, TRAIT_WEEK_CAP } from "../src/npc/growth.js";
import { advanceArcs, arcStage, describeArcs } from "../src/npc/arcs.js";
import { playerGainXp } from "../src/game/levels.js";
import { advanceMinutes } from "../src/game/clock.js";
import { createTestWorld } from "../src/world/world.js";
import { registerNpcNames } from "../src/world/names.js";
import { always, brena, FakeProvider, hale, pell, rook, say } from "./helpers.js";
import type { QuestDef } from "../src/npc/types.js";

beforeEach(() => {
  config.director = false;
  registerNpcNames({ brena: "Brena Ashford", pell: "Old Pell", hale: "Corporal Hale", rook: "Rook" });
});

const take = (persona: typeof brena, id: string, world = createTestWorld(), trust = 60) => {
  const s = createNpcState(persona, { relationship: trust, respect: 40 });
  s.pendingQuest = id;
  const q = acceptQuest(persona, s, world.player, world, (who) => (who === "horse" ? "horse-1" : null));
  return { s, q: q!, world };
};

describe("N9 quest goals, one checker each", () => {
  it("talk_to: carrying Brena's word to Hale counts when you talk to him", () => {
    const world = createTestWorld();
    world.player.level = 2;
    const { s, q } = take(brena, "hammer_whereabouts", world);
    expect(describeObjective(q)).toBe('take word to Old Pell: "Brena wants to know who has her father\'s forge hammer."');
    expect(questProgress(world.player, q).done).toBe(false);
    expect(deliverMessages(world.player, hale, world)).toEqual([]);
    expect(deliverMessages(world.player, pell, world)[0]).toMatch(/brings word from Brena Ashford/);
    expect(turnInQuests(brena, s, world).completed.map((x) => x.id)).toEqual(["hammer_whereabouts"]);
  });

  it("defeat_npc: beating Rook counts", () => {
    const world = createTestWorld();
    world.player.level = 7;
    world.player.quests.completed.push("hammer_whereabouts");
    const { q } = take(brena, "hammer_rook", world);
    expect(recordNpcDefeat(world.player, "rook")[0]).toMatch(/1\/1/);
    expect(questProgress(world.player, q).done).toBe(true);
  });

  it("gather: herbs you pick yourself at the gate count; bought ones don't", () => {
    const world = createTestWorld();
    const { s, q } = take(pell, "meadow_herbs", world, 10);
    world.player.inventory["wild herbs [F]"] = 2; // bought, not gathered
    expect(questProgress(world.player, q).done).toBe(false);
    world.player.place = "square";
    world.player.place = "gate";
    for (let i = 0; i < 3; i++) forage(world.player, always(0.95), 1);
    expect(q.progress).toBe(3);
    expect(questProgress(world.player, q).done).toBe(true);
    expect(turnInQuests(pell, s, world).completed).toHaveLength(1);
  });

  it("craft: a dagger of tier E or better made by your own hand, at the forge", () => {
    const world = createTestWorld();
    world.player.level = 2;
    world.player.skills.smithing = 2;
    world.player.inventory["iron ore [F]"] = 4;
    const { s, q } = take(brena, "apprentice_work", world);
    world.player.place = "inn";
    expect(playerCraft(world.player, "dagger", always(0.5)).message).toMatch(/forge/);
    world.player.place = "forge";
    const made = playerCraft(world.player, "dagger", always(0.5));
    expect(made.ok).toBe(true);
    expect(made.hours).toBe(2);
    expect(q.progress).toBe(1);
    expect(turnInQuests(brena, s, world).completed).toHaveLength(1);
  });

  it("escort: bring the horse to the gate, alive, in time", () => {
    const world = createTestWorld();
    world.player.level = 2;
    const { q } = take(pell, "horse_to_gate", world, 10);
    expect(q.escortee).toBe("horse-1");
    expect(q.due).toBe((world.day - 1) * 1440 + world.hour * 60 + 6 * 60);
    world.player.place = "inn";
    expect(checkEscorts(world.player, () => true)).toEqual([]);
    world.player.place = "gate";
    expect(checkEscorts(world.player, () => false)).toEqual([]);
    expect(checkEscorts(world.player, (who) => who === "horse-1")[0]).toMatch(/Done/);
  });
});

describe("N9 chains, deadlines and failure", () => {
  it("done when: the hammer is a 3-step chain, and a level 1 player can't skip ahead", () => {
    const world = createTestWorld();
    const s = createNpcState(brena, { relationship: 60, respect: 40 });
    const ids = () => questsFor(brena, s, world.player).tooHard.map((q) => q.id).concat(questsFor(brena, s, world.player).available.map((q) => q.id));
    expect(ids()).toContain("hammer_whereabouts");
    expect(ids()).not.toContain("hammer_rook");
    expect(questOfferError(brena, s, world.player, "fathers_hammer")).toMatch(/haven't done hammer_rook/);
    world.player.quests.completed.push("hammer_whereabouts");
    expect(ids()).toContain("hammer_rook");
    expect(ids()).not.toContain("fathers_hammer");
    world.player.quests.completed.push("hammer_rook");
    expect(ids()).toContain("fathers_hammer");
  });

  it("a missed deadline fails the quest once, costing trust and respect", () => {
    const world = createTestWorld();
    world.player.level = 2;
    const { s, q } = take(pell, "horse_to_gate", world, 10);
    const before = { trust: s.relationship, respect: s.respect };
    advanceMinutes(world, 5 * 60);
    expect(failOverdueQuests(world.player, { pell: { persona: pell, state: s } }, world)).toEqual([]);
    advanceMinutes(world, 2 * 60);
    expect(failOverdueQuests(world.player, { pell: { persona: pell, state: s } }, world)[0]).toMatch(/ran out of time/);
    expect(world.player.quests.active).not.toContain(q);
    expect(world.player.quests.failed).toContain("horse_to_gate");
    expect(s.relationship).toBe(before.trust - 10);
    expect(s.respect).toBe(before.respect - 5);
    expect(failOverdueQuests(world.player, { pell: { persona: pell, state: s } }, world)).toEqual([]);
    s.relationship = 50;
    expect(questOfferError(pell, s, world.player, "horse_to_gate")).toMatch(/failed/);
  });

  it("higher-rank NPCs post higher-tier work: the cap is a rank above their own", () => {
    const s = createNpcState(hale);
    expect(questsFor(hale, s, { ...createTestWorld().player, level: 5 }).tooHard.concat(questsFor(hale, { ...s, relationship: 10 }, { ...createTestWorld().player, level: 5 }).available).length).toBeGreaterThan(0);
    const low = createNpcState(brena, { relationship: 60, respect: 40 });
    low.life.tier = "D";
    const world = createTestWorld();
    world.player.level = 10;
    world.player.quests.completed.push("hammer_whereabouts", "hammer_rook");
    // Fathers_hammer is B; a D-rank Brena only gives up to C.
    expect(questOfferError(brena, low, world.player, "fathers_hammer")).toMatch(/beyond/);
  });
});

describe("N9 quest flavour: the model writes words, code keeps the structure", () => {
  const quest: QuestDef = { id: "need_brena_iron_ore", title: "Iron ore wanted", description: "You're short of iron ore.", tier: "E", minTrust: 0, objective: { type: "deliver", item: "iron ore", qty: 8 }, reward: { money: 720 } };

  it("uses a checked structured reply", async () => {
    const llm = new FakeProvider([say('{"title":"Ore for the forge","reason":"The mine road is shut and my anvil is idle."}')]);
    expect(await generateQuestFlavor(llm, brena, quest)).toEqual({ title: "Ore for the forge", description: "The mine road is shut and my anvil is idle." });
  });

  it("falls back to the template on bad JSON, or on names nobody knows", async () => {
    expect(await generateQuestFlavor(new FakeProvider([say("sure!"), say("{oops")]), brena, quest)).toBeNull();
    const invented = new FakeProvider([say('{"title":"Ore for Lord Varkis","reason":"Lord Varkis wants a blade by spring, and I need ore."}')]);
    expect(await generateQuestFlavor(invented, brena, quest)).toBeNull();
  });
});

describe("N9 growth: skills, attributes, traits", () => {
  it("routine work fills a skill's XP; only a trial crosses the tier", () => {
    const s = createNpcState(hale);
    expect(skillTrial(hale, s, "one_handed", true, 1)).toBeNull(); // not ready
    addSkillXp(hale, s, "one_handed", skillXpNeeded(2) + 50); // capped at what's needed
    expect(s.growth.skillXp.one_handed).toBe(skillXpNeeded(2));
    expect(skillTrial(hale, s, "one_handed", false, 1)).toBeNull(); // routine isn't a trial
    expect(skillTrial(hale, s, "one_handed", true, 1)).toMatch(/adept/);
    expect(skillLevel(npcSkills(hale, s), "one_handed")).toBe(3);
  });

  it("Hale's challenge (two fights won) readies one-handed; the save keeps the tier", () => {
    const s = createNpcState(hale);
    growthEvent(hale, s, { kind: "win_fight" }, 1);
    expect(s.growth.skillXp.one_handed ?? 0).toBe(0);
    expect(growthEvent(hale, s, { kind: "win_fight" }, 2).join(" ")).toMatch(/met a challenge/);
    skillTrial(hale, s, "one_handed", true, 2);
    const loaded = createNpcState(hale, JSON.parse(JSON.stringify(s)));
    expect(skillLevel(npcSkills(hale, loaded), "one_handed")).toBe(3);
  });

  it("Brena, already a master smith, gets a strength milestone for five fine blades instead", () => {
    const s = createNpcState(brena);
    const str = statsOf(brena, s).attributes.strength;
    for (let i = 0; i < 4; i++) growthEvent(brena, s, { kind: "craft", tier: "C" }, 1);
    growthEvent(brena, s, { kind: "craft", tier: "D" }, 1); // not fine enough
    expect(statsOf(brena, s).attributes.strength).toBe(str);
    growthEvent(brena, s, { kind: "craft", tier: "B" }, 1);
    expect(statsOf(brena, s).attributes.strength).toBe(str + 1);
  });

  it("done when: a cowardly NPC who survives a fight gets braver, but not past the weekly cap", () => {
    const s = createNpcState(hale);
    const start = traitsOf(hale, s).bravery;
    growthEvent(hale, s, { kind: "survive_fight" }, 1);
    expect(traitsOf(hale, s).bravery).toBeCloseTo(start + 0.05);
    for (let i = 0; i < 5; i++) growthEvent(hale, s, { kind: "survive_fight" }, 2);
    expect(traitsOf(hale, s).bravery).toBeCloseTo(start + TRAIT_WEEK_CAP);
    // A new week: it can move again, up to the lifetime cap.
    for (let d = 8; d < 400; d++) growthEvent(hale, s, { kind: "survive_fight" }, d);
    expect(traitsOf(hale, s).bravery).toBeCloseTo(start + TRAIT_LIFETIME_CAP);
  });

  it("traits never leave 0..1, and each event moves them at most 0.05", () => {
    const s = createNpcState(rook);
    expect(driftTrait(rook, s, "honesty", -1, "test", 1)).toBeCloseTo(-0.05);
    for (let d = 1; d < 200; d++) driftTrait(rook, s, "forgiveness", -0.05, "test", d * 7);
    expect(traitsOf(rook, s).forgiveness).toBeGreaterThanOrEqual(0);
  });

  it("player: levels give attribute points to spend; skills rise by hard use", () => {
    const world = createTestWorld();
    const p = world.player;
    expect(playerGainXp(p, 50)).toBe(1);
    expect(p.attributePoints).toBe(1);
    expect(raiseAttribute(p, "endurance").ok).toBe(true);
    expect(p.attributes.endurance).toBe(12);
    expect(p.maxHp).toBe(43);
    expect(raiseAttribute(p, "strength").ok).toBe(false);
    p.skills.sneak = 1;
    for (let i = 0; i < 20; i++) expect(playerUsesSkill(p, "sneak", false)).toBeNull();
    expect(playerUsesSkill(p, "sneak", true)).toMatch(/apprentice/);
  });
});

describe("N9.1 personal goal arcs", () => {
  it("done when: passing on Pell's clue moves Brena from no news to heard a rumour, once", () => {
    const world = createTestWorld();
    const s = createNpcState(brena);
    const tomas = brena.arcs![0]!;
    expect(describeArcs(brena, s)[0]).toMatch(/no word of your brother/);
    // Talking about Tomas without the clue changes nothing.
    expect(advanceArcs(brena, s, world, "Any news of Tomas?")).toEqual([]);
    (world.player.facts ??= []).push("lore:people.tomas.sighting");
    expect(advanceArcs(brena, s, world, "Good weather today.")).toEqual([]);
    const lines = advanceArcs(brena, s, world, "Tomas was seen in the city, drinking with a hooded stranger.");
    expect(lines[0]).toMatch(/Tomas was seen drinking in the city/);
    expect(arcStage(s, tomas)).toBe(1);
    expect(advanceArcs(brena, s, world, "Tomas was seen in the city.")).toEqual([]); // once
    // The stage opened a quest: ask Hale at the gate.
    const visible = questsFor(brena, { ...s, relationship: 20 }, world.player).available.map((q) => q.id);
    expect(visible).toContain("ask_at_the_gate");
  });

  it("the next stage needs that quest done; the last needs what Rook hides", () => {
    const world = createTestWorld();
    const s = createNpcState(brena, { arcs: { tomas: { stage: 1, day: 1 } } });
    expect(advanceArcs(brena, s, world)).toEqual([]);
    world.player.quests.completed.push("ask_at_the_gate");
    expect(advanceArcs(brena, s, world)).toHaveLength(1);
    (world.player.facts ??= []).push("rook.vault_job");
    expect(advanceArcs(brena, s, world, "The hooded stranger was one of Rook's men.")).toHaveLength(1);
    expect(arcStage(s, brena.arcs![0]!)).toBe(3);
    expect(world.player.journal!.some((e) => /Rook's man/.test(e.text))).toBe(true);
  });
});

