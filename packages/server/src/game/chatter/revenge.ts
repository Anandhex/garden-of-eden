import { config } from "../../config.js";
import { streamFor } from "../dice.js";
import { learn } from "../gossip/knowledge.js";
import { eventRef } from "../gossip/refs.js";
import type { PersonRow } from "../../store/peopleStore.js";
import { outlookOf, type Goal, type Outlook } from "../people/outlook.js";
import { parseDeath } from "../people/death.js";
import { recordLifeEvent } from "../people/events.js";
import type { LifeCtx } from "../people/step.js";
import { addGrievance, settleAll, weightOn } from "./grievance.js";
import { temperOf, type Temper } from "./person.js";
import { adjustRel } from "./rel.js";
import { sting } from "./apply.js";
import { venuesOf } from "../gossip/venues.js";
import type { GrievanceRow } from "../../store/socialStore.js";

/**
 * Revenge against anyone (N37). A person whose open grievances against one other add up, past what their pride and temper and
 * forgiveness allow, comes to want revenge on them: a goal on their outlook (`outlook.goal`, kind "avenge", with the target's id), made in
 * code from the heaviness of the wrong. The next day (the next night, as with the talkers' revenge of N12) they act on it, once, the way
 * their station and nature allow:
 *
 * - `ambush`: those with means (the gentry and above, the rich merchants) hire men to beat them;
 * - `confront`: the brave and hot-tempered, against someone within reach, have it out in the open;
 * - `rumour`: the dishonest tell a lie about them that travels by gossip;
 * - `refuse`: anyone else will have nothing more to do with them.
 *
 * Carrying it out settles the grievance and wrongs the target in turn, at half the weight, so a revenge can start another but a town does
 * not run into a feud on its own. Nothing here kills: that waits for N38's violence setting.
 */
export type Plan = NonNullable<Goal["plan"]>;

export const REVENGE = {
  /** A goal this strong or stronger is acted on; below `faded` it is forgotten. */
  actAt: 0.3,
  faded: 0.15,
  /** The share of the weight settled that the target now holds against the avenger. */
  backlash: 0.5,
} as const;

/** How much hatred a person needs to hold against one other before they want revenge: the proud and hot-tempered need less, the forgiving more. */
export function thresholdOf(t: Pick<Temper, "pride" | "temper" | "forgiveness">): number {
  return Math.max(0.2, Math.min(0.9, 0.55 - 0.2 * t.pride - 0.15 * t.temper + 0.2 * t.forgiveness));
}

/** What they would do about it, from who they are and who the other is. */
export function choosePlan(me: Temper, them: Temper): Plan {
  if (me.rank >= 5 || (me.rank >= 3 && me.greed >= 0.6)) return "ambush";
  const reach = them.rank - me.rank;
  if (me.bravery >= 0.5 && me.temper >= 0.5 && reach <= 2) return "confront";
  if (me.honesty < 0.4) return "rumour";
  return "refuse";
}

const PLAN_WORDS: Record<Plan, string> = {
  ambush: "hire men to teach them a lesson",
  confront: "have it out with them in the open",
  rumour: "spread a tale about them",
  refuse: "have nothing more to do with them",
};
export const planWords = (plan: Plan): string => PLAN_WORDS[plan];

/** The events behind a set of grievances (ids, without the `e:`). */
const eventIds = (gs: GrievanceRow[]): string[] => gs.filter((g) => g.cause_ref.startsWith("e:")).map((g) => g.cause_ref.slice(2));

/** The person's outlook with a goal set, written to their row. */
function setGoal(ctx: LifeCtx, row: PersonRow, goal: Goal | undefined): void {
  const o: Outlook = outlookOf(row);
  if (goal) o.goal = goal;
  else delete o.goal;
  ctx.store.people.update(row.id, { outlook: JSON.stringify(o) });
}

export interface VendettaResult {
  formed: number;
  acted: number;
  forgotten: number;
}

/**
 * One place's revenge for a day (after its exchanges and gossip are in): goals whose time has come are acted on, grievances against the dead are
 * settled, new goals are formed. Reads the place's open grievances and nothing else outside it but the target's row, so a place caught up
 * years later gives the same result.
 */
