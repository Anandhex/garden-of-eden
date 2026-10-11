/**
 * NPC voices in the page (T14). Text streams in; each finished sentence is spoken
 * while the model writes the next. Speech comes from the server's Piper voice when
 * it has one, and from the browser's own speech engine otherwise.
 */
import { SentenceSplitter, speakable, type NpcVoice, type VoiceInfo } from "@millbrook/shared";
import { fetchSpeech, fetchVoiceInfo } from "../api";
import { pickVoice } from "./pick";
import { loadPrefs, savePrefs, type VoicePrefs } from "./prefs";

interface Line {
  npc: string;
  text: string;
  voice: NpcVoice;
  /** Piper audio, fetched as soon as the line is queued so it's ready when its turn comes. */
  audio?: Promise<Blob | null>;
}

export class Speaker {
  prefs: VoicePrefs = loadPrefs();
  info: VoiceInfo = { backend: "browser", note: "", models: [] };
  private splitters = new Map<string, SentenceSplitter>();
  private queue: Line[] = [];
  private playing = false;
  private current: HTMLAudioElement | null = null;
  private aborts = new Set<AbortController>();
  /** Bumped by stop(): anything started before is dropped. */
  private generation = 0;
  private browserVoices: SpeechSynthesisVoice[] = [];

  readonly browserSupported = typeof window !== "undefined" && "speechSynthesis" in window;

  async init(): Promise<void> {
    this.info = await fetchVoiceInfo();
    if (this.browserSupported) {
      const load = () => (this.browserVoices = speechSynthesis.getVoices());
      load();
      speechSynthesis.addEventListener("voiceschanged", load);
    }
  }

  get usingPiper(): boolean {
    return this.info.backend === "piper" && this.prefs.engine === "auto";
  }

  get available(): boolean {
    return this.usingPiper || this.browserSupported;
  }

  setPrefs(p: Partial<VoicePrefs>): void {
    this.prefs = { ...this.prefs, ...p };
    savePrefs(this.prefs);
    if (!this.prefs.voices) this.stop();
    if (this.current) this.current.volume = this.prefs.volume;
  }

  /** More of an NPC's reply arrived. */
  text(npc: string, delta: string, voice: NpcVoice): void {
    if (!this.prefs.voices) return;
    let s = this.splitters.get(npc);
    if (!s) this.splitters.set(npc, (s = new SentenceSplitter()));
    for (const sentence of s.push(delta)) this.enqueue(npc, sentence, voice);
  }

  /** The NPC's reply is finished: speak what's left. */
  end(npc: string, voice: NpcVoice): void {
    const s = this.splitters.get(npc);
    this.splitters.delete(npc);
    if (!s || !this.prefs.voices) return;
    for (const rest of s.flush()) this.enqueue(npc, rest, voice);
  }

  /** A whole line at once (fillers, the voice test). */
  say(npc: string, text: string, voice: NpcVoice): void {
    if (this.prefs.voices) this.enqueue(npc, text, voice);
  }

  /** Stop talking now (the player spoke, or walked away). */
  stop(): void {
    this.generation++;
    this.queue = [];
    this.splitters.clear();
    for (const a of this.aborts) a.abort();
    this.aborts.clear();
    if (this.current) {
      this.current.pause();
      this.current = null;
    }
    if (this.browserSupported) speechSynthesis.cancel();
    this.playing = false;
  }

  /** The browser voice an NPC gets, for the settings panel. */
  browserVoiceName(npc: string, voice: NpcVoice): string {
    return pickVoice(this.browserVoices, voice, npc)?.name ?? "the browser's default voice";
  }

  private enqueue(npc: string, raw: string, voice: NpcVoice): void {
    const text = speakable(raw);
    if (!text || !/[\p{L}\p{N}]/u.test(text)) return;
    const line: Line = { npc, text, voice };
    if (this.usingPiper) line.audio = this.fetchAudio(line);
    this.queue.push(line);
    if (!this.playing) void this.pump();
  }

  private fetchAudio(line: Line): Promise<Blob | null> {
    const abort = new AbortController();
    this.aborts.add(abort);
    return fetchSpeech(line.npc, line.text, abort.signal)
      .catch(() => null)
      .finally(() => this.aborts.delete(abort));
  }

  private async pump(): Promise<void> {
    this.playing = true;
    const gen = this.generation;
    while (this.queue.length > 0 && gen === this.generation) {
      const line = this.queue.shift()!;
      const audio = line.audio ? await line.audio : null;
      if (gen !== this.generation) return;
      // If Piper failed for this line, the browser says it instead of dropping it.
      if (audio) await this.playAudio(audio);
      else if (this.browserSupported) await this.speakInBrowser(line);
    }
    if (gen === this.generation) this.playing = false;
  }

  private playAudio(blob: Blob): Promise<void> {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(blob);
      const a = new Audio(url);
      a.volume = this.prefs.volume;
      this.current = a;
      const done = () => {
        URL.revokeObjectURL(url);
        if (this.current === a) this.current = null;
        resolve();
      };
      a.onended = done;
      a.onerror = done;
      a.onpause = done;
      a.play().catch(done);
    });
  }

  private speakInBrowser(line: Line): Promise<void> {
    return new Promise((resolve) => {
      const u = new SpeechSynthesisUtterance(line.text);
      const v = pickVoice(this.browserVoices, line.voice, line.npc);
      if (v) u.voice = v;
      u.lang = v?.lang ?? line.voice.lang;
      u.pitch = line.voice.pitch;
      u.rate = line.voice.rate;
      u.volume = this.prefs.volume;
      // Some engines never fire `end` for a cancelled line: don't wait forever.
      const timer = setTimeout(resolve, 2000 + line.text.length * 120);
      u.onend = u.onerror = () => {
        clearTimeout(timer);
        resolve();
      };
      speechSynthesis.speak(u);
    });
  }
}

export const speaker = new Speaker();
