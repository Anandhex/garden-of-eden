import { plural } from "./names.js";
import { z } from "zod";
import { structured } from "../../director/structured.js";
import type { LLMProvider } from "../../llm/provider.js";
import type { Rng } from "../dice.js";
import { tierIndex, type Tier } from "../life.js";
import { atWar } from "./economy.js";
import { addRenown, figurePower, makeFigure, residents, titled } from "./figures.js";
import { foundFaction } from "./factions.js";
import { atPeace, partiesOf, sign, treatiesBetween, warOf } from "./diplomacy.js";
import { HOME_ID, neighbours, travelDays } from "./generate.js";
import { logPush, realmNews, tally } from "./log.js";
import { gangSide, settlementSide } from "./military.js";
import type { DirectorPush, Figure, Realm, Settlement } from "./types.js";

/**
 * An active director (N13.8). The nightly chronicle (N12) only reacts; this one
 * looks at what people need every morning and pushes something to happen: a
 * faction for the poor, the angry or the ambitious, a pact for the raided, a
 * trade road between friends, a caravan for the hungry, a bounty on beasts and
 * dungeons, a sword for hire in a war. Every push is a rule in code, with a
 * reason, logged; at most PUSHES_PER_DAY a day, the most pressing first.
 *
 * The model's part is words only: it may rename a faction code founded, with a
 * creed, through the invented-name check (nameFaction), else code's name stands.
 */
export const PUSHES_PER_DAY = 3;
/** Days before the director pushes the same thing at the same place again. */
export const COOLDOWN_DAYS = 10;
/** Most factions alive at once: past it, nobody founds a new one (splits still happen). */
export const MAX_FACTIONS = 24;
/** New factions a day, at most. */
export const FOUNDINGS_PER_DAY = 1;

interface Candidate {
  kind: string;
  target: string;
  reason: string;
  /** How pressing, 0..10. */
  score: number;
  run: () => boolean;
}

/** A faction like this already has its seat or a hall within `days` of the place. */
function within(realm: Realm, id: string, days: number, pred: (f: Realm["factions"][string]) => boolean): boolean {
  return Object.values(realm.factions).some((f) => !f.dissolved && pred(f) && [f.seat, ...f.branches].some((b) => b !== null && travelDays(realm, b, id) <= days));
}

/** A few of the crowd follow a new gang or rebels. */
function followers(realm: Realm, s: Settlement, factionId: string, rng: Rng, day: number, role: Figure["role"], n: number): void {
  const fac = realm.factions[factionId];
  if (!fac) return;
  for (let i = 0; i < n; i++) {
    const f = makeFigure(realm, rng, { role, home: role === "bandit" ? null : s.id, tier: rng() < 0.7 ? "G" : "F", age: 17 + Math.floor(rng() * 25), faction: factionId, superior: fac.leader, rose: "crowd" }, day);
    f.loyalty = Math.min(f.loyalty, 0.4);
    fac.members.push(f.id);
  }
}

/** Someone to found it: a resident who suits it, or someone stepping out of the crowd. */
function founderFor(realm: Realm, s: Settlement, rng: Rng, day: number, pick: (f: Figure) => number, role: Figure["role"]): Figure {
  const options = residents(realm, s.id).filter((f) => !f.talks && s.leader !== f.id && !["ruler", "lord"].includes(f.role));
  options.sort((a, b) => pick(b) - pick(a));
  const best = options[0];
  if (best && pick(best) > 0.5) return best;
  const f = makeFigure(realm, rng, { role, home: s.id, tier: "F", age: 22 + Math.floor(rng() * 20), rose: "crowd" }, day);
  f.ambition = Math.max(f.ambition, 0.7);
  return f;
}

