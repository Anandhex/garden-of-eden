import { CLASS_COLORS, CLASS_RANK, CLASS_WORDS, type CrowdRoster, hashStr, honorific, JOB_INFO, type Job, seeded, type SocialClass, type Townsperson } from "@millbrook/shared";
import { parsePersona } from "../../npc/personaSchema.js";
import { assemblePersona, fallbackIdentity, rollTemplate, type NpcTemplate, type Where } from "../../npc/templates.js";
import type { NpcPersona } from "../../npc/types.js";
import { config } from "../../config.js";
import type { PeopleStore, PersonRow } from "../../store/peopleStore.js";
import type { Rng } from "../dice.js";
import type { Tier } from "../life.js";
import type { Building } from "../../web/map.js";
import { FACTION_OF_TEMPLATE } from "../factions.js";
import { titled } from "./figures.js";
import { knowsFor } from "./lore.js";
import { personName } from "./names.js";
import type { Realm, RealmFaction, Settlement, SettlementKind } from "./types.js";

/**
 * The townsfolk (N16): every one of a place's people, not just its notables. A
 * town of a thousand has a thousand people on its map, each with a name, an age,
 * a class (slave, serf, commoner, craftsman, merchant, cleric, gentry, noble or
 * royal), a job, a home, a workplace, maybe a master and maybe a faction. Who they
 * are is rolled here from the realm's seed, person by person, so the same place has
 * the same people every visit and a growing town only adds to the end of the list.
 * Where they are is the shared crowd simulation (@millbrook/shared crowd.ts). None
 * of them costs a model call until the player talks to one: then they become a
 * talking NPC (townsfolkPersona), kept in the save like the notables.
 */

/** Persona id for a townsperson: `t_<site>_<n>`. */
export const townsfolkId = (site: string, n: number) => `t_${site}_${n}`;
/** The site and number in a townsperson id, or null if it isn't one. */
export function parseTownsfolkId(id: string): { site: string; n: number } | null {
  const m = /^t_([a-z0-9_]+)_(\d+)$/.exec(id);
  return m ? { site: m[1]!, n: Number(m[2]) } : null;
}

/** Most townsfolk rolled for one place (a capital's population is about this). */
export const MAX_TOWNSFOLK = 5000;

/**
 * The kingdom's laws on bondage, set when the realm is made (`Kingdom.laws`): one kingdom keeps serfs (bound to the
 * land, owing their lord labour) but no slaves, another keeps slaves, the third keeps neither. Free settlements keep
 * neither.
 */
export function kingdomLaws(realm: Realm, kingdom: string | null): { slavery: boolean; serfdom: boolean } {
  const laws = kingdom ? realm.kingdoms[kingdom]?.laws : undefined;
  return { slavery: laws?.slavery ?? false, serfdom: laws?.serfdom ?? false };
}

/** Shares of each class by kind of place, before the laws (slaves and serfs only where allowed). */
const SHARES: Record<SettlementKind, Partial<Record<SocialClass, number>>> = {
  capital: { noble: 0.03, gentry: 0.04, clergy: 0.03, merchant: 0.09, artisan: 0.17, serf: 0.06, slave: 0.1 },
  city: { noble: 0.02, gentry: 0.035, clergy: 0.025, merchant: 0.08, artisan: 0.16, serf: 0.08, slave: 0.08 },
  town: { noble: 0.004, gentry: 0.02, clergy: 0.015, merchant: 0.06, artisan: 0.14, serf: 0.15, slave: 0.05 },
  village: { gentry: 0.008, clergy: 0.01, merchant: 0.02, artisan: 0.08, serf: 0.35, slave: 0.03 },
  hamlet: { artisan: 0.05, serf: 0.5 },
};

interface Site {
  s: Settlement;
  buildings: Building[];
  zones: Set<string>;
}

export const shade = (hex: string, seed: number) => {
  const f = 0.85 + ((seed % 1000) / 1000) * 0.3;
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number) => Math.max(0, Math.min(255, Math.round(v * f)));
  return `#${[(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => ch(v).toString(16).padStart(2, "0")).join("")}`;
};

/** Factions with a hand in a place: its kingdom's crown and whoever is seated or has a branch there. */
function factionsAt(realm: Realm, s: Settlement): RealmFaction[] {
  return Object.values(realm.factions).filter((f) => f.dissolved === undefined && ((f.kind === "crown" && f.kingdom === s.kingdom) || f.seat === s.id || f.branches.includes(s.id)));
}

