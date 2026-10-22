import { credenceOf } from "../chatter/rel.js";
import { streamFor } from "../dice.js";
import type { LifeCtx } from "../people/step.js";
import { CREDENCE, hoursOf, LISTENERS, openAt, sociability, venuesOf, type VenueKind } from "./venues.js";
import { interestIn, learn, retell, tellable, tellables } from "./knowledge.js";
import { placeOfRef } from "./refs.js";
import type { PersonRow } from "../../store/peopleStore.js";

/**
 * Gossip among a place's people (N33). For each venue, everyone who knows something (and feels like talking) tells it to a few others
 * of the venue: the most worth-telling thing the listener does not already have, a little less accurate and now and then changed in
 * one detail. A day's talk is O(the people who know things), not O(pairs): a place where nobody knows anything costs one pass over
 * its people.
 *
 * Run once a day, or hour by hour (the place the player is in: only the venues open that hour, each at its share of the day's talk).
 * `share` scales it: the player's place does half its talk in the day's step (so it still talks while the player is on the road) and
 * half by the hour as the player watches.
 * Every roll comes from a stream named by place, day, venue and hour, in a fixed order, so working it out later gives the same result.
 */
export const ACQUAINTANCES = 60;
/** Most people who tell something in one venue in one day (an hour of it: its share). */
export const SPEAKERS_PER_VENUE: Record<VenueKind, number> = { household: 2, work: 4, inn: 24, market: 24, temple: 24 };
/** How much a listener cares for news of another place. */
export const FAR_CARE = 0.35;

export interface SpreadResult {
  told: number;
  speakers: number;
}

export function spreadSite(ctx: LifeCtx, site: string, day: number, opts: { hour?: number; share?: number; onTold?: (e: Told) => void } = {}): SpreadResult {
  const out: SpreadResult = { told: 0, speakers: 0 };
  const { store } = ctx;
  const rows = store.people.loadSite(site, "full") as PersonRow[];
  const knowers = store.knowledge.knowers();
  if (rows.length < 2 || !rows.some((r) => knowers.has(r.id))) return out;
  // How many people one person can know by name and care about.
  const familiar = Math.min(1, ACQUAINTANCES / rows.length);
  store.knowledge.transaction(() => {
    for (const venue of venuesOf(ctx, site, rows, day)) {
      if (opts.hour !== undefined && !openAt(venue.kind, opts.hour)) continue;
      const rng = streamFor(ctx.realm.seed, "gossip", site, day, venue.key, opts.hour ?? "day");
      const share = (opts.share ?? 1) * (opts.hour === undefined ? 1 : 1 / hoursOf(venue.kind));
      const cred = CREDENCE[venue.kind];
      // In a crowd only so many get to talk in a day: a big place's spread is slower, and costs no more than a small one's.
      let talkers = venue.members.filter((id) => knowers.has(id));
      const most = SPEAKERS_PER_VENUE[venue.kind];
      if (talkers.length > most) {
        for (let i = 0; i < most; i++) {
          const at = i + Math.floor(rng() * (talkers.length - i));
          [talkers[i], talkers[at]] = [talkers[at]!, talkers[i]!];
        }
        talkers = talkers.slice(0, most);
      }
      for (const speaker of talkers) {
        if (rng() >= sociability(speaker)) continue;
        // By the hour most speakers have nobody to tell yet: no need to look at what they know.
        const want = LISTENERS[venue.kind] * share;
        const n = Math.floor(want) + (rng() < want - Math.floor(want) ? 1 : 0);
        if (n === 0) continue;
        const items = tellables(ctx, speaker, day, site);
        if (items.length === 0) continue;
        out.speakers++;
        for (let i = 0; i < n; i++) {
          let listener = venue.members[Math.floor(rng() * venue.members.length)]!;
          if (listener === speaker) listener = venue.members[(venue.members.indexOf(speaker) + 1) % venue.members.length]!;
          const told = tellOne(ctx, speaker, listener, items, day, credenceOf(store, listener, speaker, day, cred), rng, false, familiar, site);
          if (told) {
            out.told++;
            opts.onTold?.({ speaker, listener, ref: told, venue: venue.kind });
          }
        }
      }
    }
  });
  return out;
}

export interface Told {
  speaker: string;
  listener: string;
  ref: string;
  venue: VenueKind;
}

/** The speaker tells the listener the best thing they do not have. Returns what was told, or null. */
export function tellOne(ctx: LifeCtx, speaker: string, listener: string, items: ReturnType<typeof tellables>, day: number, credence: number, rng: () => number, eager = false, familiar = 1, site = ""): string | null {
  const k = ctx.store.knowledge;
  for (const item of items) {
    const had = k.get(listener, item.ref);
    if (had && had.accuracy >= item.accuracy) continue;
    // A listener may shrug off a small matter (a stranger's news is always worth hearing).
    // Someone else's death matters to those who knew them, which in a big town is few: people know about as many as they can keep in mind.
    // News of somewhere else is only so interesting to people who will never go there.
    const care = item.ref.startsWith("d:") ? familiar : item.ref.startsWith("n:") && placeOfRef(ctx, item.ref) !== site ? FAR_CARE : 1;
    if (!eager && rng() >= interestIn(tellable(ctx, item, day)) * care) continue;
    const version = retell(ctx, item, listener, day, credence, rng);
    if (!version) continue;
    if (!learn(ctx, listener, item.ref, { day, source: speaker, accuracy: version.accuracy, variant: version.variant })) continue;
    return item.ref;
  }
  return null;
}
