/**
 * N15: localities. Millbrook's village is generated like every other place's, and
 * what isn't the village (the mine road, the bandit camp, the old mine, the woods)
 * is on maps of its own around it. Millbrook's notables from the realm talk, and
 * everyone who talks remembers by meaning (SQLite + embeddings).
 */
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findPath } from "@millbrook/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { config } from "../src/config.js";
import { WorldStore } from "../src/game/db.js";
import { forage } from "../src/game/gathering.js";
import { HOME_ID, lieges } from "../src/game/realm/generate.js";
import { notablesOf } from "../src/game/realm/visitors.js";
import { BEAST_DEN, GANG_DEN, gangOf, MAX_ON_MAP, settleHaunts, stockHaunts, type Haunts } from "../src/game/realm/haunts.js";
import { foundFaction } from "../src/game/realm/factions.js";
import { makeFigure } from "../src/game/realm/figures.js";
import { GUILD_FEE, joinGuild, playerDelve } from "../src/game/realm/wilds.js";
import type { Realm } from "../src/game/realm/types.js";
import { loadWorld, newWorld, SAVE_VERSION, saveWorld } from "../src/game/save.js";
import { AREAS, type AreaId, areaOfPlace, parsePlace, PLACES } from "../src/game/schedule.js";
import { certaintyOf } from "../src/npc/knowledge.js";
import { parsePersona } from "../src/npc/personaSchema.js";
import { loadCreatureTemplates } from "../src/game/creatures.js";
import { areasOf, DEN_KEYS, exitTo, MILLBROOK, MILLBROOK_INFO, siteMap, type SiteMap } from "../src/web/sites.js";
import { allPersonas, always, FakeProvider, makeTown, say } from "./helpers.js";

beforeEach(() => {
  config.director = false;
  config.planning = false;
  config.summaries = false;
  config.realm = true;
});

const millbrook = (area: AreaId = "village") => siteMap(MILLBROOK_INFO, area);
const open = (m: SiteMap) => (x: number, y: number) => m.isSolid(x, y);
const reachable = (m: SiteMap, from: { x: number; y: number }, to: { x: number; y: number }) => findPath(from, (t) => t.x === to.x && t.y === to.y, open(m)) !== null;
const inDen = (m: SiteMap, key: string) => {
  const d = m.dens[key]!;
  const free: Array<{ x: number; y: number }> = [];
  for (let y = d.y0; y <= d.y1; y++) for (let x = d.x0; x <= d.x1; x++) if (!m.isSolid(x, y)) free.push({ x, y });
  return free;
};

describe("N15.1 Millbrook's village is generated", () => {
  it("is made by the same generator as every other place, keeping its own names", () => {
    expect(MILLBROOK.id).toBe(HOME_ID);
    expect(MILLBROOK.area).toBe("village");
    const names = MILLBROOK.buildings.map((b) => b.name);
    expect(names).toEqual(expect.arrayContaining(["Village hall", "Gilded Goose", "Forge"]));
    // The same every time (seeded by the place's id).
    expect(siteMap({ ...MILLBROOK_INFO }).tiles).toEqual(MILLBROOK.tiles);
    // Its places keep Millbrook's words, so the cast's prompts read as they did.
    expect(MILLBROOK.placeWords("forge").location).toBe("Millbrook forge");
    expect(MILLBROOK.placeWords("inn").location).toBe("the Gilded Goose");
    expect(MILLBROOK.npcSpot("brena", "forge")!.nearby).toContain("a stray dog");
  });

  it("holds only the village: no camp, den, mine or mine road on it", () => {
    expect(MILLBROOK.places.sort()).toEqual(["forge", "gate", "inn", "square"]);
    expect(Object.keys(MILLBROOK.dens).sort()).toEqual(["horse", "village_square", "villager", "west_road"]);
    expect(MILLBROOK.buildings.some((b) => /camp|tent|mine/i.test(b.name))).toBe(false);
    expect(MILLBROOK.spotAt("camp", "rook")).toBeNull();
    expect(MILLBROOK.npcSpot("rook", "camp")).toBeNull();
  });

  it("every place, den and exit on it can be walked to from the gate, as it is and once it has grown and built walls", () => {
    // The realm builds on Millbrook as it prospers (N13.3): its map grows with it.
    const grown = siteMap({ ...MILLBROOK_INFO, population: 400, buildings: { farms: 1, inn: 2, smithy: 2, walls: 2, mine: 1, market: 2, temple: 2, barracks: 2, granary: 1 } });
    expect(grown.buildings.map((b) => b.name)).toEqual(expect.arrayContaining(["Market hall", "Temple", "Barracks"]));
    for (const m of [MILLBROOK, grown]) {
      for (const place of m.places) expect(reachable(m, m.start, m.spotAt(place, `walker_${place}`)!), place).toBe(true);
      for (const key of Object.keys(m.dens)) expect(inDen(m, key).some((t) => reachable(m, m.start, t)), key).toBe(true);
      for (const e of m.exits) expect(reachable(m, m.start, { x: e.x, y: e.y }), e.label).toBe(true);
    }
  });
});