/** Pairs of factions here that despise each other: stances below -20, and the old enmities (crown and outlaws, order and cult, merchants and thieves). */
function rivalsAt(facs: RealmFaction[]): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (let i = 0; i < facs.length; i++) {
    for (let j = i + 1; j < facs.length; j++) {
      const a = facs[i]!;
      const b = facs[j]!;
      const kinds = new Set([a.kind, b.kind]);
      const trades = new Set([a.trade, b.trade]);
      const old =
        (kinds.has("crown") && (kinds.has("gang") || kinds.has("rebels"))) ||
        (kinds.has("order") && kinds.has("cult")) ||
        (trades.has("merchants") && trades.has("thieves")) ||
        // Two guilds of one trade in one town: competitors for the same coin.
        (a.trade !== undefined && a.trade === b.trade) ||
        (a.parent === b.id || b.parent === a.id);
      if (old || (a.stances[b.id] ?? 0) < -20 || (b.stances[a.id] ?? 0) < -20) out.push([a.id, b.id]);
    }
  }
  return out;
}

/** Who looks down on whom: the crown's people on the guilds and associations, and a guild on a mere association. */
function scornAt(facs: RealmFaction[], rivals: Array<[string, string]>): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  const isRival = (a: string, b: string) => rivals.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
  for (const a of facs) {
    for (const b of facs) {
      if (a === b || isRival(a.id, b.id)) continue;
      if (a.kind === "crown" && (b.kind === "guild" || b.kind === "association")) out.push([a.id, b.id]);
      else if (a.kind === "guild" && b.kind === "association") out.push([a.id, b.id]);
      else if (a.kind === "order" && b.kind === "cult") out.push([a.id, b.id]);
    }
  }
  return out;
}

const cache = new Map<string, CrowdRoster>();

/** Forget the rolled rosters (the store holds the people now; tests). */
export function forgetRosters(): void {
  cache.clear();
}

/** Everything about a place's crowd but the people themselves. */
interface Shell {
  s: Settlement;
  facs: RealmFaction[];
  laws: { slavery: boolean; serfdom: boolean };
  lord: string | null;
  /** How many townsfolk the place has (its population less its notables). */
  count: number;
  roster: Omit<CrowdRoster, "people">;
}

function shellOf(realm: Realm, site: string, map: { id: string }, day: number): Shell | null {
  const s = realm.settlements[site];
  if (!s || s.abandoned) return null;
  const facs = factionsAt(realm, s);
  const notables = Object.values(realm.figures).filter((f) => f.alive && f.home === site && f.role !== "beast").length;
  const count = Math.max(0, Math.min(MAX_TOWNSFOLK, s.population - notables));
  const lord = s.leader && realm.figures[s.leader]?.alive ? titled(realm.figures[s.leader]!) : null;
  const k = s.kingdom ? realm.kingdoms[s.kingdom] : undefined;
  const ruler = k?.ruler && realm.figures[k.ruler]?.alive ? titled(realm.figures[k.ruler]!) : null;
  const talk = realm.news
    .filter((n) => n.day <= day && n.day >= day - 20 && n.importance >= 4)
    .slice(-5)
    .map((n) => (n.text.length > 110 ? `${n.text.slice(0, 107)}...` : n.text));
  const laws = kingdomLaws(realm, s.kingdom);
  const rivals = rivalsAt(facs);
  return { s, facs, laws, lord, count, roster: { site, map: map.id, place: s.name, lord, ruler, laws, rivals, scorn: scornAt(facs, rivals), talk } };
}

type MapLike = { id: string; buildings: Building[]; zones: Array<{ id: string }> };

/**
 * Roll everyone who lives in a settlement, on its village map: the generator (N16). `people`
 * leaves out the notables (they're talking NPCs already). Kept per place, its size and its map.
 * From N18 on, a world rolls each place once, when it is made, and keeps the people in the
 * database (`rosterFromStore`); this stays as the generator.
 */
export function rosterFor(realm: Realm, site: string, map: MapLike, day: number): CrowdRoster | null {
  const shell = shellOf(realm, site, map, day);
  if (!shell) return null;
  const { s, facs, laws, lord, count } = shell;
  const key = `${realm.seed}|${site}|${map.id}|${count}|${map.buildings.length}|${facs.map((f) => f.id).join(",")}|${s.leader ?? ""}`;
  const hit = cache.get(key);
  if (hit) return { ...hit, talk: shell.roster.talk, lord, ruler: shell.roster.ruler };
  const people = rollPeople(realm, { s, buildings: map.buildings, zones: new Set(map.zones.map((z) => z.id)) }, facs, laws, count, lord);
  const roster: CrowdRoster = { ...shell.roster, people };
  cache.set(key, roster);
  return roster;
}

// ---- The people in the database (N18) ----

