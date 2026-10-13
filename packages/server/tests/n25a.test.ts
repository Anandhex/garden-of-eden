/**
 * N25a: a world without a centre. The lint (tests/centre.test.ts) keeps Millbrook and the cast out of the code;
 * these are the behaviours: the start town is picked by the seed, every talker is generated and has depth
 * (secrets, fears, loves, dilemmas, arcs, services and kin) from their real history, the model's words are
 * checked field by field, and nothing hand-written is loaded.
 */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import { config } from "../src/config.js";
import { loadCreatureTemplates } from "../src/game/creatures.js";
import { WorldStore } from "../src/game/db.js";
import { openWorld } from "../src/game/openWorld.js";
import { lieges } from "../src/game/realm/generate.js";
import { marketOffsetOf } from "../src/game/events-calendar.js";
import { nearestTo, pickStartSite, startable } from "../src/game/realm/start.js";
import { siteState } from "../src/game/site.js";
import { newWorld } from "../src/game/save.js";
import { Town } from "../src/game/town.js";
import { applyDepth, applyStory, deepen, factsFor } from "../src/npc/depth/index.js";
import { loadPools } from "../src/npc/depth/pools.js";
import { StorySchema, type Story } from "../src/npc/depth/story.js";
import { checkStory } from "../src/npc/depth/validate.js";
import { fallbackDepth } from "../src/npc/depth/fallback.js";
import { lintCast } from "../src/npc/lint.js";
import { parsePersona } from "../src/npc/personaSchema.js";
import type { ChatRequest, ChatResult, LLMProvider } from "../src/llm/provider.js";
import { parseTownsfolkId } from "../src/game/realm/townsfolk.js";
import { siteMap } from "../src/web/sites.js";
import { always, FakeProvider } from "./helpers.js";
import { streamFor } from "../src/game/dice.js";
import type { NpcPersona } from "../src/npc/types.js";

beforeEach(() => {
  config.director = false;
  config.planning = false;
  config.summaries = false;
  config.realm = true;
  config.realmSeed = undefined;
});

/** A generated world's town, with everyone its start town has made (no model). */
function worldTown(seed: number, store?: WorldStore, stories = false, bg?: LLMProvider): Town {
  const templates = loadCreatureTemplates();
  return new Town({ personas: {}, creatureTemplates: templates, world: newWorld({}, templates, always(0.5), seed), llm: new FakeProvider(), ...(bg ? { backgroundLlm: bg } : {}), ...(store ? { store } : {}), stories });
}

/** Everyone the notables of every place give, over some seeds: a broad cast for the mechanics to be found in. */
function wideCast(seeds: number[]): NpcPersona[] {
  return seeds.flatMap((seed) => {
    const town = worldTown(seed);
    for (const id of Object.keys(town.world.realm!.settlements)) town.meetNotables(id);
    return Object.values(town.personas);
  });
}

