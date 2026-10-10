export const MOODS = ["happy", "neutral", "annoyed", "angry", "afraid", "sad"] as const;
export type Mood = (typeof MOODS)[number];

/** Static, authored data loaded from src/data/npcs/*.json. */
export interface NpcPersona {
  id: string;
  name: string;
  role: string;
  personality: string[];
  speechStyle: string;
  backstory: string;
  goals: string[];
  /** Things the NPC knows and may share. */
  knowledge: string[];
  /** Guarded knowledge, revealed only with high trust (enforced in code in Phase 1). */
  secrets: string[];
  startingInventory: Record<string, number>;
  /** Base price in gold for each item the NPC sells. */
  prices: Record<string, number>;
}

/** Dynamic state owned by the game. The model can only change it through actions. */
export interface NpcState {
  mood: Mood;
  /** -100 (enemy) .. 100 (best friend) */
  relationship: number;
  inventory: Record<string, number>;
  following: boolean;
  conversationOver: boolean;
}

/** What the NPC can perceive right now. Rebuilt every turn by the game. */
export interface WorldSnapshot {
  timeOfDay: "morning" | "afternoon" | "evening" | "night";
  location: string;
  nearby: string[];
  recentEvents: string[];
  player: { name: string; gold: number; inventory: Record<string, number> };
}

export interface AppliedAction {
  name: string;
  args: unknown;
  ok: boolean;
  message: string;
}

export interface TurnResult {
  text: string;
  actions: AppliedAction[];
}
