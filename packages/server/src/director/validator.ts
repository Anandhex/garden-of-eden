import { z } from "zod";
import { knownNameWords, unknownNames, worldLore } from "../npc/knowledge.js";
import { TRAITS } from "../npc/traits.js";
import type { NpcPersona, NpcState, QuestDef, WorldSnapshot } from "../npc/types.js";
import type { GameEvent } from "../game/events.js";
import { ITEMS, itemValue, itemKey } from "../game/items.js";
import { compareTiers, type QuestTier } from "../game/levels.js";
import type { CreatureTemplate } from "../game/creatures.js";
import { TIERS, tierIndex } from "../game/life.js";

/**
 * The director's validator (N12): the director model *proposes*, code *decides*.
 * Every proposal (new lore, news, a quest, a trait shift) is checked here and
 * accepted or rejected with a reason, and every decision is logged. Nothing a
 * proposal says changes state until it passes.
 */
export interface DirectorLogEntry {
  day: number;
  kind: "add_lore" | "add_news" | "propose_quest" | "propose_trait_shift" | "plan" | "flavor" | "summary" | "admin-time";
  ok: boolean;
  reason: string;
  /** The proposal as the model sent it (JSON). */
  proposal: string;
  /** The event it was about. */
  event?: string;
}

/** Most entries kept in the save; the database keeps every one. */
export const DIRECTOR_LOG_KEPT = 50;

export function logDecision(world: { directorLog?: DirectorLogEntry[] }, entry: DirectorLogEntry, sink?: (e: DirectorLogEntry) => void): void {
  const log = (world.directorLog ??= []);
  log.push(entry);
  while (log.length > DIRECTOR_LOG_KEPT) log.shift();
  sink?.(entry);
}

// ---- Schemas the tools take ----

const words = z.string().min(1);
export const AddLoreArgs = z.object({ id: z.string().regex(/^[a-z0-9_]{3,40}$/), name: words.max(60), text: words.max(300), keywords: z.array(words.max(30)).max(6).default([]) });
export const AddNewsArgs = z.object({ id: z.string().regex(/^[a-z0-9_]{3,40}$/), text: words.max(200) });
export const ProposeQuestArgs = z.object({
  giver: words,
  title: words.max(60),
  description: words.max(240),
  why: words.max(160).optional(),
  goal: z.enum(["deliver", "defeat"]),
  item: z.string().optional(),
  creature: z.string().optional(),
  qty: z.number().int().min(1).max(10),
});
export const ProposeTraitShiftArgs = z.object({ npc: words, trait: z.enum(TRAITS), direction: z.enum(["up", "down"]), reason: words.max(160) });

export type Verdict<T> = { ok: true; value: T; reason: string } | { ok: false; reason: string };
const reject = (reason: string): { ok: false; reason: string } => ({ ok: false, reason });

