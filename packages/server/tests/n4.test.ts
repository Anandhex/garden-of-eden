import { describe, expect, it } from "vitest";
import { passVillage } from "../src/game/village.js";
import { applyAction, parseAction, socialCheck, toolsFor } from "../src/npc/actions.js";
import { describeNpcAppearance, describePlayerAppearance, markBloodied, noticeLine } from "../src/npc/appearance.js";
import { NpcAgent } from "../src/npc/NpcAgent.js";
import { detectIntroduction, learnName, maskPlayerName } from "../src/npc/names.js";
import { buildTurnMessage } from "../src/npc/persona.js";
import { activeQuirks } from "../src/npc/quirks.js";
import { createNpcState, startEncounter } from "../src/npc/state.js";
import { createDemoWorld } from "../src/world/world.js";
import { always, brena, call, ctxFor, FakeProvider, hale, pell, say, worldAt } from "./helpers.js";

const reveal = (c: ReturnType<typeof ctxFor>, secret: string) => {
  const parsed = parseAction("reveal_secret", { secret });
  if (!parsed.ok) throw new Error(parsed.error);
  return applyAction(parsed, c);
};
const tools = (c: ReturnType<typeof ctxFor>) => toolsFor(c).map((t) => t.name);

describe("N4.1 layered secrets", () => {
  it("an honest NPC with no cover tells the truth once trusted", () => {
    const c = ctxFor(brena, { relationship: 60 });
    const r = reveal(c, "vault_key");
    expect(r.lie).toBeUndefined();
    expect(r.message).toContain("hooded stranger");
    expect(c.world.player.facts).toContain("brena.vault_key");
    expect(c.world.player.journal!.some((e) => e.kind === "secret" && e.npc === "brena")).toBe(true);
  });

  it("Hale tells his cover story even when he trusts you, and the truth stays hidden", () => {
    const c = ctxFor(hale, { relationship: 80 }, createDemoWorld(), always(0.99));
    const r = reveal(c, "left_post");
    expect(r).toMatchObject({ ok: true, lie: true });
    expect(r.message).toContain("patrol");
    expect(r.message).not.toContain("cellar");
    expect(c.state.revealedSecrets).toEqual([]);
  });

  it("asked about that night, he's handed his story to stick to", () => {
    const c = ctxFor(hale, { relationship: 0 });
    const msg = buildTurnMessage(hale, c.state, c.world, "Where were you the night the gate was left unguarded?");
    expect(msg).toContain("stick to your story: you were out on patrol");
  });

  it("without trust or proof he won't even be offered the secret", () => {
    expect(tools(ctxFor(hale, { relationship: 0 }))).not.toContain("reveal_secret");
  });

  it("proof breaks him at any trust: what Pell told you", () => {
    const c = ctxFor(hale, { relationship: 0 });
    c.world.player.facts = ["pell.hale_cellar"];
    expect(tools(c)).toContain("reveal_secret");
    const msg = buildTurnMessage(hale, c.state, c.world, "Pell says you hid in his cellar that night.");
    expect(msg).toContain("Your story won't hold");
    const r = reveal(c, "left_post");
    expect(r.lie).toBeUndefined();
    expect(r.message).toContain("cellar");
    expect(c.state.revealedSecrets).toEqual(["left_post"]);
  });

  it("Pell telling his secret gives you the fact that breaks Hale", () => {
    const p = ctxFor(pell, { relationship: 80 }, createDemoWorld(), always(0.99)); // 0.99: no random lie
    expect(reveal(p, "hale_cellar").message).toContain("Hale");
    const h = ctxFor(hale, { relationship: 0 }, p.world);
    expect(reveal(h, "left_post").message).toContain("cellar");
  });

  it("a won intimidation today breaks him; tomorrow he's back to his story", () => {
    const c = ctxFor(hale, { relationship: 60 }, createDemoWorld(), always(0.99)); // rolls 20
    expect(socialCheck("intimidate", "Tell me the truth or else.", c).success).toBe(true);
    const r = reveal(c, "left_post");
    expect(r.message).toContain("cellar");

    const tomorrow = ctxFor(hale, { relationship: 60, wonCheckDay: { intimidate: 1 } }, worldAt(9, 2), always(0.99));
    expect(reveal(tomorrow, "left_post").message).toContain("patrol");
  });
});

describe("N4.2 quirks and tells", () => {
  const line = "Can you make me a sword?";
  it("the same question gets a different line mid-work at the forge than at supper", () => {
    const atWork = activeQuirks(brena, createNpcState(brena), worldAt(14), line);
    const atRest = activeQuirks(brena, createNpcState(brena), worldAt(20), line);
    expect(atWork[0]).toContain("mid-work at the anvil");
    expect(atRest[0]).toContain("off work");
    expect(atWork).not.toEqual(atRest);
    expect(buildTurnMessage(brena, createNpcState(brena), worldAt(14), line)).toContain("mid-work at the anvil");
  });

  it("a quirk shows only when its condition holds: Pell drops his voice with Hale nearby", () => {
    const w = worldAt(15);
    expect(activeQuirks(pell, createNpcState(pell), w, "Hello")).toEqual([]);
    w.present = ["hale"];
    expect(activeQuirks(pell, createNpcState(pell), w, "Hello")[0]).toContain("drop your voice");
  });

  it("at most two quirk lines, topic quirks first", () => {
    const w = worldAt(15);
    w.present = ["hale"];
    const lines = activeQuirks(pell, createNpcState(pell), w, "What about the mayor's tax?");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("mayor");
  });

  it("Hale gets shifty when the captain comes up", () => {
    expect(activeQuirks(hale, createNpcState(hale), worldAt(10), "Does the captain know?")[0]).toContain("shifty");
  });
});

