import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { config } from "../src/config.js";
import { loadCreatureTemplates, spawnCreature } from "../src/game/creatures.js";
import { deathNewsId, describeDeathBeliefs, newsHeard } from "../src/game/deathNews.js";
import { seededRng } from "../src/game/dice.js";
import { gossipTogether } from "../src/game/gossip.js";
import { advanceRealm, realmDay } from "../src/game/realm/day.js";
import { candidates, directorDay, inventedWords, nameFaction, needsOf } from "../src/game/realm/director.js";
import { atPeace, declareWar, endWar, ongoing, raid, raidTarget, sign } from "../src/game/realm/diplomacy.js";
import { buildCost, economyDay, neededBuilding } from "../src/game/realm/economy.js";
import { foundFaction, join as joinFaction, membersOf, rankIn, split } from "../src/game/realm/factions.js";
import { chainOf, figurePower, killFigure, makeFigure, titled } from "../src/game/realm/figures.js";
import { generateRealm, lieges, neighbours, travelDays } from "../src/game/realm/generate.js";
import { applyArrivals, sendArrival } from "../src/game/realm/arrivals.js";
import { postNeedQuests } from "../src/game/realm/needs.js";
import { syncTalkers } from "../src/game/realm/sync.js";
import { pickStartSite } from "../src/game/realm/start.js";
import { hear, realmNews, reachesAt } from "../src/game/realm/log.js";
import { settlementSide } from "../src/game/realm/military.js";
import { deliverNews, realmNewsId } from "../src/game/realm/news.js";
import { breakAway, isTaxDay, settleTransit, successionDay, taxDay, TAX_DAYS } from "../src/game/realm/politics.js";
import { breedCreatures, castCrowd, nameRisers, personaFor, readyToTalk, TALKER_RENOWN } from "../src/game/realm/rise.js";
import { RealmSchema, type Realm } from "../src/game/realm/types.js";
import { describeRealm, realmView } from "../src/game/realm/view.js";
import { delve, dungeonsInReach, GUILD_FEE, joinGuild, packsDay, playerDelve } from "../src/game/realm/wilds.js";
import { loadWorld, SAVE_VERSION, saveWorld } from "../src/game/save.js";
import { buildTurnMessage } from "../src/npc/persona.js";
import { loadTemplates } from "../src/npc/templates.js";
import { always, brena, FakeProvider, hale, makeTown, pell, say, wren } from "./helpers.js";

beforeEach(() => {
  config.director = false;
  config.planning = false;
  config.summaries = false;
  config.realm = true;
});

const fresh = (seed = 1): Realm => generateRealm(seed, 1);
/** The start town of a realm (the one the seed picks): the place these tests stand in. */
const startOf = (r: Realm) => pickStartSite(r, r.seed);
const home = (r: Realm) => r.settlements[startOf(r)]!;
/** A pack and a dungeon near the start town, if the realm did not put any there. */
function withWilds(r: Realm) {
  const site = startOf(r);
  const pack = Object.values(r.packs).find((p) => p.near === site) ?? (r.packs.pack_start = { id: "pack_start", species: "wolf", near: site, count: 6, cap: 8, tier: "F", alpha: null, bounty: 0 });
  const dungeon = Object.values(r.dungeons).find((d) => d.near === site) ?? (r.dungeons.deeps_start = { id: "deeps_start", name: "the Test Deeps", near: site, pos: { x: 0, y: 0 }, tier: "F", depth: 2, danger: 50, treasure: 600, bounty: 0, delves: 0 });
  return { site, pack, dungeon };
}

