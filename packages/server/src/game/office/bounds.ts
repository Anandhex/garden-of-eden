import type { Realm } from "../realm/types.js";
import { seasonDays } from "../weather.js";
import { CHARTERED, memberCount, minMembers } from "./members.js";
import { leaders } from "./support.js";
import { epithetOf } from "../realm/figures.js";
import { TITLES, type TitleDef } from "../titles.js";

/**
 * N69's numbers for the long-run bounds (balance/bounds.ts): how many posts are filled and for how long they have stood empty, how many
 * treasuries are bare, how many keepers of the coffers skim, how big the guilds are, how renown is spread, and how many leaders carry
 * an epithet. Read once a day by the runner.
 */
export interface OfficeSample {
  posts: number;
  /** Posts empty now, and empty for more than a season. */
  empty: number;
  emptyLong: number;
  /** Keepers of the coffers who skim. */
  skimming: number;
  coffers: number;
  treasuries: number;
  zeroTreasury: number;
  /** The places with bare coffers today. */
  bare: string[];
  maxTreasury: number;
  /** Members of each active chartered guild-like faction. */
  guildSizes: number[];
  /** The largest share any of them holds of the people of its seat and halls (members / population there). */
  guildShare: number;
  /** Active chartered guild-like factions under their minimum for more than a season (should be none: they fold). */
  underMinLong: number;
  figures: number;
  renownMean: number;
  /** Figures at −30 or below. */
  below30: number;
  /** Figures at the ends (|renown| ≥ 99) and at exactly 0. */
  atEdges: number;
  atZero: number;
  leaders: number;
  supportMean: number;
  supportSd: number;
  withEpithet: number;
  good: number;
  bad: number;
}

export function officeSample(realm: Realm, day: number): OfficeSample {
  const offices = Object.values(realm.offices ?? {});
  const coffers = offices.filter((o) => /^(treasurer|reeve|quartermaster)$/.test(o.post) && o.holder);
  const places = Object.values(realm.settlements).filter((s) => !s.way && !s.abandoned && !s.fallen);
  const guilds = Object.values(realm.factions).filter((f) => f.dissolved === undefined && !f.charter && CHARTERED.has(f.kind));
  const figs = Object.values(realm.figures).filter((f) => f.alive && f.role !== "beast");
  const lead = leaders(realm);
  const supports = lead.map((f) => f.support ?? 0);
  const mean = (xs: number[]) => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length);
  const sm = mean(supports);
  let good = 0;
  let bad = 0;
  let withEpithet = 0;
  for (const f of lead) {
    if (!epithetOf(f)) continue;
    withEpithet++;
    for (const t of f.life.titles) {
      const def = (TITLES as Record<string, TitleDef>)[t.id];
      if (def?.kind !== "repute") continue;
      if (def.good) good++;
      else bad++;
    }
  }
  return {
    posts: offices.length,
    empty: offices.filter((o) => !o.holder).length,
    emptyLong: offices.filter((o) => !o.holder && day - (o.vacant ?? o.since) > seasonDays()).length,
    skimming: coffers.filter((o) => o.skim > 0).length,
    coffers: coffers.length,
    treasuries: places.length,
    zeroTreasury: places.filter((s) => s.treasury <= 0).length,
    // Hamlets have only their elder: a hamlet whose upkeep eats its little income is not a place nobody can run.
    bare: places.filter((s) => s.treasury <= 0 && s.kind !== "hamlet").map((s) => s.id),
    maxTreasury: Math.max(0, ...places.map((s) => s.treasury)),
    guildSizes: guilds.map((f) => memberCount(realm, f)).sort((a, b) => a - b),
    guildShare: Math.max(0, ...guilds.map((f) => memberCount(realm, f) / Math.max(1, [...new Set([f.seat, ...f.branches])].reduce((a, id) => a + (id ? (realm.settlements[id]?.population ?? 0) : 0), 0)))),
    underMinLong: guilds.filter((f) => f.belowMin !== undefined && day - f.belowMin > seasonDays() && memberCount(realm, f) < minMembers(realm, f)).length,
    figures: figs.length,
    renownMean: mean(figs.map((f) => f.renown)),
    below30: figs.filter((f) => f.renown <= -30).length,
    atEdges: figs.filter((f) => Math.abs(f.renown) >= 99).length,
    atZero: figs.filter((f) => f.renown === 0).length,
    leaders: lead.length,
    supportMean: sm,
    supportSd: Math.sqrt(mean(supports.map((x) => (x - sm) ** 2))),
    withEpithet,
    good,
    bad,
  };
}
