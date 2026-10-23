/**
 * The second adapter (G5): a plain <canvas> and plain DOM, no Phaser and no art. It plays the whole game through the
 * core and the protocol: squares for the land, dots for people, text for the panels. If it ever needs something the
 * protocol doesn't carry, the protocol is what's missing (it is the proof that an engine needs no game rules).
 */
import type { Actor, Frame, GameEvent, Intent, PromptMsg, SpeechMsg, UiAction, UiModel } from "@millbrook/shared/view";
import { Core, type ConnectionStatus, type EngineAdapter, type FrameChange } from "../../core";

const W = 26;
const H = 18;
const T = 24;
const COLOURS: Record<string, string> = {
  "terrain/grass": "#4a7a3f", "terrain/path": "#a88b5e", "terrain/water": "#3b6fa5", "terrain/sand": "#c9b37a", "terrain/hill": "#7d8a55",
  "terrain/marsh": "#55704a", "terrain/field": "#a3a04a", "terrain/ford": "#6b93b8", "terrain/bridge": "#8a6a44", "terrain/town": "#8a8478",
  "terrain/yard": "#9a8a62", "terrain/road": "#b39466",
};
const OBJECTS: Record<string, string> = { "props/tree": "#2f5a2c", "props/rock": "#7a7a72", "props/reeds": "#6b8a4a", "buildings/wall": "#5d5a52", "buildings/door": "#5b3d22", "buildings/gate": "#6b4a2a", "props/thatch": "#b59a5a", "props/farmhouse": "#8a6a44" };

const $ = (id: string) => document.getElementById(id)!;
const make = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}): HTMLElementTagNameMap[K] => Object.assign(document.createElement(tag), props);

class CanvasAdapter implements EngineAdapter {
  private core!: Core;
  private ctx!: CanvasRenderingContext2D;
  private said = new Map<string, { text: string; until: number }>();
  private streaming: { npc: string; text: string } | null = null;
  private tab = "skills";

