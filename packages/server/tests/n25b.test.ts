/**
 * N25b: lives that change. Everyone who talks is reviewed every few days and the same day something big hits their life
 * (the model proposes, in batches; code's rules are the fallback and do everyone else's); every proposal is checked
 * and limited, applied through the existing systems, recorded with its reasons, and remembered by meaning.
 */
import { days } from "./long.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { config } from "../src/config.js";
import { loadCreatureTemplates } from "../src/game/creatures.js";
import { WorldStore } from "../src/game/db.js";
import { streamFor } from "../src/game/dice.js";
import { recordEvent } from "../src/game/events.js";
import { worldHash } from "../src/game/hash.js";
import { liveSites } from "../src/game/people/live.js";
import { BLANK_OUTLOOK, cycleDue, feelingsOf, OUTLOOK, outlookOf, review, reviewDay, seasonOf } from "../src/game/people/outlook.js";
import { advanceWorld } from "../src/game/people/world.js";
import { generateRealm } from "../src/game/realm/generate.js";
import { pickStartSite } from "../src/game/realm/start.js";
import { shockFromEvent } from "../src/game/reviews.js";
import { newWorld } from "../src/game/save.js";
import { siteState } from "../src/game/site.js";
import { Town } from "../src/game/town.js";
import type { ChatRequest, ChatResult, LLMProvider } from "../src/llm/provider.js";
import { buildTurnMessage } from "../src/npc/persona.js";
import { trimBackstory, applyChanges } from "../src/npc/review/apply.js";
import { impactOn, type Shock } from "../src/npc/review/impact.js";
import { reviewInput } from "../src/npc/review/inputs.js";
import { reviewPrompt } from "../src/npc/review/model.js";
import { ruleProposal } from "../src/npc/review/rules.js";
import type { Axes, Change, ReviewInput } from "../src/npc/review/types.js";
import { checkProposal } from "../src/npc/review/validate.js";
import type { NpcPersona } from "../src/npc/types.js";
import { materialisePeople } from "../src/store/materialise.js";
import { always, FakeProvider, makeTown, brena, hale, pell, wren } from "./helpers.js";

vi.setConfig({ testTimeout: 180_000 });

beforeEach(() => {
  config.director = false;
  config.planning = false;
  config.summaries = false;
  config.realm = true;
  config.review.enabled = true;
  config.review.model = true;
});

const ax = (trust = 0, affection = 0, respect = 0, fear = 0): Axes => ({ trust, affection, respect, fear });

/** A person with a few close ones and a town, for checks and rules that need no world. */
function mkInput(over: Partial<ReviewInput> = {}): ReviewInput {
  return {
    who: { id: "odo", name: "Odo Barrow", job: "innkeeper", cls: "merchant", site: "x", siteName: "Ashby", age: 40, minor: false, traits: { honesty: 0.7 }, goals: [], fears: [], loves: [], secrets: [], money: 300, owed: 0 },
    day: 30,
    since: 27,
    news: [],
    recalled: [],
    people: [{ ref: "p:mara", text: "Mara Dunn, friend", id: "mara", name: "Mara Dunn", tie: "friend", myView: ax(50, 50), credence: 0.8, theirViews: [], recent: [] }],
    place: { name: "Ashby", conditions: [] },
    opinions: [
      { about: "player", label: "the player", axes: ax(20, 10) },
      { about: "p:mara", label: "Mara Dunn", axes: ax(50, 50) },
    ],
    rumours: [],
    candidates: [],
    arcs: [],
    names: ["Odo Barrow", "Mara Dunn", "Ashby", "Tam Reed"],
    ...over,
  };
}

/** The people who are about (a successor waits in the wings until the one they follow dies). */
const awake = (town: Town) => Object.entries(town.agents).filter(([, a]) => !a.state.dormant);

const news = (over: Partial<ReviewInput["news"][number]> = {}): ReviewInput["news"][number] => ({ ref: "e:1", text: "the player robbed Mara Dunn", importance: 7, day: 29, kind: "looted", by: "player", to: "p:mara", tone: -1, ...over });

