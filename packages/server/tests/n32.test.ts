/**
 * N32: interiors and homes. Every door leads inside, to a map made from the building's kind and its household's class,
 * trade and wealth; the household is there when the crowd has them home (asleep in their beds at night); what they keep
 * is rolled the first time anyone touches the building, hidden things and a talker's secret letter among it; going into
 * a home uninvited is trespass, and whoever inside sees it shouts for the guard.
 */
import { CrowdSim, interiorOf, interiorWalkable } from "@millbrook/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { config } from "../src/config.js";
import { loadCreatureTemplates } from "../src/game/creatures.js";
import { WorldStore } from "../src/game/db.js";
import { checkGoodsBounds, enter, goodsOf, householdOf, interiorAt, lockedNow, peopleInside, search, stepInside, take, type InsideCtx } from "../src/game/interior/inside.js";
import { syncBeasts } from "../src/game/realm/beasts.js";
import { figureTalkerId } from "../src/game/realm/notables.js";
import { newWorld } from "../src/game/save.js";
import { Town } from "../src/game/town.js";
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

function setup(seed = 1, kind?: "town" | "city") {
  const store = new WorldStore(":memory:");
  const world = newWorld({}, templates, always(0.5), seed);
  materialisePeople(world.realm!, store.people, world.day);
  syncBeasts(world.realm!, store.beasts, world.day);
  const town = new Town({ personas: {}, creatureTemplates: templates, world, llm: new FakeProvider(), store });
  const realm = world.realm!;
  const site = kind ? Object.values(realm.settlements).filter((x) => x.kind === kind && !x.abandoned).sort((a, b) => a.id.localeCompare(b.id))[0]!.id : world.player.site!;
  if (kind) world.player.site = site;
  const map = siteMap(realm.settlements[site]!, "village", realm);
  const roster = town.rosterAt(site, map, world.day)!;
  const sim = new CrowdSim({ id: map.id, w: map.w, h: map.h, tiles: map.tiles, buildings: map.buildings, zones: map.zones }, roster);
  const ctx = (hour: number, minute = 0): InsideCtx => ({
    realm,
    store,
    player: world.player,
    day: world.day,
    hour,
    minute,
    seed: realm.seed,
    map,
    sim,
    crowdDay: { weather: "clear", festival: false },
    personas: town.personas,
    relationship: (id) => town.agents[id]?.state.relationship ?? 0,
    world,
  });
  return { store, world, town, realm, site, map, roster, sim, ctx };
}

describe("N32 step 2: interiors as different as their owners", () => {
  it("a serf's hovel and a merchant's house differ in size, rooms and furnishing; the same house is the same twice", () => {
    const hovel = interiorOf(1, "x", 3, { kind: "house", style: "hovel", cls: "serf", wealth: 0 });
    const merchant = interiorOf(1, "x", 4, { kind: "house", style: "merchant", cls: "merchant", trade: "merchant", wealth: 2 });
    expect(merchant.w * merchant.h).toBeGreaterThan(hovel.w * hovel.h * 2);
    expect(merchant.rooms.length).toBeGreaterThan(hovel.rooms.length);
    expect(hovel.furniture.some((f) => f.kind === "straw")).toBe(true);
    expect(hovel.furniture.some((f) => f.kind === "bed")).toBe(false);
    expect(merchant.furniture.some((f) => f.kind === "strongbox" || f.kind === "desk")).toBe(true);
    expect(Math.max(...merchant.furniture.map((f) => f.quality))).toBeGreaterThan(Math.max(...hovel.furniture.map((f) => f.quality)));
    expect(interiorOf(1, "x", 4, { kind: "house", style: "merchant", cls: "merchant", trade: "merchant", wealth: 2 })).toEqual(merchant);
    // The door is reachable from inside: the tile before it is floor.
    expect(interiorWalkable(merchant, merchant.door.x, merchant.door.y - 1)).toBe(true);
  });

  it("a town's own hovel and merchant's house come out as their households are", () => {
    const { ctx, map } = setup(1, "city");
    const c = ctx(12);
    const styles = new Map(map.buildings.map((b, i) => [b.style ?? b.kind, i]));
    const poor = styles.get("hovel") ?? styles.get("cottage");
    const rich = styles.get("merchant") ?? styles.get("craft");
    expect(poor).toBeDefined();
    expect(rich).toBeDefined();
    const a = interiorAt(c, poor!);
    const b = interiorAt(c, rich!);
    expect(b.w * b.h).toBeGreaterThan(a.w * a.h);
    expect(householdOf(c, rich!).wealth).toBeGreaterThanOrEqual(householdOf(c, poor!).wealth);
  });
});

