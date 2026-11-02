/**
 * N26J: rough justice (steps 1–2) and being taken (step 3, with N26I). A crime that's seen is punished by the place's head,
 * by the crime's weight and the head's temper, the same way for the player and for anyone; bribes found out cost the guard
 * the post and the briber a sentence.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { config } from "../src/config.js";
import { WorldStore } from "../src/game/db.js";
import { seededRng } from "../src/game/dice.js";
import { justiceDay, recordBribe, sentencePlayer } from "../src/game/law/justice.js";
import { sentence, SENTENCES } from "../src/game/law/sentence.js";
import { recordLifeEvent } from "../src/game/people/events.js";
import { generateRealm } from "../src/game/realm/generate.js";
import { pickStartSite } from "../src/game/realm/start.js";
import type { Realm } from "../src/game/realm/types.js";
import { startRoad } from "../src/game/road/walk.js";
import { newWorld } from "../src/game/save.js";
import { Town } from "../src/game/town.js";
import { loadCreatureTemplates } from "../src/game/creatures.js";
import { materialisePeople } from "../src/store/materialise.js";
import type { PersonRow } from "../src/store/peopleStore.js";
import { always, FakeProvider } from "./helpers.js";
import { landOf } from "../src/game/road/ground.js";

vi.setConfig({ testTimeout: 120_000 });
beforeEach(() => {
  config.director = false;
  config.planning = false;
});

function world(seed = 1) {
  const realm = generateRealm(seed, 1);
  const store = new WorldStore(":memory:");
  materialisePeople(realm, store.people, 1);
  const site = pickStartSite(realm, realm.seed);
  return { realm, store, site };
}

/** Make the place's head of a temper. */
function temper(realm: Realm, site: string, t: "greedy" | "harsh" | "merciful") {
  const head = realm.figures[realm.settlements[site]!.leader!]!;
  Object.assign(head, t === "greedy" ? { greed: 0.95, bravery: 0.1, ambition: 0.1 } : t === "harsh" ? { greed: 0.05, bravery: 1, ambition: 1 } : { greed: 0.05, bravery: 0.05, ambition: 0.05 });
  return head;
}

const kindsOver = (realm: Realm, site: string, who: "player" | "person", crime: string, n = 200) => {
  const out = new Map<string, number>();
  for (let i = 0; i < n; i++) {
    const s = sentence(realm, { kind: who, id: "x", name: "X" }, crime, site, 5, seededRng(i));
    out.set(s.kind, (out.get(s.kind) ?? 0) + 1);
  }
  return out;
};
const top = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1])[0]![0];

