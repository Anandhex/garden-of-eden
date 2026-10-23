import type { Rng } from "../dice.js";
import { dailyChance } from "../weather.js";
import { addDeed, addRenown, titled } from "./figures.js";
import { distance, neighbours } from "./generate.js";
import { realmNews, tally } from "./log.js";
import { casualty, fight, gangSide, settlementSide, type Side } from "./military.js";
import type { Party, Realm, Settlement, Treaty, TreatyKind, War } from "./types.js";
import { sendArrival } from "./arrivals.js";

/**
 * Treaties, raids and wars (N13.5), in code.
 *
 * Treaties bind any two parties: a kingdom, a settlement, a faction or a person
 * ("k:", "s:", "f:", "p:"). Non-aggression and mutual defence stop raids and wars
 * between them; mutual defence brings an ally's men to a fight; trade makes both
 * richer (game/realm/economy.ts); tribute moves coin every tax day; service binds
 * a person to fight for a kingdom for a wage. Breaking one costs the breaker's
 * renown and the other side's goodwill.
 *
 * Raids: a hungry, poor or greedy settlement (or a gang) raids a weaker neighbour
 * it has no treaty with, for food and coin. Wars: kingdoms that hate each other
 * fight battles every few days at the border until one side wins or both are
 * worn out; rebels and places that broke away fight their crown.
 */

/** Days between battles in a war. */
export const BATTLE_EVERY = 3;
/** Score at which a war is won. */
export const WAR_WON = 70;
/** Score at which the attackers take the settlement they're fighting over. */
export const CAPTURE_SCORE = 35;
/** Daily chance a kingdom that hates a weaker neighbour declares war. */
export const WAR_CHANCE = 0.03;
/** Daily chance a crown moves against rebels or a place that broke away. */
export const REBEL_WAR_CHANCE = 0.05;
/**
 * Yearly chance a hard-pressed settlement raids a neighbour, and a gang goes raiding. Raids kill townsfolk, so how many a
 * year a place suffers is stated over the year (wars stay a daily story: a war is told in days, not in years).
 */
export const RAID_YEARLY = 0.39;
export const GANG_RAID_YEARLY = 0.72;

/** The parties a settlement counts as: itself, its kingdom, and its liege chain. */
export function partiesOf(realm: Realm, s: Settlement): Party[] {
  const out: Party[] = [`s:${s.id}`];
  if (s.kingdom) out.push(`k:${s.kingdom}`);
  return out;
}

/** Treaties of a kind in force between any party in `a` and any in `b`. */
export function treatiesBetween(realm: Realm, a: Party[], b: Party[], day: number, kinds?: TreatyKind[]): Treaty[] {
  return realm.treaties.filter((t) => !t.broken && t.until >= day && t.since <= day && (!kinds || kinds.includes(t.kind)) && ((a.includes(t.a) && b.includes(t.b)) || (a.includes(t.b) && b.includes(t.a))));
}

/** Are they sworn not to fight? */
export function atPeace(realm: Realm, a: Party[], b: Party[], day: number): boolean {
  return treatiesBetween(realm, a, b, day, ["non_aggression", "mutual_defense", "tribute"]).length > 0;
}

/** A display name for a party. */
export function partyName(realm: Realm, p: Party): string {
  const [kind, id] = [p[0], p.slice(2)];
  if (kind === "k") return realm.kingdoms[id]?.name ?? id;
  if (kind === "s") return realm.settlements[id]?.name ?? id;
  if (kind === "f") return realm.factions[id]?.name ?? id;
  const f = realm.figures[id];
  return f ? titled(f) : id;
}

