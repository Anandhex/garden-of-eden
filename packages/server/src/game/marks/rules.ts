import { seedOf } from "@millbrook/shared";
import type { Mark } from "@millbrook/shared/view";
import { config } from "../../config.js";
import type { MarkRow } from "../../store/markStore.js";
import { siteMap, type SiteMap } from "../../web/sites.js";
import type { WorldStore } from "../db.js";
import { deathWords, type DeathRecord } from "../people/death.js";
import { FAMINE } from "../realm/economy.js";
import type { Realm, Settlement } from "../realm/types.js";
import { seasonDays } from "../weather.js";

/**
 * Visible consequences (N31): marks laid over a place's map from what really happened there. Stored (`marks`): a house
 * burned in a raid (repaired by a day that depends on how well the place lives), scaffolding while the place builds, a
 * grave for everyone who died there (named, with the day and how, from N25's death records; faded after ten years).
 * Worked out when drawn, from the realm as it stands: empty stalls in a famine, the banners of the factions with a hall
 * here and the ruler's colours on the hall, and the extra guards of a curfew (N58 gives that a source). Lit windows are G6's.
 */

/** Days a burned house stands before it's repaired: a season in a place doing middling well, less if it thrives, more if poor. */
export function repairDays(s: Pick<Settlement, "prosperity">): number {
  return Math.max(3, Math.round(seasonDays() * (0.5 + (100 - s.prosperity) / 80)));
}

/** Graves older than this many years, with nobody left to tend them, fade to unnamed mounds. */
export const FADE_YEARS = 10;
/** Graves to a row of the graveyard. */
const ROW = 8;

const village = (realm: Realm, s: Settlement): SiteMap => siteMap(s, "village", realm);

/** The realm's day for every place's marks: burned houses after a raid, scaffolding for a project, and repairs. */
export function marksRealmDay(realm: Realm, store: WorldStore, day: number): void {
  for (const s of Object.values(realm.settlements)) {
    if (s.way || s.abandoned) continue;
    // A raid today: one to three houses burned, by seed.
    if (s.lastRaided === day) {
      const m = village(realm, s);
      const houses = m.buildings.map((b, i) => ({ b, i })).filter((x) => x.b.kind === "house");
      const n = Math.min(houses.length, 1 + ((seedOf(`burn|${s.id}|${day}`) >>> 0) % 3));
      const order = [...houses].sort((a, b) => (seedOf(`burn|${s.id}|${day}|${a.i}`) >>> 0) - (seedOf(`burn|${s.id}|${day}|${b.i}`) >>> 0)).slice(0, n);
      for (const { b, i } of order) {
        store.marks.add({ id: `burn:${s.id}:${day}:${i}`, site: s.id, kind: "burned", x: b.x, y: b.y, w: b.w, h: b.h, building: i, ref: `raid:${day}:${s.id}`, label: "burned in the raid", since: day, ends: day + repairDays(s), data: null });
      }
    }
    // A place that recovers rebuilds faster: a burned house is put right by the sooner of when it was due and what the place can do now.
    for (const r of store.marks.of(s.id).values()) {
      if (r.kind !== "burned" || r.ends === null || r.ends <= day) continue;
      const sooner = Math.max(day, r.since + repairDays(s));
      if (sooner < r.ends) store.marks.update(s.id, r.id, { ends: sooner });
    }
    // Scaffolding while it builds; down when the building is done (or given up).
    const standing = [...store.marks.of(s.id).values()].filter((r) => r.kind === "scaffold" && r.ends === null);
    for (const r of standing) if (!s.project || r.ref !== `project:${s.project.building}`) store.marks.end(s.id, r.id, day);
    if (s.project && !standing.some((r) => r.ref === `project:${s.project!.building}` && r.ends === null)) {
      const m = village(realm, s);
      const z = m.zones.find((x) => x.id === "square") ?? m.zones[0];
      if (z) store.marks.add({ id: `scaffold:${s.id}:${s.project.building}:${day}`, site: s.id, kind: "scaffold", x: z.x1 + 1, y: z.y0, w: 3, h: 3, building: null, ref: `project:${s.project.building}`, label: `scaffolding: ${s.project.building} going up`, since: day, ends: null, data: null });
    }
  }
}

/** Where a place's graveyard is: beside its temple, or in a corner by the wall. */
function graveyardOf(m: SiteMap): { x: number; y: number } {
  const temple = m.buildings.find((b) => b.kind === "temple");
  if (temple) return { x: temple.x + temple.w + 1, y: temple.y };
  return { x: 3, y: 3 };
}

/**
 * A place's own day for its marks: a grave for each of its dead (died there, with a body: not the missing), in order,
 * rows filling up; old graves fade. Runs for a place worked out later too, so its graves are the same.
 */