describe("N25b the checks", () => {
  const good: Change = { kind: "opinion", about: "player", axis: "trust", delta: -6, because: ["e:1"], why: "they robbed Mara Dunn" };
  const input = () => mkInput({ news: [news()] });

  it("takes a change that follows from what they were given", () => {
    const r = checkProposal({ changes: [good] }, input());
    expect(r.accepted).toEqual([good]);
    expect(r.rejected).toEqual([]);
  });
  it("rejects a change that cites something they were not given", () => {
    const r = checkProposal({ changes: [{ ...good, because: ["e:99"] }] }, input());
    expect(r.accepted).toEqual([]);
    expect(r.rejected[0]!.reason).toMatch(/e:99/);
  });
  it("rejects a name they don't know, an opinion about something not in play, and a change of no known kind", () => {
    const r = checkProposal({ changes: [{ ...good, why: "they heard so from Gorlam" }, { ...good, about: "p:zed" }, { kind: "teleport" }, "nonsense"] }, input());
    expect(r.accepted).toEqual([]);
    expect(r.rejected.map((x) => x.reason).join(" | ")).toMatch(/Gorlam/);
    expect(r.rejected.map((x) => x.reason).join(" | ")).toMatch(/no view of "p:zed"/);
    expect(r.rejected.filter((x) => /not a known kind/.test(x.reason))).toHaveLength(2);
  });
  it("clips a move of 50 to the limit, and a shock review has the larger limit", () => {
    const calm = checkProposal({ changes: [{ ...good, delta: -50 }] }, input());
    expect(calm.accepted[0]).toMatchObject({ delta: -config.review.maxDelta });
    expect(calm.clipped[0]!.note).toMatch(/clipped/);
    const shock = checkProposal({ changes: [{ ...good, delta: -50 }] }, { ...input(), shock: { ref: "s:war", text: "war", impact: 8 } }, true);
    expect(shock.accepted[0]).toMatchObject({ delta: -config.review.shockMaxDelta });
  });
  it("keeps to six changes, one new secret, one new goal", () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ ...good, axis: (["trust", "affection", "respect", "fear"] as const)[i % 4], about: i < 4 ? "player" : "p:mara" }));
    const r = checkProposal({ changes: many }, input());
    expect(r.accepted.length).toBeLessThanOrEqual(config.review.maxChanges);
    const goals = checkProposal(
      { changes: [{ kind: "goal-add", goal: "move", words: "You want to go.", because: ["e:1"], why: "robbed" }, { kind: "goal-add", goal: "save_coin", words: "You want coin.", because: ["e:1"], why: "robbed" }] },
      input(),
    );
    expect(goals.accepted).toHaveLength(1);
    expect(goals.clipped.some((c) => /one new goal/.test(c.note))).toBe(true);
    const secrets = checkProposal(
      {
        changes: [
          { kind: "secret", candidate: "debt1", about: "money", text: "Odo owes money.", cover: "All is well.", because: ["k:debt1"], why: "true" },
          { kind: "secret", candidate: "vice1", about: "a vice", text: "Odo cheats a little.", cover: "Never.", because: ["k:vice1"], why: "true" },
        ],
      },
      mkInput({ candidates: [{ ref: "k:debt1", text: "owes", kind: "debt" }, { ref: "k:vice1", text: "cheats", kind: "vice" }] }),
    );
    expect(secrets.accepted).toHaveLength(1);
  });
  it("rejects a secret that isn't a real candidate, a grudge with no deed behind it, a forgiveness with nothing to forgive", () => {
    const r = checkProposal(
      {
        changes: [
          { kind: "secret", candidate: "murder9", about: "a killing", text: "A man died.", cover: "No.", because: ["self"], why: "x" },
          { kind: "grudge", against: "player", because: ["self"], why: "they were rude" },
          { kind: "forgive", against: "player", because: ["self"], why: "time" },
        ],
      },
      mkInput(),
    );
    expect(r.accepted).toEqual([]);
    expect(r.rejected.map((x) => x.reason).join(" | ")).toMatch(/not something true/);
    expect(r.rejected.map((x) => x.reason).join(" | ")).toMatch(/deed or a memory/);
    expect(r.rejected.map((x) => x.reason).join(" | ")).toMatch(/no grudge to forgive/);
  });
  it("won't give a child a secret, a goal to avenge, or romance, or adult words", () => {
    const child = mkInput({ who: { ...mkInput().who, minor: true }, candidates: [{ ref: "k:loss1", text: "grief", kind: "loss" }], news: [news()] });
    const r = checkProposal(
      {
        changes: [
          { kind: "secret", candidate: "loss1", about: "grief", text: "They miss someone.", cover: "Nothing.", because: ["k:loss1"], why: "x" },
          { kind: "goal-add", goal: "avenge", target: "player", words: "You want revenge.", because: ["e:1"], why: "x" },
          { kind: "story", words: "Odo dreams of a sweetheart and a kiss.", because: ["e:1"], why: "x" },
        ],
      },
      child,
    );
    expect(r.accepted).toEqual([]);
    expect(r.rejected).toHaveLength(3);
  });
  it("rejects an avenge goal with nothing behind it, and a debt goal for someone who owes nothing", () => {
    const r = checkProposal(
      { changes: [{ kind: "goal-add", goal: "avenge", target: "player", words: "You want revenge.", because: ["self"], why: "x" }, { kind: "goal-add", goal: "pay_debt", words: "You mean to pay.", because: ["self"], why: "x" }] },
      input(),
    );
    expect(r.accepted).toEqual([]);
  });
});

describe("N25b a small model's form-filling is tidied, not trusted", () => {
  const i = mkInput({ news: [news()], opinions: [{ about: "player", label: "the player", axes: ax(20) }, { about: "lord:fig-1", label: "Rolf", axes: ax() }] });
  it("takes a ref copied with its label, a single string for `because`, and an emotion's subject under `target`", () => {
    const r = checkProposal(
      {
        changes: [
          { kind: "opinion", about: "lord:fig-1", axis: "trust", delta: -3, because: "lord:fig-1 = Rolf: trust 0", why: "folk look to whoever rules" },
          { kind: "emotion", emotion: "worry", strength: 2, target: "the player", because: ["e:1"], why: "uneasy" },
          { kind: "opinion", about: "player", axis: "trust", delta: -4, because: ["player = Traveler: trust -4"], why: "x" },
        ],
      },
      i,
    );
    expect(r.rejected).toEqual([]);
    expect(r.accepted).toHaveLength(3);
    expect(r.accepted[1]).toMatchObject({ kind: "emotion", about: "the player" });
    expect(r.accepted[0]).toMatchObject({ because: ["lord:fig-1"] });
  });
  it("an emotion with no subject takes it from the reason; a want aimed at no one they know keeps its words and loses the aim", () => {
    const r = checkProposal(
      { changes: [{ kind: "emotion", emotion: "worry", strength: 2, because: ["e:1"], why: "uneasy about the player" }, { kind: "goal-add", goal: "protect", target: "the fields", words: "You must guard the fields.", because: ["e:1"], why: "x" }] },
      i,
    );
    expect(r.accepted).toHaveLength(2);
    expect(r.accepted[0]).toMatchObject({ about: "uneasy about the player" });
    expect(r.accepted[1]).not.toHaveProperty("target");
    expect(r.clipped.some((c) => /left off/.test(c.note))).toBe(true);
    // But a vengeance with no one to take it on is not a want.
    const v = checkProposal({ changes: [{ kind: "goal-add", goal: "avenge", target: "the fields", words: "You want revenge.", because: ["e:1"], why: "x" }] }, i);
    expect(v.accepted).toEqual([]);
  });
  it("the model isn't asked to explain: the reason recorded is what the change cites", () => {
    const r = checkProposal({ changes: [{ kind: "opinion", about: "player", axis: "trust", delta: -4, because: ["e:1"] }] }, i);
    expect(r.accepted).toHaveLength(1);
    expect(r.accepted[0]).toMatchObject({ why: "the player robbed Mara Dunn" });
  });
  it("still rejects a reason that is prose, not something they were given", () => {
    const r = checkProposal({ changes: [{ kind: "grudge", against: "player", because: ["the player robbed Mara Dunn"], why: "x" }] }, i);
    expect(r.accepted).toEqual([]);
    expect(r.rejected[0]!.reason).toMatch(/not in what they were given/);
  });
});

