import { buildTimeline, cumulative, isOnTheRoad, partyAt, pointAt, positionAt, type Journey } from "@millbrook/shared";
import { recordEvent } from "../events.js";
import { itemKey } from "../items.js";
import { playerPower } from "../realm/wilds.js";
import { realmNews, tally } from "../realm/log.js";
import { fightOnRoad } from "../realm/travel.js";
import type { Town } from "../town.js";
import { tickNeeds } from "./needs.js";
import { landOf } from "./ground.js";
import { describeJourney, journeysOf, lineOf } from "./journeys.js";
import { threatsOf } from "./threats.js";
import { streamFor } from "../dice.js";
import { weatherOn } from "../weather.js";
import { formatMoney } from "../money.js";

/**
 * What the player can do with a caravan on the road (N26 B3): travel with it, or rob it. Helping is a situation (a broken
 * cart); trading is ordinary (the merchant is a talker who sells). Joining is safer: the guards fight beside you, and
 * the days pass at the caravan's pace. Robbing is a crime and an event with consequences: the goods it carried never
 * arrive, the news travels the roads, and the one robbed remembers.
 */

/** How near a member of the party the player must be. */
const REACH = 6;

function nearParty(town: Town, id: string): { j: Journey; lead: { x: number; y: number } } | null {
  const realm = town.world.realm;
  const road = town.world.player.road;
  const j = journeysOf(town.world).find((x) => x.id === id);
  if (!realm || !road || !j) return null;
  const m = town.road.minute();
  if (!isOnTheRoad(j, m)) return null;
  const data = landOf(realm).data;
  const lead = partyAt(j, lineOf(data, j), m).find((p) => Math.hypot(p.x - road.x, p.y - road.y) <= REACH);
  return lead ? { j, lead } : null;
}

/** The player's strength against a party's. */
const partyPower = (j: Journey) => (j.guards ?? 0) * 9 + j.party.length * 3;

/** Go along with a party to where it is going: safer, and at its pace. */
export function travelWith(town: Town, journeyId: string): { ok: boolean; lines: string[] } {
  const world = town.world;
  const realm = world.realm!;
  const p = world.player;
  const near = nearParty(town, journeyId);
  if (!near) return { ok: false, lines: ["They're out of reach."] };
  const { j } = near;
  if (!["caravan", "pilgrims", "adventurers", "patrol", "migrants", "refugees"].includes(j.kind)) return { ok: false, lines: ["They're not going to wait for you."] };
  if (p.road!.pending) return { ok: false, lines: ["Deal with what's in front of you first."] };
  const data = landOf(realm).data;
  const line = lineOf(data, j);
  const m = town.road.minute();
  const here = positionAt(j, line, m);
  const dest = j.path.at(-1)!;
  const total = line.length;
  const remaining = total - here.d;
  const lines = [`You fall in with ${describeJourney(j, (id) => realm.settlements[id]?.name ?? id)}.`];
  // The ambushes and hunting grounds on the stretch: the party's guards fight beside you.
  const rng = streamFor(world.seed, "with", j.id, world.day);
  const power = (j.guards ?? 0) * 9;
  for (const t of threatsOf(realm, data)) {
    const pr = line.pts.reduce((best, q, i) => (Math.hypot(q.x - t.at.x, q.y - t.at.y) < best.d ? { d: Math.hypot(q.x - t.at.x, q.y - t.at.y), i } : best), { d: Infinity, i: 0 });
    if (pr.d > t.range + 15 || line.cum[pr.i]! < here.d) continue;
    const id = t.id.slice(t.id.indexOf(":") + 1);
    const foe = t.kind === "pack" ? realm.packs[id] : realm.factions[id];
    if (!foe || (t.kind === "pack" && (foe as (typeof realm.packs)[string]).count < (foe as (typeof realm.packs)[string]).cap * 0.6)) continue;
    if (rng() < 0.5) continue;
    lines.push(...fightOnRoad(realm, p, { name: t.kind === "pack" ? `beasts near ${realm.settlements[t.near]?.name ?? "the road"}` : "outlaws at a bend in the road", power: t.kind === "pack" ? 14 : 18, tier: "E", kind: t.kind, id }, realm.settlements[t.near]?.name ?? "the road", world.day, rng, town.companionPower() + power));
  }
  // The days go by at the party's pace; the player is fed from the party's pot.
  const arrive = j.arrive;
  const minutes = Math.max(1, Math.round(arrive - m));
  lines.push(...tickNeeds(p, Math.round(minutes * 0.4), m, { weather: weatherOn(world.day) }), ...tickNeeds(p, Math.round(minutes * 0.6), m, { resting: true }));
  if (p.roadNeeds) {
    p.roadNeeds.food = Math.max(p.roadNeeds.food, 45);
    p.roadNeeds.water = Math.max(p.roadNeeds.water, 45);
  }
  town.walkMinutes(minutes);
  lines.push(`${Math.round(remaining)} tiles of road later, you come to ${realm.settlements[dest]?.name ?? "the end of the road"} together.`);
  lines.push(...town.arriveAt(dest));
  void buildTimeline;
  void cumulative;
  void pointAt;
  return { ok: true, lines };
}

