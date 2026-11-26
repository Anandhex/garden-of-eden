import type { PersonRow } from "../../store/peopleStore.js";
import { config } from "../../config.js";
import { seededRng, unitFor } from "../dice.js";
import { declareWar, damageBuilding, raid, sign, treatiesBetween, warOf } from "../realm/diplomacy.js";
import { addDeed, addRenown, makeFigure } from "../realm/figures.js";
import { TALKER_RENOWN } from "../realm/rise.js";
import { transfer } from "../realm/ledger.js";
import { realmNews } from "../realm/log.js";
import { casualty, type Side } from "../realm/military.js";
import { policyAt } from "../realm/policy.js";
import type { Realm, Settlement } from "../realm/types.js";
import type { LifeCtx } from "../people/step.js";
import { recordLifeEvent } from "../people/events.js";
import { seasonDays } from "../weather.js";
import { peopleOf, stanceOf } from "../../world/species.js";
import { generatePeoples, peoplesOf, type PeoplesState } from "./generate.js";
import { alliancesDay, hatredsDay, intentionsDay, noteRaid } from "./intent.js";
import { siteMap } from "../../web/sites.js";

/**
 * The peoples' realm day (N54 Parts B–D): the centaur herd moves to the season's grazing; the goblins raid toward the start town's mine
 * road, the ogre fighting for them; an old hatred becomes a war between the orc kingdom and the dwarf hold, and the dwarves ask a human
 * crown for help (accepted where the crown likes the dwarves or hates the orcs); the dragon wakes every few seasons, burns a hamlet near its
 * peaks, and demands tribute that the hamlet's head pays (a `tribute` treaty to the dragon). Every choice has its reason in the news.
 */
const DRAGON_EVERY = 3;
const nearest = (realm: Realm, at: { x: number; y: number }, ok: (s: Settlement) => boolean): Settlement | undefined =>
  Object.values(realm.settlements).filter(ok).sort((a, b) => Math.hypot(a.pos.x - at.x, a.pos.y - at.y) - Math.hypot(b.pos.x - at.x, b.pos.y - at.y) || a.id.localeCompare(b.id))[0];

