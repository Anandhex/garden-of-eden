import { beforeEach, describe, expect, it, vi } from "vitest";
import { config } from "../src/config.js";
import { WorldStore } from "../src/game/db.js";
import { temperOf } from "../src/game/chatter/person.js";
import type { LifeCtx } from "../src/game/people/step.js";
import { advanceWorld } from "../src/game/people/world.js";
import { generateRealm } from "../src/game/realm/generate.js";
import { setPolicy } from "../src/game/realm/policy.js";
import { bribeGuard, bribeThreshold, crackdownsDay, smuggleArrivals, smuggleDay } from "../src/game/thieves/crime.js";
import { blackMarket, buyBlack, informOn, joinGuild } from "../src/game/thieves/day.js";
import { denOf, guildAt, wantsGuild, type DenData } from "../src/game/thieves/guilds.js";
import { hateOn } from "../src/game/chatter/grievance.js";
import type { PlayerState } from "../src/npc/types.js";
import type { PersonRow } from "../src/store/peopleStore.js";
import { materialisePeople } from "../src/store/materialise.js";

/**
 * N47: the underworld. Thieves' guilds in the cities with dens and members who are the place's own people, thefts and fencing, a black
 * market for those it trusts, smuggling past curfews, guards with a price, crackdowns that jail members, and a player who joins or informs.
 */
vi.setConfig({ testTimeout: 300_000, hookTimeout: 300_000 });

beforeEach(() => {
  config.peopleLazy = "";
  config.realm = true;
  config.realmSeed = undefined;
  config.society.underworld = true;
});

/** A city and the places around it, living. */
function world(seed = 1, days = 30) {
  const realm = generateRealm(seed, 1);
  const store = new WorldStore(":memory:");
  materialisePeople(realm, store.people, 1);
  const city = Object.values(realm.settlements).filter((s) => wantsGuild(s)).sort((a, b) => b.population - a.population)[0]!;
  const live = new Set([city.id, ...city.roads.filter((r) => !realm.settlements[r]!.way)]);
  const ctx: LifeCtx = { realm, store };
  advanceWorld(realm, store, days, { live });
  return { realm, store, live, ctx, city: city.id };
}
type W = ReturnType<typeof world>;
const living = (w: W, site: string) => (w.store.people.loadSite(site, "full") as PersonRow[]).filter((r) => r.death === null);

describe("N47 steps 1–2: guilds that steal and fence", () => {
  let w: W;
  it("a city has a thieves' guild with a den and members who are its own people; over a month it steals and fences", () => {
    w = world(1, 40);
    const guild = guildAt(w.realm, w.city)!;
    expect(guild).toBeDefined();
    expect(guild.trade).toBe("thieves");
    const den = denOf(w.store, w.city)!;
    expect(den).toBeDefined();
    const members = living(w, w.city).filter((r) => r.faction === guild.id);
    expect(members.length).toBeGreaterThanOrEqual(3);
    for (const m of members) expect(Object.keys(den.data.ranks)).toContain(m.id);
    const d = w.store.records.get<DenData>(den.id)!;
    expect(d.data.thefts).toBeGreaterThan(0);
    expect(d.data.fenced).toBeGreaterThan(0);
    const thefts = w.store.recentEvents({ limit: 5000 }).filter((e) => e.kind === "theft" && e.site === w.city);
    expect(thefts.length).toBeGreaterThan(0);
    // Every victim is a real person of the place.
    for (const e of thefts) expect(w.store.people.get(e.target!)).not.toBeNull();
    expect(w.store.recentEvents({ limit: 5000 }).some((e) => e.kind === "fenced" && e.site === w.city)).toBe(true);
    // The fence's coin came into the guild through the books.
    expect(w.realm.coin.lines.some((l) => l.why.startsWith("stolen goods fenced")) || w.realm.factions[guild.id]!.wealth > 0).toBe(true);
  });
});

describe("N47 step 3: the black market", () => {
  it("sells banned goods at a premium, only to those the guild trusts", () => {
    const w = world(1, 3);
    const day = w.realm.day;
    setPolicy(w.realm, w.realm.settlements[w.city]!.kingdom!, "magic:necromancy", "banned", day, "test");
    const offers = blackMarket(w.ctx, w.city, day);
    const banned = offers.find((o) => o.kind === "banned")!;
    expect(banned).toBeDefined();
    const p = { name: "Wren", money: 500, standing: {}, factions: [] } as unknown as PlayerState;
    expect(buyBlack(w.ctx, p, w.city, banned.id, day)[0]).toMatch(/Nobody/);
    joinGuild(w.ctx, p, w.city, day);
    expect(buyBlack(w.ctx, p, w.city, banned.id, day)[0]).toMatch(/You buy/);
    expect(p.money).toBe(500 - banned.price);
    // A crackdown makes it dearer.
    setPolicy(w.realm, w.realm.settlements[w.city]!.kingdom!, "crackdown", "on", day, "test", day + 5);
    expect(blackMarket(w.ctx, w.city, day).find((o) => o.id === banned.id)!.price).toBeGreaterThan(banned.price);
  });
});

