import { CLASS_RANK, type SocialClass } from "@millbrook/shared";
import { config } from "../../config.js";
import { npcPrice } from "../../npc/actions.js";
import { adjustRelation, relationTo } from "../../npc/social.js";
import { traitsOf } from "../../npc/traits.js";
import { hearRumour } from "../rumours.js";
import type { NpcPersona, NpcState, WorldSnapshot } from "../../npc/types.js";
import type { PersonRow } from "../../store/peopleStore.js";
import { absoluteHour } from "../clock.js";
import type { WorldStore } from "../db.js";
import { streamFor } from "../dice.js";
import { recordEvent, type GameEvent } from "../events.js";
import { eventRef } from "../gossip/refs.js";
import { EFFECTS } from "../chatter/effects.js";
import { addGrievance, easeGrievances, hateOn, settleAll } from "../chatter/grievance.js";
import { adjustRel } from "../chatter/rel.js";
import { sting } from "../chatter/apply.js";
import { canCourt } from "../family.js";
import { outlookOf } from "../people/outlook.js";
import { traitsOfRow } from "../people/traits.js";
import type { Realm } from "../realm/types.js";
import { townEventsOn } from "../events-calendar.js";
import { brokeBelow, planHour, scheduleOf, workplaceOf, type PlaceId, type Plan } from "../schedule.js";
import { weatherOn } from "../weather.js";
import type { VillageMember } from "../village.js";
import { decide } from "./registry.js";
import { chosenPlan } from "./memory.js";
export { chosenPlan };
import { reasonOf } from "./score.js";
import { clockOf } from "./guards.js";
import type { ChoiceCtx, ChoiceHost, ChoiceLog, Deed, Other, Part } from "./types.js";

/**
 * The hourly menu for talkers (N38). Each hour, ahead of it being lived, every talker in the player's place scores what they could do
 * from the schedule's own pick (the habit), their needs, feelings about the others who are about, their grudges and temperament, picks
 * by a weighted roll from their own stream, and does it. What they pick becomes the hour's plan (`state.choice.plan`) which
 * `simulation.ts` follows instead of the schedule's; a deed becomes an event with the top parts of the score as its reason.
 */
export interface TalkerEnv {
  seed: number;
  members: VillageMember[];
  /** The real world: its event log and counters take what is chosen. */
  world: WorldSnapshot;
  /** The hour being chosen (the hour that is about to be lived). */
  at: { day: number; hour: number };
  store?: WorldStore | undefined;
  realm?: Realm | undefined;
  /** Nobody may do violence to these, and who the player is with (they are not choosers). */
  protect: ReadonlySet<string>;
  busy: ReadonlySet<string>;
  violence: boolean;
  /** Only these choose (the proto rollout); all of them when unset. */
  choosers?: ReadonlySet<string> | undefined;
  only?: readonly string[] | undefined;
}

const LOG_KEEP = 48;
const logs = new WeakMap<NpcState, ChoiceLog[]>();

/** The last choices a talker made (kept in memory, for the admin). */
export const choicesOf = (state: NpcState): readonly ChoiceLog[] => logs.get(state) ?? [];
function pushLog(state: NpcState, l: ChoiceLog): void {
  const list = logs.get(state) ?? [];
  list.push(l);
  if (list.length > LOG_KEEP) list.shift();
  logs.set(state, list);
}

const MOOD: Record<string, number> = { happy: 2, neutral: 0, annoyed: -1.5, angry: -2.5, afraid: -1, sad: -1.5 };
const FIRST: Record<string, number> = { royal: 7, noble: 6, gentry: 5 };

/** Standing: a talker who is a person-row has their class; otherwise their title says. */
export function rankOfTalker(persona: NpcPersona, row: PersonRow | null | undefined): number {
  if (row) return CLASS_RANK[row.cls as SocialClass] ?? 2;
  const role = persona.role.toLowerCase();
  if (/\b(king|queen|prince|duke|duchess|lord|lady|baron|baroness|noble|count|countess)\b/.test(role)) return 6;
  if (/\b(mayor|reeve|squire|knight|steward|gentry|elder|head)\b/.test(role)) return 5;
  if (/\b(priest|priestess|cleric|abbot|monk)\b/.test(role)) return 4;
  if (/\b(smith|innkeeper|merchant|baker|miller|trader|guard|captain)\b/.test(role)) return 3;
  return FIRST[role] ?? 2;
}

type RowOf = (id: string) => PersonRow | null;

const awake = (m: VillageMember): boolean => m.state.outcome !== "dead" && m.state.outcome !== "unconscious" && !m.state.dormant;

