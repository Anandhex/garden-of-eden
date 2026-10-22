/**
 * N38: NPCs as living players. One action menu for talkers and townsfolk: each hour (talkers) or day (townsfolk) a person scores every
 * option from the schedule's own pick (habit), needs, grudges, feelings, traits and the place, picks by a weighted roll whose spread their
 * temperament sets, and does it through the normal systems. Every choice that does something is an event with its reason. The model never
 * chooses. Roles are found by class and job, never by name (plans README section 12); talker mechanics use the fixture NPC files.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { config } from "../src/config.js";
import { WorldStore } from "../src/game/db.js";
import { worldHash } from "../src/game/hash.js";
import { chooseHour, choicesOf, type TalkerEnv } from "../src/game/choice/talker.js";
import { menuFor } from "../src/game/choice/registry.js";
import { choiceDay } from "../src/game/choice/day.js";
import { temperatureOf, weights, reasonOf } from "../src/game/choice/score.js";
import { MAX_RUN } from "../src/game/choice/weights.js";
import { protectedSet } from "../src/game/choice/protect.js";
import { liveSites } from "../src/game/people/live.js";
import { advanceWorld, settle } from "../src/game/people/world.js";
import { CLASS_RANK, CrowdSim, type CrowdDay, type SocialClass, type Townsperson } from "@millbrook/shared";
import { addGrievance } from "../src/game/chatter/grievance.js";
import { intentsOn } from "../src/game/choice/intents.js";
import { rosterFor } from "../src/game/realm/townsfolk.js";
import { traitsOfRow } from "../src/game/people/traits.js";
import { siteMap } from "../src/web/sites.js";
import type { LifeCtx } from "../src/game/people/step.js";
import { generateRealm } from "../src/game/realm/generate.js";
import { pickStartSite } from "../src/game/realm/start.js";
import { TRIPS } from "../src/game/road/trips/config.js";
import { materialisePeople } from "../src/store/materialise.js";
import type { PersonRow } from "../src/store/peopleStore.js";
import { createNpcState } from "../src/npc/state.js";
import type { NpcPersona } from "../src/npc/types.js";
import { createTestWorld } from "../src/world/world.js";
import { always, FakeProvider, hale, pell, pickTestPlaces, say } from "./helpers.js";
import type { VillageMember } from "../src/game/village.js";
import { loadCreatureTemplates } from "../src/game/creatures.js";
import { newWorld } from "../src/game/save.js";
import { Town } from "../src/game/town.js";
import { choicesView } from "../src/admin/choices.js";
import { card } from "../src/admin/person.js";
import type { AdminContext } from "../src/admin/context.js";
import { playerMenuAct } from "../src/game/choice/player.js";
import { EFFECTS } from "../src/game/chatter/effects.js";
import { describeChoices, explainChoice } from "../src/game/choice/words.js";
import { checkChoiceBounds } from "../src/game/choice/bounds.js";
import type { ChoiceLog } from "../src/game/choice/types.js";
import { CALL_KINDS, budgets } from "../src/budgets.js";

vi.setConfig({ testTimeout: 240_000 });

const trips = { ...Object.fromEntries(Object.entries(TRIPS).map(([k, v]) => [k, v.cap])) } as Record<string, number>;
beforeEach(() => {
  config.peopleLazy = "";
  config.gossip = true;
  config.chatter = true;
  config.realm = true;
  config.realmSeed = undefined;
  config.choice.mode = "talkers";
  config.choice.violence = false;
  config.choice.only = [];
  for (const k of Object.keys(TRIPS)) (TRIPS as Record<string, { cap: number }>)[k]!.cap = trips[k]!;
});

// ---------- two talkers in a square ----------

const SQUARE = [{ from: 0, to: 24, activity: "socialise" as const, place: "square" as const }];
const WORKDAY = [
  { from: 6, to: 20, activity: "work" as const, place: "forge" as const },
  { from: 20, to: 21, activity: "eat" as const, place: "home" as const },
  { from: 21, to: 6, activity: "sleep" as const, place: "home" as const },
];

function member(base: NpcPersona, id: string, over: Partial<NpcPersona>, tweak: (s: ReturnType<typeof createNpcState>) => void = () => {}): VillageMember {
  const persona: NpcPersona = { ...base, id, name: over.name ?? id, ...over };
  const state = createNpcState(persona, {});
  tweak(state);
  return { id, persona, state };
}

/** A hungry, wronged commoner (hot or cool as given) at work, and a lord at ease in the square who they hold a heavy grudge against. */
function scene(bravery: number, temper: number) {
  const commoner = member(hale, "commoner", { name: "Odo", role: "farmhand", schedule: WORKDAY, traits: { bravery, temper, honesty: 0.8, sociability: 0.4, forgiveness: 0.2, generosity: 0.5 } }, (s) => {
    s.needs.hunger = 60; // hungry, not yet starving: the schedule still has them at work
    s.npcRelations["lord"] = { trust: -60, affection: -70, respect: -20, fear: 5 };
  });
  const lord = member(pell, "lord", { name: "Lord Aldric", role: "Lord of the manor", schedule: SQUARE });
  return { commoner, lord, members: [commoner, lord] };
}

