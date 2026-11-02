import { mint, sink, transfer } from "./ledger.js";
import type { WorldStore } from "../db.js";
import type { Rng } from "../dice.js";
import { charterDay, minimumDay, startCharter } from "../office/charter.js";
import { memberCount } from "../office/members.js";
import { cofferMod } from "../office/posts.js";
import { fadeGlory, figureJoined, prestigeOf } from "../office/prestige.js";
import { recruitDrive, rowDues } from "../office/recruit.js";
import { standingIn } from "../office/repute.js";
import { seasonDays } from "../weather.js";
import { addDeed, addRenown, titled } from "./figures.js";
import { addFaction, neighbours } from "./generate.js";
import { realmNews, tally } from "./log.js";
import { factionName, splinterName } from "./names.js";
import type { Figure, FactionKind, GuildTrade, Realm, RealmFaction, Role } from "./types.js";

/**
 * Factions, guilds and splits (N13.4). Crowns, guilds and associations, gangs,
 * rebels, cults and orders, each with a leader, members, a seat and branches.
 * In code, a day at a time: they earn, recruit people who suit them, open
 * branches, pick a new leader when theirs dies, split when an ambitious and
 * disloyal lieutenant is strong enough, and dissolve when nobody's left. Who
 * founds new ones, and why, is the director's (game/realm/director.ts).
 */

/** Chance a day an ambitious, disloyal, strong lieutenant breaks away. */
export const SPLIT_CHANCE = 0.05;
/** Most branches a guild keeps. */
export const MAX_BRANCHES = 7;

const active = (realm: Realm) => Object.values(realm.factions).filter((f) => !f.dissolved);

/**
 * How much a figure counts, in a faction of `kind` (or a place's succession, with none): their name and rank (N69: approval for most,
 * fame among gangs and rebels: game/office/repute.ts).
 */
export const standing = (f: Figure, kind?: FactionKind) => standingIn(f, kind);

/** Members alive, best first. */
export function membersOf(realm: Realm, fac: RealmFaction): Figure[] {
  return fac.members.map((m) => realm.figures[m]!).filter((f) => f && f.alive).sort((a, b) => standing(b, fac.kind) - standing(a, fac.kind));
}

/** "guildmaster", "lieutenant", "member": a figure's place in the hierarchy of their faction. */
export function rankIn(realm: Realm, fac: RealmFaction, id: string): string {
  const names: Record<FactionKind, [string, string, string]> = {
    crown: [realm.figures[id]?.gender === "female" ? "queen" : "king", "noble", "retainer"],
    guild: ["guildmaster", "master", "journeyman"],
    association: ["head", "elder", "member"],
    gang: ["chief", "lieutenant", "cutthroat"],
    rebels: ["leader", "captain", "rebel"],
    cult: ["high priest", "acolyte", "believer"],
    order: ["grand master", "knight", "squire"],
  };
  const [lead, high, low] = names[fac.kind];
  if (fac.leader === id) return lead;
  const ms = membersOf(realm, fac).filter((f) => f.id !== fac.leader);
  const at = ms.findIndex((f) => f.id === id);
  return at >= 0 && at < Math.max(1, Math.ceil(ms.length * 0.3)) ? high : low;
}

/** The role a founder or member takes on. */
function roleFor(kind: FactionKind, leader: boolean, was: Role): Role {
  if (kind === "gang") return leader ? "bandit chief" : "bandit";
  if (kind === "rebels") return "rebel";
  if (kind === "guild" && leader) return "guildmaster";
  return was;
}

export interface Founding {
  kind: FactionKind;
  trade?: GuildTrade;
  founder: Figure;
  seat: string | null;
  creed: string;
  why: string;
  parent?: string;
}

