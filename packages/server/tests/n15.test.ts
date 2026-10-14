/**
 * N15: localities. Every place's village is generated, and what isn't the village (the road,
 * a gang's camp, a dungeon's mouth, the woods) is on maps of its own around it. A place's
 * notables from the realm talk, and everyone who talks remembers by meaning (SQLite + embeddings).
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findPath } from "@millbrook/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { config } from "../src/config.js";
import { WorldStore } from "../src/game/db.js";
import { forage } from "../src/game/gathering.js";
import { generateRealm, lieges } from "../src/game/realm/generate.js";
import { notablesOf } from "../src/game/realm/notables.js";
import { BEAST_DEN, GANG_DEN, gangOf, MAX_ON_MAP, settleHaunts, stockHaunts } from "../src/game/realm/haunts.js";
import { foundFaction } from "../src/game/realm/factions.js";
import { makeFigure } from "../src/game/realm/figures.js";
import { GUILD_FEE, joinGuild, playerDelve } from "../src/game/realm/wilds.js";
import type { Realm } from "../src/game/realm/types.js";
import { loadWorld, newWorld, SAVE_VERSION, saveWorld } from "../src/game/save.js";
import { AREAS, type AreaId, areaOfPlace, parsePlace, PLACES } from "../src/game/schedule.js";
import { certaintyOf } from "../src/npc/knowledge.js";
import { parsePersona } from "../src/npc/personaSchema.js";
import { type Creature, loadCreatureTemplates, spawnCreature } from "../src/game/creatures.js";
import { areasOf, DEN_KEYS, exitTo, siteMap, type SiteMap } from "../src/web/sites.js";
import { allPersonas, always, FakeProvider, makeTown, say } from "./helpers.js";
import { creaturesOf } from "../src/game/site.js";

beforeEach(() => {
  config.director = false;
  config.planning = false;
  config.summaries = false;
  config.realm = true;
});

/** A gang seated at a place: a chief and two of his men, of the wilds (no home, so not the place's talking folk). */
function gangAt(realm: Realm, site: string) {
  const chief = makeFigure(realm, always(0.5), { role: "bandit chief", home: null, tier: "E", age: 30, name: "Black Tam", renown: 35 }, 1);
  const fac = foundFaction(realm, always(0.5), { kind: "gang", founder: chief, seat: site, creed: "a toll on every cart", why: "test" }, 1);
  for (const name of ["Wat Crow", "Nell Briar"]) {
    const m = makeFigure(realm, always(0.5), { role: "bandit", home: null, tier: "F", age: 22, name }, 1);
    m.faction = fac.id;
    fac.members.push(m.id);
  }
  return fac;
}

/** A village with everything around it: a gang's camp up the road, and a dungeon past it. */
function fullSite() {
  const realm = generateRealm(3, 1);
  const s = Object.values(realm.settlements).find((x) => x.kind === "village" && !gangOf(realm, x.id) && !Object.values(realm.dungeons).some((d) => d.near === x.id))!;
  s.buildings = { farms: 1, inn: 1, smithy: 1 };
  gangAt(realm, s.id);
  realm.dungeons.full_deeps = { id: "full_deeps", name: "the Full Deeps", near: s.id, pos: { x: 0, y: 0 }, tier: "F", depth: 2, danger: 40, treasure: 500, bounty: 0, delves: 0 };
  return { realm, s, map: (area: AreaId = "village"): SiteMap => siteMap(s, area, realm) };
}
const open = (m: SiteMap) => (x: number, y: number) => m.isSolid(x, y);
const reachable = (m: SiteMap, from: { x: number; y: number }, to: { x: number; y: number }) => findPath(from, (t) => t.x === to.x && t.y === to.y, open(m)) !== null;
const inDen = (m: SiteMap, key: string) => {
  const d = m.dens[key]!;
  const free: Array<{ x: number; y: number }> = [];
  for (let y = d.y0; y <= d.y1; y++) for (let x = d.x0; x <= d.x1; x++) if (!m.isSolid(x, y)) free.push({ x, y });
  return free;
};

