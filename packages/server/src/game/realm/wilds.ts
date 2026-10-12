import { plural } from "./names.js";
import type { PlayerState } from "../../npc/types.js";
import { skillLevel } from "../../npc/skills.js";
import type { Rng } from "../dice.js";
import { modifier } from "../dice.js";
import { armorValue, equippedWeapon } from "../gear.js";
import { tierDamageBonus, ITEM_TIERS } from "../items.js";
import { tierIndex, type Tier } from "../life.js";
import { playerGainXp, QUEST_TIER_XP } from "../levels.js";
import { formatMoney } from "../money.js";
import { recordClear } from "../quests.js";
import { seasonOf } from "../weather.js";
import { addDeed, addRenown, figureOvercomes, figurePower, killFigure, makeFigure, takenNames } from "./figures.js";
import { travelDays, HOME_ID } from "./generate.js";
import { realmNews, tally } from "./log.js";
import { bury, fight, settlementSide, type Side } from "./military.js";
import { beastName } from "./names.js";
import type { Dungeon, Figure, Pack, Realm } from "./types.js";

/**
 * Beasts and dungeons (N13.6), in code.
 *
 * Packs breed in spring and summer while the land can feed them, starve past
 * what it can, and when they grow too many they come for the nearest settlement.
 * Hunters thin them (more with a bounty up), and a beast that wins enough can
 * rise to lead its pack, with a name (N13.7).
 *
 * Dungeons fill up while nobody clears them; past DANGER_SPILL, what's inside
 * comes out. Adventurers (the guild's, or anyone with the role) delve the ones
 * within reach: level by level, power against what lives there, for treasure,
 * XP and renown, or death. A cleared dungeon is quiet for a while, then
 * something moves in, sometimes worse. The player can delve the one by Millbrook.
 */
export const DANGER_SPILL = 85;
/** Chance a day adventurers try a dungeon in reach (more with a bounty). */
export const DELVE_CHANCE = 0.12;

const roundBy = (rng: Rng, n: number) => Math.floor(n) + (rng() < n - Math.floor(n) ? 1 : 0);

/** A pack's side in a fight. */
export function packSide(realm: Realm, p: Pack): Side {
  const alpha = p.alpha ? realm.figures[p.alpha] : undefined;
  const per = 3 + tierIndex(p.tier as Tier) * 3;
  return { name: alpha?.alive ? `${alpha.name}'s ${p.species} pack` : `a ${p.species} pack`, strength: p.count * per + (alpha?.alive ? figurePower(alpha) : 0), fighters: alpha?.alive ? [alpha] : [], men: p.count, home: null, species: p.species, rank: p.tier as Tier };
}

/** One day for every pack: births, hunger, hunters, attacks. */
export function packsDay(realm: Realm, day: number, rng: Rng): void {
  const season = seasonOf(day);
  for (const p of Object.values(realm.packs)) {
    const near = realm.settlements[p.near];
    if (!near) continue;
    // Births in spring and summer, while there's room.
    if (p.count >= 2 && p.count < p.cap && (season === "spring" || season === "summer") && rng() < 0.3) {
      const born = 1 + Math.floor(rng() * 2);
      p.count = Math.min(p.cap + 2, p.count + born);
      tally(realm, "beasts_born", born);
    }
    // More than the land feeds: some starve or wander off.
    if (p.count > p.cap && rng() < 0.4) p.count -= 1;
    // A pair wanders into empty woods now and then.
    if (p.count === 0 && rng() < 0.02) p.count = 2;
    // Hunters thin them; a bounty brings more out.
    const hunters = Object.values(realm.figures).filter((f) => f.alive && !f.talks && f.home === p.near && (f.role === "hunter" || f.role === "adventurer"));
    for (const h of hunters) {
      if (p.count <= 1 || rng() >= (p.bounty > 0 ? 0.2 : 0.07)) continue;
      p.count -= 1;
      tally(realm, "culled");
      figureOvercomes(h, 8, { kind: "hunt", rank: p.tier as Tier, what: `hunting a ${p.species}` }, day);
      if (p.bounty > 0) {
        const paid = Math.min(p.bounty, 60);
        p.bounty -= paid;
        h.wealth += paid;
      }
    }
    // A beast rises to lead the pack.
    if (!p.alpha && p.count >= 5 && rng() < 0.02) crownAlpha(realm, p, day, rng, "beating its rivals for the lead of the pack");
    // Too many: they come for the settlement.
    if (p.count >= Math.ceil(p.cap * 0.8) && (p.lastAttack === undefined || day - p.lastAttack >= 5) && rng() < 0.25) attackFrom(realm, p, day, rng);
  }
}

