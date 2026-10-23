import { CLASS_RANK, hashStr, type SocialClass } from "@millbrook/shared";
import { config } from "../../config.js";
import type { AmbitionRow, CareerStore, JobRow } from "../../store/careerStore.js";
import type { PersonRow } from "../../store/peopleStore.js";
import { speciesOf } from "../../world/species.js";
import type { Realm, Settlement } from "../realm/types.js";
import { ageFrom } from "../people/rules.js";
import { isTrade, TRADES, type AmbitionKind } from "./kinds.js";

/**
 * Careers (N40): how good someone is at their work (`people.skill`, 0..5), their rank in a trade (apprentice, journeyman, master, kept as
 * open `jobs_held` rows so a career reads as a history), shops, and what a place has room for. Everything here is a function of the
 * person's row, their open jobs, the place's people and the day, so a place worked out late gives the same careers (N25's rule).
 */

/** Years, from days. */
export const yearsOf = (days: number): number => days / config.daysPerYear;

/** The `jobs_held` names: a trade's ranks, a shop, land, a seat, and any other job by its own name. */
export const JOBS = {
  apprentice: (trade: string) => `apprentice:${trade}`,
  journeyman: (trade: string) => `${trade}:journeyman`,
  master: (trade: string) => `${trade}:master`,
  shop: (site: string, trade: string) => `shop:${site}:${trade}`,
  land: (site: string) => `land:${site}`,
  seat: (seat: string) => `seat:${seat}`,
} as const;

/** Is this job row a rank in a trade (the history's apprentice/journeyman/master rows)? */
export const isRankJob = (job: string): boolean => job.startsWith("apprentice:") || /:(journeyman|master)$/.test(job);

export type Rank = "apprentice" | "journeyman" | "master";

/** Their rank in their trade, from their job and what they hold (null for someone not in a trade). */
export function rankOf(row: Pick<PersonRow, "job">, open: readonly JobRow[]): Rank | null {
  if (row.job === "apprentice") return "apprentice";
  if (!isTrade(row.job)) return null;
  return open.some((j) => j.job === JOBS.master(row.job)) ? "master" : "journeyman";
}

/** The trade an apprentice is learning: their master's, or the open row's, or the forge where they work, or what the stream says. */
export function apprenticeTrade(row: Pick<PersonRow, "id" | "job" | "master_id">, open: readonly JobRow[], masterJob: string | null): string {
  const held = open.find((j) => j.job.startsWith("apprentice:"));
  if (held) return held.job.slice("apprentice:".length);
  if (masterJob && isTrade(masterJob)) return masterJob;
  const trades = Object.keys(TRADES);
  return trades[hashStr(`${row.id}:trade`) % trades.length]!;
}

/** The trade someone is in, or null. */
export function tradeOf(row: Pick<PersonRow, "id" | "job" | "master_id">, open: readonly JobRow[], masterJob: string | null = null): string | null {
  if (row.job === "apprentice") return apprenticeTrade(row, open, masterJob);
  return isTrade(row.job) ? row.job : null;
}

/** How long they have held a job (in years), or 0 if they don't. */
export function yearsIn(open: readonly JobRow[], job: string, day: number): number {
  const r = open.find((j) => j.job === job);
  return r ? yearsOf(day - r.from_day) : 0;
}

/**
 * Skill a person has when their career is first worked out (a place's first career day, or coming of age): a trade's people learn it
 * through their twenties and thirties, everyone else picks up their work and stops. From their id, job and age only.
 */
export function initialSkill(row: Pick<PersonRow, "id" | "job" | "born_day" | "species">, day: number): number {
  const age = ageFrom(row.born_day, day);
  const grown = speciesOf(row.species).adultAge;
  if (row.job === "child") return 0;
  const jitter = hashStr(`${row.id}:skill`) % 10 < 3 ? 1 : 0;
  if (row.job === "apprentice") return age - grown >= 4 ? 2 : 1;
  if (isTrade(row.job) || row.job === "merchant" || row.job === "innkeeper" || row.job === "priest" || row.job === "knight") return Math.min(5, 2 + Math.floor(Math.max(0, age - grown - 2) / 8) + jitter);
  return Math.min(3, 1 + Math.floor(Math.max(0, age - grown) / 15) + jitter);
}