function env(members: VillageMember[], seed: number, over: Partial<TalkerEnv> = {}, hour = 10, day = 3): TalkerEnv {
  const world = createTestWorld();
  world.day = day;
  world.hour = hour;
  world.minute = 0;
  return { seed, members, world, at: { day, hour }, protect: new Set(), busy: new Set(), violence: false, ...over };
}

describe("N38 step 1: the frame — the schedule is the default", () => {
  it("with only the schedule's own actions, an hour of choosing changes nothing", () => {
    const { members, commoner } = scene(0.9, 0.7);
    chooseHour(env(members, 1, { only: ["habit"] }));
    expect(commoner.state.choice?.plan).toBeUndefined();
    const picked = choicesOf(commoner.state).at(-1)!;
    expect(picked.options[picked.picked]!.action).toBe("work");
    expect(picked.habit).toBe(true);
  });

  it("an ordinary worker with nothing against anyone keeps their day: habit beats everything else", () => {
    const calm = member(hale, "calm", { schedule: WORKDAY, traits: { bravery: 0.5, temper: 0.4, honesty: 0.8, sociability: 0.5, forgiveness: 0.5, generosity: 0.5 } });
    const other = member(pell, "other", { schedule: SQUARE });
    let worked = 0;
    for (let seed = 1; seed <= 60; seed++) {
      chooseHour(env([calm, other], seed, {}, 9 + (seed % 6)));
      if (choicesOf(calm.state).at(-1)!.habit) worked++;
    }
    expect(worked).toBeGreaterThanOrEqual(50);
  });
});

describe("N38 step 3: temperature and streams", () => {
  it("a cautious person is nearly deterministic, a reckless one is not", () => {
    expect(temperatureOf({ bravery: 0.05, temper: 0.1 })).toBeLessThan(0.07);
    expect(temperatureOf({ bravery: 0.95, temper: 0.9 })).toBeGreaterThan(0.35);
    const calm = weights([1, 0.5, 0], temperatureOf({ bravery: 0.05, temper: 0.1 }));
    const wild = weights([1, 0.5, 0], temperatureOf({ bravery: 0.95, temper: 0.9 }));
    expect(calm[0]).toBeGreaterThan(0.99);
    expect(wild[0]).toBeLessThan(0.7);
    expect(wild.reduce((a, b) => a + b, 0)).toBeCloseTo(1);
  });

  it("the same seed plays an hour the same twice; another seed can differ", () => {
    const run = (seed: number) => {
      const { members, commoner } = scene(0.9, 0.7);
      chooseHour(env(members, seed));
      return JSON.stringify(choicesOf(commoner.state));
    };
    expect(run(7)).toBe(run(7));
    const picks = new Set<string>();
    for (let s = 1; s <= 40; s++) {
      const l = JSON.parse(run(s))[0];
      picks.add(l.options[l.picked].action);
    }
    expect(picks.size).toBeGreaterThan(1);
  });

  it("nothing in the menu rolls Math.random", () => {
    const spy = vi.spyOn(Math, "random").mockImplementation(() => {
      throw new Error("Math.random in the choice menu");
    });
    try {
      const { members } = scene(0.9, 0.7);
      for (let h = 6; h < 22; h++) chooseHour(env(members, 5, {}, h));
    } finally {
      spy.mockRestore();
    }
  });
});

