import { describe, expect, it } from "vitest";
import { config } from "../src/config.js";
import { absoluteMinute } from "../src/game/clock.js";
import { checkPlayerPromises, LATE_DISCOUNT } from "../src/game/commitments.js";
import { balanceDue, collectCommission, orderCommission } from "../src/game/commissions.js";
import { exposeLies, tellLie } from "../src/game/deception.js";
import { callInFavour, grantFavour, offerFavour, quoteFavour } from "../src/game/favours.js";
import { journalByNpc } from "../src/game/journal.js";
import { acceptQuest, turnInQuests } from "../src/game/quests.js";
import { passMinutes, passTime } from "../src/game/simulation.js";
import { quoteTraining } from "../src/game/training.js";
import { applyAction, minPrice, parseAction, playerAttack, socialCheck, toolsFor } from "../src/npc/actions.js";
import { addEmotion, baselineMood, fadeEmotions } from "../src/npc/emotions.js";
import { initiativeFor } from "../src/npc/initiative.js";
import { describeRecall, memoryWeight, recall, remember } from "../src/npc/memory.js";
import { NpcAgent } from "../src/npc/NpcAgent.js";
import { buildTurnMessage } from "../src/npc/persona.js";
import { parsePersona } from "../src/npc/personaSchema.js";
import { canBeAttacked, friendDiscount, friendshipOf, romanceAllowed, romanceStageFor } from "../src/npc/relationship.js";
import { createNpcState } from "../src/npc/state.js";
import { traitsOf } from "../src/npc/traits.js";
import { fearMoralePenalty, giftTrust } from "../src/npc/triggers.js";
import type { NpcState } from "../src/npc/types.js";
import { createTestWorld } from "../src/world/world.js";
import brenaJson from "./fixtures/npcs/brena.json" with { type: "json" };
import { always, brena, call, ctxFor, FakeProvider, hale, pell, rook, say, worldAt } from "./helpers.js";

const act = (c: ReturnType<typeof ctxFor>, name: string, args: Record<string, unknown> = {}) => {
  const parsed = parseAction(name, args);
  if (!parsed.ok) throw new Error(parsed.error);
  return applyAction(parsed, c);
};

