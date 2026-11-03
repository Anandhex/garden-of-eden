import { dayOfYear, growthAt, isMarked, PER_HEAD, seedOf, STAGE, yearOf, type FieldEvent, type FieldEventKind, type Plot } from "@millbrook/shared";
import { config } from "../../config.js";
import type { PersonRow } from "../../store/peopleStore.js";
import type { PlotRow } from "../../store/farmStore.js";
import { addGrievance } from "../chatter/grievance.js";
import type { WorldStore } from "../db.js";
import { streamFor, type Rng } from "../dice.js";
import { recordLifeEvent } from "../people/events.js";
import { killBeast, lose } from "../realm/beasts.js";
import { FAMINE } from "../realm/economy.js";
export { EATEN_PER_YEAR, FROM_STORES } from "../realm/economy.js";
import { realmNews, tally } from "../realm/log.js";
import type { Realm, Settlement } from "../realm/types.js";
import { weatherOn } from "../weather.js";
import { cropFor, loadCrops } from "./crops.js";
import { noteHarvest } from "../realm/harvest.js";
import { ensurePlots, householdsAt, plotsOf, workersOf } from "./fields.js";

/**
 * A day in the fields (N26G decisions 5–8), for one place whose people are rows. Each plot's holder works it: its people
 * sow in the crop's window (late with too few hands), weed it once it's up, and reap it when it's ripe (or it rots where
 * it stands). Each is a field event by the person who did it. Then what happens to fields, each from its real cause:
 * deer at the plots nearest the woods, a boar pack's beasts rooting a path at night, crows on fresh seed, a neighbour's
 * stock in the crop, storms, hail and frost from the day's weather, standing water by the river, blight in a wet spell,
 * fire the day after a raid, and theft by the hungry. A fence keeps out deer and stock. The harvest is the place's food.
 */

/** A healthy tile's yield is scaled so that a place's land feeds it in a normal year (`fields-feed`): measured 2026-10-24, 1.0 gave ~123 points a year on plains against 70 eaten; 0.68 gives ~84. */
export const YIELD_SCALE = 0.68;

const CONTIGUOUS = (plot: Plot, start: number, n: number): number[] => {
  const out: number[] = [];
  let i = start;
  for (let k = 0; k < n && out.length < plot.w * plot.h; k++) {
    out.push(i);
    // A path that wanders across the plot: mostly along it, now and then a step across.
    i = (i + (k % 3 === 2 ? plot.w : 1)) % (plot.w * plot.h);
  }
  return [...new Set(out)];
};

/** Food points a harvest of `units` (person-days) is, for a place of `population`. */
export const pointsFor = (units: number, population: number): number => (units * 100) / Math.max(1, population * config.daysPerYear);

interface Ctx {
  realm: Realm;
  store: WorldStore;
  s: Settlement;
  day: number;
  year: number;
  doy: number;
  rng: Rng;
  rows: Map<string, PlotRow>;
  households: Map<string, PersonRow[]>;
  everyone: PersonRow[];
  weather: string;
  rained: boolean;
}

/** Each plot's crop this year, its sowing, and its tiles now. */
function standing(c: Ctx, p: Plot) {
  const crops = loadCrops();
  const crop = cropFor(p.kind, p.field, c.year, c.s.terrain, seedOf(p.id) >>> 0);
  const def = crop ? crops[crop] : undefined;
  const sowing = def ? c.store.farm.sowingOf(c.s.id, p.id, c.year) : undefined;
  return { crop, def, sowing };
}

function record(c: Ctx, p: Plot, kind: FieldEventKind, tiles: number[], by: string, amount = tiles.length): FieldEvent {
  const e: FieldEvent = { plot: p.id, day: c.day, kind, tiles, by, amount };
  c.store.farm.record(c.s.id, e);
  tally(c.realm, `field_${kind}`);
  return e;
}