/** A townsperson as a `people` row, for the day the world was made. */
export function rowOfTownsperson(p: Townsperson, site: string, day: number): PersonRow {
  const n = parseTownsfolkId(p.id)?.n ?? 0;
  return {
    id: p.id,
    site,
    n,
    name: p.name,
    gender: p.gender,
    species: "human",
    born_day: day - p.age * config.daysPerYear,
    cls: p.cls,
    job: p.job,
    home: p.home,
    work: p.work,
    master: p.master,
    master_id: p.masterId,
    faction: p.faction,
    mother: null,
    father: null,
    spouse: null,
    figure: null,
    persona: null,
    traits: null,
    death: null,
    expecting: null,
    last_birth: null,
    stepped_day: 0,
    outlook: null,
    rev: 0,
  };
}

/** A `people` row as a townsperson on `day`, for a map with `buildings` buildings (a house that isn't there any more becomes the first one). */
export function townspersonOfRow(r: PersonRow, realm: Realm, day: number, fallbackHome: number, buildings: number): Townsperson {
  const home = r.home !== null && r.home < buildings ? r.home : fallbackHome;
  const front = /^front:(\d+)$/.exec(r.work ?? "");
  const work = front && Number(front[1]) >= buildings ? "streets" : (r.work ?? "streets");
  return {
    id: r.id,
    name: r.name,
    gender: r.gender === "female" ? "female" : "male",
    age: Math.max(0, Math.floor((day - r.born_day) / config.daysPerYear)),
    cls: r.cls as SocialClass,
    job: r.job as Job,
    faction: r.faction,
    factionName: r.faction ? (realm.factions[r.faction]?.name ?? null) : null,
    home,
    work,
    master: r.master,
    masterId: r.master_id,
    color: shade(CLASS_COLORS[r.cls as SocialClass], hashStr(r.id)),
  };
}

const fromStore = new WeakMap<PeopleStore, Map<string, { key: string; builtDay: number; people: Townsperson[] }>>();
/** Roll a place's people into the database if it has none yet (a place made after the world was). Returns how many were added. */
export function ensurePeople(store: PeopleStore, realm: Realm, site: string, map: MapLike, day: number): number {
  if (store.count(site) > 0) return 0;
  const roster = rosterFor(realm, site, map, day);
  if (!roster) return 0;
  store.insertMany(roster.people.map((p) => rowOfTownsperson(p, site, day)));
  store.setSeq(site, { stepped: day });
  return roster.people.length;
}

/**
 * Everyone who lives in a settlement, read from the database: the same `CrowdRoster` as the
 * generator makes, with the people as they are now. `people` keeps its identity until someone in
 * the place changes (or a year has passed, for their ages), so the crowd simulation built on it
 * isn't rebuilt every call.
 */
export function rosterFromStore(store: PeopleStore, realm: Realm, site: string, map: MapLike, day: number): CrowdRoster | null {
  const shell = shellOf(realm, site, map, day);
  if (!shell) return null;
  ensurePeople(store, realm, site, map, day);
  const key = `${store.revOf(site)}|${map.id}|${map.buildings.length}`;
  const per = fromStore.get(store) ?? new Map();
  fromStore.set(store, per);
  const hit = per.get(site);
  if (hit && hit.key === key && day - hit.builtDay < config.daysPerYear) return { ...shell.roster, people: hit.people };
  const houses = map.buildings.map((b, i) => ({ b, i })).filter((x) => x.b.kind === "house" && x.b.front).map((x) => x.i);
  const fallbackHome = houses[0] ?? 0;
  const rows = store.loadSite(site, "full") as PersonRow[];
  const people = rows.map((r) => townspersonOfRow(r, realm, day, fallbackHome, map.buildings.length));
  per.set(site, { key, builtDay: day, people });
  return { ...shell.roster, people };
}