/** A new faction. The founder leaves their old one. Returns it. */
export function foundFaction(realm: Realm, rng: Rng, o: Founding, day: number): RealmFaction {
  const seat = o.seat ? realm.settlements[o.seat] : undefined;
  const kingdom = seat?.kingdom ? realm.kingdoms[seat.kingdom] : undefined;
  const taken = new Set(Object.values(realm.factions).map((f) => f.name));
  const name = o.parent ? splinterName(rng, realm.factions[o.parent]!.name, o.founder.name, taken) : factionName(rng, o.kind, { place: seat?.name ?? "the wilds", kingdom: kingdom?.name ?? "the realm", ...(o.trade ? { trade: o.trade } : {}), leader: o.founder.name }, taken);
  const id = `fac${realm.next++}`;
  leave(realm, o.founder);
  const fac = addFaction(realm, {
    id,
    name,
    kind: o.kind,
    ...(o.trade ? { trade: o.trade } : {}),
    creed: o.creed,
    leader: o.founder.id,
    members: [o.founder.id],
    seat: o.seat,
    branches: o.seat && o.kind !== "gang" ? [o.seat] : [],
    wealth: 0,
    founded: day,
    ...(o.parent ? { parent: o.parent } : {}),
    stances: {},
  });
  // A guild of one is not a guild (N69): it gathers its members under a charter first.
  startCharter(realm, fac, day);
  // The founder puts in what they can (up to 400), and the first members' dues make up a stake of 100.
  transfer(realm, `p:${o.founder.id}`, `f:${id}`, 400, "founding stake", undefined, day);
  mint(realm, `f:${id}`, 100, "first dues", undefined, day);
  o.founder.faction = id;
  o.founder.role = roleFor(o.kind, true, o.founder.role);
  o.founder.superior = null;
  addRenown(o.founder, 8);
  addDeed(o.founder, `founded ${name}`);
  for (const other of active(realm)) {
    if (other.id === id) continue;
    const s = o.kind === "gang" || other.kind === "gang" ? -60 : o.kind === "rebels" && other.kind === "crown" && other.kingdom === seat?.kingdom ? -80 : 0;
    fac.stances[other.id] = s;
    other.stances[id] = s;
  }
  tally(realm, "founded");
  realmNews(realm, day, o.seat, "faction", `${titled(o.founder)} has founded ${name} in ${seat?.name ?? "the wilds"}${fac.charter ? ", and seeks members for its charter" : ""}: ${o.why}.`, 6, [o.founder.name, name, ...(seat ? [seat.name] : [])], { why: o.why });
  return fac;
}

/** A figure leaves their faction (and its leadership). */
export function leave(realm: Realm, f: Figure): void {
  const old = f.faction ? realm.factions[f.faction] : undefined;
  if (old) {
    old.members = old.members.filter((m) => m !== f.id);
    if (old.leader === f.id) old.leader = null;
  }
  f.faction = null;
}

/** Join a faction. */
export function join(realm: Realm, f: Figure, fac: RealmFaction): void {
  if (f.faction === fac.id) return;
  leave(realm, f);
  f.faction = fac.id;
  fac.members.push(f.id);
  f.role = roleFor(fac.kind, false, f.role);
  if (fac.leader && fac.leader !== f.id) f.superior = fac.leader;
  // Belonging raises your name, once (N69).
  figureJoined(f, fac);
}

/**
 * One day for every faction: members counted (figures and townsfolk), charters and the minimum (N69), dues, recruiting drives, halls,
 * new leaders, splits, dissolving. `store`: the people table, read for what figures think of a leader (townsfolk are asked in their place's day).
 */
export function factionsDay(realm: Realm, day: number, rng: Rng, store?: WorldStore): void {
  for (const fac of active(realm)) {
    const ms = membersOf(realm, fac);
    fac.members = ms.map((m) => m.id);
    if (memberCount(realm, fac) === 0) {
      fac.dissolved = day;
      tally(realm, "dissolved");
      realmNews(realm, day, fac.seat, "faction", `${cap(fac.name)} is no more: nobody is left.`, 4, [fac.name]);
      continue;
    }
    // A charter gathers its members or fails; a chartered guild under its minimum for a season folds (N69).
    if (fac.charter) {
      if (charterDay(realm, fac, day) === "failed") continue;
    } else if (minimumDay(realm, fac, day) !== null) continue;
    // Income: townsfolk members' dues come in with their work, more with halls (figures pay theirs on tax day: game/office/treasury.ts).
    if (fac.kind === "guild" || fac.kind === "association" || fac.kind === "order" || fac.kind === "cult") mint(realm, `f:${fac.id}`, rowDues(fac, cofferMod(realm, `f:${fac.id}`)) * (fac.shaken !== undefined && day < fac.shaken ? 0.7 : 1), "members' dues", undefined, day);
    if (fac.kind === "rebels") mint(realm, `f:${fac.id}`, (ms.length + (fac.rows ?? 0)) * 2, "members' dues", undefined, day);
    // A new leader when theirs is gone; two close rivals and the loser may split.
    if (!fac.leader || !realm.figures[fac.leader]?.alive) succeed(realm, fac, ms, day, rng);
    // Recruit: a drive, not a lottery (N69).
    recruitDrive(realm, fac, day, store);
    fac.prestige = prestigeOf(realm, fac);
    if (day % seasonDays() === 0) fadeGlory(fac);
    // A rich guild opens a hall in a neighbouring place.
    if ((fac.kind === "guild" || fac.kind === "association") && !fac.charter && fac.wealth > 1500 && fac.branches.length < MAX_BRANCHES && rng() < 0.1) {
      const options = fac.branches.flatMap((b) => neighbours(realm, b)).filter((s) => !fac.branches.includes(s.id) && s.kind !== "hamlet");
      const at = options[Math.floor(rng() * options.length)];
      if (at) {
        fac.branches.push(at.id);
        sink(realm, `f:${fac.id}`, 800, `a hall in ${at.name}`, undefined, day);
        tally(realm, "branches");
        realmNews(realm, day, at.id, "faction", `${cap(fac.name)} has opened a hall in ${at.name}.`, 3, [fac.name, at.name]);
      }
    }
    maybeSplit(realm, fac, day, rng);
  }
}

