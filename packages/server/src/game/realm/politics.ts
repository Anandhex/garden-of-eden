import { config } from "../../config.js";
import type { Rng } from "../dice.js";
import { tierIndex, type Tier } from "../life.js";
import { addDeed, addRenown, leaderRole, makeFigure, residents, titled } from "./figures.js";
import { foundFaction, join, leave, standing } from "./factions.js";
import { declareWar, payTreaties, raid, warOf } from "./diplomacy.js";
import { realmNews, tally } from "./log.js";
import { settlementSide } from "./military.js";
import { SETTLEMENT_KINDS, type Figure, type Realm, type Settlement } from "./types.js";

/**
 * Hierarchy and taxes (N13.3). Every settlement has a head (elder, village head,
 * mayor, lord, king or queen) who answers to the head of its liege, up to the
 * crown. Twice a year (TAX_DAYS) each place pays its liege a share of its coffers, from the
 * hamlets up, so coin climbs the chain the same day; in war the crown asks more.
 * A head too poor, greedy or disloyal to pay falls behind; the liege sends men to
 * collect, and a place strong and stubborn enough breaks away (and its crown
 * comes for it: game/realm/diplomacy.ts). A dead head is replaced by their heir;
 * a close, ambitious rival may refuse them and found rebels.
 */
/**
 * Taxes fall due twice a year (24 days at 48). Tributes and wages are paid the same day, and a liege sends men to collect
 * arrears only then, so how often a place is squeezed is stated over the year, not in days.
 */
export const TAX_DAYS = Math.max(1, Math.round(config.daysPerYear / 2));
/** Extra share the crown asks while at war. */
export const WAR_TAX = 0.06;

/** Hand over coin nobody carried (no clerk to send, or a road that doesn't join): the day after it was taken. */
export function settleTransit(realm: Realm, day: number): void {
  const keep: Realm["transit"] = [];
  for (const t of realm.transit) {
    if (t.journey || t.day >= day) keep.push(t);
    else {
      const to = realm.settlements[t.to];
      if (to) to.treasury += t.amount;
    }
  }
  realm.transit = keep;
}

/** Is today a tax day? */
export const isTaxDay = (day: number) => day % TAX_DAYS === 0;

/** Will this head pay? Poor places can't; greedy, disloyal heads won't. */
export function willPay(realm: Realm, s: Settlement): boolean {
  if (s.treasury < 20 || s.prosperity < 18) return false;
  const lead = s.leader ? realm.figures[s.leader] : undefined;
  if (!lead) return true;
  return !(lead.greed > 0.75 && lead.loyalty < 0.3);
}

/** Taxes: from the bottom of the chain up. Then tributes and wages (treaties). */
export function taxDay(realm: Realm, day: number, rng: Rng): void {
  const order = [...SETTLEMENT_KINDS];
  const places = Object.values(realm.settlements).filter((s) => !s.abandoned && s.liege).sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
  for (const s of places) {
    const liege = realm.settlements[s.liege!];
    if (!liege || liege.abandoned) continue;
    const war = s.kingdom && warOf(realm, `k:${s.kingdom}`) ? WAR_TAX : 0;
    if (!willPay(realm, s)) {
      s.arrears += 1;
      tally(realm, "unpaid");
      if (s.arrears >= 2) collect(realm, s, liege, day, rng);
      continue;
    }
    const due = Math.round(s.treasury * (s.taxRate + war));
    s.treasury -= due;
    // The coin goes up the road with the lord's clerk (N26 Part E): it is in the liege's coffers when he arrives.
    realm.transit.push({ from: s.id, to: liege.id, amount: due, day });
    s.arrears = 0;
    tally(realm, "taxes", due);
    realmNews(realm, day, s.id, "tax", `${s.name} paid ${Math.max(1, Math.round(due / 100))} gold in taxes to ${liege.name}${war ? ", more than usual for the war" : ""}.`, 2, [s.name, liege.name]);
  }
  payTreaties(realm, day);
}

/** A liege collects what it's owed: by force if it's stronger, or the place breaks away. */
function collect(realm: Realm, s: Settlement, liege: Settlement, day: number, rng: Rng): void {
  const mine = settlementSide(realm, liege, { defending: false });
  const theirs = settlementSide(realm, s).strength;
  const lead = s.leader ? realm.figures[s.leader] : undefined;
  if (s.arrears >= 3 && lead && lead.ambition > 0.5 && theirs > mine.strength * 0.8 && s.kind !== "hamlet") {
    breakAway(realm, s, day, rng);
    return;
  }
  if (mine.strength > theirs * 1.2 && rng() < 0.6) {
    if (raid(realm, mine, `s:${liege.id}`, s, day, rng, "unpaid taxes")) s.arrears = 0;
  }
}

