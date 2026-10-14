import type { Journey } from "@millbrook/shared";
import type { PersonRow } from "../../store/peopleStore.js";
import { seedFrom, streamFor } from "../dice.js";
import type { LifeCtx } from "../people/step.js";
import { ageFrom } from "../people/rules.js";
import { learn, retell, tellables } from "./knowledge.js";
import { newsRef } from "./refs.js";
import { tellOne } from "./spread.js";
import { sociability } from "./venues.js";

/**
 * News enters a place with a person, and only the people who met them know (N33, refining N26 Part E from places to people). At every
 * stop of a journey (game/road/exchange.ts) the party talks with a few of the place's people, the ones at the inn that evening, in the
 * market or on the street: each side tells the other the best two things it doesn't have, in its own version. What the party knows is
 * what its members know: they hold what the place knew when they set out (`journey.carries`, which is place-level) as their own
 * and anything they heard on the way, so a caravan driver tells what *he* heard. A crown courier (a figure, no row of their own) cries
 * the news to the first few who gather.
 */
export const MEET_MAX = 4;
/** Party members who do the talking at a stop (a caravan's whole crew need not all speak). */
export const SPEAKERS_MAX = 3;
/** Things each side tells the other. */
export const TOLD_EACH = 2;
/** The people who hear a crown courier cry the news in a place. */
export const CRIER_AUDIENCE = 4;
/** How far a stranger's word is believed. */
export const STRANGER_CREDENCE = 0.85;

/** The people of the party who are rows of the table and alive (crown couriers, who are figures, carry only what the place gave them). */
function partyRows(ctx: LifeCtx, j: Journey): PersonRow[] {
  const out: PersonRow[] = [];
  for (const t of j.party) {
    if (ctx.realm.figures[t.person]) continue;
    const row = ctx.store.people.get(t.person);
    if (row && row.death === null) out.push(row);
  }
  return out;
}

/** The party talks with the people of the place. Returns how many things changed hands. */
export function meetAtStop(ctx: LifeCtx, j: Journey, site: string, minute: number, day: number): number {
  const party = partyRows(ctx, j);
  const { store } = ctx;
  let moved = 0;
  store.knowledge.transaction(() => {
    // The party holds what it carries as its own: the member it is given to is picked by the news, so it is the same every time.
    for (const c of party.length > 0 ? (j.carries ?? []) : []) {
      if (!ctx.realm.news.some((n) => n.id === c.id)) continue;
      const holder = party[seedFrom(c.id) % party.length]!;
      if (!store.knowledge.has(holder.id, newsRef(c.id))) learn(ctx, holder.id, newsRef(c.id), { day, source: `carrier:${j.id}`, accuracy: 0.9 });
    }
    const rows = (store.people.loadSite(site, "full") as PersonRow[]).filter((r) => !r.away && ageFrom(r.born_day, day) >= 16 && !party.some((p) => p.id === r.id));
    if (rows.length === 0) return;
    const rng = streamFor(ctx.realm.seed, "gossip-meet", site, j.id, minute);
    // Who they happen to talk to: a handful at random, the most sociable first.
    const sample: PersonRow[] = [];
    const pool = [...rows];
    for (let i = 0; i < Math.min(MEET_MAX * 2, pool.length); i++) {
      const at = i + Math.floor(rng() * (pool.length - i));
      [pool[i], pool[at]] = [pool[at]!, pool[i]!];
      sample.push(pool[i]!);
    }
    const met = sample.sort((a, b) => sociability(b.id) - sociability(a.id) || (a.id < b.id ? -1 : 1)).slice(0, MEET_MAX);
    // A crown courier is a figure with no row of their own: they cry the news (the people who gather are the first to know it).
    if (party.length === 0) {
      for (const c of j.carries ?? []) {
        if (c.from === site || !ctx.realm.news.some((n) => n.id === c.id)) continue;
        for (const m of met.slice(0, CRIER_AUDIENCE)) if (learn(ctx, m.id, newsRef(c.id), { day, source: `carrier:${j.id}`, accuracy: 0.9 })) moved++;
      }
      return;
    }
    // The place learned what the party carries (game/road/exchange.ts), and the people who met them are how: the news the party brought here
    // is told to someone of the place, whatever else is talked of.
    if (met.length > 0) {
      for (const c of j.carries ?? []) {
        if (c.from === site) continue;
        const holder = party[seedFrom(c.id) % party.length]!;
        const row = store.knowledge.get(holder.id, newsRef(c.id));
        const m = met[seedFrom(`${c.id}:${site}`) % met.length]!;
        const version = row ? retell(ctx, row, m.id, day, STRANGER_CREDENCE, rng) : null;
        if (row && version && learn(ctx, m.id, row.ref, { day, source: holder.id, ...version })) moved++;
      }
    }
    const speakers = party.slice(0, SPEAKERS_MAX);
    for (const [i, m] of met.entries()) {
      const p = speakers[i % speakers.length]!;
      // Each tells the other: the stranger's news first (it is news), then the place's.
      const theirs = tellables(ctx, p.id, day, site);
      const ours = tellables(ctx, m.id, day, p.site);
      for (let k = 0; k < TOLD_EACH; k++) {
        if (tellOne(ctx, p.id, m.id, theirs, day, STRANGER_CREDENCE, rng, true)) moved++;
        if (tellOne(ctx, m.id, p.id, ours, day, STRANGER_CREDENCE, rng, true)) moved++;
      }
    }
  });
  return moved;
}
