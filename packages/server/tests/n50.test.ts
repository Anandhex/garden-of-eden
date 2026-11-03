import { beforeEach, describe, expect, it, vi } from "vitest";
import { config } from "../src/config.js";
import { menuFor } from "../src/game/choice/registry.js";
import type { ChoiceCtx, Other } from "../src/game/choice/types.js";
import { WorldStore } from "../src/game/db.js";
import { faithRealmDay, faithSiteDay, readOmen } from "../src/game/faith/day.js";
import { beliefCell, beliefOf, ensureFaiths, faithFactions, faithOf, faithOfPlace, peekFaith } from "../src/game/faith/model.js";
import { justiceDay } from "../src/game/law/justice.js";
import type { LifeCtx } from "../src/game/people/step.js";
import { advanceWorld } from "../src/game/people/world.js";
import { generateRealm } from "../src/game/realm/generate.js";
import { decidePolicy, policyOf, policyRealmDay, setPolicy } from "../src/game/realm/policy.js";
import type { PersonRow } from "../src/store/peopleStore.js";
import { materialisePeople } from "../src/store/materialise.js";
import { pickTestPlaces } from "./helpers.js";

/**
 * N50: belief. Faiths with tenets, everyone's faith and devotion, tenets weighing on choices, a cult that spreads by missionaries and is
 * persecuted where heresy is hunted, omens read by court seers that change a ruler's decision, and pilgrims at a faith's festival.
 */
vi.setConfig({ testTimeout: 300_000, hookTimeout: 300_000 });

beforeEach(() => {
  config.peopleLazy = "";
  config.realm = true;
  config.realmSeed = undefined;
  config.society.belief = true;
});

function world(seed = 1, days = 2) {
  const realm = generateRealm(seed, 1);
  const store = new WorldStore(":memory:");
  materialisePeople(realm, store.people, 1);
  const { start, liege } = pickTestPlaces(realm);
  const live = new Set([start, liege]);
  const ctx: LifeCtx = { realm, store };
  advanceWorld(realm, store, days, { live });
  return { realm, store, live, ctx, start, liege };
}
type W = ReturnType<typeof world>;
const living = (w: W, site: string) => (w.store.people.loadSite(site, "full") as PersonRow[]).filter((r) => r.death === null);

describe("N50 step 1: faiths and people's faith", () => {
  it("each kingdom has a church and the realm has cults, each with a creed of tenets; everyone has a faith, mostly their place's", () => {
    const w = world(1, 3);
    const st = peekFaith(w.realm)!;
    const facs = faithFactions(w.realm);
    expect(facs.some((f) => f.kind === "order")).toBe(true);
    expect(facs.some((f) => f.kind === "cult")).toBe(true);
    for (const f of facs) {
      expect(st.faiths[f.id]!.tenets.length).toBe(2);
      expect(f.creed.length).toBeGreaterThan(5);
    }
    for (const site of [w.start, w.liege]) {
      const rows = living(w, site);
      expect(rows.every((r) => beliefOf(r) !== null)).toBe(true);
      const home = faithOfPlace(w.realm, site)!;
      expect(rows.filter((r) => beliefOf(r)!.faith === home).length / rows.length).toBeGreaterThan(0.6);
    }
    // Each kingdom's state faith is its church.
    for (const k of Object.values(w.realm.kingdoms)) expect(st.faiths[policyOf(w.realm, k.id, "state_faith")]).toBeDefined();
  });
});

describe("N50 step 2: tenets in scoring", () => {
  it("a devout follower of a charity faith steals less than a follower of a martial faith in the same spot", () => {
    const them: Other = { id: "t2", name: "Ada", place: "square", rank: 2, hate: 0, trust: 0, affection: 0, fear: 0, protected: false, carries: true, suitable: false, sameFaction: false, sells: false, restless: false };
    const ctx = (tenets: string[]): ChoiceCtx => ({ who: "t1", name: "Bo", kind: "townsperson", grain: "day", day: 5, hour: 12, site: "x", habit: { activity: "work", place: "square" }, workPlace: "square", eatPlace: "inn", rank: 2, traits: { bravery: 0.6, temper: 0.6, honesty: 0.2, sociability: 0.5, forgiveness: 0.5, greed: 0.8, ambition: 0.5 }, hunger: 0.5, fatigue: 0, mood: -1, money: 0, broke: true, stock: 0, festival: false, storm: false, present: [them], absent: [], gatherings: [], recruiter: false, wantsToLeave: false, violence: true, last: {}, streak: null, fights: { place: 0, hour: 0 }, faith: { tenets, devotion: 1 } });
    const steal = (tenets: string[]) => menuFor(ctx(tenets)).find((o) => o.action === "steal")?.score ?? -9;
    expect(steal(["charity", "mercy"])).toBeLessThan(steal(["martial", "prosperity"]));
    expect(menuFor(ctx(["charity", "mercy"])).find((o) => o.action === "steal")!.parts.some(([p]) => p === "faith: charity")).toBe(true);
  });
});

