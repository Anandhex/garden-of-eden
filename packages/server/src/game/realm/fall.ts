import { CLASS_RANK, type SocialClass } from "@millbrook/shared";
import type { PersonRow } from "../../store/peopleStore.js";
import { streamFor, type Rng } from "../dice.js";
import { killPerson } from "../people/index.js";
import { recordLifeEvent } from "../people/events.js";
import { departHouseholds } from "../people/migration.js";
import type { LifeCtx } from "../people/step.js";
import { ageOn } from "./who.js";
import { raid } from "./diplomacy.js";
import { addDeed, makeFigure } from "./figures.js";
import { mint, payOut, putUp, transfer } from "./ledger.js";
import { killBeast } from "./beasts.js";
import { realmNews, tally } from "./log.js";
import { fight, gangSide, settlementSide } from "./military.js";
import { packSide } from "./wilds.js";
import type { Realm, Settlement } from "./types.js";

/**
 * Fallen places, lairs and strongholds (N26I). A place an attacker breaks doesn't just empty: it falls to whoever broke it.
 * A pack makes it its lair and grows there, hunting the next places' herds; a gang makes it its stronghold, lives in its
 * houses behind a palisade, farms with captives, takes tribute from the weak, raids its neighbours and carries people off.
 * Captives are rows: ransomed home, sold where the law allows it, turned to the gang, or they escape and bring the news.
 * The world answers (quests, the lord's soldiers), and a place won back is a ruin until those who fled it come home.
 * Everyone here is someone (plans README §21): refugees, captives, recruits and the dead are rows or figures.
 */

/** How much stronger an attacker must be than what's left of a place to break it. */
export const BREAK_RATIO = 4;
/** Fewer able fighters than this left, and a place is broken by any win. */
export const BROKEN_BELOW = 4;
/** How much more a lair feeds a pack (shelter, feral livestock, fields gone wild). */
export const LAIR_CAP = 1.5;
/** A stronghold's week: tribute, raids, recruits, captives. */
export const STRONGHOLD_EVERY = 7;
/** A ruin nobody comes back to in this many days stays a ruin. */
export const RUIN_YEARS_DAYS = 48;

export interface Captivity {
  by: string;
  since: number;
  worth: number;
  use: "labour" | "ransom" | "sale" | "turning";
  /** The place they were taken from (their home). */
  home: string;
  ransom?: { asked: number; sent: number };
}

export const captivityOf = (r: Pick<PersonRow, "captive">): Captivity | null => (r.captive ? (JSON.parse(r.captive) as Captivity) : null);

const able = (rows: PersonRow[], day: number) => rows.filter((r) => r.death === null && !r.away && !r.captive && ageOn(r, day) >= 16 && ageOn(r, day) <= 55);

/** What a captive is worth to those who hold them: by class (a noble's ransom), and labour. */
export function worthOf(r: PersonRow): number {
  return Math.max(1, (CLASS_RANK[r.cls as SocialClass] ?? 2) - 1);
}

/** The places broken today: each falls, or stands. */
export function fallsDay(ctx: LifeCtx, day: number): string[] {
  const { realm } = ctx;
  const lines: string[] = [];
  const due = realm.falls.filter((f) => f.day <= day);
  realm.falls = realm.falls.filter((f) => f.day > day);
  for (const f of due) {
    const s = realm.settlements[f.site];
    if (!s || s.way || s.fallen || s.abandoned) continue;
    // A capital or a kingdom's seat falls only to an army (N55), never to a pack; a gang must be very large.
    if (s.kind === "capital") continue;
    if (f.to === "pack" && (s.kind === "city" || s.kind === "town")) continue;
    const rows = ctx.store.people.count(s.id) > 0 ? (ctx.store.people.loadSite(s.id, "full") as PersonRow[]) : [];
    const fighters = rows.length > 0 ? able(rows, day).length : Math.round(s.population * 0.3);
    const defence = settlementSide(realm, s).strength;
    const attack = f.to === "pack" ? (realm.packs[f.id] ? packSide(realm, realm.packs[f.id]!).strength : 0) : realm.factions[f.id] ? gangSide(realm, f.id).strength : 0;
    if (fighters >= BROKEN_BELOW && attack < defence * BREAK_RATIO) continue;
    // Beasts break a hamlet; a village only when nobody is left to fight.
    if (f.to === "pack" && s.kind !== "hamlet" && fighters >= BROKEN_BELOW) continue;
    lines.push(...fallPlace(ctx, s, f.to, f.id, day, f.how));
  }
  return lines;
}

