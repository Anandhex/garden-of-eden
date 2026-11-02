import { homeDistrict, type SocialClass } from "@millbrook/shared";
import type { PersonRow } from "../../store/peopleStore.js";
import type { WorldStore } from "../db.js";
import { recordLifeEvent } from "../people/events.js";
import { tally } from "../realm/log.js";
import type { Realm } from "../realm/types.js";
import { siteMap } from "../../web/sites.js";

/**
 * Moving district on rising or falling (N26H decision 4): someone whose class no longer fits the quarter they live in (a
 * merchant ruined, a servant whose master died, a commoner raised to the gentry) moves, with their household, to the
 * emptiest house in the district their class puts them in, when there is one. Run every REHOUSE_EVERY days for a place.
 */
export const REHOUSE_EVERY = 6;
const CLOSED = new Set(["d:noble", "d:palace", "d:castle"]);

export function rehouse(realm: Realm, store: WorldStore, site: string, day: number): number {
  const s = realm.settlements[site];
  if (!s || s.way || day % REHOUSE_EVERY !== 0) return 0;
  const map = siteMap(s, "village", realm);
  const dlist = map.districts.map((r) => r.district);
  if (dlist.length === 0) return 0;
  const rows = (store.people.loadSite(site, "full") as PersonRow[]).filter((r) => r.death === null && !r.captive);
  const occupancy = new Map<number, number>();
  for (const r of rows) if (r.home !== null) occupancy.set(r.home, (occupancy.get(r.home) ?? 0) + 1);
  let moved = 0;
  const done = new Set<number>();
  // A household is judged by its highest-born member (a commoner wed to a gentleman lives in his house).
  const RANK: Record<string, number> = { slave: 0, serf: 1, commoner: 2, artisan: 3, merchant: 3, clergy: 4, gentry: 5, noble: 6, royal: 7 };
  const headOf = new Map<number, PersonRow>();
  for (const r of rows) if (r.home !== null && (!headOf.has(r.home) || (RANK[r.cls] ?? 2) > (RANK[headOf.get(r.home)!.cls] ?? 2))) headOf.set(r.home, r);
  for (const r0 of rows) {
    if (r0.home === null || r0.home >= map.buildings.length || done.has(r0.home) || r0.master_id) continue;
    const r = headOf.get(r0.home)!;
    if (r.master_id) continue;
    const home = r0.home;
    const b = map.buildings[home]!;
    if (b.kind !== "house") continue;
    const low = r.cls === "commoner" || r.cls === "serf" || r.cls === "slave";
    const high = r.cls === "gentry" || r.cls === "noble";
    const misfit = (low && CLOSED.has(b.district ?? "")) || (high && !["d:noble", "d:high_street", "d:castle", "d:palace", "d:manor", "d:green", "d:street"].includes(b.district ?? ""));
    if (!misfit) continue;
    const want = `d:${homeDistrict(dlist, r.cls as SocialClass, r.job)}`;
    const byRoom = (a: { i: number }, c: { i: number }) => (occupancy.get(a.i) ?? 0) - (occupancy.get(c.i) ?? 0) || a.i - c.i;
    const houses = map.buildings.map((x, i) => ({ x, i })).filter((o) => o.x.kind === "house");
    // The district their class puts them in; failing a house there, any house outside the closed quarters (or, for the high-born, in them).
    const free = houses.filter((o) => o.x.district === want).sort(byRoom)[0] ?? houses.filter((o) => (low ? !CLOSED.has(o.x.district ?? "") : CLOSED.has(o.x.district ?? "") || o.x.district === "d:high_street")).sort(byRoom)[0];
    if (!free) continue;
    const from = home;
    done.add(from);
    for (const m of rows.filter((x) => x.home === from && x.death === null)) {
      store.people.update(m.id, { home: free.i });
      occupancy.set(free.i, (occupancy.get(free.i) ?? 0) + 1);
      moved++;
    }
    recordLifeEvent(realm, store, { kind: "moved", actor: r.id, site, day, details: `${r.name}'s household moved to ${dlist.find((d) => d.id === want)?.name ?? "another part of town"}`, importance: 2 });
  }
  if (moved > 0) tally(realm, "rehoused", moved);
  return moved;
}
