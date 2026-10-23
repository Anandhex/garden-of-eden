/** The view protocol (G5), the art ids and the building templates (G6). Engine adapters import only this (and GameEvent). */
export * from "./schema.js";
export * from "./art.js";
/** Building templates (G6): how a building is dressed, the same everywhere. */
export * from "./templates.js";
export type { GameEvent } from "../events.js";
/** Speech (T14): voices and splitting a reply into sentences to speak, for any adapter that plays `speech`. */
export { SentenceSplitter, findSentenceEnd, speakable } from "../sentences.js";
export { DEFAULT_VOICE, MAX_SPEAK_CHARS, type NpcVoice, type VoiceInfo } from "../voice.js";
/** The realm map's data (`ui.realm`), drawn by the adapter. */
export type { RealmView } from "../protocol.js";
