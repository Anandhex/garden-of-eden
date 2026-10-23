/**
 * The web adapter's panels (G5): the header, the feed, the chat, the side sheet, the road bar and the dialogs,
 * laid out in the DOM from the server's UI model. Every sentence and every button comes from the server; this
 * only decides where they go. Text is only ever inserted with textContent.
 */
import { DEFAULT_VOICE, type Intent, type NpcVoice, type PromptMsg, type RealmView, type SpeechMsg, type UiAction, type UiModel } from "@millbrook/shared/view";
import type { Core } from "../../core";
import { $, el } from "../../dom";
import { drawRealmMap, realmLegend } from "../../realmMap";
import { micSupported, PushToTalk } from "./voice/mic";
import { speaker } from "./voice/speaker";

type Section = UiModel["sheet"]["tabs"][number]["sections"][number];
const TAB_KEY = "millbrook-tab";

export class Panels {
  private tab = (() => {
    try {
      return localStorage.getItem(TAB_KEY) ?? "skills";
    } catch {
      return "skills";
    }
  })();
  /** The reply streaming into the chat: its element and who says it. */
  private streaming: { npc: string; el: HTMLDivElement; text: string } | null = null;
  private waiting: HTMLDivElement | null = null;
  private onVoices: () => void = () => {};
  /** What the visible tab last showed: it is rebuilt only when that changes (so a button isn't swapped under the pointer). */
  private shown = "";
  private same = new Map<string, string>();

  /** True when `value` is what `key` showed last time (and remembers it). */
  private unchanged(key: string, value: unknown): boolean {
    const json = JSON.stringify(value);
    if (this.same.get(key) === json) return true;
    this.same.set(key, json);
    return false;
  }

  constructor(private readonly core: Core) {}

  private get ui(): UiModel | null {
    return this.core.ui;
  }

  // ---------- buttons ----------

  /** A button for a server action. With `input`, the value of a box beside it goes into the intent. */
  action(a: UiAction, small = false): HTMLElement {
    const b = el("button", { type: "button", textContent: a.label, disabled: !a.enabled, title: a.why ?? "", className: [small ? "small" : "", a.style ?? ""].join(" ").trim() });
    if (!a.input) {
      b.onclick = () => this.send(a.intent);
      return b;
    }
    const box = el("input", { placeholder: a.input.placeholder, size: 10 });
    b.onclick = () => {
      const v = box.value.trim();
      if (!v || a.intent.t !== "act") return;
      this.send({ ...a.intent, args: { ...(a.intent.args ?? {}), [a.input!.arg]: v } });
    };
    const wrap = el("span", { className: "with-input" });
    wrap.append(box, b);
    return wrap;
  }

  send(i: Intent): void {
    this.core.send(i);
  }

  // ---------- everything ----------

  render(ui: UiModel, changed: Array<keyof UiModel>): void {
    const all = changed.length === 0;
    const has = (k: keyof UiModel) => all || changed.includes(k);
    if (has("header")) this.header(ui.header);
    if (has("feed")) this.feedAll(ui.feed.lines);
    if (has("chat")) this.chat(ui.chat);
    if (has("sheet") || has("realm")) this.sheet();
    if (has("roadbar")) this.roadbar(ui.roadbar);
    if (has("modal")) this.modal(ui.modal);
  }