describe("N4.3 learning the player's name", () => {
  it("detects introductions in code, but not 'I'm hungry'", () => {
    expect(detectIntroduction("Hi, I'm Anand.")).toBe("Anand");
    expect(detectIntroduction("My name is Anand Patil, smith.")).toBe("Anand Patil");
    expect(detectIntroduction("call me Ash")).toBe("Ash");
    expect(detectIntroduction("I'm hungry")).toBeNull();
    expect(detectIntroduction("I'm Sorry about that")).toBeNull();
  });

  it("the model never sees the real name until it's told", async () => {
    const llm = new FakeProvider([say("Hm."), say("Anand, is it.")]);
    const npc = new NpcAgent(brena, llm);
    const world = createDemoWorld();
    world.player.name = "Anand";
    await npc.respond("Good day.", world);
    expect(llm.lastUser()).not.toContain("Anand");
    expect(llm.lastUser()).toContain("a stranger you've never met");
    await npc.respond("I'm Anand.", world);
    expect(npc.state.knownName).toBe("Anand");
    expect(llm.lastUser()).toContain("They told you their name is Anand");
    expect(llm.lastUser()).toContain("call them your word for a stranger");
    npc.state.relationship = 30;
    expect(buildTurnMessage(brena, npc.state, world, "Well?")).toContain("Call them by name.");
  });

  it("a name is learned once, and a rumour never overrides being told", () => {
    const s = createNpcState(pell);
    expect(learnName(s, "Anand", "rumour", "Brena Ashford")).toBe(true);
    expect(learnName(s, "Anand", "rumour", "Brena Ashford")).toBe(false);
    expect(learnName(s, "Anand", "told")).toBe(true);
    expect(learnName(s, "Bob", "rumour")).toBe(false);
    expect(s.knownName).toBe("Anand");
  });

  it("masks the real name with what the NPC knows", () => {
    const s = createNpcState(brena);
    expect(maskPlayerName("Anand says hi. Anandi too.", { name: "Anand" }, s)).toBe("Traveler says hi. Anandi too.");
    s.knownName = "Ash"; // a false name they were given
    expect(maskPlayerName("Anand says hi.", { name: "Anand" }, s)).toBe("Ash says hi.");
  });

  it("Pell hears the name from Brena over supper, as a rumour", () => {
    const world = worldAt(19);
    world.player.name = "Anand";
    const b = createNpcState(brena, { knownName: "Anand", nameSource: { how: "told" } });
    const p = createNpcState(pell);
    passVillage([{ id: "brena", persona: brena, state: b }, { id: "pell", persona: pell, state: p }], world, 2, always(0));
    expect(p.knownName).toBe("Anand");
    expect(p.nameSource).toEqual({ how: "rumour", from: "Brena Ashford" });
    expect(buildTurnMessage(pell, p, world, "Evening.")).toContain("You've heard from Brena Ashford that their name is Anand");
  });

  it("greets a returning player as someone they know", () => {
    const s = createNpcState(brena, { metBefore: true, lastMetDay: 1, knownName: "Anand", nameSource: { how: "told" }, relationship: 30 });
    expect(buildTurnMessage(brena, s, worldAt(10, 4), "Hello again.")).toContain("You last saw them 3 days ago");
  });
});

describe("N4.4 appearances and /look", () => {
  it("the visible state follows HP, work, equipment and needs", () => {
    const s = createNpcState(brena, { hp: 20 });
    const look = describeNpcAppearance(brena, s, worldAt(14));
    expect(look).toContain("scorched leather apron");
    expect(look).toContain("badly wounded");
    expect(look).toContain("covered in soot");
    expect(look).toContain("forge hammer");
    s.needs.energy = 20;
    expect(describeNpcAppearance(brena, s, worldAt(20))).toContain("tired");
    expect(describeNpcAppearance(brena, s, worldAt(20))).not.toContain("soot");
  });

  it("she notices a bloody sword once, and again in a new encounter", () => {
    const world = worldAt(14);
    world.player.inventory["iron sword [D]"] = 1;
    world.player.equipment = { weapon: "iron sword [D]" };
    const s = createNpcState(brena);
    expect(noticeLine(brena, s, world)).toBeNull();
    markBloodied(world.player, world);
    expect(noticeLine(brena, s, world)).toContain("bloody");
    expect(noticeLine(brena, s, world)).toBeNull();
    startEncounter(s);
    expect(buildTurnMessage(brena, s, world, "Hello.")).toContain("You notice: their iron sword [D] is bloody");
    expect(describePlayerAppearance(world.player, world)).toContain("(bloody)");
  });

  it("a hit in a fight bloodies the player's weapon", async () => {
    const world = worldAt(14);
    world.player.equipment = { weapon: "dagger [E]" };
    const npc = new NpcAgent(brena, new FakeProvider([say("Argh!")]), always(0.95));
    await npc.attackedByPlayer(world);
    expect(world.player.bloodiedAt).toBeDefined();
  });

  it("loved gear outranks blood", () => {
    const world = worldAt(14);
    world.player.equipment = { weapon: "iron sword [B]" };
    markBloodied(world.player, world);
    expect(noticeLine(brena, createNpcState(brena), world)).toContain("just the kind you admire");
  });

  it("/look calls no model", () => {
    const llm = new FakeProvider([call("change_mood", { mood: "happy" })]);
    describeNpcAppearance(hale, createNpcState(hale), worldAt(10));
    expect(llm.requests).toHaveLength(0);
  });
});