describe("N13.0 death is news, not telepathy", () => {
  it("those at the forge know at once; Hale at the gate doesn't, thinks Brena's alive, and gossip brings it to him", () => {
    const town = makeTown();
    const world = town.world;
    world.hour = 10;
    const b = town.agents.brena!.state;
    b.outcome = "dead";
    b.deathCause = "old age";
    town.consequences();
    const id = deathNewsId("brena");
    expect(town.agents.wren!.state.learned[id]).toBe("certain");
    expect(town.agents.hale!.state.learned[id]).toBeUndefined();
    // Hale doesn't grieve yet; Wren does.
    expect(town.agents.wren!.state.emotions.some((e) => e.kind === "grief")).toBe(true);
    expect(town.agents.hale!.state.emotions.some((e) => e.kind === "grief")).toBe(false);
    // His prompt: no death in the news, and when asked, he thinks she's alive.
    expect(newsHeard(town.agents.hale!.state, world.recentEvents)).not.toContain(id);
    const msg = buildTurnMessage(hale, town.agents.hale!.state, world, "Have you seen Brena today?");
    expect(msg).toMatch(/As far as you know, Brena Ashford is alive/);
    expect(msg).not.toMatch(/Brena Ashford died/);
    expect(describeDeathBeliefs(town.agents.wren!.state, world, "Brena?", "wren")).toMatch(/Brena Ashford is dead/);
    // Supper at the inn: Wren tells him.
    const members = [
      { id: "wren", persona: wren, state: town.agents.wren!.state },
      { id: "hale", persona: hale, state: town.agents.hale!.state },
    ];
    gossipTogether(members, world.day, always(0), world);
    expect(town.agents.hale!.state.learned[id]).toBeDefined();
    // He wasn't her friend, so no grief; but he remembers it now.
    expect(town.agents.hale!.state.memories.some((m) => m.id === "death-brena")).toBe(true);
    expect(buildTurnMessage(hale, town.agents.hale!.state, world, "Have you seen Brena today?")).not.toMatch(/As far as you know/);
  });

  it("a rumour is told as a rumour", () => {
    const town = makeTown();
    town.world.hour = 10;
    town.agents.brena!.state.outcome = "dead";
    town.agents.brena!.state.deathCause = "old age";
    town.consequences();
    town.agents.pell!.state.learned[deathNewsId("brena")] = "rumour";
    expect(describeDeathBeliefs(town.agents.pell!.state, town.world, "What happened to Brena?", "pell")).toMatch(/rumour that Brena Ashford died/);
  });
});

describe("N13.1 the realm and its people", () => {
  it("three kingdoms, two dozen places and more, the start town under a chain of lords up to a capital", () => {
    const r = fresh();
    expect(RealmSchema.safeParse(r).success).toBe(true);
    expect(Object.keys(r.kingdoms)).toHaveLength(3);
    expect(Object.keys(r.settlements).length).toBeGreaterThanOrEqual(24);
    expect(Object.values(r.figures).filter((f) => f.alive).length).toBeGreaterThanOrEqual(100);
    const mb = home(r);
    expect(["village", "town"]).toContain(mb.kind);
    expect(mb.buildings.inn).toBeGreaterThan(0);
    expect(mb.buildings.smithy).toBeGreaterThan(0);
    expect(mb.roads.length).toBeGreaterThanOrEqual(2);
    const chain = lieges(r, startOf(r));
    expect(chain.at(-1)!.kind).toBe("capital");
    expect(travelDays(r, chain.at(-1)!.id, startOf(r))).toBeGreaterThanOrEqual(1);
    for (const s of Object.values(r.settlements)) expect(s.leader, s.name).not.toBeNull();
    // Same seed, same realm; another seed, another.
    expect(JSON.stringify(fresh(1))).toBe(JSON.stringify(r));
    expect(JSON.stringify(fresh(2))).not.toBe(JSON.stringify(r));
  });

  it("figures age and die by the same rules as everyone, and deaths are news", () => {
    const r = fresh();
    const f = Object.values(r.figures).find((x) => x.role === "farmer")!;
    f.life.bornOnDay = -95 * config.daysPerYear; // older than any human lives
    realmDay(r, 2, seededRng(1));
    expect(f.alive).toBe(false);
    expect(f.deathCause).toBe("old age");
  });
});

