import { seasonDay } from "@millbrook/shared";
import { config } from "../../config.js";
import type { PersonRow } from "../../store/peopleStore.js";
import { addGrievance } from "../chatter/grievance.js";
import { temperOf } from "../chatter/person.js";
import type { WorldStore } from "../db.js";
import { streamFor, unitFor, type Rng } from "../dice.js";
import { learn } from "../gossip/knowledge.js";
import { eventRef } from "../gossip/refs.js";
import { killPerson } from "../people/index.js";
import { lazySites } from "../people/live.js";
import { catchUp } from "../people/world.js";
import { recordLifeEvent } from "../people/events.js";
import { ageFrom } from "../people/rules.js";
import { traitsOfRow } from "../people/traits.js";
import { atWar } from "../realm/economy.js";
import { travelDays } from "../realm/generate.js";
import { sink } from "../realm/ledger.js";
import { realmNews } from "../realm/log.js";
import type { Realm, Settlement } from "../realm/types.js";
import { roadDataOf } from "../road/generateRoads.js";
import { awaySite, departureOn, journeyOf, launch } from "../road/journeys.js";
import { shortest } from "../road/paths.js";
import { dailyChance, seasonOf } from "../weather.js";
import { gameById, resolveGame, type Played } from "./games.js";
import { rowEntrant } from "./people.js";

/**
 * Fairs and tournaments (N41 steps 3-4), the realm's leisure: announced as news that travels, and gathering people from places a journey
 * away. A lord with coin to spare and no war on hosts a tournament; knights within reach decide to ride to it (a round-trip journey, N26
 * Part E) and joust and fight in the melee there; a champion's name is news across the kingdom, and a knight killed in the lists does not
 * ride home. A town holds a fair twice a year: traders, players and the curious come in from round about the day before.
 *
 * Kept in `realm.leisure`: what is announced (`events`) and what came of it (`log`, the newest few dozen).
 */

export type LeisureKind = "fair" | "contest_day" | "tournament";

export interface LeisureEvent {
  id: string;
  kind: LeisureKind;
  site: string;
  day: number;
  /** The figure or row who puts it on, and why. */
  host?: string;
  why: string;
  prize: number;
  announced: number;
  /** Who means to take part (row ids) and the journeys bringing them. */
  entrants: string[];
  journeys: string[];
  /** Put on by the player (paid for), so held whoever's day it is. */
  byPlayer?: boolean;
}

export interface LeisureResult {
  id: string;
  kind: LeisureKind;
  site: string;
  day: number;
  games: Array<{ game: string; entrants: string[]; order: string[]; winner: string | null; cheats: Played["cheats"]; injuries: string[]; deaths: string[] }>;
  champion?: string;
  championName?: string;
  deaths: string[];
  visitors?: number;
  news?: string;
  /** The player took part (N41 step 5), and how they placed. */
  player?: { game: string; place: number; of: number };
}

export interface LeisureState {
  events: LeisureEvent[];
  log: LeisureResult[];
  /** Contest days already held, by `site:day:game` (the player's place may hold its own while they watch), and tavern nights played. */
  done: Record<string, true>;
  /** Entrants paid by the player to lose, by `site:day:game`. */
  rigged?: Record<string, string>;
}

export const LOG_KEPT = 60;

export function leisureOf(realm: Realm): LeisureState {
  const l = (realm.leisure ??= { events: [], log: [], done: {} }) as LeisureState;
  l.events ??= [];
  l.log ??= [];
  l.done ??= {};
  return l;
}

export function logResult(realm: Realm, r: LeisureResult): void {
  const l = leisureOf(realm);
  l.log.push(r);
  if (l.log.length > LOG_KEPT) l.log.splice(0, l.log.length - LOG_KEPT);
}