export function peoplesRealmDay(realm: Realm, day: number): void {
  if (!config.society.peoples) return;
  const st = generatePeoples(realm, day);
  if (!st) return;
  const rng = seededRng(Math.floor(unitFor(realm.seed, "peoples-day", day) * 2 ** 31));
  // ---- The herd, and every other band that wanders, moves with the seasons (B2) ----
  const herd = st.herd ? realm.settlements[st.herd] : undefined;
  if (day % seasonDays() === 0) {
    const bands = [herd, ...Object.values(st.placed?.settlements ?? {}).flat().map((id) => realm.settlements[id])].filter((s): s is Settlement => !!s?.nomadic && !s.abandoned && !s.fallen);
    for (const band of bands) {
      band.nomadic!.at = (band.nomadic!.at + 1) % band.nomadic!.route.length;
      band.pos = { ...band.nomadic!.route[band.nomadic!.at]! };
      realmNews(realm, day, band.id, "peoples", `${band.name} has moved on to its ${["spring", "summer", "autumn", "winter"][band.nomadic!.at % 4]} grazing.`, band === herd ? 2 : 1, [band.name], { why: "the season turned" });
      if (band !== herd) bandArrives(realm, band, day);
    }
  }
  // ---- The goblins raid, a season at a time ----
  const warren = st.warren ? realm.settlements[st.warren] : undefined;
  if (warren && day % seasonDays() === 5 && warren.population >= 20 && unitFor(realm.seed, "warren-raid", day) < 0.7) {
    const target = nearest(realm, warren.pos, (s) => !s.species && !s.way && !s.abandoned && !s.fallen);
    if (target) {
      const ogre = st.ogre ? realm.figures[st.ogre] : undefined;
      const fighters = [warren.leader ? realm.figures[warren.leader] : undefined, ogre?.alive && treatiesBetween(realm, [`s:${warren.id}`], [`p:${ogre.id}`], day, ["service"]).length > 0 ? ogre : undefined].filter((f): f is NonNullable<typeof f> => !!f && f.alive);
      const men = Math.round(warren.population / 3);
      const side: Side = { name: `the goblins of ${warren.name}`, strength: men * 1.1 + fighters.length * 25, fighters, men, home: warren, species: "goblin", rank: "F" };
      realmNews(realm, day, target.id, "raid", `Goblins out of ${warren.name}${ogre && fighters.includes(ogre) ? `, with ${ogre.name} the ogre,` : ""} fell on the mine road of ${target.name}.`, 5, [target.name], { why: "goblins are greedy and the mine is near" });
      raid(realm, side, `s:${warren.id}`, target, day, rng, "goblins after the mine's iron");
    }
  }
  // ---- An old hatred: the orcs and the dwarves ----
  const orcs = st.orcs ? realm.kingdoms[st.orcs] : undefined;
  const dwarves = st.dwarves ? realm.kingdoms[st.dwarves] : undefined;
  if (orcs && dwarves && !orcs.fallen && !dwarves.fallen && day % seasonDays() === 7 && !warOf(realm, `k:${orcs.id}`) && !warOf(realm, `k:${dwarves.id}`) && (orcs.opinion[dwarves.id] ?? 0) <= -40 && unitFor(realm.seed, "orc-war", day) < 0.6) {
    const w = declareWar(realm, [`k:${orcs.id}`], [`k:${dwarves.id}`], day, "an old hatred between orcs and dwarves");
    // The dwarves seek help from a human crown: the one that likes them best, which says yes if it likes the dwarves or hates the orcs.
    const crowns = Object.values(realm.kingdoms).filter((k) => !k.species && !k.fallen).sort((a, b) => (b.opinion[dwarves.id] ?? 0) - (a.opinion[dwarves.id] ?? 0) || a.id.localeCompare(b.id));
    const asked = crowns[0];
    if (asked) {
      const ok = (asked.opinion[dwarves.id] ?? 0) >= 10 || (asked.opinion[orcs.id] ?? 0) <= -20;
      st.asked.push({ day, by: dwarves.id, of: asked.id, ok, war: w.id });
      if (ok) {
        sign(realm, "mutual_defense", `k:${dwarves.id}`, `k:${asked.id}`, day, 4 * seasonDays(), `the dwarves asked ${asked.name} for help against the orcs`);
        if (!w.defenders.includes(`k:${asked.id}`)) w.defenders.push(`k:${asked.id}`);
      }
      realmNews(realm, day, asked.capital, "war", `${dwarves.name} asked ${asked.name} for help against ${orcs.name}; ${asked.name} ${ok ? "answered the call" : "refused"}.`, 7, [], { why: ok ? "an old friendship with the dwarves" : "no quarrel with the orcs worth a war" });
    }
  }
  // ---- The dragon wakes ----
  const dragon = st.dragon ? realm.figures[st.dragon] : undefined;
  const lair = dragon ? st.lairs[dragon.id] : undefined;
  if (dragon?.alive && lair && day % seasonDays() === 9 && day - (st.burned[dragon.id] ?? -999) >= DRAGON_EVERY * seasonDays()) dragonWakes(realm, st, dragon.id, lair, day, rng);
  // ---- Part C: every other people's alliances (each year), intentions (each season) and old hatreds (each year) ----
  const year = 4 * seasonDays();
  if (st.placed) {
    if (day % year === 2) alliancesDay(realm, st, day);
    if (day % seasonDays() === 11) intentionsDay(realm, st, day);
    if (day % year === 20) hatredsDay(realm, st, day);
  }
  // The realm's other dragons (B1), each on its own long sleep: a season apart from the first, so no two wake together.
  (st.placed?.figures.dragon ?? []).forEach((id, i) => {
    const d = realm.figures[id];
    const l = st.lairs[id];
    if (!d?.alive || !l || day % seasonDays() !== (9 + 3 * (i + 1)) % seasonDays()) return;
    if (day - (st.burned[id] ?? -999) < (DRAGON_EVERY + 1) * seasonDays()) return;
    dragonWakes(realm, st, id, l, day, seededRng(Math.floor(unitFor(realm.seed, "dragon-day", id, day) * 2 ** 31)));
  });
}

