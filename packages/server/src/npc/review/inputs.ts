import { config } from "../../config.js";
import type { WorldStore } from "../../game/db.js";
import { type GameEvent, knowsEvent } from "../../game/events.js";
import { titled } from "../../game/realm/figures.js";
import type { SiteDay } from "../../game/people/conditions.js";
import { type FactsSheet, factsFor } from "../depth/facts.js";
import { credence, FRIEND_AFFECTION, relationTo } from "../social.js";
import { npcName } from "../../world/names.js";
import type { SavedWorld } from "../../game/save.js";
import type { NpcPersona, NpcState } from "../types.js";
import type { Axes, ReviewInput } from "./types.js";

/**
 * What a person is given for a review (N25b step 1): only what they know. Their events are the ones they witnessed or
 * heard of (never one they didn't), their memories are the older ones closest in meaning to the news (the embeddings),
 * the people are those close to them with what *those people* think of the same things, and their place is its
 * conditions as folk there would put them. The whole is small (a few hundred tokens): the least important is trimmed first.
 */
export interface InputCtx {
  world: Pick<SavedWorld, "day" | "events" | "player" | "realm" | "talkers" | "npcStates">;
  store?: Pick<WorldStore, "recall" | "people"> | undefined;
  personas: Record<string, NpcPersona>;
  states: Record<string, NpcState>;
}

/** The most items of each kind in one input. */
export const MAX_NEWS = 8;
export const MAX_PEOPLE = 6;
export const MAX_RECALLED = 4;
const NEWSWORTHY = new Set(["attacked", "killed", "subdued", "threatened", "theft", "theft-caught", "looted", "crime", "lied-to", "lie-found-out", "promise-broken", "promise-kept", "gift", "quest-done", "amends", "favour", "raid", "raid-repelled", "insulted", "complimented", "death", "marriage", "birth", "migration", "coming-of-age", "succession", "revenge"]);
const HARM = new Set(["attacked", "killed", "subdued", "threatened", "theft", "theft-caught", "looted", "crime", "lied-to", "lie-found-out", "promise-broken", "raid", "insulted", "death", "revenge"]);
const GOOD = new Set(["gift", "quest-done", "amends", "favour", "raid-repelled", "complimented", "promise-kept", "marriage", "birth"]);

const axesOf = (s: NpcState): Axes => ({ trust: s.relationship, affection: s.affection, respect: s.respect, fear: s.fear });
const axesTo = (s: NpcState | undefined, other: string): Axes => {
  const r = s ? relationTo(s, other) : undefined;
  return r ? { trust: r.trust, affection: r.affection, respect: r.respect, fear: r.fear } : { trust: 0, affection: 0, respect: 0, fear: 0 };
};

/** A person's view of a subject ("player", "p:<id>", "lord:..", "faction:..", "site:.."). */
export function viewOf(state: NpcState | undefined, about: string): Axes {
  if (!state) return { trust: 0, affection: 0, respect: 0, fear: 0 };
  if (about === "player") return axesOf(state);
  if (about.startsWith("p:")) return axesTo(state, about.slice(2));
  const v = state.views?.[about];
  return v ? { trust: v.trust, affection: v.affection, respect: v.respect, fear: v.fear } : { trust: 0, affection: 0, respect: 0, fear: 0 };
}

/** Do they actually hold a view of this? (Someone who has never met the player has no opinion of them, not a neutral one: nothing is pulled toward it.) */
export function holdsView(state: NpcState | undefined, about: string): boolean {
  if (!state) return false;
  if (about === "player") return state.metBefore || state.relationship !== 0 || state.affection !== 0 || state.respect !== 0 || state.fear !== 0;
  if (about.startsWith("p:")) return state.npcRelations[about.slice(2)] !== undefined;
  return state.views?.[about] !== undefined;
}

/** A short plain sentence of a town's condition, and its kind (the rules read the kind). */
function conditionsFor(ctx: InputCtx, site: string, siteName: string, day: number): ReviewInput["place"]["conditions"] {
  const out: ReviewInput["place"]["conditions"] = [];
  const realm = ctx.world.realm;
  const s = realm?.settlements[site];
  const sd = ctx.store?.people.siteDay<SiteDay>(site, day) ?? null;
  const add = (kind: string, text: string) => out.push({ ref: `c:${kind}`, kind, text });
  if ((sd?.famine ?? 0) > 0 || (s && s.food < 30)) add("famine", `food is short in ${siteName}`);
  else if (s && s.food > 80) add("plenty", `the granaries of ${siteName} are full`);
  if (sd?.raided || (s?.lastRaided !== undefined && day - s.lastRaided <= 6)) add("raided", `${siteName} was raided lately`);
  if (sd?.atWar) add("war", "the kingdom is at war");
  if (sd?.plague && sd.plague > 0) add("plague", `sickness is spreading in ${siteName}`);
  return out;
}