export const TOURNEY = {
  /** Days between the announcement and the day of it: time for knights more than a week off to ride there. */
  notice: 11,
  /** How far a knight will ride for a tournament (days): a tournament is called across the kingdom. */
  reach: 8,
  /** Most knights in the lists, and from any one place. */
  most: 12,
  perPlace: 4,
  /** What a host puts up, and must have twice over. */
  prize: 300,
  /** Chance a year that a lord who can afford it holds one. */
  perYear: 0.6,
  /** Renown for the champion and for every knight who rode in it. */
  renown: 15,
} as const;

export const FAIR = {
  /** The day of the season a town's fair falls on, in summer and autumn. */
  seasonDay: 8,
  notice: 4,
  /** How far people come for a fair (days). */
  reach: 2,
  /** Most visitors from any one place. */
  perPlace: 4,
} as const;

const HOSTS = new Set(["lord", "ruler", "mayor"]);

const grown = (r: PersonRow, day: number) => ageFrom(r.born_day, day) >= 18 && r.job !== "child";

/** A place's people who are at home and well. */
/**
 * The people at home in a place. A lazy place is brought up to yesterday first, as the road does before it takes anyone (N26 Part E):
 * otherwise who is drawn from it, and when they are marked away, would depend on when it was last worked out.
 */
function homeRows(realm: Realm, store: WorldStore, site: string, day: number): PersonRow[] {
  if (lazySites().has(site) && store.people.seq(site).stepped > 0) catchUp({ realm, store }, site, day - 1);
  // A place worked out once and then left behind (a journey touched it) is caught up only when touched again, and its catch-up would
  // have its people learn older things after this: nobody is drawn from it. (One never worked out starts afresh, with no past to live.)
  const stepped = store.people.seq(site).stepped;
  if (stepped > 0 && stepped < day - 1) return [];
  return (store.people.loadSite(site, "full") as PersonRow[]).filter((r) => r.death === null && !r.away && !r.captive);
}

/** Can this place hold a tournament now: a town or above, headed by a lord, with the prize twice over, at peace, none this season. */
export function canHost(realm: Realm, s: Settlement, day: number): boolean {
  if (s.abandoned || s.fallen || !["town", "city", "capital"].includes(s.kind)) return false;
  const head = s.leader ? realm.figures[s.leader] : undefined;
  if (!head?.alive || !HOSTS.has(head.role)) return false;
  if (s.treasury < TOURNEY.prize * 2 || atWar(realm, s)) return false;
  const l = leisureOf(realm);
  const season = Math.max(1, Math.floor(config.daysPerYear / 4));
  return !l.events.some((e) => e.kind === "tournament" && e.site === s.id) && !l.log.some((e) => e.kind === "tournament" && e.site === s.id && day - e.day < season);
}

/**
 * A lord puts on a tournament (decision 3): announced as news from the place, `TOURNEY.notice` days ahead. Knights within reach decide
 * to ride to it the same day; each who goes sets out on a round trip that turns at the host's town. Returns the event, or null.
 */
export function hostTournament(realm: Realm, store: WorldStore | undefined, site: string, day: number, why = "for the glory of the house"): LeisureEvent | null {
  const s = realm.settlements[site];
  if (!s) return null;
  const head = s.leader ? realm.figures[s.leader] : undefined;
  const ev: LeisureEvent = { id: `tourney:${site}:${day + TOURNEY.notice}`, kind: "tournament", site, day: day + TOURNEY.notice, ...(head ? { host: head.id } : {}), why, prize: TOURNEY.prize, announced: day, entrants: [], journeys: [] };
  leisureOf(realm).events.push(ev);
  realmNews(realm, day, site, "tournament", `${head ? `${head.name} of ${s.name}` : s.name} will hold a tournament on day ${ev.day}, ${why}; knights are called to the lists.`, 5, [s.name, ...(head ? [head.name] : [])]);
  if (store) callKnights(realm, store, ev, day);
  return ev;
}