/** The place falls: its people flee (remembering where they came from), bandits take captives, and it's a lair or a stronghold. */
export function fallPlace(ctx: LifeCtx, s: Settlement, to: "pack" | "gang", id: string, day: number, how: string): string[] {
  const { realm, store } = ctx;
  const rng = streamFor(realm.seed, "fall", s.id, day);
  s.fallen = { to, id, day, how };
  s.abandoned = true;
  tally(realm, "fallen");
  const rows = (store.people.loadSite(s.id, "full") as PersonRow[]).filter((r) => r.death === null && !r.away);
  // Bandits carry off the young, the strong, the skilled and anyone worth a ransom.
  const taken: PersonRow[] = [];
  if (to === "gang") {
    const pool = rows.filter((r) => ageOn(r, day) >= 8 && ageOn(r, day) <= 40).sort((a, b) => worthOf(b) - worthOf(a) || (a.id < b.id ? -1 : 1));
    for (const r of pool.slice(0, Math.min(6, Math.ceil(pool.length * 0.2)))) {
      takeCaptive(ctx, r, id, s.id, day, rng);
      taken.push(r);
    }
  }
  // The rest flee to the nearest place that will have them, and remember where they came from.
  const refuge = s.roads.map((x) => realm.settlements[x]).filter((x): x is Settlement => !!x && !x.way && !x.abandoned && !x.fallen).sort((a, b) => b.prosperity - a.prosperity || (a.id < b.id ? -1 : 1))[0];
  const fleeing = rows.filter((r) => !taken.includes(r));
  for (const r of fleeing) store.people.update(r.id, { origin: JSON.stringify({ site: s.id, day, why: "fled" }) });
  if (refuge && fleeing.length > 0) departHouseholds(ctx, s, refuge, fleeing.length, rng, day, { everyone: true });
  else if (refuge && rows.length === 0) {
    refuge.population += s.population;
    s.population = 0;
  }
  for (const f of Object.values(realm.figures)) if (f.alive && f.home === s.id && f.role !== "bandit" && f.role !== "bandit chief") f.home = refuge?.id ?? null;
  if (to === "pack") {
    const p = realm.packs[id];
    if (p) {
      p.near = s.id;
      p.cap = Math.round(p.cap * LAIR_CAP);
    }
    realmNews(realm, day, s.id, "fallen", `${s.name} has fallen to the ${p?.species ?? "beast"}s: its people have fled${refuge ? ` to ${refuge.name}` : ""}, and the ${p?.species ?? "beast"}s den in its ruins.`, 7, [s.name, ...(refuge ? [refuge.name] : [])]);
  } else {
    const g = realm.factions[id];
    if (g) {
      g.seat = s.id;
      for (const m of g.members) if (realm.figures[m]?.alive) realm.figures[m]!.home = s.id;
    }
    s.buildings.walls = Math.max(1, s.buildings.walls ?? 0);
    s.stores = { food: 30, coin: 0, goods: {}, livestock: { sheep: Math.max(2, Math.round(rows.length / 6)) } };
    realmNews(realm, day, s.id, "fallen", `${g?.name ?? "Bandits"} have taken ${s.name}: they hold it behind a palisade, with ${taken.length} of its people captive; the rest have fled${refuge ? ` to ${refuge.name}` : ""}.`, 8, [s.name, ...(g ? [g.name] : []), ...taken.map((r) => r.name)]);
  }
  s.population = store.people.count(s.id) > 0 ? store.people.livingCount(s.id) : 0;
  return [`${s.name} has fallen.`];
}