  private header(h: UiModel["header"]): void {
    $("site-name").textContent = h.place;
    $("site-name").title = h.placeTip;
    document.title = h.place;
    $("time").textContent = h.clock;
    $("today").textContent = h.today;
    $("today").title = h.todayTip;
    $("hpbar").textContent = h.hp;
    $("mpbar").textContent = h.mp;
    $("gold").textContent = h.coin;
    $("llm").textContent = h.model.text;
    $("llm").className = `pill ${h.model.ready ? "ok" : "err"}`;
    $("banner").hidden = !h.model.banner;
    $("banner").textContent = h.model.banner;
    if (!this.unchanged("actions", h.actions)) $("actions").replaceChildren(...h.actions.map((a) => this.action(a)));
    const time = $<HTMLButtonElement>("time-btn");
    time.hidden = !h.time.shown;
    time.textContent = h.time.flows ? "⏸ Time" : "▶ Time";
    time.title = h.time.flows ? "Time flows while you stand about. Click to make it wait for you." : "Time waits for you. Click to let it flow while you stand about.";
    time.classList.toggle("on", h.time.flows);
    time.onclick = () => this.send({ t: "time", flow: !h.time.flows });
    const sim = $<HTMLButtonElement>("sim-btn");
    const speed = $<HTMLSelectElement>("sim-speed");
    const running = h.simulate.speed !== "off";
    if (speed.options.length !== h.simulate.speeds.length) {
      speed.replaceChildren(...h.simulate.speeds.map((x) => new Option(x.label, x.id)));
      speed.value = "normal";
    }
    sim.textContent = running ? "⏸ Stop" : "▶ Simulate";
    sim.classList.toggle("on", running);
    if (running) speed.value = h.simulate.speed;
    sim.onclick = () => this.send({ t: "simulate", speed: running ? "off" : (speed.value as "normal") });
    speed.onchange = () => running && this.send({ t: "simulate", speed: speed.value as "normal" });
    $("sim-status").hidden = !h.simulate.note;
    $("sim-status").textContent = h.simulate.note ?? "";
    const vb = $("voice-btn");
    vb.classList.toggle("off", !speaker.prefs.voices);
    vb.textContent = speaker.prefs.voices ? "🔊 Voices" : "🔇 Voices";
    for (const b of document.querySelectorAll<HTMLButtonElement>("#form button, #form input, #form select")) b.disabled = h.busy;
  }

  // ---------- the feed ----------

  private feedAll(lines: UiModel["feed"]["lines"]): void {
    $("feed").replaceChildren();
    this.feed(lines);
  }

  feed(lines: UiModel["feed"]["lines"]): void {
    const box = $("feed");
    for (const l of lines) box.append(el("p", { textContent: l.text, className: l.kind === "line" ? "" : l.kind }));
    while (box.childElementCount > 200) box.firstElementChild!.remove();
    box.scrollTop = box.scrollHeight;
  }

  // ---------- the conversation ----------

  private chat(c: UiModel["chat"]): void {
    $("chat").hidden = !c.open;
    if (!c.open) {
      this.streaming = null;
      this.waiting = null;
      return;
    }
    $("chat-name").textContent = c.name;
    $("chat-role").textContent = c.role;
    $("chat-stats").replaceChildren(...c.stats.map((s) => el("span", { textContent: s })));
    const log = $("log");
    log.replaceChildren(...c.log.map((m) => el("div", { className: m.kind.startsWith("note") ? m.kind : `msg ${m.kind}`, textContent: m.text })));
    // A reply still coming in stays at the end.
    if (this.streaming && this.streaming.npc && this.streaming.el.classList.contains("typing")) log.append(this.streaming.el);
    if (this.waiting) log.append(this.waiting);
    log.scrollTop = log.scrollHeight;
    $("offers").replaceChildren(
      ...c.offers.map((o) => {
        const line = el("div", { className: "offer" });
        const btns = el("div", { className: "btns" });
        btns.append(...o.actions.map((a) => this.action(a)));
        line.append(el("span", { textContent: o.text }), btns);
        return line;
      }),
    );
    $("quick").replaceChildren(...c.quick.map((a) => this.action(a)));
    $("tools").replaceChildren(...c.tools.map((a) => this.action(a)));
    const mode = $<HTMLSelectElement>("mode");
    const keep = mode.value;
    if (mode.options.length !== c.modes.length) {
      mode.replaceChildren(...c.modes.map((m) => new Option(m.label, m.id)));
      mode.value = c.modes.some((m) => m.id === keep) ? keep : "say";
    }
    $<HTMLInputElement>("line").placeholder = c.modes.find((m) => m.id === mode.value)?.placeholder ?? "Say something…";
  }

