import type { SituationView } from "@millbrook/shared";
import { addEmotion } from "../../npc/emotions.js";
import { remember } from "../../npc/memory.js";
import { adjust, setGrudge } from "../../npc/relationship.js";
import { traitsOf } from "../../npc/traits.js";
import type { NpcPersona, NpcState } from "../../npc/types.js";
import { config } from "../../config.js";
import { absoluteMinute } from "../clock.js";
import type { WorldStore } from "../db.js";
import { check, streamFor, type Rng } from "../dice.js";
import { recordEvent } from "../events.js";
import { itemKey } from "../items.js";
import { formatMoney } from "../money.js";
import { addGrievance, easeGrievances } from "../chatter/grievance.js";
import { adjustRel } from "../chatter/rel.js";
import { learn } from "../gossip/knowledge.js";
import { eventRef } from "../gossip/refs.js";
import { killPerson } from "../people/index.js";
import { ageFrom } from "../people/rules.js";
import type { Realm } from "../realm/types.js";
import type { SavedWorld } from "../save.js";
import { speciesOf } from "../../world/species.js";
import type { PersonRow } from "../../store/peopleStore.js";
import { bindNeeds, townNow, type Bound } from "./needs.js";
import { loadIncidents, type IncidentDef, type IncidentEffect, type Stage } from "./schema.js";

/**
 * The first hour (N39): at a new game, code scans the start town for what is already brewing, picks one opening incident whose
 * needs hold, stages it to break a few minutes in where the player will see it, and lets the player choose. Every effect runs on
 * the normal systems: a relationship (rows and the talker's own feelings), a grievance against the player, a favour owed, a death,
 * money, an event with witnesses that gossip carries (N33). Staging bends the world a little (who stands where, something due
 * brought forward) and never invents it; what it did is logged with `why: "first hour"`.
 */

/** Game minutes after the start it breaks where it is staged (decision 4). */
export const BREAKS_AT = 3;
/** Game minutes after the start it comes to the player wherever they are (decision 5): someone runs to them. */
export const COMES_AT = 5;
/** Bystanders who see it, besides the people in it. */
export const BYSTANDERS = 6;

export interface FirstHour {
  incident: string;
  site: string;
  day: number;
  /** Role → `people` row id, and their names then. */
  roles: Record<string, string>;
  names: Record<string, string>;
  words: Record<string, string>;
  refs: Record<string, string>;
  stage: Stage;
  /** Absolute game minutes: when the game began, when it breaks at its stage, and when it comes to the player wherever they are. */
  began: number;
  breaks: number;
  comes: number;
  /** What staging did, for the log. */
  staged: string[];
  state: "waiting" | "pending" | "done";
  /** The model's telling of the opening (incident-line), when it gave one that passed the checks. */
  told?: string;
  choice?: string;
  deed?: string;
  event?: string;
  /** People who owe the player for what they did (row ids). */
  owed?: string[];
  /** Talkers who have brought it up with the player (persona ids), so each does once. */
  raised?: string[];
}

export interface Picked {
  def: IncidentDef;
  bound: Bound;
  score: number;
}

/** Every incident whose needs hold in the town now, with what they bind and how good an opening each is. */
export function satisfiable(realm: Realm, store: WorldStore, site: string, day: number): Picked[] {
  const t = townNow(realm, store, site, day);
  const out: Picked[] = [];
  for (const def of loadIncidents()) {
    const bound = bindNeeds(t, def.needs, def.id);
    if (!bound || def.actors.some((a) => !bound.roles[a])) continue;
    out.push({ def, bound, score: def.weight * (1 + 0.5 * def.touches.length) });
  }
  return out;
}