/** A person taken: held at the stronghold, by the gang, for labour or ransom. */
export function takeCaptive(ctx: LifeCtx, r: PersonRow, gang: string, stronghold: string, day: number, rng: Rng): void {
  const worth = worthOf(r);
  const c: Captivity = { by: gang, since: day, worth, use: worth >= 3 ? "ransom" : rng() < 0.5 ? "labour" : "turning", home: r.site };
  ctx.store.people.update(r.id, { captive: JSON.stringify(c), site: stronghold, away: null, ...(r.spouse ? {} : {}) });
  recordLifeEvent(ctx.realm, ctx.store, { kind: "kidnapped", actor: r.id, target: gang, site: r.site, day, details: `${r.name} was carried off by ${ctx.realm.factions[gang]?.name ?? "bandits"}`, importance: 6, why: "taken in a raid" });
  tally(ctx.realm, "captives_taken");
}

/** Free a captive: they walk home (or stay where they were set free if home is gone), remembering where they were held. */
export function freeCaptive(ctx: LifeCtx, r: PersonRow, day: number, why: "ransomed" | "escaped" | "freed" | "worked off"): void {
  const c = captivityOf(r);
  if (!c) return;
  const home = ctx.realm.settlements[c.home];
  const to = home && !home.abandoned && !home.fallen ? home : Object.values(ctx.realm.settlements).find((x) => x.roads.includes(r.site) && !x.abandoned && !x.fallen && !x.way);
  ctx.store.people.update(r.id, { captive: null, ...(to ? { site: to.id } : {}), origin: JSON.stringify({ site: r.site, day, why: "freed" }) });
  recordLifeEvent(ctx.realm, ctx.store, { kind: "freed", actor: r.id, target: c.by, site: to?.id ?? r.site, day, details: `${r.name} came home, ${why}`, importance: 5, why });
  tally(ctx.realm, `captives_${why.replace(" ", "_")}`);
}

/** Each day: what happened to the places held by packs and gangs, their captives, and the answer of the places round about. */
export function fallenDay(ctx: LifeCtx, day: number): string[] {
  const { realm } = ctx;
  const lines = fallsDay(ctx, day);
  for (const s of Object.values(realm.settlements).sort((a, b) => (a.id < b.id ? -1 : 1))) {
    // From the day after it fell.
    if (s.fallen && day <= s.fallen.day) continue;
    if (s.fallen?.to === "pack") lairDay(ctx, s, day);
    else if (s.fallen?.to === "gang" && (day - s.fallen.day) % STRONGHOLD_EVERY === 0) lines.push(...strongholdWeek(ctx, s, day));
    if (s.ruinSince !== undefined && (day - s.ruinSince) % STRONGHOLD_EVERY === 3) resettle(ctx, s, day);
  }
  return lines;
}

/** A lair: the pack hunts the next places' herds (their food), and is cleared when fewer than two are left. */
function lairDay(ctx: LifeCtx, s: Settlement, day: number): void {
  const { realm } = ctx;
  const p = realm.packs[s.fallen!.id];
  if (!p || p.count < 2) {
    retake(ctx, s, day, p ? `the ${p.species}s were cleared out` : "the beasts are gone");
    return;
  }
  for (const id of s.roads) {
    const n = realm.settlements[id];
    if (!n || n.way || n.abandoned) continue;
    // Sheep and pigs taken in the night: the herds feed the pack.
    n.food = Math.max(0, n.food - 0.15 * Math.min(3, p.count / 4));
  }
  tally(realm, "lair_days");
  // The answer (N26I decision 8): the places round about put up a bounty, and their hunters go after the lair.
  if ((day - s.fallen!.day) % STRONGHOLD_EVERY !== 0) return;
  const rng = streamFor(realm.seed, "lair", s.id, day);
  for (const id of s.roads) {
    const n = realm.settlements[id];
    if (!n || n.way || n.abandoned || n.fallen) continue;
    if (p.bounty < 100) p.bounty += putUp(realm, `s:${n.id}`, Math.min(120, Math.round(n.treasury * 0.05)), `pack ${p.id}`, day);
    const hunters = Object.values(realm.figures).filter((f) => f.alive && !f.talks && f.home === n.id && (f.role === "hunter" || f.role === "adventurer" || f.role === "captain"));
    const rows = ctx.store.people.count(n.id) > 0 ? (ctx.store.people.loadSite(n.id, "full") as PersonRow[]).filter((r) => r.death === null && !r.away && (r.job === "hunter" || r.job === "guard")).length : Math.round(n.population * 0.02);
    const party = hunters.length + rows;
    if (party === 0 || rng() >= 0.6) continue;
    const kills = Math.min(p.count, 1 + Math.floor(rng() * Math.min(3, 1 + party / 3)));
    const by = hunters[0];
    const store = ctx.store.beasts;
    for (let k = 0; k < kills; k++) {
      const prey = store.living(p.id).at(-1);
      if (prey) killBeast(realm, store, prey.id, day, `hunted out of the lair at ${s.name} by the hunters of ${n.name}`, by?.id ?? null);
    }
    p.count = store.ofPack(p.id).length > 0 ? store.livingCount(p.id) : Math.max(0, p.count - kills);
    if (by && p.bounty > 0) p.bounty -= payOut(realm, `p:${by.id}`, Math.min(p.bounty, 40 * kills), `pack ${p.id}`, undefined, day);
    tally(realm, "lair_hunts");
    if (p.count < 2) {
      retake(ctx, s, day, `the hunters of ${n.name} cleared the ${p.species}s out`);
      return;
    }
  }
}

