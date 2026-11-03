import { config } from "../../config.js";
import type { WorldStore } from "../db.js";
import { streamFor, type Rng } from "../dice.js";
import { strongestOf } from "../chatter/grievance.js";
import { temperOf } from "../chatter/person.js";
import { neighbours } from "../realm/generate.js";
import type { Realm } from "../realm/types.js";
import { ageFrom } from "../people/rules.js";
import { speciesOf } from "../../world/species.js";
import type { PersonRow } from "../../store/peopleStore.js";
import type { Need, NeedKind } from "./schema.js";

/**
 * What a town already has brewing (N39 decision 3): each need is a cheap query of the town's real people and the realm. A need that
 * holds binds its roles to people (row ids) and may give words for the text (`{pack}`, `{news}`). A need that doesn't hold gives null,
 * and an incident needing it can't be picked. Nothing here makes a person, a grudge or an illness: they are found or not.
 */

export interface Bound {
  /** Role → a `people` row id. */
  roles: Record<string, string>;
  /** Words for the text: `{pack}`, `{news}`, `{arrival}`, `{from}`. */
  words: Record<string, string>;
  /** Things the incident refers to (a pack id, an arrival day), for the run. */
  refs: Record<string, string>;
}

export interface TownNow {
  realm: Realm;
  store: WorldStore;
  site: string;
  day: number;
  /** The living people at home (not away, not held), sorted by id. */
  rows: PersonRow[];
}

/** The town as the needs read it. */
export function townNow(realm: Realm, store: WorldStore, site: string, day: number): TownNow {
  const rows = (store.people.loadSite(site, "full") as PersonRow[]).filter((r) => r.death === null && !r.away && !r.captive).sort((a, b) => (a.id < b.id ? -1 : 1));
  return { realm, store, site, day, rows };
}

const ageOf = (t: TownNow, r: PersonRow) => ageFrom(r.born_day, t.day);
const grown = (t: TownNow, r: PersonRow) => ageOf(t, r) >= speciesOf(r.species).adultAge;
const pick = <T>(rng: Rng, xs: T[]): T | undefined => (xs.length > 0 ? xs[Math.floor(rng() * xs.length)] : undefined);
const kingdomOf = (t: TownNow) => {
  const k = t.realm.settlements[t.site]?.kingdom;
  return k ? t.realm.kingdoms[k] : undefined;
};

type Binder = (t: TownNow, need: Need, rng: Rng, used: Set<string>) => Bound | null;

const free = (used: Set<string>) => (r: PersonRow) => !used.has(r.id);

