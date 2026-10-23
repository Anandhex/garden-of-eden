/**
 * The engine-free core of a client (G5): connect, keep the latest frame and UI model, hand each message to the
 * adapter, and send intents back. This is the reference for adapters in other engines; it holds no game rules.
 */
import { PROTOCOL_VERSION, type GameEvent, type Intent, type ServerMsg } from "@millbrook/shared/view";
import type { EngineAdapter } from "./adapter";
import { ReplaySource, SocketSource, type Source } from "./connection";
import { Mirror } from "./mirror";

export type { EngineAdapter, ConnectionStatus } from "./adapter";
export type { FrameChange } from "./mirror";
export { Mirror, PATCH } from "./mirror";

export interface CoreOptions {
  /** The adapter's viewport in tiles. */
  view: { w: number; h: number };
  /** "web", "canvas", "unity"... */
  engine: string;
  /** Play a recording instead of connecting (`?replay=<url>`). */
  replay?: string | null;
  /** The socket's address; by default /ws on this page's host. */
  url?: string;
}

export class Core {
  readonly mirror = new Mirror();
  private readonly source: Source;
  private adapter: EngineAdapter | null = null;
  view: { w: number; h: number };
  readonly replaying: boolean;

  constructor(private readonly opts: CoreOptions) {
    this.view = { ...opts.view };
    this.replaying = !!opts.replay;
    this.source = opts.replay
      ? new ReplaySource(opts.replay)
      : new SocketSource(opts.url ?? `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`, () => ({ t: "hello", version: PROTOCOL_VERSION, view: this.view, engine: opts.engine }));
  }

  get frame() {
    return this.mirror;
  }

  get ui() {
    return this.mirror.ui;
  }

  start(adapter: EngineAdapter): void {
    this.adapter = adapter;
    adapter.start(this);
    this.source.start(
      (m) => this.receive(m),
      (s) => adapter.status(s),
    );
  }

  send(intent: Intent): void {
    if (intent.t === "view" && intent.w && intent.h) this.view = { w: intent.w, h: intent.h };
    this.source.send(intent);
  }

  private receive(m: ServerMsg): void {
    const a = this.adapter!;
    switch (m.t) {
      case "frame":
        return a.frame(m.frame, this.mirror.applyFrame(m.frame, m.whole));
      case "ui": {
        const changed = this.mirror.applyUi(m.ui);
        if (this.mirror.ui?.header) a.ui(this.mirror.ui, changed);
        return;
      }
      case "feed":
        this.mirror.appendFeed(m.lines);
        return a.feed(m.lines);
      case "event":
        return a.event(m.event as unknown as GameEvent);
      case "speech":
        return a.speech(m);
      case "prompt":
        return a.prompt(m);
      case "error":
        return a.status({ state: "error", text: m.text });
      case "hello":
      case "replaced":
        return;
    }
  }
}