/**
 * A wandering band comes to its new grazing (B2): the nearest place of another people within a day or two's ride is met. A fierce band
 * (aggression 0.7 and over) raids it if it's weaker than they are; any other band trades: a season's `trade` treaty, coin for hides.
 */
export function bandArrives(realm: Realm, band: Settlement, day: number): "raid" | "trade" | null {
  const p = band.species ? peopleOf(band.species) : undefined;
  if (!p) return null;
  const s = nearest(realm, band.pos, (x) => x.id !== band.id && x.species !== band.species && !x.way && !x.abandoned && !x.fallen && Math.hypot(x.pos.x - band.pos.x, x.pos.y - band.pos.y) <= 90);
  if (!s) return null;
  const rng = seededRng(Math.floor(unitFor(realm.seed, "band-arrives", band.id, day) * 2 ** 31));
  const men = Math.round(band.population / 3);
  if (p.temperament.aggression >= 0.7 && men > s.population * 0.15) {
    const lead = band.leader ? realm.figures[band.leader] : undefined;
    const side: Side = { name: `the ${band.name.replace(/^the /, "")}`, strength: men * 1.2 + (lead?.alive ? 20 : 0), fighters: lead?.alive ? [lead] : [], men, home: band, species: band.species!, rank: "E" };
    realmNews(realm, day, s.id, "raid", `${band.name} came down on ${s.name} as it passed.`, 5, [band.name, s.name], { why: `${p.name.replace(/^an? /, "")}s are fierce, and ${s.name} looked weak` });
    raid(realm, side, `s:${band.id}`, s, day, rng, "a wandering band's raid");
    const st = peoplesOf(realm);
    if (st && s.species) noteRaid(st, s.id, band.id, day);
    return "raid";
  }
  if (stanceOf(band.species!, s.species ?? "human") <= -50) return null;
  sign(realm, "trade", `s:${band.id}`, `s:${s.id}`, day, seasonDays(), `${band.name} trades with ${s.name} while it grazes near`);
  const paid = transfer(realm, `s:${s.id}`, `s:${band.id}`, Math.min(40, Math.round(s.treasury * 0.02)), `hides and horses from ${band.name}`, undefined, day);
  if (paid > 0) s.prosperity = Math.min(100, s.prosperity + 1);
  realmNews(realm, day, s.id, "trade", `${band.name} camped near ${s.name} and traded.`, 1, [band.name, s.name], { why: "they were passing, and at peace" });
  return "trade";
}

/** The dragon burns a hamlet near its peaks and demands tribute; the head pays from the treasury (or the hamlet is burned again). */
export function dragonWakes(realm: Realm, st: PeoplesState, dragonId: string, lair: { x: number; y: number }, day: number, rng: () => number): string | null {
  const dragon = realm.figures[dragonId]!;
  const s = nearest(realm, lair, (x) => !x.species && !x.way && !x.abandoned && (x.kind === "hamlet" || x.kind === "village"));
  if (!s) return null;
  st.burned[dragonId] = day;
  const dead = Math.max(1, Math.round(s.population * 0.06));
  casualty(realm, s, "raid", dead, `dragon:${day}:${s.id}`, day, dragonId);
  damageBuilding(s, rng);
  damageBuilding(s, rng);
  s.lastRaided = day;
  s.prosperity = Math.max(0, s.prosperity - 15);
  addRenown(dragon, 5);
  addDeed(dragon, `burned ${s.name}`);
  realmNews(realm, day, s.id, "dragon", `${dragon.name} the dragon came down from the peaks and burned ${s.name}; ${dead} died in the fire.`, 9, [dragon.name, s.name], { why: "a dragon's hunger for gold" });
  // Tribute, every tax day, or it comes back.
  const amount = Math.max(20, Math.round(s.population * 0.6));
  sign(realm, "tribute", `s:${s.id}`, `p:${dragon.id}`, day, 8 * seasonDays(), `${dragon.name} demanded tribute of ${s.name}`, amount);
  const head = s.leader ? realm.figures[s.leader] : undefined;
  const paid = transfer(realm, `s:${s.id}`, `p:${dragon.id}`, amount, `tribute to ${dragon.name} the dragon`, undefined, day);
  realmNews(realm, day, s.id, "dragon", paid > 0 ? `${head ? head.name : "The head"} of ${s.name} paid ${dragon.name} ${paid} copper in tribute.` : `${s.name} could not pay ${dragon.name}'s tribute.`, 7, [dragon.name, s.name], { why: "fear of the fire" });
  return s.id;
}

