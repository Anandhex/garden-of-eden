import { config } from "../../config.js";
import { streamFor } from "../dice.js";
import { maybeSplit, membersOf } from "../realm/factions.js";
import { addDeed, addRenown } from "../realm/figures.js";
import { realmNews, tally } from "../realm/log.js";
import type { Figure, Party, Realm, RealmFaction, Venture } from "../realm/types.js";
import { seasonDays } from "../weather.js";
import { merge } from "./charter.js";
import { awardEpithet } from "./epithets.js";
import { memberCount, minMembers } from "./members.js";
import { officeFor, placeInst, factionInst } from "./posts.js";
import { addGlory, prestigeOf } from "./prestige.js";
import { effective, noteDay, owedOf, reputeOf } from "./repute.js";
import { challenge } from "./support.js";

/**
 * Every venture can fail, and failure has a price (N69 decision 8). A venture is a raid, a war, a conquest, a guild takeover or a delve
 * led by a named figure. `ventureOutcome` is called at the end of each, and applies by its size:
 *
 * - the leader who called it: renown up if it was won (more for a just cause, less, or a loss, for greed against the weak), down if it
 *   failed (more if their own side was routed); this is what takes a leader below zero;
 * - those who went: a little renown, and loyalty to the leader up, or loyalty and respect down; the families of their dead bear the leader
 *   a grievance (owed to the people table: game/office/day.ts);
 * - the faction: prestige up and loot, or prestige down and, for a season, a lieutenant likelier to break away and members paying less;
 * - a failed conquest costs its leader the most (15..20), their captain or lieutenant half that; below −30, or with its prestige halved,
 *   the lieutenant's split check runs at once. Three ventures lost in two years and the leader is challenged.
 */

export type VentureKind = "raid" | "war" | "conquest" | "takeover" | "delve" | "defence";

export interface VentureRun {
  kind: VentureKind;
  /** The figure who called it (the head of the raiding place, the ruler, a faction's leader, the delve's leader). */
  leader?: string;
  /** Their captain or lieutenant, who led it in the field. */
  captain?: string;
  /** The faction whose venture it was (a gang's raid, a guild's takeover or delve). */
  faction?: string;
  /** Who went (figure ids). */
  went?: string[];
  won: boolean;
  /** A just cause: defence, a debt owed, a broken treaty. */
  just?: boolean;
  /** Greed against the weak: a gang or a greedy head raiding a weaker place. */
  greedWeak?: boolean;
  /** Their own side lost more than half. */
  routed?: boolean;
  /** The place whose dead it was, and the cause ref of the deaths, for grievances against the leader. */
  dead?: { site: string; causes: string[] };
  /** The place it was against, for the words. */
  against?: string;
}

/** Renown won and lost, by kind: [won (just), lost]. */
const SIZE: Record<VentureKind, [number, number]> = { raid: [4, 6], delve: [3, 4], defence: [3, 3], takeover: [6, 8], war: [10, 15], conquest: [15, 18] };

/** Keep a venture on a figure's record (the last six). */
function record(f: Figure, v: Venture): void {
  f.ventures = [...(f.ventures ?? []), v].slice(-6);
}

