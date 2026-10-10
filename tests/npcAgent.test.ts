import { describe, expect, it } from "vitest";
import brena from "../src/data/npcs/brena.json" with { type: "json" };
import type { ChatRequest, ChatResult, LLMProvider } from "../src/llm/provider.js";
import { NpcAgent } from "../src/npc/NpcAgent.js";
import type { NpcPersona } from "../src/npc/types.js";
import { createDemoWorld } from "../src/world/world.js";

/** Returns scripted replies in order and records every request it receives. */
class FakeProvider implements LLMProvider {
  readonly requests: ChatRequest[] = [];
  constructor(private readonly replies: ChatResult[]) {}
  async chat(req: ChatRequest, onText?: (delta: string) => void): Promise<ChatResult> {
    this.requests.push(structuredClone(req));
    const reply = this.replies.shift() ?? { text: "...", toolCalls: [] };
    if (reply.text) onText?.(reply.text);
    return reply;
  }
}

const say = (text: string): ChatResult => ({ text, toolCalls: [] });
const call = (name: string, args: Record<string, unknown>): ChatResult => ({ text: "", toolCalls: [{ name, arguments: args }] });

describe("NpcAgent.respond", () => {
  it("returns plain speech in one round", async () => {
    const llm = new FakeProvider([say("Hm. Welcome.")]);
    const npc = new NpcAgent(brena as NpcPersona, llm);
    const r = await npc.respond("Hello", createDemoWorld());
    expect(r).toEqual({ text: "Hm. Welcome.", actions: [] });
    expect(llm.requests).toHaveLength(1);
  });

  it("applies a tool call, sends the result back, then speaks", async () => {
    const llm = new FakeProvider([call("change_mood", { mood: "angry" }), say("Watch your tongue.")]);
    const npc = new NpcAgent(brena as NpcPersona, llm);
    const r = await npc.respond("Your forge is junk", createDemoWorld());

    expect(r.text).toBe("Watch your tongue.");
    expect(r.actions).toEqual([{ name: "change_mood", args: { mood: "angry" }, ok: true, message: "Mood updated. Now reply in character; let the feeling show in your words, never name it." }]);
    expect(npc.state.mood).toBe("angry");
    // The second request must include the tool result so the model can react to it.
    expect(llm.requests[1]!.messages.at(-1)).toEqual({ role: "tool", toolName: "change_mood", content: "Mood updated. Now reply in character; let the feeling show in your words, never name it." });
  });

  it("reports invalid tool calls back to the model without changing state", async () => {
    const llm = new FakeProvider([call("change_mood", { mood: "ecstatic" }), say("Bah.")]);
    const npc = new NpcAgent(brena as NpcPersona, llm);
    const r = await npc.respond("Hi", createDemoWorld());

    expect(r.actions[0]!.ok).toBe(false);
    expect(npc.state.mood).toBe("neutral");
    expect(r.text).toBe("Bah.");
  });

  it("stops after maxStepsPerTurn if the model keeps calling tools", async () => {
    const llm = new FakeProvider(Array.from({ length: 10 }, () => call("change_mood", { mood: "sad" })));
    const npc = new NpcAgent(brena as NpcPersona, llm);
    await npc.respond("Hi", createDemoWorld());
    expect(llm.requests).toHaveLength(4);
  });

  it("an offer waits for the player; accepting completes the sale and the NPC reacts", async () => {
    const llm = new FakeProvider([call("offer_item", { item: "dagger [E]", price: 15 }), say("Fifteen gold."), say("Pleasure.")]);
    const npc = new NpcAgent(brena as NpcPersona, llm);
    const world = createDemoWorld();

    await npc.respond("I want a dagger", world);
    expect(npc.state.pendingOffer).toEqual({ item: "dagger [E]", price: 15 });
    expect(world.player.gold).toBe(50); // nothing sold yet

    const r = await npc.acceptOffer(world);
    expect(r.sale.ok).toBe(true);
    expect(r.text).toBe("Pleasure.");
    expect(world.player.gold).toBe(35);
    expect(world.player.inventory["dagger [E]"]).toBe(1);
    expect(npc.state.pendingOffer).toBeNull();
    // The NPC is told what happened, as an event in parentheses.
    expect(llm.requests[2]!.messages.at(-1)).toMatchObject({
      role: "user",
      content: expect.stringContaining("(Traveler accepted and paid 15 gold for the dagger [E].)"),
    });
  });

  it("declining clears the offer and moves nothing", async () => {
    const llm = new FakeProvider([call("offer_item", { item: "dagger [E]", price: 15 }), say("Fifteen."), say("Suit yourself.")]);
    const npc = new NpcAgent(brena as NpcPersona, llm);
    const world = createDemoWorld();
    await npc.respond("A dagger?", world);
    const r = await npc.declineOffer(world);
    expect(r.text).toBe("Suit yourself.");
    expect(npc.state.pendingOffer).toBeNull();
    expect(world.player.gold).toBe(50);
  });

  it("only offers reveal_secret to the model above the trust threshold", async () => {
    const llm = new FakeProvider([say("Hm."), say("Hm.")]);
    const npc = new NpcAgent(brena as NpcPersona, llm);
    await npc.respond("Any secrets?", createDemoWorld());
    npc.state.relationship = 80;
    await npc.respond("Any secrets?", createDemoWorld());
    const toolNames = (i: number) => llm.requests[i]!.tools!.map((t) => t.name);
    expect(toolNames(0)).not.toContain("reveal_secret");
    expect(toolNames(1)).toContain("reveal_secret");
  });
});