describe("N5 memory and relationships", () => {
  it("done when: insult Brena, wait a day, and she's still cold and says why", async () => {
    const llm = new FakeProvider([call("change_mood", { mood: "angry" }), say("Get out of my forge."), say("You again.")]);
    const npc = new NpcAgent(brena, llm, always(0.99));
    const world = worldAt(14);
    await npc.respond("Your forge is junk and you smell like a goat.", world);
    expect(npc.state.memories.some((m) => m.text.includes("insulted you"))).toBe(true);
    npc.wait(world, 24);
    expect(world.day).toBe(2);
    expect(npc.state.mood).toBe("annoyed"); // drifted from angry to the resentment baseline, not neutral
    expect(npc.state.relationship).toBeLessThan(0);
    await npc.respond("Morning.", world);
    expect(llm.lastUser()).toContain('Yesterday, they insulted you: "Your forge is junk');
    expect(llm.lastUser()).toContain("You still resent them insulting you");
  });

  it("done when: two quests earn the respect that unlocks expert training, which trust alone didn't", () => {
    const world = createTestWorld();
    world.player.skills.smithing = 3;
    world.player.money = 100_000;
    const state = createNpcState(brena, { relationship: 60 });
    expect(quoteTraining(brena, state, world, "smithing", 1).message).toContain("don't rate you highly enough");
    for (const [id, item, qty] of [["hot_meal", "stew [G]", 1], ["burn_poultice", "wild herbs [F]", 3]] as const) {
      world.player.level = 2; // the herbs job is F-tier
      state.pendingQuest = id;
      expect(acceptQuest(brena, state, world.player, world)?.id).toBe(id);
      world.player.inventory[item] = (world.player.inventory[item] ?? 0) + qty;
      expect(turnInQuests(brena, state, world).completed).toHaveLength(1);
    }
    expect(state.respect).toBe(20);
    expect(quoteTraining(brena, state, world, "smithing", 1).ok).toBe(true);
  });

  it("recall: the top three by importance × freshness; bad memories fade at forgiveness", () => {
    const s = createNpcState(brena);
    const t = traitsOf(brena);
    remember(s, { id: "a", day: 1, text: "they bought a horseshoe", importance: 2, valence: 1 }, t);
    remember(s, { id: "b", day: 1, text: "they insulted you", importance: 6, valence: -1 }, t);
    remember(s, { id: "c", day: 3, text: "they gave you stew", importance: 4, valence: 1 }, t);
    remember(s, { id: "d", day: 3, text: "they fixed your sign", importance: 3, valence: 1 }, t);
    expect(recall(s, 3, t).map((m) => m.id)).toEqual(["b", "c", "d"]);
    expect(describeRecall(s, 3, t)).toContain("Two days ago, they insulted you.");
    // A grudge-holder (Hale) keeps a bad memory longer than a forgiving soul.
    const insult = s.memories.find((m) => m.id === "b")!;
    expect(memoryWeight(insult, 11, traitsOf(hale))).toBeGreaterThan(memoryWeight(insult, 11, { forgiveness: 1 }));
  });

  it("fear is what buys a discount from intimidation: Hale caves, Rook doesn't", () => {
    const h = ctxFor(hale, {}, worldAt(10), always(0.99));
    expect(socialCheck("intimidate", "Cut the price.", h).message).toContain("% off");
    expect(h.state.discountPct).toBeGreaterThan(0);
    const r = ctxFor(rook, {}, worldAt(10), always(0.99));
    const res = socialCheck("intimidate", "Cut the price.", r);
    expect(res.success).toBe(true);
    expect(res.message).toContain("not scared enough to cut your prices");
    expect(r.state.discountPct).toBe(0);
  });

  it("an attack leaves a grudge that blocks trade and teaching until amends are paid", () => {
    const c = ctxFor(brena, { relationship: 60 }, worldAt(14), always(0.01));
    playerAttack(c);
    c.state.inCombat = false;
    c.state.hp = 90;
    c.state.relationship = 60;
    c.state.mood = "neutral";
    expect(c.state.grudge?.reason).toBe("they attacked you");
    expect(toolsFor({ ...c, tradeTalk: true }).map((t) => t.name)).not.toContain("offer_item");
    expect(quoteTraining(brena, c.state, c.world, "smithing", 1).message).toContain("grudge");
    expect(toolsFor(c).map((t) => t.name)).not.toContain("make_amends"); // only when they sound sorry
    expect(toolsFor({ ...c, amendsTalk: true }).map((t) => t.name)).toContain("make_amends");
    expect(act(c, "make_amends").message).toContain("1 gold");
    expect(c.state.pendingAmends?.fine).toBe(100);
  });

  it("paying the fine settles the grudge", async () => {
    const npc = new NpcAgent(brena, new FakeProvider([say("Fine.")]), always(0.5));
    const world = worldAt(14);
    npc.state.grudge = { reason: "they attacked you", day: 1, until: 9 };
    npc.state.pendingAmends = { fine: 100 };
    const r = await npc.acceptAmends(world);
    expect(r.amends.ok).toBe(true);
    expect(npc.state.grudge).toBeNull();
    expect(world.player.money).toBe(400);
  });

  it("a grudge fades on its own after a forgiveness-set number of days", () => {
    const c = ctxFor(pell, {}, worldAt(14), always(0.01));
    playerAttack(c);
    expect(c.state.grudge!.until).toBe(1 + 6); // forgiveness 0.5: 2 + 8 × 0.5
  });
});

