import type { JournalEntry, PlayerState } from "../npc/types.js";

/**
 * The player's journal (N5.7): what the player has learned, kept for them. Filled
 * in by code from events (a secret revealed, a love discovered, a promise made, a
 * name learned, a quest taken), never from the model's words. Each note is added
 * once, by id; a later note with the same id updates it (a lie found out, a
 * promise kept).
 */
export const JOURNAL_KINDS = ["secret", "love", "fear", "promise", "name", "quest", "lie", "favour", "rumour", "family"] as const;
export type JournalKind = (typeof JOURNAL_KINDS)[number];

/** Add a note, or update the one with the same id. Returns true if it's new. */
export function note(player: PlayerState, entry: { id: string; day: number; text: string; npc?: string; kind: JournalKind }): boolean {
  const journal = (player.journal ??= []);
  const existing = journal.find((e) => e.id === entry.id);
  if (existing) {
    if (existing.text === entry.text) return false;
    existing.text = entry.text;
    existing.day = entry.day;
    return false;
  }
  journal.push(entry);
  return true;
}

/** Notes about one NPC (by persona id), or all of them. */
export function journalFor(player: PlayerState, npc?: string): JournalEntry[] {
  return (player.journal ?? []).filter((e) => !npc || e.npc === npc);
}

/** Notes grouped by NPC, for /journal: "Mara Ashford" → lines. Notes about no one go under "General". */
export function journalByNpc(player: PlayerState, names: Record<string, string>, npc?: string): Array<{ who: string; lines: string[] }> {
  const groups = new Map<string, string[]>();
  for (const e of journalFor(player, npc)) {
    const who = e.npc ? (names[e.npc] ?? e.npc) : "General";
    groups.set(who, [...(groups.get(who) ?? []), `Day ${e.day}: ${e.text}`]);
  }
  return [...groups.entries()].map(([who, lines]) => ({ who, lines }));
}
