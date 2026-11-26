import { beforeEach, describe, expect, it, vi } from "vitest";
import { config } from "../src/config.js";
import { WorldStore } from "../src/game/db.js";
import { seededRng } from "../src/game/dice.js";
import { bandArrives, dragonWakes, peoplesRealmDay, residentsSiteDay } from "../src/game/peoples/day.js";
import { foodRatio } from "../src/game/realm/economy.js";
import { generatePeoples, peoplesOf } from "../src/game/peoples/generate.js";
import type { LifeCtx } from "../src/game/people/step.js";
import { generateRealm } from "../src/game/realm/generate.js";
import { policyOf, policyRealmDay, setPolicy } from "../src/game/realm/policy.js";
import { pickStartSite } from "../src/game/realm/start.js";
import { checkPeoples, loadPeoples, PEOPLES, peopleOf, SPECIES, speciesOf, stanceOf } from "../src/world/species.js";
import { loadCreatureTemplates } from "../src/game/creatures.js";
import type { PersonRow } from "../src/store/peopleStore.js";
import { materialisePeople } from "../src/store/materialise.js";
import { alliancesDay, hatredsDay, intentionOf, intentionsDay } from "../src/game/peoples/intent.js";
import { pickInteraction } from "../src/game/chatter/pick.js";
import { prejudice } from "../src/game/chatter/day.js";
import { cleverRises } from "../src/game/peoples/day.js";
import { personaFor, TALKER_RENOWN } from "../src/game/realm/rise.js";
import { loadTemplates } from "../src/npc/templates.js";
import { befriendPeople, BEFRIEND_CAP, deedAgainstPeople, peopleOfCreature, peopleReputeOf } from "../src/game/peoples/repute.js";
import { postRealmJobs, resolveJobs } from "../src/game/market/day.js";
import { claim } from "../src/game/market/jobs.js";
import type { PlayerState } from "../src/npc/types.js";

/**
 * N54: peoples and monsters. Species as data; a goblin warren near the start town with an ogre bound to it, an orc kingdom in the east, a
 * dwarf hold, a centaur herd that moves with the seasons, a dragon in the northern peaks; raids, a war of old hatred and a call for help,
 * goblins living among people where the law lets them, orcs kept only as slaves in the slave kingdom, and a dragon's fire and tribute.
 */
vi.setConfig({ testTimeout: 300_000, hookTimeout: 300_000 });

beforeEach(() => {
  config.realm = true;
  config.realmSeed = undefined;
  config.society.peoples = true;
});

describe("N54 Part A: species as data", () => {
  it("the peoples load into the species table with their lives, minds and stances; humans are as they were", () => {
    expect(speciesOf("human").adultAge).toBe(16);
    expect(speciesOf("goblin").maxAge).toBeGreaterThan(30);
    expect(speciesOf("dragon").maxTier).toBe("SSS");
    expect(stanceOf("dwarf", "goblin")).toBeLessThan(-50);
    expect(stanceOf("goblin", "ogre")).toBeGreaterThan(0);
  });

  it("every people and animal is a data file that passes the schema and the cross-checks (A1)", () => {
    const all = loadPeoples();
    expect(checkPeoples(all, Object.keys(loadCreatureTemplates()))).toEqual([]);
    // The stage file's list, with the three giants apart, beside the old peoples and the animals.
    for (const id of ["goblin", "hobgoblin", "orc", "ogre", "troll", "hill_giant", "frost_giant", "stone_giant", "dragon", "kobold", "gnoll", "lizardfolk", "harpy", "centaur", "minotaur", "elf", "dwarf", "halfling", "human", "wolf", "bear"]) expect(peopleOf(id), id).toBeDefined();
    expect(Object.keys(SPECIES).sort()).toEqual(PEOPLES.map((p) => p.id).sort());
    expect(peopleOf("frost_giant")!.climate).toBe("cold");
    expect(peopleOf("dwarf")!.underMountain).toBe(true);
    expect(peopleOf("dragon")!.sizeClass).toBe(3);
  });

  it("the old code table is unchanged: humans, the old peoples and the animals keep their exact lives (A1)", () => {
    expect(SPECIES.human).toEqual({ name: "a human", talks: true, adultAge: 16, elderAge: 60, maxAge: 95, maxTier: "SSS", learnRate: 1 });
    expect(SPECIES.orc).toEqual({ name: "an orc", talks: true, adultAge: 12, elderAge: 40, maxAge: 65, maxTier: "SS", learnRate: 1.3 });
    expect(SPECIES.wolf).toEqual({ name: "a wolf", talks: false, adultAge: 2, elderAge: 8, maxAge: 14, maxTier: "B", learnRate: 1.2 });
    expect(SPECIES.dog).toEqual({ name: "a dog", talks: false, adultAge: 1, elderAge: 9, maxAge: 15, maxTier: "F", learnRate: 1 });
    // Beast minds don't talk (their clever few aside); cunning and reasoning ones do.
    expect(speciesOf("ogre").talks).toBe(false);
    expect(speciesOf("goblin").talks).toBe(true);
  });

  it("each people met in the wild has a fight template of its own kind (A2)", () => {
    const t = loadCreatureTemplates();
    for (const p of PEOPLES.filter((x) => x.creature)) {
      expect(t[p.creature!], p.id).toBeDefined();
      if (p.living !== "wild") expect(t[p.creature!]!.species === p.id || p.creature === "giant", p.id).toBe(true);
    }
  });
});

