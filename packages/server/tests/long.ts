/**
 * Long runs (plans README section 10). The tests that only prove the world is the same twice, or that a lazy place equals a live one, need a few
 * days, not a season: `days(full, short)` gives `short` normally and `full` with LONG=1 (the nightly job). Tests that need a long run to see
 * anything (a bound after a year, a rare event) use `longOnly` and are skipped normally.
 */
export const LONG = process.env.LONG === "1";
export const days = (full: number, short: number): number => (LONG ? full : short);
export const longOnly = (it: { skipIf: (c: boolean) => unknown }) => it.skipIf(!LONG);
