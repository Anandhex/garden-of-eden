import { CLASS_RANK, type SocialClass } from "@garden-of-eden/shared";
import type { PersonRow } from "../../store/peopleStore.js";
import { moodOf } from "../people/outlook.js";
import { traitsOfRow } from "../people/traits.js";
import { unit } from "../gossip/venues.js";

/**
 * The few things about a person that decide how they behave in an exchange (N37). A townsperson's row keeps ambition, loyalty, greed and
 * bravery; the rest of a temperament (temper, pride, forgiveness, honesty) is worked out from their id and class, the same every time, so
 * it needs no more columns and a place worked out years later gives the same people the same tempers.
 */
export interface Temper {
  rank: number;
  /** 0..1 */
  temper: number;
  pride: number;
  forgiveness: number;
  honesty: number;
  bravery: number;
  greed: number;
  /** -3 (miserable) to 3 (content): from their last review. */
  mood: number;
}

export const rankOf = (row: Pick<PersonRow, "cls">): number => CLASS_RANK[row.cls as SocialClass] ?? 2;

/** The parts of a temper that come from the id alone, hashed once per person (the same numbers every time). */
const byId = new Map<string, { pride: number; temper: number; forgive: number; honest: number }>();
function idTemper(id: string) {
  let h = byId.get(id);
  if (!h) {
    if (byId.size > 100_000) byId.clear();
    byId.set(id, (h = { pride: unit(`${id}:pride`), temper: unit(`${id}:temper`), forgive: unit(`${id}:forgive`), honest: unit(`${id}:honest`) }));
  }
  return h;
}

export function temperOf(row: Pick<PersonRow, "id" | "cls" | "traits" | "outlook">): Temper {
  const rank = rankOf(row);
  const t = traitsOfRow(row);
  const h = idTemper(row.id);
  // Station breeds pride: a noble is proud before they are anything else.
  const pride = Math.min(1, 0.55 * h.pride + 0.07 * rank);
  return {
    rank,
    temper: h.temper,
    pride,
    forgiveness: h.forgive,
    honesty: h.honest,
    bravery: t.bravery,
    greed: t.greed,
    mood: moodOf(row),
  };
}

/** Is a mood sour enough to make a person quarrelsome? */
export const angry = (t: Pick<Temper, "mood">): boolean => t.mood <= -1.5;
