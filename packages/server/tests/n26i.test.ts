/**
 * N26I: fallen places, lairs and strongholds (and N26J step 3: the player taken). A place an attacker breaks falls: a pack
 * makes it a lair, a gang a stronghold; its people flee by name and remember it; bandits take captives who are ransomed,
 * sold, turned or escape; the world answers; places are won back and resettled.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { config } from "../src/config.js";
import { WorldStore } from "../src/game/db.js";
import { seededRng } from "../src/game/dice.js";
import { captiveAct, captiveDay, maybeTake, ransomOf } from "../src/game/law/taken.js";
import { liveSites } from "../src/game/people/live.js";
import type { LifeCtx } from "../src/game/people/step.js";
import { advanceWorld } from "../src/game/people/world.js";
import { syncBeasts } from "../src/game/realm/beasts.js";
import { captivesAccounted, captivityOf, fallenDay, fallPlace, retake, STRONGHOLD_EVERY, takeCaptive } from "../src/game/realm/fall.js";
import { generateRealm } from "../src/game/realm/generate.js";
import { pickStartSite } from "../src/game/realm/start.js";
import type { Realm, Settlement } from "../src/game/realm/types.js";
import { gangMembers } from "../src/game/realm/who.js";
import { journeysOf } from "../src/game/road/journeys.js";
import { materialisePeople } from "../src/store/materialise.js";
import type { PersonRow } from "../src/store/peopleStore.js";

vi.setConfig({ testTimeout: 300_000 });
beforeEach(() => {
  config.director = false;
  config.planning = false;
});

function world(seed = 1) {
  const realm = generateRealm(seed, 1);
  const store = new WorldStore(":memory:");
  materialisePeople(realm, store.people, 1);
  syncBeasts(realm, store.beasts, 1);
  const start = pickStartSite(realm, realm.seed);
  const ctx: LifeCtx = { realm, store };
  return { realm, store, start, ctx, live: liveSites(realm, start, "all") };
}

/** A small place with people and a neighbour to flee to. */
const smallPlace = (realm: Realm) => Object.values(realm.settlements).filter((s) => (s.kind === "hamlet" || s.kind === "village") && !s.way && s.roads.some((r) => realm.settlements[r] && !realm.settlements[r]!.way)).sort((a, b) => (a.id < b.id ? -1 : 1))[0]!;
const gangOf = (realm: Realm) => Object.values(realm.factions).find((f) => f.kind === "gang" && f.dissolved === undefined && gangMembers(realm, f.id).length >= 2)!;
const rowsOf = (w: ReturnType<typeof world>, site: string) => (w.store.people.loadSite(site, "full") as PersonRow[]).filter((r) => r.death === null);

describe("N26I step 1: falling", () => {
  it("a pack that wins against a hamlet with its fighters gone takes it; a walled town doesn't fall to a pack", () => {
    const w = world(1);
    const s = smallPlace(w.realm);
    const p = Object.values(w.realm.packs).find((x) => x.count >= 3)!;
    // Its fighters are dead.
    for (const r of rowsOf(w, s.id).filter((r) => (w.realm.day - r.born_day) / config.daysPerYear >= 16)) w.store.people.update(r.id, { death: JSON.stringify({ cause: "beast", day: 1, site: s.id }) });
    w.realm.falls.push({ site: s.id, to: "pack", id: p.id, day: 2, how: "overrun by wolves" });
    const town = Object.values(w.realm.settlements).find((x) => x.kind === "town" && !x.way)!;
    w.realm.falls.push({ site: town.id, to: "pack", id: p.id, day: 2, how: "overrun" });
    fallenDay(w.ctx, 2);
    expect(s.fallen).toMatchObject({ to: "pack", id: p.id });
    expect(p.near).toBe(s.id);
    expect(town.fallen).toBeUndefined();
    expect(w.realm.news.some((n) => n.text.includes(`${s.name} has fallen`))).toBe(true);
  });

  it("when a gang takes a place its people flee as rows on journeys and remember where they came from; some are taken captive by name", () => {
    const w = world(1);
    const s = smallPlace(w.realm);
    const g = gangOf(w.realm);
    const before = rowsOf(w, s.id).length;
    fallPlace(w.ctx, s, "gang", g.id, 3, "overrun by bandits");
    const captives = rowsOf(w, s.id).filter((r) => r.captive);
    expect(captives.length).toBeGreaterThan(0);
    for (const r of captives) expect(captivityOf(r)!.by).toBe(g.id);
    const fled = Object.values(w.realm.settlements).flatMap((x) => rowsOf(w, x.id)).filter((r) => r.origin && JSON.parse(r.origin).site === s.id);
    expect(fled.length + captives.length).toBe(before);
    expect(journeysOf(w.realm).some((j) => j.kind === "refugees" && j.move?.from === s.id)).toBe(true);
    // A stronghold now: the gang's seat, a palisade, stores.
    expect(g.seat).toBe(s.id);
    expect(s.buildings.walls).toBeGreaterThan(0);
    expect(s.stores).toBeDefined();
    for (const m of gangMembers(w.realm, g.id)) expect(m.home).toBe(s.id);
  });
});