const BINDERS: Record<NeedKind, Binder> = {
  /** An old person, frail with years, with family at home; a healer if there is one. */
  frail(t, _n, rng, used) {
    const old = t.rows.filter((r) => free(used)(r) && ageOf(t, r) >= speciesOf(r.species).adultAge + 45).sort((a, b) => a.born_day - b.born_day || (a.id < b.id ? -1 : 1));
    const elder = old.slice(0, 3)[Math.floor(rng() * Math.min(3, old.length))];
    if (!elder) return null;
    const kin = t.rows.find((r) => r.id !== elder.id && free(used)(r) && grown(t, r) && (r.mother === elder.id || r.father === elder.id || r.spouse === elder.id || (elder.home !== null && r.home === elder.home)));
    if (!kin) return null;
    const healer = t.rows.find((r) => free(used)(r) && r.id !== kin.id && (r.job === "herbalist" || r.job === "priest" || r.job === "healer"));
    return { roles: { elder: elder.id, kin: kin.id, ...(healer ? { healer: healer.id } : {}) }, words: {}, refs: {} };
  },
  /** Two people of the town at home with a grudge between them heavy enough to break. */
  grievance(t, n, _rng, used) {
    if (!config.chatter) return null;
    let best: { who: string; against: string; w: number } | null = null;
    const here = new Map(t.rows.map((r) => [r.id, r]));
    for (const r of t.rows) {
      if (used.has(r.id) || !grown(t, r)) continue;
      const s = strongestOf(t.store, r.id, t.day);
      if (!s || s.g.against === "player" || !here.has(s.g.against) || used.has(s.g.against)) continue;
      if (s.weight >= (n.minWeight ?? 0.5) && (!best || s.weight > best.w)) best = { who: r.id, against: s.g.against, w: s.weight };
    }
    return best ? { roles: { avenger: best.who, victim: best.against }, words: {}, refs: { weight: best.w.toFixed(2) } } : null;
  },
  /** Someone with a reason to steal (a gang's man, or the greediest of the poor), and a stall to steal from. */
  thief(t, _n, rng, used) {
    const gangs = new Set(Object.values(t.realm.factions).filter((f) => f.kind === "gang" && f.dissolved === undefined).map((f) => f.id));
    const poor = ["labourer", "porter", "servant", "washer"];
    const sworn = t.rows.filter((r) => free(used)(r) && grown(t, r) && r.faction && gangs.has(r.faction));
    const greedy = t.rows.filter((r) => free(used)(r) && grown(t, r) && poor.includes(r.job) && temperOf(r).greed >= 0.75 && temperOf(r).honesty < 0.4);
    const thief = pick(rng, sworn) ?? pick(rng, greedy);
    if (!thief) return null;
    const stall = pick(rng, t.rows.filter((r) => r.id !== thief.id && free(used)(r) && ["stallholder", "merchant", "baker", "potter", "weaver", "tailor", "cobbler"].includes(r.job)));
    return stall ? { roles: { thief: thief.id, stallholder: stall.id }, words: {}, refs: {} } : null;
  },
  /** Someone from the next place down the road, come in with what they know of the realm. Always there while a road is. */
  stranger(t, _n, rng, used) {
    const s = t.realm.settlements[t.site];
    if (!s) return null;
    for (const n of neighbours(t.realm, t.site).filter((x) => !x.abandoned && !x.fallen).sort((a, b) => a.id.localeCompare(b.id))) {
      const rows = (t.store.people.loadSite(n.id, "full") as PersonRow[]).filter((r) => r.death === null && !r.away && !r.captive && !used.has(r.id) && grown(t, r) && ["porter", "labourer", "merchant", "hunter", "stallholder", "farmer"].includes(r.job));
      const who = pick(rng, rows.sort((a, b) => (a.id < b.id ? -1 : 1)));
      if (who) return { roles: { stranger: who.id }, words: { from: n.name, news: newsFrom(t, n.id) }, refs: { from: n.id } };
    }
    return null;
  },
  /** A pack that roams this place's land, and a farmer whose beasts are out. */
  pack_near(t, _n, rng, used) {
    const pack = Object.values(t.realm.packs).filter((p) => p.near === t.site && p.count >= 2).sort((a, b) => a.id.localeCompare(b.id))[0];
    if (!pack) return null;
    const farmer = pick(rng, t.rows.filter((r) => free(used)(r) && grown(t, r) && (r.job === "farmer" || r.job === "herder")));
    return farmer ? { roles: { farmer: farmer.id }, words: { pack: pack.species }, refs: { pack: pack.id } } : null;
  },
  /** What a household owes: a serf family the lord's dues (where there are serfs), else a poor family a merchant's debt. */
  dues(t, _n, rng, used) {
    const serfs = kingdomOf(t)?.laws.serfdom === true;
    const collector = pick(rng, t.rows.filter((r) => free(used)(r) && grown(t, r) && (serfs ? ["clerk", "guard"].includes(r.job) : ["merchant", "stallholder", "clerk"].includes(r.job))));
    if (!collector) return null;
    // A household is the people of one home (a new world's families are its homes: kin links grow as people are born and wed).
    const households = t.rows.filter((r) => r.id !== collector.id && free(used)(r) && grown(t, r) && r.home !== null && (serfs ? r.cls === "serf" : ["labourer", "farmer", "porter", "washer"].includes(r.job)) && t.rows.some((c) => c.home === r.home && !grown(t, c)));
    const debtor = pick(rng, households);
    return debtor ? { roles: { collector: collector.id, debtor: debtor.id }, words: { owed: serfs ? "the lord's dues" : "what they owe" }, refs: { serfs: serfs ? "1" : "0" } } : null;
  },
  /** A small child of the town and their mother. */
  child(t, _n, rng, used) {
    const motherOf = (c: PersonRow) => (c.mother ? t.rows.find((m) => m.id === c.mother) : undefined) ?? t.rows.find((m) => m.home !== null && m.home === c.home && m.gender === "female" && ageOf(t, m) >= 18 && ageOf(t, m) <= 50);
    const kids = t.rows.filter((r) => free(used)(r) && ageOf(t, r) >= 4 && ageOf(t, r) <= 9 && motherOf(r) && !used.has(motherOf(r)!.id));
    const child = pick(rng, kids);
    return child ? { roles: { child: child.id, mother: motherOf(child)!.id }, words: {}, refs: {} } : null;
  },
  /** A carter or porter of the town on the road in. */
  carter(t, _n, rng, used) {
    const c = pick(rng, t.rows.filter((r) => free(used)(r) && grown(t, r) && ageOf(t, r) < 60 && ["porter", "carter", "merchant"].includes(r.job)));
    return c ? { roles: { carter: c.id }, words: {}, refs: {} } : null;
  },
  /** Raiders or beasts the realm has sent for tonight or tomorrow (`realm.arrivals`), and someone who keeps watch. */
  arrival_due(t, _n, rng, used) {
    const due = (t.realm.arrivals[t.site] ?? []).find((a) => !a.done && (a.kind === "raid" || a.kind === "beasts") && a.day >= t.day && a.day <= t.day + 1);
    if (!due) return null;
    const watch = pick(rng, t.rows.filter((r) => free(used)(r) && grown(t, r) && (r.job === "guard" || r.job === "hunter")));
    return watch ? { roles: { watchman: watch.id }, words: { arrival: due.kind === "raid" ? `raiders of ${due.by}` : `${due.by}` }, refs: { arrivalDay: String(due.day) } } : null;
  },
  /** Someone held in bondage (a slave, or a serf), and the one they belong to. */
  runaway(t, _n, rng, used) {
    const k = kingdomOf(t);
    if (!k || (!k.laws.slavery && !k.laws.serfdom)) return null;
    const here = new Map(t.rows.map((r) => [r.id, r]));
    const bound = t.rows.filter((r) => free(used)(r) && grown(t, r) && (r.cls === "slave" || r.cls === "serf") && r.master_id && here.has(r.master_id) && !used.has(r.master_id));
    const who = pick(rng, bound);
    return who ? { roles: { runaway: who.id, master: who.master_id! }, words: { bond: who.cls === "slave" ? "slave" : "serf" }, refs: {} } : null;
  },
  /** One of the gentry (or higher) of the town, and someone selling in the square. */
  noble(t, _n, rng, used) {
    const high = pick(rng, t.rows.filter((r) => free(used)(r) && grown(t, r) && ["gentry", "noble", "royal"].includes(r.cls)));
    if (!high) return null;
    const vendor = pick(rng, t.rows.filter((r) => free(used)(r) && grown(t, r) && ["stallholder", "baker", "potter", "weaver", "merchant", "farmer"].includes(r.job) && ["commoner", "artisan", "serf"].includes(r.cls)));
    return vendor ? { roles: { noble: high.id, vendor: vendor.id }, words: {}, refs: {} } : null;
  },
  /** Two of the hottest tempers in town, with an inn to drink at. */
  drinkers(t, _n, _rng, used) {
    const s = t.realm.settlements[t.site];
    if (!s || (s.buildings.inn ?? 0) === 0) return null;
    const men = t.rows.filter((r) => free(used)(r) && grown(t, r) && ageOf(t, r) < 55 && ["labourer", "farmer", "porter", "hunter", "carpenter", "smith"].includes(r.job)).map((r) => ({ r, temper: temperOf(r).temper })).sort((a, b) => b.temper - a.temper || (a.r.id < b.r.id ? -1 : 1));
    if (men.length < 2 || men[1]!.temper < 0.6) return null;
    return { roles: { brawler: men[0]!.r.id, other: men[1]!.r.id }, words: {}, refs: {} };
  },
};