describe("N54 Part B: the realm generates its peoples", () => {
  it("a goblin warren in the hills near the start town, an orc kingdom in the east, a herd that moves with the seasons, a dragon in the northern peaks", () => {
    const realm = generateRealm(1, 1);
    const humans = Object.values(realm.settlements).filter((s) => !s.way);
    const st = generatePeoples(realm, 1)!;
    const warren = realm.settlements[st.warren!]!;
    const start = realm.settlements[pickStartSite(realm, realm.seed)]!;
    expect(warren.species).toBe("goblin");
    expect(warren.terrain).toBe("hills");
    // Near: closer to the start town than most places are.
    const d = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
    const farther = humans.filter((s) => d(s.pos, start.pos) > d(warren.pos, start.pos)).length;
    expect(farther / humans.length).toBeGreaterThan(0.5);
    const orcs = realm.kingdoms[st.orcs!]!;
    expect(orcs.species).toBe("orc");
    expect(realm.settlements[orcs.capital]!.pos.x).toBeGreaterThan(Math.max(...humans.map((s) => s.pos.x)));
    expect(realm.figures[orcs.ruler!]!.species).toBe("orc");
    const lair = st.lairs[st.dragon!]!;
    expect(lair.y).toBeLessThan(Math.min(...humans.map((s) => s.pos.y)));
    expect(realm.figures[st.dragon!]!.species).toBe("dragon");
    // The herd moves with the seasons.
    const herd = realm.settlements[st.herd!]!;
    const seen = new Set<string>();
    for (let day = 1; day <= 48; day++) {
      peoplesRealmDay(realm, day);
      seen.add(`${herd.pos.x},${herd.pos.y}`);
    }
    expect(seen.size).toBe(4);
  });

  it("every other people is placed where its habitat fits: frost giants in the north, lizardfolk in the marsh, an elf realm in the forest, kobolds by the dragon (B1)", () => {
    for (const seed of [1, 3]) {
      const realm = generateRealm(seed, 1);
      const humans = Object.values(realm.settlements).filter((s) => !s.way && !s.species);
      const st = generatePeoples(realm, 1)!;
      const placed = st.placed!;
      for (const p of ["hobgoblin", "hill_giant", "frost_giant", "stone_giant", "kobold", "gnoll", "lizardfolk", "harpy", "elf"]) {
        const ids = placed.settlements[p] ?? [];
        expect(ids.length, `${p} (seed ${seed})`).toBeGreaterThan(0);
        for (const id of ids) {
          const s = realm.settlements[id]!;
          expect(s.species).toBe(p);
          expect(peopleOf(p)!.habitat).toContain(s.terrain);
        }
      }
      for (const p of ["troll", "minotaur"]) for (const id of placed.figures[p] ?? []) expect(st.lairs[id]).toBeDefined();
      expect((placed.figures.troll ?? []).length).toBeGreaterThan(0);
      // Frost giants live in the north half of the human lands.
      const ys = humans.map((s) => s.pos.y).sort((a, b) => a - b);
      expect(realm.settlements[placed.settlements.frost_giant![0]!]!.pos.y).toBeLessThan(ys[Math.floor(ys.length / 2)]! + 40);
      // The elves rule a kingdom of their own, with an elf on the throne.
      const elves = realm.kingdoms[placed.kingdoms.elf!]!;
      expect(elves.species).toBe("elf");
      expect(realm.figures[elves.ruler!]!.species).toBe("elf");
      expect(realm.factions[elves.crown]).toBeDefined();
      // Kobolds dig in nearer the dragon's peaks than most human places are.
      const lair = st.lairs[st.dragon!]!;
      const kob = realm.settlements[placed.settlements.kobold![0]!]!;
      const dist = (a: { x: number; y: number }) => Math.hypot(a.x - lair.x, a.y - lair.y);
      expect(humans.filter((s) => dist(s.pos) > dist(kob.pos)).length / humans.length).toBeGreaterThan(0.5);
      // The gnolls wander; their heads are of their own people and named in their own words.
      expect(realm.settlements[placed.settlements.gnoll![0]!]!.nomadic).toBeDefined();
      const head = realm.figures[realm.settlements[placed.settlements.gnoll![0]!]!.leader!]!;
      expect(head.species).toBe("gnoll");
      expect(peopleOf("gnoll")!.names).toContain(head.name);
      // The same seed gives the same peoples.
      const again = generatePeoples(generateRealm(seed, 1), 1)!;
      expect(again.placed).toEqual(placed);
    }
  });

  it("a wandering band moves each season and, at its new grazing, raids the weak or trades (B2)", () => {
    const realm = generateRealm(1, 1);
    const st = generatePeoples(realm, 1)!;
    const band = realm.settlements[st.placed!.settlements.gnoll![0]!]!;
    const seen = new Set<string>();
    for (let day = 1; day <= 96; day++) {
      peoplesRealmDay(realm, day);
      seen.add(`${band.pos.x},${band.pos.y}`);
    }
    expect(seen.size).toBe(4);
    // At each new grazing the band meets its nearest neighbour: a fierce people raids one it outnumbers.
    const near = { ...realm.settlements[Object.keys(realm.settlements).find((id) => !realm.settlements[id]!.way && !realm.settlements[id]!.species)!]! };
    const weak = { ...near, id: "weak_hamlet", name: "Weakling", pos: { x: band.pos.x + 5, y: band.pos.y }, population: 20, species: undefined, roads: [] };
    realm.settlements[weak.id] = weak;
    expect(bandArrives(realm, band, 200)).toBe("raid");
    // A peaceful band trades instead.
    band.species = "centaur";
    expect(bandArrives(realm, band, 201)).toBe("trade");
    expect(realm.treaties.some((t) => t.kind === "trade" && t.a === `s:${band.id}`)).toBe(true);
  });

  it("other peoples' places live by their own lights: goblins, with their fungus beds under the hill, get more from the same land than humans would, and breed faster (B3)", () => {
    const realm = generateRealm(1, 1);
    const st = generatePeoples(realm, 1)!;
    const warren = realm.settlements[st.warren!]!;
    const asHumans = foodRatio(realm, { ...warren, species: undefined }, 10);
    // Goblins and kobolds farm 1.1 (was under 1: their hill warrens starved every winter on seeds 1 and 2).
    expect(foodRatio(realm, warren, 10)).toBeGreaterThan(asHumans);
    expect(peopleOf("goblin")!.economy!.breed).toBeGreaterThan(1);
    expect(peopleOf("elf")!.economy!.breed).toBeLessThan(1);
  });
});

