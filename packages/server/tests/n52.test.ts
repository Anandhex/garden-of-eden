import { beforeEach, describe, expect, it, vi } from "vitest";
import { config } from "../src/config.js";
import { adjustRel } from "../src/game/chatter/rel.js";
import { hateOn } from "../src/game/chatter/grievance.js";
import { WorldStore } from "../src/game/db.js";
import { describeKnown } from "../src/game/gossip/describe.js";
import { sociability } from "../src/game/gossip/venues.js";
import { playerCases } from "../src/game/law/player.js";
import { justiceDay } from "../src/game/law/justice.js";
import type { LifeCtx } from "../src/game/people/step.js";
import { advanceWorld } from "../src/game/people/world.js";
import { generateRealm } from "../src/game/realm/generate.js";
import { pickStartSite } from "../src/game/realm/start.js";
import { believers, frame, payVoice, plant, playerPlants, rumourRef, rumoursDay, walkTrail, type FabricationData } from "../src/game/shaping/rumours.js";
import type { PlayerState } from "../src/npc/types.js";
import type { PersonRow } from "../src/store/peopleStore.js";
import { materialisePeople } from "../src/store/materialise.js";

/**
 * N52: shaping what people believe. A rumour whispered to a gossip spreads by N33's rules and drifts; believed, it moves feelings; believed
 * by enough, the watch investigates and walks the tellers back; found out, the subject's grudge and a slander case. Framing, paid voices.
 */
vi.setConfig({ testTimeout: 300_000, hookTimeout: 300_000 });

beforeEach(() => {
  config.peopleLazy = "";
  config.realm = true;
  config.realmSeed = undefined;
  config.gossip = true;
});

/** A village (small enough that half of it is a few dozen people), living. */
function world(seed = 1) {
  const realm = generateRealm(seed, 1);
  const store = new WorldStore(":memory:");
  materialisePeople(realm, store.people, 1);
  const start = pickStartSite(realm, realm.seed);
  const village = [start, ...realm.settlements[start]!.roads].map((id) => realm.settlements[id]!).filter((s) => !s.way && (s.kind === "village" || s.kind === "hamlet") && s.leader).sort((a, b) => a.population - b.population)[0] ?? realm.settlements[start]!;
  const live = new Set([village.id]);
  const ctx: LifeCtx = { realm, store };
  advanceWorld(realm, store, 2, { live });
  return { realm, store, live, ctx, site: village.id };
}
type W = ReturnType<typeof world>;
const grown = (w: W) => (w.store.people.loadSite(w.site, "full") as PersonRow[]).filter((r) => r.death === null && r.job !== "child");
const player = (): PlayerState => ({ name: "Wren", money: 500, hp: 20, maxHp: 20 }) as unknown as PlayerState;

describe("N52 steps 1–2: planted and spreading", () => {
  it("whispered to a gossipy stallholder, 'the mayor stole the tax money' reaches half the village in three days, in several versions", () => {
    const w = world(1);
    const day = w.realm.day + 1;
    const rows = grown(w);
    const gossip = [...rows].sort((a, b) => sociability(b.id) - sociability(a.id))[0]!;
    const head = w.realm.figures[w.realm.settlements[w.site]!.leader!]!;
    const p = player();
    playerPlants(w.ctx, p, gossip, { id: head.id, name: head.name }, "stole", day, "the tax money");
    const f = w.store.records.open<FabricationData>("fabrication")[0]!;
    // The truth view knows it's made up; the stallholder believes it.
    expect(f.data.by).toBe("player");
    expect(w.store.knowledge.get(gossip.id, rumourRef(f.id))!.accuracy).toBeGreaterThanOrEqual(0.5);
    advanceWorld(w.realm, w.store, day + 3, { live: w.live });
    const holders = w.store.knowledge.holders(rumourRef(f.id));
    expect(holders.length).toBeGreaterThanOrEqual(rows.length / 2);
    const versions = new Set(holders.map((k) => describeKnown(w.ctx, k.ref, k.accuracy, k.variant)));
    expect(versions.size).toBeGreaterThanOrEqual(2);
    expect([...versions].some((v) => v?.includes("stole"))).toBe(true);
  });
});

