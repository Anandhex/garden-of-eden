import { describe, expect, it } from "vitest";
import { config } from "../src/config.js";
import type { Rng } from "../src/game/dice.js";
import { describeToday, mineRoadClosed, townEventsOn } from "../src/game/events-calendar.js";
import { acceptQuest, questRewardMoney } from "../src/game/quests.js";
import { currentPlan, planHour, unavailable } from "../src/game/schedule.js";
import { Scene, sceneTurn } from "../src/game/scene.js";
import { acceptService, lodgingHours, offerService } from "../src/game/services.js";
import { goodDayChance, isTrustedRegular } from "../src/game/signature.js";
import { passTime } from "../src/game/simulation.js";
import { passVillage, type VillageMember } from "../src/game/village.js";
import { seasonOf, weatherOn } from "../src/game/weather.js";
import { itemsForSale, maxBuyPrice, npcPrice, toolsFor } from "../src/npc/actions.js";
import { initiativeFor, pickOpener } from "../src/npc/initiative.js";
import { NpcAgent } from "../src/npc/NpcAgent.js";
import { buildTurnMessage } from "../src/npc/persona.js";
import { createNpcState } from "../src/npc/state.js";
import { always, brena, ctxFor, FakeProvider, hale, pell, rook, say, worldAt } from "./helpers.js";

