import { beforeEach, describe, expect, it, vi } from "vitest";
import { config } from "../src/config.js";
import { addGrievance } from "../src/game/chatter/grievance.js";
import { choiceDay } from "../src/game/choice/day.js";
import { WorldStore } from "../src/game/db.js";
import { seededRng } from "../src/game/dice.js";
import type { LifeCtx } from "../src/game/people/step.js";
import { advanceWorld } from "../src/game/people/world.js";
import { generateRealm } from "../src/game/realm/generate.js";
import { makeFigure } from "../src/game/realm/figures.js";
import { courtDaySecrets, courtOf } from "../src/game/secrets/court.js";
import { knowersOf, secretRef, type DemandData, type SecretData } from "../src/game/secrets/model.js";
import { blackmailBy, exposeBy, pry, sellSecret } from "../src/game/secrets/player.js";
import { crimeSecrets } from "../src/game/secrets/sources.js";
import { answerOf, useDay } from "../src/game/secrets/use.js";
import { playerLearns } from "../src/game/playerKnowledge.js";
import type { PersonRow } from "../src/store/peopleStore.js";
import { materialisePeople } from "../src/store/materialise.js";
import type { PlayerState } from "../src/npc/types.js";
import { pickTestPlaces } from "./helpers.js";

/**
 * N46: secrets, spies and blackmail. A secret is a record with who knows it; it never spreads by gossip on its own; people use it through
 * the action menu (blackmail, expose); the blackmailed pay, refuse, flee or silence; courts plan wars in secret and spies report them; a
 * disputed throne breeds plots. People are found by class and job, never by name.
 */
vi.setConfig({ testTimeout: 240_000, hookTimeout: 240_000 });

