import { config } from "../../config.js";
import { unitFor } from "../dice.js";
import { declareWar, ongoing, shiftOpinion, sign, treatiesBetween, warOf } from "../realm/diplomacy.js";
import { addDeed, killFigure, titled } from "../realm/figures.js";
import { travelDays } from "../realm/generate.js";
import { realmNews } from "../realm/log.js";
import { decidePolicy, setPolicy } from "../realm/policy.js";
import type { Figure, Kingdom, Realm } from "../realm/types.js";
import { dailyChance, seasonDays } from "../weather.js";

/**
 * Courts' secrets (N46 steps 4–5): war plans, spies who learn them, and plots against a throne. All realm-level, kept in
 * `realm.society.court`, worked out in the realm's day from its own dice.
 *
 * - **War plans:** a court that has had enough of a neighbour (opinion ≤ −40, an ambitious ruler) plans a war a season ahead, in secret;
 *   when the day comes it goes to war if it still wants to.
 * - **Spies are people:** a court with an eye for intrigue sends one of its own (a merchant, a noble, an adventurer: a figure) to live in a
 *   neighbour's capital. A spy may learn the plans of the court they live by; the report travels home as a traveller would (the road's days),
 *   and the home court acts on it, by its ruler: strikes first, or prepares (a heavy levy, an ally sought), logged with the report as cause.
 *   A spy can be caught (and hanged as one).
 * - **Plots:** a disputed throne (a new ruler whose claim a better-known noble of the realm, or a passed-over child, resents) breeds a
 *   plot: conspirators gather, the court's own watchers may find it out (the plotters hang), or it comes to an attempt on the ruler's life.
 */
export interface WarPlan {
  id: string;
  k: string;
  against: string;
  since: number;
  ready: number;
  /** Spies who learned it. */
  known: string[];
  done?: "war" | "dropped";
}

export interface Spy {
  person: string;
  for: string;
  in: string;
  since: number;
  skill: number;
  homeWas: string | null;
  caught?: number;
}

export interface Report {
  id: string;
  spy: string;
  for: string;
  plan: string;
  learned: number;
  arrives: number;
  acted?: { day: number; how: "strike" | "prepare" | "ignore"; why: string };
}

export interface Plot {
  id: string;
  k: string;
  target: string;
  claimant: string;
  aim: "throne";
  conspirators: string[];
  strength: number;
  since: number;
  /** "found" (the court found it out: the plotters hanged), "struck" (the ruler killed), "failed" (the attempt failed). */
  end?: { day: number; how: "found" | "struck" | "failed"; why: string };
}

export interface CourtState {
  plans: WarPlan[];
  spies: Spy[];
  reports: Report[];
  plots: Plot[];
  next: number;
}

export function courtOf(realm: Realm): CourtState {
  const soc = (realm.society ??= {});
  return (soc.court ??= { plans: [], spies: [], reports: [], plots: [], next: 0 }) as CourtState;
}

/** What the admin view reads without making the state (no `??=`: reading must not change the world's hash). */
export const peekCourt = (realm: Realm): CourtState | undefined => realm.society?.court as CourtState | undefined;

const PLANS_A_YEAR = 0.8;
const SPY_CAUGHT_A_YEAR = 0.12;
const PLOT_FOUND_DAILY = 0.015;
const PLOT_STRIKES_AT = 4;

const living = (realm: Realm, id: string | null | undefined): Figure | undefined => (id && realm.figures[id]?.alive ? realm.figures[id] : undefined);

export function courtDaySecrets(realm: Realm, day: number): void {
  if (!config.society.secrets) return;
  const c = courtOf(realm);
  const ks = Object.values(realm.kingdoms).filter((k) => !k.fallen).sort((a, b) => a.id.localeCompare(b.id));
  plansDay(realm, c, ks, day);
  spiesDay(realm, c, ks, day);
  reportsDay(realm, c, day);
  plotsDay(realm, c, ks, day);
  // Keep the record short.
  c.plans = c.plans.filter((p) => !p.done || day - p.ready < 4 * seasonDays());
  c.reports = c.reports.filter((r) => !r.acted || day - r.acted.day < 4 * seasonDays());
  c.plots = c.plots.filter((p) => !p.end || day - p.end.day < 8 * seasonDays());
}

