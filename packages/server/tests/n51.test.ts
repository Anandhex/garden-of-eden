import { beforeEach, describe, expect, it, vi } from "vitest";
import { config } from "../src/config.js";
import { WorldStore } from "../src/game/db.js";
import { always } from "./helpers.js";
import { cast } from "../src/game/magic/cast.js";
import { giftLevel, magicRealmDay, magicSiteDay } from "../src/game/magic/day.js";
import { checkSpells, giftCell, giftOf, magicOf, mageBonus, rollGift, spells } from "../src/game/magic/model.js";
import { borderCheck, learnSpell, magicOfPlayer, playerCast } from "../src/game/magic/player.js";
import { epidemicsOf } from "../src/game/epidemic/model.js";
import { justiceDay } from "../src/game/law/justice.js";
import { beliefCell } from "../src/game/faith/model.js";
import type { LifeCtx } from "../src/game/people/step.js";
import { advanceWorld } from "../src/game/people/world.js";
import { generateRealm } from "../src/game/realm/generate.js";
import { fight, type Side } from "../src/game/realm/military.js";
import { makeFigure } from "../src/game/realm/figures.js";
import { decidePolicy, policyOf, policyRealmDay, setPolicy } from "../src/game/realm/policy.js";
import { courtOf } from "../src/game/secrets/court.js";
import { seededRng } from "../src/game/dice.js";
import type { PlayerState } from "../src/npc/types.js";
import type { PersonRow } from "../src/store/peopleStore.js";
import { materialisePeople } from "../src/store/materialise.js";
import { pickTestPlaces } from "./helpers.js";

/**
 * N51: magic. Gifts that show in childhood and a hedge witch who takes the child; schools and spells as data; casting with costs and
 * misfires; laws per school (licensed healers in a free kingdom, a witch burned after a plague in a slave one); court divinations that
 * weigh on rulers; a battle mage who tips a fight; the player learning a spell and hiding it across a border.
 */
vi.setConfig({ testTimeout: 300_000, hookTimeout: 300_000 });

