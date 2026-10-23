/**
 * Where the server's messages come from (G5): the game's WebSocket (reconnecting with backoff), or a recording
 * (`npm run frames:record`) played back with its own timing, so an adapter can be built with no game running.
 */
import type { Intent, ServerMsg } from "@millbrook/shared/view";
import type { ConnectionStatus } from "./adapter";

export interface Source {
  start(onMsg: (m: ServerMsg) => void, onStatus: (s: ConnectionStatus) => void): void;
  send(i: Intent): void;
}

/** The live game at /ws. `hello` is sent on every (re)connect; nothing else is sent before the server's hello. */
export class SocketSource implements Source {
  private ws: WebSocket | null = null;
  private attempt = 0;
  private open = false;
  private replaced = false;

  constructor(
    private readonly url: string,
    private readonly hello: () => Intent,
  ) {}

  start(onMsg: (m: ServerMsg) => void, onStatus: (s: ConnectionStatus) => void): void {
    const connect = () => {
      onStatus({ state: "connecting", attempt: this.attempt });
      const ws = new WebSocket(this.url);
      this.ws = ws;
      ws.onopen = () => {
        this.attempt = 0;
        ws.send(JSON.stringify(this.hello()));
      };
      ws.onmessage = (e) => {
        const m = JSON.parse(String(e.data)) as ServerMsg;
        if (m.t === "hello") {
          this.open = true;
          onStatus({ state: "open" });
        }
        if (m.t === "replaced") {
          this.replaced = true;
          onStatus({ state: "replaced" });
        }
        onMsg(m);
      };
      ws.onclose = () => {
        this.open = false;
        this.ws = null;
        if (this.replaced) return;
        // Back off: 0.5 s, 1 s, 2 s … up to 8 s.
        const wait = Math.min(8000, 500 * 2 ** this.attempt++);
        setTimeout(connect, wait);
      };
    };
    connect();
  }

  send(i: Intent): void {
    if (this.open && this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(i));
  }
}

/** One line of a recording: when (ms from the start) and what the server sent. */
export interface Recorded {
  at: number;
  msg: ServerMsg;
}

/** A recording, played at its own pace (or `speed` times faster). Intents go nowhere. */
export class ReplaySource implements Source {
  constructor(
    private readonly url: string,
    private readonly speed = 1,
  ) {}

  start(onMsg: (m: ServerMsg) => void, onStatus: (s: ConnectionStatus) => void): void {
    onStatus({ state: "replay", done: false });
    void fetch(this.url)
      .then((r) => {
        if (!r.ok) throw new Error(`${r.status} for ${this.url}`);
        return r.text();
      })
      .then(async (text) => {
        const lines = text.split("\n").filter(Boolean).map((l) => JSON.parse(l) as Recorded);
        const t0 = performance.now();
        for (const line of lines) {
          const due = t0 + line.at / this.speed - performance.now();
          if (due > 0) await new Promise((r) => setTimeout(r, due));
          onMsg(line.msg);
        }
        onStatus({ state: "replay", done: true });
      })
      .catch((err: Error) => onStatus({ state: "error", text: `Can't play the recording: ${err.message}` }));
  }

  send(): void {}
}
