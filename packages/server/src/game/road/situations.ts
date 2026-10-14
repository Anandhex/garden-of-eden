import { readdirSync, readFileSync } from "node:fs";
import { cumulative, pointAt, Ground, type RoadData, type RoadPath, type SituationView, type Traveller } from "@millbrook/shared";
import { z } from "zod";
import { check, streamFor, type Rng } from "../dice.js";
import { recordEvent } from "../events.js";
import { itemKey } from "../items.js";
import { formatMoney } from "../money.js";
import { personName, pick } from "../realm/names.js";
import { fightOnRoad, type Foe } from "../realm/travel.js";
import { weatherOn } from "../weather.js";
import type { Realm } from "../realm/types.js";
import type { Town } from "../town.js";
import { groundAt, landOf } from "./ground.js";
import { needsOf, tickNeeds } from "./needs.js";
import { waypointsOf } from "./walk.js";

/**
 * Situations, not just fights (N26 C2): a broken cart, someone hurt, a toll on a lane, a flooded ford, a beast, a child
 * alone, a peddler, a patrol looking for someone. Each is data (data/situations/*.json): where it can be, when, how
 * likely, who is in it, and the choices, each a list of effects on the game's ordinary systems (money, items, health,
 * reputation, standing, an NPC's trust, needs, time, a fight). Whether a stretch of road has one today is rolled
 * from `streamFor(seed, "situation", road, segment, day)`, so the broken cart is in the same place for everyone who
 * passes that day. A choice is recorded as an event; its consequences come back later as events linked to it.
 */

// ---- The data ----

const Effect: z.ZodType<EffectDef> = z.lazy(() =>
  z.object({
    type: z.enum(["time", "money", "item", "hp", "xp", "trust", "reputation", "needs", "fight", "check", "later", "say", "rumour", "standing"]),
    text: z.string().optional(),
    minutes: z.number().optional(),
    amount: z.number().optional(),
    item: z.union([z.string(), z.tuple([z.string(), z.number()])]).optional(),
    qty: z.number().optional(),
    species: z.string().optional(),
    attr: z.string().optional(),
    target: z.number().optional(),
    success: z.array(Effect).optional(),
    fail: z.array(Effect).optional(),
    id: z.string().optional(),
    days: z.number().optional(),
    outcomes: z.array(z.object({ chance: z.number(), text: z.string(), effects: z.array(Effect).optional() })).optional(),
    who: z.string().optional(),
    // `say` carries what it does as well as what it says.
    money: z.number().optional(),
    hp: z.number().optional(),
    reputation: z.record(z.string(), z.number()).optional(),
    needs: z.record(z.string(), z.number()).optional(),
    standing: z.object({ who: z.string(), amount: z.number() }).optional(),
    loseItem: z.boolean().optional(),
    food: z.number().optional(),
    water: z.number().optional(),
    rest: z.number().optional(),
    trust: z.union([z.number(), z.record(z.string(), z.number())]).optional(),
    respect: z.number().optional(),
    affection: z.number().optional(),
    fear: z.number().optional(),
  }),
);

export interface EffectDef {
  type: "time" | "money" | "item" | "hp" | "xp" | "trust" | "reputation" | "needs" | "fight" | "check" | "later" | "say" | "rumour" | "standing";
  text?: string | undefined;
  minutes?: number | undefined;
  amount?: number | undefined;
  item?: string | [string, number] | undefined;
  qty?: number | undefined;
  species?: string | undefined;
  attr?: string | undefined;
  target?: number | undefined;
  success?: EffectDef[] | undefined;
  fail?: EffectDef[] | undefined;
  id?: string | undefined;
  days?: number | undefined;
  outcomes?: Array<{ chance: number; text: string; effects?: EffectDef[] | undefined }> | undefined;
  who?: string | undefined;
  money?: number | undefined;
  hp?: number | undefined;
  reputation?: Record<string, number> | undefined;
  needs?: Record<string, number> | undefined;
  standing?: { who: string; amount: number } | undefined;
  loseItem?: boolean | undefined;
  food?: number | undefined;
  water?: number | undefined;
  rest?: number | undefined;
  trust?: number | Record<string, number> | undefined;
  respect?: number | undefined;
  affection?: number | undefined;
  fear?: number | undefined;
}