/** Knights within reach decide whether to ride (N38-style score: bravery, wanting a name, distance) and set out. */
function callKnights(realm: Realm, store: WorldStore, ev: LeisureEvent, day: number): void {
  const host = realm.settlements[ev.site]!;
  const data = roadDataOf(realm);
  const places = Object.values(realm.settlements)
    .filter((s) => !s.abandoned && !s.fallen && (s.kingdom === host.kingdom || s.id === host.id) && travelDays(realm, s.id, host.id) <= TOURNEY.reach)
    .sort((a, b) => a.id.localeCompare(b.id));
  const want: Array<{ r: PersonRow; score: number }> = [];
  for (const s of places) {
    for (const r of homeRows(realm, store, s.id, day)) {
      // Knights, and (until there are armies with ranks, N55) the gentry and nobles young and bold enough to ride as knights-errant.
      const t = traitsOfRow(r);
      const errant = ["gentry", "noble"].includes(r.cls) && ageFrom(r.born_day, day) <= 45 && t.bravery >= 0.45 && !["clerk", "scholar", "priest", "child"].includes(r.job);
      if ((r.job !== "knight" && !errant) || !grown(r, day) || ageFrom(r.born_day, day) > 55) continue;
      const far = travelDays(realm, s.id, host.id);
      const score = 0.15 + 0.45 * t.bravery + 0.3 * t.ambition + 0.2 * temperOf(r).pride - 0.04 * far + (s.id === host.id ? 0.2 : 0) - (r.job === "knight" ? 0 : 0.2);
      if (unitFor(realm.seed, "tourney-go", r.id, ev.id) < score) want.push({ r, score });
    }
  }
  want.sort((a, b) => b.score - a.score || (a.r.id < b.r.id ? -1 : 1));
  const fromPlace = new Map<string, number>();
  const going = want.filter(({ r }) => {
    const n = fromPlace.get(r.site) ?? 0;
    fromPlace.set(r.site, n + 1);
    return n < TOURNEY.perPlace;
  });
  for (const { r } of going.slice(0, TOURNEY.most)) {
    if (r.site === ev.site) {
      ev.entrants.push(r.id);
      continue;
    }
    const way = shortest(data, r.site, ev.site);
    if (!way) continue;
    const back = [...way].reverse().slice(1);
    // They stay for the day of it and the feast after; the timeline takes them home after.
    const stay = Math.max(1440, (ev.day + 1 - day) * 1440);
    const j = launch(realm, data, { kind: "tourney", party: [{ person: r.id, name: r.name, role: "knight", gender: r.gender === "female" ? "female" : "male" }], path: [...way, ...back], depart: departureOn(day + 1, unitFor(realm.seed, "tourney-depart", r.id)), purpose: `riding to the tournament at ${host.name}`, turn: { index: way.length - 1, stay }, guards: 1 }, store.people);
    if (!j) continue;
    ev.entrants.push(r.id);
    ev.journeys.push(j.id);
  }
}

