/**
 * N17: the admin world view. A second page (/admin) that shows the whole world as it
 * really is, lets you search anyone and pin people or places to follow, and changes
 * nothing except the clock. The data side is `src/admin/*` (pure reads of the world,
 * the town and the store); the routes are `src/web/routes/admin.ts`.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { fileURLToPath } from "node:url";
import { type AdminCard, type AdminEvent, type AdminEventsPage, compareAt, CrowdSim } from "@millbrook/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { classCounts, crowdDay, folkOf } from "../src/admin/folk.js";
import type { AdminContext } from "../src/admin/context.js";
import { events } from "../src/admin/events.js";
import { gossipOverview, knowersOf } from "../src/admin/gossip.js";
import { health } from "../src/admin/health.js";
import { overview } from "../src/admin/overview.js";
import { card, crowdOf, pinned } from "../src/admin/person.js";
import { playerView } from "../src/admin/player.js";
import { awayAndVisiting, roadsOf } from "../src/admin/roads.js";
import { resetSearchIndex, search } from "../src/admin/search.js";
import { timeControl } from "../src/admin/time.js";
import { config } from "../src/config.js";
import { WorldStore } from "../src/game/db.js";
import { recordEvent } from "../src/game/events.js";
import { worldHash } from "../src/game/hash.js";
import { realmNews } from "../src/game/realm/log.js";
import { describeRealm } from "../src/game/realm/view.js";
import { townEventsOn } from "../src/game/events-calendar.js";
import { weatherOn } from "../src/game/weather.js";
import { hearRumour } from "../src/game/rumours.js";
import type { Town } from "../src/game/town.js";
import { resetTimings } from "../src/metrics/timing.js";
import { handleAdmin } from "../src/web/routes/admin.js";
import { makeTown } from "./helpers.js";

let town: Town;
let store: WorldStore;
let paused = false;
let ctx: AdminContext;
/** Everything the admin side can be asked, with typical parameters. */
let everything: () => Promise<unknown[]>;

beforeAll(async () => {
  config.director = false;
  config.planning = false;
  config.summaries = false;
  config.realm = true;
  // Seed 1, every system on its own stream (N18): in 40 days wars break out and the director pushes (`SEED=1 npm run sim:realm`).
  // A death needs luck in 40 days, so one place's leader is made too old to live (as n13.test does).
  config.realmSeed = 1;
  resetTimings();
  store = new WorldStore(":memory:");
  town = makeTown({ rng: null, store });
  const elder = Object.values(town.world.realm!.figures).find((f) => f.home && f.home !== START() && town.world.realm!.settlements[f.home]?.leader === f.id)!;
  elder.life.bornOnDay = -95 * config.daysPerYear;
  for (let d = 0; d < 40; d++) town.passHours(24);
  // The reviews of those days leave their reflections in the store a moment later (embeddings): let them land before anything is measured.
  await town.reviews.idle();
  ctx = {
    world: () => town.world,
    town: () => town,
    store,
    queueLength: () => 0,
    time: { paused: () => paused, setPaused: (p) => void (paused = p), advance: async (hours) => town.passHours(hours) },
  };
  // Two people have heard a rumour about the player, one a little garbled.
  const day = town.world.day;
  hearRumour(town.agents.brena!.state, { about: "player", fact: "thief", text: "the traveller steals from shops", truth: "false", accuracy: 1, day });
  hearRumour(town.agents.hale!.state, { about: "player", fact: "thief", text: "the traveller steals from shops", truth: "false", accuracy: 0.8, heardFrom: "brena", day });
  town.agents.pell!.state.grudge = { reason: "the traveller broke his table", day, until: day + 20 };
  // A game event with a reason, in the database.
  recordEvent(town.world, { kind: "insulted", actor: "player", target: "brena", details: "called the forge a ruin", importance: 4, witnesses: ["brena"], why: "the player was in a temper" });
  everything = async () => {
    const realm = town.world.realm!;
    const town1 = Object.values(realm.settlements).find((s) => s.kind === "town" && s.id !== START())!;
    const folk = folkOf(ctx, town1.id)!;
    const person = folk.roster.people[3]!;
    const figure = Object.values(realm.figures).find((f) => f.alive && f.role !== "beast")!;
    const dead = Object.values(realm.figures).find((f) => !f.alive);
    const refs = ["player", "cast:brena", "cast:hale", `figure:${figure.id}`, ...(dead ? [`figure:${dead.id}`] : []), `town:${person.id}`, `place:${town1.id}`, `place:${START()}`, ...Object.keys(town.creaturesHere()).slice(0, 2).map((u) => `beast:${u}`)];
    const out: unknown[] = [];
    out.push(overview(ctx), overview(ctx), health(ctx), events(ctx), events(ctx, { source: "realm", minImportance: 5 }), events(ctx, { person: "player" }), playerView(ctx));
    out.push(search(ctx, "brena"), search(ctx, person.name), search(ctx, "farmer"), search(ctx, "wolf"), search(ctx, ""));
    for (const ref of refs) out.push(card(ctx, ref));
    out.push(pinned(ctx, refs), crowdOf(ctx, town1.id), classCounts(ctx, town1.id));
    // The roads (N26 Part E): every journey, and who of a place is away.
    out.push(roadsOf(ctx), awayAndVisiting(ctx, town1.id));
    // What people know (N33): the overview, and who knows the most-known things.
    const gossip = gossipOverview(ctx);
    out.push(gossip, ...gossip.popular.slice(0, 3).map((p) => knowersOf(ctx, p.ref)));
    return out;
  };
}, 120_000);

