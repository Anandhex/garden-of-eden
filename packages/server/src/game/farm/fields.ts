import { fieldsOf, PER_HEAD, plotAt, plotCount, seedOf, type Plot } from "@millbrook/shared";
import type { WorldStore } from "../db.js";
import type { PersonRow } from "../../store/peopleStore.js";
import type { PlotRow } from "../../store/farmStore.js";
import type { Realm, Settlement } from "../realm/types.js";
import { ageOn } from "../realm/who.js";
import { roadDataOf } from "../road/generateRoads.js";

/**
 * A place's plots and who holds and works them (N26G decisions 1, 2 and 5). The layout is the shared one; the number of
 * plots only grows (cleared land stays cleared): more as the people grow and the farms rise. Holders by class: a free
 * farmer's household holds strips, a serf's holds strips and owes days on the demesne, a slave holds none, the lord holds
 * the demesne, the temple its glebe, and paddocks and meadow are the commons. A plot never has a holder that doesn't
 * exist: when a household dies out or leaves, its plots go to the lord, or else to the commons.
 */

/** Every tenth plot is the lord's demesne; one in twenty-five is the temple's glebe. */
const DEMESNE_EVERY = 10;
const GLEBE_AT = 25;

export const householdOf = (r: Pick<PersonRow, "site" | "home">): string | null => (r.home === null ? null : `hh:${r.site}:${r.home}`);

/** The plots of a place now, growing its land if it has grown. */
export function plotsOf(realm: Realm, s: Settlement, day: number): Plot[] {
  const want = plotCount({ site: s.id, terrain: s.terrain, population: s.population, farms: s.buildings.farms ?? 0, kind: s.kind });
  const f = (s.fields ??= { plots: want, kept: false, since: day });
  if (want > f.plots * 1.1 || (want > f.plots && want - f.plots >= 4)) f.plots = want;
  return layoutOfCount(realm, s, f.plots);
}

/** The first `n` plots of a place's layout (the people may have fallen since the land was cleared: it stays cleared). */
function layoutOfCount(realm: Realm, s: Settlement, n: number): Plot[] {
  const k = (PER_HEAD[s.terrain] ?? 0.4) * (1 + 0.15 * (s.buildings.farms ?? 0));
  return fieldsOf({ site: s.id, terrain: s.terrain, population: Math.max(1, Math.ceil(n / k)), farms: s.buildings.farms ?? 0, kind: s.kind }, roadDataOf(realm)).slice(0, n);
}

/** The living people of a place, grouped by household, the ones that farm marked. */
export function householdsAt(store: WorldStore, site: string, day: number): { all: Map<string, PersonRow[]>; farming: string[] } {
  const all = new Map<string, PersonRow[]>();
  for (const r of store.people.loadSite(site, "full") as PersonRow[]) {
    if (r.death !== null) continue;
    const h = householdOf(r);
    if (!h) continue;
    all.set(h, [...(all.get(h) ?? []), r]);
  }
  const farming = [...all.entries()]
    .filter(([, rows]) => rows.some((r) => r.cls !== "slave" && (r.job === "farmer" || (r.cls === "serf" && (r.job === "labourer" || r.job === "farmer")))))
    .map(([h]) => h)
    .sort();
  void day;
  return { all, farming };
}

/** Who holds plot `i` when the land is first given out. */
function firstHolder(s: Settlement, p: Plot, i: number, farming: string[]): string {
  if (p.kind === "paddock" || p.kind === "meadow") return "commons";
  if (i % DEMESNE_EVERY === 0 && s.leader) return `lord:${s.leader}`;
  if (i % GLEBE_AT === 5 && (s.buildings.temple ?? 0) > 0) return `temple:${s.id}`;
  if (farming.length === 0) return s.leader ? `lord:${s.leader}` : "commons";
  return farming[(seedOf(`${p.id}|holder`) >>> 0) % farming.length]!;
}

/** Make the rows of new plots, and give back the plots of holders who are gone. Returns the place's plot rows. */
export function ensurePlots(realm: Realm, store: WorldStore, s: Settlement, plots: Plot[], day: number): Map<string, PlotRow> {
  const rows = store.farm.plotsOf(s.id);
  const hh = store.people.count(s.id) > 0 ? householdsAt(store, s.id, day) : { all: new Map<string, PersonRow[]>(), farming: [] };
  const fresh: PlotRow[] = [];
  plots.forEach((p, i) => {
    if (!rows.has(p.id)) fresh.push({ id: p.id, site: s.id, holder: firstHolder(s, p, i, hh.farming), fence: p.kind === "orchard" ? 1 : 0 });
  });
  if (fresh.length > 0) store.farm.addPlots(fresh);
  // Holders who are no more: the lord takes the plot back, or it goes to the commons.
  for (const r of rows.values()) {
    if (holderExists(realm, s, r.holder, hh.all)) continue;
    store.farm.setPlot(s.id, r.id, { holder: s.leader && realm.figures[s.leader]?.alive ? `lord:${s.leader}` : "commons" });
  }
  return rows;
}

/** A holder that is still there to hold a plot. */
export function holderExists(realm: Realm, s: Settlement, holder: string, households: Map<string, PersonRow[]>): boolean {
  if (holder === "commons") return true;
  if (holder.startsWith("temple:")) return (s.buildings.temple ?? 0) > 0;
  if (holder.startsWith("lord:")) return !!realm.figures[holder.slice(5)]?.alive;
  if (holder.startsWith("hh:")) return households.size === 0 || households.has(holder);
  return false;
}

/** Who works a holder's land today (N26G decision 5): its own grown people; serfs on the demesne on their duty days. */
export function workersOf(holder: string, site: string, day: number, households: Map<string, PersonRow[]>, everyone: PersonRow[]): PersonRow[] {
  const grown = (r: PersonRow) => r.death === null && !r.away && ageOn(r, day) >= 12 && r.persona === null;
  if (holder.startsWith("hh:")) return (households.get(holder) ?? []).filter((r) => grown(r) && r.job !== "child");
  if (holder.startsWith("lord:")) {
    // Serfs owe the demesne one day in three; with no serfs, the lord's hired labourers.
    const serfs = everyone.filter((r) => grown(r) && (r.cls === "serf" || r.cls === "slave"));
    if (serfs.length > 0) return serfs.filter((r) => (seedOf(`${r.id}|duty`) >>> 0) % 3 === day % 3);
    return everyone.filter((r) => grown(r) && r.job === "labourer").slice(0, 3);
  }
  if (holder.startsWith("temple:")) return everyone.filter((r) => grown(r) && (r.job === "acolyte" || r.job === "priest")).slice(0, 3);
  return everyone.filter((r) => grown(r) && r.job === "farmer").slice(0, 2);
}

/** The plot under a road tile, if a place's fields are there (for trampling, and the frame's drawing). */
export function plotUnder(realm: Realm, store: WorldStore, x: number, y: number, day: number): { s: Settlement; plot: Plot; i: number; row: PlotRow | undefined } | null {
  const data = roadDataOf(realm);
  for (const f of data.footprints) {
    if (x < f.x0 - 1200 || x > f.x1 + 1200 || y < f.y0 - 1200 || y > f.y1 + 1200) continue;
    const s = realm.settlements[f.id];
    if (!s?.fields?.kept) continue;
    const hit = plotAt(plotsOf(realm, s, day), x, y);
    if (hit) return { s, plot: hit.plot, i: hit.i, row: store.farm.plotsOf(s.id).get(hit.plot.id) };
  }
  return null;
}
