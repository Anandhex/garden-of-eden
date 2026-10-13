import { beforeEach, describe, expect, it } from "vitest";
import { config } from "../src/config.js";
import { createNpcState } from "../src/npc/state.js";
import { traitsOf } from "../src/npc/traits.js";
import { playerAttack } from "../src/npc/actions.js";
import { initiativeFor } from "../src/npc/initiative.js";
import { knownNameWords, unknownNames, worldLore, setDynamicLore, certaintyOf, knowsOf } from "../src/npc/knowledge.js";
import { EventSchema, parseEvents, recordEvent, learnEvent } from "../src/game/events.js";
import { actOnRevenge, chooseRevenge, fadeRevenge, forgive, wantRevenge } from "../src/director/revenge.js";
import { expireNews, NEWS_DAYS, pushNews, runChronicle } from "../src/director/chronicle.js";
import { validateQuest, validateTraitShift, similarity } from "../src/director/validator.js";
import { driftTrait, TRAIT_LIFETIME_CAP } from "../src/npc/growth.js";
import { loadCreatureTemplates } from "../src/game/creatures.js";
import { ITEMS } from "../src/game/items.js";
import { acceptQuest, recordCreatureDefeat, turnInQuests } from "../src/game/quests.js";
import { applySpawnRules, allSpawnRules, ambushers } from "../src/game/spawning.js";
import { createTestWorld } from "../src/world/world.js";
import { WorldStore } from "../src/game/db.js";
import type { ChatRequest, ChatResult, LLMProvider } from "../src/llm/provider.js";
import { allPersonas, always, brena, hale, makeTown, pell, rook } from "./helpers.js";
import type { NpcState, WorldSnapshot } from "../src/npc/types.js";
import type { GameEvent } from "../src/game/events.js";
import { creaturesOf, siteState } from "../src/game/site.js";

const templates = loadCreatureTemplates();

beforeEach(() => {
  config.director = false;
  config.planning = false;
  config.summaries = false;
  setDynamicLore([]);
});

/** A director that answers each request by calling `pick(prompt)`. */
class Director implements LLMProvider {
  calls = 0;
  constructor(private readonly pick: (prompt: string, n: number) => ChatResult["toolCalls"]) {}
  async chat(req: ChatRequest): Promise<ChatResult> {
    const prompt = req.messages.at(-1)!.content as string;
    return { text: "", toolCalls: this.pick(prompt, this.calls++) };
  }
}

function worldWith(events: Array<Partial<GameEvent> & Pick<GameEvent, "kind" | "actor" | "target">>): WorldSnapshot {
  const w = createTestWorld();
  w.events = [];
  for (const e of events) recordEvent(w, { details: "", importance: 8, witnesses: [], ...e });
  return w;
}

const statesFor = () => Object.fromEntries(Object.entries(allPersonas()).map(([id, p]) => [id, createNpcState(p)])) as Record<string, NpcState>;

describe("N12.1 the event log", () => {
  it("events are checked on load: a malformed one is dropped", () => {
    const good = { id: "e1", day: 1, hour: 2, kind: "theft", actor: "player", target: "brena", details: "x", importance: 5 };
    expect(EventSchema.safeParse(good).success).toBe(true);
    expect(parseEvents([good, { ...good, kind: "made-up" }, { nonsense: true }])).toHaveLength(1);
  });

  it("witnesses are whoever was there; only they know at first, and gossip spreads it", () => {
    const w = createTestWorld();
    w.present = ["pell"];
    const e = recordEvent(w, { kind: "attacked", actor: "player", target: "brena", details: "", importance: 9 });
    expect(e.witnesses).toEqual(["pell", "brena"]);
    expect(e.knownBy).toEqual(["pell", "brena"]);
    expect(learnEvent(e, "hale")).toBe(true);
    expect(learnEvent(e, "hale")).toBe(false);
  });
});