/** One incident for this seed and town (decision 3): weighted by score among those that hold, from the seed's own stream. */
export function pickIncident(realm: Realm, store: WorldStore, site: string, day: number, seed: number): Picked | null {
  const ok = satisfiable(realm, store, site, day);
  if (ok.length === 0) return null;
  const rng = streamFor(seed, "first-hour", "pick", site);
  // A stream's first draws for keys that differ only a little lean alike (FNV into mulberry32): skip them, so seeds spread.
  for (let i = 0; i < 4; i++) rng();
  const total = ok.reduce((a, p) => a + p.score, 0);
  let r = rng() * total;
  return ok.find((p) => (r -= p.score) < 0) ?? ok[ok.length - 1]!;
}

/** Set the first hour up for a new game: pick, stage, and point the player at it. Returns the nudge line, or [] if nothing held. */
export function beginFirstHour(world: SavedWorld, store: WorldStore, site: string): string[] {
  const realm = world.realm;
  if (!realm || world.firstHour) return [];
  const got = pickIncident(realm, store, site, world.day, world.seed);
  if (!got) return [];
  const { def, bound } = got;
  const names = Object.fromEntries(Object.entries(bound.roles).map(([role, id]) => [role, store.people.get(id)?.name ?? "someone"]));
  const began = absoluteMinute(world);
  const staged = [`${def.actors.map((a) => names[a]).join(" and ")} at the ${def.stage.where} (why: first hour)`];
  if (def.stage.bring) staged.push(`brought forward: ${def.stage.bring} (why: first hour)`);
  world.firstHour = { incident: def.id, site, day: world.day, roles: bound.roles, names, words: bound.words, refs: bound.refs, stage: def.stage.where, began, breaks: began + BREAKS_AT, comes: began + COMES_AT, staged, state: "waiting" };
  return [def.stage.nudge];
}

/** The incident's def, for a world that has one. */
export const incidentOf = (fh: FirstHour): IncidentDef | undefined => loadIncidents().find((d) => d.id === fh.incident);

const fill = (text: string, fh: Pick<FirstHour, "names" | "words">) => text.replace(/\{([a-z_]+)\}/g, (m, k: string) => fh.names[k] ?? fh.words[k] ?? m);

/**
 * Time passing (and the player moving): the incident breaks once the player is at its stage after it has broken there, or comes to
 * them wherever they are at minute COMES_AT (decision 5). Only in the start town, off the road, not inside a building.
 */
export function firstHourTick(world: SavedWorld): string[] {
  const fh = world.firstHour;
  if (!fh || fh.state !== "waiting") return [];
  const p = world.player;
  if (p.site !== fh.site || p.road || p.area !== undefined) return [];
  const now = absoluteMinute(world);
  const there = p.place === fh.stage && now >= fh.breaks;
  if (!there && now < fh.comes) return [];
  fh.state = "pending";
  const def = incidentOf(fh);
  if (!def) return [];
  if (there) return [`${def.title}.`];
  const runner = fh.names[def.actors[1] ?? def.actors[0]!] ?? "Someone";
  return [`${runner === fh.names[def.actors[0]!] ? "Someone" : runner} comes running to you: "${def.title}! Come quick!"`];
}

/** What to show while it waits for the player's choice (the road situation's panel). */
export function incidentView(world: SavedWorld): SituationView | null {
  const fh = world.firstHour;
  if (!fh || fh.state !== "pending") return null;
  const def = incidentOf(fh);
  if (!def) return null;
  const p = world.player;
  return {
    id: `firsthour:${def.id}`,
    title: def.title,
    text: fh.told ?? fill(def.text, fh),
    choices: def.choices.map((c) => {
      const miss = c.requires?.money !== undefined && p.money < c.requires.money ? `You need ${formatMoney(c.requires.money)}.` : c.requires?.item && !Object.keys(p.inventory).some((k) => k.startsWith(c.requires!.item!)) ? `You need ${c.requires.item}.` : null;
      return { id: c.id, label: fill(c.label, fh), ...(miss ? { hint: miss } : {}) };
    }),
  };
}

