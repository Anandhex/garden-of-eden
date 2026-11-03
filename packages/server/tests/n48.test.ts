import { beforeEach, describe, expect, it, vi } from "vitest";
import { config } from "../src/config.js";
import { addGrievance } from "../src/game/chatter/grievance.js";
import { temperOf as rowTemper } from "../src/game/chatter/person.js";
import { choiceDay } from "../src/game/choice/day.js";
import { WorldStore } from "../src/game/db.js";
import { seededRng } from "../src/game/dice.js";
import { justiceDay } from "../src/game/law/justice.js";
import { breakOut, bribeJudge, openPlayerCase, tryPlayer } from "../src/game/law/player.js";
import { judgeOf, lawBook, sentence, type SentenceKind } from "../src/game/law/sentence.js";
import { jail, jailedNow, verdictOf, wordWeight } from "../src/game/law/trial.js";
import type { LifeCtx } from "../src/game/people/step.js";
import { advanceWorld } from "../src/game/people/world.js";
import { generateRealm } from "../src/game/realm/generate.js";
import { policyOf, setPolicy } from "../src/game/realm/policy.js";
import type { PlayerState } from "../src/npc/types.js";
import type { PersonRow } from "../src/store/peopleStore.js";
import { materialisePeople } from "../src/store/materialise.js";
import { pickTestPlaces } from "./helpers.js";

/**
 * N48: law and trials. Each kingdom's law book (policies), trials that weigh witnesses by class, sentences by the book, pardons, jail and
 * breaking out, false accusations turned to slander, and a player who bribes a judge.
 */
vi.setConfig({ testTimeout: 240_000, hookTimeout: 240_000 });

beforeEach(() => {
  config.peopleLazy = "";
  config.realm = true;
  config.realmSeed = undefined;
  config.society.trials = true;
  config.choice.only = [];
});

function world(seed = 1) {
  const realm = generateRealm(seed, 1);
  const store = new WorldStore(":memory:");
  materialisePeople(realm, store.people, 1);
  const { start, liege } = pickTestPlaces(realm);
  const live = new Set([start, liege]);
  const ctx: LifeCtx = { realm, store };
  advanceWorld(realm, store, 2, { live });
  return { realm, store, live, ctx, start, liege };
}
type W = ReturnType<typeof world>;
const grown = (w: W, site: string) => (w.store.people.loadSite(site, "full") as PersonRow[]).filter((r) => r.death === null && !r.away && r.job !== "child");
const SEVERITY: Record<SentenceKind, number> = { fine: 1, stocks: 2, lockup: 3, flogging: 4, banished: 5, bounty: 5, hanging: 6 };

describe("N48 step 1: the law book", () => {
  it("the slave kingdom and the free kingdom have different law books", () => {
    let differs = 0;
    for (const seed of [1, 2, 3, 4, 5]) {
      const realm = generateRealm(seed, 1);
      const ks = Object.values(realm.kingdoms);
      const slave = ks.find((k) => k.laws.slavery);
      const free = ks.find((k) => !k.laws.slavery && !k.laws.serfdom);
      if (!slave || !free) continue;
      const a = [policyOf(realm, slave.id, "punishments"), policyOf(realm, slave.id, "class_weight")];
      const b = [policyOf(realm, free.id, "punishments"), policyOf(realm, free.id, "class_weight")];
      if (a.join() !== b.join()) differs++;
      // A slave kingdom's words never weigh more equally than a free kingdom's.
      const order = ["equal", "some", "strong"];
      expect(order.indexOf(a[1]!)).toBeGreaterThanOrEqual(order.indexOf(b[1]!));
    }
    expect(differs).toBeGreaterThan(0);
  });
});

describe("N48 step 4: sentences by the book", () => {
  it("a serf who stole bread is sentenced harshly where the law is harsh and lightly in the free kingdom", () => {
    const realm = generateRealm(1, 1);
    const ks = Object.values(realm.kingdoms);
    const harshK = ks.find((k) => k.laws.serfdom || k.laws.slavery)!;
    const freeK = ks.find((k) => !k.laws.slavery && !k.laws.serfdom)!;
    setPolicy(realm, harshK.id, "punishments", "harsh", 1, "test");
    setPolicy(realm, harshK.id, "class_weight", "strong", 1, "test");
    setPolicy(realm, freeK.id, "punishments", "lenient", 1, "test");
    const at = (k: string) => Object.values(realm.settlements).find((s) => s.kingdom === k && s.leader)!.id;
    const avg = (place: string) => {
      let sum = 0;
      for (let i = 0; i < 40; i++) sum += SEVERITY[sentence(realm, { kind: "person", id: "t_x_1", name: "Ada Serf", cls: "serf" }, "petty_theft", place, 5, seededRng(i)).kind];
      return sum / 40;
    };
    expect(lawBook(realm, at(harshK.id), 5).harsh).toBeGreaterThan(0);
    expect(avg(at(harshK.id))).toBeGreaterThan(avg(at(freeK.id)) + 0.5);
  });
});

