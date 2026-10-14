import type { AdminJourney, AdminNewsChain, AdminRoads } from "@millbrook/shared";
import { isOnTheRoad, partyAt, placeAt, unitsOf, type Journey } from "@millbrook/shared";
import { newsChain } from "../game/road/exchange.js";
import { roadDataOf } from "../game/road/generateRoads.js";
import { describeJourney, journeyOf, journeysOf, lineOf } from "../game/road/journeys.js";
import { visitorsAt } from "../game/road/presence.js";
import type { PersonRow } from "../store/peopleStore.js";
import { parseAway } from "../store/peopleStore.js";
import type { AdminContext } from "./context.js";

/**
 * The roads, for the admin view (N26 Part E decision 9): every journey with its party (each a person of the table, clickable), where it is,
 * what it carries; where one person is; and the chain of who carried a piece of news where. Reads only.
 */

const minuteNow = (ctx: AdminContext) => {
  const w = ctx.world();
  return (w.day - 1) * 1440 + w.hour * 60 + (w.minute ?? 0);
};

function whereWords(ctx: AdminContext, j: Journey, minute: number): { where: string; state: string } {
  const realm = ctx.world().realm!;
  const name = (id: string | null) => (id ? (realm.settlements[id]?.name ?? id) : "the road");
  const p = placeAt(j, minute);
  switch (p.state) {
    case "waiting":
      return { where: `about to set out from ${name(j.path[0]!)}`, state: p.state };
    case "walking":
      return { where: `on the road, ${j.turn && minute > j.turn.leave ? "heading home" : `bound for ${name(j.turn?.site ?? j.path.at(-1)!)}`}`, state: p.state };
    case "resting":
      return { where: realm.settlements[p.site ?? ""]?.way ? `resting at the inn at ${name(p.site)}` : `at ${name(p.site)}`, state: p.state };
    case "ended":
      return { where: `stopped: ${j.ended?.why ?? "turned back"}`, state: p.state };
    default:
      return { where: `arrived at ${name(p.site)}`, state: p.state };
  }
}

export function journeyView(ctx: AdminContext, j: Journey, minute = minuteNow(ctx)): AdminJourney {
  const realm = ctx.world().realm!;
  const data = roadDataOf(realm);
  const name = (id: string) => realm.settlements[id]?.name ?? id;
  const lead = partyAt(j, lineOf(data, j), minute)[0] ?? { x: 0, y: 0 };
  const { where, state } = whereWords(ctx, j, minute);
  return {
    id: j.id,
    kind: j.kind,
    text: describeJourney(j, name),
    where,
    from: name(j.path[0]!),
    to: name(j.turn?.site ?? j.path.at(-1)!),
    depart: j.depart,
    arrive: j.arrive,
    x: unitsOf(lead.x),
    y: unitsOf(lead.y),
    state,
    carries: (j.carries ?? []).map((c) => ({ news: c.id, text: realm.news.find((n) => n.id === c.id)?.text ?? c.id, from: name(c.from) })),
    party: j.party.map((t) => ({ ref: `town:${t.person}`, name: t.name, role: t.role })),
    ...(j.cargo ? { cargo: j.cargo } : {}),
  };
}

/** Every journey that is not over, with what is on the road now counted by kind. */
export function roadsOf(ctx: AdminContext): AdminRoads {
  const world = ctx.world();
  const realm = world.realm;
  if (!realm) return { day: world.day, journeys: [], onTheRoad: {} };
  const minute = minuteNow(ctx);
  const onTheRoad: Record<string, number> = {};
  const journeys = journeysOf(realm).filter((j) => !j.closed).map((j) => {
    if (isOnTheRoad(j, minute)) onTheRoad[j.kind] = (onTheRoad[j.kind] ?? 0) + 1;
    return journeyView(ctx, j, minute);
  });
  return { day: world.day, journeys, onTheRoad };
}

/** The journey of a person who is away, as a view (null if they are at home). */
export function journeyOfPerson(ctx: AdminContext, row: PersonRow): AdminJourney | null {
  const realm = ctx.world().realm;
  const away = parseAway(row.away);
  const j = realm && away ? journeyOf(realm, away.journey) : undefined;
  return j ? journeyView(ctx, j) : null;
}

/** Who of a place is away, and who is visiting it now. */
export function awayAndVisiting(ctx: AdminContext, site: string): { away: Array<{ row: PersonRow; journey: AdminJourney }>; visiting: Array<{ row: PersonRow; journey: AdminJourney }> } {
  const realm = ctx.world().realm;
  const store = ctx.store;
  if (!realm || !store) return { away: [], visiting: [] };
  const away = store.people.awayRows().filter((r) => r.site === site).map((row) => ({ row, journey: journeyOfPerson(ctx, row) })).filter((x): x is { row: PersonRow; journey: AdminJourney } => !!x.journey);
  const visiting = visitorsAt(store.people, realm, site, minuteNow(ctx)).filter((v) => !v.home).map((v) => ({ row: v.row, journey: journeyOfPerson(ctx, v.row) })).filter((x): x is { row: PersonRow; journey: AdminJourney } => !!x.journey);
  return { away, visiting };
}

/** Who carried a piece of news to a place, and how it got there. */
export function newsChainOf(ctx: AdminContext, newsId: string, site: string): AdminNewsChain | null {
  const realm = ctx.world().realm;
  const n = realm?.news.find((x) => x.id === newsId);
  if (!realm || !n) return null;
  const name = (id: string) => realm.settlements[id]?.name ?? id;
  const steps = newsChain(realm, newsId, site).map((s) => {
    const j = s.via ? journeyOf(realm, s.via) : undefined;
    return { site: s.site, name: name(s.site), day: s.day, via: s.via, viaText: j ? describeJourney(j, name) : s.via ? "a journey since forgotten" : null };
  });
  return { news: newsId, text: n.text, steps };
}
