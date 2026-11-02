import type { BeastRow, BeastStore, Kill } from "../../store/beastStore.js";
import { killsOf, woundsOf } from "../../store/beastStore.js";
import { speciesOf } from "../../world/species.js";
import { config } from "../../config.js";
import { streamFor, type Rng } from "../dice.js";
import { createLife, tierIndex, TIERS, type Life, type Tier } from "../life.js";
import { addDeed, addRenown, killFigure, makeFigure, takenNames } from "./figures.js";
import { realmNews, tally } from "./log.js";
import { beastName, plural } from "./names.js";
import type { Figure, Pack, Realm } from "./types.js";

/**
 * Pack beasts as rows (N26F decision 14). The realm's pack rules (wilds.ts) still work in numbers, a day at a time and
 * without the database, but every change they make is written to the pack's log with its cause (`bear`, `lose`,
 * `tookLife`). Each day `syncBeasts` turns the log into rows: a birth is a young row with a mother in the pack, a loss
 * kills a particular row (the weakest for hunger, a grown one for a hunter), a kill is remembered by the beast that made
 * it. After the sync a pack's `count` is its living rows. Fights on a map or on the road act on rows directly
 * (haunts.ts, road/hostiles.ts) and keep `count` in step themselves.
 *
 * A beast rises to a named figure when it wins NAMED_AFTER_WINS fights, kills a person, lives through two fights with
 * people, or grows very old. When the alpha dies the strongest named beast (else the oldest grown one) leads, and a
 * pack past its cap with two named beasts splits.
 */

/** Fights won that earn a beast a name. */
export const BEAST_NAMED_AFTER_WINS = 3;
/** Fights with people lived through that earn a beast a name. */
export const BEAST_NAMED_AFTER_SURVIVING = 2;
/** Share of its kind's greatest age past which an old beast is known by name. */
export const BEAST_GREAT_AGE = 0.8;
/** How much of its hurt a beast mends each day. */
export const BEAST_MENDS = 0.25;

// ---- The log the realm writes ----

/** Young born into a pack. */
export function bear(p: Pack, n: number, day: number): void {
  if (n <= 0) return;
  p.count += n;
  (p.log ??= []).push({ day, born: n, how: "born" });
}

/** Beasts lost from a pack, and how ("starved", "hunted by Hal", "killed in the attack on Ashby"). */
export function lose(p: Pack, n: number, day: number, how: string, by?: string): void {
  const k = Math.min(n, p.count);
  if (k <= 0) return;
  p.count -= k;
  (p.log ??= []).push({ day, lost: k, how, ...(by ? { by } : {}) });
}

/** A beast of the pack killed someone: which one is picked by the sync, and it remembers. */
export function tookLife(p: Pack, day: number, victim: { who: string; name: string }): void {
  (p.log ??= []).push({ day, how: "killed", victim });
}

// ---- Rows ----

const sexOf = (rng: Rng): "f" | "m" => (rng() < 0.5 ? "f" : "m");

function newRow(p: Pack, id: string, age: number, day: number, rng: Rng, mother: string | null): BeastRow {
  const def = speciesOf(p.species);
  const tier = p.tier as Tier;
  const life = createLife(def, age, tier, day, TIERS[Math.min(tierIndex(def.maxTier), tierIndex(tier) + (rng() < 0.3 ? 1 : 0))]!);
  return { id, pack: p.id, species: p.species, sex: sexOf(rng), born: life.bornOnDay, mother, life: JSON.stringify(life), wounds: JSON.stringify({ hp: 1, scars: [], survived: 0 }), wins: 0, kills: "[]", figure: null, died: null, died_how: null, died_by: null };
}

export const lifeOfRow = (b: BeastRow): Life => JSON.parse(b.life) as Life;
export const ageOfRow = (b: BeastRow, day: number): number => Math.max(0, Math.floor((day - b.born) / config.daysPerYear));
const grown = (b: BeastRow, day: number) => ageOfRow(b, day) >= speciesOf(b.species).adultAge;

/** A pack's beasts made for the first time: `count` rows of mixed ages, the alpha's row its figure. */
export function seedPack(store: BeastStore, realm: Realm, p: Pack, day: number): void {
  if (store.ofPack(p.id).length > 0) return;
  const rng = streamFor(realm.seed, "beasts", p.id);
  const def = speciesOf(p.species);
  const alpha = p.alpha ? realm.figures[p.alpha] : undefined;
  for (let i = 0; i < p.count; i++) {
    const age = i === 0 && alpha ? Math.max(def.adultAge, Math.min(def.elderAge, Math.floor((day - alpha.life.bornOnDay) / config.daysPerYear))) : Math.floor(rng() * def.elderAge);
    const row = newRow(p, `b-${p.id}-${i + 1}`, age, day, rng, null);
    if (i === 0 && alpha?.alive) {
      row.figure = alpha.id;
      row.life = JSON.stringify(alpha.life);
      row.born = alpha.life.bornOnDay;
      row.sex = alpha.gender === "female" ? "f" : "m";
    }
    store.add(row);
  }
}

