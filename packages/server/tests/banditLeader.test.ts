import { describe, expect, it } from "vitest";
import brenaJson from "../src/data/npcs/brena.json" with { type: "json" };
import rookJson from "../src/data/npcs/rook.json" with { type: "json" };
import { type Creature, fightCreature, loadCreatureTemplates } from "../src/game/creatures.js";
import { acceptQuest, turnInQuests } from "../src/game/quests.js";
import { applySpawnRules, denKey, loadSpawnRules, type SpawnLedger } from "../src/game/spawning.js";
import type { ChatRequest, ChatResult, LLMProvider } from "../src/llm/provider.js";
import { certaintyOf } from "../src/npc/knowledge.js";
import { NpcAgent } from "../src/npc/NpcAgent.js";
import { parsePersona } from "../src/npc/personaSchema.js";
import { createNpcState } from "../src/npc/state.js";
import { NPC_SPOTS } from "../src/web/map.js";
import { createDemoWorld } from "../src/world/world.js";

/** Counts model calls; always says a short line. */
class CountingProvider implements LLMProvider {
  calls = 0;
  async chat(_req: ChatRequest, onText?: (delta: string) => void): Promise<ChatResult> {
    this.calls++;
    onText?.("Hm.");
    return { text: "Hm.", toolCalls: [] };
  }
}

const rook = parsePersona(rookJson, "rook.json");
const brena = parsePersona(brenaJson, "brena.json");
const templates = loadCreatureTemplates();
/** Every roll a natural 20 (and the top of every damage die): the player always hits hard. */
const max = () => 0.999;

describe("Rook, the bandit leader", () => {
  it("is a full NPC with a spot at his camp, carrying Brena's father's hammer", () => {
    expect(NPC_SPOTS.rook).toBeDefined();
    expect(rook.startingInventory["forge hammer"]).toBe(1);
    expect(rook.dropsOnDeath).toBe(true);
    // He can't wield it: it's above his rank. It's a trophy, or a ransom.
    expect(rook.weapon).not.toMatch(/forge hammer/);
  });

  it("is in the lore: Pell knows of him for sure, Brena only by rumour", () => {
    expect(certaintyOf(parsePersona({ ...rookJson }), "people.rook")).toBe("certain");
    expect(certaintyOf(brena, "people.rook")).toBe("rumour");
  });

  it("killed, he drops his pack and purse; a shopkeeper drops nothing", async () => {
    const world = createDemoWorld();
    const npc = new NpcAgent(rook, new CountingProvider(), max);
    npc.state.hp = 1;
    const money = world.player.money;
    const r = await npc.attackedByPlayer(world);
    expect(npc.isDead).toBe(true);
    expect(r.spoils?.[0]).toMatch(/You take from Rook's body: forge hammer \[C\] x1, bread loaf \[G\] x2, 4 gold/);
    expect(world.player.inventory["forge hammer [C]"]).toBe(1);
    expect(world.player.money).toBe(money + 400);

    const smith = new NpcAgent(brena, new CountingProvider(), max);
    smith.state.hp = 1;
    const r2 = await smith.attackedByPlayer(createDemoWorld());
    expect(r2.spoils).toBeUndefined();
  });
});

describe("My father's hammer (N3.2 done-when)", () => {
  it("sends you against three bandit stat blocks and Rook; only Rook ever calls the model", async () => {
    const world = createDemoWorld();
    world.player.level = 10; // a B-tier job
    world.player.attributes.strength = 20;
    const state = createNpcState(brena);
    state.relationship = 60;
    state.respect = 20; // a B-tier job: she has to rate you (N5)
    // The chain (N9): Pell has said who has it; the next step is beating Rook.
    world.player.quests.completed.push("hammer_whereabouts");
    state.pendingQuest = "hammer_rook";
    expect(acceptQuest(brena, state, world.player)?.id).toBe("hammer_rook");

    // Taking it brings out his guards, at his camp.
    const creatures: Record<string, Creature> = {};
    const ledger: SpawnLedger = {};
    const rules = loadSpawnRules();
    applySpawnRules(rules, templates, creatures, ledger, { ...world, recentEvents: [] }, max);
    const guards = ledger.rook_guards!.uids.map((uid) => creatures[uid]!);
    expect(guards).toHaveLength(3);
    for (const g of guards) expect(denKey(rules, ledger, g)).toBe("bandit_camp");

    // The guards: fought entirely in code.
    for (const g of guards) {
      for (let round = 0; round < 20 && !g.outcome; round++) fightCreature(templates.bandit!, g, world, max);
      expect(g.outcome).not.toBeNull();
    }

    // Rook talks, then fights: the only model calls.
    const llm = new CountingProvider();
    const leader = new NpcAgent(rook, llm, max);
    await leader.respond("I've come for the smith's hammer.", world);
    for (let round = 0; round < 20 && !leader.isDead; round++) await leader.attackedByPlayer(world);
    expect(leader.isDead).toBe(true);
    expect(llm.calls).toBeGreaterThan(0);

    // Rook is beaten; then the hammer goes home.
    world.player.hp = world.player.maxHp;
    expect(turnInQuests(brena, state, world).completed.map((q) => q.id)).toEqual(["hammer_rook"]);
    state.pendingQuest = "fathers_hammer";
    expect(acceptQuest(brena, state, world.player)?.id).toBe("fathers_hammer");
    const done = turnInQuests(brena, state, world);
    expect(done.completed.map((q) => q.id)).toEqual(["fathers_hammer"]);
  });
});