/** The chance a year that skill grows by one: the young learn, the old keep what they have; a trade's people learn by doing. */
export function growthChance(row: Pick<PersonRow, "job" | "master_id" | "species" | "born_day">, day: number, skill: number): number {
  if (skill >= 5 || row.job === "child" || row.job === "elder") return 0;
  const age = ageFrom(row.born_day, day) - speciesOf(row.species).adultAge;
  const byAge = age < 9 ? 0.6 : age < 24 ? 0.38 : age < 39 ? 0.15 : 0.03;
  const learning = row.job === "apprentice" ? (row.master_id ? 1.25 : 0.8) : isTrade(row.job) ? 1 : 0.5;
  // The last rung is the hardest.
  return Math.min(0.95, byAge * learning * (skill >= 4 ? 0.6 : 1));
}

/** What a place has room for, and who it has: read once a day per place by the career day. */
export interface PlaceCareers {
  site: string;
  s: Settlement;
  laws: { slavery: boolean; serfdom: boolean };
  /** Living people (grown or not). */
  population: number;
  /** Shops open now, by trade. */
  shops: Map<string, number>;
  /** Freeholds held now (land bought by townsfolk). */
  plots: number;
  /** Guilds with a seat or a branch here (faction ids). */
  guilds: Set<string>;
  /** Knights living here. */
  knights: number;
}

/** Shops a place's custom can keep for a trade: one per `demand` people, at least one. */
export function shopRoom(p: Pick<PlaceCareers, "population" | "shops">, trade: string): number {
  const t = TRADES[trade as keyof typeof TRADES];
  if (!t) return 0;
  return Math.max(1, Math.round(p.population / t.demand)) - (p.shops.get(trade) ?? 0);
}

/** Freeholds a place has fields for: a village's land is most of it, a city's a little round its walls. */
export function plotRoom(p: Pick<PlaceCareers, "population" | "plots" | "s">): number {
  const per = p.s.kind === "hamlet" || p.s.kind === "village" ? 30 : p.s.kind === "town" ? 70 : 140;
  return Math.max(1, Math.ceil(p.population / per)) - p.plots;
}

/** Knights a place keeps: its barracks and its hall. */
export const knightRoom = (p: Pick<PlaceCareers, "s" | "knights">): number => (p.s.buildings.barracks ?? 0) * 2 + (p.s.kind === "city" || p.s.kind === "capital" ? 2 : 0) - p.knights;

export function placeCareers(realm: Realm, site: string, rows: readonly PersonRow[], careers: CareerStore, laws: PlaceCareers["laws"]): PlaceCareers {
  const s = realm.settlements[site]!;
  const shops = new Map<string, number>();
  let plots = 0;
  for (const { row } of careers.holdersOf(`shop:${site}:`)) shops.set(row.job.split(":")[2]!, (shops.get(row.job.split(":")[2]!) ?? 0) + 1);
  plots = careers.holdersOf(JOBS.land(site)).filter((h) => h.row.job === JOBS.land(site)).length;
  const guilds = new Set(
    Object.values(realm.factions)
      .filter((f) => (f.kind === "guild" || f.kind === "association") && !f.dissolved && (f.seat === site || f.branches.includes(site)))
      .map((f) => f.id)
      .sort(),
  );
  return { site, s, laws, population: rows.length, shops, plots, guilds, knights: rows.filter((r) => r.job === "knight").length };
}

/** What a person's ambition is measured against: their row, rank, what they hold and how long. */
export interface Standing {
  row: PersonRow;
  amb: AmbitionRow;
  open: readonly JobRow[];
  rank: Rank | null;
  trade: string | null;
  skill: number;
  age: number;
}

/**
 * How far toward the next rung someone is, 0..1, measured from who they are now (never rolled): years at the bench and skill for a trade,
 * coin put by for land (years of work at what their work pays), years in a seat, a child's age for a match. `ready` is when the next rung
 * can be taken (the event that takes it is the career day's).
 */
