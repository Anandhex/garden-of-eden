import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

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
  killedBy: string;
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