/** A beast becomes the pack's named leader. */
export function crownAlpha(realm: Realm, p: Pack, day: number, rng: Rng, how: string, f?: Figure): Figure {
  const alpha =
    f ??
    makeFigure(realm, rng, { role: "beast", home: null, tier: ITEM_TIERS[Math.min(ITEM_TIERS.length - 1, tierIndex(p.tier as Tier) + 1)]!, age: 4, species: p.species, renown: 20, rose: "crowd", name: beastName(rng, p.species, takenNames(realm)) }, day);
  alpha.role = "beast";
  p.alpha = alpha.id;
  addDeed(alpha, how);
  tally(realm, "alphas");
  realmNews(realm, day, p.near, "beast", `The ${plural(p.species)} near ${realm.settlements[p.near]?.name ?? "the wilds"} have a leader now: ${alpha.name}, ${how}.`, 5, [alpha.name]);
  return alpha;
}

/** The pack attacks the settlement it lives by. */
function attackFrom(realm: Realm, p: Pack, day: number, rng: Rng): void {
  const s = realm.settlements[p.near]!;
  p.lastAttack = day;
  const side = packSide(realm, p);
  const r = fight(realm, side, settlementSide(realm, s), day, rng, `the ${p.species} attack on ${s.name}`);
  p.count = Math.max(0, p.count - r.lost.attackers);
  bury(s, r.lost.defenders);
  if (r.hero && r.hero.role === "beast" && !p.alpha) crownAlpha(realm, p, day, rng, `leading the attack on ${s.name}`, r.hero);
  if (r.attackerWon) {
    s.food = Math.max(0, s.food - 8);
    s.lastRaided = day;
  }
  if (s.home) realm.home.push({ day, kind: "beasts", count: Math.max(1, Math.min(4, Math.round(p.count / 3))), by: p.species });
  tally(realm, "beast_attacks");
  realmNews(realm, day, s.id, "beast", r.attackerWon ? `${cap(side.name)} came out of the wild and savaged ${s.name}'s flocks and fields.` : `${s.name} beat off ${side.name}.`, s.home ? 6 : 4, [s.name, ...(p.alpha ? [realm.figures[p.alpha]!.name] : [])]);
}

/** One day for every dungeon: things breed inside, spill out, and adventurers go in. */
export function dungeonsDay(realm: Realm, day: number, rng: Rng): void {
  for (const d of Object.values(realm.dungeons)) {
    if (d.clearedUntil !== undefined) {
      if (day < d.clearedUntil) continue;
      // Something new has moved in, sometimes worse.
      d.clearedUntil = undefined;
      if (rng() < 0.35 && tierIndex(d.tier as Tier) < 5) d.tier = ITEM_TIERS[tierIndex(d.tier as Tier) + 1]!;
      d.danger = 25;
      d.treasure += 200 * d.depth;
      realmNews(realm, day, d.near, "dungeon", `Something has moved into ${d.name} again.`, 3, [d.name]);
    }
    d.danger = Math.min(100, d.danger + 0.8 + d.depth * 0.3);
    d.treasure += 8 * d.depth;
    if (d.danger >= DANGER_SPILL && rng() < 0.2) spill(realm, d, day, rng);
    if (rng() < DELVE_CHANCE + (d.bounty > 0 ? 0.2 : 0)) {
      const party = partyFor(realm, d, rng);
      if (party.length > 0) delve(realm, d, party, day, rng);
    }
  }
}

