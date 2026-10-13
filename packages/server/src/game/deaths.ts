import type { DeathCause } from "./people/death.js";

/**
 * Death is permanent. When an NPC dies, it's written to the world's record (`world.deaths`, in the
 * save) and to their people row (N25), and from then on no restart brings them back.
 */
export interface DeathRecord {
  npcId: string;
  name: string;
  /** In-game time of death. */
  day: number;
  hour: number;
  /** Who killed them, or "old age" for a natural death. */
  killedBy: string;
  /** How, in the typed words everyone's death uses (N25), and where. Absent in records made before. */
  cause?: DeathCause;
  site?: string | null;
}

/** For the player: "died of old age on day 40" / "was killed by Traveler on day 2". */
export function describeDeath(death: Pick<DeathRecord, "killedBy" | "day">): string {
  return death.killedBy === "old age" ? `died of old age on day ${death.day}` : `was killed by ${death.killedBy} on day ${death.day}`;
}