/** What someone from `from` would bring: the newest real news their place has heard, else what is true of the roads near it. */
function newsFrom(t: TownNow, from: string): string {
  const heard = t.realm.heard[from] ?? {};
  const known = t.realm.news.filter((n) => heard[n.id] !== undefined && n.importance >= 3).sort((a, b) => b.day - a.day || b.importance - a.importance)[0];
  if (known) return known.text.replace(/\.$/, "");
  const pack = Object.values(t.realm.packs).find((p) => p.near === from && p.count >= 2);
  if (pack) return `${pack.species}s have taken sheep on the road out of ${t.realm.settlements[from]?.name ?? "there"}`;
  const gang = Object.values(t.realm.factions).find((f) => f.kind === "gang" && f.dissolved === undefined && f.seat === from);
  if (gang) return `${gang.name} have been stopping carts on the road`;
  const war = t.realm.wars.find((w) => w.end === undefined);
  if (war) return `there is war: ${war.cause}`;
  const dungeon = Object.values(t.realm.dungeons).find((d) => d.near === from);
  if (dungeon) return `things have been heard moving in ${dungeon.name}`;
  return "the roads are quiet, and that worries the old ones";
}

/** Bind every need of an incident in turn (one person plays one role), or null if any doesn't hold. */
export function bindNeeds(t: TownNow, needs: Need[], key: string): Bound | null {
  const rng = streamFor(t.realm.seed, "first-hour", t.site, key);
  const used = new Set<string>();
  const out: Bound = { roles: {}, words: {}, refs: {} };
  // The fallback (no needs) still has its stranger.
  for (const need of needs.length > 0 ? needs : [{ kind: "stranger" as const }]) {
    const b = BINDERS[need.kind](t, need, rng, used);
    if (!b) return null;
    for (const id of Object.values(b.roles)) used.add(id);
    Object.assign(out.roles, b.roles);
    Object.assign(out.words, b.words);
    Object.assign(out.refs, b.refs);
  }
  return out;
}
