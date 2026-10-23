import { budgets } from "../../budgets.js";
import { config } from "../../config.js";
import { seasonDays } from "../weather.js";
import type { Bound } from "../road/bounds.js";
import type { ChoiceLog } from "./types.js";
import { MAX_FIGHTS_PER_PLACE_PER_DAY, MAX_RUN } from "./weights.js";

/**
 * N38's balance bounds (N22 gathers them into one list; until then tests read this). Run over the logs of a stretch of play.
 *
 * - `no-loops`: nobody picks the same non-habit action more than MAX_RUN times in a row.
 * - `work-still-happens`: of the hours the schedule had someone at work, they were at work in most (70%): habit usually wins.
 * - `violence-rare`: violent deeds in a place in a season stay under the cap the fight limit allows (a tenth of it), and there are none
 *   at all with the setting off.
 * - `choices-cost`: an hour of choices for a place's talkers fits the full-detail hour budget.
 */
export interface ChoiceSample {
  /** Every choice made, per person, in the order made. */
  logs: ChoiceLog[];
  /** Violent deeds that were chosen (attacks, thefts): where and when. */
  violent: Array<{ site: string; day: number }>;
  /** Milliseconds one hour of choices took for the biggest place, if measured. */
  hourMs?: number;
}

const picked = (l: ChoiceLog) => l.options[l.picked]!;

export function checkChoiceBounds(sample: ChoiceSample): Bound[] {
  const out: Bound[] = [];
  const byWho = new Map<string, ChoiceLog[]>();
  for (const l of sample.logs) byWho.set(l.who, [...(byWho.get(l.who) ?? []), l]);
  let longest = 0;
  let loopy = "";
  for (const [who, logs] of byWho) {
    let run = 0;
    let last = "";
    for (const l of logs) {
      const a = picked(l).action;
      if (l.habit) {
        run = 0;
        last = "";
      } else {
        run = a === last ? run + 1 : 1;
        last = a;
      }
      if (run > longest) {
        longest = run;
        loopy = `${who} (${a})`;
      }
    }
  }
  out.push({ name: "no-loops", ok: longest <= MAX_RUN, detail: `longest run of one non-habit action: ${longest}${loopy ? ` by ${loopy}` : ""} (cap ${MAX_RUN})` });

  const workHours = sample.logs.filter((l) => l.options.some((o) => o.parts.some(([label]) => label.startsWith("habit: work"))));
  const worked = workHours.filter((l) => picked(l).action === "work").length;
  out.push({ name: "work-still-happens", ok: workHours.length < 20 || worked / workHours.length >= 0.7, detail: `${worked} of ${workHours.length} scheduled work hours were worked` });

  const season = seasonDays();
  const perPlaceSeason = new Map<string, number>();
  for (const v of sample.violent) {
    const key = `${v.site}|${Math.floor(v.day / season)}`;
    perPlaceSeason.set(key, (perPlaceSeason.get(key) ?? 0) + 1);
  }
  const cap = Math.max(1, Math.floor(0.1 * MAX_FIGHTS_PER_PLACE_PER_DAY * season));
  const worst = Math.max(0, ...perPlaceSeason.values());
  out.push({ name: "violence-rare", ok: config.choice.violence ? worst <= cap : sample.violent.length === 0, detail: `${sample.violent.length} violent deeds; most in one place in a season: ${worst} (cap ${config.choice.violence ? cap : 0})` });

  out.push({ name: "choices-cost", ok: sample.hourMs === undefined || sample.hourMs <= budgets.tick.hourFullMs, detail: sample.hourMs === undefined ? "not measured" : `${sample.hourMs.toFixed(2)} ms for an hour (budget ${budgets.tick.hourFullMs} ms)` });
  return out;
}