describe("N47 step 4: smuggling", () => {
  it("a smuggler slips goods past a curfew", () => {
    const w = world(1, 3);
    let day = w.realm.day + 1;
    const near = w.realm.settlements[w.city]!.roads.map((id) => w.realm.settlements[id]!).find((s) => !s.way && s.kingdom)!;
    let slipped = false;
    for (let i = 0; i < 40 && !slipped; i++, day += 7) {
      setPolicy(w.realm, near.kingdom!, "curfew", "dusk", day, "unrest", day + 30);
      const id = smuggleDay(w.ctx, w.city, day);
      if (!id) continue;
      const run = w.store.records.get<{ arrives: number }>(id)!;
      const out = smuggleArrivals(w.ctx, run.data.arrives);
      if (out.some((o) => o.how.includes("curfew"))) slipped = true;
    }
    expect(slipped).toBe(true);
    expect(w.realm.news.some((n) => n.kind === "smuggling" && /curfew/.test(n.text))).toBe(true);
  });
});

describe("N47 step 5: corruption", () => {
  it("a guard is bribed to look away: a greedy, poorly paid one takes it, an honest one reports it", () => {
    const w = world(1, 3);
    const day = w.realm.day + 1;
    const guards = living(w, w.city).filter((r) => r.job === "guard");
    expect(guards.length).toBeGreaterThan(1);
    const sorted = [...guards].sort((a, b) => temperOf(a).honesty - temperOf(b).honesty);
    const crooked = sorted[0]!;
    const honest = sorted[sorted.length - 1]!;
    expect(bribeThreshold(w.ctx, crooked, day)).toBeLessThan(bribeThreshold(w.ctx, honest, day));
    const took = bribeGuard(w.ctx, crooked, "player", bribeThreshold(w.ctx, crooked, day), "look away", day);
    expect(took.taken).toBe(true);
    expect(w.store.eventsAt(w.city, day, ["bribe"]).some((e) => e.actor === crooked.id)).toBe(true);
    if (temperOf(honest).honesty >= 0.5) {
      const r = bribeGuard(w.ctx, honest, "player", 5, "look away", day);
      expect(r.taken).toBe(false);
      expect(r.reported).toBe(true);
    }
  });
});

describe("N47 step 6: crackdowns", () => {
  it("a crackdown jails some of the guild", () => {
    const w = world(1, 30);
    const guild = guildAt(w.realm, w.city)!;
    const before = living(w, w.city).filter((r) => r.faction === guild.id).length;
    setPolicy(w.realm, w.realm.settlements[w.city]!.kingdom!, "crackdown", "on", w.realm.day + 1, "thefts", w.realm.day + 40);
    advanceWorld(w.realm, w.store, w.realm.day + 30, { live: w.live });
    const arrests = w.store.recentEvents({ limit: 5000 }).filter((e) => e.kind === "crackdown" && e.site === w.city);
    expect(arrests.length).toBeGreaterThan(0);
    // Each went before the law.
    const sentenced = w.store.recentEvents({ limit: 5000 }).filter((e) => e.kind === "sentence" && arrests.some((a) => a.actor === e.actor));
    expect(sentenced.length).toBe(arrests.length);
    expect(before).toBeGreaterThan(0);
  });

  it("a crown cracks down when its towns suffer a run of thefts", () => {
    const w = world(1, 3);
    const den = denOf(w.store, w.city)!;
    w.store.records.patch<DenData>(den.id, { data: { thefts: 500 } });
    const day = 48;
    crackdownsDay(w.realm, w.store, day);
    expect(w.realm.news.some((n) => n.kind === "policy" && /cracking down/.test(n.text))).toBe(true);
  });
});

describe("N47 step 7: the player", () => {
  it("informing gets members arrested and gives the guild a grievance against the player", () => {
    const w = world(1, 10);
    const day = w.realm.day + 1;
    const guild = guildAt(w.realm, w.city)!;
    const members = living(w, w.city).filter((r) => r.faction === guild.id);
    const p = { name: "Wren", money: 0, standing: {}, factions: [] } as unknown as PlayerState;
    informOn(w.ctx, p, w.city, day);
    const taken = w.store.eventsAt(w.city, day, ["crackdown"]);
    expect(taken.length).toBeGreaterThan(0);
    const rest = members.filter((m) => !taken.some((e) => e.actor === m.id));
    expect(rest.some((m) => hateOn(w.store, m.id, "player", day) > 0.3)).toBe(true);
    expect(p.standing![guild.id]).toBeLessThan(0);
  });
});