/** What's inside a level of a dungeon, as power. */
export function levelPower(d: Dungeon, level: number): number {
  return (d.danger / 100) * (10 + tierIndex(d.tier as Tier) * 12) * (1 + level * 0.25);
}

/** Things come out of a full dungeon and attack the settlement by it. */
function spill(realm: Realm, d: Dungeon, day: number, rng: Rng): void {
  const s = realm.settlements[d.near];
  if (!s) return;
  const side: Side = { name: `the things from ${d.name}`, strength: levelPower(d, d.depth) * 2.5, fighters: [], men: Math.round(d.danger / 10), home: null, species: "spider", rank: d.tier as Tier };
  const r = fight(realm, side, settlementSide(realm, s), day, rng, `the horror from ${d.name}`);
  bury(s, r.lost.defenders);
  d.danger = Math.max(30, d.danger - 25);
  if (r.attackerWon) s.lastRaided = day;
  if (s.home) realm.home.push({ day, kind: "beasts", count: 2, by: "spider" });
  tally(realm, "spills");
  realmNews(realm, day, s.id, "dungeon", `Things crawled out of ${d.name} and fell on ${s.name}${r.attackerWon ? "" : ", but were driven back"}.`, s.home ? 7 : 5, [d.name, s.name]);
}

/** Adventurers within two days of a dungeon who'd go: a guild's own first. Two to four. */
function partyFor(realm: Realm, d: Dungeon, rng: Rng): Figure[] {
  const pool = Object.values(realm.figures).filter((f) => f.alive && !f.talks && f.role === "adventurer" && f.home && travelDays(realm, f.home, d.near) <= 2 && f.life.stage !== "venerable");
  if (pool.length === 0) return [];
  pool.sort((a, b) => (b.faction === a.faction ? 0 : b.faction ? 1 : -1) || figurePower(b) - figurePower(a));
  const size = Math.min(pool.length, 2 + Math.floor(rng() * 3));
  const lead = pool[Math.floor(rng() * Math.min(pool.length, 3))]!;
  return [lead, ...pool.filter((f) => f !== lead && (f.faction === lead.faction || !lead.faction)).slice(0, size - 1)];
}

/** A party delves: level by level until they win through or turn back. Returns lines. */
export function delve(realm: Realm, d: Dungeon, party: Figure[], day: number, rng: Rng): string[] {
  const lines: string[] = [];
  let cleared = 0;
  for (let level = 1; level <= d.depth; level++) {
    const ours = party.filter((f) => f.alive).reduce((a, f) => a + figurePower(f), 0);
    const theirs = levelPower(d, level);
    if (ours <= 0) break;
    if (rng() < ours / (ours + theirs)) {
      cleared = level;
      continue;
    }
    // Turned back, not without losses.
    for (const f of party) {
      const gap = tierIndex(d.tier as Tier) - tierIndex(f.life.tier as Tier);
      if (rng() < Math.max(0.05, Math.min(0.5, 0.2 + gap * 0.1)) && killFigure(realm, f, day, `lost in ${d.name}`)) lines.push(`${f.name} died in ${d.name}.`);
    }
    break;
  }
  d.delves += 1;
  tally(realm, "delves");
  const names = party.map((f) => f.name);
  const who = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : (names[0] ?? "Adventurers");
  const loot = Math.round((d.treasure * 0.6 * cleared) / d.depth);
  d.treasure -= loot;
  d.danger = Math.max(0, d.danger - cleared * (60 / d.depth));
  const living = party.filter((f) => f.alive);
  const guild = living[0]?.faction ? realm.factions[living[0].faction] : undefined;
  const cut = guild ? Math.round(loot * 0.2) : 0;
  if (guild) guild.wealth += cut;
  for (const f of living) {
    f.wealth += Math.floor((loot - cut) / Math.max(1, living.length));
    if (cleared > 0) {
      lines.push(...figureOvercomes(f, 15 * cleared, { kind: "fight", rank: d.tier as Tier, what: `delving ${d.name}` }, day));
      addRenown(f, 3 * cleared);
      addDeed(f, cleared === d.depth ? `cleared ${d.name}` : `went ${cleared} levels into ${d.name}`);
    }
  }
  if (cleared === d.depth) {
    d.clearedUntil = day + 25 + Math.floor(rng() * 20);
    d.danger = 0;
    for (const f of living) f.wealth += Math.floor(d.bounty / Math.max(1, living.length));
    d.bounty = 0;
    tally(realm, "cleared");
    realmNews(realm, day, d.near, "dungeon", `${who} cleared ${d.name}, and came out with ${Math.round(loot / 100)} gold of treasure.`, 6, [d.name, ...names]);
  } else {
    realmNews(realm, day, d.near, "dungeon", `${who} went into ${d.name}${cleared > 0 ? ` and got ${cleared} level${cleared > 1 ? "s" : ""} down` : ""} before turning back${lines.some((l) => l.includes("died")) ? `; not all came out` : ""}.`, 4, [d.name, ...names]);
  }
  return lines;
}

