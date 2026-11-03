import { config } from "../../config.js";
import type { PersonRow } from "../../store/peopleStore.js";
import { addGrievance } from "../chatter/grievance.js";
import { temperOf } from "../chatter/person.js";
import { adjustRel } from "../chatter/rel.js";
import { streamFor, unitFor } from "../dice.js";
import { festivalOn, marketOffsetOf, MARKET_EVERY } from "../events-calendar.js";
import { learn } from "../gossip/knowledge.js";
import { eventRef } from "../gossip/refs.js";
import { recordLifeEvent } from "../people/events.js";
import type { LifeCtx } from "../people/step.js";
import { ageFrom } from "../people/rules.js";
import { sink } from "../realm/ledger.js";
import type { Realm } from "../realm/types.js";
import { gameById, resolveGame, type Entrant, type GameDef } from "./games.js";
import { leisureOf, logResult, type LeisureResult } from "./events.js";
import { competeScore, rowEntrant } from "./people.js";

/**
 * Contest days (N41 step 3): on each festival, and on some market days in a town, the head of the place puts on archery, wrestling and
 * a foot race (a strongman's lift and a horse race in a town with the people for them), with prizes from the treasury. Who enters is
 * N38-style scoring (pride, bravery, youth, wanting a name). Winners gain renown; a proud runner-up holds it against the winner; at a
 * festival the young dance, and dancing together warms them to each other. The player can enter, bet and put one on (player.ts).
 *
 * A place's contest day is worked out in its next day's step (a place lived later gets the same), unless the player already took part
 * in a game of it while there (`leisure.done`).
 */
export const CONTEST = {
  /** Least score to enter, and the share of the score that is the chance. */
  least: 0.45,
  chance: 0.6,
  /** Prize per game, by kind of place. */
  prize: { hamlet: 0, village: 15, town: 40, city: 80, capital: 120 } as Record<string, number>,
  /** A market day in a town has a contest this often. */
  market: 0.25,
  /** Couples who dance at a festival. */
  dancers: 6,
} as const;

/** Is there a contest day at the place: a festival anywhere but a hamlet, some market days in a town, or one the player paid for. */
export function contestOn(realm: Realm, site: string, day: number): boolean {
  const s = realm.settlements[site];
  if (!s || s.abandoned || s.fallen || s.way || s.kind === "hamlet") return false;
  if (leisureOf(realm).events.some((e) => e.kind === "contest_day" && e.site === site && e.day === day)) return true;
  if (festivalOn(day)) return true;
  const market = (day + marketOffsetOf(site)) % MARKET_EVERY === 0;
  return market && s.kind !== "village" && unitFor(realm.seed, "contest-market", site, day) < CONTEST.market;
}

/** The games of a place's contest day. */
export function contestGames(realm: Realm, site: string, rows: PersonRow[]): GameDef[] {
  const s = realm.settlements[site]!;
  const ids = ["archery", "wrestling", "foot_race"];
  if (s.kind !== "village") ids.push("strongman");
  if (s.kind !== "village" && rows.filter((r) => ["gentry", "noble", "royal", "merchant"].includes(r.cls)).length >= 3) ids.push("horse_race");
  return ids.map(gameById);
}

/** Who may enter a game. */
export const mayEnter = (g: GameDef, r: PersonRow, day: number): boolean => (!g.who.classes || g.who.classes.includes(r.cls)) && ageFrom(r.born_day, day) >= (g.who.minAge ?? 14) && r.job !== "child";

/** The entrants a game of a contest day draws from the place (best-scored first, at most its most). */
export function entrantsFor(realm: Realm, g: GameDef, rows: PersonRow[], site: string, day: number): PersonRow[] {
  return rows
    .filter((r) => mayEnter(g, r, day))
    .map((r) => ({ r, score: competeScore(r, day) + (g.resolve.skill === "archery" && r.job === "hunter" ? 0.3 : 0) + (g.resolve.attribute === "strength" && ["labourer", "smith", "porter", "farmer"].includes(r.job) ? 0.15 : 0) }))
    .filter((x) => x.score >= CONTEST.least && unitFor(realm.seed, "contest-enter", x.r.id, site, day, g.id) < x.score * CONTEST.chance)
    .sort((a, b) => b.score - a.score || (a.r.id < b.r.id ? -1 : 1))
    .slice(0, g.players[1])
    .map((x) => x.r)
    .sort((a, b) => (a.id < b.id ? -1 : 1));
}

export interface PlayerEntry {
  game: string;
  entrant: Entrant;
  /** A bet on someone (a row id, or "player"), and how much. */
  bet?: { on: string; stake: number };
}

/**
 * Hold one game of a contest day: resolve it, pay the prize, give the renown, leave the grudges. With the player in it (`player`), the
 * player is one more entrant; the result says where they placed. Marks the game done.
 */
