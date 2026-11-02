import { config } from "../config.js";

/**
 * Break switches (N22 decision 5): each turns one stabiliser off, so a test can prove the bound that watches it fails.
 * `BALANCE_BREAK=no-famine-relief,no-war-fatigue`. Wired: `no-famine-relief` (economy.ts buying grain, the director's
 * caravans), `no-war-fatigue` (diplomacy.ts: weariness never rises, long wars don't end of themselves), `no-peace` (no war
 * ends by victory or weariness).
 *
 * Measured 2026-10-24: `no-war-fatigue` alone trips nothing in 5 years on seeds 1-3, because wars are decided on the
 * field (the score) within about 30 days and weariness rarely reaches the 30 that stops a new war. So the stabiliser the
 * war bound really watches is the score; `no-peace` is the switch that proves it.
 */
export const BREAK_SWITCHES = ["no-famine-relief", "no-war-fatigue", "no-peace"] as const;

export function broken(name: (typeof BREAK_SWITCHES)[number]): boolean {
  return config.balance.break.has(name);
}