describe("N32 step 7: homes show fortune", () => {
  it("the same house after a good year has better things than in a famine; its rooms stay where they are", () => {
    const { ctx, map, realm, site } = setup(1, "city");
    const s = realm.settlements[site]!;
    const c = ctx(12);
    const house = map.buildings.findIndex((b, i) => (b.style === "cottage" || b.style === "craft") && householdOf(c, i).members.length > 0);
    expect(house).toBeGreaterThanOrEqual(0);
    s.prosperity = 85;
    s.food = 90;
    const good = householdOf(c, house);
    const rich = interiorAt(c, house);
    s.prosperity = 20;
    s.food = 5;
    const lean = householdOf(c, house);
    const bare = interiorAt(c, house);
    expect(good.wealth).toBeGreaterThan(lean.wealth);
    expect([rich.w, rich.h, rich.rooms.length]).toEqual([bare.w, bare.h, bare.rooms.length]);
    const worth = (x: typeof rich) => x.furniture.reduce((a, f) => a + f.quality, 0);
    expect(worth(rich)).toBeGreaterThan(worth(bare));
  });
});

describe("N32 steps 1 and 4: going in, and who is there", () => {
  it("the inn is open: in by the door, out by the door", () => {
    const { ctx, map, world } = setup(1);
    const inn = map.buildings.findIndex((b) => b.kind === "inn");
    expect(inn).toBeGreaterThanOrEqual(0);
    const c = ctx(12);
    const r = enter(c, inn);
    expect(r.ok).toBe(true);
    expect(world.player.inside?.building).toBe(inn);
    expect(world.player.inside?.trespass).toBeUndefined();
    // Walk back to the door: out.
    const int = interiorAt(c, inn);
    expect(stepInside(c, int.door.x - world.player.inside!.x, 1).out).toBe(true);
    expect(world.player.inside).toBeUndefined();
  });

  it("at two in the morning the family is asleep in its beds; at noon a worker isn't home", () => {
    const { ctx, map, roster } = setup(1);
    const homes = new Map<number, number>();
    for (const p of roster.people) if (p.home !== undefined && p.job !== "guard") homes.set(p.home, (homes.get(p.home) ?? 0) + 1);
    const house = [...homes.entries()].filter(([i]) => map.buildings[i]?.kind === "house").sort((a, b) => b[1] - a[1])[0]![0];
    const night = ctx(2);
    const int = interiorAt(night, house);
    const inside = peopleInside(night, house, int);
    expect(inside.length).toBeGreaterThan(0);
    for (const p of inside) {
      expect(p.doing).toBe("asleep");
      expect(int.furniture.some((f) => (f.kind === "bed" || f.kind === "straw") && f.x === p.x && f.y === p.y)).toBe(true);
    }
    const workers = roster.people.filter((p) => p.home === house && ["farmer", "labourer", "smith", "miner", "porter"].includes(p.job)).map((p) => p.id);
    if (workers.length > 0) expect(peopleInside(ctx(11), house).some((p) => workers.includes(p.id))).toBe(false);
  });
});