describe("N13.2 prosperity, building and moving", () => {
  it("a hungry place builds farms; the building finishes and raises a level", () => {
    const r = fresh();
    const s = home(r);
    s.food = 20;
    s.treasury = 100_000;
    s.lastRaided = undefined;
    for (const p of Object.values(r.packs)) if (p.near === startOf(r)) p.count = 0;
    expect(neededBuilding(r, s, 1)?.building).toBe("farms");
    const before = s.buildings.farms ?? 0;
    economyDay(r, 2, seededRng(2));
    expect(s.project?.building).toBe("farms");
    const done = s.project!.done;
    expect(s.treasury).toBeLessThan(100_000);
    for (let d = 3; d <= done; d++) economyDay(r, d, seededRng(d));
    expect(s.buildings.farms).toBe(before + 1);
    expect(r.stats.buildings).toBeGreaterThanOrEqual(1);
  });

  it("a grown place is promoted, and people leave poor places for better ones", () => {
    const r = fresh();
    const v = Object.values(r.settlements).find((s) => s.kind === "village" && s.id !== startOf(r))!;
    v.population = 500;
    economyDay(r, 2, seededRng(3));
    expect(v.kind).toBe("town");
    const poor = Object.values(r.settlements).find((s) => s.kind === "village" && s.id !== startOf(r) && neighbours(r, s.id).length > 0)!;
    const rich = neighbours(r, poor.id)[0]!;
    poor.population = 300;
    poor.prosperity = 10;
    rich.prosperity = 90;
    rich.food = 90;
    const was = rich.population;
    economyDay(r, 3, seededRng(4));
    expect(rich.population).toBeGreaterThan(was);
    expect(r.stats.migrants).toBeGreaterThan(0);
  });

  it("building costs grow with the level and the place", () => {
    const r = fresh();
    const s = home(r);
    const town = lieges(r, startOf(r))[0]!;
    expect(buildCost(town, "walls")).toBeGreaterThan(buildCost(s, "walls"));
  });
});

describe("N13.3 hierarchy and taxes", () => {
  it("the chain runs from a hamlet's elder to the crown; taxes climb it on tax days", () => {
    const r = fresh();
    const hamlet = Object.values(r.settlements).find((s) => s.kind === "hamlet")!;
    const chain = chainOf(r, hamlet.leader!);
    expect(chain.at(-1)!.role).toBe("ruler");
    expect(isTaxDay(TAX_DAYS)).toBe(true);
    const mb = home(r);
    const crown = lieges(r, startOf(r)).at(-1)!;
    r.figures[mb.leader!]!.greed = 0.1;
    const before = { mb: mb.treasury, crown: crown.treasury };
    taxDay(r, TAX_DAYS, seededRng(1));
    expect(mb.treasury).toBeLessThan(before.mb);
    // The coin goes up the road with a clerk; with none to send it is handed over a day later.
    settleTransit(r, TAX_DAYS + 1);
    // The capital pays no one: it ends up with what came up the chain.
    expect(crown.treasury).toBeGreaterThan(before.crown);
    expect(r.stats.taxes).toBeGreaterThan(0);
  });

  it("a greedy, disloyal head won't pay; behind enough and strong enough, they break away and the crown goes to war", () => {
    const r = fresh();
    const town = Object.values(r.settlements).find((s) => s.kind === "town" && !lieges(r, startOf(r)).includes(s) && s.id !== startOf(r))!;
    const lead = r.figures[town.leader!]!;
    lead.greed = 0.9;
    lead.loyalty = 0.1;
    lead.ambition = 0.9;
    town.population = 3000;
    const liege = r.settlements[town.liege!]!;
    liege.population = 100;
    for (let i = 1; i <= 3; i++) taxDay(r, TAX_DAYS * i, seededRng(i));
    expect(town.freeSince).toBeDefined();
    expect(town.kingdom).toBeNull();
    expect(ongoing(r).some((w) => w.defenders.includes(`s:${town.id}`))).toBe(true);
    expect(Object.values(r.factions).some((f) => f.kind === "rebels" && f.leader === lead.id)).toBe(true);
  });

  it("a dead head's heir takes over; a dead ruler's heir becomes king or queen", () => {
    const r = fresh();
    const k = Object.values(r.kingdoms)[0]!;
    const ruler = r.figures[k.ruler!]!;
    killFigure(r, ruler, 2, "a fall from a horse");
    successionDay(r, 2, seededRng(5));
    expect(k.ruler).not.toBeNull();
    expect(k.ruler).not.toBe(ruler.id);
    expect(r.figures[k.ruler!]!.role).toBe("ruler");
    expect(titled(r.figures[k.ruler!]!)).toMatch(/^(King|Queen) /);
  });

  it("breakAway frees the place and those under it", () => {
    const r = fresh();
    const town = lieges(r, startOf(r))[0]!;
    breakAway(r, town, 3, seededRng(1));
    expect(town.kingdom).toBeNull();
    expect(home(r).kingdom).toBeNull();
  });
});