/**
 * Residents of other peoples (N54 decision 7): a place whose kingdom has a goblin warren near and lets goblins live in its outer quarters
 * (`species:goblin` welcome or limited) takes in one a season from the warren (the warren is a goblin less: nobody is made up). Some can
 * talk with anyone (the people's clever share). Where a kingdom keeps a people only as slaves, any of them there is a slave.
 */
export function residentsSiteDay(ctx: LifeCtx, site: string, day: number): string | null {
  if (!config.society.peoples) return null;
  const { realm, store } = ctx;
  const st = peoplesOf(realm);
  const s = realm.settlements[site];
  if (!st || !s || s.species || s.way || !s.kingdom) return null;
  // Where a people may only be slaves, those here are.
  for (const r of store.people.loadSite(site, "full") as PersonRow[]) {
    if (r.death !== null || r.species === "human" || r.cls === "slave") continue;
    if (policyAt(realm, site, `species:${r.species}`, day) === "slaves_only") store.people.update(r.id, { cls: "slave", job: "slave" });
  }
  if (day % seasonDays() !== 4) return null;
  if (st.residents.filter((x) => x.site === site).length >= 2) return null;
  const warren = st.warren ? realm.settlements[st.warren] : undefined;
  const goblin = warren && warren.population >= 10 ? comeToLive(ctx, st, s, warren, "goblin", day) : null;
  if (goblin) return goblin;
  // Any other people that talks and has a home of its own near (C3): the nearest such home whose people the law lets live here.
  const homes = Object.entries(st.placed?.settlements ?? {})
    .flatMap(([sp, ids]) => ids.map((id) => ({ sp, h: realm.settlements[id] })))
    .filter((x): x is { sp: string; h: Settlement } => !!x.h && !x.h.abandoned && !x.h.fallen && x.h.population >= 10 && speciesTalks(x.sp))
    .sort((a, b) => Math.hypot(a.h.pos.x - s.pos.x, a.h.pos.y - s.pos.y) - Math.hypot(b.h.pos.x - s.pos.x, b.h.pos.y - s.pos.y) || a.h.id.localeCompare(b.h.id));
  for (const { sp, h } of homes) {
    const id = comeToLive(ctx, st, s, h, sp, day);
    if (id) return id;
  }
  return null;
}

const speciesTalks = (sp: string): boolean => {
  const p = peopleOf(sp);
  return !!p && p.mind !== "beast" && p.body.size !== "huge" && p.body.size !== "gargantuan";
};

/**
 * One of a people comes from their home to live in a human place (N54 decision 7), if the place's kingdom lets them live among its people
 * (`species:<id>` welcome or limited) and the home is near enough: a row of their species in a house of the outer quarters, named in their
 * own words; their home is one fewer (nobody is made up). The goblins' rolls keep their old keys, so a goblin comes exactly as before.
 */
