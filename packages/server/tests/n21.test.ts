/**
 * N21: callbacks to the player's choices. A notable event that traces back, within a few cause links, to something the player chose to
 * do is a callback; it is written in their journal once they know the outcome, never before, and no more than one a day.
 */
import { describe, expect, it } from "vitest";
import { WorldStore } from "../src/game/db.js";
import type { GameEvent } from "../src/game/events.js";
import { recordLifeEvent } from "../src/game/people/events.js";
import { generateRealm } from "../src/game/realm/generate.js";
import { pickStartSite } from "../src/game/realm/start.js";
import { CALLBACK, callbacks, canTell, choicesBehind, findCallbacks, isPlayerChoice, tellCallbacks } from "../src/game/stories/callbacks.js";
import type { PlayerState } from "../src/npc/types.js";

function setup() {
  const realm = generateRealm(1, 1);
  const store = new WorldStore(":memory:");
  const home = pickStartSite(realm, 1);
  let n = 0;
  /** A chain of `links` events after a root, the last one notable; returns all of them, root first. */
  const chain = (root: { actor: string; kind: GameEvent["kind"] }, links: number, day: number): GameEvent[] => {
    const out: GameEvent[] = [];
    const k = ++n;
    out.push(recordLifeEvent(realm, store, { kind: root.kind, actor: root.actor, target: "t_odo", site: home, day, hour: 9, details: `${root.actor} ${root.kind} Odo`, importance: 3, key: `root${k}` }));
    for (let i = 1; i <= links; i++) {
      const last = i === links;
      out.push(recordLifeEvent(realm, store, { kind: last ? "attacked" : "band", actor: "t_odo", target: "", site: home, day: day + i, hour: 9, details: last ? "Odo led a raid on the mill" : `Odo gathered men (${i})`, importance: last ? 8 : 3, key: `c${k}-${i}`, causedBy: [out.at(-1)!.id] }));
    }
    return out;
  };
  const nameOf = (id: string) => (id === "t_odo" ? "Odo" : id);
  return { realm, store, home, chain, nameOf };
}

const player = (known: string[] = []): PlayerState => ({ name: "Tester", known: Object.fromEntries(known.map((id) => [`e:${id}`, { day: 1, how: "told" as const }])) }) as unknown as PlayerState;

describe("N21: finding callbacks", () => {
  it("a choice of the player's three links behind a notable event is a callback; five links behind, or someone else's, is not", () => {
    const { realm, store, chain } = setup();
    expect(isPlayerChoice({ actor: "player", kind: "spared" })).toBe(true);
    expect(isPlayerChoice({ actor: "t_odo", kind: "spared" })).toBe(false);
    const near = chain({ actor: "player", kind: "spared" }, 3, 2);
    const far = chain({ actor: "player", kind: "spared" }, 5, 2);
    const other = chain({ actor: "t_mara", kind: "spared" }, 3, 2);
    expect(choicesBehind(store, near.at(-1)!.id).map((c) => c.path)).toEqual([near.map((e) => e.id)]);
    for (let d = 2; d <= 8; d++) findCallbacks(realm, store, d);
    const all = callbacks(store);
    expect(all.map((c) => c.outcome)).toEqual([near.at(-1)!.id]);
    expect(all[0]).toMatchObject({ choice: near[0]!.id, path: near.map((e) => e.id), found: 5 });
    expect(CALLBACK.depth).toBe(4);
    void far;
    void other;
    // Found once.
    findCallbacks(realm, store, 5);
    expect(callbacks(store)).toHaveLength(1);
  });

  it("a townsperson may tell it only if they know both ends", () => {
    const { realm, store, chain } = setup();
    const c = chain({ actor: "player", kind: "spared" }, 2, 2);
    findCallbacks(realm, store, 4);
    const [cb] = callbacks(store);
    expect(canTell(cb!, (id) => id === c.at(-1)!.id)).toBe(false);
    expect(canTell(cb!, () => true)).toBe(true);
  });
});

describe("N21: telling through the journal", () => {
  it("the journal ties the choice to the outcome once the player knows the outcome, and not before", () => {
    const { realm, store, chain, nameOf } = setup();
    const c = chain({ actor: "player", kind: "spared" }, 2, 2);
    findCallbacks(realm, store, 4);
    const unaware = player();
    expect(tellCallbacks(realm, store, unaware, 5, nameOf)).toEqual([]);
    expect(unaware.journal ?? []).toEqual([]);
    const aware = player([c.at(-1)!.id]);
    const told = tellCallbacks(realm, store, aware, 6, nameOf);
    expect(told).toHaveLength(1);
    expect(aware.journal).toEqual([expect.objectContaining({ kind: "consequence", day: 6 })]);
    expect(aware.journal![0]!.text).toMatch(/You spared Odo on day 2; on day 4 it came to this: Odo led a raid on the mill\./);
    expect(store.eventsOfDay(6).find((e) => e.kind === "callback-told")!.causedBy).toEqual([c.at(-1)!.id, c[0]!.id]);
    expect(callbacks(store, { pending: true })).toEqual([]);
  });

  it("three ready on one day: one is told that day, the next the day after", () => {
    const { realm, store, chain, nameOf } = setup();
    const ends = [chain({ actor: "player", kind: "spared" }, 1, 2), chain({ actor: "player", kind: "gift" }, 1, 2), chain({ actor: "player", kind: "theft" }, 1, 2)].map((c) => c.at(-1)!.id);
    findCallbacks(realm, store, 3);
    const p = player(ends);
    expect(tellCallbacks(realm, store, p, 4, nameOf)).toHaveLength(1);
    expect(tellCallbacks(realm, store, p, 4, nameOf)).toHaveLength(0);
    expect(tellCallbacks(realm, store, p, 5, nameOf)).toHaveLength(1);
    expect(p.journal).toHaveLength(2);
  });
});