describe("N13.4 factions, guilds and splits", () => {
  it("founding, a hierarchy inside, a split with followers and a grudge", () => {
    const r = fresh();
    const s = lieges(r, startOf(r))[0]!;
    const founder = makeFigure(r, seededRng(1), { role: "merchant", home: s.id, tier: "D", age: 40 }, 1);
    const fac = foundFaction(r, seededRng(2), { kind: "guild", trade: "merchants", founder, seat: s.id, creed: "fair scales", why: "testing" }, 1);
    expect(fac.leader).toBe(founder.id);
    expect(founder.role).toBe("guildmaster");
    const lt = makeFigure(r, seededRng(3), { role: "merchant", home: s.id, tier: "C", age: 30, renown: 60 }, 1);
    for (let i = 0; i < 4; i++) joinFaction(r, makeFigure(r, seededRng(10 + i), { role: "merchant", home: s.id, tier: "F", age: 25 }, 1), fac);
    joinFaction(r, lt, fac);
    for (const m of membersOf(r, fac)) if (m !== founder && m !== lt) m.loyalty = 0.1;
    expect(rankIn(r, fac, founder.id)).toBe("guildmaster");
    expect(rankIn(r, fac, lt.id)).toBe("master");
    const out = split(r, fac, lt, 2, seededRng(4), "ambition");
    expect(out.parent).toBe(fac.id);
    expect(out.leader).toBe(lt.id);
    expect(out.members.length).toBeGreaterThan(1);
    expect(fac.stances[out.id]).toBeLessThan(0);
    expect(r.stats.splits).toBe(1);
  });

  it("the director founds a gang where people starve and a guild where monsters gather", () => {
    const r = fresh();
    const v = Object.values(r.settlements).find((s) => s.kind === "village" && s.id !== startOf(r))!;
    v.prosperity = 10;
    v.food = 5;
    for (const f of Object.values(r.factions)) if (f.kind === "gang") f.dissolved = 1;
    const kinds = candidates(r, 2, seededRng(1)).filter((c) => c.target === v.id).map((c) => c.kind);
    expect(kinds).toContain("found_gang");
    const before = Object.keys(r.factions).length;
    for (let d = 2; d < 12 && Object.keys(r.factions).length === before; d++) directorDay(r, d, seededRng(d));
    expect(Object.keys(r.factions).length).toBeGreaterThan(before);
    expect(r.director.length).toBeGreaterThan(0);
  });

  it("the model may rename a faction, but only with names the realm knows", async () => {
    const r = fresh();
    const s = lieges(r, startOf(r))[0]!;
    const founder = makeFigure(r, seededRng(1), { role: "adventurer", home: s.id, tier: "D", age: 40 }, 1);
    const fac = foundFaction(r, seededRng(2), { kind: "guild", trade: "adventurers", founder, seat: s.id, creed: "x", why: "y" }, 1);
    const bad = new FakeProvider([{ text: '{"name":"the Blades of Zarathor","creed":"glory"}', toolCalls: [] }, { text: '{"name":"the Blades of Zarathor","creed":"glory"}', toolCalls: [] }]);
    expect(await nameFaction(bad, r, fac.id)).toBe(false);
    const good = new FakeProvider([{ text: `{"name":"the Lantern Blades of ${s.name}","creed":"light in the deep places"}`, toolCalls: [] }]);
    expect(await nameFaction(good, r, fac.id)).toBe(true);
    expect(fac.name).toBe(`the Lantern Blades of ${s.name}`);
    expect(inventedWords("the Blades of Zarathor", [s.name])).toEqual(["Zarathor"]);
  });
});

