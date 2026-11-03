/**
 * The soundscape's player (N29), all synthesis: no sound files. The frame says what can be heard (`frame.sound`, plain
 * facts); the shared `soundscape()` says what should be heard (beds with a volume, spots at a place); this plays it with Web
 * Audio. Beds are filtered noise and small oscillators that fade to new volumes over a few seconds, never cut; a bed at
 * nothing is stopped, not left running silent. Spots are short synthesized sounds, panned by where they are. It starts only
 * after a click or a key (browsers require it) and only while sound is on (this browser's setting).
 */
import { soundscape, type BedId, type Scape, type ScapeInput, type SpotRule, type SpotSource } from "@millbrook/shared/view";

const PREF = "millbrook-sound";
const VOLUME_PREF = "millbrook-soundVolume";
/** Seconds a bed takes to reach a new volume. */
const FADE = 2.5;
/** Most beds playing at once. */
const MAX_BEDS = 8;

interface Bed {
  gain: GainNode;
  stop: () => void;
  level: number;
}

export class SoundEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private beds = new Map<BedId, Bed>();
  private scape: Scape = { beds: {}, spots: [] };
  private next = new Map<string, number>();
  private played = new Map<string, number>();
  private timer: number | null = null;
  on: boolean;
  /** The master volume, 0..1 (remembered in this browser, like on and off). */
  volume: number;

  constructor() {
    let saved = "on";
    let vol: string | null = null;
    try {
      saved = localStorage.getItem(PREF) ?? "on";
      vol = localStorage.getItem(VOLUME_PREF);
    } catch {
      /* private window: default on */
    }
    this.on = saved !== "off";
    const v = vol === null ? NaN : Number(vol);
    this.volume = Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0.6;
    const start = () => {
      if (this.on) this.start();
    };
    window.addEventListener("pointerdown", start, { once: false });
    window.addEventListener("keydown", start, { once: false });
    document.addEventListener("visibilitychange", () => {
      if (!this.ctx) return;
      if (document.visibilityState === "visible" && this.on) void this.ctx.resume();
      else void this.ctx.suspend();
    });
  }

  /** Turn sound on or off (remembered in this browser). */
  setOn(on: boolean): void {
    this.on = on;
    try {
      localStorage.setItem(PREF, on ? "on" : "off");
    } catch {
      /* not remembered */
    }
    if (!on) {
      for (const id of [...this.beds.keys()]) this.dropBed(id, 0.3);
      void this.ctx?.suspend();
    } else this.start();
  }

  /** Set the master volume, 0..1 (remembered in this browser). */
  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v));
    try {
      localStorage.setItem(VOLUME_PREF, String(this.volume));
    } catch {
      /* not remembered */
    }
    if (this.ctx && this.master) this.master.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.05);
  }

  private start(): void {
    if (this.ctx) {
      if (this.ctx.state !== "running") void this.ctx.resume();
      return;
    }
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(this.ctx.destination);
    const len = this.ctx.sampleRate * 2;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this.timer = window.setInterval(() => this.tick(), 250);
    this.apply();
  }

  /** New facts from the frame: work out the mix again. */
  setInput(input: ScapeInput | undefined): void {
    this.scape = input ? soundscape(input) : { beds: {}, spots: [] };
    this.apply();
  }

  private apply(): void {
    if (!this.ctx || !this.on) return;
    const want = (Object.entries(this.scape.beds) as Array<[BedId, number]>).filter(([, v]) => v > 0.01).sort((a, b) => b[1] - a[1]).slice(0, MAX_BEDS);
    const keep = new Set(want.map(([id]) => id));
    for (const id of [...this.beds.keys()]) if (!keep.has(id)) this.dropBed(id, FADE);
    for (const [id, v] of want) {
      let b = this.beds.get(id);
      if (!b) {
        b = this.makeBed(id);
        this.beds.set(id, b);
      }
      b.level = v;
      b.gain.gain.setTargetAtTime(v, this.ctx.currentTime, FADE / 3);
    }
  }

  private dropBed(id: BedId, seconds: number): void {
    const b = this.beds.get(id);
    if (!b || !this.ctx) return;
    this.beds.delete(id);
    b.gain.gain.setTargetAtTime(0, this.ctx.currentTime, seconds / 3);
    window.setTimeout(() => b.stop(), seconds * 1000 + 300);
  }

  // ---------- beds ----------

  private noiseSource(): AudioBufferSourceNode {
    const src = this.ctx!.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    src.loopStart = Math.random() * 1.5;
    return src;
  }

  private filter(type: BiquadFilterType, f: number, q = 0.7): BiquadFilterNode {
    const n = this.ctx!.createBiquadFilter();
    n.type = type;
    n.frequency.value = f;
    n.Q.value = q;
    return n;
  }

  /** A slow wobble on a parameter (gusts, waves, voices rising and falling). */
  private lfo(target: AudioParam, rate: number, depth: number): OscillatorNode {
    const o = this.ctx!.createOscillator();
    o.frequency.value = rate;
    const g = this.ctx!.createGain();
    g.gain.value = depth;
    o.connect(g).connect(target);
    o.start();
    return o;
  }

  private makeBed(id: BedId): Bed {
    const ctx = this.ctx!;
    const out = ctx.createGain();
    out.gain.value = 0;
    out.connect(this.master!);
    const nodes: Array<{ stop(): void }> = [];
    const noiseThrough = (...chain: AudioNode[]) => {
      const src = this.noiseSource();
      let at: AudioNode = src;
      for (const n of chain) at = at.connect(n);
      at.connect(out);
      src.start();
      nodes.push(src);
    };
    switch (id) {
      case "rain_roof":
        noiseThrough(this.filter("bandpass", 2500, 0.6), this.filter("highpass", 800));
        break;
      case "rain_open":
        noiseThrough(this.filter("bandpass", 1600, 0.5));
        break;
      case "storm": {
        const g = ctx.createGain();
        noiseThrough(this.filter("lowpass", 220), g);
        nodes.push(this.lfo(g.gain, 0.15, 0.5));
        break;
      }
      case "wind": {
        const f = this.filter("lowpass", 500, 1.2);
        noiseThrough(f);
        nodes.push(this.lfo(f.frequency, 0.08, 250));
        break;
      }
      case "snow_hush":
        noiseThrough(this.filter("lowpass", 180));
        break;
      case "river":
        noiseThrough(this.filter("bandpass", 650, 0.8));
        break;
      case "sea": {
        const g = ctx.createGain();
        noiseThrough(this.filter("lowpass", 600), g);
        nodes.push(this.lfo(g.gain, 0.1, 0.6));
        break;
      }
      case "crowd_murmur":
      case "market":
      case "tavern": {
        // Several bands of voices, each rising and falling at the pace of speech.
        for (const [f, rate] of [[320, 3.1], [560, 4.3], [800, 2.7]] as const) {
          const g = ctx.createGain();
          g.gain.value = 0.35;
          noiseThrough(this.filter("bandpass", id === "market" ? f * 1.2 : f, 3), g);
          nodes.push(this.lfo(g.gain, rate, 0.3));
        }
        break;
      }
      case "insects_night": {
        const g = ctx.createGain();
        noiseThrough(this.filter("highpass", 4500), this.filter("bandpass", 6000, 6), g);
        nodes.push(this.lfo(g.gain, 18, 0.8));
        break;
      }
      case "frogs": {
        const o = ctx.createOscillator();
        o.type = "square";
        o.frequency.value = 220;
        const g = ctx.createGain();
        g.gain.value = 0.05;
        o.connect(this.filter("lowpass", 700)).connect(g).connect(out);
        o.start();
        nodes.push(o, this.lfo(g.gain, 2.2, 0.05));
        break;
      }
      case "fire_hearth":
        noiseThrough(this.filter("bandpass", 900, 0.6), this.filter("lowpass", 2500));
        break;
      case "birds_day":
      case "birds_dawn":
      case "music":
        // Made of notes, played in `tick` while the bed stands.
        break;
    }
    return { gain: out, level: 0, stop: () => {
      for (const n of nodes) {
        try {
          n.stop();
        } catch {
          /* already stopped */
        }
      }
      out.disconnect();
    } };
  }

  // ---------- notes and spots ----------

  private tone(freq: number, to: number, start: number, dur: number, gain: number, pan = 0, type: OscillatorType = "sine", dest?: AudioNode): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, start);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, to), start + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, start);
    g.gain.linearRampToValueAtTime(gain, start + Math.min(0.02, dur / 4));
    g.gain.exponentialRampToValueAtTime(0.0005, start + dur);
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    o.connect(g).connect(p).connect(dest ?? this.master!);
    o.start(start);
    o.stop(start + dur + 0.05);
  }

  private burst(f: number, start: number, dur: number, gain: number, pan = 0, q = 1, type: BiquadFilterType = "bandpass"): void {
    const ctx = this.ctx!;
    const src = this.noiseSource();
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, start);
    g.gain.exponentialRampToValueAtTime(0.0005, start + dur);
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    src.connect(this.filter(type, f, q)).connect(g).connect(p).connect(this.master!);
    src.start(start);
    src.stop(start + dur + 0.05);
  }

  private playSpot(s: SpotRule): void {
    const t = this.ctx!.currentTime + 0.02;
    const pan = Math.max(-1, Math.min(1, s.dx / 15));
    const g = s.gain * 0.5;
    const play: Record<SpotSource, () => void> = {
      hammer: () => (this.burst(2200, t, 0.08, g, pan, 2), this.tone(1800, 1700, t, 0.25, g * 0.5, pan, "triangle")),
      bell: () => [440, 880, 1320, 1760].forEach((f, k) => this.tone(f, f * 0.998, t, 3.5 - k * 0.6, g * (0.6 / (k + 1)), pan)),
      owl: () => (this.tone(420, 380, t, 0.35, g * 0.5, pan), this.tone(400, 360, t + 0.6, 0.6, g * 0.5, pan)),
      dog: () => (this.burst(700, t, 0.12, g, pan, 2), this.burst(650, t + 0.25, 0.12, g, pan, 2)),
      cart: () => this.burst(150, t, 1.6, g * 0.6, pan, 0.6, "lowpass"),
      horse: () => this.tone(520, 300, t, 0.6, g * 0.4, pan, "sawtooth"),
      thunder: () => this.burst(90, t, 3, g, pan, 0.5, "lowpass"),
      watch: () => [0, 0.6, 1.2, 1.8].forEach((k) => this.burst(300, t + k, 0.05, g * 0.6, pan, 3)),
      woodpecker: () => Array.from({ length: 10 }, (_, k) => this.burst(1500, t + k * 0.05, 0.02, g * 0.6, pan, 4)),
      crow: () => (this.tone(900, 650, t, 0.3, g * 0.5, pan, "sawtooth"), this.tone(880, 620, t + 0.45, 0.3, g * 0.5, pan, "sawtooth")),
      hawk: () => this.tone(2300, 1500, t, 0.9, g * 0.4, pan),
      wolf_howl: () => (this.tone(300, 520, t, 1.2, g * 0.4, pan), this.tone(520, 340, t + 1.2, 1.4, g * 0.4, pan)),
      cheer: () => this.burst(1100, t, 0.9, g * 0.6, pan, 0.8),
      shout: () => this.burst(800, t, 0.5, g * 0.7, pan, 2),
      children: () => [0, 0.18, 0.5].forEach((k, n) => this.tone(900 + n * 180, 1300 + n * 120, t + k, 0.14, g * 0.35, pan, "triangle")),
      livestock: () => this.tone(150, 118, t, 1.3, g * 0.35, pan, "sawtooth"),
    };
    play[s.source]();
  }

  /** Birdsong: a few chirps now and then, more at dawn. */
  private chirps(level: number, dawn: boolean): void {
    const t = this.ctx!.currentTime;
    if (Math.random() > (dawn ? 0.6 : 0.25)) return;
    const base = 2200 + Math.random() * 2400;
    const pan = Math.random() * 1.6 - 0.8;
    for (let k = 0; k < 2 + Math.floor(Math.random() * 4); k++) this.tone(base * (1 + Math.random() * 0.3), base * (0.8 + Math.random() * 0.5), t + k * 0.11, 0.09, level * 0.18, pan);
  }

  /** Festival music: a pipe's tune on a pentatonic scale, a note at a time. */
  private note(level: number): void {
    const scale = [392, 440, 494, 587, 659, 784];
    const f = scale[Math.floor(Math.random() * scale.length)]!;
    this.tone(f, f, this.ctx!.currentTime, 0.28, level * 0.15, 0, "triangle");
  }

  private tick(): void {
    if (!this.ctx || !this.on || this.ctx.state !== "running") return;
    const now = this.ctx.currentTime;
    const birds = this.beds.get("birds_dawn") ?? this.beds.get("birds_day");
    if (birds) this.chirps(birds.level, this.beds.has("birds_dawn"));
    const music = this.beds.get("music");
    if (music && Math.random() < 0.9) this.note(music.level);
    // Spots: each plays again after its own wait; a sound for a moment (the bell's hour) plays once.
    const live = new Set(this.scape.spots.map((s) => s.id));
    for (const id of [...this.next.keys()]) if (!live.has(id)) this.next.delete(id);
    let playing = 0;
    for (const s of this.scape.spots) {
      if (playing >= 6) break;
      if (s.every[1] === 0) {
        if (this.played.has(s.id)) continue;
        this.played.set(s.id, now);
        this.playSpot(s);
        playing++;
        continue;
      }
      const at = this.next.get(s.id);
      if (at === undefined) {
        this.next.set(s.id, now + s.every[0] * Math.random());
        continue;
      }
      if (now < at) continue;
      this.playSpot(s);
      playing++;
      this.next.set(s.id, now + s.every[0] + Math.random() * (s.every[1] - s.every[0]));
    }
    if (this.played.size > 50) this.played.clear();
  }

  dispose(): void {
    if (this.timer !== null) window.clearInterval(this.timer);
    void this.ctx?.close();
  }
}
