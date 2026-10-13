import { FRIEND_AFFECTION } from "../social.js";
import type { Axes, Change, Proposal, ReviewInput } from "./types.js";

/**
 * Code's review (N25b step 2): the same kinds of change the model proposes, from the same input, by fixed rules, with
 * no words of its own beyond plain sentences built from the input. It is what everyone who doesn't talk gets, what a
 * talker gets when the model is off or over budget or leaves a person out of a reply, and the baseline the model's
 * proposals are measured against. Deterministic: the same input gives the same proposal. Its proposals go through the
 * same checks (validate.ts) and are applied by the same code (apply.ts) as the model's.
 */

/** Share of the gap to what close people think that a review closes: opinions spread through a town this way. */
export const PULL = 0.3;
/** The least gap that pulls. */
export const PULL_FROM = 6;
/** The most one review's pull moves one axis. */
export const PULL_MAX = 5;
/** Days a grudge against the player lasts before code lets it go (anyone more forgiving drops it sooner through `grudgeDays`). */
export const LET_GO_AFTER = 20;

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const first = (name: string) => name.split(" ")[0]!;

/** The axes an event of a kind moves, per point of importance, for someone it matters to. */
const DEED: Record<string, Partial<Record<keyof Axes, number>>> = {
  attacked: { trust: -1, fear: 0.8 },
  killed: { trust: -1.2, fear: 1, affection: -0.8 },
  subdued: { trust: -1, fear: 0.9 },
  threatened: { trust: -0.6, fear: 0.6 },
  theft: { trust: -1 },
  "theft-caught": { trust: -1 },
  looted: { trust: -1, affection: -0.4 },
  crime: { trust: -0.8 },
  "lied-to": { trust: -0.5 },
  "lie-found-out": { trust: -0.8, respect: -0.4 },
  "promise-broken": { trust: -0.8 },
  gift: { affection: 0.8, trust: 0.4 },
  "quest-done": { respect: 0.8, trust: 0.4 },
  "promise-kept": { trust: 0.8 },
  amends: { trust: 0.6 },
  favour: { affection: 0.6, trust: 0.4 },
  "raid-repelled": { respect: 0.8, affection: 0.4 },
  complimented: { affection: 0.4 },
  insulted: { affection: -0.6, respect: -0.3 },
};

const clip = (n: number, cap: number) => clamp(Math.round(n), -cap, cap);

