/**
 * N20: stories, drama and liveness. Every event may say what led to it (explicitly, or by a cause scope); code walks those links back
 * and keeps the best chains as stories; daily numbers say how alive the world is; a drama manager (off until N38) hurries a thread already
 * in motion when the player's place is quiet, and logs why.
 */
import { afterEach, describe, expect, it } from "vitest";
import { config } from "../src/config.js";
import { addGrievance, hateOn } from "../src/game/chatter/grievance.js";
import { temperOf } from "../src/game/chatter/person.js";
import { thresholdOf, vendettaDay } from "../src/game/chatter/revenge.js";
import { WorldStore } from "../src/game/db.js";
import { recordEvent, type GameEvent } from "../src/game/events.js";
import { liveSites } from "../src/game/people/live.js";
import { outlookOf } from "../src/game/people/outlook.js";
import { recordLifeEvent } from "../src/game/people/events.js";
import type { LifeCtx } from "../src/game/people/step.js";
import { advanceWorld } from "../src/game/people/world.js";
import { generateRealm } from "../src/game/realm/generate.js";
import { realmNews } from "../src/game/realm/log.js";
import { pickStartSite } from "../src/game/realm/start.js";
import { causesFor, currentCauses, refusedCauses, withCause } from "../src/game/stories/cause.js";
import { scoreChain, stories, storiesDay, storyById, STORY } from "../src/game/stories/detect.js";
import { DRAMA, dramaDay, dramaLog } from "../src/game/stories/drama.js";
import { chainBack, chainForward, longestBack } from "../src/game/stories/graph.js";
import { livenessFor } from "../src/game/stories/liveness.js";
import { materialisePeople } from "../src/store/materialise.js";
import type { PersonRow } from "../src/store/peopleStore.js";
import { days } from "./long.js";

const was = { drama: config.drama, stories: config.stories, realm: config.realm };
afterEach(() => Object.assign(config, was));

function world(seed = 1) {
  const realm = generateRealm(seed, 1);
  const store = new WorldStore(":memory:");
  materialisePeople(realm, store.people, 1);
  const home = pickStartSite(realm, seed);
  return { realm, store, home, ctx: { realm, store } as LifeCtx };
}

const grownAt = (store: WorldStore, site: string) => (store.people.loadSite(site, "full") as PersonRow[]).filter((r) => r.job !== "child" && !r.away && r.death === null && r.persona === null);

describe("N20 step 1: cause links", () => {
  it("events inside a cause scope inherit it, nested scopes add theirs, and a throw still pops", () => {
    expect(currentCauses()).toEqual([]);
    withCause("l1-3-raid-x", () => {
      expect(currentCauses()).toEqual(["l1-3-raid-x"]);
      withCause(["n:rn4"], () => expect(currentCauses()).toEqual(["n:rn4", "l1-3-raid-x"]));
      expect(() => withCause("l1-4-fire-y", () => {
        throw new Error("boom");
      })).toThrow("boom");
      expect(currentCauses()).toEqual(["l1-3-raid-x"]);
    });
    expect(currentCauses()).toEqual([]);
    // After the scope: nothing is caused by it.
    const w = { day: 2, hour: 5, location: "the green", events: [] as GameEvent[] };
    const e = recordEvent(w, { kind: "theft", actor: "a", target: "b", details: "stole a loaf", importance: 3 });
    expect(e.causedBy).toBeUndefined();
    const f = withCause("e2-4-1", () => recordEvent(w, { kind: "theft", actor: "a", target: "b", details: "stole again", importance: 3 }));
    expect(f.causedBy).toEqual(["e2-4-1"]);
  });

  it("a cause newer than its effect is refused, as is an event its own cause; at most three are kept, explicit ones first", () => {
    const before = refusedCauses();
    expect(causesFor("l5-10-attacked-k", ["l6-1-insult-k"])).toBeUndefined();
    expect(causesFor("l5-10-attacked-k", ["l5-10-attacked-k"])).toBeUndefined();
    expect(refusedCauses()).toBe(before + 2);
    expect(causesFor("l5-10-attacked-k", ["l5-10-insult-k", "l4-2-a-x"])).toEqual(["l5-10-insult-k", "l4-2-a-x"]);
    expect(withCause(["l1-1-c-1", "l1-1-d-1"], () => causesFor("l5-10-x-k", ["l2-1-a-1", "l3-1-b-1"]))).toEqual(["l2-1-a-1", "l3-1-b-1", "l1-1-c-1"]);
  });

  it("realm news and townsfolk events carry their causes, and the store indexes them both ways", () => {
    const { realm, store, home } = world();
    realmNews(realm, 3, home, "fire", "A barn burned.", 3, [], { causedBy: ["l3-1-insult-a"] });
    expect(realm.news.at(-1)!.causedBy).toEqual(["l3-1-insult-a"]);
    const a = recordLifeEvent(realm, store, { kind: "affront", actor: "p1", target: "p2", site: home, day: 3, hour: 1, details: "p1 insulted p2", importance: 2, key: "a" });
    const b = withCause(a.id, () => recordLifeEvent(realm, store, { kind: "npc-fight", actor: "p2", target: "p1", site: home, day: 4, hour: 2, details: "p2 and p1 fought", importance: 4, key: "b" }));
    expect(b.causedBy).toEqual([a.id]);
    expect(store.causesOf(b.id)).toEqual([a.id]);
    expect(store.effectsOf(a.id)).toEqual([b.id]);
  });
});