function rollPeople(realm: Realm, site: Site, facs: RealmFaction[], laws: { slavery: boolean; serfdom: boolean }, count: number, lord: string | null): Townsperson[] {
  const { s, buildings } = site;
  const of = (kind: string) => buildings.map((b, i) => ({ b, i })).filter((x) => x.b.kind === kind && x.b.front).map((x) => x.i);
  const houses = of("house");
  const manors = of("manor");
  const inns = of("inn");
  const smithies = of("smithy");
  const temples = of("temple");
  const halls = [...of("palace"), ...of("hall")];
  const barracks = of("barracks");
  const guildhalls = of("guildhall");
  const markets = of("market");
  const anyHome = houses.length > 0 ? houses : buildings.map((_, i) => i).slice(0, 1);
  const crown = facs.find((f) => f.kind === "crown");
  const guild = (trade: string) => facs.find((f) => (f.kind === "guild" || f.kind === "association") && f.trade === trade);
  const lodge = facs.filter((f) => f.kind === "order" || f.kind === "cult");
  const gang = facs.find((f) => f.kind === "gang");
  const rebels = facs.find((f) => f.kind === "rebels");
  const zone = (z: string) => site.zones.has(z);

  // Class shares (the laws first: no slaves or serfs where they're not allowed; their share goes to commoners).
  const shares = { ...SHARES[s.kind] };
  if (!laws.slavery) delete shares.slave;
  if (!laws.serfdom) delete shares.serf;

  // The posts every place has filled first: innkeepers, smiths, priests and the royal family.
  type Post = { cls: SocialClass; job: Job; work: string; home?: number };
  const posts: Post[] = [];
  // The first inn and the first forge are kept by the place's notables where it has them (they talk already): no second innkeeper or smith.
  const kept = (role: string) => Object.values(realm.figures).some((f) => f.alive && f.home === s.id && f.role === role);
  const innHeld = kept("innkeeper");
  const smithHeld = kept("smith");
  inns.forEach((i, k) => posts.push(...(k === 0 && innHeld ? [] : [{ cls: "merchant" as const, job: "innkeeper" as const, work: `front:${i}`, home: i }]), { cls: "commoner", job: "server", work: `front:${i}`, home: i }));
  smithies.forEach((i, k) => posts.push(...(k === 0 && smithHeld ? [] : [{ cls: "artisan" as const, job: "smith" as const, work: `front:${i}` }]), { cls: "artisan", job: "apprentice", work: `front:${i}` }));
  for (const i of temples) posts.push({ cls: "clergy", job: "priest", work: `front:${i}`, home: i });
  if (s.kind === "capital") for (let r = 0; r < 4; r++) posts.push({ cls: "royal", job: "royal", work: "home", home: halls[0] });

  const taken = new Set<string>();
  const jobs: Partial<Record<Job, number>> = {};
  const people: Townsperson[] = [];
  const masters: number[] = [];
  const base = hashStr(`${realm.seed}:${s.id}:folk`);
  for (let n = 0; n < count; n++) {
    const rng: Rng = seeded(base + n * 2654435761);
    const post = posts[n];
    let cls: SocialClass = post?.cls ?? "commoner";
    if (!post) {
      let roll = rng();
      for (const [c, share] of Object.entries(shares) as Array<[SocialClass, number]>) {
        if (roll < share) {
          cls = c;
          break;
        }
        roll -= share;
      }
    }
    // A share of everyone is a child or an elder (of their parents' class).
    const life = rng();
    const child = !post && life < 0.2;
    const elder = !post && !child && life > 0.92;
    const gender: "female" | "male" = rng() < 0.5 ? "female" : "male";
    const age = child ? 4 + Math.floor(rng() * 11) : elder ? 61 + Math.floor(rng() * 20) : 16 + Math.floor(rng() * 45);
    let job: Job = post?.job ?? "labourer";
    let work = post?.work ?? "streets";
    const jr = rng();
    if (!post) {
      if (child) job = cls === "slave" ? "slave" : "child";
      else if (elder) job = cls === "slave" ? "slave" : "elder";
      else {
        switch (cls) {
          case "royal":
            job = "royal";
            break;
          case "noble":
            job = s.kind === "capital" && jr < 0.4 ? "courtier" : "noble";
            break;
          case "gentry":
            job = barracks.length > 0 && jr < 0.3 ? "knight" : jr < 0.6 ? "clerk" : jr < 0.8 ? "scholar" : s.kind === "capital" ? "courtier" : "clerk";
            break;
          case "clergy":
            job = temples.length > 0 ? (jr < 0.35 ? "priest" : "acolyte") : "priest";
            break;
          case "merchant":
            job = zone("market") ? (jr < 0.6 ? "stallholder" : "merchant") : jr < 0.5 ? "stallholder" : "merchant";
            break;
          case "artisan":
            job = smithies.length > 0 && jr < 0.15 ? (jr < 0.07 ? "smith" : "apprentice") : (["baker", "baker", "weaver", "carpenter", "cobbler", "tailor", "potter"] as const)[Math.floor(rng() * 7)]!;
            break;
          case "serf":
            job = zone("fields") && jr < 0.75 ? "farmer" : "labourer";
            break;
          case "slave":
            job = "slave";
            break;
          default: {
            const options: Array<[Job, number]> = [
              ["farmer", zone("fields") ? (s.kind === "hamlet" || s.kind === "village" ? 0.45 : 0.15) : 0],
              ["labourer", 0.2],
              ["porter", s.kind === "hamlet" ? 0 : 0.1],
              ["washer", 0.07],
              ["server", inns.length > 0 ? 0.05 : 0],
              ["guard", (s.buildings.walls ?? 0) > 0 || barracks.length > 0 ? 0.08 : 0.02],
              ["miner", zone("exit_road") && (s.buildings.mine ?? 0) > 0 ? 0.12 : 0],
              ["hunter", zone("exit_woods") ? 0.05 : 0],
              ["beggar", s.kind === "town" || s.kind === "city" || s.kind === "capital" ? 0.04 : 0],
              ["adventurer", guild("adventurers") || guildhalls.length > 0 ? 0.03 : 0],
              ["weaver", 0.04],
            ];
            const total = options.reduce((a, [, w]) => a + w, 0);
            let r = jr * total;
            job = "labourer";
            for (const [j, w] of options) {
              if (r < w) {
                job = j;
                break;
              }
              r -= w;
            }
          }
        }
      }
      // No more at one door than could work there: the rest find other work.
      const full = (j: Job, per: number, at: number[]) => (jobs[j] ?? 0) >= per * Math.max(at.length, 0);
      if ((job === "smith" || job === "apprentice") && full(job, 3, smithies)) job = "carpenter";
      if (job === "server" && full(job, 4, inns)) job = "labourer";
      if ((job === "priest" && full(job, 3, temples)) || (job === "acolyte" && full(job, 5, temples))) work = "streets";
      if (job === "innkeeper" && full(job, 1, inns)) job = "merchant";
      if (work !== "streets" || cls !== "clergy") work = workOf(job, { inns, smithies, temples, halls, barracks, guildhalls, markets, zone }, rng);
    }
    jobs[job] = (jobs[job] ?? 0) + 1;
    // Home: royals in the palace, nobles and gentry in manors, clergy at the temple, guards in barracks; bondsmen with their master.
    let home = post?.home ?? anyHome[Math.floor(rng() * anyHome.length)]!;
    let master: string | null = null;
    let masterId: string | null = null;
    if (!post?.home) {
      if ((cls === "royal" || job === "courtier") && halls.length > 0) home = halls[0]!;
      else if ((cls === "noble" || cls === "gentry") && manors.length > 0) home = manors[Math.floor(rng() * manors.length)]!;
      else if (cls === "clergy" && temples.length > 0) home = temples[Math.floor(rng() * temples.length)]!;
      else if (job === "guard" && barracks.length > 0) home = barracks[Math.floor(rng() * barracks.length)]!;
    }
    // Slaves and servants belong to a household above them; serfs are bound to the lord.
    if ((cls === "slave" || (cls === "commoner" && !child && jr < 0.06)) && masters.length > 0) {
      const m = people[masters[Math.floor(rng() * masters.length)]!]!;
      master = m.name;
      masterId = m.id;
      home = m.home;
      if (cls === "commoner") job = "servant";
      if (job === "servant" || (cls === "slave" && rng() < 0.5)) work = `front:${m.home}`;
    } else if (cls === "serf") master = lord;
    if (job === "servant" && !masterId) job = "labourer";
    // Who they're with.
    let faction: RealmFaction | undefined;
    const fr = rng();
    if (crown && (cls === "royal" || job === "courtier" || job === "knight" || job === "guard" || (cls === "noble" && fr < 0.8) || (job === "clerk" && fr < 0.6))) faction = crown;
    else if ((job === "stallholder" || job === "merchant" || job === "innkeeper") && fr < 0.6) faction = guild("merchants");
    else if ((job === "smith" || job === "apprentice") && fr < 0.7) faction = guild("smiths");
    else if (job === "farmer" && fr < 0.3) faction = guild("farmers");
    else if (job === "hunter" && fr < 0.6) faction = guild("hunters");
    else if (job === "adventurer" && fr < 0.8) faction = guild("adventurers");
    else if (cls === "clergy" && fr < 0.2) faction = guild("healers");
    else if ((job === "beggar" || job === "porter") && fr < 0.15) faction = guild("thieves") ?? gang;
    else if ((cls === "serf" || cls === "slave") && fr < 0.1) faction = rebels;
    else if (job === "labourer" && fr < 0.04) faction = gang;
    else if (!child && lodge.length > 0 && fr > 0.96) faction = lodge[Math.floor(rng() * lodge.length)];
    const id = townsfolkId(s.id, n);
    const p: Townsperson = {
      id,
      name: personName(rng, gender, taken),
      gender,
      age,
      cls,
      job,
      faction: faction?.id ?? null,
      factionName: faction?.name ?? null,
      home,
      work,
      master,
      masterId,
      color: shade(CLASS_COLORS[cls], hashStr(id)),
    };
    people.push(p);
    if (!child && (cls === "noble" || cls === "gentry" || cls === "merchant" || cls === "royal")) masters.push(n);
  }
  return people;
}

