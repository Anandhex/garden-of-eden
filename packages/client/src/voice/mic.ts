/**
 * Push-to-talk (player voice input): hold the 🎙 button or the V key, speak, let go.
 * Uses the browser's speech recognition, so no model has to share memory with the
 * language model. Where the browser can recognise speech on the device it's asked to;
 * otherwise the browser's own service hears the audio (the button's tooltip says so).
 */

interface RecognitionResultList {
  length: number;
  [i: number]: { isFinal: boolean; 0: { transcript: string } };
}
interface Recognition extends EventTarget {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  processLocally?: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: { resultIndex: number; results: RecognitionResultList }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
}
type RecognitionCtor = new () => Recognition;

const Ctor: RecognitionCtor | undefined =
  typeof window === "undefined" ? undefined : ((window as unknown as Record<string, RecognitionCtor | undefined>).SpeechRecognition ?? (window as unknown as Record<string, RecognitionCtor | undefined>).webkitSpeechRecognition);

export const micSupported = Boolean(Ctor);

export interface MicOptions {
  /** Live words while speaking. */
  onInterim(text: string): void;
  /** What was said, once you let go. */
  onFinal(text: string): void;
  onState(listening: boolean): void;
  onError(message: string): void;
}

export class PushToTalk {
  private rec: Recognition | null = null;
  private finalText = "";
  private interim = "";
  private listening = false;
  /** Set once on-device recognition turned out not to be available. */
  private remoteOnly = false;

  constructor(private readonly opts: MicOptions) {}

  get isListening(): boolean {
    return this.listening;
  }

  start(): void {
    if (!Ctor || this.listening) return;
    const rec = new Ctor();
    rec.lang = navigator.language || "en-GB";
    rec.interimResults = true;
    rec.continuous = true;
    if ("processLocally" in rec && !this.remoteOnly) rec.processLocally = true;
    this.finalText = "";
    this.interim = "";
    rec.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i]!;
        if (r.isFinal) this.finalText += r[0].transcript;
        else interim += r[0].transcript;
      }
      this.interim = interim;
      this.opts.onInterim((this.finalText + interim).trim());
    };
    rec.onerror = (e) => {
      if (e.error === "language-not-supported" && !this.remoteOnly) {
        this.remoteOnly = true; // no on-device model for this language: the browser's service it is
        return;
      }
      if (e.error !== "aborted" && e.error !== "no-speech") this.opts.onError(e.error === "not-allowed" ? "Microphone access was blocked." : `Speech recognition: ${e.error}`);
    };
    rec.onend = () => {
      const said = (this.finalText + this.interim).trim();
      this.rec = null;
      this.setListening(false);
      if (said) this.opts.onFinal(said);
    };
    this.rec = rec;
    try {
      rec.start();
      this.setListening(true);
    } catch (err) {
      this.rec = null;
      this.opts.onError((err as Error).message);
    }
  }

  /** Let go: recognition finishes the last words, then onFinal fires. */
  stop(): void {
    this.rec?.stop();
  }

  cancel(): void {
    this.finalText = "";
    this.interim = "";
    this.rec?.abort();
  }

  private setListening(on: boolean): void {
    this.listening = on;
    this.opts.onState(on);
  }
}