describe("N54 Part C: relations and intentions", () => {
  it("the goblins raid toward the mine road and have a pact with an ogre", () => {
    const realm = generateRealm(1, 1);
    const st = generatePeoples(realm, 1)!;
    expect(realm.treaties.some((t) => t.kind === "service" && t.a === `s:${st.warren}` && t.b === `p:${st.ogre}`)).toBe(true);
    for (let day = 1; day <= 96; day++) peoplesRealmDay(realm, day);
    expect(realm.news.some((n) => n.kind === "raid" && n.text.includes("Goblins") && /mine road/.test(n.text))).toBe(true);
  });

  it("the orc kingdom wars with the dwarves, and the dwarves seek help from a human crown", () => {
    const realm = generateRealm(1, 1);
    const st = generatePeoples(realm, 1)!;
    for (let day = 1; day <= 200 && st.asked.length === 0; day++) peoplesRealmDay(realm, day);
    expect(realm.wars.some((w) => w.attackers.includes(`k:${st.orcs}`) && w.defenders.includes(`k:${st.dwarves}`))).toBe(true);
    expect(st.asked.length).toBeGreaterThan(0);
    const ask = st.asked[0]!;
    expect(realm.kingdoms[ask.of]!.species).toBeUndefined();
    expect(realm.news.some((n) => n.text.includes("asked") && n.text.includes("for help against"))).toBe(true);
  });

  it("a clever goblin lives in the liege town's outer quarter because its kingdom tolerates goblins, while the slave kingdom keeps orcs only as slaves", () => {
    const realm = generateRealm(1, 1);
    const store = new WorldStore(":memory:");
    materialisePeople(realm, store.people, 1);
    const ctx: LifeCtx = { realm, store };
    const st = generatePeoples(realm, 1)!;
    policyRealmDay(realm, 1);
    const warren = realm.settlements[st.warren!]!;
    const town = Object.values(realm.settlements).filter((s) => !s.species && !s.way && s.kingdom).sort((a, b) => Math.hypot(a.pos.x - warren.pos.x, a.pos.y - warren.pos.y) - Math.hypot(b.pos.x - warren.pos.x, b.pos.y - warren.pos.y))[0]!;
    setPolicy(realm, town.kingdom!, "species:goblin", "limited", 1, "test");
    let id: string | null = null;
    for (let day = 1; day <= 200 && !id; day++) id = residentsSiteDay(ctx, town.id, day);
    expect(id).not.toBeNull();
    const row = store.people.get(id!)!;
    expect(row.species).toBe("goblin");
    expect(JSON.parse(row.origin!).site).toBe(warren.id);
    const map = (await_map(realm, town.id));
    expect(["d:noble", "d:castle", "d:palace", "d:manor"]).not.toContain(map[row.home!] ?? "");
    // Some of the goblins who come can talk with anyone.
    expect(st.residents.find((r) => r.id === id)).toBeDefined();
    // The slave kingdom: orcs only as slaves.
    const slaveK = Object.values(realm.kingdoms).find((k) => k.laws.slavery && !k.species)!;
    setPolicy(realm, slaveK.id, "species:orc", "slaves_only", 1, "test");
    expect(policyOf(realm, slaveK.id, "species:orc")).toBe("slaves_only");
    const place = Object.values(realm.settlements).find((s) => s.kingdom === slaveK.id && !s.way)!;
    const someone = (store.people.loadSite(place.id, "full") as PersonRow[]).find((r) => r.job !== "child" && r.cls !== "slave")!;
    store.people.update(someone.id, { species: "orc" });
    residentsSiteDay(ctx, place.id, 2);
    expect(store.people.get(someone.id)!.cls).toBe("slave");
  });
});