/** What choosing needs of the game: the town's people, and making one of them someone who talks (and remembers). */
export interface FirstHourHost {
  world: SavedWorld;
  store?: WorldStore | undefined;
  agents: Record<string, { persona: NpcPersona; state: NpcState }>;
  /** Make a townsperson a talker (Town.meetPerson): returns their persona id. */
  meetPerson(id: string): string | null;
  walkMinutes(minutes: number): string[];
}

export interface Chose {
  ok: boolean;
  lines: string[];
}

interface Ctx {
  host: FirstHourHost;
  fh: FirstHour;
  def: IncidentDef;
  realm: Realm;
  store: WorldStore;
  lines: string[];
  rng: Rng;
  ref: string;
  deed: string;
  day: number;
}

/** The player chooses (decision 6). Effects through the normal systems; the choice is an event the town will talk about. */
export function chooseIncident(host: FirstHourHost, choiceId: string): Chose {
  const world = host.world;
  const fh = world.firstHour;
  const realm = world.realm;
  const store = host.store;
  if (!fh || fh.state !== "pending" || !realm || !store) return { ok: false, lines: ["There's nothing to decide."] };
  const def = incidentOf(fh);
  const choice = def?.choices.find((c) => c.id === choiceId);
  if (!def || !choice) return { ok: false, lines: ["That isn't a choice here."] };
  const p = world.player;
  if (choice.requires?.money !== undefined && p.money < choice.requires.money) return { ok: false, lines: [`You need ${formatMoney(choice.requires.money)}.`] };
  const deed = fill(choice.deed, fh);
  const witnesses = bystanders(realm, store, fh, world.day);
  const main = fh.roles[def.actors[0]!]!;
  const e = recordEvent(world as never, { kind: "incident", actor: "player", target: main, details: `${p.name} ${deed}`, importance: 5, witnesses: [...Object.values(fh.roles), ...witnesses], why: `first hour: ${def.title}`, site: fh.site, ...(realm.settlements[fh.site]?.kingdom ? { kingdom: realm.settlements[fh.site]!.kingdom! } : {}) });
  fh.state = "done";
  fh.choice = choice.id;
  fh.deed = deed;
  fh.event = e.id;
  const ref = eventRef(e.id);
  // Those in it and those who saw it know of it (N33); everyone else hears it from them.
  if (config.gossip) for (const who of [...Object.values(fh.roles), ...witnesses]) learn({ realm, store }, who, ref, { day: world.day, source: "saw", accuracy: 1 });
  const c: Ctx = { host, fh, def, realm, store, lines: [], rng: streamFor(world.seed, "first-hour", "choice", choice.id), ref, deed, day: world.day };
  for (const fx of choice.effects) apply(c, fx);
  return { ok: true, lines: c.lines };
}

/** A few grown townsfolk at home who saw it happen, from the seed's stream (never the people in it). */
function bystanders(realm: Realm, store: WorldStore, fh: FirstHour, day: number): string[] {
  const inIt = new Set(Object.values(fh.roles));
  const rows = (store.people.loadSite(fh.site, "full") as PersonRow[]).filter((r) => r.death === null && !r.away && !r.captive && !inIt.has(r.id) && ageFrom(r.born_day, day) >= speciesOf(r.species).adultAge).sort((a, b) => (a.id < b.id ? -1 : 1));
  const rng = streamFor(realm.seed, "first-hour", "bystanders", fh.site);
  const out: string[] = [];
  for (let i = 0; i < Math.min(BYSTANDERS, rows.length); i++) {
    const j = i + Math.floor(rng() * (rows.length - i));
    [rows[i], rows[j]] = [rows[j]!, rows[i]!];
    out.push(rows[i]!.id);
  }
  return out;
}

const say = (c: Ctx, text: string | undefined) => text && c.lines.push(fill(text, c.fh));
const axesOf = (fx: IncidentEffect) => ({ ...(fx.trust ? { trust: fx.trust } : {}), ...(fx.affection ? { affection: fx.affection } : {}), ...(fx.respect ? { respect: fx.respect } : {}), ...(fx.fear ? { fear: fx.fear } : {}) });

