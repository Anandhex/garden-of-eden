import { CLASS_RANK, type SocialClass } from "@millbrook/shared";
import type { PersonRow } from "../../store/peopleStore.js";
import { MARKET_EVERY, marketOffsetOf } from "../events-calendar.js";
import { seedFrom, seededRng } from "../dice.js";
import type { LifeCtx } from "../people/step.js";
import { ageFrom } from "../people/rules.js";

/**
 * Who meets whom (N33): not a loop over pairs but a few venues a place's people gather in, each with its members and its hours.
 * Everyone is in their household (the same home) and, if they work, their workplace; in the evening some go to the inn (more of
 * those with coin to spend), on market days many go to the market, on rest days to the temple. Cost is O(people), once a day.
 */
export type VenueKind = "household" | "work" | "inn" | "market" | "temple";

export interface Venue {
  key: string;
  kind: VenueKind;
  /** Person ids, in order. */
  members: string[];
}

/** Hours a venue is busy (`[from, to)`, wrapping past midnight when from > to): a day's gossip there is spread over them when run by the hour. */
export const HOURS: Record<VenueKind, [number, number]> = {
  household: [18, 8],
  work: [8, 17],
  inn: [18, 22],
  market: [9, 14],
  temple: [8, 12],
};

export const hoursOf = (kind: VenueKind): number => {
  const [from, to] = HOURS[kind];
  return to > from ? to - from : 24 - from + to;
};

export const openAt = (kind: VenueKind, hour: number): boolean => {
  const [from, to] = HOURS[kind];
  return from < to ? hour >= from && hour < to : hour >= from || hour < to;
};

/** How many others each person who knows something tells, in a day at a venue. */
export const LISTENERS: Record<VenueKind, number> = { household: 3, work: 2, inn: 3, market: 3, temple: 3 };
/** How far the telling is believed there, before what the listener thinks of the teller (a relationship row, if they have one: chatter/rel.ts `credenceOf`, N37). */
export const CREDENCE: Record<VenueKind, number> = { household: 0.95, work: 0.9, inn: 0.85, market: 0.85, temple: 0.9 };

/** A fixed 0..1 for a person and a purpose (and day): their own, from nothing but who they are. */
export const unit = (key: string): number => seededRng(seedFrom(key))();

/** How talkative a person is, 0.4..1. */
export const sociability = (id: string): number => 0.4 + 0.6 * unit(`${id}:sociable`);

const rankOf = (r: Pick<PersonRow, "cls">) => CLASS_RANK[r.cls as SocialClass] ?? 2;

const memo = new WeakMap<object, Map<string, Venue[]>>();

/** The venues of a place on a day, sorted by key, each with its members sorted by id. */
export function venuesOf(ctx: LifeCtx, site: string, rows: PersonRow[], day: number): Venue[] {
  let held = memo.get(ctx.store);
  if (!held || held.size > 64) memo.set(ctx.store, (held = new Map()));
  let away = 0;
  for (const r of rows) if (r.away) away++;
  const key = `${site}|${day}|${ctx.store.people.revOf(site)}|${rows.length}|${away}`;
  const got = held.get(key);
  if (got) return got;
  const by = new Map<string, Venue>();
  const add = (k: string, kind: VenueKind, id: string) => {
    let v = by.get(k);
    if (!v) by.set(k, (v = { key: k, kind, members: [] }));
    v.members.push(id);
  };
  const marketToday = (day + marketOffsetOf(site)) % MARKET_EVERY === 0;
  const restToday = day % MARKET_EVERY === 0;
  for (const r of rows) {
    if (r.away) continue;
    if (r.home !== null) add(`h:${r.home}`, "household", r.id);
    const adult = ageFrom(r.born_day, day) >= 16;
    if (!adult) continue;
    if (r.work) add(`w:${r.work}`, "work", r.id);
    const rank = rankOf(r);
    // Those with coin spend an evening at the inn; the bound seldom go.
    if (unit(`${r.id}:inn:${day}`) < 0.06 + 0.05 * Math.min(rank, 5)) add("inn", "inn", r.id);
    if (marketToday && rank >= 1 && unit(`${r.id}:market:${day}`) < 0.5) add("market", "market", r.id);
    if (restToday && unit(`${r.id}:temple:${day}`) < (r.cls === "clergy" ? 1 : 0.4)) add("temple", "temple", r.id);
  }
  const out = [...by.values()].filter((v) => v.members.length > 1).sort((a, b) => (a.key < b.key ? -1 : 1));
  for (const v of out) v.members.sort();
  held.set(key, out);
  return out;
}