/** Sign a treaty. Returns it (or the one already in force). */
export function sign(realm: Realm, kind: TreatyKind, a: Party, b: Party, day: number, days: number, why: string, amount?: number): Treaty {
  const existing = treatiesBetween(realm, [a], [b], day, [kind])[0];
  if (existing) {
    existing.until = Math.max(existing.until, day + days);
    return existing;
  }
  const t: Treaty = { id: `t${realm.next++}`, kind, a, b, since: day, until: day + days, why, ...(amount !== undefined ? { amount } : {}) };
  realm.treaties.push(t);
  tally(realm, "treaties");
  const words: Record<TreatyKind, string> = { non_aggression: "a pact of non-aggression", mutual_defense: "a pact of mutual defence", trade: "a trade agreement", tribute: "a tribute", service: "an oath of service" };
  const where = a.startsWith("s:") ? a.slice(2) : b.startsWith("s:") ? b.slice(2) : a.startsWith("k:") ? realm.kingdoms[a.slice(2)]?.capital ?? null : null;
  realmNews(realm, day, where, "treaty", `${cap(partyName(realm, a))} and ${partyName(realm, b)} have sworn ${words[kind]} (${why}).`, kind === "service" ? 4 : 5, [partyName(realm, a), partyName(realm, b)], { why });
  // Old, finished treaties go.
  if (realm.treaties.length > 80) realm.treaties = realm.treaties.filter((x) => x.until >= day - 30 || x === t);
  return t;
}

/** Break a treaty: the breaker loses renown, the other side's goodwill. */
export function breakTreaty(realm: Realm, t: Treaty, by: Party, day: number, why: string): void {
  if (t.broken) return;
  t.broken = { by, day };
  const other = t.a === by ? t.b : t.a;
  if (by.startsWith("k:") && other.startsWith("k:")) shiftOpinion(realm, other.slice(2), by.slice(2), -35);
  const leader = leaderOfParty(realm, by);
  if (leader) {
    addRenown(leader, -10);
    addDeed(leader, `broke faith with ${partyName(realm, other)}`);
  }
  tally(realm, "broken");
  realmNews(realm, day, null, "treaty", `${cap(partyName(realm, by))} has broken its ${t.kind.replace("_", "-")} treaty with ${partyName(realm, other)}: ${why}.`, 6, [partyName(realm, by), partyName(realm, other)], { why });
}

function leaderOfParty(realm: Realm, p: Party) {
  const id = p.slice(2);
  const fid = p[0] === "k" ? realm.kingdoms[id]?.ruler : p[0] === "s" ? realm.settlements[id]?.leader : p[0] === "f" ? realm.factions[id]?.leader : id;
  return fid ? realm.figures[fid] : undefined;
}

export function shiftOpinion(realm: Realm, of: string, about: string, delta: number): void {
  const k = realm.kingdoms[of];
  if (!k || of === about) return;
  k.opinion[about] = Math.max(-100, Math.min(100, Math.round((k.opinion[about] ?? 0) + delta)));
}

/** Allies sworn to defend `defender`: their men join (a share of their strength). */
export function alliedHelp(realm: Realm, defender: Settlement, day: number): { strength: number; names: string[] } {
  const mine = partiesOf(realm, defender);
  let strength = 0;
  const names: string[] = [];
  for (const t of realm.treaties.filter((x) => x.kind === "mutual_defense" && !x.broken && x.until >= day)) {
    const other = mine.includes(t.a) ? t.b : mine.includes(t.b) ? t.a : null;
    if (!other) continue;
    const s = other.startsWith("s:") ? realm.settlements[other.slice(2)] : other.startsWith("k:") ? realm.settlements[realm.kingdoms[other.slice(2)]?.capital ?? ""] : undefined;
    if (!s || s.abandoned || s.id === defender.id) continue;
    strength += settlementSide(realm, s, { defending: false }).strength * 0.35;
    names.push(s.name);
  }
  // A liege sends a few men to its own.
  if (defender.liege) {
    const l = realm.settlements[defender.liege];
    if (l) strength += settlementSide(realm, l, { defending: false }).strength * 0.1;
  }
  return { strength, names };
}

/**
 * A raid on `target` by a side. Win: loot (coin and food), damage, fear. Lose:
 * the raiders limp home. Either way the dead are buried and it's news. The raiders are queued for the
 * target's own map (game/realm/arrivals.ts).
 */