// ---- The player (N13.6) ----

/** Copper to join the adventurers' guild. */
export const GUILD_FEE = 50;
export const ADVENTURERS = "adventurers_guild";

/** Where a dungeon's mouth is, in words (N15): up the road from the place it lies by. */
export function mouthOf(realm: Realm, d: Dungeon): string {
  const s = realm.settlements[d.near];
  return s ? `${d.name} opens at the end of the road out of ${s.name}${s.id === HOME_ID ? " (the mine road, north of the village)" : ""}` : d.name;
}

/** Dungeons the player can reach from where they are (a day or less; Millbrook by default). */
export function dungeonsInReach(realm: Realm, from: string = HOME_ID): Dungeon[] {
  return Object.values(realm.dungeons).filter((d) => travelDays(realm, d.near, from) <= 1);
}

/** The player's rank in the adventurers' guild, by renown. */
export function guildRank(player: Pick<PlayerState, "renown" | "factions">): string | null {
  if (!inGuild(player)) return null;
  const r = player.renown ?? 0;
  return r >= 60 ? "master" : r >= 25 ? "journeyman" : "apprentice";
}

export function inGuild(player: Pick<PlayerState, "factions">): boolean {
  return (player.factions ?? []).includes(ADVENTURERS);
}

/** Join the adventurers' guild (it has a hall a day away). */
export function joinGuild(realm: Realm, player: PlayerState): { ok: boolean; message: string } {
  const g = realm.factions[ADVENTURERS];
  if (!g || g.dissolved) return { ok: false, message: "There's no adventurers' guild to join any more." };
  if (inGuild(player)) return { ok: false, message: `You're already a member of ${g.name}.` };
  if (player.money < GUILD_FEE) return { ok: false, message: `Joining ${g.name} costs ${formatMoney(GUILD_FEE)}, and you're short.` };
  player.money -= GUILD_FEE;
  (player.factions ??= []).push(ADVENTURERS);
  g.wealth += GUILD_FEE;
  return { ok: true, message: `You paid ${formatMoney(GUILD_FEE)} and joined ${g.name}. You can delve now: ${dungeonsInReach(realm, player.site ?? HOME_ID).map((d) => d.name).join(", ") || "nothing in reach"}.` };
}

export interface PlayerDelve {
  ok: boolean;
  lines: string[];
  /** Hours it took (the caller passes the time). */
  hours: number;
  money: number;
  xp: number;
}

/** The player's fighting power for a delve: level, strength, weapon and its skill, armour. */
export function playerPower(player: PlayerState): number {
  const w = equippedWeapon(player);
  return 6 + player.level * 3 + modifier(player.attributes.strength) * 2 + Math.round(w.die / 2) + tierDamageBonus(w.tier) + skillLevel(player.skills, w.skill) * 2 + armorValue(player);
}

