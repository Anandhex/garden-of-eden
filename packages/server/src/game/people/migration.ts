import type { PersonRow } from "../../store/peopleStore.js";
import { speciesOf } from "../../world/species.js";
import { streamFor, type Rng } from "../dice.js";
import { FAMINE } from "../realm/economy.js";
import { neighbours } from "../realm/generate.js";
import { crowding, PER_HOUSE } from "../realm/houses.js";
import { realmNews, tally } from "../realm/log.js";
import type { Realm, Settlement } from "../realm/types.js";
import { recordLifeEvent } from "./events.js";
import { LIVES } from "./rates.js";
import { ageFrom } from "./rules.js";
import type { LifeCtx } from "./step.js";
import { sendArrival } from "../realm/arrivals.js";
import { outlookOf } from "./outlook.js";
import { WALK_PACE, type Journey, type Traveller } from "@millbrook/shared";
import { roadDataOf } from "../road/generateRoads.js";
import { departureOn, launch } from "../road/journeys.js";
import { shortest } from "../road/paths.js";

/**
 * People moving between places (N25). Decided once a day for the whole realm, by household, before
 * anyone's own step, and applied to both places' rows at once: so a place's own days never depend on
 * order, and a lazily-stepped place is simply brought up to date before it gives or takes anyone
 * (`ensureCurrent`). A household is a couple and their children under age, or one grown person; only the
 * free classes go (serfs are bound to the land, slaves to their masters, the gentry and above have
 * their manors), and they go together.
 */
/** Daily share of a frightened or starving place's people who leave (a household at a time; the old model took 2% off the number). */
export const FLEEING_SHARE = 0.012;

const FREE = new Set(["commoner", "artisan", "merchant"]);

const roundBy = (rng: Rng, n: number): number => {
  const f = Math.floor(n);
  return f + (rng() < n - f ? 1 : 0);
};

export interface Household {
  key: string;
  members: PersonRow[];
}

/** The living of a place grouped into households. `everyone`: an emptying place sends all of them, whatever their class. */
export function householdsOf(rows: PersonRow[], day: number, everyone: boolean): Household[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const homeOf = new Map<string, string>(); // member -> household key
  const groups = new Map<string, PersonRow[]>();
  const add = (key: string, r: PersonRow) => {
    homeOf.set(r.id, key);
    let g = groups.get(key);
    if (!g) groups.set(key, (g = []));
    g.push(r);
  };
  for (const r of rows) {
    const grown = ageFrom(r.born_day, day) >= speciesOf(r.species).adultAge;
    if (!grown) continue;
    // A couple is one household, under whichever of them has the smaller id.
    add(r.spouse && byId.has(r.spouse) ? (r.id < r.spouse ? r.id : r.spouse) : r.id, r);
  }
  for (const r of rows) {
    const grown = ageFrom(r.born_day, day) >= speciesOf(r.species).adultAge;
    if (grown) continue;
    const parent = [r.mother, r.father].filter((p): p is string => !!p && homeOf.has(p))[0];
    // An orphan goes only with everyone else, alone.
    if (parent) add(homeOf.get(parent)!, r);
    else if (everyone) add(r.id, r);
  }
  return [...groups]
    .filter(([, members]) => (everyone || members.every((m) => FREE.has(m.cls))) && members.some((m) => ageFrom(m.born_day, day) >= speciesOf(m.species).adultAge || everyone))
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([key, members]) => ({ key, members }));
}

/** The house in a place with the fewest people in it (ties: the lowest). */
function roomiestHome(occupancy: Map<number, number>): number {
  let best: number | null = null;
  for (const [home, n] of [...occupancy].sort((a, b) => a[0] - b[0])) if (best === null || n < occupancy.get(best)!) best = home;
  return best ?? 0;
}

/**
 * Households set out from one place for another until about `count` people have gone (N26 Part E). They are marked `away` and
 * walk the road for the days it takes, still their old place's people (and counted there); on the day they arrive
 * (`arriveHouseholds`) the move is applied to both places. If no road joins the places, or the roads are full, the
 * move is made at once, as it always was. Both places must be current (see `ensureCurrent`). Returns how many people set out.
 */