/** A stronghold's week: it farms, sells, takes tribute, raids, recruits; its captives' fates; the lord may come. */
function strongholdWeek(ctx: LifeCtx, s: Settlement, day: number): string[] {
  const { realm, store } = ctx;
  const g = realm.factions[s.fallen!.id];
  const rng = streamFor(realm.seed, "stronghold", s.id, day);
  const lines: string[] = [];
  const members = g ? g.members.map((m) => realm.figures[m]).filter((f) => f?.alive) : [];
  if (!g || g.dissolved !== undefined || members.length === 0) {
    retake(ctx, s, day, `${g?.name ?? "the gang"} is broken`);
    return lines;
  }
  const st = (s.stores ??= { food: 20, coin: 0, goods: {}, livestock: {} });
  const captives = (store.people.loadSite(s.id, "full") as PersonRow[]).filter((r) => r.death === null && r.captive);
  // The fields, worked by captives and their own; less is grown with fewer hands.
  st.food = Math.max(0, st.food + captives.length * 3 + members.length * 1.5 - members.length * 2.2);
  // Stolen goods sold through a crooked merchant of a nearby town: new coin for the gang.
  const goods = Object.values(st.goods).reduce((a, b) => a + b, 0);
  if (goods > 0) {
    mint(realm, `f:${g.id}`, goods * 4, "stolen goods sold to a fence", undefined, day);
    st.goods = {};
  }
  // Tribute from the weak round about.
  let refused: Settlement | null = null;
  const strength = gangSide(realm, g.id).strength;
  for (const id of s.roads) {
    const n = realm.settlements[id];
    if (!n || n.way || n.abandoned || n.fallen) continue;
    const def = settlementSide(realm, n).strength;
    if (def >= strength) continue;
    const t = ((n.tribute ??= {})[g.id] ??= { amount: Math.max(20, Math.round(n.treasury * 0.05)), last: 0 });
    const head = n.leader ? realm.figures[n.leader] : undefined;
    const pays = def < strength * 0.7 || (head?.bravery ?? 0.5) < 0.4;
    if (pays && transfer(realm, `s:${n.id}`, `f:${g.id}`, t.amount, `tribute to ${g.name}`, undefined, day) > 0) {
      t.last = day;
      delete t.refused;
    } else {
      t.refused = day;
      refused = n;
      realmNews(realm, day, n.id, "tribute", `${n.name} has refused ${g.name}'s demand for tribute.`, 4, [n.name, g.name]);
    }
  }
  // Raid: a place that refused, or the richest weak one when the gang is hungry or poor.
  const hungry = st.food < 15 || g.wealth < 100;
  const target = refused ?? (hungry ? s.roads.map((x) => realm.settlements[x]).filter((x): x is Settlement => !!x && !x.way && !x.abandoned && !x.fallen).sort((a, b) => b.treasury - a.treasury)[0] ?? null : null);
  if (target && rng() < (refused ? 0.8 : 0.6)) {
    const won = raid(realm, gangSide(realm, g.id), `f:${g.id}`, target, day, rng, refused ? "tribute refused" : "hunger");
    if (won) {
      st.food += 15;
      st.goods.loot = (st.goods.loot ?? 0) + 5;
      // People carried off: the young and the strong of the place, by name.
      const pool = (store.people.loadSite(target.id, "full") as PersonRow[]).filter((r) => r.death === null && !r.away && !r.captive && ageOn(r, day) >= 10 && ageOn(r, day) <= 35);
      for (const r of pool.sort((a, b) => worthOf(b) - worthOf(a) || (a.id < b.id ? -1 : 1)).slice(0, 1 + Math.floor(rng() * 3))) takeCaptive(ctx, r, g.id, s.id, day, rng);
      lines.push(`${g.name} raided ${target.name}.`);
    }
  }
  // Recruits: the desperate of the places round about walk in.
  if (g.wealth > 200 || rng() < 0.3) {
    for (const id of s.roads) {
      const n = realm.settlements[id];
      if (!n || n.abandoned || n.food >= 20) continue;
      const desperate = (store.people.loadSite(n.id, "full") as PersonRow[]).filter((r) => r.death === null && !r.away && !r.captive && r.persona === null && ageOn(r, day) >= 16 && ageOn(r, day) <= 40 && (r.cls === "commoner" || r.cls === "serf"));
      const r = desperate[Math.floor(rng() * desperate.length)];
      if (r) lines.push(joinGang(ctx, r, g.id, s.id, day, "hunger"));
      break;
    }
  }
  // The captives: ransomed, sold, turned, or they get away.
  for (const r of captives) lines.push(...captiveWeek(ctx, r, s, day, rng));
  // The world answers: the lord sends soldiers when the gang is a real danger.
  lines.push(...lordAnswers(ctx, s, day, rng));
  return lines;
}

