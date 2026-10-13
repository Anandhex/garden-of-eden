import { z } from "zod";
import { EMOTION_KINDS } from "../emotions.js";
import { MOODS } from "../types.js";

/**
 * Lives that change (N25b). A review is a proposal of small changes to what a person feels and wants, each of a
 * fixed kind and each citing what in the input it follows from. The model proposes (for talkers); code's rules
 * propose the same kinds (for everyone else, and when the model is off or over budget); the same checks
 * (validate.ts) and the same code (apply.ts) take both. Nothing here is a fact about the world: a review changes
 * a person, never what happened.
 */
export const CHANGE_KINDS = ["opinion", "emotion", "goal-add", "goal-drop", "grudge", "forgive", "fear", "love", "secret", "belief", "arc-step", "story"] as const;
export type ChangeKind = (typeof CHANGE_KINDS)[number];

export const OPINION_AXES = ["trust", "affection", "respect", "fear"] as const;
export const GOAL_KINDS = ["move", "avenge", "pay_debt", "protect", "make_amends", "save_coin", "leave_post"] as const;

/** Every change cites what it follows from (refs given in the input) and says why in a sentence. */
const reasons = { because: z.array(z.string().min(1).max(60)).min(1).max(4), why: z.string().min(1).max(240) };
const words = z.array(z.string().min(1).max(40)).min(1).max(5);

export const ChangeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("opinion"), about: z.string().min(1).max(60), axis: z.enum(OPINION_AXES), delta: z.number(), ...reasons }),
  z.object({ kind: z.literal("emotion"), emotion: z.enum(EMOTION_KINDS), strength: z.number().min(0.1).max(3), about: z.string().min(1).max(100), ...reasons }),
  z.object({ kind: z.literal("goal-add"), goal: z.enum(GOAL_KINDS), target: z.string().max(60).optional(), words: z.string().min(1).max(200), ...reasons }),
  z.object({ kind: z.literal("goal-drop"), goal: z.string().min(1).max(60), ...reasons }),
  z.object({ kind: z.literal("grudge"), against: z.string().min(1).max(60), ...reasons }),
  z.object({ kind: z.literal("forgive"), against: z.string().min(1).max(60), ...reasons }),
  z.object({ kind: z.literal("fear"), name: z.string().min(1).max(80), mentions: words, ...reasons }),
  z.object({ kind: z.literal("love"), name: z.string().min(1).max(80), mentions: words, ...reasons }),
  z.object({ kind: z.literal("secret"), candidate: z.string().min(1).max(40), about: z.string().min(1).max(140), text: z.string().min(1).max(400), cover: z.string().min(1).max(200), ...reasons }),
  z.object({ kind: z.literal("belief"), rumour: z.string().min(1).max(80), accept: z.boolean(), ...reasons }),
  z.object({ kind: z.literal("arc-step"), arc: z.string().min(1).max(60), words: z.string().min(1).max(200), ...reasons }),
  z.object({ kind: z.literal("story"), words: z.string().min(1).max(280), ...reasons }),
]);
export type Change = z.infer<typeof ChangeSchema>;

/**
 * What a person's review returns. Each change is read on its own, so one malformed change costs only itself
 * (a change that doesn't parse is dropped and counted).
 */
export const ProposalSchema = z.object({
  changes: z.array(z.unknown()).max(20).default([]),
  mood: z.enum(MOODS).optional().catch(undefined),
});
export type RawProposal = z.infer<typeof ProposalSchema>;

/**
 * What the model is held to (as the JSON Schema of its structured reply): a flat change, so a small model can fill it in. Each person has
 * an id and a list of these; the checks (`ChangeSchema`) then read each one on its own.
 */
export const ModelChangeSchema = z.object({
  kind: z.enum(CHANGE_KINDS),
  because: z.array(z.string()).min(1).max(4),
  about: z.string().optional(),
  axis: z.enum(OPINION_AXES).optional(),
  delta: z.number().optional(),
  emotion: z.enum(EMOTION_KINDS).optional(),
  strength: z.number().optional(),
  goal: z.string().optional(),
  target: z.string().optional(),
  against: z.string().optional(),
  name: z.string().optional(),
  mentions: z.array(z.string()).optional(),
  candidate: z.string().optional(),
  text: z.string().optional(),
  cover: z.string().optional(),
  rumour: z.string().optional(),
  accept: z.boolean().optional(),
  arc: z.string().optional(),
  words: z.string().optional(),
});
export const ModelReplySchema = z.object({ reviews: z.array(z.object({ person: z.string(), changes: z.array(ModelChangeSchema).max(3), mood: z.enum(MOODS).optional() })) });

/** A batched reply as read: one entry per person; their changes are read one at a time by the checks. */
export const BatchReplySchema = z.object({ reviews: z.array(z.object({ person: z.string(), changes: z.array(z.unknown()).max(20).default([]), mood: z.enum(MOODS).optional().catch(undefined) })) });

export interface Proposal {
  /** As proposed: each is checked on its own, and one that isn't a known kind of change is rejected (validate.ts). */
  changes: unknown[];
  mood?: (typeof MOODS)[number];
  /** Changes in the raw reply that were not of a known shape. */
  malformed: number;
}