/** Code's proposal for one person. */
export function ruleProposal(input: ReviewInput): Proposal {
  // Changes are gathered in groups and returned in the order of what matters most to a life (the checks keep the first six):
  // what they feel, what it did to their story and what they want, then how they see whoever did it, then the town, then the pull of friends.
  const group: Record<"feel" | "story" | "wants" | "deeds" | "town" | "pull" | "time", Change[]> = { feel: [], story: [], wants: [], deeds: [], town: [], pull: [], time: [] };
  let into: keyof typeof group = "deeds";
  const add = (c: Change) => group[into].push(c);
  const at = (g: keyof typeof group) => void (into = g);
  const shock = input.shock !== undefined;
  const cap = shock ? 18 : 8;
  const subjects = new Set(input.opinions.map((o) => o.about));
  const name = first(input.who.name);
  const kin = new Set(input.people.filter((p) => /spouse|wife|husband|mother|father|parent|child|son|daughter|brother|sister|sibling/i.test(p.tie)).map((p) => `p:${p.id}`));
  const close = (ref: string | undefined) => ref === "self" || (ref !== undefined && (kin.has(ref) || input.people.some((p) => `p:${p.id}` === ref && p.myView.affection >= FRIEND_AFFECTION)));

  // 1. Deeds they know of: what was done to them and theirs moves how they see whoever did it (the two axes it moves most).
  for (const n of input.news) {
    const by = n.by;
    const axes = DEED[n.kind];
    if (!by || by === "self" || !subjects.has(by) || !axes) continue;
    const toClose = close(n.to);
    // Someone who was there was moved at the time (the game's own hooks); the review is their second thoughts, a smaller step.
    const weight = (n.importance / 5) * (toClose ? 1 : n.to ? 0.35 : 0.6) * (n.tone === 0 ? 0.5 : 1) * (n.saw ? 0.5 : 1);
    at("deeds");
    const moves = (Object.entries(axes) as Array<[keyof Axes, number]>).map(([axis, per]) => ({ axis, delta: clip(per * 5 * weight, cap) })).filter((m) => m.delta !== 0).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, 2);
    for (const m of moves) add({ kind: "opinion", about: by, axis: m.axis, delta: m.delta, because: [n.ref], why: n.text.slice(0, 200) });
    // A deed that cuts deep leaves a feeling, and sometimes a grudge or a want.
    if (n.tone === -1 && toClose && n.importance >= 6) {
      at("feel");
      add({ kind: "emotion", emotion: n.kind === "killed" ? "grief" : "resentment", strength: clamp(n.importance / 4, 1, 3), about: n.text.slice(0, 90), because: [n.ref], why: n.text.slice(0, 200) });
      if (n.importance >= 7) add({ kind: "grudge", against: by, because: [n.ref], why: `${name} will not forget it: ${n.text}`.slice(0, 230) });
      at("wants");
      if (n.kind === "killed" && n.importance >= 8 && input.who.goals.length < 3 && !input.who.minor) add({ kind: "goal-add", goal: "avenge", target: by, words: `You want to see ${nameFor(input, by)} answer for it.`, because: [n.ref], why: n.text.slice(0, 200) });
    }
  }
  // A death in the family is grief, whoever dealt it.
  at("feel");
  for (const n of input.news) {
    if ((n.kind === "death" || n.kind === "killed") && n.to !== undefined && kin.has(n.to) && n.tone === -1 && !group.feel.some((c) => c.kind === "emotion" && c.emotion === "grief")) {
      add({ kind: "emotion", emotion: "grief", strength: 2.5, about: n.text.slice(0, 90), because: [n.ref], why: n.text.slice(0, 200) });
    }
  }

  // 2. A life turning leaves a line in their story.
  at("story");
  const turn = input.news.find((n) => n.tone !== 0 && n.importance >= 7 && close(n.to) && ["death", "killed", "marriage", "birth", "raid", "attacked", "looted"].includes(n.kind));
  if (turn && !input.who.minor) {
    add({ kind: "story", words: `${turn.text.replace(/\.$/, "")}, and ${name} has not been quite the same since.`.slice(0, 270), because: [turn.ref], why: turn.text.slice(0, 200) });
  }

  // 3. What they come to want. One at a time, and only when something real gives it.
  at("wants");
  const wants = (k: string) => input.who.goals.some((g) => g.id.startsWith(k));
  const hard = input.place.conditions.find((c) => ["famine", "raided", "war"].includes(c.kind));
  if (!input.who.minor && input.who.goals.length < 3 && !group.wants.some((c) => c.kind === "goal-add")) {
    if (hard && input.who.money < 400 && !wants("move") && input.who.job !== "head") add({ kind: "goal-add", goal: "move", target: `site:${input.who.site}`, words: `You are thinking of leaving ${input.place.name} for somewhere better.`, because: [hard.ref], why: `${hard.text} in ${input.place.name}, and ${name} has little to fall back on` });
    else if (input.who.owed > 0 && input.who.money < input.who.owed && !wants("pay_debt")) add({ kind: "goal-add", goal: "pay_debt", words: "You mean to clear what you owe.", because: ["self"], why: `${name} owes more than they have` });
  }
  if (!hard && wants("move")) {
    const g = input.who.goals.find((x) => x.id.startsWith("move"))!;
    add({ kind: "goal-drop", goal: g.id, because: [input.place.conditions[0]?.ref ?? "self"], why: `${input.place.name} is easier now` });
  }

  // 4. What is happening in their town sits on their mood, and on how they see whoever rules it.
  at("town");
  const lord = input.opinions.find((o) => o.about.startsWith("lord:"));
  for (const cond of input.place.conditions) {
    const why = `${cond.text} in ${input.place.name}`.slice(0, 200);
    if (cond.kind === "famine") {
      add({ kind: "emotion", emotion: "worry", strength: 2, about: `the hunger in ${input.place.name}`, because: [cond.ref], why });
      if (lord) add({ kind: "opinion", about: lord.about, axis: "trust", delta: clip(-4, cap), because: [cond.ref], why: `${cond.text}, and folk look to whoever rules` });
    } else if (cond.kind === "raided") {
      add({ kind: "emotion", emotion: "worry", strength: 2, about: `the raids on ${input.place.name}`, because: [cond.ref], why });
      if (lord) add({ kind: "opinion", about: lord.about, axis: "respect", delta: clip(-3, cap), because: [cond.ref], why: `${cond.text}; the one who rules is meant to keep it safe` });
    } else if (cond.kind === "war") add({ kind: "emotion", emotion: "worry", strength: 1.5, about: "the war", because: [cond.ref], why });
    else if (cond.kind === "plenty") {
      add({ kind: "emotion", emotion: "joy", strength: 1, about: `the good times in ${input.place.name}`, because: [cond.ref], why });
      if (lord) add({ kind: "opinion", about: lord.about, axis: "trust", delta: 2, because: [cond.ref], why: `${cond.text}` });
    }
  }

  // 5. Time wears grudges down.
  at("time");
  if (input.who.grudge && (input.who.grudgeAge ?? 0) >= LET_GO_AFTER && !input.news.some((n) => n.by === "player" && n.tone === -1)) {
    add({ kind: "forgive", against: "player", because: ["self"], why: `${name} has carried it long enough` });
  }

  // 6. The pull of the people they trust: opinions spread. Each subject drifts toward what close people think of it, but only people
  // who hold a view at all count (someone who has never met the player has no opinion of them to pull toward).
  at("pull");
  for (const o of input.opinions) {
    const views = input.people.filter((p) => p.credence >= 0.55).flatMap((p) => p.theirViews.filter((v) => v.about === o.about).map((v) => ({ p, v })));
    if (views.length === 0) continue;
    const weight = views.reduce((s, { p }) => s + p.credence, 0);
    for (const axis of ["trust", "affection", "respect"] as const) {
      const avg = views.reduce((s, { p, v }) => s + v.axes[axis] * p.credence, 0) / weight;
      const gap = avg - o.axes[axis];
      if (Math.abs(gap) < PULL_FROM) continue;
      const delta = clip(gap * PULL, PULL_MAX);
      if (delta !== 0) add({ kind: "opinion", about: o.about, axis, delta, because: views.slice(0, 3).map(({ p }) => p.ref), why: `${views.length === 1 ? views[0]!.p.name : "the people close to them"} ${gap > 0 ? "think better" : "think worse"} of ${o.label}`.slice(0, 220) });
    }
  }

  const changes = [...group.feel, ...group.story, ...group.wants, ...group.deeds, ...group.town, ...group.time, ...group.pull];
  return { changes, malformed: 0 };
}

function nameFor(input: ReviewInput, about: string): string {
  if (about === "player") return "them";
  return input.people.find((p) => `p:${p.id}` === about)?.name ?? input.opinions.find((o) => o.about === about)?.label ?? "whoever did it";
}