describe("N5.1 favours", () => {
  it("refused below the trust needed, offered above, and owed after", () => {
    const world = worldAt(10);
    const low = createNpcState(brena, { relationship: 10 });
    expect(quoteFavour(brena, low, world, "lend_gold").ok).toBe(false);
    const high = createNpcState(brena, { relationship: 60 });
    const quote = offerFavour(brena, high, world, "lend_gold");
    expect(quote).toMatchObject({ ok: true, amount: 150 }); // her spare money: 3 gold 5 silver less 2 gold reserve
    expect(grantFavour(brena, high, world).ok).toBe(true);
    expect(world.player.money).toBe(650);
    expect(world.player.commitments![0]).toMatchObject({ kind: "repay_loan", amount: 150, toWhom: "brena", status: "open" });
    expect(high.owedFavours).toHaveLength(1);
    expect(quoteFavour(brena, high, world, "warn_me").ok).toBe(false); // not until that's squared
  });

  it("done when: Brena lends to a trusted player, and later asks for a favour back", async () => {
    const llm = new FakeProvider([say("Here."), say("You owe me.")]);
    const npc = new NpcAgent(brena, llm, always(0.99));
    npc.state.relationship = 60;
    npc.state.metBefore = true;
    const world = worldAt(14);
    await npc.askFavour("lend_gold", world);
    await npc.acceptFavour(world);
    world.day = 2;
    const opening = initiativeFor(brena, npc.state, world);
    expect(opening?.trigger).toBe("favour");
    const first = await npc.speakFirst(world);
    expect(first?.trigger).toBe("favour");
    expect(llm.lastUser()).toContain("calling it in: you want 1 stew");
    const job = npc.state.questBoard.find((q) => q.favour)!;
    expect(job.objective).toEqual({ type: "deliver", item: "stew", qty: 1 });
    npc.state.pendingQuest = job.id;
    acceptQuest(brena, npc.state, world.player, world);
    world.player.inventory["stew [G]"] = 1;
    turnInQuests(brena, npc.state, world);
    expect(npc.state.owedFavours).toEqual([]);
  });

  it("offer_favour only on favour talk, with the kinds they'd grant", () => {
    const c = ctxFor(brena, { relationship: 60 });
    expect(toolsFor(c).map((t) => t.name)).not.toContain("offer_favour");
    expect(toolsFor({ ...c, favourTalk: true }).map((t) => t.name)).toContain("offer_favour");
  });

  it("calling in a favour makes one job, once", () => {
    const s = createNpcState(hale, { owedFavours: [{ kind: "warn_me", day: 1 }] });
    expect(callInFavour(hale, s, 1)).toBeNull(); // too soon
    expect(callInFavour(hale, s, 2)?.objective).toEqual({ type: "deliver", item: "ale", qty: 1 });
    expect(callInFavour(hale, s, 3)).toBeNull();
  });
});

describe("N5.2 fears and loves", () => {
  it("a loved gift raises trust more than its gold value", () => {
    const s = createNpcState(brena);
    const stew = giftTrust(brena, s, { item: "stew [G]" }, 1); // worth 4 silver
    const coins = giftTrust(brena, s, { money: 40 }, 1);
    expect(stew).toBeGreaterThan(coins);
    expect(giftTrust(brena, s, { item: "iron sword [B]" }, 1)).toBeGreaterThan(giftTrust(brena, s, { money: 900 }, 1));
  });

  it("done when: a well-made blade wins Brena over faster than coins", async () => {
    const blade = new NpcAgent(brena, new FakeProvider([say("Now that's steel.")]));
    const coin = new NpcAgent(brena, new FakeProvider([say("Hm.")]));
    const w1 = worldAt(14);
    w1.player.inventory["iron sword [B]"] = 1;
    const w2 = worldAt(14);
    w2.player.money = 2000;
    await blade.receiveGift("iron sword [B]", w1);
    await coin.receiveGift("9 gold", w2); // the sword's value
    expect(blade.state.relationship).toBeGreaterThan(coin.state.relationship);
    expect(w1.player.journal!.some((e) => e.text === "Brena Ashford loves a well-made blade.")).toBe(true);
  });

  it("done when: Pell panics when the mayor is named", async () => {
    const llm = new FakeProvider([say("H-hush!")]);
    const npc = new NpcAgent(pell, llm);
    const world = worldAt(15);
    await npc.respond("The mayor was asking about you.", world);
    expect(npc.state.mood).toBe("afraid");
    expect(llm.lastUser()).toContain("They mentioned the mayor, which frightens you.");
    expect(world.player.journal!.some((e) => e.kind === "fear" && e.text.includes("the mayor"))).toBe(true);
  });

  it("a fear in sight makes the morale roll harder", () => {
    const world = worldAt(15);
    expect(fearMoralePenalty(pell, world)).toBe(0);
    world.present = ["rook"];
    expect(fearMoralePenalty(pell, world)).toBe(3);
  });
});