describe("N15.2 localities around a place", () => {
  it("Millbrook has the mine road, the bandit camp, the old mine and the woods, each with its own den and place", () => {
    expect(areasOf(null, HOME_ID)).toEqual([...AREAS]);
    expect(millbrook("road").places).toEqual(["road"]);
    expect(Object.keys(millbrook("road").dens).sort()).toEqual(["bandit", "road_ambush"]);
    expect(millbrook("camp").places).toEqual(["camp"]);
    expect(Object.keys(millbrook("camp").dens)).toEqual(["bandit_camp"]);
    expect(millbrook("camp").npcSpot("rook", "camp")!.location).toBe("the bandit camp at the north end of the mine road");
    expect(millbrook("mine").places).toEqual(["mine"]);
    expect(millbrook("woods").places).toEqual(["woods"]);
    expect(Object.keys(millbrook("woods").dens).sort()).toEqual(["deep_woods", "forest_edge", "wolf"]);
    // Every den key the spawn rules may name is on exactly one of Millbrook's maps.
    const all = AREAS.flatMap((a) => Object.keys(millbrook(a).dens));
    expect(new Set(all).size).toBe(all.length);
    expect([...all].sort()).toEqual([...DEN_KEYS].sort());
    // Every place's woods have room for its pack, and every camp for its gang.
    expect(millbrook("woods").dens.deep_woods).toBeDefined();
  });

  it("the maps join up both ways: walk off an edge and you come in at the matching edge of the next", () => {
    for (const area of AREAS) {
      const m = millbrook(area);
      expect(m.id).toBe(area === "village" ? HOME_ID : `${HOME_ID}:${area}`);
      for (const e of m.exits) {
        const next = millbrook(e.to);
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
    expect(millbrook("village").exits.map((e) => e.to).sort()).toEqual(["road", "woods"]);
    expect(millbrook("road").exits.map((e) => e.to).sort()).toEqual(["camp", "mine", "village"]);
  });

  it("other places get the woods, and a road to a camp or a mine only when there's one", () => {
    const town = makeTown();
    const realm = town.world.realm!;
    for (const s of Object.values(realm.settlements)) {
      const areas = areasOf(realm, s.id);
      expect(areas[0]).toBe("village");
      expect(areas).toContain("woods");
      const gang = Object.values(realm.factions).some((f) => f.kind === "gang" && f.dissolved === undefined && f.seat === s.id);
      const dungeon = Object.values(realm.dungeons).some((d) => d.near === s.id);
      if (s.id !== HOME_ID) {
        expect(areas.includes("camp")).toBe(gang);
        expect(areas.includes("mine")).toBe(dungeon);
        expect(areas.includes("road")).toBe(gang || dungeon);
      }
      for (const a of areas) {
        const m = siteMap(s, a, realm);
        expect(m.site).toBe(s.id);
        for (const e of m.exits) expect(areas).toContain(e.to);
      }
    }
    const d = Object.values(realm.dungeons).find((x) => x.near !== HOME_ID)!;
    const mine = siteMap(realm.settlements[d.near]!, "mine", realm);
    expect(mine.name.toLowerCase()).toBe(d.name.toLowerCase());
    expect(mine.placeWords("mine").location).toContain(realm.settlements[d.near]!.name);
    // An area a place doesn't have falls back to its village.
    const plain = Object.values(realm.settlements).find((s) => !areasOf(realm, s.id).includes("camp"))!;
    expect(siteMap(plain, "camp", realm).area).toBe("village");
  });

  it("schedule places sit on their own area's map, and the localities can be named and foraged", () => {
    for (const p of PLACES) if (p !== "home") expect(millbrook(areaOfPlace(p)).places, p).toContain(p);
    expect(parsePlace("the woods")).toBe("woods");
    expect(parsePlace("mine road")).toBe("road");
    expect(parsePlace("bandit camp")).toBe("camp");
    expect(parsePlace("the old mine")).toBe("mine");
    const p = newWorld(allPersonas(), loadCreatureTemplates(), always(0.5)).player;
    p.place = "woods";
    p.attributes.perception = 20;
    const r = forage(p, always(0.99), 1);
    expect(r.ok).toBe(true);
    expect(r.message).toMatch(/herbs|pelt/);
  });
});

describe("N15.3 Millbrook's notables talk", () => {
  it("the mayor and the guard captain join the cast, with their offices and their lore", () => {
    const town = makeTown();
    const realm = town.world.realm!;
    const byName = (n: string) => town.ids.find((id) => town.personas[id]!.name === n);
    const voss = byName("Aldric Voss");
    const holt = byName("Reyna Holt");
    expect(voss).toBeDefined();
    expect(holt).toBeDefined();
    // Kept in the save with the risen, and the realm's figures point at them.
    expect(town.world.risen?.[voss!]).toBeDefined();
    const fig = (id: string) => Object.values(realm.figures).find((f) => f.talks === id)!;
    expect(fig(voss!).role).toBe("mayor");
    expect(fig(holt!).role).toBe("captain");
    expect(town.personas[voss!]!.role).toBe("the mayor of Millbrook");
    // What the village says about them, they know for certain.
    expect(certaintyOf(town.personas[voss!]!, "people.mayor.vault")).toBe("certain");
    expect(certaintyOf(town.personas[holt!]!, "people.guard_captain.tax")).toBe("certain");
    expect(certaintyOf(town.personas[holt!]!, "millbrook")).toBe("certain");
    expect(() => parsePersona(JSON.parse(JSON.stringify(town.personas[holt!])))).not.toThrow();
    // No one is left to meet: the crowd walks the map as villagers, not as talkers.
    expect(notablesOf(realm, HOME_ID)).toEqual([]);
    // They live the village's day, and keep their offices through it.
    town.world.hour = 10;
    expect(town.placeOf(voss!)).toBe("square");
    expect(MILLBROOK.places).toContain(town.placeOf(holt!));
    town.passHours(48);
    expect(fig(voss!).role).toBe("mayor");
    expect(fig(holt!).role).toBe("captain");
    // Not made twice.
    expect(town.ids.filter((id) => town.personas[id]!.name === "Aldric Voss")).toHaveLength(1);
  });

  it("a new head of Millbrook talks too, and the save brings them all back", () => {
    const town = makeTown();
    const realm = town.world.realm!;
    const voss = town.ids.find((id) => town.personas[id]!.name === "Aldric Voss")!;
    town.agents[voss]!.state.outcome = "dead";
    town.agents[voss]!.state.deathCause = "a fever";
    town.consequences();
    const lines = town.passHours(24 * 3);
    const head = realm.settlements[HOME_ID]!.leader!;
    expect(realm.figures[head]!.name).not.toBe("Aldric Voss");
    expect(realm.figures[head]!.talks).toBeDefined();
    expect(lines.join(" ")).toMatch(/is about the village now/);
    const dir = mkdtempSync(join(tmpdir(), "n15-"));
    saveWorld(join(dir, "world.json"), town.world);
    const again = makeTown({ world: loadWorld(join(dir, "world.json"), allPersonas(), loadCreatureTemplates()) });
    expect(again.ids).toContain(realm.figures[head]!.talks);
    expect(again.ids).toContain(town.ids.find((id) => town.personas[id]!.name === "Reyna Holt"));
  });
});

describe("N15.4 everyone remembers by meaning", () => {
  it("a talk with someone of another place is summarised into the database, and recalled after a reload", async () => {
    config.summaries = true;
    const store = new WorldStore();
    const summary = say('{"facts":[{"text":"They asked about the road north and its bandits","importance":4,"feeling":"neutral"}],"tone":"neutral"}');
    const llm = new FakeProvider([say("Welcome, stranger."), say("The road north? Bandits, mostly."), summary]);
    const town = makeTown({ llm, store });
    const realm = town.world.realm!;
    const s = lieges(realm, HOME_ID)[0]!;
    town.world.player.site = s.id;
    const [head] = town.meetPeopleOf(s.id);
    const a = town.agents[head!]!;
    await a.respond("Good day.", town.world);
    await a.respond("What's on the road north?", town.world);
    town.summarise(head!);
    await town.background.drain();
    expect(store.memoryCount(head!)).toBe(1);
    // A fresh town on the same save (a restart): the people of other places still recall by meaning.
    const again = makeTown({ store, world: town.world });
    const recalled = await again.agents[head!]!.recall!("tell me about the bandits on the north road");
    expect(recalled.join(" ")).toMatch(/road north and its bandits/);
  });

  it("Millbrook's notables recall by meaning too", async () => {
    const store = new WorldStore();
    const town = makeTown({ store });
    const holt = town.ids.find((id) => town.personas[id]!.name === "Reyna Holt")!;
    await store.addMemory(holt, 2, "summary", "they offered to find the missing tax money", 4);
    expect((await town.agents[holt]!.recall!("the tax money that went missing")).join(" ")).toMatch(/missing tax money/);
  });
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

describe("N15.6 the beasts and outlaws of other places", () => {
  it("a place's woods hold its pack as the realm has it, its alpha among them, no more than are left", () => {
    const town = makeTown();
    const realm = town.world.realm!;
    const p = Object.values(realm.packs).find((x) => x.near !== HOME_ID && x.count >= 3)!;
    p.count = 7;
    const haunts: Haunts = {};
    const templates = loadCreatureTemplates();
    stockHaunts(realm, haunts, p.near, templates, 1, always(0.5));
    const beasts = Object.values(haunts[p.near]!);
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
    stockHaunts(realm, haunts, p.near, templates, 2, always(0.5));
    expect(Object.keys(haunts[p.near]!)).toEqual(uids);
    p.count = 2;
    stockHaunts(realm, haunts, p.near, templates, 3, always(0.5));
    expect(Object.keys(haunts[p.near]!)).toHaveLength(2);
    // A named alpha leads them.
    const alpha = makeFigure(realm, always(0.5), { role: "beast", home: p.near, tier: "E", age: 5, species: p.species, name: "Greyfang", renown: 30 }, 1);
    p.alpha = alpha.id;
    stockHaunts(realm, haunts, p.near, templates, 4, always(0.5));
    expect(Object.values(haunts[p.near]!).filter((c) => c.name === "Greyfang" && c.figure === alpha.id)).toHaveLength(1);
    // Millbrook's own creatures are never haunts.
    expect(stockHaunts(realm, haunts, HOME_ID, templates, 4, always(0.5))).toEqual([]);
  });

  it("killing them goes back to the realm: a pack one fewer and a share of its bounty; a named one is a realm death", () => {
    const town = makeTown();
    const realm = town.world.realm!;
    const player = town.world.player;
    const p = Object.values(realm.packs).find((x) => x.near !== HOME_ID)!;
    p.count = 3;
    p.bounty = 300;
    const alpha = makeFigure(realm, always(0.5), { role: "beast", home: p.near, tier: "E", age: 5, species: p.species, name: "Greyfang", renown: 30 }, 1);
    p.alpha = alpha.id;
    const haunts: Haunts = {};
    stockHaunts(realm, haunts, p.near, loadCreatureTemplates(), 1, always(0.5));
    const [lead, second, third] = Object.values(haunts[p.near]!).sort((a, b) => (b.figure ? 1 : 0) - (a.figure ? 1 : 0));
    const money = player.money;
    lead!.outcome = "dead";
    second!.outcome = "fled";
    const lines = settleHaunts(realm, haunts, p.near, player, 5);
    expect(p.count).toBe(2);
    expect(player.money - money).toBe(100); // a third of the bounty: one of three
    expect(p.bounty).toBe(200);
    expect(alpha.alive).toBe(false);
    expect(alpha.deathCause).toBe(`killed by ${player.name}`);
    expect(p.alpha).toBeNull();
    expect(realm.news.at(-1)!.text).toMatch(/Greyfang.*was killed by Traveler/);
    expect(lines.join(" ")).toMatch(/bounty.*Word will spread that Greyfang is dead/);
    // The one that ran is gone for now; the living one is still there.
    expect(Object.values(haunts[p.near]!).map((c) => c.uid)).toEqual([third!.uid]);
  });

  it("a gang's camp holds its members by name; killing one is a realm death, and the gang is one fewer", () => {
    const town = makeTown();
    const realm = town.world.realm!;
    const site = Object.values(realm.settlements).find((s) => s.id !== HOME_ID && !gangOf(realm, s.id) && !Object.values(realm.dungeons).some((d) => d.near === s.id))!;
    expect(areasOf(realm, site.id)).not.toContain("camp");
    const fac = gangAt(realm, site.id);
    expect(areasOf(realm, site.id)).toEqual(["village", "road", "camp", "woods"]);
    const haunts: Haunts = {};
    stockHaunts(realm, haunts, site.id, loadCreatureTemplates(), 1, always(0.5));
    const men = Object.values(haunts[site.id]!).filter((c) => c.den === GANG_DEN);
    expect(men.map((c) => c.name).sort()).toEqual(["Black Tam", "Nell Briar", "Wat Crow"]);
    for (const c of men) expect(c.template).toBe("bandit");
    expect(siteMap(site, "camp", realm).name).toBe(`The camp of ${fac.name}`);
    const tam = men.find((c) => c.name === "Black Tam")!;
    tam.outcome = "dead";
    settleHaunts(realm, haunts, site.id, town.world.player, 2);
    expect(realm.figures[tam.figure!]!.alive).toBe(false);
    expect(fac.members).toHaveLength(2);
    expect(fac.leader).toBeNull();
    stockHaunts(realm, haunts, site.id, loadCreatureTemplates(), 2, always(0.5));
    expect(Object.values(haunts[site.id]!).map((c) => c.name).sort()).toEqual(["Nell Briar", "Wat Crow"]);
  });

  it("the town stocks them when the player arrives, they're the creatures there, and the save keeps them", () => {
    const town = makeTown();
    const realm = town.world.realm!;
    const p = Object.values(realm.packs).find((x) => x.near !== HOME_ID && x.count > 0)!;
    town.world.player.site = p.near;
    town.arriveAt(p.near);
    const here = town.creaturesHere();
    expect(Object.values(here).filter((c) => c.packId === p.id)).toHaveLength(Math.min(p.count, MAX_ON_MAP));
    // Millbrook's own aren't there.
    expect(Object.keys(here).some((uid) => town.world.creatures[uid])).toBe(false);
    const dir = mkdtempSync(join(tmpdir(), "n15-"));
    saveWorld(join(dir, "world.json"), town.world);
    const back = loadWorld(join(dir, "world.json"), allPersonas(), loadCreatureTemplates());
    expect(Object.keys(back.haunts![p.near]!)).toEqual(Object.keys(here));
    // Home again: Millbrook's own.
    town.arriveAt(HOME_ID);
    expect(town.creaturesHere()).toBe(town.world.creatures);
  });

  it("a dungeon is delved from its mouth, wherever it is", () => {
    const town = makeTown();
    const realm = town.world.realm!;
    const player = town.world.player;
    player.money = GUILD_FEE;
    joinGuild(realm, player);
    const d = Object.values(realm.dungeons).find((x) => x.near !== HOME_ID)!;
    d.danger = 5;
    town.arriveAt(d.near);
    expect(playerDelve(realm, player, "", 1, always(0.01)).lines.join(" ")).toMatch(/opens at the end of the road out of .* Walk there first/);
    player.area = "mine";
    expect(playerDelve(realm, player, "", 1, always(0.01)).ok).toBe(true);
  });
});

describe("N15.5 saves (v10)", () => {
  it("an older save at home starts back at the gate of the generated village, and its creatures find their dens again", () => {
    const personas = allPersonas();
    const templates = loadCreatureTemplates();
    const world = newWorld(personas, templates, always(0.5));
    world.position = { x: 16, y: 2 };
    world.player.place = "camp";
    for (const c of Object.values(world.creatures)) c.pos = { x: 1, y: 1 };
    const dir = mkdtempSync(join(tmpdir(), "n15-"));
    const file = join(dir, "world.json");
    saveWorld(file, world);
    const raw = JSON.parse(readFileSync(file, "utf8")) as { version: number };
    raw.version = 9;
    writeFileSync(file, JSON.stringify(raw));
    const back = loadWorld(file, personas, templates);
    expect(back.version).toBe(SAVE_VERSION);
    expect(back.position).toBeUndefined();
    expect(back.player.place).toBe("gate");
    expect(Object.values(back.creatures).every((c) => c.pos === undefined)).toBe(true);
    expect(Object.keys(back.creatures).length).toBeGreaterThan(0);
    // A v10 save keeps where you stood, and which area you were in.
    back.position = { x: 12, y: 16 };
    back.player.area = "road";
    saveWorld(file, back);
    const kept = loadWorld(file, personas, templates);
    expect(kept.position).toEqual({ x: 12, y: 16 });
    expect(kept.player.area).toBe("road");
  });
});