export function raid(realm: Realm, attacker: Side, attackerParty: Party, target: Settlement, day: number, rng: Rng, why: string): boolean {
  const defence = settlementSide(realm, target);
  const help = alliedHelp(realm, target, day);
  defence.strength += help.strength;
  const what = `the raid on ${target.name}`;
  const r = fight(realm, attacker, defence, day, rng, what);
  const raidRef = `raid:${day}:${attacker.home?.id ?? attacker.name.toLowerCase().replace(/[^a-z0-9]+/g, "_")}>${target.id}`;
  casualty(realm, attacker.home, "raid", r.lost.attackers, `${raidRef}:raiders`, day);
  casualty(realm, target, "raid", r.lost.defenders, raidRef, day);
  target.lastRaided = day;
  tally(realm, "raids");
  sendArrival(realm, target.id, { day, kind: "raid", count: Math.max(2, Math.min(6, Math.round(attacker.men / 4))), by: attacker.name });
  if (attackerParty.startsWith("s:") && target.kingdom) {
    const ak = realm.settlements[attackerParty.slice(2)]?.kingdom;
    if (ak && ak !== target.kingdom) shiftOpinion(realm, target.kingdom, ak, -15);
  }
  if (r.attackerWon) {
    const coin = Math.round(target.treasury * (0.15 + rng() * 0.15));
    target.treasury -= coin;
    target.food = Math.max(0, target.food - 15);
    if (attacker.home) {
      attacker.home.treasury += coin;
      attacker.home.food = Math.min(100, attacker.home.food + 10);
    } else if (attackerParty.startsWith("f:")) {
      const f = realm.factions[attackerParty.slice(2)];
      if (f) f.wealth += coin;
    }
    // Something burns.
    if (rng() < 0.35) damageBuilding(target, rng);
    realmNews(realm, day, target.id, "raid", `${cap(attacker.name)} raided ${target.name} (${why}) and carried off ${Math.round(coin / 100)} gold${r.dead.length > 0 ? `; ${r.dead.map((f) => f.name).join(" and ")} died` : ""}.`, 7, [attacker.name, target.name, ...r.dead.map((f) => f.name)], { why });
  } else {
    realmNews(realm, day, target.id, "raid", `${cap(target.name)} drove off a raid by ${attacker.name}${help.names.length > 0 ? `, with help from ${help.names.join(" and ")}` : ""}${r.dead.length > 0 ? `; ${r.dead.map((f) => f.name).join(" and ")} died` : ""}.`, 6, [attacker.name, target.name, ...help.names, ...r.dead.map((f) => f.name)], { why });
  }
  return r.attackerWon;
}

/** A building loses a level (the walls first, else any). Returns which, or null. */
export function damageBuilding(s: Settlement, rng: Rng): string | null {
  const built = Object.entries(s.buildings).filter(([, l]) => (l ?? 0) > 0);
  if (built.length === 0) return null;
  const [b] = built.find(([b]) => b === "walls") ?? built[Math.floor(rng() * built.length)]!;
  s.buildings[b as keyof Settlement["buildings"]] = (s.buildings[b as keyof Settlement["buildings"]] ?? 1) - 1;
  return b;
}

/** The best target for a raid from `from`: a weaker, richer neighbour it has no treaty with. */
export function raidTarget(realm: Realm, from: Party[], near: string, attack: number, day: number): Settlement | null {
  const options = [realm.settlements[near]!, ...neighbours(realm, near)].filter((s) => s && !s.abandoned && !from.includes(`s:${s.id}`));
  const ok = options.filter((s) => !atPeace(realm, from, partiesOf(realm, s), day) && settlementSide(realm, s).strength + alliedHelp(realm, s, day).strength < attack * 0.9);
  ok.sort((a, b) => b.treasury + b.food * 10 - (a.treasury + a.food * 10));
  return ok[0] ?? null;
}

/** One day of raids: hungry or greedy settlements and gangs look for easy pickings. */
export function raidsDay(realm: Realm, day: number, rng: Rng): void {
  for (const s of Object.values(realm.settlements)) {
    if (s.abandoned || s.kind === "capital" || s.population < 20) continue;
    const lead = s.leader ? realm.figures[s.leader] : undefined;
    const pressed = s.food < 25 || s.prosperity < 30 || (lead !== undefined && lead.greed > 0.8 && lead.bravery > 0.5);
    if (!pressed || rng() >= dailyChance(RAID_YEARLY)) continue;
    const side = settlementSide(realm, s, { defending: false });
    const target = raidTarget(realm, partiesOf(realm, s), s.id, side.strength, day);
    if (!target) continue;
    raid(realm, side, `s:${s.id}`, target, day, rng, s.food < 25 ? "they were starving" : lead && lead.greed > 0.8 ? `${lead.name} wanted their coin` : "hard times");
  }
  for (const g of Object.values(realm.factions)) {
    if (g.dissolved || g.kind !== "gang" || !g.seat || rng() >= dailyChance(GANG_RAID_YEARLY)) continue;
    const side = gangSide(realm, g.id);
    if (side.fighters.length === 0) continue;
    const target = raidTarget(realm, [`f:${g.id}`], g.seat, side.strength, day);
    if (target) raid(realm, side, `f:${g.id}`, target, day, rng, "for plunder");
  }
}