describe("NpcAgent mood written as text", () => {
  it("strips a leading mood label and applies the mood", async () => {
    const llm = new FakeProvider([say("Annoyed. That's low, stranger.")]);
    const npc = new NpcAgent(brena as NpcPersona, llm);
    const shown: string[] = [];
    const r = await npc.respond("Your forge is junk", createDemoWorld(), (d) => shown.push(d));

    expect(r.text).toBe("That's low, stranger.");
    expect(shown.join("")).toBe("That's low, stranger.");
    expect(npc.state.mood).toBe("annoyed");
    expect(r.actions).toEqual([expect.objectContaining({ name: "change_mood", ok: true, args: { mood: "annoyed", fromText: true } })]);
  });
});

describe("NpcAgent combat and checks", () => {
  const face = (n: number, sides: number) => (n - 0.5) / sides;
  const rolls = (...v: number[]) => {
    let i = 0;
    return () => v[i++ % v.length]!;
  };

  it("after three insults the NPC can attack; the hit is rolled in code", async () => {
    const llm = new FakeProvider([
      call("change_mood", { mood: "annoyed" }), say("Watch it."),
      call("change_mood", { mood: "angry" }), say("Last warning."),
      call("change_mood", { mood: "angry" }), call("attack_player", {}), say("Get out!"),
    ]);
    const world = createDemoWorld();
    const npc = new NpcAgent(brena as NpcPersona, llm, rolls(face(15, 20), face(5, 8)));
    await npc.respond("You're useless.", world);
    await npc.respond("Your swords are junk.", world);
    const r = await npc.respond("And you smell.", world);

    expect(r.text).toBe("Get out!");
    expect(r.actions.map((a) => a.name)).toEqual(["change_mood", "attack_player"]);
    expect(world.player.hp).toBe(30); // 5 on the d8 + 3 STR + 2 for the tier-C hammer
    expect(npc.state.inCombat).toBe(true);
    // attack_player was only offered on the third turn's second request.
    expect(llm.requests[4]!.tools!.map((t) => t.name)).not.toContain("attack_player");
    expect(llm.requests[5]!.tools!.map((t) => t.name)).toContain("attack_player");
  });

  it("player attack: the NPC is told the result and reacts", async () => {
    const llm = new FakeProvider([say("You'll regret that!")]);
    const npc = new NpcAgent(brena as NpcPersona, llm, rolls(face(15, 20), face(4, 4)));
    const r = await npc.attackedByPlayer(createDemoWorld());
    expect(r.hit.damage).toBe(5);
    expect(r.text).toBe("You'll regret that!");
    expect(llm.requests[0]!.messages.at(-1)!.content).toContain("attacked you with their fists and hit for 5 damage");
  });

  it("a dead NPC never speaks or acts again", async () => {
    const llm = new FakeProvider([say("should not be used")]);
    const npc = new NpcAgent(brena as NpcPersona, llm, rolls(face(20, 20), face(4, 4)));
    npc.state.hp = 1;
    const world = createDemoWorld();
    const r = await npc.attackedByPlayer(world);
    expect(npc.isDead).toBe(true);
    expect(r.text).toBe("");
    expect(await npc.respond("Hello?", world)).toEqual({ text: "", actions: [] });
    expect((await npc.attackedByPlayer(world)).hit.ok).toBe(false);
    expect(llm.requests).toHaveLength(0);
    expect(world.player.hp).toBe(40); // she didn't strike back
  });

  it("persuasion: the roll is reported before the NPC speaks", async () => {
    const llm = new FakeProvider([say("Fine, fine.")]);
    const npc = new NpcAgent(brena as NpcPersona, llm, rolls(face(18, 20)));
    const order: string[] = [];
    const r = await npc.attempt("persuade", "Come on.", createDemoWorld(), () => order.push("text"), () => order.push("roll"));
    expect(r.check.success).toBe(true);
    expect(order).toEqual(["roll", "text"]);
    expect(npc.state.discountPct).toBe(14); // 20%, shrunk by Brena's haggling
  });

  it("the NPC can only attack once per turn", async () => {
    const llm = new FakeProvider([
      { text: "", toolCalls: [{ name: "attack_player", arguments: {} }, { name: "attack_player", arguments: {} }] },
      say("Take that!"),
    ]);
    const world = createDemoWorld();
    const npc = new NpcAgent(brena as NpcPersona, llm, rolls(face(15, 20), face(5, 8)));
    npc.state.inCombat = true;
    const r = await npc.respond("Come on then!", world);
    expect(r.actions.map((a) => a.ok)).toEqual([true, false]);
    expect(r.actions[1]!.message).toBe("You already attacked this turn.");
    expect(world.player.hp).toBe(30); // 5 on the d8 + 3 STR + 2 for the tier-C hammer
  });

  it("haggling over a pending offer lowers its price, and the NPC is told", async () => {
    const llm = new FakeProvider([call("offer_item", { item: "iron sword [D]", price: 40 }), say("Forty."), say("Fine. Thirty-four.")]);
    const world = createDemoWorld();
    const npc = new NpcAgent(brena as NpcPersona, llm, rolls(face(19, 20)));
    await npc.respond("A sword, please.", world);
    const r = await npc.haggle("That's steep.", world);
    expect(r.check.success).toBe(true);
    expect(npc.state.pendingOffer).toEqual({ item: "iron sword [D]", price: 34 });
    expect(llm.requests[2]!.messages.at(-1)!.content).toContain("Your offer is now iron sword [D] for 34 gold.");
  });

  it("training: progress happens in code and the NPC reacts as a teacher", async () => {
    const llm = new FakeProvider([say("Again. Harder this time.")]);
    const world = createDemoWorld();
    const npc = new NpcAgent(brena as NpcPersona, llm);
    const r = await npc.train("smithing", 4, world);
    expect(r.training.levelsGained).toBe(1);
    expect(world.player.skills.smithing).toBe(1);
    expect(r.text).toBe("Again. Harder this time.");
    expect(llm.requests[0]!.messages.at(-1)!.content).toContain("Say a line as their teacher.");
  });

  it("training refused: the NPC isn't asked to speak", async () => {
    const llm = new FakeProvider([]);
    const npc = new NpcAgent(brena as NpcPersona, llm);
    const r = await npc.train("archery", 2, createDemoWorld());
    expect(r.training.ok).toBe(false);
    expect(llm.requests).toHaveLength(0);
  });

  it("selling: the NPC offers, the player accepts, the trade happens in code, the NPC reacts", async () => {
    const llm = new FakeProvider([call("offer_to_buy", { item: "iron ore [F]", price: 3 }), say("Three gold."), say("Good ore.")]);
    const world = createDemoWorld();
    const npc = new NpcAgent(brena as NpcPersona, llm);
    await npc.respond("Want to buy some iron ore?", world);
    expect(npc.state.pendingPurchase).toEqual({ item: "iron ore [F]", price: 3 });
    expect(world.player.gold).toBe(50);

    const r = await npc.acceptPurchase(world);
    expect(r.sale.ok).toBe(true);
    expect(r.text).toBe("Good ore.");
    expect(world.player.gold).toBe(53);
    expect(npc.state.inventory["iron ore [F]"]).toBe(1);
    expect(llm.requests[2]!.messages.at(-1)!.content).toContain("(Traveler sold you the iron ore [F] for 3 gold.)");
  });

  it("trade talk stays on for every round of a turn, then switches off", async () => {
    const llm = new FakeProvider([call("change_mood", { mood: "happy" }), say("Ore? Let's see."), say("Hm.")]);
    const npc = new NpcAgent(brena as NpcPersona, llm);
    await npc.respond("Want to buy some iron ore?", createDemoWorld());
    await npc.respond("Nice day.", createDemoWorld());
    const names = (i: number) => llm.requests[i]!.tools!.map((t) => t.name);
    expect(names(0)).toContain("offer_to_buy");
    expect(names(1)).toContain("offer_to_buy"); // second round of the same turn
    expect(names(2)).not.toContain("offer_to_buy");
  });

  it("training offer: the NPC offers, the player accepts, the lesson is paid and run in code", async () => {
    const llm = new FakeProvider([call("offer_training", { skill: "smithing", hours: 2 }), say("Ten gold, two hours."), say("Again.")]);
    const world = createDemoWorld();
    const npc = new NpcAgent(brena as NpcPersona, llm);
    await npc.respond("Can you train me in smithing?", world);
    expect(npc.state.pendingTraining).toEqual({ skill: "smithing", hours: 2, cost: 10 });
    expect(world.player.gold).toBe(50);

    const r = await npc.acceptTraining(world);
    expect(r.training).toMatchObject({ ok: true, hoursSpent: 2, cost: 10 });
    expect(world.player.gold).toBe(40);
    expect(npc.state.pendingTraining).toBeNull();
    expect(r.text).toBe("Again.");
  });

  it("declining a training offer clears it and charges nothing", async () => {
    const llm = new FakeProvider([call("offer_training", { skill: "smithing", hours: 2 }), say("Ten gold."), say("Suit yourself.")]);
    const world = createDemoWorld();
    const npc = new NpcAgent(brena as NpcPersona, llm);
    await npc.respond("Teach me?", world);
    const r = await npc.declineTraining(world);
    expect(r.text).toBe("Suit yourself.");
    expect(npc.state.pendingTraining).toBeNull();
    expect(world.player.gold).toBe(50);
  });

  it("a persuasion right after a training request is about training", async () => {
    const llm = new FakeProvider([say("No apprentices."), say("Fine. I'll teach you.")]);
    const npc = new NpcAgent(brena as NpcPersona, llm, rolls(face(18, 20)));
    const world = createDemoWorld();
    await npc.respond("Can you train me?", world);
    await npc.attempt("persuade", "Please, I'll do anything.", world);
    const event = llm.requests[1]!;
    expect(event.tools!.map((t) => t.name)).toContain("offer_training");
    expect(event.messages.at(-1)!.content).toContain("You could teach them now");
    expect(event.messages.at(-1)!.content).toContain("inclined to agree to what they asked");
    expect(event.messages.at(-1)!.content).not.toContain("carries:");
  });

  it("a training request stays open for one more turn, so a plain 'yes' can get an offer", async () => {
    const llm = new FakeProvider([say("Smithing, if you've the coin."), say("Good."), say("Hm.")]);
    const npc = new NpcAgent(brena as NpcPersona, llm);
    const world = createDemoWorld();
    await npc.respond("Could you teach me something?", world);
    await npc.respond("Yes, please.", world);
    await npc.respond("Nice weather.", world);
    const tools = (i: number) => llm.requests[i]!.tools!.map((t) => t.name);
    expect(tools(0)).toContain("offer_training");
    expect(tools(1)).toContain("offer_training");
    expect(tools(2)).not.toContain("offer_training");
  });

  it("once attacked, the NPC strikes back automatically, and keeps attacking on later turns", async () => {
    const llm = new FakeProvider([say("You'll pay for that!"), say("Stop talking and fight!")]);
    const world = createDemoWorld();
    // Every roll: d20 15 (hits), damage dice in the middle.
    const npc = new NpcAgent(brena as NpcPersona, llm, () => 14.5 / 20);
    const first = await npc.attackedByPlayer(world);
    expect(first.actions).toContainEqual(expect.objectContaining({ name: "attack_player", ok: true, args: { automatic: true } }));
    const hpAfterFirst = world.player.hp;
    expect(hpAfterFirst).toBeLessThan(40);

    // The player just talks; she attacks anyway.
    const second = await npc.respond("Wait, let's talk about this.", world);
    expect(second.actions).toContainEqual(expect.objectContaining({ name: "attack_player", ok: true }));
    expect(world.player.hp).toBeLessThan(hpAfterFirst);
  });

  it("the NPC stops attacking once it ends the fight", async () => {
    const llm = new FakeProvider([call("end_fight", {}), say("Fine. Get out of my forge.")]);
    const world = createDemoWorld();
    const npc = new NpcAgent(brena as NpcPersona, llm, () => 14.5 / 20);
    npc.state.inCombat = true;
    const r = await npc.respond("I'm sorry! I give up!", world);
    expect(npc.state.inCombat).toBe(false);
    expect(r.actions.map((a) => a.name)).toEqual(["end_fight"]);
    expect(world.player.hp).toBe(40);
  });

  it("running away: success ends it, and she shouts after you", async () => {
    const llm = new FakeProvider([say("Run, coward!")]);
    const npc = new NpcAgent(brena as NpcPersona, llm, () => 19.5 / 20);
    npc.state.inCombat = true;
    const r = await npc.playerFlees(createDemoWorld());
    expect(r.flee.escaped).toBe(true);
    expect(r.text).toBe("Run, coward!");
    expect(npc.state.conversationOver).toBe(true);
  });
});

