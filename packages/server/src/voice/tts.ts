/**
 * Speech for NPCs (T14), on the server side. Piper is optional: without it the
 * browser speaks, and this module only says so.
 */
import { createHash } from "node:crypto";
import { spawn as nodeSpawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NpcVoice, VoiceInfo } from "@millbrook/shared";

export interface TtsProvider {
  readonly name: string;
  /** WAV audio for one sentence in this voice. */
  synthesize(text: string, voice: NpcVoice): Promise<Buffer>;
}

/** Voice model names (without .onnx) in a folder, each with its .onnx.json config next to it. */
export function listPiperModels(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".onnx") && existsSync(join(dir, `${f}.json`)))
    .map((f) => f.replace(/\.onnx$/, ""))
    .sort();
}

/**
 * Piper's own HTTP server (`python3 -m piper.http_server -m <voice> --data-dir voices`; the URL is its /synthesize endpoint),
 * which keeps the voice model loaded between sentences. POST JSON, get WAV back.
 */
export class PiperHttpTts implements TtsProvider {
  readonly name = "piper (http)";
  constructor(
    private readonly url: string,
    private readonly timeoutMs: number,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async synthesize(text: string, voice: NpcVoice): Promise<Buffer> {
    const body: Record<string, unknown> = { text };
    if (voice.piper) {
      body.voice = voice.piper.model;
      if (voice.piper.speaker !== undefined) body.speaker_id = voice.piper.speaker;
      if (voice.piper.lengthScale !== undefined) body.length_scale = voice.piper.lengthScale;
    }
    const res = await this.fetchImpl(this.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!res.ok) throw new Error(`Piper server answered ${res.status}.`);
    return Buffer.from(await res.arrayBuffer());
  }
}

type Spawn = typeof nodeSpawn;

/**
 * The `piper` program, run once per sentence: text on stdin, a WAV file out. Slower
 * than the HTTP server (the model loads every time) but needs nothing running.
 */
export class PiperCliTts implements TtsProvider {
  readonly name = "piper (cli)";
  constructor(
    private readonly bin: string,
    private readonly voicesDir: string,
    private readonly timeoutMs: number,
    private readonly spawn: Spawn = nodeSpawn,
  ) {}

  synthesize(text: string, voice: NpcVoice): Promise<Buffer> {
    const model = voice.piper?.model ?? listPiperModels(this.voicesDir)[0];
    if (!model) return Promise.reject(new Error(`No Piper voice models in ${this.voicesDir}.`));
    // real time, not simulation: a temp file name
    const out = join(tmpdir(), `millbrook-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.wav`);
    const args = ["--model", join(this.voicesDir, `${model}.onnx`), "--output_file", out];
    if (voice.piper?.speaker !== undefined) args.push("--speaker", String(voice.piper.speaker));
    if (voice.piper?.lengthScale !== undefined) args.push("--length_scale", String(voice.piper.lengthScale));
    return new Promise((resolve, reject) => {
      const child = this.spawn(this.bin, args, { stdio: ["pipe", "ignore", "pipe"] });
      let stderr = "";
      const timer = setTimeout(() => child.kill("SIGKILL"), this.timeoutMs);
      child.stderr?.on("data", (d) => (stderr = (stderr + String(d)).slice(-500)));
      child.on("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        try {
          if (code !== 0 || !existsSync(out)) return reject(new Error(`piper exited with ${code}: ${stderr.trim()}`));
          resolve(readFileSync(out));
        } finally {
          rmSync(out, { force: true });
        }
      });
      child.stdin?.end(text);
    });
  }
}

/** Keeps recent sentences, so a repeated line is spoken from memory. */
export class CachedTts implements TtsProvider {
  private readonly cache = new Map<string, Buffer>();
  constructor(
    private readonly inner: TtsProvider,
    private readonly maxEntries: number,
  ) {}

  get name() {
    return this.inner.name;
  }

  async synthesize(text: string, voice: NpcVoice): Promise<Buffer> {
    const key = createHash("sha1").update(JSON.stringify([text, voice.piper ?? null])).digest("hex");
    const hit = this.cache.get(key);
    if (hit) {
      this.cache.delete(key); // refresh its place: least recently used goes first
      this.cache.set(key, hit);
      return hit;
    }
    const audio = await this.inner.synthesize(text, voice);
    if (this.maxEntries <= 0) return audio;
    this.cache.set(key, audio);
    while (this.cache.size > this.maxEntries) this.cache.delete(this.cache.keys().next().value!);
    return audio;
  }
}

export interface VoiceSetup {
  tts: TtsProvider | null;
  info: VoiceInfo;
}

/** Is `bin` a program we can run (a path, or a name on PATH)? */
export function findProgram(bin: string, path = process.env.PATH ?? ""): string | null {
  if (!bin) return null;
  if (bin.includes("/")) return existsSync(bin) ? bin : null;
  for (const dir of path.split(":")) if (dir && existsSync(join(dir, bin))) return join(dir, bin);
  return null;
}

/**
 * Pick the speech backend from config: the Piper HTTP server if a URL is set and it
 * answers, else the piper program if it's installed and there are voices, else the browser.
 */
export async function setUpVoice(
  cfg: { piperUrl: string; piperBin: string; piperVoices: string; cacheEntries: number; timeoutMs: number },
  fetchImpl: typeof fetch = fetch,
): Promise<VoiceSetup> {
  const models = listPiperModels(cfg.piperVoices);
  if (cfg.piperUrl) {
    try {
      // Any HTTP answer (even 404 or 405 for a GET) means the server is up.
      await fetchImpl(cfg.piperUrl, { method: "GET", signal: AbortSignal.timeout(2000) });
      return { tts: new CachedTts(new PiperHttpTts(cfg.piperUrl, cfg.timeoutMs, fetchImpl), cfg.cacheEntries), info: { backend: "piper", note: `Piper server at ${cfg.piperUrl}.`, models } };
    } catch {
      return { tts: null, info: { backend: "browser", note: `No Piper server answering at ${cfg.piperUrl}; using the browser's voices.`, models } };
    }
  }
  const bin = findProgram(cfg.piperBin || "piper");
  if (bin && models.length > 0) {
    return { tts: new CachedTts(new PiperCliTts(bin, cfg.piperVoices, cfg.timeoutMs), cfg.cacheEntries), info: { backend: "piper", note: `Piper program at ${bin}, ${models.length} voice(s).`, models } };
  }
  const why = !bin ? "Piper isn't installed" : `no voice models in ${cfg.piperVoices}/`;
  return { tts: null, info: { backend: "browser", note: `${why}; using the browser's voices.`, models } };
}
