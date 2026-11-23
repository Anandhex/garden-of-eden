import { beforeEach, describe, expect, it, vi } from "vitest";
import { UiModelSchema } from "@garden-of-eden/shared/view";
import { config } from "../src/config.js";
import { addGrievance } from "../src/game/chatter/grievance.js";
import { adjustRel } from "../src/game/chatter/rel.js";
import { loadCreatureTemplates } from "../src/game/creatures.js";
import { customsAt } from "../src/game/culture/day.js";
import { WorldStore } from "../src/game/db.js";
import { eventRef } from "../src/game/gossip/refs.js";
import { openPlayerCase } from "../src/game/law/player.js";
import { judgeOf } from "../src/game/law/sentence.js";
import { jail, jailedNow, type CaseData } from "../src/game/law/trial.js";
import { teacherAt } from "../src/game/magic/player.js";
import { giftCell, giftOf, spells } from "../src/game/magic/model.js";
import type { LifeCtx } from "../src/game/people/step.js";
import { playerKnows } from "../src/game/playerKnowledge.js";
import { declareWar } from "../src/game/realm/diplomacy.js";
import { generateRealm } from "../src/game/realm/generate.js";
import { newWorld } from "../src/game/save.js";
import { addSecret, type SecretData } from "../src/game/secrets/model.js";
import { sell } from "../src/game/setback/setback.js";
import { checkSocietyBounds } from "../src/game/society/bounds.js";
import { nextCourtDay, societyAct, societyView } from "../src/game/society/player.js";
import { denDay, denOf, foundGuilds, guildAt, wantsGuild, type DenData } from "../src/game/thieves/guilds.js";
import { Town } from "../src/game/town.js";
import { armiesRealmDay } from "../src/game/war/armies.js";
import type { PersonRow } from "../src/store/peopleStore.js";
import { materialisePeople } from "../src/store/materialise.js";
import { societySections } from "../src/view/ui.js";
import { FakeProvider } from "./helpers.js";

/**
 * N70: society in play. Every player action of N46–N55 is reached through the one `society` action (the same handler the web server and the
 * CLI call), driven here through a real Town: a slave escapes and comes home to a story; a case against the player is heard on court day,
 * and a judge is bought or charges them; secrets, the underworld, the law, magic, rumours, customs and the war each change the records their
 * own phase's test checks, and are refused with a reason where they can't be done; the panels' rows validate against the protocol's schema.
 */
vi.setConfig({ testTimeout: 600_000, hookTimeout: 600_000 });

beforeEach(() => {
  config.realm = true;
  config.realmSeed = undefined;
  config.director = false;
  config.planning = false;
  config.peopleLazy = "";
  config.firstHour = false;
  config.playerDefeat = "knockout";
  for (const k of ["secrets", "underworld", "trials", "magic", "cultures", "armies", "belief"] as const) config.society[k] = true;
});

function game(seed: number, start?: string) {
  const templates = loadCreatureTemplates();
  const store = new WorldStore(":memory:");
  const world = newWorld({}, templates, Math.random, seed, start ? { start } : {});
  materialisePeople(world.realm!, store.people, world.day);
  const town = new Town({ personas: {}, creatureTemplates: templates, world, llm: new FakeProvider(), store, stories: false });
  const ctx: LifeCtx = { realm: world.realm!, store };
  return { town, world, store, realm: world.realm!, ctx };
}
const grown = (store: WorldStore, site: string) => (store.people.loadSite(site, "full") as PersonRow[]).filter((r) => r.death === null && r.job !== "child" && !r.away).sort((a, b) => a.id.localeCompare(b.id));

