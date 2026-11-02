import { MAX_FACTIONS } from "../game/realm/director.js";
import type { Sample } from "./sample.js";

/**
 * Long-run bounds (N22 decision 1): data with code checks, each tagged with the phase that added it. A phase that adds a
 * system adds its bounds here in the same commit. Bands are checked after the warm-up year, so the generator's starting
 * state doesn't trip them. Each band's comment records what was measured when it was set, and when (plans README §22):
 * bounds are a net against regressions, not a design target. When one fails, tune the answers (relief, lords, bounties,
 * hunters, patrols), not a hard cap.
 */
export interface BoundCtx {
  daysPerYear: number;
  seed: number;
}

export interface LongBound {
  id: string;
  phase: string;
  describe: string;
  check(series: Sample[], ctx: BoundCtx): { ok: boolean; detail: string };
}

export interface BoundResult {
  id: string;
  phase: string;
  ok: boolean;
  detail: string;
}

/** The samples after the warm-up year. */
const afterYear = (series: Sample[], ctx: BoundCtx) => {
  const first = series[0]?.day ?? 1;
  const late = series.filter((s) => s.day - first >= ctx.daysPerYear);
  return late.length > 0 ? late : series.slice(-1);
};

/** The director's cap, with the fifth over it that splits are seen to reach before it thins them. */
const FACTION_CEILING = Math.ceil(MAX_FACTIONS * 1.2);

const pct = (n: number) => `${Math.round(n * 100)}%`;

