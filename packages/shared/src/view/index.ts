/** The view protocol (G5) and the art ids (G6). Engine adapters import only this (and GameEvent). */
export * from "./schema.js";
export * from "./art.js";
export type { GameEvent } from "../events.js";
/** Speech (T14): voices and splitting a reply into sentences to speak, for any adapter that plays `speech`. */
export { SentenceSplitter, findSentenceEnd, speakable } from "../sentences.js";
export { DEFAULT_VOICE, MAX_SPEAK_CHARS, type NpcVoice, type VoiceInfo } from "../voice.js";
/** The realm map's data (`ui.realm`), drawn by the adapter. */
export type { RealmView } from "../protocol.js";
