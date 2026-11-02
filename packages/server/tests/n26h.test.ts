/**
 * N26H: districts, access and buildings to scale. Every place has the districts its size calls for; buildings are drawn
 * at their real size; people live where their class puts them; and one access rule (`canEnter`) decides who goes where,
 * with posts manned by named guards on a rota and the ways round them: rank, papers, a bribe, sneaking.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { canEnter, districtsOf, FOOTPRINT, type District, type Entrant } from "@millbrook/shared";
import { config } from "../src/config.js";
import { WorldStore } from "../src/game/db.js";
import { seededRng } from "../src/game/dice.js";
import { traitsOfRow } from "../src/game/people/traits.js";
import { generateRealm } from "../src/game/realm/generate.js";
import { pickStartSite } from "../src/game/realm/start.js";
import type { Realm, Settlement } from "../src/game/realm/types.js";
import { guardsOf, offerBribe, onDuty, playerMayEnter, summon, type Post } from "../src/game/town/access.js";
import { materialisePeople } from "../src/store/materialise.js";
import type { PersonRow } from "../src/store/peopleStore.js";
import { districtAt } from "../src/web/districtLayout.js";
import { siteMap, type SiteMap } from "../src/web/sites.js";
import { pickTestPlaces } from "./helpers.js";

vi.setConfig({ testTimeout: 180_000 });
beforeEach(() => {
  config.director = false;
});

const realm1 = generateRealm(1, 1);
const ofKind = (realm: Realm, kind: string) => Object.values(realm.settlements).find((s) => s.kind === kind && !s.way)!;
const mapOf = (realm: Realm, s: Settlement) => siteMap(s, "village", realm);

/** Every walkable tile reachable from a point (doors and gates are walkable). */
function reach(m: SiteMap, from: { x: number; y: number }): Set<string> {
  const seen = new Set([`${from.x},${from.y}`]);
  const q = [from];
  while (q.length) {
    const p = q.shift()!;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const x = p.x + dx;
      const y = p.y + dy;
      const k = `${x},${y}`;
      if (seen.has(k) || x < 0 || y < 0 || x >= m.w || y >= m.h) continue;
      const t = m.tiles[y]![x];
      if (m.isSolid(x, y) && t !== "door") continue;
      seen.add(k);
      q.push({ x, y });
    }
  }
  return seen;
}

describe("N26H step 1: districts", () => {
  it("a hamlet is a green and its farmsteads; a capital has a palace ward, a noble quarter and slums; the same seed, the same districts", () => {
    expect(districtsOf({ kind: "hamlet", name: "X", buildings: {}, terrain: "plains", seat: false }).map((d) => d.kind)).toEqual(["green", "farmsteads"]);
    const cap = ofKind(realm1, "capital");
    const m = mapOf(realm1, cap);
    const kinds = m.districts.map((d) => d.district.kind);
    expect(kinds).toEqual(expect.arrayContaining(["palace", "noble", "slums", "market", "gate"]));
    expect(mapOf(generateRealm(1, 1), ofKind(generateRealm(1, 1), "capital")).districts.map((d) => d.district.id)).toEqual(m.districts.map((d) => d.district.id));
  });

  it("every district of a town, a city and the capital can be reached from the gate (through its gates where it's walled)", () => {
    for (const kind of ["town", "city", "capital"]) {
      const s = ofKind(realm1, kind);
      const m = mapOf(realm1, s);
      const seen = reach(m, m.start);
      for (const r of m.districts) {
        let any = false;
        for (let y = r.y0; y <= r.y1 && !any; y++) for (let x = r.x0; x <= r.x1 && !any; x++) any = seen.has(`${x},${y}`) && !m.isSolid(x, y);
        expect(any, `${kind}: ${r.district.kind}`).toBe(true);
      }
    }
  });
});