/** What each settlement needs, as pushes code could make. */
export function candidates(realm: Realm, day: number, rng: Rng): Candidate[] {
  const out: Candidate[] = [];
  const live = Object.values(realm.settlements).filter((s) => !s.abandoned);
  for (const s of live) {
    // The desperate turn outlaw.
    if (s.prosperity < 30 && s.food < 30 && !within(realm, s.id, 2, (f) => f.kind === "gang")) {
      out.push({ kind: "found_gang", target: s.id, reason: `${s.name} is poor and hungry`, score: 6 + (30 - s.food) / 10, run: () => {
        const f = founderFor(realm, s, rng, day, (x) => x.greed * x.bravery, "bandit chief");
        const g = foundFaction(realm, rng, { kind: "gang", founder: f, seat: s.id, creed: "the roads owe us a living", why: `${s.name} is starving and nobody helps` }, day);
        f.home = null;
        followers(realm, s, g.id, rng, day, "bandit", 2 + Math.floor(rng() * 3));
        return true;
      } });
    }
    // Heavy taxes on a poor place breed rebels.
    if (s.liege && s.prosperity < 32 && (s.arrears > 0 || s.taxRate >= 0.15) && !within(realm, s.id, 1, (f) => f.kind === "rebels")) {
      out.push({ kind: "found_rebels", target: s.id, reason: `${s.name} can't bear its taxes`, score: 5 + s.arrears * 2 + (35 - s.prosperity) / 10, run: () => {
        const f = founderFor(realm, s, rng, day, (x) => x.ambition * (1 - x.loyalty), "rebel");
        const r = foundFaction(realm, rng, { kind: "rebels", founder: f, seat: s.id, creed: "no more taxes for lords who give nothing back", why: `${s.name} is bled dry by taxes` }, day);
        followers(realm, s, r.id, rng, day, "rebel", 2 + Math.floor(rng() * 3));
        return true;
      } });
    }
    // Danger nearby and no adventurers to meet it.
    const danger = Object.values(realm.dungeons).some((d) => d.near === s.id && d.danger >= 60) || Object.values(realm.packs).some((p) => p.near === s.id && p.count >= p.cap * 0.7);
    const advNear = within(realm, s.id, 2, (f) => f.trade === "adventurers");
    if (danger && !advNear && (s.kind === "town" || s.kind === "city")) {
      out.push({ kind: "found_guild", target: s.id, reason: `monsters near ${s.name} and no adventurers within reach`, score: 5, run: () => {
        const f = founderFor(realm, s, rng, day, (x) => (x.role === "adventurer" || x.role === "hunter" ? 1 : 0) * (0.5 + x.bravery), "adventurer");
        f.role = "adventurer";
        foundFaction(realm, rng, { kind: "guild", trade: "adventurers", founder: f, seat: s.id, creed: "the wilds made safe, for a price", why: `the beasts and the deep places near ${s.name} need dealing with` }, day);
        for (let i = 0; i < 2; i++) {
          const a = makeFigure(realm, rng, { role: "adventurer", home: s.id, tier: (["G", "F", "E"] as Tier[])[Math.floor(rng() * 3)]!, age: 18 + Math.floor(rng() * 15), faction: f.faction, superior: f.id, rose: "crowd" }, day);
          realm.factions[f.faction!]!.members.push(a.id);
        }
        return true;
      } });
    }
    // Rich traders band together.
    if (s.prosperity > 62 && (s.buildings.market ?? 0) >= 2 && !within(realm, s.id, 2, (f) => f.trade === "merchants")) {
      out.push({ kind: "found_guild", target: s.id, reason: `${s.name}'s market is thriving`, score: 3, run: () => {
        const f = founderFor(realm, s, rng, day, (x) => (x.role === "merchant" ? 1 : 0) + x.greed * 0.3, "merchant");
        foundFaction(realm, rng, { kind: "guild", trade: "merchants", founder: f, seat: s.id, creed: "fair scales and open roads", why: `${s.name}'s traders want a say` }, day);
        return true;
      } });
    }
    // Hungry villages band together to share seed and grain.
    if ((s.kind === "village" || s.kind === "hamlet") && s.food < 30 && !within(realm, s.id, 2, (f) => f.trade === "farmers")) {
      out.push({ kind: "found_association", target: s.id, reason: `${s.name}'s granary is nearly empty`, score: 3 + (30 - s.food) / 10, run: () => {
        const f = founderFor(realm, s, rng, day, (x) => (x.role === "farmer" ? 1 : 0) + (1 - x.greed) * 0.3, "farmer");
        foundFaction(realm, rng, { kind: "association", trade: "farmers", founder: f, seat: s.id, creed: "no one goes hungry while a neighbour has grain", why: `the fields of ${s.name} failed` }, day);
        return true;
      } });
    }
    // Raided and alone: look for an ally.
    if (s.lastRaided !== undefined && day - s.lastRaided <= 5 && treatiesBetween(realm, partiesOf(realm, s), Object.values(realm.settlements).map((x) => `s:${x.id}` as const), day, ["mutual_defense"]).length === 0) {
      const ally = neighbours(realm, s.id).filter((n) => n.kingdom === s.kingdom && n.id !== s.liege).sort((a, b) => settlementSide(realm, b).strength - settlementSide(realm, a).strength)[0];
      if (ally) out.push({ kind: "treaty", target: s.id, reason: `${s.name} was raided and wants friends`, score: 6, run: () => (sign(realm, "mutual_defense", `s:${s.id}`, `s:${ally.id}`, day, 40, `after the raid on ${s.name}`), true) });
    }
    // Hungry: a caravan from a neighbour with grain to spare.
    if (s.food < 20) {
      const giver = neighbours(realm, s.id).filter((n) => n.food > 60 && !atPeaceBroken(realm, n, s, day)).sort((a, b) => b.food - a.food)[0];
      if (giver) out.push({ kind: "caravan", target: s.id, reason: `${s.name} is starving and ${giver.name} has grain`, score: 7, run: () => {
        const price = Math.min(s.treasury, Math.round(s.population * 1.5));
        s.treasury -= price;
        giver.treasury += price;
        s.food = Math.min(100, s.food + 20);
        giver.food -= 10;
        tally(realm, "caravans");
        if (s.home) realm.home.push({ day, kind: "caravan", count: 1, by: giver.name });
        realmNews(realm, day, s.id, "caravan", `A grain caravan from ${giver.name} reached hungry ${s.name}.`, 4, [giver.name, s.name]);
        return true;
      } });
    }
    // Beasts or a dungeon too full: whoever can pay puts up a bounty.
    for (const p of Object.values(realm.packs).filter((x) => x.near === s.id && x.count >= x.cap * 0.7 && x.bounty === 0)) {
      out.push({ kind: "bounty", target: p.id, reason: `the ${plural(p.species)} near ${s.name} are too many`, score: 4 + p.count / p.cap, run: () => {
        const amount = Math.min(Math.round(s.treasury * 0.2), 400);
        if (amount < 40) return false;
        s.treasury -= amount;
        p.bounty += amount;
        realmNews(realm, day, s.id, "bounty", `${s.name} has put a bounty of ${Math.round(amount / 100)} gold on the ${plural(p.species)} in its woods.`, s.home ? 5 : 3, [s.name]);
        return true;
      } });
    }
    for (const d of Object.values(realm.dungeons).filter((x) => x.near === s.id && x.danger >= 70 && x.bounty === 0)) {
      out.push({ kind: "bounty", target: d.id, reason: `${d.name} near ${s.name} is filling up`, score: 4 + d.danger / 30, run: () => {
        const amount = Math.min(Math.round(s.treasury * 0.25), 600);
        if (amount < 40) return false;
        s.treasury -= amount;
        d.bounty += amount;
        realmNews(realm, day, s.id, "bounty", `${s.name} will pay ${Math.round(amount / 100)} gold to whoever clears ${d.name}.`, s.home ? 5 : 3, [s.name, d.name]);
        return true;
      } });
    }
    // A gang leans on a weak village: pay us and we'll leave you be.
    const gangs = Object.values(realm.factions).filter((f) => !f.dissolved && f.kind === "gang" && !f.file && f.seat && (f.seat === s.id || neighbours(realm, f.seat).some((n) => n.id === s.id)));
    for (const g of gangs) {
      if (atPeace(realm, [`f:${g.id}`], partiesOf(realm, s), day) || s.kind === "capital" || s.kind === "city") continue;
      const gs = gangSide(realm, g.id).strength;
      if (gs < settlementSide(realm, s).strength * 2) continue;
      out.push({ kind: "tribute", target: s.id, reason: `${g.name} is stronger than ${s.name}'s watch`, score: 3, run: () => (sign(realm, "tribute", `s:${s.id}`, `f:${g.id}`, day, 30, `protection from ${g.name}`, Math.max(10, Math.round(s.treasury * 0.03))), true) });
    }
  }
  // Friends across a border trade.
  for (const a of Object.values(realm.kingdoms)) {
    for (const b of Object.values(realm.kingdoms)) {
      if (a.id >= b.id || (a.opinion[b.id] ?? 0) < 15 || treatiesBetween(realm, [`k:${a.id}`], [`k:${b.id}`], day, ["trade"]).length > 0 || warOf(realm, `k:${a.id}`)?.war.defenders.includes(`k:${b.id}`)) continue;
      out.push({ kind: "treaty", target: a.id, reason: `${a.name} and ${b.name} are on good terms`, score: 3, run: () => (sign(realm, "trade", `k:${a.id}`, `k:${b.id}`, day, 60, "good terms between their crowns"), true) });
    }
  }
  // A kingdom at war hires the strongest free swords.
  for (const k of Object.values(realm.kingdoms)) {
    if (!warOf(realm, `k:${k.id}`)) continue;
    const swords = Object.values(realm.figures)
      .filter((f) => f.alive && !f.talks && ["adventurer", "captain", "hunter"].includes(f.role) && f.faction !== k.crown && tierIndex(f.life.tier as Tier) >= 2 && realm.settlements[f.home ?? ""]?.kingdom === k.id)
      .filter((f) => !realm.treaties.some((t) => t.kind === "service" && t.a === `p:${f.id}` && !t.broken && t.until >= day))
      .sort((a, b) => figurePower(b) - figurePower(a));
    const f = swords[0];
    if (f) out.push({ kind: "service", target: f.id, reason: `${k.name} needs fighters`, score: 6, run: () => (sign(realm, "service", `p:${f.id}`, `k:${k.id}`, day, 30, `${titled(f)} sells their sword to the crown`, 80), addRenown(f, 3), true) });
  }
  return out;
}