/** A settlement (and those under it) breaks free of its liege and crown; rebels form, and the crown will come. */
export function breakAway(realm: Realm, s: Settlement, day: number, rng: Rng): void {
  const crown = s.kingdom ? realm.kingdoms[s.kingdom] : undefined;
  const lead = s.leader ? realm.figures[s.leader] : undefined;
  const liege = s.liege ? realm.settlements[s.liege] : undefined;
  s.liege = null;
  s.freeSince = day;
  s.arrears = 0;
  for (const x of Object.values(realm.settlements)) if (x === s || inChain(realm, x, s.id)) x.kingdom = null;
  if (crown) crown.opinion[`free:${s.id}`] = -60;
  if (lead) {
    lead.superior = null;
    if (crown && lead.faction === crown.crown) leave(realm, lead);
    addRenown(lead, 10);
    addDeed(lead, `led ${s.name} out from under ${liege?.name ?? "its liege"}`);
    foundFaction(realm, rng, { kind: "rebels", founder: lead, seat: s.id, creed: `${s.name} answers to no one`, why: "it would pay no more taxes" }, day);
    lead.role = leaderRole(s.kind);
  }
  tally(realm, "breakaways");
  realmNews(realm, day, s.id, "breakaway", `${s.name} has broken away from ${liege?.name ?? "its liege"}${crown ? ` and ${crown.name}` : ""}: ${lead ? titled(lead) : "its people"} will pay no more taxes.`, 8, [s.name, ...(liege ? [liege.name] : []), ...(crown ? [crown.name] : []), ...(lead ? [lead.name] : [])], { why: "it would pay no more taxes" });
  if (crown && !warOf(realm, `k:${crown.id}`)) declareWar(realm, [`k:${crown.id}`], [`s:${s.id}`], day, `${s.name} broke away`);
}

function inChain(realm: Realm, s: Settlement, top: string): boolean {
  const seen = new Set<string>();
  let cur = s.liege;
  while (cur && !seen.has(cur)) {
    if (cur === top) return true;
    seen.add(cur);
    cur = realm.settlements[cur]?.liege ?? null;
  }
  return false;
}

/** Heads for places with none: the heir (a child of the last, else the most renowned), or someone appointed. */
export function successionDay(realm: Realm, day: number, rng: Rng): void {
  for (const s of Object.values(realm.settlements)) {
    if (s.abandoned || (s.leader && realm.figures[s.leader]?.alive)) continue;
    const old = s.leader ? realm.figures[s.leader] : undefined;
    const candidates = residents(realm, s.id).filter((f) => !f.talks && f.life.stage !== "young" && !["bandit", "bandit chief", "beast"].includes(f.role));
    const score = (f: Figure) => standing(f) + (old && f.parents?.includes(old.id) ? 30 : 0);
    candidates.sort((a, b) => score(b) - score(a));
    let heir = candidates[0];
    const rival = candidates[1];
    let appointed = false;
    if (!heir) {
      const liege = s.liege ? realm.settlements[s.liege] : undefined;
      heir = makeFigure(realm, rng, { role: leaderRole(s.kind), home: s.id, tier: (["G", "F", "E", "D", "C"] as Tier[])[Math.min(4, SETTLEMENT_KINDS.indexOf(s.kind))]!, age: 30 + Math.floor(rng() * 20), renown: 15, rose: "crowd" }, day);
      appointed = liege !== undefined;
    }
    install(realm, s, heir, day);
    tally(realm, "successions");
    realmNews(realm, day, s.id, "succession", `${titled(heir)} is the new head of ${s.name}${old ? `, after ${old.name}` : ""}${appointed ? ", appointed from above" : ""}.`, s.kind === "capital" ? 8 : s.kind === "city" ? 6 : 4, [heir.name, s.name, ...(old ? [old.name] : [])], { why: appointed ? "no one in the place could lead, so the liege appointed a head" : old && heir.parents?.includes(old.id) ? "the old head's child, and the most standing" : "the most standing of those who lived there" });
    // A rival who won't bow: they found rebels (at the capital, a pretender to the crown).
    if (rival && score(heir) - score(rival) < 10 && rival.ambition > 0.65 && rival.loyalty < 0.5 && rng() < 0.5) {
      const fac = foundFaction(realm, rng, { kind: "rebels", founder: rival, seat: s.id, creed: s.kind === "capital" ? `${rival.name} for the crown` : `${rival.name} should rule ${s.name}`, why: `${rival.name} would not bow to ${heir.name}` }, day);
      for (const f of residents(realm, s.id)) if (f !== rival && f !== heir && !f.talks && f.loyalty < 0.35 && rng() < 0.5) join(realm, f, fac);
    }
  }
  refreshHierarchy(realm);
}

/**
 * The court seats a kingdom's crown keeps besides the heads of places: a noble house at the capital and the
 * city, and a captain at the capital, the city and each town (as `generateRealm` seats them).
 */
export function courtSeats(s: Settlement): Array<"noble" | "captain"> {
  return s.kind === "capital" || s.kind === "city" ? ["noble", "captain"] : s.kind === "town" ? ["captain"] : [];
}

/** A day's chance an empty court seat is filled: a story-day thing, not a yearly one (about four days). */
const COURT_FILL_CHANCE = 0.25;
/** Who may be made captain: those who already bear arms. */
const CAPTAIN_FROM: Figure["role"][] = ["guard", "adventurer", "hunter"];