/** A townsperson in it as a talker who remembers the player, made so on first need. */
function talkerFor(c: Ctx, rowId: string): NpcState | null {
  const id = c.host.meetPerson(rowId);
  return id ? (c.host.agents[id]?.state ?? null) : null;
}

function apply(c: Ctx, fx: IncidentEffect): void {
  const world = c.host.world;
  const p = world.player;
  const who = fx.who ? c.fh.roles[fx.who] : undefined;
  switch (fx.type) {
    case "say":
      say(c, fx.text);
      break;
    case "rel": {
      if (!who) break;
      const axes = axesOf(fx);
      if (fx.toward && fx.toward !== "player") {
        const to = c.fh.roles[fx.toward];
        if (to) adjustRel(c.store, who, to, axes, c.day);
        break;
      }
      // How they feel about the player: their row (what the townsfolk rules read) and, as someone who now talks, their own state.
      adjustRel(c.store, who, "player", axes, c.day);
      const st = talkerFor(c, who);
      if (st) {
        for (const [axis, d] of Object.entries(axes)) adjust(st, axis as "trust", d);
        const good = (fx.trust ?? 0) + (fx.affection ?? 0) >= 0;
        const agent = Object.values(c.host.agents).find((a) => a.state === st);
        const traits = agent ? traitsOf(agent.persona, st) : undefined;
        remember(st, { id: `firsthour-${c.fh.event}`, day: c.day, text: `this morning the stranger ${c.deed.replace(/\{[a-z]+\}/g, "")}`, importance: 7, valence: good ? 1 : -1 }, traits);
        addEmotion(st, good ? "gratitude" : "resentment", Math.min(1, Math.abs((fx.trust ?? 0) + (fx.affection ?? 0)) / 30), c.deed, c.day, true);
        // Someone who was helped asks the helper's name (N39 decision 7: "greets the player by name the next day").
        if (good && (fx.trust ?? 0) >= 10) st.knownName ??= p.name;
      }
      break;
    }
    case "grievance": {
      if (!who) break;
      const against = fx.toward === "player" ? "player" : fx.toward ? c.fh.roles[fx.toward] : undefined;
      if (!against) break;
      addGrievance(c.store, { who, against, cause: c.ref, weight: fx.weight ?? 0.3, day: c.day });
      if (against === "player") {
        const st = talkerFor(c, who);
        const agent = st ? Object.values(c.host.agents).find((a) => a.state === st) : undefined;
        if (st) setGrudge(st, agent ? traitsOf(agent.persona, st) : { forgiveness: 0.5 }, `the stranger ${c.deed}`, c.day);
      }
      break;
    }
    case "settle": {
      const to = fx.toward ? c.fh.roles[fx.toward] : undefined;
      if (who && to) easeGrievances(c.store, who, to, fx.amount ?? 0.5, c.day);
      break;
    }
    case "favour": {
      if (!who) break;
      if (fx.owes === "player") {
        // The player owes them: called in later as a small job (game/favours.ts, npc/initiative.ts).
        const st = talkerFor(c, who);
        st?.owedFavours.push({ kind: "vouch", day: c.day });
      } else {
        c.fh.owed = [...new Set([...(c.fh.owed ?? []), who])];
        adjustRel(c.store, who, "player", { trust: 5 }, c.day);
      }
      break;
    }
    case "money":
      if (fx.amount) {
        p.money = Math.max(0, p.money + fx.amount);
        c.lines.push(fx.amount > 0 ? `You get ${formatMoney(fx.amount)}.` : `You pay ${formatMoney(-fx.amount)}.`);
      }
      break;
    case "item":
      if (fx.item) p.inventory[itemKey(fx.item)] = (p.inventory[itemKey(fx.item)] ?? 0) + (fx.qty ?? 1);
      break;
    case "hp":
      // Nothing in the first hour kills the player (edge case: knocked about at worst).
      p.hp = Math.max(1, Math.min(p.maxHp, p.hp + (fx.amount ?? 0)));
      break;
    case "xp":
      if (fx.amount) p.xp += fx.amount;
      break;
    case "reputation": {
      const rep = (p.reputation ??= { trust: 0, fear: 0, respect: 0, affection: 0 });
      for (const k of ["trust", "fear", "respect", "affection"] as const) if (fx[k]) rep[k] = Math.max(-100, Math.min(100, rep[k] + fx[k]!));
      break;
    }
    case "standing": {
      const s = c.realm.settlements[c.fh.site];
      const head = s?.leader ? c.realm.figures[s.leader] : undefined;
      const faction = head?.faction ?? (s?.kingdom ? c.realm.kingdoms[s.kingdom]?.crown : undefined);
      if (faction && fx.amount) p.standing = { ...(p.standing ?? {}), [faction]: Math.max(-100, Math.min(100, (p.standing?.[faction] ?? 0) + fx.amount)) };
      break;
    }
    case "time":
      if (fx.minutes) c.host.walkMinutes(fx.minutes);
      break;
    case "check": {
      const attr = (p.attributes as unknown as Record<string, number>)[fx.attr ?? "strength"] ?? 10;
      const r = check(c.rng, attr, fx.target ?? 12);
      c.lines.push(`(${fx.attr ?? "strength"} ${r.total} vs ${r.target}: ${r.success ? "success" : "failure"})`);
      for (const x of (r.success ? fx.success : fx.fail) ?? []) apply(c, x);
      break;
    }
    case "fight": {
      // A scuffle, never a fight to the death (edge case): the player takes some knocks and is left standing.
      const hurt = 2 + Math.floor(c.rng() * Math.max(1, (fx.power ?? 8) / 2));
      p.hp = Math.max(1, p.hp - hurt);
      c.lines.push(`${who ? (c.fh.names[fx.who!] ?? "They") : "They"} catch${who ? "es" : ""} you a few good ones before it's over (${hurt} hurt).`);
      break;
    }
    case "death": {
      if (!who || c.rng() >= (fx.chance ?? 1)) break;
      if (killPerson(c.realm, c.store, who, { cause: (fx.cause ?? "illness") as never, day: c.day, site: c.fh.site, event: c.fh.event!, note: "in the square, the first morning" })) c.lines.push(`By noon word comes round: ${c.fh.names[fx.who!]} is dead.`);
      break;
    }
  }
}