/** Raided by them, or at war: no caravans. */
function atPeaceBroken(realm: Realm, a: Settlement, b: Settlement, day: number): boolean {
  return (a.kingdom !== b.kingdom && (atWar(realm, a) || atWar(realm, b))) || (a.lastRaided === day && b.lastRaided === day);
}

/**
 * The director's morning: the most pressing needs get a push (some luck in which,
 * so the same pressure doesn't always win). Returns what it did.
 */
export function directorDay(realm: Realm, day: number, rng: Rng): DirectorPush[] {
  const alive = Object.values(realm.factions).filter((f) => !f.dissolved).length;
  const pool = candidates(realm, day, rng)
    .filter((c) => (realm.cooldowns[`${c.kind}:${c.target}`] ?? 0) <= day)
    .filter((c) => !c.kind.startsWith("found_") || alive < MAX_FACTIONS)
    .map((c) => ({ c, w: c.score + rng() * 3 }));
  let foundings = 0;
  pool.sort((a, b) => b.w - a.w);
  const done: DirectorPush[] = [];
  const touched = new Set<string>();
  for (const { c } of pool) {
    if (done.length >= PUSHES_PER_DAY) break;
    if (touched.has(c.target) || rng() < 0.35) continue;
    if (c.kind.startsWith("found_") && foundings >= FOUNDINGS_PER_DAY) continue;
    touched.add(c.target);
    const ok = c.run();
    realm.cooldowns[`${c.kind}:${c.target}`] = day + COOLDOWN_DAYS * (c.kind.startsWith("found_") ? 2 : 1);
    if (ok && c.kind.startsWith("found_")) foundings += 1;
    const push = { day, kind: c.kind, target: c.target, reason: c.reason, ok };
    logPush(realm, push);
    done.push(push);
    tally(realm, `push_${c.kind}`);
  }
  return done;
}

