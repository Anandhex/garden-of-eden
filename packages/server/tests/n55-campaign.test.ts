import { beforeEach, describe, expect, it } from "vitest";
import { config } from "../src/config.js";
import { declareWar, front } from "../src/game/realm/diplomacy.js";
import { generateRealm } from "../src/game/realm/generate.js";
import type { Realm, War } from "../src/game/realm/types.js";
import { armiesRealmDay, peekArmies, soldiersSiteDay, type SoldierData } from "../src/game/war/armies.js";
import { WorldStore } from "../src/game/db.js";
import { parseDeath } from "../src/game/people/death.js";
import type { LifeCtx } from "../src/game/people/step.js";
import { pickStartSite } from "../src/game/realm/start.js";
import { materialisePeople } from "../src/store/materialise.js";
import { attackerReady, campaignDay, campOfArmy, sideMod, STARVED, starvedOut, SUPPLY_MAX } from "../src/game/war/campaign.js";

/**
 * N55 step 2: armies on the map. Realm-only (no people file), so fast: an army musters, marches on the front a day's pace at a time and
 * camps; it eats its wagons and draws on its own places; an attacker before walls lays siege, and a place that eats its stores gives in.
 */
beforeEach(() => {
  config.peopleLazy = "";
  config.realm = true;
  config.realmSeed = undefined;
  config.society.armies = true;
});

function war(seed = 1): { realm: Realm; w: War } {
  const realm = generateRealm(seed, 1);
  const [a, b] = Object.keys(realm.kingdoms).sort();
  const w = declareWar(realm, [`k:${a}`], [`k:${b}`], 3, "a test war");
  return { realm, w };
}
const attackerArmy = (realm: Realm, w: War) => peekArmies(realm).find((x) => x.war === w.id && x.side === "attackers")!;

describe("N55 step 2: marching, camps and supply", () => {
  it("an army musters at its seat, marches on the front day by day, and arrives; battles wait for it", () => {
    const { realm, w } = war();
    armiesRealmDay(realm, 3);
    const a = attackerArmy(realm, w);
    expect(a).toBeDefined();
    const c = campOfArmy(a)!;
    const home = realm.settlements[c.muster]!;
    expect(c.pos).toEqual(home.pos);
    expect(c.last).toMatch(/mustering/);
    expect(attackerReady(realm, w)).toBe(false);
    const field = front(realm, w, 5)!;
    const dist = () => Math.hypot(c.pos.x - field.pos.x, c.pos.y - field.pos.y);
    let before = dist();
    let day = 4;
    for (; day < 40 && !c.arrived; day++) {
      armiesRealmDay(realm, day);
      if (a.status !== "mustering" && !c.arrived) {
        expect(dist()).toBeLessThan(before);
        expect(c.last).toMatch(/marching on|camped/);
      }
      before = dist();
    }
    expect(c.arrived).toBe(true);
    expect(c.pos).toEqual(field.pos);
    expect(attackerReady(realm, w)).toBe(true);
    expect(realm.news.some((n) => n.kind === "war" && n.text.includes("has reached"))).toBe(true);
  });

  it("an army eats a day's food each day, draws on its own places, and goes hungry with nothing to draw on", () => {
    const { realm, w } = war();
    for (let d = 3; d <= 6; d++) armiesRealmDay(realm, d);
    const a = attackerArmy(realm, w);
    const c = campOfArmy(a)!;
    // Near its own seat, with stores: it keeps its wagons full, and the place's stores fall.
    const home = realm.settlements[c.muster]!;
    c.pos = { ...home.pos };
    c.arrived = true;
    c.supply = 4;
    home.food = 80;
    campaignDay(realm, 7, () => null);
    expect(c.supply).toBe(6);
    expect(home.food).toBeLessThan(80);
    // Far from anyone, with empty wagons: hunger, and the army fights worse.
    const good = sideMod(realm, w, "attackers");
    c.pos = { x: -10_000, y: -10_000 };
    c.supply = 0;
    const m0 = c.morale;
    for (let d = 8; d <= 12; d++) campaignDay(realm, d, () => null);
    expect(c.supply).toBe(0);
    expect(c.morale).toBeLessThan(m0);
    expect(sideMod(realm, w, "attackers")).toBeLessThan(good);
    expect(c.supply).toBeLessThanOrEqual(SUPPLY_MAX);
  });
});