/** Someone joins the gang (a recruit, or a captive turned): a figure of it, living at the stronghold. */
export function joinGang(ctx: LifeCtx, r: PersonRow, gang: string, stronghold: string, day: number, why: string): string {
  const { realm, store } = ctx;
  const g = realm.factions[gang]!;
  const rng = streamFor(realm.seed, "join", r.id, day);
  const fig = makeFigure(realm, rng, { role: "bandit", home: stronghold, tier: "F", age: Math.round(ageOn(r, day)), species: r.species, renown: 5, rose: `person:${r.id}`, name: r.name, faction: gang, wealth: 0, gender: r.gender === "female" ? "female" : "male" }, day);
  fig.person = r.id;
  addDeed(fig, `joined ${g.name} (${why})`);
  g.members.push(fig.id);
  store.people.update(r.id, { captive: null, site: stronghold, faction: gang, figure: fig.id, job: "labourer" });
  recordLifeEvent(realm, store, { kind: "recruited", actor: r.id, target: gang, site: stronghold, day, details: `${r.name} joined ${g.name}`, importance: 4, why });
  tally(realm, "gang_recruits");
  return `${r.name} has joined ${g.name}.`;
}

/** A captive's week. */
function captiveWeek(ctx: LifeCtx, r: PersonRow, s: Settlement, day: number, rng: Rng): string[] {
  const { realm, store } = ctx;
  const c = captivityOf(r)!;
  const g = realm.factions[c.by];
  const home = realm.settlements[c.home];
  // Ransom: a letter goes home; the place (or the lord) pays what's asked if it can.
  if (c.use === "ransom" && home && !home.abandoned) {
    const asked = 80 * c.worth * c.worth;
    if (!c.ransom) {
      c.ransom = { asked, sent: day };
      store.people.update(r.id, { captive: JSON.stringify(c) });
      realmNews(realm, day, home.id, "ransom", `${g?.name ?? "Bandits"} ask ${asked} copper for ${r.name}'s return.`, 5, [r.name, home.name]);
      return [];
    }
    if (day - c.ransom.sent >= 3 && transfer(realm, `s:${home.id}`, `f:${c.by}`, asked, `the ransom of ${r.name}`, undefined, day) >= asked) {
      freeCaptive(ctx, r, day, "ransomed");
      realmNews(realm, day, home.id, "ransom", `${r.name} is home: ${home.name} paid ${g?.name ?? "the bandits"} ${asked} copper.`, 5, [r.name]);
      return [`${r.name} was ransomed.`];
    }
  }
  // Sold, where the kingdom allows slavery: to a slaver of a city of that kingdom.
  const kingdom = s.kingdom ? realm.kingdoms[s.kingdom] : undefined;
  if (kingdom?.laws.slavery && day - c.since >= 14 && c.use !== "ransom" && rng() < 0.4) {
    const market = Object.values(realm.settlements).find((x) => x.kingdom === kingdom.id && (x.kind === "city" || x.kind === "capital") && !x.abandoned);
    if (market) {
      const price = 60 + 20 * c.worth;
      transfer(realm, `s:${market.id}`, `f:${c.by}`, price, `${r.name} sold`, undefined, day);
      store.people.update(r.id, { captive: null, site: market.id, cls: "slave", job: "slave", origin: JSON.stringify({ site: c.home, day, why: "moved" }) });
      recordLifeEvent(realm, store, { kind: "sold", actor: r.id, target: c.by, site: market.id, day, details: `${r.name} was sold as a slave in ${market.name}`, importance: 6, why: "captive" });
      tally(realm, "captives_sold");
      return [`${r.name} was sold.`];
    }
  }
  // Turned: time, fear and need; a grudge against their own lord makes it sooner.
  if (day - c.since >= 12 && rng() < (c.use === "turning" ? 0.35 : 0.1)) return [joinGang(ctx, r, c.by, s.id, day, "turned in captivity")];
  // Escape: courage against the watch. They bring the stronghold's news home.
  if (rng() < 0.06) {
    freeCaptive(ctx, r, day, "escaped");
    if (home) realmNews(realm, day, home.id, "escape", `${r.name} escaped from ${g?.name ?? "the bandits"} at ${s.name} and came home with word of how it's held.`, 6, [r.name, s.name]);
    return [`${r.name} escaped.`];
  }
  return [];
}