function comeToLive(ctx: LifeCtx, st: PeoplesState, s: Settlement, from: Settlement, species: string, day: number): string | null {
  const { realm, store } = ctx;
  const site = s.id;
  const law = policyAt(realm, site, `species:${species}`, day);
  if (law !== "welcome" && law !== "limited") return null;
  // Only the places near enough to their home.
  if (Math.hypot(from.pos.x - s.pos.x, from.pos.y - s.pos.y) > 220) return null;
  const p = peopleOf(species);
  const key = species === "goblin" ? "goblin" : `resident-${species}`;
  const map = siteMap(s, "village", realm);
  const outer = map.buildings.map((b, i) => ({ b, i })).filter((o) => o.b.kind === "house" && !["d:noble", "d:castle", "d:palace", "d:manor", "d:high_street"].includes(o.b.district ?? ""));
  const home = outer[Math.floor(unitFor(realm.seed, `${key}-home`, site, day) * outer.length)]?.i ?? null;
  const seq = store.people.seq(site);
  const id = `t_${site}_${seq.next_id}`;
  const gender = unitFor(realm.seed, `${key}-gender`, id) < 0.5 ? "female" : "male";
  const clever = species === "goblin" ? unitFor(realm.seed, "clever", id) < Math.max(0.05, p?.cleverShare ?? 0.05) * 6 : unitFor(realm.seed, `clever-${species}`, id) < Math.min(1, (p?.cleverShare ?? 0.05) * 6);
  const names = p?.names ?? ["Snikk"];
  const name = `${names[Math.floor(unitFor(realm.seed, `${key}-name`, id) * names.length)]!} of ${from.name.replace(/^the /, "")}`;
  const age = species === "goblin" ? 14 : Math.round((p?.body.adultAge ?? 16) * 1.3);
  const a = (p?.name ?? species).replace(/^(an?|one of the) /, "");
  store.people.add({ id, site, n: seq.next_n, name, gender, species, born_day: day - age * config.daysPerYear, cls: "commoner", job: "labourer", home, work: null, master: null, master_id: null, faction: null, mother: null, father: null, spouse: null, figure: null, persona: null, traits: null, death: null, expecting: null, last_birth: null, stepped_day: day, outlook: null, away: null, skill: null, shop: null, origin: JSON.stringify({ site: from.id, day, why: species === "goblin" ? "came from the warren to live among people" : `came from ${from.name} to live among people` }), rev: 0 });
  store.people.setSeq(site, { next_id: seq.next_id + 1, next_n: seq.next_n + 1 });
  from.population -= 1;
  st.residents.push({ id, species, site, clever, day });
  const them = `${species.replace(/_/g, " ")}s`;
  if (clever) cleverRises(ctx, id, day);
  recordLifeEvent(realm, store, { kind: "migration", actor: id, site, day, details: `${name}, ${/^[aeiou]/.test(a) ? "an" : "a"} ${a}${clever && species === "goblin" ? " with a quick tongue" : ""}, came from ${from.name} to live in the outer quarter of ${s.name}`, importance: 3, why: law === "welcome" ? `${them} are welcome here` : `${them} may live in the outer quarters here` });
  return id;
}

/**
 * A clever one of another people among humans (N54 D1) is someone folk talk about: a realm figure made for their row, with a name worth a
 * talk (TALKER_RENOWN), so the player meets them as a talking NPC (`promoteRisers`), with their people's view in their persona. The figure's
 * id is the row's (`fig-r-<row>`), not a counter, so a lazy place's catch-up makes the same one (issue #6).
 */
export function cleverRises(ctx: LifeCtx, id: string, day: number): string | null {
  const { realm, store } = ctx;
  const r = store.people.get(id);
  if (!r || r.figure || r.death !== null) return null;
  const figId = `fig-r-${id}`;
  if (realm.figures[figId]) return figId;
  const rng = seededRng(Math.floor(unitFor(realm.seed, "clever-rises", id) * 2 ** 31));
  const next = realm.next;
  const fig = makeFigure(realm, rng, { role: "commoner", home: r.site, tier: "E", age: Math.floor((day - r.born_day) / config.daysPerYear), gender: r.gender === "female" ? "female" : "male", name: r.name, species: r.species, renown: TALKER_RENOWN, wealth: 0, rose: `person:${id}` }, day);
  delete realm.figures[fig.id];
  realm.next = next;
  fig.id = figId;
  fig.person = id;
  realm.figures[figId] = fig;
  // No place name in the deed: deeds become lore, and lore names only names the realm's talk already knows (n12's invented-name check).
  addDeed(fig, "came to live among folk not of their own kind");
  store.people.update(id, { figure: figId });
  return figId;
}