/** The fields of one place for a day. Returns lines worth telling. */
export function fieldsDay(realm: Realm, store: WorldStore, site: string, day: number): string[] {
  const s = realm.settlements[site];
  if (!s || s.way || s.abandoned) return [];
  const plots = plotsOf(realm, s, day);
  if (plots.length === 0) return [];
  const rows = ensurePlots(realm, store, s, plots, day);
  const hh = householdsAt(store, site, day);
  const everyone = [...hh.all.values()].flat();
  const year = yearOf(day, config.daysPerYear);
  const c: Ctx = { realm, store, s, day, year, doy: dayOfYear(day, config.daysPerYear), rng: streamFor(realm.seed, "fields", site, day), rows, households: hh.all, everyone, weather: weatherOn(day, { realm, site }), rained: ["rain", "storm"].includes(weatherOn(day, { realm, site })) && ["rain", "storm"].includes(weatherOn(day - 1, { realm, site })) };
  const f = s.fields!;
  // The first day the fields are kept: what should already be in the ground this year is (the switch mustn't starve anyone).
  const backfill = !f.kept;
  f.kept = true;
  const lines: string[] = [];
  let reaped = 0;
  const holdings = new Map<string, number>();
  const crews = new Map<string, PersonRow[]>();
  for (const r of rows.values()) holdings.set(r.holder, (holdings.get(r.holder) ?? 0) + 1);
  for (const p of plots) {
    const row = rows.get(p.id);
    if (!row) continue;
    const { crop, def, sowing } = standing(c, p);
    if (!crop || !def) continue;
    let workers = crews.get(row.holder);
    if (!workers) crews.set(row.holder, (workers = workersOf(row.holder, site, day, hh.all, everyone)));
    const hands = workers.length;
    const crew = workers;
    const by = () => (crew.length > 0 ? crew[Math.floor(c.rng() * crew.length)]!.id : row.holder);
    // Sow, in the window; the more plots a household has for its hands, the later.
    if (!sowing) {
      if (backfill && c.doy > def.sow[1]) {
        c.store.farm.sow(site, { plot: p.id, crop, day: day - (c.doy - def.sow[0]), year });
        continue;
      }
      if (c.doy < def.sow[0] || c.doy > def.sow[1] + 4 || hands === 0) continue;
      const load = (holdings.get(row.holder) ?? 1) / Math.max(1, hands);
      if (c.doy < def.sow[1] && c.rng() >= Math.min(1, 0.6 / Math.max(0.5, load))) continue;
      c.store.farm.sow(site, { plot: p.id, crop, day, year });
      record(c, p, "sow", [], by(), p.w * p.h);
      continue;
    }
    const d = day - sowing.day;
    const events = c.store.farm.eventsOfPlot(site, p.id).filter((e) => e.day >= sowing.day);
    const reapedAlready = events.some((e) => e.kind === "harvest");
    if (reapedAlready) continue;
    // Weed once it's up.
    if (d >= Math.floor(def.grow * 0.35) && d < def.grow && hands > 0 && !events.some((e) => e.kind === "weed") && c.rng() < 0.5) record(c, p, "weed", [], by(), 0);
    // Reap when it's ripe, before it rots.
    if (d >= def.grow && d < def.grow + def.ripe && hands > 0 && c.rng() < Math.min(1, 0.35 * hands)) {
      const stages = growthAt(p, sowing, def, events, day);
      const healthy = [...stages].filter((x) => x === STAGE.ripe).length;
      const care = events.some((e) => e.kind === "weed") ? 1 : 0.8;
      const like = def.likes.includes(s.terrain) ? 1.15 : def.dislikes.includes(s.terrain) ? 0.8 : 1;
      // Hill and marsh land is scarcer (fewer plots a head); what there is is worked harder.
      const land = 0.5 / (PER_HEAD[s.terrain] ?? 0.4);
      const units = healthy * def.yield * care * like * land * YIELD_SCALE;
      record(c, p, "harvest", [], by(), Math.round(units * 10) / 10);
      reaped += units;
      continue;
    }
    if (d < def.grow + def.ripe) damage(c, p, row, sowing.day, def.eatenBy, def.frost, def.flood);
  }
  if (reaped > 0) {
    s.food = Math.min(100, s.food + pointsFor(reaped, s.population));
    noteHarvest(s, day, pointsFor(reaped, s.population), 0);
    tally(realm, "harvest_units", Math.round(reaped));
  }
  // When a new year begins, the last year's events are folded into each plot's year.
  if (c.doy === 1) store.farm.fold(site, day, (dd) => yearOf(dd, config.daysPerYear));
  return lines;
}