interface Places {
  inns: number[];
  smithies: number[];
  temples: number[];
  halls: number[];
  barracks: number[];
  guildhalls: number[];
  markets: number[];
  zone: (z: string) => boolean;
}

/** Where a job is done, as the crowd simulation reads it. */
function workOf(job: Job, p: Places, rng: Rng): string {
  const one = (list: number[]) => (list.length > 0 ? `front:${list[Math.floor(rng() * list.length)]}` : null);
  switch (job) {
    case "farmer":
      return p.zone("fields") ? "zone:fields" : "streets";
    case "labourer":
    case "porter":
      return "streets";
    case "washer":
      return "zone:square";
    case "weaver":
    case "baker":
    case "cobbler":
    case "tailor":
    case "potter":
      return "home";
    case "carpenter":
      return rng() < 0.5 ? "home" : "streets";
    case "smith":
    case "apprentice":
      return one(p.smithies) ?? "home";
    case "stallholder":
    case "merchant":
      return p.zone("market") ? "zone:market" : (one(p.markets) ?? "zone:square");
    case "innkeeper":
    case "server":
      return one(p.inns) ?? "zone:square";
    case "guard":
      return rng() < 0.6 ? "zone:gate" : "streets";
    case "knight":
      return one(p.barracks) ?? one(p.halls) ?? "zone:gate";
    case "priest":
    case "acolyte":
      return one(p.temples) ?? "streets";
    case "clerk":
    case "scholar":
      return one(p.halls) ?? one(p.guildhalls) ?? "home";
    case "courtier":
      return one(p.halls) ?? "home";
    case "miner":
      return p.zone("exit_road") ? "out:exit_road" : "streets";
    case "hunter":
      return p.zone("exit_woods") ? "out:exit_woods" : "streets";
    case "adventurer":
      return one(p.guildhalls) ?? one(p.inns) ?? "streets";
    case "slave":
      return p.zone("fields") && rng() < 0.4 ? "zone:fields" : "streets";
    default:
      return "home";
  }
}