describe("N55 step 2: sieges", () => {
  it("an attacker before walls besieges the place; it eats its stores and gives in when they're gone", () => {
    const { realm, w } = war();
    for (let d = 3; d <= 5; d++) armiesRealmDay(realm, d);
    const a = attackerArmy(realm, w);
    const c = campOfArmy(a)!;
    const field = front(realm, w, 6)!;
    field.buildings.walls = 2;
    field.food = STARVED + 5;
    c.pos = { ...field.pos };
    c.arrived = true;
    campaignDay(realm, 6, () => field);
    expect(c.siege?.site).toBe(field.id);
    expect(a.status).toBe("fighting");
    expect(realm.news.some((n) => n.kind === "siege" && n.at === field.id)).toBe(true);
    expect(starvedOut(realm, w)).toBeNull();
    let d = 7;
    while (field.food >= STARVED && d < 20) campaignDay(realm, d++, () => field);
    expect(field.food).toBeLessThan(STARVED);
    expect(starvedOut(realm, w)?.id).toBe(field.id);
  });

  it("with ARMIES off nothing moves and battles don't wait", () => {
    const { realm, w } = war();
    config.society.armies = false;
    armiesRealmDay(realm, 3);
    expect(peekArmies(realm)).toHaveLength(0);
    expect(attackerReady(realm, w)).toBe(true);
    expect(sideMod(realm, w, "attackers")).toBe(1);
  });
});

describe("N55 steps 1, 3–4: who goes, and what battles make of them", () => {
  it("knights and volunteers go first, then the levy; battles make heroes, deserters and prisoners; officers become names; the peace sends them home", () => {
    const realm = generateRealm(1, 1);
    const store = new WorldStore(":memory:");
    materialisePeople(realm, store.people, 1);
    const ctx: LifeCtx = { realm, store };
    const start = pickStartSite(realm, realm.seed);
    const mine = realm.settlements[start]!.kingdom!;
    const foe = Object.keys(realm.kingdoms).find((k) => k !== mine)!;
    const w = declareWar(realm, [`k:${foe}`], [`k:${mine}`], 3, "a test war");
    armiesRealmDay(realm, 3);
    const a = peekArmies(realm).find((x) => x.war === w.id && x.party === `k:${mine}`)!;
    a.levy[start] = 40;
    const first = soldiersSiteDay(ctx, { site: start, deaths: [] }, 3);
    const sols = () => store.records.list<SoldierData>("soldier", (s) => s.data.war === w.id && s.site === start);
    expect(first.levied.length + first.volunteered.length).toBe(sols().length);
    expect(first.levied.length).toBeGreaterThan(0);
    // Volunteers and knights are the first on the roll, ahead of anyone levied.
    for (const s of sols().filter((x) => x.data.how !== "levy")) expect(["soldier", "sergeant"]).toContain(s.data.rank);
    // Twelve battles, the defenders losing every other one.
    for (let d = 4; d <= 15; d++) w.battles.push({ day: d, at: start, winner: d % 2 ? "attackers" : "defenders", losses: 0, text: "" });
    const after = soldiersSiteDay(ctx, { site: start, deaths: [] }, 16);
    const by = (st: string) => sols().filter((s) => s.data.status === st);
    expect(by("serving").length + by("deserted").length + by("captured").length + sols().filter((s) => s.data.status === "dead").length).toBe(sols().length);
    expect(after.deserted.length).toBeGreaterThan(0);
    expect(after.promoted.length).toBeGreaterThan(0);
    // Twelve battles: the survivors are lieutenants or better, and each is a name in the realm.
    const officers = by("serving").filter((s) => ["lieutenant", "captain"].includes(s.data.rank));
    expect(officers.length).toBeGreaterThan(0);
    for (const s of officers) expect(realm.figures[`fig-s-${s.a}`]?.person).toBe(s.a);
    // The deserters are home (or hanged under a heavy levy, on the roll).
    for (const id of after.deserted) {
      const r = store.people.get(id)!;
      if (r.death === null) expect(r.away).toBeNull();
      else expect(parseDeath(r.death)?.cause).toBe("execution");
    }
    // The peace: the serving come home changed, the prisoners are exchanged.
    const taken = by("captured").map((s) => s.a!);
    w.end = 17;
    w.winner = "attackers";
    const home = soldiersSiteDay(ctx, { site: start, deaths: [] }, 18);
    expect(by("serving")).toHaveLength(0);
    for (const id of taken) expect(home.home).toContain(id);
    expect(store.records.list("prisoner", (p) => p.status === "held")).toHaveLength(0);
  });
});
