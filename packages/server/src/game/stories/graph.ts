import type { WorldStore } from "../db.js";

/**
 * Walking the cause graph (N20 step 2). Links live in the store's `event_causes` (one row per cause), so walking either way is an
 * indexed query, and old links never vanish with the save's short event list. Graphs can have diamonds: every walk keeps a visited set.
 * A cause may be a ref that is not an event (`n:` realm news, `e:` a grievance's event ref, `dr:` a drama nudge): it ends a walk back.
 */
type Store = Pick<WorldStore, "causesOf" | "effectsOf">;

/** A cause as an event id (a grievance's `e:<id>` is that event). */
export const asEventId = (ref: string): string => (ref.startsWith("e:") ? ref.slice(2) : ref);

/** Everything behind `ref`, breadth first, up to `maxDepth` steps, nearest first (not `ref` itself). */
export function chainBack(store: Store, ref: string, maxDepth = 8): string[] {
  return walk(ref, maxDepth, (r) => store.causesOf(asEventId(r)).map(asEventId));
}

/** Everything `ref` led to, breadth first, up to `maxDepth` steps, nearest first. */
export function chainForward(store: Store, ref: string, maxDepth = 8): string[] {
  return walk(ref, maxDepth, (r) => [...store.effectsOf(r), ...(r.startsWith("e:") ? [] : store.effectsOf(`e:${r}`))]);
}

function walk(from: string, maxDepth: number, next: (r: string) => string[]): string[] {
  const seen = new Set([from]);
  const out: string[] = [];
  let level = [from];
  for (let d = 0; d < maxDepth && level.length > 0; d++) {
    const up: string[] = [];
    for (const r of level) for (const n of next(r)) if (!seen.has(n)) {
      seen.add(n);
      out.push(n);
      up.push(n);
    }
    level = up;
  }
  return out;
}

/**
 * The longest path back from `ref` (oldest first, ending at `ref`), up to `maxDepth` steps: the chain a story tells. Ties go to the
 * cause that sorts first, so the same graph always gives the same path.
 */
export function longestBack(store: Store, ref: string, maxDepth = 8): string[] {
  const memo = new Map<string, string[]>();
  const go = (r: string, depth: number, onPath: Set<string>): string[] => {
    if (depth >= maxDepth) return [r];
    const key = `${r}@${depth}`;
    const had = memo.get(key);
    if (had) return had;
    let best: string[] = [];
    for (const c of [...new Set(store.causesOf(asEventId(r)).map(asEventId))].sort()) {
      if (onPath.has(c)) continue;
      onPath.add(c);
      const p = go(c, depth + 1, onPath);
      onPath.delete(c);
      if (p.length > best.length) best = p;
    }
    const out = [...best, r];
    memo.set(key, out);
    return out;
  };
  return go(ref, 0, new Set([ref]));
}