export function holdGame(ctx: LifeCtx, site: string, day: number, g: GameDef, rows: PersonRow[], player?: PlayerEntry, enters = true, rigged?: string, today = day): LeisureResult["games"][number] & { event?: string } {
  const { realm, store } = ctx;
  const s = realm.settlements[site]!;
  const entrants = entrantsFor(realm, g, rows, site, day);
  // Someone paid to lose throws it: their best is not tried (game/leisure/player.ts `playerRig`).
  const throws = (e: Entrant): Entrant => (e.id === rigged ? { ...e, attrs: { ...e.attrs, [g.resolve.attribute]: Math.max(1, (e.attrs[g.resolve.attribute] ?? 10) - 8) }, skills: {} } : e);
  const all: Entrant[] = [...entrants.map((r) => throws(rowEntrant(r, day))), ...(player && enters ? [player.entrant] : [])];
  const rng = streamFor(realm.seed, "contest", site, day, g.id);
  leisureOf(realm).done[`${site}:${day}:${g.id}`] = true;
  if (all.length < g.players[0]) return { game: g.id, entrants: all.map((e) => e.id), order: [], winner: null, cheats: [], injuries: [], deaths: [] };
  const p = resolveGame(g, all, rng);
  const out: LeisureResult["games"][number] & { event?: string } = { game: g.id, entrants: all.map((e) => e.id), order: p.order, winner: p.winner, cheats: p.cheats, injuries: p.injuries, deaths: [] };
  const name = (id: string) => (id === "player" ? (player?.entrant.name ?? "a stranger") : (store.people.get(id)?.name ?? id));
  const crowd = rows.filter((r) => !all.some((e) => e.id === r.id)).slice(0, 12).map((r) => r.id);
  if (!p.winner) return out;
  const festival = festivalOn(day);
  const e = recordLifeEvent(realm, store, { kind: "contest", actor: p.winner, site, day, hour: 14, key: `${g.id}:${site}`, details: `${name(p.winner)} won ${g.name} at ${s.name}${festival ? `'s ${festival} festival` : ""}${p.order[1] ? `, ahead of ${name(p.order[1])}` : ""}`, importance: 1, witnesses: [...crowd, ...all.map((x) => x.id).filter((id) => id !== "player")] });
  out.event = e.id;
  if (config.gossip) for (const id of [...crowd, ...entrants.map((r) => r.id)]) learn(ctx, id, eventRef(e.id), { day: today, source: "saw", accuracy: 1 });
  // Renown: the winner, and a little for a place.
  const bump = (id: string, n: number) => {
    if (id === "player" || n === 0) return;
    const r = store.people.get(id);
    if (r) store.people.update(id, { renown: Math.max(-100, Math.min(100, (r.renown ?? 0) + n)) });
  };
  bump(p.winner, g.renown[0]);
  if (p.order[1]) bump(p.order[1], g.renown[1]);
  // The prize, from the treasury (it leaves the books: a townsperson's purse isn't one of them).
  const prize = Math.min(CONTEST.prize[s.kind] ?? 0, s.treasury);
  if (prize > 0 && p.winner !== "player") sink(realm, `s:${site}`, prize, `the ${g.name} prize to ${name(p.winner)}`, undefined, day);
  // A proud runner-up beaten in front of everyone holds it against the winner (a rival).
  const second = p.order[1];
  if (second && second !== "player" && p.winner !== "player") {
    const r2 = store.people.get(second);
    if (config.chatter && r2 && temperOf(r2).pride > 0.65) addGrievance(store, { who: second, against: p.winner, cause: eventRef(e.id), weight: 0.2, day });
  }
  for (const id of p.injuries) {
    if (id === "player") continue;
    const r = store.people.get(id);
    if (r) recordLifeEvent(realm, store, { kind: "injury", actor: id, site, day, hour: 14, key: `contest-hurt:${id}:${g.id}`, details: `${r.name} was hurt in ${g.name}`, importance: 1, causedBy: [e.id] });
  }
  return out;
}

/**
 * A contest day's games that are still to be held (the player may have held some), then the dancing. `today` is the day being stepped
 * (the day after, usually): what was seen is learned on it, so the knowledge cap counts it with the rest of that day's rows.
 */
export function contestDay(ctx: LifeCtx, site: string, day: number, today = day): LeisureResult | null {
  const { realm, store } = ctx;
  if (!contestOn(realm, site, day)) return null;
  const rows = (store.people.loadSite(site, "full") as PersonRow[]).filter((r) => r.death === null && !r.away && !r.captive);
  const done = leisureOf(realm).done;
  const res: LeisureResult = { id: `contest:${site}:${day}`, kind: "contest_day", site, day, games: [], deaths: [] };
  for (const g of contestGames(realm, site, rows)) {
    if (done[`${site}:${day}:${g.id}`]) continue;
    res.games.push(holdGame(ctx, site, day, g, rows, undefined, false, leisureOf(realm).rigged?.[`${site}:${day}:${g.id}`], today));
  }
  if (festivalOn(day)) dance(ctx, site, day, rows);
  if (res.games.length > 0) logResult(realm, res);
  return res;
}

/** The dancing at a festival: the young and unwed pair off, and warm to each other. */
function dance(ctx: LifeCtx, site: string, day: number, rows: PersonRow[]): void {
  const { realm, store } = ctx;
  const young = rows.filter((r) => !r.spouse && ageFrom(r.born_day, day) >= 16 && ageFrom(r.born_day, day) <= 35 && r.job !== "child");
  const men = young.filter((r) => r.gender === "male").filter((r) => unitFor(realm.seed, "dance", r.id, day) < 0.4);
  const women = young.filter((r) => r.gender === "female").filter((r) => unitFor(realm.seed, "dance", r.id, day) < 0.4);
  for (let i = 0; i < Math.min(CONTEST.dancers, men.length, women.length); i++) {
    const a = men[i]!;
    const b = women[i]!;
    if (config.chatter) {
      adjustRel(store, a.id, b.id, { affection: 8, trust: 3 }, day);
      adjustRel(store, b.id, a.id, { affection: 8, trust: 3 }, day);
    }
    if (i < 2) recordLifeEvent(realm, store, { kind: "courtship", actor: a.id, target: b.id, site, day, hour: 21, key: `dance:${a.id}`, details: `${a.name} and ${b.name} danced the night through at the festival`, importance: 1 });
  }
}
