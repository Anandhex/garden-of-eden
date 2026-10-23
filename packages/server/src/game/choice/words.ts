import { z } from "zod";
import { structured } from "../../director/structured.js";
import type { LLMProvider } from "../../llm/provider.js";
import type { NpcState } from "../../npc/types.js";
import { choicesOf } from "./talker.js";
import { reasonOf } from "./score.js";
import type { ChoiceLog, Ranked } from "./types.js";

/**
 * The words for a choice (N38). Code decided; the model only narrates. The fallback is the parts of the score in plain words, which is
 * what a talker is told when asked why they did something, and what the day's plan is fed; the `choice-reason` call (lowest-priority
 * flavour, only when asked or pinned) lets the model say it in their own voice, and the game is the same without it.
 */
const DOING: Record<string, string> = {
  work: "went to work",
  eat: "went to eat",
  rest: "rested",
  gossip: "went to talk to people",
  buy: "went to buy a meal",
  sell: "sold their goods",
  court: "paid court to",
  confront: "had it out with",
  insult: "insulted",
  revenge: "settled a score with",
  spread_rumour: "spread a tale about",
  recruit: "talked into joining them",
  travel: "decided to leave",
  steal: "stole from",
  attack: "came to blows with",
  flatter: "sought the favour of",
  petition: "asked a favour of",
  seek_master: "set out to find a master to learn from",
};

const PART_WORDS: Array<[RegExp, string]> = [
  [/^grudge vs (.+)$/, "a grudge against $1"],
  [/^revenge: (.+)$/, "wanting revenge ($1)"],
  [/^habit: (.+)$/, "it was their usual $1"],
  [/^bold$/, "being bold"],
  [/^hot temper$/, "a hot temper"],
  [/^hunger sours$/, "hunger souring their mood"],
  [/^hunger$/, "hunger"],
  [/^tired$/, "being tired"],
  [/^broke$/, "being short of coin"],
  [/^sociable$/, "liking company"],
  [/^greed$/, "greed"],
  [/^dishonest$/, "being no stickler for the truth"],
  [/^mood: anger$/, "a sour mood"],
  [/^warmth toward (.+)$/, "warmth toward $1"],
  [/^wants to be elsewhere$/, "wanting to be elsewhere"],
  [/^ambition: (.+)$/, "wanting $1"],
  [/^rival for (.+)$/, "a rivalry over $1"],
  [/^currying favour$/, "wanting to stand well with those above them"],
];

const words = (label: string): string => {
  for (const [re, to] of PART_WORDS) if (re.test(label)) return label.replace(re, to);
  return label;
};

/** The picked option as a sentence: "had it out with Odo, because of a grudge against Odo and being bold". */
export function choiceWords(log: ChoiceLog): string {
  const o = log.options[log.picked]!;
  const what = DOING[o.action] ?? o.action;
  const reasons = [...o.parts]
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([l]) => words(l));
  const who = o.target && /(with|to|of|from|about|on|up)$/.test(what) ? ` ${nameOf(log, o)}` : "";
  return `${what}${who}${reasons.length > 0 ? `, because of ${reasons.join(" and ")}` : ""}`;
}

const nameOf = (log: ChoiceLog, o: Ranked): string => o.parts.map(([l]) => /^(?:grudge vs|warmth toward) (.+)$/.exec(l)?.[1]).find(Boolean) ?? o.target ?? "someone";

/** What they did lately that was not just their day, for a situation line or a plan: or null if nothing. */
export function describeChoices(state: NpcState): string | null {
  const last = choicesOf(state)
    .filter((l) => !l.habit)
    .slice(-2);
  if (last.length === 0) return null;
  return `Lately you ${last.map((l) => `${choiceWords(l)} (day ${l.day})`).join("; then you ")}.`;
}

export const ReasonSchema = z.object({ reason: z.string().min(8).max(160) });

/** The reason in the person's own voice, or the fallback words if the model has nothing usable (or is not asked). */
export async function explainChoice(log: ChoiceLog, who: string, llm?: LLMProvider | null): Promise<string> {
  const fallback = `${who} ${choiceWords(log)}.`;
  if (!llm) return fallback;
  const system = 'You write one short line in the first person for a medieval fantasy villager explaining why they did something. Reply as JSON: {"reason": ...}. Under 25 words. Invent no names or facts beyond those given.';
  const prompt = `${who} ${choiceWords(log)}. The reasons, as numbers: ${reasonOf(log.options[log.picked]!.parts)}. Write what ${who} says if asked why.`;
  const out = await structured(llm, ReasonSchema, { kind: "choice-reason", system, prompt, maxTokens: 80, temperature: 0.8 });
  const line = out?.reason.trim().replace(/^"|"$/g, "");
  return line && !/\d|\n/.test(line) ? line : fallback;
}
