import { WALK_PACE, type RoadData } from "@millbrook/shared";
import type { PeopleStore, PersonRow } from "../../store/peopleStore.js";
import { streamFor } from "../dice.js";
import { sink, transfer } from "../realm/ledger.js";
import { realmNews, tally } from "../realm/log.js";
import type { Realm, Settlement } from "../realm/types.js";
import { ageOn } from "../realm/who.js";
import { workPlacesOf } from "./commute.js";
import { departureOn, journeysOf, launch } from "./journeys.js";
import { shortest } from "./paths.js";
import { territoriesNow } from "./territories.js";

/**
 * The mine watch and hired swords (N26F decision 13). A town with a working mine posts its own guards on the road to it,
 * and hires sellswords (people of the cities, by job) when it has too few, paid a daily wage out of its treasury. Once a
 * week it looks at the danger to its mine: a gang whose stretch of road crosses the mine's road, its carts robbed in the
 * last WATCH_MEMORY days, a pack on that road. No danger: one guard at the post. Some: the full watch. More than its own
 * guards: hired swords, if it can pay WATCH_MEMORY days of wages and the year's wages stay within a third of its coffers.
 * Each change is news in the town. Hiring moves a row (a journey there), it never makes one; a released sellsword walks
 * home. N69 later puts a captain and a treasurer in charge; until then it's a plain treasury sink with a `hired` tally.
 */
export const WATCH_EVERY = 7;
export const WATCH_MEMORY = 12;
/** Copper a day to a hired sword. */
export const SELLSWORD_WAGE = 8;
/** Guards wanted at each level. */
export const WATCH_SIZE = [1, 3, 4] as const;

/** How dangerous the road to a place's mine is now, 0..2+. */
export function mineDanger(realm: Realm, data: RoadData, s: Settlement, day: number): { level: 0 | 1 | 2; why: string[] } {
  const { mine } = workPlacesOf(data, s.id);
  if (!mine) return { level: 0, why: [] };
  const why: string[] = [];
  let n = 0;
  for (const t of territoriesNow(realm, data)) {
    if (t.road !== mine.road) continue;
    if (t.kind === "gang") {
      n += 1;
      why.push(`${realm.factions[t.owner]?.name ?? "outlaws"} hold the road`);
    } else if ((realm.packs[t.owner]?.count ?? 0) >= 3) {
      n += 0.5;
      why.push(`${realm.packs[t.owner]!.species}s on the road`);
    }
  }
  const robbed = journeysOf(realm).filter((j) => j.ended?.why.startsWith("robbed") && j.path[0] === s.id && j.ended.minute >= (day - WATCH_MEMORY) * 1440).length;
  if (robbed > 0) {
    n += robbed;
    why.push(`${robbed === 1 ? "a cart was" : `${robbed} carts were`} taken`);
  }
  return { level: n === 0 ? 0 : n < 2 ? 1 : 2, why };
}

const able = (rows: PersonRow[], day: number) => rows.filter((r) => r.death === null && !r.away && r.persona === null && ageOn(r, day) >= 18 && ageOn(r, day) <= 55);

/** Who is hired anywhere now (a sellsword is hired by one town at a time). */
function hiredEverywhere(realm: Realm): Set<string> {
  return new Set(Object.values(realm.settlements).flatMap((s) => s.watch?.hired.map((h) => h.person) ?? []));
}

/** Each day: every town with a working mine looks to its watch once a week, pays its hired swords, and lets go those it can't keep. */
export function watchDay(realm: Realm, people: PeopleStore, data: RoadData, day: number, live?: ReadonlySet<string>): string[] {
  const lines: string[] = [];
  for (const s of Object.values(realm.settlements).sort((a, b) => (a.id < b.id ? -1 : 1))) {
    if (s.way || s.abandoned || s.fallen || !workPlacesOf(data, s.id).mine || (live && !live.has(s.id))) continue;
    const w = (s.watch ??= { guards: [], hired: [], level: 0, checked: day - WATCH_EVERY });
    // Wages, every day; those who aren't paid go home.
    for (const h of [...w.hired]) {
      const paid = sink(realm, `s:${s.id}`, h.wage, `wages to ${people.get(h.person)?.name ?? "a sellsword"}`, undefined, day);
      if (paid < h.wage || day >= h.until) release(realm, people, data, s, h.person, day, paid < h.wage ? "unpaid" : "done");
    }
    if (day - w.checked < WATCH_EVERY) continue;
    w.checked = day;
    const danger = mineDanger(realm, data, s, day);
    const want = WATCH_SIZE[danger.level];
    const own = able((people.loadSite(s.id, "full") as PersonRow[]).filter((r) => r.job === "guard"), day).sort((a, b) => (a.id < b.id ? -1 : 1));
    const before = w.level;
    w.level = danger.level;
    w.guards = own.slice(0, Math.min(want, own.length)).map((r) => r.id);
    const short = want - w.guards.length - w.hired.length;
    if (short > 0 && danger.level > 0) {
      const affordable = Math.floor(s.treasury / 3 / (SELLSWORD_WAGE * WATCH_MEMORY));
      const n = Math.min(short, affordable);
      if (n <= 0) {
        realmNews(realm, day, s.id, "watch", `${s.name} can't pay for more men on its mine road (${danger.why.join("; ")}).`, 3, [s.name]);
        tally(realm, "watch_unpaid");
      } else lines.push(...hire(realm, people, data, s, n, day, danger.why));
    } else if (danger.level === 0 && w.hired.length > 0) {
      for (const h of [...w.hired]) release(realm, people, data, s, h.person, day, "quiet");
    }
    if (danger.level !== before) {
      const what = danger.level === 0 ? "back to one guard at the post" : danger.level === 1 ? "the full watch" : "every guard it has, and more";
      realmNews(realm, day, s.id, "watch", `${s.name}'s mine road has ${what}${danger.why.length ? `: ${danger.why.join("; ")}` : ""}.`, 3, [s.name]);
    }
  }
  return lines;
}