export const BOUNDS: LongBound[] = [
  {
    id: "no-kingdom-extinct",
    phase: "N22",
    describe: "every starting kingdom still holds a place at the end",
    check: (series) => {
      const first = series[0];
      const last = series.at(-1);
      if (!first || !last) return { ok: true, detail: "no samples" };
      const gone = Object.keys(first.kingdoms).filter((k) => first.kingdoms[k]!.alive && !last.kingdoms[k]?.alive);
      return { ok: gone.length === 0, detail: gone.length === 0 ? `${Object.keys(last.kingdoms).length} kingdoms all standing` : `fell: ${gone.join(", ")}` };
    },
  },
  {
    id: "kingdoms-within-cap",
    phase: "N22",
    describe: "no more than 12 kingdoms at any time",
    check: (series) => {
      const most = Math.max(0, ...series.map((s) => Object.keys(s.kingdoms).length));
      return { ok: most <= 12, detail: `at most ${most}` };
    },
  },
  {
    // Measured 2026-10-24 (seeds 1-3, slice, 2 years): the realm's people within -12%..+4% of the start.
    id: "population-band",
    phase: "N22",
    describe: "after year 1, total population stays within ±50% of the start",
    check: (series, ctx) => {
      const start = series[0]?.population ?? 0;
      const late = afterYear(series, ctx);
      const lo = Math.min(...late.map((s) => s.population));
      const hi = Math.max(...late.map((s) => s.population));
      const ok = start === 0 || (lo >= start * 0.5 && hi <= start * 1.5);
      return { ok, detail: `start ${start}, after year 1 ${lo}..${hi} (${pct(lo / Math.max(1, start) - 1)}..${pct(hi / Math.max(1, start) - 1)})` };
    },
  },
  {
    // Measured 2026-10-24 (seeds 1-3, slice, 5 years): mean food 74..98 after year 1, hunger at most 2 days running. Granaries
    // run nearly full under the old food formula; N26G's harvests should bring the mean down, and this band with it. Food tops out at 100, so the
    // ceiling only catches a world where nothing is ever eaten.
    id: "food-band",
    phase: "N22",
    describe: "mean food 30..99.5 after year 1, and no place below 15 for more than a year running",
    check: (series, ctx) => {
      const late = afterYear(series, ctx);
      const lo = Math.min(...late.map((s) => s.food.mean));
      const hi = Math.max(...late.map((s) => s.food.mean));
      const run = new Map<string, number>();
      let worst = 0;
      let who = "";
      for (const s of series) {
        for (const id of [...run.keys()]) if (!s.starving.includes(id)) run.delete(id);
        for (const id of s.starving) {
          const n = (run.get(id) ?? 0) + 1;
          run.set(id, n);
          if (n > worst) [worst, who] = [n, id];
        }
      }
      const ok = lo >= 30 && hi <= 99.5 && worst <= ctx.daysPerYear;
      return { ok, detail: `mean food ${lo.toFixed(0)}..${hi.toFixed(0)}; longest hunger ${worst} days${who ? ` (${who})` : ""}` };
    },
  },
  {
    id: "prosperity-band",
    phase: "N22",
    describe: "mean prosperity 25..85 after year 1",
    check: (series, ctx) => {
      const late = afterYear(series, ctx);
      const lo = Math.min(...late.map((s) => s.prosperity.mean));
      const hi = Math.max(...late.map((s) => s.prosperity.mean));
      return { ok: lo >= 25 && hi <= 85, detail: `mean prosperity ${lo.toFixed(0)}..${hi.toFixed(0)}` };
    },
  },
  {
    id: "war-not-permanent",
    phase: "N22",
    describe: "no war lasts more than 3 years, and every kingdom has a year of peace at a stretch",
    check: (series, ctx) => {
      const longest = Math.max(0, ...series.map((s) => s.longestWar));
      // The longest run of peace each kingdom had.
      const kings = Object.keys(series[0]?.kingdoms ?? {});
      const peace = kings.map((k) => {
        let run = 0;
        let best = 0;
        for (const s of series) {
          run = s.kingdoms[k]?.atWar ? 0 : run + 1;
          best = Math.max(best, run);
        }
        return { k, best };
      });
      const worst = peace.sort((a, b) => a.best - b.best)[0];
      const needPeace = series.length > 4 * ctx.daysPerYear; // a short run may not hold a whole year of peace
      const ok = longest <= 3 * ctx.daysPerYear && (!needPeace || !worst || worst.best >= ctx.daysPerYear);
      return { ok, detail: `longest war ${longest} days; least peace ${worst ? `${worst.best} days running (${worst.k})` : "n/a"}` };
    },
  },
  {
    // Measured 2026-10-24 (seeds 1-3, 5 years): 16..26 factions (splits can pass the director's cap of 24 for a while), guilds 62..70% (each trade's guild and its splits), gangs 17%.
    // N13's worry was outlaws and rebels multiplying, so the half-share rule is for them; guilds are held by the cap.
    id: "factions-band",
    phase: "N22",
    describe: `active factions between 3 and ${FACTION_CEILING} after year 1; no outlaw, rebel or cult kind above half`,
    check: (series, ctx) => {
      const late = afterYear(series, ctx);
      const lo = Math.min(...late.map((s) => s.factions));
      const hi = Math.max(...late.map((s) => s.factions));
      const wild = new Set(["gang", "rebels", "cult"]);
      const worst = Math.max(0, ...late.flatMap((s) => Object.entries(s.factionsByKind).filter(([k]) => wild.has(k)).map(([, n]) => n / Math.max(1, s.factions))));
      return { ok: lo >= 3 && hi <= FACTION_CEILING && worst <= 0.5, detail: `${lo}..${hi} factions; the biggest kind is ${pct(worst)}` };
    },
  },
  {
    // Plans README section 24: coin is moved, never made. Rounding in old code may leave a copper or two; nothing more.
    id: "coin-conserved",
    phase: "N26F-J",
    describe: "the realm's coin changes only by what was minted less what was sunk",
    check: (series) => {
      const worst = series.reduce((w, s) => (Math.abs(s.coin.unaccounted) > Math.abs(w.coin.unaccounted) ? s : w), series[0]!);
      const tolerance = Math.max(10, (worst?.coin.total ?? 0) * 0.001);
      return { ok: !worst || Math.abs(worst.coin.unaccounted) <= tolerance, detail: worst ? `worst on day ${worst.day}: ${worst.coin.unaccounted} copper unaccounted of ${worst.coin.total}` : "no samples" };
    },
  },
  {
    // N26F decision 14 / N26I: packs grow, but never past three times their cap.
    id: "packs-band",
    phase: "N26F-J",
    describe: "no pack larger than three times its cap",
    check: (series) => {
      const worst = Math.max(0, ...series.map((s) => s.packs.worstOverCap));
      return { ok: worst <= 3, detail: `the largest pack was ${worst.toFixed(2)}× its cap` };
    },
  },
  {
    // N26I: no more than a tenth of places fallen at once.
    id: "fallen-band",
    phase: "N26F-J",
    describe: "no more than a tenth of places held by beasts or bandits at once",
    check: (series) => {
      const worst = series.reduce((w, s) => Math.max(w, s.fallen / Math.max(1, s.places + s.fallen)), 0);
      return { ok: worst <= 0.1, detail: `at worst ${pct(worst)} of places had fallen` };
    },
  },
];

export function checkAll(series: Sample[], ctx: BoundCtx, only?: string): BoundResult[] {
  return BOUNDS.filter((b) => !only || b.id === only).map((b) => ({ id: b.id, phase: b.phase, ...b.check(series, ctx) }));
}