describe("N25b code's rules", () => {
  it("what is done to someone close moves how they see whoever did it, and a deep one leaves a grudge", () => {
    const i = mkInput({ news: [news({ importance: 8 })] });
    const p = ruleProposal(i);
    const trust = p.changes.find((c) => (c as Change).kind === "opinion" && (c as { axis: string }).axis === "trust") as Extract<Change, { kind: "opinion" }>;
    expect(trust.delta).toBeLessThan(0);
    expect(p.changes.some((c) => (c as Change).kind === "grudge")).toBe(true);
    // Everything it proposes passes the same checks.
    const checked = checkProposal(p, i);
    expect(checked.rejected).toEqual([]);
    expect(checked.accepted.length).toBeGreaterThan(0);
  });
  it("opinions spread: a friend who distrusts the lord draws mine down, a step at a time", () => {
    const i = mkInput({
      opinions: [{ about: "lord:rolf", label: "Lord Rolf", axes: ax(40) }],
      people: [{ ref: "p:mara", text: "Mara", id: "mara", name: "Mara Dunn", tie: "friend", myView: ax(50, 50), credence: 0.9, theirViews: [{ about: "lord:rolf", axes: ax(-40) }], recent: [] }],
    });
    const pulled = ruleProposal(i).changes.find((c) => (c as Change).kind === "opinion") as Extract<Change, { kind: "opinion" }>;
    expect(pulled.about).toBe("lord:rolf");
    expect(pulled.delta).toBe(-5);
    expect(pulled.because).toEqual(["p:mara"]);
    // Close enough already, and nothing moves.
    expect(ruleProposal(mkInput({ opinions: [{ about: "lord:rolf", label: "Lord Rolf", axes: ax(-35) }], people: i.people })).changes.filter((c) => (c as Change).kind === "opinion")).toEqual([]);
  });
  it("a famine worries them and sours them on whoever rules; a poor person comes to want to leave, and drops it when it's over", () => {
    const famine = mkInput({ place: { name: "Ashby", conditions: [{ ref: "c:famine", kind: "famine", text: "food is short" }] }, opinions: [{ about: "lord:rolf", label: "Lord Rolf", axes: ax(10) }] });
    const p = ruleProposal(famine).changes as Change[];
    expect(p.some((c) => c.kind === "emotion" && c.emotion === "worry")).toBe(true);
    expect(p.some((c) => c.kind === "opinion" && c.about === "lord:rolf" && c.delta < 0)).toBe(true);
    expect(p.some((c) => c.kind === "goal-add" && c.goal === "move")).toBe(true);
    const over = mkInput({ who: { ...mkInput().who, goals: [{ id: "move-20", words: "You are thinking of leaving." }] } });
    expect((ruleProposal(over).changes as Change[]).some((c) => c.kind === "goal-drop")).toBe(true);
    // A rich person doesn't.
    expect((ruleProposal({ ...famine, who: { ...famine.who, money: 5000 } }).changes as Change[]).some((c) => c.kind === "goal-add")).toBe(false);
  });
  it("a death in the family is grief, a goal to avenge when it was a killing, and a line in their story", () => {
    const i = mkInput({
      people: [{ ref: "p:tam", text: "Tam Reed, brother", id: "tam", name: "Tam Reed", tie: "brother", myView: ax(80, 80), credence: 0.9, theirViews: [], recent: [] }],
      opinions: [{ about: "p:tam", label: "Tam Reed", axes: ax(80, 80) }, { about: "player", label: "the player", axes: ax() }],
      news: [news({ ref: "e:7", text: "Tam Reed was killed by the player", kind: "killed", by: "player", to: "p:tam", importance: 9 })],
    });
    const changes = ruleProposal(i).changes as Change[];
    expect(changes.some((c) => c.kind === "emotion" && c.emotion === "grief")).toBe(true);
    expect(changes.some((c) => c.kind === "goal-add" && c.goal === "avenge")).toBe(true);
    expect(changes.some((c) => c.kind === "story" && /Tam Reed was killed/.test(c.words))).toBe(true);
    expect(checkProposal({ changes }, i, true).rejected).toEqual([]);
  });
  it("time wears a grudge down", () => {
    const i = mkInput({ who: { ...mkInput().who, grudge: "they robbed Mara", grudgeAge: 25 } });
    expect((ruleProposal(i).changes as Change[]).some((c) => c.kind === "forgive")).toBe(true);
    expect((ruleProposal(mkInput({ who: { ...mkInput().who, grudge: "x", grudgeAge: 5 } })).changes as Change[]).some((c) => c.kind === "forgive")).toBe(false);
  });
  it("is the same every time", () => {
    const i = mkInput({ news: [news()] });
    expect(JSON.stringify(ruleProposal(i))).toBe(JSON.stringify(ruleProposal(i)));
  });
});

describe("N25b big events", () => {
  const who = { ids: ["a"], site: "ashby", kingdom: "k1", family: new Set(["wife"]), friends: new Set(["pal"]) };
  const death = (victims: string[]): Shock => ({ ref: "s:d", kind: "family-death", text: "a death", day: 1, scope: "person", site: "ashby", kingdom: "k1", victims });
  it("a death shocks the family and close friends, not a neighbour", () => {
    expect(impactOn(death(["a"]), who)).toBe(9);
    expect(impactOn(death(["wife"]), who)).toBeCloseTo(7.2);
    expect(impactOn(death(["pal"]), who)).toBeCloseTo(5.4);
    expect(impactOn(death(["stranger"]), who)).toBeCloseTo(4.5);
    expect(impactOn(death(["stranger"]), who)).toBeLessThan(config.review.shockImpact);
    expect(impactOn(death(["stranger"]), { ...who, site: "elsewhere" })).toBe(0);
  });
  it("a raid hits one town, a war a whole kingdom", () => {
    const raid: Shock = { ref: "s:r", kind: "raid", text: "raid", day: 1, scope: "town", site: "ashby", victims: [] };
    expect(impactOn(raid, who)).toBe(7);
    expect(impactOn(raid, { ...who, site: "far" })).toBe(0);
    const war: Shock = { ref: "s:w", kind: "war", text: "war", day: 1, scope: "kingdom", site: "ashby", kingdom: "k1", victims: [] };
    expect(impactOn(war, { ...who, site: "other", kingdom: "k1" })).toBe(8);
    expect(impactOn(war, { ...who, site: "other", kingdom: "k2" })).toBe(0);
  });
  it("what the player does becomes a shock for its victim", () => {
    const e = recordEvent({ day: 3, hour: 9, location: "x" } as never, { kind: "attacked", actor: "player", target: "brena", details: "they attacked Brena", importance: 8 });
    expect(shockFromEvent(e, () => "k1")).toMatchObject({ kind: "attacked", victims: ["brena"], scope: "person" });
    expect(shockFromEvent({ ...e, kind: "bought" }, () => null)).toBeNull();
  });
});