function plansDay(realm: Realm, c: CourtState, ks: Kingdom[], day: number): void {
  for (const p of c.plans.filter((x) => !x.done && x.ready <= day)) {
    const k = realm.kingdoms[p.k];
    const t = realm.kingdoms[p.against];
    if (!k || !t || k.fallen || t.fallen || warOf(realm, `k:${k.id}`) || (k.opinion[t.id] ?? 0) > -30) {
      p.done = "dropped";
      continue;
    }
    p.done = "war";
    declareWar(realm, [`k:${k.id}`], [`k:${t.id}`], day, `${k.name} had long planned it`);
  }
  for (const k of ks) {
    if (warOf(realm, `k:${k.id}`) || c.plans.some((p) => p.k === k.id && !p.done)) continue;
    const ruler = living(realm, k.ruler);
    if (!ruler || ruler.ambition < 0.5) continue;
    const foe = ks.filter((t) => t.id !== k.id && (k.opinion[t.id] ?? 0) <= -40).sort((a, b) => (k.opinion[a.id] ?? 0) - (k.opinion[b.id] ?? 0))[0];
    if (!foe || unitFor(realm.seed, "war-plan", k.id, day) >= dailyChance(PLANS_A_YEAR)) continue;
    c.plans.push({ id: `wp${c.next++}`, k: k.id, against: foe.id, since: day, ready: day + seasonDays(), known: [] });
  }
}

function spiesDay(realm: Realm, c: CourtState, ks: Kingdom[], day: number): void {
  // Placing spies, a season at a time.
  if (day % seasonDays() === 0) {
    for (const k of ks) {
      const ruler = living(realm, k.ruler);
      if (!ruler || ruler.ambition + ruler.greed < 0.9) continue;
      for (const t of ks) {
        if (t.id === k.id || c.spies.some((s) => s.for === k.id && s.in === t.id && !s.caught && realm.figures[s.person]?.alive)) continue;
        if (unitFor(realm.seed, "spy-send", k.id, t.id, day) >= 0.5) continue;
        const pick = Object.values(realm.figures)
          .filter((f) => f.alive && !f.away && !f.talks && ["merchant", "noble", "adventurer"].includes(f.role) && f.home && realm.settlements[f.home]?.kingdom === k.id && !Object.values(realm.settlements).some((s) => s.leader === f.id) && !c.spies.some((s) => s.person === f.id && !s.caught))
          .sort((a, b) => a.id.localeCompare(b.id));
        const f = pick[Math.floor(unitFor(realm.seed, "spy-pick", k.id, t.id, day) * pick.length)];
        if (!f) continue;
        c.spies.push({ person: f.id, for: k.id, in: t.id, since: day, skill: Math.round((0.3 + 0.7 * unitFor(realm.seed, "spy-skill", f.id)) * 100) / 100, homeWas: f.home });
        f.home = t.capital;
        realm.stats.spiesSent = (realm.stats.spiesSent ?? 0) + 1;
      }
    }
  }
  for (const s of c.spies) {
    const f = living(realm, s.person);
    if (!f || s.caught) continue;
    // Caught, now and then: hanged as a spy, and the courts' feelings sour.
    if (unitFor(realm.seed, "spy-caught", s.person, day) < dailyChance(SPY_CAUGHT_A_YEAR) * (1.3 - s.skill)) {
      s.caught = day;
      killFigure(realm, f, day, "hanged as a spy", { cause: "execution" } as never);
      shiftOpinion(realm, s.in, s.for, -25);
      realmNews(realm, day, realm.kingdoms[s.in]?.capital ?? null, "spy", `${f.name} was taken in ${realm.kingdoms[s.in]?.name} as a spy of ${realm.kingdoms[s.for]?.name}, and hanged.`, 6, [f.name], { why: "a spy caught" });
      continue;
    }
    // A plan of the court they live by, found out.
    for (const p of c.plans.filter((x) => x.k === s.in && !x.done && !x.known.includes(s.person))) {
      if (unitFor(realm.seed, "spy-learn", s.person, p.id, day) >= 0.12 * s.skill + 0.04) continue;
      p.known.push(s.person);
      const arrives = day + Math.max(1, travelDays(realm, realm.kingdoms[s.in]?.capital ?? null, realm.kingdoms[s.for]?.capital ?? s.in));
      c.reports.push({ id: `rp${c.next++}`, spy: s.person, for: s.for, plan: p.id, learned: day, arrives });
    }
  }
}

