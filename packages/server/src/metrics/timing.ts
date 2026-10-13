import type { AdminTiming } from "@millbrook/shared";

/**
 * Timings (N17): how long the simulation's steps take, kept as a ring buffer of the
 * last durations per name, so the admin view can show them live. Real time, for
 * looking at; nothing in the simulation reads these (design: no wall clock in the sim).
 */

/** Durations kept per name. */
export const KEPT = 200;

const rings = new Map<string, { ms: number[]; next: number; calls: number }>();

/** Record how long something took. */
export function record(name: string, ms: number): void {
  let r = rings.get(name);
  if (!r) rings.set(name, (r = { ms: [], next: 0, calls: 0 }));
  if (r.ms.length < KEPT) r.ms.push(ms);
  else r.ms[r.next] = ms;
  r.next = (r.next + 1) % KEPT;
  r.calls++;
}

/** Run `fn` and record how long it took under `name`. */
export function timed<T>(name: string, fn: () => T): T {
  const start = performance.now();
  try {
    return fn();
  } finally {
    record(name, performance.now() - start);
  }
}

const round = (n: number) => Math.round(n * 100) / 100;

/** The nth percentile (0..1) of sorted values. */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]!;
}

/** Last, median and 95th percentile, in ms, for every name seen. */
export function snapshot(): Record<string, AdminTiming> {
  const out: Record<string, AdminTiming> = {};
  for (const [name, r] of rings) {
    if (r.ms.length === 0) continue;
    const last = r.ms[(r.next - 1 + r.ms.length) % r.ms.length]!;
    const sorted = [...r.ms].sort((a, b) => a - b);
    out[name] = { last: round(last), p50: round(percentile(sorted, 0.5)), p95: round(percentile(sorted, 0.95)), count: r.calls };
  }
  return out;
}

/** Forget everything (tests). */
export function resetTimings(): void {
  rings.clear();
}
