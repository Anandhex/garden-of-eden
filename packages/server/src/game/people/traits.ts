import { hashStr, seeded } from "@millbrook/shared";
import { CLASS_RANK } from "@millbrook/shared";
import type { PersonRow } from "../../store/peopleStore.js";
import { ITEM_TIERS } from "../items.js";
import { parseRowTraits, type RowTraits } from "./rules.js";

/**
 * The traits of a townsperson (N25). A row keeps them as a small JSON once they matter (a child is born
 * with the blend of their parents'); the first people of a place have none stored, and get theirs worked
 * out from their id and class, the same every time, until they pass them on.
 */
export function traitsOfRow(row: Pick<PersonRow, "id" | "cls" | "traits">): RowTraits {
  const stored = parseRowTraits(row.traits);
  if (stored) return stored;
  const rng = seeded(hashStr(`${row.id}:traits`));
  const unit = () => Math.round(rng() * 100) / 100;
  const rank = CLASS_RANK[row.cls as keyof typeof CLASS_RANK] ?? 2;
  // Station gives a head start; luck gives the rest: most are ordinary, a few have it in them.
  const base = rank >= 6 ? 2 : rank >= 4 ? 1 : 0;
  const luck = rng();
  const bump = luck > 0.97 ? 3 : luck > 0.88 ? 2 : luck > 0.7 ? 1 : 0;
  return { ambition: unit(), loyalty: unit(), greed: unit(), bravery: unit(), potential: ITEM_TIERS[Math.min(ITEM_TIERS.length - 1, base + bump)]! };
}