/**
 * Empty court seats filled (sworn to the crown): a noble's grown child takes up the house, else the crown raises a
 * new one; a captain is the most standing of the place's guards, adventurers and hunters, else one is sent.
 * Without this a crown only ever shrinks: the dead leave it and only the heads of places were replaced.
 */
export function courtDay(realm: Realm, day: number, rng: Rng): void {
  const byHome = new Map<string, Figure[]>();
  for (const f of Object.values(realm.figures)) {
    if (!f.alive || f.home === null || f.role === "beast") continue;
    const at = byHome.get(f.home);
    if (at) at.push(f);
    else byHome.set(f.home, [f]);
  }
  for (const s of Object.values(realm.settlements).sort((a, b) => a.id.localeCompare(b.id))) {
    const kingdom = s.kingdom ? realm.kingdoms[s.kingdom] : undefined;
    const crown = kingdom ? realm.factions[kingdom.crown] : undefined;
    if (s.abandoned || !crown || crown.dissolved || courtSeats(s).length === 0) continue;
    const here = byHome.get(s.id) ?? [];
    for (const role of courtSeats(s)) {
      if (here.some((f) => f.role === role && f.faction === crown.id)) continue;
      if (rng() >= COURT_FILL_CHANCE) continue;
      const free = here.filter((f) => !f.faction && !f.talks && f.life.stage !== "young" && f.id !== s.leader);
      const nobleBorn = (f: Figure) => (f.parents ?? []).some((p) => ["noble", "ruler", "lord"].includes(realm.figures[p]?.role ?? ""));
      const pool = free.filter((f) => (role === "noble" ? nobleBorn(f) : CAPTAIN_FROM.includes(f.role))).sort((a, b) => standing(b) - standing(a));
      const raised = pool[0];
      const tiers: Tier[] = role === "captain" && s.kind !== "town" ? ["D", "C"] : ["E", "D"];
      const f = raised ?? makeFigure(realm, rng, { role, home: s.id, tier: tiers[Math.floor(rng() * tiers.length)]!, age: 25 + Math.floor(rng() * 25), renown: 20, rose: "crowd" }, day);
      f.role = role;
      join(realm, f, crown);
      addRenown(f, 5);
      addDeed(f, role === "noble" ? `took up a noble house in ${s.name}` : `was made captain of ${s.name}`);
      here.push(f);
      tally(realm, "court");
      realmNews(realm, day, s.id, "court", role === "noble" ? `${f.name} ${raised ? "takes up" : "is raised to"} a noble house in ${s.name}, sworn to ${crown.name}.` : `${f.name} is made captain of ${s.name} for ${crown.name}.`, 3, [f.name, s.name], { why: raised ? (role === "noble" ? "a noble's child came of age to an empty house" : "the most standing of those who bear arms there") : "no one there fit the seat, so the crown sent someone" });
    }
  }
  refreshHierarchy(realm);
}

/** Make someone head of a settlement (and ruler of its kingdom, at a capital). */
export function install(realm: Realm, s: Settlement, f: Figure, day: number): void {
  s.leader = f.id;
  f.home = s.id;
  f.role = leaderRole(s.kind);
  addRenown(f, 5);
  addDeed(f, `became head of ${s.name}`);
  const crown = s.kingdom ? realm.kingdoms[s.kingdom] : undefined;
  if (crown) {
    const fac = realm.factions[crown.crown];
    if (fac && f.faction !== fac.id) join(realm, f, fac);
    if (s.kind === "capital") {
      crown.ruler = f.id;
      if (fac) fac.leader = f.id;
    }
  }
  void day;
}

/**
 * The chain of command: heads answer to their liege's head; faction members (not crowns)
 * to their faction's leader; everyone else to the head of where they live.
 */
export function refreshHierarchy(realm: Realm): void {
  const heads = new Set(Object.values(realm.settlements).map((s) => s.leader).filter(Boolean) as string[]);
  for (const f of Object.values(realm.figures)) {
    if (!f.alive) continue;
    const home = f.home ? realm.settlements[f.home] : undefined;
    if (home && home.leader === f.id) {
      const liege = home.liege ? realm.settlements[home.liege] : undefined;
      f.superior = liege?.leader ?? null;
      continue;
    }
    const fac = f.faction ? realm.factions[f.faction] : undefined;
    if (fac && fac.kind !== "crown" && fac.leader && fac.leader !== f.id && realm.figures[fac.leader]?.alive) {
      f.superior = fac.leader;
      continue;
    }
    if (fac && fac.leader === f.id) {
      f.superior = null;
      continue;
    }
    f.superior = home?.leader && home.leader !== f.id && !heads.has(f.id) ? home.leader : f.superior && realm.figures[f.superior]?.alive ? f.superior : null;
  }
}

/** The best fighter's rank in a settlement, for the UI. */
export function topRank(realm: Realm, s: Settlement): Tier {
  return residents(realm, s.id).reduce<Tier>((best, f) => (tierIndex(f.life.tier as Tier) > tierIndex(best) ? (f.life.tier as Tier) : best), "G");
}
