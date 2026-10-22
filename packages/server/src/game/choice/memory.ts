import type { NpcState } from "../../npc/types.js";

/** The plan a talker's pick set for this absolute hour, or null: what `simulation.ts` follows in place of the schedule's. */
export function chosenPlan(state: Pick<NpcState, "choice">, abs: number): NonNullable<NonNullable<NpcState["choice"]>["plan"]> | null {
  const p = state.choice?.plan;
  return p && p.at === abs ? p : null;
}