afterAll(() => store.close());

/** The town the world began in. */
const START = () => town.world.startSite!;
const warNews = () => town.world.realm!.news.filter((n) => n.kind === "war");
const byKind = (page: AdminEventsPage, kind: string, source?: string): AdminEvent[] => page.events.filter((e) => e.kind === kind && (!source || e.source === source));

describe("N17.1 nothing on the admin page changes the save", () => {
  it("every read leaves the world, the events and the database as they were", async () => {
    const before = worldHash(town.world, store);
    const counts = { events: town.world.events?.length, next: town.world.realm!.next, db: store.eventCount(), news: town.world.realm!.news.length };
    const answers = await everything();
    expect(answers.length).toBeGreaterThan(20);
    expect(worldHash(town.world, store)).toBe(before);
    expect({ events: town.world.events?.length, next: town.world.realm!.next, db: store.eventCount(), news: town.world.realm!.news.length }).toEqual(counts);
  });

  it("the same reads over HTTP change nothing either, and anything but GET is turned away", async () => {
    const http = await listen();
    try {
      const before = worldHash(town.world, store);
      const paths = ["overview", "clock", "health", "events?limit=20", "events?kind=war&source=realm", "search?q=brena", "card?ref=cast:brena", "card?ref=player", "pinned?refs=player,cast:hale", "player", `crowd?site=${START()}`];
      for (const p of paths) {
        const res = await fetch(`${http.base}/api/admin/${p}`);
        expect(res.status, p).toBe(200);
        await res.json();
      }
      expect(worldHash(town.world, store)).toBe(before);
      for (const method of ["POST", "PUT", "DELETE", "PATCH"]) {
        const res = await fetch(`${http.base}/api/admin/overview`, { method, ...(method === "POST" ? { body: "{}" } : {}) });
        expect(res.status, method).toBe(405);
      }
      // Time is the one POST; a GET to it is not allowed.
      expect((await fetch(`${http.base}/api/admin/time`)).status).toBe(405);
      expect((await fetch(`${http.base}/api/admin/nonsense`)).status).toBe(404);
      expect(worldHash(town.world, store)).toBe(before);
    } finally {
      await http.close();
    }
  });
});