export function marksSiteDay(realm: Realm, store: WorldStore, site: string, day: number): void {
  const s = realm.settlements[site];
  if (!s || s.way) return;
  const dead = store.people.diedAt(site, day - 2);
  if (dead.length === 0 && day % 12 !== 0) return;
  const marks = store.marks.of(site);
  let count = [...marks.values()].filter((r) => r.kind === "grave").length;
  let yard: { x: number; y: number } | null = null;
  for (const r of dead.sort((a, b) => (a.id < b.id ? -1 : 1))) {
    if (!r.death || marks.has(`grave:${r.id}`)) continue;
    const rec = JSON.parse(r.death) as DeathRecord;
    if (rec.cause === "missing" || (rec.site !== null && rec.site !== site)) continue;
    yard ??= graveyardOf(village(realm, s));
    store.marks.add({ id: `grave:${r.id}`, site, kind: "grave", x: yard.x + (count % ROW), y: yard.y + Math.floor(count / ROW), w: 1, h: 1, building: null, ref: r.id, label: `${r.name}, died day ${rec.day}, ${deathWords(rec)}`, since: rec.day, ends: null, data: null });
    count++;
  }
  // Graves nobody tends any more fade to mounds without a name.
  if (day % 12 === 0) {
    const old = day - FADE_YEARS * config.daysPerYear;
    for (const g of marks.values()) if (g.kind === "grave" && g.since < old && !g.data) store.marks.update(site, g.id, { label: "an old grave, the name worn away", data: JSON.stringify({ faded: true }) });
  }
}

/** The marks to draw on a place's map on a day: stored ones standing, and those worked out from the realm now. */
export function marksToDraw(realm: Realm, store: WorldStore | null, site: string, day: number, m: SiteMap): Mark[] {
  const s = realm.settlements[site];
  if (!s) return [];
  const out: Mark[] = (store?.marks.active(site, day) ?? []).map(toMark);
  // A famine: the market's stalls stand empty, more of them the hungrier the place.
  const market = m.zones.find((z) => z.id === "market") ?? m.zones.find((z) => z.id === "square");
  if (market && s.food < FAMINE) {
    const n = Math.max(1, Math.ceil(((FAMINE - s.food) / FAMINE) * 6));
    for (let k = 0; k < n; k++) out.push({ id: `stall:${site}:${k}`, kind: "stall_empty", x: market.x0 + ((k * 2) % Math.max(1, market.x1 - market.x0 + 1)), y: market.y0 + Math.floor((k * 2) / Math.max(1, market.x1 - market.x0 + 1)), w: 1, h: 1, label: "an empty stall: nothing to sell" });
  }
  // Banners: each faction with a hall here on its building; the ruler's colours on the hall.
  for (const f of Object.values(realm.factions)) {
    if (f.dissolved || !f.branches.includes(site)) continue;
    const kind = f.kind === "guild" ? "guildhall" : f.kind === "cult" || f.kind === "order" ? "temple" : "hall";
    const b = m.buildings.find((x) => x.kind === kind) ?? m.buildings.find((x) => x.kind === "hall");
    if (b) out.push({ id: `banner:${f.id}`, kind: "banner", x: b.x, y: b.y - 1, w: 1, h: 1, label: `the banner of ${f.name}`, colour: "#b5763f" });
  }
  const k = s.kingdom ? realm.kingdoms[s.kingdom] : undefined;
  const hall = m.buildings.find((x) => x.kind === "palace" || x.kind === "castle" || x.kind === "hall");
  if (k && hall) out.push({ id: `colours:${site}`, kind: "banner", x: hall.x + hall.w - 1, y: hall.y - 1, w: 1, h: 1, label: `the colours of ${k.name}`, colour: k.color });
  // A curfew's extra guards (N58 sets them).
  for (const g of curfewGuards(realm, site)) out.push({ id: `guards:${site}:${g.x}:${g.y}`, kind: "guards", x: g.x, y: g.y, w: 1, h: 1, label: "guards posted for the curfew" });
  return out;
}

/** Where a curfew posts extra guards (N58 gives this a source; none until then). */
export function curfewGuards(_realm: Realm, _site: string): Array<{ x: number; y: number }> {
  return [];
}

const toMark = (r: MarkRow): Mark => ({ id: r.id, kind: r.kind as Mark["kind"], x: r.x, y: r.y, w: r.w, h: r.h, ...(r.label ? { label: r.label } : {}) });

/**
 * Most named marks standing in a place (N31's `marks-bounded`), graves counted only while named: a floor of 600, and for a
 * big place ten years of its dead (graves stay named that long) at a hard year's rate of 50 in 1,000, half its people.
 */
export const MARKS_CAP = 600;
export const marksCap = (s: Pick<Settlement, "population">): number => Math.max(MARKS_CAP, Math.round(s.population / 2));

/** N31's bounds: `marks-bounded` and `ruins-repaired` (no burned house in a place that thrives now still stands burned after a season). */
export function checkMarkBounds(realm: Realm, store: WorldStore, day: number): Array<{ name: string; ok: boolean; detail: string }> {
  let most = 0;
  let where = "";
  let over = 0;
  let slow = 0;
  for (const s of Object.values(realm.settlements)) {
    if (s.way) continue;
    const marks = [...store.marks.of(s.id).values()];
    const named = marks.filter((r) => (r.ends === null || r.ends > day) && !(r.kind === "grave" && r.data)).length;
    if (named > most) {
      most = named;
      where = s.name;
    }
    if (named > marksCap(s)) over++;
    // Judged on what still stands: a house burned while the place was poor took longer, and is put right once it thrives.
    if (s.prosperity >= 60) slow += marks.filter((r) => r.kind === "burned" && (r.ends === null || r.ends > day) && day - r.since > seasonDays()).length;
  }
  return [
    { name: "marks-bounded", ok: over === 0, detail: `at most ${most} marks standing${where ? ` (${where})` : ""}; ${over} places over their cap (600, or half their people)` },
    { name: "ruins-repaired", ok: slow === 0, detail: `${slow} burned houses in thriving places left longer than a season` },
  ];
}