export const SituationSchema = z.object({
  id: z.string().regex(/^[a-z0-9_]+$/),
  title: z.string().min(1),
  /** Where it can happen: "road" anywhere on it, or the kind of land or crossing. */
  where: z.array(z.enum(["road", "ford", "bridge", "marsh", "forest", "hills"])).min(1),
  when: z.object({ night: z.boolean().optional(), rain: z.boolean().optional(), crackdown: z.boolean().optional() }).default({}),
  /** Weight among what could happen on a stretch of road that has something. */
  chance: z.number().min(0).max(1),
  actors: z.array(z.object({ role: z.string() })).default([]),
  text: z.string().min(1),
  choices: z
    .array(
      z.object({
        id: z.string().regex(/^[a-z0-9_]+$/),
        label: z.string().min(1),
        requires: z.object({ money: z.number().optional(), item: z.string().optional() }).optional(),
        effects: z.array(Effect),
      }),
    )
    .min(1),
});
export type SituationDef = z.infer<typeof SituationSchema>;

const DIR = new URL("../../data/situations/", import.meta.url);
let loaded: SituationDef[] | null = null;

/** Every situation file, checked (`npm run check-npcs` runs this too). Throws on the first bad one, naming it. */
export function loadSituations(dir: URL = DIR): SituationDef[] {
  if (loaded && dir === DIR) return loaded;
  const out: SituationDef[] = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".json")).sort()) {
    const r = SituationSchema.safeParse(JSON.parse(readFileSync(new URL(f, dir), "utf8")));
    if (!r.success) throw new Error(`${f} is invalid:\n${r.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n")}`);
    if (r.data.id !== f.replace(/\.json$/, "")) throw new Error(`${f}: the id is "${r.data.id}", which should be the file's name.`);
    out.push(r.data);
  }
  if (dir === DIR) loaded = out;
  return out;
}

// ---- Rolling a stretch of road ----

/** The chance a stretch of road has something on it today. */
export const SITUATION_CHANCE = 0.5;

export interface Rolled {
  key: string;
  def: SituationDef;
  /** Distance along the road, in tiles. */
  t: number;
  actors: Traveller[];
  road: string;
}

const rolls = new Map<string, Rolled | null>();

/** What kind of country is round a point, from what is drawn there. */
function country(realm: Realm, p: { x: number; y: number }): string[] {
  const land = landOf(realm);
  let marsh = 0;
  let trees = 0;
  let hill = 0;
  for (let dy = -9; dy <= 9; dy += 3) {
    for (let dx = -9; dx <= 9; dx += 3) {
      const g = groundAt(land, Math.round(p.x) + dx, Math.round(p.y) + dy);
      if (g === Ground.marsh || g === Ground.reeds) marsh++;
      else if (g === Ground.tree) trees++;
      else if (g === Ground.hill || g === Ground.rock) hill++;
    }
  }
  const out = ["road"];
  if (marsh >= 6) out.push("marsh");
  if (trees >= 7) out.push("forest");
  if (hill >= 6) out.push("hills");
  return out;
}

const rained = (day: number) => ["rain", "storm"].includes(weatherOn(day)) || ["rain", "storm"].includes(weatherOn(day - 1));

/** What the stretch of `road` between waypoints `seg` and `seg + 1` has on it on `day`, or null. The same for everyone. */
export function rollSegment(realm: Realm, data: RoadData, road: RoadPath & { cum?: number[] }, seg: number, day: number): Rolled | null {
  const key = `${road.id}#${seg}:${day}`;
  if (rolls.has(key)) return rolls.get(key)!;
  const out = rollNow(realm, data, road, seg, day, key);
  rolls.set(key, out);
  if (rolls.size > 400) rolls.delete(rolls.keys().next().value!);
  return out;
}

function rollNow(realm: Realm, data: RoadData, road: RoadPath & { cum?: number[] }, seg: number, day: number, key: string): Rolled | null {
  const wp = waypointsOf(data, road);
  const lo = wp[seg];
  const hi = wp[seg + 1];
  if (lo === undefined || hi === undefined || hi - lo < 500) return null;
  const rng = streamFor(realm.seed, "situation", road.id, seg, day);
  if (rng() >= SITUATION_CHANCE) return null;
  const t = lo + 200 + rng() * (hi - lo - 400);
  const cum = road.cum ?? cumulative(road.pts);
  const at = pointAt(road.pts, cum, t);
  const where = country(realm, at);
  const crossing = data.crossings.find((c) => c.road === road.id && Math.abs(c.t - t) < 90);
  if (crossing) where.push(crossing.kind === "bridge" ? "bridge" : "ford");
  const ok = loadSituations().filter((d) => d.chance > 0 && d.where.some((w) => where.includes(w)) && !d.when.crackdown && (!d.when.rain || rained(day)));
  // Something tied to a crossing or a kind of country beats a plain one if both could be: a ford in flood is what's there.
  const special = ok.filter((d) => !d.where.every((w) => w === "road"));
  const pool = special.length > 0 && rng() < 0.7 ? special : ok;
  const total = pool.reduce((a, d) => a + d.chance, 0);
  if (total <= 0) return null;
  let r = rng() * total;
  const def = pool.find((d) => (r -= d.chance) < 0) ?? pool[0]!;
  const taken = new Set<string>();
  const actors = def.actors.map((a) => {
    const gender = rng() < 0.5 ? "female" : "male";
    return { name: personName(rng, gender, taken), role: a.role, gender } as Traveller;
  });
  return { key, def, t, actors, road: road.id };
}