/** Every tax day: tributes paid, servants' wages paid. */
export function payTreaties(realm: Realm, day: number): void {
  for (const t of realm.treaties) {
    if (t.broken || t.until < day || !t.amount) continue;
    const from = t.kind === "tribute" ? t.a : t.b;
    const to = t.kind === "tribute" ? t.b : t.a;
    const paid = take(realm, from, t.amount);
    give(realm, to, paid);
    if (paid < t.amount && t.kind === "tribute") breakTreaty(realm, t, from, day, "it couldn't pay");
  }
}

/** Coin out of a party's purse (settlement, kingdom's capital, faction or person). Returns what was there. */
function take(realm: Realm, p: Party, amount: number): number {
  const id = p.slice(2);
  const holder = p[0] === "s" ? realm.settlements[id] : p[0] === "k" ? realm.settlements[realm.kingdoms[id]?.capital ?? ""] : undefined;
  if (holder) {
    const paid = Math.min(holder.treasury, amount);
    holder.treasury -= paid;
    return paid;
  }
  const purse = p[0] === "f" ? realm.factions[id] : realm.figures[id];
  if (!purse) return 0;
  const has = "treasury" in purse ? 0 : purse.wealth;
  const paid = Math.min(has, amount);
  purse.wealth -= paid;
  return paid;
}

function give(realm: Realm, p: Party, amount: number): void {
  const id = p.slice(2);
  const holder = p[0] === "s" ? realm.settlements[id] : p[0] === "k" ? realm.settlements[realm.kingdoms[id]?.capital ?? ""] : undefined;
  if (holder) holder.treasury += amount;
  else if (p[0] === "f" && realm.factions[id]) realm.factions[id]!.wealth += amount;
  else if (p[0] === "p" && realm.figures[id]) realm.figures[id]!.wealth += amount;
}

// ---- Wars ----

/** Wars going on now. */
export const ongoing = (realm: Realm) => realm.wars.filter((w) => w.end === undefined);

/** Is a party in a war now, and on which side? */
export function warOf(realm: Realm, p: Party): { war: War; side: "attackers" | "defenders" } | null {
  for (const w of ongoing(realm)) {
    if (w.attackers.includes(p)) return { war: w, side: "attackers" };
    if (w.defenders.includes(p)) return { war: w, side: "defenders" };
  }
  return null;
}

/** A kingdom's (or rebel faction's, or free settlement's) army. */
export function armyOf(realm: Realm, p: Party, day: number): Side & { seats: Settlement[] } {
  const id = p.slice(2);
  let seats: Settlement[] = [];
  let base: Side;
  if (p[0] === "k") {
    seats = Object.values(realm.settlements).filter((s) => s.kingdom === id && !s.abandoned);
    const sides = seats.map((s) => settlementSide(realm, s, { defending: false }));
    base = { name: realm.kingdoms[id]?.name ?? id, strength: sides.reduce((a, s) => a + s.strength, 0) * 0.3, fighters: sides.flatMap((s) => s.fighters), men: Math.round(sides.reduce((a, s) => a + s.men, 0) * 0.3), home: realm.settlements[realm.kingdoms[id]?.capital ?? ""] ?? null, species: "human", rank: "F" };
  } else if (p[0] === "f") {
    base = gangSide(realm, id);
    const seat = realm.factions[id]?.seat;
    if (seat && realm.settlements[seat]) seats = [realm.settlements[seat]!];
  } else {
    const s = realm.settlements[id]!;
    seats = [s];
    base = settlementSide(realm, s, { defending: false });
  }
  // Those sworn to serve it come too.
  for (const t of realm.treaties.filter((x) => x.kind === "service" && !x.broken && x.until >= day && x.b === p)) {
    const f = realm.figures[t.a.slice(2)];
    if (f?.alive && !base.fighters.includes(f)) {
      base.fighters.push(f);
      base.strength += 6 + 4 * ["G", "F", "E", "D", "C", "B", "A", "S", "SS", "SSS"].indexOf(f.life.tier);
    }
  }
  return { ...base, seats };
}