describe("N17.2 the realm overview shows the map and its numbers", () => {
  it("has every kingdom and settlement, and the numbers match what sim:realm prints", () => {
    const realm = town.world.realm!;
    const o = overview(ctx);
    expect(o.realm!.kingdoms.map((k) => k.id).sort()).toEqual(Object.keys(realm.kingdoms).sort());
    expect(o.realm!.settlements.map((s) => s.id).sort()).toEqual(Object.keys(realm.settlements).sort());
    expect(o.summary).toEqual(describeRealm(realm));
    expect(o.totals.population).toBe(Object.values(realm.settlements).reduce((a, s) => a + s.population, 0));
    expect(o.totals.kingdoms).toBe(Object.keys(realm.kingdoms).length);
    expect(o.clock.day).toBe(town.world.day);
    // The map layer: packs where they live, war fronts as lines between seats; caravans wait for N26.
    expect(o.layer.packs.length).toBe(Object.values(realm.packs).filter((p) => p.count > 0).length);
    expect(o.layer.missing.join(" ")).toMatch(/N26/);
  });

  it("works out the people by class a few places a request, until every place is in", () => {
    let o = overview(ctx);
    const first = Object.keys(o.classes).length;
    expect(o.classesPending + first).toBe(Object.values(town.world.realm!.settlements).filter((s) => !s.abandoned).length);
    for (let i = 0; i < 60 && o.classesPending > 0; i++) o = overview(ctx);
    expect(o.classesPending).toBe(0);
    const total = (id: string) => Object.values(o.classes[id]!).reduce((a, n) => a + (n ?? 0), 0);
    const s = town.world.realm!.settlements[START()]!;
    // N25: the population is the count of living townsfolk; the notables (realm figures) are counted on top of them here.
    const notables = Object.values(town.world.realm!.figures).filter((f) => f.alive && f.home === START() && f.role !== "beast").length;
    expect(total(START())).toBeGreaterThan(0);
    expect(total(START())).toBeLessThanOrEqual(s.population + notables);
  });
});

describe("N17.3 the event stream shows a war, a death and a director push with their reasons", () => {
  it("holds all three kinds, each with a why", () => {
    const page = events(ctx, { limit: 1000 });
    // A war's news says why it began (a conquest's says only that it was lost): find one that does.
    const war = byKind(page, "war", "realm").find((e) => e.why && e.text.includes(e.why));
    expect(war, "a war in the news").toBeDefined();
    expect(war!.why).toBeTruthy();
    expect(war!.text).toContain(war!.why!);
    const death = byKind(page, "death", "realm")[0];
    expect(death, "a death in the news").toBeDefined();
    expect(death!.why).toMatch(/old age|killed by/);
    expect(death!.people.length).toBeGreaterThan(0);
    const push = page.events.find((e) => e.source === "director" && e.ref.startsWith("d:"));
    expect(push, "a director push").toBeDefined();
    expect(push!.why).toBeTruthy();
    const game = page.events.find((e) => e.source === "game" && e.text === "called the forge a ruin");
    expect(game, "a game event from the database").toBeDefined();
    expect(game!.why).toBe("the player was in a temper");
    expect(game!.people).toEqual(expect.arrayContaining(["player", "cast:brena"]));
  });

  it("news carries the figures in it, found when it was written", () => {
    const realm = town.world.realm!;
    const f = Object.values(realm.figures).find((x) => x.alive)!;
    realmNews(realm, realm.day, START(), "test", `${f.name} did something.`, 5);
    const n = realm.news.at(-1)!;
    expect(n.people).toContain(f.id);
    const row = events(ctx, { kind: "test" }).events[0]!;
    expect(row.people).toContain(`figure:${f.id}`);
    realm.news.pop();
  });

  it("filters by place, person, kind, importance and source; newest first", () => {
    const all = events(ctx, { limit: 1000 });
    for (let i = 1; i < all.events.length; i++) expect(compareAt(all.events[i - 1]!.at, all.events[i]!.at)).toBeGreaterThanOrEqual(0);
    const withSite = all.events.find((e) => e.source === "realm" && e.site && e.people.length > 0)!;
    const bySite = events(ctx, { site: withSite.site! });
    expect(bySite.events.length).toBeGreaterThan(0);
    expect(bySite.events.every((e) => e.site === withSite.site)).toBe(true);
    const byPerson = events(ctx, { person: withSite.people[0]! });
    expect(byPerson.events.every((e) => e.people.includes(withSite.people[0]!))).toBe(true);
    expect(byPerson.events.map((e) => e.ref)).toContain(withSite.ref);
    expect(events(ctx, { kind: "war" }).events.every((e) => e.kind === "war")).toBe(true);
    expect(events(ctx, { minImportance: 8 }).events.every((e) => e.importance >= 8)).toBe(true);
    expect(events(ctx, { source: "director" }).events.every((e) => e.source === "director")).toBe(true);
    expect(events(ctx, { limit: 5 }).events.length).toBe(5);
    expect(events(ctx, { limit: 5 }).matched).toBeGreaterThan(5);
  });

  it("the cursor returns only newer rows", () => {
    const first = events(ctx);
    expect(first.cursor).toBeTruthy();
    // Nothing yet after the newest row.
    expect(events(ctx, { after: first.cursor! }).events).toEqual([]);
    const seen = new Set(events(ctx, { limit: 1000 }).events.map((e) => e.ref));
    town.passHours(24);
    const next = events(ctx, { after: first.cursor!, limit: 1000 });
    expect(next.events.length).toBeGreaterThan(0);
    for (const e of next.events) {
      expect(compareAt(e.at, first.cursor!)).toBeGreaterThan(0);
      expect(seen.has(e.ref), `${e.ref} was already there`).toBe(false);
    }
    expect(compareAt(next.cursor!, first.cursor!)).toBeGreaterThan(0);
  });
});

