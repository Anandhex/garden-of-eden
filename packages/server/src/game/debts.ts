import type { NpcPersona, NpcState } from "../npc/types.js";
import { formatMoney } from "./money.js";

/**
 * NPC debts. Whenever an NPC earns money (a sale, a lesson), they put everything
 * above their reserve toward what they owe. This happens in code and is never
 * shown to the model: debts are usually secrets, and small models leak them.
 * The model only learns about a debt through reveal_secret (see debtStatus).
 */
/** Copper an NPC keeps back before paying debts, unless their file says otherwise (2 gold). */
export const DEFAULT_RESERVE = 200;

export interface DebtPayment {
  debtId: string;
  creditor: string;
  amount: number;
  remaining: number;
}

/** Pay down debts with money above the NPC's reserve. Mutates `state`. */
export function payDebts(persona: NpcPersona, state: NpcState): DebtPayment[] {
  const reserve = persona.reserveMoney ?? DEFAULT_RESERVE;
  const payments: DebtPayment[] = [];
  for (const debt of persona.debts ?? []) {
    const owed = state.debts[debt.id] ?? 0;
    const spare = state.money - reserve;
    if (owed <= 0 || spare <= 0) continue;
    const amount = Math.min(owed, spare);
    state.money -= amount;
    state.debts[debt.id] = owed - amount;
    payments.push({ debtId: debt.id, creditor: debt.creditor, amount, remaining: owed - amount });
  }
  return payments;
}

/** For the model, when it reveals a secret about this debt: how things stand now. */
export function debtStatus(persona: NpcPersona, state: NpcState, debtId: string): string {
  const debt = persona.debts?.find((d) => d.id === debtId);
  if (!debt) return "";
  const owed = state.debts[debtId] ?? 0;
  if (owed <= 0) return `You've since paid ${debt.creditor} back in full, and it's a weight off your shoulders.`;
  const paid = debt.amount - owed;
  return paid > 0
    ? `You've paid back ${formatMoney(paid)} so far; you still owe ${debt.creditor} ${formatMoney(owed)}.`
    : `You still owe ${debt.creditor} all ${formatMoney(owed)}.`;
}

/** True if the NPC has debts and has paid them all. */
export function isDebtFree(persona: NpcPersona, state: NpcState): boolean {
  return (persona.debts ?? []).length > 0 && (persona.debts ?? []).every((d) => (state.debts[d.id] ?? 0) <= 0);
}

/** The NPC's greed right now: lower once their debts are paid, if they have a greedWhenDebtFree. */
export function effectiveGreed(persona: NpcPersona, state: NpcState): number {
  return isDebtFree(persona, state) ? (persona.greedWhenDebtFree ?? persona.greed) : persona.greed;
}