// ---- Putting one in front of the player ----

const fill = (text: string, actors: Traveller[]) => text.replace(/\{a\}/g, actors[0]?.name ?? "Someone").replace(/\{b\}/g, actors[1]?.name ?? "another");

/** The player's state has a pending situation: what to show. */
export function viewOf(realm: Realm, data: RoadData, town: Town): SituationView | null {
  const pend = town.world.player.road?.pending;
  if (!pend) return null;
  const rolled = findRolled(realm, data, pend.key);
  if (!rolled) return null;
  const p = town.world.player;
  return {
    id: pend.key,
    title: rolled.def.title,
    text: fill(rolled.def.text, rolled.actors),
    choices: rolled.def.choices.map((c) => {
      const miss = unmet(c.requires, p);
      return { id: c.id, label: fill(c.label, rolled.actors), ...(miss ? { hint: miss } : {}) };
    }),
  };
}

function unmet(req: { money?: number | undefined; item?: string | undefined } | undefined, p: Town["world"]["player"]): string | null {
  if (!req) return null;
  if (req.money !== undefined && p.money < req.money) return `You need ${formatMoney(req.money)}.`;
  if (req.item !== undefined && !Object.keys(p.inventory).some((k) => (p.inventory[k] ?? 0) > 0 && (k === itemKey(req.item!) || k.startsWith(req.item!)))) return `You need ${req.item}.`;
  return null;
}

function findRolled(realm: Realm, data: RoadData, key: string): Rolled | null {
  const hit = rolls.get(key);
  if (hit) return hit;
  const m = /^(.+)#(\d+):(\d+)$/.exec(key);
  const road = m ? data.roads.find((r) => r.id === m[1]) : undefined;
  return m && road ? rollSegment(realm, data, road, Number(m[2]), Number(m[3])) : null;
}

/** Does the player's step bring them to something? Sets it pending, and says so. */
export function meet(town: Town, data: RoadData, road: RoadPath & { cum: number[] }, t: number): string[] {
  const realm = town.world.realm!;
  const state = town.world.player.road!;
  const day = town.world.day;
  const wp = waypointsOf(data, road);
  let seg = 0;
  while (seg + 2 < wp.length && t > wp[seg + 1]!) seg++;
  const rolled = rollSegment(realm, data, road, seg, day);
  if (!rolled || Math.abs(t - rolled.t) > 12 || state.seen[rolled.key] === day || state.pending) return [];
  const night = town.world.hour >= 20 || town.world.hour < 5;
  if (rolled.def.when.night !== undefined && rolled.def.when.night !== night) return [];
  state.seen[rolled.key] = day;
  for (const k of Object.keys(state.seen)) if (state.seen[k]! < day - 2) delete state.seen[k];
  state.pending = { kind: "situation", id: rolled.def.id, key: rolled.key };
  return [`${rolled.def.title}.`];
}

// ---- Choosing ----

export interface Resolved {
  ok: boolean;
  lines: string[];
}

/** The player picks. Effects go through the game's own systems; the choice is an event the consequences are linked to. */
export function resolve(town: Town, choiceId: string, now: number): Resolved {
  const world = town.world;
  const realm = world.realm;
  const p = world.player;
  const pend = p.road?.pending;
  if (!realm || !pend) return { ok: false, lines: ["There's nothing to decide."] };
  const data = landOf(realm).data;
  const rolled = findRolled(realm, data, pend.key);
  const choice = rolled?.def.choices.find((c) => c.id === choiceId);
  if (!rolled || !choice) return { ok: false, lines: ["That isn't a choice here."] };
  const miss = unmet(choice.requires, p);
  if (miss) return { ok: false, lines: [miss] };
  delete p.road!.pending;
  const ctx: Ctx = { town, rolled, lines: [], rng: town.actionRng(), now, cause: "" };
  const from = realm.settlements[p.road!.from];
  const ev = recordEvent(world as never, { kind: "road", actor: "player", target: rolled.actors[0] ? `${rolled.actors[0].name}` : "road", details: `${rolled.def.title}: ${fill(choice.label, rolled.actors)}`, importance: 3, why: rolled.def.title, ...(from ? { site: from.id } : {}), witnesses: [] });
  ctx.cause = ev.id;
  for (const e of choice.effects) apply(ctx, e);
  return { ok: true, lines: ctx.lines };
}

