import { CLASS_RANK, type SocialClass } from "@millbrook/shared";
import { config } from "../../config.js";
import { timed } from "../../metrics/timing.js";
import type { PersonRow } from "../../store/peopleStore.js";
import { addGrievance, easeGrievances, settleAll, weightOn } from "../chatter/grievance.js";
import { sting } from "../chatter/apply.js";
import { EFFECTS } from "../chatter/effects.js";
import { temperOf } from "../chatter/person.js";
import { adjustRel, feelings } from "../chatter/rel.js";
import { seedFrom, streamFor } from "../dice.js";

const hashes = new Map<string, number>();
/** A fixed 0..1 for a person on a day (and a purpose): from who they are and the day alone, so no stream is walked and no order matters. */
function dailyUnit(seed: number, id: string, day: number, purpose = "pick"): number {
  let h = hashes.get(id);
  if (h === undefined) hashes.set(id, (h = seedFrom(id)));
  let x = (h ^ Math.imul(day + 1, 0x9e3779b1) ^ seed ^ (purpose === "pick" ? 0 : 0x5bd1e995)) | 0;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}
import { learn } from "../gossip/knowledge.js";
import { eventRef } from "../gossip/refs.js";
import { sociability } from "../gossip/venues.js";
import { recordLifeEvent } from "../people/events.js";
import { NEUTRAL_DAY, type SiteDay } from "../people/conditions.js";
import { outlookOf } from "../people/outlook.js";
import { ageFrom } from "../people/rules.js";
import type { LifeCtx, SiteStep } from "../people/step.js";
import { traitsOfRow } from "../people/traits.js";
import { decide } from "./registry.js";
import { reasonOf } from "./score.js";
import type { ChoiceCtx, ChoiceHost, ChoiceLog, Deed, Other } from "./types.js";

/**
 * The daily menu for townsfolk (N38): the same menu as the talkers' at coarse grain. A townsperson who has something to decide (a grievance
 * they hold, a wish to leave, a faction to recruit for, a shortage that sours them) or who is picked for an ordinary day's variety scores
 * a smaller menu and picks. Pure in `(seed, rows, the place's conditions, the day)`: every roll is from a named stream, cooldowns live on
 * the person's row, and the people are taken in id order, so a day worked out years later in a catch-up chooses what it would have chosen
 * on the day. What they pick that matters is an event whose reason is the top parts of its score; where they go today is the intent the
 * browser's crowd follows (`intentsOn`).
 */
export const CHOICE_DAY = {
  /** Share of everyone else in a place who is looked at for a day's variety, and the most chosen for in a place a day. */
  sample: 0.01,
  /** The most chosen for in a place a day: this share of its grown people (so a capital is not starved and a hamlet is not made to choose for all), within a least and a most. */
  share: 0.02,
  least: 4,
  most: 60,
  /** Others in reach: the people they hold something against, plus more by the stream up to this many. */
  others: 5,
} as const;

export interface DayChoices {
  site: string;
  day: number;
  chose: number;
  deeds: number;
  logs: ChoiceLog[];
  /** What the crowd shows today, by person. */
  intents: Array<{ id: string; kind: string; target?: string }>;
}

const rankOf = (r: Pick<PersonRow, "cls">): number => CLASS_RANK[r.cls as SocialClass] ?? 2;
const grownUp = (r: PersonRow): boolean => r.job !== "child" && r.persona === null && !r.away && r.death === null;

const kin = (a: PersonRow, b: PersonRow): boolean =>
  a.spouse === b.id || b.spouse === a.id || a.mother === b.id || a.father === b.id || b.mother === a.id || b.father === a.id || (!!a.mother && a.mother === b.mother) || (!!a.father && a.father === b.father);

function otherOf(ctx: LifeCtx, me: PersonRow, you: PersonRow, day: number, siteDay: SiteDay, hate: number): Other {
  const f = feelings(ctx.store.social.rel(me.id, you.id), day);
  const o = outlookOf(you);
  const r = rankOf(you);
  const age = ageFrom(you.born_day, day);
  const mine = ageFrom(me.born_day, day);
  return {
    id: you.id,
    name: you.name,
    place: "square",
    rank: r,
    hate,
    trust: f.trust,
    affection: f.affection,
    fear: f.fear,
    protected: you.job === "child",
    carries: r >= 3,
    suitable: !me.spouse && !you.spouse && age >= 17 && mine >= 17 && Math.abs(age - mine) <= 15 && !kin(me, you),
    sameFaction: !!me.faction && me.faction === you.faction,
    sells: false,
    restless: o.mood <= -1 || (r <= 1 && siteDay.famine > 0.3),
  };
}

