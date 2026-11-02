import type { PersonRow } from "../../store/peopleStore.js";
import type { WorldStore } from "../db.js";
import type { Realm } from "../realm/types.js";
import type { Bound } from "../road/bounds.js";
import { siteMap } from "../../web/sites.js";
import { onDuty, type Post } from "./access.js";

/**
 * N26H's bounds, over places whose people are rows: `homes-by-class` (most nobles in the noble quarter, the castle or the
 * palace ward), `nobody-misplaced` (no commoner, serf or slave of their own household with a home in a closed quarter),
 * `posts-filled` (in peace, most gates have a guard on them).
 */
export function checkDistrictBounds(realm: Realm, store: WorldStore, sites: string[], day: number): Bound[] {
  let nobles = 0;
  let nobleIn = 0;
  let misplaced = 0;
  let posts = 0;
  let manned = 0;
  for (const id of sites) {
    const s = realm.settlements[id];
    if (!s || s.way || store.people.count(id) === 0) continue;
    const m = siteMap(s, "village", realm);
    const all = (store.people.loadSite(id, "full") as PersonRow[]).filter((r) => r.death === null);
    // A household is as high as its highest-born member (a commoner wed into the gentry lives in their house).
    const high = new Set(all.filter((r) => ["gentry", "noble", "royal"].includes(r.cls) && r.home !== null).map((r) => r.home));
    for (const r of all) {
      if (r.home === null || r.home >= m.buildings.length) continue;
      const d = m.buildings[r.home]!.district ?? "";
      if (r.cls === "noble" && m.buildings[r.home]!.kind === "manor") {
        nobles++;
        if (["d:noble", "d:castle", "d:palace", "d:manor"].includes(d)) nobleIn++;
      }
      if (high.has(r.home)) continue;
      if ((r.cls === "commoner" || r.cls === "serf" || r.cls === "slave") && !r.master_id && ["d:noble", "d:palace", "d:castle"].includes(d) && m.buildings[r.home]!.kind === "house") misplaced++;
    }
    const ps: Post[] = m.gates.map((g) => ({ id: `post:${id}:${g.x},${g.y}`, site: id, district: g.district, x: g.x, y: g.y }));
    for (const p of ps) {
      posts++;
      if (onDuty(store, p, ps, day, 12)) manned++;
    }
  }
  return [
    { name: "homes-by-class", ok: nobles === 0 || nobleIn / nobles >= 0.5, detail: `${nobleIn} of ${nobles} nobles' manors in the noble quarter or a ward` },
    { name: "nobody-misplaced", ok: misplaced === 0, detail: `${misplaced} commoners, serfs or slaves housed in a closed quarter` },
    { name: "posts-filled", ok: posts === 0 || manned / posts >= 0.8, detail: `${manned} of ${posts} gates manned at noon` },
  ];
}
