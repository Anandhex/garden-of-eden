import type { AdminBudgetRow, AdminTiming } from "@millbrook/shared";
import { perfSlack, tickBudgets } from "../budgets.js";

/** Green under this share of a budget, amber up to the budget, red over it. */
export const WARN_SHARE = 0.75;

/**
 * Each tick budget against what was measured (N19): the 95th percentile of the last calls, so
 * one slow outlier doesn't fail a run but a habit does. `slack` multiplies every limit (tests on
 * slow machines). A budget nothing has measured yet is "idle", never over.
 */
export function checkBudgets(timings: Record<string, AdminTiming>, slack = 1): AdminBudgetRow[] {
  return tickBudgets().map((b) => {
    const limit = b.ms * slack;
    const t = timings[b.name];
    if (!t) return { name: b.name, label: b.label, budgetMs: limit, p95Ms: null, ratio: null, status: "idle" as const };
    const ratio = limit > 0 ? t.p95 / limit : t.p95 > 0 ? Infinity : 0;
    return { name: b.name, label: b.label, budgetMs: limit, p95Ms: t.p95, ratio: Number.isFinite(ratio) ? Math.round(ratio * 100) / 100 : 999, status: t.p95 > limit ? ("over" as const) : ratio >= WARN_SHARE ? ("warn" as const) : ("ok" as const) };
  });
}

export { perfSlack };