/** Apply a venture's end to everyone it touches. Returns the leader's change of renown. */
export function ventureOutcome(realm: Realm, v: VentureRun, day: number): number {
  const rng = streamFor(realm.seed, "venture", v.kind, v.leader ?? v.faction ?? "", day);
  const [gain, loss] = SIZE[v.kind];
  const leader = v.leader ? realm.figures[v.leader] : undefined;
  let change = 0;
  if (leader?.alive) {
    if (v.won) change = Math.round((v.just ? gain : gain * 0.6) + rng() * 2) - (v.greedWeak ? 4 : 0);
    else change = -Math.round(loss + rng() * (v.kind === "conquest" ? 2 : 3) + (v.routed ? 2 : 0));
    addRenown(leader, change);
    // A defence is not a venture they called: it counts toward neither the Bold nor the Unready.
    record(leader, { day, kind: v.kind, won: v.won, ...(v.kind !== "defence" ? { led: true } : {}), ...(v.routed ? { routed: true } : {}) });
    if (v.greedWeak && v.won) noteDay(leader, "weakRaids", day);
    if (!v.won) addDeed(leader, `lost ${v.kind === "conquest" ? "a war of conquest" : `a ${v.kind}`}${v.against ? ` against ${v.against}` : ""}`);
  }
  // The captain or lieutenant in the field shares half of it.
  const captain = v.captain && v.captain !== v.leader ? realm.figures[v.captain] : undefined;
  if (captain?.alive) {
    addRenown(captain, Math.round(change / 2));
    record(captain, { day, kind: v.kind, won: v.won });
  }
  // Those who went.
  for (const id of v.went ?? []) {
    const f = realm.figures[id];
    if (!f?.alive || f.id === v.leader || f.id === v.captain) continue;
    if (v.won) {
      addRenown(f, 1);
      f.loyalty = Math.min(1, Math.round((f.loyalty + 0.03) * 100) / 100);
    } else f.loyalty = Math.max(0, Math.round((f.loyalty - 0.05) * 100) / 100);
    record(f, { day, kind: v.kind, won: v.won });
  }
  // The families of the dead bear the leader a grudge (the people table holds them: owed until the store's side applies it).
  if (!v.won && leader && v.dead && v.dead.causes.length > 0) {
    const owed = owedOf(realm);
    if (owed.grievances.length < 200) owed.grievances.push({ site: v.dead.site, day, causes: v.dead.causes, against: leader.person ?? leader.id, cause: `venture:${v.kind}:${day}:${v.dead.site}`, weight: v.kind === "conquest" || v.kind === "war" ? 0.5 : 0.35 });
  }
  // The faction.
  const fac = v.faction ? realm.factions[v.faction] : undefined;
  if (fac && fac.dissolved === undefined) {
    const before = fac.prestige ?? prestigeOf(realm, fac);
    addGlory(fac, v.won ? (v.greedWeak ? 1 : 3) : -6);
    if (!v.won) {
      fac.shaken = day + seasonDays();
      // A guild's venture that failed costs its head as it costs the leader (they are often one and the same).
      const head = fac.leader ? realm.figures[fac.leader] : undefined;
      if (head?.alive && head.id !== v.leader) addRenown(head, change || -loss);
    }
    // A gang that preys on the weak: its members are known as cutthroats.
    if (v.won && v.greedWeak && fac.kind === "gang") for (const m of membersOf(realm, fac)) if (m.id !== v.leader) addRenown(m, -1);
    fac.prestige = prestigeOf(realm, fac);
    const lead = fac.leader ? realm.figures[fac.leader] : undefined;
    if (!v.won && lead && (effective(lead) < -30 || (fac.prestige ?? 0) <= before / 2)) maybeSplit(realm, fac, day, rng, 0.5);
  }
  // Three lost in two years: the leader is challenged, and called the Unready.
  if (leader?.alive && !v.won) {
    const lost = (leader.ventures ?? []).filter((x) => x.led && !x.won && x.day > day - 2 * config.daysPerYear).length;
    if (lost >= 3) {
      awardEpithet(realm, leader, "the_unready", day, "lost three ventures in two years");
      challenge(realm, leader, day, undefined, "three ventures lost in two years");
    }
  }
  tally(realm, v.won ? "ventures_won" : "ventures_lost");
  return change;
}

/** The figure who calls a party's ventures: a kingdom's ruler, a place's head, a faction's leader, a person themselves. */
export function callerOf(realm: Realm, p: Party): Figure | undefined {
  const id = p.slice(2);
  const fid = p[0] === "k" ? realm.kingdoms[id]?.ruler : p[0] === "s" ? realm.settlements[id]?.leader : p[0] === "f" ? realm.factions[id]?.leader : id;
  const f = fid ? realm.figures[fid] : undefined;
  return f?.alive ? f : undefined;
}