/** Declare a war. Allies with mutual defence join the defenders. */
export function declareWar(realm: Realm, attackers: Party[], defenders: Party[], day: number, cause: string): War {
  const allies: Party[] = [];
  for (const d of defenders) {
    for (const t of realm.treaties.filter((x) => x.kind === "mutual_defense" && !x.broken && x.until >= day && (x.a === d || x.b === d))) {
      const ally = t.a === d ? t.b : t.a;
      if (!attackers.includes(ally) && !defenders.includes(ally) && !allies.includes(ally) && ally.startsWith("k:")) allies.push(ally);
    }
    // Breaking a promise not to fight.
    for (const t of treatiesBetween(realm, attackers, [d], day, ["non_aggression", "trade"])) breakTreaty(realm, t, attackers[0]!, day, "it went to war");
  }
  const w: War = { id: `w${realm.next++}`, attackers, defenders: [...defenders, ...allies], cause, start: day, score: 0, battles: [] };
  realm.wars.push(w);
  tally(realm, "wars");
  const capitalOf = (p: Party) => (p[0] === "k" ? realm.kingdoms[p.slice(2)]?.capital ?? null : p[0] === "s" ? p.slice(2) : (realm.factions[p.slice(2)]?.seat ?? null));
  realmNews(realm, day, capitalOf(defenders[0]!), "war", `War! ${cap(attackers.map((p) => partyName(realm, p)).join(" and "))} has gone to war with ${defenders.map((p) => partyName(realm, p)).join(" and ")} (${cause})${allies.length > 0 ? `; ${allies.map((p) => partyName(realm, p)).join(" and ")} stand${allies.length === 1 ? "s" : ""} with them` : ""}.`, 9, [...attackers, ...defenders, ...allies].map((p) => partyName(realm, p)), { why: cause });
  return w;
}

/** Where the fighting is: the defenders' settlement nearest the attackers. */
function front(realm: Realm, w: War, day: number): Settlement | null {
  const att = armyOf(realm, w.attackers[0]!, day).seats;
  const def = w.defenders.flatMap((p) => armyOf(realm, p, day).seats);
  let best: { s: Settlement; d: number } | null = null;
  for (const d of def) for (const a of att) {
    const dd = distance(realm, a.id, d.id);
    if (!best || dd < best.d) best = { s: d, d: dd };
  }
  return best?.s ?? def[0] ?? null;
}