import { siteMap } from "../src/web/sites.js";
describe("N54 Part C, for every people placed by habitat", () => {
  it("alliances of convenience: a lone beast taken into service, giants hired by a crown, the weak under a strong friend (C1)", () => {
    const realm = generateRealm(1, 1);
    const st = generatePeoples(realm, 1)!;
    const made = alliancesDay(realm, st, 2);
    expect(made.length).toBeGreaterThan(0);
    for (const m of made) {
      const [kind, a, b] = m.split(":");
      const t = realm.treaties.find((x) => (kind === "defense" ? x.kind === "mutual_defense" : x.kind === "service") && [x.a, x.b].some((p) => p.endsWith(a!)) && [x.a, x.b].some((p) => p.endsWith(b!)));
      expect(t, m).toBeDefined();
    }
    // Made once: the next call the same year finds them already signed.
    const again = alliancesDay(realm, st, 3);
    for (const m of made) expect(again).not.toContain(m);
    expect(realm.news.some((n) => n.kind === "peoples" && /service|hired|protection/.test(n.text))).toBe(true);
  });

  it("each home picks an intention by temperament and acts on it, with its reason; a wronged people takes revenge (C2)", () => {
    const realm = generateRealm(1, 1);
    const st = generatePeoples(realm, 1)!;
    const home = (sp: string) => realm.settlements[st.placed!.settlements[sp]![0]!]!;
    // The same place on the same day always wants the same thing.
    expect(intentionOf(realm, home("lizardfolk"), 11)).toEqual(intentionOf(realm, home("lizardfolk"), 11));
    // Over a year of seasons, the fierce hobgoblins raid more than the easy-going lizardfolk do.
    const count = (sp: string, want: string) => [11, 23, 35, 47, 59, 71, 83, 95].filter((d) => intentionOf(realm, home(sp), d).intent === want).length;
    expect(count("hobgoblin", "raid")).toBeGreaterThanOrEqual(count("lizardfolk", "raid"));
    expect(count("lizardfolk", "raid")).toBeLessThan(8);
    const recs = intentionsDay(realm, st, 11);
    expect(recs.length).toBeGreaterThan(0);
    for (const r of recs) expect(r.why.length).toBeGreaterThan(0);
    expect(st.intents![recs[0]!.site]).toEqual(recs[0]);
    // A raid on them is remembered, and the raided pay it back.
    const victim = home("hobgoblin");
    const raider = home("kobold");
    st.raidedBy = { [victim.id]: { by: raider.id, day: 12 } };
    raider.pos = { x: victim.pos.x + 20, y: victim.pos.y };
    expect(intentionOf(realm, victim, 13).intent).toBe("revenge");
  });

  it("an old hatred between crowns of peoples: the orcs and the elves go to war, and the elves ask a human crown for help (C2)", () => {
    const realm = generateRealm(1, 1);
    const st = generatePeoples(realm, 1)!;
    let w: string | null = null;
    for (let day = 20; day <= 20 + 48 * 10 && !w; day += 48) w = hatredsDay(realm, st, day);
    expect(w).not.toBeNull();
    const war = realm.wars.find((x) => x.id === w)!;
    const sides = [...war.attackers, ...war.defenders];
    expect(sides).toContain(`k:${st.placed!.kingdoms.elf}`);
    expect(st.asked.some((a) => a.war === w)).toBe(true);
  });

  it("other peoples come to live in human places where the law lets them, named in their own words (C3)", () => {
    const realm = generateRealm(1, 1);
    const store = new WorldStore(":memory:");
    materialisePeople(realm, store.people, 1);
    const ctx: LifeCtx = { realm, store };
    const st = generatePeoples(realm, 1)!;
    policyRealmDay(realm, 1);
    const from = realm.settlements[st.placed!.settlements.lizardfolk![0]!]!;
    const town = Object.values(realm.settlements).filter((s) => !s.species && !s.way && s.kingdom).sort((a, b) => Math.hypot(a.pos.x - from.pos.x, a.pos.y - from.pos.y) - Math.hypot(b.pos.x - from.pos.x, b.pos.y - from.pos.y))[0]!;
    for (const sp of ["goblin", "lizardfolk", "hobgoblin", "kobold", "gnoll", "harpy"]) setPolicy(realm, town.kingdom!, `species:${sp}`, sp === "lizardfolk" ? "welcome" : "banned", 1, "test");
    let id: string | null = null;
    for (let day = 1; day <= 200 && !id; day++) id = residentsSiteDay(ctx, town.id, day);
    expect(id).not.toBeNull();
    const row = store.people.get(id!)!;
    expect(row.species).toBe("lizardfolk");
    expect(peopleOf("lizardfolk")!.names!.some((n) => row.name.startsWith(n))).toBe(true);
    expect(JSON.parse(row.origin!).site).toBe(from.id);
  });

  it("prejudice in chatter: a human who looks down on goblins sneers at one more often than at another human (C3)", () => {
    expect(prejudice("human", "goblin")).toBeGreaterThan(0);
    expect(prejudice("goblin", "ogre")).toBe(0);
    const t = { rank: 2, temper: 0.5, pride: 0.5, bravery: 0.5, honesty: 0.5, mood: 0 } as never;
    const zero = { trust: 0, affection: 0, respect: 0, fear: 0 } as never;
    const row = (id: string, species: string) => ({ id, species, master_id: null }) as never;
    const hostileShare = (scorn: number) => {
      let n = 0;
      const rng = seededRng(7);
      for (let i = 0; i < 4000; i++) {
        const k = pickInteraction({ x: { row: row("a", "human"), t }, y: { row: row("b", "goblin"), t }, viewXofY: zero, viewYofX: zero, hateXofY: 0, hateYofX: 0, kin: false, witnesses: 0, drink: false, bowing: true, prejudiceXofY: scorn, prejudiceYofX: 0 }, rng).kind;
        if (k === "sneer" || k === "insult" || k === "threaten" || k === "humiliate") n++;
      }
      return n / 4000;
    };
    expect(hostileShare(prejudice("human", "goblin"))).toBeGreaterThan(hostileShare(0));
  });
});

