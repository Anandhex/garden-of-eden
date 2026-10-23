/** Choosing a browser voice for an NPC (T14). Pure, so it's tested without a browser. */
import type { NpcVoice } from "@millbrook/shared/view";

export interface VoiceOption {
  name: string;
  lang: string;
  localService?: boolean;
}

/** Common system voices by how they sound, for NPC files that only give a gender. */
const FEMALE = /\b(serena|martha|kate|moira|karen|tessa|samantha|victoria|fiona|susan|allison|ava|zoe|female|sonia|libby|hazel|emma|jenny|aria|catherine|veena)\b/i;
const MALE = /\b(daniel|arthur|oliver|fred|ralph|alex|tom|aaron|rishi|gordon|lee|male|ryan|thomas|guy|george|james|david|mark)\b/i;

const sameLang = (a: string, b: string) => a.replace("_", "-").toLowerCase() === b.toLowerCase();
const sameFamily = (a: string, b: string) => a.slice(0, 2).toLowerCase() === b.slice(0, 2).toLowerCase();

/** A stable number for a string, so each NPC keeps the same fallback voice. */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/**
 * The voice an NPC speaks with: the first of their preferred names that's installed;
 * else one in their language (and gender, if given), picked by their id so NPCs differ;
 * else any voice in the same language family; else null (the engine's default).
 */
export function pickVoice<V extends VoiceOption>(voices: readonly V[], voice: NpcVoice, npcId: string): V | null {
  for (const want of voice.browser) {
    const hit = voices.find((v) => v.name === want) ?? voices.find((v) => v.name.toLowerCase().startsWith(want.toLowerCase()));
    if (hit) return hit;
  }
  const pool = (filter: (v: V) => boolean) => voices.filter(filter);
  const gendered = (v: V) => (voice.gender === "female" ? FEMALE.test(v.name) : voice.gender === "male" ? MALE.test(v.name) : true);
  for (const candidates of [
    pool((v) => sameLang(v.lang, voice.lang) && gendered(v)),
    pool((v) => sameFamily(v.lang, voice.lang) && gendered(v)),
    pool((v) => sameLang(v.lang, voice.lang)),
    pool((v) => sameFamily(v.lang, voice.lang)),
  ]) {
    if (candidates.length > 0) {
      // Prefer voices that run on this machine: no audio leaves it, and they start faster.
      const local = candidates.filter((v) => v.localService !== false);
      const list = local.length > 0 ? local : candidates;
      return list[hash(npcId) % list.length]!;
    }
  }
  return null;
}
