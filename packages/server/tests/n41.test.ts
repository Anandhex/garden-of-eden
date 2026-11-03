import { beforeEach, describe, expect, it, vi } from "vitest";
import { config } from "../src/config.js";
import { loadCreatureTemplates } from "../src/game/creatures.js";
import { WorldStore } from "../src/game/db.js";
import { seededRng } from "../src/game/dice.js";
import { festivalOn } from "../src/game/events-calendar.js";
import { menuFor } from "../src/game/choice/registry.js";
import type { ChoiceCtx } from "../src/game/choice/types.js";
import { contestGames, entrantsFor, holdGame } from "../src/game/leisure/contests.js";
import { announceFair, hostTournament, leisureOf, TOURNEY } from "../src/game/leisure/events.js";
import { gameById, loadGames, resolveGame, type Entrant } from "../src/game/leisure/games.js";
import { rowEntrant } from "../src/game/leisure/people.js";
import { playerContest, playerGamble, playerOrganise, playerRematch } from "../src/game/leisure/player.js";
import { tavernNight } from "../src/game/leisure/tavern.js";
import { advanceWorld } from "../src/game/people/world.js";
import { generateRealm } from "../src/game/realm/generate.js";
import type { Realm } from "../src/game/realm/types.js";
import { journeyOf } from "../src/game/road/journeys.js";
import { newWorld } from "../src/game/save.js";
import { Town } from "../src/game/town.js";
import { initiativeFor } from "../src/npc/initiative.js";
import { materialisePeople } from "../src/store/materialise.js";
import type { PersonRow } from "../src/store/peopleStore.js";
import { FakeProvider, pickTestPlaces } from "./helpers.js";

/**
 * N41: leisure and contests. Games are data with one resolver; evenings at every inn have tables where cheats are caught and tempers
 * break; festivals have contests; lords hold tournaments that knights ride to and die at; the player plays, bets, wins and is challenged.
 * People and places are found by role, never by name.
 */
vi.setConfig({ testTimeout: 600_000, hookTimeout: 600_000 });

beforeEach(() => {
  config.realm = true;
  config.realmSeed = undefined;
  config.director = false;
  config.planning = false;
  config.peopleLazy = "";
  config.leisure = true;
  config.gossip = true;
  config.chatter = true;
  config.choice.violence = false;
  config.firstHour = false;
});

function slice(seed = 1) {
  const realm = generateRealm(seed, 1);
  const store = new WorldStore(":memory:");
  materialisePeople(realm, store.people, 1);
  const { start, liege } = pickTestPlaces(realm);
  return { realm, store, start, liege, ctx: { realm, store } };
}

const ent = (id: string, o: Partial<Entrant> = {}): Entrant => ({ id, name: id, skills: {}, attrs: {}, ...o });

describe("N41 step 1: games as data, one resolver", () => {
  it("every game file passes the schema, with the starting set", () => {
    const ids = loadGames().map((g) => g.id);
    for (const id of ["dice", "cards", "knucklebones", "arm_wrestling", "drinking", "darts", "archery", "wrestling", "foot_race", "horse_race", "strongman", "ball_game", "joust", "melee", "dance", "storytelling", "bard"]) expect(ids).toContain(id);
  });

  it("a skilled cheat among three marks is caught by a sharp-eyed watcher, and gets away with it without one", () => {
    const dice = gameById("dice");
    const cheat = ent("cheat", { cheats: true, skills: { sleight: 2, gambling: 1 }, attrs: { agility: 14 } });
    const marks = [ent("a"), ent("b"), ent("c")];
    const hawk = { id: "hawk", perception: 18, gambling: 3 };
    let withEyes = 0;
    let without = 0;
    let found = -1;
    for (let seed = 1; seed <= 200; seed++) {
      const seen = resolveGame(dice, [cheat, ...marks], seededRng(seed), [hawk]).cheats.some((c) => c.caught && c.by === "hawk");
      const blind = resolveGame(dice, [cheat, ...marks], seededRng(seed), []).cheats.some((c) => c.caught);
      if (seen) withEyes++;
      if (blind) without++;
      if (found < 0 && seen && !blind) found = seed;
    }
    expect(found).toBeGreaterThan(0);
    expect(withEyes).toBeGreaterThan(without * 2);
    // On that fixed seed: caught with the watcher, not without.
    expect(resolveGame(dice, [cheat, ...marks], seededRng(found), [hawk]).winner).not.toBe("cheat");
  });

  it("gambling and sleight are skills, and someone teaches each", async () => {
    const { SKILLS } = await import("../src/npc/skills.js");
    const { loadTemplates } = await import("../src/npc/templates.js");
    expect(SKILLS).toContain("gambling");
    expect(SKILLS).toContain("sleight");
    const t = loadTemplates();
    expect(Object.values(t).some((x) => x.teaches === "gambling")).toBe(true);
    expect(Object.values(t).some((x) => x.teaches === "sleight")).toBe(true);
  });
});