/** The next row id of a pack, never reused. */
function nextId(store: BeastStore, p: Pack): string {
  return `b-${p.id}-${store.ofPack(p.id).length + 1}`;
}

/** Kill a beast's row (and its figure, if it had risen). */
export function killBeast(realm: Realm, store: BeastStore, id: string, day: number, how: string, by: string | null): boolean {
  const b = store.get(id);
  if (!b || b.died !== null) return false;
  const p = realm.packs[b.pack];
  const wasAlpha = !!p && !!b.figure && p.alpha === b.figure;
  store.update(id, { died: day, died_how: how, died_by: by });
  const f = b.figure ? realm.figures[b.figure] : undefined;
  if (f?.alive) killFigure(realm, f, day, how);
  if (p) p.count = Math.min(p.count, store.livingCount(p.id));
  if (p && wasAlpha) {
    p.alpha = null;
    succeed(realm, store, p, day);
  }
  return true;
}

/** Bring every pack's rows in line with its log and its count. Returns lines worth telling (risings, new leaders). */
export function syncBeasts(realm: Realm, store: BeastStore, day: number): string[] {
  const out: string[] = [];
  for (const p of Object.values(realm.packs).sort((a, b) => (a.id < b.id ? -1 : 1))) {
    seedPack(store, realm, p, day);
    const rng = streamFor(realm.seed, "beasts-day", p.id, day);
    const log = p.log ?? [];
    delete p.log;
    for (const e of log) {
      if (e.born) {
        const mothers = store.living(p.id).filter((b) => b.sex === "f" && grown(b, day));
        for (let i = 0; i < e.born; i++) {
          const mother = mothers.length > 0 ? mothers[Math.floor(rng() * mothers.length)]!.id : null;
          store.add(newRow(p, nextId(store, p), 0, day, rng, mother));
        }
      } else if (e.lost) {
        for (let i = 0; i < e.lost; i++) {
          const pool = store.living(p.id);
          if (pool.length === 0) break;
          // Hunger and the cold take the youngest and the oldest; hunters and fights take the grown (never the leader first).
          const hungry = /starv|cold/.test(e.how);
          const fighters = pool.filter((b) => grown(b, day) && b.figure !== p.alpha);
          const span = (b: BeastRow) => Math.abs(ageOfRow(b, day) - speciesOf(b.species).elderAge / 2);
          const pick = hungry ? [...pool].sort((a, b) => span(b) - span(a) || (a.id < b.id ? -1 : 1))[0]! : (fighters[Math.floor(rng() * fighters.length)] ?? pool.at(-1)!);
          if (/wander/.test(e.how)) {
            // Wandering off isn't dying, but the beast is gone from the pack and its record.
            store.update(pick.id, { died: day, died_how: "wandered off", died_by: null });
            continue;
          }
          killBeast(realm, store, pick.id, day, e.how, e.by ?? null);
        }
      } else if (e.victim) {
        const killer = pickKiller(store, p, day, rng);
        if (killer) out.push(...remember(realm, store, p, killer, { who: e.victim.who, name: e.victim.name, day }, day, rng));
      }
    }
    // Whatever changed without a log (old code, a fight in numbers): rows follow the count.
    let living = store.living(p.id);
    while (living.length > p.count) {
      const weakest = [...living].sort((a, b) => woundsOf(a).hp - woundsOf(b).hp || ageOfRow(b, day) - ageOfRow(a, day))[0]!;
      killBeast(realm, store, weakest.id, day, "lost in the wild", null);
      living = store.living(p.id);
    }
    while (living.length < p.count) {
      store.add(newRow(p, nextId(store, p), Math.floor(rng() * speciesOf(p.species).elderAge), day, rng, null));
      living = store.living(p.id);
    }
    // Wounds mend; the very old are known by name; a pack with no leader gets one.
    for (const b of living) {
      const w = woundsOf(b);
      if (w.hp < 1) store.update(b.id, { wounds: JSON.stringify({ ...w, hp: Math.min(1, w.hp + BEAST_MENDS) }) });
      out.push(...maybeRise(realm, store, p, b.id, day, rng));
    }
    if (p.alpha && !realm.figures[p.alpha]?.alive) {
      p.alpha = null;
      out.push(...succeed(realm, store, p, day));
    }
    out.push(...maybeSplit(realm, store, p, day, rng));
  }
  return out;
}