/** The lord of the place's kingdom sends soldiers once the gang is a real danger: a fight of real deaths. */
function lordAnswers(ctx: LifeCtx, s: Settlement, day: number, rng: Rng): string[] {
  const { realm } = ctx;
  const g = realm.factions[s.fallen!.id];
  const k = s.kingdom ? realm.kingdoms[s.kingdom] : undefined;
  const seat = k ? realm.settlements[k.capital] : undefined;
  if (!g || !seat || seat.abandoned) return [];
  const gs = gangSide(realm, g.id);
  if (gs.strength < 20 || rng() >= 0.4) return [];
  const army = settlementSide(realm, seat, { defending: false });
  army.strength *= 0.35;
  army.name = `the soldiers of ${seat.name}`;
  const r = fight(realm, army, gs, day, rng, `the attack on ${g.name} at ${s.name}`);
  realmNews(realm, day, s.id, "war", r.attackerWon ? `Soldiers of ${seat.name} stormed ${g.name}'s stronghold at ${s.name}${r.dead.length ? `; ${r.dead.map((f) => f.name).join(" and ")} fell` : ""}.` : `${g.name} threw back the soldiers of ${seat.name} at ${s.name}.`, 6, [seat.name, g.name, ...r.dead.map((f) => f.name)]);
  if (r.attackerWon) {
    // The rest scatter: the gang loses half of who's left, the chief among the first to fall.
    const left = g.members.map((m) => realm.figures[m]).filter((f) => f?.alive);
    const chief = g.leader ? realm.figures[g.leader] : undefined;
    if (chief?.alive && rng() < 0.6) {
      chief.alive = false;
      chief.deathDay = day;
      chief.deathCause = `killed by the soldiers of ${seat.name}`;
    }
    for (const f of left.slice(0, Math.ceil(left.length / 2))) if (f!.alive && rng() < 0.5) {
      f!.alive = false;
      f!.deathDay = day;
      f!.deathCause = `killed by the soldiers of ${seat.name}`;
    }
    g.members = g.members.filter((m) => realm.figures[m]?.alive);
    if (g.members.length <= 2 || !realm.figures[g.leader ?? ""]?.alive) retake(ctx, s, day, `soldiers of ${seat.name} broke ${g.name}`);
  }
  return [];
}

