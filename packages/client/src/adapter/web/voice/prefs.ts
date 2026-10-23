/** Per-player voice settings, remembered in this browser only. */
export interface VoicePrefs {
  /** NPCs speak their lines aloud. */
  voices: boolean;
  /** 0–1. */
  volume: number;
  /** "auto" uses Piper when the server has it; "browser" always speaks in the page. */
  engine: "auto" | "browser";
  /** Push-to-talk sends the words as soon as you let go. */
  micAutoSend: boolean;
}

const KEY = "millbrook.voice";
const DEFAULTS: VoicePrefs = { voices: true, volume: 0.9, engine: "auto", micAutoSend: true };

export function loadPrefs(): VoicePrefs {
  try {
    return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<VoicePrefs>) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function savePrefs(p: VoicePrefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    // private window or blocked storage: the settings last until the page closes
  }
}