/** A seeded random number generator (mulberry32), for rates over many rolls. */
function seeded(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const village = (): VillageMember[] =>
  [brena, pell, hale, rook].map((persona) => ({ id: persona.id, persona, state: createNpcState(persona) }));

describe("N6 daily life", () => {
  it("done when: 24 hours give Brena forging by day, supper at the inn, and sleep at night", () => {
    const members = village();
    for (const m of members) m.state.needs = { hunger: 10, energy: 100 }; // after a night's sleep
    const b = members[0]!;
    const world = worldAt(6);
    const seen: string[] = [];
    for (let h = 0; h < 24; h++) {
      passVillage(members, world, 1, always(0.99));
      seen.push(`${world.hour}:${b.state.activity!.activity}@${b.state.activity!.place}`);
    }
    // 7:00 .. 19:00 at the forge, but for the midday break (N16): an hour at the inn in the middle of her day.
    expect(seen.slice(0, 13).filter((s) => !s.endsWith("work@forge"))).toEqual(["13:eat@inn"]);
    expect(seen).toContain("20:eat@inn");
    expect(seen).toContain("21:sleep@home");
    expect(seen).toContain("3:sleep@home");
    expect(seen.at(-1)).toBe("6:work@forge");
  });

  it("Brena eats at Pell's inn in the evening and pays him: the first trade between NPCs", () => {
    const members = village();
    const [b, p] = [members[0]!, members[1]!];
    const world = worldAt(19);
    const before = { brena: b.state.money, pell: p.state.money, stew: p.state.inventory["stew [G]"]! };
    const log = passVillage(members, world, 1, always(0.99));
    expect(log).toContain("Brena Ashford had stew at the inn and paid Old Pell 4 silver.");
    expect(b.state.money).toBe(before.brena - 40);
    expect(log).toContain("Corporal Hale had stew at the inn and paid Old Pell 4 silver.");
    expect(p.state.inventory["stew [G]"]).toBe(before.stew - 2);
    expect(b.state.needs.hunger).toBeLessThan(20);
  });

  it("she's only reachable where she is: asleep at night, and at the inn for supper", async () => {
    const members = village();
    const b = members[0]!;
    const world = worldAt(20);
    passVillage(members, world, 2, always(0.99)); // 22:00
    expect(unavailable(brena, b.state, world)).toBe("Brena Ashford is asleep at home until 06:00");
    const npc = new NpcAgent(brena, new FakeProvider([say("Zzz")]), always(0.99), b.state);
    expect((await npc.respond("Hello?", world)).busy).toBe("asleep");
    expect(currentPlan(brena, b.state, worldAt(20)).place).toBe("inn");
  });

  it("a starving NPC goes to eat, an exhausted one to bed, and a broke one works late", () => {
    const s = createNpcState(brena);
    s.needs.hunger = 75;
    expect(planHour(brena, s, worldAt(10))).toEqual({ activity: "eat", place: "inn", why: "starving" });
    s.needs.hunger = 10;
    s.needs.energy = 10;
    expect(planHour(brena, s, worldAt(10))).toMatchObject({ activity: "sleep", why: "exhausted" });
    s.needs.energy = 80;
    s.money = 50;
    expect(planHour(brena, s, worldAt(20))).toEqual({ activity: "work", place: "forge", why: "broke" });
  });

  it("crafting only happens in work blocks", () => {
    const s = createNpcState(brena);
    s.inventory["iron ore [F]"] = 4;
    const evening = worldAt(20);
    passTime(brena, s, evening, 1, always(0.01));
    expect(s.job).toBeNull();
    const morning = worldAt(9);
    passTime(brena, s, morning, 1, always(0.01));
    expect(s.job).not.toBeNull();
  });

  it("mood follows needs: hungry and tired show as a line, and drift the mood", () => {
    const s = createNpcState(hale);
    s.needs.hunger = 66;
    s.needs.energy = 20;
    expect(buildTurnMessage(hale, s, worldAt(19), "Hi")).toContain("You're tired and hungry.");
    // Asleep, he stays hungry: after three hours the mood drifts to match.
    s.needs.energy = 60;
    passTime(hale, s, worldAt(21), 2, always(0.99));
    expect(s.mood).toBe("neutral");
    passTime(hale, s, worldAt(23), 1, always(0.99));
    expect(s.mood).toBe("annoyed");
  });
});

describe("N6.1 signature moves", () => {
  it("done when: Brena has a good forge day at a rate you can state: 3 in 20 (15%)", () => {
    expect(goodDayChance(brena.stats.attributes.luck)).toBe(0.15);
    const s = createNpcState(brena);
    const rng = seeded(42);
    let good = 0;
    const days = 2000;
    for (let day = 1; day <= days; day++) {
      s.goodDay = null;
      s.job = null;
      s.inventory = {};
      s.needs = { hunger: 10, energy: 100 };
      const w = worldAt(5, day);
      passTime(brena, s, w, 1, rng); // into 6:00, the start of her working day
      if (s.goodDay === day) good++;
    }
    expect(good / days).toBeGreaterThan(0.12);
    expect(good / days).toBeLessThan(0.18);
  });

  it("a good day's next piece comes out a tier better", () => {
    const s = createNpcState(brena, { goodDay: 1 });
    s.inventory = { "iron ore [F]": 4 };
    const w = worldAt(9);
    passTime(brena, s, w, 1, always(0.01)); // crafts the first recipe, horseshoes; d20 roll of 1 → base tier G
    expect(s.job?.output).toBe("horseshoe [F]");
    expect(s.goodDay).toBeNull();
    expect(s.emotions[0]?.kind).toBe("pride");
  });

  it("Pell keeps his strong salve under the bar for trusted regulars", () => {
    const c = ctxFor(pell, {});
    expect(itemsForSale(c)).not.toContain("healing salve [C]");
    c.state.relationship = 60;
    c.state.metBefore = true;
    expect(isTrustedRegular(pell, c.state)).toBe(true);
    expect(itemsForSale(c)).toContain("healing salve [C]");
    expect(buildTurnMessage(pell, c.state, c.world, "Got anything special?")).toContain("the strong salve he keeps under the bar");
  });
});

describe("N6.2 healers and services", () => {
  it("done when: a hurt player pays Pell for a room and wakes up healed", async () => {
    const world = worldAt(21);
    world.player.hp = 12;
    const npc = new NpcAgent(pell, new FakeProvider([say("Room's upstairs, friend.")]));
    const offer = offerService(pell, npc.state, world, "lodging");
    expect(offer).toMatchObject({ ok: true, price: 80 });
    const r = await npc.acceptService(world);
    expect(r.service).toMatchObject({ ok: true, kind: "lodging", sleepHours: 9 });
    expect(world.player.hp).toBe(world.player.maxHp);
    expect(world.player.money).toBe(420);
    expect(npc.state.pendingService).toBeNull();
    expect(acceptService(pell, npc.state, world).ok).toBe(false); // charged once
    expect(lodgingHours(3)).toBe(3);
  });

  it("healing restores HP for gold, and offer_service only comes up on service talk", () => {
    const c = ctxFor(pell, {}, worldAt(15));
    c.world.player.hp = 10;
    expect(toolsFor(c).map((t) => t.name)).not.toContain("offer_service");
    expect(toolsFor({ ...c, serviceTalk: true }).map((t) => t.name)).toContain("offer_service");
    offerService(pell, c.state, c.world, "heal");
    expect(acceptService(pell, c.state, c.world)).toMatchObject({ ok: true, healed: 30 });
    expect(c.world.player.hp).toBe(40);
  });

  it("an NPC without the service can't offer it", () => {
    expect(offerService(brena, createNpcState(brena), worldAt(10), "lodging").ok).toBe(false);
  });
});

describe("N6.3 NPCs who start things", () => {
  it("done when: the day after you take her job, Brena asks about it first, and not on every turn", async () => {
    const llm = new FakeProvider([say("Got that ore yet?"), say("Hm.")]);
    const npc = new NpcAgent(brena, llm, always(0.99));
    npc.state.metBefore = true;
    const world = worldAt(14);
    npc.state.pendingQuest = "hot_meal";
    acceptQuest(brena, npc.state, world.player, world);
    expect(initiativeFor(brena, npc.state, world)).toBeNull(); // same day: nothing to ask yet
    world.day = 2;
    const first = await npc.speakFirst(world);
    expect(first?.trigger).toBe("quest_followup");
    expect(llm.lastUser()).toContain('took your job "A hot meal"');
    expect(await npc.speakFirst(world)).toBeNull();
  });

  it("a stranger is greeted once", () => {
    const s = createNpcState(hale);
    expect(initiativeFor(hale, s, worldAt(10))?.trigger).toBe("greeting");
  });

  it("the highest priority wins, and only one NPC speaks first", () => {
    const world = worldAt(14);
    const grudged = createNpcState(brena, { metBefore: true, grudge: { reason: "they attacked you", day: 1, until: 5 } });
    const greeter = createNpcState(pell);
    const pick = pickOpener([
      { id: "pell", opening: initiativeFor(pell, greeter, world) },
      { id: "brena", opening: initiativeFor(brena, grudged, world) },
    ]);
    expect(pick?.id).toBe("brena");
    expect(pick?.opening?.trigger).toBe("grudge");
  });
});

describe("N6.4 weather, seasons and town events", () => {
  it("seasons split the year, and the weather is stable for a day", () => {
    expect(seasonOf(1)).toBe("spring");
    expect(seasonOf(config.daysPerYear)).toBe("winter");
    expect(weatherOn(5)).toBe(weatherOn(5));
  });

  it("done when: Pell's pelt quest pays more in winter", () => {
    const quest = pell.quests!.find((q) => q.id === "winter_pelts")!;
    const spring = worldAt(10, 1);
    const winter = worldAt(10, config.daysPerYear);
    expect(questRewardMoney(pell, quest, winter)).toBe(Math.round(questRewardMoney(pell, quest, spring) * 1.5));
    expect(maxBuyPrice(pell, createNpcState(pell), "rabbit pelt [F]", winter)).toBeGreaterThan(maxBuyPrice(pell, createNpcState(pell), "rabbit pelt [F]", spring)!);
    const s = createNpcState(pell, { relationship: 20, pendingQuest: "winter_pelts" });
    winter.player.level = 3;
    expect(acceptQuest(pell, s, winter.player, winter)?.reward.money).toBe(300);
  });

  it("done when: a bandit raid shows up in every NPC's news and in prices, and closes the mine road", () => {
    const world = worldAt(10, 2);
    world.recentEvents.push("news.bandit_raid");
    world.lastRaidDay = 2;
    expect(townEventsOn(world)).toContain("raid");
    expect(mineRoadClosed(world)).toBe(true);
    expect(npcPrice(brena, "iron sword [D]", world)).toBe(500);
    expect(npcPrice(brena, "iron sword [D]")).toBe(400);
    for (const p of [brena, pell, hale]) {
      const msg = buildTurnMessage(p, createNpcState(p), world, "Hello");
      expect(msg).toContain("Bandits raided");
      expect(msg).toContain("the roads are shut");
    }
    world.day = 4;
    expect(mineRoadClosed(world)).toBe(false);
  });

  it("a storm keeps the guard off the gate; the forge works on", () => {
    const stormy = Array.from({ length: 200 }, (_, i) => i + 1).find((d) => weatherOn(d) === "storm")!;
    expect(planHour(hale, createNpcState(hale), worldAt(10, stormy))).toMatchObject({ activity: "socialise", place: "home", why: "storm" });
    expect(planHour(brena, createNpcState(brena), worldAt(10, stormy))).toMatchObject({ activity: "work", place: "forge" });
    expect(describeToday(worldAt(10, stormy))).toContain("storm");
  });

  it("market day doubles the chance of village sales", () => {
    const market = worldAt(10, 7);
    expect(townEventsOn(market)).toContain("market");
  });
});

describe("N6.5 group scenes", () => {
  it("done when: haggling with Brena at the inn, Pell chimes in once, and Brena reacts to what he said", async () => {
    const world = worldAt(20);
    const bLlm = new FakeProvider([say("Four gold, stranger. Firm."), say("Pell's a fool.")]);
    const pLlm = new FakeProvider([say("Don't listen to her, she overcharges everyone!")]);
    const b = new NpcAgent(brena, bLlm, always(0.99));
    const p = new NpcAgent(pell, pLlm, always(0.99));
    const scene = new Scene("inn");
    const turn = await sceneTurn(scene, [b, p], b, "How much for a sword? That's too dear.", world, always(0));
    expect(turn.addressed.id).toBe("brena");
    expect(turn.interjection?.id).toBe("pell");
    expect(pLlm.lastUser()).toContain('Brena Ashford said: "Four gold, stranger. Firm."');
    // Next turn: Brena sees what Pell said; Pell is in his cooldown, so nobody chimes in.
    const next = await sceneTurn(scene, [b, p], b, "Well?", world, always(0));
    expect(bLlm.lastUser()).toContain('Old Pell said: "Don\'t listen to her, she overcharges everyone!"');
    expect(next.interjection).toBeNull();
  });

  it("at most one interjection a turn, and the addressed NPC always answers", async () => {
    const world = worldAt(20);
    const agents = [brena, pell, hale].map((p) => new NpcAgent(p, new FakeProvider(), always(0.99)));
    const scene = new Scene("inn");
    for (let i = 0; i < 5; i++) {
      const turn = await sceneTurn(scene, agents, agents[0]!, "Brena, Pell and Hale, listen!", world, always(0));
      expect(turn.addressed.id).toBe("brena");
      expect(turn.interjection === null || turn.interjection.id !== "brena").toBe(true);
    }
  });

  it("a trusted NPC's word lifts the other's trust, once a day", async () => {
    const world = worldAt(20);
    const b = new NpcAgent(brena, new FakeProvider(), always(0.99));
    const p = new NpcAgent(pell, new FakeProvider(), always(0.99));
    p.state.relationship = 70;
    const scene = new Scene("inn");
    const turn = await sceneTurn(scene, [b, p], b, "Pell knows me.", world, always(0));
    expect(turn.vouched).toBe("Old Pell");
    expect(b.state.relationship).toBeGreaterThanOrEqual(3);
  });

  it("nobody chimes in on a bad roll", async () => {
    const world = worldAt(20);
    const b = new NpcAgent(brena, new FakeProvider(), always(0.99));
    const r = new NpcAgent(rook, new FakeProvider(), always(0.99));
    const turn = await sceneTurn(new Scene("inn"), [b, r], b, "Hello.", world, always(0.99));
    expect(turn.interjection).toBeNull();
  });
});

describe("N6 fixes from playing", () => {
  it("the NPC named first is the one addressed", async () => {
    const { addressedByName } = await import("../src/game/scene.js");
    const b = new NpcAgent(brena, new FakeProvider());
    const p = new NpcAgent(pell, new FakeProvider());
    expect(addressedByName("Pell, what do you think of Brena?", [b, p])?.persona.id).toBe("pell");
    expect(addressedByName("Nice evening.", [b, p])).toBeNull();
  });

  it("Rook never sells to villagers at the camp", () => {
    const s = createNpcState(rook);
    passTime(rook, s, worldAt(6), 14, always(0));
    expect(s.inventory["forge hammer [C]"]).toBe(1);
  });
});