describe("N38 step 5: the done-when pair", () => {
  const confronts = (bravery: number, temper: number, seeds = 60) => {
    let n = 0;
    let parts: string[] = [];
    for (let seed = 1; seed <= seeds; seed++) {
      const { members, commoner } = scene(bravery, temper);
      chooseHour(env(members, seed));
      const l = choicesOf(commoner.state).at(-1)!;
      const o = l.options[l.picked]!;
      if (o.action === "confront") {
        n++;
        parts = o.parts.map(([label]) => label);
      }
    }
    return { n, parts };
  };

  it("a hungry, wronged, bold commoner confronts the noble instead of going to work", () => {
    const bold = confronts(0.95, 0.8);
    expect(bold.n).toBeGreaterThanOrEqual(30);
    expect(bold.parts.some((p) => p.startsWith("grudge vs Lord Aldric"))).toBe(true);
    expect(bold.parts).toContain("bold");
  });

  it("a cautious one in the same spot, with the same hunger and the same grievance, does not", () => {
    const shy = confronts(0.1, 0.2);
    expect(shy.n).toBeLessThanOrEqual(2);
    // Why: the grudge is there, but fear of standing up to a lord outweighs it.
    const { members, commoner } = scene(0.1, 0.2);
    chooseHour(env(members, 1));
    const l = choicesOf(commoner.state).at(-1)!;
    const c = l.options.find((o) => o.action === "confront")!;
    const w = l.options.find((o) => o.action === "work")!;
    expect(c.parts.some(([label, v]) => label.includes("stands above them") && v < 0)).toBe(true);
    expect(w.score).toBeGreaterThan(c.score);
  });

  it("a choice that does something is an event whose reason is the top parts of its score", () => {
    const { members, commoner, lord } = scene(0.95, 0.8);
    let found = false;
    for (let seed = 1; seed <= 40 && !found; seed++) {
      const m = scene(0.95, 0.8);
      const e = env(m.members, seed);
      chooseHour(e);
      const ev = (e.world.events ?? []).find((x) => x.kind === "confrontation");
      if (!ev) continue;
      found = true;
      expect(ev.actor).toBe("commoner");
      expect(ev.target).toBe("lord");
      expect(ev.why).toMatch(/grudge vs Lord Aldric \+/);
      expect(ev.why!.split(", ")).toHaveLength(3);
      // The commoner went to the square to do it, and the lord now thinks the worse of them.
      expect(m.commoner.state.choice?.plan).toMatchObject({ place: "square", activity: "socialise" });
      expect(m.lord.state.npcRelations["commoner"]!.respect).toBeLessThan(0);
    }
    expect(found).toBe(true);
    void members;
    void commoner;
    void lord;
  });
});