describe("N41 step 2: tavern nights", () => {
  it("evenings at the start town's inn have dice games where a cheat is caught and a fight breaks out (violence on), or a confrontation and a grudge (off)", () => {
    for (const violence of [true, false]) {
      config.choice.violence = violence;
      const { realm, store, start, ctx } = slice(1);
      let hit: ReturnType<typeof tavernNight>["tables"][number] | undefined;
      let nights = 0;
      for (let day = 1; day <= 120 && !hit; day++) {
        const night = tavernNight(ctx, start, day);
        if (night.tables.length > 0) nights++;
        hit = night.tables.find((t) => t.caught && t.fight && ["dice", "cards"].includes(t.game));
      }
      expect(nights).toBeGreaterThan(0);
      expect(hit, `violence ${violence}`).toBeDefined();
      expect(hit!.fight!.violent).toBe(violence);
      const kinds = hit!.events.map((id) => store.eventById(id)!.kind);
      expect(kinds).toContain("cheat-caught");
      expect(kinds).toContain(violence ? "npc-fight" : "confrontation");
      // The cheated hold it against the cheat.
      const cheated = hit!.players.filter((id) => id !== hit!.caught!.cheat);
      expect(cheated.some((id) => store.social.openBetween(id, hit!.caught!.cheat).length > 0)).toBe(true);
      void realm;
    }
  });

  it("a place lived later plays the same nights (the tables are pure in the seed, the rows and the day)", () => {
    const a = slice(2);
    const b = slice(2);
    const sum = (s: ReturnType<typeof slice>) => [1, 2, 3, 4, 5].map((d) => tavernNight(s.ctx, s.start, d).tables.map((t) => `${t.game}:${t.players.join("+")}:${t.played.winner}`).join("|")).join("/");
    const got = sum(a);
    expect(got).toBe(sum(b));
    // Most evenings have tables.
    expect(got.split("/").filter((x) => x.length > 0).length).toBeGreaterThanOrEqual(4);
  });

  it("an evening's game is on the menu (play), and the crowd shows them going to the inn", () => {
    const ctx = { who: "x", name: "X", kind: "talker", grain: "hour", day: 5, hour: 20, site: "s", habit: { activity: "socialise", place: "square" }, workPlace: "square", eatPlace: "inn", rank: 2, traits: { bravery: 0.5, temper: 0.8, honesty: 0.2, sociability: 0.9, forgiveness: 0.5, greed: 0.8, ambition: 0.5 }, hunger: 0, fatigue: 0, mood: 1, money: 200, broke: false, stock: 0, festival: false, storm: false, present: [], absent: [], gatherings: [], recruiter: false, wantsToLeave: false, violence: false, last: {}, streak: null, fights: { place: 0, hour: 0 } } as unknown as ChoiceCtx;
    const menu = menuFor(ctx);
    const play = menu.find((o) => o.action === "play")!;
    expect(play).toBeDefined();
    expect(play.parts.map((p) => p[0])).toContain("a gambler's itch");
    expect(menuFor({ ...ctx, hour: 10 }).some((o) => o.action === "play")).toBe(false);
  });
});