describe("N17.4 search finds anyone", () => {
  it("finds a cast member, a realm figure, a beast, and a townsperson of another settlement", () => {
    const realm = town.world.realm!;
    expect(search(ctx, "Brena").hits.some((h) => h.ref === "cast:brena")).toBe(true);
    // The player and places can be found too, to pin them.
    expect(search(ctx, town.world.player.name).hits.map((h) => h.ref)).toContain("player");
    const millbrook = town.world.realm!.settlements[START()]!;
    expect(search(ctx, millbrook.name, { kind: "place" }).hits[0]).toMatchObject({ ref: `place:${START()}`, kind: "place" });
    const fig = Object.values(realm.figures).find((f) => f.role !== "beast" && f.alive)!;
    expect(search(ctx, fig.name).hits.map((h) => h.ref)).toContain(`figure:${fig.id}`);
    const dead = Object.values(realm.figures).find((f) => !f.alive);
    if (dead) expect(search(ctx, dead.name).hits.find((h) => h.ref === `figure:${dead.id}`)?.detail).toMatch(/dead/);
    const beast = Object.values(town.creaturesHere())[0]!;
    expect(search(ctx, beast.name).hits.some((h) => h.kind === "beast")).toBe(true);
    // A townsperson of a place that isn't Millbrook, by name; the index fills in over a few requests.
    const away = Object.values(realm.settlements).find((s) => s.id !== START() && !s.abandoned && s.kind !== "hamlet")!;
    const person = folkOf(ctx, away.id)!.roster.people[7]!;
    let r = search(ctx, person.name, { site: away.id });
    for (let i = 0; i < 100 && !r.complete; i++) r = search(ctx, person.name, { site: away.id });
    expect(r.complete).toBe(true);
    expect(r.hits.map((h) => h.ref)).toContain(`town:${person.id}`);
  });

  it("matches class, job, place and faction, best first, at most 50", () => {
    resetSearchIndex();
    let r = search(ctx, "farmer");
    for (let i = 0; i < 200 && !r.complete; i++) r = search(ctx, "farmer");
    expect(r.hits.length).toBe(50);
    expect(r.hits.every((h) => /farmer/i.test(h.detail) || /farmer/i.test(h.name))).toBe(true);
    const hale = town.personas.hale!.name;
    expect(search(ctx, hale).hits[0]!.ref).toBe("cast:hale");
    expect(search(ctx, hale.toUpperCase()).hits[0]!.name).toBe(hale);
    // Partial answers say so.
    resetSearchIndex();
    const partial = search(ctx, "zzzz-nobody");
    expect(partial.places).toBeGreaterThan(0);
    expect(partial.hits).toEqual([]);
  });
});