/** The realm's leisure for a day: tournaments decided, held; fairs announced, held. Runs after the realm's own day. */
export function leisureRealmDay(realm: Realm, day: number, rng: Rng, store?: WorldStore): void {
  const l = leisureOf(realm);
  // What is due today happens.
  for (const ev of l.events.filter((e) => e.day === day).sort((a, b) => a.id.localeCompare(b.id))) {
    if (ev.kind === "tournament" && store) holdTournament(realm, store, ev, day);
    else if (ev.kind === "fair" && store) holdFair(realm, store, ev, day);
  }
  l.events = l.events.filter((e) => e.day > day || (e.kind === "contest_day" && e.day >= day - 1));
  // What was held long ago is forgotten (the keys are by day).
  for (const k of Object.keys(l.done)) if (Number(k.split(":").at(k.startsWith("tavern:") ? -1 : 1)) < day - 3) delete l.done[k];
  for (const k of Object.keys(l.rigged ?? {})) if (Number(k.split(":")[1]) < day - 3) delete l.rigged![k];
  // Lords decide on tournaments.
  for (const s of Object.values(realm.settlements).sort((a, b) => a.id.localeCompare(b.id))) {
    if (!canHost(realm, s, day)) continue;
    // A victory, or a full treasury, makes a lord likelier to show it off.
    const won = realm.wars.some((w) => w.end !== undefined && day - w.end <= 6 && ((w.winner === "attackers" && w.attackers.includes(`k:${s.kingdom}`)) || (w.winner === "defenders" && w.defenders.includes(`k:${s.kingdom}`))));
    const rich = s.treasury >= TOURNEY.prize * 6 ? 1.5 : 1;
    if (rng() < dailyChance(TOURNEY.perYear * rich * (won ? 4 : 1))) hostTournament(realm, store, s.id, day, won ? "to celebrate the victory" : "for the glory of the house");
  }
  // Towns announce their fairs.
  const ahead = day + FAIR.notice;
  if (seasonDay(ahead, config.daysPerYear) === FAIR.seasonDay && (seasonOf(ahead) === "summer" || seasonOf(ahead) === "autumn")) {
    for (const s of Object.values(realm.settlements).sort((a, b) => a.id.localeCompare(b.id))) {
      if (s.abandoned || s.fallen || !["town", "city", "capital"].includes(s.kind) || (s.buildings.market ?? 0) === 0) continue;
      announceFair(realm, store, s.id, day, ahead);
    }
  }
}

/** A fair announced (decision 3): news from the place, and the curious of places within reach decide to come, arriving the day before. */
export function announceFair(realm: Realm, store: WorldStore | undefined, site: string, day: number, on: number): LeisureEvent {
  const s = realm.settlements[site]!;
  const ev: LeisureEvent = { id: `fair:${site}:${on}`, kind: "fair", site, day: on, why: `${seasonOf(on)} fair`, prize: 0, announced: day, entrants: [], journeys: [] };
  leisureOf(realm).events.push(ev);
  realmNews(realm, day, site, "fair", `${s.name} holds its ${seasonOf(on)} fair on day ${on}: traders, players, a menagerie and games of chance.`, 4, [s.name]);
  if (!store) return ev;
  const data = roadDataOf(realm);
  for (const from of Object.values(realm.settlements).filter((x) => x.id !== site && !x.abandoned && !x.fallen && !x.way && travelDays(realm, x.id, site) <= FAIR.reach).sort((a, b) => a.id.localeCompare(b.id))) {
    const way = shortest(data, from.id, site);
    if (!way) continue;
    const goers = homeRows(realm, store, from.id, day)
      .filter((r) => grown(r, day) && r.cls !== "serf" && r.cls !== "slave" && !r.captive && ["merchant", "stallholder", "labourer", "farmer", "porter", "weaver", "potter", "server"].includes(r.job))
      .filter((r) => unitFor(realm.seed, "fair-go", r.id, ev.id) < 0.06)
      .slice(0, FAIR.perPlace);
    if (goers.length === 0) continue;
    // Set out early enough to be there the day before.
    const leave = Math.max(day + 1, on - 1 - travelDays(realm, from.id, site));
    const j = launch(realm, data, { kind: "market", party: goers.map((r) => ({ person: r.id, name: r.name, role: r.job, gender: r.gender === "female" ? "female" : "male" })), path: [...way, ...[...way].reverse().slice(1)], depart: departureOn(leave, 0.1), purpose: `going to the fair at ${s.name}`, turn: { index: way.length - 1, stay: Math.max(1440, (on + 1 - leave) * 1440) } }, store.people);
    if (!j) continue;
    ev.entrants.push(...goers.map((r) => r.id));
    ev.journeys.push(j.id);
  }
  return ev;
}

/** Who of an event's travellers are in the host's place today (their journey has them there). */
function arrivedFor(realm: Realm, store: WorldStore, ev: LeisureEvent, day: number): PersonRow[] {
  const out: PersonRow[] = [];
  for (const id of ev.entrants) {
    const r = store.people.get(id);
    if (!r || r.death !== null) continue;
    if (r.site === ev.site && !r.away) out.push(r);
    else {
      const away = r.away ? (JSON.parse(r.away) as { journey: string }) : null;
      if (away && awaySite(realm, away.journey, day) === ev.site) out.push(r);
    }
  }
  return out;
}