describe("N12.2 revenge, decided by traits", () => {
  it("the same attack on Brena, Hale and Rook leads to three different responses", () => {
    expect(chooseRevenge(brena)).toBe("confront");
    expect(chooseRevenge(hale)).toBe("rumour");
    expect(chooseRevenge(rook)).toBe("ambush");
  });

  it("done when: attacked, each acts on it the next day, in their own way", () => {
    const town = makeTown();
    const world = town.world;
    for (const id of ["brena", "hale", "rook"] as const) {
      const a = town.agents[id]!;
      playerAttack({ persona: a.persona, state: a.state, world, rng: always(0.01) });
      a.state.inCombat = false;
    }
    town.passHours(12); // through midnight
    const b = town.agents.brena!.state;
    const h = town.agents.hale!.state;
    expect(b.goals[0]!.acted).toBeDefined();
    world.hour = 10;
    expect(initiativeFor(brena, b, world)?.trigger).toBe("confront");
    expect(initiativeFor(brena, b, world)?.event).toMatch(/Confront them/);
    expect(Object.values(h.rumours).some((r) => r.about === "player")).toBe(true);
    expect((world.extraSpawnRules ?? []).some((r) => r.ambush && r.id.startsWith("revenge_rook"))).toBe(true);
    // The hired men turn up and lie in wait.
    world.hour = 9;
    applySpawnRules(allSpawnRules([], siteState(world), world.day), templates, creaturesOf(world), siteState(world).spawns, world, always(0.5));
    expect(ambushers(allSpawnRules([], siteState(world), world.day), siteState(world).spawns, creaturesOf(world)).length).toBe(2);
  });

  it("revenge fades at forgiveness, and amends clear it", () => {
    const s = createNpcState(brena);
    wantRevenge(brena, s, "robbed", "they robbed you", 1);
    fadeRevenge(brena, s);
    expect(s.goals[0]!.strength).toBeLessThan(0.6);
    forgive(s);
    expect(s.goals).toEqual([]);
    const forgiving = createNpcState(brena, { goals: [] });
    forgiving.growth.traits.forgiveness = 0.5; // 0.4 + 0.5 → 0.9: takes it half as hard
    expect(wantRevenge(brena, forgiving, "attacked", "x", 1).strength).toBe(0.4);
  });

  it("acts once per goal", () => {
    const w = createTestWorld();
    const s = createNpcState(hale);
    wantRevenge(hale, s, "attacked", "they attacked you", 1);
    expect(actOnRevenge(hale, s, w)?.plan).toBe("rumour");
    expect(actOnRevenge(hale, s, w)).toBeNull();
  });
});

describe("N12.3 the nightly chronicle", () => {
  const event = { kind: "raid-repelled" as const, actor: "player", target: "pell", witnesses: ["pell", "hale"] };

  it("accepts good lore and news; witnesses know it for certain, everyone else as a rumour", async () => {
    const world = worldWith([event]);
    const states = statesFor();
    const llm = new Director(() => [
      { name: "add_news", arguments: { id: "raid_beaten_back", text: "Old Pell and a stranger beat back bandits at the Gilded Goose." } },
      { name: "add_lore", arguments: { id: "night_of_the_goose", name: "the night of the Goose", text: "The night a raid on the Gilded Goose was beaten back.", keywords: ["goose", "raid"] } },
    ]);
    const r = await runChronicle({ llm, world, personas: allPersonas(), states, creatures: templates }, 1);
    expect(r.accepted.map((e) => e.kind)).toEqual(["add_news", "add_lore"]);
    expect(world.recentEvents).toContain("news.raid_beaten_back");
    expect(worldLore().byId.has("chronicle.night_of_the_goose")).toBe(true);
    expect(certaintyOf({ knows: knowsOf(pell, states.pell) }, "chronicle.night_of_the_goose")).toBe("certain");
    expect(certaintyOf({ knows: knowsOf(brena, states.brena) }, "chronicle.night_of_the_goose")).toBe("rumour");
    // Runs once per day.
    expect((await runChronicle({ llm, world, personas: allPersonas(), states, creatures: templates }, 1)).accepted).toEqual([]);
  });

  it("rejects invented names, taken ids and near-duplicates, and logs why", async () => {
    const world = worldWith([event]);
    const states = statesFor();
    pushNews(world, "news.bandit_raid");
    const llm = new Director(() => [
      { name: "add_news", arguments: { id: "visitor", text: "Lord Varkis of Ostmark rode in to praise the defenders." } },
      { name: "add_news", arguments: { id: "bandit_raid", text: "Something else." } },
      { name: "add_news", arguments: { id: "again", text: "Bandits raided a shop in Millbrook during the night and made off with goods and coin." } },
    ]);
    const r = await runChronicle({ llm, world, personas: allPersonas(), states, creatures: templates }, 1);
    expect(r.accepted).toEqual([]);
    expect(r.rejected.map((e) => e.reason)).toEqual([expect.stringMatching(/Varkis/), expect.stringMatching(/taken/), expect.stringMatching(/too close/)]);
    expect(world.directorLog).toHaveLength(3);
  });

  it("news expires after a few days", () => {
    const world = createTestWorld();
    pushNews(world, "news.bandit_raid");
    world.day += NEWS_DAYS;
    expect(expireNews(world)).toEqual([]);
    world.day += 1;
    expect(expireNews(world)).toEqual(["news.bandit_raid"]);
    expect(world.recentEvents).not.toContain("news.bandit_raid");
  });

  it("near-duplicates score high, different news low", () => {
    expect(similarity("Bandits raided the forge in the night.", "In the night, bandits raided the forge.")).toBeGreaterThan(0.5);
    expect(similarity("Bandits raided the forge.", "A festival filled the square.")).toBeLessThan(0.2);
  });
});

