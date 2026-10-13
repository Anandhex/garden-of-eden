import { describe, expect, it } from "vitest";
import { config } from "../src/config.js";
import { NpcAgent } from "../src/npc/NpcAgent.js";
import { createNpcState } from "../src/npc/state.js";
import { summariseConversation, SUMMARY_IMPORTANCE_CAP, transcriptLines } from "../src/director/summary.js";
import { describePlan, needsPlan, planDay } from "../src/director/planning.js";
import { BackgroundWork } from "../src/director/background.js";
import { WorldStore } from "../src/game/db.js";
import { cosine, hashedEmbedding, pickEmbedder, hashedEmbedder } from "../src/game/embeddings.js";
import { recordEvent } from "../src/game/events.js";
import { gossipTogether } from "../src/game/gossip.js";
import { createDemoWorld } from "../src/world/world.js";
import { always, brena, FakeProvider, makeTown, pell, say } from "./helpers.js";

describe("conversation summaries (optional)", () => {
  it("turn a talk into a few capped, marked memories that are never gossiped", async () => {
    const npc = new NpcAgent(brena, new FakeProvider([say("Tomas? My brother. Haven't heard from him."), say("Bah. Off with you.")]));
    const world = createDemoWorld();
    await npc.respond("Do you have a brother called Tomas?", world);
    await npc.respond("I'm looking for work in the city.", world);
    const transcript = npc.takeTranscript();
    expect(transcriptLines(transcript, "Brena", "Traveler")).toEqual([
      "Traveler: Do you have a brother called Tomas?",
      "Brena: Tomas? My brother. Haven't heard from him.",
      "Traveler: I'm looking for work in the city.",
      "Brena: Bah. Off with you.",
    ]);
    expect(npc.takeTranscript()).toEqual([]); // taken once
    const llm = new FakeProvider([say('{"facts":[{"text":"They asked about Tomas","importance":5,"feeling":"neutral"},{"text":"Sir Gorm sent them","importance":3,"feeling":"bad"}],"tone":"tense"}')]);
    const s = createNpcState(brena);
    const out = await summariseConversation(llm, brena, s, transcript, "Traveler", 1);
    expect(out!.tone).toBe("tense");
    expect(out!.facts.map((f) => f.text)).toEqual(["They asked about Tomas"]); // the invented name is dropped
    const m = s.memories.find((x) => x.summary)!;
    expect(m.importance).toBe(SUMMARY_IMPORTANCE_CAP);
    expect(m.text).toMatch(/^\(from talking\)/);
    // Code events are the truth: summaries aren't passed on.
    const p = createNpcState(pell);
    m.importance = 9;
    gossipTogether([{ id: "brena", persona: brena, state: s }, { id: "pell", persona: pell, state: p }], 1, always(0.01));
    expect(p.memories.some((x) => /Tomas/.test(x.text))).toBe(false);
  });

  it("dropped exchanges are kept for summarising, not lost", async () => {
    const replies = Array.from({ length: 80 }, (_, i) => say(`Reply ${i} ${"words ".repeat(30)}`));
    const npc = new NpcAgent(brena, new FakeProvider(replies));
    const world = createDemoWorld();
    for (let i = 0; i < 40; i++) await npc.respond(`Line ${i} ${"talk ".repeat(30)}`, world);
    expect(npc.messages.length).toBeLessThan(80);
    expect(npc.pendingTranscript).toBeGreaterThanOrEqual(80);
  });
});

describe("off-screen planning (optional)", () => {
  it("one checked call a day: flavour for the situation, never acted on", async () => {
    const world = createDemoWorld();
    const s = createNpcState(brena);
    expect(needsPlan(s, 1)).toBe(true);
    const plan = await planDay(new FakeProvider([say('{"intentions":["Find ore for the forge","Ask Old Pell about Tomas"]}')]), brena, s, world, ["Old Pell"]);
    expect(plan?.intentions).toEqual(["Find ore for the forge", "Ask Old Pell about Tomas"]);
    expect(needsPlan(s, 1)).toBe(false);
    expect(describePlan(s, 1)).toMatch(/Ask Old Pell about Tomas/);
    expect(describePlan(s, 2)).toBeNull();
    // A plan naming someone nobody knows is dropped.
    const s2 = createNpcState(brena);
    expect(await planDay(new FakeProvider([say('{"intentions":["Meet Lord Ferris at dawn"]}')]), brena, s2, world)).toBeNull();
  });
});