/** Won back: captives go home, the scattered go to the road, and the place is a ruin held by no one. */
export function retake(ctx: LifeCtx, s: Settlement, day: number, why: string): void {
  const { realm, store } = ctx;
  const was = s.fallen;
  if (!was) return;
  for (const r of (store.people.loadSite(s.id, "full") as PersonRow[]).filter((x) => x.death === null && x.captive)) freeCaptive(ctx, r, day, "freed");
  if (was.to === "gang") {
    const g = realm.factions[was.id];
    if (g) {
      const elsewhere = s.roads.map((x) => realm.settlements[x]).find((x) => x && !x.abandoned && !x.way);
      g.seat = elsewhere?.id ?? null;
      for (const m of g.members) if (realm.figures[m]?.alive) realm.figures[m]!.home = null;
      if (g.members.every((m) => !realm.figures[m]?.alive)) g.dissolved = day;
    }
    delete s.stores;
  } else {
    const p = realm.packs[was.id];
    const elsewhere = s.roads.map((x) => realm.settlements[x]).find((x) => x && !x.abandoned && !x.way);
    if (p && elsewhere) p.near = elsewhere.id;
  }
  delete s.fallen;
  s.ruinSince = day;
  tally(realm, "retaken");
  realmNews(realm, day, s.id, "retaken", `${s.name} is free again (${why}), but empty: its houses burned and its fields gone to weed.`, 6, [s.name]);
}

/** Those who fled a ruin may come back to it, if where they live now is poor or their kin are there; then it's a hamlet again. */
function resettle(ctx: LifeCtx, s: Settlement, day: number): void {
  const { realm, store } = ctx;
  if (day - s.ruinSince! > RUIN_YEARS_DAYS * 2) return;
  const rng = streamFor(realm.seed, "resettle", s.id, day);
  // Who remembers it: rows whose origin is this place, living elsewhere now.
  const near = s.roads.map((x) => realm.settlements[x]).filter((x): x is Settlement => !!x && !x.abandoned && !x.way);
  for (const n of near) {
    const fled = (store.people.loadSite(n.id, "full") as PersonRow[]).filter((r) => r.death === null && !r.away && r.origin && (JSON.parse(r.origin) as { site: string }).site === s.id);
    if (fled.length === 0) continue;
    if (n.prosperity > 55 && rng() < 0.6) continue;
    s.abandoned = false;
    s.kind = "hamlet";
    delete s.ruinSince;
    departHouseholds(ctx, n, s, Math.min(fled.length, 12), rng, day);
    realmNews(realm, day, s.id, "resettled", `Families who fled ${s.name} have gone back to it: it's a hamlet again, with its old name and its graves.`, 6, [s.name, n.name]);
    tally(realm, "resettled");
    return;
  }
  // Nobody with rows remembers it (a place whose people were never rows): a few come back now and then.
  if (store.people.count(s.id) === 0 && near.length > 0 && rng() < 0.15) {
    s.abandoned = false;
    s.kind = "hamlet";
    delete s.ruinSince;
    const from = near[0]!;
    const n = Math.min(12, Math.floor(from.population * 0.05));
    if (n >= 8) {
      from.population -= n;
      s.population = n;
      realmNews(realm, day, s.id, "resettled", `Folk have gone back to ${s.name}: it's a hamlet again.`, 5, [s.name]);
      tally(realm, "resettled");
    } else {
      s.abandoned = true;
      s.ruinSince = day;
    }
  }
}

/** For bounds and tests: every captive alive, with a captor that exists (or freed, sold, turned or dead on record). */
export function captivesAccounted(realm: Realm, rows: PersonRow[]): { held: number; lost: number } {
  let held = 0;
  let lost = 0;
  for (const r of rows) {
    const c = captivityOf(r);
    if (!c || r.death !== null) continue;
    held++;
    if (!realm.factions[c.by] || realm.factions[c.by]!.dissolved !== undefined) lost++;
  }
  return { held, lost };
}

export { killPerson };
