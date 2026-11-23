/**
 * Cause links (N20 step 1). Every event may say what led to it: explicitly (`causedBy` on the event), or by scope, `withCause(ref, fn)`,
 * so that everything recorded inside inherits the cause without threading it through ten functions (a raid's deaths, loot and flight).
 *
 * The simulation is synchronous, so a module-level stack is safe; a scope is never held across an `await` (model calls): `assertNoCause`
 * at the start of every async entry point catches a leak.
 *
 * Refs: a game event's own id (`e…`, `l…`), or a prefixed ref (`n:<realm news id>`, `dr:<drama nudge>`, `e:<event>` from a grievance). A cause newer
 * than the event it causes (a later day) is refused (a cycle from bad wiring), as is an event its own cause; at most `MAX_CAUSES` are kept.
 */

export const MAX_CAUSES = 3;

const stack: string[][] = [];
let refused = 0;

/** Run `fn` with `refs` as the cause of everything recorded inside it. Always pops, even on a throw. */
export function withCause<T>(refs: string | readonly string[] | null | undefined, fn: () => T): T {
  const list = (typeof refs === "string" ? [refs] : [...(refs ?? [])]).filter((x) => !!x);
  stack.push(list);
  try {
    return fn();
  } finally {
    stack.pop();
  }
}

/** The causes in scope now, innermost first, without repeats. */
export function currentCauses(): string[] {
  const out: string[] = [];
  for (let i = stack.length - 1; i >= 0; i--) for (const r of stack[i]!) if (!out.includes(r)) out.push(r);
  return out;
}

/** Throws when a cause scope is open: call at the start of async work (a request, a model job), where none may be. */
export function assertNoCause(where: string): void {
  if (stack.length > 0) throw new Error(`a cause scope leaked into ${where}`);
}

/**
 * The day something with this ref happened, if the ref says (`l<day>-<hour>-…`, `e<day>-<hour>-…`). By the day, not the hour: a
 * townsfolk event's hour is drawn from a stream of its own (people/events.ts), so a goal formed the evening of an insult may carry an
 * earlier hour than the insult did.
 */
export function whenOf(ref: string): number | null {
  const m = /^(?:[a-z]:)?[a-z](\d+)-(\d+)-/.exec(ref);
  return m ? Number(m[1]) : null;
}

/** How many causes were refused (newer than their effect, or the event itself) since the process started: a wiring check. */
export const refusedCauses = (): number => refused;

/**
 * The causes an event keeps: its own explicit ones, then the scope's; never itself, never one newer than it; at most MAX_CAUSES,
 * explicit ones first. Undefined when it has none.
 */
export function causesFor(id: string, explicit: readonly string[] | undefined): string[] | undefined {
  const at = whenOf(id);
  const out: string[] = [];
  for (const c of [...(explicit ?? []), ...currentCauses()]) {
    if (!c || out.includes(c)) continue;
    const t = whenOf(c);
    if (c === id || (at !== null && t !== null && t > at)) {
      refused++;
      continue;
    }
    out.push(c);
    if (out.length >= MAX_CAUSES) break;
  }
  return out.length > 0 ? out : undefined;
}