describe("N38 step 4: guardrails", () => {
  it("nobody loops on one action over a simulated week", () => {
    const { members, commoner } = scene(0.95, 0.9);
    let run = 0;
    let longest = 0;
    let last = "";
    for (let h = 0; h < 24 * 7; h++) {
      const e = env(members, 11, {}, h % 24, 1 + Math.floor(h / 24));
      chooseHour(e);
      const l = choicesOf(commoner.state).at(-1)!;
      const o = l.options[l.picked]!;
      const habit = l.habit;
      if (habit || o.action !== last) run = habit ? 0 : 1;
      else run++;
      last = habit ? "" : o.action;
      longest = Math.max(longest, run);
    }
    expect(longest).toBeLessThanOrEqual(MAX_RUN);
  });

  it("violent actions are not offered unless the setting is on; with it on, protected people are never their target", () => {
    const { members, commoner, lord } = scene(0.95, 0.9);
    const build = (violence: boolean, protect: string[]) => {
      const e = env(members, 3, { violence, protect: new Set(protect) });
      chooseHour(e);
      return choicesOf(commoner.state).at(-1)!;
    };
    const off = build(false, []);
    expect(off.options.some((o) => o.action === "attack" || o.action === "steal")).toBe(false);
    commoner.state.choice = undefined;
    lord.state.money = 500;
    const on = build(true, []);
    expect(on.options.some((o) => o.action === "attack" && o.target === "lord")).toBe(true);
    commoner.state.choice = undefined;
    const guarded = build(true, ["lord"]);
    expect(guarded.options.some((o) => (o.action === "attack" || o.action === "steal") && o.target === "lord")).toBe(false);
    // They can still be insulted.
    expect(guarded.options.some((o) => o.action === "insult" && o.target === "lord")).toBe(true);
  });

  it("a place sees at most two fights a day, and one an hour", () => {
    config.choice.violence = true;
    const { members } = scene(0.95, 0.95);
    const world = createTestWorld();
    world.day = 3;
    world.hour = 10;
    const mk = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `e${i}`, day: 3, hour: 10, kind: "attacked", actor: "x", target: "y", details: "", importance: 5 }) as never);
    const oneThisHour = { ...env(members, 2), world: { ...world, events: mk(1) } };
    chooseHour(oneThisHour);
    expect(choicesOf(members[0]!.state).at(-1)!.options.some((o) => o.action === "attack")).toBe(false);
    members[0]!.state.choice = undefined;
    const twoToday = { ...env(members, 2, {}, 14), world: { ...world, hour: 14, events: mk(2) } };
    chooseHour(twoToday);
    expect(choicesOf(members[0]!.state).at(-1)!.options.some((o) => o.action === "attack" || o.action === "steal")).toBe(false);
  });

  it("the player's companions, whoever they are talking to, open quest-givers and children are protected", () => {
    const ally = member(hale, "ally", {}, (s) => (s.companion = true as never));
    const kid = member(pell, "kid", { minor: true });
    const giver = member(pell, "giver", {});
    const talk = member(pell, "talk", {});
    const set = protectedSet({ quests: { active: [{ giverId: "giver" } as never], completed: [] } }, [ally, kid, giver, talk], "talk");
    expect([...set].sort()).toEqual(["ally", "giver", "kid", "talk"]);
  });

  it("the menu reads the same twice (a fixed order)", () => {
    const { members } = scene(0.9, 0.8);
    const a = menuFor(talkerCtxFor(members));
    const b = menuFor(talkerCtxFor(members));
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(3);
    expect(reasonOf(a[0]!.parts).length).toBeGreaterThan(0);
  });
});

import { talkerCtx } from "../src/game/choice/talker.js";
import { planHour } from "../src/game/schedule.js";
function talkerCtxFor(members: VillageMember[]) {
  const e = env(members, 1);
  const plans = new Map(members.map((m) => [m.id, planHour(m.persona, m.state, { ...e.world, day: 3, hour: 10 })]));
  return talkerCtx(e, members[0]!, plans, () => null);
}

// ---------- townsfolk, a day at a time ----------

function realmWorld(seed = 1) {
  const realm = generateRealm(seed, 1);
  const store = new WorldStore(":memory:");
  materialisePeople(realm, store.people, 1);
  const live = liveSites(realm, pickStartSite(realm, realm.seed), "all");
  const ctx: LifeCtx = { realm, store };
  return { realm, store, live, ctx, ...pickTestPlaces(realm) };
}
const grownRows = (w: ReturnType<typeof realmWorld>, site: string) => (w.store.people.loadSite(site, "full") as PersonRow[]).filter((r) => r.job !== "child" && !r.away && r.persona === null).sort((a, b) => (a.id < b.id ? -1 : 1));