describe("N12.4 director quests", () => {
  const ctx = (world: WorldSnapshot, states = statesFor()) => ({ world, personas: allPersonas(), states, creatures: templates, extraNames: ["Traveler"] });
  const raid: GameEvent = { id: "ev1", day: 1, hour: 2, kind: "raid", actor: "bandit-1", target: "brena", details: "", importance: 8, witnesses: ["brena"], knownBy: ["brena"] };

  it("only checkable goals, a tier from what's asked, the reward from the giver's purse", () => {
    const states = statesFor();
    const v = validateQuest(ctx(createTestWorld(), states), { giver: "Brena", title: "Get my blade back", description: "Bandits took my best blade in the raid.", goal: "defeat", creature: "bandits", qty: 2 }, raid);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.value.quest.objective).toEqual({ type: "defeat", creature: "bandit", qty: 2 });
    expect(v.value.quest.director).toBe(true);
    expect(v.value.quest.reward.money).toBeLessThanOrEqual(states.brena!.money / 2);
    // Unknown items and creatures, uninvolved givers and invented names are turned down.
    expect(validateQuest(ctx(createTestWorld()), { giver: "Brena", title: "x", description: "y", goal: "deliver", item: "dragon egg", qty: 1 }, raid).ok).toBe(false);
    expect(validateQuest(ctx(createTestWorld()), { giver: "Hale", title: "x", description: "y", goal: "deliver", item: "ale", qty: 1 }, raid).ok).toBe(false);
    expect(validateQuest(ctx(createTestWorld()), { giver: "Brena", title: "For Lord Varkis", description: "y", goal: "deliver", item: "ale", qty: 1 }, raid).ok).toBe(false);
  });

  it("a director quest goes on the board, its quarry turns up, and it's completable in code", async () => {
    const world = worldWith([{ kind: "raid", actor: "bandit-1", target: "brena", witnesses: ["brena"] }]);
    const states = statesFor();
    const llm = new Director(() => [{ name: "propose_quest", arguments: { giver: "Brena Ashford", title: "Thin out the bandits", description: "After the raid you want the bandits on the road thinned out.", goal: "defeat", creature: "bandit", qty: 1 } }]);
    const r = await runChronicle({ llm, world, personas: allPersonas(), states, creatures: templates }, 1);
    expect(r.accepted).toHaveLength(1);
    const q = states.brena!.questBoard.find((x) => x.director)!;
    expect(world.extraSpawnRules!.some((x) => x.quest === q.id)).toBe(true);
    world.player.level = 5;
    states.brena!.pendingQuest = q.id;
    expect(acceptQuest(brena, states.brena!, world.player, world)?.id).toBe(q.id);
    recordCreatureDefeat(world.player, "bandit");
    expect(turnInQuests(brena, states.brena!, world).completed.map((x) => x.id)).toEqual([q.id]);
  });
});

describe("N12.5 character drift", () => {
  const fight: GameEvent = { id: "ev2", day: 1, hour: 2, kind: "raid-repelled", actor: "player", target: "pell", details: "", importance: 8, witnesses: ["pell", "hale"] };

  it("no shift without a qualifying event that involves them", () => {
    const c = { world: createTestWorld(), personas: allPersonas(), states: statesFor(), creatures: templates, extraNames: [] };
    expect(validateTraitShift(c, { npc: "Hale", trait: "bravery", direction: "up", reason: "held the line" }, fight).ok).toBe(true);
    expect(validateTraitShift(c, { npc: "Brena", trait: "bravery", direction: "up", reason: "?" }, fight).ok).toBe(false);
    expect(validateTraitShift(c, { npc: "Hale", trait: "bravery", direction: "up", reason: "?" }, { ...fight, importance: 3 }).ok).toBe(false);
  });

  it("caps hold over a thousand nights: never more than 0.2 from the file", () => {
    const s = createNpcState(hale);
    for (let night = 1; night <= 1000; night++) driftTrait(hale, s, "bravery", 0.05, "night after night", night);
    expect(traitsOf(hale, s).bravery - traitsOf(hale).bravery).toBeCloseTo(TRAIT_LIFETIME_CAP);
    for (let night = 1001; night <= 2000; night++) driftTrait(hale, s, "temper", -0.05, "calming", night);
    expect(traitsOf(hale).temper - traitsOf(hale, s).temper).toBeLessThanOrEqual(TRAIT_LIFETIME_CAP + 1e-9);
  });
});