function rowCtx(ctx: LifeCtx, me: PersonRow, day: number, siteDay: SiteDay, others: PersonRow[], fights: number, hates: Map<string, number>): ChoiceCtx {
  const outlook = outlookOf(me);
  const t = temperOf(me);
  const rt = traitsOfRow(me);
  const r = rankOf(me);
  const poor = r <= 2;
  const hungry = siteDay.famine > 0 ? Math.min(1, siteDay.famine * (poor ? 1 : 0.5)) : 0;
  const retired = me.job === "elder" || me.job === "retired";
  return {
    who: me.id,
    name: me.name,
    kind: "townsperson",
    grain: "day",
    day,
    hour: 12,
    site: me.site,
    habit: { activity: retired ? "socialise" : "work", place: "square" },
    workPlace: "square",
    eatPlace: "inn",
    rank: r,
    traits: { bravery: t.bravery, temper: t.temper, honesty: t.honesty, sociability: sociability(me.id), forgiveness: t.forgiveness, greed: t.greed, ambition: rt.ambition },
    hunger: hungry,
    fatigue: 0.2,
    mood: outlook.mood,
    money: 0,
    broke: poor && siteDay.famine > 0.3,
    stock: 0,
    festival: false,
    storm: false,
    present: others.map((o) => otherOf(ctx, me, o, day, siteDay, hates.get(o.id) ?? 0)),
    absent: [],
    gatherings: [],
    recruiter: !!me.faction,
    wantsToLeave: outlook.goal?.kind === "move",
    violence: config.choice.violence,
    last: outlook.choice?.cd ?? {},
    streak: null,
    fights: { place: fights, hour: 0 },
  };
}

function hostFor(ctx: LifeCtx, me: PersonRow, day: number, onDeed: () => void): ChoiceHost {
  const { store, realm } = ctx;
  return {
    seed: realm.seed,
    roll: (key) => streamFor(realm.seed, "choice-roll", me.id, day, key)(),
    finishGoal(who) {
      const row = store.people.get(who);
      if (!row) return;
      const o = outlookOf(row);
      if (o.goal?.kind === "avenge") {
        delete o.goal;
        store.people.update(who, { outlook: JSON.stringify(o) });
      }
    },
    deed(d: Deed): string | undefined {
      onDeed();
      const a = store.people.get(d.actor);
      const b = d.target ? store.people.get(d.target) : null;
      if (!a) return undefined;
      const fx = d.interaction ? EFFECTS[d.interaction] : null;
      const e = recordLifeEvent(realm, store, {
        kind: d.kind,
        actor: d.actor,
        target: d.target ?? "",
        site: a.site,
        day,
        details: d.details,
        importance: d.importance,
        key: `choice:${d.actor}>${d.target ?? ""}`,
        witnesses: (d.witnesses ?? []).slice(0, 5),
        ...(d.causedBy && d.causedBy.length > 0 ? { causedBy: d.causedBy } : {}),
        why: reasonOf(d.why),
      });
      const ref = eventRef(e.id);
      // Those it was done between and a few who saw it know of it (gossip carries it on from there).
      if (config.gossip) for (const who of [d.actor, ...(d.target ? [d.target] : []), ...(d.witnesses ?? []).slice(0, 3)]) learn(ctx, who, ref, { day, source: "saw", accuracy: 1 });
      if (b) {
        adjustRel(store, b.id, a.id, { ...fx?.target, ...d.onTarget }, day);
        adjustRel(store, a.id, b.id, { ...fx?.actor, ...d.onActor }, day);
        const g = d.grievance ?? fx?.grievance ?? 0;
        if (g > 0) addGrievance(store, { who: b.id, against: a.id, cause: ref, weight: g * sting(b, a), day });
        if (d.settles) {
          if (d.settles >= 1) settleAll(store, a.id, b.id, day);
          else easeGrievances(store, a.id, b.id, d.settles, day);
          // Having it out is the revenge they wanted: the goal does not come back next day to do it again.
          const o = outlookOf(a);
          if (d.settles >= 0.7 && o.goal?.kind === "avenge" && o.goal.target === b.id) {
            delete o.goal;
            store.people.update(a.id, { outlook: JSON.stringify(o) });
          }
        }
        if (d.recruit && a.faction && !b.faction) store.people.update(b.id, { faction: a.faction });
      }
      if (d.rumour && b) {
        for (const who of d.rumour.hearers.slice(0, 3)) {
          if (config.gossip) learn(ctx, who, ref, { day, source: "told", accuracy: 0.8 });
          adjustRel(store, who, b.id, { trust: -5, respect: -3 }, day);
        }
      }
      if (d.leave) {
        const o = outlookOf(a);
        if (!o.goal) o.goal = { kind: "move", since: day };
        store.people.update(a.id, { outlook: JSON.stringify(o) });
      }
      return e.id;
    },
  };
}