describe("N26I steps 2–5: lairs, strongholds and captives", () => {
  it("a lair's pack can grow past its old cap, and the next places lose their herds to it", () => {
    const w = world(1);
    const s = smallPlace(w.realm);
    const p = Object.values(w.realm.packs).find((x) => x.count >= 3)!;
    const cap = p.cap;
    const n = w.realm.settlements[s.roads.find((r) => !w.realm.settlements[r]!.way)!]!;
    fallPlace(w.ctx, s, "pack", p.id, 2, "overrun");
    expect(p.cap).toBeGreaterThan(cap);
    const food = n.food;
    for (let d = 3; d <= 6; d++) fallenDay(w.ctx, d);
    expect(n.food).toBeLessThan(food);
  });

  it("a merchant's child is ransomed when the place pays, and walks home", () => {
    const w = world(1);
    const s = smallPlace(w.realm);
    const g = gangOf(w.realm);
    const home = w.realm.settlements[s.roads.find((r) => !w.realm.settlements[r]!.way)!]!;
    fallPlace(w.ctx, s, "gang", g.id, 2, "overrun");
    const child = rowsOf(w, home.id).find((r) => !r.captive)!;
    w.store.people.update(child.id, { cls: "merchant" });
    takeCaptive(w.ctx, w.store.people.get(child.id)!, g.id, s.id, 2, seededRng(1));
    // Make sure it's a ransom.
    const c = captivityOf(w.store.people.get(child.id)!)!;
    w.store.people.update(child.id, { captive: JSON.stringify({ ...c, use: "ransom", worth: 3, home: home.id }) });
    home.treasury = 100_000;
    for (let d = 3; d <= 2 + STRONGHOLD_EVERY * 3; d++) fallenDay(w.ctx, d);
    const after = w.store.people.get(child.id)!;
    expect(after.captive).toBeNull();
    expect(after.site).toBe(home.id);
    expect(w.realm.news.some((n) => n.text.includes(child.name) && /ransom|paid|home/.test(n.text))).toBe(true);
  });

  it("in a kingdom without slavery no captive is sold; every captive is accounted for", () => {
    const w = world(2);
    const s = smallPlace(w.realm);
    const g = gangOf(w.realm);
    if (s.kingdom) w.realm.kingdoms[s.kingdom]!.laws.slavery = false;
    fallPlace(w.ctx, s, "gang", g.id, 2, "overrun");
    for (let d = 3; d <= 60; d++) fallenDay(w.ctx, d);
    expect(w.realm.stats.captives_sold ?? 0).toBe(0);
    const all = Object.keys(w.realm.settlements).flatMap((id) => rowsOf(w, id));
    expect(captivesAccounted(w.realm, all).lost).toBe(0);
  });

  it("broken, a stronghold frees its captives, and the families who fled come back: a hamlet again with its old name", () => {
    const w = world(1);
    const s = smallPlace(w.realm);
    const name = s.name;
    const g = gangOf(w.realm);
    fallPlace(w.ctx, s, "gang", g.id, 2, "overrun");
    const held = rowsOf(w, s.id).filter((r) => r.captive).map((r) => r.id);
    // Let the refugees arrive where they fled.
    advanceWorld(w.realm, w.store, 8, { live: w.live });
    retake(w.ctx, s, 8, "soldiers broke them");
    for (const id of held) expect(w.store.people.get(id)!.captive).toBeNull();
    expect(s.fallen).toBeUndefined();
    // Make the place they fled to poor, so going back is worth it.
    for (const id of s.roads) if (w.realm.settlements[id]) w.realm.settlements[id]!.prosperity = 20;
    for (let d = 9; d <= 40 && s.abandoned; d++) fallenDay(w.ctx, d);
    expect(s.abandoned).toBe(false);
    expect(s.name).toBe(name);
    expect(s.kind).toBe("hamlet");
  });
});