export function progressOf(st: Standing, day: number, extra: { hate?: number; childAge?: number; courtAge?: number } = {}): number {
  const { amb, open, skill, row } = st;
  const kind = amb.kind as AmbitionKind;
  const since = yearsOf(day - amb.since);
  const grown = ageFrom(row.born_day, day) - speciesOf(row.species).adultAge;
  const clamp = (n: number) => Math.max(0, Math.min(1, n));
  switch (kind) {
    case "master_trade": {
      const trade = st.trade ?? "";
      if (amb.step === 0) return clamp(Math.min(yearsIn(open, JOBS.apprentice(trade), day) / CAREER.apprenticeYears, skill / 2));
      if (amb.step === 1) return clamp(Math.min(yearsIn(open, JOBS.journeyman(trade), day) / CAREER.journeymanYears, skill / 4));
      if (amb.step === 2) return clamp(yearsIn(open, JOBS.master(trade), day) / CAREER.masterYearsToShop);
      return 1;
    }
    case "guild_seat":
      if (amb.step === 0) return clamp(0.5 * (skill / 3) + 0.5 * (grown / 6));
      return clamp(yearsIn(open, open.find((j) => j.job.startsWith("seat:g:") && j.job.endsWith(":officer"))?.job ?? "", day) / 3);
    case "office":
      if (amb.step === 0) return clamp(Math.min(1, (grown - 4) / 12) * (0.6 + 0.1 * skill));
      return clamp(yearsIn(open, open.find((j) => j.job.startsWith("seat:council:"))?.job ?? "", day) / 6);
    case "land":
      if (amb.step === 0) return clamp((since * earnings(row.job)) / CAREER.plotYears);
      return clamp(yearsIn(open, open.find((j) => j.job.startsWith("land:"))?.job ?? "", day) / 3);
    case "wealth":
      return clamp((since * earnings(row.job) * (0.6 + 0.2 * skill)) / (amb.step === 0 ? 16 : 30));
    case "freedom":
      return clamp(since / (row.cls === "slave" ? 15 : 10));
    case "knighthood":
      return clamp(Math.min(skill / 4, grown / 6));
    case "good_match":
      return clamp((extra.childAge ?? 0) / Math.max(1, extra.courtAge ?? 18));
    case "revenge":
      return clamp(1 - Math.min(1, extra.hate ?? 0));
    default:
      return 0;
  }
}

/** What a year of their work puts by, against a labourer's 1. */
export function earnings(job: string): number {
  if (job === "merchant" || job === "innkeeper") return 2;
  if (job === "stallholder") return 1.6;
  if (isTrade(job)) return 1.5;
  if (job === "guard" || job === "clerk" || job === "miner" || job === "hunter") return 1.2;
  if (job === "beggar" || job === "slave" || job === "child" || job === "elder") return 0.2;
  return 1;
}

/** The career rules' numbers, in years (one 48-day year each: README §5), in one place for a balance pass. */
export const CAREER = {
  /** Years an apprentice serves before they can be a journeyman (with skill 2). */
  apprenticeYears: 3,
  /** Years as a journeyman before the master's exam (with skill 4). */
  journeymanYears: 2,
  /** Years as a master before they can open a shop of their own. */
  masterYearsToShop: 1,
  /** Years of a labourer's work that buy a plot. */
  plotYears: 6,
  /** A master who has waited this long for room for a shop gives it up (or moves to find it). */
  shopWaitYears: 4,
  /** Days a seat stands vacant before it is filled (candidates come forward). */
  vacancyDays: 3,
  /** Checks of a person's ambition a year (spread over the year by their id): their next rung, if it is due. */
  checksPerYear: 4,
} as const;

/** Is today one of their check days (CAREER.checksPerYear a year, spread over the year by their id)? */
export function checkDay(id: string, day: number): boolean {
  const every = Math.max(1, Math.floor(config.daysPerYear / CAREER.checksPerYear));
  return (day + (hashStr(`${id}:check`) % every)) % every === 0;
}

/** Class standing (CLASS_RANK). */
export const standingOf = (row: Pick<PersonRow, "cls">): number => CLASS_RANK[row.cls as SocialClass] ?? 2;
