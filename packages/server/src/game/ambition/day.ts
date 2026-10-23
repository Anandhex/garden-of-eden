import { config } from "../../config.js";
import { timed } from "../../metrics/timing.js";
import { AMBITION_DEFAULTS, type AmbitionRow } from "../../store/careerStore.js";
import type { PersonRow } from "../../store/peopleStore.js";
import { speciesOf } from "../../world/species.js";
import { addGrievance, hateOn, strongestOf } from "../chatter/grievance.js";
import { seedFrom, streamFor } from "../dice.js";
import type { GameEvent } from "../events.js";
import { learn } from "../gossip/knowledge.js";
import { eventRef } from "../gossip/refs.js";
import { recordLifeEvent, type LifeEventInput } from "../people/events.js";
import { outlookOf } from "../people/outlook.js";
import { NEUTRAL_DAY, type SiteDay } from "../people/conditions.js";
import { adjustRel } from "../chatter/rel.js";
import { temperOf } from "../chatter/person.js";
import { baseStrength, chooseRoute, hardTimes, LIVING, urgentOf, ventOf, type Route, type RouteEnv, type Urgent } from "./situations.js";
import { decidersOf } from "./seats.js";
import { rivalsOf } from "./words.js";
import { ageFrom } from "../people/rules.js";
import type { LifeCtx, SiteStep } from "../people/step.js";
import { traitsOfRow } from "../people/traits.js";
import { kingdomLaws } from "../realm/townsfolk.js";
import { dailyChance } from "../weather.js";
import {
  CAREER,
  checkDay,
  growthChance,
  initialSkill,
  isRankJob,
  JOBS,
  knightRoom,
  placeCareers,
  plotRoom,
  progressOf,
  rankOf,
  shopRoom,
  standingOf,
  tradeOf,
  yearsIn,
  yearsOf,
  type PlaceCareers,
  type Standing,
} from "./careers.js";
import { isTrade, topStep, TRADES, type AmbitionKind } from "./kinds.js";
import { wantsOf } from "./words.js";
import { pickAmbition, type PickEnv } from "./pick.js";
import { decideSeat, lossWeight, mayStand, seatIdOf, seatsOf, type Contest, type Seat } from "./seats.js";

/**
 * A place's careers for a day (N40), after its people's day, reviews, chatter, gossip and choices. In this order:
 *
 * 1. Seats, shops and land whose holders died or left are given up.
 * 2. Anyone grown whose career was never worked out (a place's first career day, a new adult) gets their skill and their rank.
 * 3. On a place's first career day its masters take their shops and its seats are filled, as they were before the story began (no contest).
 * 4. Each grown person in id order: their skill grows on their birthday; an apprentice finds a master; they get an ambition if they have
 *    none; on their check days (CAREER.checksPerYear a year) it is measured and, when the next rung is due, the event that takes it is tried.
 * 5. Seats that have stood vacant `CAREER.vacancyDays` are filled from the candidates, by the seat's rule; the losers bear a grievance.
 * 6. Masters with shops and no apprentice may take one.
 *
 * Pure in `(seed, the place's rows, its tables, the day)`: every roll is from a stream named by who and when, so a place worked out years
 * later in a catch-up has the same careers.
 */
export interface CareerDay {
  site: string;
  day: number;
  /** Ambitions picked (first ones and re-picks). */
  picked: number;
  /** Rises in rank: "<id>:<rank>". */
  promoted: string[];
  /** Shops opened today (ids of their keepers). */
  shops: string[];
  /** Seats filled by a contest today. */
  contests: Contest[];
  /** Ambitions had (kind by who) and given up. */
  achieved: Array<{ who: string; kind: string }>;
  changed: Array<{ who: string; kind: string; why: string }>;
  /** Shops and land passed on (from the dead or the old to an heir or a hand). */
  passed: Array<{ from: string; to: string; what: string }>;
  /** Frustration let out, and how. */
  vented: Array<{ who: string; how: string; at?: string }>;
  /** Urgent wants that began today. */
  urgent: Array<{ who: string; kind: string }>;
  events: GameEvent[];
}

const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : 1);

/** Is today the day of someone's career year (once a year, spread over the year by their id: a place's first people share a birthday)? */
export function careerYearDay(id: string, day: number): boolean {
  const Y = config.daysPerYear;
  return (day + (seedFrom(`${id}:year`) % Y)) % Y === 0;
}

const names = (xs: string[]): string => (xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);

