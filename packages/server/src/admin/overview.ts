import type { AdminClock, AdminMapLayer, AdminOverview, ClassCounts } from "@millbrook/shared";
import { ongoing } from "../game/realm/diplomacy.js";
import type { Party, Realm } from "../game/realm/types.js";
import { describeRealm, realmView } from "../game/realm/view.js";
import type { AdminContext } from "./context.js";
import { classCounts } from "./folk.js";

/** Settlements whose class counts are worked out per request: a capital's roster is thousands of people. */
const CLASSES_PER_REQUEST = 3;

export function clockOf(ctx: AdminContext): AdminClock {
  const w = ctx.world();
  return { day: w.day, hour: w.hour, minute: w.minute ?? 0, paused: ctx.time?.paused() ?? false };
}

/** Where a party sits on the map: a kingdom's capital, a settlement, a faction's seat, a person's home. */
function seatOf(realm: Realm, p: Party): { x: number; y: number } | null {
  const id = p.slice(2);
  const settlement = p[0] === "k" ? realm.settlements[realm.kingdoms[id]?.capital ?? ""] : p[0] === "s" ? realm.settlements[id] : p[0] === "f" ? realm.settlements[realm.factions[id]?.seat ?? ""] : realm.settlements[realm.figures[id]?.home ?? ""];
  return settlement ? { ...settlement.pos } : null;
}

/** What the map shows besides the places: packs, war fronts, and (from N26) caravans. */
export function mapLayer(realm: Realm): AdminMapLayer {
  const packs = Object.values(realm.packs)
    .filter((p) => p.count > 0 && realm.settlements[p.near])
    .map((p) => ({ id: p.id, species: p.species, count: p.count, near: p.near, x: realm.settlements[p.near]!.pos.x, y: realm.settlements[p.near]!.pos.y }));
  const fronts = ongoing(realm).flatMap((w) => {
    const from = seatOf(realm, w.attackers[0]!);
    const to = seatOf(realm, w.defenders[0]!);
    return from && to ? [{ attackers: w.attackers.join(" & "), defenders: w.defenders.join(" & "), cause: w.cause, score: w.score, from, to }] : [];
  });
  return { packs, fronts, caravans: [], missing: ["caravans on the road (from N26)", "armies in the field (from N55)"] };
}

/** The whole realm as it is: the map, the numbers, the people by class where worked out. */
export function overview(ctx: AdminContext): AdminOverview {
  const world = ctx.world();
  const realm = world.realm;
  const clock = clockOf(ctx);
  if (!realm) {
    return { clock, realm: null, layer: { packs: [], fronts: [], caravans: [], missing: [] }, totals: { kingdoms: 0, settlements: 0, population: 0, figuresAlive: 0, figuresDead: 0, factions: 0, wars: 0, treaties: 0 }, classes: {}, classesPending: 0, summary: ["This world has no realm (REALM=off)."] };
  }
  const classes: Record<string, ClassCounts> = {};
  let pending = 0;
  let worked = 0;
  // Smaller places first: they are cheap, so the table fills quickly; the capitals come last.
  const order = Object.values(realm.settlements).filter((s) => !s.abandoned).sort((a, b) => Number(b.id === world.player.site) - Number(a.id === world.player.site) || a.population - b.population);
  for (const s of order) {
    const hit = classCounts(ctx, s.id, true);
    if (hit) classes[s.id] = hit;
    else if (worked < CLASSES_PER_REQUEST) {
      worked++;
      const c = classCounts(ctx, s.id);
      if (c) classes[s.id] = c;
    } else pending++;
  }
  const figures = Object.values(realm.figures);
  const settlements = Object.values(realm.settlements);
  return {
    clock,
    realm: realmView(realm),
    layer: mapLayer(realm),
    totals: {
      kingdoms: Object.keys(realm.kingdoms).length,
      settlements: settlements.length,
      population: settlements.reduce((a, s) => a + s.population, 0),
      figuresAlive: figures.filter((f) => f.alive).length,
      figuresDead: figures.filter((f) => !f.alive).length,
      factions: Object.values(realm.factions).filter((f) => !f.dissolved).length,
      wars: ongoing(realm).length,
      treaties: realm.treaties.filter((t) => !t.broken && t.until >= realm.day).length,
    },
    classes,
    classesPending: pending,
    summary: describeRealm(realm),
  };
}