export interface Axes {
  trust: number;
  affection: number;
  respect: number;
  fear: number;
}

/** One thing the input says, with the ref a change must cite to follow from it. */
export interface Item {
  ref: string;
  text: string;
}

export interface ReviewInput {
  /** The person: the ref is "self". */
  who: {
    id: string;
    name: string;
    job: string;
    cls: string;
    site: string;
    siteName: string;
    age: number;
    minor: boolean;
    traits: Record<string, number>;
    /** What they want now (words), their fears and loves (names), the secrets they hold (ids). */
    goals: Array<{ id: string; words: string }>;
    fears: string[];
    loves: string[];
    secrets: string[];
    money: number;
    owed: number;
    /** Their grudge against the player, if they hold one, and how many days old it is. */
    grudge?: string;
    grudgeAge?: number;
  };
  day: number;
  since: number;
  /** Set for a shock review: what hit them, and how hard. */
  shock?: { ref: string; text: string; impact: number };
  /**
   * Events they know since `since`, most important kept (refs "e:<id>"). `text` is a plain third-person sentence.
   * `by` and `to` are who did it and who it was done to, as subjects the person knows ("player", "self", "p:<id>"),
   * `tone` is what it was for them and theirs: -1 harm, 1 good, 0 neither.
   */
  news: Array<Item & { importance: number; day: number; kind: string; by?: string; to?: string; tone: -1 | 0 | 1; /** They were there: the game already moved them a little at the time. */ saw?: boolean }>;
  /** Their older memories closest in meaning to the news (refs "m:<id>"). */
  recalled: Array<Item & { day: number }>;
  /** The people who matter to them (refs "p:<id>"), with what those people think about what's in play. */
  people: Array<Item & { id: string; name: string; tie: string; myView: Axes; credence: number; theirViews: Array<{ about: string; axes: Axes }>; recent: string[] }>;
  /** Their place: its conditions (refs "c:<kind>") and the events there they know (refs "e:<id>"). */
  place: { name: string; conditions: Array<Item & { kind: string }> };
  /** What they now think of the subjects in play: "player", "p:<id>", "lord:<id>", "faction:<id>", "site:<id>". */
  opinions: Array<{ about: string; label: string; axes: Axes }>;
  rumours: Array<Item & { about: string; accuracy: number }>;
  /** True things that could become a secret (ids as in the facts sheet). */
  candidates: Array<Item & { kind: string }>;
  arcs: Array<{ ref: string; name: string; stage: number; stages: number }>;
  /** Every proper name the words may use. */
  names: string[];
}

/** Every ref a change may cite in this input. */
export function refsOf(input: ReviewInput): Set<string> {
  const refs = new Set<string>(["self"]);
  if (input.shock) refs.add(input.shock.ref);
  for (const i of [...input.news, ...input.recalled, ...input.people, ...input.place.conditions, ...input.rumours, ...input.candidates]) refs.add(i.ref);
  for (const a of input.arcs) refs.add(a.ref);
  // Their own fears and loves, and wants, are things a change may follow from too.
  input.who.fears.forEach((_, i) => refs.add(`f:${i + 1}`));
  input.who.loves.forEach((_, i) => refs.add(`l:${i + 1}`));
  for (const g of input.who.goals) refs.add(g.id);
  // Their own views are things a change may follow from ("they already trust the lord little").
  for (const o of input.opinions) refs.add(o.about);
  return refs;
}

/** What validation did with a proposal, with the reasons (stored in `life_reviews`). `accepted` are the changes to apply, already clipped to the limits. */
export interface Checked {
  accepted: Change[];
  clipped: Array<{ kind: string; note: string }>;
  rejected: Array<{ change: unknown; reason: string }>;
}

/** What each ref says, in a sentence: the reason recorded for a change that cites it. */
export function refTexts(input: ReviewInput): Map<string, string> {
  const m = new Map<string, string>();
  if (input.shock) m.set(input.shock.ref, input.shock.text);
  for (const n of input.news) m.set(n.ref, n.text);
  for (const r of input.recalled) m.set(r.ref, r.text);
  for (const p of input.people) m.set(p.ref, `${p.name}, ${p.tie}`);
  for (const c of input.place.conditions) m.set(c.ref, `${c.text} in ${input.place.name}`);
  for (const r of input.rumours) m.set(r.ref, r.text);
  for (const k of input.candidates) m.set(k.ref, k.text);
  for (const a of input.arcs) m.set(a.ref, a.name);
  for (const o of input.opinions) m.set(o.about, `what ${input.who.name.split(" ")[0]} thinks of ${o.label}`);
  input.who.fears.forEach((f, i) => m.set(`f:${i + 1}`, `${input.who.name.split(" ")[0]} fears ${f}`));
  input.who.loves.forEach((f, i) => m.set(`l:${i + 1}`, `${input.who.name.split(" ")[0]} loves ${f}`));
  for (const g of input.who.goals) m.set(g.id, g.words);
  m.set("self", `${input.who.name}'s own circumstances`);
  return m;
}