describe("N17.5 pinning a townsperson in another town shows their day hour by hour", () => {
  it("has 24 hours, asleep in their house at 03:00 and at work at 10:00, as the crowd simulation says", () => {
    const realm = town.world.realm!;
    const away = Object.values(realm.settlements).find((s) => s.id !== START() && !s.abandoned && s.kind === "town")!;
    const folk = folkOf(ctx, away.id)!;
    const farmer = folk.roster.people.find((p) => p.job === "farmer" && p.age >= 18 && p.work === "zone:fields")!;
    // A fine working day: bad weather and festivals keep people home, which the crowd simulation also knows.
    let day = town.world.day;
    while (weatherOn(day) !== "clear" || townEventsOn({ ...town.world, day }).includes("festival")) day++;
    const onDay: AdminContext = { ...ctx, world: () => ({ ...town.world, day }) };
    const c = card(onDay, `town:${farmer.id}`) as AdminCard;
    expect(c.kind).toBe("townsperson");
    expect(c.siteName).toBe(away.name);
    expect(c.day).toHaveLength(24);
    expect(c.rolledOn).toBe(day);
    const sim = new CrowdSim(folk.sim.map, folk.roster);
    for (const h of c.day!) {
      const at = sim.at(farmer, day, h.hour * 60, crowdDay(onDay));
      expect(h.doing).toBe(at.doing);
      expect([h.x, h.y, h.visible]).toEqual([at.x, at.y, at.visible]);
    }
    const [three, ten] = [c.day![3]!, c.day![10]!];
    expect(three.visible).toBe(false);
    expect(three.inside).toBeTruthy();
    expect(three.doing).toMatch(/asleep/);
    expect(ten.visible).toBe(true);
    expect(ten.doing).toMatch(/work/);
    // It is worked out on demand: nothing was simulated, nothing saved.
    expect(c.follow).toEqual({ site: away.id, id: farmer.id });
    expect(c.sections.some((s) => "unavailable" in s && /N25/.test(s.unavailable))).toBe(true);
  });

  it("can draw their town: the map, the roster and the clock", () => {
    const away = Object.values(town.world.realm!.settlements).find((s) => s.id !== START() && !s.abandoned && s.kind === "village")!;
    const crowd = crowdOf(ctx, away.id)!;
    expect(crowd.map.w).toBeGreaterThan(10);
    expect(crowd.roster.people.length).toBeGreaterThan(0);
    expect(crowdOf(ctx, "nowhere")).toBeNull();
  });
});

describe("N17.6 pinning the player shows a rumour about them and who believes it", () => {
  it("lists the rumour with both holders and how sure each is", () => {
    const v = playerView(ctx);
    const belief = v.beliefs.find((b) => b.key === "player.thief")!;
    expect(belief).toBeDefined();
    expect(belief.holders.map((h) => h.ref)).toEqual(expect.arrayContaining(["cast:brena", "cast:hale"]));
    expect(belief.holders.find((h) => h.ref === "cast:brena")!.accuracy).toBe(1);
    expect(belief.holders.find((h) => h.ref === "cast:hale")!.accuracy).toBe(0.8);
    expect(belief.holders.find((h) => h.ref === "cast:hale")!.heardFrom).toBe("brena");
    expect(belief.truth).toBe("false");
    // Grudges and feelings are listed too.
    expect(v.opinions.find((o) => o.ref === "cast:pell")!.grudge).toMatch(/table/);
    const c = card(ctx, "player")!;
    expect(c.kind).toBe("player");
    const who = c.sections.find((s) => s.title === "Who believes what")!;
    expect("rows" in who && who.rows.some(([text]) => text.includes("steals from shops"))).toBe(true);
    expect(pinned(ctx, ["player", "cast:brena"]).cards.map((x) => x.ref)).toEqual(["player", "cast:brena"]);
  });
});

