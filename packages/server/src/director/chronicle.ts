import { z } from "zod";
import { config } from "../config.js";
import { CallDropped } from "../llm/budgeted.js";
import type { LLMProvider, ToolDef } from "../llm/provider.js";
import { addLore, learnLore } from "../npc/knowledge.js";
import { driftTrait } from "../npc/growth.js";
import type { NpcPersona, NpcState, WorldSnapshot } from "../npc/types.js";
import type { CreatureTemplate } from "../game/creatures.js";
import { eventsOn, type GameEvent } from "../game/events.js";
import { formatMoney } from "../game/money.js";
import { ITEMS } from "../game/items.js";
import type { SpawnRule } from "../game/spawning.js";
import { describeObjective } from "../game/quests.js";
import {
  AddLoreArgs,
  AddNewsArgs,
  type DirectorLogEntry,
  logDecision,
  ProposeQuestArgs,
  ProposeTraitShiftArgs,
  validateLore,
  validateQuest,
  validateTraitShift,
  type ValidatorContext,
} from "./validator.js";

/**
 * The nightly chronicle (N12.3, N12.4, N12.5). At midnight (or after a /wait) code
 * picks the day's most important events and makes one small director call per
 * event, with tools: add_lore, add_news, propose_quest, propose_trait_shift. Each
 * proposal goes through the validator (director/validator.ts): accepted or rejected,
 * logged either way. Who knows new lore is set by code from the witnesses (certain
 * for them, a rumour for everyone else), never by the model. At most
 * config.directorMaxPerNight proposals are accepted a night; news expires after
 * NEWS_DAYS. Runs only while the player isn't mid-conversation.
 */
export const EVENTS_PER_NIGHT = 4;
/** Events below this importance aren't worth a chronicle entry. */
export const CHRONICLE_IMPORTANCE = 5;
/** Days news stays in everyone's ears. */
export const NEWS_DAYS = 3;

/** Kinds of events too ordinary for the chronicle. */
const ORDINARY = new Set(["bought", "sold", "complimented", "gift", "commission", "service", "trade", "message", "rumour", "growth"]);

const SYSTEM = `You are the chronicler of Millbrook, a small fantasy village. You are told one thing that happened today.
Use the tools to record it, or do nothing if it isn't worth recording:
- add_news: a one-sentence piece of news everyone in the village will hear.
- add_lore: a short entry for the village's history, if it will be remembered.
- propose_quest: a job someone involved might now want done (bring an item, or deal with some creatures).
- propose_trait_shift: if the event would change someone involved a little (braver, warier, kinder...).
Rules: only name people, places and creatures given to you. Never invent names. Keep every text short and plain.`;

export interface ChronicleContext {
  llm: LLMProvider;
  world: WorldSnapshot;
  personas: Record<string, NpcPersona>;
  states: Record<string, NpcState>;
  creatures: Record<string, CreatureTemplate>;
  /** Where accepted/rejected decisions go besides the save (the database). */
  sink?: (e: DirectorLogEntry) => void;
}

export interface ChronicleResult {
  log: string[];
  accepted: DirectorLogEntry[];
  rejected: DirectorLogEntry[];
}

/** The day's events worth chronicling, most important first. */
export function chronicleEvents(world: Pick<WorldSnapshot, "events">, day: number): GameEvent[] {
  return eventsOn(world, day)
    .filter((e) => e.importance >= CHRONICLE_IMPORTANCE && !ORDINARY.has(e.kind))
    .slice(0, EVENTS_PER_NIGHT);
}