function reportsDay(realm: Realm, c: CourtState, day: number): void {
  for (const r of c.reports.filter((x) => !x.acted && x.arrives <= day)) {
    const k = realm.kingdoms[r.for];
    const p = c.plans.find((x) => x.id === r.plan);
    const spy = realm.figures[r.spy];
    if (!k || k.fallen || !p) {
      r.acted = { day, how: "ignore", why: "nobody left to read it" };
      continue;
    }
    const planner = realm.kingdoms[p.k]!;
    const ruler = living(realm, k.ruler);
    const why = `${spy ? spy.name : "a spy"}'s report from ${planner.name}: they mean war on ${realm.kingdoms[p.against]?.name ?? "someone"} by day ${p.ready}`;
    const onUs = p.against === k.id;
    const bold = ruler ? ruler.bravery * 0.6 + ruler.ambition * 0.4 : 0.4;
    if (onUs && !p.done && !warOf(realm, `k:${k.id}`) && bold > 0.6 && unitFor(realm.seed, "strike-first", r.id) < bold) {
      declareWar(realm, [`k:${k.id}`], [`k:${planner.id}`], day, `to strike first: ${why}`);
      r.acted = { day, how: "strike", why };
    } else if (onUs) {
      decidePolicy(realm, k.id, "levy", day, r.id, { heavy: 1.5 }, `war is coming: ${why}`);
      // An ally sought among those who also mislike the planner.
      const ally = Object.values(realm.kingdoms).find((o) => o.id !== k.id && o.id !== planner.id && !o.fallen && (o.opinion[planner.id] ?? 0) < 0 && treatiesBetween(realm, [`k:${k.id}`], [`k:${o.id}`], day, ["mutual_defense"]).length === 0);
      if (ally) sign(realm, "mutual_defense", `k:${k.id}`, `k:${ally.id}`, day, 4 * seasonDays(), `against ${planner.name}, after ${why}`);
      shiftOpinion(realm, k.id, planner.id, -15);
      realmNews(realm, day, k.capital, "court", `${k.name} makes ready for war with ${planner.name}${ally ? `, and seeks ${ally.name}'s friendship` : ""}.`, 6, [], { why });
      r.acted = { day, how: "prepare", why };
    } else {
      shiftOpinion(realm, k.id, planner.id, -5);
      r.acted = { day, how: "ignore", why: `${why}: not our war` };
    }
    if (spy) addDeed(spy, `learned ${planner.name}'s war plans`);
  }
}

/**
 * A ruler who came to a throne someone better known, or passed over, thinks theirs: a claimant. Looked at when a reign begins (the new ruler
 * has not been on the throne long).
 */
export function claimantOf(realm: Realm, k: Kingdom, day: number): Figure | null {
  const ruler = living(realm, k.ruler);
  if (!ruler) return null;
  const nobles = Object.values(realm.figures).filter((f) => f.alive && f.id !== ruler.id && (f.role === "noble" || f.role === "lord") && f.home && realm.settlements[f.home]?.kingdom === k.id);
  const old = Object.values(realm.figures).find((f) => !f.alive && f.role === "ruler" && f.deathDay !== undefined && day - f.deathDay < seasonDays() * 2 && f.home && realm.settlements[f.home]?.kingdom === k.id);
  const passedOver = old ? Object.values(realm.figures).find((f) => f.alive && f.id !== ruler.id && f.parents?.includes(old.id)) : undefined;
  const rival = passedOver ?? nobles.filter((f) => f.ambition >= 0.6 && f.renown > ruler.renown).sort((a, b) => b.renown - a.renown || a.id.localeCompare(b.id))[0];
  return rival ?? null;
}

function plotsDay(realm: Realm, c: CourtState, ks: Kingdom[], day: number): void {
  // When each reign began (a plot is bred on a reign's first days). A realm's first rulers count as having reigned long.
  const reigns = ((realm.society ??= {}).reigns ??= {}) as Record<string, number>;
  const reignOf = (realm.society!.reignOf ??= {}) as Record<string, string>;
  for (const k of ks) {
    if (!k.ruler || reignOf[k.id] === k.ruler) continue;
    reigns[k.id] = reignOf[k.id] === undefined ? -999 : day;
    reignOf[k.id] = k.ruler;
  }
  // New plots: on the first days of a reign whose claim is disputed.
  for (const k of ks) {
    const ruler = living(realm, k.ruler);
    if (!ruler || c.plots.some((p) => p.k === k.id && !p.end)) continue;
    if (day - (reigns[k.id] ?? -999) > seasonDays()) continue;
    const claimant = claimantOf(realm, k, day);
    if (!claimant || unitFor(realm.seed, "plot", k.id, ruler.id, claimant.id) >= 0.6) continue;
    c.plots.push({ id: `pl${c.next++}`, k: k.id, target: ruler.id, claimant: claimant.id, aim: "throne", conspirators: [claimant.id], strength: 1, since: day });
    realm.stats.plots = (realm.stats.plots ?? 0) + 1;
  }
  for (const p of c.plots.filter((x) => !x.end)) {
    const k = realm.kingdoms[p.k];
    const ruler = living(realm, p.target);
    const claimant = living(realm, p.claimant);
    if (!k || !ruler || !claimant || k.ruler !== ruler.id) {
      p.end = { day, how: "failed", why: "the throne changed hands another way" };
      continue;
    }
    // Recruiting: the disloyal of the realm's nobles join.
    if (day % 3 === 0) {
      const join = Object.values(realm.figures).filter((f) => f.alive && !p.conspirators.includes(f.id) && f.id !== ruler.id && f.loyalty < 0.4 && f.home && realm.settlements[f.home]?.kingdom === k.id && ["noble", "lord", "captain", "merchant"].includes(f.role)).sort((a, b) => a.id.localeCompare(b.id))[0];
      if (join && unitFor(realm.seed, "plot-join", p.id, join.id) < 0.6) {
        p.conspirators.push(join.id);
        p.strength += 1 + join.bravery;
      }
    }
    // Found out: each conspirator is a mouth that might talk; the ruler's spies and servants listen.
    if (unitFor(realm.seed, "plot-found", p.id, day) < PLOT_FOUND_DAILY * p.conspirators.length) {
      p.end = { day, how: "found", why: `the plot of ${claimant.name} was found out` };
      for (const id of p.conspirators) {
        const f = realm.figures[id];
        if (f?.alive) killFigure(realm, f, day, "executed for treason", { cause: "execution" } as never);
      }
      realmNews(realm, day, k.capital, "plot", `A plot against ${titled(ruler)} was found out: ${claimant.name} and ${p.conspirators.length - 1} others were put to death for treason.`, 8, [claimant.name, ruler.name], { why: p.end.why });
      continue;
    }
    // The attempt.
    if (p.strength >= PLOT_STRIKES_AT) {
      const guard = 1.5 + ruler.bravery + (realm.settlements[k.capital]?.buildings.barracks ?? 0) * 0.5;
      const hit = p.strength / (p.strength + guard);
      if (unitFor(realm.seed, "plot-strike", p.id) < hit) {
        p.end = { day, how: "struck", why: `${claimant.name}'s plot: the ruler was killed` };
        killFigure(realm, ruler, day, `murdered by ${claimant.name}'s plotters`, { cause: "murder", killer: claimant.id } as never);
        realmNews(realm, day, k.capital, "plot", `${titled(ruler)} has been murdered in ${realm.settlements[k.capital]?.name ?? "the capital"}. ${claimant.name} is named behind it.`, 9, [ruler.name, claimant.name], { why: "a disputed succession" });
      } else {
        p.end = { day, how: "failed", why: `the attempt on ${ruler.name}'s life failed` };
        killFigure(realm, claimant, day, "killed in a failed attempt on the throne", { cause: "execution" } as never);
        realmNews(realm, day, k.capital, "plot", `An attempt on ${titled(ruler)}'s life failed; ${claimant.name} died for it.`, 8, [ruler.name, claimant.name], { why: "a disputed succession" });
      }
    }
  }
  void ongoing;
  void setPolicy;
}