describe("N41 step 3: contest days and fairs", () => {
  it("a festival's archery is won by the best archer most of the time", () => {
    let best = 0;
    let held = 0;
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const { realm, store, start, ctx } = slice(seed);
      const day = [...Array(48).keys()].map((d) => d + 1).find((d) => festivalOn(d))!;
      const rows = (store.people.loadSite(start, "full") as PersonRow[]).filter((r) => r.death === null && !r.away);
      const g = gameById("archery");
      const entrants = entrantsFor(realm, g, rows, start, day);
      if (entrants.length < 3) continue;
      const strength = (r: PersonRow) => {
        const e = rowEntrant(r, day);
        return 2 * (e.skills.archery ?? 0) + Math.floor(((e.attrs.perception ?? 10) - 10) / 2);
      };
      const top = Math.max(...entrants.map(strength));
      const res = holdGame(ctx, start, day, g, rows);
      held++;
      if (res.winner && strength(store.people.get(res.winner)!) === top) best++;
    }
    expect(held).toBeGreaterThanOrEqual(5);
    expect(best / held).toBeGreaterThan(0.5);
  });

  it("a fair brings people from places within reach, arriving the day before", () => {
    const { realm, store, liege } = slice(1);
    const town = Object.values(realm.settlements).find((s) => ["town", "city"].includes(s.kind) && (s.buildings.market ?? 0) > 0 && !s.abandoned)!;
    const ev = announceFair(realm, store, town.id, 1, 6);
    expect(ev.journeys.length).toBeGreaterThan(0);
    for (const jid of ev.journeys) {
      const j = journeyOf(realm, jid)!;
      expect(j.purpose).toContain("fair");
      // At the fair's town by the start of the day before.
      expect(j.turn!.arrive).toBeLessThanOrEqual((ev.day - 1) * 1440);
    }
    const live = new Set([town.id, ...ev.journeys.flatMap((id) => journeyOf(realm, id)!.path)]);
    advanceWorld(realm, store, ev.day, { live });
    const res = leisureOf(realm).log.find((r) => r.id === ev.id)!;
    expect(res.visitors).toBeGreaterThan(0);
    void liege;
  });
});

describe("N41 step 4: tournaments", () => {
  it("the liege town's lord holds a tournament that knights from three places ride to; one dies; the champion's name is news across the kingdom", () => {
    let done = false;
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8] as const) {
      const { realm, store, liege } = slice(seed);
      const L = realm.settlements[liege]!;
      L.treasury = Math.max(L.treasury, TOURNEY.prize * 4);
      const ev = hostTournament(realm, store, liege, 1);
      if (!ev) continue;
      const travelled = new Set(ev.entrants.map((id) => store.people.get(id)!.site).filter((s) => s !== liege));
      if (travelled.size < 3) continue;
      // Their journeys take them there for the day.
      const kingdomPlaces = Object.values(realm.settlements).filter((s) => s.kingdom === L.kingdom && !s.abandoned);
      const live = new Set(kingdomPlaces.map((s) => s.id));
      advanceWorld(realm, store, ev.day, { live });
      const res = leisureOf(realm).log.find((r) => r.id === ev.id)!;
      expect(res.champion).toBeDefined();
      if (res.deaths.length === 0) continue;
      // The dead knight doesn't ride home.
      const dead = store.people.get(res.deaths[0]!)!;
      expect(dead.death).not.toBeNull();
      expect(dead.away).toBeNull();
      // The champion's name reaches every town of the kingdom, carried by travellers.
      const news = realm.news.find((n) => n.kind === "tournament" && n.text.includes(res.championName!))!;
      expect(news).toBeDefined();
      const towns = kingdomPlaces.filter((s) => s.kind !== "hamlet" && !s.way);
      let day = ev.day;
      while (day < ev.day + 45 && !towns.every((t) => realm.heard[t.id]?.[news.id])) advanceWorld(realm, store, ++day, { live });
      expect(towns.filter((t) => !realm.heard[t.id]?.[news.id]).map((t) => t.name)).toEqual([]);
      done = true;
      break;
    }
    expect(done).toBe(true);
  });
});