describe("N20 steps 2 and 3: chains and stories", () => {
  it("an insult, a grudge, a revenge goal and an ambush walk back as one chain; the story grows when the chain does", () => {
    const { realm, store, home } = world();
    const [p, q] = grownAt(store, home);
    const mk = (kind: GameEvent["kind"], day: number, by: string, to: string, details: string, importance: number, cause?: string) =>
      recordLifeEvent(realm, store, { kind, actor: by, target: to, site: home, day, hour: 10, details, importance, key: `t:${kind}:${day}`, ...(cause ? { causedBy: [cause] } : {}) });
    const insult = mk("affront", 1, q!.id, p!.id, `${q!.name} insulted ${p!.name}`, 2);
    const slight = mk("slight", 2, p!.id, q!.id, `${p!.name} snubbed ${q!.name}`, 2, insult.id);
    const goal = mk("new-goal", 3, p!.id, q!.id, `${p!.name} wants revenge on ${q!.name}`, 3, slight.id);
    const ambush = mk("attacked", 4, p!.id, q!.id, `${p!.name} had men beat ${q!.name}`, 5, goal.id);
    expect(chainBack(store, ambush.id)).toEqual([goal.id, slight.id, insult.id]);
    expect(chainForward(store, insult.id)).toEqual([slight.id, goal.id, ambush.id]);
    expect(longestBack(store, ambush.id)).toEqual([insult.id, slight.id, goal.id, ambush.id]);

    const nameOf = (id: string) => store.people.get(id)?.name;
    expect(storiesDay(realm, store, 4, nameOf)).toMatchObject({ found: 1, grown: 0 });
    const [st] = stories(store);
    expect(st!.refs).toEqual([insult.id, slight.id, goal.id, ambush.id]);
    expect(st!.title).toContain(p!.name);
    expect(st!.summary).toContain("insulted");
    expect(st!.score).toBe(scoreChain(realm, [insult, slight, goal, ambush]).score);
    // A new effect of the ambush grows the same story.
    const feud = mk("npc-fight", 6, q!.id, p!.id, `${q!.name} and ${p!.name} came to blows`, 5, ambush.id);
    expect(storiesDay(realm, store, 6, nameOf)).toMatchObject({ found: 0, grown: 1 });
    expect(stories(store)).toHaveLength(1);
    expect(storyById(store, st!.id)!.refs.at(-1)).toBe(feud.id);
    // Running the day again changes nothing.
    storiesDay(realm, store, 6, nameOf);
    expect(stories(store)).toHaveLength(1);
  });

  it(`a run of days makes stories, and every step of every story links to the one before (${days(60, 25)} days)`, () => {
    config.realm = true;
    const { realm, store, home } = world();
    advanceWorld(realm, store, days(60, 25), { live: liveSites(realm, home, "all"), watched: new Set([home]) });
    const all = stories(store, 500);
    expect(all.length).toBeGreaterThan(0);
    for (const s of all) {
      expect(s.refs.length).toBeGreaterThanOrEqual(STORY.minLength);
      for (let i = 1; i < s.refs.length; i++) expect(store.causesOf(s.refs[i]!).map((c) => c.replace(/^e:/, "")), `${s.id} step ${i}`).toContain(s.refs[i - 1]);
    }
    // Every day has its numbers.
    const m = store.dumpTable("metrics_daily");
    expect(m.length).toBe(days(60, 25) - 1);
    expect(JSON.parse(String(m.at(-1)!.data)).distinctActions).toBeGreaterThan(0);
  });
});