describe("N26H step 2: buildings to scale", () => {
  it("a palace's compound is ten times a cottage and more, a hall five; the castle has a bailey and a gatehouse; a cathedral only in the capital", () => {
    const cottage = FOOTPRINT.cottage!.w * FOOTPRINT.cottage!.h;
    const cap = mapOf(realm1, ofKind(realm1, "capital"));
    const palace = cap.buildings.find((b) => b.kind === "palace")!;
    expect(palace.compound!.w * palace.compound!.h).toBeGreaterThanOrEqual(10 * cottage);
    const town = mapOf(realm1, ofKind(realm1, "town"));
    const hall = town.buildings.find((b) => b.kind === "hall")!;
    expect(hall.w * hall.h).toBeGreaterThanOrEqual(5 * cottage);
    expect(cap.buildings.some((b) => b.name === "Cathedral")).toBe(true);
    for (const k of ["town", "city"]) expect(mapOf(realm1, ofKind(realm1, k)).buildings.some((b) => b.name === "Cathedral")).toBe(false);
    // A castle where a lord sits: a keep in a walled bailey, with a gate.
    const city = Object.values(realm1.settlements).find((s) => s.kind === "city" && mapOf(realm1, s).buildings.some((b) => b.kind === "castle"));
    if (city) {
      const castle = mapOf(realm1, city).buildings.find((b) => b.kind === "castle")!;
      expect(castle.compound!.w).toBeGreaterThan(castle.w);
      const g = castle.compound!.gate;
      expect(mapOf(realm1, city).tiles[g.y]![g.x]).toBe("door");
    }
  });
});

