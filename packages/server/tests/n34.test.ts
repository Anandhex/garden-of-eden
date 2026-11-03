/**
 * N34: following people. The player keeps track of a friend; news of her reaches the player only when someone where
 * the player is knows it (a caravan out of the place she moved to), with its source and how sure; her last known place
 * stays the old one until then; her letter is carried by real travellers and arrives days after she wrote it.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { config } from "../src/config.js";
import { loadCreatureTemplates } from "../src/game/creatures.js";
import { WorldStore } from "../src/game/db.js";
import { follow, followsOf, MAX_FOLLOWS, overhear, unfollow } from "../src/game/follow/follow.js";
import { collectLetters, lettersDay, lettersOf, playerWrites, writeLetter } from "../src/game/follow/letters.js";
import { learn } from "../src/game/gossip/knowledge.js";
import { recordLifeEvent } from "../src/game/people/events.js";
import { syncBeasts } from "../src/game/realm/beasts.js";
import { roadDataOf } from "../src/game/road/generateRoads.js";
import { launch } from "../src/game/road/journeys.js";
import { shortest } from "../src/game/road/paths.js";
import { newWorld } from "../src/game/save.js";
import { Town } from "../src/game/town.js";
import { materialisePeople } from "../src/store/materialise.js";
import type { PersonRow } from "../src/store/peopleStore.js";
import { always, FakeProvider } from "./helpers.js";

vi.setConfig({ testTimeout: 180_000 });
beforeEach(() => {
  config.director = false;
  config.planning = false;
  config.realm = true;
});

const templates = loadCreatureTemplates();

function setup(seed = 1) {
  const store = new WorldStore(":memory:");
  const world = newWorld({}, templates, always(0.5), seed);
  const realm = world.realm!;
  materialisePeople(realm, store.people, world.day);
  syncBeasts(realm, store.beasts, world.day);
  const home = world.player.site!;
  // Her new place: one joined to home by road.
  const data = roadDataOf(realm);
  const there = Object.values(realm.settlements).filter((s) => !s.way && s.id !== home && shortest(data, home, s.id)).sort((a, b) => a.id.localeCompare(b.id))[0]!.id;
  const friend = (store.people.loadSite(home, "full") as PersonRow[]).find((r) => r.job !== "child" && r.cls !== "slave")!;
  return { store, world, realm, home, there, friend, data, p: world.player };
}

describe("N34 step 1: following", () => {
  it("follow and unfollow; at most a few dozen", () => {
    const { p, friend, home } = setup();
    expect(follow(p, friend.id, friend.name, "friend", 1, { site: home, how: "you saw them there" })).toContain("keep an ear out");
    expect(followsOf(p)[friend.id]?.lastKnown?.site).toBe(home);
    expect(follow(p, friend.id, friend.name, "friend", 1)).toContain("already");
    for (let k = 0; k < MAX_FOLLOWS + 2; k++) follow(p, `x${k}`, `X${k}`, "chosen", 1);
    expect(Object.keys(followsOf(p)).length).toBe(MAX_FOLLOWS);
    expect(unfollow(p, friend.id)).toContain("stop");
  });
});

describe("N34 step 2: word of her, by people who know it", () => {
  it("the player hears she married only once a caravan from her new place brings it; her last known place stays the old one till then", () => {
    const { store, realm, home, there, friend, p, data } = setup();
    follow(p, friend.id, friend.name, "friend", 1, { site: home, how: "you saw them there" });
    // She moves away and marries there.
    store.people.update(friend.id, { site: there });
    const groom = (store.people.loadSite(there, "full") as PersonRow[]).find((r) => r.gender !== friend.gender && r.job !== "child")!;
    const ev = recordLifeEvent(realm, store, { kind: "marriage", actor: groom.id, target: friend.id, site: there, day: 10, key: `${groom.id}+${friend.id}`, details: `${groom.name} married ${friend.name}`, importance: 3 });
    const ref = `e:${ev.id}`;
    // Nobody at home knows: nothing to hear, and she's still "last known" at home.
    expect(overhear(realm, store, p, home, 12)).toEqual([]);
    expect(followsOf(p)[friend.id]!.lastKnown!.site).toBe(home);
    // A caravan out of her place comes; one of its people tells a neighbour at home, who has it from the caravan.
    const out = shortest(data, there, home)!;
    const carter = (store.people.loadSite(there, "full") as PersonRow[]).find((r) => r.job !== "child" && r.id !== friend.id && r.id !== groom.id)!;
    const j = launch(realm, data, { kind: "caravan", party: [{ person: carter.id, name: carter.name, role: "carter", gender: carter.gender as "female" | "male" }], path: out, depart: 15 * 1440 + 6 * 60, purpose: "trade" })!;
    const neighbour = (store.people.loadSite(home, "full") as PersonRow[]).find((r) => r.job !== "child" && r.id !== friend.id)!;
    learn({ realm, store }, neighbour.id, ref, { day: 20, source: `carrier:${j.id}`, accuracy: 0.85, variant: 0 });
    const heard = overhear(realm, store, p, home, 20).join(" ");
    expect(heard).toContain(friend.name.split(" ")[0]!);
    expect(heard).toContain("caravan");
    expect(heard).toMatch(/fairly sure/);
    const f = followsOf(p)[friend.id]!;
    expect(f.lastKnown!.site).toBe(there);
    expect(f.heard.map((h) => h.ref)).toContain(ref);
    // Heard once, not every day.
    expect(overhear(realm, store, p, home, 21)).toEqual([]);
  });
});

describe("N34 step 3: letters carried by real travellers", () => {
  it("her letter waits for a traveller, rides with them, and arrives days after she wrote it, with who carried it", () => {
    const { store, realm, home, there, friend, p, data } = setup();
    follow(p, friend.id, friend.name, "friend", 1, { site: home, how: "you saw them there" });
    const letter = writeLetter(realm, { from: friend.id, fromName: friend.name, to: "player", toName: p.name, about: [], text: "Dear friend, I am married now. — A", written: 10, fromSite: there, toSite: home });
    // Nobody leaves for a day: it waits.
    lettersDay(realm, data, 10);
    expect(letter.at).toBe(there);
    // A real traveller of her place sets out for home on day 12.
    const walker = (store.people.loadSite(there, "full") as PersonRow[]).find((r) => r.job !== "child" && r.id !== friend.id)!;
    const j = launch(realm, data, { kind: "kin", party: [{ person: walker.id, name: walker.name, role: "visitor", gender: walker.gender as "female" | "male" }], path: shortest(data, there, home)!, depart: 11 * 1440 + 6 * 60, purpose: "a visit" })!;
    lettersDay(realm, data, 12);
    expect(letter.carrier?.person).toBe(walker.id);
    const arriveDay = Math.ceil(j.arrive / 1440);
    for (let d = 13; d <= arriveDay + 1; d++) lettersDay(realm, data, d);
    expect(letter.arrived).toBeGreaterThan(letter.written);
    expect(letter.legs.map((l) => l.person)).toEqual([walker.id]);
    const lines = collectLetters(realm, store, p, home, letter.arrived!).join(" ");
    expect(lines).toContain(`carried by ${walker.name}`);
    expect(lines).toContain("married");
    expect(p.letters?.length).toBe(1);
    expect(collectLetters(realm, store, p, home, letter.arrived! + 1)).toEqual([]);
  });

  it("a letter goes down with its carrier's party", () => {
    const { store, realm, home, there, friend, p, data } = setup();
    const letter = writeLetter(realm, { from: friend.id, fromName: friend.name, to: "player", toName: p.name, about: [], text: "x", written: 10, fromSite: there, toSite: home });
    const walker = (store.people.loadSite(there, "full") as PersonRow[]).find((r) => r.job !== "child" && r.id !== friend.id)!;
    const j = launch(realm, data, { kind: "kin", party: [{ person: walker.id, name: walker.name, role: "visitor", gender: walker.gender as "female" | "male" }], path: shortest(data, there, home)!, depart: 11 * 1440 + 6 * 60, purpose: "a visit" })!;
    lettersDay(realm, data, 12);
    j.ended = { minute: j.depart + 120, why: "robbed on the road" };
    lettersDay(realm, data, 13);
    expect(letter.lost?.why).toContain("robbed");
    expect(lettersOf(realm).find((l) => l.id === letter.id)?.arrived).toBeUndefined();
  });

  it("the player writes back to where they last knew her to be, paying postage", () => {
    const { realm, home, friend, p, data } = setup();
    p.money = 100;
    expect(playerWrites(realm, data, p, home, friend.id, "hi", 3)).toContain("keep track");
    follow(p, friend.id, friend.name, "friend", 1, { site: home, how: "you saw them there" });
    const line = playerWrites(realm, data, p, home, friend.id, "Come home soon.", 3);
    expect(line).toContain("letter");
    expect(p.money).toBeLessThan(100);
    expect(lettersOf(realm).some((l) => l.from === "player" && l.to === friend.id && l.toSite === home)).toBe(true);
  });
});

describe("N34: a friend writes when her life turns", () => {
  it("the day after she marries in her new place, she writes to the player; a traveller brings it home days later", () => {
    const { store, world, realm, home, there, friend, p, data } = setup();
    const town = new Town({ personas: {}, creatureTemplates: templates, world, llm: new FakeProvider(), store });
    // The player knows her and she's fond of them.
    const id = town.meetPerson(friend.id)!;
    expect(id).toBeTruthy();
    town.agents[id]!.state.relationship = 60;
    follow(p, friend.id, friend.name, "friend", 1, { site: home, how: "you saw them there" });
    // Nothing has happened to her: no letter.
    expect(town.followDay(home, 10)).toBeDefined();
    expect(lettersOf(realm).filter((l) => l.from === friend.id)).toEqual([]);
    // She moves away and marries there on day 10.
    store.people.update(friend.id, { site: there });
    const groom = (store.people.loadSite(there, "full") as PersonRow[]).find((r) => r.gender !== friend.gender && r.job !== "child")!;
    recordLifeEvent(realm, store, { kind: "marriage", actor: groom.id, target: friend.id, site: there, day: 10, key: `${groom.id}+${friend.id}`, details: `${groom.name} married ${friend.name}`, importance: 3 });
    town.followDay(home, 11);
    const letter = lettersOf(realm).find((l) => l.from === friend.id)!;
    expect(letter).toBeTruthy();
    expect(letter.written).toBe(11);
    expect(letter.fromSite).toBe(there);
    expect(letter.toSite).toBe(home);
    expect(letter.text).toMatch(/marr/i);
    // Not twice in a few days.
    town.followDay(home, 12);
    expect(lettersOf(realm).filter((l) => l.from === friend.id).length).toBe(1);
    // A traveller of her place going home carries it.
    const walker = (store.people.loadSite(there, "full") as PersonRow[]).find((r) => r.job !== "child" && r.id !== friend.id && r.id !== groom.id)!;
    const j = launch(realm, data, { kind: "kin", party: [{ person: walker.id, name: walker.name, role: "visitor", gender: walker.gender as "female" | "male" }], path: shortest(data, there, home)!, depart: 12 * 1440 + 6 * 60, purpose: "a visit" })!;
    const arriveDay = Math.ceil(j.arrive / 1440);
    for (let d = 12; d <= arriveDay + 1; d++) lettersDay(realm, data, d);
    expect(letter.arrived).toBeGreaterThan(letter.written);
    const lines = collectLetters(realm, store, p, home, letter.arrived!).join(" ");
    expect(lines).toContain(friend.name.split(" ")[0]!);
    expect(lines).toContain(`carried by ${walker.name}`);
  });
});