describe("N17.7 a person's card", () => {
  it("shows a cast member's needs, feelings, goals, relationships, beliefs, family and timeline", () => {
    const c = card(ctx, "cast:brena")!;
    const titles = c.sections.map((s) => s.title);
    for (const t of ["Right now", "Needs and emotions", "Goals and grudges", "Relationships", "What they know or believe", "Family", "Timeline"]) expect(titles).toContain(t);
    const timeline = c.sections.find((s) => s.title === "Timeline")!;
    expect("rows" in timeline && timeline.rows.some(([, text]) => text.includes("called the forge a ruin") && text.includes("temper"))).toBe(true);
    const rumours = c.sections.find((s) => s.title === "What they know or believe")!;
    expect("rows" in rumours && rumours.rows.some(([label]) => label.includes("Rumour"))).toBe(true);
    // A section whose phase isn't built says which phase.
    expect(c.sections.find((s) => s.title === "Ambitions and choices")).toEqual({ title: "Ambitions and choices", unavailable: expect.stringContaining("N38") });
  });

  it("shows a figure's rank, faction, chain of command and deeds; a place's numbers and people", () => {
    const realm = town.world.realm!;
    const lead = realm.figures[Object.values(realm.settlements).find((s) => s.leader && s.id !== START())!.leader!]!;
    const c = card(ctx, `figure:${lead.id}`)!;
    expect(c.name).toBe(lead.name);
    expect(c.sections.map((s) => s.title)).toEqual(expect.arrayContaining(["Right now", "Standing", "Nature", "Deeds", "Timeline"]));
    const p = card(ctx, `place:${lead.home}`)!;
    expect(p.kind).toBe("place");
    expect(p.sections.map((s) => s.title)).toEqual(expect.arrayContaining(["The place", "People by class", "Notable people", "Lately"]));
    expect(card(ctx, "figure:nobody")).toBeNull();
    expect(card(ctx, "garbage")).toBeNull();
  });
});

describe("N17.8 time controls move the clock, as the player waiting would, and are logged", () => {
  it("steps an hour, steps a day, pauses and resumes; each is an admin-time entry in the stream", async () => {
    const start = { day: town.world.day, hour: town.world.hour };
    const r = await timeControl(ctx, { action: "step-hour" });
    expect(r.ok).toBe(true);
    expect((town.world.day - start.day) * 24 + town.world.hour - start.hour).toBe(1);
    const d = await timeControl(ctx, { action: "step-day" });
    expect(d.advanced).toBe(24);
    expect((town.world.day - start.day) * 24 + town.world.hour - start.hour).toBe(25);
    expect((await timeControl(ctx, { action: "pause" })).clock.paused).toBe(true);
    expect(paused).toBe(true);
    expect((await timeControl(ctx, { action: "resume" })).clock.paused).toBe(false);
    const entries = store.directorEntries().filter((e) => e.kind === "admin-time");
    expect(entries.map((e) => e.proposal)).toEqual(["stepped an hour", "stepped a day", "paused the clock", "resumed the clock"]);
    expect(events(ctx, { kind: "admin-time" }).events.length).toBe(4);
    expect(events(ctx, { kind: "admin-time" }).events[0]!.source).toBe("director");
  });

  it("fast-forward is capped at 30 days a call, and refused without controls", async () => {
    const day = town.world.day;
    const r = await timeControl(ctx, { action: "fast", days: 500 });
    expect(r.advanced).toBe(30);
    expect(town.world.day - day).toBe(30);
    expect((await timeControl({ ...ctx, time: undefined }, { action: "step-hour" })).ok).toBe(false);
    // 30 days now include everyone's lives (N25), so allow for a loaded machine.
  }, 60_000);

  it("works over HTTP, and a bad action is refused", async () => {
    const http = await listen();
    try {
      const hour = town.world.hour;
      const res = await fetch(`${http.base}/api/admin/time`, { method: "POST", body: JSON.stringify({ action: "step-hour" }) });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { ok: boolean; clock: { hour: number } };
      expect(body.ok).toBe(true);
      expect(body.clock.hour).toBe((hour + 1) % 24);
      const bad = await fetch(`${http.base}/api/admin/time`, { method: "POST", body: JSON.stringify({ action: "rewind" }) });
      expect(((await bad.json()) as { ok: boolean }).ok).toBe(false);
      expect((await fetch(`${http.base}/api/admin/time`, { method: "POST", body: "not json" })).status).toBe(400);
    } finally {
      await http.close();
    }
  });
});

