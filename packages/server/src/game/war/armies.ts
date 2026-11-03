import type { PlayerState } from "../../npc/types.js";
import type { PersonRow } from "../../store/peopleStore.js";
import type { Rec } from "../../store/recordStore.js";
import { config } from "../../config.js";
import { addGrievance } from "../chatter/grievance.js";
import { unitFor } from "../dice.js";
import { learn } from "../gossip/knowledge.js";
import { eventRef } from "../gossip/refs.js";
import { parseDeath } from "../people/death.js";
import { recordLifeEvent } from "../people/events.js";
import { ageFrom } from "../people/rules.js";
import type { LifeCtx, SiteStep } from "../people/step.js";
import { policyAt } from "../realm/policy.js";
import type { Party, Realm, War } from "../realm/types.js";
import { speciesOf } from "../../world/species.js";

/**
 * Armies, soldiers and the war dead (N55). A war raises an **army** per kingdom at war (`realm.society.armies`), with a levy laid on each of
 * its places by its `levy` law (light: one in twenty of the fighting-age, heavy: one in ten; serfs first where serfdom is law). Each place's
 * own day picks its levies from its real people: grown, of fighting age, not the only grown one of their household. A soldier is away
 * (`people.away`, purpose "war", journey = the army) and has a record (kind "soldier") with their rank and the battles they've lived through.
 * A battle's dead are drawn from the soldiers first (people/casualties.ts) and carry the war and side on their death record; each is on the
 * war's **roll of the fallen** (kind "war_dead"), never mixed with plague or famine. Ranks rise with battles survived (soldier after one,
 * sergeant after three, lieutenant after six). Families grieve, and one may hold the enemy's ruler to blame. At the peace the living come
 * home, and the missing turn up, some of them.
 */
export const RANKS = ["levy", "soldier", "sergeant", "lieutenant", "captain"] as const;
export type Rank = (typeof RANKS)[number];
export const RANK_AT: Record<Rank, number> = { levy: 0, soldier: 1, sergeant: 3, lieutenant: 6, captain: 10 };

export interface Army {
  id: string;
  war: string;
  party: Party;
  side: "attackers" | "defenders";
  since: number;
  /** How many each place owes, and how many it has sent. */
  levy: Record<string, number>;
  raised: Record<string, number>;
  status: "mustering" | "fighting" | "disbanded";
  ended?: number;
}

export interface SoldierData {
  army: string;
  war: string;
  home: string;
  rank: Rank;
  joined: number;
  how: "levy" | "volunteer";
  battles: number;
  status: "serving" | "dead" | "missing" | "discharged" | "deserted";
}

export interface WarDeadData {
  war: string;
  battle: string;
  side: string;
  rank: Rank;
  day: number;
  cause: string;
  home: string;
  name: string;
}

export function armiesOf(realm: Realm): Army[] {
  const soc = (realm.society ??= {});
  return (soc.armies ??= []) as Army[];
}
export const peekArmies = (realm: Realm): Army[] => (realm.society?.armies as Army[] | undefined) ?? [];

/** The places of a party (a kingdom's places, a settlement, a faction's seat) that raise its levies. */
function placesOf(realm: Realm, p: Party): string[] {
  if (p.startsWith("k:")) return Object.values(realm.settlements).filter((s) => s.kingdom === p.slice(2) && !s.way && !s.abandoned && !s.fallen).map((s) => s.id).sort();
  if (p.startsWith("s:")) return [p.slice(2)];
  return [];
}