describe("NpcAgent says the real offer terms", () => {
  it("drops what it said before the game set the terms, and keeps what it says after", async () => {
    const llm = new FakeProvider([
      { text: "Eight hours for eighty gold.", toolCalls: [{ name: "offer_training", arguments: { skill: "smithing", hours: 8 } }] },
      say("Seven hours for fifty gold. That's all your purse covers."),
    ]);
    const npc = new NpcAgent(brena as NpcPersona, llm);
    const shown: string[] = [];
    const r = await npc.respond("Can you train me?", createDemoWorld(), (d) => shown.push(d));
    // 4h toward novice at 5/h + 3h toward apprentice at 10/h = 50, all the player has.
    expect(npc.state.pendingTraining).toEqual({ skill: "smithing", hours: 7, cost: 50 });
    expect(r.text).toBe("Seven hours for fifty gold. That's all your purse covers.");
    expect(shown.join("")).not.toContain("eighty");
    // The tool result tells it the real terms and why they differ.
    expect(llm.requests[1]!.messages.at(-1)!.content).toBe(
      "Say exactly these terms: 7 hours of smithing for 50 gold. Not 8 hours: that's all they can afford. They'll accept or decline. Don't start yet.",
    );
  });

  it("doesn't hold text back on ordinary turns", async () => {
    const llm = new FakeProvider([say("Stranger.")]);
    const npc = new NpcAgent(brena as NpcPersona, llm);
    const shown: string[] = [];
    await npc.respond("Hello.", createDemoWorld(), (d) => shown.push(d));
    expect(shown).toEqual(["Stranger."]);
  });
});