describe("N17.9 the admin view is for this machine only", () => {
  it("answers 403 to another address, and to the page itself", async () => {
    const written: Array<{ status: number; body: string }> = [];
    const res = { writeHead: (status: number) => written.push({ status, body: "" }), end: (body: string) => void (written.at(-1)!.body = body) };
    const from = (addr: string) => ({ url: "/api/admin/overview", method: "GET", socket: { remoteAddress: addr } });
    expect(await handleAdmin(from("10.0.0.5") as never, res as never, ctx)).toBe(true);
    expect(written.at(-1)!.status).toBe(403);
    expect(await handleAdmin(from("192.168.1.9") as never, res as never, ctx)).toBe(true);
    expect(written.at(-1)!.status).toBe(403);
    // POST to time from elsewhere is refused before it does anything.
    const hour = town.world.hour;
    await handleAdmin({ ...from("10.0.0.5"), method: "POST", url: "/api/admin/time" } as never, res as never, ctx);
    expect(written.at(-1)!.status).toBe(403);
    expect(town.world.hour).toBe(hour);
    for (const local of ["127.0.0.1", "::1", "::ffff:127.0.0.1"]) {
      await handleAdmin(from(local) as never, res as never, ctx);
      expect(written.at(-1)!.status, local).toBe(200);
    }
    // Other paths are not the admin's to answer.
    expect(await handleAdmin({ url: "/api/state", method: "GET", socket: { remoteAddress: "10.0.0.5" } } as never, res as never, ctx)).toBe(false);
  });
});

describe("N17.10 health: timings and counts", () => {
  it("has the realm day's timings and the counts sim:realm shows", () => {
    const h = health(ctx);
    expect(h.tickMs["realm.day"]!.count).toBeGreaterThanOrEqual(40);
    for (const step of ["realm.economy", "realm.director", "realm.wars", "realm.factions"]) expect(h.tickMs[step], step).toBeDefined();
    const t = h.tickMs["realm.day"]!;
    expect(t.p95).toBeGreaterThanOrEqual(t.p50);
    expect(t.last).toBeGreaterThan(0);
    const realm = town.world.realm!;
    expect(h.counts.population).toBe(Object.values(realm.settlements).reduce((a, s) => a + s.population, 0));
    expect(h.counts.kingdoms).toBe(Object.keys(realm.kingdoms).length);
    expect(h.counts.factions).toBe(Object.values(realm.factions).filter((f) => !f.dissolved).length);
    expect(h.stats).toEqual(realm.stats);
    expect(h.summary).toEqual(describeRealm(realm));
    expect(h).toHaveProperty("counts.queue", 0);
    expect(h).toHaveProperty("counts.fights");
  });
});

describe("N17.11 the game page does not carry the admin view", () => {
  // CI builds before it tests; locally this is skipped until `npm run build` has run.
  const dist = fileURLToPath(new URL("../../client/dist/", import.meta.url));
  it.skipIf(!existsSync(`${dist}index.html`) || !existsSync(`${dist}admin.html`))("the game's scripts never mention /api/admin", () => {
    const html = readFileSync(`${dist}index.html`, "utf8");
    const files = [...html.matchAll(/(?:src|href)="\/?(assets\/[^"]+\.js)"/g)].map((m) => m[1]!);
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) expect(readFileSync(`${dist}${f}`, "utf8"), f).not.toContain("/api/admin");
    // And the admin page does.
    const adminHtml = readFileSync(`${dist}admin.html`, "utf8");
    const adminFiles = [...adminHtml.matchAll(/(?:src|href)="\/?(assets\/[^"]+\.js)"/g)].map((m) => m[1]!);
    expect(adminFiles.some((f) => readFileSync(`${dist}${f}`, "utf8").includes("/api/admin"))).toBe(true);
    expect(readdirSync(`${dist}assets`).length).toBeGreaterThan(1);
  });
});

/** The admin routes on a real HTTP server (requests come from 127.0.0.1). */
async function listen(): Promise<{ base: string; close: () => Promise<void> }> {
  const server: Server = createServer((req, res) => {
    void handleAdmin(req, res, ctx).then((done) => {
      if (!done) res.writeHead(404).end();
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  return { base: `http://127.0.0.1:${port}`, close: () => new Promise<void>((r) => server.close(() => r())) };
}