export function departHouseholds(ctx: LifeCtx, from: Settlement, to: Settlement, count: number, rng: Rng, day: number, opts: { everyone?: boolean } = {}): number {
  const { realm, store } = ctx;
  const people = store.people;
  const homes = householdsOf((people.loadSite(from.id, "full") as PersonRow[]).filter((r) => r.away === null), day, !!opts.everyone);
  if (homes.length === 0) return 0;
  // Who goes: households in an order of the day's dice, while the count isn't reached.
  // A household with someone who has come to want to leave (a review's outcome, N25b) goes before the others: the same one die each, the order shifts.
  const wantsOut = (h: Household) => h.members.some((m) => outlookOf(m).goal?.kind === "move");
  const ordered = homes.map((h) => ({ h, k: rng() - (wantsOut(h) ? 0.6 : 0) })).sort((a, b) => a.k - b.k || (a.h.key < b.h.key ? -1 : 1)).map((x) => x.h);
  const data = roadDataOf(realm);
  const way = shortest(data, from.id, to.id);
  const kind = opts.everyone || from.food < FAMINE ? "refugees" : "migrants";
  let moved = 0;
  for (const h of ordered) {
    if (!opts.everyone && moved >= count) break;
    if (!opts.everyone && moved + h.members.length > count + 2) continue;
    const members = h.members.sort((a, b) => (a.id < b.id ? -1 : 1));
    const head = members.find((m) => ageFrom(m.born_day, day) >= speciesOf(m.species).adultAge) ?? members[0]!;
    const party: Traveller[] = members.map((m) => ({ person: m.id, name: m.name, role: ageFrom(m.born_day, day) < speciesOf(m.species).adultAge ? "child" : m.job, gender: m.gender === "female" ? ("female" as const) : ("male" as const) }));
    const j = way ? launch(realm, data, { kind, party, path: way, depart: departureOn(day, rng()), pace: WALK_PACE * 0.8, move: { from: from.id, to: to.id, everyone: !!opts.everyone }, purpose: `leaving ${from.name} for ${to.name}` }, people) : null;
    if (!j) applyMove(ctx, members, from, to, day, !!opts.everyone);
    moved += members.length;
    recordLifeEvent(realm, store, {
      kind: "migration",
      actor: head.id,
      target: to.id,
      site: from.id,
      day,
      details: `${head.name}${members.length > 1 ? ` and ${members.length - 1} of their household` : ""} left ${from.name} for ${to.name}`,
      importance: Math.min(5, 1 + members.length),
    });
  }
  return moved;
}

/** The household's move, applied to the rows of both places: they live in `to` from today, in a free house, and take part in today's step there. */
function applyMove(ctx: LifeCtx, members: PersonRow[], from: Settlement, to: Settlement, day: number, everyone: boolean): void {
  const { realm, store } = ctx;
  const people = store.people;
  void from;
  void everyone;
  void realm;
  const occupancy = new Map<number, number>();
  for (const r of people.loadSite(to.id, "full") as PersonRow[]) if (r.home !== null) occupancy.set(r.home, (occupancy.get(r.home) ?? 0) + 1);
  const seq = people.seq(to.id);
  let nextN = seq.next_n;
  const home = roomiestHome(occupancy);
  for (const m0 of members) {
    const m = people.get(m0.id) ?? m0;
    if (m.death !== null) continue;
    const servant = m.cls === "commoner" && m.master_id !== null;
    people.update(m.id, {
      site: to.id,
      n: nextN++,
      home,
      away: null,
      // The doors of the old place's map mean nothing in the new one.
      work: m.work && m.work.startsWith("front:") ? "streets" : m.work,
      ...(servant ? { master: null, master_id: null, job: "labourer" } : {}),
      // They were stepped at home through yesterday: they take part in today's step where they are now.
      stepped_day: day - 1,
      // What they wanted was to go; they have gone.
      ...(outlookOf(m).goal?.kind === "move" ? { outlook: JSON.stringify({ ...outlookOf(m), goal: undefined }) } : {}),
    });
    occupancy.set(home, (occupancy.get(home) ?? 0) + 1);
  }
  people.setSeq(to.id, { next_n: nextN });
}

/**
 * Households (or workers who found a place) arrive: the move is applied to both places' rows, which are brought up to date first.
 * Called on the day after their journey ended (road/day.ts). Returns how many people arrived.
 */
export function arriveHouseholds(ctx: LifeCtx, j: Journey, day: number, ensureCurrent: Catcher): number {
  const { realm, store } = ctx;
  const mv = j.move;
  const from = mv && realm.settlements[mv.from];
  const to = mv && realm.settlements[mv.to];
  if (!mv || !from || !to) return 0;
  const rows = j.party.map((t) => store.people.get(t.person)).filter((r): r is PersonRow => !!r && r.death === null);
  if (rows.length === 0) return 0;
  ensureCurrent(from.id, day - 1);
  ensureCurrent(to.id, day - 1);
  applyMove(ctx, rows, from, to, day, mv.everyone);
  from.population = store.people.livingCount(from.id);
  to.population = store.people.livingCount(to.id);
  tally(realm, "migrants", rows.length);
  tally(realm, to.prosperity + to.food >= from.prosperity + from.food ? "migrants_up" : "migrants_down", rows.length);
  if (rows.length >= 3) sendArrival(realm, to.id, { day, kind: "refugees", count: Math.min(4, Math.ceil(rows.length / 3)), by: from.name });
  return rows.length;
}

/** Bring a place's people up to `day` (a lazy place, before it gives or takes anyone). */
export type Catcher = (site: string, toDay: number) => void;