describe("N15.1 a village is generated", () => {
  it("is made by the same generator as every other place, with names from what's built", () => {
    const { s, map } = fullSite();
    const v = map();
    expect(v.id).toBe(s.id);
    expect(v.area).toBe("village");
    const names = v.buildings.map((b) => b.name);
    expect(names).toEqual(expect.arrayContaining(["Village hall", "Forge"]));
    expect(v.buildings.some((b) => b.kind === "inn")).toBe(true);
    // The same every time (seeded by the place's id).
    expect(siteMap({ ...s }, "village", generateRealm(3, 1)).tiles).toEqual(siteMap({ ...s }, "village", generateRealm(3, 1)).tiles);
    // Its places speak in its own words.
    expect(v.placeWords("forge").location).toBe(`the smithy of ${s.name}`);
    expect(v.placeWords("inn").location).toMatch(new RegExp(`the inn of ${s.name}`));
    expect(v.npcSpot("anyone", "forge")!.nearby).toContain("an anvil");
  });

  it("holds only the village: no camp, den, mine or road on it", () => {
    const v = fullSite().map();
    expect(v.places.sort()).toEqual(["forge", "gate", "inn", "square"]);
    expect(Object.keys(v.dens).sort()).toEqual(["gate_road", "horse", "paddock", "square", "villager"]);
    expect(v.buildings.some((b) => /camp|tent|mine/i.test(b.name))).toBe(false);
    expect(v.spotAt("camp", "rook")).toBeNull();
    expect(v.npcSpot("rook", "camp")).toBeNull();
  });

  it("every place, den and exit on it can be walked to from the gate, as it is and once it has grown and built walls", () => {
    // The realm builds on a place as it prospers (N13.3): its map grows with it.
    const { s, realm, map } = fullSite();
    const grown = siteMap({ ...s, population: 400, buildings: { farms: 1, inn: 2, smithy: 2, walls: 2, mine: 1, market: 2, temple: 2, barracks: 2, granary: 1 } }, "village", realm);
    expect(grown.buildings.map((b) => b.name)).toEqual(expect.arrayContaining(["Market hall", "Temple", "Barracks"]));
    for (const m of [map(), grown]) {
      for (const place of m.places) expect(reachable(m, m.start, m.spotAt(place, `walker_${place}`)!), place).toBe(true);
      for (const key of Object.keys(m.dens)) expect(inDen(m, key).some((t) => reachable(m, m.start, t)), key).toBe(true);
      for (const e of m.exits) expect(reachable(m, m.start, { x: e.x, y: e.y }), e.label).toBe(true);
    }
  });
});