  /** Who is speaking, by name, when it isn't the one the chat is with (a group scene, N6.5). */
  private nameOf(npc: string): string | null {
    const c = this.ui?.chat;
    if (!c?.open || c.npc === npc) return null;
    return this.ui?.cast.find((x) => x.id === npc)?.name ?? null;
  }

  /** Speech from the server: into the chat as it streams, and to the voices. Returns the line so far, for the bubble. */
  speech(s: SpeechMsg): { text: string | null; done?: boolean; filler?: boolean } | null {
    const voice = (s.voice as NpcVoice | null) ?? DEFAULT_VOICE;
    const log = $("log");
    const open = this.ui?.chat.open === true;
    if (s.thinking) {
      if (open) {
        this.waiting?.remove();
        this.waiting = el("div", { className: "msg npc waiting" });
        log.append(this.waiting);
        log.scrollTop = log.scrollHeight;
      }
      return { text: null };
    }
    if (s.filler !== undefined) {
      if (open) log.insertBefore(el("div", { className: "msg npc filler", textContent: s.filler }), this.waiting);
      speaker.say(s.npc, s.filler, voice);
      return { text: s.filler, filler: true };
    }
    if (s.delta !== undefined) {
      this.waiting?.remove();
      this.waiting = null;
      if (!this.streaming || this.streaming.npc !== s.npc || !this.streaming.el.classList.contains("typing")) {
        const other = this.nameOf(s.npc);
        this.streaming = { npc: s.npc, el: el("div", { className: `msg ${other ? "npc other" : "npc"} typing` }), text: other ? `${other}: ` : "" };
        if (open) log.append(this.streaming.el);
      }
      this.streaming.text += s.delta;
      this.streaming.el.textContent = this.streaming.text;
      log.scrollTop = log.scrollHeight;
      speaker.text(s.npc, s.delta, voice);
      return { text: this.streaming.text.replace(/^[^:]+: /, "") };
    }
    if (s.done) {
      this.waiting?.remove();
      this.waiting = null;
      const st = this.streaming;
      this.streaming = null;
      st?.el.classList.remove("typing");
      speaker.end(s.npc, voice);
      return { text: st ? st.text.replace(/^[^:]+: /, "") : null, done: true };
    }
    return null;
  }

  // ---------- the side sheet ----------

  private sheet(): void {
    const ui = this.ui;
    if (!ui?.sheet) return;
    for (const b of $("tabs").querySelectorAll<HTMLElement>("[data-tab]")) b.classList.toggle("on", b.dataset.tab === this.tab);
    const body = $("tab-body");
    const tab = ui.sheet.tabs.find((t) => t.id === this.tab) ?? ui.sheet.tabs[0]!;
    const json = JSON.stringify([tab, tab.id === "realm" ? ui.realm : null]);
    if (json === this.shown) return;
    this.shown = json;
    const out: Array<HTMLElement | SVGElement> = [];
    if (tab.id === "realm" && ui.realm) {
      const r = ui.realm as unknown as RealmView & { here: string; selected: string | null };
      out.push(drawRealmMap(r, { here: r.here, selected: r.selected, onPick: (id) => this.send({ t: "select", what: "realm", id }) }), realmLegend(r));
    }
    out.push(...this.sections(tab.sections));
    const scroll = body.scrollTop;
    body.replaceChildren(...out);
    body.scrollTop = scroll;
  }

  /** Sections of rows: a heading, then text, key and value, a bar, buttons. */
  sections(sections: Section[]): HTMLElement[] {
    const out: HTMLElement[] = [];
    for (const s of sections) {
      if (s.title) out.push(el("h3", { textContent: s.title }));
      for (const r of s.rows) {
        if (r.value === undefined && !r.actions?.length) out.push(el("p", { className: "empty", textContent: r.text }));
        else {
          const row = el("div", { className: "row" });
          row.append(el("span", { textContent: r.text }));
          if (r.value) row.append(el("span", { textContent: r.value }));
          for (const a of r.actions ?? []) row.append(this.action(a, true));
          out.push(row);
        }
        if (r.bar !== undefined) {
          const wrap = el("div", { className: "bar" });
          const i = el("i");
          i.style.width = `${r.bar * 100}%`;
          wrap.append(i);
          out.push(wrap);
        }
      }
    }
    return out;
  }