describe("N50 step 3: spreading", () => {
  it("a cult spreads from one town to the next: a missionary wins converts there, who preach in turn", () => {
    const realm = generateRealm(1, 1);
    const store = new WorldStore(":memory:");
    materialisePeople(realm, store.people, 1);
    ensureFaiths(realm, 1);
    const cult = faithFactions(realm).find((f) => f.kind === "cult")!;
    const seat = cult.seat!;
    const near = realm.settlements[seat]!.roads.filter((id) => !realm.settlements[id]!.way);
    const live = new Set([seat, ...near]);
    advanceWorld(realm, store, 20, { live });
    const mission = store.records && faithOf(realm).missions.find((m) => m.faith === cult.id && m.done);
    expect(mission).toBeDefined();
    const followers = (store.people.loadSite(mission!.to, "full") as PersonRow[]).filter((r) => r.death === null && beliefOf(r)?.faith === cult.id);
    expect(followers.length).toBeGreaterThan(0);
    expect(store.recentEvents({ limit: 5000 }).some((e) => e.kind === "conversion" && e.site === mission!.to)).toBe(true);
  });
});

describe("N50 step 4: heresy and persecution", () => {
  it("the cult is persecuted as heresy in a harsh kingdom: denounced, tried, its shrine burned, kept in secret", () => {
    const w = world(1, 3);
    const k = w.realm.settlements[w.liege]!.kingdom!;
    setPolicy(w.realm, k, "heresy", "persecute", 4, "test");
    const cult = faithFactions(w.realm).find((f) => f.kind === "cult")!;
    // Some of the place hold the cult's faith.
    const rows = living(w, w.liege).filter((r) => r.job !== "child");
    for (const r of rows.slice(0, 15)) w.store.people.update(r.id, { faith: beliefCell(cult.id, 0.6) });
    for (const r of rows.slice(15, 40)) w.store.people.update(r.id, { faith: beliefCell(policyOf(w.realm, k, "state_faith"), 0.9) });
    let denounced = 0;
    for (let d = 4; d < 40; d++) {
      denounced += faithSiteDay(w.ctx, { site: w.liege, births: [] }, d).denounced.length;
      justiceDay(w.realm, w.store, w.liege, d);
    }
    expect(denounced).toBeGreaterThan(0);
    expect(w.store.records.list("case", (c) => (c.data as { crime?: string }).crime === "heresy").length).toBeGreaterThan(0);
    expect(w.store.recentEvents({ limit: 5000 }).some((e) => e.kind === "trial" && /heresy/.test(e.details))).toBe(true);
    expect(w.store.records.list("secret", (s) => (s.data as { what?: string }).what === "cult").length).toBeGreaterThan(0);
  });
});

describe("N50 step 5: omens and readings", () => {
  it("an omen read by a court seer changes a ruler's decision, logged with the reading", () => {
    let changed = 0;
    for (const seed of [1, 2, 3, 4]) {
      const decide = (withOmen: boolean) => {
        const realm = generateRealm(seed, 1);
        policyRealmDay(realm, 1);
        faithRealmDay(realm, 1);
        const k = Object.values(realm.kingdoms).sort((a, b) => a.id.localeCompare(b.id))[0]!;
        const was = policyOf(realm, k.id, "heresy", 3);
        const means = was === "persecute" ? "peace" : "purge";
        if (withOmen) {
          const st = faithOf(realm);
          st.omens.push({ id: "om-test", day: 2, kind: "a comet in the west", at: null, text: "A comet" });
          readOmen(realm, "om-test", 2);
          for (const r of st.readings) r.means = means;
        }
        const ch = decidePolicy(realm, k.id, "heresy", 3, "test");
        return { was, value: policyOf(realm, k.id, "heresy", 3), why: ch?.why ?? "", means };
      };
      const a = decide(false);
      const b = decide(true);
      expect(a.value).toBe(a.was);
      if (a.value !== b.value) {
        changed++;
        expect(b.why).toMatch(new RegExp(`read a comet in the west as a sign of ${b.means}`));
        expect(b.value).toBe(b.means === "purge" ? "persecute" : "tolerate");
      }
    }
    expect(changed).toBeGreaterThan(0);
  });

  it("omens happen a few times a year, and every court reads them", () => {
    const realm = generateRealm(1, 1);
    for (let d = 1; d <= 96; d++) faithRealmDay(realm, d);
    const st = faithOf(realm);
    expect(st.omens.length).toBeGreaterThan(0);
    expect(st.omens.length).toBeLessThan(15);
    expect(realm.news.some((n) => n.kind === "omen")).toBe(true);
  });
});

describe("N50 step 6: pilgrimages", () => {
  it("pilgrims travel to a shrine at its festival", () => {
    const w = world(1, 3);
    const st = peekFaith(w.realm)!;
    // The devout of the start town follow the liege's church, whose holy site is elsewhere.
    const church = Object.values(st.faiths).find((f) => f.holy && f.holy !== w.start)!;
    for (const r of living(w, w.start).filter((x) => x.job !== "child").slice(0, 20)) w.store.people.update(r.id, { faith: beliefCell(church.id, 0.95) });
    advanceWorld(w.realm, w.store, 14, { live: w.live });
    const pilgrims = w.realm.journeys.filter((j) => j.kind === "pilgrims" && String(j.purpose ?? "").includes("festival") && String(j.purpose).includes(w.realm.factions[church.id]!.name));
    expect(pilgrims.length).toBeGreaterThan(0);
    expect(String(pilgrims[0]!.purpose)).toMatch(new RegExp(w.realm.settlements[church.holy!]!.name));
  });
});