/** The realm's day: armies raised for new wars, levies laid on the places; armies of ended wars stood down. */
export function armiesRealmDay(realm: Realm, day: number): void {
  if (!config.society.armies) return;
  const armies = armiesOf(realm);
  for (const w of realm.wars) {
    for (const [side, parties] of [["attackers", w.attackers], ["defenders", w.defenders]] as const) {
      for (const p of parties) {
        if (!p.startsWith("k:") && !p.startsWith("s:")) continue;
        const id = `army:${w.id}:${p.slice(2)}`;
        let a = armies.find((x) => x.id === id);
        if (!a && w.end === undefined) {
          const k = p.startsWith("k:") ? p.slice(2) : (realm.settlements[p.slice(2)]?.kingdom ?? null);
          const heavy = k ? policyAt(realm, realm.kingdoms[k]?.capital ?? "", "levy", day) === "heavy" : false;
          const levy: Record<string, number> = {};
          for (const site of placesOf(realm, p)) levy[site] = Math.max(1, Math.round((realm.settlements[site]!.population * 0.3) / (heavy ? 10 : 20)));
          armies.push((a = { id, war: w.id, party: p, side, since: day, levy, raised: {}, status: "mustering" }));
        }
        if (a && w.end !== undefined && a.status !== "disbanded") {
          a.status = "disbanded";
          a.ended = w.end;
        } else if (a && a.status === "mustering" && day - a.since >= 2) a.status = "fighting";
      }
    }
  }
  // Long-ended armies are forgotten (their soldiers' records stay).
  realm.society!.armies = armies.filter((a) => a.status !== "disbanded" || day - (a.ended ?? day) < 96);
}

/**
 * The share of a battle's dead that fall among each side's soldiers from other places (warsDay asks): by the soldiers each place sent.
 * `at` already takes its own share (the field it's fought on). Returns casualty orders by place.
 */
export function soldierOrders(realm: Realm, w: War, side: "attackers" | "defenders", lost: number, _day: number, at: string): Array<{ site: string; n: number }> {
  if (!config.society.armies || lost <= 0) return [];
  const raised = new Map<string, number>();
  for (const a of peekArmies(realm).filter((x) => x.war === w.id && x.side === side && x.status !== "disbanded")) for (const [site, n] of Object.entries(a.raised)) if (site !== at && n > 0) raised.set(site, (raised.get(site) ?? 0) + n);
  const total = [...raised.values()].reduce((x, y) => x + y, 0);
  if (total === 0) return [];
  // About half the dead come from the levies of other places; the rest from the field's own people.
  const share = Math.round(lost * 0.5);
  return [...raised].sort((a, b) => a[0].localeCompare(b[0])).map(([site, n]) => ({ site, n: Math.max(0, Math.min(n, Math.round((share * n) / total))) })).filter((o) => o.n > 0);
}

const fightingAge = (r: PersonRow, day: number) => {
  const sp = speciesOf(r.species);
  const age = ageFrom(r.born_day, day);
  return age >= sp.adultAge && age < Math.min(sp.elderAge, sp.adultAge + 30);
};

