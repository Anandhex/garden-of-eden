import type { AdminSection } from "@millbrook/shared";
import { choicesOf } from "../game/choice/talker.js";
import { reasonOf } from "../game/choice/score.js";
import { choiceWords } from "../game/choice/words.js";
import type { ChoiceLog, Ranked } from "../game/choice/types.js";
import type { NpcState } from "../npc/types.js";
import type { AdminContext } from "./context.js";

/**
 * What a person chose and why (N38): a talker's last hours with every option, its score and the parts it was made of, the temperature
 * and the roll; a townsperson's day shows as the events they chose to make, each with its reason. Read-only, like everything here.
 */
const SHOWN = 6;
const num = (n: number) => `${n >= 0 ? "" : "−"}${Math.abs(n).toFixed(2)}`;
const optionWords = (o: Ranked): string => `${o.action}${o.target ? ` ${o.target}` : ""}${o.place ? ` @${o.place}` : ""}`;

/** The data the endpoint returns for a talker: the last choices, newest last. */
export interface ChoicesView {
  ref: string;
  name: string;
  kind: "talker" | "townsperson";
  choices: ChoiceLog[];
  /** What each choice was, in words (the fallback for the `choice-reason` call), in the same order. */
  words: string[];
  /** For a townsperson: the deeds they chose, with their reasons. */
  deeds: Array<{ day: number; kind: string; details: string; why: string }>;
}

export function choicesView(ctx: AdminContext, id: string): ChoicesView | null {
  const town = ctx.town();
  const agent = town.agents[id];
  if (agent) return { ref: `town:${id}`, name: town.personas[id]?.name ?? id, kind: "talker", choices: [...choicesOf(agent.state)], words: choicesOf(agent.state).map(choiceWords), deeds: deedsOf(ctx, id) };
  const row = ctx.store?.people.get(id);
  if (!row) return null;
  return { ref: `town:${id}`, name: row.name, kind: "townsperson", choices: [], words: [], deeds: deedsOf(ctx, id) };
}

function deedsOf(ctx: AdminContext, id: string): ChoicesView["deeds"] {
  const events = ctx.store?.eventsAbout(id, 200) ?? [];
  return events
    .filter((e) => e.actor === id && !!e.why && /[+−]\d\.\d\d/.test(e.why))
    .slice(-SHOWN)
    .reverse()
    .map((e) => ({ day: e.day, kind: e.kind, details: e.details, why: e.why! }));
}

export function choiceSections(ctx: AdminContext, id: string, state?: NpcState): AdminSection[] {
  const out: AdminSection[] = [];
  const logs = state ? choicesOf(state).slice(-SHOWN) : [];
  if (logs.length > 0) {
    out.push({
      title: "Choices (last hours)",
      rows: logs
        .slice()
        .reverse()
        .map((l): [string, string] => {
          const p = l.options[l.picked]!;
          const rest = l.options
            .filter((_, i) => i !== l.picked)
            .slice(0, 3)
            .map((o) => `${optionWords(o)} ${num(o.score)}`)
            .join("; ");
          return [`Day ${l.day}, ${String(l.hour).padStart(2, "0")}:00${l.habit ? " (habit)" : ""}`, `${optionWords(p)} ${num(p.score)} [${reasonOf(p.parts, 4)}]; T=${l.T.toFixed(2)}, roll ${l.roll.toFixed(2)}${rest ? `. Instead of: ${rest}` : ""}`];
        }),
    });
  }
  const deeds = deedsOf(ctx, id);
  if (deeds.length > 0) out.push({ title: "Chose to do", rows: deeds.map((d): [string, string] => [`Day ${d.day}: ${d.kind}`, `${d.details}. Because ${d.why}`]) });
  return out;
}