beforeEach(() => {
  config.peopleLazy = "";
  config.realm = true;
  config.realmSeed = undefined;
  config.society.magic = true;
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

describe("N51 steps 1 and 4: a gift shown, a hedge witch's apprentice", () => {
  it("a child in the start town shows a gift, the household knows, and the hedge witch takes them as an apprentice", () => {
    const w = world(1, 2);
    const rows = living(w, w.start);
    // Gifted children (rolled from their ids: about 1 in 30); one is given a gift for the test if none was born with one.
    if (!rows.some((r) => r.job === "child" && giftLevel(w.ctx, r) >= 1)) w.store.people.update(rows.find((r) => r.job === "child")!.id, { gift: giftCell({ gift: 2, schools: {} }) });
    // A hedge witch: the first gifted grown person (one is made if none).
    if (!rows.some((r) => r.job !== "child" && giftLevel(w.ctx, r) >= 1)) w.store.people.update(rows.find((r) => r.job !== "child")!.id, { gift: giftCell({ gift: 1, schools: {} }) });
    setPolicy(w.realm, w.realm.settlements[w.start]!.kingdom!, "magic:healing", "licensed", 3, "test");
    let child: PersonRow | undefined;
    for (let d = 3; d < 600 && !child; d++) {
      const shown = magicSiteDay(w.ctx, { site: w.start }, d).shown;
      if (shown.length > 0) child = w.store.people.get(shown[0]!)!;
    }
    expect(child).toBeDefined();
    const e = w.store.recentEvents({ limit: 1000 }).find((x) => x.kind === "gift-shown" && x.actor === child!.id)!;
    expect(e.witnesses!.length).toBeGreaterThan(0);
    let taken = false;
    for (let d = 600; d < 610 && !taken; d++) taken = magicSiteDay(w.ctx, { site: w.start }, d).taken.includes(child!.id) || !!giftOf(w.store.people.get(child!.id)!)?.teacher;
    expect(taken).toBe(true);
    const witch = w.store.people.get(giftOf(w.store.people.get(child!.id)!)!.teacher!)!;
    expect(giftOf(witch)!.role).toBe("hedge");
    expect(w.store.recentEvents({ limit: 1000 }).some((x) => x.kind === "apprenticed" && x.actor === child!.id)).toBe(true);
  });

  it("gifts are rare, and likelier for a gifted parent's child", () => {
    const n = 4000;
    let any = 0;
    let fromGifted = 0;
    for (let i = 0; i < n; i++) {
      if (rollGift(7, `t_x_${i}`) > 0) any++;
      if (rollGift(7, `t_x_${i}`, 3) > 0) fromGifted++;
    }
    expect(any / n).toBeGreaterThan(0.01);
    expect(any / n).toBeLessThan(0.08);
    expect(fromGifted).toBeGreaterThan(any);
  });
});

describe("N51 steps 2–3: data and casting", () => {
  it("every spell passes its schema; a broken one fails with a clear message", () => {
    expect(spells().length).toBeGreaterThan(10);
    expect(checkSpells({ spells: spells() })).toEqual([]);
    expect(checkSpells({ spells: [{ ...spells()[0]!, school: "nonsense" }] })[0]).toMatch(/no school "nonsense"/);
  });

  it("a healing spell cures a fever; a misfire with a failing roll hurts the caster", () => {
    const caster = { mp: 30, hp: 20, maxHp: 20, inventory: { "wild herbs": 2 }, schools: { healing: 2, fire: 2 } };
    const sick = { hp: 10, maxHp: 20, illness: { id: "fever", day: 1, daysLeft: 3 } as never };
    const r = cast(null, caster, "cure_fever", sick, null, always(0.9));
    expect(r.ok).toBe(true);
    expect(sick.illness).toBeNull();
    expect(caster.inventory["wild herbs"]).toBe(1);
    const m = cast(null, caster, "firebolt", null, null, always(0));
    expect(m.misfire).toBe(true);
    expect(caster.hp).toBeLessThan(20);
  });
});

describe("N51 step 5: laws and witch hunts", () => {
  it("the free kingdom licenses healers while the slave kingdom burns a witch after a plague", () => {
    const w = world(1, 2);
    const ks = Object.values(w.realm.kingdoms);
    const free = ks.find((k) => !k.laws.slavery && !k.laws.serfdom)!;
    const slaveK = ks.find((k) => k.laws.slavery)!;
    setPolicy(w.realm, free.id, "magic:healing", "licensed", 3, "test");
    expect(policyOf(w.realm, free.id, "magic:healing")).toBe("licensed");
    // A plague in a place of the slave kingdom (N61's outbreaks; forced here), and a pious, harsh ruler.
    const sick = Object.values(w.realm.settlements).find((s) => s.kingdom === slaveK.id && !s.way)!;
    epidemicsOf(w.realm).outbreaks.push({ id: "ob-test", disease: "the sweating sickness", site: sick.id, since: 3, origin: sick.id, share: 0.3, dead: 4 });
    const ruler = w.realm.figures[slaveK.ruler!]!;
    ruler.bravery = 1;
    ruler.ambition = 1;
    ruler.loyalty = 0;
    for (let d = 6; d <= 60 && policyOf(w.realm, slaveK.id, "magic:beast", d) !== "burned"; d += 6) magicRealmDay(w.realm, d);
    expect(policyOf(w.realm, slaveK.id, "magic:beast")).toBe("burned");
    expect(w.realm.news.some((n) => n.kind === "policy" && /plague/.test(n.why ?? ""))).toBe(true);
    // A witch of a place there is denounced and burned.
    const live = new Set([sick.id]);
    advanceWorld(w.realm, w.store, w.realm.day + 1, { live });
    // (A new reign on the realm's day may have weighed the law again: the hunt below is under the plague's law.)
    setPolicy(w.realm, slaveK.id, "magic:beast", "burned", 61, "after the plague");
    const rows = living(w, sick.id).filter((r) => r.job !== "child");
    const witch = rows[0]!;
    w.store.people.update(witch.id, { gift: giftCell({ gift: 2, schools: { growth: 2, healing: 1 }, role: "hedge", shown: 1 }) });
    for (const r of rows.slice(1, 20)) w.store.people.update(r.id, { faith: beliefCell("x", 0.9) });
    setPolicy(w.realm, slaveK.id, "punishments", "harsh", 61, "test");
    let burned = false;
    for (let d = 62; d < 200 && !burned; d++) {
      magicSiteDay(w.ctx, { site: sick.id }, d);
      justiceDay(w.realm, w.store, sick.id, d);
      magicSiteDay(w.ctx, { site: sick.id }, d);
      burned = w.store.recentEvents({ limit: 2000 }).some((e) => e.kind === "witch-hunt" && /burned/.test(e.details));
      if (w.store.people.get(witch.id)!.death === null && w.store.records.get(`case:sorcery:${witch.id}`)?.ended !== null && w.store.records.get(`case:sorcery:${witch.id}`)) w.store.records.remove(`case:sorcery:${witch.id}`);
    }
    expect(w.store.recentEvents({ limit: 2000 }).some((e) => e.kind === "witch-hunt" && e.target === witch.id)).toBe(true);
    expect(burned).toBe(true);
  });
});

describe("N51 step 6: mages in the world", () => {
  it("a court wizard's divination changes a ruler's decision, logged", () => {
    let changed = 0;
    for (const seed of [1, 2, 3, 4, 5]) {
      const run = (divine: boolean) => {
        const realm = generateRealm(seed, 1);
        policyRealmDay(realm, 1);
        magicRealmDay(realm, 1);
        const [k, foe] = Object.values(realm.kingdoms).sort((a, b) => a.id.localeCompare(b.id));
        if (divine) {
          courtOf(realm).plans.push({ id: "wp-x", k: foe!.id, against: k!.id, since: 1, ready: 40, known: [] });
          for (let d = 2; d <= 15; d++) magicRealmDay(realm, d);
        }
        const ch = decidePolicy(realm, k!.id, "levy", 16, "test");
        return { value: policyOf(realm, k!.id, "levy", 16), why: ch?.why ?? "", div: magicOf(realm).divinations.at(-1) };
      };
      const a = run(false);
      const b = run(true);
      if (a.value !== b.value) {
        changed++;
        expect(b.value).toBe("heavy");
        expect(b.why).toMatch(/divination foresaw war/);
      }
    }
    expect(changed).toBeGreaterThan(0);
  });

  it("a battle mage turns a battle, within the cap", () => {
    const realm = generateRealm(1, 1);
    const rng = seededRng(1);
    const mage = makeFigure(realm, rng, { name: "Testa Flame", role: "captain", home: null, tier: "D", age: 30 }, 1);
    const side = (fighters: never[], strength = 100): Side => ({ name: "x", strength, fighters, men: 10, home: null, species: "human", rank: "G" });
    const without = fight(realm, side([mage] as never), side([]), 1, always(0.51), "a test fight");
    magicOf(realm).mages[mage.id] = { schools: { fire: 2 }, role: "battle" };
    const withMage = fight(realm, side([mage] as never), side([]), 1, always(0.51), "a test fight");
    expect(without.attackerWon).toBe(false);
    expect(withMage.attackerWon).toBe(true);
    expect(mageBonus(realm, Array(5).fill(mage))).toBeLessThanOrEqual(1.15);
  });
});

describe("N51 step 7: the player's magic", () => {
  it("the player learns a minor spell and must hide it when crossing into a kingdom that bans it", () => {
    const w = world(1, 2);
    const rows = living(w, w.start);
    const witch = rows.find((r) => r.job !== "child")!;
    w.store.people.update(witch.id, { gift: giftCell({ gift: 2, schools: { healing: 2, growth: 1 }, role: "hedge", shown: 1 }) });
    const p = { name: "Wren", money: 200, hp: 20, maxHp: 20, mp: 20, maxMp: 20, inventory: { "grimoire of mending": 1 }, society: { magic: { gift: 1, schools: {} } } } as unknown as PlayerState;
    expect(learnSpell(w.ctx, p, w.start, "mend", 3)[0]).toMatch(/teaches you Mend/);
    expect(magicOfPlayer(w.realm.seed, p).schools.healing).toBe(1);
    // Over the border, where healing is burned.
    const other = Object.values(w.realm.settlements).find((s) => s.kingdom && s.kingdom !== w.realm.settlements[w.start]!.kingdom && !s.way)!;
    setPolicy(w.realm, other.kingdom!, "magic:healing", "burned", 3, "test");
    let found = false;
    for (let d = 3; d < 20 && !found; d++) {
      p.inventory = { "grimoire of mending": 1 };
      const lines = borderCheck(w.ctx, p, w.start, other.id, d);
      expect(lines[0]).toMatch(/forbidden/);
      found = lines.some((l) => /find the grimoire/.test(l));
    }
    expect(found).toBe(true);
    // Casting it there in sight of people opens a case.
    p.mp = 20;
    const r = playerCast(w.ctx, p, "mend", other.id, 20, 12, ["t_someone"], null, always(0.9));
    expect(r.caseId).toBeDefined();
    expect((p.society!.cases as string[]).some((c) => c.includes("sorcery"))).toBe(true);
  });
});
