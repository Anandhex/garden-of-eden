import type { AdminHealth } from "@millbrook/shared";
import { ongoing } from "../game/realm/diplomacy.js";
import { describeRealm } from "../game/realm/view.js";
import { snapshot } from "../metrics/timing.js";
import type { AdminContext } from "./context.js";
import { clockOf } from "./overview.js";

/** Tick timings, counts and the numbers `npm run sim:realm` prints, so tuning can be done live (N17). */
export function health(ctx: AdminContext): AdminHealth {
  const world = ctx.world();
  const realm = world.realm;
  const town = ctx.town();
  const agents = Object.values(town.agents);
  const counts: Record<string, number> = {
    fights: agents.filter((a) => a.state.inCombat && !a.isDead).length,
    queue: ctx.queueLength(),
    cast: town.ids.length,
    castAlive: agents.filter((a) => !a.isDead && !a.state.dormant).length,
    creatures: Object.values(world.creatures).filter((c) => c.outcome === null).length,
    eventsInSave: (world.events ?? []).length,
    eventsInDatabase: ctx.store?.eventCount() ?? 0,
    eventsToday: (world.events ?? []).filter((e) => e.day === world.day).length,
    peopleInDatabase: ctx.store?.people.count() ?? 0,
    peopleUnsaved: ctx.store?.people.pending ?? 0,
  };
  if (realm) {
    counts.kingdoms = Object.keys(realm.kingdoms).length;
    counts.settlements = Object.keys(realm.settlements).length;
    counts.population = Object.values(realm.settlements).reduce((a, s) => a + s.population, 0);
    counts.figuresAlive = Object.values(realm.figures).filter((f) => f.alive).length;
    counts.factions = Object.values(realm.factions).filter((f) => !f.dissolved).length;
    counts.wars = ongoing(realm).length;
    counts.newsToday = realm.news.filter((n) => n.day === realm.day).length;
  }
  return { clock: clockOf(ctx), tickMs: snapshot(), counts, stats: { ...(realm?.stats ?? {}) }, summary: realm ? describeRealm(realm) : [] };
}