describe("N15.2 localities around a place", () => {
  it("a place with a gang and a dungeon has the road, the camp, the mine and the woods, each with its own den and place", () => {
    const { s, realm, map } = fullSite();
    expect([...areasOf(realm, s.id)].sort()).toEqual([...AREAS].sort());
    expect(map("road").places).toEqual(["road"]);
    expect(Object.keys(map("road").dens).sort()).toEqual(["bandit", "road_ambush"]);
    expect(map("camp").places).toEqual(["camp"]);
    expect(Object.keys(map("camp").dens)).toEqual(["camp"]);
    expect(map("camp").npcSpot("rook", "camp")!.location).toMatch(/^the camp of .* outside /);
    expect(map("mine").places).toEqual(["mine"]);
    expect(map("woods").places).toEqual(["woods"]);
    expect(Object.keys(map("woods").dens).sort()).toEqual(["deep_woods", "wolf", "woods_edge"]);
    // Every den key the spawn rules may name is on exactly one of the maps.
    const all = AREAS.flatMap((a) => Object.keys(map(a).dens));
    expect(new Set(all).size).toBe(all.length);
    expect([...all].sort()).toEqual([...DEN_KEYS].sort());
    // Every place's woods have room for its pack, and every camp for its gang.
    expect(map("woods").dens.deep_woods).toBeDefined();
  });

  it("the maps join up both ways: walk off an edge and you come in at the matching edge of the next", () => {
    const { s, map } = fullSite();
    for (const area of AREAS) {
      const m = map(area);
      expect(m.id).toBe(area === "village" ? s.id : `${s.id}:${area}`);
      for (const e of m.exits) {
        // The west gate leads out onto the open road (N26): that is the realm's map, not another area's.
        if (e.to === "realm") {
          expect(e.x).toBe(0);
          continue;
        }
        const next = map(e.to);
        const back = exitTo(next, area);
        expect(back, `${area} → ${e.to}`).toBeDefined();
        expect(next.isSolid(back!.inward.x, back!.inward.y)).toBe(false);
        // You can get from where you come in to every exit, place and den of the map.
        expect(reachable(m, e.inward, { x: e.x, y: e.y })).toBe(true);
        for (const other of m.exits) expect(reachable(m, e.inward, { x: other.x, y: other.y })).toBe(true);
        for (const place of m.places) expect(reachable(m, e.inward, m.spotAt(place, `walker_${place}`)!), `${area}:${place}`).toBe(true);
        for (const key of Object.keys(m.dens)) expect(inDen(m, key).some((t) => reachable(m, e.inward, t)), `${area}:${key}`).toBe(true);
      }
    }
    expect(map("village").exits.map((e) => e.to).sort()).toEqual(["realm", "road", "woods"]);
    expect(map("road").exits.map((e) => e.to).sort()).toEqual(["camp", "mine", "village"]);
  });

  it("every place gets the woods, and a road to a camp or a mine only when there's one", () => {
    const town = makeTown();
    const realm = town.world.realm!;
    for (const s of Object.values(realm.settlements)) {
      const areas = areasOf(realm, s.id);
      expect(areas[0]).toBe("village");
      expect(areas).toContain("woods");
      const gang = Object.values(realm.factions).some((f) => f.kind === "gang" && f.dissolved === undefined && f.seat === s.id);
      const dungeon = Object.values(realm.dungeons).some((d) => d.near === s.id);
      expect(areas.includes("camp")).toBe(gang);
      expect(areas.includes("mine")).toBe(dungeon);
      expect(areas.includes("road")).toBe(gang || dungeon);
      for (const a of areas) {
        const m = siteMap(s, a, realm);
        expect(m.site).toBe(s.id);
        for (const e of m.exits) if (e.to !== "realm") expect(areas).toContain(e.to);
      }
    }
    const d = Object.values(realm.dungeons)[0]!;
    const mine = siteMap(realm.settlements[d.near]!, "mine", realm);
    expect(mine.name.toLowerCase()).toBe(d.name.toLowerCase());
    expect(mine.placeWords("mine").location).toContain(realm.settlements[d.near]!.name);
    // An area a place doesn't have falls back to its village.
    const plain = Object.values(realm.settlements).find((s) => !areasOf(realm, s.id).includes("camp"))!;
    expect(siteMap(plain, "camp", realm).area).toBe("village");
  });

  it("schedule places sit on their own area's map, and the localities can be named and foraged", () => {
    const { map } = fullSite();
    for (const p of PLACES) if (p !== "home") expect(map(areaOfPlace(p)).places, p).toContain(p);
    expect(parsePlace("the woods")).toBe("woods");
    expect(parsePlace("the road out")).toBe("road");
    expect(parsePlace("the camp in the woods")).toBe("camp");
    expect(parsePlace("the mouth of the old workings")).toBe("mine");
    const p = newWorld(allPersonas(), loadCreatureTemplates(), always(0.5)).player;
    p.place = "woods";
    p.attributes.perception = 20;
    const r = forage(p, always(0.99), 1);
    expect(r.ok).toBe(true);
    expect(r.message).toMatch(/herbs|pelt/);
  });
});

