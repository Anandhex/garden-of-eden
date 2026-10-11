import { needsMood } from "../game/needs.js";
import type { Traits } from "./traits.js";
import type { Mood, NpcState } from "./types.js";

/**
 * Lasting emotions (N5.3): feelings that outlive one conversation. Events add them
 * in code (an insult in front of others leaves resentment and embarrassment, a fine
 * piece of work leaves pride); they fade every night, bad ones at the NPC's
 * forgiveness. The strongest nudges the NPC's mood and gets one situation line.
 */
export const EMOTION_KINDS = ["pride", "gratitude", "joy", "grief", "embarrassment", "resentment", "worry"] as const;
export type EmotionKind = (typeof EMOTION_KINDS)[number];

const NEGATIVE: ReadonlySet<EmotionKind> = new Set(["grief", "embarrassment", "resentment", "worry"]);

export interface Emotion {
  kind: EmotionKind;
  /** 0..1. Below FADED it's gone. */
  strength: number;
  /** What it's about, written to the NPC: "them insulting you in front of the regulars". */
  about: string;
  /** Day it started (or was last renewed). */
  since: number;
  /** Felt about the player (so it colours how the NPC treats them). */
  aboutPlayer?: boolean;
}

/** An emotion weaker than this is forgotten. */
export const FADED = 0.1;
/** Strong enough to colour mood and get a situation line. */
export const FELT = 0.3;

export const isNegative = (kind: EmotionKind) => NEGATIVE.has(kind);

/**
 * Share of a bad feeling lost each night: 10% for the most grudge-holding, 50% for
 * the most forgiving. Good feelings fade at a steady 30%.
 */
export function dailyFade(kind: EmotionKind, t: Pick<Traits, "forgiveness">): number {
  return isNegative(kind) ? 0.1 + 0.4 * t.forgiveness : 0.3;
}

/** Add (or strengthen) a feeling. The same kind about the same thing stacks, up to 1. */
export function addEmotion(state: NpcState, kind: EmotionKind, strength: number, about: string, day: number, aboutPlayer = false): void {
  const existing = state.emotions.find((e) => e.kind === kind && e.about === about);
  if (existing) {
    existing.strength = Math.min(1, existing.strength + strength);
    existing.since = day;
    return;
  }
  state.emotions.push({ kind, strength: Math.min(1, strength), about, since: day, ...(aboutPlayer ? { aboutPlayer } : {}) });
}

/** A night passes: every feeling fades by its daily share, and faded ones are dropped. */
export function fadeEmotions(state: NpcState, t: Pick<Traits, "forgiveness">, nights = 1): void {
  for (const e of state.emotions) e.strength *= (1 - dailyFade(e.kind, t)) ** nights;
  state.emotions = state.emotions.filter((e) => e.strength >= FADED);
}

/** The strongest feeling, if it's strong enough to show. */
export function strongestEmotion(state: Pick<NpcState, "emotions">): Emotion | null {
  const felt = state.emotions.filter((e) => e.strength >= FELT).sort((a, b) => b.strength - a.strength);
  return felt[0] ?? null;
}

const HOW: Record<EmotionKind, string> = {
  pride: "You're proud of",
  gratitude: "You're grateful for",
  joy: "You're still glad about",
  grief: "You're grieving",
  embarrassment: "You're still embarrassed about",
  resentment: "You still resent",
  worry: "You're worried about",
};

/** The situation line for the strongest feeling, e.g. "You still resent them insulting you in front of the regulars." */
export function describeEmotion(state: Pick<NpcState, "emotions">): string | null {
  const e = strongestEmotion(state);
  if (!e) return null;
  const deep = e.strength >= 0.7 ? " It weighs on you." : "";
  return `${HOW[e.kind]} ${e.about}.${deep}`;
}

/** The mood a feeling pulls towards, or null if none is strong enough. */
export function emotionMood(state: Pick<NpcState, "emotions">): Mood | null {
  const e = strongestEmotion(state);
  if (!e) return null;
  if (e.kind === "grief") return "sad";
  if (e.kind === "worry") return "afraid";
  if (isNegative(e.kind)) return "annoyed";
  return e.strength >= 0.5 ? "happy" : null;
}

/** Hours a mood lasts before it drifts back to the NPC's baseline. */
export const MOOD_HOURS = 3;

/** The mood an NPC settles into when nothing's happening: from their feelings, then their needs. */
export function baselineMood(state: Pick<NpcState, "emotions" | "needs" | "money">): Mood {
  return emotionMood(state) ?? needsMood(state.needs) ?? "neutral";
}