describe("N70 step 1: the dead ends", () => {
  it("a player sold as a slave escapes with a helper, arrives in a free place, and is met at home by a story people have heard", () => {
    const { town, world, store, realm, ctx } = game(1);
    const p = world.player;
    p.money = 0;
    const home = town.site();
    const r = sell(ctx, p, { by: "slavers", site: home, day: world.day })!;
    expect(r).not.toBeNull();
    town.arriveAt(r.chapter.site);
    expect(town.site()).toBe(r.chapter.site);
    // Held: what a free person does is refused, with the reason.
    const someone = grown(store, r.chapter.site).find((x) => x.id !== r.master.id)!;
    const no = societyAct(town, "pry", { npc: someone.id });
    expect(no.ok).toBe(false);
    expect(no.lines[0]).toMatch(/held/);
    // No coin and no friend: buying freedom is offered but can't be done yet.
    expect(societyAct(town, "ransom", { confirm: true }).ok).toBe(false);
    // A fellow slave of the same master who hates them, and has come to like the player.
    const other = grown(store, r.chapter.site).find((x) => x.id !== r.master.id && x.id !== someone.id)!;
    store.people.update(other.id, { cls: "slave", master_id: r.master.id, job: "slave" });
    addGrievance(store, { who: other.id, against: r.master.id, cause: "the lash", weight: 0.9, day: world.day });
    adjustRel(store, other.id, "player", { affection: 45, trust: 30 }, world.day);
    const v = societyView(town, [])!;
    const exits = v.sections.find((s) => s.title === "You")!.rows.flatMap((x) => x.actions ?? []);
    expect(exits.map((a) => a.op)).toEqual(expect.arrayContaining(["escape", "ransom"]));
    // Once a day, within a season.
    let out = societyAct(town, "escape");
    for (let i = 0; !out.ok && i < 12; i++) {
      expect(societyAct(town, "escape").ok).toBe(false);
      world.day += 1;
      out = societyAct(town, "escape");
    }
    expect(out.ok).toBe(true);
    expect(p.chapter).toBeUndefined();
    const free = town.site();
    expect(free).not.toBe(r.chapter.site);
    const k = realm.settlements[free]!.kingdom;
    expect(free === home || (!!k && !realm.kingdoms[k]!.laws.slavery)).toBe(true);
    // Home: the story goes ahead of them.
    const lines = free === home ? out.lines : town.arriveAt(home);
    expect(lines.join(" ")).toMatch(/sold as a slave/);
    const story = p.society!.story.event as string;
    const knowers = store.knowledge.holders(eventRef(story)).map((x) => x.who);
    expect(knowers.length).toBeGreaterThan(2);
    for (const id of knowers) expect(store.people.get(id)!.site).toBe(home);
    expect(p.society!.homeward).toBeUndefined();
    town.close();
  });

  it("a case against the player is heard on court day; a greedy judge takes a bribe and drops one; an honest one opens a second case", () => {
    const { town, world, store, realm, ctx } = game(2);
    const site = town.site();
    const p = world.player;
    p.money = 2000;
    const witness = grown(store, site).find((r) => r.job === "guard") ?? grown(store, site)[0]!;
    // A sorcery case, as a spell seen cast where magic is banned opens one (N51).
    const c1 = openPlayerCase(ctx, p, "sorcery", site, world.day, [witness.id]);
    const row = societyView(town, [])!.sections.find((s) => s.title === "You")!.rows.find((x) => x.text.includes("A case against you"))!;
    expect(row.actions![0]!.op).toBe("bribejudge");
    const court = nextCourtDay(realm.seed, site, world.day + 1);
    world.day = court;
    const lines = town.realmNights(court - 1);
    expect(store.records.get<CaseData>(c1)!.ended).toBe(court);
    expect(lines.join(" ")).toMatch(/court/);
    // Bought: dropped.
    const judge = judgeOf(realm, site);
    expect(judge).not.toBeNull();
    judge!.greed = 0.9;
    judge!.loyalty = 0.2;
    const c2 = openPlayerCase(ctx, p, "sorcery", site, world.day, [witness.id]);
    const offer = societyAct(town, "bribejudge", { case: c2, amount: 300 });
    expect(offer.confirm).toBeDefined();
    expect(store.records.get(c2)!.ended).toBeNull();
    const paid = societyAct(town, "confirm");
    expect(paid.ok).toBe(true);
    expect(store.records.get(c2)!.status).toBe("dropped");
    // Honest: refused, charged with bribery on the spot (a second case, closed), and the first still stands.
    judge!.greed = 0.1;
    judge!.loyalty = 0.9;
    const c3 = openPlayerCase(ctx, p, "sorcery", site, world.day + 1, [witness.id]);
    world.day += 1;
    societyAct(town, "bribejudge", { case: c3, amount: 300 });
    const refused = societyAct(town, "confirm");
    expect(refused.ok).toBe(false);
    expect(refused.lines[0]).toMatch(/bribery/);
    expect(store.records.list<CaseData>("case", (c) => c.data.accused === "player" && c.data.crime === "bribery").length).toBe(1);
    expect(store.records.get(c3)!.ended).toBeNull();
    town.close();
  });
});

