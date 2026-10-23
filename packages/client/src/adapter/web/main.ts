/**
 * The web adapter (G5): Phaser draws the world (world/WorldScene.ts), the DOM lays out the panels (panels.ts), and
 * the browser speaks (voice/). The core (../../core) holds the connection and what the server sent; this file maps
 * keys and clicks to intents. It decides how things look, never what is true or allowed.
 */
import "./style.css";
import type { Frame, GameEvent, PromptMsg, SpeechMsg, UiModel } from "@millbrook/shared/view";
import { Core, type ConnectionStatus, type EngineAdapter, type FrameChange } from "../../core";
import { $ } from "../../dom";
import { Panels } from "./panels";
import { speaker } from "./voice/speaker";
import { startWorld, VIEW_H, VIEW_W, type WorldScene } from "./world/WorldScene";

const KEYS: Record<string, [-1 | 0 | 1, -1 | 0 | 1]> = { ArrowUp: [0, -1], w: [0, -1], ArrowDown: [0, 1], s: [0, 1], ArrowLeft: [-1, 0], a: [-1, 0], ArrowRight: [1, 0], d: [1, 0] };

class WebAdapter implements EngineAdapter {
  private core!: Core;
  private panels!: Panels;
  private world!: WorldScene;

  start(core: Core): void {
    this.core = core;
    this.panels = new Panels(core);
    this.world = startWorld($("map"), core);
    this.panels.setUpMic();
    this.wire();
  }

  frame(f: Frame, changed: FrameChange): void {
    this.world.frame(changed, f);
  }

  event(e: GameEvent): void {
    this.world.event(e);
    if (e.type === "item_moved" && (e.to === "player" || e.from === "player")) this.panels.pulseInventory();
  }

  speech(s: SpeechMsg): void {
    const said = this.panels.speech(s);
    if (said) this.world.speech(s.npc, said.text, { done: said.done, filler: said.filler });
  }

  ui(u: UiModel, changed: Array<keyof UiModel>): void {
    const wasOpen = !$("chat").hidden;
    this.panels.render(u, changed);
    if (changed.includes("chat") && u.chat.open && !wasOpen) {
      speaker.stop();
      $("line").focus();
    }
    if (changed.includes("chat") && !u.chat.open && wasOpen) speaker.stop();
  }

  feed(lines: UiModel["feed"]["lines"]): void {
    this.panels.feed(lines);
  }

  prompt(p: PromptMsg): void {
    this.panels.prompt(p);
  }

  status(s: ConnectionStatus): void {
    const banner = $("banner");
    if (s.state === "open") {
      banner.hidden = !this.core.ui?.header.model.banner;
      banner.textContent = this.core.ui?.header.model.banner ?? "";
    } else {
      banner.hidden = false;
      banner.textContent =
        s.state === "connecting" ? (s.attempt === 0 ? "Connecting to the game…" : "Lost the game server. Reconnecting…") : s.state === "replaced" ? "Playing in another window. Reload this page to play here." : s.state === "replay" ? (s.done ? "The recording is over." : "Playing a recording (no game server).") : s.text;
    }
  }

  /** Keys (read by the page, not Phaser, so typing never moves you), the header and sheet controls. */
  private wire(): void {
    const send = this.core.send.bind(this.core);
    addEventListener("keydown", (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const typing = ["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement?.tagName ?? "");
      const modalOpen = $<HTMLDialogElement>("modal").open || $<HTMLDialogElement>("prompt").open;
      const chatOpen = this.core.ui?.chat.open === true;
      if (e.key === "Escape" && chatOpen && !modalOpen) return send({ t: "close" });
      if (e.key === "Escape" && typing) return void (document.activeElement as HTMLElement).blur();
      if (typing || modalOpen) return;
      const dir = KEYS[e.key] ?? KEYS[e.key.toLowerCase()];
      const key = e.key.toLowerCase();
      if (dir) {
        e.preventDefault();
        send({ t: "step", dx: dir[0], dy: dir[1] });
      } else if (key === "e") send({ t: "interact" });
      else if (key === "f") send({ t: "fight" });
      else if (key === "r") send({ t: "flee" });
      else if (key === "escape") send({ t: "cancel" });
    });
    $("form").addEventListener("submit", (e) => {
      e.preventDefault();
      const line = $<HTMLInputElement>("line");
      const mode = $<HTMLSelectElement>("mode");
      if (mode.value === "say" && !line.value.trim()) return;
      speaker.stop(); // you talk over them
      send({ t: "say", mode: mode.value, text: line.value });
      line.value = "";
      mode.value = "say";
    });
    $("mode").addEventListener("change", () => {
      const m = $<HTMLSelectElement>("mode").value;
      const c = this.core.ui?.chat;
      if (c?.open) $<HTMLInputElement>("line").placeholder = c.modes.find((x) => x.id === m)?.placeholder ?? "";
      $("line").focus();
    });
    $("chat-close").onclick = () => send({ t: "close" });
    $("tabs").addEventListener("click", (e) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>("[data-tab]")?.dataset.tab;
      if (t) this.panels.setTab(t);
    });
    $("voice-btn").onclick = () => this.panels.voices(() => this.core.ui && this.panels.render(this.core.ui, ["header"]));
    // The look (G6): atmosphere is drawing only, so it's this browser's setting, not the server's.
    const look = $("look-btn");
    const showLook = () => {
      const on = this.world.lookNow.atmosphere;
      look.textContent = on ? "✨ Atmosphere" : "✨ Atmosphere off";
      look.classList.toggle("off", !on);
    };
    look.onclick = () => {
      this.world.setLook({ atmosphere: !this.world.lookNow.atmosphere });
      showLook();
    };
    showLook();
    $("modal-close").onclick = () => this.panels.closeModal();
    $<HTMLDialogElement>("modal").addEventListener("cancel", (e) => {
      e.preventDefault();
      this.panels.closeModal();
    });
    $<HTMLDialogElement>("prompt").addEventListener("cancel", (e) => e.preventDefault());
    // Time waits while nobody is looking.
    document.addEventListener("visibilitychange", () => send({ t: "view", hidden: document.visibilityState !== "visible" }));
  }
}

const replay = new URLSearchParams(location.search).get("replay");
await speaker.init({ server: !replay });
new Core({ view: { w: VIEW_W, h: VIEW_H }, engine: "web", replay }).start(new WebAdapter());