/** Hire `n` sellswords from the nearest place that has them: a journey there for each, paid from the day they're taken on. */
function hire(realm: Realm, people: PeopleStore, data: RoadData, s: Settlement, n: number, day: number, why: string[]): string[] {
  const taken = hiredEverywhere(realm);
  const sources = Object.values(realm.settlements)
    .filter((x) => !x.way && !x.abandoned && !x.fallen && x.id !== s.id)
    .map((x) => ({ x, way: shortest(data, x.id, s.id) }))
    .filter((o) => o.way)
    .sort((a, b) => a.way!.length - b.way!.length || (a.x.id < b.x.id ? -1 : 1));
  const w = s.watch!;
  const lines: string[] = [];
  for (const { x, way } of sources) {
    if (lines.length >= n) break;
    const swords = able((people.loadSite(x.id, "full") as PersonRow[]).filter((r) => r.job === "sellsword" && !taken.has(r.id)), day).sort((a, b) => (a.id < b.id ? -1 : 1));
    for (const r of swords) {
      if (lines.length >= n) break;
      const rng = streamFor(realm.seed, "hire", r.id, day);
      // There, a spell on the watch, and home again: a round trip, so the arrival and the going home can both be seen.
      const there = way!.length - 1;
      const path = [...way!, ...way!.slice(0, -1).reverse()];
      const j = launch(realm, data, { kind: "work", party: [{ person: r.id, name: r.name, role: "sellsword", gender: r.gender === "female" ? "female" : "male" }], path, turn: { index: there, stay: WATCH_MEMORY * 1440 }, depart: departureOn(day, rng()), pace: WALK_PACE, purpose: `hired to guard ${s.name}'s mine` }, people);
      if (!j) continue;
      w.hired.push({ person: r.id, from: x.id, wage: SELLSWORD_WAGE, since: day, until: day + WATCH_MEMORY });
      taken.add(r.id);
      tally(realm, "hired");
      lines.push(`${s.name} hires ${r.name}, a sellsword of ${x.name}.`);
    }
    if (lines.length >= n) break;
  }
  if (lines.length > 0) realmNews(realm, day, s.id, "watch", `${s.name} has hired ${lines.length === 1 ? "a sellsword" : `${lines.length} sellswords`} to guard its mine road (${why.join("; ")}).`, 3, [s.name]);
  return lines;
}

/** A hired sword is let go (paid off, unpaid, or the road is quiet): they walk home. */
function release(realm: Realm, people: PeopleStore, data: RoadData, s: Settlement, person: string, day: number, why: "done" | "unpaid" | "quiet"): void {
  const w = s.watch!;
  const h = w.hired.find((x) => x.person === person);
  w.hired = w.hired.filter((x) => x.person !== person);
  const r = people.get(person);
  if (!h || !r || r.death !== null) return;
  if (why === "unpaid") realmNews(realm, day, s.id, "watch", `${r.name} has left ${s.name}'s mine watch: there was no coin for wages.`, 2, [r.name, s.name]);
  tally(realm, "released");
  void data;
}

/** The guards and hired swords on a place's watch now (for the admin view and encounters). */
export function watchStrength(s: Settlement): number {
  return (s.watch?.guards.length ?? 0) + (s.watch?.hired.length ?? 0);
}

/**
 * The player takes a day on the mine watch (N26F decision 13, the `hire_on` action; a hook for N40's careers): walk out with
 * the miners, stand the watch, and be paid at the end of the day by the town (`payDuty`). Offered while the watch is up.
 */
export function hireOn(town: { world: { day: number; player: { duty?: { site: string; day: number; wage: number; what: string } }; realm?: Realm } }, site: string): string[] {
  const s = town.world.realm?.settlements[site];
  if (!s?.watch || s.watch.level === 0) return ["The watch has all the hands it needs."];
  if (town.world.player.duty?.day === town.world.day) return ["You're already on the watch today."];
  town.world.player.duty = { site, day: town.world.day, wage: SELLSWORD_WAGE, what: `the mine watch of ${s.name}` };
  return [`The watch takes you on for the day: ${SELLSWORD_WAGE} copper at sundown, and keep your eyes on the trees.`];
}

/** At the end of a day the player was hired: the place pays them, if it can. Returns a line, or null. */
export function payDuty(realm: Realm, player: { money: number; duty?: { site: string; day: number; wage: number; what: string } }, today: number): string | null {
  const d = player.duty;
  if (!d || d.day >= today) return null;
  delete player.duty;
  const paid = transfer(realm, `s:${d.site}`, "player", d.wage, `a day on ${d.what}`, player, today);
  return paid > 0 ? `You're paid ${paid} copper for your day on ${d.what}.` : `There's no coin to pay you for your day on ${d.what}.`;
}