describe("N52 steps 3–4: investigation and getting caught", () => {
  it("the captain investigates once enough believe it; found out, the mayor has a grudge and the law a case", () => {
    const w = world(1);
    const day = w.realm.day + 1;
    const rows = grown(w);
    const head = w.realm.figures[w.realm.settlements[w.site]!.leader!]!;
    const p = player();
    const first = rows[0]!;
    const f = plant(w.ctx, { by: "player", byName: p.name, listener: first, subject: head.id, subjectName: head.name, claim: "stole", detail: "the tax money", site: w.site, day });
    // Most of the place believe it, told by the first one told.
    for (const r of rows.slice(1)) w.store.knowledge.put({ who: r.id, ref: rumourRef(f.id), learned_day: day, source: first.id, accuracy: 0.8, variant: 0 });
    rumoursDay(w.ctx, w.site, day, p);
    const rec = w.store.records.get<FabricationData>(f.id)!;
    expect(rec.data.investigated).toBeDefined();
    expect(w.store.eventsAt(w.site, day, ["investigation"]).length).toBe(1);
    // Believers think less of the mayor.
    expect(w.store.social.rel(rows[3]!.id, head.id)!.trust).toBeLessThan(0);
    if (rec.data.investigated!.found === "player") {
      expect(hateOn(w.store, head.id, "player", day)).toBeGreaterThan(0.5);
      expect(playerCases(w.ctx).some((c) => c.includes("slander"))).toBe(true);
    }
  });

  it("the trail reaches the player on one seed; a friend who shields them stops it on another", () => {
    const w = world(1);
    const day = w.realm.day + 1;
    const rows = grown(w);
    const head = w.realm.figures[w.realm.settlements[w.site]!.leader!]!;
    let reached = 0;
    for (let i = 0; i < 12; i++) {
      const first = rows[i]!;
      const f = plant(w.ctx, { by: "player", byName: "Wren", listener: first, subject: head.id, subjectName: head.name, claim: "stole", site: w.site, day: day + i, key: `t${i}` });
      w.store.knowledge.put({ who: rows[rows.length - 1 - i]!.id, ref: rumourRef(f.id), learned_day: day, source: first.id, accuracy: 0.8, variant: 0 });
      if (walkTrail(w.ctx, f, [rows[rows.length - 1 - i]!.id], day + i).origin === "player") reached++;
    }
    expect(reached).toBeGreaterThan(0);
    // A first teller fond of the player shields them.
    const friend = rows[rows.length - 14]!;
    adjustRel(w.store, friend.id, "player", { affection: 80 }, day);
    const f = plant(w.ctx, { by: "player", byName: "Wren", listener: friend, subject: head.id, subjectName: head.name, claim: "stole", site: w.site, day, key: "friend" });
    w.store.knowledge.put({ who: rows[rows.length - 15]!.id, ref: rumourRef(f.id), learned_day: day, source: friend.id, accuracy: 0.8, variant: 0 });
    const r = walkTrail(w.ctx, f, [rows[rows.length - 15]!.id], day);
    expect(r.origin).toBeNull();
    expect(r.shielded).toBe(friend.id);
  });
});

describe("N52 steps 5–6: framing, paid voices, factions", () => {
  it("framing a merchant with goods in their house and a bribed witness opens a case against them, or turns on the framer", () => {
    const w = world(1);
    const day = w.realm.day + 1;
    const rows = grown(w);
    const target = rows.find((r) => r.cls === "merchant" || r.cls === "artisan") ?? rows[0]!;
    let against = 0;
    let turned = 0;
    for (const witness of rows.filter((r) => r.id !== target.id).slice(0, 30)) {
      const p = player();
      const r = frame(w.ctx, p, target, witness, 150, day + rows.indexOf(witness));
      if (r.ok) against++;
      else if (r.caseId) turned++;
    }
    expect(against).toBeGreaterThan(0);
    expect(turned).toBeGreaterThan(0);
    // A framed case is tried with the planted goods as evidence.
    justiceDay(w.realm, w.store, w.site, day + 40);
    expect(w.store.records.list("case", (c) => (c.data as { planted?: boolean }).planted === true && c.ended !== null).length).toBeGreaterThan(0);
  });

  it("a paid sermon reaches the faithful; a rumour about a guild lowers another faction's regard for it", () => {
    const w = world(1);
    const day = w.realm.day + 1;
    const rows = grown(w);
    const priest = rows.find((r) => r.cls === "clergy" || r.job === "priest") ?? rows[1]!;
    const subject = rows[2]!;
    const p = player();
    const lines = payVoice(w.ctx, p, "priest", priest, { subject: subject.id, subjectName: subject.name, claim: "heretic" }, w.site, day);
    if (/takes your coin/.test(lines[0]!)) {
      const f = w.store.records.open<FabricationData>("fabrication")[0]!;
      expect(w.store.knowledge.holders(rumourRef(f.id)).length).toBeGreaterThan(3);
    } else expect(lines[0]).toMatch(/won't/);
    // A faction rumoured against: members of others who believe it think less of it.
    const facs = Object.values(w.realm.factions).filter((x) => x.dissolved === undefined && x.kind !== "crown");
    const [a, b] = [facs[0]!, facs[1]!];
    const member = rows[5]!;
    w.store.people.update(member.id, { faction: a.id });
    const before = a.stances[b.id] ?? 0;
    const f = plant(w.ctx, { by: "player", byName: "Wren", listener: member, subject: b.id, subjectName: b.name, claim: "hoards", site: w.site, day, key: "fac" });
    w.store.knowledge.put({ who: member.id, ref: rumourRef(f.id), learned_day: day, source: "player", accuracy: 0.9, variant: 0 });
    rumoursDay(w.ctx, w.site, day);
    expect(believers(w.ctx, f.id)).toContain(member.id);
    expect(a.stances[b.id] ?? 0).toBeLessThan(before);
  });
});
