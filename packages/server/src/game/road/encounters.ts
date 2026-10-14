import { type Journey, type RoadData } from "@millbrook/shared";
import type { WorldStore } from "../db.js";
import { streamFor } from "../dice.js";
import { killPerson } from "../people/index.js";
import { gangFoe, packFoe } from "../realm/travel.js";
import { realmNews, tally } from "../realm/log.js";
import type { Realm } from "../realm/types.js";
import { dayStartMinute, journeysOf, lineOf } from "./journeys.js";
import { threatsOf, type Threat } from "./threats.js";

/**
 * Off-screen meetings on the road (N26 Part E decision 7). A journey that passes a gang's ambush or a hungry pack's ground may meet it,
 * with or without the player there. Resolved in code on the day the journey sets out, weighted by the party's size and guards, the
 * threat's strength, and any patrol on the same road: a robbery (the cargo never arrives, the gang is richer, the clerk's coin goes
 * to the gang), people hurt or killed on real rows, or the party turning back. Each is news at the place they came from.
 */

/** Chance a party that passes a threat's ground meets it. */
export const MEET_CHANCE = 0.3;

const partyPower = (j: Journey) => (j.guards ?? 0) * 9 + j.party.length * 3;

/** The minute a journey is `d` tiles along its line. */
function minuteAt(j: Journey, d: number): number {
  const leg = j.timeline.find((l) => l.d1 > l.d0 && d <= l.d1 + 1e-6) ?? j.timeline.at(-1);
  if (!leg || leg.d1 === leg.d0) return j.depart;
  return Math.round(leg.t0 + ((Math.max(leg.d0, d) - leg.d0) / (leg.d1 - leg.d0)) * (leg.t1 - leg.t0));
}

/** How far along its line a journey comes closest to a threat, and whether that is within range (null if not). */
function passes(data: RoadData, j: Journey, t: Threat): number | null {
  const line = lineOf(data, j);
  let best = Infinity;
  let at = 0;
  for (let i = 0; i < line.pts.length; i++) {
    const q = line.pts[i]!;
    if (Math.abs(q.x - t.at.x) > t.range || Math.abs(q.y - t.at.y) > t.range) continue;
    const d = Math.hypot(q.x - t.at.x, q.y - t.at.y);
    if (d < best) {
      best = d;
      at = line.cum[i]!;
    }
  }
  return best <= t.range ? at : null;
}

/** The journeys that set out today meet what waits on their roads. Returns how many encounters there were. */
export function encountersDay(realm: Realm, store: WorldStore, data: RoadData, day: number, ensure: (site: string) => void = () => {}): number {
  const lo = dayStartMinute(day);
  const threats = threatsOf(realm, data);
  if (threats.length === 0) return 0;
  const today = journeysOf(realm).filter((j) => !j.closed && !j.ended && j.depart >= lo && j.depart < lo + 1440);
  const patrols = today.concat(journeysOf(realm).filter((j) => j.kind === "patrol" && !j.closed && j.depart < lo + 1440 && j.arrive >= lo));
  let n = 0;
  for (const j of today) {
    if (j.kind === "adventurers") continue;
    for (const t of threats) {
      const d = passes(data, j, t);
      if (d === null) continue;
      const rng = streamFor(realm.seed, "encounter", j.id, t.id);
      if (rng() >= MEET_CHANCE) continue;
      const id = t.id.slice(t.id.indexOf(":") + 1);
      const gang = t.kind === "gang" ? realm.factions[id] : undefined;
      const pack = t.kind === "pack" ? realm.packs[id] : undefined;
      if ((t.kind === "gang" && (!gang || gang.dissolved !== undefined || gang.members.length === 0)) || (t.kind === "pack" && (!pack || pack.count < pack.cap * 0.6))) continue;
      const foe = gang ? gangFoe(realm, gang) : packFoe(realm, pack!);
      // A patrol on the same road the same day fights beside them.
      const escort = patrols.filter((p) => p !== j && p.kind === "patrol" && p.roads.some((r) => j.roads.some((x) => x.id === r.id))).reduce((a, p) => a + partyPower(p), 0);
      const ours = partyPower(j) + escort;
      n++;
      resolveEncounter(realm, store, j, t, foe.name, foe.power, ours, escort > 0, minuteAt(j, d), day, rng, ensure);
    }
  }
  return n;
}

function resolveEncounter(realm: Realm, store: WorldStore, j: Journey, t: Threat, foeName: string, theirs: number, ours: number, escorted: boolean, minute: number, day: number, rng: () => number, ensure: (site: string) => void): void {
  const from = realm.settlements[j.path[0]!];
  const lead = j.party[0]?.name ?? "someone";
  const kind = j.kind === "caravan" ? `${lead}'s caravan` : `${lead} and ${j.party.length - 1} other${j.party.length === 2 ? "" : "s"}`;
  const where = realm.settlements[t.near]?.name ?? "the road";
  if (rng() < ours / (ours + theirs)) {
    tally(realm, "road_ambush_beaten");
    if (escorted) realmNews(realm, day, j.path[0]!, "road", `A patrol and ${kind} of ${from?.name ?? "the road"} drove off ${foeName} near ${where}.`, 3, [foeName, where]);
    return;
  }
  tally(realm, "road_ambush_lost");
  const gang = t.kind === "gang" ? realm.factions[t.id.slice(t.id.indexOf(":") + 1)] : undefined;
  // The cargo never arrives, and the clerk's coin goes to the gang.
  let loot = 0;
  if (j.cargo) loot += Object.values(j.cargo).reduce((a, q) => a + q * 4, 0);
  for (const c of realm.transit.filter((x) => x.journey === j.id)) loot += c.amount;
  realm.transit = realm.transit.filter((x) => x.journey !== j.id);
  if (gang) gang.wealth += loot;
  const robbed = gang !== undefined && (!!j.cargo || loot > 0);
  // Real people hurt: some die, on their own rows.
  const dead: string[] = [];
  for (const m of j.party) {
    if (rng() >= (robbed ? 0.12 : 0.25) * Math.min(1.5, theirs / Math.max(1, ours) + 0.4)) continue;
    const hour = Math.floor((minute % 1440) / 60);
    const home = store.people.get(m.person)?.site;
    if (home) ensure(home);
    if (killPerson(realm, store, m.person, { cause: t.kind === "gang" ? "murder" : "beast", day, hour, killer: t.id.slice(t.id.indexOf(":") + 1), note: `killed by ${foeName} on the road near ${where}`, site: null })) dead.push(m.name);
  }
  j.ended = { minute, why: robbed ? `robbed by ${foeName}` : `driven back by ${foeName}` };
  const text = robbed
    ? `${kind} of ${from?.name ?? "the road"} was robbed by ${foeName} near ${where}${dead.length > 0 ? `; ${dead.join(" and ")} died` : ""}.`
    : `${kind} of ${from?.name ?? "the road"} met ${foeName} near ${where} and turned back${dead.length > 0 ? `; ${dead.join(" and ")} died` : ""}.`;
  realmNews(realm, day, j.path[0]!, "road", text, dead.length > 0 || robbed ? 5 : 3, [foeName, where, ...dead], { why: `${t.kind === "gang" ? "ambushed" : "attacked"} on the road` });
}