describe("N13.5 treaties, raids and wars", () => {
  it("a pact keeps raiders off; without one, the weak are raided and lose coin", () => {
    const r = fresh();
    const mb = home(r);
    const raider = neighbours(r, startOf(r)).find((n) => n.kingdom === mb.kingdom)!;
    raider.population = 4000;
    mb.population = 30;
    mb.treasury = 10_000;
    const attack = settlementSide(r, raider, { defending: false }).strength;
    expect(raidTarget(r, [`s:${raider.id}`], raider.id, attack, 2)?.id).toBeDefined();
    sign(r, "non_aggression", `s:${raider.id}`, `s:${startOf(r)}`, 2, 30, "testing");
    expect(atPeace(r, [`s:${raider.id}`], [`s:${startOf(r)}`], 2)).toBe(true);
    const targets = [raider, ...neighbours(r, raider.id)].filter((x) => x.id !== raider.id);
    expect(raidTarget(r, [`s:${raider.id}`], raider.id, attack, 2)?.id === startOf(r)).toBe(false);
    void targets;
    // A raid on the town (no pact for the gang) brings raiders to its map.
    const won = raid(r, settlementSide(r, raider, { defending: false }), `f:gang_test`, mb, 3, () => 0.01, "testing");
    expect(won).toBe(true);
    expect(mb.treasury).toBeLessThan(10_000);
    expect(mb.lastRaided).toBe(3);
    expect(r.arrivals[startOf(r)]?.some((e) => e.kind === "raid")).toBe(true);
  });

  it("a war: allies with mutual defence join, battles happen, and it ends in a peace with tribute", () => {
    const r = fresh();
    const [a, b, c] = Object.values(r.kingdoms);
    sign(r, "mutual_defense", `k:${b!.id}`, `k:${c!.id}`, 1, 100, "old friends");
    const w = declareWar(r, [`k:${a!.id}`], [`k:${b!.id}`], 2, "testing");
    expect(w.defenders).toContain(`k:${c!.id}`);
    for (let d = 3; d <= 40 && w.end === undefined; d++) realmDay(r, d, seededRng(d));
    expect(w.battles.length).toBeGreaterThan(0);
    if (w.end === undefined) endWar(r, w, 41, w.score >= 0 ? "attackers" : "defenders", "testing");
    expect(w.outcome).toBeTruthy();
    expect(r.treaties.some((t) => t.kind === "non_aggression" && t.since >= 2)).toBe(true);
  });

  it("a person can swear service to a kingdom", () => {
    const r = fresh();
    const k = Object.values(r.kingdoms)[0]!;
    const f = Object.values(r.figures).find((x) => x.role === "adventurer")!;
    const t = sign(r, "service", `p:${f.id}`, `k:${k.id}`, 1, 30, "a sword for hire", 80);
    expect(t.kind).toBe("service");
    expect(describeRealm(r).join("\n")).toMatch(/service/);
  });
});

describe("N13.6 beasts and dungeons", () => {
  it("packs breed in spring while there's room, and a pack too big attacks", () => {
    const r = fresh();
    const { pack: p, site } = withWilds(r);
    p.count = 3;
    for (let d = 1; d <= 3; d++) packsDay(r, d, always(0.1)); // spring days, a lucky roll
    expect(p.count).toBeGreaterThan(3);
    p.count = p.cap;
    packsDay(r, 4, always(0.01)); // under the day's share of the yearly attack chance
    expect(r.stats.beast_attacks).toBeGreaterThanOrEqual(1);
    expect(r.arrivals[site]?.some((e) => e.kind === "beasts")).toBe(true);
  });

  it("adventurers delve: clearing a dungeon pays, quiets it, and makes them stronger", () => {
    const r = fresh();
    const d = Object.values(r.dungeons)[0]!;
    d.danger = 10;
    const party = [0, 1, 2].map((i) => makeFigure(r, seededRng(i), { role: "adventurer", home: d.near, tier: "C", age: 30 }, 1));
    const wealth = party.map((f) => f.wealth);
    delve(r, d, party, 2, always(0.01));
    expect(d.clearedUntil).toBeGreaterThan(2);
    expect(party.some((f, i) => f.wealth > wealth[i]!)).toBe(true);
    expect(r.stats.cleared).toBe(1);
  });

  it("the player joins the guild and delves a dungeon near the town", () => {
    const r = fresh();
    const { site, dungeon } = withWilds(r);
    const town = makeTown();
    const player = town.world.player;
    player.site = site;
    expect(playerDelve(r, player, "", 1, always(0.01)).ok).toBe(false);
    player.money = GUILD_FEE + 10;
    expect(joinGuild(r, player).ok).toBe(true);
    expect(player.money).toBe(10);
    expect(dungeonsInReach(r, site).map((d) => d.id)).toContain(dungeon.id);
    const d = dungeonsInReach(r, site).find((x) => x.near === site)!;
    d.danger = 5;
    // Down from its mouth only (N15): up the road from the village.
    const away = playerDelve(r, player, d.name, 1, always(0.01));
    expect(away.ok).toBe(false);
    expect(away.lines.join(" ")).toMatch(/opens at the end of the road out of .*\. Walk there first/);
    player.area = "mine";
    const out = playerDelve(r, player, d.name, 1, always(0.01));
    expect(out.ok).toBe(true);
    expect(out.money).toBeGreaterThan(0);
    expect(out.xp).toBeGreaterThan(0);
    expect(d.clearedUntil).toBeDefined();
  });

  it("a place's wolves breed on the map in spring, up to the cap", () => {
    const templates = loadCreatureTemplates();
    const creatures: Record<string, ReturnType<typeof spawnCreature>> = {};
    for (let i = 0; i < 2; i++) creatures[`wolf-${i + 1}`] = spawnCreature(templates.wolf!, `wolf-${i + 1}`, 1, always(0.5), `wolf ${i + 1}`, 4);
    expect(breedCreatures(templates, creatures, 1, always(0.01)).length).toBe(1);
    expect(Object.values(creatures).length).toBeGreaterThan(2);
    for (let i = 0; i < 20; i++) breedCreatures(templates, creatures, 2, always(0.01));
    expect(Object.values(creatures).filter((c) => c.template === "wolf").length).toBeLessThanOrEqual(templates.wolf!.breeding!.cap);
  });
});