/** Words for comparing texts: lower-case, no little words. */
function tokens(text: string): Set<string> {
  return new Set(text.toLowerCase().split(/[^a-z']+/).filter((w) => w.length > 3));
}

/** Share of words two texts have in common (Jaccard). Near-duplicates score high. */
export function similarity(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let both = 0;
  for (const w of ta) if (tb.has(w)) both++;
  return both / (ta.size + tb.size - both);
}

/** Above this similarity a new entry is a near-duplicate of a recent one. */
export const DUPLICATE_SIMILARITY = 0.5;

export interface ValidatorContext {
  world: WorldSnapshot;
  personas: Record<string, NpcPersona>;
  states: Record<string, NpcState>;
  creatures: Record<string, CreatureTemplate>;
  /** Extra known names (the player's, creature names). */
  extraNames: string[];
}

function inventedNames(ctx: ValidatorContext, text: string): string[] {
  return unknownNames(text, knownNameWords(Object.values(ctx.personas), ctx.extraNames));
}

function nearDuplicate(ctx: ValidatorContext, text: string): string | null {
  const recent = [...(ctx.world.lore ?? []).slice(-30), ...worldLore().entries.filter((e) => e.kind === "news")];
  const hit = recent.find((e) => similarity(e.text, text) >= DUPLICATE_SIMILARITY);
  return hit ? hit.id : null;
}

/** A new lore or news entry: new id, only known names, not a near-duplicate. */
export function validateLore(ctx: ValidatorContext, raw: unknown, kind: "lore" | "news"): Verdict<{ id: string; name: string; text: string; keywords: string[] }> {
  // The id's form is code's business: "Raid at the Goose!" becomes raid_at_the_goose.
  if (raw && typeof raw === "object" && typeof (raw as { id?: unknown }).id === "string") {
    const id = (raw as { id: string }).id.toLowerCase().replace(/^(news|chronicle)\./, "").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);
    raw = { ...(raw as object), id };
  }
  const parsed = kind === "lore" ? AddLoreArgs.safeParse(raw) : AddNewsArgs.safeParse(raw);
  if (!parsed.success) return reject(`bad arguments: ${z.prettifyError(parsed.error)}`);
  const a = parsed.data as { id: string; text: string; name?: string; keywords?: string[] };
  const id = `${kind === "lore" ? "chronicle" : "news"}.${a.id}`;
  if (worldLore().byId.has(id)) return reject(`id "${id}" is taken`);
  // News has no name of its own: its first words, cut at a word (a cut word would look like a strange name).
  const first = a.text.split(/[.!?]/)[0]!;
  const name = a.name ?? (first.length <= 60 ? first : first.slice(0, first.lastIndexOf(" ", 60)));
  const invented = inventedNames(ctx, `${name}. ${a.text}`);
  if (invented.length > 0) return reject(`names nobody knows: ${invented.join(", ")}`);
  const dup = nearDuplicate(ctx, a.text);
  if (dup) return reject(`too close to "${dup}"`);
  return { ok: true, reason: "accepted", value: { id, name, text: a.text, keywords: (a.keywords ?? []).map((k) => k.toLowerCase()) } };
}

/** The tier of a quest from what it asks: the goods' value, or the quarry's rank and number. */
export function tierOfAsk(goal: "deliver" | "defeat", value: number, creatureRank?: QuestTier, qty = 1): QuestTier {
  if (goal === "defeat") return TIERS[Math.min(TIERS.length - 1, tierIndex(creatureRank ?? "G") + (qty >= 3 ? 1 : 0))]!;
  const bands: Array<[number, QuestTier]> = [[100, "G"], [250, "F"], [500, "E"], [1000, "D"], [2000, "C"], [4000, "B"], [8000, "A"]];
  for (const [limit, tier] of bands) if (value < limit) return tier;
  return "S";
}

/**
 * A director quest: the giver is alive and touched by the event, the goal is one
 * code can check (deliver a known item, defeat a known creature kind), the tier comes
 * from what's asked (capped by what the giver ever offers), and the reward from the
 * giver's own purse.
 */
export function validateQuest(ctx: ValidatorContext, raw: unknown, event: GameEvent): Verdict<{ giver: string; quest: QuestDef }> {
  const parsed = ProposeQuestArgs.safeParse(raw);
  if (!parsed.success) return reject(`bad arguments: ${z.prettifyError(parsed.error)}`);
  const a = parsed.data;
  const giverId = Object.keys(ctx.personas).find((id) => id === a.giver.toLowerCase() || ctx.personas[id]!.name.toLowerCase() === a.giver.toLowerCase() || ctx.personas[id]!.name.toLowerCase().includes(a.giver.toLowerCase()));
  if (!giverId) return reject(`no NPC "${a.giver}"`);
  const giver = ctx.personas[giverId]!;
  const state = ctx.states[giverId]!;
  if (state.outcome === "dead" || state.dormant) return reject(`${giver.name} can't give work`);
  const involved = event.actor === giverId || event.target === giverId || (event.knownBy ?? event.witnesses ?? []).includes(giverId);
  if (!involved) return reject(`${giver.name} wasn't part of it and hasn't heard of it`);
  const invented = inventedNames(ctx, `${a.title}. ${a.description} ${a.why ?? ""}`);
  if (invented.length > 0) return reject(`names nobody knows: ${invented.join(", ")}`);

  let objective: QuestDef["objective"];
  let tier: QuestTier;
  let value: number;
  if (a.goal === "deliver") {
    if (!a.item || !ITEMS[a.item.toLowerCase()]) return reject(`no such item "${a.item}"`);
    const item = a.item.toLowerCase();
    value = (itemValue(itemKey(item)) ?? 0) * a.qty;
    objective = { type: "deliver", item, qty: a.qty };
    tier = tierOfAsk("deliver", value);
  } else {
    const kind = a.creature?.toLowerCase().replace(/s$/, "");
    const t = kind ? ctx.creatures[kind] : undefined;
    if (!t) return reject(`no such creature "${a.creature}"`);
    objective = { type: "defeat", creature: t.id, qty: a.qty };
    tier = tierOfAsk("defeat", 0, t.tier, a.qty);
    value = 60 * (tierIndex(t.tier) + 1) * a.qty;
  }
  if (compareTiers(tier, giver.maxQuestTier) > 0) return reject(`a ${tier}-tier job is beyond what ${giver.name} gives (${giver.maxQuestTier})`);
  if (state.questBoard.some((q) => q.director)) return reject(`${giver.name} already has a director quest up`);
  const money = Math.min(Math.ceil(value * 1.5), Math.floor(state.money / 2));
  if (money <= 0) return reject(`${giver.name} can't pay for it`);
  const id = `dq_${giverId}_${event.day}_${event.id.replace(/[^a-z0-9]/gi, "").slice(-6)}`;
  return {
    ok: true,
    reason: "accepted",
    value: { giver: giverId, quest: { id, title: a.title, description: a.description, tier, minTrust: 0, objective, reward: { money }, director: true } },
  };
}

/** A trait shift: the NPC is real and was in the event; code picks the size (npc/growth.ts caps it). */
export function validateTraitShift(ctx: ValidatorContext, raw: unknown, event: GameEvent): Verdict<{ npc: string; trait: (typeof TRAITS)[number]; delta: number; reason: string }> {
  const parsed = ProposeTraitShiftArgs.safeParse(raw);
  if (!parsed.success) return reject(`bad arguments: ${z.prettifyError(parsed.error)}`);
  const a = parsed.data;
  const id = Object.keys(ctx.personas).find((x) => x === a.npc.toLowerCase() || ctx.personas[x]!.name.toLowerCase().includes(a.npc.toLowerCase()));
  if (!id) return reject(`no NPC "${a.npc}"`);
  if (ctx.states[id]!.outcome === "dead") return reject("the dead don't change");
  const involved = event.actor === id || event.target === id || (event.witnesses ?? []).includes(id);
  if (!involved) return reject(`${ctx.personas[id]!.name} wasn't part of the event`);
  if (event.importance < 5) return reject("not a big enough event to change anyone");
  return { ok: true, reason: "accepted", value: { npc: id, trait: a.trait, delta: a.direction === "up" ? 0.05 : -0.05, reason: a.reason } };
}