// ---------- talking to one ----------

/** What each class makes of the others, for the persona (and so the model plays the pecking order). */
const ATTITUDE: Record<SocialClass, string> = {
  slave: "They are owned, and know it. They keep their eyes down before free folk, flinch at raised voices, and dream of freedom, but only ever whisper it.",
  serf: "They are bound to the land and owe their lord days of labour and a tithe of what they grow. They bow to their betters, resent the lord's demands, and envy free townsfolk.",
  commoner: "They are free but poor. They bow to nobles and gentry in the street and grumble about them behind their backs, look down on slaves and serfs a little, and distrust merchants' prices.",
  artisan: "They take pride in their craft and their guild. They are civil to their betters, think nobles idle, and look down on unskilled labourers.",
  merchant: "They measure people by their coin. They flatter nobles to their faces and envy their privileges, and think the poor lazy.",
  clergy: "They speak for the gods. They are courteous to all, mindful of rank, and expect respect even from nobles.",
  gentry: "They are of good family, a step below the nobility, and anxious to keep that step above the commons. They are curt with common folk and polite upward.",
  noble: "They are high-born and expect deference. They look down on commoners as rough and on merchants as grasping upstarts, and speak to servants only to give orders.",
  royal: "They are of the blood royal. Everyone bows to them; they are used to it, and gracious or cold as the mood takes them.",
};

/** What each job wants out of life (for those whose template is someone else's trade). */
const JOB_GOALS: Partial<Record<Job, string[]>> = {
  farmer: ["Bring the harvest in before the rain", "Keep enough back to last the winter"],
  labourer: ["Find steady work that pays on time", "Keep their back from giving out"],
  porter: ["Carry enough loads to make the day's bread", "Get taken on by a merchant house"],
  washer: ["Finish the washing before the light goes", "Keep the children fed"],
  carpenter: ["Get the commission for the new roof", "Take on an apprentice"],
  apprentice: ["Learn the trade well enough to set up on their own", "Stay on the master's good side"],
  server: ["Get through the evening rush", "Save their tips"],
  guard: ["Get through the watch without trouble", "Be made sergeant"],
  knight: ["Win renown in the lord's service", "Keep their horse and arms in good order"],
  priest: ["Keep the temple full and the gods content", "Comfort the sick"],
  acolyte: ["Be ordained a priest", "Learn every rite by heart"],
  clerk: ["Keep the accounts straight", "Catch the eye of someone important"],
  scholar: ["Finish their treatise", "Find a patron"],
  courtier: ["Rise in favour at court", "Outdo their rivals"],
  noble: ["Keep up the family's name and lands", "Make a good match for their children"],
  royal: ["Keep the crown's honour", "Be seen to be gracious"],
  servant: ["Keep their place in the household", "Save enough to marry"],
  slave: ["Keep out of trouble with their master", "Someday be free"],
  elder: ["See their grandchildren settled", "Be listened to"],
  beggar: ["Get through another day", "Find a warm corner tonight"],
  miner: ["Strike a good seam", "Come up alive every evening"],
  hunter: ["Bring home a stag", "Keep clear of the wolves"],
  adventurer: ["Find work worth the risk", "Make a name"],
};