/** The grown beast who did it: the alpha if it's about, else the strongest. */
function pickKiller(store: BeastStore, p: Pack, day: number, rng: Rng): BeastRow | null {
  const pool = store.living(p.id).filter((b) => grown(b, day));
  if (pool.length === 0) return null;
  const lead = pool.find((b) => b.figure && b.figure === p.alpha);
  if (lead && rng() < 0.5) return lead;
  return [...pool].sort((a, b) => b.wins - a.wins || tierIndex(lifeOfRow(b).tier) - tierIndex(lifeOfRow(a).tier) || (a.id < b.id ? -1 : 1))[0]!;
}

/** A beast remembers who it killed, and rises for it. */
export function remember(realm: Realm, store: BeastStore, p: Pack, b: BeastRow, kill: Kill, day: number, rng: Rng = streamFor(realm.seed, "beast-kill", b.id, day)): string[] {
  const kills = [...killsOf(b), kill];
  store.update(b.id, { kills: JSON.stringify(kills) });
  return maybeRise(realm, store, p, b.id, day, rng);
}

/** Why a beast would be named now, or null. */
function riseReason(b: BeastRow, day: number): string | null {
  const kills = killsOf(b);
  if (kills.length > 0) return `the ${speciesOf(b.species).name.replace(/^an? /, "")} that took ${kills[0]!.name}`;
  if (b.wins >= BEAST_NAMED_AFTER_WINS) return `won ${b.wins} fights`;
  if (woundsOf(b).survived >= BEAST_NAMED_AFTER_SURVIVING) return `lived through ${woundsOf(b).survived} fights with hunters`;
  if (ageOfRow(b, day) >= speciesOf(b.species).maxAge * BEAST_GREAT_AGE) return "lived to a great age";
  return null;
}

/** The epithet its life has earned. */
function epithetOf(b: BeastRow, day: number): string {
  const w = woundsOf(b);
  if (w.scars.some((s) => /eye/.test(s))) return "the One-Eyed";
  if (w.scars.some((s) => /ear/.test(s))) return "Notch-ear";
  if (killsOf(b).length > 0) return "the Man-Taker";
  if (ageOfRow(b, day) >= speciesOf(b.species).maxAge * BEAST_GREAT_AGE) return "the Old";
  if (w.scars.length > 0) return "the Scarred";
  return b.wins >= BEAST_NAMED_AFTER_WINS ? "the Fierce" : "the Wary";
}

/** Name a beast if its life has earned it (once). Returns news lines. */
export function maybeRise(realm: Realm, store: BeastStore, p: Pack, id: string, day: number, rng: Rng): string[] {
  const b = store.get(id);
  if (!b || b.died !== null || b.figure) return [];
  const why = riseReason(b, day);
  if (!why) return [];
  const life = lifeOfRow(b);
  const name = `${beastName(rng, b.species, takenNames(realm))} ${epithetOf(b, day)}`;
  const fig = makeFigure(realm, rng, { role: "beast", home: null, tier: life.tier as Tier, age: ageOfRow(b, day), species: b.species, renown: 20 + killsOf(b).length * 10, rose: `beast:${b.id}`, name, wealth: 0, gender: b.sex === "f" ? "female" : "male" }, day);
  fig.life = structuredClone(life) as Figure["life"];
  addDeed(fig, why);
  store.update(b.id, { figure: fig.id });
  tally(realm, "beasts_named");
  const where = realm.settlements[p.near]?.name ?? "the wilds";
  const kills = killsOf(b);
  realmNews(realm, day, p.near, "beast", kills.length > 0 ? `Folk near ${where} have a name for the ${speciesOf(b.species).name.replace(/^an? /, "")} that killed ${kills[0]!.name}: ${name}.` : `The ${plural(b.species)} near ${where} have one folk know by name now: ${name}, that ${why}.`, kills.length > 0 ? 6 : 4, [name, ...kills.map((k) => k.name)]);
  if (!p.alpha) {
    p.alpha = fig.id;
    addDeed(fig, "took the lead of the pack");
  }
  return [`${name} is known by name now.`];
}