describe("N13.7 rising from the crowd", () => {
  /** A villager on the town's map (refugees come as villagers), made one of the town's commoners by name. */
  function villagerOnMap() {
    const town = makeTown();
    const realm = town.world.realm!;
    const site = town.site();
    const t = town.templates.villager!;
    const creatures = town.creaturesHere();
    creatures["villager-1"] = spawnCreature(t, "villager-1", 1, always(0.5), "Villager 1", 25);
    castCrowd(realm, creatures, town.world.day, site);
    return { town, realm, site, villager: creatures["villager-1"]! };
  }

  it("villagers on the map are the place's commoners, by name", () => {
    const { realm, villager } = villagerOnMap();
    expect(villager.figure).toBeDefined();
    expect(villager.name).toBe(realm.figures[villager.figure!]!.name);
  });

  it("a wolf that wins three fights earns a name and leads its place's pack", () => {
    const town = makeTown();
    const realm = town.world.realm!;
    const { site, pack } = withWilds(realm);
    const creatures: Record<string, ReturnType<typeof spawnCreature>> = {};
    creatures["beast-1"] = spawnCreature(town.templates[pack.species]!, "beast-1", 1, always(0.5), "beast 1", 25);
    const wolf = creatures["beast-1"]!;
    wolf.life.fightsWon = 3;
    const lines = nameRisers(realm, town.templates, creatures, 2, seededRng(1), site);
    expect(lines.join(" ")).toMatch(/earned a name/);
    expect(wolf.name).not.toMatch(/^wolf/);
    const f = realm.figures[wolf.figure!]!;
    expect(f.role).toBe("beast");
    expect(realm.packs[pack.id]!.alpha).toBe(f.id);
  });

  it("a commoner who makes a breakthrough becomes a talking NPC, from a template", () => {
    const { town, realm, site, villager } = villagerOnMap();
    villager.life.tier = "E";
    nameRisers(realm, town.templates, town.creaturesHere(), town.world.day, seededRng(1), site);
    const f = realm.figures[villager.figure!]!;
    expect(f.renown).toBeGreaterThanOrEqual(TALKER_RENOWN);
    const ready = readyToTalk(realm, town.creaturesHere(), site);
    expect(ready.map((x) => x.id)).toContain(f.id);
    const persona = personaFor(f, loadTemplates(), town.world.day, seededRng(2), town.ids);
    expect(persona).not.toBeNull();
    expect(persona!.tier).toBe("E");
    // At midnight, the town makes them one of its talkers.
    const before = town.ids.length;
    town.world.hour = 7;
    town.passHours(24 - town.world.hour + 1);
    expect(town.ids.length).toBe(before + 1);
    const id = town.ids.at(-1)!;
    expect(town.world.talkers![id]!.site).toBe(site);
    expect(realm.figures[f.id]!.talks).toBe(id);
    expect(Object.values(town.creaturesHere()).some((c) => c.figure === f.id)).toBe(false);
  });
});