interface Ctx {
  town: Town;
  rolled: Rolled;
  lines: string[];
  rng: Rng;
  now: number;
  cause: string;
}

const say = (c: Ctx, text: string | undefined) => text && c.lines.push(fill(text, c.rolled.actors));
const clamp = (n: number, lo = -100, hi = 100) => Math.max(lo, Math.min(hi, n));

function apply(c: Ctx, e: EffectDef): void {
  const p = c.town.world.player;
  const world = c.town.world;
  switch (e.type) {
    case "say":
      say(c, e.text);
      break;
    case "time":
      if (e.minutes) {
        c.lines.push(...tickNeeds(p, e.minutes, c.now, { weather: weatherOn(world.day) }));
        c.town.walkMinutes(e.minutes);
      }
      break;
    case "money":
      if (e.amount) {
        p.money = Math.max(0, p.money + e.amount);
        c.lines.push(e.amount > 0 ? `You receive ${formatMoney(e.amount)}.` : `You pay ${formatMoney(-e.amount)}.`);
      }
      break;
    case "item": {
      const [name, qty] = Array.isArray(e.item) ? e.item : [e.item ?? "", e.qty ?? 1];
      if (!name) break;
      const key = itemKey(name);
      if (qty > 0) {
        p.inventory[key] = (p.inventory[key] ?? 0) + qty;
        c.lines.push(`You get ${qty > 1 ? `${qty} ` : ""}${name}.`);
      } else {
        const have = Object.keys(p.inventory).find((k) => k === key || k.startsWith(`${name} [`));
        if (have) {
          p.inventory[have] = (p.inventory[have] ?? 0) + qty;
          if ((p.inventory[have] ?? 0) <= 0) delete p.inventory[have];
        }
      }
      say(c, e.text);
      break;
    }
    case "hp":
      p.hp = Math.max(1, Math.min(p.maxHp, p.hp + (e.amount ?? e.hp ?? 0)));
      break;
    case "xp":
      if (e.amount) p.xp += e.amount;
      break;
    case "trust":
      trust(c, typeof e.trust === "number" ? e.trust : (e.amount ?? 0));
      say(c, e.text);
      break;
    case "reputation":
      rep(c, e as unknown as Record<string, number>);
      break;
    case "needs":
      needs(c, e as unknown as Record<string, number>);
      say(c, e.text);
      break;
    case "standing":
      standing(c, e.who ?? "crown", e.amount ?? 0);
      break;
    case "rumour":
      say(c, e.text);
      break;
    case "fight":
      fight(c, e.species ?? "bandit");
      break;
    case "check": {
      const attr = (p.attributes as unknown as Record<string, number>)[e.attr ?? "charisma"] ?? 10;
      const r = check(c.rng, attr, e.target ?? 12, needsBonus(c));
      c.lines.push(`(${e.attr} ${r.total} vs ${r.target}: ${r.success ? "success" : "failure"})`);
      for (const f of (r.success ? e.success : e.fail) ?? []) apply(c, f);
      break;
    }
    case "later":
      c.town.world.roadLater = [...(c.town.world.roadLater ?? []), { id: e.id ?? "later", day: world.day + (e.days ?? 1), cause: c.cause, outcomes: e.outcomes ?? [], actorName: c.rolled.actors[0]?.name }];
      break;
  }
  // `say` carries extra effects of its own.
  if (e.type === "say") {
    if (e.money) apply(c, { type: "money", amount: e.money });
    if (e.hp) apply(c, { type: "hp", amount: e.hp });
    if (e.reputation) apply(c, { type: "reputation", ...e.reputation });
    if (e.needs) apply(c, { type: "needs", ...e.needs });
    if (e.trust !== undefined) apply(c, { type: "trust", trust: e.trust });
    if (e.standing) apply(c, { type: "standing", who: e.standing.who, amount: e.standing.amount });
    if (e.item) apply(c, { type: "item", item: e.item });
    if (e.loseItem) loseOne(c);
  }
}