describe("N5.3 lasting emotions", () => {
  it("done when: insulted in front of others, Pell is cool a day later and warm again a week later", async () => {
    const npc = new NpcAgent(pell, new FakeProvider([call("change_mood", { mood: "angry" }), say("How dare you!")]), always(0.99));
    const world = worldAt(20);
    world.present = ["brena", "hale"];
    await npc.respond("You water your ale, you old crook.", world);
    world.present = [];
    npc.wait(world, 24);
    expect(npc.state.mood).toBe("annoyed");
    npc.wait(world, 24 * 6);
    expect(npc.state.emotions.filter((e) => e.kind === "resentment")).toEqual([]);
    expect(npc.state.mood).toBe("neutral");
    expect(npc.state.relationship).toBeGreaterThanOrEqual(0);
  });

  it("grudge-holders hold on to bad feelings longer", () => {
    const h = createNpcState(hale);
    const b = createNpcState(brena);
    addEmotion(h, "resentment", 0.8, "x", 1);
    addEmotion(b, "resentment", 0.8, "x", 1);
    fadeEmotions(h, traitsOf(hale), 3);
    fadeEmotions(b, traitsOf(brena), 3);
    expect(h.emotions[0]!.strength).toBeGreaterThan(b.emotions[0]!.strength);
  });

  it("pride from a masterwork shows, then fades over /wait", () => {
    const s = createNpcState(brena);
    addEmotion(s, "pride", 0.6, "the sword you made", 1);
    expect(baselineMood(s)).toBe("happy");
    expect(buildTurnMessage(brena, s, worldAt(14), "Hi")).toContain("You're proud of the sword you made.");
    passTime(brena, s, worldAt(14), 48, always(0.99));
    expect(s.emotions[0]!.strength).toBeCloseTo(0.6 * 0.7 * 0.7); // good feelings fade 30% a night
    passTime(brena, s, worldAt(14), 24 * 4, always(0.99));
    expect(s.emotions).toEqual([]);
  });
});

describe("N5.4 the player can lie", () => {
  it("believed on a good roll, and stored as a fact the NPC can't see is false", () => {
    const w = worldAt(10);
    const s = createNpcState(hale);
    const r = tellLie(hale, s, w, "The captain sent me.", always(0.99));
    expect(r.believed).toBe(true);
    expect(s.beliefs[0]).toMatchObject({ claim: "The captain sent me.", names: ["people.guard_captain"], foundOut: false });
    const msg = buildTurnMessage(hale, s, w, "So?");
    expect(msg).toContain('told you (and you believe it): "The captain sent me."');
    expect(msg).not.toContain("false");
  });

  it("spotted on a bad roll: trust and respect drop, and it's remembered", () => {
    const s = createNpcState(hale);
    const r = tellLie(hale, s, worldAt(10), "The captain sent me.", always(0));
    expect(r.believed).toBe(false);
    expect(s.relationship).toBe(-10);
    expect(s.respect).toBe(-5);
    expect(s.memories[0]!.text).toContain("lied to your face");
  });

  it("done when: Hale believes it, then turns cold once he learns otherwise", () => {
    const w = worldAt(10);
    const s = createNpcState(hale, { relationship: 20 });
    tellLie(hale, s, w, "The captain sent me.", always(0.99));
    w.day = 2;
    expect(exposeLies(hale, s, w, always(0.99))).toEqual([]); // not tonight
    expect(exposeLies(hale, s, w, always(0.1))[0]).toContain("was a lie"); // he checked with the captain
    expect(s.relationship).toBe(0);
    expect(s.beliefs[0]!.foundOut).toBe(true);
    expect(baselineMood(s)).toBe("annoyed");
    expect(exposeLies(hale, s, w, always(0))).toEqual([]); // found out once
  });
});

