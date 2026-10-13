import type { PersonRow } from "../../store/peopleStore.js";
import { speciesOf } from "../../world/species.js";
import { streamFor } from "../dice.js";
import type { CasualtyOrder } from "../realm/types.js";
import { ageFrom } from "./rules.js";

/**
 * Who a fight kills (N25), among the people of the place it fell on. The fight rolled how many; here code
 * picks who, weighted by the cause, with a stream of the event's own so the same event on the same people
 * picks the same dead, whenever it is worked out:
 *
 * - **raid, battle, siege:** the fighters first (guards, knights, adventurers, the hunters), then grown men,
 *   far fewer women, children and the old.
 * - **beast:** whoever works out in the fields and woods: farmers, hunters, miners, labourers.
 */
const FIGHTING_JOBS = new Set(["guard", "knight", "adventurer", "hunter", "noble"]);
const OUTDOOR_JOBS = new Set(["farmer", "hunter", "miner", "labourer", "porter", "carter"]);

function weight(r: PersonRow, cause: CasualtyOrder["cause"], day: number): number {
  const age = ageFrom(r.born_day, day);
  const sp = speciesOf(r.species);
  const grown = age >= sp.adultAge;
  const old = age >= sp.elderAge;
  if (cause === "beast") {
    if (!grown) return 0.1;
    return OUTDOOR_JOBS.has(r.job) ? 5 : 0.4;
  }
  if (FIGHTING_JOBS.has(r.job) && grown && !old) return 8;
  if (!grown) return 0.1;
  if (old) return 0.2;
  return r.gender === "male" ? 1.5 : 0.3;
}

/**
 * Pick `order.count` of `rows` to die (all of them, if the place has fewer), by weighted sampling without
 * replacement: each person gets the key u^(1/w) and the highest keys die. Returns ids, in the order they fell.
 */
export function pickCasualties(seed: number, rows: PersonRow[], order: Pick<CasualtyOrder, "cause" | "count" | "event">, day: number): string[] {
  const rng = streamFor(seed, "casualty", order.event, day);
  const keyed: Array<{ id: string; key: number }> = [];
  for (const r of rows) {
    const w = weight(r, order.cause, day);
    if (w <= 0) continue;
    keyed.push({ id: r.id, key: rng() ** (1 / w) });
  }
  keyed.sort((a, b) => b.key - a.key || (a.id < b.id ? -1 : 1));
  return keyed.slice(0, order.count).map((k) => k.id);
}