/** A place with a high-born person and a low-born one, found by class (never by name). */
function highAndLow(w: ReturnType<typeof realmWorld>) {
  for (const site of [w.start, w.liege, ...[...w.live].sort()]) {
    const all = grownRows(w, site).filter((r) => !r.master_id);
    const high = all.find((r) => (CLASS_RANK[r.cls as SocialClass] ?? 2) >= 5);
    const low = all.filter((r) => (CLASS_RANK[r.cls as SocialClass] ?? 2) <= 2 && r.id !== high?.id);
    if (high && low.length >= 2) return { site, high, low: low[0]!, other: low[1]! };
  }
  throw new Error("no place with a noble and a commoner");
}

/** A world where the commoner holds a heavy grudge against the noble, with the given bravery. */
function grudgeWorld(bravery: number) {
  const w = realmWorld(1);
  const { site, high, low } = highAndLow(w);
  w.store.people.update(low.id, { traits: JSON.stringify({ ...traitsOfRow(low), bravery }) });
  addGrievance(w.store, { who: low.id, against: high.id, cause: "e:seed", weight: 1.1, day: 1 });
  return { w, site, high, low };
}

const choiceEvents = (w: ReturnType<typeof realmWorld>, actor: string, kind: string) => w.store.dumpTable("events").filter((e) => e.actor === actor && e.kind === kind && String(e.id).includes("choice:"));

