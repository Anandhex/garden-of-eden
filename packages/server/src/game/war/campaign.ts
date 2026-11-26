import { config } from "../../config.js";
import { realmNews } from "../realm/log.js";
import type { Party, Realm, Settlement, War } from "../realm/types.js";
import { seasonOf } from "../weather.js";
import { peekArmies, type Army } from "./armies.js";

/**
 * N55 steps 2 and 6: armies on the map. An army musters at its party's seat, then **marches** toward the war's front at an army's pace,
 * camping each night where it stopped; it **eats** a day's supply and draws more from its own places it passes (their stores fall), or
 * **forages** in enemy land (their stores and goodwill fall), or goes hungry (morale falls). An attacker that reaches walled ground
 * **besieges** it: the place eats from its stores with nothing coming in, and a place starved below the mark gives in. Battles (warsDay)
 * wait for the attacker to arrive, and each side's army fights as well as its morale and food let it. A kingdom's weariness rises with its
 * dead and the levies it has taken, not only with each battle.
 *
 * All on `realm.society.armies` (each army's `camp`), from the realm's own numbers: no dice, so a seed gives the same campaign.
 */
export const PACE = 45;
/** Days of food an army can carry. */
export const SUPPLY_MAX = 12;
/** An army that hasn't reached the front after this many days of marching is taken to be there (a war never stalls on a long road). */
export const MARCH_LIMIT = 18;
/** A besieged place's stores, below which it gives in. */
export const STARVED = 12;

export interface Camp {
  pos: { x: number; y: number };
  muster: string;
  target: string | null;
  /** Days of food in the wagons. */
  supply: number;
  morale: number;
  marchDays: number;
  arrived: boolean;
  siege?: { site: string; since: number };
  /** The last day's doings, for the admin and the news. */
  last?: string;
  /** Soldiers lost, for weariness: counted from the war's battles' losses on this side. */
  counted?: number;
}

const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

/** Where a party's army musters: its kingdom's capital, its settlement, or its faction's seat. */
function musterOf(realm: Realm, p: Party): Settlement | undefined {
  if (p.startsWith("k:")) return realm.settlements[realm.kingdoms[p.slice(2)]?.capital ?? ""];
  if (p.startsWith("s:")) return realm.settlements[p.slice(2)];
  const seat = realm.factions[p.slice(2)]?.seat;
  return seat ? realm.settlements[seat] : undefined;
}

const campOf = (a: Army): Camp | undefined => (a as Army & { camp?: Camp }).camp;

/** The places that answer to a party (for supply: an army eats from its own). */
function isOwn(realm: Realm, p: Party, s: Settlement): boolean {
  if (p.startsWith("k:")) return s.kingdom === p.slice(2);
  if (p.startsWith("s:")) return s.id === p.slice(2);
  return false;
}

/** One day of every army in the field: marching, camping, eating, besieging. `front` gives each war's battlefield. */
export function campaignDay(realm: Realm, day: number, front: (w: War) => Settlement | null): void {
  if (!config.society.armies) return;
  const winter = seasonOf(day) === "winter";
  for (const a of peekArmies(realm)) {
    if (a.status === "disbanded") continue;
    const w = realm.wars.find((x) => x.id === a.war);
    if (!w || w.end !== undefined) continue;
    const home = musterOf(realm, a.party);
    if (!home) continue;
    const c = ((a as Army & { camp?: Camp }).camp ??= { pos: { ...home.pos }, muster: home.id, target: null, supply: SUPPLY_MAX, morale: 70, marchDays: 0, arrived: false });
    if (a.status === "mustering") {
      c.last = `mustering at ${home.name}`;
      continue;
    }
    const field = front(w);
    c.target = field?.id ?? null;
    // ---- March ----
    if (field && !c.arrived) {
      const d = dist(c.pos, field.pos);
      const step = PACE * (winter ? 0.6 : 1);
      if (d <= step || c.marchDays >= MARCH_LIMIT) {
        c.pos = { ...field.pos };
        c.arrived = true;
        realmNews(realm, day, field.id, "war", `The army of ${partyName(realm, a.party)} has reached ${field.name}${a.side === "attackers" ? " and made camp before it" : " to hold it"}.`, 5, [field.name], { why: `${c.marchDays} days on the march` });
      } else {
        c.pos = { x: Math.round(c.pos.x + ((field.pos.x - c.pos.x) * step) / d), y: Math.round(c.pos.y + ((field.pos.y - c.pos.y) * step) / d) };
        c.marchDays++;
        c.last = `marching on ${field.name}, camped ${Math.round(d - step)} away`;
      }
    }
    // ---- Supply ----
    c.supply = Math.max(0, c.supply - 1);
    const near = Object.values(realm.settlements)
      .filter((s) => !s.way && !s.abandoned && !s.fallen && dist(s.pos, c.pos) <= 80)
      .sort((x, y) => dist(x.pos, c.pos) - dist(y.pos, c.pos) || x.id.localeCompare(y.id));
    const own = near.find((s) => isOwn(realm, a.party, s) && s.food > 35);
    const enemy = near.find((s) => !isOwn(realm, a.party, s) && s.food > 20 && [...w.attackers, ...w.defenders].some((p) => p !== a.party && isOwn(realm, p, s)) && !(a.side === "attackers" ? w.attackers : w.defenders).some((p) => isOwn(realm, p, s)));
    if (c.supply < SUPPLY_MAX && own) {
      const take = Math.min(SUPPLY_MAX - c.supply, 3);
      own.food = Math.max(0, own.food - take * 0.8);
      c.supply += take;
      c.last = `${c.last ?? "camped"}; drew stores from ${own.name}`;
    } else if (c.supply < SUPPLY_MAX && enemy && !winter) {
      enemy.food = Math.max(0, enemy.food - 3);
      enemy.prosperity = Math.max(0, enemy.prosperity - 1);
      c.supply += 2;
      c.last = `${c.last ?? "camped"}; foraged about ${enemy.name}`;
    }
    // ---- Morale: fed and winning, or hungry and beaten ----
    const lastBattle = w.battles.filter((b) => b.day === day - 1).pop();
    if (lastBattle) c.morale += lastBattle.winner === a.side ? 10 : -15;
    if (c.supply <= 0) {
      c.morale -= 6;
      if (day % 3 === 0) realmNews(realm, day, c.target, "war", `The army of ${partyName(realm, a.party)} is hungry: its wagons are empty.`, 4, [], { why: "no stores to draw on" });
    } else c.morale += c.morale < 70 ? 2 : 0;
    c.morale = Math.max(5, Math.min(100, c.morale));
    // ---- Siege ----
    if (a.side === "attackers" && c.arrived && field && (field.buildings.walls ?? 0) >= 1) {
      if (!c.siege || c.siege.site !== field.id) {
        c.siege = { site: field.id, since: day };
        a.status = "fighting";
        realmNews(realm, day, field.id, "siege", `${field.name} is under siege by ${partyName(realm, a.party)}.`, 7, [field.name], { why: "its walls are too strong to take by storm at once" });
      }
      // Nothing comes in: the place eats from its stores.
      field.food = Math.max(0, field.food - 2);
      c.last = `besieging ${field.name} (day ${day - c.siege.since + 1})`;
    } else if (c.siege && (!field || field.id !== c.siege.site)) delete c.siege;
  }
  weariness(realm, day);
}