describe("N26J step 3: the player taken", () => {
  const player = () => ({ name: "Tester", money: 400, renown: 25, hp: 30, maxHp: 30, attributes: { agility: 12 }, skills: {}, factions: [] }) as never as Parameters<typeof maybeTake>[1];

  it("beaten by a gang with a stronghold, a player with renown is taken there and held", () => {
    const w = world(1);
    const s = smallPlace(w.realm);
    const g = gangOf(w.realm);
    fallPlace(w.ctx, s, "gang", g.id, 2, "overrun");
    const p = player();
    const r = maybeTake(w.realm, p, g.id, w.start, 3, seededRng(1));
    expect(r.taken).toBe(true);
    expect(p.chapter).toMatchObject({ kind: "captive", holder: g.id, site: s.id });
    expect(p.site).toBe(s.id);
    expect(p.money).toBeLessThan(400);
  });

  it("a friend with coin pays the ransom and the player walks free; or they buy it themselves", () => {
    const w = world(1);
    const g = gangOf(w.realm);
    const p = player();
    maybeTake(w.realm, p, g.id, w.start, 3, seededRng(1));
    p.money = 0;
    let paid = 0;
    const r = captiveAct(w.realm, p, "ransom", 4, 12, seededRng(1), [{ name: "Hob", money: 10_000, pay: (n) => void (paid = n) }]);
    expect(r.free).toBe(true);
    expect(paid).toBe(ransomOf(p));
    expect(p.chapter).toBeUndefined();
  });

  it("an escape at night with a bribed watchman works; a failed one is punished, and the watch is closer", () => {
    const w = world(1);
    const g = gangOf(w.realm);
    for (const m of gangMembers(w.realm, g.id)) m.greed = 1;
    const p = player();
    maybeTake(w.realm, p, g.id, w.start, 3, seededRng(1));
    p.money = 500;
    expect(captiveAct(w.realm, p, "bribe", 4, 22, () => 0.01).ok).toBe(true);
    expect(captiveAct(w.realm, p, "escape", 4, 23, () => 0.6).free).toBe(true);
    // Another time, no bribe, by day, and bad luck.
    maybeTake(w.realm, p, g.id, w.start, 5, seededRng(1));
    const hp = p.hp;
    const r = captiveAct(w.realm, p, "escape", 6, 12, () => 0);
    expect(r.free).toBe(false);
    expect(p.hp).toBeLessThan(hp);
    expect(p.chapter!.watch).toBe(1);
  });

  it("held long enough, a hero of home may come for them", () => {
    const w = world(1);
    const g = gangOf(w.realm);
    const p = player();
    maybeTake(w.realm, p, g.id, w.start, 3, seededRng(1));
    // A hero of the start town.
    const hero = Object.values(w.realm.figures).find((f) => f.alive && !f.talks)!;
    hero.home = w.start;
    hero.role = "adventurer";
    hero.life.tier = "S";
    let lines: string[] = [];
    for (let d = 8; d <= 40 && p.chapter; d++) lines = captiveDay(w.realm, p, d, seededRng(d));
    expect(p.chapter).toBeUndefined();
    expect(lines.join(" ")).toMatch(/cuts you free/);
    void ({} as Settlement);
  });
});
