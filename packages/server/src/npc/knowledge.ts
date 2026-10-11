import { readFileSync } from "node:fs";
import { z } from "zod";
import type { NpcPersona } from "./types.js";

/**
 * World lore: one source of truth for places, people, history and news
 * (src/data/world.json). NPCs only know what their `knows` scopes cover, and
 * code picks the few entries a player line is about. Nothing outside an NPC's
 * scope ever reaches its prompt, so it can't leak what it shouldn't know; and
 * names that aren't in the lore are flagged (unknownNames) so an invented
 * mayor's wife shows up in tests and benchmarks.
 *
 * Ids are dotted paths: "people.mayor.household" is part of "people.mayor".
 * A scope is an exact id, "x.*" (x and everything under it) or "*" (everything).
 */

export const CERTAINTY = ["certain", "rumour"] as const;
export type Certainty = (typeof CERTAINTY)[number];

/** Lore lines added to one turn at most (design rule 3). */
export const MAX_LORE_LINES = 3;

export const LoreEntrySchema = z
  .object({
    id: z.string().regex(/^[a-z0-9_]+(\.[a-z0-9_]+)*$/, "lower-case words joined by dots"),
    kind: z.enum(["place", "person", "history", "news"]),
    /** How NPCs name it: "the Gilded Goose". */
    name: z.string().min(1),
    /** Other proper names it goes by. Count as known names, and as keywords. */
    aliases: z.array(z.string().min(1)).default([]),
    /** Lower-case words or phrases that bring it up. A child entry also comes up on its parent's keywords. */
    keywords: z.array(z.string().min(1)).default([]),
    text: z.string().min(1),
    /** A person entry played by a talking NPC (their persona id). */
    npc: z.string().optional(),
    /** For a person: what they know more about, for "who would know" hints. */
    knowsMore: z.string().optional(),
    /** For a person: hears about everything, so the one to send people to about anything unknown. */
    hearsRumours: z.boolean().optional(),
    /**
     * Something that happens during play (a raid, an attack). NPCs only hear of it once the
     * game puts its id in world.recentEvents; it never comes up from a keyword lookup.
     */
    event: z.boolean().optional(),
    /** Lore id of a person who knows more about this, for NPCs who don't. Children inherit it. */
    ask: z.string().optional(),
  })
  .strict();
export type LoreEntry = z.infer<typeof LoreEntrySchema>;

export const LoreSchema = z
  .object({ lore: z.array(LoreEntrySchema) })
  .strict()
  .superRefine((w, ctx) => {
    const ids = new Set<string>();
    w.lore.forEach((e, i) => {
      if (ids.has(e.id)) ctx.addIssue({ code: "custom", path: ["lore", i, "id"], message: `duplicate id "${e.id}"` });
      ids.add(e.id);
    });
    w.lore.forEach((e, i) => {
      const parent = e.id.split(".").slice(0, -1).join(".");
      // A top-level word can be a bare namespace ("people", "news"); deeper parents must exist.
      if (parent.includes(".") && !ids.has(parent)) ctx.addIssue({ code: "custom", path: ["lore", i, "id"], message: `no parent entry "${parent}"` });
      if (e.ask && !w.lore.some((p) => p.id === e.ask && p.kind === "person")) {
        ctx.addIssue({ code: "custom", path: ["lore", i, "ask"], message: `"${e.ask}" is not a person in the lore` });
      }
    });
  });

export interface Lore {
  entries: LoreEntry[];
  byId: Map<string, LoreEntry>;
}

export function parseLore(raw: unknown, source = "world file"): Lore {
  const result = LoreSchema.safeParse(raw);
  if (!result.success) {
    const problems = result.error.issues.map((i) => `  ${i.path.join(".") || "(root)"}: ${i.message}`).join("\n");
    throw new Error(`${source} is invalid:\n${problems}`);
  }
  return { entries: result.data.lore, byId: new Map(result.data.lore.map((e) => [e.id, e])) };
}

