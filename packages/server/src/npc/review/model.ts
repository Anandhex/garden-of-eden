import { structured } from "../../director/structured.js";
import type { LLMProvider } from "../../llm/provider.js";
import { z } from "zod";
import { BatchReplySchema, CHANGE_KINDS, GOAL_KINDS, ModelReplySchema, refsOf, type Axes, type Proposal, type ReviewInput } from "./types.js";

/**
 * The model's review (N25b step 3): up to `review.batch` talkers in one call, one shared section (their town's
 * conditions, what hit them if a shock) and one section per person with only what *they* know. The model proposes
 * changes of fixed kinds, citing the refs it was given; it never sets a fact. A person missing from the reply, or
 * whose reply is unusable, gets code's rules instead (schedule.ts). Each change is read on its own by the checks, so
 * one malformed change costs only itself.
 */
const ax = (a: Axes) => `trust ${Math.round(a.trust)}, affection ${Math.round(a.affection)}, respect ${Math.round(a.respect)}, fear ${Math.round(a.fear)}`;

/** One person's section of the prompt. Plain lines, refs in brackets. */
export function renderPerson(i: ReviewInput): string {
  const w = i.who;
  const lines: string[] = [];
  lines.push(`### ${w.id}: ${w.name}, ${w.job} of ${w.siteName}, age ${w.age}${w.minor ? " (a child)" : ""}. Traits: ${Object.entries(w.traits).map(([k, v]) => `${k} ${v}`).join(", ") || "none given"}.`);
  lines.push(`Money ${w.money} copper${w.owed > 0 ? `, owes ${w.owed}` : ""}.${w.grudge ? ` Holds a grudge against the player: ${w.grudge}.` : ""}`);
  if (w.goals.length > 0) lines.push(`Wants now: ${w.goals.map((g) => `[${g.id}] ${g.words}`).join(" ")}`);
  if (w.fears.length > 0) lines.push(`Fears: ${w.fears.map((f, n) => `[f:${n + 1}] ${f}`).join("; ")}. Loves: ${w.loves.map((f, n) => `[l:${n + 1}] ${f}`).join("; ") || "nothing named"}.`);
  if (i.shock) lines.push(`WHAT JUST HIT THEM [${i.shock.ref}]: ${i.shock.text} (a big event for them).`);
  lines.push(i.news.length > 0 ? `What they know of since ${i.since === i.day ? "last time" : `day ${i.since}`}:` : "Nothing new they know of.");
  for (const n of i.news) lines.push(`  [${n.ref}] day ${n.day}: ${n.text}${n.by ? ` (by ${n.by}${n.to ? ` to ${n.to}` : ""})` : ""}`);
  if (i.recalled.length > 0) lines.push("They remember from before:", ...i.recalled.map((r) => `  [${r.ref}] day ${r.day}: ${r.text}`));
  if (i.people.length > 0) {
    lines.push("The people close to them:");
    for (const p of i.people) {
      lines.push(`  [${p.ref}] ${p.name} (${p.tie}); they see them: ${ax(p.myView)}.${p.recent.length > 0 ? ` Lately: ${p.recent.join("; ")}.` : ""}`);
      for (const v of p.theirViews.filter((x) => Math.abs(x.axes.trust) + Math.abs(x.axes.affection) > 0)) lines.push(`      ${p.name} thinks of ${v.about}: ${ax(v.axes)}`);
    }
  }
  if (i.place.conditions.length > 0) lines.push(`In ${i.place.name}: ${i.place.conditions.map((c) => `[${c.ref}] ${c.text}`).join("; ")}.`);
  if (i.opinions.length > 0) lines.push('Their views (for an "opinion" change, "about" must be one of these ids, in quotes): ' + i.opinions.map((o) => `"${o.about}" (${o.label}) ${ax(o.axes)}`).join(" | "));
  if (i.rumours.length > 0) lines.push("Rumours they hold:", ...i.rumours.map((r) => `  [${r.ref}] about ${r.about}: ${r.text} (they trust it ${Math.round(r.accuracy * 100)}%)`));
  if (i.candidates.length > 0) lines.push("True things that could become a secret they keep: " + i.candidates.map((c) => `[${c.ref}] ${c.text}`).join(" | "));
  if (i.arcs.length > 0) lines.push("Their stories: " + i.arcs.map((a) => `[${a.ref}] ${a.name} (stage ${a.stage + 1} of ${a.stages})`).join(" | "));
  lines.push(`Refs you may cite in "because" (copy them exactly, with the prefix; nothing else): ${[...refsOf(i)].join(", ")}`);
  return lines.join("\n");
}

