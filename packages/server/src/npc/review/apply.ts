import { config } from "../../config.js";
import type { Rng } from "../../game/dice.js";
import type { EventKind } from "../../game/events.js";
import { addEmotion } from "../emotions.js";
import { remember } from "../memory.js";
import { adjust, settleGrudge, setGrudge, type Axis } from "../relationship.js";
import { adjustRelation, NO_RELATION } from "../social.js";
import { traitsOf } from "../traits.js";
import type { FactsSheet } from "../depth/facts.js";
import { secretFrom } from "../depth/fallback.js";
import type { LifeGoal, NpcPersona, NpcState } from "../types.js";
import type { Change, ReviewInput } from "./types.js";

/**
 * Applying a checked review (N25b step 5). Each kind of change maps onto what the game already has: relationship axes,
 * lasting emotions, grudges, rumours' accuracy, arcs, memories, and the persona's own fears, loves, secrets and story.
 * Nothing is invented here: the checks have already said the change follows from what the person was given. Returns the
 * persona (a new one if their file changed) and a line for each change, with the event kind to record.
 */
export interface AppliedLine {
  kind: Change["kind"];
  /** What changed, plainly: for the admin card and the event. */
  text: string;
  why: string;
  event: EventKind;
}

export interface ApplyCtx {
  persona: NpcPersona;
  state: NpcState;
  day: number;
  input: ReviewInput;
  /** For a secret: what is true about them (the candidates). */
  sheet?: FactsSheet;
  rng: Rng;
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/** What a person wants weighs a little less at every review; a want below this is forgotten. */
export const GOAL_FADE = 0.08;
export const GOAL_FADED = 0.15;

/** The one thing most on their mind, as a situation line written to them (null if nothing is). */
export function describeLifeGoals(state: Pick<NpcState, "lifeGoals">): string | null {
  const g = [...(state.lifeGoals ?? [])].sort((a, b) => b.strength - a.strength)[0];
  return g ? `On your mind: ${g.words}` : null;
}

/** Keep a backstory inside its limit by dropping the oldest of the lines reviews added (never the first two sentences). */
export function trimBackstory(text: string, max = config.review.maxBackstory): string {
  if (text.length <= max) return text;
  const sentences = text.split(/(?<=[.!?])\s+/);
  const head = sentences.slice(0, 2);
  let tail = sentences.slice(2);
  while (tail.length > 0 && [...head, ...tail].join(" ").length > max) tail = tail.slice(1);
  const out = [...head, ...tail].join(" ");
  return out.length <= max ? out : out.slice(0, max);
}

const nameOf = (input: ReviewInput, about: string): string => {
  if (about === "player") return "the player";
  const p = input.people.find((x) => x.id === about.replace(/^p:/, ""));
  if (p) return p.name;
  return input.opinions.find((o) => o.about === about)?.label ?? about;
};

/** Apply the accepted changes. */
export function applyChanges(ctx: ApplyCtx, changes: readonly Change[], mood?: NpcState["mood"]): { persona: NpcPersona; lines: AppliedLine[] } {
  const { state, day, input } = ctx;
  let persona = ctx.persona;
  const lines: AppliedLine[] = [];
  const traits = traitsOf(persona, state);
  // What they wanted before weighs a little less each time they think it over.
  if (state.lifeGoals) state.lifeGoals = state.lifeGoals.map((g) => ({ ...g, strength: Math.round((g.strength - GOAL_FADE) * 100) / 100 })).filter((g) => g.strength >= GOAL_FADED);
  const line = (c: Change, text: string, event: EventKind) => lines.push({ kind: c.kind, text, why: c.why, event });

  for (const c of changes) {
    switch (c.kind) {
      case "opinion": {
        const delta = Math.round(c.delta);
        const axis = c.axis as Axis;
        if (c.about === "player") adjust(state, axis, delta);
        else if (c.about.startsWith("p:")) adjustRelation(state, c.about.slice(2), axis, delta);
        else {
          const v = ((state.views ??= {})[c.about] ??= { ...NO_RELATION });
          v[axis] = axis === "fear" ? clamp(v[axis] + delta, 0, 100) : clamp(v[axis] + delta, -100, 100);
        }
        line(c, `${c.axis} toward ${nameOf(input, c.about)} ${delta > 0 ? "+" : ""}${delta}`, "changed-mind");
        break;
      }
      case "emotion":
        addEmotion(state, c.emotion, clamp(c.strength / 3, 0.1, 1), c.about, day, c.about.toLowerCase().includes("player") || c.about.toLowerCase().includes("they "));
        line(c, `${c.emotion} (${c.about})`, "changed-mind");
        break;
      case "goal-add": {
        const goal: LifeGoal = { id: `${c.goal}-${day}`, kind: c.goal, ...(c.target ? { target: c.target } : {}), words: c.words, since: day, strength: 0.7 };
        (state.lifeGoals ??= []).push(goal);
        line(c, `wants to ${c.goal.replace("_", " ")}: ${c.words}`, "new-goal");
        break;
      }
      case "goal-drop":
        state.lifeGoals = (state.lifeGoals ?? []).filter((g) => g.id !== c.goal);
        line(c, `no longer wants "${c.goal}"`, "new-goal");
        break;
      case "grudge":
        if (c.against === "player") setGrudge(state, traits, c.why, day);
        else {
          const id = c.against.replace(/^p:/, "");
          adjustRelation(state, id, "trust", -25);
          adjustRelation(state, id, "affection", -15);
        }
        line(c, `holds a grudge against ${nameOf(input, c.against)}`, "changed-mind");
        break;
      case "forgive":
        if (c.against === "player") settleGrudge(state);
        else {
          const id = c.against.replace(/^p:/, "");
          adjustRelation(state, id, "trust", 15);
          adjustRelation(state, id, "affection", 10);
        }
        line(c, `forgives ${nameOf(input, c.against)}`, "changed-mind");
        break;
      case "fear":
      case "love": {
        const key = c.kind === "fear" ? "fears" : "loves";
        persona = { ...persona, [key]: [...(persona[key] ?? []), { name: c.name, words: c.mentions }] };
        line(c, `a new ${c.kind}: ${c.name}`, "new-fear");
        break;
      }
      case "secret": {
        const cand = ctx.sheet?.secrets.find((k) => k.id === c.candidate);
        if (!cand || !ctx.sheet) break;
        const made = secretFrom(cand, ctx.sheet, ctx.rng);
        const secret = { ...made.secret, about: c.about, text: c.text, cover: c.cover };
        persona = { ...persona, secrets: [...persona.secrets, secret], ...(made.debt ? { debts: [...(persona.debts ?? []), made.debt] } : {}) };
        line(c, `has come to keep a secret (${cand.kind})`, "secret-made");
        break;
      }
      case "belief": {
        const key = input.rumours.find((r) => r.ref === c.rumour || r.ref === `r:${c.rumour}`)?.ref.replace(/^r:/, "") ?? c.rumour;
        const heard = state.rumours[key];
        if (heard) {
          if (c.accept) heard.accuracy = 1;
          else delete state.rumours[key];
        }
        line(c, `${c.accept ? "believes" : "dismisses"} the rumour "${key}"`, "changed-mind");
        break;
      }
      case "arc-step": {
        const id = c.arc.replace(/^a:/, "");
        const arc = (persona.arcs ?? []).find((a) => a.id === id);
        const at = state.arcs[id]?.stage ?? 0;
        if (arc && at + 1 < arc.stages.length) {
          state.arcs[id] = { stage: at + 1, day };
          remember(state, { id: `arc:${id}:${at + 1}`, day, text: arc.stages[at + 1]!.line, importance: 4, valence: 0 }, traits);
          line(c, `their story "${arc.name}" moves on`, "changed-mind");
        }
        break;
      }
      case "story":
        persona = { ...persona, backstory: trimBackstory(`${persona.backstory} ${c.words}`) };
        line(c, c.words, "story-turn");
        break;
    }
  }
  if (mood && !state.inCombat) state.mood = mood;
  // The review itself is remembered: what changed, and why, for the next time they think it over.
  if (lines.length > 0) {
    const text = lines.map((l) => l.why).join(" ").slice(0, 220);
    remember(state, { id: `review:${day}`, day, text, importance: 3, valence: 0 }, traits);
  }
  state.review = { day, ...(input.shock ? { shock: day } : state.review?.shock !== undefined ? { shock: state.review.shock } : {}), seen: [...(state.review?.seen ?? []), ...input.news.map((n) => n.ref)].slice(-40) };
  return { persona, lines };
}
