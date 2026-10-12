/** Calls to the game server. */
import { NdjsonDecoder, type CrowdRoster, type MoveResponse, type Snapshot, type StreamEvent, type TickResponse, type VoiceInfo } from "@millbrook/shared";

const post = (url: string, body: unknown) => fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

export async function fetchState(poll = false): Promise<Snapshot> {
  const res = await fetch(poll ? "/api/state?poll=1" : "/api/state");
  return (await res.json()) as Snapshot;
}

export async function postMove(dx: number, dy: number): Promise<MoveResponse | { ok: false; reason: string; state?: undefined; events?: undefined; log?: undefined }> {
  const res = await post("/api/move", { dx, dy });
  return (await res.json()) as MoveResponse;
}

/** Everyone who lives on the map the player is on (N16), or null. */
export async function fetchCrowd(): Promise<CrowdRoster | null> {
  return (await (await fetch("/api/crowd")).json()) as CrowdRoster | null;
}

/** A minute passes while the player stands about (N16). `state` is null when the server was busy. */
export async function postTick(): Promise<TickResponse | { ok: false; state: null; log: string[]; events: [] }> {
  return (await (await post("/api/tick", {})).json()) as TickResponse;
}

export async function postNew(): Promise<{ state?: Snapshot }> {
  return (await (await post("/api/new", {})).json()) as { state?: Snapshot };
}

/** POST an action and hand each streamed event to `onEvent` as it arrives. */
export async function streamAct(body: Record<string, unknown>, onEvent: (ev: StreamEvent) => void): Promise<"ok" | "busy"> {
  const res = await post("/api/act", body);
  if (res.status === 429) return "busy";
  if (!res.body) throw new Error("No response body.");
  const reader = res.body.getReader();
  const text = new TextDecoder();
  const lines = new NdjsonDecoder<StreamEvent>();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    for (const ev of lines.push(text.decode(value, { stream: true }))) onEvent(ev);
  }
  for (const ev of lines.push("\n")) onEvent(ev);
  return "ok";
}

export async function fetchQuote(npc: string, skill: string, hours: number) {
  const res = await fetch(`/api/quote?npc=${encodeURIComponent(npc)}&skill=${encodeURIComponent(skill)}&hours=${hours}`);
  return (await res.json()) as { ok: boolean; message: string; money: number; hours: number };
}

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
