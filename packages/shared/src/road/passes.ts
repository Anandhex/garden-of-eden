import { DAYS_PER_YEAR } from "../calendar.js";
import { weatherAt } from "../weather.js";
import { cumulative, pointAt } from "./geometry.js";
import { TILES_PER_UNIT } from "./scale.js";
import type { Anchor, RoadPath, RoadPoint } from "./types.js";

/**
 * High roads and snow (N30 decision 6), pure functions of the realm's seed and the day, so the server, the browser and a
 * lazy place all agree. A road is high when most of it runs through hill country (its nearest place is in the hills); its
 * pass is its middle. Two days of snow at the pass close it; two days without snow open it again.
 */

/** Share of a road's samples in hill country for it to be a high road. */
const HIGH_SHARE = 0.5;
/** Days of weather looked back over to know whether a pass is shut (a closure is decided within a few days). */
const LOOKBACK = 16;

/** Mark the high roads among `roads` and set their pass (in tiles). */
export function markHighRoads(roads: RoadPath[], anchors: Anchor[]): void {
  for (const r of roads) {
    if (r.id.startsWith("spur:") || r.length < 1500) continue;
    const cum = cumulative(r.pts);
    let hills = 0;
    const n = 9;
    for (let k = 1; k <= n; k++) {
      const p = pointAt(r.pts, cum, (r.length * k) / (n + 1));
      let best: Anchor | null = null;
      let d = Infinity;
      for (const a of anchors) {
        const e = (a.x - p.x) ** 2 + (a.y - p.y) ** 2;
        if (e < d) {
          d = e;
          best = a;
        }
      }
      if (best?.terrain === "hills") hills++;
    }
    if (hills / n < HIGH_SHARE) continue;
    const mid = pointAt(r.pts, cum, r.length / 2);
    r.high = true;
    r.pass = { x: Math.round(mid.x), y: Math.round(mid.y) };
  }
}

const snowAt = (seed: number, day: number, pass: RoadPoint, dpy: number) => weatherAt(seed, day, { x: pass.x / TILES_PER_UNIT, y: pass.y / TILES_PER_UNIT }, "hills", dpy) === "snow";

/** Is a high road snowed in on a day? `seed`: the realm's. Low roads never close. */
export function roadClosed(seed: number, road: Pick<RoadPath, "high" | "pass">, day: number, dpy = DAYS_PER_YEAR): boolean {
  if (!road.high || !road.pass) return false;
  let closed = false;
  let snow = 0;
  let dry = 0;
  for (let d = day - LOOKBACK; d <= day; d++) {
    if (snowAt(seed, d, road.pass, dpy)) {
      snow++;
      dry = 0;
    } else {
      dry++;
      snow = 0;
    }
    if (snow >= 2) closed = true;
    else if (dry >= 2) closed = false;
  }
  return closed;
}

/** The roads closed on a day, by id. */
export function closedRoads(seed: number, roads: RoadPath[], day: number, dpy = DAYS_PER_YEAR): Set<string> {
  const out = new Set<string>();
  for (const r of roads) if (r.high && roadClosed(seed, r, day, dpy)) out.add(r.id);
  return out;
}
