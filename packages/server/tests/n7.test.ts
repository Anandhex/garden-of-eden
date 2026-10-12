import { deathNewsId, heardNews } from "../src/game/deathNews.js";
import { beforeEach, describe, expect, it } from "vitest";
import { config } from "../src/config.js";
import { minPrice, npcPrice, playerAttack } from "../src/npc/actions.js";
import { createNpcState } from "../src/npc/state.js";
import { relationTo, isFriend } from "../src/npc/social.js";
import { passVillage } from "../src/game/village.js";
import { gossipTogether } from "../src/game/gossip.js";
import { confrontRumour, hearRumour, retold, seedRumours } from "../src/game/rumours.js";
import { firstImpression } from "../src/game/reputation.js";
import { chooseDilemma, dilemmasFor, presentDilemma } from "../src/game/dilemmas.js";
import { describeFactionView, factionMarkup, joinFaction, memberDiscount, shiftStanding, standingForDeed, standingWith, STANDING } from "../src/game/factions.js";
import { initiativeFor } from "../src/npc/initiative.js";
import { holdsGrudge } from "../src/npc/relationship.js";
import { stealTarget, steal, recognisesStolen } from "../src/game/stealth.js";
import { reportCrimes } from "../src/game/crime.js";
import { createDemoWorld } from "../src/world/world.js";
import { always, brena, ctxFor, hale, makeTown, pell, rook, wren } from "./helpers.js";
import type { NpcState } from "../src/npc/types.js";

beforeEach(() => {
  config.director = false;
  config.planning = false;
  config.summaries = false;
});

describe("N7 NPC-to-NPC relationships", () => {
  it("come from the NPC files: Brena and Pell are friends, Pell fears Rook", () => {
    const b = createNpcState(brena);
    const p = createNpcState(pell);
    expect(isFriend(b, "pell")).toBe(true);
    expect(isFriend(p, "brena")).toBe(true);
    expect(relationTo(p, "rook").fear).toBeGreaterThanOrEqual(50);
    expect(relationTo(b, "hale").respect).toBeLessThan(0);
  });

  it("survive a save round trip (createNpcState keeps saved values)", () => {
    const b = createNpcState(brena);
    b.npcRelations.pell!.affection = 90;
    const again = createNpcState(brena, JSON.parse(JSON.stringify(b)) as NpcState);
    expect(again.npcRelations.pell!.affection).toBe(90);
  });
});

describe("N7 done when: attack Brena, and Pell already knows by evening", () => {
  it("he's heard, he's wary, and he charges more", () => {
    const world = createDemoWorld();
    const members = [
      { id: "brena", persona: brena, state: createNpcState(brena) },
      { id: "pell", persona: pell, state: createNpcState(pell) },
    ];
    const fight = { persona: brena, state: members[0]!.state, world, rng: always(0.99) };
    playerAttack(fight);
    members[0]!.state.inCombat = false; // the player ran; she lives
    const ale = Object.keys(members[1]!.state.inventory).find((k) => k.startsWith("ale"))!;
    const before = minPrice(pell, members[1]!.state, ale, world)!;
    // 14:00 → 21:00: Brena eats at the Goose at 20:00, where Pell works.
    passVillage(members, world, 7, always(0.5));
    const p = members[1]!.state;
    expect(p.memories.some((m) => m.heardFrom === "Brena Ashford" && /attacked/.test(m.text))).toBe(true);
    expect(p.relationship).toBeLessThanOrEqual(-10);
    expect(minPrice(pell, p, ale, world)!).toBeGreaterThan(before);
    // The event itself now counts Pell among those who know it, and the town's view moved.
    const attack = world.events!.find((e) => e.kind === "attacked")!;
    expect(attack.knownBy).toContain("pell");
    expect(world.player.reputation!.trust).toBeLessThan(0);
  });
});