describe("N54 Part D: clever ones, dragon-slayers, and the player among the peoples", () => {
  it("a clever goblin among people is a figure worth talking to, and talks as a goblin with a goblin's view (D1)", () => {
    const realm = generateRealm(1, 1);
    const store = new WorldStore(":memory:");
    materialisePeople(realm, store.people, 1);
    const ctx: LifeCtx = { realm, store };
    const st = generatePeoples(realm, 1)!;
    policyRealmDay(realm, 1);
    const warren = realm.settlements[st.warren!]!;
    const town = Object.values(realm.settlements).filter((s) => !s.species && !s.way && s.kingdom).sort((a, b) => Math.hypot(a.pos.x - warren.pos.x, a.pos.y - warren.pos.y) - Math.hypot(b.pos.x - warren.pos.x, b.pos.y - warren.pos.y))[0]!;
    setPolicy(realm, town.kingdom!, "species:goblin", "welcome", 1, "test");
    let id: string | null = null;
    for (let day = 1; day <= 400 && !(id && st.residents.find((r) => r.id === id)?.clever); day++) {
      const got = residentsSiteDay(ctx, town.id, day);
      if (got) id = got;
      if (st.residents.filter((r) => r.site === town.id).length >= 2) st.residents = st.residents.filter((r) => r.site !== town.id || r.clever);
    }
    const rec = st.residents.find((r) => r.id === id && r.clever);
    expect(rec).toBeDefined();
    const row = store.people.get(id!)!;
    const fig = realm.figures[row.figure!]!;
    expect(fig.id).toBe(`fig-r-${id}`);
    expect(fig.species).toBe("goblin");
    expect(fig.renown).toBeGreaterThanOrEqual(TALKER_RENOWN);
    expect(cleverRises(ctx, id!, 500)).toBeNull();
    const persona = personaFor(fig, loadTemplates(), 500, seededRng(1), [])!;
    expect(persona).not.toBeNull();
    expect(persona.species).toBe("goblin");
    expect(persona.backstory).toMatch(/As a goblin, they/);
  });

  it("a hamlet that pays a dragon posts a dragon-slayer's job; a party that wins kills the dragon and takes its hoard (D2)", () => {
    const realm = generateRealm(1, 1);
    const store = new WorldStore(":memory:");
    const st = generatePeoples(realm, 1)!;
    const burned = dragonWakes(realm, st, st.dragon!, st.lairs[st.dragon!]!, 10, seededRng(3))!;
    realm.settlements[burned]!.treasury = 2000;
    postRealmJobs(realm, store, 11);
    const job = store.jobs.list((j) => j.kind === "slay")[0]!;
    expect(job).toBeDefined();
    expect(job.target).toBe(st.dragon);
    expect(job.title).toMatch(/Slay .* the dragon/);
    // A party of heroes far beyond the dragon's strength.
    const heroes = Object.values(realm.figures).filter((f) => f.alive && f.species === "human").slice(0, 4);
    for (const f of heroes) {
      f.life.tier = "SSS";
      f.bravery = 1;
    }
    store.jobs.putParty({ id: "party1", leader: heroes[0]!.id, members: JSON.stringify(heroes.map((f) => f.id)), roles: "{}", shares: "equal", formed: 11, disbanded: null, record: JSON.stringify({ done: 0, failed: 0, deaths: 0, earned: 0 }) });
    claim(store, job.id, "party1", 11, { arrive: 11 });
    let dead = false;
    for (let d = 12; d < 40 && !dead; d++) {
      resolveJobs(realm, store, d);
      dead = !realm.figures[st.dragon!]!.alive;
      if (!dead && store.jobs.job(job.id)!.status === "open") claim(store, job.id, "party1", d, { arrive: d });
    }
    expect(dead).toBe(true);
    expect(realm.news.some((n) => n.importance === 10 && /slew .* the dragon/.test(n.text))).toBe(true);
  });

  it("reputation by people: killing goblins sets goblins against you and pleases dwarves; time among a people earns a little goodwill (D3)", () => {
    const p = { name: "Wren" } as unknown as PlayerState;
    expect(peopleOfCreature("goblin")).toBe("goblin");
    expect(peopleOfCreature("wolf")).toBeUndefined();
    expect(peopleOfCreature("bandit")).toBeUndefined();
    deedAgainstPeople(p, "goblin", true);
    expect(peopleReputeOf(p).goblin).toBeLessThan(0);
    expect(peopleReputeOf(p).dwarf).toBeGreaterThan(0);
    for (let i = 0; i < 30; i++) befriendPeople(p, "lizardfolk");
    expect(peopleReputeOf(p).lizardfolk).toBe(BEFRIEND_CAP);
  });
});