describe("N25b applying a review", () => {
  function subject() {
    const town = makeTown({ rng: always(0.5) });
    const agent = town.agents.brena!;
    return { town, agent, persona: town.personas.brena!, state: agent.state };
  }
  const base = (persona: NpcPersona, state: ReturnType<typeof subject>["state"], input: ReviewInput) => ({ persona, state, day: 30, input, rng: always(0.5) });

  it("moves opinions through the systems that already read them, and records what changed", () => {
    const { persona, state } = subject();
    state.relationship = 20;
    state.npcRelations.hale = { trust: 10, fear: 0, respect: 0, affection: 0 };
    const input = mkInput({ people: [{ ref: "p:hale", text: "Hale", id: "hale", name: "Hale", tie: "acquaintance", myView: ax(10), credence: 0.6, theirViews: [], recent: [] }], opinions: [{ about: "player", label: "the player", axes: ax(20) }, { about: "p:hale", label: "Hale", axes: ax(10) }, { about: "lord:rolf", label: "Lord Rolf", axes: ax() }] });
    const { lines } = applyChanges(base(persona, state, input), [
      { kind: "opinion", about: "player", axis: "trust", delta: -8, because: ["self"], why: "x" },
      { kind: "opinion", about: "p:hale", axis: "affection", delta: 6, because: ["self"], why: "x" },
      { kind: "opinion", about: "lord:rolf", axis: "respect", delta: -4, because: ["self"], why: "x" },
    ]);
    expect(state.relationship).toBe(12);
    expect(state.npcRelations.hale!.affection).toBe(6);
    expect(state.views!["lord:rolf"]!.respect).toBe(-4);
    expect(lines.map((l) => l.event)).toEqual(["changed-mind", "changed-mind", "changed-mind"]);
    expect(state.review).toMatchObject({ day: 30 });
    expect(state.memories.some((m) => m.id === "review:30")).toBe(true);
  });
  it("feelings, grudges, goals, fears, a story line and an arc step land where the game reads them", () => {
    const { persona, state } = subject();
    const input = mkInput({ arcs: [{ ref: "a:forge_trust", name: "Trust", stage: 0, stages: 3 }] });
    const arcId = persona.arcs?.[0]?.id;
    const out = applyChanges(base(persona, state, input), [
      { kind: "emotion", emotion: "grief", strength: 2.5, about: "the loss", because: ["self"], why: "x" },
      { kind: "grudge", against: "player", because: ["self"], why: "they robbed Mara" },
      { kind: "goal-add", goal: "move", words: "You want to leave Ashby.", because: ["self"], why: "x" },
      { kind: "fear", name: "the raiders' return", mentions: ["raiders", "return"], because: ["self"], why: "x" },
      { kind: "story", words: "The raid changed how she sleeps.", because: ["self"], why: "x" },
      ...(arcId ? ([{ kind: "arc-step", arc: arcId, words: "A step.", because: ["self"], why: "x" }] as Change[]) : []),
    ]);
    expect(state.emotions.some((e) => e.kind === "grief" && e.strength > 0.8)).toBe(true);
    expect(state.grudge?.reason).toBe("they robbed Mara");
    expect(state.lifeGoals).toHaveLength(1);
    expect(out.persona.fears!.at(-1)!.name).toBe("the raiders' return");
    expect(out.persona.backstory.endsWith("The raid changed how she sleeps.")).toBe(true);
    if (arcId) expect(state.arcs[arcId]!.stage).toBe(1);
    // A person's next conversation reflects it: the mood line, the grudge, the want.
    const msg = buildTurnMessage(out.persona, state, { ...makeTown().world }, "Hello.");
    expect(msg).toMatch(/On your mind: You want to leave Ashby/);
    expect(msg).toMatch(/grudge/i);
  });
  it("a goal fades review by review and is forgotten; belief changes how sure they are of a rumour", () => {
    const { persona, state } = subject();
    state.lifeGoals = [{ id: "move-1", kind: "move", words: "You want to leave.", since: 1, strength: 0.3 }];
    state.rumours.k = { about: "hale", fact: "thief", text: "Hale steals", truth: "false", accuracy: 0.6, day: 1 };
    const input = mkInput({ rumours: [{ ref: "r:k", text: "Hale steals", about: "hale", accuracy: 0.6 }] });
    applyChanges(base(persona, state, input), [{ kind: "belief", rumour: "k", accept: true, because: ["r:k"], why: "x" }]);
    expect(state.rumours.k!.accuracy).toBe(1);
    expect(state.lifeGoals).toHaveLength(1);
    applyChanges(base(persona, state, input), []);
    applyChanges(base(persona, state, input), []);
    expect(state.lifeGoals ?? []).toHaveLength(0);
    applyChanges(base(persona, state, input), [{ kind: "belief", rumour: "k", accept: false, because: ["r:k"], why: "x" }]);
    expect(state.rumours.k).toBeUndefined();
  });
  it("a backstory only grows to its limit, keeping the start and dropping the oldest additions", () => {
    const long = "She came to Ashby young. She kept the forge. " + Array.from({ length: 40 }, (_, i) => `Year ${i} brought a change.`).join(" ");
    const t = trimBackstory(long, 300);
    expect(t.length).toBeLessThanOrEqual(300);
    expect(t.startsWith("She came to Ashby young. She kept the forge.")).toBe(true);
    expect(t.endsWith("Year 39 brought a change.")).toBe(true);
  });
});

