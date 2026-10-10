import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { AppliedAction, NpcState, PlayerState } from "../npc/types.js";

export interface TranscriptTurn {
  playerLine: string;
  stateBefore: { npc: NpcState; player: PlayerState };
  stateAfter: { npc: NpcState; player: PlayerState };
  actions: AppliedAction[];
  reply: string;
}

export function appendTranscript(file: string, turn: TranscriptTurn): void {
  writeFileSync(file, `${JSON.stringify(turn)}\n`, { flag: "a" });
}

export function readTranscript(file: string): TranscriptTurn[] {
  if (!existsSync(file)) throw new Error(`Transcript does not exist: ${file}`);
  return readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line) as TranscriptTurn;
      } catch (error) {
        throw new Error(`Invalid transcript line ${index + 1}: ${(error as Error).message}`);
      }
    });
}

export function diffTranscriptTurn(turn: TranscriptTurn, actual: { npc: NpcState; player: PlayerState }): string[] {
  const differences: string[] = [];
  if (JSON.stringify(turn.stateAfter.npc) !== JSON.stringify(actual.npc)) differences.push("npc state differs");
  if (JSON.stringify(turn.stateAfter.player) !== JSON.stringify(actual.player)) differences.push("player state differs");
  return differences;
}