/** Where each talker would be this hour, by the schedule; choosers update it as they decide. */
function plansFor(env: TalkerEnv): Map<string, Plan> {
  const at = env.world;
  const clock = { ...at, day: env.at.day, hour: env.at.hour };
  return new Map(env.members.map((m) => [m.id, planHour(m.persona, m.state, clock)]));
}

function hateBetween(env: TalkerEnv, rowOf: RowOf, a: VillageMember, b: VillageMember): number {
  const ra = rowOf(a.id);
  const rb = rowOf(b.id);
  const fromRows = env.store && ra && rb ? hateOn(env.store, ra.id, rb.id, env.at.day) : 0;
  const r = relationTo(a.state, b.id);
  // Talkers who have no rows between them feel it on the talkers' own four axes (npc/social.ts).
  const fromAxes = Math.min(1.5, Math.max(0, -(0.6 * r.affection + 0.4 * r.trust)) / 60);
  return Math.max(fromRows, fromAxes);
}

function otherOf(env: TalkerEnv, rowOf: RowOf, me: VillageMember, you: VillageMember, plan: Plan): Other {
  const r = relationTo(me.state, you.id);
  const myRow = rowOf(me.id);
  const yourRow = rowOf(you.id);
  const unhappy = (MOOD[you.state.mood] ?? 0) < 0 || you.state.needs.hunger >= 65 || you.state.money < brokeBelow(you.persona);
  const kin = env.members as Array<VillageMember>;
  let suitable = false;
  try {
    suitable = canCourt(me, you, env.world, kin);
  } catch {
    suitable = false;
  }
  return {
    id: you.id,
    name: you.persona.name,
    place: plan.place,
    rank: rankOfTalker(you.persona, yourRow),
    hate: hateBetween(env, rowOf, me, you),
    trust: r.trust,
    affection: r.affection,
    fear: r.fear,
    protected: env.protect.has(you.id),
    carries: you.state.money > 50,
    suitable,
    sameFaction: !!myRow?.faction && myRow.faction === yourRow?.faction,
    sells: (plan.activity === "work" || plan.activity === "socialise") && ["stew", "bread loaf", "ale"].some((k) => you.persona.prices[k] !== undefined),
    restless: unhappy,
  };
}

/** A grievance-sourced revenge goal on the row, or a talker's own `avenge` life goal. */
function goalOf(env: TalkerEnv, me: VillageMember, row: PersonRow | null): ChoiceCtx["goal"] | undefined {
  const g = row ? outlookOf(row).goal : undefined;
  if (g?.kind === "avenge" && g.target && g.acted === undefined && (g.strength ?? 0) >= 0.3 && g.since < env.at.day)
    return { target: g.target, plan: g.plan ?? "confront", strength: g.strength ?? 0.5, reason: g.reason ?? "an old wrong", ...(g.cause ? { cause: g.cause } : {}) };
  const life = (me.state.lifeGoals ?? []).find((x) => x.kind === "avenge" && x.target && !x.target.includes(":") && x.strength >= 0.3);
  if (life) return { target: life.target!, plan: "confront", strength: life.strength, reason: life.words };
  return undefined;
}

const VIOLENT_KINDS = new Set(["attacked", "theft", "theft-caught", "npc-fight"]);

/** Violent deeds already recorded this day and this hour, from the world's log. */
export function fightsSoFar(world: Pick<WorldSnapshot, "events">, at: { day: number; hour: number }): { place: number; hour: number } {
  let day = 0;
  let hour = 0;
  for (const e of world.events ?? []) {
    if (e.day !== at.day || !VIOLENT_KINDS.has(e.kind)) continue;
    day++;
    if (e.hour === at.hour) hour++;
  }
  return { place: day, hour };
}