describe("N70 step 2: the society ops", () => {
  it("each op changes its phase's records, and is refused with a reason where it can't be done", () => {
    const realm0 = generateRealm(3, 1);
    const city = Object.values(realm0.settlements).filter((s) => wantsGuild(s)).sort((a, b) => b.population - a.population)[0]!.id;
    const { town, world, store, realm, ctx } = game(3, city);
    expect(town.site()).toBe(city);
    const p = world.player;
    p.money = 5000;
    const rows = grown(store, city);
    const [subject, buyer, listener, witness, prisoner, teacher, accused] = rows;
    // ---- Secrets (N46) ----
    const s1 = addSecret(store, { site: city, day: world.day, data: { what: "debt", about: subject!.id, text: `${subject!.name} owes the moneylender more than the house is worth`, weight: 5 }, key: "n70a" });
    const s2 = addSecret(store, { site: city, day: world.day, data: { what: "crime", about: subject!.id, text: `${subject!.name} took coin from the poor box`, weight: 6 }, key: "n70b" });
    expect(societyAct(town, "sellsecret", { secret: s1.id, npc: buyer!.id }).ok).toBe(false);
    for (let i = 0; i < 200 && !(playerKnows(p, `s:${s1.id}`) && playerKnows(p, `s:${s2.id}`)); i++) {
      world.hour = i % 24;
      if (world.hour === 0) world.day += 1;
      const r = societyAct(town, "pry", { npc: subject!.id });
      expect(r.ok).toBe(true);
      expect(r.hours).toBe(2);
    }
    expect(playerKnows(p, `s:${s1.id}`) && playerKnows(p, `s:${s2.id}`)).toBe(true);
    addGrievance(store, { who: buyer!.id, against: subject!.id, cause: "an old wrong", weight: 0.8, day: world.day });
    const before = p.money;
    expect(societyAct(town, "sellsecret", { secret: s1.id, npc: buyer!.id }).ok).toBe(true);
    expect(p.money).toBeGreaterThan(before);
    expect(store.knowledge.has(buyer!.id, `s:${s1.id}`)).toBe(true);
    expect(societyAct(town, "blackmail", { secret: s1.id }).confirm).toBeDefined();
    societyAct(town, "confirm");
    expect(store.records.has(`demand:${s1.id}:player`)).toBe(true);
    expect(societyAct(town, "expose", { secret: s2.id }).ok).toBe(true);
    expect(store.records.get<SecretData>(s2.id)!.data.exposed).toBeDefined();
    // ---- Rumours (N52) ----
    expect(societyAct(town, "plant", { npc: listener!.id, text: "nonsense" }).ok).toBe(false);
    expect(societyAct(town, "plant", { npc: listener!.id, text: `${subject!.name} stole the grain money` }).ok).toBe(true);
    expect(store.records.list("fabrication", (f) => f.a === "player" && f.b === subject!.id).length).toBe(1);
    societyAct(town, "frame", { npc: witness!.id, text: subject!.name, bribe: 300 });
    const framed = societyAct(town, "confirm");
    expect(framed.lines.length).toBeGreaterThan(0);
    if (framed.ok) expect(store.records.list("case", (c) => (c.data as { framedBy?: string }).framedBy === "player").length).toBe(1);
    // ---- The law (N48) ----
    expect(societyAct(town, "breakout", { npc: prisoner!.id }).ok).toBe(false);
    jail(store, prisoner!, world.day + 5, world.day, "theft");
    expect(societyAct(town, "breakout", { npc: prisoner!.id }).ok).toBe(true);
    expect(jailedNow(store, prisoner!.id, world.day)).toBeUndefined();
    // ---- Magic (N51) ----
    store.people.update(teacher!.id, { gift: giftCell({ gift: 3, schools: Object.fromEntries([...new Set(spells().map((s) => s.school))].map((sc) => [sc, 3])), role: "hedge", shown: 1 }) });
    const t = teacherAt(ctx, city)!;
    p.society = { ...(p.society ?? {}), magic: { gift: 0, schools: {} } };
    const sp = spells().find((s) => s.rank === 1 && s.cost.mp > 0 && s.cost.mp <= 50 && !s.cost.reagents?.length && (giftOf(t)?.schools[s.school] ?? 0) >= 1)!;
    societyAct(town, "learn", { spell: sp.id });
    expect(societyAct(town, "confirm").ok).toBe(false); // no gift: "nothing in you to teach"
    p.society.magic.gift = 2;
    societyAct(town, "learn", { spell: sp.id });
    const taught = societyAct(town, "confirm");
    expect(taught.ok).toBe(true);
    expect(p.society.magic.schools[sp.school]).toBeGreaterThanOrEqual(1);
    p.mp = 50;
    const cast = societyAct(town, "cast", { spell: sp.id });
    expect(cast.lines.length).toBeGreaterThan(0);
    expect(p.mp).toBeLessThan(50);
    // ---- Customs and taboos (N53) ----
    const cu = customsAt(realm, city);
    expect(societyAct(town, "custom", { custom: cu.customs[0] }).ok).toBe(true);
    expect(societyAct(town, "custom", { custom: "not_a_custom" }).ok).toBe(false);
    expect(societyAct(town, "taboo", { taboo: cu.taboos[0] }).ok).toBe(true);
    expect(p.society.learnedTaboos).toContain(`${cu.culture!.id}:${cu.taboos[0]}`);
    // ---- The underworld (N47) ----
    foundGuilds(realm, world.day);
    for (const d of [3, 6, 9, 12]) denDay(ctx, city, d);
    const guild = guildAt(realm, city)!;
    expect(guild).toBeDefined();
    expect(societyAct(town, "market").ok).toBe(false);
    const nope = societyAct(town, "joinguild");
    expect(nope.ok).toBe(false);
    expect(nope.lines[0]).toMatch(/who to ask/);
    // Shown the den (as a member who trusts them would): they can ask.
    const den = denOf(store, city)!;
    store.records.patch<DenData>(den.id, { data: { found: ["player"] } });
    expect(societyAct(town, "joinguild").ok).toBe(true);
    expect(societyAct(town, "market").ok).toBe(true);
    const papersBefore = p.inventory["forged_papers"] ?? 0;
    expect(societyAct(town, "buy", { offer: "papers" }).confirm).toBeDefined();
    expect(societyAct(town, "confirm").ok).toBe(true);
    expect(p.inventory["forged_papers"]).toBe(papersBefore + 1);
    // ---- The war (N55) ----
    societyAct(town, "enlist");
    expect(societyAct(town, "confirm").ok).toBe(false); // no war
    const mine = realm.settlements[city]!.kingdom!;
    const foe = Object.keys(realm.kingdoms).find((k) => k !== mine && !realm.kingdoms[k]!.species)!;
    declareWar(realm, [`k:${foe}`], [`k:${mine}`], world.day, "a test war");
    armiesRealmDay(realm, world.day);
    // ---- The panels: a place with a den, a court case and a war lists them, and the rows validate ----
    store.records.put<CaseData>({ id: `case:n70:${accused!.id}`, kind: "case", site: city, a: buyer!.id, b: accused!.id, since: world.day, status: "open", ended: null, data: { crime: "theft", accused: accused!.id, accuser: buyer!.id, witnesses: [buyer!.id] } });
    const v = societyView(town, rows.slice(0, 8).map((r) => r.id))!;
    const place = v.sections.find((s) => s.title.startsWith("Among the people"))!;
    const text = place.rows.map((r) => r.text).join(" ");
    expect(text).toMatch(/keep a den here/);
    expect(text).toMatch(/court/);
    expect(text).toMatch(/at war/);
    expect(place.rows.flatMap((r) => r.actions ?? []).map((a) => a.op)).toEqual(expect.arrayContaining(["enlist", "buy", "inform", "custom"]));
    expect(v.people[listener!.id]!.tools.map((a) => a.op)).toEqual(expect.arrayContaining(["pry", "plant", "frame"]));
    const sections = societySections(v, false);
    expect(() => UiModelSchema.shape.sheet.parse({ tabs: [{ id: "world", label: "World", sections }] })).not.toThrow();
    societyAct(town, "enlist");
    expect(societyAct(town, "confirm").ok).toBe(true);
    expect(p.society.army).toBeDefined();
    // Inform last: the members the player can name are taken.
    expect(societyAct(town, "inform").confirm).toBeDefined();
    expect(societyAct(town, "confirm").ok).toBe(true);
    expect(store.records.get<DenData>(den.id)!.data.arrests).toBeGreaterThan(0);
    // Unknown ops and cancelled offers.
    expect(societyAct(town, "fly").ok).toBe(false);
    societyAct(town, "enlist");
    expect(societyAct(town, "cancel").ok).toBe(true);
    expect(p.society.offer).toBeUndefined();
    // The new bounds run on this world.
    const bounds = checkSocietyBounds(realm, store);
    for (const name of ["rumours-die-out", "player-rumours-traced", "cultures-distinct", "levies-bounded", "nobody-serves-an-ended-war"]) expect(bounds.map((b) => b.name)).toContain(name);
    town.close();
  });
});