describe("N48 step 3: evidence and the verdict", () => {
  it("a noble accused by a commoner walks free unless the witnesses are many", () => {
    const w = world(1);
    const day = w.realm.day + 1;
    setPolicy(w.realm, w.realm.settlements[w.liege]!.kingdom!, "class_weight", "strong", day, "test");
    const rows = grown(w, w.liege);
    const noble = rows.find((r) => r.cls === "noble" || r.cls === "gentry")!;
    const commoners = rows.filter((r) => r.cls === "commoner" && r.job !== "guard" && (w.store.social.rel(r.id, noble.id)?.affection ?? 0) <= 0).slice(0, 8);
    const one = verdictOf(w.ctx, { id: "c1", crime: "assault", accused: noble, witnesses: commoners.slice(0, 1), place: w.liege, day });
    expect(one.guilty).toBe(false);
    const many = verdictOf(w.ctx, { id: "c2", crime: "assault", accused: noble, witnesses: commoners, place: w.liege, day });
    expect(many.guilty).toBe(true);
    // The weights are the book's: a noble's word is worth several commoners'.
    expect(wordWeight(w.realm, w.liege, noble.cls, day)).toBeGreaterThan(2 * wordWeight(w.realm, w.liege, "commoner", day));
    expect(one.parts.some(([p]) => /own word/.test(p))).toBe(true);
  });

  it("the player bribes a judge and it works; with an honest judge they are charged for it", () => {
    const w = world(1);
    const day = w.realm.day + 1;
    const judge = judgeOf(w.realm, w.liege)!;
    const p = { name: "Wren", money: 1000, hp: 30, maxHp: 30 } as unknown as PlayerState;
    judge.greed = 0.95;
    judge.loyalty = 0.2;
    const c1 = openPlayerCase(w.ctx, p, "theft", w.liege, day, [grown(w, w.liege)[0]!.id]);
    const r1 = bribeJudge(w.ctx, p, c1, 200, day);
    expect(r1.ok).toBe(true);
    expect(w.store.records.get(c1)!.status).toBe("dropped");
    // Now an honest one.
    judge.greed = 0.1;
    judge.loyalty = 0.9;
    const c2 = openPlayerCase(w.ctx, p, "theft", w.liege, day + 1, [grown(w, w.liege)[0]!.id]);
    const r2 = bribeJudge(w.ctx, p, c2, 200, day + 1);
    expect(r2.ok).toBe(false);
    expect(r2.lines[0]).toMatch(/bribery/);
    expect((p.sentences ?? []).some((s) => s.crime === "bribery")).toBe(true);
  });

  it("the player's own case is tried by the same weights", () => {
    const w = world(1);
    const day = w.realm.day + 1;
    const guard = grown(w, w.liege).find((r) => r.job === "guard")!;
    const p = { name: "Wren", money: 1000, hp: 30, maxHp: 30 } as unknown as PlayerState;
    const c = openPlayerCase(w.ctx, p, "petty_theft", w.liege, day, [guard.id]);
    const r = tryPlayer(w.ctx, p, c, day);
    expect(r.verdict.guilty).toBe(true);
    expect(r.sentence).toBeDefined();
  });
});

describe("N48 step 5: prisons", () => {
  it("a prisoner broken out is free and the breaker has a case", () => {
    const w = world(1);
    const day = w.realm.day + 1;
    const prisoner = grown(w, w.liege)[3]!;
    jail(w.store, prisoner, day + 5, day, "theft");
    expect(jailedNow(w.store, prisoner.id, day)).toBeDefined();
    const p = { name: "Wren", money: 0 } as unknown as PlayerState;
    let cased = false;
    for (let h = 0; h < 24 && !cased; h++) {
      jail(w.store, prisoner, day + 5, day + h * 0, "theft");
      w.store.records.put({ id: `jail:${prisoner.id}:${day}`, kind: "jail", site: prisoner.site, a: prisoner.id, b: null, since: day, status: "held", ended: null, data: { until: day + 5, why: "theft" } });
      breakOut(w.ctx, p, prisoner, day, h);
      expect(jailedNow(w.store, prisoner.id, day)).toBeUndefined();
      cased = (p.society?.cases ?? []).some((c: string) => c.includes("aiding_escape"));
    }
    expect(cased).toBe(true);
  });
});

describe("N48 step 6: false accusation", () => {
  it("a false accusation with thin evidence turns into a slander case against the accuser", () => {
    const w = world(1);
    const day = w.realm.day + 1;
    setPolicy(w.realm, w.realm.settlements[w.liege]!.kingdom!, "class_weight", "some", day, "test");
    const rows = grown(w, w.liege).filter((r) => r.cls === "commoner" && r.job !== "guard");
    // Someone dishonest with a grudge.
    const dishonest = rows.filter((r) => rowTemper(r).honesty < 0.35);
    expect(dishonest.length).toBeGreaterThan(1);
    const [a, b] = [dishonest[0]!, rows.find((r) => r.id !== dishonest[0]!.id)!];
    addGrievance(w.store, { who: a.id, against: b.id, cause: "test", weight: 1.4, day });
    config.choice.only = ["accuse"];
    choiceDay(w.ctx, { site: w.liege }, day);
    const ev = w.store.eventsAt(w.liege, day, ["accusation"]).find((e) => e.actor === a.id);
    expect(ev).toBeDefined();
    justiceDay(w.realm, w.store, w.liege, day);
    const c = w.store.records.get<{ verdict: string }>(`case:${ev!.id}`)!;
    expect(c.ended).not.toBeNull();
    if (c.data.verdict !== "guilty") {
      expect(w.store.eventsAt(w.liege, day, ["sentence"]).some((e) => e.actor === a.id && /slander/.test(e.details))).toBe(true);
    }
  });
});