let base: Lore | undefined;
let cached: Lore | undefined;
/** Lore that grew during play (director/chronicle.ts, deaths), kept in the world save. */
let dynamic: LoreEntry[] = [];

/** The world's lore: src/data/world.json (loaded once), plus whatever grew during play. */
export function worldLore(): Lore {
  base ??= parseLore(JSON.parse(readFileSync(new URL("../data/world.json", import.meta.url), "utf8")), "src/data/world.json");
  if (!cached) {
    const extra = dynamic.filter((e) => !base!.byId.has(e.id));
    const entries = [...base.entries, ...extra];
    cached = { entries, byId: new Map(entries.map((e) => [e.id, e])) };
  }
  return cached;
}

/**
 * Use this world's grown lore (world.lore) on top of world.json. Call on load and
 * whenever an entry is added. Entries that clash with the file's ids are ignored.
 */
export function setDynamicLore(entries: LoreEntry[] | undefined): void {
  dynamic = [...(entries ?? [])];
  cached = undefined;
}

/** Add one entry to a world's grown lore (and the running lore). Returns false if the id is taken. */
export function addLore(world: { lore?: LoreEntry[] }, entry: LoreEntry): boolean {
  if (worldLore().byId.has(entry.id)) return false;
  (world.lore ??= []).push(entry);
  setDynamicLore(world.lore);
  return true;
}

/** What an NPC knows: their file's scopes, plus what they learned in play (state.learned). */
export function knowsOf(persona: Pick<NpcPersona, "knows">, state?: { learned?: Record<string, Certainty> }): Record<string, Certainty> {
  return state?.learned ? { ...persona.knows, ...state.learned } : persona.knows;
}

/** An NPC learns a lore entry in play (told by the player or another NPC, or saw it happen). Certain beats rumour. */
export function learnLore(state: { learned: Record<string, Certainty> }, id: string, certainty: Certainty): boolean {
  const had = state.learned[id];
  if (had === "certain" || had === certainty) return false;
  state.learned[id] = certainty;
  return true;
}

/** Does a scope pattern cover a lore id? "x.*" covers x and everything under it. */
export function scopeCovers(pattern: string, id: string): boolean {
  if (pattern === "*") return true;
  if (pattern.endsWith(".*")) {
    const base = pattern.slice(0, -2);
    return id === base || id.startsWith(`${base}.`);
  }
  return pattern === id;
}

/** How specific a pattern is: an exact id beats any wildcard, and a longer wildcard beats a shorter one. */
function specificity(pattern: string): number {
  if (pattern === "*") return 0;
  if (pattern.endsWith(".*")) return pattern.length;
  return 10_000 + pattern.length;
}

/** How sure this NPC is of an entry, or null if it's outside what they know. The most specific scope wins. */
export function certaintyOf(persona: Pick<NpcPersona, "knows">, id: string): Certainty | null {
  let best: { at: number; certainty: Certainty } | null = null;
  for (const [pattern, certainty] of Object.entries(persona.knows)) {
    if (!scopeCovers(pattern, id)) continue;
    const at = specificity(pattern);
    if (!best || at > best.at) best = { at, certainty };
  }
  return best?.certainty ?? null;
}

/** Every entry this NPC knows, in file order. */
export function knownLore(persona: Pick<NpcPersona, "knows">, lore: Lore = worldLore()): LoreEntry[] {
  return lore.entries.filter((e) => certaintyOf(persona, e.id) !== null);
}