/** Who led a party's men in the field: a place's captain (or marshal), a faction's lieutenant. */
export function captainOf(realm: Realm, p: Party): Figure | undefined {
  const id = p.slice(2);
  const inst = p[0] === "k" ? placeInst(realm.kingdoms[id]?.capital ?? "") : p[0] === "s" ? placeInst(id) : p[0] === "f" ? factionInst(id) : "";
  const o = officeFor(realm, inst, inst.startsWith("f:") ? "recruit" : "levy") ?? officeFor(realm, inst, "watch");
  const h = o?.office?.holder;
  const f = h ? realm.figures[h] : undefined;
  return f?.alive ? f : undefined;
}

/** The faction behind a party (a gang's or rebels' own; a kingdom's crown). */
export function factionOfParty(realm: Realm, p: Party): RealmFaction | undefined {
  if (p[0] === "f") return realm.factions[p.slice(2)];
  if (p[0] === "k") return realm.factions[realm.kingdoms[p.slice(2)]?.crown ?? ""];
  return undefined;
}

/** A figure took a place (a conquest won): the Conqueror, for life. */
export function conquered(realm: Realm, f: Figure | undefined, place: string, day: number): void {
  if (f?.alive) awardEpithet(realm, f, "conqueror", day, `took ${place}`);
}

/** A place that had given in (paid its tribute) was sacked by them anyway: the Cruel, for life, and renown −8. */
export function sackedSurrendered(realm: Realm, f: Figure | undefined, place: string, day: number): void {
  if (!f?.alive) return;
  reputeOf(f).sacked = day;
  addRenown(f, -8);
  addDeed(f, `sacked ${place}, which had given in`);
  awardEpithet(realm, f, "the_cruel", day, `sacked ${place}, which had given in`);
}

/**
 * Guild takeovers (decision 8): a rich guild may buy or force out a weak one of the same trade that shares a place with it. Won: the weak
 * one is folded into it and its leader's renown rises; failed: its leader (the guild's head) loses renown, its members pay less for a
 * season, and the two guilds are enemies. A season's chance for each pair.
 */
export const TAKEOVER_CHANCE = 0.25;

export function takeoversDay(realm: Realm, day: number): void {
  const active = Object.values(realm.factions).filter((f) => f.dissolved === undefined && !f.charter && (f.kind === "guild" || f.kind === "association") && f.leader).sort((a, b) => a.id.localeCompare(b.id));
  for (const big of active) {
    if (big.dissolved !== undefined) continue;
    const places = new Set([big.seat, ...big.branches].filter(Boolean));
    const weak = active.find((o) => o.id !== big.id && o.dissolved === undefined && o.trade === big.trade && o.kind === big.kind && [o.seat, ...o.branches].some((b) => b && places.has(b)) && big.wealth > 2 * Math.max(100, o.wealth) && memberCount(realm, o) <= minMembers(realm, o) + 1);
    if (!weak) continue;
    const rng = streamFor(realm.seed, "takeover", big.id, weak.id, day);
    if (rng() >= TAKEOVER_CHANCE) continue;
    const lead = realm.figures[big.leader!];
    const theirs = weak.leader ? realm.figures[weak.leader] : undefined;
    const odds = Math.min(0.85, 0.35 + 0.1 * Math.log2(big.wealth / Math.max(100, weak.wealth)) + ((lead ? effective(lead) : 0) - (theirs ? effective(theirs) : 0)) / 200);
    const won = rng() < odds;
    const where = realm.settlements[weak.seat ?? ""]?.name;
    if (won) {
      merge(realm, weak, big, day, `${big.name} bought out its masters`);
      tally(realm, "takeovers");
    } else {
      big.stances[weak.id] = Math.min(big.stances[weak.id] ?? 0, -40);
      weak.stances[big.id] = Math.min(weak.stances[big.id] ?? 0, -40);
      realmNews(realm, day, weak.seat, "faction", `${cap(big.name)} tried to take over ${weak.name}${where ? ` in ${where}` : ""}, and its masters would not sell.`, 4, [big.name, weak.name, ...(lead ? [lead.name] : [])], { why: `${big.name} is rich and ${weak.name} is small` });
    }
    ventureOutcome(realm, { kind: "takeover", leader: big.leader!, faction: big.id, won, just: false, against: weak.name }, day);
  }
}

const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1);