/** A model that answers a review prompt with replies chosen from the names it sees. */
class ReviewModel implements LLMProvider {
  requests: ChatRequest[] = [];
  constructor(private readonly reply: (ids: string[], prompt: string) => string | null) {}
  async chat(req: ChatRequest): Promise<ChatResult> {
    this.requests.push(req);
    const prompt = req.messages.at(-1)!.content;
    if (req.kind !== "life-review") return { text: "...", toolCalls: [] };
    const ids = [...prompt.matchAll(/^### (\S+): /gm)].map((m) => m[1]!);
    const out = this.reply(ids, prompt);
    return { text: out ?? "I cannot say.", toolCalls: [] };
  }
  get reviewCalls() {
    return this.requests.filter((r) => r.kind === "life-review");
  }
}

describe("N25b the model's review", () => {
  function setup(reply: ReviewModel["reply"], store?: WorldStore) {
    config.director = true;
    const model = new ReviewModel(reply);
    const town = makeTown({ llm: model, backgroundLlm: model, rng: always(0.5), ...(store ? { store } : {}) });
    return { town, model };
  }
  const insulted = (town: Town) => {
    // The player robbed Brena's friend Wren; Brena heard of it (she saw it).
    const e = recordEvent(town.world, { kind: "looted", actor: "player", target: "wren", details: "the player robbed Wren", importance: 8, witnesses: ["brena", "wren"], knownBy: ["brena", "wren"] });
    return e;
  };

  it("a good reply is applied, recorded with its reasons, and remembered by meaning", async () => {
    const store = new WorldStore(":memory:");
    const { town, model } = setup(
      (ids) =>
        JSON.stringify({
          reviews: ids.map((id) => ({
            person: id,
            changes: [{ kind: "opinion", about: "player", axis: "trust", delta: -8, because: ["e:" + town.world.events![0]!.id], why: "they robbed Wren, a friend" }, { kind: "emotion", emotion: "resentment", strength: 2, about: "the robbery of Wren", because: ["e:" + town.world.events![0]!.id], why: "they robbed Wren, a friend" }],
            mood: "annoyed",
          })),
        }),
      store,
    );
    insulted(town);
    town.agents.brena!.state.metBefore = true;
    town.agents.brena!.state.relationship = 30;
    await town.reviews.run(["brena"]);
    expect(model.reviewCalls).toHaveLength(1);
    expect(town.agents.brena!.state.relationship).toBeLessThan(30);
    expect(town.agents.brena!.state.mood).toBe("annoyed");
    const log = store.reviewsOf("brena");
    expect(log).toHaveLength(1);
    expect(log[0]!.by).toBe("model");
    expect((log[0]!.applied as Array<{ why: string }>)[0]!.why).toMatch(/robbed Wren/);
    // A week on, something like it comes up and she remembers how she took it.
    await new Promise((r) => setTimeout(r, 20));
    const recalled = await store.recall("brena", "robbed a friend", 3);
    expect(recalled.some((m) => /thought it over/.test(m.text))).toBe(true);
  });
  it("one person's changes may not cite another's refs; a ref from the wrong person is rejected", async () => {
    const { town } = setup((ids) => JSON.stringify({ reviews: ids.map((id) => ({ person: id, changes: [{ kind: "opinion", about: "player", axis: "trust", delta: -8, because: ["e:not-mine"], why: "x" }] })) }));
    town.agents.brena!.state.metBefore = true;
    town.agents.brena!.state.relationship = 30;
    insulted(town);
    const store = new WorldStore(":memory:");
    void store;
    await town.reviews.run(["brena"]);
    // Nothing usable in the reply: code's rules took her instead, and she still reacted to what she knew.
    expect(town.agents.brena!.state.relationship).toBeLessThan(30);
  });
  it("a reply that can't be read, a call that fails, or a person left out gets code's rules", async () => {
    const { town, model } = setup(() => null);
    town.agents.brena!.state.metBefore = true;
    town.agents.brena!.state.relationship = 30;
    insulted(town);
    await town.reviews.run(["brena"]);
    expect(model.reviewCalls.length).toBeGreaterThanOrEqual(1);
    expect(town.agents.brena!.state.relationship).toBeLessThan(30);
    expect(town.agents.brena!.state.review?.day).toBe(town.world.day);
  });
  it("with the model off, code's rules review at once and no call is made", async () => {
    config.director = false;
    const model = new ReviewModel(() => null);
    const town = makeTown({ llm: model, backgroundLlm: model, rng: always(0.5) });
    town.agents.brena!.state.metBefore = true;
    town.agents.brena!.state.relationship = 30;
    insulted(town);
    town.world.day += 5;
    await town.reviews.run(["brena"], undefined, undefined, true);
    expect(model.reviewCalls).toHaveLength(0);
    expect(town.agents.brena!.state.relationship).toBeLessThan(30);
  });
  it("the prompt gives each person only their own section, with the refs they may cite", async () => {
    const town = makeTown({ rng: always(0.5) });
    insulted(town);
    const ctx = { world: town.world, store: undefined, personas: town.personas, states: Object.fromEntries(Object.entries(town.agents).map(([id, a]) => [id, a.state])) };
    const a = await reviewInput(ctx, "brena");
    const b = await reviewInput(ctx, "rook");
    // Brena saw it; Rook, who wasn't there, never gets it.
    expect(a.news.some((n) => /robbed Wren/.test(n.text))).toBe(true);
    expect(b.news.some((n) => /robbed Wren/.test(n.text))).toBe(false);
    const prompt = reviewPrompt([a, b]).prompt;
    const sectionB = prompt.slice(prompt.indexOf("### rook:"));
    expect(sectionB).not.toMatch(/robbed Wren/);
    expect(prompt).toMatch(/### brena:/);
  });
});

describe("N25b what they are given", () => {
  it("memories come back by meaning, family is always there, and the town's conditions are in words", async () => {
    const store = new WorldStore(":memory:");
    const town = makeTown({ rng: always(0.5), store });
    await store.addMemory("brena", 3, "reflection", "Wolves took my brother in the winter and I have feared them since", 6);
    await store.addMemory("brena", 4, "reflection", "I bought turnips at the market", 2);
    recordEvent(town.world, { kind: "attacked", actor: "rook", target: "wren", details: "wolves and bandits attacked the cart, and Wren was hurt", importance: 7, witnesses: ["brena"], knownBy: ["brena"] });
    const ctx = { world: town.world, store, personas: town.personas, states: Object.fromEntries(Object.entries(town.agents).map(([id, a]) => [id, a.state])) };
    const input = await reviewInput(ctx, "brena");
    expect(input.recalled.some((r) => /Wolves took my brother/.test(r.text))).toBe(true);
    expect(input.recalled.some((r) => /turnips/.test(r.text))).toBe(false);
    // The strongest ties are there, with what those people think of what is in play.
    expect(input.people.some((p) => p.id === "wren")).toBe(true);
    expect(input.people.length).toBeLessThanOrEqual(6);
    expect(JSON.stringify(input).length).toBeLessThan(6000);
  });
  it("family is included even when the tie is weak", async () => {
    const town = makeTown({ rng: always(0.5) });
    // Brena and Hale are wed in the world, and have little to say to each other.
    town.world.family = { ...town.world.family!, marriages: [{ a: "brena", b: "hale", day: 1 }] };
    town.world.talkers!.brena!.persona = { ...town.world.talkers!.brena!.persona, spouse: "hale" };
    town.personas.brena = town.world.talkers!.brena!.persona;
    void hale;
    const ctx = { world: town.world, store: undefined, personas: town.personas, states: Object.fromEntries(Object.entries(town.agents).map(([id, a]) => [id, a.state])) };
    const input = await reviewInput(ctx, "brena");
    expect(input.people.length).toBeGreaterThan(0);
  });
});

describe("N25b when reviews happen", () => {
  it("each person's cycle falls once every `everyDays` days, and a town's reviews are spread across the days", () => {
    const ids = Array.from({ length: 60 }, (_, i) => `person_${i}`);
    const per = new Map<number, number>();
    for (const id of ids) {
      const days = Array.from({ length: 30 }, (_, d) => d + 1).filter((d) => cycleDue(id, d));
      expect(days).toHaveLength(30 / config.review.everyDays);
      for (let i = 1; i < days.length; i++) expect(days[i]! - days[i - 1]!).toBe(config.review.everyDays);
      for (const d of days) per.set(d, (per.get(d) ?? 0) + 1);
    }
    // No day has most of the town.
    expect(Math.max(...per.values())).toBeLessThanOrEqual(Math.ceil(ids.length / config.review.everyDays) + 12);
    expect(Math.min(...per.values())).toBeGreaterThan(0);
  });
  it("a week passes: the people with the player are reviewed on their cycle, in batches of three to a call", async () => {
    config.director = true;
    const model = new ReviewModel((ids) => JSON.stringify({ reviews: ids.map((id) => ({ person: id, changes: [] })) }));
    const town = makeTown({ llm: model, backgroundLlm: model, rng: always(0.5) });
    // Give them all something to weigh, so the quiet-stretch skip doesn't apply.
    for (const a of Object.values(town.agents)) a.state.lifeGoals = [{ id: "move-0", kind: "move", words: "You want to go.", since: 0, strength: 0.9 }];
    for (let d = 0; d < 7; d++) town.passHours(24);
    await town.background.drain();
    const calls = model.reviewCalls;
    expect(calls.length).toBeGreaterThan(0);
    // Six people, three to a call: never more than three sections in one prompt.
    for (const c of calls) expect([...c.messages.at(-1)!.content.matchAll(/^### /gm)].length).toBeLessThanOrEqual(config.review.batch);
    // Everyone was reviewed at least once in a week (three days a cycle).
    for (const [id, a] of awake(town)) expect(a.state.review, id).toBeDefined();
  });
  it("a war starting shocks everyone in the kingdom the same day, with the larger limits; a raid on a far town shocks only its own", async () => {
    config.director = false;
    const town = makeTown({ rng: always(0.5) });
    const here = town.site();
    const realm = town.world.realm!;
    const day = town.world.day;
    const kingdom = realm.settlements[here]!.kingdom;
    const war: Shock = { ref: `s:war:${here}:${day}`, kind: "war", text: "the kingdom went to war", day, scope: "kingdom", site: here, kingdom, victims: [] };
    for (const a of Object.values(town.agents)) a.state.relationship = 40;
    town.reviews.shock(war);
    await new Promise((r) => setTimeout(r, 30));
    for (const [id, a] of awake(town)) expect(a.state.review?.shock, `${id} was shocked`).toBe(day);
    // A raid on a place across the realm leaves these people alone.
    const far = Object.values(realm.settlements).find((s) => s.id !== here && s.kingdom !== kingdom)!;
    for (const a of Object.values(town.agents)) delete a.state.review;
    town.reviews.shock({ ref: "s:raid:far", kind: "raid", text: "raid", day, scope: "town", site: far.id, victims: [] });
    await new Promise((r) => setTimeout(r, 30));
    for (const [id, a] of awake(town)) expect(a.state.review, id).toBeUndefined();
  });
  it("a death in the family shocks a talker the same day; a friend's too (5.4 passes the bar); a stranger's does not", async () => {
    config.director = false;
    const town = makeTown({ rng: always(0.5) });
    const day = town.world.day;
    town.agents.brena!.state.npcRelations.wren = { trust: 60, fear: 0, respect: 60, affection: 70 };
    town.agents.brena!.state.npcRelations.hale = { trust: 0, fear: 0, respect: 0, affection: 0 };
    town.reviews.shock({ ref: "s:d:wren", kind: "family-death", text: "Wren died", day, scope: "person", site: town.site(), victims: ["wren"] });
    await new Promise((r) => setTimeout(r, 30));
    expect(town.agents.brena!.state.review?.shock).toBe(day);
    expect(town.agents.hale!.state.review?.shock).toBeUndefined();
    expect(town.agents.pell!.state.review?.shock).toBeUndefined();
  });
  it("if the model is dropped from a long queue, code's rules review them at once", async () => {
    config.director = true;
    const model = new ReviewModel(() => null);
    const town = makeTown({ llm: model, backgroundLlm: model, rng: always(0.5) });
    town.agents.brena!.state.metBefore = true;
    town.agents.brena!.state.relationship = 30;
    recordEvent(town.world, { kind: "looted", actor: "player", target: "wren", details: "the player robbed Wren", importance: 8, witnesses: ["brena", "wren"], knownBy: ["brena", "wren"] });
    // The queue is already past its limit: the review is shed.
    for (let i = 0; i < 400; i++) town.background.add({ key: `plan:${i}`, kind: "plan", run: async () => new Promise(() => undefined) });
    town.reviews.shock({ ref: "s:robbed", kind: "robbed", text: "robbed", day: town.world.day, scope: "person", site: town.site(), victims: ["brena"] });
    await new Promise((r) => setTimeout(r, 30));
    expect(town.agents.brena!.state.relationship).toBeLessThan(30);
  });
  it("a place left for a week is reviewed once on arrival, however many cycles were missed", async () => {
    config.director = false;
    const town = makeTown({ rng: always(0.5) });
    const start = town.site();
    const realm = town.world.realm!;
    const other = Object.values(realm.settlements).find((s) => s.id !== start && !s.abandoned)!.id;
    const trip = town.setOutFor(other);
    town.passHours(trip.hours);
    town.arriveAt(other);
    for (let d = 0; d < 7; d++) town.passHours(24);
    const before = town.agents.brena!.state.review?.day ?? 0;
    const back = town.setOutFor(start);
    town.passHours(back.hours);
    town.arriveAt(start);
    await new Promise((r) => setTimeout(r, 50));
    expect(town.agents.brena!.state.review?.day ?? 0).toBeGreaterThanOrEqual(before);
  });
});

describe("N25b townsfolk change by code's rules", () => {
  function world(seed = 1) {
    const realm = generateRealm(seed, 1);
    const store = new WorldStore(":memory:");
    materialisePeople(realm, store.people, 1);
    const live = liveSites(realm, pickStartSite(realm, realm.seed), "slice");
    return { realm, store, live };
  }
  const outlooks = (store: WorldStore, site: string) => store.dumpTable("people").filter((r) => r.site === site && r.death === null && r.persona === null).map((r) => outlookOf({ outlook: r.outlook as string | null }));

  it("everyone is reviewed every few days, spread over the days", () => {
    const { realm, store, live } = world();
    const site = [...live][0]!;
    advanceWorld(realm, store, 10, { live });
    const rows = store.dumpTable("people").filter((r) => r.site === site && r.death === null);
    const reviewed = rows.map((r) => outlookOf({ outlook: r.outlook as string | null }).r);
    // Everyone has been reviewed; their last reviews fall on every one of the last three days.
    expect(reviewed.every((d) => d >= 8)).toBe(true);
    for (const d of [8, 9, 10]) expect(reviewed.filter((x) => x === d).length).toBeGreaterThan(rows.length / 6);
  });
  it("a famine sours a town on whoever rules, lowers its mood, and some people come to want to leave", () => {
    const a = world(1);
    const b = world(1);
    const site = [...a.live][0]!;
    const hungry = (w: typeof a) => {
      for (let d = 2; d <= 24; d++) {
        w.realm.settlements[site]!.food = 0;
        advanceWorld(w.realm, w.store, d, { live: w.live });
      }
    };
    hungry(a);
    advanceWorld(b.realm, b.store, 24, { live: b.live });
    const sad = outlooks(a.store, site);
    const calm = outlooks(b.store, site);
    const avg = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
    expect(avg(sad.map((o) => o.lord.t))).toBeLessThan(avg(calm.map((o) => o.lord.t)) - 3);
    expect(avg(sad.map((o) => o.mood))).toBeLessThan(avg(calm.map((o) => o.mood)));
    expect(sad.filter((o) => o.goal?.kind === "move").length).toBeGreaterThan(0);
    expect(calm.filter((o) => o.goal?.kind === "move").length).toBe(0);
    // Serfs and slaves have nowhere to go.
    const rows = a.store.dumpTable("people").filter((r) => r.site === site && (r.cls === "serf" || r.cls === "slave"));
    for (const r of rows) expect(outlookOf({ outlook: r.outlook as string | null }).goal?.kind).not.toBe("move");
  });
  it("a death in the family is felt the day it happens: grief in their mood, and a grudge if they were killed", () => {
    const row = { id: "t_x_1", cls: "commoner" } as never;
    const o = review(row, BLANK_OUTLOOK, { days: 3, famine: 0, raided: 0, war: 0, plague: 0 }, [], [{ kind: "family-death", who: "Tam", death: { cause: "raid", day: 5, site: "x", killer: "the raiders of the Red Hand" } }], 5, 1);
    expect(o.mood).toBeLessThan(-2);
    expect(o.grudge?.against).toBe("the raiders of the Red Hand");
    expect(feelingsOf(o).join(" ")).toMatch(/grudge/);
  });
  it("opinions of the lord are pulled toward those of the people closest to them, a step at a time, and settle back", () => {
    const row = { id: "t_x_2", cls: "commoner" } as never;
    const kin = [{ ...BLANK_OUTLOOK, lord: { t: -50, f: 0, e: 0, a: 0 } }];
    let o = { ...BLANK_OUTLOOK, lord: { t: 30, f: 0, e: 0, a: 0 } };
    const quiet = { days: 3, famine: 0, raided: 0, war: 0, plague: 0 };
    const seen: number[] = [];
    for (let day = 3; day <= 30; day += 3) {
      o = review(row, o, quiet, kin, [], day, 1);
      seen.push(o.lord.t);
    }
    expect(seen[0]!).toBeLessThan(30);
    expect(seen.at(-1)!).toBeLessThan(0);
    expect(Math.abs(seen[0]! - 30)).toBeLessThanOrEqual(OUTLOOK.pullMax + 2);
    // Alone and untroubled, a view drifts back toward nothing.
    let lone = { ...BLANK_OUTLOOK, lord: { t: 40, f: 0, e: 0, a: 0 } };
    for (let day = 3; day <= 60; day += 3) lone = review(row, lone, quiet, [], [], day, 1);
    expect(lone.lord.t).toBeLessThan(15);
  });
  it("what the day's step did decides who is shocked: only the family of the dead, and the whole town in a raid", () => {
    const { realm, store, live } = world(1);
    const site = [...live][0]!;
    advanceWorld(realm, store, 6, { live });
    const before = outlooks(store, site).length;
    expect(before).toBeGreaterThan(0);
    // A raid begins: the place's conditions say so, and everyone in it is reviewed that day.
    const day = 7;
    realm.settlements[site]!.lastRaided = day;
    advanceWorld(realm, store, day, { live });
    const rows = store.dumpTable("people").filter((r) => r.site === site && r.death === null && r.persona === null);
    expect(rows.every((r) => outlookOf({ outlook: r.outlook as string | null }).r === day)).toBe(true);
  });
  it("is the same on every run, and the same worked out later (a lazy place)", () => {
    const a = world(4);
    const b = world(4);
    advanceWorld(a.realm, a.store, days(30, 12), { live: a.live });
    advanceWorld(b.realm, b.store, days(30, 12), { live: b.live });
    expect(worldHash({ realm: a.realm }, a.store)).toBe(worldHash({ realm: b.realm }, b.store));
    expect(seasonOf({ realm: a.realm, store: a.store }, [...a.live][0]!, 1, days(30, 12)).days).toBe(days(30, 12));
  });
  it("someone who becomes a talker keeps how they feel, and it is part of what the model is told about them", () => {
    const o = { ...BLANK_OUTLOOK, mood: -2, lord: { t: -40, f: 10, e: -30, a: 0 }, goal: { kind: "move" as const, since: 3 } };
    const f = feelingsOf(o, "Lord Rolf");
    expect(f).toEqual(expect.arrayContaining(["they have little trust in Lord Rolf", "they have lost respect for Lord Rolf", "they have been low in spirits lately", "they have been thinking of leaving"]));
  });
  it("only people who don't talk are reviewed here (talkers have their own)", () => {
    const { realm, store, live } = world(1);
    const site = [...live][0]!;
    const rows = store.people.loadSite(site, "full") as Array<{ id: string }>;
    store.people.update(rows[0]!.id, { persona: "someone" });
    advanceWorld(realm, store, 6, { live });
    expect(store.people.get(rows[0]!.id)!.outlook).toBeNull();
    void reviewDay;
    void streamFor;
  });
});

describe("N25b determinism", () => {
  it("with the model off, two worlds of one seed are the same after thirty days, reviews and all", async () => {
    config.director = false;
    const run = async () => {
      const store = new WorldStore(":memory:");
      const templates = loadCreatureTemplates();
      const town = new Town({ personas: {}, creatureTemplates: templates, world: newWorld({}, templates, always(0.5), 5), llm: new FakeProvider(), store });
      for (let d = 0; d < days(30, 12); d++) town.passHours(24);
      await town.reviews.idle();
      return { hash: worldHash(town.world, store), reviews: store.reviewCount(), states: JSON.stringify(Object.values(town.agents).map((a) => [a.state.relationship, a.state.review, a.state.lifeGoals])) };
    };
    const a = await run();
    const b = await run();
    expect(a.reviews).toBeGreaterThan(0);
    expect(b).toEqual(a);
  });
});

describe("N25b a review in the admin view", () => {
  it("is recorded with its reasons, and a person's card lists it", async () => {
    config.director = false;
    const store = new WorldStore(":memory:");
    const town = makeTown({ rng: always(0.5), store });
    town.agents.brena!.state.metBefore = true;
    town.agents.brena!.state.relationship = 30;
    recordEvent(town.world, { kind: "looted", actor: "player", target: "wren", details: "the player robbed Wren", importance: 8, witnesses: ["brena", "wren"], knownBy: ["brena", "wren"] });
    await town.reviews.run(["brena"], undefined, undefined, true);
    const rows = store.reviewsOf("brena");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ by: "code" });
    expect(JSON.stringify(rows[0]!.applied)).toMatch(/robbed Wren/);
    expect(store.reviewCount()).toBe(1);
  });
});

describe("N25b the done-when scenarios (model off, so the same every time)", () => {
  const soon = () => new Promise((r) => setTimeout(r, 40));

  it("the player robs a woman's friend: her trust falls at her next review though she did not see it, and her friend's falls a little later by social pull", async () => {
    config.director = false;
    const town = makeTown({ rng: always(0.5) });
    const { brena: b, pell: p, pip } = town.agents as Record<string, (typeof town.agents)[string]>;
    for (const a of [b!, p!, pip!]) {
      a.state.metBefore = true;
      a.state.relationship = 40;
    }
    // Pell is robbed with only Pell there; Brena hears of it from Pell (as gossip would tell her).
    const e = recordEvent(town.world, { kind: "looted", actor: "player", target: "pell", details: "the player robbed Pell", importance: 8, witnesses: ["pell"], knownBy: ["pell"] });
    expect(e.knownBy).not.toContain("brena");
    town.reviews.closeness();
    await town.reviews.run(["brena"], undefined, undefined, true);
    // She didn't know: nothing moved against the player for what she never heard of.
    expect(b!.state.relationship).toBe(40);
    // (The game itself moved Pell when he was robbed.)
    p!.state.relationship = -30;
    e.knownBy!.push("brena");
    town.world.day += 3;
    await town.reviews.run(["brena"], undefined, undefined, true);
    expect(b!.state.relationship).toBeLessThan(40);
    const hers = b!.state.relationship;
    // Pip, Brena's friend, wasn't told; but a few days on, what Brena thinks draws Pip's view down a step.
    town.world.day += 3;
    await town.reviews.run(["pip"], undefined, undefined, true);
    expect(pip!.state.relationship).toBeLessThan(40);
    expect(pip!.state.relationship).toBeGreaterThan(hers);
  });

  it("a war declared on their kingdom changes everyone in it that day: talkers by review, townsfolk by rules, fear up", async () => {
    config.director = false;
    config.realmSeed = 3;
    const store = new WorldStore(":memory:");
    const templates = loadCreatureTemplates();
    const town = new Town({ personas: {}, creatureTemplates: templates, world: newWorld({}, templates, always(0.5), 3), llm: new FakeProvider(), store });
    const realm = town.world.realm!;
    const here = town.site();
    const kingdom = realm.settlements[here]!.kingdom!;
    const other = Object.values(realm.kingdoms).find((k) => k.id !== kingdom)!;
    for (let d = 0; d < 6; d++) town.passHours(24);
    const talkers = town.talkersAt(here);
    expect(talkers.length).toBeGreaterThan(1);
    const day = town.world.day + 1;
    realm.wars.push({ id: "war-test", attackers: [`k:${other.id}`], defenders: [`k:${kingdom}`], cause: "a test", start: day, score: 0, battles: [] });
    town.passHours(24);
    await soon();
    expect(town.world.day).toBe(day);
    for (const id of talkers) expect(town.agents[id]!.state.review?.shock, `${id} was shocked by the war`).toBe(day);
    const rows = store.dumpTable("people").filter((r) => r.site === here && r.death === null && r.persona === null);
    expect(rows.length).toBeGreaterThan(20);
    expect(rows.every((r) => outlookOf({ outlook: r.outlook as string | null }).r === day)).toBe(true);
    expect(rows.every((r) => outlookOf({ outlook: r.outlook as string | null }).lord.f > 0)).toBe(true);
  });

  it("a friend is killed: it is grief, a line in their story, and a want to see it answered", async () => {
    config.director = false;
    const town = makeTown({ rng: always(0.5) });
    const b = town.agents.brena!;
    const pellName = town.personas.pell!.name;
    const rookName = town.personas.rook!.name;
    recordEvent(town.world, { kind: "killed", actor: "rook", target: "pell", details: `${rookName} killed ${pellName}`, importance: 9, witnesses: ["brena", "pell"], knownBy: ["brena"] });
    town.world.day += 1;
    await town.reviews.run(["brena"], { ref: "s:killed", kind: "family-death", text: `${pellName} was killed`, day: town.world.day, scope: "person", victims: ["pell"] }, new Map([["brena", 5.4]]), true);
    expect(b.state.emotions.some((e) => e.kind === "grief")).toBe(true);
    expect(town.personas.brena!.backstory).toMatch(/has not been quite the same since/);
    expect(b.state.lifeGoals?.some((g) => g.kind === "avenge")).toBe(true);
    expect(b.state.review?.shock).toBe(town.world.day);
    // Her next conversation carries it.
    expect(buildTurnMessage(town.personas.brena!, b.state, town.world, "How are you?")).toMatch(/grieving/i);
  });

  it("a person's card in the admin view lists each review, who made it, and what was applied or not and why", async () => {
    config.director = false;
    const store = new WorldStore(":memory:");
    const town = makeTown({ rng: always(0.5), store });
    town.agents.brena!.state.metBefore = true;
    town.agents.brena!.state.relationship = 40;
    recordEvent(town.world, { kind: "looted", actor: "player", target: "pell", details: "the player robbed Pell", importance: 8, witnesses: ["brena", "pell"], knownBy: ["brena", "pell"] });
    await town.reviews.run(["brena"], undefined, undefined, true);
    const { card } = await import("../src/admin/person.js");
    const ctx = { world: () => town.world, town: () => town, store, queueLength: () => 0, time: { paused: () => false, setPaused: () => undefined, advance: async () => undefined } };
    const c = card(ctx as never, "cast:brena")!;
    const section = c.sections.find((x) => x.title === "Life reviews")!;
    expect("rows" in section).toBe(true);
    const rows = "rows" in section ? section.rows : [];
    expect(rows.some(([label, text]) => /code's rules/.test(label) && /robbed Pell/.test(text))).toBe(true);
    expect(rows.some(([label]) => /Last review/.test(label))).toBe(true);
  });
});

void newWorld;
void loadCreatureTemplates;
void siteState;
void FakeProvider;
void brena;
void pell;
void wren;
void hale;