function await_map(realm: ReturnType<typeof generateRealm>, site: string): string[] {
  return siteMap(realm.settlements[site]!, "village", realm).buildings.map((b) => b.district ?? "");
}

describe("N54 Part D: the dragon", () => {
  it("the dragon burns a hamlet, demands tribute, and the hamlet's head pays", () => {
    const realm = generateRealm(1, 1);
    const st = generatePeoples(realm, 1)!;
    const dragon = st.dragon!;
    const pops = Object.fromEntries(Object.values(realm.settlements).map((x) => [x.id, x.population]));
    const burned = dragonWakes(realm, st, dragon, st.lairs[dragon]!, 10, seededRng(3))!;
    const s = realm.settlements[burned]!;
    expect(s.kind === "hamlet" || s.kind === "village").toBe(true);
    expect(s.lastRaided).toBe(10);
    expect(realm.treaties.some((t) => t.kind === "tribute" && t.a === `s:${burned}` && t.b === `p:${dragon}`)).toBe(true);
    expect(realm.news.some((n) => n.kind === "dragon" && /burned/.test(n.text))).toBe(true);
    expect(realm.news.some((n) => n.kind === "dragon" && /paid/.test(n.text)) || realm.news.some((n) => /could not pay/.test(n.text))).toBe(true);
    // Its dead (a number where its people aren't rows; orders for the people's day where they are).
    expect(s.population < pops[burned]! || realm.casualties.some((c) => c.site === burned && c.killer === dragon)).toBe(true);
    // A dragon is slow to wake again.
    for (let day = 11; day <= 40; day++) peoplesRealmDay(realm, day);
    // (The realm's other dragons keep their own sleeps: only this one's fires count here.)
    expect(realm.news.filter((n) => n.kind === "dragon" && /burned/.test(n.text) && n.text.includes(realm.figures[dragon]!.name)).length).toBe(1);
    void peoplesOf;
  });
});