// ---- Millbrook's needs, for the talking NPCs' quest boards (game/realm/home.ts) ----

export type HomeNeed = "beasts" | "walls" | "food" | "dungeon" | "raiders";

/** What Millbrook needs now, most pressing first. */
export function homeNeeds(realm: Realm, day: number): Array<{ need: HomeNeed; why: string }> {
  const s = realm.settlements[HOME_ID];
  if (!s) return [];
  const out: Array<{ need: HomeNeed; why: string }> = [];
  const pack = Object.values(realm.packs).find((p) => p.near === HOME_ID);
  if (pack && pack.count >= pack.cap * 0.6) out.push({ need: "beasts", why: `the ${plural(pack.species)} in the woods are breeding (${pack.count} of them)` });
  if (s.lastRaided !== undefined && day - s.lastRaided <= 6) out.push({ need: "raiders", why: "raiders hit Millbrook" });
  if (s.project?.building === "walls" || (s.lastRaided !== undefined && day - s.lastRaided <= 12 && (s.buildings.walls ?? 0) < 2)) out.push({ need: "walls", why: "Millbrook is putting up walls" });
  if (s.food < 35) out.push({ need: "food", why: "Millbrook's stores are running low" });
  const d = Object.values(realm.dungeons).find((x) => x.near === HOME_ID);
  if (d && d.danger >= 70) out.push({ need: "dungeon", why: `${d.name} is filling up with things` });
  return out;
}

// ---- Words from the model (optional) ----

export const FactionWordsSchema = z.object({ name: z.string().min(4).max(50), creed: z.string().min(4).max(90) });

/**
 * The model names a faction code founded, and gives it a creed. Only words: the
 * name may use only names already in the realm (places, kingdoms, the founder),
 * plus ordinary words. Returns true if accepted; code's name stands otherwise.
 */