/** The whole prompt for a batch. */
export function reviewPrompt(inputs: ReviewInput[]): { system: string; prompt: string } {
  const system =
    "You decide how people in a small fantasy world feel and what they want after the days just gone, from only what is written for each of them. Reply with JSON only. " +
    "Change little: most reviews are one to three small changes, or none (at most three). Every change must follow from items in that person's own section and cite their refs in `because` (a ref is the text in [brackets]). " +
    "Never use a name or place that is not in that person's section. Never invent events. Never decide what happened; only how they take it. Keep to plain, grounded words. Do not explain: the game records the reason from the items you cite. " +
    "For a child, nothing romantic or adult.";
  const shared = inputs[0]!.place.conditions.length > 0 ? `The place: ${inputs[0]!.place.name}.` : "";
  const kinds =
    `Kinds of change (each also has "because": [refs it follows from]):\n` +
    `- {"kind":"opinion","about":<one of their views>,"axis":"trust"|"affection"|"respect"|"fear","delta":<-10..10>}\n` +
    `- {"kind":"emotion","emotion":"pride"|"gratitude"|"joy"|"grief"|"embarrassment"|"resentment"|"worry","strength":<1..3>,"about":"<what, a few words>"}\n` +
    `- {"kind":"goal-add","goal":${GOAL_KINDS.map((g) => `"${g}"`).join("|")},"target":<optional view or ref>,"words":"You ... (what they want, to them)"}  /  {"kind":"goal-drop","goal":<id they have>}\n` +
    `- {"kind":"grudge","against":"player"|<p:ref>} (needs a deed or memory)  /  {"kind":"forgive","against":...}\n` +
    `- {"kind":"fear"|"love","name":"...","mentions":["lower","case","words"]}\n` +
    `- {"kind":"secret","candidate":<id from the list>,"about":"...","text":"...","cover":"what they say instead"}\n` +
    `- {"kind":"belief","rumour":<ref key>,"accept":true|false}  /  {"kind":"arc-step","arc":<id>,"words":"..."}  /  {"kind":"story","words":"a sentence or two, third person, added to their life story"}\n` +
    `All kinds: ${CHANGE_KINDS.join(", ")}.`;
  const prompt =
    `${shared}\n${kinds}\n\nReply as {"reviews":[{"person":"<id>","changes":[...],"mood":"happy"|"neutral"|"annoyed"|"angry"|"afraid"|"sad"}]} with one entry per person below, in the order given (changes may be empty). Fill in only the fields a change needs.\n\n` +
    inputs.map(renderPerson).join("\n\n");
  return { system, prompt };
}

/** Ask the model for a batch of reviews. Null if it failed (or the call was over its cap): the caller uses code's rules. */
export async function modelReviews(llm: LLMProvider, inputs: ReviewInput[]): Promise<Record<string, Proposal> | null> {
  if (inputs.length === 0) return {};
  const { system, prompt } = reviewPrompt(inputs);
  const reply = await structured(llm, BatchReplySchema, { kind: "life-review", system, prompt, maxTokens: 300 * inputs.length, temperature: 0.7, jsonSchema: z.toJSONSchema(ModelReplySchema) as Record<string, unknown> }, 2);
  if (!reply) return null;
  const out: Record<string, Proposal> = {};
  for (const i of inputs) {
    const p = reply.reviews.find((r) => r.person === i.who.id);
    // Each change is parsed on its own by the checks; here only the count of non-objects is noted.
    if (p) out[i.who.id] = { changes: p.changes as Proposal["changes"], ...(p.mood ? { mood: p.mood } : {}), malformed: p.changes.filter((c) => typeof c !== "object" || c === null).length };
  }
  return out;
}