describe("N26H steps 3–5: homes, access and the ways in", () => {
  const world = () => {
    const realm = generateRealm(1, 1);
    const store = new WorldStore(":memory:");
    materialisePeople(realm, store.people, 1);
    return { realm, store, ...pickTestPlaces(realm, pickStartSite(realm, realm.seed)) };
  };

  it("in the bigger places nobles live in the noble quarter or the castle, and no slave or serf has a house of their own outside the poor end, the slums or the farmsteads", () => {
    const { realm, store } = world();
    for (const s of Object.values(realm.settlements).filter((x) => (x.kind === "city" || x.kind === "capital") && !x.way)) {
      const m = mapOf(realm, s);
      const rows = (store.people.loadSite(s.id, "full") as PersonRow[]).filter((r) => r.death === null && r.home !== null && r.home < m.buildings.length);
      for (const r of rows) {
        const b = m.buildings[r.home!]!;
        if (r.cls === "noble" && b.kind === "manor") expect(["d:noble", "d:castle", "d:palace", "d:high_street", "d:market", "d:cathedral", "d:craft"]).toContain(b.district);
        if ((r.cls === "slave" || r.cls === "serf") && !r.master_id && b.kind === "house") expect(["d:poor_end", "d:slums", "d:farmsteads"], `${r.cls} in ${b.district}`).toContain(b.district);
      }
      const nobles = rows.filter((r) => r.cls === "noble" && m.buildings[r.home!]!.kind === "manor");
      if (nobles.length > 0) expect(nobles.filter((r) => ["d:noble", "d:castle", "d:palace"].includes(m.buildings[r.home!]!.district!)).length / nobles.length).toBeGreaterThan(0.5);
    }
  });

  it("a commoner is turned back at the noble quarter's gate; summoned, they're let in that day and not the next", () => {
    const cap = ofKind(realm1, "capital");
    const noble = mapOf(realm1, cap).districts.find((r) => r.district.kind === "noble")!.district;
    const p = { factions: [], papers: [] } as never as Parameters<typeof playerMayEnter>[0];
    expect(playerMayEnter(p, noble, 5, 12).ok).toBe(false);
    expect(playerMayEnter(p, noble, 5, 12).why).toMatch(/gentry/);
    summon(p, noble, 5, "fig-1");
    expect(playerMayEnter(p, noble, 5, 12).ok).toBe(true);
    expect(playerMayEnter(p, noble, 6, 12).ok).toBe(false);
    // Gentry go in by rank.
    p.cls = "gentry";
    expect(playerMayEnter(p, noble, 6, 12).ok).toBe(true);
  });

  it("a home opens to kin and friends, to acquaintances by day, never to strangers; the temple close is open by day and shut at night", () => {
    const home = { id: "h", name: "the Reeds' house", access: { level: "private" as const } };
    const who = (warmth?: number): Entrant => ({ cls: "commoner", job: "labourer", belongs: [], papers: [], ...(warmth !== undefined ? { warmth } : {}) });
    expect(canEnter(who(60), home, 1, 23).ok).toBe(true);
    expect(canEnter(who(20), home, 1, 12).ok).toBe(true);
    expect(canEnter(who(20), home, 1, 23).ok).toBe(false);
    expect(canEnter(who(), home, 1, 12).ok).toBe(false);
    const close = districtsOf({ kind: "town", name: "X", buildings: { temple: 1 }, terrain: "plains", seat: false }).find((d) => d.kind === "temple_close")!;
    expect(canEnter(who(), close, 1, 12).ok).toBe(true);
    expect(canEnter(who(), close, 1, 23).ok).toBe(false);
  });

  it("who is on a gate is a named guard from the rota, different by the watch; with no guards left, the post stands empty", () => {
    const { realm, store } = world();
    const cap = ofKind(realm, "capital");
    const m = mapOf(realm, cap);
    const posts: Post[] = m.gates.map((g) => ({ id: `post:${cap.id}:${g.x},${g.y}`, site: cap.id, district: g.district, x: g.x, y: g.y }));
    const palaceGate = posts.find((p) => p.district === "d:palace") ?? posts[0]!;
    const night = onDuty(store, palaceGate, posts, 3, 2)!;
    const noon = onDuty(store, palaceGate, posts, 3, 12)!;
    expect(night.job).toBe("guard");
    expect(night.id).not.toBe(noon.id);
    for (const g of guardsOf(store, cap.id, 3)) store.people.update(g.id, { away: JSON.stringify({ journey: "war", since: 0, purpose: "war", returns: true }) });
    expect(onDuty(store, palaceGate, posts, 3, 2)).toBeNull();
  });

  it("a greedy guard on the night watch takes a bribe; a loyal one refuses and the briber is sentenced", () => {
    const { realm, store } = world();
    const cap = ofKind(realm, "capital");
    const m = mapOf(realm, cap);
    const posts: Post[] = m.gates.map((g) => ({ id: `post:${cap.id}:${g.x},${g.y}`, site: cap.id, district: g.district, x: g.x, y: g.y }));
    const post = posts.find((p) => p.district === "d:noble")!;
    const d = m.districts.find((r) => r.district.id === post.district)!.district as District;
    const guard = onDuty(store, post, posts, 4, 23)!;
    const greedy = () => store.people.update(guard.id, { traits: JSON.stringify({ ...traitsOfRow(guard), greed: 1, loyalty: 0 }) });
    const loyal = () => store.people.update(guard.id, { traits: JSON.stringify({ ...traitsOfRow(guard), greed: 0, loyalty: 1 }) });
    greedy();
    const p = { name: "Tester", money: 1000, hp: 30, maxHp: 30, factions: [], papers: [] } as never as Parameters<typeof offerBribe>[2];
    const r = offerBribe(realm, store, p, post, posts, d, 4, 23, seededRng(1));
    expect(r.ok).toBe(true);
    expect(playerMayEnter(p, d, 4, 23).ok).toBe(true);
    expect(store.eventsAbout(guard.id).some((e) => e.kind === "bribe")).toBe(true);
    loyal();
    const r2 = offerBribe(realm, store, p, post, posts, d, 5, 23, seededRng(1));
    expect(r2.ok).toBe(false);
    expect(r2.lines.join(" ")).toMatch(/calls for the watch/);
    expect(p.sentences?.some((s) => s.crime === "bribery")).toBe(true);
    void districtAt;
  });
});
