import type { PersonRow } from "../../store/peopleStore.js";
import type { LifeCtx, SiteStep } from "../people/step.js";
import { handOnDrops, isKin, knowItem, moveItem } from "./notable.js";

/**
 * What the day's dead held (N43 decision 4, with N45's inheritance to come): a notable item goes to the one who killed them when that was
 * a realm figure (looted), else to their kin (inherited, and the household knows it), else it lies where they died.
 */
export function inheritDay(ctx: LifeCtx, step: Pick<SiteStep, "site" | "deaths">, day: number): void {
  if (step.deaths.length === 0) return;
  const { realm, store } = ctx;
  for (const d of step.deaths) {
    const held = store.notables.heldBy(d.id);
    if (held.length === 0) continue;
    const killer = d.record.killer ? realm.figures[d.record.killer] : undefined;
    const dead = store.people.get(d.id);
    for (const it of held) {
      if (killer?.alive) {
        moveItem(store, it.id, killer.id, "looted", day, { name: killer.name, from: d.name, ...(d.record.site ? { site: d.record.site } : {}) });
        killer.items = [...new Set([...(killer.items ?? []), it.id])];
        // The watch of their place learns what was taken from them (N7's crime, N48 later): stolen goods give a thief away.
        if (dead) knowItem(ctx, it.id, (store.people.loadSite(dead.site, "full") as PersonRow[]).filter((r) => r.job === "guard" && r.death === null).map((r) => r.id), day, 0.9, "told");
        continue;
      }
      const kin = dead ? heirOf(store.people.loadSite(dead.site, "full") as PersonRow[], dead, (a, b) => isKin(store, a, b)) : undefined;
      if (kin) {
        moveItem(store, it.id, kin.id, "inherited", day, { name: kin.name, from: d.name, site: kin.site });
        knowItem(ctx, it.id, (store.people.loadSite(kin.site, "full") as PersonRow[]).filter((r) => r.home === kin.home && r.death === null).map((r) => r.id), day);
      } else moveItem(store, it.id, d.record.site ? `site:${d.record.site}` : null, "lost", day, { how: `left where ${d.name} died`, ...(d.record.site ? { site: d.record.site } : {}) });
    }
  }
}

/** Who inherits: a living spouse, then a grown child, then anyone of the household. */
function heirOf(rows: PersonRow[], dead: PersonRow, kin: (a: string, b: string) => boolean): PersonRow | undefined {
  const living = rows.filter((r) => r.death === null && r.id !== dead.id);
  return living.find((r) => r.id === dead.spouse) ?? living.find((r) => (r.mother === dead.id || r.father === dead.id) && r.job !== "child") ?? living.find((r) => kin(dead.id, r.id) && r.job !== "child");
}

export { handOnDrops };