export function ambitionDay(ctx: LifeCtx, step: Pick<SiteStep, "site"> & Partial<Pick<SiteStep, "events" | "deaths" | "marriages">>, day: number): CareerDay {
  const site = step.site;
  const out: CareerDay = { site, day, picked: 0, promoted: [], shops: [], contests: [], achieved: [], changed: [], passed: [], vented: [], urgent: [], events: [] };
  if (!config.ambitions) return out;
  const { realm, store } = ctx;
  const s = realm.settlements[site];
  if (!s) return out;
  return timed("ambition.day", () => {
    const careers = store.careers;
    const people = store.people;
    const laws = kingdomLaws(realm, s.kingdom);
    const Y = config.daysPerYear;
    const rows = new Map((people.loadSite(site, "full") as PersonRow[]).map((r) => [r.id, r]));
    const ids = [...rows.keys()].sort();
    const cur = (id: string): PersonRow | null => rows.get(id) ?? null;
    const patch = (id: string, p: Partial<PersonRow>): PersonRow | null => {
      const next = people.update(id, p);
      if (next && rows.has(id)) rows.set(id, next);
      return next;
    };
    const grown = (r: PersonRow) => r.job !== "child" && r.death === null;
    const emit = (e: LifeEventInput) => {
      const ev = recordLifeEvent(realm, store, e);
      out.events.push(ev);
      step.events?.push(ev);
      return ev;
    };
    // What is news (a shop opened, a seat won, freedom given) is known at once to those it touches; gossip carries it on.
    const tell = (ref: string, who: readonly string[]) => {
      if (config.gossip) for (const w of who) learn(ctx, w, ref, { day, source: "saw", accuracy: 1 });
    };
    const first = !ids.some((id) => grown(rows.get(id)!) && careers.ambitionOf(id));
    const place: PlaceCareers = placeCareers(realm, site, [...rows.values()], careers, laws);
    const cameOfAge = (r: PersonRow) => Math.min(day, r.born_day + speciesOf(r.species).adultAge * Y);
    const seatsHeld = (who: string) => careers.openJobs(who).filter((j) => j.job.startsWith("seat:")).map((j) => seatIdOf(j.job));
    const sd = people.siteDay<SiteDay>(site, day) ?? NEUTRAL_DAY;
    // Today's deaths and weddings, by the people of this place they touch: grief, a killer to answer, a shop or land to pass on, a match.
    const grieving = new Map<string, { dead: string; name: string; killer?: string; spouse: boolean }>();
    for (const d of step.deaths ?? []) {
      const dead = people.get(d.id);
      if (!dead) continue;
      const kin = [dead.spouse, dead.mother, dead.father, ...people.childrenOf(dead.id).map((c) => c.id)].filter((x): x is string => !!x);
      for (const k of kin) if (rows.has(k) && !grieving.has(k)) grieving.set(k, { dead: d.id, name: d.name, ...(d.record.killer ? { killer: d.record.killer } : {}), spouse: dead.spouse === k });
    }
    const wed = new Set((step.marriages ?? []).flat());

    store.careers.transaction(() => {
      // ---- 1. What the dead and the gone held here (a shop or land the dead held passes on, once careers are worked out) ----
      const bequests: Array<{ from: PersonRow; job: string }> = [];
      for (const prefix of ["seat:", `shop:${site}:`, JOBS.land(site)]) {
        for (const { who, row } of careers.holdersOf(prefix)) {
          if (row.site !== site) continue;
          const r = people.get(who);
          if (r && r.death === null && r.site === site) continue;
          careers.endJob(who, row.job, day);
          if (r && r.death !== null && (row.job.startsWith("shop:") || row.job.startsWith("land:"))) bequests.push({ from: r, job: row.job });
          if (row.job.startsWith("shop:")) {
            place.shops.set(row.job.split(":")[2]!, Math.max(0, (place.shops.get(row.job.split(":")[2]!) ?? 1) - 1));
            if (r && r.death === null) patch(who, { shop: null });
          }
          if (row.job.startsWith("land:")) place.plots = Math.max(0, place.plots - 1);
        }
      }

      // ---- 2. Careers never worked out ----
      for (const id of ids) {
        const r = rows.get(id)!;
        if (!grown(r) || r.skill !== null) continue;
        const skill = initialSkill(r, day);
        patch(id, { skill });
        startWork(rows.get(id)!, cameOfAge(r), skill);
      }
      for (const b of bequests) passOn(b.from, b.job);

      // ---- 3. A place's first career day: shops and seats as they were ----
      if (first) {
        const masters = ids.map((id) => rows.get(id)!).filter((r) => grown(r) && isTrade(r.job) && rankOf(r, careers.openJobs(r.id)) === "master").sort((a, b) => a.born_day - b.born_day || byId(a, b));
        for (const m of masters) if (shopRoom(place, m.job) > 0) openShop(m, false);
        const members = memberCounts();
        for (const seat of seatsOf(realm, site, place.guilds, members)) {
          if (careers.seatHolders(site).has(JOBS.seat(seat.id))) continue;
          const cands = ids.map((id) => rows.get(id)!).filter((r) => grown(r) && mayStand(seat, r, null, seatsHeld(r.id), day, s.kind, false));
          if (cands.length === 0) continue;
          const c = decideSeat(store, realm, seat, cands, voters(seat), day);
          careers.startJob(c.winner, JOBS.seat(seat.id), site, day);
        }
      }

      // ---- 4. Each person ----
      for (const id of ids) {
        const r0 = rows.get(id)!;
        if (!grown(r0)) continue;
        syncJob(r0);
        let r = rows.get(id)!;
        const birthday = careerYearDay(id, day);
        if (birthday) {
          const skill = r.skill ?? 0;
          if (streamFor(realm.seed, "career", id, day, "skill")() < growthChance(r, day, skill)) r = patch(id, { skill: skill + 1 })!;
        }
        if (r.job === "apprentice") r = findMaster(r);
        let amb = careers.ambitionOf(id);
        if (!amb) {
          amb = repick(r, null, null);
          continue;
        }
        const check = birthday || checkDay(id, day);
        amb = situate(r, amb, check);
        if (!amb) continue;
        if (check) advance(r, amb, birthday);
      }

      // ---- 5. Seats falling free ----
      const members = memberCounts();
      for (const seat of seatsOf(realm, site, place.guilds, members)) {
        const job = JOBS.seat(seat.id);
        if (careers.seatHolders(site).has(job)) continue;
        const hist = careers.lastHeld(job);
        // A seat falling vacant today is an opening: those who want it want it more.
        if (hist.left === day) for (const id of ids) {
          const a = careers.ambitionOf(id);
          if (a && seatWanted(seat, a)) careers.setAmbition({ ...a, strength: a.strength + LIVING.opening });
        }
        if (hist.left !== null && day - hist.left < CAREER.vacancyDays) continue;
        const cands = ids.map((id) => rows.get(id)!).filter((r) => grown(r) && mayStand(seat, r, careers.ambitionOf(r.id), seatsHeld(r.id), day, s.kind, true));
        if (cands.length === 0) continue;
        contest(seat, cands);
      }

      // ---- 6. Masters take apprentices ----
      for (const id of ids) {
        const m = rows.get(id)!;
        if (!grown(m) || m.shop === null || !isTrade(m.job) || m.away) continue;
        if (ids.some((x) => rows.get(x)!.master_id === id && rows.get(x)!.job === "apprentice")) continue;
        if (streamFor(realm.seed, "career", id, day, "apprentice")() >= dailyChance(0.6)) continue;
        takeApprentice(m);
      }
    });
    return out;

    // ---- the rules, sharing the day's working state ----

    function memberCounts(): Map<string, number> {
      const m = new Map<string, number>();
      for (const id of ids) {
        const r = rows.get(id)!;
        if (grown(r) && r.faction && place.guilds.has(r.faction)) m.set(r.faction, (m.get(r.faction) ?? 0) + 1);
      }
      return m;
    }

    function voters(seat: Seat): PersonRow[] {
      return seat.faction ? ids.map((id) => rows.get(id)!).filter((r) => grown(r) && r.faction === seat.faction) : [];
    }

    /** The open row of what someone does, from their job: a trade's rank, or the job itself. */
    function startWork(r: PersonRow, from: number, skill: number): void {
      const open = careers.openJobs(r.id);
      if (r.job === "apprentice") {
        const master = r.master_id ? people.get(r.master_id) : null;
        const trade = tradeOf(r, open, master?.job ?? null)!;
        // However old they are, an apprenticeship found on a place's first day is a couple of years old at most.
        careers.startJob(r.id, JOBS.apprentice(trade), site, Math.max(from, day - 2 * Y));
      } else if (isTrade(r.job)) {
        // Years in the trade: an apprentice's, then a journeyman's; a master has passed both.
        const asJourneyman = Math.min(day, from + CAREER.apprenticeYears * Y);
        if (skill >= 4) careers.startJob(r.id, JOBS.master(r.job), site, Math.min(day, asJourneyman + (CAREER.journeymanYears + 2 * (skill - 4)) * Y));
        else careers.startJob(r.id, JOBS.journeyman(r.job), site, asJourneyman);
      } else careers.startJob(r.id, r.job, site, from);
    }

    /** Their open job row follows their job: a new adult, someone retired, or someone whose work changed by another rule. */
    function syncJob(r: PersonRow): void {
      const open = careers.openJobs(r.id);
      const plain = open.filter((j) => !j.job.startsWith("seat:") && !j.job.startsWith("shop:") && !j.job.startsWith("land:"));
      const fits = (j: string) => j === r.job || (r.job === "apprentice" && j.startsWith("apprentice:")) || (isTrade(r.job) && (j === JOBS.journeyman(r.job) || j === JOBS.master(r.job)));
      if (plain.some((j) => fits(j.job))) return;
      for (const j of plain) careers.endJob(r.id, j.job, day);
      // Stepping back in old age: the shop shuts (who takes it on is N45's) and the seats are given up.
      if (r.job === "elder") {
        const shopJob = open.find((j) => j.job.startsWith("shop:"))?.job;
        for (const j of open) if (j.job.startsWith("seat:") || j.job.startsWith(`shop:`)) careers.endJob(r.id, j.job, day);
        if (r.shop !== null) {
          const trade = shopJob?.split(":")[2];
          if (trade) place.shops.set(trade, Math.max(0, (place.shops.get(trade) ?? 1) - 1));
          patch(r.id, { shop: null });
          // Stepping back, they hand the shop to a child or a hand of theirs who works it (the laws of inheritance are N45's).
          if (shopJob) passOn({ ...r, shop: r.shop }, shopJob);
        }
      }
      startWork(rows.get(r.id) ?? r, day, r.skill ?? 0);
    }

    function standing(r: PersonRow, amb: AmbitionRow): Standing {
      const open = careers.openJobs(r.id);
      const master = r.master_id ? people.get(r.master_id) : null;
      return { row: r, amb, open, rank: rankOf(r, open), trade: tradeOf(r, open, master?.job ?? null), skill: r.skill ?? 0, age: ageFrom(r.born_day, day) };
    }

    function pickEnv(r: PersonRow): PickEnv {
      const open = careers.openJobs(r.id);
      const master = r.master_id ? people.get(r.master_id) : null;
      const sp = speciesOf(r.species);
      const children = people
        .childrenOf(r.id)
        .filter((c) => c.death === null && !c.spouse)
        .map((c) => ({ id: c.id, age: ageFrom(c.born_day, day) }))
        .filter((c) => c.age >= sp.adultAge - 6 && c.age <= sp.adultAge + 10);
      const g = strongestOf(store, r.id, day);
      return {
        day,
        site,
        kind: s!.kind,
        laws,
        guilds: place.guilds,
        rank: rankOf(r, open),
        trade: tradeOf(r, open, master?.job ?? null),
        hasShop: r.shop !== null,
        hasLand: open.some((j) => j.job.startsWith("land:")),
        seats: open.filter((j) => j.job.startsWith("seat:")).map((j) => seatIdOf(j.job)),
        children,
        grudge: g ? { against: g.g.against, weight: g.weight } : null,
        knightly: (s!.buildings.barracks ?? 0) > 0 || s!.kind === "city" || s!.kind === "capital",
      };
    }

    /** A new ambition (their first, or after one was had or given up). */
    function repick(r: PersonRow, was: AmbitionRow | null, exclude: AmbitionKind | null): AmbitionRow {
      const p = pickAmbition(r, pickEnv(r), streamFor(realm.seed, "ambition", r.id, day), exclude ?? undefined);
      // A hard time does not end because what they want changed.
      const urgent = was?.urgent && urgentOf(was, day) ? was.urgent : null;
      const grudge = p.kind === "revenge" ? (strongestOf(store, r.id, day)?.weight ?? 0) : 0;
      let row: AmbitionRow = { who: r.id, kind: p.kind, target: p.target, progress: 0, since: day, step: p.step, ...AMBITION_DEFAULTS, strength: Math.min(1, baseStrength(r) + 0.3 * grudge), urgent };
      row = { ...row, route: chooseRoute(r, p.kind, p.step, p.target, routeEnv(r), roll(r, "route")) };
      // Measured at once, so a new ambition says how far along they already are.
      row = { ...row, progress: progressOf(standing(r, row), day) };
      careers.setAmbition(row);
      out.picked++;
      if (was && p.kind !== was.kind) {
        out.changed.push({ who: r.id, kind: p.kind, why: `was ${was.kind}` });
      }
      return row;
    }

    function achieve(r: PersonRow, amb: AmbitionRow, words: string): void {
      out.achieved.push({ who: r.id, kind: amb.kind });
      emit({ kind: "ambition-achieved", actor: r.id, site, day, key: `${r.id}:${amb.kind}`, details: `${r.name} has what they wanted: ${words}`, importance: 3 });
      repick(r, { ...amb, step: topStep(amb.kind as AmbitionKind) }, amb.kind as AmbitionKind);
    }

    function giveUp(r: PersonRow, amb: AmbitionRow, why: string): void {
      out.changed.push({ who: r.id, kind: amb.kind, why });
      emit({ kind: "ambition-changed", actor: r.id, site, day, key: `${r.id}:${amb.kind}`, details: `${r.name} no longer wants ${wantsOf(realm, store, amb)}: ${why}`, importance: 1 });
      repick(r, amb, amb.kind as AmbitionKind);
    }

    function moveOn(amb: AmbitionRow, step: number): AmbitionRow {
      // A rung taken: the frustration of waiting for it goes, and they want the next one a little more.
      const next = { ...amb, step, progress: 0, frustration: 0, strength: Math.min(1, amb.strength + 0.05) };
      careers.setAmbition(next);
      return next;
    }

    function roll(r: PersonRow, key: string): number {
      return streamFor(realm.seed, "career", r.id, day, key)();
    }

    /** Measure an ambition and, if its next rung is due, try the event that takes it. */
    function advance(r: PersonRow, amb0: AmbitionRow, birthday: boolean): void {
      let amb = amb0;
      const kind = amb.kind as AmbitionKind;
      const age = ageFrom(r.born_day, day);
      const sp = speciesOf(r.species);
      const st = standing(r, amb);
      const t = traitsOfRow(r);
      const extra: Parameters<typeof progressOf>[2] = {};
      if (kind === "revenge" && amb.target) extra.hate = hateOn(store, r.id, amb.target, day);
      let child: PersonRow | null = null;
      if (kind === "good_match" && amb.target) {
        child = people.get(amb.target);
        if (child) {
          extra.childAge = ageFrom(child.born_day, day);
          extra.courtAge = sp.adultAge + 2;
        }
      }
      const progress = progressOf(st, day, extra);
      careers.setAmbition((amb = { ...amb, progress }));
      // While a hard time lasts, what they want waits (what can no longer be had is still seen).
      const pressing = urgentOf(amb, day) !== null;
      if (pressing && kind !== "revenge" && kind !== "good_match" && kind !== "guild_seat") return;
      // Old age: most give up what they were reaching for.
      if (kind !== "quiet_life" && kind !== "revenge" && age >= sp.elderAge && birthday && roll(r, "settle") < 0.5) return giveUp(r, amb, "they are old now");
      switch (kind) {
        case "quiet_life":
          // A change of heart: the young find something to want.
          if (birthday && age < sp.elderAge - 10 && roll(r, "heart") < 0.15) {
            emit({ kind: "ambition-changed", actor: r.id, site, day, key: `${r.id}:quiet`, details: `${r.name} wants more of life than they have`, importance: 1 });
            repick(r, amb, "quiet_life");
          }
          return;
        case "master_trade":
          return trade(r, amb, st, t.ambition);
        case "guild_seat":
          if (!amb.target || r.faction !== amb.target || !place.guilds.has(amb.target)) return giveUp(r, amb, "they are no longer of the guild here");
          if (amb.step >= topStep(kind)) return achieve(r, amb, "they are master of their guild here");
          return;
        case "office":
          if (amb.step === 1 && r.figure && s!.leader === r.figure) {
            moveOn(amb, 2);
            return achieve(r, amb, `they are head of ${s!.name}`);
          }
          return;
        case "land":
          return land(r, amb, progress);
        case "wealth":
          if (progress < 1) return;
          if (amb.step === 0) {
            emit({ kind: "promoted", actor: r.id, site, day, key: `${r.id}:caravan`, details: `${r.name} has bought a caravan of their own`, importance: 3 });
            out.promoted.push(`${r.id}:caravan`);
            moveOn(amb, 1);
            return;
          }
          moveOn(amb, 2);
          return achieve(r, amb, "a trading house of their own");
        case "freedom":
          return freedom(r, amb, progress);
        case "knighthood":
          if (progress < 1) return;
          if (knightRoom(place) <= 0) return frustrate(r, amb, LIVING.blocked);
          if (roll(r, "knight") >= 0.5) return;
          patch(r.id, { job: "knight", cls: standingOf(r) < 5 ? "gentry" : r.cls, work: "zone:gate" });
          syncJob(rows.get(r.id)!);
          place.knights++;
          emit({ kind: "knighted", actor: r.id, site, day, details: `${r.name} was knighted in ${s!.name}`, importance: 5 });
          moveOn(amb, 1);
          return achieve(r, amb, "a knighthood");
        case "good_match": {
          if (!child || child.death !== null) return giveUp(r, amb, "the child they hoped to marry well is gone");
          if (!child.spouse) return;
          const spouse = people.get(child.spouse);
          if (spouse && standingOf(spouse) > standingOf(r)) {
            moveOn(amb, 1);
            return achieve(r, amb, `${child.name} married ${spouse.name}, above the family`);
          }
          return giveUp(r, amb, `${child.name} married no higher than the family`);
        }
        case "revenge": {
          const them = amb.target ? people.get(amb.target) : null;
          if (!them || them.death !== null) return giveUp(r, amb, "the one who wronged them is dead");
          if ((extra.hate ?? 0) < 0.05) {
            moveOn(amb, 1);
            return achieve(r, amb, `the wrong ${them.name} did them is answered`);
          }
          return;
        }
      }
    }

    /** How someone's situation stands for choosing a route: a spouse's or parent's shop, land in the family, free to go. */
    function routeEnv(r: PersonRow): RouteEnv {
      const here = (id: string | null) => {
        const x = id ? people.get(id) : null;
        return x && x.death === null && x.site === site ? x : null;
      };
      const spouse = here(r.spouse);
      const parents = [here(r.mother), here(r.father)].filter((x): x is PersonRow => !!x);
      const land = (x: PersonRow) => careers.openJobs(x.id).some((j) => j.job.startsWith("land:"));
      return {
        spouseShop: spouse && spouse.shop !== null ? spouse.job : null,
        parentShop: parents.find((p) => p.shop !== null)?.job ?? null,
        spouseLand: !!spouse && land(spouse),
        parentLand: parents.some(land),
        free: r.cls !== "slave" && r.cls !== "serf",
      };
    }

    /** Does this ambition want this seat? */
    function seatWanted(seat: Seat, a: AmbitionRow): boolean {
      if (seat.kind === "guild_officer" || seat.kind === "guild_master") return a.kind === "guild_seat" && a.target === seat.faction;
      if (seat.kind === "council") return a.kind === "office";
      return a.kind === "knighthood" || a.kind === "office";
    }

    /**
     * What today means for someone's wanting, before their ladder is looked at: grief for a death in the family (and a killer to answer), a
     * wedding that brings a shop or land, hunger or fighting that pushes it aside for a while, a new place to start again in, and on their
     * check days the slow drift back to their own level of wanting, the fading of age and of frustration, and letting go when it is gone.
     * Returns their ambition as it stands, or null if it was given up.
     */
    function situate(r: PersonRow, amb0: AmbitionRow, check: boolean): AmbitionRow | null {
      let amb = amb0;
      const kind = amb.kind as AmbitionKind;
      const poor = standingOf(r) <= 2 && r.shop === null;
      let urgent: Urgent | null = urgentOf(amb, day);
      // The hard time is over.
      if (urgent?.kind === "get_by" && sd.famine < LIVING.famine) urgent = null;
      if (!urgent && amb.urgent) amb = { ...amb, urgent: null };
      // A death in the family.
      const loss = grieving.get(r.id);
      if (loss) {
        urgent = { kind: "grieve", since: day, until: day + LIVING.griefDays, why: `the death of ${loss.name}` };
        amb = { ...amb, strength: amb.strength * (loss.spouse ? LIVING.grief : 0.85), urgent: JSON.stringify(urgent) };
        out.urgent.push({ who: r.id, kind: "grieve" });
        // Killed: the unforgiving want the killer to answer for it (a person of the realm or of a town).
        const killer = loss.killer && (people.get(loss.killer) ?? realm.figures[loss.killer]) ? loss.killer : null;
        if (killer && kind !== "revenge" && roll(r, "avenge") < 0.6 * (1 - temperOf(r).forgiveness)) {
          careers.setAmbition(amb);
          const row: AmbitionRow = { who: r.id, kind: "revenge", target: killer, progress: 0, since: day, step: 0, ...AMBITION_DEFAULTS, strength: 0.9, urgent: JSON.stringify(urgent) };
          careers.setAmbition(row);
          out.changed.push({ who: r.id, kind: "revenge", why: `the killing of ${loss.name}` });
          emit({ kind: "ambition-changed", actor: r.id, target: killer, site, day, key: `${r.id}:avenge`, details: `${r.name} swore that whoever killed ${loss.name} will answer for it`, importance: 3 });
          return row;
        }
      }
      // A wedding: what the other brings (a shop of the same trade, land) may be what they wanted.
      if (wed.has(r.id)) amb = { ...amb, route: chooseRoute(r, kind, amb.step, amb.target, routeEnv(r), roll(r, "route")) };
      // Hunger and fighting.
      const hard = hardTimes(r, kind, sd, day, poor);
      if (hard.urgent && !urgent) {
        urgent = hard.urgent;
        amb = { ...amb, urgent: JSON.stringify(urgent) };
        out.urgent.push({ who: r.id, kind: urgent.kind });
      }
      if (hard.strength !== 0 && check) amb = { ...amb, strength: amb.strength + hard.strength };
      // A famine eats what was put by.
      if ((kind === "land" || kind === "wealth") && amb.step === 0 && sd.famine >= LIVING.famine) amb = { ...amb, since: Math.min(day, amb.since + LIVING.famineCost) };
      // A new place: they start again, with fresh heart and a fresh look at how.
      const open = careers.openJobs(r.id);
      const elsewhere = open.filter((j) => !j.job.startsWith("seat:") && !j.job.startsWith("shop:") && !j.job.startsWith("land:") && j.site !== site);
      if (elsewhere.length > 0 && elsewhere.length === open.filter((j) => !j.job.startsWith("seat:") && !j.job.startsWith("shop:") && !j.job.startsWith("land:")).length) {
        for (const j of elsewhere) {
          careers.endJob(r.id, j.job, day);
          careers.startJob(r.id, j.job, site, j.from_day);
        }
        amb = { ...amb, strength: amb.strength + LIVING.opening, route: amb.route === "wander" ? "wander" : chooseRoute(r, kind, amb.step, amb.target, routeEnv(r), roll(r, "route")) };
      }
      if (check && kind !== "quiet_life") {
        const grownYears = ageFrom(r.born_day, day) - speciesOf(r.species).adultAge;
        const base = baseStrength(r);
        amb = { ...amb, strength: amb.strength + (base - amb.strength) * LIVING.drift - (grownYears >= LIVING.fadeFrom ? LIVING.fade : 0), frustration: Math.max(0, amb.frustration - LIVING.ease) };
        // A route that no longer fits (the spouse died, the shop went elsewhere) gives way to one that does.
        if (amb.route === "marry_in" || amb.route === "inherit") amb = { ...amb, route: chooseRoute(r, kind, amb.step, amb.target, routeEnv(r), roll(r, "route")) };
      }
      careers.setAmbition(amb);
      amb = careers.ambitionOf(r.id)!;
      if (check && kind !== "quiet_life" && kind !== "revenge" && amb.strength < LIVING.letGo) {
        giveUp(r, amb, "their heart has gone out of it");
        return null;
      }
      return amb;
    }

    /** Being blocked builds frustration (the hot-tempered faster); at a head it is let out. */
    function frustrate(r: PersonRow, amb: AmbitionRow, add: number): void {
      const now = careers.ambitionOf(r.id);
      if (!now || now.kind !== amb.kind) return;
      const next = { ...now, frustration: now.frustration + add * (0.7 + 0.6 * temperOf(r).temper) };
      careers.setAmbition(next);
      if (careers.ambitionOf(r.id)!.frustration >= LIVING.head) vent(r, careers.ambitionOf(r.id)!);
    }

    /** Frustration at a head turns into something, by their temper: a grudge, a slander, a shortcut, leaving, or giving up. */
    function vent(r: PersonRow, amb: AmbitionRow): void {
      const kind = amb.kind as AmbitionKind;
      const blockerId = rivalsOf(store, r, amb)[0]?.id ?? decidersOf(store, realm, r, amb)[0];
      const blocker = blockerId ? people.get(blockerId) : null;
      const free = r.cls !== "slave" && r.cls !== "serf";
      // One shop of a trade without the masters' leave is as many as a place will stand.
      const shortcut = !!amb.target && careers.holdersOf(JOBS.shop(site, amb.target)).every((h) => !h.row.job.endsWith(":unlicensed"));
      const how = ventOf(r, kind, amb.step, { blocker: !!blocker && blocker.death === null, free, shortcut }, roll(r, "vent"));
      out.vented.push({ who: r.id, how, ...(blocker ? { at: blocker.id } : {}) });
      careers.setAmbition({ ...amb, frustration: LIVING.vented });
      const what = wantsOf(realm, store, amb);
      switch (how) {
        case "grudge": {
          const e = emit({ kind: "slight", actor: r.id, target: blocker!.id, site, day, key: `${r.id}:resent`, details: `${r.name} has come to resent ${blocker!.name}, who stands between them and what they want (${what})`, importance: 2 });
          if (config.chatter) addGrievance(store, { who: r.id, against: blocker!.id, cause: eventRef(e.id), weight: 0.35, day });
          return;
        }
        case "slander": {
          const e = emit({ kind: "rumour", actor: r.id, target: blocker!.id, site, day, key: `${r.id}:slander`, details: `${r.name} is telling folk that ${blocker!.name} cheats their customers (it is not true): ${blocker!.name} stands between them and what they want`, importance: 3 });
          const ref = eventRef(e.id);
          // A few who hear it think less of the one slandered; the slandered, when it reaches them, hold it against the teller.
          const hearers = ids.filter((id) => id !== r.id && id !== blocker!.id && grown(rows.get(id)!)).sort((a, b) => seedFrom(`${a}:${r.id}:${day}`) - seedFrom(`${b}:${r.id}:${day}`)).slice(0, 3);
          if (config.chatter) for (const h of hearers) adjustRel(store, h, blocker!.id, { trust: -6, respect: -4 }, day);
          tell(ref, [r.id, ...hearers]);
          if (config.chatter && roll(r, "found-out") < 0.5) addGrievance(store, { who: blocker!.id, against: r.id, cause: ref, weight: 0.3, day });
          return;
        }
        case "shortcut": {
          // A shop without the guild's leave (or the custom to keep it): the masters of the trade resent it.
          const tr = amb.target ?? r.job;
          const lot = r.home;
          if (lot === null) return;
          patch(r.id, { shop: lot, work: `front:${lot}` });
          careers.startJob(r.id, `${JOBS.shop(site, tr)}:unlicensed`, site, day);
          place.shops.set(tr, (place.shops.get(tr) ?? 0) + 1);
          out.shops.push(r.id);
          const e = emit({ kind: "opened-shop", actor: r.id, site, day, key: `${r.id}:unlicensed`, details: `${r.name} opened a ${TRADES[tr as keyof typeof TRADES]?.shop ?? "shop"} without the leave of the masters of the trade`, importance: 4 });
          const ref = eventRef(e.id);
          tell(ref, [r.id]);
          const masters = ids.filter((id) => id !== r.id && rows.get(id)!.shop !== null && rows.get(id)!.job === tr).slice(0, 3);
          if (config.chatter) for (const m of masters) addGrievance(store, { who: m, against: r.id, cause: ref, weight: 0.25, day });
          moveOn(careers.ambitionOf(r.id)!, 3);
          achieve(rows.get(r.id) ?? r, { ...careers.ambitionOf(r.id)!, step: 3 }, `a ${TRADES[tr as keyof typeof TRADES]?.shop ?? "shop"} of their own, leave or no leave`);
          return;
        }
        case "leave": {
          const o = outlookOf(r);
          if (!o.goal) {
            o.goal = { kind: "move", since: day, reason: `nothing comes of wanting ${what} here` };
            patch(r.id, { outlook: JSON.stringify(o) });
          }
          emit({ kind: "new-goal", actor: r.id, site, day, key: `${r.id}:leave`, details: `${r.name} means to leave ${s!.name}: nothing comes of wanting ${what} here`, importance: 2 });
          return;
        }
        default:
          return giveUp(r, amb, "they are tired of waiting");
      }
    }

    /** A journeyman of the `wander` route sets out to work in other towns for a while (N25's move goal takes them). */
    function wander(r: PersonRow, tr: string): void {
      const o = outlookOf(r);
      if (o.goal) return;
      o.goal = { kind: "move", since: day, reason: `to work as a journeyman ${tr} in other towns` };
      patch(r.id, { outlook: JSON.stringify(o) });
    }

    /**
     * A shop or land the dead (or a master stepping back) held passes on: to a child of theirs in the same trade, then a hand who works it, then
     * their spouse; land to a child who wants land, then the eldest. Nobody takes on a second shop. A shop nobody takes is an opening for the
     * masters of the trade who have been waiting.
     */
    function passOn(from: PersonRow, job: string): void {
      const lot = from.shop;
      const candidates = ids.map((id) => rows.get(id)!).filter((x) => grown(x) && x.id !== from.id && !x.away && x.death === null);
      const kids = new Set(people.childrenOf(from.id).map((c) => c.id));
      if (job.startsWith("shop:")) {
        const tr = job.split(":")[2]!;
        const heirs = candidates
          .filter((x) => x.job === tr && x.shop === null && rankOf(x, careers.openJobs(x.id)) !== null)
          .map((x) => ({ x, w: (kids.has(x.id) ? 4 : 0) + (lot !== null && x.work === `front:${lot}` ? 2 : 0) + (from.spouse === x.id ? 1 : 0) }))
          .filter((h) => h.w > 0)
          .sort((a, b) => b.w - a.w || (b.x.skill ?? 0) - (a.x.skill ?? 0) || byId(a.x, b.x));
        const heir = heirs[0]?.x;
        if (!heir || lot === null) {
          for (const id of ids) {
            const a = careers.ambitionOf(id);
            if (a && a.kind === "master_trade" && a.target === tr && a.step === 2) careers.setAmbition({ ...a, strength: a.strength + LIVING.opening });
          }
          return;
        }
        if (rankOf(heir, careers.openJobs(heir.id)) !== "master") {
          careers.endJob(heir.id, JOBS.journeyman(tr), day);
          careers.startJob(heir.id, JOBS.master(tr), site, day);
          out.promoted.push(`${heir.id}:master`);
        }
        patch(heir.id, { shop: lot, work: `front:${lot}`, master_id: null, master: null });
        careers.startJob(heir.id, JOBS.shop(site, tr), site, day);
        place.shops.set(tr, (place.shops.get(tr) ?? 0) + 1);
        out.passed.push({ from: from.id, to: heir.id, what: job });
        out.shops.push(heir.id);
        const e = emit({ kind: "opened-shop", actor: heir.id, target: from.id, site, day, key: `${heir.id}:took-over`, details: `${heir.name} took over the ${TRADES[tr as keyof typeof TRADES]?.shop ?? "shop"} of ${from.name}${from.death !== null ? " after their death" : ", who has stepped back"}`, importance: 4 });
        tell(eventRef(e.id), [heir.id]);
        const a = careers.ambitionOf(heir.id);
        if (a && a.kind === "master_trade") {
          careers.setAmbition({ ...a, route: "take_over" });
          moveOn(careers.ambitionOf(heir.id)!, 3);
          achieve(rows.get(heir.id) ?? heir, { ...careers.ambitionOf(heir.id)!, step: 3 }, `the ${TRADES[tr as keyof typeof TRADES]?.shop ?? "shop"} of ${from.name}`);
        }
        return;
      }
      // Land.
      const heir = candidates
        .filter((x) => kids.has(x.id) && !careers.openJobs(x.id).some((j) => j.job.startsWith("land:")))
        .sort((a, b) => Number(careers.ambitionOf(b.id)?.kind === "land") - Number(careers.ambitionOf(a.id)?.kind === "land") || a.born_day - b.born_day || byId(a, b))[0];
      if (!heir) return;
      careers.startJob(heir.id, JOBS.land(site), site, day);
      place.plots++;
      out.passed.push({ from: from.id, to: heir.id, what: job });
      emit({ kind: "bought-land", actor: heir.id, target: from.id, site, day, key: `${heir.id}:inherit`, details: `${heir.name} has the land of ${from.name} now`, importance: 3 });
      const a = careers.ambitionOf(heir.id);
      if (a && a.kind === "land") {
        careers.setAmbition({ ...a, route: "inherit" });
        moveOn(careers.ambitionOf(heir.id)!, 2);
        achieve(rows.get(heir.id) ?? heir, { ...careers.ambitionOf(heir.id)!, step: 2 }, `the land of ${from.name}`);
      }
    }

    /** A trade's ladder: the end of an apprenticeship, the master's exam, a shop. */
    function trade(r: PersonRow, amb: AmbitionRow, st: Standing, drive: number): void {
      const tr = st.trade;
      if (!tr || (st.rank === null && r.job !== "apprentice")) return giveUp(r, amb, "they are no longer in the trade");
      // Their rank moved on another way (taken on as an apprentice, a master by the first day): the ladder follows.
      const at = st.rank === "apprentice" ? 0 : st.rank === "journeyman" ? 1 : r.shop !== null ? 3 : 2;
      if (at !== amb.step) amb = moveOn(amb, at);
      if (at >= 3) return achieve(r, amb, `a ${TRADES[tr as keyof typeof TRADES]?.shop ?? "shop"} of their own`);
      if (amb.progress < 1 && at < 2) return;
      if (at === 0) {
        const master = r.master_id ? people.get(r.master_id) : null;
        const sayso = master && master.death === null && master.site === site ? 0.75 : 0.4;
        if (roll(r, "journeyman") >= sayso) return frustrate(r, amb, LIVING.blocked);
        const shop = master?.shop ?? null;
        careers.endJob(r.id, JOBS.apprentice(tr), day);
        patch(r.id, { job: tr as PersonRow["job"], master_id: null, master: null, work: shop !== null ? `front:${shop}` : r.work });
        careers.startJob(r.id, JOBS.journeyman(tr), site, day);
        out.promoted.push(`${r.id}:journeyman`);
        emit({ kind: "promoted", actor: r.id, target: master?.id ?? "", site, day, key: `${r.id}:journeyman`, details: `${r.name} finished their apprenticeship${master ? ` under ${master.name}` : ""} and is a journeyman ${tr} now`, importance: 3 });
        moveOn(amb, 1);
        return;
      }
      if (at === 1) {
        const guild = TRADES[tr as keyof typeof TRADES]?.guild;
        const fac = guild ? [...place.guilds].find((g) => realm.factions[g]?.trade === guild) : undefined;
        // A journeyman who went to work in other towns comes back a better hand (route `wander`).
        const travelled = amb.route === "wander" && st.open.some((j) => j.job === JOBS.journeyman(tr) && j.site !== site);
        if (amb.route === "wander" && !travelled) wander(r, tr);
        const pass = (fac ? 0.35 + 0.12 * st.skill : 0.55) + (travelled ? 0.2 : 0);
        if (roll(r, "exam") >= pass) return frustrate(r, amb, LIVING.failed);
        careers.endJob(r.id, JOBS.journeyman(tr), day);
        careers.startJob(r.id, JOBS.master(tr), site, day);
        out.promoted.push(`${r.id}:master`);
        emit({ kind: "promoted", actor: r.id, site, day, key: `${r.id}:master`, details: fac ? `${r.name} passed the ${realm.factions[fac]!.name}'s exam and is a master ${tr}` : `${r.name} is a master ${tr} now, by the say-so of the masters of the trade`, importance: 3 });
        moveOn(amb, 2);
        return;
      }
      // A master: a shop of their own. Through marriage: their spouse's shop of the same trade is theirs to keep together.
      const spouse = r.spouse ? people.get(r.spouse) : null;
      if (spouse && spouse.death === null && spouse.site === site && spouse.shop !== null && spouse.job === tr) {
        patch(r.id, { shop: spouse.shop, work: `front:${spouse.shop}` });
        moveOn(amb, 3);
        return achieve(rows.get(r.id) ?? r, { ...amb, step: 3 }, `the ${TRADES[tr as keyof typeof TRADES]?.shop ?? "shop"} they keep with ${spouse.name}`);
      }
      // Else if the place's custom has room for one more.
      if (shopRoom(place, tr) <= 0) {
        frustrate(r, amb, LIVING.blocked);
        if (careers.ambitionOf(r.id)?.kind !== "master_trade") return;
        if (yearsIn(st.open, JOBS.master(tr), day) < CAREER.shopWaitYears) return;
        // No room here: the ambitious go where there is (the N25 move goal), the rest settle for what they have.
        if (drive >= 0.6 && r.cls !== "slave" && r.cls !== "serf") {
          const o = outlookOf(r);
          if (!o.goal) {
            o.goal = { kind: "move", since: day, reason: `there is no room for another ${tr} here` };
            patch(r.id, { outlook: JSON.stringify(o) });
          }
          return;
        }
        return giveUp(r, amb, `there is no room for another ${TRADES[tr as keyof typeof TRADES]?.shop ?? "shop"} in ${s!.name}`);
      }
      if (amb.progress < 1 || r.home === null || roll(r, "shop") >= 0.4 + 0.4 * drive) return;
      openShop(r, true);
      moveOn(amb, 3);
      achieve(rows.get(r.id) ?? r, { ...amb, step: 3 }, `a ${TRADES[tr as keyof typeof TRADES]?.shop ?? "shop"} of their own`);
    }

    /** A master opens a shop: their house takes their sign (N31's reserved lots are not built: the shop is the house they live in). */
    function openShop(m: PersonRow, told: boolean): void {
      const front = /^front:(\d+)$/.exec(m.work ?? "");
      // The keeper of a forge on the map keeps that forge; anyone else hangs their sign on their own house.
      const lot = m.job === "smith" && front ? Number(front[1]) : m.home;
      if (lot === null) return;
      patch(m.id, { shop: lot, work: `front:${lot}` });
      careers.startJob(m.id, JOBS.shop(site, m.job), site, day);
      place.shops.set(m.job, (place.shops.get(m.job) ?? 0) + 1);
      if (!told) return;
      out.shops.push(m.id);
      const e = emit({ kind: "opened-shop", actor: m.id, site, day, details: `${m.name} opened a ${TRADES[m.job as keyof typeof TRADES]?.shop ?? "shop"} of their own in ${s!.name}`, importance: 4 });
      tell(eventRef(e.id), [m.id]);
    }

    /** An apprentice without a master finds one: a master of their trade with a shop here, the one with fewest apprentices. */
    function findMaster(r: PersonRow): PersonRow {
      const now = r.master_id ? people.get(r.master_id) : null;
      if (now && now.death === null && now.site === site && isTrade(now.job)) return r;
      const trade = tradeOf(r, careers.openJobs(r.id), now?.job ?? null);
      const masters = ids
        .map((id) => rows.get(id)!)
        .filter((m) => grown(m) && m.job === trade && m.shop !== null && m.id !== r.id)
        .map((m) => ({ m, n: ids.filter((x) => rows.get(x)!.master_id === m.id && rows.get(x)!.job === "apprentice").length }))
        .sort((a, b) => a.n - b.n || byId(a.m, b.m));
      const m = masters[0]?.m;
      if (!m) return now ? patch(r.id, { master_id: null, master: null })! : r;
      return patch(r.id, { master_id: m.id, master: m.name, work: `front:${m.shop}` })!;
    }

    /** A master takes on a young person of the place as their apprentice. */
    function takeApprentice(m: PersonRow): void {
      const sp = speciesOf(m.species);
      const young = ids
        .map((id) => rows.get(id)!)
        .filter((y) => grown(y) && !y.away && !y.master_id && (y.cls === "commoner" || y.cls === "artisan") && ["labourer", "porter", "washer"].includes(y.job) && ageFrom(y.born_day, day) <= sp.adultAge + 5)
        .sort((a, b) => seedFrom(`${a.id}:${day}`) - seedFrom(`${b.id}:${day}`) || byId(a, b));
      const y = young[0];
      if (!y) return;
      for (const j of careers.openJobs(y.id)) if (!j.job.startsWith("seat:") && !j.job.startsWith("land:")) careers.endJob(y.id, j.job, day);
      patch(y.id, { job: "apprentice", master_id: m.id, master: m.name, work: `front:${m.shop}`, skill: Math.max(1, y.skill ?? 0) });
      careers.startJob(y.id, JOBS.apprentice(m.job), site, day);
      careers.setAmbition({ who: y.id, kind: "master_trade", target: m.job, progress: 0, since: day, step: 0, ...AMBITION_DEFAULTS, strength: baseStrength(y) + 0.1, route: "custom" });
      out.picked++;
      emit({ kind: "apprenticed", actor: m.id, target: y.id, site, day, details: `${m.name} took ${y.name} on as an apprentice ${m.job}`, importance: 2 });
    }

    /** Land: coin put by buys a plot (a freehold on the place's fields), and in time tenants work it. */
    function land(r: PersonRow, amb: AmbitionRow, progress: number): void {
      if (progress < 1) return;
      if (amb.step === 0) {
        if (plotRoom(place) <= 0) return frustrate(r, amb, LIVING.blocked);
        if (roll(r, "plot") >= 0.6) return;
        for (const j of careers.openJobs(r.id)) if (!j.job.startsWith("seat:") && !isRankJob(j.job) && j.job !== r.job) careers.endJob(r.id, j.job, day);
        patch(r.id, { job: "farmer", work: "zone:fields" });
        syncJob(rows.get(r.id)!);
        careers.startJob(r.id, JOBS.land(site), site, day);
        place.plots++;
        emit({ kind: "bought-land", actor: r.id, site, day, details: `${r.name} bought a plot of land of their own outside ${s!.name}`, importance: 3 });
        moveOn(amb, 1);
        return;
      }
      // Tenants: a landless labourer or serf with no master comes to work it.
      const tenant = ids.map((id) => rows.get(id)!).find((y) => grown(y) && y.id !== r.id && !y.master_id && !y.away && (y.job === "labourer" || (y.cls === "serf" && y.job !== "farmer")));
      if (!tenant) return;
      patch(tenant.id, { master_id: r.id, master: r.name, job: "farmer", work: "zone:fields" });
      moveOn(amb, 2);
      achieve(r, amb, `${tenant.name} works their land as a tenant`);
    }

    /** Freedom: years of service, then the master's leave (the greedy hold on), or the law changing under them. */
    function freedom(r: PersonRow, amb: AmbitionRow, progress: number): void {
      const bound = (r.cls === "slave" && laws.slavery) || (r.cls === "serf" && laws.serfdom);
      if (bound && progress < 1) return;
      const boss = r.master_id ? people.get(r.master_id) : null;
      // A check's chance of the master's leave (or the lord's, for a serf): a few in a hundred a season, fewer from the greedy.
      const leave = boss && boss.death === null ? 0.12 - 0.1 * traitsOfRow(boss).greed : 0.05;
      if (bound && roll(r, "freed") >= leave) return frustrate(r, amb, LIVING.blocked);
      patch(r.id, { cls: "commoner", master: null, master_id: null, ...(r.job === "slave" ? { job: "labourer" as PersonRow["job"], work: "streets" } : {}) });
      syncJob(rows.get(r.id)!);
      const e = emit({ kind: "freed", actor: r.id, target: boss?.id ?? "", site, day, details: bound ? `${r.name} was given their freedom${boss ? ` by ${boss.name}` : ""}` : `${r.name} is free: the law no longer binds them`, importance: 5 });
      tell(eventRef(e.id), [r.id, ...(boss ? [boss.id] : [])]);
      moveOn(amb, 1);
      achieve(rows.get(r.id) ?? r, { ...amb, step: 1 }, "their freedom");
    }

    /** A seat that stood vacant is filled: the rule picks; the winner rises; the losers bear the winner a grievance. */
    function contest(seat: Seat, cands: PersonRow[]): void {
      const c = decideSeat(store, realm, seat, cands, voters(seat), day);
      out.contests.push(c);
      const winner = rows.get(c.winner)!;
      careers.startJob(winner.id, JOBS.seat(seat.id), site, day);
      const losers = c.scores.slice(1);
      const how = seat.rule === "vote" ? "by the members' vote" : "by the head's choosing";
      const e = emit({
        kind: "seat-won",
        actor: winner.id,
        target: losers[0]?.who ?? "",
        site,
        day,
        key: seat.id,
        details: `${winner.name} was made ${seat.title}${losers.length > 0 ? `, over ${names(losers.map((l) => rows.get(l.who)!.name))}` : ""} (${how})`,
        importance: seat.kind === "guild_master" || seat.kind === "captain" ? 5 : 4,
        witnesses: c.scores.map((x) => x.who).slice(0, 5),
        why: c.scores[0]!.parts.map(([l, v]) => `${l} ${v.toFixed(2)}`).join(", "),
      });
      const ref = eventRef(e.id);
      tell(ref, c.scores.map((x) => x.who));
      // The winner's ladder: an officer's seat is the first rung of a guild, its master the last; a council seat a say in the place.
      const amb = careers.ambitionOf(winner.id);
      if (amb) {
        if (seat.kind === "guild_master") {
          for (const j of careers.openJobs(winner.id)) if (j.job.startsWith(`seat:g:${seat.faction}:`) && j.job.includes(":officer")) careers.endJob(winner.id, j.job, day);
          if (amb.kind === "guild_seat") achieve(winner, moveOn(amb, 2), seat.title);
        } else if (seat.kind === "guild_officer" && amb.kind === "guild_seat") moveOn(amb, 1);
        else if (seat.kind === "council" && amb.kind === "office") moveOn(amb, 1);
      }
      // The losers: a grievance by how close they came and how proud they are; standing to rebuild; and a seat held for life by someone
      // younger is one they will not have.
      const best = c.scores[0]!.score;
      const only = seat.kind === "guild_master" || seat.kind === "captain";
      for (const l of losers) {
        const loser = rows.get(l.who)!;
        // Grievances are chatter's (N37): with it off, a loss leaves none.
        if (config.chatter) addGrievance(store, { who: loser.id, against: winner.id, cause: ref, weight: lossWeight(loser, l.score, best), day });
        const la = careers.ambitionOf(loser.id);
        if (!la) continue;
        if (only && winner.born_day > loser.born_day + 5 * Y) giveUp(loser, la, `${winner.name}, younger than them, holds ${seat.title}`);
        else {
          // A loss: the proud vow to have it next time, the rest lose heart; either way it rankles.
          const proud = temperOf(loser).pride >= 0.6;
          const next = { ...la, progress: la.progress * 0.5, strength: la.strength + (proud ? 0.1 : -0.15) };
          careers.setAmbition(next);
          frustrate(loser, next, LIVING.lostSeat);
        }
      }
    }
  });
}

export { yearsOf };