describe("N13.8 an active director", () => {
  it("a place's needs become work on the right NPC's board, with the quarry to hunt", () => {
    const town = makeTown();
    const realm = town.world.realm!;
    const { site, pack } = withWilds(realm);
    pack.count = pack.cap;
    expect(needsOf(realm, site, town.world.day).map((n) => n.need)).toContain("beasts");
    const lines = postNeedQuests(realm, town.world, site, town.members());
    expect(lines.join(" ")).toMatch(/Hale has work/);
    const q = town.agents.hale!.state.questBoard.find((x) => x.id.startsWith("rq_beasts_"))!;
    expect(q.objective).toMatchObject({ type: "defeat", creature: pack.species, qty: 3 });
    expect(town.world.extraSpawnRules!.some((r) => r.quest === q.id)).toBe(true);
    // Not twice.
    expect(postNeedQuests(realm, town.world, site, town.members())).toEqual([]);
  });

  it("realm news reaches a place only when a traveller brings it; the innkeeper hears it first, as a rumour", () => {
    const town = makeTown();
    const realm = town.world.realm!;
    const site = town.site();
    const far = Object.values(realm.settlements).reduce((a, b) => (travelDays(realm, b.id, site) > travelDays(realm, a.id, site) ? b : a));
    town.world.hour = 10;
    realmNews(realm, town.world.day, far.id, "war", `War has come to ${far.name}.`, 9);
    const n = realm.news.at(-1)!;
    // Where it happened it is known at once; nowhere else yet (N26 Part E: nothing predicts the future).
    expect(reachesAt(realm, n, far.id)).toBe(town.world.day);
    expect(reachesAt(realm, n, site)).toBeNull();
    expect(deliverNews(realm, town.world, site, town.members())).toEqual([]);
    // A traveller arrives with it.
    hear(realm, site, n.id, town.world.day, far.id, "j1");
    const lines = deliverNews(realm, town.world, site, town.members());
    expect(lines.join(" ")).toMatch(/Travellers bring news/);
    const id = realmNewsId(n);
    expect(town.agents.pell!.state.learned[id]).toBe("rumour");
    expect(town.agents.brena!.state.learned[id]).toBeUndefined();
    // Hale hears of wars.
    expect(town.agents.hale!.state.learned[id]).toBe("rumour");
    // Another place hasn't heard it until someone brings it.
    const elsewhere = Object.values(realm.settlements).find((x) => x.id !== site && x.id !== far.id)!;
    expect(reachesAt(realm, n, elsewhere.id)).toBeNull();
  });

  it("what the realm sends a place turns up on its map", () => {
    const town = makeTown();
    const realm = town.world.realm!;
    const site = town.site();
    sendArrival(realm, site, { day: town.world.day, kind: "raid", count: 3, by: "Ashby" });
    sendArrival(realm, site, { day: town.world.day, kind: "beasts", count: 2, by: "wolf" });
    const lines = applyArrivals(realm, town.world, site, town.members(), Object.keys(town.templates));
    expect(lines.join(" ")).toMatch(/Raiders from Ashby/);
    expect(town.world.extraSpawnRules!.filter((r) => r.id.startsWith("realm_")).length).toBe(2);
    // Once each.
    expect(applyArrivals(realm, town.world, site, town.members(), Object.keys(town.templates))).toEqual([]);
  });

  it("the talkers are realm figures too: a guard answers to their captain, their rank and name follow the NPC", () => {
    const town = makeTown();
    const realm = town.world.realm!;
    syncTalkers(realm, town.members(), town.site(), 1);
    advanceRealm(realm, 2, seededRng(1));
    const haleFig = Object.values(realm.figures).find((f) => f.talks === "hale")!;
    expect(haleFig.role).toBe("guard");
    expect(haleFig.name).toBe("Corporal Hale");
    expect(haleFig.home).toBe(town.site());
    void brena;
    void pell;
  });
});

