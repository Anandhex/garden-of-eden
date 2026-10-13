import type { WorldSnapshot } from "../npc/types.js";
import { marketOffsetOf } from "./events-calendar.js";
import type { Creature } from "./creatures.js";
import type { SpawnLedger, SpawnRule } from "./spawning.js";

/**
 * What a place keeps about its own day (N25a decision 3). Every settlement is a site with the same state and the
 * same systems; the only special place is the one the player is in, and only for detail: it runs hour by hour,
 * and every other place is caught up when the player arrives (`Town.activate`).
 */
export interface SiteState {
  /** The beasts, outlaws and crowd on its maps, by uid (what stockHaunts and the spawn rules put there). */
  creatures: Record<string, Creature>;
  /** Which creatures each of its spawn rules has out. */
  spawns: SpawnLedger;
  /** Spawn rules made in play here (the director's, hired ambushes, quests' quarry), and the ones the realm's state generated. */
  rules: SpawnRule[];
  /** The day of its last raid (the town calendar's raid day). */
  lastRaidDay?: number;
  /** Today's news as lore ids: what folk here talk about. */
  recentEvents: string[];
  /** Day each of those arrived, so they can expire. */
  newsDays: Record<string, number>;
  /** Realm news already delivered here (its own news clock: each place hears after the days a traveller takes). */
  newsSeen: string[];
  /** The last day the nightly chronicle ran for here. */
  chronicleDay?: number;
  /** The absolute hour the player last left it, until they come back. */
  lastActive?: number;
  /** It has been the player's place at some time (so "You're back in...", and its notables exist). */
  visited?: boolean;
  /** Days before a need is posted again, by need: when it was last posted here. */
  needCooldowns: Record<string, number>;
}

export const newSite = (): SiteState => ({ creatures: {}, spawns: {}, rules: [], recentEvents: [], newsDays: {}, newsSeen: [], needCooldowns: {} });

/** A world that keeps sites (a saved one). */
export interface SiteWorld {
  sites?: Record<string, SiteState>;
  startSite?: string;
  player: { site?: string };
}

/** Where the player is: their site, or the start site of a world that has not set one yet. */
export function siteIdOf(world: SiteWorld): string {
  const site = world.player.site ?? world.startSite;
  if (!site) throw new Error("This world has no site: the player has none and nothing set a start site.");
  return site;
}

/** A place's state, made on first use with its defaults. */
export function siteState(world: SiteWorld, site: string = siteIdOf(world)): SiteState {
  const sites = (world.sites ??= {});
  return (sites[site] ??= newSite());
}

/** A place's state without making one (the admin view only looks). */
export function peekSite(world: SiteWorld, site: string): SiteState | undefined {
  return world.sites?.[site];
}

/** The creatures where the player is. */
export const creaturesOf = (world: SiteWorld, site: string = siteIdOf(world)): Record<string, Creature> => siteState(world, site).creatures;

type Bound = Pick<WorldSnapshot, "recentEvents" | "lastRaidDay" | "newsDays" | "chronicleDay" | "extraSpawnRules"> & { spawns?: SpawnLedger };

/**
 * The fields the rest of the game reads off the world as "today in town" (`recentEvents`, `lastRaidDay`, `newsDays`,
 * `chronicleDay`, `extraSpawnRules`, `spawns`) are the player's site's own. They are defined on a saved world as
 * properties that forward to `sites[player.site]`, so moving the player moves them, nothing is copied back and
 * forth, and a place keeps its own. (Enumerable, so a spread of the world is a snapshot of them; the save strips them.)
 */
export const BOUND_FIELDS = ["recentEvents", "lastRaidDay", "newsDays", "chronicleDay", "extraSpawnRules", "spawns"] as const;

export function bindActiveSite<T extends SiteWorld>(world: T): T & Bound {
  const here = () => siteState(world);
  const prop = (get: () => unknown, set: (v: never) => void) => ({ get, set, enumerable: true, configurable: true });
  Object.defineProperties(world, {
    recentEvents: prop(() => here().recentEvents, (v: string[]) => void (here().recentEvents = v)),
    lastRaidDay: prop(() => here().lastRaidDay, (v: number | undefined) => void (here().lastRaidDay = v)),
    newsDays: prop(() => here().newsDays, (v: Record<string, number>) => void (here().newsDays = v)),
    chronicleDay: prop(() => here().chronicleDay, (v: number | undefined) => void (here().chronicleDay = v)),
    extraSpawnRules: prop(() => here().rules, (v: SpawnRule[]) => void (here().rules = v)),
    spawns: prop(() => here().spawns, (v: SpawnLedger) => void (here().spawns = v)),
  });
  // Not saved, not hashed: where in the week the player's place keeps its market.
  Object.defineProperty(world, "marketOffset", { get: () => marketOffsetOf(siteIdOf(world)), enumerable: false, configurable: true });
  return world as T & Bound;
}

/** Every creature in the world with the place it belongs to (reading only: it makes no site). */
export function allCreatures(world: Pick<SiteWorld, "sites">): Array<{ site: string; creature: Creature }> {
  return Object.entries(world.sites ?? {}).flatMap(([site, s]) => Object.values(s.creatures).map((creature) => ({ site, creature })));
}

/** A creature by uid, wherever it is (reading only). */
export function findCreature(world: Pick<SiteWorld, "sites">, uid: string): { site: string; creature: Creature } | undefined {
  for (const [site, s] of Object.entries(world.sites ?? {})) {
    const creature = s.creatures[uid];
    if (creature) return { site, creature };
  }
  return undefined;
}
