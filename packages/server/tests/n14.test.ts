import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { config } from "../src/config.js";
import { seededRng } from "../src/game/dice.js";
import { killFigure } from "../src/game/realm/figures.js";
import { lieges, neighbours } from "../src/game/realm/generate.js";
import { dangersOn, destinations, route, setOut, siteOf } from "../src/game/realm/travel.js";
import { figureTalkerId, notablePersona, notablesOf } from "../src/game/realm/notables.js";
import { dungeonsInReach } from "../src/game/realm/wilds.js";
import { loadWorld, saveWorld } from "../src/game/save.js";
import { buildTurnMessage } from "../src/npc/persona.js";
import { loadTemplates } from "../src/npc/templates.js";
import { PLAIN, siteMap } from "../src/web/sites.js";
import { always, makeTown } from "./helpers.js";

beforeEach(() => {
  config.director = false;
  config.planning = false;
  config.summaries = false;
  config.realm = true;
});

describe("N14 travel: routes and the road", () => {
  it("there's a road route from the start town to every place, and the hours grow with the distance", () => {
    const town = makeTown();
    const realm = town.world.realm!;
    const start = town.site();
    const capital = lieges(realm, start).at(-1)!;
    const next = neighbours(realm, start)[0]!;
    const near = route(realm, start, next.id)!;
    const far = route(realm, start, capital.id)!;
    expect(near.path[0]).toBe(start);
    expect(far.path.at(-1)).toBe(capital.id);
    expect(far.hours).toBeGreaterThanOrEqual(near.hours);
    expect(far.hours).toBeGreaterThanOrEqual(24);
    const dests = destinations(realm, start);
    expect(dests.length).toBe(Object.values(realm.settlements).filter((s) => !s.abandoned && s.id !== start).length);
  });

  it("a big pack on the way is a danger, and can stop you; you fight it in code", () => {
    const town = makeTown();
    const realm = town.world.realm!;
    const start = town.site();
    const next = neighbours(realm, start)[0]!;
    realm.packs.road_test = { id: "road_test", species: "wolf", near: next.id, count: 8, cap: 8, tier: "F", alpha: null, bounty: 0 };
    expect(dangersOn(realm, route(realm, start, next.id)!).join(" ")).toMatch(/wolves near/);
    const p = town.world.player;
    const trip = setOut(realm, p, next.id, 1, always(0.01));
    expect(trip.ok).toBe(true);
    expect(trip.lines.join(" ")).toMatch(/comes out of the trees/);
    expect(trip.lines.join(" ")).toMatch(/You win through/);
    expect(realm.packs.road_test!.count).toBeLessThan(8);
  });

  it("you can't set out hurt, mid-fight, for nowhere, or for where you are", () => {
    const town = makeTown();
    const realm = town.world.realm!;
    const start = town.site();
    expect(setOut(realm, town.world.player, "Nowhereville", 1, always(0.5)).ok).toBe(false);
    expect(setOut(realm, town.world.player, realm.settlements[start]!.name, 1, always(0.5)).ok).toBe(false);
    town.world.player.hp = 2;
    expect(setOut(realm, town.world.player, neighbours(realm, start)[0]!.id, 1, always(0.5)).ok).toBe(false);
  });
});

describe("N14 other places: a map and people", () => {
  it("every place has its own map, the same each time, walled if it has walls, with the usual places on it", () => {
    const town = makeTown();
    const realm = town.world.realm!;
    const city = lieges(realm, town.site()).at(-1)!;
    const m = siteMap(city);
    expect(m.id).toBe(city.id);
    expect(m.tiles).not.toBe(PLAIN.tiles);
    expect(m.buildings.some((b) => /Palace|hall/i.test(b.name))).toBe(true);
    if ((city.buildings.walls ?? 0) > 0) expect(m.tiles[2]!.includes("wall")).toBe(true);
    for (const place of ["square", "gate", "inn", "forge"]) expect(m.spotAt(place, `someone_${place}`)).not.toBeNull();
    expect(m.isSolid(m.start.x, m.start.y)).toBe(false);
    expect(JSON.stringify(siteMap({ ...city }).tiles)).toBe(JSON.stringify(m.tiles));
  });

  it("the head and the best-known folk of a place get personas from templates, with their office and place", () => {
    const town = makeTown();
    const realm = town.world.realm!;
    const s = lieges(realm, town.site())[0]!;
    const folk = notablesOf(realm, s.id);
    expect(folk[0]!.id).toBe(s.leader);
    const p = notablePersona(realm, folk[0]!, loadTemplates(), 1)!;
    expect(p).not.toBeNull();
    expect(p.role).toMatch(new RegExp(s.name));
    expect(p.name.split(" ")[0]).toBe(realm.figures[s.leader!]!.name.split(" ")[0]);
    expect(JSON.stringify(p)).not.toMatch(/\{(place|placeKind|work|name|first|role|age)\}/);
  });
});

