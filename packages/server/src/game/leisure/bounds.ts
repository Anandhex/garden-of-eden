import type { Realm } from "../realm/types.js";
import { leisureOf } from "./events.js";

/**
 * N41's balance bounds: cheats are caught sometimes (not never, not always), and tournaments rarely kill. Read from the realm's tallies
 * and leisure log at the end of a long run (`npm run sim:years`).
 */
export function checkLeisureBounds(realm: Realm): Array<{ name: string; ok: boolean; detail: string }> {
  const tried = realm.stats.cheats_tried ?? 0;
  const caught = realm.stats.cheats_caught ?? 0;
  const tourneys = leisureOf(realm).log.filter((r) => r.kind === "tournament");
  const deaths = tourneys.reduce((a, r) => a + r.deaths.length, 0);
  return [
    { name: "cheats-caught", ok: tried < 10 || (caught > 0 && caught < tried), detail: `${caught} of ${tried} cheats caught` },
    { name: "tournament-deaths-rare", ok: tourneys.length === 0 || deaths / tourneys.length <= 1.5, detail: `${deaths} died in ${tourneys.length} tournaments on record` },
  ];
}