/**
 * One place's choices for a day, after its people's day, reviews, chatter and gossip. Returns what was chosen (the logs are kept only
 * when `keep`, for the admin and tests; nothing is stored).
 */
export function choiceDay(ctx: LifeCtx, step: Pick<SiteStep, "site">, day: number, opts: { keep?: boolean } = {}): DayChoices {
  const site = step.site;
  const out: DayChoices = { site, day, chose: 0, deeds: 0, logs: [], intents: [] };
  // The choices are made of what chatter leaves behind (relationships, grievances): without chatter there is nothing to choose from.
  if (config.choice.mode !== "all" || !config.chatter) return out;
  const { store, realm } = ctx;
  return timed("choice.day", () => {
    const sd = store.people.siteDay<SiteDay>(site, day) ?? NEUTRAL_DAY;
    // Read from the cache of people alive in the place, never from a query that joins the file: what is not flushed yet must count the same
    // here as in a place caught up later or loaded elsewhere.
    const everyone = (store.people.loadSite(site, "full") as PersonRow[]).filter(grownUp);
    if (everyone.length < 2) return out;
    // Who has something to decide (a grievance held open), and a few more picked by who they are and the day, for the day's variety. A wish
    // to leave is looked at only for these: reading every person's outlook every day would cost more than the choosing.
    const wanting: PersonRow[] = [];
    const rest: PersonRow[] = [];
    for (const r of everyone) {
      if (store.social.hasOpen(r.id)) wanting.push(r);
      else if (dailyUnit(realm.seed, r.id, day) < CHOICE_DAY.sample) rest.push(r);
    }
    if (wanting.length + rest.length === 0) return out;
    // The same order wherever the place is worked out; when more want to choose than a place can in a day, a fair draw of them, not whoever's id sorts first.
    const rows = everyone.sort((a, b) => (a.id < b.id ? -1 : 1));
    const byId = new Map(rows.map((r) => [r.id, r]));
    const fair = (r: PersonRow) => dailyUnit(realm.seed, r.id, day, "order");
    const choosers = [...wanting, ...rest].sort((a, b) => fair(a) - fair(b) || (a.id < b.id ? -1 : 1)).slice(0, Math.max(CHOICE_DAY.least, Math.min(CHOICE_DAY.most, Math.ceil(CHOICE_DAY.share * everyone.length))));
    let fights = 0;
    store.social.transaction(() => {
      for (const me of choosers) {
        const fresh = store.people.get(me.id);
        if (!fresh || fresh.death !== null) continue;
        // The people in reach: those they hold something against, then a few by the stream.
        const pool = streamFor(realm.seed, "choice-others", me.id, day);
        const open = store.social.openOf(me.id);
        const hates = new Map<string, number>();
        for (const g of open) hates.set(g.against, Math.min(2, (hates.get(g.against) ?? 0) + weightOn(g, day)));
        const grudges = open.map((g) => byId.get(g.against)).filter((r): r is PersonRow => !!r && r.id !== me.id);
        const near: PersonRow[] = [...new Map(grudges.map((r) => [r.id, r])).values()];
        for (let tries = 0; near.length < CHOICE_DAY.others && tries < 12; tries++) {
          const r = rows[Math.floor(pool() * rows.length)]!;
          if (r.id !== me.id && !near.some((n) => n.id === r.id)) near.push(r);
        }
        near.sort((a, b) => (a.id < b.id ? -1 : 1));
        const c = rowCtx(ctx, fresh, day, sd, near, fights, hates);
        const decision = decide(c, hostFor(ctx, fresh, day, () => void (fights += 1)), streamFor(realm.seed, "choice", me.id, day));
        if (!decision) continue;
        out.chose++;
        if (opts.keep) out.logs.push(decision.log);
        const { picked, log, applied } = decision;
        if (!log.habit) {
          out.deeds++;
          // Remember it on their row: when they last did it (the cooldown).
          const o = outlookOf(fresh);
          o.choice = { cd: { ...(o.choice?.cd ?? {}), [picked.action]: day } };
          store.people.update(fresh.id, { outlook: JSON.stringify(o) });
        }
        if (applied && applied.intent && applied.intent.kind !== "work") out.intents.push({ id: me.id, kind: applied.intent.kind, ...(applied.intent.target ? { target: applied.intent.target } : {}) });
      }
    });
    return out;
  });
}
