import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { config } from "../src/config.js";
import { seededRng, type Rng } from "../src/game/dice.js";
import {
  adulthood,
  canCourt,
  childhood,
  describeFamily,
  familyNight,
  familyOf,
  inherit,
  makeChild,
  propose,
  spouseOf,
  wed,
  type Kin,
} from "../src/game/family.js";
import { ageOn } from "../src/game/life.js";
import { loadWorld, newWorld, saveWorld } from "../src/game/save.js";
import { deathRipple } from "../src/game/succession.js";
import { addSkillXp, TALENT_XP } from "../src/npc/growth.js";
import { lintPersona } from "../src/npc/lint.js";
import { buildSystemPrompt, buildTurnMessage } from "../src/npc/persona.js";
import { parsePersona } from "../src/npc/personaSchema.js";
import { canBeAttacked, describeBond, romanceAllowed } from "../src/npc/relationship.js";
import { NpcAgent } from "../src/npc/NpcAgent.js";
import { playerAttack, toolsFor } from "../src/npc/actions.js";
import { createNpcState } from "../src/npc/state.js";
import { adjustRelation } from "../src/npc/social.js";
import { assemblePersona, fallbackIdentity, generateNpc, loadTemplates, rollTemplate, writeIdentity } from "../src/npc/templates.js";
import type { NpcPersona } from "../src/npc/types.js";
import { MILLBROOK } from "../src/web/sites.js";
import { createDemoWorld } from "../src/world/world.js";
import { loadCreatureTemplates } from "../src/game/creatures.js";
import type { ChatRequest, ChatResult, GenerateRequest, LLMProvider } from "../src/llm/provider.js";
import { allPersonas, always, brena, ctxFor, FakeProvider, hale, makeTown, pell, pip, say } from "./helpers.js";

const templates = loadTemplates();

const romance = config.content.romance;
const marriage = config.content.npcMarriage;
const family = { ...config.family };
beforeEach(() => {
  config.director = false;
  config.planning = false;
  config.summaries = false;
});
afterEach(() => {
  config.content.romance = romance;
  config.content.npcMarriage = marriage;
  Object.assign(config.family, family);
});

/** A model that answers structured requests with `reply(n)` (the nth call). */
class Writer implements LLMProvider {
  calls = 0;
  constructor(private readonly reply: (n: number) => unknown) {}
  async chat(): Promise<ChatResult> {
    return { text: "", toolCalls: [] };
  }
  async generate(_req: GenerateRequest): Promise<string> {
    const r = this.reply(this.calls++);
    if (r instanceof Error) throw r;
    return typeof r === "string" ? r : JSON.stringify(r);
  }
}

const goodWords = {
  name: "Maud Tiller",
  personality: ["practical", "thrifty", "weather-wise"],
  speechStyle: "Plain and slow, with a farmer's 'aye' before every answer.",
  backstory: "Maud has farmed the east fields since she was a girl. She brings her eggs to the square every morning, rain or shine.",
  appearance: "A broad woman in a mud-spattered smock and a straw hat.",
  goals: ["Sell the eggs by noon", "Keep the hens safe from foxes"],
};