/** The day of the tournament (decision 3): jousts to a champion, then the melee; hurts and deaths; the prize, the renown, the news. */
export function holdTournament(realm: Realm, store: WorldStore, ev: LeisureEvent, day: number): LeisureResult {
  const s = realm.settlements[ev.site]!;
  const rng = streamFor(realm.seed, "tournament", ev.id);
  const knights = arrivedFor(realm, store, ev, day).sort((a, b) => (a.id < b.id ? -1 : 1));
  const res: LeisureResult = { id: ev.id, kind: "tournament", site: ev.site, day, games: [], deaths: [] };
  const lists = homeRows(realm, store, ev.site, day).filter((r) => grown(r, day)).slice(0, 12).map((r) => r.id);
  const joust = gameById("joust");
  const dead = new Set<string>();
  // The jousts: pairs ride until one is left.
  let round = knights.map((k) => k);
  for (let i = round.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [round[i], round[j]] = [round[j]!, round[i]!];
  }
  while (round.length > 1) {
    const next: PersonRow[] = [];
    for (let i = 0; i < round.length; i += 2) {
      const a = round[i]!;
      const b = round[i + 1];
      if (!b) {
        next.push(a);
        continue;
      }
      const p = resolveGame(joust, [rowEntrant(a, day), rowEntrant(b, day)], rng);
      res.games.push({ game: "joust", entrants: [a.id, b.id], order: p.order, winner: p.winner, cheats: [], injuries: p.injuries, deaths: p.deaths });
      for (const d of p.deaths) dead.add(d);
      const w = p.winner === a.id ? a : p.winner === b.id ? b : null;
      if (w) next.push(w);
    }
    round = next;
  }
  const champion = round[0];
  // The melee: everyone still standing, for the second prize and the crowd.
  const standing = knights.filter((k) => !dead.has(k.id));
  if (standing.length >= 4) {
    const m = resolveGame(gameById("melee"), standing.map((k) => rowEntrant(k, day)), rng);
    res.games.push({ game: "melee", entrants: standing.map((k) => k.id), order: m.order, winner: m.winner, cheats: [], injuries: m.injuries, deaths: m.deaths });
    for (const d of m.deaths) if (d !== champion?.id) dead.add(d);
  }
  const ev0 = recordLifeEvent(realm, store, { kind: "tournament", actor: champion?.id ?? ev.host ?? ev.site, site: ev.site, day, key: ev.id, details: `The tournament at ${s.name}: ${knights.length} knights rode${champion ? `, and ${champion.name} was champion` : ""}`, importance: 6, witnesses: lists, why: ev.why });
  for (const id of lists) if (config.gossip) learn({ realm, store }, id, eventRef(ev0.id), { day, source: "saw", accuracy: 1 });
  // Those killed in the lists: their journeys end here.
  for (const id of [...dead].sort()) {
    const r = store.people.get(id);
    if (!r) continue;
    killPerson(realm, store, id, { cause: "accident", day, site: ev.site, event: ev0.id, note: `killed in the lists at ${s.name}` });
    store.people.update(id, { away: null });
    for (const jid of ev.journeys) {
      const j = journeyOf(realm, jid);
      if (j && j.party.some((t) => t.person === id)) {
        j.party = j.party.filter((t) => t.person !== id);
        if (j.party.length === 0) (j as { closed?: boolean }).closed = true;
      }
    }
    res.deaths.push(id);
  }
  for (const id of new Set(res.games.flatMap((g) => g.injuries))) {
    if (dead.has(id)) continue;
    const r = store.people.get(id);
    if (r) recordLifeEvent(realm, store, { kind: "injury", actor: id, site: ev.site, day, key: `lists:${id}`, details: `${r.name} was hurt in the lists at ${s.name}`, importance: 3, causedBy: [ev0.id] });
  }
  // Renown for all who rode, more for the champion; the prize from the host's treasury.
  for (const k of knights) {
    if (dead.has(k.id)) continue;
    const r = store.people.get(k.id)!;
    store.people.update(k.id, { renown: Math.min(100, (r.renown ?? 0) + (k.id === champion?.id ? TOURNEY.renown : 2)) });
  }
  if (champion && !dead.has(champion.id)) {
    res.champion = champion.id;
    res.championName = champion.name;
    const paid = Math.min(ev.prize, s.treasury);
    if (paid > 0) sink(realm, `s:${s.id}`, paid, `the tournament's prize to ${champion.name}`, undefined, day);
    const home = realm.settlements[champion.site]?.name ?? "parts unknown";
    const killed = res.deaths.map((id) => store.people.get(id)?.name).filter(Boolean) as string[];
    const renown = store.people.get(champion.id)?.renown ?? 0;
    res.news = `${champion.name} of ${home} is champion of the tournament at ${s.name}${killed.length > 0 ? `; ${killed.join(" and ")} died in the lists` : ""}.`;
    realmNews(realm, day, ev.site, "tournament", res.news, Math.min(9, 6 + Math.floor(renown / 40)), [champion.name, s.name, home, ...killed]);
    // The beaten in the final may take it hard.
    const final = res.games.filter((g) => g.game === "joust").at(-1);
    const loser = final?.entrants.find((id) => id !== champion.id && !dead.has(id));
    const lr = loser ? store.people.get(loser) : null;
    if (config.chatter && lr && temperOf(lr).pride > 0.6) addGrievance(store, { who: lr.id, against: champion.id, cause: eventRef(ev0.id), weight: 0.3, day });
  } else if (knights.length > 0) {
    realmNews(realm, day, ev.site, "tournament", `The tournament at ${s.name} ended without a champion.`, 4, [s.name]);
  }
  logResult(realm, res);
  return res;
}