describe("N5.5 promises and commitments", () => {
  it("done when: Brena finishes a commission late, apologises unprompted, and gives a discount", async () => {
    const world = worldAt(19);
    world.minute = 30;
    world.player.money = 2000;
    const llm = new FakeProvider([say("Done, by tomorrow."), say("Sorry it's late."), say("There.")]);
    const npc = new NpcAgent(brena, llm, always(0.99));
    npc.state.inventory["iron ore [F]"] = 4;
    const order = await npc.commission("iron sword", world);
    expect(order.order.ok).toBe(true);
    expect(order.order.message).toContain("ready by Day 2, 01:00"); // 4 hours' work and an hour's slack, from 19:30
    npc.wait(world, 16); // she stops at 20:00, sleeps, starts at 6:00
    expect(npc.state.commission).toMatchObject({ status: "ready", late: true });
    const first = await npc.speakFirst(world);
    expect(first?.trigger).toBe("apology");
    expect(llm.lastUser()).toContain("Apologise");
    expect(await npc.speakFirst(world)).toBeNull(); // once, not on every turn
    const owed = balanceDue(npc.state.commission!);
    expect(owed).toBe(Math.max(0, 400 - 200 - (400 * LATE_DISCOUNT) / 100));
    const got = await npc.collect(world);
    expect(got.collect.ok).toBe(true);
    expect(Object.keys(world.player.inventory).some((k) => k.startsWith("iron sword"))).toBe(true);
  });

  it("on time, nothing to apologise for", () => {
    const world = worldAt(8);
    world.player.money = 2000;
    const s = createNpcState(brena);
    s.inventory["iron ore [F]"] = 4;
    orderCommission(brena, s, world, "iron sword");
    passTime(brena, s, world, 6, always(0.99));
    expect(s.commission).toMatchObject({ status: "ready", late: false });
    expect(s.commitments[0]!.status).toBe("kept");
    expect(initiativeFor(brena, s, world)?.trigger).not.toBe("apology");
    expect(collectCommission(brena, s, world).ok).toBe(true);
  });

  it("the player's broken promise costs trust, once", () => {
    const world = worldAt(10);
    const s = createNpcState(brena, { relationship: 60 });
    offerFavour(brena, s, world, "lend_gold");
    grantFavour(brena, s, world);
    world.day = 5;
    expect(checkPlayerPromises(brena, s, world.player, world)).toHaveLength(1);
    expect(s.relationship).toBe(45);
    expect(checkPlayerPromises(brena, s, world.player, world)).toHaveLength(0);
    expect(s.relationship).toBe(45);
  });

  it("repaying on time keeps your word", async () => {
    const world = worldAt(10);
    const npc = new NpcAgent(brena, new FakeProvider([say("Good.")]));
    npc.state.relationship = 60;
    offerFavour(brena, npc.state, world, "lend_gold");
    grantFavour(brena, npc.state, world);
    const r = await npc.repay(world);
    expect(r.repay.ok).toBe(true);
    expect(world.player.commitments![0]!.status).toBe("kept");
    expect(npc.state.relationship).toBe(65);
  });

  it("a promise due soon is a situation line", () => {
    const world = worldAt(10);
    const s = createNpcState(brena, { relationship: 60 });
    offerFavour(brena, s, world, "lend_gold");
    grantFavour(brena, s, world);
    world.day = 4;
    world.hour = 8;
    expect(buildTurnMessage(brena, s, world, "Hi")).toContain("They promised you to repay 1 gold 5 silver (1 gold 5 silver) by 10:00.");
  });
});

