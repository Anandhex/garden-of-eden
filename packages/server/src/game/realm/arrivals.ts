import { itemKey } from "../items.js";
import type { SpawnRule, Who } from "../spawning.js";
import { siteState, type SiteWorld } from "../site.js";
import type { NpcPersona, NpcState, WorldSnapshot } from "../../npc/types.js";
import type { Arrival, Realm } from "./types.js";

/**
 * What the realm sends to a place's own map (N13.5, N25a decision 8): raiders by night, beasts out of the woods,
 * refugees on the road, a grain caravan at the inn. The realm queues them for the place they are aimed at,
 * whichever place that is, and the place applies them when the player is there: on its map while they are due,
 * or as aftermath (a raid day, a line of news) when the player comes back after they are over.
 */

/** Most arrivals kept waiting for one place. */
export const MAX_QUEUED = 8;
/** Days a done or missed arrival is kept. */
export const KEEP_DAYS = 14;

export interface Talking {
  id: string;
  persona: NpcPersona;
  state: NpcState;
}

/** Queue something for a place. */
export function sendArrival(realm: Realm, site: string, a: Omit<Arrival, "done">): void {
  const queue = ((realm.arrivals ??= {})[site] ??= []);
  queue.push({ ...a });
  if (queue.length > MAX_QUEUED) queue.splice(0, queue.length - MAX_QUEUED);
}

/** Forget what is long past, and places with nothing waiting. */
export function pruneArrivals(realm: Realm, day: number): void {
  for (const [site, queue] of Object.entries(realm.arrivals ?? {})) {
    const keep = queue.filter((a) => day - a.day <= KEEP_DAYS);
    if (keep.length === 0) delete realm.arrivals[site];
    else realm.arrivals[site] = keep;
  }
}

/** Days an arrival stays on the map after the day it came. */
const WINDOW: Record<Arrival["kind"], number> = { raid: 1, beasts: 1, refugees: 2, war_levy: 0, caravan: 0 };

/**
 * Apply what is waiting for a place, once each. Due ones happen on its map (spawn rules, stock); ones whose time
 * has passed leave their aftermath. Returns lines for the player.
 */
export function applyArrivals(
  realm: Realm,
  world: WorldSnapshot & SiteWorld,
  site: string,
  folk: Talking[],
  creatureKinds: string[],
  /** Real people of a place to fill a raid that came from it (N26F step 0b): its fighting-age rows. Without it, only named figures come. */
  pick: (from: string, n: number, seed: string, kind?: "people" | "beasts") => Who[] = () => [],
): string[] {
  const lines: string[] = [];
  const state = siteState(world, site);
  const queue = realm.arrivals?.[site];
  if (!queue) return lines;
  for (const e of queue) {
    if (e.done) continue;
    e.done = true;
    const over = world.day > e.day + WINDOW[e.kind];
    const rules: SpawnRule[] = [];
    if (e.kind === "raid") {
      if (over) {
        state.lastRaidDay = Math.max(state.lastRaidDay ?? -1, e.day);
        lines.push(`Raiders from ${e.by} came through ${world.day - e.day} day(s) ago.`);
      } else if (creatureKinds.includes("bandit")) {
        // The raiders are the people who went: the named fighters, and the rest from the place they came from.
        const want = Math.max(1, Math.min(5, e.count));
        const named: Who[] = (e.who ?? []).map((id) => realm.figures[id]).filter((f) => !!f && f.alive && !f.talks).slice(0, want).map((f) => ({ name: f!.name, figure: f!.id }));
        const rest = e.from && named.length < want ? pick(e.from, want - named.length, `raid:${e.day}:${site}`) : [];
        const who = [...named, ...rest];
        if (who.length > 0) {
          rules.push({ id: `realm_raid_${e.day}_${realm.next++}`, creature: "bandit", count: who.length, who, place: "gate_road", hours: [20, 4], untilDay: e.day + 1 });
          lines.push(`Raiders from ${e.by} are on the road tonight: ${who.slice(0, 3).map((w) => w.name).join(", ")}${who.length > 3 ? " and others" : ""}.`);
        } else lines.push(`Raiders from ${e.by} came by night and were gone by morning.`);
      }
    } else if (e.kind === "beasts" && !over) {
      const kind = creatureKinds.includes(e.by) ? e.by : "wolf";
      // The pack's own beasts, by row where the rows are kept.
      const who = e.from ? pick(e.from, Math.max(1, Math.min(4, e.count)), `beasts:${e.day}:${site}`, "beasts") : [];
      if (creatureKinds.includes(kind)) rules.push({ id: `realm_beasts_${e.day}_${realm.next++}`, creature: kind, count: Math.max(1, Math.min(4, e.count)), place: "woods_edge", hours: [19, 5], untilDay: e.day + 1, ...(who.length > 0 ? { who } : {}) });
      lines.push(`${e.by === "wolf" ? "Wolves" : "Beasts"} have been seen at the edge of the woods.`);
    } else if (e.kind === "refugees" && !over) {
      // The refugees themselves are rows on a journey (N26 Part E): they walk in on the road and live here now. Nobody is made up for the gate.
      lines.push(`Folk from ${e.by} have come up the road with their bundles.`);
    } else if (e.kind === "caravan") {
      const baker = folk.find((m) => m.state.outcome !== "dead" && !m.state.dormant && m.persona.prices["bread loaf"] !== undefined);
      if (baker) {
        const k = itemKey("bread loaf");
        baker.state.inventory[k] = (baker.state.inventory[k] ?? 0) + 4;
        lines.push(`A grain caravan from ${e.by} stopped at ${baker.persona.name}'s.`);
      }
    }
    if (rules.length > 0) state.rules.push(...rules);
  }
  realm.arrivals[site] = queue.filter((e) => !e.done || world.day - e.day <= 10);
  return lines;
}