export function vendettaDay(ctx: LifeCtx, site: string, day: number): VendettaResult {
  const { store } = ctx;
  const out: VendettaResult = { formed: 0, acted: 0, forgotten: 0 };
  const open = store.social.openAt(site);
  if (open.length === 0) return out;
  const byWho = new Map<string, GrievanceRow[]>();
  for (const g of open) byWho.set(g.who, [...(byWho.get(g.who) ?? []), g]);
  for (const who of [...byWho.keys()].sort()) {
    const row = store.people.get(who);
    if (!row || row.death !== null || row.job === "child") continue;
    // Whoever they hold it against is gone (dead, or gone from the place's reach): it is over.
    const live: GrievanceRow[] = [];
    for (const g of byWho.get(who)!) {
      const other = store.people.get(g.against);
      // Dead by this day: a place caught up late sees deaths that came after the day it is working out, and they settle nothing yet.
      const gone = !other || (other.death !== null && (parseDeath(other.death)?.day ?? 0) <= day);
      if (gone) store.social.settle(g.id, day);
      else live.push(g);
    }
    if (live.length === 0) continue;
    const hate = new Map<string, number>();
    for (const g of live) hate.set(g.against, (hate.get(g.against) ?? 0) + weightOn(g, day));
    const outlook = outlookOf(row);
    const goal = outlook.goal;
    // A goal already made: it cools with the hatred behind it, and is acted on the day after it was made.
    if (goal?.kind === "avenge" && goal.plan && goal.acted === undefined && goal.target) {
      const left = Math.min(1, hate.get(goal.target) ?? 0);
      if (left < REVENGE.faded) {
        setGoal(ctx, row, undefined);
        out.forgotten++;
        continue;
      }
      if (goal.since < day && left >= REVENGE.actAt) {
        const target = store.people.get(goal.target);
        // They can only reach someone of their own place; if the other has gone away, the goal waits (it fades as the hatred does).
        if (target && target.death === null && target.site === row.site && !target.away && !row.away) {
          actOnVendetta(ctx, row, target, goal, live.filter((g) => g.against === target.id), day);
          out.acted++;
          continue;
        }
      }
      setGoal(ctx, row, { ...goal, strength: Math.round(left * 100) / 100 });
      continue;
    }
    // No goal yet: hatred past what they can bear makes one (someone who wants something else, or already wants revenge for a death, waits).
    if (goal) continue;
    const me = temperOf(row);
    const need = thresholdOf(me);
    let worst: string | null = null;
    for (const id of [...hate.keys()].sort()) if (!worst || hate.get(id)! > hate.get(worst)!) worst = id;
    if (!worst || hate.get(worst)! < need) continue;
    const target = store.people.get(worst);
    if (!target || target.death !== null || target.site !== row.site || target.away || row.away) continue;
    const gs = live.filter((g) => g.against === worst);
    const plan = choosePlan(me, temperOf(target));
    const strongest = [...gs].sort((a, b) => weightOn(b, day) - weightOn(a, day) || a.id - b.id)[0]!;
    const cause = strongest.cause_ref.startsWith("e:") ? store.eventById(strongest.cause_ref.slice(2)) : null;
    const reason = cause?.details ?? `${target.name} wronged them`;
    const formed: Goal = { kind: "avenge", since: day, target: worst, plan, strength: Math.round(Math.min(1, hate.get(worst)!) * 100) / 100, reason, ...(strongest.cause_ref.startsWith("e:") ? { cause: strongest.cause_ref.slice(2) } : {}) };
    setGoal(ctx, row, formed);
    recordLifeEvent(ctx.realm, store, {
      kind: "new-goal",
      actor: row.id,
      target: worst,
      site,
      day,
      details: `${row.name} wants revenge on ${target.name} (${reason}) and means to ${planWords(plan)}`,
      importance: 3,
      key: `vendetta:${worst}`,
      causedBy: eventIds(gs),
      why: `their grievances against ${target.name} weigh ${(Math.round(hate.get(worst)! * 100) / 100).toFixed(2)}, more than they can bear (${need.toFixed(2)})`,
    });
    out.formed++;
  }
  return out;
}

const CHARGES = ["a thief", "a cheat", "a drunkard", "no better than they should be", "a liar", "in league with the raiders"];