/** One day of every war: battles every few days, captures, and peace. Also declarations. */
export function warsDay(realm: Realm, day: number, rng: Rng): void {
  for (const w of ongoing(realm)) {
    if ((day - w.start) % BATTLE_EVERY !== 0 || day === w.start) continue;
    const at = front(realm, w, day);
    const attack = armyOf(realm, w.attackers[0]!, day);
    for (const extra of w.attackers.slice(1)) attack.strength += armyOf(realm, extra, day).strength * 0.5;
    if (!at || attack.strength <= 0) {
      endWar(realm, w, day, "defenders", "the attackers had no one left to fight");
      continue;
    }
    const defence = settlementSide(realm, at);
    for (const d of w.defenders) defence.strength += armyOf(realm, d, day).strength * (d === w.defenders[0] ? 0.4 : 0.25);
    const r = fight(realm, attack, defence, day, rng, `the battle of ${at.name}`);
    casualty(realm, attack.home, "battle", r.lost.attackers, `battle:${day}:${at.id}:attackers`, day);
    casualty(realm, at, "battle", r.lost.defenders, `battle:${day}:${at.id}`, day);
    at.lastRaided = day;
    // A battle lost at the walls leaves its mark.
    if (r.attackerWon && rng() < 0.5) damageBuilding(at, rng);
    w.score = Math.max(-100, Math.min(100, w.score + (r.attackerWon ? 18 : -18)));
    w.battles.push({ day, at: at.id, winner: r.attackerWon ? "attackers" : "defenders", losses: r.lost.attackers + r.lost.defenders, text: `${r.attackerWon ? attack.name : at.name} won at ${at.name}` });
    tally(realm, "battles");
    for (const p of [...w.attackers, ...w.defenders]) if (p.startsWith("k:")) realm.kingdoms[p.slice(2)]!.weariness = Math.min(100, realm.kingdoms[p.slice(2)]!.weariness + 6);
    sendArrival(realm, at.id, { day, kind: "war_levy", count: r.lost.defenders, by: attack.name });
    realmNews(realm, day, at.id, "battle", `The battle of ${at.name}: ${r.attackerWon ? `${attack.name} won` : `${at.name} held`}; ${r.lost.attackers + r.lost.defenders} fell${r.dead.length > 0 ? `, ${r.dead.map((f) => f.name).join(" and ")} among them` : ""}.`, 7, [at.name, attack.name, ...r.dead.map((f) => f.name)]);
    // Taken: it changes hands.
    if (r.attackerWon && w.score >= CAPTURE_SCORE && at.kind !== "capital" && w.attackers[0]!.startsWith("k:")) capture(realm, at, w.attackers[0]!.slice(2), day);
    const weary = w.attackers.concat(w.defenders).filter((p) => p.startsWith("k:")).every((p) => realm.kingdoms[p.slice(2)]!.weariness >= 60);
    if (w.score >= WAR_WON) endWar(realm, w, day, "attackers", "they won the field");
    else if (w.score <= -WAR_WON) endWar(realm, w, day, "defenders", "they threw the attackers back");
    else if (weary || day - w.start > 45) endWar(realm, w, day, Math.abs(w.score) < 20 ? "none" : w.score > 0 ? "attackers" : "defenders", "both sides were worn out");
  }
  // Rebels whose leader is gone, or with nobody left, give up.
  for (const w of ongoing(realm)) {
    for (const p of [...w.attackers, ...w.defenders]) {
      const f = p.startsWith("f:") ? realm.factions[p.slice(2)] : undefined;
      if (f && (f.dissolved || f.members.length === 0)) endWar(realm, w, day, w.attackers.includes(p) ? "defenders" : "attackers", `${f.name} was broken`);
    }
  }
  // Kingdoms rest when not fighting; opinions drift back.
  for (const k of Object.values(realm.kingdoms)) {
    if (!warOf(realm, `k:${k.id}`)) k.weariness = Math.max(0, k.weariness - 1.5);
    for (const o of Object.keys(k.opinion)) {
      const trade = treatiesBetween(realm, [`k:${k.id}`], [`k:${o}`], day, ["trade"]).length > 0;
      k.opinion[o] = Math.max(-100, Math.min(100, k.opinion[o]! + (trade ? 0.4 : 0) + (k.opinion[o]! < 0 ? 0.3 : k.opinion[o]! > 0 ? -0.2 : 0)));
    }
  }
  declareWars(realm, day, rng);
}

/** Kingdoms that hate each other and feel strong enough go to war; crowns fight rebels and places that broke away. */
function declareWars(realm: Realm, day: number, rng: Rng): void {
  const ks = Object.values(realm.kingdoms).filter((k) => !k.fallen);
  for (const a of ks) {
    if (warOf(realm, `k:${a.id}`) || a.weariness > 30) continue;
    const ruler = a.ruler ? realm.figures[a.ruler] : undefined;
    for (const b of ks) {
      if (a === b || warOf(realm, `k:${b.id}`)) continue;
      const hate = (a.opinion[b.id] ?? 0) <= -50;
      const sworn = atPeace(realm, [`k:${a.id}`], [`k:${b.id}`], day);
      const bold = ruler !== undefined && ruler.ambition > 0.8 && ruler.bravery > 0.6;
      if (!hate || (sworn && !(bold && ruler!.loyalty < 0.3))) continue;
      const mine = armyOf(realm, `k:${a.id}`, day).strength;
      const theirs = armyOf(realm, `k:${b.id}`, day).strength;
      if (mine < theirs * (bold ? 0.9 : 1.15) || rng() >= WAR_CHANCE) continue;
      declareWar(realm, [`k:${a.id}`], [`k:${b.id}`], day, `${a.name} has had enough of ${b.name}`);
      return;
    }
  }
  for (const f of Object.values(realm.factions)) {
    if (f.dissolved || f.kind !== "rebels" || warOf(realm, `f:${f.id}`) || !f.seat) continue;
    const seat = realm.settlements[f.seat];
    const crown = seat?.kingdom ? realm.kingdoms[seat.kingdom] : undefined;
    if (!crown || f.members.length < 3 || rng() >= REBEL_WAR_CHANCE) continue;
    declareWar(realm, [`k:${crown.id}`], [`f:${f.id}`], day, `${crown.name} moves to crush ${f.name}`);
  }
  for (const s of Object.values(realm.settlements)) {
    if (s.freeSince === undefined || s.kingdom !== null || warOf(realm, `s:${s.id}`) || s.abandoned) continue;
    const was = Object.values(realm.kingdoms).find((k) => (k.opinion[`free:${s.id}`] ?? 0) < 0);
    if (!was || warOf(realm, `k:${was.id}`) || rng() >= REBEL_WAR_CHANCE) continue;
    declareWar(realm, [`k:${was.id}`], [`s:${s.id}`], day, `${was.name} wants ${s.name} back`);
  }
}