describe("N14 done when", () => {
  it("you travel to another place and to the capital, talk to the head there, come back, and your own town's people are mid-day", () => {
    const town = makeTown({ rng: seededRng(5), generate: true });
    const realm = town.world.realm!;
    const start = town.site();
    for (const pk of Object.values(realm.packs)) pk.count = 0;
    for (const f of Object.values(realm.factions)) if (f.kind === "gang") f.members = [];
    // The town has news of its own; the places it travels to have theirs.
    town.world.recentEvents = ["news.cart_attack"];
    const village = neighbours(realm, start).find((n) => n.kind === "village" || n.kind === "hamlet" || n.kind === "town")!;
    const startDay = town.world.day;
    const trip = town.setOutFor(village.name);
    expect(trip.ok).toBe(true);
    town.passHours(trip.hours);
    const lines = town.arriveAt(trip.route!.path.at(-1)!);
    expect(lines[0]).toMatch(new RegExp(`You reach ${village.name}`));
    expect(siteOf(town.world.player)).toBe(village.id);
    expect(realm.day).toBe(town.world.day);
    // Who's about: that place's people, not the start town's.
    const here = town.localIds();
    expect(here).not.toContain("brena");
    const head = figureTalkerId(village.leader!);
    expect(here).toContain(head);
    const msg = buildTurnMessage(town.personas[head]!, town.agents[head]!.state, town.sceneFor(town.agents[head]!), "Who rules this place?");
    expect(msg).toMatch(new RegExp(village.name));
    // The start town's news isn't theirs.
    expect(msg).not.toMatch(/merchant cart on the mine road/);
    // On to the capital.
    const city = lieges(realm, start).at(-1)!;
    const t2 = town.setOutFor(city.id);
    expect(t2.ok).toBe(true);
    town.passHours(t2.hours);
    town.arriveAt(city.id);
    expect(town.localIds()).toContain(figureTalkerId(city.leader!));
    expect(town.world.day).toBeGreaterThan(startDay + 1);
    // Save and load: the people met are still there, with their files.
    const dir = mkdtempSync(join(tmpdir(), "travel-"));
    const file = join(dir, "world.json");
    saveWorld(file, town.world);
    const back = loadWorld(file, town.personas, town.templates);
    expect(back.player.site).toBe(city.id);
    expect(back.talkers[head]).toBeDefined();
    // A town made from the loaded world has them about again.
    const again = makeTown({ world: back, generate: true });
    expect(again.localIds()).toContain(figureTalkerId(city.leader!));
    expect(back.npcStates[head]).toBeDefined();
    // Home again: a week or so on, and Brena is at her forge.
    const t3 = town.setOutFor(start);
    town.passHours(t3.hours);
    const back2 = town.arriveAt(start);
    expect(back2[0]).toMatch(/You're back in/);
    expect(town.site()).toBe(start);
    town.world.hour = 10;
    expect(town.placeOf("brena")).toBe("forge");
    expect(town.localIds()).not.toContain(head);
  });

  it("a head killed is a realm death (a new head follows); a realm death kills their NPC", () => {
    const town = makeTown({ generate: true });
    const realm = town.world.realm!;
    const s = lieges(realm, town.site())[0]!;
    town.world.player.site = s.id;
    const [headId, other] = town.meetNotables(s.id);
    const oldHead = s.leader!;
    town.agents[headId!]!.state.outcome = "dead";
    town.agents[headId!]!.state.deathCause = town.world.player.name;
    town.consequences();
    expect(realm.figures[oldHead]!.alive).toBe(false);
    expect(realm.news.at(-1)!.text).toMatch(/was killed by Traveler/);
    town.passHours(24);
    expect(s.leader).not.toBe(oldHead);
    const f = town.figureOf(other!)!;
    killFigure(realm, f, town.world.day, "a fever");
    town.consequences();
    expect(town.agents[other!]!.isDead).toBe(true);
  });

  it("dungeons in reach are counted from where you are", () => {
    const town = makeTown();
    const realm = town.world.realm!;
    const d = Object.values(realm.dungeons).find((x) => x.near !== town.site())!;
    expect(dungeonsInReach(realm, d.near).map((x) => x.id)).toContain(d.id);
  });
});
