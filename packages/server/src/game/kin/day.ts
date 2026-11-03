import type { PersonRow } from "../../store/peopleStore.js";
import { config } from "../../config.js";
import { ageFrom } from "../people/rules.js";
import type { LifeCtx, SiteStep } from "../people/step.js";
import { speciesOf } from "../../world/species.js";
import { affairsDay } from "./affairs.js";
import { arrangeDay } from "./arranged.js";
import { disputesDay, type Dispute } from "./disputes.js";
import { lawAt, makeWill, willOf } from "./estate.js";
import { feudsDay, inheritGrudges } from "./feuds.js";

/**
 * A place's families on a day (N45), after its careers (N40) have passed on what the dead held: wills are made, disputes over estates are
 * decided, grudges are handed down and feuds flare or end, affairs begin, are seen and end marriages, and families arrange matches.
 */
export interface KinDay {
  disputes: Dispute[];
  feudEvents: string[];
  affairEvents: string[];
  matches: Array<[string, string]>;
  passed: number;
}

export function kinSiteDay(ctx: LifeCtx, step: SiteStep, day: number): KinDay {
  const out: KinDay = { disputes: [], feudEvents: [], affairEvents: [], matches: [], passed: 0 };
  if (!config.society.feuds) return out;
  const { realm, store } = ctx;
  const site = step.site;
  // Wills: under a `chosen` law, those with a shop or land make one as they become elders.
  if (lawAt(realm, site, day) === "chosen" && day % 12 === 0) {
    for (const r of store.people.loadSite(site, "full") as PersonRow[]) {
      if (r.death !== null || willOf(r) || (r.shop === null && !store.careers.openJobs(r.id).some((j) => j.job.startsWith("land:")))) continue;
      if (ageFrom(r.born_day, day) >= speciesOf(r.species).elderAge) makeWill(store, realm, r, day);
    }
  }
  out.disputes = disputesDay(ctx, site, day, (_from, to, d) => moveShop(ctx, to, d, day));
  out.passed = inheritGrudges(ctx, step, day);
  out.matches = arrangeDay(ctx, step, day);
  out.feudEvents = feudsDay(ctx, step, day);
  out.affairEvents = affairsDay(ctx, step, day);
  return out;
}

/** A disputed shop goes to the claimant who won it: the lawful heir gives it up. */
function moveShop(ctx: LifeCtx, to: PersonRow, d: Dispute, day: number): void {
  const { store } = ctx;
  const trade = d.data.part.startsWith("shop:") ? d.data.part.slice(5) : null;
  if (!trade) return;
  const from = store.people.get(d.data.lawful);
  if (!from) return;
  const job = `shop:${to.site}:${trade}`;
  store.careers.endJob(from.id, job, day);
  store.people.update(from.id, { shop: null, work: from.work?.startsWith("front:") ? null : from.work });
  store.careers.startJob(to.id, job, to.site, day);
  store.people.update(to.id, { shop: d.data.lot ?? from.shop, work: `front:${d.data.lot ?? from.shop}`, master_id: null, master: null });
}