/** The best member leads; a close, ambitious rival may break away with followers. */
function succeed(realm: Realm, fac: RealmFaction, ms: Figure[], day: number, rng: Rng): void {
  const [first, second] = ms.filter((f) => !f.talks);
  if (!first) {
    fac.leader = null;
    return;
  }
  fac.leader = first.id;
  first.role = fac.kind === "crown" ? first.role : roleFor(fac.kind, true, first.role);
  for (const m of ms) if (m.id !== first.id) m.superior = first.id;
  first.superior = null;
  addRenown(first, 5);
  realmNews(realm, day, fac.seat, "leader", `${first.name} now leads ${fac.name}.`, fac.kind === "crown" ? 7 : 4, [first.name, fac.name]);
  if (second && fac.kind !== "crown" && standing(first, fac.kind) - standing(second, fac.kind) < 8 && second.ambition > 0.6 && rng() < 0.6) {
    split(realm, fac, second, day, rng, `${second.name} would not follow ${first.name}`);
  }
}

/**
 * An ambitious, disloyal lieutenant strong enough may break away. After a defeat (N69: `shaken`) the loyalty bar is 0.1 higher, so
 * one is likelier to; `chance` overrides the day's chance (a defeat runs the check at once).
 */
export function maybeSplit(realm: Realm, fac: RealmFaction, day: number, rng: Rng, chance = SPLIT_CHANCE): RealmFaction | null {
  if (fac.members.length < 3 || !fac.leader) return null;
  const leader = realm.figures[fac.leader];
  if (!leader?.alive) return null;
  const bar = fac.shaken !== undefined && day < fac.shaken ? 0.55 : 0.45;
  const lt = membersOf(realm, fac).find((f) => f.id !== fac.leader && !f.talks);
  if (!lt || lt.ambition <= 0.65 || lt.loyalty >= bar || standing(lt, fac.kind) < standing(leader, fac.kind) * 0.6) return null;
  if (rng() >= chance) return null;
  return split(realm, fac, lt, day, rng, `${lt.name} had grown tired of answering to ${leader.name}`);
}

/**
 * A faction splits: the rebel lieutenant founds their own (a crown's split-off are
 * rebels), taking the followers with low loyalty, a share of the wealth and some
 * branches. Both sides hate each other. Returns the new faction.
 */
export function split(realm: Realm, fac: RealmFaction, rebel: Figure, day: number, rng: Rng, why: string): RealmFaction {
  const kind: FactionKind = fac.kind === "crown" ? "rebels" : fac.kind;
  const followers = membersOf(realm, fac).filter((f) => f.id !== rebel.id && f.id !== fac.leader && !f.talks && f.loyalty < 0.5 && rng() < 0.6);
  const seat = rebel.home ?? fac.seat;
  const out = foundFaction(realm, rng, { kind, ...(fac.trade ? { trade: fac.trade } : {}), founder: rebel, seat, creed: fac.kind === "crown" ? `a new rule, under ${rebel.name}` : `${fac.creed}, done right`, why, parent: fac.id }, day);
  for (const f of followers) join(realm, f, out);
  transfer(realm, `f:${fac.id}`, `f:${out.id}`, Math.round(fac.wealth * 0.3), "the split", undefined, day);
  if (fac.kind === "guild" || fac.kind === "association") {
    const takes = fac.branches.filter((b) => b !== fac.seat && followers.some((f) => f.home === b));
    out.branches = [...new Set([...out.branches, ...takes])];
    fac.branches = fac.branches.filter((b) => !takes.includes(b));
  }
  out.stances[fac.id] = -70;
  fac.stances[out.id] = -70;
  tally(realm, "splits");
  realmNews(realm, day, seat, "split", `${cap(fac.name)} has split: ${rebel.name} broke away with ${followers.length} followers and founded ${out.name}.`, 7, [fac.name, rebel.name, out.name], { why });
  return out;
}

const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1);

export { active as activeFactions };