export function talkerCtx(env: TalkerEnv, me: VillageMember, plans: Map<string, Plan>, rowOf: RowOf): ChoiceCtx {
  const { persona, state } = me;
  const row = rowOf(me.id);
  const habit = plans.get(me.id)!;
  const t = traitsOf(persona, state);
  const rt = row ? traitsOfRow(row) : null;
  const schedule = scheduleOf(persona);
  const others = env.members.filter((m) => m.id !== me.id && awake(m));
  const about = others.filter((m) => {
    const p = plans.get(m.id)!;
    return p.activity !== "sleep" && p.place !== "home";
  });
  const count = new Map<PlaceId, number>();
  for (const m of about) count.set(plans.get(m.id)!.place, (count.get(plans.get(m.id)!.place) ?? 0) + 1);
  const present = about
    .map((m) => otherOf(env, rowOf, me, m, plans.get(m.id)!))
    .sort((a, b) => b.hate - a.hate || (a.id < b.id ? -1 : 1))
    .slice(0, 12);
  const presentIds = new Set(present.map((p) => p.id));
  const absent: Other[] = [];
  if (env.store && row) {
    for (const g of env.store.social.openOf(row.id).sort((a, b) => b.weight - a.weight || a.id - b.id)) {
      if (absent.length >= 2) break;
      const other = env.store.people.get(g.against);
      if (!other || other.death !== null || presentIds.has(other.id) || absent.some((a) => a.id === other.id)) continue;
      absent.push({ id: other.id, name: other.name, place: "square", rank: CLASS_RANK[other.cls as SocialClass] ?? 2, hate: hateOn(env.store, row.id, other.id, env.at.day), trust: 0, affection: 0, fear: 0, protected: env.protect.has(other.id), carries: false, suitable: false, sameFaction: false, sells: false, restless: false });
    }
  }
  const stock = Object.keys(state.inventory).reduce((n, k) => n + ((state.inventory[k] ?? 0) > 0 && npcPrice(persona, k) !== undefined ? state.inventory[k]! : 0), 0);
  const eatsOut = schedule.find((b) => b.activity === "eat" && b.place !== "home");
  const gatherings = [...count.entries()].map(([place, n]) => ({ place, count: n })).sort((a, b) => b.count - a.count || (a.place < b.place ? -1 : 1));
  const mem = state.choice;
  return {
    who: me.id,
    name: persona.name,
    kind: "talker",
    grain: "hour",
    day: env.at.day,
    hour: env.at.hour,
    site: row?.site ?? "",
    habit: { activity: habit.activity, place: habit.place, ...(habit.why ? { why: habit.why } : {}) },
    workPlace: workplaceOf(persona),
    eatPlace: eatsOut?.place ?? "inn",
    rank: rankOfTalker(persona, row),
    traits: { bravery: t.bravery, temper: t.temper, honesty: t.honesty, sociability: t.sociability, forgiveness: t.forgiveness, greed: persona.greed, ambition: rt?.ambition ?? 0.5 },
    hunger: state.needs.hunger / 100,
    fatigue: (100 - state.needs.energy) / 100,
    mood: MOOD[state.mood] ?? 0,
    money: state.money,
    broke: state.money < brokeBelow(persona),
    stock,
    festival: townEventsOn({ ...env.world, day: env.at.day }).includes("festival"),
    storm: weatherOn(env.at.day) === "storm",
    present,
    absent,
    gatherings,
    ...(goalOf(env, me, row) ? { goal: goalOf(env, me, row)! } : {}),
    recruiter: !!row?.faction,
    wantsToLeave: false,
    violence: env.violence,
    last: mem?.last ?? {},
    streak: mem?.streak ?? null,
    fights: fightsSoFar(env.world, env.at),
    ...(env.only ? { only: env.only } : {}),
  };
}

