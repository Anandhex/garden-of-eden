import { describe, expect, it } from "vitest";
import { describeEvent, diffFrames, type EventFrame } from "../src/events.js";
import { NdjsonDecoder } from "../src/ndjson.js";
import { findPath } from "../src/path.js";
import { findSentenceEnd, SentenceSplitter, speakable } from "../src/sentences.js";

const npc = (over: Partial<EventFrame["npcs"][string]> = {}): EventFrame["npcs"][string] => ({
  mood: "neutral",
  trust: 0,
  hp: 30,
  money: 100,
  inventory: {},
  dead: false,
  deathCause: null,
  companion: false,
  pendingQuest: null,
  busy: null,
  ...over,
});
const frame = (player: Partial<EventFrame["player"]> = {}, npcs: Record<string, ReturnType<typeof npc>> = { brena: npc() }): EventFrame => ({
  player: { money: 500, hp: 40, inventory: {}, ...player },
  npcs,
});

describe("diffFrames (T13)", () => {
  it("pairs a purchase: the sword goes to the player and the coin to the smith", () => {
    const before = frame({ money: 500 }, { brena: npc({ inventory: { "iron sword": 2 }, money: 100 }) });
    const after = frame({ money: 100, inventory: { "iron sword": 1 } }, { brena: npc({ inventory: { "iron sword": 1 }, money: 500 }) });
    expect(diffFrames(before, after)).toEqual([
      { type: "item_moved", item: "iron sword", qty: 1, from: "brena", to: "player" },
      { type: "gold_moved", amount: 400, from: "player", to: "brena" },
    ]);
  });

  it("sends what nobody tracked gained to the world (eating, a fine to the guardhouse)", () => {
    const events = diffFrames(frame({ money: 50, inventory: { stew: 2 } }), frame({ money: 30, inventory: { stew: 1 } }));
    expect(events).toEqual([
      { type: "item_moved", item: "stew", qty: 1, from: "player", to: "world" },
      { type: "gold_moved", amount: 20, from: "player", to: "world" },
    ]);
  });

  it("reports mood, trust, HP, deaths, companions, offers and busy NPCs", () => {
    const before = frame({ hp: 40 }, { brena: npc(), hale: npc({ hp: 5 }) });
    const after = frame(
      { hp: 33 },
      { brena: npc({ mood: "happy", trust: 5, companion: true, pendingQuest: "Herbs for a burn", busy: "forging a dagger" }), hale: npc({ hp: 0, dead: true, deathCause: "killed by Traveler", mood: "afraid" }) },
    );
    const types = diffFrames(before, after).map((e) => e.type);
    expect(types).toEqual(["mood_changed", "trust_changed", "following", "quest_offered", "npc_busy", "npc_died", "hp_changed", "hp_changed"]);
    // A dead NPC's last mood change isn't news.
    expect(diffFrames(before, after).some((e) => e.type === "mood_changed" && e.npc === "hale")).toBe(false);
  });

  it("says nothing when nothing changed", () => {
    expect(diffFrames(frame(), frame())).toEqual([]);
  });

  it("describes events for a text log", () => {
    expect(describeEvent({ type: "gold_moved", amount: 40, from: "player", to: "brena" }, (id) => (id === "brena" ? "Brena" : id))).toBe("40 copper: you → Brena");
    expect(describeEvent({ type: "attack", by: "hale", target: "player", hit: false, damage: 0 })).toBe("hale attacks you: miss");
  });
});

describe("SentenceSplitter (T14)", () => {
  it("hands back each sentence once the next one has begun", () => {
    const s = new SentenceSplitter();
    expect(s.push("Iron sword for 4 gold")).toEqual([]);
    expect(s.push(". Take it or")).toEqual(["Iron sword for 4 gold."]);
    expect(s.push(" leave it.")).toEqual([]);
    expect(s.flush()).toEqual(["Take it or leave it."]);
    expect(s.flush()).toEqual([]);
  });

  it("doesn't split on abbreviations, initials or decimals", () => {
    const s = new SentenceSplitter();
    expect(s.push("Ask Mr. Pell about it, the price is 3.5 silver. J. Tally knows. Now go! ")).toEqual(["Ask Mr. Pell about it, the price is 3.5 silver.", "J. Tally knows."]);
    // "Now go!" is short: it waits for more, and comes out when the reply ends.
    expect(s.flush()).toEqual(["Now go!"]);
  });

  it("joins a very short piece to the next sentence", () => {
    const s = new SentenceSplitter();
    expect(s.push("Hm. Hold on, let me see. Right")).toEqual(["Hm. Hold on, let me see."]);
  });

  it("keeps closing quotes and runs of punctuation with their sentence", () => {
    expect(findSentenceEnd('He said "get out!" and left')).toBe('He said "get out!"'.length);
    expect(findSentenceEnd("What?! No way")).toBe(6);
    expect(findSentenceEnd("Wait")).toBe(-1);
  });

  it("speakable() drops stage directions and markup", () => {
    expect(speakable("*wipes her hands* Brena: Fine. (She sighs.) <situation>x</situation> Take it.")).toBe("Fine. x Take it.");
    expect(speakable("**Four** gold.")).toBe("Four gold.");
  });
});

describe("findPath", () => {
  const wall = new Set(["1,0", "1,1"]);
  const blocked = (x: number, y: number) => x < 0 || y < 0 || x > 3 || y > 3 || wall.has(`${x},${y}`);
  it("goes around walls, in steps", () => {
    const path = findPath({ x: 0, y: 0 }, (t) => t.x === 2 && t.y === 0, blocked)!;
    expect(path.at(-1)).toEqual({ x: 2, y: 0 });
    expect(path).toHaveLength(6);
    for (const [i, t] of path.entries()) {
      const prev = i === 0 ? { x: 0, y: 0 } : path[i - 1]!;
      expect(Math.abs(t.x - prev.x) + Math.abs(t.y - prev.y)).toBe(1);
    }
  });
  it("returns [] when already there and null when there's no way", () => {
    expect(findPath({ x: 0, y: 0 }, (t) => t.x === 0 && t.y === 0, blocked)).toEqual([]);
    expect(findPath({ x: 0, y: 0 }, (t) => t.x === 9, blocked)).toBeNull();
  });
});

describe("NdjsonDecoder", () => {
  it("parses lines split across chunks and skips broken ones", () => {
    const d = new NdjsonDecoder<{ t: string }>();
    expect(d.push('{"t":"te')).toEqual([]);
    expect(d.push('xt"}\n{bad}\n{"t":"done"}\n')).toEqual([{ t: "text" }, { t: "done" }]);
  });
});