describe("N32 step 5: belongings and hidden things", () => {
  it("a hidden letter in the head's desk is one of their real secrets; reading it, the player knows it", () => {
    const { ctx, map, realm, site, town, world, store } = setup(1);
    town.meetNotables(site);
    const head = figureTalkerId(realm.settlements[site]!.leader!);
    const persona = town.personas[head]!;
    expect(persona).toBeTruthy();
    // Their depth gives most heads a secret; one is written for this seed's head if not.
    if (persona.secrets.length === 0) persona.secrets.push({ id: "skim", about: "the tithe barn", text: "I keep back a tenth of the tithe for myself." });
    const secret = persona.secrets[0]!;
    const hall = map.buildings.findIndex((b) => ["hall", "manor", "palace", "castle"].includes(b.kind ?? ""));
    expect(hall).toBeGreaterThanOrEqual(0);
    const c = ctx(12);
    const goods = goodsOf(c, hall);
    const letter = goods.find((g) => g.item === "letter" && g.owner === head)!;
    expect(letter.ref).toBe(`secret:${head}:${secret.id}`);
    expect(letter.hidden).toBe(1);
    // Stand by the desk it's in, search until it's found, and take it.
    const int = interiorAt(c, hall);
    const desk = int.furniture.find((f) => f.slot?.id === letter.slot)!;
    world.player.attributes.perception = 20;
    world.player.inside = { site, building: hall, x: desk.x, y: desk.y + 1 };
    if (!interiorWalkable(int, desk.x, desk.y + 1)) world.player.inside = { site, building: hall, x: desk.x + 1, y: desk.y };
    let found = "";
    for (let d = 1; d < 12 && !found.includes("letter"); d++) {
      world.day = d;
      found = search(ctx(12)).join(" ");
    }
    expect(found).toContain("letter");
    const read = take(ctx(12), letter.slot, "letter").join(" ");
    expect(read).toContain(secret.text);
    expect(world.player.facts ?? []).toContain(`${head}.${secret.id}`);
    expect(store.goods.of(site, hall)!.some((g) => g.item === "letter")).toBe(false);
  });

  it("goods are kept only for buildings someone touched", () => {
    const { ctx, map, store } = setup(1);
    expect(store.goods.touched()).toBe(0);
    goodsOf(ctx(12), map.buildings.findIndex((b) => b.kind === "inn"));
    expect(store.goods.touched()).toBe(1);
    expect(checkGoodsBounds(store)[0]!.ok).toBe(true);
  });
});

describe("N32 step 6: trespass", () => {
  it("a merchant's door is locked; picked in the evening, a servant inside sees the intruder and the guard is called", () => {
    const { ctx, map, world, roster } = setup(1, "city");
    // A locked house with a servant or slave of the household living in it.
    const watched = map.buildings.findIndex((b, i) => ["house", "manor", "hall", "palace", "castle"].includes(b.kind ?? "") && roster.people.some((p) => p.home === i && (p.job === "servant" || p.cls === "slave")) && lockedNow(householdOf(ctx(21), i), 21, true));
    expect(watched).toBeGreaterThanOrEqual(0);
    expect(enter(ctx(21, 30), watched).locked).toBe(true);
    world.player.skills.lockpicking = 5;
    world.player.attributes.agility = 20;
    let lines: string[] = [];
    for (let d = 1; d < 30 && !(world.player.crimes ?? []).some((x) => x.kind === "trespass"); d++) {
      world.day = d;
      for (const h of [19, 20, 21]) {
        delete world.player.inside;
        lines = enter({ ...ctx(h, 10), day: d }, watched, true).lines;
        if ((world.player.crimes ?? []).some((x) => x.kind === "trespass")) break;
      }
    }
    const crime = (world.player.crimes ?? []).find((x) => x.kind === "trespass")!;
    expect(crime).toBeTruthy();
    expect(lines.join(" ")).toContain("shouts for the guard");
    expect(world.player.bounty).toBeGreaterThan(0);
    const ev = (world.events ?? []).find((e) => e.id === crime.event)!;
    expect(ev.kind).toBe("trespass");
    expect(ev.witnesses?.length).toBe(1);
  });

  it("a hovel is never locked; a cottage is at night", () => {
    expect(lockedNow({ kind: "house", style: "hovel", cls: "serf", wealth: 0 }, 2, false)).toBe(false);
    expect(lockedNow({ kind: "house", style: "cottage", cls: "commoner", wealth: 1 }, 2, true)).toBe(true);
    expect(lockedNow({ kind: "house", style: "cottage", cls: "commoner", wealth: 1 }, 12, true)).toBe(false);
    expect(lockedNow({ kind: "inn", wealth: 1 }, 2, true)).toBe(false);
  });
});