/**
 * The player delves a dungeon by Millbrook: level by level, their power against
 * what lives there. A level won pays its share of the treasure and XP; a level
 * lost costs a quarter of their HP, and below 30% HP they get out. Clearing it
 * all earns the bounty and quiets the dungeon for a while.
 */
export function playerDelve(realm: Realm, player: PlayerState, query: string, day: number, rng: Rng): PlayerDelve {
  const none = (message: string): PlayerDelve => ({ ok: false, lines: [message], hours: 0, money: 0, xp: 0 });
  if (!inGuild(player)) return none(`Only members of the adventurers' guild go into the dungeons (join it for ${formatMoney(GUILD_FEE)}).`);
  const here = player.site ?? HOME_ID;
  const reach = dungeonsInReach(realm, here);
  const q = query.trim().toLowerCase();
  // At a dungeon's mouth (N15), that's the one; otherwise the one asked for, to say where its mouth is.
  const atMouth = player.area === "mine";
  const matches = reach.filter((x) => !q || x.name.toLowerCase().includes(q) || x.id === q);
  const d = (atMouth ? matches.find((x) => x.near === here) : undefined) ?? matches[0];
  if (!d) return none(`No dungeon like that within a day of ${realm.settlements[here]?.name ?? "here"}. In reach: ${reach.map((x) => x.name).join(", ") || "none"}.`);
  if (!atMouth || d.near !== here) return none(`You go down into a dungeon from its mouth: ${mouthOf(realm, d)}. Walk there first.`);
  if (d.clearedUntil !== undefined && day < d.clearedUntil) return none(`${cap(d.name)} has been cleared; it's quiet for now.`);
  if (player.hp <= player.maxHp * 0.3) return none("You're in no state to go down there. Heal first.");
  const lines = [`You go down into ${d.name} (rank ${d.tier}, ${d.depth} levels).`];
  let cleared = 0;
  let money = 0;
  let xp = 0;
  for (let level = 1; level <= d.depth; level++) {
    const ours = playerPower(player);
    const theirs = levelPower(d, level);
    if (rng() < ours / (ours + theirs)) {
      cleared = level;
      const share = Math.round((d.treasure * 0.5) / d.depth);
      d.treasure -= share;
      money += share;
      const gain = Math.round(QUEST_TIER_XP[d.tier as Tier] * 0.4);
      xp += gain;
      lines.push(`Level ${level}: you fight your way through and find ${formatMoney(share)}.`);
      continue;
    }
    const hurt = Math.ceil(player.maxHp * 0.25);
    player.hp = Math.max(1, player.hp - hurt);
    lines.push(`Level ${level}: it's too much. You take a beating (−${hurt} HP).`);
    if (player.hp <= player.maxHp * 0.3) {
      lines.push("You get out while you still can.");
      break;
    }
    level -= 1; // try the same level again
    if (lines.length > 12) break;
  }
  d.delves += 1;
  d.danger = Math.max(0, d.danger - cleared * (60 / d.depth));
  if (cleared === d.depth) {
    d.clearedUntil = day + 25 + Math.floor(rng() * 20);
    d.danger = 0;
    money += d.bounty;
    if (d.bounty > 0) lines.push(`You claim the ${formatMoney(d.bounty)} bounty on it.`);
    d.bounty = 0;
    lines.push(`You've cleared ${d.name}!`);
    lines.push(...recordClear(player, d.id));
    player.renown = Math.min(100, (player.renown ?? 0) + 10);
    tally(realm, "cleared");
    realmNews(realm, day, d.near, "dungeon", `${player.name} cleared ${d.name}.`, 6, [player.name, d.name]);
  }
  player.money += money;
  player.renown = Math.min(100, (player.renown ?? 0) + 3 * cleared);
  const levels = playerGainXp(player, xp);
  if (xp > 0) lines.push(`+${xp} XP${levels > 0 ? ` (level ${player.level}!)` : ""}.`);
  tally(realm, "player_delves");
  return { ok: true, lines, hours: 2 * Math.max(1, cleared + 1), money, xp };
}

const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1);