/** How each kind of person talks, for those whose template is someone else's trade. */
const JOB_SPEECH: Partial<Record<Job, string>> = {
  farmer: "Slow and plain; talks about the weather, the soil and the harvest.",
  labourer: "Blunt and tired; few words, mostly about the work and the pay.",
  porter: "Quick and breathless, always on the way somewhere.",
  washer: "Chatty and sharp-tongued; knows everyone's business from their laundry.",
  carpenter: "Practical and measured; sizes everything up as if it were timber.",
  apprentice: "Eager but careful; quotes their master a lot.",
  server: "Brisk and friendly, used to shouting over a crowd.",
  priest: "Calm and formal, with a blessing ready for everyone.",
  acolyte: "Earnest and a little nervous; quotes scripture.",
  clerk: "Precise and fussy about details.",
  scholar: "Wordy and distracted, prone to tangents.",
  courtier: "Smooth and careful, never quite saying what they mean.",
  noble: "Measured and cool, used to being obeyed.",
  royal: "Gracious and distant, used to every word being heeded.",
  servant: "Polite and quiet, with an eye on the door.",
  slave: "Quiet and careful; speaks only when spoken to.",
  elder: "Slow, rambling, full of how things used to be.",
  beggar: "Wheedling and humble, quick to bless or curse.",
  miner: "Gruff, coughing now and then; talks about the dark and the seams.",
  hunter: "Few words, watchful; talks about tracks and weather.",
  adventurer: "Boastful and restless, always asking about work.",
};

const TEMPLATE_FOR: Partial<Record<Job, string>> = {
  stallholder: "merchant",
  merchant: "merchant",
  innkeeper: "innkeeper",
  baker: "merchant",
  weaver: "merchant",
  cobbler: "merchant",
  tailor: "merchant",
  potter: "merchant",
  smith: "smith",
  guard: "guard",
  knight: "guard",
  child: "child",
};

/**
 * A talking NPC for one of the townsfolk (N16), made the moment the player speaks
 * to them: a template by their job (traders from the merchant's, guards and knights
 * from the guard's, children from the child's, everyone else from the farmer's),
 * with their own name, age, class, job, master and faction, what they think of the
 * other classes, and the lore of their place. Only traders sell: everyone else has
 * nothing for sale and buys nothing. Null if the template's missing or the file
 * doesn't pass the schema.
 */
