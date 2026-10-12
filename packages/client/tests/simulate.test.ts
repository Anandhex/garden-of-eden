import { describe, expect, it } from "vitest";
import type { Snapshot } from "@millbrook/shared";
import { heldBy, SPEEDS } from "../src/simulate";

const snap = (over: Partial<Snapshot> = {}): Snapshot => ({ engaged: null, creatures: [], npcs: [], ...over }) as unknown as Snapshot;

describe("simulate mode", () => {
  it("lets time pass when nobody is fighting", () => {
    expect(heldBy(snap({ npcs: [{ name: "Brena", inCombat: false, dead: false }] as Snapshot["npcs"] }))).toBeNull();
  });

  it("holds the clock in a fight, as the server does", () => {
    expect(heldBy(snap({ engaged: "w1" }))).toBe("you're in a fight");
    expect(heldBy(snap({ creatures: [{ engaged: true }] as Snapshot["creatures"] }))).toBe("you're in a fight");
    expect(heldBy(snap({ npcs: [{ name: "Rook", inCombat: true, dead: false }] as Snapshot["npcs"] }))).toBe("Rook is in a fight");
    // The dead don't hold anything up.
    expect(heldBy(snap({ npcs: [{ name: "Rook", inCombat: true, dead: true }] as Snapshot["npcs"] }))).toBeNull();
  });

  it("every speed moves the clock within what the server allows (1-24h)", () => {
    for (const { hours, everyMs } of Object.values(SPEEDS)) {
      expect(hours).toBeGreaterThanOrEqual(1);
      expect(hours).toBeLessThanOrEqual(24);
      expect(everyMs).toBeGreaterThan(0);
    }
  });
});