/** How each kind of event reads, actor first: "{a} attacked {t}". Unlisted kinds read "{a}: <kind> ({t})". */
const VERBS: Partial<Record<GameEvent["kind"], string>> = {
  attacked: "{a} attacked {t}",
  killed: "{a} killed {t}",
  subdued: "{a} beat {t} senseless",
  looted: "{a} robbed {t}, who lay helpless",
  theft: "{a} stole from {t}, unseen",
  "theft-caught": "{a} was caught stealing from {t}",
  insulted: "{a} insulted {t}",
  threatened: "{a} threatened {t}",
  gift: "{a} gave {t} a gift",
  "quest-done": "{a} finished a job for {t}",
  "quest-failed": "{a} let {t} down on a job",
  "raid-repelled": "{a} helped drive a bandit raid off {t}'s place",
  raid: "bandits ({a}) raided {t}'s place",
  death: "{t} died",
  succession: "{a} took over from {t}",
  dilemma: "{a} made a hard choice that {t} put to them",
  revenge: "{a} took revenge on {t}",
  "companion-left": "{a} walked out on {t}",
  hired: "{a} hired {t} to come along",
};

/** One event in plain words for the director, with names resolved. */
export function describeEventForDirector(e: GameEvent, names: Record<string, string>): string {
  const who = (id: string) => names[id] ?? id.replace(/-(\d+)$/, " $1");
  const seen = (e.witnesses ?? []).filter((w) => w !== e.actor && w !== e.target).map(who);
  const verb = VERBS[e.kind] ?? `{a}: ${e.kind.replace(/-/g, " ")} ({t})`;
  const what = verb.replace("{a}", who(e.actor)).replace("{t}", who(e.target));
  return `Day ${e.day}, ${String(e.hour).padStart(2, "0")}:00${e.where ? ` at ${e.where}` : ""}: ${what}${e.details && e.details !== e.kind ? ` (${e.details})` : ""}.${seen.length > 0 ? ` Seen by ${seen.join(", ")}.` : ""}`;
}

const tool = (name: string, description: string, schema: z.ZodType): ToolDef => ({ name, description, parameters: z.toJSONSchema(schema) as Record<string, unknown> });

/** Expire old news: ids pushed by play (newsDays) that are older than NEWS_DAYS leave recentEvents. */
export function expireNews(world: WorldSnapshot): string[] {
  const gone: string[] = [];
  for (const [id, day] of Object.entries(world.newsDays ?? {})) {
    if (world.day - day <= NEWS_DAYS) continue;
    world.recentEvents = world.recentEvents.filter((x) => x !== id);
    delete world.newsDays![id];
    gone.push(id);
  }
  return gone;
}

/** Push a news id everyone hears, with a date so it can expire. */
export function pushNews(world: WorldSnapshot, id: string): void {
  if (!world.recentEvents.includes(id)) world.recentEvents.push(id);
  (world.newsDays ??= {})[id] = world.day;
}

/**
 * Run the chronicle for `day` (normally yesterday, at midnight). Returns lines for
 * the player and the decisions. Each event gets one call; a failed call is skipped.
 */
