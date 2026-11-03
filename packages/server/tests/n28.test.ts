/**
 * N28: fauna and flora. Animals and plants are data files; where they are is a pure function of the seed, the land, the
 * season and the hour; they run from the player, fall quiet near a predator, can be hunted, tracked, fished and tamed;
 * plants flower and fruit by the calendar, can be gathered (and mistaken for their lookalikes) and cure or sicken; the
 * player keeps a bestiary; herbalists and fishers live off the land and sell what they bring home.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { CHUNK, activeAt, animalsInChunk, plantsInChunk, stageOf, tileOf, type NatureCtx } from "@millbrook/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { config } from "../src/config.js";
import { loadCreatureTemplates } from "../src/game/creatures.js";
import { WorldStore } from "../src/game/db.js";
import { itemKey } from "../src/game/items.js";
import { checkSpecies, lightAnimals, loadSpecies, plantSpecs } from "../src/game/nature/species.js";
import { checkNatureBounds, entryOf, fish, fleeFrom, gatherPlant, herbalistHaul, huntAnimal, isForbidden, natureOf, natureView, noteSpecies, plantsNear, showToHerbalist, signOf, tameStray, track, useWildItem, strayAt, animalsNear } from "../src/game/nature/wild.js";
import { syncBeasts } from "../src/game/realm/beasts.js";
import { roadDataOf } from "../src/game/road/generateRoads.js";
import { groundAt, landOf } from "../src/game/road/ground.js";
import { newWorld } from "../src/game/save.js";
import { Town } from "../src/game/town.js";
import { Ground } from "@millbrook/shared";
import { materialisePeople } from "../src/store/materialise.js";
import { siteMap } from "../src/web/sites.js";
import { FakeProvider, always } from "./helpers.js";

vi.setConfig({ testTimeout: 180_000 });
beforeEach(() => {
  config.director = false;
  config.planning = false;
  config.realm = true;
});

const templates = loadCreatureTemplates();
const book = loadSpecies();

function town(seed = 1): Town {
  const store = new WorldStore(":memory:");
  const world = newWorld({}, templates, always(0.5), seed);
  materialisePeople(world.realm!, store.people, world.day);
  syncBeasts(world.realm!, store.beasts, world.day);
  return new Town({ personas: {}, creatureTemplates: templates, world, llm: new FakeProvider(), store });
}

function standAt(t: Town, x: number, y: number, hour = 12, day = t.world.day) {
  t.world.day = day;
  t.world.hour = hour;
  t.world.minute = 0;
  t.world.player.road = { x, y, steps: 0, from: t.world.player.site!, paid: {}, met: {}, seen: {} };
}

const ctx = (terrain: string, season: string, frac: number, water = false): NatureCtx => ({ terrain, season, frac, water: () => water });

describe("N28 step 1: species are data", () => {
  it("every species file loads and points at real items, creatures, illnesses and plants", () => {
    expect(Object.keys(book.animals).length).toBeGreaterThanOrEqual(40);
    expect(Object.keys(book.plants).length).toBeGreaterThanOrEqual(40);
    expect(checkSpecies(book, Object.keys(templates))).toEqual([]);
  });

  it("a broken file fails with a clear message", () => {
    const dir = join(tmpdir(), `species-${process.pid}-${Date.now()}`);
    mkdirSync(join(dir, "animals"), { recursive: true });
    mkdirSync(join(dir, "plants"), { recursive: true });
    writeFileSync(join(dir, "animals", "bad.json"), JSON.stringify({ id: "bad", kind: "animal", name: "bad" }));
    expect(() => loadSpecies(pathToFileURL(`${dir}/`))).toThrow(/species animals\/bad\.json/);
    const wrong = structuredClone(book);
    wrong.plants.willow!.products[0]!.item = "unobtainium";
    expect(checkSpecies(wrong, Object.keys(templates)).join(" ")).toContain("unobtainium");
  });
});

describe("N28 step 2: where the animals are", () => {
  const specs = lightAnimals(book);
  const count = (terrain: string, season: string, minute: number, water = false) => {
    const seen = new Map<string, number>();
    for (let cy = 0; cy < 30; cy++) for (let cx = 0; cx < 30; cx++) for (const g of animalsInChunk(7, specs, cx, cy, 5, minute, ctx(terrain, season, 0.1, water))) seen.set(g.species, (seen.get(g.species) ?? 0) + 1);
    return seen;
  };

  it("the same chunk at the same minute gives the same animals", () => {
    expect(animalsInChunk(7, specs, 3, 4, 9, 400, ctx("forest", "summer", 0.3))).toEqual(animalsInChunk(7, specs, 3, 4, 9, 400, ctx("forest", "summer", 0.3)));
  });

  it("deer in the forest, herons in the marsh water, gulls on the coast; no owls at noon", () => {
    const forest = count("forest", "summer", 7 * 60);
    expect((forest.get("red_deer") ?? 0) + (forest.get("roe_deer") ?? 0)).toBeGreaterThan(0);
    expect(count("marsh", "summer", 12 * 60, true).get("heron") ?? 0).toBeGreaterThan(0);
    expect(count("coast", "summer", 12 * 60).get("gull") ?? 0).toBeGreaterThan(0);
    expect(count("forest", "summer", 12 * 60).get("owl") ?? 0).toBe(0);
    expect(count("forest", "summer", 23 * 60).get("owl") ?? 0).toBeGreaterThan(0);
  });

  it("birds sing at dawn; frogs in spring, not in winter", () => {
    expect(activeAt("dawn", 6 * 60)).toBeGreaterThan(activeAt("dawn", 13 * 60));
    const songbirds = (m: Map<string, number>) => ["wren", "robin", "nightingale", "lark"].reduce((a, k) => a + (m.get(k) ?? 0), 0);
    expect(songbirds(count("forest", "spring", 6 * 60))).toBeGreaterThan(songbirds(count("forest", "spring", 13 * 60)));
    expect(count("marsh", "spring", 7 * 60, true).get("frog") ?? 0).toBeGreaterThan(count("marsh", "winter", 7 * 60, true).get("frog") ?? 0);
  });

  it("deer run from the player when they come close", () => {
    const g = { id: "n:0:0:0:1:1", species: "red_deer", n: 3, x: 105, y: 100, home: { x: 100, y: 100 } };
    const fled = fleeFrom(g, book.animals.red_deer!, { x: 100, y: 100 });
    expect(Math.hypot(fled.x - 100, fled.y - 100)).toBeGreaterThan(book.animals.red_deer!.flees);
    expect(fleeFrom({ ...g, x: 140 }, book.animals.red_deer!, { x: 100, y: 100 }).x).toBe(140);
  });
});

describe("N28 step 4: plants and the calendar", () => {
  it("a spring walk and an autumn walk through the same woods find different things in flower", () => {
    const specs = plantSpecs(book);
    const flowering = (frac: number, season: string) => {
      const out = new Set<string>();
      for (let cy = 0; cy < 12; cy++) for (let cx = 0; cx < 12; cx++) for (const p of plantsInChunk(3, specs, cx, cy, ctx("forest", season, frac))) if (p.stage === "flower") out.add(p.species);
      return out;
    };
    const spring = flowering(0.15, "spring");
    const autumn = flowering(0.6, "autumn");
    expect(spring.size).toBeGreaterThan(0);
    expect([...spring].sort()).not.toEqual([...autumn].sort());
    expect(stageOf(book.plants.bramble!.calendar, 0.55)).toBe("fruit");
    expect(stageOf(book.plants.bramble!.calendar, 0.9)).toBe("dormant");
  });
});

describe("N28 step 5: gathering, lookalikes and what herbs do", () => {
  it("willow bark brewed cures a fever", () => {
    const t = town(1);
    const p = t.world.player;
    p.illness = { id: "fever", day: 1, daysLeft: 4 };
    p.inventory[itemKey("willow bark")] = 1;
    expect(useWildItem(t, "willow bark", "brewed").join(" ")).toContain("sickness lift");
    expect(p.illness).toBeNull();
  });

  it("a mushroom gathered by someone who can't tell it from a death cap sickens them; a herbalist would have known; the patch regrows", () => {
    const t = town(1);
    const realm = t.world.realm!;
    const home = realm.settlements[t.world.player.site!]!;
    // An autumn day when field mushrooms are up, and a patch of them near the start.
    const day = 31;
    const cx0 = Math.floor(tileOf(home.pos.x) / CHUNK);
    const cy0 = Math.floor(tileOf(home.pos.y) / CHUNK);
    let patch: { id: string; x: number; y: number } | null = null;
    outer: for (let r = 1; r < 40; r++) for (let cy = cy0 - r; cy <= cy0 + r; cy++) for (let cx = cx0 - r; cx <= cx0 + r; cx++) {
      standAt(t, cx * CHUNK + 32, cy * CHUNK + 32, 12, day);
      const hit = plantsNear(t, 45).find((x) => x.species === "field_mushroom" && x.ready);
      if (hit) {
        patch = hit;
        break outer;
      }
    }
    expect(patch).toBeTruthy();
    const p = t.world.player;
    p.attributes.perception = 1;
    standAt(t, patch!.x, patch!.y + 1, 12, day);
    const got = gatherPlant(t, patch!.id).join(" ");
    expect(got).toContain("field mushroom");
    // They think it's field mushroom; it is a death cap.
    expect(natureOf(p).mislabelled["field mushroom"]?.["death cap"]).toBeGreaterThan(0);
    expect(JSON.stringify(natureView(p, null, null))).not.toContain("death cap");
    expect(useWildItem(t, "field mushroom", "eaten").join(" ")).toContain("no good thing");
    expect(p.illness?.id).toBe("poisoned");
    // The patch is bare now, and back after it regrows.
    expect(plantsNear(t, 3).find((x) => x.id === patch!.id)?.ready).toBe(false);
    standAt(t, patch!.x, patch!.y + 1, 12, day + book.plants.field_mushroom!.regrowDays);
    expect(plantsNear(t, 3).find((x) => x.id === patch!.id)?.ready ?? true).toBe(true);
  });

  it("shown to a herbalist, a mistaken gathering is put right", () => {
    const t = town(1);
    const p = t.world.player;
    p.money = 20;
    p.inventory[itemKey("field mushroom")] = 2;
    natureOf(p).mislabelled["field mushroom"] = { "death cap": 2 };
    expect(showToHerbalist(p, "Old Moll").join(" ")).toContain("death cap");
    expect(p.inventory[itemKey("death cap")]).toBe(2);
    expect(p.inventory[itemKey("field mushroom")]).toBeUndefined();
  });
});

describe("N28 steps 6–7: tracking, hunting, fishing, taming", () => {
  it("tracking a wild goat by its signs leads to the goats", () => {
    const t = town(1);
    const realm = t.world.realm!;
    const hills = Object.values(realm.settlements).filter((s) => s.terrain === "hills" && !s.way);
    let found: ReturnType<typeof animalsNear>[number] | null = null;
    for (const s of hills) {
      for (let hour = 7; hour < 17 && !found; hour++) {
        standAt(t, tileOf(s.pos.x) + 300, tileOf(s.pos.y) + 300, hour);
        found = animalsNear(t, 400).find((g) => g.species === "wild_goat") ?? null;
      }
      if (found) break;
    }
    expect(found).toBeTruthy();
    const g = found!;
    const first = signOf(g, book.animals.wild_goat!, 0);
    standAt(t, first.x, first.y, t.world.hour);
    t.world.minute = 0;
    const lines: string[] = [];
    for (let step = 0; step < 4; step++) {
      // Hold the clock still, so the goats' loop is where the trail says.
      t.walkMinutes = () => [];
      const here = signOf(g, book.animals.wild_goat!, step);
      t.world.player.road!.x = here.x;
      t.world.player.road!.y = here.y;
      lines.push(...track(t, here.id));
    }
    expect(lines.join(" ")).toContain("close ahead");
    expect(Math.hypot(t.world.player.road!.x - g.x, t.world.player.road!.y - g.y)).toBeLessThan(20);
  });

  it("a hunt on a species without a creature is one check; the lord's deer by a town is poaching", () => {
    const t = town(1);
    const realm = t.world.realm!;
    const town0 = Object.values(realm.settlements).find((s) => s.kind === "town" || s.kind === "city")!;
    expect(isForbidden(realm, book.animals.red_deer!, { x: tileOf(town0.pos.x) + 200, y: tileOf(town0.pos.y) }, 20)).toContain("lord");
    expect(isForbidden(realm, book.animals.rabbit!, { x: tileOf(town0.pos.x) + 200, y: tileOf(town0.pos.y) }, 20)).toBeNull();
    expect(isForbidden(realm, book.animals.red_deer!, { x: 0, y: 0 }, 2)).toContain("season");
    expect(huntAnimal(t, "n:nothing").lines.join(" ")).toMatch(/not out|gone/);
  });

  it("fishing the river lands a fish that lives there", () => {
    const t = town(1);
    const realm = t.world.realm!;
    const land = landOf(realm);
    const river = roadDataOf(realm).rivers[0]!;
    let spot: { x: number; y: number } | null = null;
    for (const q of river.pts) {
      for (const [dx, dy] of [[0, 3], [3, 0], [0, -3], [-3, 0], [0, 4], [4, 0]] as const) {
        const x = q.x + dx;
        const y = q.y + dy;
        if (groundAt(land, x, y) !== Ground.water) {
          spot = { x, y };
          break;
        }
      }
      if (spot) break;
    }
    expect(spot).toBeTruthy();
    const p = t.world.player;
    p.inventory[itemKey("fishing rod")] = 1;
    p.skills.fishing = 5;
    p.attributes.agility = 18;
    let landed = "";
    for (let h = 6; h < 20 && !landed; h++) {
      standAt(t, spot!.x, spot!.y, h, 20);
      const r = fish(t).join(" ");
      if (r.includes("You land")) landed = r;
    }
    expect(landed).toMatch(/You land a (brown trout|salmon|pike|eel|carp|herring)/);
    expect(natureOf(p).seen).not.toEqual({});
  });

  it("feeding a stray dog over a few days makes it the player's", () => {
    const t = town(1);
    const realm = t.world.realm!;
    const site = Object.keys(realm.settlements).find((id) => strayAt(id) === "stray_dog")!;
    t.world.player.site = site;
    delete t.world.player.road;
    const p = t.world.player;
    p.attributes.charisma = 18;
    p.skills.animal_handling = 5;
    p.inventory[itemKey("bread loaf")] = 10;
    const lines: string[] = [];
    for (let d = 3; d < 12 && natureOf(p).pets.length === 0; d++) {
      t.world.day = d;
      lines.push(...tameStray(t));
      expect(tameStray(t).join(" ")).toMatch(/tomorrow|already/);
    }
    expect(natureOf(p).pets.map((x) => x.species)).toEqual(["stray_dog"]);
    expect(lines.join(" ")).toContain("follows you");
  });
});

describe("N28 step 8: the bestiary", () => {
  it("lists the species met, more as they are known better", () => {
    const t = town(1);
    const p = t.world.player;
    noteSpecies(p, "red_deer", 1, 1);
    noteSpecies(p, "willow", 3, 1);
    const view = natureView(p, null, null);
    expect(view.entries.map((e) => e.name).sort()).toEqual(["red deer", "white willow"]);
    expect(view.entries.find((e) => e.name === "white willow")!.text).toContain("cures");
    expect(entryOf("field_mushroom", 4)!.text).toContain("death cap");
  });
});

describe("N28 step 9: people who live off the land", () => {
  it("a herbalist on the hills goes out in early autumn for kingsroot, and sells what they bring home", () => {
    const t = town(1);
    const realm = t.world.realm!;
    const hills = Object.values(realm.settlements).find((s) => s.terrain === "hills" && !s.way)!;
    let found = false;
    for (let d = 25; d <= 27 && !found; d++) for (let k = 0; k < 20 && !found; k++) if ((herbalistHaul(realm, hills.id, `t_${hills.id}_${k}`, d).kingsroot ?? 0) > 0) found = true;
    expect(found).toBe(true);
    // Never in spring.
    for (let k = 0; k < 20; k++) expect(herbalistHaul(realm, hills.id, `t_${hills.id}_${k}`, 5).kingsroot).toBeUndefined();
    // A herbalist who talks: their stock gets the day's haul, with a price on it.
    const site = Object.keys(realm.settlements).find((id) => (t.store!.people.loadSite(id, "coarse") as Array<{ job: string }>).some((r) => r.job === "herbalist"))!;
    const s = realm.settlements[site]!;
    t.world.player.site = site;
    const map = siteMap(s, "village", realm);
    const roster = t.rosterAt(site, map, t.world.day)!;
    const herb = roster.people.find((x) => x.job === "herbalist")!;
    const id = t.meetTownsperson(roster, herb)!;
    expect(id).toBeTruthy();
    let stocked = false;
    for (let d = 14; d < 40 && !stocked; d++) {
      t.landHauls(site, d);
      const agent = t.agents[id]!;
      stocked = Object.keys(herbalistHaul(realm, site, id, d)).some((item) => (agent.state.inventory[itemKey(item)] ?? 0) > 0 && agent.persona.prices[item]! > 0);
    }
    expect(stocked).toBe(true);
  });
});

describe("N28 bounds", () => {
  it("wildlife in every country and season; herbalists earn a living, not a fortune", () => {
    const t = town(1);
    for (const b of checkNatureBounds(t.world.realm!)) expect(b.ok, `${b.name}: ${b.detail}`).toBe(true);
  });
});