beforeEach(() => {
  config.peopleLazy = "";
  config.realm = true;
  config.realmSeed = undefined;
  config.society.secrets = true;
  config.choice.violence = false;
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

/** A crime nobody saw, by someone: an event with no witnesses. */
function hiddenCrime(w: W, doer: PersonRow, victim: PersonRow, day: number, n = 0) {
  w.store.archiveEvent({ id: `test-theft-${doer.id}-${day}-${n}`, day, hour: 22, kind: "theft", actor: doer.id, target: victim.id, details: `${doer.name} lifted a purse from ${victim.name}`, importance: 3, witnesses: [], knownBy: [], site: doer.site });
}

describe("N46 step 1: secret records and sources", () => {
  it("an unwitnessed theft makes a `crime` secret the thief knows, which gossip never passes on by itself", () => {
    const w = world(1);
    const day = w.realm.day + 1;
    const [thief, victim] = grown(w, w.liege);
    hiddenCrime(w, thief!, victim!, day);
    const made = crimeSecrets(w.ctx, w.liege, day);
    expect(made.length).toBe(1);
    const s = w.store.records.get<SecretData>(made[0]!)!;
    expect(s.data.what).toBe("crime");
    expect(s.data.about).toBe(thief!.id);
    expect(knowersOf(w.store, s.id)).toContain(thief!.id);
    expect(knowersOf(w.store, s.id)).not.toContain(victim!.id);
    // Worth nothing to gossip: a secret is only told on purpose.
    advanceWorld(w.realm, w.store, day + 6, { live: w.live });
    // Everyone who knows it saw it, did it, or served the household: nobody was told it.
    for (const k of w.store.knowledge.holders(secretRef(s.id))) expect(["did", "saw", "served"]).toContain(k.source);
  });
});

describe("N46 steps 2–3: discovery and using secrets", () => {
  it("an NPC witnesses a noble's crime, blackmails them, and the noble pays or has the witness silenced", () => {
    const w = world(1);
    let day = w.realm.day + 1;
    const rows = grown(w, w.liege);
    const nobles = rows.filter((r) => r.cls === "noble" || r.cls === "gentry");
    expect(nobles.length).toBeGreaterThan(0);
    // Crimes until one is seen after all by someone near.
    let sec: { id: string; witness: string; noble: PersonRow } | null = null;
    for (let i = 0; i < 40 && !sec; i++) {
      const noble = nobles[i % nobles.length]!;
      const victim = rows.find((r) => r.id !== noble.id && r.home !== noble.home)!;
      hiddenCrime(w, noble, victim, day, i);
      for (const id of crimeSecrets(w.ctx, w.liege, day)) {
        const witness = knowersOf(w.store, id).find((k) => k !== noble.id);
        if (witness && !sec) sec = { id, witness, noble };
      }
      day++;
    }
    expect(sec).not.toBeNull();
    // The witness knows; the noble doesn't know that they do (they knew it as the doer).
    expect(w.store.knowledge.get(sec!.witness, secretRef(sec!.id))!.source).toBe("saw");
    // The witness chooses to blackmail (the menu, narrowed to it).
    config.choice.only = ["blackmail"] as never;
    choiceDay(w.ctx, { site: w.liege }, day);
    const ev = w.store.eventsAt(w.liege, day, ["blackmail"]).find((e) => e.actor === sec!.witness);
    expect(ev).toBeDefined();
    expect(ev!.causedBy).toContain(sec!.id);
    useDay(w.ctx, w.liege, day);
    const d = w.store.records.get<DemandData>(`demand:${sec!.id}:${sec!.witness}`)!;
    expect(d).toBeDefined();
    expect(["pay", "refuse", "flee", "silence"]).toContain(d.data.answer);
    // Across the place's nobles, some pay and some would silence: answers come from who they are.
    const answers = new Set(nobles.flatMap((n) => rows.slice(0, 30).map((k) => answerOf(w.ctx, n, k, { what: "crime", about: n.id, text: "x", weight: 8 }, `${n.id}:${k.id}`).answer)));
    expect(answers.has("pay")).toBe(true);
    expect(answers.has("silence")).toBe(true);
  });

  it("with violence on, a ruthless one silences the witness: a murder, itself a new secret", async () => {
    const w = world(1);
    const day = w.realm.day + 1;
    config.choice.violence = true;
    const rows = grown(w, w.liege);
    const { silence } = await import("../src/game/secrets/use.js");
    const noble = rows.find((r) => r.cls === "noble" || r.cls === "gentry")!;
    const witness = rows.find((r) => r.id !== noble.id)!;
    hiddenCrime(w, noble, rows.find((r) => r.id !== noble.id && r.id !== witness.id)!, day);
    const id = crimeSecrets(w.ctx, w.liege, day)[0]!;
    silence(w.ctx, noble, witness, id, null, day, "test");
    expect(w.store.people.get(witness.id)!.death).not.toBeNull();
    const murder = w.store.records.open<SecretData>("secret", (s) => s.data.about === noble.id && s.data.weight === 10)[0]!;
    expect(murder.data.text).toMatch(/killed/);
    expect(knowersOf(w.store, murder.id)).toEqual([noble.id]);
  });

  it("an exposed secret is out: the subject's name suffers, and a crime becomes a case for the law", () => {
    const w = world(1);
    const day = w.realm.day + 1;
    const rows = grown(w, w.liege);
    const [doer, victim, teller] = rows;
    hiddenCrime(w, doer!, victim!, day);
    const id = crimeSecrets(w.ctx, w.liege, day)[0]!;
    w.store.knowledge.put({ who: teller!.id, ref: secretRef(id), learned_day: day, source: "saw", accuracy: 1, variant: 0 });
    addGrievance(w.store, { who: teller!.id, against: doer!.id, cause: "test", weight: 1.2, day });
    config.choice.only = ["expose"] as never;
    choiceDay(w.ctx, { site: w.liege }, day);
    useDay(w.ctx, w.liege, day);
    const s = w.store.records.get<SecretData>(id)!;
    expect(s.data.exposed).toBeDefined();
    expect(w.store.records.get(`case:${id}`)).toBeDefined();
    expect(w.store.people.get(doer!.id)!.renown ?? 0).toBeLessThan(0);
  });
});

describe("N46 step 4: spies", () => {
  it("a kingdom's spy learns of a neighbour's war plans and the court acts on it", () => {
    const realm = generateRealm(1, 1);
    const [A, B] = Object.values(realm.kingdoms).sort((a, b) => a.id.localeCompare(b.id));
    const c = courtOf(realm);
    c.plans.push({ id: "wp-test", k: A!.id, against: B!.id, since: 1, ready: 60, known: [] });
    A!.opinion[B!.id] = -80;
    const spy = makeFigure(realm, seededRng(3), { name: "Testy Quill", role: "merchant", home: A!.capital, tier: "C", age: 30 }, 1);
    c.spies.push({ person: spy.id, for: B!.id, in: A!.id, since: 1, skill: 1, homeWas: B!.capital });
    let acted: (typeof c.reports)[number] | undefined;
    for (let d = 2; d < 59 && !acted; d++) {
      courtDaySecrets(realm, d);
      acted = c.reports.find((r) => r.acted && r.plan === "wp-test");
    }
    expect(acted).toBeDefined();
    expect(["strike", "prepare"]).toContain(acted!.acted!.how);
    expect(acted!.acted!.why).toMatch(/Testy Quill's report/);
    // Logged with the report as the cause.
    const news = realm.news.filter((n) => n.why?.includes("Testy Quill's report") || n.text.includes(B!.name));
    expect(news.length).toBeGreaterThan(0);
  });
});

describe("N46 step 5: plots and assassination", () => {
  it("a disputed succession ends in an assassination plot (found out, struck, or failed)", () => {
    let ended = 0;
    for (const seed of [1, 2, 3]) {
      const realm = generateRealm(seed, 1);
      const k = Object.values(realm.kingdoms).sort((a, b) => a.id.localeCompare(b.id))[0]!;
      courtDaySecrets(realm, 1);
      // A new ruler, and a better-known, ambitious noble of the realm who thinks it theirs.
      const rng = seededRng(seed);
      const ruler = makeFigure(realm, rng, { name: `Newking ${seed}`, role: "ruler", home: k.capital, tier: "C", age: 30, renown: 5 }, 2);
      k.ruler = ruler.id;
      const claimant = makeFigure(realm, rng, { name: `Claimant ${seed}`, role: "noble", home: k.capital, tier: "B", age: 40, renown: 60 }, 2);
      claimant.ambition = 0.9;
      const c = courtOf(realm);
      for (let d = 2; d < 600; d++) {
        courtDaySecrets(realm, d);
        const p = c.plots.find((x) => x.claimant === claimant.id);
        if (p?.end) {
          ended++;
          expect(["found", "struck", "failed"]).toContain(p.end.how);
          expect(realm.news.some((n) => n.kind === "plot")).toBe(true);
          break;
        }
      }
      expect(c.plots.some((x) => x.claimant === claimant.id)).toBe(true);
    }
    expect(ended).toBeGreaterThan(0);
  });
});

describe("N46 step 6: the player", () => {
  it("the player pries a secret out, sells it to a rival, who then uses it", () => {
    const w = world(1);
    const day = w.realm.day + 1;
    const rows = grown(w, w.liege);
    const [doer, victim, rival] = rows;
    hiddenCrime(w, doer!, victim!, day);
    const id = crimeSecrets(w.ctx, w.liege, day)[0]!;
    const p = { name: "Wren", money: 0, known: {}, skills: {} } as unknown as PlayerState;
    let found = false;
    for (let h = 0; h < 40 && !found; h++) {
      pry(w.ctx, p, doer!, day, h);
      found = !!p.known?.[secretRef(id)];
    }
    expect(found).toBe(true);
    addGrievance(w.store, { who: rival!.id, against: doer!.id, cause: "test", weight: 1, day });
    const lines = sellSecret(w.ctx, p, id, rival!, day);
    expect(lines[0]).toMatch(/pays you/);
    expect(p.money).toBeGreaterThan(0);
    expect(knowersOf(w.store, id)).toContain(rival!.id);
    config.choice.only = ["blackmail", "expose"] as never;
    choiceDay(w.ctx, { site: w.liege }, day + 1);
    expect(w.store.eventsAt(w.liege, day + 1, ["blackmail", "exposure"]).some((e) => e.actor === rival!.id && e.causedBy?.includes(id))).toBe(true);
  });

  it("the player can blackmail and expose like anyone", () => {
    const w = world(1);
    const day = w.realm.day + 1;
    const rows = grown(w, w.liege);
    hiddenCrime(w, rows[0]!, rows[1]!, day);
    const id = crimeSecrets(w.ctx, w.liege, day)[0]!;
    const p = { name: "Wren", money: 0, known: {}, skills: {} } as unknown as PlayerState;
    playerLearns(p, secretRef(id), "saw", day);
    const lines = blackmailBy(w.ctx, p, id, day);
    expect(lines.length).toBe(1);
    expect(w.store.records.get(`demand:${id}:player`)).toBeDefined();
    exposeBy(w.ctx, p, id, day, 12, [rows[2]!.id]);
    expect(w.store.records.get<SecretData>(id)!.data.exposed!.by).toBe("player");
  });
});