  setTab(t: string): void {
    this.tab = t;
    try {
      localStorage.setItem(TAB_KEY, t);
    } catch {
      // remembered for this page only
    }
    this.sheet();
  }

  /** Something came to the player: the inventory tab pulses. */
  pulseInventory(): void {
    const tab = document.querySelector<HTMLElement>('[data-tab="inv"]');
    if (!tab) return;
    tab.classList.remove("pulse");
    void tab.offsetWidth;
    tab.classList.add("pulse");
  }

  // ---------- the road bar ----------

  private roadbar(r: UiModel["roadbar"]): void {
    const bar = $("roadbar");
    bar.hidden = !r.shown;
    if (!r.shown || this.unchanged("roadbar", r)) return;
    const items = r.items.map((i) => {
      if (i.need === undefined) return el("span", { className: i.dim ? "dim" : "", textContent: i.text });
      const s = el("span", { className: `need${i.need < 25 ? " low" : ""}` });
      const b = el("i");
      const fill = document.createElement("b");
      fill.style.width = `${Math.max(0, Math.min(100, i.need))}%`;
      b.append(fill);
      s.append(i.text, b);
      return s;
    });
    bar.replaceChildren(...items, el("span", { className: "spacer" }), ...r.actions.map((a) => this.action(a)));
  }

  // ---------- dialogs ----------

  private modal(m: UiModel["modal"]): void {
    const dialog = $<HTMLDialogElement>("modal");
    if (!m) {
      if (dialog.open && dialog.dataset.kind !== "voices") dialog.close();
      return;
    }
    dialog.dataset.kind = m.kind;
    const body = $("modal-body");
    body.replaceChildren(el("h3", { textContent: m.title }));
    if (m.body) body.append(el("p", { textContent: m.body }));
    body.append(...this.sections(m.sections));
    if (m.actions.length) {
      const choices = el("div", { className: "choices" });
      choices.append(...m.actions.map((a) => this.action(a)));
      body.append(choices);
    }
    if (!dialog.open) dialog.showModal();
  }

  /** The Close button: a server dialog is closed by the server (a situation on the road can't be). */
  closeModal(): void {
    const dialog = $<HTMLDialogElement>("modal");
    if (dialog.dataset.kind === "voices" || !this.ui?.modal) dialog.close();
    else if (this.ui.modal.kind !== "situation") this.send({ t: "panel", panel: null });
  }

  /** A question from the server (a confirm, a price): its options are the answers. */
  prompt(p: PromptMsg): void {
    const dialog = $<HTMLDialogElement>("prompt");
    const body = $("prompt-body");
    body.replaceChildren(el("h3", { textContent: p.title }), el("p", { textContent: p.body }));
    const choices = el("div", { className: "choices" });
    for (const o of p.options) {
      const b = el("button", { type: "button", textContent: o.label });
      b.onclick = () => {
        dialog.close();
        this.send({ t: "answer", prompt: p.id, option: o.id });
      };
      choices.append(b);
    }
    body.append(choices);
    if (!dialog.open) dialog.showModal();
  }