/** The fair (decision 3): the visitors who came, the games played, the menagerie shown; news of a good one. */
export function holdFair(realm: Realm, store: WorldStore, ev: LeisureEvent, day: number): LeisureResult {
  const s = realm.settlements[ev.site]!;
  const visitors = arrivedFor(realm, store, ev, day).filter((r) => r.site !== ev.site);
  const rng = streamFor(realm.seed, "fair", ev.id);
  const folk = [...visitors, ...homeRows(realm, store, ev.site, day).filter((r) => grown(r, day))].sort((a, b) => (a.id < b.id ? -1 : 1));
  const res: LeisureResult = { id: ev.id, kind: "fair", site: ev.site, day, games: [], deaths: [], visitors: visitors.length };
  for (const gid of ["strongman", "cards"]) {
    const g = gameById(gid);
    const n = Math.min(folk.length, g.players[1]);
    const picked = folk.filter((r) => unitFor(realm.seed, "fair-play", r.id, ev.id, gid) < 0.3).slice(0, n);
    if (picked.length < g.players[0]) continue;
    const p = resolveGame(g, picked.map((r) => rowEntrant(r, day)), rng);
    res.games.push({ game: gid, entrants: picked.map((r) => r.id), order: p.order, winner: p.winner, cheats: p.cheats, injuries: p.injuries, deaths: p.deaths });
  }
  const e = recordLifeEvent(realm, store, { kind: "fair", actor: ev.site, site: ev.site, day, key: ev.id, details: `${s.name}'s ${ev.why}: ${visitors.length} came in from round about`, importance: 3, witnesses: folk.slice(0, 10).map((r) => r.id) });
  for (const r of folk.slice(0, 10)) if (config.gossip) learn({ realm, store }, r.id, eventRef(e.id), { day, source: "saw", accuracy: 1 });
  logResult(realm, res);
  return res;
}