export async function runChronicle(ctx: ChronicleContext, day: number): Promise<ChronicleResult> {
  const { world, personas, states, creatures } = ctx;
  const result: ChronicleResult = { log: [], accepted: [], rejected: [] };
  if ((world.chronicleDay ?? 0) >= day) return result;
  world.chronicleDay = day;
  expireNews(world);
  const names: Record<string, string> = { ...Object.fromEntries(Object.entries(personas).map(([id, p]) => [id, p.name])), player: world.player.name };
  const vctx: ValidatorContext = { world, personas, states, creatures, extraNames: [world.player.name, ...Object.values(creatures).map((c) => c.name)] };
  const tools = [
    tool("add_news", "Record one sentence of news the whole village will hear. id: a short snake_case id.", AddNewsArgs),
    tool("add_lore", "Record an entry in the village's history. id: a short snake_case id; name: what folk will call it.", AddLoreArgs),
    tool("propose_quest", "Propose a job for someone involved: goal 'deliver' (an item) or 'defeat' (a creature kind).", ProposeQuestArgs),
    tool("propose_trait_shift", "Propose that someone involved changed a little: trait one of temper, bravery, honesty, generosity, sociability, forgiveness.", ProposeTraitShiftArgs),
  ];
  const living = Object.entries(personas).filter(([id]) => states[id] && states[id]!.outcome !== "dead" && !states[id]!.dormant);
  const people = living.map(([, p]) => p.name).join(", ");
  const items = Object.keys(ITEMS).join(", ");
  const kinds = Object.values(creatures).map((c) => c.id).join(", ");

  for (const event of chronicleEvents(world, day)) {
    if (result.accepted.length >= config.directorMaxPerNight) break;
    const prompt = [
      describeEventForDirector(event, names),
      `People: ${people}. The player is ${world.player.name}.`,
      `Items: ${items}. Creature kinds: ${kinds}.`,
      "Record it with the tools if it matters.",
    ].join("\n");
    let calls: Array<{ name: string; arguments: Record<string, unknown> }> = [];
    try {
      calls = (await ctx.llm.chat({ kind: "chronicle", system: SYSTEM, messages: [{ role: "user", content: prompt }], tools, maxTokens: 250 })).toolCalls;
    } catch (err) {
      // Over the day's budget: the rest of the night's events go unchronicled (nothing is lost; code recorded them).
      if (err instanceof CallDropped) break;
      continue;
    }
    for (const call of calls.slice(0, 3)) {
      if (result.accepted.length >= config.directorMaxPerNight) break;
      const entry = (ok: boolean, reason: string): DirectorLogEntry => ({ day, kind: call.name as DirectorLogEntry["kind"], ok, reason, proposal: JSON.stringify(call.arguments), event: event.id });
      const decide = (ok: boolean, reason: string) => {
        const e = entry(ok, reason);
        logDecision(world, e, ctx.sink);
        (ok ? result.accepted : result.rejected).push(e);
      };
      if (call.name === "add_lore" || call.name === "add_news") {
        const v = validateLore(vctx, call.arguments, call.name === "add_lore" ? "lore" : "news");
        if (!v.ok) {
          decide(false, v.reason);
          continue;
        }
        addLore(world, { id: v.value.id, kind: call.name === "add_news" ? "news" : "history", name: v.value.name, aliases: [], keywords: v.value.keywords, text: v.value.text, ...(call.name === "add_news" ? { event: true } : {}) });
        // Witnesses know for certain; everyone else has only heard.
        const knew = new Set(event.knownBy ?? event.witnesses ?? []);
        for (const [id] of living) learnLore(states[id]!, v.value.id, knew.has(id) ? "certain" : "rumour");
        if (call.name === "add_news") pushNews(world, v.value.id);
        decide(true, "accepted");
        result.log.push(call.name === "add_news" ? `News: ${v.value.text}` : `The village will remember: ${v.value.text}`);
      } else if (call.name === "propose_quest") {
        const v = validateQuest(vctx, call.arguments, event);
        if (!v.ok) {
          decide(false, v.reason);
          continue;
        }
        const s = states[v.value.giver]!;
        s.questBoard.push(v.value.quest);
        if (v.value.quest.objective.type === "defeat") {
          const rule: SpawnRule = { id: `dq_${v.value.quest.id}`, creature: v.value.quest.objective.creature, count: v.value.quest.objective.qty, quest: v.value.quest.id };
          (world.extraSpawnRules ??= []).push(rule);
        }
        decide(true, "accepted");
        result.log.push(`${personas[v.value.giver]!.name} has work: "${v.value.quest.title}" (${describeObjective(v.value.quest)}, ${formatMoney(v.value.quest.reward.money)}).`);
      } else if (call.name === "propose_trait_shift") {
        const v = validateTraitShift(vctx, call.arguments, event);
        if (!v.ok) {
          decide(false, v.reason);
          continue;
        }
        const moved = driftTrait(personas[v.value.npc]!, states[v.value.npc]!, v.value.trait, v.value.delta, v.value.reason, world.day, event.id);
        if (moved === 0) {
          decide(false, "a cap stopped it (per event, per week or lifetime)");
          continue;
        }
        decide(true, `accepted: ${v.value.trait} ${moved > 0 ? "+" : ""}${moved}`);
      } else decide(false, `unknown tool "${call.name}"`);
    }
  }
  return result;
}