describe("N15.3 a place's notables talk", () => {
  it("the head and the others of note join the town as talkers, with their offices and their lore", () => {
    const town = makeTown({ generate: true });
    const realm = town.world.realm!;
    const site = town.site();
    const s = realm.settlements[site]!;
    const head = realm.figures[s.leader!]!;
    const headId = head.talks!;
    expect(headId).toBeDefined();
    // Kept in the registry with the place they belong to, and the realm's figures point at them.
    expect(town.world.talkers![headId]!.site).toBe(site);
    expect(town.personas[headId]!.name).toBe(head.name);
    expect(town.personas[headId]!.role).toMatch(new RegExp(s.name));
    // What is told about their place, they know for certain.
    expect(certaintyOf(town.personas[headId]!, `place.${site}`)).toBe("certain");
    expect(() => parsePersona(JSON.parse(JSON.stringify(town.personas[headId])))).not.toThrow();
    // Everyone of note is a talker now; no one is left to meet.
    expect(notablesOf(realm, site)).toEqual([]);
    // They live the place's day, and keep their offices through it.
    town.world.hour = 10;
    expect(town.placeOf(headId)).toBe("square");
    town.passHours(48);
    expect(realm.figures[head.id]!.role).toBe(head.role);
    // Not made twice.
    expect(town.ids.filter((id) => town.personas[id]!.name === head.name)).toHaveLength(1);
  });

  it("a new head of the place talks too, and the save brings them all back", () => {
    const town = makeTown({ generate: true });
    const realm = town.world.realm!;
    const s = realm.settlements[town.site()]!;
    const oldHead = realm.figures[s.leader!]!;
    town.agents[oldHead.talks!]!.state.outcome = "dead";
    town.agents[oldHead.talks!]!.state.deathCause = "a fever";
    town.consequences();
    const lines = town.passHours(24 * 3);
    const head = s.leader!;
    expect(realm.figures[head]!.name).not.toBe(oldHead.name);
    expect(realm.figures[head]!.talks).toBeDefined();
    expect(lines.join(" ")).toMatch(/is about now/);
    const dir = mkdtempSync(join(tmpdir(), "n15-"));
    saveWorld(join(dir, "world.json"), town.world);
    const again = makeTown({ generate: true, world: loadWorld(join(dir, "world.json"), allPersonas(), loadCreatureTemplates()) });
    expect(again.ids).toContain(realm.figures[head]!.talks);
  });
});

describe("N15.4 everyone remembers by meaning", () => {
  it("a talk with someone of another place is summarised into the database, and recalled after a reload", async () => {
    config.summaries = true;
    const store = new WorldStore();
    const summary = say('{"facts":[{"text":"They asked about the road north and its bandits","importance":4,"feeling":"neutral"}],"tone":"neutral"}');
    const llm = new FakeProvider([say("Welcome, stranger."), say("The road north? Bandits, mostly."), summary]);
    const town = makeTown({ llm, store, generate: true });
    const realm = town.world.realm!;
    const s = lieges(realm, town.site())[0]!;
    town.world.player.site = s.id;
    const [head] = town.meetNotables(s.id);
    const a = town.agents[head!]!;
    await a.respond("Good day.", town.world);
    await a.respond("What's on the road north?", town.world);
    town.summarise(head!);
    await town.background.drain();
    expect(store.memoryCount(head!)).toBe(1);
    // A fresh town on the same save (a restart): the people of other places still recall by meaning.
    const again = makeTown({ store, world: town.world, generate: true });
    const recalled = await again.agents[head!]!.recall!("tell me about the bandits on the north road");
    expect(recalled.join(" ")).toMatch(/road north and its bandits/);
  });

  it("the start town's notables recall by meaning too", async () => {
    const store = new WorldStore();
    const town = makeTown({ store, generate: true });
    const site = town.site();
    const headId = town.world.realm!.figures[town.world.realm!.settlements[site]!.leader!]!.talks!;
    await store.addMemory(headId, 2, "summary", "they offered to find the missing tax money", 4);
    expect((await town.agents[headId]!.recall!("the tax money that went missing")).join(" ")).toMatch(/missing tax money/);
  });
});

