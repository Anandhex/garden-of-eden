/**
 * The voice endpoints (T14), plain HTTP beside the socket (G5 decision 10): audio is a binary blob, not a JSON
 * message. What a line says comes over the socket; this only turns it into sound in the NPC's Piper voice.
 */
import type { VoiceInfo } from "@millbrook/shared/view";

export async function fetchVoiceInfo(): Promise<VoiceInfo> {
  try {
    return (await (await fetch("/api/voice")).json()) as VoiceInfo;
  } catch {
    return { backend: "browser", note: "The server didn't say; using the browser's voices.", models: [] };
  }
}

/** One sentence as audio from the server's Piper voice. */
export async function fetchSpeech(npc: string, text: string, signal?: AbortSignal): Promise<Blob> {
  const res = await fetch("/api/speak", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ npc, text }), signal });
  if (!res.ok) throw new Error(`speak: ${res.status}`);
  return res.blob();
}