/** What happens to a standing crop today, each from its cause. */
function damage(c: Ctx, p: Plot, row: PlotRow, sown: number, eatenBy: string[], frost: boolean, flood: boolean): void {
  const n = p.w * p.h;
  const r = c.rng;
  const d = c.day - sown;
  const fence = row.fence;
  const tiles = (k: number) => CONTIGUOUS(p, Math.floor(r() * n), k);
  const winter = c.doy > (config.daysPerYear * 3) / 4;
  // Deer from the woods: the outer plots most, at dawn and dusk; a fence keeps most out.
  if (eatenBy.includes("deer") && r() < (p.ring >= 2 ? 0.012 : 0.003) * (winter ? 2 : 1) * (fence >= 2 ? 0.15 : fence === 1 ? 0.4 : 1)) {
    record(c, p, "graze", tiles(3 + Math.floor(r() * 6)), "deer");
    raiseFence(c, p, row);
  }
  // A boar pack near the place roots a path through a plot at night: its own beasts, by row.
  const boars = Object.values(c.realm.packs).find((x) => x.near === c.s.id && x.species === "boar" && x.count >= 2);
  if (boars && eatenBy.includes("boar") && p.ring >= 1 && r() < 0.006 * (fence >= 2 ? 0.3 : 1)) {
    const beast = c.store.beasts.living(boars.id)[Math.floor(r() * Math.max(1, c.store.beasts.livingCount(boars.id)))];
    record(c, p, "root", tiles(6 + Math.floor(r() * 9)), beast?.id ?? `pack:${boars.id}`);
    boarKeepsComing(c, boars.id);
  }
  // Crows on fresh seed: children sent to scare them off help.
  if (eatenBy.includes("crows") && d <= 3 && r() < 0.06) record(c, p, "seed-eaten", tiles(2 + Math.floor(r() * 4)), "crows");
  // A neighbour's stock got in: a quarrel between the households (N37).
  if (p.kind === "strip" && fence === 0 && r() < 0.002) {
    // The household of the nearest plot along the layout (plot ids end in their number), not the place's first.
    const at = (id: string) => Number(id.slice(id.lastIndexOf(":") + 1));
    const neighbour = [...c.rows.values()]
      .filter((x) => x.holder !== row.holder && x.holder.startsWith("hh:"))
      .sort((a, b) => Math.abs(at(a.id) - at(p.id)) - Math.abs(at(b.id) - at(p.id)) || at(a.id) - at(b.id))[0];
    if (neighbour && row.holder.startsWith("hh:")) {
      record(c, p, "stock", tiles(4 + Math.floor(r() * 5)), neighbour.holder);
      const victim = c.households.get(row.holder)?.find((x) => x.job !== "child");
      const culprit = c.households.get(neighbour.holder)?.find((x) => x.job !== "child");
      if (victim && culprit && config.chatter) {
        const ev = recordLifeEvent(c.realm, c.store, { kind: "stock-strayed", actor: culprit.id, target: victim.id, site: c.s.id, day: c.day, key: `${p.id}:${culprit.id}`, details: `${culprit.name}'s stock got into ${victim.name}'s crop and trampled it`, importance: 1 });
        addGrievance(c.store, { who: victim.id, against: culprit.id, cause: `e:${ev.id}`, weight: 0.2, day: c.day });
      }
      raiseFence(c, p, row);
    }
  }
  // The weather.
  if (c.weather === "storm" && d >= 10 && r() < 0.25) record(c, p, "storm", tiles(Math.ceil(n * 0.12)), "weather");
  if (frost && d <= 4 && c.doy <= 5 && c.weather === "clear" && r() < 0.08) record(c, p, "frost", tiles(Math.ceil(n * 0.2)), "weather");
  if (flood && c.rained && p.kind === "meadow" && r() < 0.2) record(c, p, "flood", tiles(Math.ceil(n * 0.3)), "weather");
  if (c.rained && d >= 8 && r() < 0.004) record(c, p, "blight", tiles(Math.ceil(n * 0.25)), "weather");
  // The day after a raid, the plots by the road burn.
  if (c.s.lastRaided !== undefined && c.day - c.s.lastRaided <= 1 && p.ring === 0 && r() < 0.15) record(c, p, "fire", [], "raiders");
  // The hungry strip a ripe plot by night: a theft, with a witness if anyone was about.
  if (c.s.food < FAMINE && d >= 10 && r() < 0.01) {
    const hungry = c.everyone.filter((x) => (x.cls === "commoner" || x.cls === "serf" || x.cls === "slave") && x.job !== "child");
    const thief = hungry[Math.floor(r() * hungry.length)];
    if (thief) {
      record(c, p, "theft", tiles(4 + Math.floor(r() * 5)), thief.id);
      const watch = c.everyone.find((x) => x.job === "guard" && r() < 0.4);
      recordLifeEvent(c.realm, c.store, { kind: "theft", actor: thief.id, site: c.s.id, day: c.day, details: `${thief.name} stripped a plot in the fields by night, out of hunger`, importance: 3, ...(watch ? { witnesses: [watch.id] } : {}), why: "hunger" });
    }
  }
}