describe("N12 done when: 30 simulated days", () => {
  it("the chronicle's lore always passes the invented-name check, and every director quest is checkable", async () => {
    const names = ["Brena Ashford", "Old Pell", "Corporal Hale", "Rook"];
    // A director that tries everything, good and bad.
    const llm = new Director((prompt, n) => {
      const who = names.find((x) => prompt.split("\n")[0]!.includes(x)) ?? "Old Pell";
      const bad = n % 3 === 0;
      return [
        { name: "add_news", arguments: { id: `day_news_${n}`, text: bad ? `Sir Bastion of Kell came to see ${who}.` : `Folk talk of what happened with ${who} (${n}).` } },
        { name: "propose_quest", arguments: { giver: who, title: `Help for ${who}`, description: "Something needs doing after what happened.", goal: n % 2 ? "deliver" : "defeat", item: n % 5 === 0 ? "unicorn horn" : "wild herbs", creature: "wolf", qty: 1 + (n % 3) } },
        { name: "propose_trait_shift", arguments: { npc: who, trait: "bravery", direction: "up", reason: "it changed them" } },
      ];
    });
    config.director = true;
    const store = new WorldStore();
    const town = makeTown({ llm, store, rng: (() => { let s = 3; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })() });
    const world = town.world;
    for (let day = 0; day < 30; day++) {
      // Something happens each day: the player picks a fight and walks away.
      const victim = town.agents[["hale", "pell", "rook"][day % 3]!]!;
      if (!victim.isDead) {
        world.present = ["brena"];
        playerAttack({ persona: victim.persona, state: victim.state, world, rng: always(0.4) });
        victim.state.inCombat = false;
      }
      town.passHours(24);
      await town.background.drain();
    }
    const known = knownNameWords(Object.values(allPersonas()), [world.player.name, ...Object.values(templates).map((t) => t.name)]);
    const grown = world.lore ?? [];
    expect(grown.length).toBeGreaterThan(0);
    for (const l of grown) expect(unknownNames(`${l.name}. ${l.text}`, known), l.text).toEqual([]);
    const directorQuests = Object.values(town.agents).flatMap((a) => a.state.questBoard.filter((q) => q.director));
    for (const q of directorQuests) {
      if (q.objective.type === "deliver") expect(ITEMS).toHaveProperty([q.objective.item]);
      else if (q.objective.type === "defeat") expect(templates).toHaveProperty([q.objective.creature]);
      // Millbrook's needs (N13) reach its guard captain now she talks (N15): the dungeon by the mine.
      else if (q.objective.type === "clear") expect(world.realm?.dungeons).toHaveProperty([q.objective.dungeon]);
      else throw new Error(`unexpected goal ${q.objective.type}`);
    }
    const log = world.directorLog ?? [];
    expect(store.directorEntries().some((e) => !e.ok && /Bastion|Kell/.test(e.reason))).toBe(true);
    expect(log.length).toBeLessThanOrEqual(50); // the save keeps the latest; the database keeps them all
    const all = store.directorEntries();
    expect(all.some((e) => !e.ok && /unicorn/.test(e.reason))).toBe(true);
    expect(all.length).toBe(store.directorStats().accepted + store.directorStats().rejected);
    // Caps held for everyone.
    for (const a of Object.values(town.agents)) expect(Math.abs(traitsOf(a.persona, a.state).bravery - traitsOf(a.persona).bravery)).toBeLessThanOrEqual(TRAIT_LIFETIME_CAP + 1e-9);
    // Per night, at most the configured number of proposals got through.
    const perDay = new Map<number, number>();
    for (const e of store.directorEntries().filter((x) => x.ok)) perDay.set(e.day, (perDay.get(e.day) ?? 0) + 1);
    for (const n of perDay.values()) expect(n).toBeLessThanOrEqual(config.directorMaxPerNight);
    config.director = false;
  }, 30_000);
});