describe("N5.6 affection, friendship and romance", () => {
  it("done when: helping Pell over several days makes him a friend with a friend's discount", async () => {
    const llm = new FakeProvider();
    const npc = new NpcAgent(pell, llm, always(0.99));
    const world = worldAt(9);
    const list = minPrice(pell, npc.state, "ale [G]")!;
    for (let day = 1; day <= 4; day++) {
      world.day = day;
      world.hour = 9;
      for (const line of ["Morning, Pell!", "Any gossip today?", "Lovely inn."]) await npc.respond(line, world);
      if (day <= 2) {
        npc.state.pendingQuest = day === 1 ? "stable_shoes" : "winter_pelts";
        npc.state.relationship = Math.max(npc.state.relationship, 10);
        world.player.level = 3;
        acceptQuest(pell, npc.state, world.player, world);
        world.player.inventory[day === 1 ? "horseshoe [G]" : "rabbit pelt [F]"] = day === 1 ? 2 : 3;
        turnInQuests(pell, npc.state, world);
      }
    }
    expect(friendshipOf(npc.state)).toBe("friend");
    expect(friendDiscount(npc.state)).toBe(10);
    expect(minPrice(pell, npc.state, "ale [G]")).toBeLessThan(list);
  });

  it("the schema rejects romance on a minor, and minors get no romance or attacks", () => {
    const child = { ...brenaJson, id: "kit", name: "Kit", age: 10, minor: true, romance: { open: true } };
    expect(() => parsePersona(child)).toThrow(/minor can never be open to romance/);
    const minor = parsePersona({ ...child, romance: { open: false } });
    expect(romanceAllowed(minor)).toBe(false);
    expect(canBeAttacked(minor)).toBe(false);
    const c = ctxFor(minor, {}, worldAt(14), always(0.99));
    expect(playerAttack(c).ok).toBe(false);
    expect(c.state.inCombat).toBe(false);
    // Even with the player's romance setting on, a minor never gets there.
    const saved = config.content.romance;
    config.content.romance = true;
    expect(romanceStageFor({ ...minor, romance: { open: true } }, { affection: 100, relationship: 100 })).toBe(0);
    config.content.romance = saved;
  });

  it("romance is off unless the player turns it on, and then follows affection and trust", () => {
    const s: Pick<NpcState, "affection" | "relationship"> = { affection: 100, relationship: 100 };
    expect(romanceStageFor(brena, s)).toBe(0);
    const saved = config.content.romance;
    config.content.romance = true;
    expect(romanceStageFor(brena, { affection: 55, relationship: 45 })).toBe(1);
    expect(romanceStageFor(brena, s)).toBe(3);
    config.content.romance = saved;
  });
});

describe("N5.7 the player's journal", () => {
  it("done when: /journal brena lists her secret, the stew she loves and the sword she promised", async () => {
    const world = worldAt(9);
    world.player.money = 2000;
    const npc = new NpcAgent(brena, new FakeProvider([say("Stew, aye."), call("reveal_secret", { secret: "vault_key" }), say("Here it is."), say("Deal.")]), always(0.99));
    npc.state.relationship = 60;
    npc.state.inventory["iron ore [F]"] = 4;
    await npc.respond("I brought you some stew from the inn.", world);
    await npc.respond("Is there something you're keeping from me?", world);
    await npc.commission("iron sword", world);
    const groups = journalByNpc(world.player, { brena: brena.name }, "brena");
    expect(groups).toHaveLength(1);
    const text = groups[0]!.lines.join("\n");
    expect(text).toContain("Brena Ashford's secret: Last month you forged a key");
    expect(text).toContain("Brena Ashford loves stew.");
    expect(text).toContain("Brena Ashford promised you an iron sword");
  });

  it("each entry is added once", async () => {
    const world = worldAt(9);
    const npc = new NpcAgent(brena, new FakeProvider());
    await npc.respond("Do you like stew?", world);
    await npc.respond("Stew is great.", world);
    expect(world.player.journal!.filter((e) => e.kind === "love")).toHaveLength(1);
  });
});

describe("event log", () => {
  it("records what happens, in code", async () => {
    const world = worldAt(14);
    const npc = new NpcAgent(brena, new FakeProvider([call("change_mood", { mood: "angry" }), say("Out.")]));
    await npc.respond("You're a hack.", world);
    expect(world.events!.map((e) => e.kind)).toEqual(["insulted"]);
    expect(absoluteMinute(world)).toBeGreaterThan(0);
    passMinutes(brena, npc.state, world, 1, always(0.99));
  });
});