/** Carry it out. The result is an event whose cause is the wrong. */
function actOnVendetta(ctx: LifeCtx, me: PersonRow, them: PersonRow, goal: Goal, grievances: GrievanceRow[], day: number): void {
  const { store, realm } = ctx;
  const plan = goal.plan!;
  const mine = temperOf(me);
  const theirs = temperOf(them);
  const rng = streamFor(realm.seed, "vendetta", me.id, them.id, day);
  const causes = eventIds(grievances);
  const weight = grievances.reduce((s, g) => s + weightOn(g, day), 0);
  const base = { actor: me.id, target: them.id, site: me.site, day, key: `vendetta:${them.id}`, causedBy: causes, why: goal.reason ?? "an old wrong" } as const;
  let backlash: number = REVENGE.backlash;
  let eventId: string | null = null;
  const tell = (ids: string[], id: string, accuracy: number) => {
    if (config.gossip) for (const who of ids) learn(ctx, who, eventRef(id), { day, source: "saw", accuracy });
  };
  switch (plan) {
    case "ambush": {
      // Hired men: they can fail, more often the higher the target stands above the hirer.
      const odds = Math.max(0.25, 0.7 - 0.08 * Math.max(0, theirs.rank - mine.rank));
      const worked = rng() < odds;
      const e = recordLifeEvent(realm, store, {
        ...base,
        kind: worked ? "attacked" : "revenge",
        details: worked ? `${me.name} had men beat ${them.name} (${goal.reason ?? "an old wrong"})` : `${me.name}'s plot against ${them.name} came to nothing`,
        importance: worked ? 5 : 3,
      });
      eventId = e.id;
      if (worked) {
        adjustRel(store, them.id, me.id, { trust: -12, fear: 15, affection: -10 }, day);
        tell([me.id, them.id], e.id, 1);
      } else backlash = 0.1;
      break;
    }
    case "confront": {
      // Fought in the open: bravery and standing decide who comes off worse.
      const edge = 0.5 + 0.25 * (mine.bravery - theirs.bravery) + 0.05 * (mine.rank - theirs.rank);
      const won = rng() < Math.max(0.15, Math.min(0.85, edge));
      const hurt = won ? them : me;
      const other = won ? me : them;
      const e = recordLifeEvent(realm, store, { ...base, kind: "npc-fight", details: `${me.name} and ${them.name} came to blows over an old wrong; ${hurt.name} came off worse`, importance: 4 });
      eventId = e.id;
      adjustRel(store, hurt.id, other.id, { trust: -8, fear: 8, affection: -6 }, day);
      // The street was watching.
      const folk = witnessesAmong(ctx, me.site, day, [me.id, them.id], rng);
      tell([me.id, them.id, ...folk], e.id, 1);
      if (!won) backlash = 0;
      break;
    }
    case "rumour": {
      const charge = CHARGES[Math.floor(rng() * CHARGES.length)]!;
      const e = recordLifeEvent(realm, store, { ...base, kind: "rumour", details: `${me.name} is telling folk that ${them.name} is ${charge} (it is not true)`, importance: 3 });
      eventId = e.id;
      // It is told to a few, who believe it a little less each time (N33 carries it on from there), and think the worse of them.
      const folk = witnessesAmong(ctx, me.site, day, [me.id, them.id], rng);
      tell([me.id], e.id, 1);
      tell(folk, e.id, 0.8);
      for (const who of folk) adjustRel(store, who, them.id, { trust: -5, respect: -3 }, day);
      backlash = 0.3;
      break;
    }
    case "refuse": {
      const e = recordLifeEvent(realm, store, { ...base, kind: "slight", details: `${me.name} will have nothing more to do with ${them.name}`, importance: 2 });
      eventId = e.id;
      adjustRel(store, me.id, them.id, { trust: -15, affection: -10 }, day);
      tell([me.id, them.id], e.id, 1);
      backlash = 0;
      break;
    }
  }
  // Done: what they held against them is settled, and (for a violent or spiteful plan) the other now holds a smaller grudge of their own.
  settleAll(store, me.id, them.id, day);
  if (eventId && backlash > 0) addGrievance(store, { who: them.id, against: me.id, cause: eventRef(eventId), weight: weight * backlash * sting(them, me), day });
  setGoal(ctx, me, undefined);
}

/** A few others of the place who saw or heard (people of the same venues, picked by the stream). */
function witnessesAmong(ctx: LifeCtx, site: string, day: number, not: string[], rng: () => number): string[] {
  const rows = ctx.store.people.loadSite(site, "full") as PersonRow[];
  const venues = venuesOf(ctx, site, rows, day);
  const mine = venues.filter((v) => v.members.some((m) => not.includes(m)));
  const pool = (mine.length > 0 ? mine : venues).flatMap((v) => v.members).filter((m) => !not.includes(m));
  const out: string[] = [];
  const set = [...new Set(pool)];
  for (let i = 0; i < 5 && set.length > 0; i++) out.push(set.splice(Math.floor(rng() * set.length), 1)[0]!);
  return out.sort();
}