describe("N26J step 1: crimes and sentences", () => {
  it("a petty thief is fined by a greedy head and flogged by a harsh one", () => {
    const { realm, site } = world(1);
    temper(realm, site, "greedy");
    expect(top(kindsOver(realm, site, "person", "petty_theft"))).toBe("fine");
    temper(realm, site, "harsh");
    expect(top(kindsOver(realm, site, "person", "petty_theft"))).toBe("flogging");
    temper(realm, site, "merciful");
    expect(["stocks", "fine"]).toContain(top(kindsOver(realm, site, "person", "petty_theft")));
  });

  it("the player and a townsperson caught for the same crime get the same range of sentences (never hanging for the player)", () => {
    const { realm, site } = world(1);
    temper(realm, site, "harsh");
    for (const crime of ["theft", "assault", "killing"]) {
      const p = kindsOver(realm, site, "player", crime);
      const n = kindsOver(realm, site, "person", crime);
      expect(p.has("hanging")).toBe(false);
      for (const k of p.keys()) if (k !== "hanging") expect(SENTENCES).toContain(k);
      expect(top(p) === top(n) || (top(n) === "hanging" && p.size > 0)).toBe(true);
    }
  });

  it("a fine goes to the place's treasury; one the player can't pay is the lock-up", () => {
    const { realm, site } = world(1);
    temper(realm, site, "greedy");
    const player = { name: "Tester", money: 10_000, hp: 30, maxHp: 30 } as never as Parameters<typeof sentencePlayer>[1];
    const before = realm.settlements[site]!.treasury;
    const r = sentencePlayer(realm, player, "petty_theft", site, 3, seededRng(1));
    expect(r.sentence.kind).toBe("fine");
    expect(realm.settlements[site]!.treasury).toBe(before + r.sentence.amount!);
    player.money = 0;
    const r2 = sentencePlayer(realm, player, "petty_theft", site, 4, seededRng(1));
    expect(r2.sentence.kind).toBe("lockup");
    expect(r2.hours).toBeGreaterThanOrEqual(24);
  });

  it("a banished player is refused at the gate until the day it ends", () => {
    const templates = loadCreatureTemplates();
    const store = new WorldStore(":memory:");
    const w = newWorld({}, templates, always(0.5), 1);
    materialisePeople(w.realm!, store.people, w.day);
    const town = new Town({ personas: {}, creatureTemplates: templates, world: w, llm: new FakeProvider(), store });
    const site = town.site();
    const realm = town.world.realm!;
    const p = town.world.player;
    const road = startRoad(realm, p, site)!;
    p.banished = { [site]: town.world.day + 3 };
    // Step back toward the gate.
    const fp = landOf(realm).footprints.get(site)!;
    const gate = Object.values(fp.gates).sort((a, b) => Math.hypot(a.x - road.x, a.y - road.y) - Math.hypot(b.x - road.x, b.y - road.y))[0]!;
    /** Walk toward the gate until something stops the player or they're in. */
    const walk = () => {
      for (let i = 0; i < 12; i++) {
        const at = p.road!;
        const dx = Math.sign(gate.x - at.x);
        const dy = dx === 0 ? Math.sign(gate.y - at.y) : 0;
        const r = town.road.step(dx, dy, () => []);
        if (!r.ok || r.entered) return r;
      }
      return null;
    };
    const r = walk()!;
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/banished until day/);
    expect(p.road).toBeDefined();
    town.world.day += 3;
    expect(walk()!.entered).toBe(site);
  });

  it("a townsperson caught stealing is judged that day by the place's head", () => {
    const { realm, store, site } = world(1);
    const rows = (store.people.loadSite(site, "full") as PersonRow[]).filter((r) => r.death === null && r.job !== "child");
    const [thief, victim, witness] = rows;
    recordLifeEvent(realm, store, { kind: "theft-caught", actor: thief!.id, target: victim!.id, site, day: 4, details: "caught stealing", importance: 4, witnesses: [witness!.id] });
    expect(justiceDay(realm, store, site, 4)).toBe(1);
    const s = store.eventsAbout(thief!.id).find((e) => e.kind === "sentence");
    expect(s).toBeDefined();
    expect(s!.target).toBe(realm.settlements[site]!.leader);
    // An unseen theft is nobody's business.
    recordLifeEvent(realm, store, { kind: "theft", actor: victim!.id, target: thief!.id, site, day: 5, details: "lifted a purse", importance: 3 });
    expect(justiceDay(realm, store, site, 5)).toBe(0);
  });
});

describe("N26J step 2: bribes found out", () => {
  it("a guard who took a bribe and was seen is turned out of the watch, and the briber is sentenced", () => {
    const { realm, store, site } = world(1);
    const rows = (store.people.loadSite(site, "full") as PersonRow[]).filter((r) => r.death === null && r.job !== "child");
    const guard = rows.find((r) => r.job === "guard") ?? rows[0]!;
    store.people.update(guard.id, { job: "guard" });
    const briber = rows.find((r) => r.id !== guard.id)!;
    const witness = rows.find((r) => r.id !== guard.id && r.id !== briber.id)!;
    recordBribe(realm, store, { guard: guard.id, briber: briber.id, site, day: 6, amount: 30, witnesses: [witness.id], what: "look the other way at the gate" });
    expect(justiceDay(realm, store, site, 6)).toBe(2);
    expect(store.people.get(guard.id)!.job).toBe("labourer");
    expect(store.eventsAbout(briber.id).some((e) => e.kind === "sentence")).toBe(true);
    expect(realm.news.some((n) => n.text.includes("turned out of the watch"))).toBe(true);
  });
});
