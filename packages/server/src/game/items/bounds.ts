import type { WorldStore } from "../db.js";
import type { Realm } from "../realm/types.js";

/**
 * N43's balance bounds: notable items stay few for the people there are (most items are plain stacks), and named ones are rarer still.
 */
export function checkItemBounds(realm: Realm, store: Pick<WorldStore, "notables" | "people">): Array<{ name: string; ok: boolean; detail: string }> {
  const all = store.notables.list();
  const people = Math.max(1, store.people.count());
  const named = all.filter((r) => r.name).length;
  const perK = (all.length * 1000) / people;
  return [
    { name: "notables-bounded", ok: perK <= 20, detail: `${all.length} notable items for ${people} people (${perK.toFixed(1)} per thousand)` },
    { name: "named-rare", ok: all.length < 10 || named <= all.length * 0.3, detail: `${named} of ${all.length} have names` },
  ];
}
