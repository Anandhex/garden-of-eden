import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { DeathCause } from "./people/death.js";

/**
 * Death is permanent. When an NPC dies, it's written to a save file, and from
 * then on the game refuses to load that NPC: no restart brings them back.
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

export class DeathRegistry {
  constructor(private readonly file: string) {}

  all(): Record<string, DeathRecord> {
    if (!existsSync(this.file)) return {};
    return JSON.parse(readFileSync(this.file, "utf8")) as Record<string, DeathRecord>;
  }

  get(npcId: string): DeathRecord | undefined {
    return this.all()[npcId];
  }

  isDead(npcId: string): boolean {
    return this.get(npcId) !== undefined;
  }

  /** Record a death. The first record wins: the dead can't die again. */
  record(death: DeathRecord): void {
    const all = this.all();
    if (all[death.npcId]) return;
    all[death.npcId] = death;
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(this.file, `${JSON.stringify(all, null, 2)}\n`);
  }
}