/**
 * The input for one person's review, with their older memories closest in meaning to the news (the embeddings): what the model is given.
 * `shock` is set when something big just happened to them.
 */
export async function reviewInput(ctx: InputCtx, id: string, opts: { shock?: { ref: string; text: string; impact: number } } = {}): Promise<ReviewInput> {
  const input = reviewInputNow(ctx, id, opts);
  // ---- Memories by meaning ----
  const query = [...input.news.map((n) => n.text), opts.shock?.text ?? ""].filter(Boolean).join(". ").slice(0, 400);
  if (ctx.store && query) {
    for (const r of await ctx.store.recall(id, query, MAX_RECALLED)) {
      if (input.news.some((n) => n.text === r.text) || r.text.length === 0) continue;
      input.recalled.push({ ref: `m:${r.id}`, day: r.day, text: r.text.slice(0, 200) });
    }
  }
  return input;
}

/** The same without the recall: all of it a plain read, so a review by code's rules is done in one go (no waiting, nothing left half done). */
export function reviewInputNow(ctx: InputCtx, id: string, opts: { shock?: { ref: string; text: string; impact: number } } = {}): ReviewInput {
  const { world } = ctx;
  const persona = ctx.personas[id]!;
  const state = ctx.states[id]!;
  const day = world.day;
  const talkers = world.talkers ?? {};
  const sheet: FactsSheet = factsFor({ realm: world.realm ?? null, people: ctx.store?.people ?? null, events: world.events ?? [], day, talkers }, persona);
  const since = state.review?.day ?? Math.max(0, day - config.review.everyDays);
  const realm = world.realm;
  const head = realm?.settlements[sheet.site]?.leader ? realm.figures[realm.settlements[sheet.site]!.leader!] : undefined;
  const lordRef = head && head.talks !== id && head.id !== persona.id.replace(/^f_/, "").replace(/_/g, "-") ? `lord:${head.id}` : undefined;
  const nameFor = (ref: string): string => (ref === "player" ? world.player.name : ref.startsWith("p:") ? (ctx.personas[ref.slice(2)]?.name ?? npcName(ref.slice(2))) : ref === lordRef ? titled(head!) : ref);

  // ---- The people close to them: kin first, then by how strongly they feel ----
  const kin = sheet.family.filter((r) => r.id && ctx.personas[r.id] && r.alive).map((r) => ({ id: r.id!, tie: r.kind }));
  const strongest = Object.entries(state.npcRelations)
    .filter(([other]) => ctx.personas[other] && !kin.some((k) => k.id === other) && ctx.states[other]?.outcome !== "dead")
    .sort((a, b) => Math.abs(b[1].trust) + Math.abs(b[1].affection) - (Math.abs(a[1].trust) + Math.abs(a[1].affection)))
    .map(([other, r]) => ({ id: other, tie: r.affection >= FRIEND_AFFECTION ? "friend" : r.affection <= -30 || r.trust <= -40 ? "rival" : "acquaintance" }));
  const closeIds = [...kin, ...strongest].slice(0, MAX_PEOPLE);

  // ---- What they know of since last time ----
  const seen = new Set(state.review?.seen ?? []);
  const known = (world.events ?? []).filter((e) => e.day >= Math.min(since, day - 60) && !seen.has(`e:${e.id}`) && knowsEvent(e, id) && e.importance >= 3 && NEWSWORTHY.has(e.kind));
  const subjectOf = (who: string | undefined): string | undefined => {
    if (!who) return undefined;
    if (who === "player") return "player";
    if (who === id) return "self";
    if (closeIds.some((c) => c.id === who) || ctx.personas[who]) return `p:${who}`;
    return undefined;
  };
  const closeSubjects = new Set(["self", ...closeIds.map((c) => `p:${c.id}`)]);
  const news = known
    .sort((a, b) => b.importance - a.importance || b.day - a.day)
    .slice(0, MAX_NEWS)
    .map((e: GameEvent) => {
      const by = subjectOf(e.actor);
      const to = subjectOf(e.target);
      const mattersToMe = (to !== undefined && closeSubjects.has(to)) || e.kind === "raid" || e.kind === "death" || e.kind === "birth" || e.kind === "marriage";
      const tone: -1 | 0 | 1 = mattersToMe ? (HARM.has(e.kind) ? -1 : GOOD.has(e.kind) ? 1 : 0) : 0;
      return { ref: `e:${e.id}`, text: e.details, importance: e.importance, day: e.day, kind: e.kind, ...(by ? { by } : {}), ...(to ? { to } : {}), tone, saw: (e.witnesses ?? []).includes(id) };
    });

  const recalled: ReviewInput["recalled"] = [];

  // ---- Subjects in play: who and what they have views about ----
  const subjects: Array<{ about: string; label: string }> = [];
  const addSubject = (about: string | undefined) => {
    if (!about || about === "self" || subjects.some((s) => s.about === about)) return;
    subjects.push({ about, label: nameFor(about) });
  };
  if (state.metBefore || news.some((n) => n.by === "player" || n.to === "player") || state.relationship !== 0) addSubject("player");
  for (const c of closeIds) addSubject(`p:${c.id}`);
  for (const n of news) {
    addSubject(n.by);
    addSubject(n.to);
  }
  addSubject(lordRef);
  const opinions = subjects.map((s) => ({ ...s, axes: viewOf(state, s.about) }));

  const people: ReviewInput["people"] = closeIds.map((c) => {
    const their = ctx.states[c.id];
    return {
      ref: `p:${c.id}`,
      text: `${ctx.personas[c.id]!.name}, ${c.tie}`,
      id: c.id,
      name: ctx.personas[c.id]!.name,
      tie: c.tie,
      myView: axesTo(state, c.id),
      credence: credence(state, c.id),
      theirViews: subjects.filter((s) => s.about !== `p:${c.id}` && holdsView(their, s.about)).map((s) => ({ about: s.about, axes: viewOf(their, s.about) })),
      recent: (world.events ?? []).filter((e) => (e.actor === c.id || e.target === c.id) && e.day > since && e.importance >= 4 && NEWSWORTHY.has(e.kind)).slice(0, 2).map((e) => e.details),
    };
  });

  const goals = (state.lifeGoals ?? []).map((g) => ({ id: g.id, words: g.words }));
  const owed = Object.values(state.debts ?? {}).reduce((a, b) => a + b, 0);
  return {
    who: {
      id,
      name: persona.name,
      job: sheet.job,
      cls: sheet.cls,
      site: sheet.site,
      siteName: sheet.siteName,
      age: persona.age,
      minor: !!persona.minor,
      traits: { ...(persona.traits ?? {}) } as Record<string, number>,
      goals,
      fears: (persona.fears ?? []).map((f) => f.name),
      loves: (persona.loves ?? []).map((f) => f.name),
      secrets: persona.secrets.map((s) => s.id),
      money: state.money,
      owed,
      ...(state.grudge ? { grudge: state.grudge.reason, grudgeAge: day - state.grudge.day } : {}),
    },
    day,
    since,
    ...(opts.shock ? { shock: opts.shock } : {}),
    news,
    recalled,
    people,
    place: { name: sheet.siteName, conditions: conditionsFor(ctx, sheet.site, sheet.siteName, day) },
    opinions,
    rumours: Object.entries(state.rumours ?? {})
      .sort((a, b) => b[1].day - a[1].day)
      .slice(0, 4)
      .map(([key, r]) => ({ ref: `r:${key}`, text: r.text.slice(0, 160), about: r.about, accuracy: r.accuracy })),
    candidates: sheet.secrets.filter((c) => !persona.secrets.some((s) => s.id === c.id)).map((c) => ({ ref: `k:${c.id}`, text: c.fact, kind: c.kind })),
    arcs: (persona.arcs ?? []).map((a) => ({ ref: `a:${a.id}`, name: a.name, stage: state.arcs[a.id]?.stage ?? 0, stages: a.stages.length })),
    names: [...new Set([...sheet.names, persona.name, world.player.name, ...subjects.map((s) => s.label), ...people.map((p) => p.name)])],
  };
}

/** Does anything here give a review something to do? A quiet stretch with nothing to weigh is skipped. */
export function worthReviewing(input: ReviewInput): boolean {
  return input.shock !== undefined || input.news.length > 0 || input.place.conditions.length > 0 || input.people.some((p) => p.theirViews.some((v) => Math.abs(v.axes.trust) > 10)) || !!input.who.grudge || input.who.goals.length > 0;
}