describe("N20 step 5: liveness", () => {
  it("a hand-built day gives the numbers it should", () => {
    const { realm, store, home } = world();
    const fig = Object.values(realm.figures).find((f) => f.alive && (f.renown ?? 0) >= 25);
    const ev = (kind: GameEvent["kind"], actor: string, hour: number, importance: number, key: string, extra: Partial<GameEvent> = {}): GameEvent => ({ id: `l9-${hour}-${kind}-${key}`, day: 9, hour, kind, actor, target: "", details: "", importance, site: home, ...extra });
    const events = [
      ev("affront", "a", 3, 2, "1"),
      ev("affront", "a", 4, 2, "2"),
      ev("npc-fight", "a", 5, 4, "3"),
      ev("theft", "b", 5, 5, "4", { knownBy: ["player"] }),
      ...(fig ? [ev("trial", fig.id, 12, 3, "5")] : []),
    ];
    const m = livenessFor(realm, store, 9, { site: home, known: { "n:rn1": { day: 9, how: "news" }, "n:rn2": { day: 8, how: "news" } } }, events);
    expect(m).toMatchObject({ day: 9, distinctActions: fig ? 4 : 3, namedMoved: fig ? 1 : 0, reachedPlayer: 2, quietHours: 23, events: events.length, storiesGrew: 0 });
  });
});

describe("N20 step 6: the drama manager", () => {
  function quietGrudge() {
    const w = world();
    const [p, q] = grownAt(w.store, w.home).filter((r) => !outlookOf(r).goal);
    const need = thresholdOf(temperOf(p!));
    addGrievance(w.store, { who: p!.id, against: q!.id, cause: "e:l1-1-insult-x", weight: need - 0.1, day: 5 });
    return { ...w, p: p!, q: q!, need };
  }

  it("off, it does nothing; on, a quiet place's nearest grudge is hurried to revenge, and the nudge says why", () => {
    config.drama = false;
    const off = quietGrudge();
    expect(dramaDay(off.ctx, off.home, 5)).toBeNull();
    expect(dramaLog(off.store)).toEqual([]);

    config.drama = true;
    const on = quietGrudge();
    const nudge = dramaDay(on.ctx, on.home, 5)!;
    expect(nudge).toMatchObject({ day: 5, action: "hurry", thread: `grudge:${on.p.id}>${on.q.id}` });
    expect(nudge.reason).toMatch(/quiet for 2 days/);
    expect(nudge.reason).toContain(on.p.name);
    expect(dramaLog(on.store)).toEqual([nudge]);
    expect(hateOn(on.store, on.p.id, on.q.id, 5)).toBeGreaterThanOrEqual(on.need);
    // Not again the next day: one nudge every few days.
    expect(dramaDay(on.ctx, on.home, 6)).toBeNull();
    expect(dramaDay(on.ctx, on.home, 5 + DRAMA.everyDays)).not.toBeNull();
    // The system then acts by its own rules: the next day the grudge becomes a revenge goal, as it would not have in the quiet world.
    expect(vendettaDay(on.ctx, on.home, 6).formed).toBeGreaterThanOrEqual(1);
    expect(outlookOf(on.store.people.get(on.p.id)!).goal).toMatchObject({ kind: "avenge", target: on.q.id });
    expect(vendettaDay(off.ctx, off.home, 6).formed).toBe(0);
    // And the days' numbers differ.
    expect(livenessFor(on.realm, on.store, 6).events).toBeGreaterThan(livenessFor(off.realm, off.store, 6).events);
  });

  it("a place where something weighty happened lately is not quiet: no nudge", () => {
    config.drama = true;
    const w = quietGrudge();
    recordLifeEvent(w.realm, w.store, { kind: "death", actor: w.q.id, site: w.home, day: 4, details: "a death", importance: 6, key: "loud" });
    expect(dramaDay(w.ctx, w.home, 5)).toBeNull();
  });
});
