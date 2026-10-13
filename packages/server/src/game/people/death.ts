import { z } from "zod";

/**
 * One typed death record for everyone (N25): a townsperson's row, a realm figure and a talking NPC's
 * registry entry all say how, when and where, in the same words.
 *
 * `missing` is a state, not a death: a person can be missing and turn up later (N55's war missing). It
 * takes them out of every roster (they are not stepped, not counted among the living) and no more.
 */
export const DEATH_CAUSES = ["old-age", "illness", "famine", "battle", "siege", "raid", "execution", "murder", "beast", "accident", "childbirth", "missing"] as const;
export type DeathCause = (typeof DEATH_CAUSES)[number];

export interface DeathRecord {
  cause: DeathCause;
  day: number;
  hour?: number;
  /** The place they died in (a settlement id), or null out in the wild. */
  site: string | null;
  /** The event it belongs to: a realm ref ("raid:34:ashby") or an event id. */
  event?: string;
  /** Who did it (a person ref: a persona id, a figure id or a townsperson id). */
  killer?: string;
  /** Any words the cause doesn't say ("killed in the raid on Ashby", "old age"). */
  note?: string;
}

export const DeathRecordSchema = z.object({
  cause: z.enum(DEATH_CAUSES),
  day: z.number().int(),
  hour: z.number().int().min(0).max(23).optional(),
  site: z.string().nullable(),
  event: z.string().optional(),
  killer: z.string().optional(),
  note: z.string().optional(),
});

/** The record in a `people.death` cell, or null for none (a cell that isn't one is read as none). */
export function parseDeath(cell: string | null | undefined): DeathRecord | null {
  if (!cell) return null;
  try {
    const r = DeathRecordSchema.safeParse(JSON.parse(cell));
    return r.success ? (r.data as DeathRecord) : null;
  } catch {
    return null;
  }
}

/** Dead, not just missing. */
export const isDead = (rec: DeathRecord | null): boolean => rec !== null && rec.cause !== "missing";

/** "of old age", "of hunger", "in childbirth": for news and the admin card. */
export function deathWords(rec: Pick<DeathRecord, "cause" | "note">): string {
  switch (rec.cause) {
    case "old-age":
      return "of old age";
    case "illness":
      return "of an illness";
    case "famine":
      return "of hunger";
    case "battle":
      return "in battle";
    case "siege":
      return "in a siege";
    case "raid":
      return "in a raid";
    case "execution":
      return "on the gallows";
    case "murder":
      return "by another's hand";
    case "beast":
      return "to a beast";
    case "accident":
      return "in an accident";
    case "childbirth":
      return "in childbirth";
    case "missing":
      return "and has not been seen since";
  }
}

/** The cause of a death described in the old free-text words ("old age", "killed in the raid on Ashby", "lost in the Deeps"). */
export function causeFromWords(words: string): DeathCause {
  const w = words.toLowerCase();
  if (/old age|natural/.test(w)) return "old-age";
  if (/hunger|starv|famine/.test(w)) return "famine";
  if (/siege/.test(w)) return "siege";
  if (/raid/.test(w)) return "raid";
  if (/battle|war|fight|defence|defense/.test(w)) return "battle";
  if (/wolf|bear|boar|spider|beast|pack|horror|things/.test(w)) return "beast";
  if (/execut|hang/.test(w)) return "execution";
  if (/childbirth|birth/.test(w)) return "childbirth";
  if (/killed by|slain|murder/.test(w)) return "murder";
  if (/illness|plague|sick|fever/.test(w)) return "illness";
  return "accident";
}