  /** Voice settings (T14): this browser's own choices, and a sample of who sounds like what. */
  voices(onChange: () => void): void {
    this.onVoices = onChange;
    const dialog = $<HTMLDialogElement>("modal");
    dialog.dataset.kind = "voices";
    const body = $("modal-body");
    body.replaceChildren(el("h3", { textContent: "Voices" }));
    const p = speaker.prefs;
    const toggle = (label: string, hint: string, checked: boolean, set: (v: boolean) => void, disabled = false) => {
      const r = el("label", { className: "voice-row" });
      const text = el("span", { textContent: label });
      text.append(el("small", { textContent: hint }));
      const box = el("input", { type: "checkbox", checked, disabled });
      box.onchange = () => (set(box.checked), this.onVoices());
      r.append(text, box);
      body.append(r);
    };
    toggle("NPCs speak aloud", speaker.available ? "Sentence by sentence, as they reply." : "This browser has no speech engine.", p.voices, (v) => speaker.setPrefs({ voices: v }), !speaker.available);
    const vol = el("label", { className: "voice-row" });
    vol.append(el("span", { textContent: "Volume" }));
    const range = el("input", { type: "range", min: "0", max: "1", step: "0.05", value: String(p.volume) });
    range.oninput = () => speaker.setPrefs({ volume: Number(range.value) });
    vol.append(range);
    body.append(vol);
    const piper = speaker.info.backend === "piper";
    toggle("Use the server's Piper voices", piper ? speaker.info.note : `${speaker.info.note} See the README (NPC voices) to set Piper up.`, piper && p.engine === "auto", (v) => speaker.setPrefs({ engine: v ? "auto" : "browser" }), !piper);
    toggle("Send what I say straight away", micSupported ? "Hold V or 🎙 to speak; let go to send. Off: the words wait in the box." : "This browser can't recognise speech (try Chrome, Edge or Safari).", p.micAutoSend, (v) => speaker.setPrefs({ micAutoSend: v }), !micSupported);
    body.append(el("h3", { textContent: "Who sounds like what" }));
    for (const n of this.ui?.cast ?? []) {
      const voice = n.voice as unknown as NpcVoice;
      const r = el("div", { className: "voice-row" });
      const who = el("span", { textContent: n.name });
      who.append(el("small", { textContent: speaker.usingPiper && voice.piper ? `Piper: ${voice.piper.model}${voice.piper.speaker !== undefined ? ` #${voice.piper.speaker}` : ""}` : speaker.browserVoiceName(n.id, voice) }));
      const test = el("button", { className: "small", textContent: "▶ Hear" });
      test.onclick = () => {
        speaker.stop();
        const was = speaker.prefs.voices;
        speaker.prefs.voices = true;
        speaker.say(n.id, n.sample, voice);
        speaker.prefs.voices = was;
      };
      r.append(who, test);
      body.append(r);
    }
    if (!dialog.open) dialog.showModal();
  }

  /** Push-to-talk: hold 🎙, or V when not typing. What's heard becomes a `say` intent. */
  setUpMic(): void {
    const btn = $<HTMLButtonElement>("mic");
    const line = $<HTMLInputElement>("line");
    if (!micSupported) return;
    btn.hidden = false;
    btn.title = "Hold to speak (or hold V). Your browser turns speech into text; where it can't do that on this device, its own speech service hears the audio.";
    let before = "";
    const talking = () => this.ui?.chat.open === true && !this.ui.header.busy;
    const ptt = new PushToTalk({
      onInterim: (text) => (line.value = before ? `${before} ${text}` : text),
      onFinal: (text) => {
        const said = before ? `${before} ${text}` : text;
        if (speaker.prefs.micAutoSend && talking()) {
          line.value = "";
          this.send({ t: "say", mode: $<HTMLSelectElement>("mode").value, text: said });
          $<HTMLSelectElement>("mode").value = "say";
        } else {
          line.value = said;
          line.focus();
        }
      },
      onState: (on) => {
        btn.classList.toggle("listening", on);
        line.classList.toggle("listening", on);
        if (on) speaker.stop(); // don't let the NPC hear themselves
      },
      onError: (message) => this.feed([{ id: -1, kind: "fail", text: message }]),
    });
    const start = () => {
      if (!talking()) return;
      before = line.value.trim();
      ptt.start();
    };
    btn.addEventListener("pointerdown", (e) => (e.preventDefault(), start()));
    for (const ev of ["pointerup", "pointerleave", "pointercancel"]) btn.addEventListener(ev, () => ptt.stop());
    addEventListener("keydown", (e) => {
      if (e.key.toLowerCase() !== "v" || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      if (["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement?.tagName ?? "") || $<HTMLDialogElement>("modal").open) return;
      e.preventDefault();
      start();
    });
    addEventListener("keyup", (e) => {
      if (e.key.toLowerCase() === "v" && ptt.isListening) ptt.stop();
    });
    addEventListener("blur", () => ptt.isListening && ptt.stop());
  }
}
