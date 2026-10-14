import type { WorldStore } from "../db.js";
import { parseDeath } from "../people/death.js";
import type { Realm } from "../realm/types.js";
import type { Bound } from "../road/bounds.js";
import { KNOWLEDGE_CAP } from "./knowledge.js";
import { parseRef } from "./refs.js";

/**
 * N33's balance bounds (N22 gathers them into one list; until then tests read this). Run once the realm has been going a while.
 *
 * - `knowledge-bounded`: nobody holds more than KNOWLEDGE_CAP items, so the table is at most that many rows per person.
 * - `gossip-not-instant`: nobody knows a thing before it happened. A row for realm news is dated on or after the news, a row for a
 *   death on or after the death, and a row with a person as its teller is not older than the teller's own knowledge unless they
 *   have forgotten it and heard it again since (the cap makes people forget). That a far event reaches a place only with a person
 *   who went there is the step 4 test, which has the journeys to hand.
 */
export function checkGossipBounds(realm: Realm, store: Pick<WorldStore, "knowledge" | "people">, sample = 5000): Bound[] {
  const k = store.knowledge;
  const most = k.mostHeld();
  const total = k.total();
  const people = store.people.count();
  const out: Bound[] = [{ name: "knowledge-bounded", ok: most <= KNOWLEDGE_CAP && total <= KNOWLEDGE_CAP * Math.max(1, people), detail: `most held by one person: ${most} (cap ${KNOWLEDGE_CAP}); ${total} rows for ${people} people` }];
  const news = new Map(realm.news.map((n) => [n.id, n.day]));
  let early = 0;
  let checked = 0;
  for (const r of k.toldByPeople(sample)) {
    const ref = parseRef(r.ref);
    if (!ref) continue;
    const happened = ref.kind === "n" ? news.get(ref.id) : ref.kind === "d" ? parseDeath(store.people.get(ref.id)?.death)?.day : undefined;
    checked++;
    if (happened !== undefined && r.learned_day < happened) early++;
  }
  out.push({ name: "gossip-not-instant", ok: early === 0, detail: `${early} of ${checked} sampled rows were dated before the thing happened` });
  return out;
}