describe("N41 step 5: the player", () => {
  function playerTown(seed = 1) {
    const templates = loadCreatureTemplates();
    const store = new WorldStore(":memory:");
    const world = newWorld({}, templates, Math.random, seed);
    materialisePeople(world.realm!, store.people, world.day);
    const town = new Town({ personas: {}, creatureTemplates: templates, world, llm: new FakeProvider(), store, stories: false });
    return { town, world, store, realm: world.realm as Realm };
  }

  it("the player wins an archery contest and a rival challenges them to a rematch", () => {
    const { town, world, store } = playerTown(1);
    world.hour = 11;
    world.player.place = "square";
    world.player.skills.archery = 5;
    world.player.attributes.perception = 20;
    // A good archer wins most festivals' archery: the first one they win.
    let r = { ok: false, lines: [] as string[] };
    for (const fest of [...Array(48 * 2).keys()].map((d) => d + 2).filter((d) => festivalOn(d))) {
      world.day = fest;
      r = playerContest(town, { game: "archery" });
      expect(r.ok).toBe(true);
      if (r.lines.join(" ").includes("You win") && world.player.leisure?.rivals?.length) break;
    }
    expect(r.lines.join(" ")).toContain("You win");
    const rival = world.player.leisure?.rivals?.[0];
    expect(rival).toBeDefined();
    const agent = town.agents[rival!.who];
    expect(agent).toBeDefined();
    const opening = initiativeFor(agent!.persona, agent!.state, town.sceneFor(agent!));
    expect(opening?.trigger).toBe("challenge");
    // The game is done for today, and the rematch can be played.
    expect(playerContest(town, { game: "archery" }).ok).toBe(false);
    const m = playerRematch(town, rival!.who);
    expect(m.ok).toBe(true);
    expect(world.player.leisure!.rivals![0]!.rematch).toBeDefined();
    void store;
    town.close();
  });

  it("dice at the inn in the evening moves coin; caught cheating sets the table against the player; a paid-for contest day is held", () => {
    const { town, world, store, realm } = playerTown(2);
    world.hour = 20;
    world.player.place = "inn";
    world.player.money = 500;
    expect(playerGamble(town, { game: "dice", stake: 10 }).ok).toBe(true);
    expect(world.player.money).not.toBe(500);
    world.player.skills.sleight = 0;
    world.player.attributes.agility = 3;
    let caught = false;
    for (let i = 0; i < 30 && !caught; i++) {
      const r = playerGamble(town, { game: "dice", stake: 5, cheat: true });
      caught = r.lines.some((l) => l.includes("Cheat!"));
    }
    expect(caught).toBe(true);
    expect(store.social.openAgainst("player").length).toBeGreaterThan(0);
    // Paying for a contest day: tomorrow there's one, and its coin went into the place's treasury.
    const before = realm.settlements[town.site()]!.treasury;
    expect(playerOrganise(town).ok).toBe(true);
    expect(realm.settlements[town.site()]!.treasury).toBe(before + 60);
    expect(leisureOf(realm).events.some((e) => e.kind === "contest_day" && e.day === world.day + 1)).toBe(true);
    town.close();
  });
});

describe("N41 balance", () => {
  it("cheats-caught: a share of cheats at the inns are caught, not none and not all", () => {
    const { start, ctx, liege } = slice(3);
    let tried = 0;
    let caught = 0;
    for (const site of [start, liege])
      for (let d = 1; d <= 60; d++)
        for (const t of tavernNight(ctx, site, d).tables) {
          tried += t.played.cheats.length;
          caught += t.played.cheats.filter((c) => c.caught).length;
        }
    expect(tried).toBeGreaterThan(5);
    expect(caught).toBeGreaterThan(0);
    expect(caught).toBeLessThan(tried);
  });

  it("tournament-deaths-rare: few knights die in a tournament", () => {
    const joust = gameById("joust");
    let deaths = 0;
    let bouts = 0;
    for (let s = 1; s <= 400; s++) {
      const p = resolveGame(joust, [ent("a", { skills: { animal_handling: 2 }, attrs: { strength: 13 } }), ent("b", { skills: { animal_handling: 2 }, attrs: { strength: 12 } })], seededRng(s));
      deaths += p.deaths.length;
      bouts++;
    }
    expect(deaths / bouts).toBeLessThan(0.08);
    expect(deaths).toBeGreaterThan(0);
  });

  it("contest games for a place are the ones its people can play", () => {
    const { realm, store, start } = slice(1);
    const rows = store.people.loadSite(start, "full") as PersonRow[];
    const games = contestGames(realm, start, rows).map((g) => g.id);
    expect(games).toEqual(expect.arrayContaining(["archery", "wrestling", "foot_race"]));
  });
});