export function townsfolkPersona(realm: Realm | null, roster: CrowdRoster, p: Townsperson, templates: Record<string, NpcTemplate>): NpcPersona | null {
  const t = templates[TEMPLATE_FOR[p.job] ?? "farmer"] ?? templates.farmer;
  if (!t) return null;
  const rng = seeded(hashStr(p.id));
  const r = rollTemplate(t, rng);
  r.gender = p.gender;
  r.species = "human";
  r.age = p.job === "child" && t.minor ? Math.max(t.age[0], Math.min(t.age[1], p.age)) : Math.max(16, p.age);
  r.voice = { ...t.voice[p.gender], pitch: r.voice.pitch, rate: r.voice.rate };
  // Rank by station: the high-born and the trained a step up.
  r.tier = (CLASS_RANK[p.cls] >= 5 || p.job === "guard" || p.job === "knight" ? "F" : "G") as Tier;
  r.potential = r.tier === "F" ? ("E" as Tier) : ("F" as Tier);
  const settlement = realm?.settlements[roster.site];
  const kingdom = settlement?.kingdom ? realm?.kingdoms[settlement.kingdom]?.name : undefined;
  const where: Where = { place: roster.place, kind: settlement?.kind ?? "village", ...(kingdom ? { kingdom } : {}) };
  const words = fallbackIdentity(t, r, rng, p.name, where);
  const job = JOB_INFO[p.job];
  const clsWord = CLASS_WORDS[p.cls];
  const role = p.job === "child" ? `a child of ${roster.place}` : p.cls === "royal" ? `a prince${p.gender === "female" ? "ss" : ""} of the blood, at the palace of ${roster.place}` : `a ${job.words} of ${roster.place}${clsWord !== job.words ? ` (${clsWord})` : ""}`;
  const fac = p.faction && realm ? realm.factions[p.faction] : undefined;
  const rivals = roster.rivals.filter(([a, b]) => a === p.faction || b === p.faction).map(([a, b]) => (a === p.faction ? b : a)).map((id) => realm?.factions[id]?.name).filter(Boolean);
  const facName = (id: string) => realm?.factions[id]?.name;
  const looksDown = roster.scorn.filter(([a]) => a === p.faction).map(([, b]) => facName(b)).filter(Boolean);
  const resents = roster.scorn.filter(([, b]) => b === p.faction).map(([a]) => facName(a)).filter(Boolean);
  const above = honorific({ cls: "noble", gender: "male", job: "noble" }, p);
  words.backstory = [
    `${p.name} is ${role}.`,
    p.master ? (p.cls === "slave" ? `They are the slave of ${p.master}.` : p.cls === "serf" ? `They are bound to the land of ${p.master}.` : `They serve in the household of ${p.master}.`) : null,
    roster.lord ? (roster.lord === roster.ruler ? `${roster.place} is the seat of ${roster.ruler}.` : `${roster.place} is under ${roster.lord}${roster.ruler ? `, and the crown is ${roster.ruler}'s` : ""}.`) : null,
    fac ? `They belong to ${fac.name} ("${fac.creed}").` : null,
    rivals.length > 0 ? `They despise ${rivals.join(" and ")}.` : null,
    looksDown.length > 0 ? `They look down on ${looksDown.join(" and ")}.` : null,
    resents.length > 0 ? `They resent the airs of ${resents.join(" and ")}.` : null,
    job.sells ? null : "They are no trader and have nothing to sell.",
    ATTITUDE[p.cls],
    CLASS_RANK[p.cls] <= 3 ? `They call a lord "${above}" and bow when one passes.` : null,
  ]
    .filter(Boolean)
    .join(" ")
    .slice(0, 500);
  words.speechStyle = job.sells || TEMPLATE_FOR[p.job] ? words.speechStyle : (JOB_SPEECH[p.job] ?? words.speechStyle);
  if (!job.sells && !TEMPLATE_FOR[p.job] && JOB_GOALS[p.job]) words.goals = [...JOB_GOALS[p.job]!];
  if (p.cls === "noble" || p.cls === "royal") words.speechStyle = `Haughty and precise; speaks to commoners as to servants. ${words.speechStyle}`.slice(0, 300);
  else if (p.cls === "slave") words.speechStyle = `Quiet, careful and deferential; says little and never contradicts free folk. ${words.speechStyle}`.slice(0, 300);
  else if (p.cls === "serf") words.speechStyle = `Plain and wary; touches their forelock to anyone above them. ${words.speechStyle}`.slice(0, 300);
  if (p.cls === "slave" && p.job !== "slave") words.goals = ["Keep out of trouble with their master", "Someday be free", ...words.goals].slice(0, 3);
  const persona = assemblePersona(t, r, words, p.id, where);
  persona.role = role;
  // Only traders sell.
  if (!job.sells) {
    persona.prices = {};
    persona.buys = [];
    // What they carry is their own: no stock of a trade that isn't theirs.
    persona.startingInventory = {};
    delete persona.teaches;
    delete persona.services;
    delete persona.storage;
  }
  // Out and about from waking to bed, as the crowd simulation has them.
  persona.schedule = [
    { from: 6, to: 21, activity: "work", place: "square" },
    { from: 21, to: 6, activity: "sleep", place: "home" },
  ];
  persona.quests = [];
  const kind = FACTION_OF_TEMPLATE[TEMPLATE_FOR[p.job] ?? "farmer"];
  if (kind) persona.faction = kind;
  else delete persona.faction;
  persona.knows = realm && settlement ? knowsFor(realm, settlement) : {};
  try {
    return parsePersona(persona, `townsfolk ${persona.id}`);
  } catch {
    delete persona.armor;
    persona.weapon = t.weapon.at(-1)!;
    try {
      return parsePersona(persona, `townsfolk ${persona.id}`);
    } catch {
      return null;
    }
  }
}

/** The social class a realm figure belongs to, by their office (for notables' files and the crowd's manners). */
export function figureClass(role: string): SocialClass {
  switch (role) {
    case "ruler":
      return "royal";
    case "lord":
    case "noble":
      return "noble";
    case "mayor":
    case "captain":
    case "guildmaster":
      return "gentry";
    case "priest":
      return "clergy";
    case "merchant":
    case "innkeeper":
      return "merchant";
    case "smith":
    case "apprentice":
      return "artisan";
    default:
      return "commoner";
  }
}

export { ATTITUDE as CLASS_ATTITUDE };
