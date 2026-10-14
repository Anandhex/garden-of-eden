import type { PersonRow } from "../../store/peopleStore.js";
import { streamFor } from "../dice.js";
import type { LifeCtx, SiteStep } from "../people/step.js";
import { learn } from "./knowledge.js";
import { deathRef, newsRef } from "./refs.js";

/**
 * Where a thing is first known (N33): the people it happened to or in front of. Everyone else hears it from them, or from a traveller
 * who brings it from somewhere else (meet.ts). Nothing here makes news arrive from away.
 *
 * - **A death** is known at once to the family, the household and the people they worked with, and (a few) to the neighbours.
 * - **News that happened here** (the realm's record says the place heard it with no one to tell it: `heard[site][id]` from nowhere)
 *   is seen by a share of the people (at most LOCAL_MAX), on the day or the next one if nobody here knows it yet.
 */
export const LOCAL_SHARE = 0.1;
export const LOCAL_MAX = 12;
export const NEIGHBOURS = 0.04;
export const WORKMATES = 6;
export const NEIGHBOURS_MAX = 10;

/** News below this weight isn't something people take in. */
export const SEEN_IMPORTANCE = 4;

export function seedDay(ctx: LifeCtx, step: SiteStep, day: number): void {
  const { realm, store } = ctx;
  const site = step.site;
  // Nothing to take in on most days: the place had no deaths at home and nothing happened in it.
  const heard = realm.heard[site];
  // What happened here today, or last night after the place's day was done (a deed of the player's, say): not yet known to anyone here.
  const fresh = heard ? Object.keys(heard).filter((id) => heard[id]![1] === "" && heard[id]![0] >= day - 1 && heard[id]![0] <= day && (heard[id]![0] === day || !store.knowledge.knownAt(newsRef(id), site))) : [];
  const deaths = step.deaths.filter((p) => p.record.site === site);
  if (fresh.length === 0 && deaths.length === 0) return;
  const here = store.people.loadSite(site, "full") as PersonRow[];
  if (here.length === 0) return;
  const present = new Set(here.filter((r) => !r.away).map((r) => r.id));
  store.knowledge.transaction(() => {
    for (const p of deaths) {
      const dead = store.people.get(p.id);
      if (!dead) continue;
      const rng = streamFor(realm.seed, "gossip-seed", site, day, deathRef(p.id));
      const near = new Set<string>();
      for (const id of [dead.spouse, dead.mother, dead.father]) if (id) near.add(id);
      let work = 0;
      for (const r of here) {
        if (r.id === p.id || r.away) continue;
        if (r.mother === p.id || r.father === p.id) near.add(r.id);
        if (dead.home !== null && r.home === dead.home) near.add(r.id);
        else if (dead.work && r.work === dead.work && work < WORKMATES) {
          near.add(r.id);
          work++;
        }
      }
      // A few neighbours hear at once (a share of a small place, never more than NEIGHBOURS_MAX).
      const others = here.filter((r) => !r.away && !near.has(r.id));
      const heardAt = Math.min(NEIGHBOURS_MAX, Math.round(others.length * NEIGHBOURS));
      for (let i = 0; i < heardAt; i++) {
        const j = i + Math.floor(rng() * (others.length - i));
        [others[i], others[j]] = [others[j]!, others[i]!];
        near.add(others[i]!.id);
      }
      for (const id of [...near].sort()) if (present.has(id)) learn(ctx, id, deathRef(p.id), { day, source: "saw", accuracy: 1 });
    }
    for (const id of fresh.sort()) {
      const n = realm.news.find((x) => x.id === id);
      if (!n || n.importance < SEEN_IMPORTANCE) continue;
      const rng = streamFor(realm.seed, "gossip-seed", site, day, newsRef(id));
      const folk = here.filter((r) => !r.away);
      const take = Math.min(LOCAL_MAX, Math.max(1, Math.round(folk.length * LOCAL_SHARE)));
      // A partial shuffle: the first `take` of a stream's draw.
      const pool = folk.map((r) => r.id);
      for (let i = 0; i < Math.min(take, pool.length); i++) {
        const j = i + Math.floor(rng() * (pool.length - i));
        [pool[i], pool[j]] = [pool[j]!, pool[i]!];
        learn(ctx, pool[i]!, newsRef(id), { day, source: "saw", accuracy: 1 });
      }
    }
  });
}