/** A new leader when the alpha is gone: the strongest named beast, else the oldest grown one (made a figure). */
export function succeed(realm: Realm, store: BeastStore, p: Pack, day: number): string[] {
  const living = store.living(p.id);
  const named = living.filter((b) => b.figure && realm.figures[b.figure]?.alive).sort((a, b) => tierIndex(lifeOfRow(b).tier) - tierIndex(lifeOfRow(a).tier) || b.wins - a.wins || a.born - b.born);
  let lead = named[0];
  if (!lead) {
    const old = living.filter((b) => grown(b, day)).sort((a, b) => a.born - b.born || (a.id < b.id ? -1 : 1))[0];
    if (!old) return [];
    const rng = streamFor(realm.seed, "beast-lead", old.id, day);
    const life = lifeOfRow(old);
    const fig = makeFigure(realm, rng, { role: "beast", home: null, tier: life.tier as Tier, age: ageOfRow(old, day), species: old.species, renown: 20, rose: `beast:${old.id}`, name: `${beastName(rng, old.species, takenNames(realm))} ${epithetOf(old, day)}`, wealth: 0, gender: old.sex === "f" ? "female" : "male" }, day);
    fig.life = structuredClone(life) as Figure["life"];
    store.update(old.id, { figure: fig.id });
    lead = store.get(old.id)!;
  }
  const f = realm.figures[lead.figure!]!;
  p.alpha = f.id;
  addDeed(f, "took the lead of the pack");
  addRenown(f, 5);
  tally(realm, "alphas");
  realmNews(realm, day, p.near, "beast", `The ${plural(p.species)} near ${realm.settlements[p.near]?.name ?? "the wilds"} follow ${f.name} now.`, 4, [f.name]);
  return [`${f.name} leads the ${plural(p.species)} now.`];
}

/** A pack well past its cap, with two named beasts, splits: the second leads some away to the woods of another place. */
function maybeSplit(realm: Realm, store: BeastStore, p: Pack, day: number, rng: Rng): string[] {
  if (p.count <= p.cap + 1 || rng() >= 0.2) return [];
  const living = store.living(p.id);
  const second = living.find((b) => b.figure && b.figure !== p.alpha && realm.figures[b.figure]?.alive);
  if (!second) return [];
  const taken = new Set(Object.values(realm.packs).filter((x) => x.species === p.species && x.count > 0).map((x) => x.near));
  const near = realm.settlements[p.near];
  if (!near) return [];
  const to = near.roads.map((id) => realm.settlements[id]).filter((s) => s && !s.way && !s.abandoned && !taken.has(s.id)).sort((a, b) => (a!.id < b!.id ? -1 : 1))[0];
  if (!to) return [];
  const id = `${p.id}_${to.id}`;
  if (realm.packs[id]) return [];
  const n = Math.max(2, Math.floor(living.length / 3));
  const going = [second, ...living.filter((b) => b.id !== second.id && b.figure !== p.alpha).slice(0, n - 1)];
  realm.packs[id] = { id, species: p.species, near: to.id, count: going.length, cap: p.cap, tier: p.tier, alpha: second.figure, bounty: 0 };
  for (const b of going) store.update(b.id, { pack: id });
  p.count -= going.length;
  tally(realm, "packs_split");
  const f = realm.figures[second.figure!]!;
  realmNews(realm, day, to.id, "beast", `${f.name} has led ${going.length} ${plural(p.species)} away from ${near.name} into the woods near ${to.name}.`, 5, [f.name, to.name]);
  return [`${f.name} has led part of the pack away to ${to.name}.`];
}

/** A row's creature-facing hurt, fights won and scars, written back after a fight (on a map or the road). */
export function afterFight(realm: Realm, store: BeastStore, id: string, o: { hpShare: number; won: boolean; survived: boolean; scar?: string; killed?: { who: string; name: string } }, day: number): string[] {
  const b = store.get(id);
  if (!b || b.died !== null) return [];
  const w = woundsOf(b);
  const scars = o.scar ? [...w.scars, o.scar] : w.scars;
  store.update(id, { wounds: JSON.stringify({ hp: Math.max(0.05, Math.min(1, o.hpShare)), scars, survived: w.survived + (o.survived ? 1 : 0) }), wins: b.wins + (o.won ? 1 : 0) });
  const p = realm.packs[b.pack];
  if (!p) return [];
  if (o.killed) return remember(realm, store, p, store.get(id)!, { ...o.killed, day }, day);
  return maybeRise(realm, store, p, id, day, streamFor(realm.seed, "beast-rise", id, day));
}

/** For news and the admin view: a beast in words. */
export function describeBeast(realm: Realm, b: BeastRow, day: number): string {
  const f = b.figure ? realm.figures[b.figure] : undefined;
  const w = woundsOf(b);
  return `${f ? f.name : `a ${b.sex === "f" ? "she-" : ""}${b.species}`}, ${ageOfRow(b, day)} years${w.scars.length ? `, ${w.scars.join(", ")}` : ""}${b.wins ? `, ${b.wins} fights won` : ""}${killsOf(b).length ? `, killed ${killsOf(b).map((k) => k.name).join(", ")}` : ""}`;
}