/** Has the attacking side's army reached the field? (warsDay waits for it.) True where no army is kept for the war. */
export function attackerReady(realm: Realm, w: War): boolean {
  if (!config.society.armies) return true;
  const mine = peekArmies(realm).filter((a) => a.war === w.id && a.side === "attackers" && a.status !== "disbanded");
  if (mine.length === 0) return true;
  return mine.some((a) => campOf(a)?.arrived);
}

/** How well a side's army fights today: morale and food (1 is a fed army in good heart; a starving, beaten one about half). */
export function sideMod(realm: Realm, w: War, side: "attackers" | "defenders"): number {
  if (!config.society.armies) return 1;
  const camps = peekArmies(realm).filter((a) => a.war === w.id && a.side === side && a.status !== "disbanded").map(campOf).filter((c): c is Camp => !!c);
  if (camps.length === 0) return 1;
  const m = camps.reduce((s, c) => s + (0.5 + (0.5 * c.morale) / 70) * (c.supply > 0 ? 1 : 0.7), 0) / camps.length;
  return Math.max(0.4, Math.min(1.25, m));
}

/** A besieged place that has eaten its stores gives in: the siege's end, for warsDay to take it. */
export function starvedOut(realm: Realm, w: War): Settlement | null {
  if (!config.society.armies) return null;
  for (const a of peekArmies(realm).filter((x) => x.war === w.id && x.side === "attackers" && x.status !== "disbanded")) {
    const c = campOf(a);
    const s = c?.siege ? realm.settlements[c.siege.site] : undefined;
    if (s && s.food < STARVED) return s;
  }
  return null;
}

/** Weariness from what a war really costs (N55 decision 7): each kingdom's battle dead and the levies taken, as a share of its people. */
function weariness(realm: Realm, day: number): void {
  void day;
  for (const a of peekArmies(realm)) {
    if (!a.party.startsWith("k:") || a.status === "disbanded") continue;
    const k = realm.kingdoms[a.party.slice(2)];
    const w = realm.wars.find((x) => x.id === a.war);
    const c = campOf(a);
    if (!k || !w || !c) continue;
    const people = Object.values(realm.settlements).filter((s) => s.kingdom === k.id && !s.way).reduce((x, s) => x + s.population, 0) || 1;
    // Half of each battle's losses were this side's (warsDay doesn't split them by side in the battle record).
    const lost = Math.round(w.battles.reduce((x, b) => x + b.losses, 0) / 2);
    const fresh = lost - (c.counted ?? 0);
    if (fresh > 0) {
      k.weariness = Math.min(100, k.weariness + (fresh / people) * 400);
      c.counted = lost;
    }
  }
}

function partyName(realm: Realm, p: Party): string {
  if (p.startsWith("k:")) return realm.kingdoms[p.slice(2)]?.name ?? p;
  if (p.startsWith("s:")) return realm.settlements[p.slice(2)]?.name ?? p;
  return realm.factions[p.slice(2)]?.name ?? p;
}

export const campOfArmy = campOf;