/** Scope patterns that match no lore entry: a typo in an NPC file. */
export function badScopes(knows: Record<string, Certainty>, lore: Lore = worldLore()): string[] {
  return Object.keys(knows).filter((pattern) => !lore.entries.some((e) => scopeCovers(pattern, e.id)));
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const mentions = (line: string, word: string) => new RegExp(`\\b${escape(word.toLowerCase())}\\b`).test(line);

function ownWords(e: LoreEntry): string[] {
  return [...e.keywords, ...e.aliases, e.name.replace(/^the /i, "")];
}

function ancestors(e: LoreEntry, lore: Lore): LoreEntry[] {
  const parts = e.id.split(".");
  const out: LoreEntry[] = [];
  for (let i = parts.length - 1; i > 0; i--) {
    const parent = lore.byId.get(parts.slice(0, i).join("."));
    if (parent) out.push(parent);
  }
  return out;
}

/** How strongly a player line is about an entry: its own words count double, its parents' once. */
function relevance(e: LoreEntry, line: string, lore: Lore): number {
  const own = ownWords(e).filter((w) => mentions(line, w)).length;
  const inherited = ancestors(e, lore).flatMap(ownWords).filter((w) => mentions(line, w)).length;
  return own * 2 + inherited;
}

/** Does the line ask for news or gossip in general? */
export function isNewsTalk(line: string): boolean {
  return /\b(news|rumou?rs?|gossip|heard anything|anything interesting|going on|happening|what's new)\b/i.test(line);
}

export interface LoreLookup {
  /** Entries the NPC knows that the line is about, most relevant first. */
  known: Array<{ entry: LoreEntry; certainty: Certainty }>;
  /** Entries the line is about that the NPC doesn't know. */
  unknown: LoreEntry[];
}

/**
 * The lore a player line is about, split into what this NPC knows and doesn't,
 * at most `max` entries in all. A general news question brings up the news
 * they know. Entries in `skip` (e.g. today's events, already shown) are left out.
 */
export function lookupLore(
  persona: Pick<NpcPersona, "knows">,
  line: string,
  lore: Lore = worldLore(),
  skip: ReadonlySet<string> = new Set(),
  max = MAX_LORE_LINES,
): LoreLookup {
  const lower = line.toLowerCase();
  const scored = lore.entries
    .filter((e) => !e.event && !skip.has(e.id))
    .map((e) => ({ e, score: relevance(e, lower, lore) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  if (isNewsTalk(line)) {
    for (const e of lore.entries) {
      if (e.kind === "news" && !e.event && !skip.has(e.id) && !scored.some((x) => x.e === e) && certaintyOf(persona, e.id)) scored.push({ e, score: 0 });
    }
  }
  const known: LoreLookup["known"] = [];
  const unknown: LoreEntry[] = [];
  for (const { e, score } of scored.slice(0, max)) {
    const certainty = certaintyOf(persona, e.id);
    if (certainty) known.push({ entry: e, certainty });
    // Only admit not knowing what the player named (its own words, score 2+): "you know nothing
    // about Tomas seen in the city" on a plain question about Tomas would leak that there's news.
    else if (score >= 2 && !unknown.some((u) => scopeCovers(`${u.id}.*`, e.id))) unknown.push(e);
  }
  return { known, unknown };
}

/** The person to point the player to about an entry (its own `ask`, or a parent's), if this NPC knows them and isn't them. */
function whoToAsk(persona: Pick<NpcPersona, "id" | "knows">, e: LoreEntry, lore: Lore): LoreEntry | null {
  for (const at of [e, ...ancestors(e, lore)]) {
    if (!at.ask) continue;
    const person = lore.byId.get(at.ask);
    if (person && person.npc !== persona.id && certaintyOf(persona, person.id)) return person;
  }
  return null;
}

/** Situation lines for a lookup: what they know (and how sure), and what they must admit they don't. */
export function describeLookup(persona: Pick<NpcPersona, "id" | "knows">, found: LoreLookup, lore: Lore = worldLore()): string[] {
  const lines = found.known.map(({ entry, certainty }) =>
    certainty === "certain" ? `You know: ${entry.text}` : `You've heard a rumour (you're not sure it's true): ${entry.text}`,
  );
  for (const e of found.unknown) {
    const ask = whoToAsk(persona, e, lore);
    lines.push(`You know nothing about ${e.name}. Say so; don't make anything up.${ask ? ` ${ask.name} might know.` : ""}`);
  }
  return lines;
}

/** For the system prompt: the names of the places and people this NPC knows of. Stays the same every turn. */
export function knownNames(persona: Pick<NpcPersona, "knows">, lore: Lore = worldLore()): string[] {
  return knownLore(persona, lore)
    .filter((e) => e.kind === "place" || e.kind === "person")
    .filter((e) => e.id.split(".").length <= 2 || e.aliases.length > 0)
    .map((e) => e.name);
}

/** For the system prompt: "Old Pell (every rumour in the village)" for each knowledgeable person they know, except themselves. */
export function whoKnowsMore(persona: Pick<NpcPersona, "id" | "knows">, lore: Lore = worldLore()): string[] {
  return knownLore(persona, lore)
    .filter((e) => e.kind === "person" && e.knowsMore && e.npc !== persona.id)
    .map((e) => `${e.name} (${e.knowsMore})`);
}

/** The person this NPC sends people to about anything they've never heard of: someone they know who hears every rumour. */
export function rumourMonger(persona: Pick<NpcPersona, "id" | "knows">, lore: Lore = worldLore()): LoreEntry | null {
  return knownLore(persona, lore).find((e) => e.kind === "person" && e.hearsRumours && e.npc !== persona.id) ?? null;
}

/** Today's events, as text. Ids not in the lore are dropped: NPCs only hear of events the game injected. */
export function eventTexts(ids: readonly string[], lore: Lore = worldLore()): string[] {
  return ids.map((id) => lore.byId.get(id)?.text).filter((t): t is string => t !== undefined);
}

/** Map saved event text from before event ids to its lore id. Unknown text is dropped. */
export function eventIdFor(textOrId: string, lore: Lore = worldLore()): string | null {
  if (lore.byId.has(textOrId)) return textOrId;
  return lore.entries.find((e) => e.text === textOrId)?.id ?? null;
}

// ---- The invented-name check ----

/** Capitalised words that aren't names. */
const COMMON = new Set(
  (
    "I I'm I'll I've I'd A An The This That These Those It It's Its He She We They You Your Yours My Mine Our Their His Her Him Me Us " +
    "Aye Nay Yes No Oh Ah Eh Hm Hmm Well Now Then So But And Or If When Why What Who Whom Whose Where How Here There Not Never " +
    "Mister Sir Madam Lady Lord Friend Stranger Citizen Traveler Traveller Gods God Gold Silver Copper " +
    "Monday Tuesday Wednesday Thursday Friday Saturday Sunday Day Night Morning Evening"
  ).split(" "),
);

/** Every proper name the world knows of: lore names and aliases, NPC names, and any extra (the player's name, creature names). */
export function knownNameWords(personas: Array<Pick<NpcPersona, "name">>, extra: string[] = [], lore: Lore = worldLore()): Set<string> {
  const names = [...lore.entries.flatMap((e) => [e.name, ...e.aliases]), ...personas.map((p) => p.name), ...extra];
  const words = new Set<string>();
  for (const n of names) for (const w of n.split(/[\s'-]+/)) if (/^[A-Z]/.test(w)) words.add(w);
  return words;
}

/**
 * Capitalised words in `text` that aren't known names: likely an invented person
 * or place. Words that open a sentence are skipped: they're capitalised anyway
 * ("Ask Old Pell"), so a name there slips through. A heuristic for
 * tests and benchmarks (T15), not a filter on what NPCs say.
 */
export function unknownNames(text: string, known: Set<string>): string[] {
  const found: string[] = [];
  const tokens = text.replace(/[*_"“”]/g, " ").split(/[\s—–]+/).filter(Boolean);
  let sentenceStart = true;
  tokens.forEach((raw) => {
    const word = raw.replace(/^[^A-Za-z]+|[^A-Za-z'’]+$/g, "").replace(/['’]s$/, "");
    const opens = sentenceStart;
    sentenceStart = /[.!?:]["')]*$/.test(raw);
    if (!/^[A-Z][a-z]/.test(word) || COMMON.has(word) || known.has(word)) return;
    if (opens) return;
    if (!found.includes(word)) found.push(word);
  });
  return found;
}