describe("NpcAgent quests and busy NPCs", () => {
  it("asked for work, the NPC offers a quest; accepting puts it in the player's log", async () => {
    const llm = new FakeProvider([call("offer_job", { quest: "hot_meal" }), say("Bring me a stew. Eight gold."), say("Good.")]);
    const world = createDemoWorld();
    const npc = new NpcAgent(brena as NpcPersona, llm);
    await npc.respond("Got any work for me?", world);
    expect(npc.state.pendingQuest).toBe("hot_meal");
    expect(llm.requests[0]!.tools!.map((t) => t.name)).toContain("offer_job");
    const r = await npc.acceptQuest(world);
    expect(r.quest).toBe("A hot meal");
    expect(world.player.quests.active.map((q) => q.id)).toEqual(["hot_meal"]);
  });

  it("the quest tool never lists quests the player can't take", async () => {
    const llm = new FakeProvider([say("Hm.")]);
    const npc = new NpcAgent(brena as NpcPersona, llm);
    npc.state.relationship = 60;
    await npc.respond("Give me your hardest quest, the SSS one!", createDemoWorld());
    const tool = llm.requests[0]!.tools!.find((t) => t.name === "offer_job")!;
    const ids = (tool.parameters as any).properties.quest.enum;
    expect(ids).not.toContain("fathers_hammer");
    expect(llm.requests[0]!.messages.at(-1)!.content).toContain("Too dangerous for them");
  });

  it("turning in pays out in code, and the NPC reacts", async () => {
    const llm = new FakeProvider([say("Bring it hot."), say("Hot. Good.")]);
    const world = createDemoWorld();
    world.player.gold = 0;
    const npc = new NpcAgent(brena as NpcPersona, llm);
    npc.state.pendingQuest = "hot_meal";
    await npc.acceptQuest(world);
    world.player.inventory["stew [G]"] = 1;
    const r = await npc.turnIn(world);
    expect(r.turnIn.completed.map((q) => q.id)).toEqual(["hot_meal"]);
    expect(r.text).toBe("Hot. Good.");
    expect(world.player.gold).toBe(8);
    expect(llm.requests[1]!.messages.at(-1)!.content).toContain('finished "A hot meal"');
  });

  it("turning in with nothing ready doesn't bother the NPC", async () => {
    const llm = new FakeProvider([]);
    const r = await new NpcAgent(brena as NpcPersona, llm).turnIn(createDemoWorld());
    expect(r.turnIn.completed).toEqual([]);
    expect(llm.requests).toHaveLength(0);
  });

  it("a busy NPC can't be talked to", async () => {
    const llm = new FakeProvider([say("should not be used")]);
    const world = createDemoWorld();
    const npc = new NpcAgent(brena as NpcPersona, llm);
    npc.state.job = { recipeId: "dagger", output: "dagger [E]", qty: 1, until: 16 * 60, doing: "forging a dagger" };
    const r = await npc.respond("Hello?", world);
    expect(r.busy).toBe("forging a dagger until 16:00");
    expect(llm.requests).toHaveLength(0);
    npc.wait(world, 2);
    expect(npc.busyWith(world)).toBeNull();
  });
});
