import type { WorldStore } from "../db.js";
import type { Realm } from "../realm/types.js";
import { lifeStats } from "./report.js";

/**
 * N25's balance bounds: numbers a realm of living people must stay inside after its first year. Started from the
 * rates `npm run sim:lives` measured (births 25-40 and deaths 15-25 per 1,000 a year, children 30-45%), with room
 * for wars and famines. N22's long-run tests read this list; so does the test in tests/n25.test.ts.
 */
export interface Bound {
  name: string;
  ok: boolean;
  detail: string;
}

export function checkLifeBounds(realm: Realm, store: WorldStore): Bound[] {
  const s = lifeStats(store, realm.day);
  const within = (n: number, lo: number, hi: number) => n >= lo && n <= hi;
  const living = Object.values(realm.settlements).filter((x) => !x.abandoned).reduce((a, x) => a + x.population, 0);
  const rows = store.dumpTable("people").filter((r) => r.death === null && !realm.settlements[String(r.site)]?.abandoned).length;
  const capitals = Object.values(realm.settlements).filter((x) => x.kind === "capital");
  return [
    { name: "births-and-deaths", ok: within(s.birthRate, 10, 60) && within(s.deathRate, 5, 60), detail: `births ${s.birthRate}, deaths ${s.deathRate} per 1,000` },
    { name: "age-pyramid", ok: within(s.pyramid.children, 0.1, 0.55) && within(s.pyramid.adults, 0.35, 0.8) && within(s.pyramid.elders, 0.03, 0.25), detail: `children ${s.pyramid.children.toFixed(2)}, adults ${s.pyramid.adults.toFixed(2)}, elders ${s.pyramid.elders.toFixed(2)}` },
    { name: "marriage-rate", ok: s.courting === 0 || within(s.married / s.courting, 0.4, 0.95), detail: `${s.married} of ${s.courting} married` },
    { name: "count-matches-population", ok: living === rows, detail: `settlements say ${living}, the roster holds ${rows}` },
    { name: "no-empty-capitals", ok: capitals.every((c) => c.population >= 500), detail: capitals.map((c) => `${c.name} ${c.population}`).join(", ") },
  ];
}