describe("N11.1 NPCs from templates", () => {
  it("every template file is valid, and the four the roadmap names are there", () => {
    expect(Object.keys(templates).sort()).toEqual(["bandit", "child", "farmer", "guard", "merchant"]);
    expect(templates.child!.minor).toBe(true);
  });

  it("the same seed and template give the same numbers; another seed gives others", () => {
    const a = rollTemplate(templates.farmer!, seededRng(42));
    const b = rollTemplate(templates.farmer!, seededRng(42));
    const c = rollTemplate(templates.farmer!, seededRng(43));
    expect(a).toEqual(b);
    expect(c).not.toEqual(a);
  });

  it("numbers stay inside the template's ranges, and gear is never above the rank", () => {
    const t = templates.guard!;
    for (let seed = 1; seed <= 50; seed++) {
      const r = rollTemplate(t, seededRng(seed));
      expect(r.age).toBeGreaterThanOrEqual(t.age[0]);
      expect(r.age).toBeLessThanOrEqual(t.age[1]);
      expect(r.traits.bravery).toBeGreaterThanOrEqual(t.traits.bravery![0]);
      expect(r.traits.bravery).toBeLessThanOrEqual(t.traits.bravery![1]);
      expect(r.maxHp).toBeGreaterThanOrEqual(t.hp[0]);
      expect(t.weapon).toContain(r.weapon);
    }
  });

  it("every template makes NPCs that pass the full schema and the authoring check, over many seeds", async () => {
    for (const t of Object.values(templates)) {
      for (let seed = 1; seed <= 60; seed++) {
        const { persona } = await generateNpc(t, seededRng(seed));
        const checked = parsePersona(JSON.parse(JSON.stringify(persona)), `${t.id}:${seed}`);
        expect(lintPersona(checked, { [checked.id]: checked }), `${t.id}:${seed}`).toEqual([]);
      }
    }
  });

  it("the model writes only the words: the numbers match the no-model NPC exactly", async () => {
    const llm = new Writer(() => goodWords);
    const withModel = await generateNpc(templates.farmer!, seededRng(7), { llm });
    const without = await generateNpc(templates.farmer!, seededRng(7));
    expect(withModel.words).toBe("model");
    expect(without.words).toBe("template");
    expect(withModel.persona.name).toBe("Maud Tiller");
    expect(withModel.persona.id).toBe("maud");
    for (const key of ["age", "tier", "potential", "greed", "traits", "stats", "skills", "startingInventory", "startingMoney", "prices", "schedule"] as const) {
      expect(withModel.persona[key]).toEqual(without.persona[key]);
    }
  });

  it("a failed model call retries once, then falls back cleanly to the template's words", async () => {
    const llm = new Writer(() => new Error("connection refused"));
    const g = await generateNpc(templates.merchant!, seededRng(3), { llm });
    expect(llm.calls).toBe(2);
    expect(g.words).toBe("template");
    expect(() => parsePersona(JSON.parse(JSON.stringify(g.persona)))).not.toThrow();
  });

  it("bad JSON, a taken name, or (for a child) an adult word counts as a failure", async () => {
    const rolled = rollTemplate(templates.farmer!, seededRng(1));
    expect(await writeIdentity(new Writer(() => "{not json"), templates.farmer!, rolled)).toBeNull();
    expect(await writeIdentity(new Writer(() => ({ ...goodWords, name: "Brena Smith" })), templates.farmer!, rolled, ["Brena Ashford"])).toBeNull();
    const kid = rollTemplate(templates.child!, seededRng(1));
    const flirt = { ...goodWords, name: "Kit Reed", backstory: "Kit has a sweetheart at the inn and talks of nothing but kissing her. She is ten years old and loud." };
    expect(await writeIdentity(new Writer(() => flirt), templates.child!, kid)).toBeNull();
    // Good words pass, on the second try after a bad first.
    const second = new Writer((n) => (n === 0 ? "nope" : goodWords));
    expect((await writeIdentity(second, templates.farmer!, rolled))?.name).toBe("Maud Tiller");
  });

  it("model personality words that contradict the numbers are dropped", async () => {
    const rolled = rollTemplate(templates.farmer!, seededRng(9));
    const llm = new Writer(() => ({ ...goodWords, personality: rolled.traits.bravery < 0.5 ? ["brave", "kind", "plain"] : ["cowardly", "kind", "plain"] }));
    const g = await generateNpc(templates.farmer!, seededRng(9), { llm });
    expect(g.persona.personality).not.toContain("brave");
    expect(g.persona.personality).not.toContain("cowardly");
    expect(g.persona.personality.length).toBeGreaterThanOrEqual(3);
  });

  it("a generated farmer works in the chat with no hand edits", async () => {
    const { persona } = await generateNpc(templates.farmer!, seededRng(5));
    const agent = new NpcAgent(persona, new FakeProvider([say("Eggs are a copper each, mind.")]), always(0.5));
    const r = await agent.respond("What do you sell?", createDemoWorld());
    expect(r.text).toContain("Eggs");
    expect(buildSystemPrompt(persona)).toContain(persona.name);
  });

  it("a generated NPC gets a free spot on the map at its workplace", async () => {
    const { persona } = await generateNpc(templates.farmer!, seededRng(5));
    const spot = MILLBROOK.npcSpot(persona.id, "square")!;
    expect(MILLBROOK.isSolid(spot.x, spot.y)).toBe(false);
    expect(MILLBROOK.spotAt("square", persona.id)).toEqual({ x: spot.x, y: spot.y });
    expect(MILLBROOK.spotAt("square", "someone_else")).not.toEqual({ x: spot.x, y: spot.y });
  });

  it("the authoring check (T5) catches what the schema can't", () => {
    const bad: NpcPersona = {
      ...pell,
      id: "bad",
      teaches: "archery",
      buys: ["dragon egg"],
      personality: ["cowardly"],
      traits: { ...pell.traits, bravery: 0.9 },
      spouse: "hale",
      relationships: { nobody: { trust: 1 } },
    };
    const problems = lintPersona(bad, { bad, hale, pell });
    expect(problems.join("\n")).toMatch(/teaches archery/);
    expect(problems.join("\n")).toMatch(/unknown item "dragon egg"/);
    expect(problems.join("\n")).toMatch(/cowardly/);
    expect(problems.join("\n")).toMatch(/doesn't name them back/);
    expect(problems.join("\n")).toMatch(/unknown NPC "nobody"/);
    expect(lintPersona({ ...pip, guard: true, armor: "leather armor" }, { pip }).join("\n")).toMatch(/minor can't be a guard[\s\S]*armour/);
  });

  it("every NPC file passes the authoring check", () => {
    const cast = allPersonas();
    for (const p of Object.values(cast)) expect(lintPersona(p, cast), p.id).toEqual([]);
  });
});

describe("N11.2 a child NPC", () => {
  it("Pip is a minor with a role in town: errands at the square and the gossip", () => {
    expect(pip.minor).toBe(true);
    expect(pip.quests!.every((q) => q.tier === "G")).toBe(true);
    expect(pip.knows["news.*"]).toBe("certain");
    expect(pip.schedule!.some((b) => b.place === "square" && b.activity === "work")).toBe(true);
  });

  it("no romance, ever: not allowed, no bond words, nothing in the prompt, even with romance on and full affection", () => {
    config.content.romance = true;
    const forced = { ...pip, romance: { open: true } };
    expect(romanceAllowed(forced)).toBe(false);
    const state = createNpcState(pip, { affection: 100, relationship: 100 });
    const world = createDemoWorld();
    const words = /\b(romance|courting|drawn to|together|kiss|sweetheart|marry|married)\b/i;
    expect(describeBond(forced, state, world.player) ?? "").not.toMatch(words);
    expect(buildSystemPrompt(pip)).not.toMatch(words);
    expect(buildTurnMessage(pip, state, world, "Hello Pip! Fancy some sweets?")).not.toMatch(words);
    // The schema refuses a minor open to romance, or married.
    expect(() => parsePersona({ ...pip, romance: { open: true } })).toThrow(/minor/);
    expect(() => parsePersona({ ...pip, spouse: "hale" })).toThrow(/minor/);
  });

  it("no romance tools and no fight tools, even when provoked", () => {
    const ctx = ctxFor(pip, { provocations: 10, mood: "angry" });
    const names = toolsFor(ctx).map((t) => t.name);
    expect(names).not.toContain("attack_player");
    expect(names.join(" ")).not.toMatch(/romance|propose|kiss|marry|court/);
  });

  it("the chosen combat rule: the player can't attack Pip (minorsCanBeAttacked is off)", () => {
    expect(config.content.minorsCanBeAttacked).toBe(false);
    expect(canBeAttacked(pip)).toBe(false);
    const ctx = ctxFor(pip);
    const hp = ctx.state.hp;
    const r = playerAttack(ctx);
    expect(r.ok).toBe(false);
    expect(ctx.state.inCombat).toBe(false);
    expect(ctx.state.hp).toBe(hp);
    expect(ctx.state.relationship).toBe(0);
  });

  it("never courts, marries or is proposed to", () => {
    config.content.romance = true;
    const town = makeTown();
    const kin = town.members() as Kin[];
    const p = kin.find((k) => k.id === "pip")!;
    const h = kin.find((k) => k.id === "hale")!;
    adjustRelation(p.state, "hale", "affection", 100);
    adjustRelation(h.state, "pip", "affection", 100);
    expect(canCourt(p, h, town.world, kin)).toBe(false);
    expect(propose(town.world, kin, "pip")).toMatchObject({ ok: false, message: expect.stringMatching(/child/) });
  });

  it("is out at the square in the day and home at night", () => {
    const town = makeTown();
    town.world.hour = 10;
    expect(town.placeOf("pip")).toBe("square");
    town.world.hour = 22;
    expect(town.placeOf("pip")).toBeNull();
  });
});

// ---- Families ----

/** A town where Brena and Hale are fond of each other (both ways). */
function fondTown(rng: Rng = always(0.01)) {
  const town = makeTown({ rng });
  const a = town.agents.brena!.state;
  const b = town.agents.hale!.state;
  for (const [s, other] of [[a, "hale"], [b, "brena"]] as const) {
    adjustRelation(s, other, "affection", 80 - s.npcRelations[other]!.affection);
    adjustRelation(s, other, "trust", 60 - s.npcRelations[other]!.trust);
  }
  return town;
}

/** Let `days` midnights pass for the town's family rules alone. */
/** Children born in play (the save also keeps grown-up children's files, like Pip's). */
const births = (town: ReturnType<typeof makeTown>) => Object.values(familyOf(town.world).born).filter((p) => p.bornOnDay !== undefined);

function nights(town: ReturnType<typeof makeTown>, days: number): string[] {
  const from = town.world.day;
  town.world.day += days;
  return town.familyNights(from);
}

describe("N11.3 courtship and marriage", () => {
  it("two grown NPCs who like and trust each other court, then marry after the courtship nights", () => {
    const town = fondTown();
    const log = nights(town, 1);
    expect(log.join(" ")).toMatch(/Brena Ashford and Corporal Hale have started walking out together/);
    expect(familyOf(town.world).courting).toHaveLength(1);
    const more = nights(town, config.family.courtshipNights);
    expect(more.join(" ")).toMatch(/are married/);
    expect(spouseOf(town.world, "brena")).toBe("hale");
    expect(spouseOf(town.world, "hale")).toBe("brena");
    // News for everyone, a memory for both.
    expect(town.world.lore!.some((l) => l.id.startsWith("news.wedding_"))).toBe(true);
    expect(town.agents.pell!.state.learned[town.world.lore!.find((l) => l.id.startsWith("news.wedding_"))!.id]).toBe("certain");
    expect(town.agents.brena!.state.memories.some((m) => m.text === "you married Corporal Hale")).toBe(true);
    expect(town.world.events!.some((e) => e.kind === "marriage")).toBe(true);
  });

  it("it happens as time passes in the town (passHours), not only when called directly", () => {
    const town = fondTown();
    const log = town.passHours(24 * (config.family.courtshipNights + 2));
    expect(log.join(" ")).toMatch(/are married/);
    expect(spouseOf(town.world, "brena")).toBe("hale");
  });

  it("no courting without both feeling it, nor across a big age gap, nor for kin, nor for one who's sworn off love", () => {
    const town = makeTown();
    const kin = town.members() as Kin[];
    const b = kin.find((k) => k.id === "brena")!;
    const h = kin.find((k) => k.id === "hale")!;
    const p = kin.find((k) => k.id === "pell")!;
    expect(nights(town, 1).join(" ")).not.toMatch(/walking out/);
    // Pell is 68, Brena 34: too far apart.
    expect(canCourt(b, p, town.world, kin)).toBe(false);
    expect(canCourt(b, h, town.world, kin)).toBe(true);
    // Just grown isn't old enough to court: 17-year-old Hale would have to wait a year.
    const young = { ...h, state: { ...h.state, life: { ...h.state.life, bornOnDay: town.world.day - 17 * config.daysPerYear } } };
    expect(canCourt(b, young, town.world, kin)).toBe(false);
    expect(canCourt({ ...b, persona: { ...b.persona, romance: { open: false } } }, h, town.world, kin)).toBe(false);
    expect(canCourt(b, { ...h, persona: { ...h.persona, parents: ["brena", "rook"] } }, town.world, [b, { ...h, persona: { ...h.persona, parents: ["brena", "rook"] } }])).toBe(false);
    config.content.npcMarriage = false;
    expect(canCourt(b, h, town.world, kin)).toBe(false);
  });

  it("a quarrel ends a courtship", () => {
    const town = fondTown();
    nights(town, 1);
    adjustRelation(town.agents.hale!.state, "brena", "affection", -100);
    expect(nights(town, 1).join(" ")).toMatch(/no longer walking out/);
    expect(familyOf(town.world).courting).toHaveLength(0);
  });

  it("the player can marry only with romance on, an NPC open to it, at the last romance stage", () => {
    const town = makeTown();
    const kin = () => town.members() as Kin[];
    config.content.romance = false;
    expect(propose(town.world, kin(), "brena").ok).toBe(false);
    config.content.romance = true;
    expect(propose(town.world, kin(), "brena")).toMatchObject({ ok: false, message: expect.stringMatching(/isn't ready/) });
    Object.assign(town.agents.brena!.state, { affection: 100, relationship: 100 });
    expect(propose(town.world, kin(), "brena").ok).toBe(true);
    expect(spouseOf(town.world, "player")).toBe("brena");
    // Hale isn't open to romance; and the player is married now anyway.
    expect(propose(town.world, kin(), "hale").ok).toBe(false);
  });

  it("the family line shows only on family talk (design rule 3), and says who's who", () => {
    const town = fondTown();
    nights(town, 1 + config.family.courtshipNights);
    const brenaA = town.agents.brena!;
    const plain = buildTurnMessage(brenaA.persona, brenaA.state, town.world, "What's for sale?");
    expect(plain).not.toMatch(/husband/);
    const talk = buildTurnMessage(brenaA.persona, brenaA.state, town.world, "Are you married?");
    expect(talk).toMatch(/Your husband is Corporal Hale/);
  });
});

/** A married Brena and Hale, and a child template, for birth tests. */
function marriedTown(rng: Rng = always(0.01)) {
  const town = fondTown(rng);
  wed(town.world, town.members() as Kin[], "brena", "hale");
  return town;
}

describe("N11.3 children", () => {
  it("a married couple expects a child, born pregnancyDays later as a new NPC in the town", () => {
    const town = marriedTown();
    const log = nights(town, 1);
    expect(log.join(" ")).toMatch(/expecting a child/);
    const born = nights(town, config.family.pregnancyDays);
    expect(born.join(" ")).toMatch(/Brena Ashford and Corporal Hale have a (son|daughter|child)/);
    const child = births(town)[0]!;
    expect(town.ids).toContain(child.id);
    expect(town.agents[child.id]).toBeDefined();
    expect(child).toMatchObject({ minor: true, age: 0, parents: ["brena", "hale"], tier: "G" });
    expect(child.name.endsWith("Ashford")).toBe(true);
    expect(() => parsePersona(JSON.parse(JSON.stringify(child)))).not.toThrow();
    expect(lintPersona(child, town.personas)).toEqual([]);
    // A baby is at home, never on the map.
    town.world.hour = 10;
    expect(town.placeOf(child.id)).toBeNull();
    // Parents love them, and remember the day.
    expect(town.agents.brena!.state.npcRelations[child.id]!.affection).toBeGreaterThanOrEqual(90);
    expect(town.agents.hale!.state.memories.some((m) => m.id === `child-${child.id}`)).toBe(true);
  });

  it("children inherit: averaged attributes (give or take 2), blended traits, and talents from the parents' skills", () => {
    const town = marriedTown();
    const kin = town.members() as Kin[];
    const template = templates.child!;
    const stock = (id: string) => {
      const k = kin.find((m) => m.id === id)!;
      return { id, name: k.persona.name, species: "human", attributes: k.persona.stats.attributes, maxHp: k.persona.stats.maxHp, maxMp: k.persona.stats.maxMp, skills: k.persona.skills, traits: { ...{ temper: 0.5, bravery: 0.5, honesty: 0.5, generosity: 0.5, sociability: 0.5, forgiveness: 0.5 }, ...k.persona.traits }, potential: k.persona.potential, persona: k.persona };
    };
    const a = stock("brena");
    const b = stock("hale");
    for (let seed = 1; seed <= 30; seed++) {
      const inh = inherit(a, b, seededRng(seed));
      for (const at of ["strength", "intelligence", "charisma"] as const) {
        const avg = Math.round((a.attributes[at] + b.attributes[at]) / 2);
        expect(Math.abs(inh.attributes[at] - avg)).toBeLessThanOrEqual(2);
      }
      for (const s of inh.talents) expect(Math.max(a.skills[s] ?? 0, b.skills[s] ?? 0)).toBeGreaterThanOrEqual(2);
      for (const [s, lvl] of Object.entries(inh.inherited)) expect(lvl).toBe(Math.max(1, Math.floor(Math.max(a.skills[s as "smithing"] ?? 0, b.skills[s as "smithing"] ?? 0) / 2)));
    }
    // Brena is a master smith: over many children, smithing is the gift most often passed on.
    const smiths = Array.from({ length: 40 }, (_, i) => inherit(a, b, seededRng(100 + i))).filter((x) => x.talents.includes("smithing")).length;
    expect(smiths).toBeGreaterThan(25);
    // The same parents on the same day always make the same child.
    expect(makeChild(template, a, b, 9, [], [])).toEqual(makeChild(template, a, b, 9, [], []));
  });

  it("talents make a skill learn faster", () => {
    const base = { ...pip, talents: undefined };
    const gifted = { ...pip, talents: ["foraging" as const] };
    const s1 = createNpcState(base);
    const s2 = createNpcState(gifted);
    addSkillXp(base, s1, "foraging", 10);
    addSkillXp(gifted, s2, "foraging", 10);
    expect(s2.growth.skillXp.foraging).toBe(10 * TALENT_XP);
    expect(s1.growth.skillXp.foraging).toBe(10);
  });

  it("no more than maxChildrenPerCouple, none past the population cap, and rest between births", () => {
    const town = marriedTown();
    // Everyone alive in the world (the cast, and Millbrook's notables from the realm: N15; Wren waits in the wings): room for one more.
    config.family.maxPopulation = town.members().filter((m) => !m.state.dormant && m.state.outcome !== "dead").length + 1;
    nights(town, 1 + config.family.pregnancyDays);
    expect(births(town)).toHaveLength(1);
    nights(town, 40);
    expect(births(town)).toHaveLength(1);
    config.family.maxPopulation = 100;
    config.family.maxChildrenPerCouple = 2;
    nights(town, 1);
    // Rest days have passed: another one is on the way, and then no more.
    nights(town, 80);
    expect(births(town)).toHaveLength(2);
  });

  it("children grow up: talking and errands at talkAge, grown at adulthood with what's in the blood", () => {
    const town = marriedTown();
    nights(town, 1 + config.family.pregnancyDays);
    const id = births(town)[0]!.id;
    const born = familyOf(town.world).born[id]!;
    // Talking age.
    nights(town, config.family.talkAge * config.daysPerYear);
    const child = town.personas[id]!;
    expect(child.minor).toBe(true);
    expect(child.speechStyle.startsWith("A baby")).toBe(false);
    expect(child.schedule).toEqual(templates.child!.schedule);
    town.world.hour = 10;
    expect(town.placeOf(id)).toBe("square");
    // Adulthood: not a minor, the inherited tiers, and the working parent's hours.
    nights(town, 16 * config.daysPerYear);
    const grown = town.personas[id]!;
    expect(grown.minor).toBeUndefined();
    for (const [s, lvl] of Object.entries(born.inherited ?? {})) expect(grown.skills[s as "smithing"]).toBeGreaterThanOrEqual(lvl);
    expect(grown.schedule).toEqual(brena.schedule);
    expect(ageOn(town.agents[id]!.state.life, town.world.day)).toBeGreaterThanOrEqual(16);
    expect(() => parsePersona(JSON.parse(JSON.stringify(grown)))).not.toThrow();
  });

  it("a baby stays at home whatever the day brings (a festival, an empty purse)", () => {
    const town = marriedTown();
    nights(town, 1 + config.family.pregnancyDays);
    const baby = births(town)[0]!;
    for (const hour of [8, 12, 19]) {
      town.world.hour = hour;
      town.agents[baby.id]!.state.money = 0;
      town.agents[baby.id]!.state.activity = null;
      expect(town.placeOf(baby.id)).toBeNull();
    }
  });

  it("a minor from the files grows up too: Pip at 16 is no longer a minor, and stays grown after a reload", () => {
    const dir = mkdtempSync(join(tmpdir(), "n11-"));
    try {
      const town = makeTown();
      const years = 16 - pip.age;
      const log = nights(town, years * config.daysPerYear + 1);
      expect(town.personas.pip!.minor).toBeUndefined();
      expect(log.join(" ")).not.toMatch(/Pip Hollis has come of age\./);
      expect(() => parsePersona(JSON.parse(JSON.stringify(town.personas.pip)))).not.toThrow();
      for (const k of town.ids) town.world.npcStates[k] = town.agents[k]!.state;
      saveWorld(join(dir, "w.json"), town.world);
      const again = makeTown({ world: loadWorld(join(dir, "w.json"), allPersonas(), loadCreatureTemplates()) });
      expect(again.personas.pip!.minor).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("childhood and adulthood are pure: same file in, same file out", () => {
    const town = marriedTown();
    nights(town, 1 + config.family.pregnancyDays);
    const baby = births(town)[0]!;
    expect(childhood(baby, templates.child!, 70)).toEqual(childhood(baby, templates.child!, 70));
    expect(adulthood(baby, [brena, hale], 200)).toEqual(adulthood(baby, [brena, hale], 200));
  });

  it("born children survive a save and load, with their own file", () => {
    const dir = mkdtempSync(join(tmpdir(), "n11-"));
    try {
      const town = marriedTown();
      nights(town, 1 + config.family.pregnancyDays);
      const id = births(town)[0]!.id;
      for (const k of town.ids) town.world.npcStates[k] = town.agents[k]!.state;
      saveWorld(join(dir, "w.json"), town.world);
      const loaded = loadWorld(join(dir, "w.json"), allPersonas(), loadCreatureTemplates());
      expect(loaded.family!.born[id]!.name).toBe(town.personas[id]!.name);
      expect(loaded.npcStates[id]).toBeDefined();
      expect(spouseOf(loaded, "brena")).toBe("hale");
      const again = makeTown({ world: loaded });
      expect(again.ids).toContain(id);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("a grown child takes over a parent's trade when there's no successor waiting", () => {
    const town = marriedTown();
    nights(town, 1 + config.family.pregnancyDays + 17 * config.daysPerYear);
    const id = births(town)[0]!.id;
    expect(town.personas[id]!.minor).toBeUndefined();
    // Hale names no successor: his grown child inherits.
    const ripple = deathRipple(town.members(), town.world, "hale", null);
    expect(ripple.successor).toBe(id);
  });

  it("a child of the player inherits from the player's skills", () => {
    const world = newWorld(allPersonas());
    world.player.skills = { archery: 5 };
    const template = templates.child!;
    const kin = Object.entries(allPersonas()).map(([id, persona]) => ({ id, persona, state: createNpcState(persona) }));
    familyOf(world).marriages.push({ a: "player", b: "brena", day: 1 });
    familyOf(world).expecting.push({ parents: ["player", "brena"], since: 1, dueDay: 2 });
    world.day = 2;
    const night = familyNight(kin, world, always(0.99), template);
    expect(night.born).toHaveLength(1);
    expect(night.born[0]!.parents).toEqual(["player", "brena"]);
    expect(world.player.journal!.some((j) => j.kind === "family")).toBe(true);
    // Across seeds, archery 5 nearly always passes on.
    const stockP = { id: "player", name: "You", species: "human", attributes: world.player.attributes, maxHp: 30, maxMp: 10, skills: { archery: 5 as const }, traits: { temper: 0.5, bravery: 0.5, honesty: 0.5, generosity: 0.5, sociability: 0.5, forgiveness: 0.5 }, potential: "C" as const, persona: null };
    expect(inherit(stockP, stockP, seededRng(1)).talents).toContain("archery");
  });

  it("describeFamily says children's ages and talents in words", () => {
    const town = marriedTown();
    nights(town, 1 + config.family.pregnancyDays);
    const line = describeFamily(town.personas.brena!, town.world)!;
    expect(line).toMatch(/Your husband is Corporal Hale\. Your children: \w+ \(a baby\)\./);
  });
});

describe("N11 template words for a born child", () => {
  it("fallback words fill in the child's name and age", () => {
    const t = templates.child!;
    const r = rollTemplate(t, seededRng(2));
    const w = fallbackIdentity(t, r, seededRng(2), "Tam Ashford");
    const p = assemblePersona(t, r, w, "tam");
    expect(p.backstory).not.toMatch(/\{/);
    expect(p.minor).toBe(true);
    expect(p.reserveMoney).toBe(0);
  });
});

/** Unused-provider check: a chat-only provider (no generate) also works for the words. */
class ChatOnly implements LLMProvider {
  async chat(_req: ChatRequest): Promise<ChatResult> {
    return { text: `Here you go: ${JSON.stringify(goodWords)}`, toolCalls: [] };
  }
}

it("a provider without structured output still writes words (JSON parsed out of chat)", async () => {
  const g = await generateNpc(templates.farmer!, seededRng(11), { llm: new ChatOnly() });
  expect(g.words).toBe("model");
  expect(g.persona.name).toBe("Maud Tiller");
});