/**
 * The day's moves, in code (the old `migrate` in realm/economy.ts, for people): a place short of food or
 * lately raided sends people to its best neighbour; so does a crowded one; a poor place loses a few to a
 * much richer one; an abandoned one sends everyone. `live`: only these places have people to move.
 */
export function migrationDay(ctx: LifeCtx, day: number, live: ReadonlySet<string>, ensureCurrent: Catcher): number {
  const { realm, store } = ctx;
  const people = store.people;
  let total = 0;
  const sites = Object.values(realm.settlements).filter((s) => live.has(s.id)).sort((a, b) => a.id.localeCompare(b.id));
  for (const s of sites) {
    const rng = streamFor(realm.seed, "migrate", s.id, day);
    const near = neighbours(realm, s.id).filter((n) => live.has(n.id)).sort((a, b) => b.prosperity - a.prosperity || a.id.localeCompare(b.id));
    if (s.abandoned) {
      if (people.livingCount(s.id) === 0 || near.length === 0) continue;
      const to = near[0]!;
      ensureCurrent(s.id, day - 1);
      ensureCurrent(to.id, day - 1);
      const moved = departHouseholds(ctx, s, to, Infinity, rng, day, { everyone: true });
      total += moved;
      s.population = people.livingCount(s.id);
      to.population = people.livingCount(to.id);
      continue;
    }
    if (people.livingCount(s.id) < 10) continue;
    const fleeing = s.food < FAMINE || (s.lastRaided !== undefined && day - s.lastRaided <= 2);
    const packed = crowding(s) > LIVES.crowded;
    // A small place only empties out when it has to.
    if (!fleeing && !packed && s.population < 30) continue;
    const better = near.filter((n) => n.prosperity - s.prosperity > 15 && n.food > 30)[0];
    const roomy = packed ? near.filter((n) => crowding(n) < crowding(s) * 0.8 && n.food > FAMINE)[0] : undefined;
    const to = better ?? roomy ?? (fleeing ? near[0] : undefined);
    if (!to) continue;
    let share = fleeing ? FLEEING_SHARE : better ? 0.003 * ((to.prosperity - s.prosperity) / 15) : 0;
    if (packed) share = Math.max(share, 0.008);
    const moving = Math.min(people.livingCount(s.id) - 5, roundBy(rng, people.livingCount(s.id) * share));
    if (moving <= 0) continue;
    ensureCurrent(s.id, day - 1);
    ensureCurrent(to.id, day - 1);
    const moved = departHouseholds(ctx, s, to, moving, rng, day);
    if (moved <= 0) continue;
    total += moved;
    s.population = people.livingCount(s.id);
    to.population = people.livingCount(to.id);
    if (fleeing && moved >= 5 && rng() < 0.3) realmNews(realm, day, s.id, "refugees", `Folk are leaving ${s.name} for ${to.name}: ${moved} gone this week.`, 3, [s.name, to.name]);
  }
  total += homestead(ctx, day, live, ensureCurrent, sites);
  return total;
}

/** A place this empty has room: homes standing empty draw households from a more crowded neighbour. */
export const ROOMY = 0.85;
/** The neighbour must be at least this crowded to send anyone. */
export const SENDS_AT = 1.05;
/** Daily share of its empty homes' worth of people that a roomy place draws. */
export const HOMESTEAD = 0.012;

/**
 * Settling the empty (N25): a village that has lost people still has its houses, and the next place along
 * the road, bursting at the seams, sends a household or two. Without it every small place would drain into the
 * towns for good, because births alone cannot keep a hamlet's few families going.
 */
function homestead(ctx: LifeCtx, day: number, live: ReadonlySet<string>, ensureCurrent: Catcher, sites: Settlement[]): number {
  const { realm, store } = ctx;
  const people = store.people;
  let total = 0;
  for (const to of sites) {
    if (to.abandoned || to.food < 35 || to.prosperity < 35) continue;
    const gap = ROOMY - crowding(to);
    if (gap <= 0) continue;
    const from = neighbours(realm, to.id)
      .filter((n) => live.has(n.id) && crowding(n) >= SENDS_AT && n.food > FAMINE && people.livingCount(n.id) > 40)
      .sort((a, b) => crowding(b) - crowding(a) || a.id.localeCompare(b.id))[0];
    if (!from) continue;
    const rng = streamFor(realm.seed, "settle", to.id, day);
    const capacity = (to.houses ?? 1) * PER_HOUSE[to.kind];
    const want = roundBy(rng, HOMESTEAD * capacity * (gap / ROOMY));
    if (want <= 0) continue;
    ensureCurrent(from.id, day - 1);
    ensureCurrent(to.id, day - 1);
    const moved = departHouseholds(ctx, from, to, want, rng, day);
    if (moved <= 0) continue;
    total += moved;
    from.population = people.livingCount(from.id);
    to.population = people.livingCount(to.id);
    tally(realm, "settlers", moved);
  }
  return total;
}