  start(core: Core): void {
    this.core = core;
    const canvas = $("world") as HTMLCanvasElement;
    canvas.width = W * T;
    canvas.height = H * T;
    this.ctx = canvas.getContext("2d")!;
    canvas.onclick = (e) => {
      const r = canvas.getBoundingClientRect();
      const o = this.cornerTile();
      this.send({ t: "click", x: Math.floor(((e.clientX - r.left) / r.width) * W) + o.x, y: Math.floor(((e.clientY - r.top) / r.height) * H) + o.y });
    };
    const keys: Record<string, [-1 | 0 | 1, -1 | 0 | 1]> = { arrowup: [0, -1], w: [0, -1], arrowdown: [0, 1], s: [0, 1], arrowleft: [-1, 0], a: [-1, 0], arrowright: [1, 0], d: [1, 0] };
    addEventListener("keydown", (e) => {
      if (["INPUT", "SELECT"].includes(document.activeElement?.tagName ?? "")) return;
      const k = e.key.toLowerCase();
      if (keys[k]) {
        e.preventDefault();
        this.send({ t: "step", dx: keys[k][0], dy: keys[k][1] });
      } else if (k === "e") this.send({ t: "interact" });
      else if (k === "f") this.send({ t: "fight" });
      else if (k === "r") this.send({ t: "flee" });
      else if (k === "escape") this.send(this.core.ui?.chat.open ? { t: "close" } : { t: "cancel" });
    });
    ($("say") as HTMLFormElement).onsubmit = (e) => {
      e.preventDefault();
      const line = $("line") as HTMLInputElement;
      this.send({ t: "say", mode: ($("mode") as HTMLSelectElement).value, text: line.value });
      line.value = "";
    };
    document.addEventListener("visibilitychange", () => this.send({ t: "view", hidden: document.visibilityState !== "visible" }));
    const loop = () => {
      this.draw();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  private send(i: Intent): void {
    this.core.send(i);
  }

  /** The tile at the canvas's top-left: the view centred on the player, kept inside a place's map. */
  private cornerTile(): { x: number; y: number } {
    const m = this.core.frame;
    let x = Math.round(m.player.x) - Math.floor(W / 2);
    let y = Math.round(m.player.y) - Math.floor(H / 2);
    if (m.map?.kind === "place" && m.map.w && m.map.h) {
      x = Math.max(0, Math.min(m.map.w - W, x));
      y = Math.max(0, Math.min(m.map.h - H, y));
    }
    return { x, y };
  }

  private draw(): void {
    const m = this.core.frame;
    const c = this.ctx;
    const o = this.cornerTile();
    c.fillStyle = "#1d2026";
    c.fillRect(0, 0, W * T, H * T);
    for (let j = 0; j < H; j++) {
      for (let i = 0; i < W; i++) {
        const t = m.tileAt(o.x + i, o.y + j);
        if (!t) continue;
        c.fillStyle = COLOURS[t.ground] ?? "#4a7a3f";
        c.fillRect(i * T, j * T, T, T);
        if (t.object) {
          c.fillStyle = OBJECTS[t.object] ?? "#555";
          c.fillRect(i * T + 4, j * T + 4, T - 8, T - 8);
        }
      }
    }
    for (const b of m.buildings) {
      c.fillStyle = b.color;
      c.fillRect((b.x - o.x) * T, (b.y - o.y) * T, b.w * T, b.h * T);
      if (b.lit) {
        c.fillStyle = "#ffd27a";
        c.fillRect((b.x - o.x + b.w / 2) * T - 4, (b.y - o.y + b.h) * T - 8, 8, 5);
      }
      c.fillStyle = "#f3e9d2";
      c.font = "11px sans-serif";
      c.fillText(b.label, (b.x - o.x) * T + 3, (b.y - o.y) * T + 13);
    }
    c.font = "10px sans-serif";
    for (const s of m.signs) {
      c.fillStyle = "#ffd27a";
      c.fillText(s.text, Math.max(2, Math.min(W * T - 120, (s.x - o.x) * T)), (s.y - o.y) * T + 14);
    }
    const now = performance.now();
    const target = m.prompt?.target;
    for (const a of m.actors.values()) this.drawActor(a, o, a.id === target, now);
    if (m.prompt) {
      c.fillStyle = m.prompt.tone === "danger" ? "#ff8a7a" : "#ffd27a";
      c.font = "bold 12px sans-serif";
      c.fillText(m.prompt.text, (m.prompt.x - o.x) * T - 20, (m.prompt.y - o.y + 1) * T + 12);
    }
    if (m.fight) {
      const left = Math.max(0, m.fight.secondsLeft - (now - m.fight.at) / 1000);
      c.fillStyle = "#e0675b";
      c.fillText(`your move: ${Math.ceil(left)}s`, 6, H * T - 8);
    }
    c.fillStyle = `rgba(10,16,48,${(1 - m.ambience.light) * 0.45})`;
    c.fillRect(0, 0, W * T, H * T);
  }

  private drawActor(a: Actor, o: { x: number; y: number }, hl: boolean, now: number): void {
    const c = this.ctx;
    const x = (a.x - o.x + 0.5) * T;
    const y = (a.y - o.y + 0.5) * T;
    if (x < -T || y < -T || x > W * T + T || y > H * T + T) return;
    c.fillStyle = a.flags.includes("dead") ? "#999" : (a.look.tint ?? "#ccc");
    c.beginPath();
    if (a.look.sprite.startsWith("creature/")) c.rect(x - 8, y - 6, 16, 12);
    else c.arc(x, y, a.kind === "folk" ? 6 : 8, 0, Math.PI * 2);
    c.fill();
    if (a.kind === "player") {
      c.strokeStyle = "#ffd27a";
      c.lineWidth = 2;
      c.stroke();
    }
    const label = a.kind === "folk" && !hl ? null : a.kind === "creature" || a.kind === "traveller" ? (hl ? a.label : a.shortLabel) : a.label;
    if (label) {
      c.fillStyle = hl ? "#ffd27a" : "#fff";
      c.font = "10px sans-serif";
      c.fillText(label, x - c.measureText(label).width / 2, y - 11);
    }
    if (a.hp !== undefined && a.hp < 1 && !a.flags.includes("dead")) {
      c.fillStyle = "#000";
      c.fillRect(x - 10, y + 9, 20, 3);
      c.fillStyle = "#e0675b";
      c.fillRect(x - 10, y + 9, 20 * a.hp, 3);
    }
    const said = this.said.get(a.id);
    if (said && said.until > now) {
      c.fillStyle = "#f3e9d2";
      c.font = "11px sans-serif";
      const t = said.text.length > 50 ? `…${said.text.slice(-48)}` : said.text;
      c.fillText(t, x - c.measureText(t).width / 2, y - 24);
    }
  }

  frame(f: Frame, _changed: FrameChange): void {
    const until = performance.now() + 3500;
    for (const ch of f.chatter ?? []) this.said.set(ch.a, { text: ch.lines[0], until }).set(ch.b, { text: ch.lines[1], until });
    for (const g of f.gossip ?? []) this.said.set(g.who, { text: g.text, until: until + 1500 });
  }

  event(e: GameEvent): void {
    if (e.type === "hp_changed") this.said.set(e.who, { text: `${e.to - e.from > 0 ? "+" : ""}${e.to - e.from} HP`, until: performance.now() + 1500 });
  }

  speech(s: SpeechMsg): void {
    if (s.thinking) this.said.set(s.npc, { text: "…", until: performance.now() + 60_000 });
    if (s.filler) this.said.set(s.npc, { text: s.filler, until: performance.now() + 4000 });
    if (s.delta !== undefined) {
      if (this.streaming?.npc !== s.npc) this.streaming = { npc: s.npc, text: "" };
      this.streaming.text += s.delta;
      this.said.set(s.npc, { text: this.streaming.text, until: performance.now() + 60_000 });
      $("streaming").textContent = this.streaming.text;
    }
    if (s.done) {
      const text = this.streaming?.text ?? "";
      this.said.set(s.npc, { text, until: performance.now() + 4000 });
      this.streaming = null;
      $("streaming").textContent = "";
    }
  }

  // ---------- panels: text and buttons ----------

  private button(a: UiAction): HTMLElement {
    const b = make("button", { textContent: a.label, disabled: !a.enabled, title: a.why ?? "" });
    if (!a.input) {
      b.onclick = () => this.send(a.intent);
      return b;
    }
    const box = make("input", { placeholder: a.input.placeholder, size: 8 });
    b.onclick = () => {
      const it = a.intent;
      if (it.t !== "act" || !box.value.trim()) return;
      const args: Record<string, unknown> = { ...(it.args ?? {}) };
      args[a.input!.arg] = box.value.trim();
      this.send({ t: "act", action: it.action, args });
    };
    const span: HTMLSpanElement = document.createElement("span");
    span.append(box, b);
    return span;
  }

  private sections(sections: UiModel["sheet"]["tabs"][number]["sections"]): HTMLElement[] {
    const out: HTMLElement[] = [];
    for (const s of sections) {
      if (s.title) out.push(make("h4", { textContent: s.title }));
      for (const r of s.rows) {
        const p = make("div", { textContent: r.value ? `${r.text}: ${r.value}` : r.text });
        for (const a of r.actions ?? []) p.append(" ", this.button(a));
        out.push(p);
      }
    }
    return out;
  }

  ui(u: UiModel, changed: Array<keyof UiModel>): void {
    const h = u.header;
    if (changed.includes("header")) {
      $("head").textContent = `${h.place} · ${h.clock} · ${h.today} · ${h.hp} · ${h.coin} · ${h.model.text}${h.simulate.note ? ` · ${h.simulate.note}` : ""}`;
      const tools = [...h.actions.map((a) => this.button(a))];
      if (h.time.shown) tools.push(this.button({ id: "time", label: h.time.flows ? "Time: flowing" : "Time: waiting", enabled: true, intent: { t: "time", flow: !h.time.flows } }));
      const running = h.simulate.speed !== "off";
      tools.push(this.button({ id: "sim", label: running ? "Stop simulating" : "Simulate", enabled: true, intent: { t: "simulate", speed: running ? "off" : "normal" } }));
      $("actions").replaceChildren(...tools);
    }
    if (changed.includes("feed")) $("feed").replaceChildren(...u.feed.lines.map((l) => make("div", { textContent: l.text })));
    if (changed.includes("chat")) {
      const c = u.chat;
      $("chat").hidden = !c.open;
      if (c.open) {
        $("who").textContent = `${c.name}: ${c.role}. ${c.stats.join(" · ")}`;
        $("log").replaceChildren(...c.log.map((l) => make("div", { textContent: `${l.kind.startsWith("note") ? "· " : l.kind === "you" ? "> " : ""}${l.text}` })));
        $("offers").replaceChildren(...c.offers.flatMap((o) => [make("div", { textContent: o.text }), ...o.actions.map((a) => this.button(a))]));
        $("tools").replaceChildren(...[...c.quick, ...c.tools, { id: "close", label: "Close", enabled: true, intent: { t: "close" } } as UiAction].map((a) => this.button(a)));
        const mode = $("mode") as HTMLSelectElement;
        if (mode.options.length !== c.modes.length) mode.replaceChildren(...c.modes.map((m) => new Option(m.label, m.id)));
      }
    }
    if (changed.includes("sheet")) {
      $("tabs").replaceChildren(...u.sheet.tabs.map((t) => {
        const b = make("button", { textContent: t.label });
        b.onclick = () => {
          this.tab = t.id;
          this.ui(u, ["sheet"]);
        };
        return b;
      }));
      $("sheet").replaceChildren(...this.sections((u.sheet.tabs.find((t) => t.id === this.tab) ?? u.sheet.tabs[0]!).sections));
    }
    if (changed.includes("roadbar")) $("road").replaceChildren(...(u.roadbar.shown ? [make("span", { textContent: u.roadbar.items.map((i) => (i.need !== undefined ? `${i.text} ${i.need}` : i.text)).join(" · ") + " " }), ...u.roadbar.actions.map((a) => this.button(a))] : []));
    if (changed.includes("modal")) {
      const m = u.modal;
      $("modal").hidden = !m;
      if (m) $("modal").replaceChildren(make("h4", { textContent: m.title }), make("div", { textContent: m.body }), ...this.sections(m.sections), ...m.actions.map((a) => this.button(a)), ...(m.kind === "situation" ? [] : [this.button({ id: "x", label: "Close", enabled: true, intent: { t: "panel", panel: null } })]));
    }
  }

  feed(lines: UiModel["feed"]["lines"]): void {
    for (const l of lines) $("feed").append(make("div", { textContent: l.text }));
    $("feed").scrollTop = $("feed").scrollHeight;
  }

  prompt(p: PromptMsg): void {
    const box = $("prompt");
    box.hidden = false;
    box.replaceChildren(make("h4", { textContent: p.title }), make("div", { textContent: p.body }), ...p.options.map((o) => {
      const b = make("button", { textContent: o.label });
      b.onclick = () => {
        box.hidden = true;
        this.send({ t: "answer", prompt: p.id, option: o.id });
      };
      return b;
    }));
  }

  status(s: ConnectionStatus): void {
    $("status").textContent = s.state === "open" ? "" : s.state === "connecting" ? "Connecting…" : s.state === "replaced" ? "Playing in another window." : s.state === "replay" ? (s.done ? "Recording over." : "Playing a recording.") : s.text;
  }
}

new Core({ view: { w: W, h: H }, engine: "canvas", replay: new URLSearchParams(location.search).get("replay") }).start(new CanvasAdapter());