describe("N7 crimes: kill someone, and the guard brings it up", () => {
  it("a bounty follows once the guard hears, Hale opens with it, and won't trade until it's paid", () => {
    const town = makeTown();
    const world = town.world;
    const brenaAgent = town.agents.brena!;
    brenaAgent.state.hp = 1;
    playerAttack({ persona: brena, state: brenaAgent.state, world, rng: always(0.99) });
    expect(brenaAgent.isDead).toBe(true);
    // Hale is at the gate: he doesn't know yet (N13.0), so there's no bounty.
    town.consequences();
    expect(world.player.bounty ?? 0).toBe(0);
    // The news reaches him.
    heardNews({ id: "hale", persona: hale, state: town.agents.hale!.state }, deathNewsId("brena"), world, "certain");
    const lines = town.consequences();
    expect(world.player.bounty).toBeGreaterThanOrEqual(2000);
    expect(lines.some((l) => /murder of Brena Ashford/.test(l))).toBe(true);
    world.hour = 10;
    const opening = initiativeFor(hale, town.agents.hale!.state, world);
    expect(opening?.trigger).toBe("crime");
    expect(opening?.event).toMatch(/wanted for murder/);
  });

  it("hurting a bandit isn't a crime", () => {
    const town = makeTown();
    const rookAgent = town.agents.rook!;
    playerAttack({ persona: rook, state: rookAgent.state, world: town.world, rng: always(0.99) });
    town.world.events!.at(-1)!.knownBy!.push("hale");
    expect(reportCrimes(town.world, town.personas, ["hale"])).toEqual([]);
    expect(town.world.player.bounty ?? 0).toBe(0);
  });
});

describe("N7 reputation", () => {
  it("strangers start from what the town says: half of it, plus respect for deed titles", () => {
    const world = createDemoWorld();
    world.player.reputation = { trust: -20, fear: 30, respect: 10, affection: 0 };
    world.player.titles = [{ id: "giant_slayer", day: 1 }];
    const s = createNpcState(hale);
    expect(firstImpression(s, world.player, 1)).toBe(true);
    expect(s.relationship).toBe(-10);
    expect(s.fear).toBe(15);
    expect(s.respect).toBe(10);
    // Once only, and never for someone they've met.
    expect(firstImpression(s, world.player, 1)).toBe(false);
  });
});