/** A place's soldiers on a day: levies raised, ranks for battles survived, the fallen on the roll, the living home at the peace. */
export function soldiersSiteDay(ctx: LifeCtx, step: Pick<SiteStep, "site" | "deaths">, day: number): { levied: string[]; promoted: string[]; fallen: string[]; home: string[] } {
  const out = { levied: [] as string[], promoted: [] as string[], fallen: [] as string[], home: [] as string[] };
  if (!config.society.armies) return out;
  const { realm, store } = ctx;
  const site = step.site;
  const armies = peekArmies(realm);
  // ---- Levies ----
  for (const a of armies.filter((x) => x.status !== "disbanded" && (x.levy[site] ?? 0) > (x.raised[site] ?? 0))) {
    const rows = (store.people.loadSite(site, "full") as PersonRow[]).filter((r) => r.death === null && !r.away && !r.captive);
    const k = realm.settlements[site]?.kingdom ? realm.kingdoms[realm.settlements[site]!.kingdom!] : undefined;
    const homes = new Map<number | null, number>();
    for (const r of rows) if (r.job !== "child") homes.set(r.home, (homes.get(r.home) ?? 0) + 1);
    const fodder = k?.laws.slavery;
    const pool = rows
      .filter((r) => r.gender === "male" && fightingAge(r, day) && (homes.get(r.home) ?? 0) > 1 && (r.cls !== "slave" || fodder) && !["noble", "royal", "clergy"].includes(r.cls))
      .sort((x, y) => Number(y.cls === "serf") - Number(x.cls === "serf") || unitFor(realm.seed, "levy", a.id, x.id) - unitFor(realm.seed, "levy", a.id, y.id));
    const want = (a.levy[site] ?? 0) - (a.raised[site] ?? 0);
    for (const r of pool.slice(0, want)) {
      store.people.update(r.id, { away: JSON.stringify({ journey: a.id, since: (day - 1) * 1440 + 8 * 60, purpose: "war", returns: true }) });
      store.careers.startJob(r.id, "soldier:levy", site, day);
      store.records.put<SoldierData>({ id: `soldier:${r.id}:${a.war}`, kind: "soldier", site, a: r.id, b: a.id, since: day, status: "serving", ended: null, data: { army: a.id, war: a.war, home: site, rank: "levy", joined: day, how: "levy", battles: 0, status: "serving" } });
      recordLifeEvent(realm, store, { kind: "levied", actor: r.id, site, day, details: `${r.name} was levied for the war and marched away`, importance: 3, witnesses: rows.filter((x) => x.home === r.home && x.id !== r.id).map((x) => x.id).slice(0, 4) });
      out.levied.push(r.id);
    }
    a.raised[site] = (a.raised[site] ?? 0) + Math.min(want, pool.length);
    // A place with nobody left to send owes nothing more.
    if (pool.length < want) a.levy[site] = a.raised[site]!;
  }
  // ---- The fallen ----
  for (const d of step.deaths) {
    if (!d.record.war) continue;
    const sol = store.records.get<SoldierData>(`soldier:${d.id}:${d.record.war}`);
    const rank = sol?.data.rank ?? "levy";
    const missing = d.record.cause === "missing";
    store.records.put<WarDeadData>({ id: `wardead:${d.id}`, kind: "war_dead", site: d.record.site, a: d.id, b: d.record.war, since: day, status: missing ? "missing" : "fallen", ended: null, data: { war: d.record.war, battle: d.record.event ?? "", side: d.record.side ?? "", rank, day, cause: missing ? "missing" : d.record.cause, home: site, name: d.name } });
    if (sol) store.records.patch<SoldierData>(sol.id, { status: missing ? "missing" : "dead", data: { status: missing ? "missing" : "dead" } });
    out.fallen.push(d.id);
    if (missing) continue;
    // The family grieves; one of them lays it at the enemy ruler's door.
    const dead = store.people.get(d.id);
    const kin = [dead?.spouse, dead?.mother, dead?.father, ...store.people.childrenOf(d.id).map((c) => c.id)].filter((x): x is string => !!x).map((id) => store.people.get(id)).filter((r): r is PersonRow => !!r && r.death === null && r.job !== "child");
    const w = realm.wars.find((x) => x.id === d.record.war);
    const enemy = w ? (d.record.side === "attackers" ? w.defenders : w.attackers).find((p) => p.startsWith("k:")) : undefined;
    const ruler = enemy ? realm.kingdoms[enemy.slice(2)]?.ruler : null;
    const mourner = kin[0];
    if (mourner && ruler) addGrievance(store, { who: mourner.id, against: ruler, cause: `wardead:${d.id}`, weight: 0.6, day });
    const e = recordLifeEvent(realm, store, { kind: "war-dead", actor: d.id, target: ruler ?? "", site, day, details: `${d.name} fell in ${d.record.event?.startsWith("battle:") ? `the battle at ${realm.settlements[d.record.event.split(":")[2] ?? ""]?.name ?? "the front"}` : "the war"}`, importance: 5, witnesses: kin.map((k) => k.id) });
    for (const k of kin) learn(ctx, k.id, eventRef(e.id), { day, source: "told", accuracy: 1 });
  }
  // ---- Serving soldiers: battles survived, ranks; the peace sends them home ----
  for (const sol of store.records.open<SoldierData>("soldier", (x) => x.site === site && x.data.status === "serving")) {
    const w = realm.wars.find((x) => x.id === sol.data.war);
    const r = sol.a ? store.people.get(sol.a) : null;
    if (!r || r.death !== null) continue;
    if (!w || w.end !== undefined) {
      store.people.update(r.id, { away: null });
      store.careers.endJob(r.id, `soldier:${sol.data.rank}`, day);
      store.records.end(sol.id, day, "discharged", { status: "discharged" });
      recordLifeEvent(realm, store, { kind: "migration", actor: r.id, site, day, key: `${r.id}:home-from-war`, details: `${r.name} came home from the war, a ${sol.data.rank}`, importance: 3 });
      out.home.push(r.id);
      continue;
    }
    const battles = w.battles.filter((b) => b.day > sol.data.joined).length;
    if (battles === sol.data.battles) continue;
    let rank = sol.data.rank;
    for (const k of RANKS) if (battles >= RANK_AT[k]) rank = k;
    if (rank !== sol.data.rank) {
      store.careers.endJob(r.id, `soldier:${sol.data.rank}`, day);
      store.careers.startJob(r.id, `soldier:${rank}`, site, day);
      recordLifeEvent(realm, store, { kind: "promoted", actor: r.id, site, day, key: `${r.id}:${rank}`, details: `${r.name} was made ${rank} after ${battles} battles`, importance: 3 });
      out.promoted.push(r.id);
    }
    store.records.patch<SoldierData>(sol.id, { data: { battles, rank } });
  }
  // ---- The missing, after the peace: some come home ----
  for (const m of store.records.open<WarDeadData>("war_dead", (x) => x.data.home === site && x.status === "missing")) {
    const w = realm.wars.find((x) => x.id === m.data.war);
    const r = m.a ? store.people.get(m.a) : null;
    if (!r || !w || w.end === undefined) continue;
    const rec = parseDeath(r.death);
    if (rec?.cause !== "missing") continue;
    if (unitFor(realm.seed, "found", r.id, day) >= 0.08) continue;
    store.people.update(r.id, { death: null, away: null });
    store.records.end(m.id, day, "came home");
    const sol = store.records.get<SoldierData>(`soldier:${r.id}:${m.data.war}`);
    if (sol) store.records.end(sol.id, day, "discharged", { status: "discharged" });
    recordLifeEvent(realm, store, { kind: "migration", actor: r.id, site, day, key: `${r.id}:found`, details: `${r.name}, missing since the war, came home`, importance: 6 });
    out.home.push(r.id);
  }
  return out;
}

/** The roll of the fallen of a war: by battle, with each one's rank and home. */
export function rollOfTheFallen(store: LifeCtx["store"], war: string): Array<Rec<WarDeadData>> {
  return store.records.list<WarDeadData>("war_dead", (r) => r.data.war === war).sort((a, b) => a.data.day - b.data.day || a.id.localeCompare(b.id));
}

/** The player enlists in their kingdom's army in a war (N55 decision 8): a soldier with a rank, who rises as anyone does. */
export function enlist(realm: Realm, p: PlayerState, kingdomId: string, day: number): string[] {
  const a = peekArmies(realm).find((x) => x.party === `k:${kingdomId}` && x.status !== "disbanded");
  if (!a) return ["There's no war to sign up for."];
  p.society ??= {};
  p.society.army = { army: a.id, war: a.war, rank: "soldier", joined: day, battles: 0 };
  return [`You put your mark to the roll of ${realm.kingdoms[kingdomId]?.name ?? "the crown"}'s army. A soldier now.`];
}