describe("N38 step 6: townsfolk at coarse grain", () => {
  it("a bold commoner with a heavy grudge confronts the noble on some days; a cautious one in the same spot never does", () => {
    config.choice.mode = "all";
    const confrontations = (bravery: number) => {
      const { w, site, low, high } = grudgeWorld(bravery);
      let intents = 0;
      for (let day = 3; day <= 30; day++) {
        const r = choiceDay(w.ctx, { site }, day, { keep: true });
        intents += r.intents.filter((i) => i.id === low.id && i.kind === "confront" && i.target === high.id).length;
      }
      return { events: choiceEvents(w, low.id, "confrontation"), intents, w, low, high };
    };
    const bold = confrontations(0.97);
    expect(bold.events.length).toBeGreaterThanOrEqual(2);
    expect(bold.intents).toBe(bold.events.length);
    // Each one says why, in the top parts of its score, and the noble now holds a grievance against them.
    for (const e of bold.events) expect(String(e.why)).toMatch(/grudge vs .* \+/);
    expect(bold.w.store.social.openAgainst(bold.low.id).some((g) => g.who === bold.high.id)).toBe(true);
    expect(confrontations(0.04).events).toHaveLength(0);
  });

  it("nobody confronts the same person two days running (the cooldown lives on their row)", () => {
    config.choice.mode = "all";
    const { w, site, low } = grudgeWorld(0.97);
    const days: number[] = [];
    for (let day = 3; day <= 20; day++) {
      const before = choiceEvents(w, low.id, "confrontation").length;
      choiceDay(w.ctx, { site }, day);
      if (choiceEvents(w, low.id, "confrontation").length > before) days.push(day);
    }
    expect(days.length).toBeGreaterThan(1);
    for (let i = 1; i < days.length; i++) expect(days[i]! - days[i - 1]!).toBeGreaterThanOrEqual(2);
  });

  it("the crowd shows the confronting commoner at the noble's door that morning", () => {
    config.choice.mode = "all";
    const realm = generateRealm(7);
    const start = pickStartSite(realm, realm.seed);
    const map = siteMap(realm.settlements[start]!, "village", realm);
    const roster = rosterFor(realm, start, map, 3)!;
    const sim = new CrowdSim({ id: map.id, w: map.w, h: map.h, tiles: map.tiles, buildings: map.buildings, zones: map.zones }, roster);
    const [a, b] = roster.people.filter((p) => p.job !== "child" && p.job !== "guard" && p.work !== "home").slice(0, 2) as [Townsperson, Townsperson];
    const clear: CrowdDay = { weather: "clear", festival: false };
    const away = (d: CrowdDay) => sim.at(a, 3, 12 * 60, d);
    const usual = away(clear);
    const sent: CrowdDay = { ...clear, intents: [{ id: a.id, kind: "confront", target: b.id }] };
    const there = away(sent);
    expect(there.doing).toContain(`have it out with ${b.name}`);
    expect(usual.doing).not.toBe(there.doing);
    // And everyone else's day is the same as before.
    expect(sim.at(b, 3, 12 * 60, sent)).toEqual(sim.at(b, 3, 12 * 60, clear));
    expect(sim.at(a, 3, 8 * 60, sent)).toEqual(sim.at(a, 3, 8 * 60, clear));
  });

  it("intents are read back from the events a day's choices left", () => {
    config.choice.mode = "all";
    const { w, site, low, high } = grudgeWorld(0.97);
    let day = 3;
    for (; day <= 20; day++) if (choiceDay(w.ctx, { site }, day).intents.some((i) => i.kind === "confront")) break;
    expect(intentsOn(w.store, site, day)).toContainEqual({ id: low.id, kind: "confront", target: high.id });
    expect(intentsOn(w.store, site, day + 1000)).toEqual([]);
  });

  it("a day of choices for a place is cheap", () => {
    config.choice.mode = "all";
    const w = realmWorld(1);
    advanceWorld(w.realm, w.store, 20, { live: w.live });
    const times: number[] = [];
    for (let d = 21; d < 26; d++) {
      const t0 = performance.now();
      choiceDay(w.ctx, { site: w.start }, d);
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    expect(times[2]!).toBeLessThan(60 * Number(process.env.PERF_SLACK ?? 1));
  });

  it("is off unless the setting says all", () => {
    const w = realmWorld(1);
    config.choice.mode = "talkers";
    expect(choiceDay(w.ctx, { site: w.start }, 3).chose).toBe(0);
  });

  it("the same seed gives the same days: the world hashes the same", () => {
    config.choice.mode = "all";
    const run = () => {
      const w = realmWorld(1);
      advanceWorld(w.realm, w.store, 14, { live: w.live });
      return worldHash(w.realm, w.store);
    };
    expect(run()).toBe(run());
  });

  it("a place worked out later chooses what it would have chosen on the day", () => {
    config.choice.mode = "all";
    for (const k of Object.keys(TRIPS)) (TRIPS as Record<string, { cap: number }>)[k]!.cap = 0;
    const run = (lazy: boolean) => {
      const w = realmWorld(1);
      advanceWorld(w.realm, w.store, 2, { live: w.live });
      config.peopleLazy = lazy ? w.start : "";
      advanceWorld(w.realm, w.store, 12, { live: w.live });
      if (lazy) settle(w.ctx, w.start, 12);
      const mine = (id: unknown) => w.store.people.get(String(id))?.site === w.start;
      return JSON.stringify({ rels: w.store.dumpTable("relationships").filter((r) => mine(r.a)), events: w.store.dumpTable("events").filter((e) => String(e.site) === w.start && String(e.id).includes("choice:")) });
    };
    const live = run(false);
    expect(run(true)).toBe(live);
  });
});

// ---------- a real town, over days ----------

const shared = new Map<string, ReturnType<typeof playTown>>();
/** A town played for some days and then only read: tests that do not change it share one (the slowest thing in this file). */
function playedTown(seed: number, days: number) {
  const key = `${seed}:${days}:${config.choice.mode}`;
  if (!shared.has(key)) shared.set(key, playTown(seed, days));
  return shared.get(key)!;
}

function playTown(seed: number, days: number) {
  const templates = loadCreatureTemplates();
  const store = new WorldStore(":memory:");
  const town = new Town({ personas: {}, creatureTemplates: templates, world: newWorld({}, templates, always(0.5), seed), llm: new FakeProvider(), store });
  town.passHours(24 * days);
  return { town, store };
}

describe("N38: a real town plays", () => {
  it("the same seed plays the same days twice: the world hashes the same; another seed differs", () => {
    config.choice.mode = "talkers";
    const hash = (seed: number) => {
      const { town, store } = playTown(seed, 2);
      return worldHash(town.world, store);
    };
    const a = hash(1);
    expect(hash(1)).toBe(a);
    expect(hash(2)).not.toBe(a);
  });

  it("with only the schedule's own actions a whole town plays exactly as it did without the menu", () => {
    const hashWith = (mode: "off" | "talkers", only: string[]) => {
      config.choice.mode = mode;
      config.choice.only = only;
      const { town, store } = playTown(1, 2);
      return worldHash(town.world, store);
    };
    const without = hashWith("off", []);
    expect(hashWith("talkers", ["habit"])).toBe(without);
    // And with the whole menu it is a different town: the menu does move people.
    expect(hashWith("talkers", [])).not.toBe(without);
  });

  it("a talker asked why says so: in plain words, and in their own voice if the model has it", async () => {
    config.choice.mode = "talkers";
    const { town } = playTown(1, 6);
    const doer = town.members().find((m) => choicesOf(m.state).some((l) => !l.habit));
    expect(doer, "someone did something other than their day").toBeDefined();
    const says = await town.sayWhy(doer!.id);
    expect(says.length).toBeGreaterThan(0);
    for (const s of says) expect(s).toMatch(/because of/);
  });

  it("the talkers of the place choose every hour, and every choice that did something is an event with its reason", () => {
    config.choice.mode = "talkers";
    config.choice.violence = false;
    const { town } = playedTown(1, 4);
    const logs = town.members().flatMap((m) => [...choicesOf(m.state)]);
    expect(logs.length).toBeGreaterThan(20);
    // Not everyone does what they would have: the menu moves some of them. But most keep their day (habit wins).
    const habit = logs.filter((l) => l.habit).length;
    expect(habit / logs.length).toBeGreaterThan(0.6);
    const deeds = (town.world.events ?? []).filter((e) => e.why && /[+−]\d\.\d\d/.test(e.why));
    for (const e of deeds) expect(e.why!.split(", ").length).toBeLessThanOrEqual(3);
    // Nothing violent happens with the setting off.
    expect((town.world.events ?? []).filter((e) => (e.kind === "attacked" || e.kind === "theft" || e.kind === "theft-caught") && e.actor !== "player" && (e.why ?? "").includes("grudge"))).toHaveLength(0);
  });

  it("the admin view explains every choice: options, scores, parts, the temperature and the roll, for a talker's last hours", () => {
    config.choice.mode = "talkers";
    const { town, store } = playedTown(1, 4);
    const ctx: AdminContext = { world: () => town.world, town: () => town, store, queueLength: () => 0 };
    const talker = town.members().find((m) => choicesOf(m.state).length > 0)!;
    const v = choicesView(ctx, talker.id)!;
    expect(v.kind).toBe("talker");
    expect(v.choices.length).toBeGreaterThan(5);
    expect(v.words).toHaveLength(v.choices.length);
    for (const l of v.choices) {
      expect(l.options.length).toBeGreaterThan(0);
      expect(l.options[l.picked]).toBeDefined();
      expect(l.T).toBeGreaterThan(0);
      expect(l.roll).toBeGreaterThanOrEqual(0);
      for (const o of l.options) expect(Math.abs(o.parts.reduce((s, [, x]) => s + x, 0) - o.score)).toBeLessThan(0.02);
    }
    const c = card(ctx, `cast:${talker.id}`)!;
    expect(c.sections.map((s) => s.title)).toContain("Choices (last hours)");
    expect(choicesView(ctx, "nobody-at-all")).toBeNull();
  });
});

describe("N38 step 8: the player uses the same actions; the words", () => {
  it("the player's insult has the effects and the event an NPC's insult has", () => {
    const { members, commoner, lord } = scene(0.9, 0.9);
    const world = createTestWorld();
    world.day = 3;
    world.hour = 10;
    world.present = [];
    const before = lord.state.affection;
    const r = playerMenuAct("insult", lord.persona, lord.state, world);
    expect(r.ok).toBe(true);
    expect(lord.state.affection).toBeLessThan(before);
    const e = world.events!.find((x) => x.id === r.event)!;
    expect(e).toMatchObject({ kind: "insulted", actor: "player", target: "lord" });
    expect(e.why).toContain("you chose it");
    // The same table drives an NPC's insult: the same shift in how the target sees the actor.
    const fx = EFFECTS.insult.target;
    expect(lord.state.affection - before).toBe(fx.affection);
    void members;
    void commoner;
  });

  it("describes what a talker lately did, and why, in plain words", () => {
    const { members, commoner } = scene(0.97, 0.9);
    for (let seed = 1; seed <= 40; seed++) {
      commoner.state.choice = undefined;
      chooseHour(env(members, seed));
      if (!choicesOf(commoner.state).at(-1)!.habit) break;
    }
    const line = describeChoices(commoner.state)!;
    expect(line).toMatch(/^Lately you /);
    expect(line).toMatch(/because of/);
  });

  it("explains a choice in the person's voice if the model gives something usable, and in plain words if not", async () => {
    const { members, commoner } = scene(0.97, 0.9);
    for (let seed = 1; seed <= 40; seed++) {
      chooseHour(env(members, seed));
      if (!choicesOf(commoner.state).at(-1)!.habit) break;
    }
    const log = choicesOf(commoner.state).at(-1)!;
    expect(await explainChoice(log, "Odo", new FakeProvider([say('{"reason":"He has wronged me and I will not be silent."}')]))).toBe("He has wronged me and I will not be silent.");
    expect(await explainChoice(log, "Odo", new FakeProvider([say("nonsense"), say("nonsense")]))).toMatch(/^Odo /);
    expect(await explainChoice(log, "Odo")).toMatch(/because of/);
    expect(CALL_KINDS).toContain("choice-reason");
    expect(CALL_KINDS.indexOf("choice-reason")).toBeGreaterThan(CALL_KINDS.indexOf("chatter-line"));
    expect(budgets.model.perGameDay["choice-reason"]).toBeGreaterThan(0);
  });
});

describe("N38: balance bounds", () => {
  it("hold over a week of choosing, and fail on purpose when they should", () => {
    // Most people just have their day; the one with a grudge is the exception that the loop guard is for.
    const calm = member(hale, "calm", { schedule: WORKDAY, traits: { bravery: 0.5, temper: 0.4, honesty: 0.8, sociability: 0.5, forgiveness: 0.5, generosity: 0.5 } });
    const quiet = member(pell, "quiet", { schedule: SQUARE });
    const { members, commoner } = scene(0.95, 0.9);
    const logs: ChoiceLog[] = [];
    const grudge: ChoiceLog[] = [];
    for (let h = 0; h < 24 * 7; h++) {
      chooseHour(env([calm, quiet], 4, {}, h % 24, 1 + Math.floor(h / 24)));
      logs.push(choicesOf(calm.state).at(-1)!);
      chooseHour(env(members, 4, {}, h % 24, 1 + Math.floor(h / 24)));
      grudge.push(choicesOf(commoner.state).at(-1)!);
    }
    expect(checkChoiceBounds({ logs: grudge, violent: [] }).find((b) => b.name === "no-loops")).toMatchObject({ ok: true });
    expect(checkChoiceBounds({ logs: grudge, violent: [] }).find((b) => b.name === "work-still-happens")!.ok).toBe(false);
    const ok = checkChoiceBounds({ logs, violent: [], hourMs: 1 });
    expect(ok.map((b) => b.name)).toEqual(["no-loops", "work-still-happens", "violence-rare", "choices-cost"]);
    for (const b of ok) expect(b, `${b.name}: ${b.detail}`).toMatchObject({ ok: true });
    // A run of one action in a row, a shirker, and a fight with the setting off are all caught.
    const picked = grudge.find((l) => !l.habit);
    const looped = Array.from({ length: 6 }, () => ({ ...picked!, habit: false }));
    expect(checkChoiceBounds({ logs: looped, violent: [] }).find((b) => b.name === "no-loops")!.ok).toBe(false);
    expect(checkChoiceBounds({ logs, violent: [{ site: "x", day: 3 }] }).find((b) => b.name === "violence-rare")!.ok).toBe(false);
    expect(checkChoiceBounds({ logs, violent: [], hourMs: 10_000 }).find((b) => b.name === "choices-cost")!.ok).toBe(false);
  });
});