function needsBonus(c: Ctx): number {
  const n = c.town.world.player.roadNeeds;
  const worst = n ? Math.min(n.food, n.water, n.rest) : 100;
  return worst < 5 ? -3 : worst < 25 ? -1 : 0;
}

function needs(c: Ctx, n: Record<string, number>): void {
  const need = needsOf(c.town.world.player, c.now);
  for (const k of ["food", "water", "rest"] as const) if (n[k]) need[k] = clamp(need[k] + n[k]!, 0, 100);
}

function rep(c: Ctx, r: Record<string, number>): void {
  const p = c.town.world.player;
  const cur = (p.reputation ??= { trust: 0, fear: 0, respect: 0, affection: 0 });
  for (const k of ["trust", "fear", "respect", "affection"] as const) if (r[k]) cur[k] = clamp(cur[k] + r[k]!);
}

function standing(c: Ctx, who: string, amount: number): void {
  const p = c.town.world.player;
  const realm = c.town.world.realm!;
  const k = realm.settlements[p.road!.from]?.kingdom;
  const id = who === "crown" && k ? realm.kingdoms[k]?.crown : who;
  if (!id) return;
  p.standing = { ...(p.standing ?? {}), [id]: clamp((p.standing?.[id] ?? 0) + amount) };
}

function loseOne(c: Ctx): void {
  const p = c.town.world.player;
  const keys = Object.keys(p.inventory).filter((k) => (p.inventory[k] ?? 0) > 0).sort();
  const k = keys[Math.floor(c.rng() * keys.length)];
  if (!k) return;
  p.inventory[k] = (p.inventory[k] ?? 1) - 1;
  if ((p.inventory[k] ?? 0) <= 0) delete p.inventory[k];
  c.lines.push(`You lose ${k}.`);
}

/** The first person of the situation becomes someone who talks (and remembers the player); their trust moves. */
function trust(c: Ctx, amount: number): void {
  const actor = c.rolled.actors[0];
  if (!actor || !amount) return;
  const id = c.town.meetRoadPerson(c.rolled.key, 0, actor, c.town.world.player.road!.from, c.rolled.road.split("~")[1] ?? c.town.world.player.road!.from, c.rolled.def.title.toLowerCase());
  const agent = id ? c.town.agents[id] : undefined;
  if (!agent) return;
  agent.state.relationship = clamp(agent.state.relationship + amount);
  agent.state.knownName ??= c.town.world.player.name;
}

function fight(c: Ctx, species: string): void {
  const realm = c.town.world.realm!;
  const p = c.town.world.player;
  const foe: Foe =
    species === "wolf"
      ? { name: "a wolf and its pack", power: 14, tier: "F", kind: "pack", id: `x:${c.rolled.key}`, species: "wolf" }
      : { name: "the men at the rope", power: 16, tier: "E", kind: "gang", id: `x:${c.rolled.key}` };
  c.lines.push(...fightOnRoad(realm, p, foe, realm.settlements[p.road!.from]?.name ?? "the road", c.town.world.day, c.rng, c.town.companionPower()));
}

// ---- Consequences, later ----

/** The day has come for what a choice on the road set going: each becomes an event linked to the choice, and a line for the player. */
export function dueLater(town: Town, day: number): string[] {
  const world = town.world;
  const list = world.roadLater ?? [];
  const due = list.filter((x) => x.day <= day);
  if (due.length === 0) return [];
  world.roadLater = list.filter((x) => x.day > day);
  const lines: string[] = [];
  for (const item of due) {
    const rng = streamFor(world.seed, "road-later", item.id, item.cause, item.day);
    const outcomes = item.outcomes as Array<{ chance: number; text: string; effects?: EffectDef[] }>;
    let r = rng() * outcomes.reduce((a, o) => a + o.chance, 0);
    const out = outcomes.find((o) => (r -= o.chance) < 0) ?? outcomes[0];
    if (!out) continue;
    const text = out.text.replace(/\{a\}/g, item.actorName ?? "Someone");
    recordEvent(world as never, { kind: "road", actor: "road", target: "player", details: text, importance: 3, why: "what came of a choice on the road", causedBy: [item.cause], witnesses: [] });
    lines.push(text);
    const p = world.player;
    for (const e of out.effects ?? []) {
      if (e.type === "money" && e.amount) p.money = Math.max(0, p.money + e.amount);
      else if (e.type === "item") {
        const [name, qty] = Array.isArray(e.item) ? e.item : [e.item ?? "", e.qty ?? 1];
        if (name) p.inventory[itemKey(name)] = (p.inventory[itemKey(name)] ?? 0) + qty;
      }
    }
  }
  return lines;
}

export { pick };