/** A settlement taken in war: it now answers to the winner's nearest town, city or capital. */
function capture(realm: Realm, s: Settlement, kingdom: string, day: number): void {
  const from = s.kingdom;
  const lieges = Object.values(realm.settlements).filter((x) => x.kingdom === kingdom && (x.kind === "town" || x.kind === "city" || x.kind === "capital") && x.id !== s.id);
  lieges.sort((a, b) => distance(realm, a.id, s.id) - distance(realm, b.id, s.id));
  const liege = lieges[0];
  const moved = [s, ...Object.values(realm.settlements).filter((x) => x.liege === s.id)];
  for (const x of moved) x.kingdom = kingdom;
  s.liege = liege?.id ?? null;
  s.freeSince = undefined;
  const lead = s.leader ? realm.figures[s.leader] : undefined;
  if (lead) lead.superior = liege?.leader ?? null;
  tally(realm, "captured");
  realmNews(realm, day, s.id, "war", `${s.name} has fallen to ${realm.kingdoms[kingdom]!.name}${from ? `, taken from ${realm.kingdoms[from]?.name ?? from}` : ""}.`, 8, [s.name, realm.kingdoms[kingdom]!.name], { why: "its defenders lost the war" });
}

/** Peace: the loser pays tribute, and both swear not to fight for a while. */
export function endWar(realm: Realm, w: War, day: number, winner: "attackers" | "defenders" | "none", why: string): void {
  if (w.end !== undefined) return;
  w.end = day;
  const a = w.attackers[0]!;
  const d = w.defenders[0]!;
  const winnerName = winner === "none" ? null : partyName(realm, winner === "attackers" ? a : d);
  w.outcome = winner === "none" ? `a peace with no winner (${why})` : `${winnerName} won (${why})`;
  tally(realm, "wars_ended");
  if (a.startsWith("k:") && d.startsWith("k:")) {
    sign(realm, "non_aggression", a, d, day, 40, `the peace after the war`);
    if (winner !== "none") sign(realm, "tribute", winner === "attackers" ? d : a, winner === "attackers" ? a : d, day, 30, "the price of losing the war", 600);
    shiftOpinion(realm, a.slice(2), d.slice(2), 20);
    shiftOpinion(realm, d.slice(2), a.slice(2), 20);
  }
  // Rebels: broken, or free.
  for (const p of [a, d]) {
    const f = p.startsWith("f:") ? realm.factions[p.slice(2)] : undefined;
    if (!f) continue;
    const won = (winner === "attackers" && p === a) || (winner === "defenders" && p === d);
    const seat = f.seat ? realm.settlements[f.seat] : undefined;
    if (won && seat && seat.kingdom) {
      const crown = realm.kingdoms[seat.kingdom];
      if (crown) crown.opinion[`free:${seat.id}`] = -60;
      seat.kingdom = null;
      seat.liege = null;
      seat.freeSince = day;
      const lead = f.leader ? realm.figures[f.leader] : undefined;
      if (lead) {
        seat.leader = lead.id;
        lead.home = seat.id;
        lead.role = "lord";
        lead.superior = null;
        addRenown(lead, 15);
      }
    } else if (!won) {
      f.dissolved = day;
    }
  }
  const where = a.startsWith("k:") ? realm.kingdoms[a.slice(2)]?.capital ?? null : null;
  realmNews(realm, day, where, "peace", `The war between ${partyName(realm, a)} and ${partyName(realm, d)} is over: ${w.outcome}.`, 8, [partyName(realm, a), partyName(realm, d)], { why: w.outcome ?? "the fighting ended" });
}

const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1);