describe("N13 closing the gaps", () => {
  it("a filling dungeon becomes Hale's job to clear it; delving to the bottom finishes the quest and earns renown", () => {
    const town = makeTown();
    const realm = town.world.realm!;
    const { site, dungeon: d } = withWilds(realm);
    d.danger = 90;
    d.tier = "F";
    d.depth = 2;
    for (const p of Object.values(realm.packs)) p.count = 0;
    postNeedQuests(realm, town.world, site, town.members());
    const q = town.agents.hale!.state.questBoard.find((x) => x.id.startsWith("rq_dungeon_"))!;
    expect(q.objective).toMatchObject({ type: "clear", dungeon: d.id });
    const player = town.world.player;
    player.quests.active.push({ ...q, giverId: "hale", giverName: "Corporal Hale", progress: 0 });
    player.money = 1000;
    joinGuild(realm, player);
    d.danger = 5;
    player.area = "mine";
    const out = playerDelve(realm, player, "", town.world.day, always(0.01));
    expect(out.lines.join(" ")).toMatch(/Done: report back to Corporal Hale/);
    expect(player.renown).toBeGreaterThanOrEqual(10);
  });

  it("war makes blades, armour and food dear in a kingdom at war", async () => {
    const { priceFactor } = await import("../src/game/events-calendar.js");
    const town = makeTown();
    const w = town.world;
    expect(priceFactor("iron sword", w)).toBe(1);
    const [a, b] = Object.values(w.realm!.kingdoms);
    declareWar(w.realm!, [`k:${b!.id}`], [`k:${home(w.realm!).kingdom!}` === `k:${a!.id}` ? `k:${a!.id}` : `k:${home(w.realm!).kingdom!}`], w.day, "testing");
    town.passHours(24);
    expect(w.atWar).toBe(true);
    expect(priceFactor("iron sword", w)).toBeCloseTo(1.25);
    expect(priceFactor("bread loaf", w)).toBeCloseTo(1.15);
  });

  it("a lost battle can knock down the walls", async () => {
    const { damageBuilding } = await import("../src/game/realm/diplomacy.js");
    const r = fresh();
    const s = home(r);
    s.buildings.walls = 2;
    expect(damageBuilding(s, always(0.5))).toBe("walls");
    expect(s.buildings.walls).toBe(1);
  });

  it("big news from away is retold by the model, but only with names it was given", async () => {
    const { retellNews } = await import("../src/game/realm/news.js");
    const town = makeTown();
    const realm = town.world.realm!;
    const site = town.site();
    const far = Object.values(realm.settlements).find((x) => travelDays(realm, x.id, site) >= 2)!;
    realmNews(realm, town.world.day, far.id, "war", `War has come to ${far.name}.`, 9);
    const n = realm.news.at(-1)!;
    hear(realm, site, n.id, town.world.day, far.id, "j1");
    deliverNews(realm, town.world, site, town.members());
    const id = realmNewsId(n);
    const bad = new FakeProvider([say('{"text":"Lord Vexmoor burned the whole of the place down, they say."}'), say('{"text":"Lord Vexmoor burned it all."}')]);
    expect(await retellNews(bad, realm, town.world, id)).toBe(false);
    const good = new FakeProvider([say(`{"text":"They say there's fighting at ${far.name} now. War, true enough."}`)]);
    expect(await retellNews(good, realm, town.world, id)).toBe(true);
    expect(town.world.lore!.find((e) => e.id === id)!.text).toMatch(/fighting at/);
  });
});

describe("N13 done when: a seeded 120-day realm", () => {
  it("founds and splits factions, signs treaties, raids, fights a war to its end, taxes, builds, breeds and culls, delves and names", () => {
    const r = generateRealm(4, 1);
    advanceRealm(r, 121, seededRng(4 * 7919 + 1));
    const s = r.stats;
    expect(s.founded).toBeGreaterThanOrEqual(1);
    expect(s.splits).toBeGreaterThanOrEqual(1);
    expect(s.treaties).toBeGreaterThanOrEqual(1);
    expect(s.raids).toBeGreaterThanOrEqual(1);
    expect(s.wars).toBeGreaterThanOrEqual(1);
    expect(s.wars_ended).toBeGreaterThanOrEqual(1);
    expect(s.taxes).toBeGreaterThan(0);
    expect(s.buildings).toBeGreaterThanOrEqual(1);
    expect(s.beasts_born).toBeGreaterThan(0);
    expect(s.culled).toBeGreaterThan(0);
    expect(s.delves).toBeGreaterThanOrEqual(1);
    expect((s.alphas ?? 0) + (s.risen ?? 0)).toBeGreaterThanOrEqual(1);
    expect(RealmSchema.safeParse(r).success).toBe(true);
    // The browser's view of it.
    const v = realmView(r);
    expect(v.settlements.length).toBe(Object.keys(r.settlements).length);
    expect(v.news.length).toBeGreaterThan(0);
  });

  it("the town keeps a realm through 10 days, and a save round trip keeps it", () => {
    const town = makeTown({ rng: seededRng(9) });
    for (let i = 0; i < 10; i++) town.passHours(24);
    const realm = town.world.realm!;
    expect(realm.day).toBe(town.world.day);
    const dir = mkdtempSync(join(tmpdir(), "realm-"));
    const file = join(dir, "world.json");
    saveWorld(file, town.world);
    const back = loadWorld(file, town.personas, town.templates);
    expect(back.version).toBe(SAVE_VERSION);
    expect(back.realm?.day).toBe(realm.day);
    expect(Object.keys(back.realm!.figures).length).toBe(Object.keys(realm.figures).length);
    void figurePower;
  });
});