/** How a chosen deed reaches the world for talkers: events in the log, feelings on the talkers' own axes and (where both have rows) on the rows. */
function hostFor(env: TalkerEnv, me: VillageMember, rowOf: RowOf, at: () => PlaceId): ChoiceHost {
  const byId = new Map(env.members.map((m) => [m.id, m]));
  const day = env.at.day;
  const world = env.world;
  // The log takes events stamped with the hour being chosen; the counters stay the real world's.
  const clock = {
    day,
    hour: env.at.hour,
    get location() {
      return world.location;
    },
    get events() {
      return (world.events ??= []);
    },
    get nextEventSeq() {
      return world.nextEventSeq;
    },
    set nextEventSeq(v: number | undefined) {
      world.nextEventSeq = v;
    },
    player: world.player,
    present: [],
  };
  const axes = ["trust", "affection", "respect", "fear"] as const;
  return {
    seed: env.seed,
    roll: (key) => streamFor(env.seed, "choice-roll", me.id, day, env.at.hour, key)(),
    finishGoal(who) {
      const m = byId.get(who);
      const row = rowOf(who);
      if (row) {
        const o = outlookOf(row);
        if (o.goal?.kind === "avenge") {
          delete o.goal;
          env.store?.people.update(who, { outlook: JSON.stringify(o) });
        }
      }
      if (m) m.state.lifeGoals = (m.state.lifeGoals ?? []).filter((g) => g.kind !== "avenge");
    },
    deed(d: Deed): string | undefined {
      const actor = byId.get(d.actor);
      const target = d.target ? byId.get(d.target) : undefined;
      const fx = d.interaction ? EFFECTS[d.interaction] : null;
      const ra = rowOf(d.actor);
      const rt = d.target ? rowOf(d.target) : null;
      const why = reasonOf(d.why);
      const witnesses = [...new Set([d.actor, ...(d.target ? [d.target] : []), ...(d.witnesses ?? [])])].filter((id) => byId.has(id));
      const e: GameEvent = recordEvent(clock, {
        kind: d.kind,
        actor: d.actor,
        target: d.target ?? "",
        details: d.details,
        importance: Math.max(0, Math.min(10, d.importance)),
        witnesses,
        place: at(),
        why,
        ...(d.causedBy && d.causedBy.length > 0 ? { causedBy: d.causedBy } : {}),
      });
      const onTarget = { ...fx?.target, ...d.onTarget };
      const onActor = { ...fx?.actor, ...d.onActor };
      for (const ax of axes) {
        if (target && onTarget[ax]) adjustRelation(target.state, d.actor, ax, onTarget[ax]!);
        if (actor && d.target && onActor[ax]) adjustRelation(actor.state, d.target, ax, onActor[ax]!);
      }
      if (env.store && ra && rt && config.chatter) {
        adjustRel(env.store, rt.id, ra.id, onTarget, day);
        adjustRel(env.store, ra.id, rt.id, onActor, day);
        const g = d.grievance ?? fx?.grievance ?? 0;
        if (g > 0) addGrievance(env.store, { who: rt.id, against: ra.id, cause: eventRef(e.id), weight: g * sting(rt, ra), day });
        if (d.settles) {
          if (d.settles >= 1) settleAll(env.store, ra.id, rt.id, day);
          else easeGrievances(env.store, ra.id, rt.id, d.settles, day);
        }
      }
      if (d.coin && actor && target) {
        const take = Math.min(d.coin, target.state.money);
        target.state.money -= take;
        actor.state.money += take;
      }
      if (d.harm) {
        const hurt = d.lost ? actor : target;
        if (hurt) hurt.state.hp = Math.max(1, hurt.state.hp - d.harm * 3);
      }
      if (d.rumour) {
        for (const id of d.rumour.hearers) {
          const h = byId.get(id);
          if (!h || id === d.actor || id === d.target) continue;
          hearRumour(h.state, { about: d.target ?? d.actor, fact: `choice_${d.actor}_${day}_${env.at.hour}`, text: d.rumour.text, truth: "false", accuracy: 0.8, day });
          if (d.target) adjustRelation(h.state, d.target, "trust", -5);
        }
      }
      if (d.recruit && env.store && ra?.faction && rt && !rt.faction) env.store.people.update(rt.id, { faction: ra.faction });
      return e.id;
    },
  };
}

/**
 * Let the talkers of a place choose the hour that is about to be lived. Choosers go in id order; what one does changes what the next
 * one sees (where the others are, what has been done), and the order never changes. Returns what each chose.
 */
export function chooseHour(env: TalkerEnv): ChoiceLog[] {
  const out: ChoiceLog[] = [];
  const plans = plansFor(env);
  const store = env.store;
  const rowOf: RowOf = (id) => (store ? store.people.get(id) : null);
  const choosers = [...env.members].sort((a, b) => (a.id < b.id ? -1 : 1)).filter((m) => awake(m) && !m.state.companion && !m.state.inCombat && !env.busy.has(m.id) && (!env.choosers || env.choosers.has(m.id)));
  const abs = absoluteHour({ day: env.at.day, hour: env.at.hour });
  for (const m of choosers) {
    // Busy making something: their hands are full until it is done.
    if (m.state.job) continue;
    const ctx = talkerCtx(env, m, plans, rowOf);
    const stay = (): PlaceId => plans.get(m.id)!.place;
    const rng = streamFor(env.seed, "choice", m.id, env.at.day, env.at.hour);
    const decision = decide(ctx, hostFor(env, m, rowOf, stay), rng);
    if (!decision) continue;
    const { log, picked, applied } = decision;
    pushLog(m.state, log);
    const now = clockOf(ctx);
    // A talker keeps no memory of choosing until they choose something other than their day.
    if (log.habit) {
      if (m.state.choice) delete m.state.choice.streak;
    } else {
      const mem = (m.state.choice ??= { last: {} });
      mem.last[picked.action] = now;
      mem.streak = mem.streak?.action === picked.action ? { action: picked.action, n: mem.streak.n + 1 } : { action: picked.action, n: 1 };
    }
    const habit = plans.get(m.id)!;
    const plan = applied && applied.plan;
    if (applied && (plan || applied.sell)) {
      const next = plan ?? { activity: habit.activity, place: habit.place, why: "selling" };
      if (applied.sell || next.activity !== habit.activity || next.place !== habit.place) {
        (m.state.choice ??= { last: {} }).plan = { ...next, at: abs, ...(applied.sell ? { sell: true } : {}) };
        plans.set(m.id, { activity: next.activity, place: next.place, why: next.why });
      } else if (m.state.choice) delete m.state.choice.plan;
    } else if (m.state.choice) delete m.state.choice.plan;
    out.push(log);
  }
  return out;
}

export type { Part };