/** A household that keeps losing a plot to beasts or stock puts up a fence (hurdles, then a hedge). */
function raiseFence(c: Ctx, p: Plot, row: PlotRow): void {
  if (row.fence >= 2) return;
  const hits = c.store.farm.eventsOfPlot(c.s.id, p.id).filter((e) => (e.kind === "graze" || e.kind === "stock" || e.kind === "root") && e.day > c.day - config.daysPerYear).length;
  if (hits >= 2 + row.fence * 2) c.store.farm.setPlot(c.s.id, p.id, { fence: row.fence + 1 });
}

/** A boar that roots the fields three nights running: the place sends its hunters after it (N26G decision 7). */
function boarKeepsComing(c: Ctx, pack: string): void {
  const recent = new Set(c.store.farm.eventsOf(c.s.id).filter((e) => e.kind === "root" && e.day > c.day - 3).map((e) => e.day));
  if (recent.size < 3) return;
  const p = c.realm.packs[pack];
  const hunters = c.everyone.filter((x) => x.job === "hunter" || x.job === "guard").slice(0, 3);
  if (!p || hunters.length === 0 || (p.lastAttack ?? -99) >= c.day - 3) return;
  p.lastAttack = c.day;
  // The beast they bring down is one of the pack's own (the one that's been rooting the fields, if it can be told).
  const rooter = c.store.farm.eventsOf(c.s.id).filter((e) => e.kind === "root" && e.day > c.day - 3).map((e) => c.store.beasts.get(e.by)).find((b) => b && b.died === null);
  const prey = rooter ?? c.store.beasts.living(pack).at(-1);
  if (prey) {
    killBeast(c.realm, c.store.beasts, prey.id, c.day, `hunted by ${hunters.map((h) => h.name).join(" and ")} of ${c.s.name}`, hunters[0]!.id);
    p.count = c.store.beasts.livingCount(pack);
  } else lose(p, 1, c.day, `hunted by ${hunters.map((h) => h.name).join(" and ")} of ${c.s.name}`, hunters[0]!.id);
  realmNews(c.realm, c.day, c.s.id, "beast", `${hunters.map((h) => h.name).join(" and ")} went after the boar that has been rooting ${c.s.name}'s fields.`, 4, [c.s.name, ...hunters.map((h) => h.name)]);
  tally(c.realm, "boar_hunts");
}