describe("background work makes way for the player", () => {
  it("pausing cancels the job in flight and puts it back; resuming finishes it", async () => {
    let aborted = 0;
    const bg = new BackgroundWork(() => aborted++);
    let runs = 0;
    let release!: () => void;
    bg.add({
      key: "plan:brena",
      kind: "plan",
      run: () =>
        new Promise<void>((resolve, reject) => {
          runs++;
          if (runs === 1) release = () => reject(new Error("aborted"));
          else resolve();
        }),
    });
    expect(bg.stats.running).toBe("plan:brena");
    bg.pause();
    release();
    await new Promise((r) => setTimeout(r, 10));
    expect(aborted).toBe(1);
    expect(bg.stats.queued).toBe(1);
    bg.resume();
    await bg.drain();
    expect(runs).toBe(2);
    expect(bg.stats.done).toBe(1);
  });

  it("the town queues today's plans after midnight, and a summary when talk ends", async () => {
    config.planning = true;
    config.summaries = true;
    config.director = false;
    const llm = new FakeProvider(Array.from({ length: 20 }, () => say('{"intentions":["Keep the fire going"],"facts":[{"text":"They were polite","importance":2,"feeling":"good"}],"tone":"friendly"}')));
    const town = makeTown({ llm });
    town.passHours(12);
    await town.background.drain();
    expect(town.agents.brena!.state.plan?.intentions).toEqual(["Keep the fire going"]);
    config.planning = false;
    config.summaries = false;
  });
});

describe("the long-term store (SQLite) and recall by meaning", () => {
  it("keeps every event, beyond what the save keeps", () => {
    const store = new WorldStore();
    const world = createDemoWorld();
    for (let i = 0; i < 5; i++) store.archiveEvent(recordEvent(world, { kind: "bought", actor: "player", target: "brena", details: `item ${i}`, importance: 2 }));
    expect(store.eventCount()).toBe(5);
    expect(store.eventsAbout("brena")).toHaveLength(5);
    store.reset();
    expect(store.eventCount()).toBe(0);
  });

  it("recalls an old talk by meaning, for that NPC only", async () => {
    const store = new WorldStore(":memory:", hashedEmbedder);
    await store.addMemory("brena", 3, "summary", "they asked about my brother Tomas in the city guard", 4);
    await store.addMemory("brena", 4, "summary", "they wanted a sword for cheap", 3);
    await store.addMemory("pell", 4, "summary", "they asked about Tomas too", 3);
    const hits = await store.recall("brena", "Any word of your brother?");
    expect(hits.map((h) => h.text)).toEqual(["they asked about my brother Tomas in the city guard"]);
    expect(await store.recall("brena", "nice weather today")).toEqual([]);
  });

  it("the hashed stand-in is used when no embedding model is pulled", async () => {
    expect(cosine(hashedEmbedding("my brother Tomas"), hashedEmbedding("your brother"))).toBeGreaterThan(0.3);
    const probe = { name: "nomic-embed-text", available: async () => false, embed: async () => [[1]] };
    expect((await pickEmbedder(probe)).name).toBe("hashed");
  });

  it("an agent with a store recalls a relevant old talk into its situation", async () => {
    const store = new WorldStore();
    await store.addMemory("brena", 2, "summary", "they promised to look for my brother Tomas", 4);
    const llm = new FakeProvider([say("Hm.")]);
    const town = makeTown({ llm, store });
    town.world.hour = 10;
    await town.agents.brena!.respond("I'm still looking for your brother.", town.world);
    expect(llm.lastUser()).toMatch(/From earlier talks with them you recall: on day 2, they promised to look for my brother Tomas/);
    town.close();
  });
});
