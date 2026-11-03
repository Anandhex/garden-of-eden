import type { PersonRow } from "../../store/peopleStore.js";
import { adjustRel } from "../chatter/rel.js";
import { rankOf } from "../chatter/person.js";
import { unitFor } from "../dice.js";
import { learn } from "../gossip/knowledge.js";
import { eventRef } from "../gossip/refs.js";
import { recordLifeEvent } from "../people/events.js";
import { ageFrom, ageGapTooWide, canCourtAt, closeKin } from "../people/rules.js";
import type { LifeCtx, SiteStep } from "../people/step.js";
import { policyAt } from "../realm/policy.js";
import { familyOf, feudBetween } from "./feuds.js";

/**
 * Arranged marriages (N45 decision 7). Where the kingdom's `marriage_by` law is `family`, a parent who wants a good match for a grown child
 * (N40's `good_match` ambition) looks for one every MATCH_EVERY days: unmarried, of an age, not kin, scored by rank above the family, a shop
 * or land in the household, and (a classic) being of a family at feud with theirs, which ends the feud. The child's own feelings still count:
 * an unwilling match cools them to the parent, and an unhappy marriage is where affairs begin (affairs.ts).
 */
export const MATCH_EVERY = 4;

/** How a household stands: rank, and a shop or land of its own. */
function worth(ctx: LifeCtx, r: PersonRow): number {
  const held = ctx.store.careers.openJobs(r.id);
  return rankOf(r) + (r.shop !== null ? 1 : 0) + (held.some((j) => j.job.startsWith("land:")) ? 0.7 : 0);
}

export function arrangeDay(ctx: LifeCtx, step: Pick<SiteStep, "site" | "marriages">, day: number): Array<[string, string]> {
  const { realm, store } = ctx;
  const site = step.site;
  if (day % MATCH_EVERY !== 0 || policyAt(realm, site, "marriage_by", day) !== "family") return [];
  const rows = (store.people.loadSite(site, "full") as PersonRow[]).filter((r) => r.death === null && !r.away && !r.captive);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const parentsOf = (id: string) => {
    const r = store.people.get(id);
    return r ? [r.mother, r.father].filter((x): x is string => !!x) : [];
  };
  const made: Array<[string, string]> = [];
  const taken = new Set<string>();
  for (const parent of rows) {
    const amb = store.careers.ambitionOf(parent.id);
    if (amb?.kind !== "good_match" || !amb.target) continue;
    const child = byId.get(amb.target);
    if (!child || child.spouse || taken.has(child.id) || !canCourtAt(child.species, ageFrom(child.born_day, day))) continue;
    const ownFam = familyOf(child);
    const pool = rows.filter((x) => x.gender !== child.gender && !x.spouse && !taken.has(x.id) && x.job !== "child" && x.cls !== "slave" && canCourtAt(x.species, ageFrom(x.born_day, day)) && !ageGapTooWide(ageFrom(x.born_day, day), ageFrom(child.born_day, day)) && !closeKin(parentsOf, x.id, child.id, 2));
    let best: { x: PersonRow; s: number; why: string } | null = null;
    for (const x of pool) {
      const up = worth(ctx, x) - worth(ctx, child);
      const feud = feudBetween(ctx, ownFam, familyOf(x));
      const s = up + (feud ? 1.2 : 0) + 0.6 * unitFor(realm.seed, "match-pick", parent.id, x.id, day);
      if (up < 0 && !feud) continue;
      if (!best || s > best.s) best = { x, s, why: feud ? `to end the feud between the ${ownFam.split(":")[1]}s and the ${familyOf(x).split(":")[1]}s` : `a match above the family` };
    }
    if (!best || best.s < 0.6) continue;
    const other = best.x;
    const [husband, wife] = child.gender === "male" ? [child, other] : [other, child];
    store.people.update(husband.id, { spouse: wife.id });
    store.people.update(wife.id, { spouse: husband.id, home: husband.home });
    taken.add(child.id).add(other.id);
    made.push([husband.id, wife.id]);
    // The child's say: an unwilling match cools them to the parent (and makes the marriage a cold one to begin with).
    const willing = unitFor(realm.seed, "willing", child.id, day) < 0.55;
    if (!willing) {
      adjustRel(store, child.id, parent.id, { affection: -18 }, day);
      adjustRel(store, child.id, other.id, { affection: -10 }, day);
    }
    const e = recordLifeEvent(realm, store, {
      kind: "arranged-match",
      actor: parent.id,
      target: child.id,
      site,
      day,
      key: `${husband.id}+${wife.id}`,
      details: `${parent.name} married ${child.name} to ${other.name}${willing ? "" : `, though ${child.name} was unwilling`}`,
      importance: 4,
      why: best.why,
      witnesses: [child.id, other.id],
    });
    for (const w of [parent.id, child.id, other.id]) learn(ctx, w, eventRef(e.id), { day, source: "saw", accuracy: 1 });
    // A wedding between feuding families ends their feud (feuds.ts reads today's marriages).
    step.marriages?.push([husband.id, wife.id]);
  }
  return made;
}