/** For tests and the admin view: a plot's tiles now. */
export function plotTiles(realm: Realm, store: WorldStore, s: Settlement, p: Plot, day: number): Uint8Array {
  const year = yearOf(day, config.daysPerYear);
  const crop = cropFor(p.kind, p.field, year, s.terrain, seedOf(p.id) >>> 0);
  const def = crop ? loadCrops()[crop] : undefined;
  const sowing = store.farm.sowingOf(s.id, p.id, year);
  return growthAt(p, sowing, def, store.farm.eventsOfPlot(s.id, p.id), day);
}

export { isMarked };

/** Every plot tile's stage inside a rectangle of the road world, keyed `x,y` (the frame draws the fields from this). */
export function fieldStagesIn(realm: Realm, store: WorldStore, x0: number, y0: number, w: number, h: number, day: number): Map<string, number> {
  const out = new Map<string, number>();
  for (const s of Object.values(realm.settlements)) {
    if (!s.fields?.kept) continue;
    for (const p of plotsOf(realm, s, day)) {
      if (p.x + p.w <= x0 || p.x >= x0 + w || p.y + p.h <= y0 || p.y >= y0 + h) continue;
      const st = plotTiles(realm, store, s, p, day);
      for (let i = 0; i < st.length; i++) out.set(`${p.x + (i % p.w)},${p.y + Math.floor(i / p.w)}`, st[i]!);
    }
  }
  return out;
}

/**
 * The player hires on for a day's harvest at a ripe plot (N26G decision 5): they reap it with the household, the yield goes
 * to the place's food like any harvest (a field event by the player), and the holder's place pays a day's wage at day's end.
 */
export function playerReaps(realm: Realm, store: WorldStore, site: string, plotId: string, day: number, player: { duty?: { site: string; day: number; wage: number; what: string } }): string[] {
  const s = realm.settlements[site];
  if (!s?.fields?.kept) return ["Nobody here is reaping."];
  const p = plotsOf(realm, s, day).find((x) => x.id === plotId);
  if (!p) return ["That isn't a field you can work."];
  const year = yearOf(day, config.daysPerYear);
  const crop = cropFor(p.kind, p.field, year, s.terrain, seedOf(p.id) >>> 0);
  const def = crop ? loadCrops()[crop] : undefined;
  const sowing = store.farm.sowingOf(site, p.id, year);
  const events = store.farm.eventsOfPlot(site, p.id).filter((e) => sowing && e.day >= sowing.day && e.day <= day);
  if (!def || !sowing || events.some((e) => e.kind === "harvest")) return ["There's nothing standing to reap."];
  const stages = growthAt(p, sowing, def, events, day);
  const healthy = [...stages].filter((x) => x === STAGE.ripe).length;
  if (healthy === 0) return ["It isn't ripe yet."];
  const land = 0.5 / (PER_HEAD[s.terrain] ?? 0.4);
  const units = Math.round(healthy * def.yield * (events.some((e) => e.kind === "weed") ? 1 : 0.8) * land * YIELD_SCALE * 10) / 10;
  store.farm.record(site, { plot: p.id, day, kind: "harvest", tiles: [], by: "player", amount: units });
  s.food = Math.min(100, s.food + pointsFor(units, s.population));
  noteHarvest(s, day, pointsFor(units, s.population), 0);
  player.duty = { site, day, wage: 6, what: `the harvest at ${s.name}` };
  return [`You work the day at the ${def.name} with them: ${healthy} rows of it in, and you're owed a day's wage at sundown.`];
}
