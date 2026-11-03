import { roadClosed } from "@millbrook/shared";
import { config } from "../../config.js";
import { roadDataOf } from "../road/generateRoads.js";
import { seasonDays } from "../weather.js";
import type { Bound } from "../road/bounds.js";
import type { Realm } from "./types.js";

/**
 * N30's bounds, on the realm as it stands: `no-permanent-famine` (no living place has been under the famine line for more
 * than a season), `harvest-matters` (in at least 80% of places, stores at the end of winter are lower than just after the
 * harvest), `roads-reopen` (no high road has been snowed in for more than a season in the last year).
 */
export const HARVEST_MATTERS = 0.8;

export function checkSeasonBounds(realm: Realm, day: number): Bound[] {
  const season = seasonDays();
  const living = Object.values(realm.settlements).filter((s) => !s.abandoned && !s.fallen && !s.way && s.population > 0);
  const hungry = living.filter((s) => s.hungrySince !== undefined && day - s.hungrySince > season);
  const judged = living.filter((s) => s.harvest?.after !== undefined && s.harvest.end !== undefined);
  const fell = judged.filter((s) => s.harvest!.end! < s.harvest!.after!);
  const data = roadDataOf(realm);
  let longest = 0;
  let worst = "";
  for (const r of data.roads.filter((x) => x.high)) {
    let run = 0;
    for (let d = Math.max(1, day - config.daysPerYear); d <= day; d++) {
      run = roadClosed(realm.seed, r, d, config.daysPerYear) ? run + 1 : 0;
      if (run > longest) {
        longest = run;
        worst = r.id;
      }
    }
  }
  return [
    { name: "no-permanent-famine", ok: hungry.length === 0, detail: hungry.length === 0 ? "no place hungry for more than a season" : `hungry for over a season: ${hungry.slice(0, 4).map((s) => s.name).join(", ")}` },
    {
      name: "harvest-matters",
      ok: judged.length === 0 || fell.length / judged.length >= HARVEST_MATTERS,
      detail: judged.length === 0 ? "no whole winter yet" : `${fell.length} of ${judged.length} places ended winter with less than after the harvest`,
    },
    { name: "roads-reopen", ok: longest <= season, detail: data.roads.some((x) => x.high) ? `longest closure ${longest} days${worst ? ` (${worst})` : ""}` : "no high roads" },
  ];
}