/**
 * The pointer lines (decision 7): a talker who was in it and hasn't brought it up yet, or one who has heard of it, has something to say
 * when the player next meets them. Read-only: returns the opening event for npc/initiative.ts, or null.
 */
export function firstHourOpening(world: { firstHour?: FirstHour | undefined; player: { name: string } }, personaId: string, state: Pick<NpcState, "rumours">): { key: string; event: string } | null {
  const fh = world.firstHour;
  if (!fh || fh.state !== "done" || !fh.event || !fh.deed) return null;
  if (fh.raised?.includes(personaId)) return null;
  const role = Object.entries(fh.roles).find(([, id]) => id === personaId)?.[0];
  const deed = fh.deed;
  if (role) {
    const owed = fh.owed?.includes(personaId);
    return { key: `firsthour:${fh.event}`, event: `${world.player.name} is the one who ${deed}. ${owed ? "You owe them for it: thank them, warmly, and say you won't forget." : "You remember it well: let them know how you feel about it."}` };
  }
  const ref = eventRef(fh.event);
  if (Object.values(state.rumours ?? {}).some((r) => r.ref === ref)) return { key: `firsthour:${fh.event}`, event: `Everyone has been talking about the stranger who ${deed}: that is ${world.player.name}, here now. Mention it.` };
  return null;
}