export async function nameFaction(llm: LLMProvider, realm: Realm, id: string): Promise<boolean> {
  const f = realm.factions[id];
  if (!f || f.named || f.file) return false;
  const founder = f.leader ? realm.figures[f.leader] : undefined;
  const seat = f.seat ? realm.settlements[f.seat] : undefined;
  const parent = f.parent ? realm.factions[f.parent] : undefined;
  const system = "You name factions in a small fantasy realm. Reply with a short name (2-6 words, starting with 'the') and a creed (one short line). Use only the place and person names you are given. No other proper names.";
  const prompt = [
    `A ${f.kind}${f.trade ? ` of ${f.trade}` : ""} was just founded${seat ? ` in ${seat.name}` : ""}${founder ? ` by ${founder.name}` : ""}.`,
    parent ? `It split off from ${parent.name}.` : null,
    `What they want: ${f.creed}.`,
    `Names you may use: ${allowedNames(realm, f.seat).join(", ")}.`,
  ]
    .filter(Boolean)
    .join("\n");
  const out = await structured(llm, FactionWordsSchema, { system, prompt, maxTokens: 80, temperature: 0.8 });
  if (!out) return false;
  const name = out.name.trim().replace(/^The /, "the ");
  if (inventedWords(`${name} ${out.creed}`, allowedNames(realm, f.seat)).length > 0) return false;
  if (Object.values(realm.factions).some((o) => o !== f && o.name.toLowerCase() === name.toLowerCase())) return false;
  const old = f.name;
  f.name = name.startsWith("the ") ? name : `the ${name}`;
  f.creed = out.creed.replace(/\.$/, "");
  f.named = true;
  realmNews(realm, realm.day, f.seat, "faction", `${cap(old)} now call themselves ${f.name}: "${f.creed}".`, 3, [old, f.name]);
  return true;
}

/** Names the model may use: places near the seat, kingdoms, and living figures there. */
export function allowedNames(realm: Realm, seat: string | null): string[] {
  const s = seat ? realm.settlements[seat] : undefined;
  const places = s ? [s, ...neighbours(realm, s.id)].map((x) => x.name) : [];
  const people = s ? residents(realm, s.id).map((f) => f.name) : [];
  return [...new Set([...places, ...Object.values(realm.kingdoms).map((k) => k.name), ...people])];
}

/** Words a faction's name may use besides names the realm knows: ordinary words, not proper names. */
const ORDINARY = new Set(
  (
    "The Of And A An In For To Our We No All By With On At From " +
    "Free True New Old Last First United Common Commons Bold Brave Loyal Silent Quiet Hidden Golden Gold Silver Iron Steel Copper Bronze Brass " +
    "Red Black Grey Gray White Green Blue Scarlet Crimson Pale Dark Bright Broken Burning Rising Wild Deep High Low Long Lone " +
    "Brotherhood Sisterhood Company Guild League Hand Hands Fist Eye Heart Band Order Circle Fellowship Lodge Knights Wardens Watch Guard " +
    "Sons Daughters Children Folk People Crown Throne Blade Blades Sword Swords Shield Shields Spear Spears Axe Axes Bow Bows Arrow Arrows Banner Banners " +
    "Road Roads Wolves Wolf Crows Crow Ravens Raven Hawks Hawk Bear Bears Boar Stag Lion Lions Dogs Hounds Kings Hall Moot Society Bond Oath Sworn " +
    "Lantern Lanterns Torch Torches Light Lights Flame Flames Ember Embers Ash Ashes Oak Thorn Thorns River Stone Stones Rose Roses Dawn Dusk Night Storm Wind " +
    "Gate Gates Tower Wall Walls Bridge Coin Coins Purse Scales Scale Plough Ploughmen Grain Harvest Field Fields Mercy Hope Faith Truth Justice Honour Honor Glory Valour " +
    "Bone Bones Blood Fire Water Earth Sky Moon Sun Star Stars Shadow Shadows Riders Seekers Keepers Delvers Hunters Trackers Brothers Sisters Friends " +
    "Guardians Defenders Wanderers Pilgrims Merchants Traders Smiths Farmers Healers Hammer Hammers Anvil Unbowed Uprising Rebellion Revolt Pact Union Accord Covenant " +
    "Fang Fangs Claw Claws Teeth Tooth Mask Masks Cloak Cloaks Hood Hoods Rats Rat Foxes Fox Vipers Viper Serpents Serpent Spiders Spider Ditch Night Reformed"
  ).split(" "),
);

/** Capitalised words that aren't ordinary and aren't part of an allowed name. */
export function inventedWords(text: string, allowed: string[]): string[] {
  const ok = new Set(allowed.flatMap((n) => n.split(/[\s']+/)));
  return [...new Set((text.match(/\b[A-Z][a-z]+\b/g) ?? []).filter((w) => !ORDINARY.has(w) && !ok.has(w)))];
}

const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1);