describe("N15.6 the beasts and outlaws of a place", () => {
  it("a place's woods hold its pack as the realm has it, its alpha among them, no more than are left", () => {
    const realm = generateRealm(2, 1);
    const p = Object.values(realm.packs).find((x) => x.count >= 3)!;
    p.count = 7;
    const creatures: Record<string, Creature> = {};
    const templates = loadCreatureTemplates();
    stockHaunts(realm, creatures, p.near, templates, 1, always(0.5));
    const beasts = Object.values(creatures);
    expect(beasts).toHaveLength(MAX_ON_MAP);
    for (const c of beasts) {
      expect(c.template).toBe(p.species);
      expect(c.packId).toBe(p.id);
      expect(c.den).toBe(BEAST_DEN);
    }
    // Its woods map has room for them.
    const woods = siteMap(realm.settlements[p.near]!, "woods", realm);
    expect(woods.dens[BEAST_DEN]).toBeDefined();
    // The same beasts next time; hunters thinned the pack off-screen: fewer.
    const uids = beasts.map((c) => c.uid);
    stockHaunts(realm, creatures, p.near, templates, 2, always(0.5));
    expect(Object.keys(creatures)).toEqual(uids);
    p.count = 2;
    stockHaunts(realm, creatures, p.near, templates, 3, always(0.5));
    expect(Object.keys(creatures)).toHaveLength(2);
    // A named alpha leads them.
    const alpha = makeFigure(realm, always(0.5), { role: "beast", home: p.near, tier: "E", age: 5, species: p.species, name: "Greyfang", renown: 30 }, 1);
    p.alpha = alpha.id;
    stockHaunts(realm, creatures, p.near, templates, 4, always(0.5));
    expect(Object.values(creatures).filter((c) => c.name === "Greyfang" && c.figure === alpha.id)).toHaveLength(1);
  });

  it("whatever else is on a place's map (a rule's creatures, the crowd) isn't a haunt, and stocking leaves it alone", () => {
    const realm = generateRealm(2, 1);
    const p = Object.values(realm.packs).find((x) => x.count >= 3)!;
    const templates = loadCreatureTemplates();
    const creatures: Record<string, Creature> = {};
    creatures["horse-1"] = { ...(templates.horse ? { uid: "horse-1", template: "horse", name: "horse 1" } : {}) } as Creature;
    stockHaunts(realm, creatures, p.near, templates, 1, always(0.5));
    expect(creatures["horse-1"]).toBeDefined();
    expect(settleHaunts(realm, creatures, p.near, newWorld({}).player, 2)).toEqual([]);
    expect(creatures["horse-1"]).toBeDefined();
  });

  it("killing them goes back to the realm: a pack one fewer and a share of its bounty; a named one is a realm death", () => {
    const town = makeTown();
    const realm = town.world.realm!;
    const player = town.world.player;
    const p = Object.values(realm.packs)[0]!;
    p.count = 3;
    p.bounty = 300;
    const alpha = makeFigure(realm, always(0.5), { role: "beast", home: p.near, tier: "E", age: 5, species: p.species, name: "Greyfang", renown: 30 }, 1);
    p.alpha = alpha.id;
    const creatures: Record<string, Creature> = {};
    stockHaunts(realm, creatures, p.near, loadCreatureTemplates(), 1, always(0.5));
    const [lead, second, third] = Object.values(creatures).sort((a, b) => (b.figure ? 1 : 0) - (a.figure ? 1 : 0));
    const money = player.money;
    lead!.outcome = "dead";
    second!.outcome = "fled";
    const lines = settleHaunts(realm, creatures, p.near, player, 5);
    expect(p.count).toBe(2);
    expect(player.money - money).toBe(100); // a third of the bounty: one of three
    expect(p.bounty).toBe(200);
    expect(alpha.alive).toBe(false);
    expect(alpha.deathCause).toBe(`killed by ${player.name}`);
    expect(p.alpha).toBeNull();
    expect(realm.news.at(-1)!.text).toMatch(/Greyfang.*was killed by Traveler/);
    expect(lines.join(" ")).toMatch(/bounty.*Word will spread that Greyfang is dead/);
    // The one that ran is gone for now; the living one is still there.
    expect(Object.values(creatures).map((c) => c.uid)).toEqual([third!.uid]);
  });

  it("a gang's camp holds its members by name; killing one is a realm death, and the gang is one fewer", () => {
    const town = makeTown();
    const realm = town.world.realm!;
    const site = Object.values(realm.settlements).find((s) => !gangOf(realm, s.id) && !Object.values(realm.dungeons).some((d) => d.near === s.id))!;
    expect(areasOf(realm, site.id)).not.toContain("camp");
    const fac = gangAt(realm, site.id);
    expect(areasOf(realm, site.id)).toEqual(["village", "road", "camp", "woods"]);
    const creatures: Record<string, Creature> = {};
    stockHaunts(realm, creatures, site.id, loadCreatureTemplates(), 1, always(0.5));
    const men = Object.values(creatures).filter((c) => c.den === GANG_DEN);
    expect(men.map((c) => c.name).sort()).toEqual(["Black Tam", "Nell Briar", "Wat Crow"]);
    for (const c of men) expect(c.template).toBe("bandit");
    expect(siteMap(site, "camp", realm).name).toBe(`The camp of ${fac.name}`);
    const tam = men.find((c) => c.name === "Black Tam")!;
    tam.outcome = "dead";
    settleHaunts(realm, creatures, site.id, town.world.player, 2);
    expect(realm.figures[tam.figure!]!.alive).toBe(false);
    expect(fac.members).toHaveLength(2);
    expect(fac.leader).toBeNull();
    stockHaunts(realm, creatures, site.id, loadCreatureTemplates(), 2, always(0.5));
    expect(Object.values(creatures).map((c) => c.name).sort()).toEqual(["Nell Briar", "Wat Crow"]);
  });

  it("the town stocks them when the player arrives, they're the creatures there, and the save keeps them", () => {
    const town = makeTown();
    const realm = town.world.realm!;
    const p = Object.values(realm.packs).find((x) => x.near !== town.site() && x.count > 0)!;
    town.arriveAt(p.near);
    const here = town.creaturesHere();
    expect(Object.values(here).filter((c) => c.packId === p.id)).toHaveLength(Math.min(p.count, MAX_ON_MAP));
    const dir = mkdtempSync(join(tmpdir(), "n15-"));
    saveWorld(join(dir, "world.json"), town.world);
    const back = loadWorld(join(dir, "world.json"), allPersonas(), loadCreatureTemplates());
    expect(Object.keys(creaturesOf(back))).toEqual(Object.keys(here));
    // Home again: the start town's own creatures, not these.
    const home = town.world.startSite;
    town.arriveAt(home);
    expect(town.creaturesHere()).not.toBe(here);
    expect(Object.values(town.creaturesHere()).some((c) => c.packId === p.id)).toBe(false);
  });

  it("a dungeon is delved from its mouth, wherever it is", () => {
    const town = makeTown();
    const realm = town.world.realm!;
    const player = town.world.player;
    player.money = GUILD_FEE;
    joinGuild(realm, player);
    const d = Object.values(realm.dungeons).find((x) => x.near !== town.site())!;
    d.danger = 5;
    town.arriveAt(d.near);
    expect(playerDelve(realm, player, "", 1, always(0.01)).lines.join(" ")).toMatch(/opens at the end of the road out of .* Walk there first/);
    player.area = "mine";
    expect(playerDelve(realm, player, "", 1, always(0.01)).ok).toBe(true);
  });
});

describe("N15.5 saves", () => {
  it("a save keeps where the player stood and which area they were in, and the creatures' tiles", () => {
    const personas = allPersonas();
    const templates = loadCreatureTemplates();
    const world = newWorld(personas, templates, always(0.5));
    world.position = { x: 12, y: 16 };
    world.player.area = "road";
    creaturesOf(world)["wolf-1"] = spawnCreature(templates.wolf!, "wolf-1", 1, always(0.5), "wolf 1");
    for (const c of Object.values(creaturesOf(world))) c.pos = { x: 1, y: 1 };
    const dir = mkdtempSync(join(tmpdir(), "n15-"));
    const file = join(dir, "world.json");
    saveWorld(file, world);
    const kept = loadWorld(file, personas, templates);
    expect(kept.version).toBe(SAVE_VERSION);
    expect(kept.position).toEqual({ x: 12, y: 16 });
    expect(kept.player.area).toBe("road");
    expect(Object.values(creaturesOf(kept)).length).toBeGreaterThan(0);
    expect(Object.values(creaturesOf(kept)).every((c) => c.pos?.x === 1 && c.pos.y === 1)).toBe(true);
  });
});