describe("N25a the start town", () => {
  it("is picked by the seed: the same seed, the same town, one that makes a good first hour", () => {
    const seen = new Set<string>();
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const a = worldTown(seed);
      const b = worldTown(seed);
      expect(a.world.startSite).toBe(b.world.startSite);
      expect(a.world.player.site).toBe(a.world.startSite);
      expect(pickStartSite(a.world.realm!, a.world.seed)).toBe(a.world.startSite);
      const s = a.world.realm!.settlements[a.world.startSite!]!;
      expect(startable(s), `${s.name} should have an inn, a smithy and two roads`).toBe(true);
      seen.add(a.world.startSite!);
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  it("is a place like any other: its head and notables are generated talkers, and its head has work to give", () => {
    const town = worldTown(1);
    const site = town.world.startSite!;
    const ids = town.talkersAt(site);
    expect(ids.length).toBeGreaterThan(2);
    for (const id of ids) expect(id).toMatch(/^f_/);
    const head = town.personas[town.world.realm!.figures[town.world.realm!.settlements[site]!.leader!]!.talks!]!;
    expect((head.quests ?? []).length + (town.agents[head.id]!.state.questBoard?.length ?? 0)).toBeGreaterThan(0);
  });
});

describe("N25a nothing hand-written is loaded", () => {
  it("the game has no persona files, and a new world's talkers are all generated", () => {
    const src = fileURLToPath(new URL("../src/data/", import.meta.url));
    expect(existsSync(`${src}npcs`)).toBe(false);
    expect(existsSync(`${src}world.json`)).toBe(false);
    expect(existsSync(`${src}spawns.json`)).toBe(false);
    const town = worldTown(2);
    for (const id of Object.keys(town.personas)) expect(id).toMatch(/^(f_|t_)/);
  });
});

describe("N25a generated depth, from code", () => {
  const cast = wideCast([1, 2, 3, 4]);

  it("every generated talker has fears, loves, quirks, an arc and what the town says of them", () => {
    expect(cast.length).toBeGreaterThan(50);
    for (const p of cast) {
      expect(p.fears?.length, `${p.name} fears`).toBeGreaterThan(0);
      expect(p.loves?.length, `${p.name} loves`).toBeGreaterThan(0);
      expect(p.quirks?.length, `${p.name} quirks`).toBeGreaterThan(0);
      expect(p.arcs?.length, `${p.name} arcs`).toBeGreaterThan(0);
      expect(p.reputationFacts?.length, `${p.name} reputation`).toBeGreaterThan(0);
    }
  });

  it("every mechanic of N4 to N9 has material in the generated cast", () => {
    const some = (f: (p: NpcPersona) => unknown) => cast.filter((p) => f(p)).length;
    expect(some((p) => p.secrets.length > 0), "secrets (N4)").toBeGreaterThan(0);
    expect(some((p) => p.secrets.some((s) => s.cover && (s.breaksWith ?? []).length > 0)), "cover stories that can break (N4)").toBeGreaterThan(0);
    expect(some((p) => p.fears?.length), "fears (N5)").toBeGreaterThan(50);
    expect(some((p) => p.loves?.some((l) => l.item)), "loves you can give (N5)").toBeGreaterThan(0);
    expect(some((p) => p.signature), "signatures (N6)").toBeGreaterThan(0);
    expect(some((p) => p.services?.length), "services (N6)").toBeGreaterThan(0);
    expect(some((p) => p.dilemmas?.length), "dilemmas (N7)").toBeGreaterThan(0);
    expect(some((p) => p.debts?.length), "debts (N7)").toBeGreaterThan(0);
    expect(some((p) => p.hire), "companions for hire (N8)").toBeGreaterThan(0);
    expect(some((p) => p.arcs?.length), "arcs (N9)").toBeGreaterThan(50);
  });

  it("a secret always has a real fact behind it, and a debt secret a real debt", () => {
    for (const p of cast) {
      for (const s of p.secrets) {
        expect(s.text.length).toBeGreaterThan(20);
        expect(s.text).not.toMatch(/\{\w+\}/);
        if (s.debt) expect((p.debts ?? []).some((d) => d.id === s.debt), `${p.name}: ${s.id} names its debt`).toBe(true);
      }
    }
  });

  it("no placeholder is left in any generated word", () => {
    for (const p of cast) expect(JSON.stringify(p), p.name).not.toMatch(/\{(name|first|place|job|job_place|lost|creditor|subject|fact)\}/);
  });

  it("an arc's stages are all reachable: each waits only for a day after the first, in order", () => {
    for (const p of cast) {
      for (const arc of p.arcs ?? []) {
        let last = 0;
        arc.stages.forEach((s, i) => {
          if (i === 0) return expect(s.requires).toBeUndefined();
          expect(s.requires?.day, `${p.name} ${arc.id}`).toBeGreaterThan(last);
          last = s.requires!.day!;
        });
      }
    }
  });

  it("a child gets no adult secrets, no companion hire, and nothing a minor shouldn't have", () => {
    const town = worldTown(2);
    const adult = Object.values(town.personas).find((p) => p.template === "innkeeper" || p.template === "smith")!;
    const child: NpcPersona = { ...adult, id: "t_kid", name: "Pip Small", age: 9, minor: true, template: "child", guard: undefined, startingMoney: 0 };
    const ctx = { realm: town.world.realm!, people: null, events: [], day: 1, talkers: { ...town.world.talkers!, t_kid: { site: town.world.startSite!, persona: child } } };
    const sheet = factsFor(ctx, child);
    // Even with an adult's candidates on the sheet, only a grief is fit for a child to carry.
    const withCrimes = { ...sheet, secrets: [{ id: "crime1", kind: "crime" as const, fact: "Pip Small stole", knownBy: [] }, { id: "debt1", kind: "debt" as const, fact: "x", creditor: "y", knownBy: [] }, { id: "vice1", kind: "vice" as const, fact: "z", knownBy: [] }] };
    const d = fallbackDepth(withCrimes, child, 1, streamFor(1, "kid"));
    expect(d.secrets).toEqual([]);
    expect(d.hire).toBeUndefined();
    expect(d.signature).toBeUndefined();
    expect(d.dilemmas.every((x) => x.id !== "look_away")).toBe(true);
  });

  it("the same seed gives the same depth", () => {
    expect(JSON.stringify(wideCast([5]))).toBe(JSON.stringify(wideCast([5])));
  });

  it("generated people pass the authoring lint", () => {
    const byId = Object.fromEntries(cast.map((p) => [p.id, p]));
    expect(lintCast(byId)).toEqual({});
  });

  it("the pools are valid and name no one", () => {
    const pools = loadPools();
    expect(pools.fears.length + pools.loves.length + pools.quirks.length + pools.secrets.length + pools.dilemmas.length + pools.arcs.length + pools.reputation.length).toBeGreaterThan(60);
    expect(JSON.stringify(pools)).not.toMatch(/Brena|Hale|Pell|Rook|Millbrook|Voss/);
  });
});

describe("N25a depth from a townsperson's real family", () => {
  it("someone who lost a child to a beast fears the woods, and says so in a secret", () => {
    const store = new WorldStore(":memory:");
    const town = worldTown(1, store);
    const site = town.world.startSite!;
    const realm = town.world.realm!;
    const roster = town.rosterAt(site, siteMap(realm.settlements[site]!, "village", realm))!;
    const adult = roster.people.find((x) => x.cls === "commoner" && x.job === "labourer")!;
    // A dead child of theirs, in the database: lost to a beast.
    store.people.insertMany([{ id: "t_lost_1", site, n: 9000, name: "Little Wren", gender: "female", species: "human", born_day: -2000, cls: "commoner", job: "child", home: 0, work: null, master: null, master_id: null, faction: null, mother: adult.id, father: null, spouse: null, figure: null, persona: null, traits: null, death: JSON.stringify({ cause: "beast", day: -20, site: null }), expecting: null, last_birth: null, stepped_day: 0, outlook: null, rev: 0 }]);
    const id = town.meetTownsperson(roster, adult)!;
    const p = town.personas[id]!;
    const sheet = factsFor({ realm, people: store.people, events: [], day: town.world.day, talkers: town.world.talkers! }, p);
    expect(sheet.family.some((r) => r.name === "Little Wren" && !r.alive && r.cause === "a beast")).toBe(true);
    expect(sheet.secrets.some((c) => c.kind === "loss")).toBe(true);
    expect(p.fears?.some((f) => /wolves|woods/.test(f.name))).toBe(true);
    expect(p.goals.join(" ")).toContain("Little Wren");
  });
});

/** A person from a seed: the sheet and the persona to check a model's reply against. */
function subject() {
  const town = worldTown(2);
  const site = town.world.startSite!;
  const p = town.talkersAt(site).map((id) => town.personas[id]!).find((x) => x.template === "innkeeper") ?? Object.values(town.personas)[0]!;
  const ctx = { realm: town.world.realm!, people: null, events: [], day: town.world.day, talkers: town.world.talkers! };
  const sheet = factsFor(ctx, p);
  const base = fallbackDepth(sheet, p, town.world.day, streamFor(1, "t"));
  return { town, p, sheet, base, rng: streamFor(1, "t2") };
}

/** A reply the validator should take whole. */
function goodStory(s: ReturnType<typeof subject>): Story {
  const c = s.sheet.secrets[0];
  const neighbour = s.sheet.neighbours[0]?.name ?? s.sheet.siteName;
  return StorySchema.parse({
    backstory: `${s.p.name} has kept the books of ${s.sheet.siteName} for longer than most remember, and trusts ${neighbour} with little.`,
    personality: ["careful", "dry"],
    speechStyle: "Speaks slowly and counts under their breath.",
    appearance: "A tall, stooped figure in a clean apron.",
    quirks: [{ line: "You straighten the nearest cup whenever someone mentions money.", topic: ["money", "coin"] }],
    fears: [{ name: "a bad winter", words: ["winter", "snow"], because: "the stores are always thin" }],
    loves: [{ name: "a quiet corner", words: ["quiet", "corner"], because: "it is where the day ends" }],
    secrets: c ? [{ candidate: c.id, about: "what the books really say", text: `${s.p.name} has been juggling the books to hide how little the business makes.`, cover: "The books are in order." }] : [],
    dilemmas: [],
    arcs: [],
    goals: ["Keep the doors open", "See the debt cleared"],
    reputationFacts: [{ text: `${s.p.name.split(" ")[0]} always counts the change twice.`, keywords: ["change", "counts"] }],
  });
}

describe("N25a the model's story is checked, field by field", () => {
  it("a good reply is taken whole", () => {
    const s = subject();
    const r = checkStory(goodStory(s), s.sheet, s.p, s.base, 1, s.rng);
    expect(r.rejected).toEqual({});
    expect(r.accepted).toEqual(expect.arrayContaining(["backstory", "personality", "speechStyle", "appearance", "quirks", "fears", "loves", "goals", "reputationFacts"]));
    expect(r.depth.backstory).toContain("kept the books");
    expect(r.depth.written.length).toBeGreaterThan(5);
  });

  it("a name that isn't on the sheet is rejected; code's words stand there", () => {
    const s = subject();
    const story = { ...goodStory(s), backstory: `${s.p.name} was raised by Gorlam the Tinker far away.` };
    const r = checkStory(story, s.sheet, s.p, s.base, 1, s.rng);
    expect(r.rejected.backstory).toMatch(/Gorlam/);
    expect(r.depth.backstory).toBeUndefined();
    expect(r.accepted).toContain("fears");
  });

  it("a secret that isn't a real candidate is rejected", () => {
    const s = subject();
    const story = { ...goodStory(s), secrets: [{ candidate: "murder9", about: "a killing", text: "They killed a man long ago.", cover: "Never." }] };
    const r = checkStory(story, s.sheet, s.p, s.base, 1, s.rng);
    expect(r.rejected.secrets).toMatch(/no such secret/);
    expect(r.depth.secrets).toEqual(s.base.secrets);
  });

  it("a reply that makes a living relative dead (or a dead one alive) is rejected", () => {
    const s = subject();
    const sheet = { ...s.sheet, family: [{ name: "Tomas Reed", kind: "spouse" as const, alive: true }, { name: "Edda Reed", kind: "child" as const, alive: false, cause: "a beast" }], names: [...s.sheet.names, "Tomas Reed", "Edda Reed", "Tomas", "Edda", "Reed"] };
    const dead = checkStory({ ...goodStory(s), backstory: `${s.p.name} lost Tomas Reed to a fever years ago. Tomas died young.` }, sheet, s.p, s.base, 1, s.rng);
    expect(dead.rejected.backstory).toMatch(/Tomas Reed is dead/);
    const alive = checkStory({ ...goodStory(s), backstory: `${s.p.name} is raising Edda Reed, who is still alive and lives with them.` }, sheet, s.p, s.base, 1, s.rng);
    expect(alive.rejected.backstory).toMatch(/Edda Reed is alive/);
    const widow = checkStory({ ...goodStory(s), backstory: `${s.p.name} is a widow of ${s.sheet.siteName}.` }, sheet, s.p, s.base, 1, s.rng);
    expect(widow.rejected.backstory).toMatch(/widow/);
  });

  it("romance or drink in a child's words is rejected", () => {
    const s = subject();
    const child = { ...s.p, minor: true };
    const r = checkStory({ ...goodStory(s), backstory: `${s.p.name} dreams of a sweetheart and a kiss behind the barn.` }, s.sheet, child, s.base, 1, s.rng);
    expect(r.rejected.backstory).toMatch(/adult/);
  });

  it("a crime the record doesn't bear out is rejected from what the town says", () => {
    const s = subject();
    const sheet = { ...s.sheet, secrets: [], deeds: [] };
    const r = checkStory({ ...goodStory(s), reputationFacts: [{ text: `${s.p.name.split(" ")[0]} is a thief, they say.`, keywords: ["thief"] }] }, sheet, s.p, s.base, 1, s.rng);
    expect(r.rejected.reputationFacts).toMatch(/crime/);
  });

  it("personality words that contradict the numbers are rejected", () => {
    const s = subject();
    const brave = { ...s.p, traits: { ...s.p.traits, bravery: 0.9 } };
    const r = checkStory({ ...goodStory(s), personality: ["cowardly", "timid"] }, s.sheet, brave, s.base, 1, s.rng);
    expect(r.rejected.personality).toMatch(/cowardly/);
  });

  it("a dilemma of a kind that doesn't hold for them is rejected", () => {
    const s = subject();
    const r = checkStory({ ...goodStory(s), dilemmas: [{ kind: "bribe", offer: "Look away for coin.", yes: "take it", no: "refuse" }] }, s.sheet, s.p, s.base, 1, s.rng);
    expect(r.rejected.dilemmas).toBeDefined();
  });

  it("the accepted result is a valid persona, and a secret the player has heard is never swapped", () => {
    const s = subject();
    const r = checkStory(goodStory(s), s.sheet, s.p, s.base, 1, s.rng);
    expect(() => parsePersona(JSON.parse(JSON.stringify(applyDepth(s.p, r.depth))))).not.toThrow();
  });
});

describe("N25a the model writes a talker's story in the background", () => {
  /** A model that answers each person's prompt with a reply about them. */
  class StoryModel implements LLMProvider {
    calls = 0;
    constructor(private readonly reply: (name: string, prompt: string) => string | null) {}
    async chat(req: ChatRequest): Promise<ChatResult> {
      this.calls++;
      const text = req.messages.at(-1)!.content;
      const name = /Name: ([^,]+),/.exec(text)?.[1] ?? "";
      const out = this.reply(name, text);
      return { text: out ?? "no", toolCalls: [] };
    }
  }

  it("a good reply is applied and recorded; code's words stand until then, and for any field that fails", async () => {
    config.director = true;
    const model = new StoryModel((name) =>
      JSON.stringify({
        backstory: `${name} came to this place as a young person and never found a reason to leave.`,
        personality: ["steady", "wry"],
        speechStyle: "Plain words, a dry joke now and then.",
        appearance: "Weathered, with kind eyes.",
        quirks: [{ line: "You hum when you think no one is listening.", topic: ["song", "music"] }],
        fears: [{ name: "deep water", words: ["river", "drowning"], because: "a cousin drowned" }],
        loves: [],
        secrets: [{ candidate: "murder9", about: "a killing", text: "A man died by their hand.", cover: "Never." }],
        dilemmas: [],
        arcs: [],
        goals: ["Keep things as they are", "See a good harvest"],
        reputationFacts: [],
      }),
    );
    const town = worldTown(1, undefined, true, model);
    const ids = Object.keys(town.personas);
    const before = JSON.stringify(town.personas[ids[0]!]!.fears);
    expect(before).toBeDefined();
    await town.background.drain();
    // A minute a story is too long a queue for all five at once: the rest are asked for on the days after, three a day.
    const first = Object.values(town.world.talkers!).filter((t) => t.written).length;
    expect(first).toBeGreaterThan(0);
    for (let d = 0; d < 3 && Object.values(town.world.talkers!).some((t) => !t.written); d++) {
      town.passHours(24);
      await town.background.drain();
    }
    expect(model.calls).toBeGreaterThanOrEqual(ids.length);
    for (const id of ids) {
      const p = town.personas[id]!;
      const t = town.world.talkers![id]!;
      expect(p.backstory).toContain("never found a reason to leave");
      expect(p.fears?.map((f) => f.name)).toEqual(["deep water"]);
      expect(p.goals).toEqual(["Keep things as they are", "See a good harvest"]);
      expect(t.written?.fields).toEqual(expect.arrayContaining(["backstory", "fears", "goals"]));
      expect(t.written?.rejected.secrets).toMatch(/no such secret/);
      // The invented secret was not taken: code's stand.
      expect(p.secrets.every((s) => !/died by their hand/.test(s.text))).toBe(true);
      expect(p.loves?.length).toBeGreaterThan(0);
      expect(parsePersona(JSON.parse(JSON.stringify(p)))).toBeDefined();
    }
  });

  it("a model that fails changes nothing", async () => {
    config.director = true;
    const model = new StoryModel(() => null);
    const town = worldTown(1, undefined, true, model);
    const quiet = worldTown(1);
    await town.background.drain();
    expect(JSON.stringify(town.personas)).toBe(JSON.stringify(quiet.personas));
    expect(Object.values(town.world.talkers!).every((t) => !t.written)).toBe(true);
  });

  it("a story the model didn't give (shed, or failed) is asked for again on a later day, a few at a time", async () => {
    config.director = true;
    let working = false;
    const model = new StoryModel((name) => (working ? JSON.stringify({ backstory: `${name} has lived here a long while and knows everyone by their step.`, personality: ["steady", "dry"] }) : null));
    const town = worldTown(1, undefined, true, model);
    await town.background.drain();
    expect(Object.values(town.world.talkers!).every((t) => !t.written)).toBe(true);
    working = true;
    town.passHours(24);
    await town.background.drain();
    const written = Object.values(town.world.talkers!).filter((t) => t.written).length;
    expect(written).toBeGreaterThan(0);
    expect(written).toBeLessThanOrEqual(3);
    town.passHours(24);
    await town.background.drain();
    expect(Object.values(town.world.talkers!).filter((t) => t.written).length).toBeGreaterThan(written);
  });

  it("with the model off, no call is made", async () => {
    config.director = false;
    const model = new StoryModel(() => null);
    worldTown(1, undefined, true, model);
    expect(model.calls).toBe(0);
  });

  it("a secret already told, a dilemma settled or an arc moved is never swapped under the player", () => {
    const town = worldTown(1);
    const p = Object.values(town.personas).find((x) => x.secrets.length > 0 && (x.dilemmas?.length ?? 0) > 0 && (x.arcs?.length ?? 0) > 0)!;
    const sheet = factsFor({ realm: town.world.realm!, people: null, events: [], day: 1, talkers: town.world.talkers! }, p);
    const base = fallbackDepth(sheet, p, 1, streamFor(1, "z"));
    const swapped = { ...base, secrets: [{ ...p.secrets[0]!, id: "other", text: "A different secret altogether, long enough to see." }], debts: [], dilemmas: [{ ...p.dilemmas![0]!, id: "other_dilemma" }], arcs: [{ ...p.arcs![0]!, id: "other_arc" }] };
    const all = ["secrets", "dilemmas", "arcs"];
    // Untouched: the model's replace code's.
    const fresh = applyStory(p, swapped, all, { revealedSecrets: [], dilemmasDone: {}, arcs: {} });
    expect(fresh.secrets.map((x) => x.id)).toEqual(["other"]);
    expect(fresh.dilemmas!.map((x) => x.id)).toEqual(["other_dilemma"]);
    expect(fresh.arcs!.map((x) => x.id)).toEqual(["other_arc"]);
    // Played with: code's stay.
    const played = applyStory(p, swapped, all, { revealedSecrets: [p.secrets[0]!.id], dilemmasDone: { [p.dilemmas![0]!.id]: "take" }, arcs: { [p.arcs![0]!.id]: { stage: 1, day: 2 } } });
    expect(played.secrets).toEqual(p.secrets);
    expect(played.dilemmas).toEqual(p.dilemmas);
    expect(played.arcs).toEqual(p.arcs);
  });
});

describe("N25a deepening is plain code", () => {
  it("deepen() gives the same persona and sheet for the same inputs, with no model", () => {
    const town = worldTown(3);
    const p = Object.values(town.personas)[0]!;
    const ctx = { realm: town.world.realm!, people: null, events: [], day: 1, talkers: town.world.talkers! };
    const a = deepen(ctx, p, 3);
    const b = deepen(ctx, p, 3);
    expect(JSON.stringify(a.persona)).toBe(JSON.stringify(b.persona));
    expect(parseTownsfolkId(p.id)).toBeNull();
  });
});

describe("N25a the same systems at every place", () => {
  /** Go to a place: set out, let the hours pass, arrive. */
  function goTo(town: Town, site: string): void {
    const trip = town.setOutFor(site);
    expect(trip.ok, `a road to ${site}`).toBe(true);
    town.passHours(trip.hours);
    town.arriveAt(site);
    expect(town.site()).toBe(site);
  }

  it.each([1, 2, 3])("seed %i: the start village, a town and the capital run the same day", (seed) => {
    const town = worldTown(seed);
    const realm = town.world.realm!;
    const start = town.site();
    const places = [start, lieges(realm, start)[0]!.id, lieges(realm, start).at(-1)!.id];
    expect(new Set(places).size).toBe(3);
    for (const site of places) {
      if (site !== start) goTo(town, site);
      const talkers = town.talkersAt(site);
      expect(talkers.length, `${site} has people who talk`).toBeGreaterThan(0);
      // Their day: everyone has somewhere to be, by the same schedule rules.
      for (const m of town.members()) expect(town.placeOf(m.id)).not.toBeUndefined();
      // The market day is the place's own, seeded.
      expect(marketOffsetOf(site)).toBeGreaterThanOrEqual(0);
      expect(marketOffsetOf(site)).toBeLessThan(7);
      // A day goes by, and the place keeps its own news and creatures.
      const day = town.world.day;
      town.passHours(24);
      expect(town.world.day).toBe(day + 1);
      expect(siteState(town.world, site).lastActive).toBeUndefined();
      expect(Array.isArray(town.rules())).toBe(true);
    }
    // Two places do not share creatures, news or spawn ledgers.
    const a = siteState(town.world, places[0]!);
    const b = siteState(town.world, places[1]!);
    expect(a.creatures).not.toBe(b.creatures);
    expect(a.spawns).not.toBe(b.spawns);
  });

  it("a place left for a week is found with its people mid-day, caught up", () => {
    const town = worldTown(2);
    const start = town.site();
    const neighbour = nearestTo(town.world.realm!, start)[0]!;
    // Tire everyone out, then leave.
    for (const m of town.members()) {
      m.state.needs = { hunger: 90, energy: 5 };
      m.state.hp = Math.max(1, Math.floor(m.state.hp / 2));
    }
    goTo(town, neighbour);
    for (let d = 0; d < 6; d++) town.passHours(24);
    expect(siteState(town.world, start).lastActive).toBeDefined();
    goTo(town, start);
    for (const m of town.members()) {
      expect(m.state.needs.hunger, `${m.persona.name} has eaten`).toBeLessThan(60);
      expect(m.state.needs.energy, `${m.persona.name} has slept`).toBeGreaterThan(30);
    }
  });
});

void openWorld;
