/**
 * NPC voices (T14). Each NPC file can say how its NPC sounds; the browser's own
 * speech engine is the default (no memory next to the language model), and a local
 * Piper server is used instead when one is running.
 */
export interface NpcVoice {
  /** BCP 47 language tag for the browser voice, e.g. "en-GB". */
  lang: string;
  /** 0–2, 1 is the engine's normal pitch. */
  pitch: number;
  /** 0.5–2, 1 is normal speed. */
  rate: number;
  /** Preferred browser voice names, best first; the first one installed wins (e.g. "Daniel", "Google UK English Male"). */
  browser: string[];
  /** Used to pick a browser voice when none of `browser` is installed. */
  gender?: "female" | "male" | "neutral";
  /** A Piper voice: the model name (e.g. "en_GB-alan-medium"), optional speaker id and speed. */
  piper?: { model: string; speaker?: number; lengthScale?: number };
}

export const DEFAULT_VOICE: NpcVoice = { lang: "en-GB", pitch: 1, rate: 1, browser: [] };

/** What the server can do for speech, from `GET /api/voice`. */
export interface VoiceInfo {
  /** "piper": `POST /api/speak` returns audio. "browser": speak in the page. */
  backend: "piper" | "browser";
  /** Why Piper isn't used, when it isn't (for the settings panel). */
  note: string;
  /** Piper voice models the server found. */
  models: string[];
}

/** Body of `POST /api/speak`. */
export interface SpeakRequest {
  npc: string;
  text: string;
}

/** Longest text one speak request takes: a sentence or two. */
export const MAX_SPEAK_CHARS = 400;