/** Rob a caravan: fight for its cargo. */
export function robCaravan(town: Town, journeyId: string): { ok: boolean; lines: string[] } {
  const world = town.world;
  const realm = world.realm!;
  const p = world.player;
  const near = nearParty(town, journeyId);
  if (!near || near.j.kind !== "caravan" || !near.j.cargo) return { ok: false, lines: ["There's nothing here to rob."] };
  const { j } = near;
  const cargo = j.cargo!;
  if (j.ended) return { ok: false, lines: ["It has been robbed already."] };
  const from = realm.settlements[j.path[0]!]?.name ?? "somewhere";
  const to = realm.settlements[j.path.at(-1)!]?.name ?? "somewhere";
  const rng = town.actionRng();
  const ours = playerPower(p) + town.companionPower();
  const theirs = partyPower(j);
  const lines = [`You stand in the road and demand the cargo of ${describeJourney(j, (id) => realm.settlements[id]?.name ?? id)}.`];
  const m = town.road.minute();
  const master = j.party[0]!;
  if (rng() < ours / (ours + theirs)) {
    for (const [item, qty] of Object.entries(cargo)) p.inventory[itemKey(item)] = (p.inventory[itemKey(item)] ?? 0) + qty;
    j.ended = { minute: m, why: `robbed by ${p.name}` };
    lines.push(`Their guards break and run. You take ${Object.entries(cargo).map(([k, v]) => `${v} ${k}`).join(" and ")}.`);
    p.reputation = { trust: -6 + (p.reputation?.trust ?? 0), fear: 6 + (p.reputation?.fear ?? 0), respect: p.reputation?.respect ?? 0, affection: -4 + (p.reputation?.affection ?? 0) };
    p.crimes = [...(p.crimes ?? []), { id: `c-${j.id}`, kind: "theft", victim: master.name, victimName: master.name, day: world.day, event: "", fine: 300 }];
    p.bounty = (p.bounty ?? 0) + 300;
    const ev = recordEvent(world as never, { kind: "road", actor: "player", target: master.name, details: `${p.name} robbed ${master.name}'s caravan between ${from} and ${to}`, importance: 6, why: "a caravan was stopped on the road", witnesses: [] });
    // What it means: the goods never arrive, the news goes out along the roads, the merchants of the place lose a little.
    const origin = realm.settlements[j.path[0]!];
    if (origin) origin.prosperity = Math.max(0, origin.prosperity - 1);
    tally(realm, "caravans_robbed");
    realmNews(realm, world.day, j.path[0]!, "road", `${master.name}'s caravan from ${from} was robbed on the road to ${to}.`, 5, [master.name, from, to], { why: `robbed by ${p.name}` });
    void ev;
  } else {
    const hurt = Math.ceil(p.maxHp * 0.35);
    p.hp = Math.max(1, p.hp - hurt);
    const taken = Math.floor(p.money * 0.25);
    p.money -= taken;
    lines.push(`The guards beat you off (−${hurt} HP)${taken > 0 ? ` and take ${formatMoney(taken)} for your trouble` : ""}.`);
  }
  return { ok: true, lines };
}