describe("N7.1 rumours about NPCs", () => {
  it("Pell starts out knowing the false rumour about Brena; telling it loses accuracy", () => {
    const states = { brena: createNpcState(brena), pell: createNpcState(pell), hale: createNpcState(hale) };
    seedRumours({ brena, pell, hale }, states, 1);
    const r = states.pell.rumours["brena.thief"]!;
    expect(r.truth).toBe("false");
    expect(r.accuracy).toBe(1);
    expect(retold(r, "Old Pell", 1)!.accuracy).toBe(0.8);
    // Never told to the one it's about.
    gossipTogether([{ id: "pell", persona: pell, state: states.pell }, { id: "brena", persona: brena, state: states.brena }], 1, always(0.01));
    expect(states.brena.rumours["brena.thief"]).toBeUndefined();
  });

  it("a false rumour gets denied, angrily; a true one confirmed; the journal says which", () => {
    const world = createDemoWorld();
    const lie = confrontRumour(brena, "They say you're a thief.", world.player, 1)!;
    expect(lie.mood).toBe("angry");
    expect(lie.line).toMatch(/It's a lie/);
    const truth = confrontRumour(hale, "Folk say you take bribes.", world.player, 1)!;
    expect(truth.mood).toBeNull();
    expect(truth.line).toMatch(/It's true/);
    const notes = world.player.journal!.map((e) => e.text).join(" ");
    expect(notes).toMatch(/is a lie/);
    expect(notes).toMatch(/turned out to be true/);
  });

  it("a garbled rumour (too many retellings) stops spreading", () => {
    const s = createNpcState(pell);
    hearRumour(s, { about: "brena", fact: "x", text: "something", truth: "false", accuracy: 0.35, day: 1 });
    expect(retold(s.rumours["brena.x"]!, "Old Pell", 1)).toBeNull();
  });
});

describe("N7.2 moral dilemmas", () => {
  it("Hale's bribe comes up at the gate talk, and each option applies exactly its effects", () => {
    const take = createDemoWorld();
    const s = createNpcState(hale);
    expect(dilemmasFor(hale, s, "What's the toll at the gate?").map((d) => d.id)).toEqual(["smugglers_cart"]);
    presentDilemma(hale, s, "smugglers_cart");
    const r = chooseDilemma(hale, s, take, "take");
    expect(r.ok).toBe(true);
    expect(take.player.money).toBe(500 + 50);
    expect(take.player.standing!.guard).toBe(-15);
    expect(s.relationship).toBe(10);
    expect(s.dilemmasDone.smugglers_cart).toBe("take");
    // Settled: it doesn't come up again.
    expect(dilemmasFor(hale, s, "the gate")).toEqual([]);

    const refuse = createDemoWorld();
    const s2 = createNpcState(hale);
    presentDilemma(hale, s2, "smugglers_cart");
    chooseDilemma(hale, s2, refuse, "refuse");
    expect(s2.fear).toBe(15);
    expect(refuse.player.money).toBe(500);
    expect(refuse.player.standing!.guard).toBe(5);
  });

  it("Brena's only comes up once her secret is out", () => {
    const s = createNpcState(brena);
    expect(dilemmasFor(brena, s, "the mayor wants a word")).toEqual([]);
    s.revealedSecrets.push("vault_key");
    expect(dilemmasFor(brena, s, "the mayor wants a word").map((d) => d.id)).toEqual(["lie_to_mayor"]);
  });
});

describe("N7.3 factions", () => {
  it("hurting a guard lowers guard standing and raises bandit standing", () => {
    const world = createDemoWorld();
    standingForDeed(world.player, { persona: hale }, STANDING.attacked);
    expect(standingWith(world.player, "guard")).toBeLessThan(0);
    expect(standingWith(world.player, "bandits")).toBeGreaterThan(0);
  });

  it("done when: after helping the merchants, Pell gives a member's discount and Hale is warier", () => {
    const world = createDemoWorld();
    for (let i = 0; i < 6; i++) shiftStanding(world.player, "merchants", STANDING.questDone);
    expect(joinFaction(world.player, "merchants").ok).toBe(true);
    expect(memberDiscount(pell, world.player)).toBe(10);
    expect(standingWith(world.player, "guard")).toBeLessThanOrEqual(-15);
    expect(factionMarkup(hale, world.player)).toBeGreaterThan(0);
    expect(describeFactionView(hale, world.player)).toMatch(/wary/);
    // The member's discount shows in Pell's prices.
    const ps = createNpcState(pell);
    const ale = Object.keys(ps.inventory).find((k) => k.startsWith("ale"))!;
    expect(minPrice(pell, ps, ale, world)).toBe(Math.ceil(npcPrice(pell, ale, world, ps)! * 0.9));
  });

  it("joining one faction closes the door on its rivals", () => {
    const world = createDemoWorld();
    world.player.standing = { bandits: 70 };
    expect(joinFaction(world.player, "bandits").ok).toBe(true);
    world.player.standing.guard = 80;
    expect(joinFaction(world.player, "guard").ok).toBe(false);
  });
});

describe("N7.4 successors", () => {
  it("done when: if Brena dies, Wren runs the forge next day and refuses her killer", () => {
    const town = makeTown();
    const world = town.world;
    expect(town.agents.wren!.state.dormant).toBe(true);
    expect(town.placeOf("wren")).toBeNull();
    const b = town.agents.brena!;
    b.state.inventory = { "iron sword [D]": 4 };
    b.state.hp = 1;
    playerAttack({ persona: brena, state: b.state, world, rng: always(0.99) });
    const lines = town.consequences();
    expect(lines.some((l) => /Wren Tally takes over/.test(l))).toBe(true);
    const w = town.agents.wren!.state;
    expect(w.dormant).toBe(false);
    expect(w.inventory["iron sword [D]"]).toBe(3);
    expect(w.grudge?.blood).toBe(true);
    expect(holdsGrudge(w, world.day + 1)).toBe(true);
    // Next morning she's at the forge, and won't sell to the killer.
    world.day += 1;
    world.hour = 9;
    expect(town.placeOf("wren")).toBe("forge");
    const ctx = ctxFor(wren, {}, world);
    ctx.state = w;
    expect(w.memories.some((m) => /died at Traveler's hands/.test(m.text))).toBe(true);
  });

  it("a death fails the player's jobs for them and is news to everyone", () => {
    const town = makeTown();
    const world = town.world;
    world.player.quests.active.push({ id: "guard_ale", title: "Something for the long watch", description: "", tier: "G", minTrust: 0, objective: { type: "deliver", item: "ale", qty: 2 }, reward: { money: 50 }, giverId: "hale", giverName: "Corporal Hale" });
    town.agents.hale!.state.outcome = "dead";
    town.agents.hale!.state.deathCause = "old age";
    const lines = town.consequences();
    expect(world.player.quests.active).toHaveLength(0);
    expect(world.player.quests.failed).toContain("guard_ale");
    expect(world.recentEvents).toContain("news.death_hale");
    expect(lines.some((l) => /no one to take over/.test(l))).toBe(true);
  });
});

describe("N7.5 theft and stealth", () => {
  it("a busy NPC is easier to rob than one face to face", () => {
    const world = createDemoWorld();
    const s = createNpcState(brena);
    expect(stealTarget({ persona: brena, state: s, world, victim: "busy", witnesses: [] })).toBeLessThan(stealTarget({ persona: brena, state: s, world, victim: "face to face", witnesses: [] }));
    expect(stealTarget({ persona: brena, state: s, world, victim: "asleep", witnesses: [] })).toBeLessThan(stealTarget({ persona: brena, state: s, world, victim: "busy", witnesses: [] }));
  });

  it("done when: you lift a dagger mid-forge, but face to face you're caught", () => {
    const world = createDemoWorld();
    const busy = createNpcState(brena);
    const lifted = steal("dagger", { persona: brena, state: busy, world, rng: always(0.6), victim: "busy", witnesses: [] });
    expect(lifted.success).toBe(true);
    expect(world.player.inventory["dagger [E]"]).toBe(1);
    expect(world.player.stolen).toEqual([{ item: "dagger [E]", from: "brena", day: 1 }]);

    const face = createNpcState(brena);
    const caught = steal("dagger", { persona: brena, state: face, world, rng: always(0.6), victim: "face to face", witnesses: ["pell"] });
    expect(caught.success).toBe(false);
    expect(face.mood).toBe("angry");
    expect(holdsGrudge(face, 1)).toBe(true);
    expect(caught.event!.kind).toBe("theft-caught");
    expect(caught.event!.witnesses).toEqual(["brena", "pell"]);
    // Pell doesn't guard; once Hale hears of it, it's a crime.
    expect(reportCrimes(world, { brena, hale, pell }, ["hale"])).toEqual([]);
    caught.event!.knownBy!.push("hale");
    expect(reportCrimes(world, { brena, hale, pell }, ["hale"])).toHaveLength(1);
    expect(world.player.bounty).toBeGreaterThan(0);
  });

  it("selling a stolen piece back to its owner gets you caught", () => {
    const world = createDemoWorld();
    const s = createNpcState(brena);
    steal("dagger", { persona: brena, state: s, world, rng: always(0.6), victim: "busy", witnesses: [] });
    const e = recognisesStolen(brena, s, world, "dagger [E]", always(0.9));
    expect(e?.kind).toBe("theft-caught");
    expect(world.player.stolen).toEqual([]);
  });
});
