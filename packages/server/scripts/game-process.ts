/**
 * A real game server in a child process on a throwaway save, and a client that speaks only the view protocol (G5).
 * Used by `npm run frames:record` and the socket tests. `fakeModel` starts a stand-in for Ollama that answers every
 * chat with the same short line, streamed, so NPCs talk without a real model.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PROTOCOL_VERSION, type Intent, type ServerMsg, type UiModel } from "@millbrook/shared/view";

const root = fileURLToPath(new URL("../../../", import.meta.url));

/** A stand-in for Ollama's /api/chat: a streamed reply of `line`, word by word (no tool calls). */
export async function fakeModel(line = "Good day to you, traveller."): Promise<{ url: string; close(): void; chats: number }> {
  const state = { chats: 0 };
  const server: Server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      if (req.url !== "/api/chat") return void res.writeHead(404).end("{}");
      const msg = JSON.parse(body || "{}") as { stream?: boolean; messages?: unknown[] };
      if (!msg.stream) return void res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ model: "fake", message: { role: "assistant", content: "{}" }, done: true }));
      state.chats++;
      res.writeHead(200, { "content-type": "application/x-ndjson" });
      for (const w of line.split(/(?<= )/)) res.write(`${JSON.stringify({ model: "fake", message: { role: "assistant", content: w }, done: false })}\n`);
      res.end(`${JSON.stringify({ model: "fake", message: { role: "assistant", content: "" }, done: true, prompt_eval_count: 1, eval_count: 1, total_duration: 1 })}\n`);
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => server.close(),
    get chats() {
      return state.chats;
    },
  };
}

export interface GameProcess {
  port: number;
  proc: ChildProcess;
  output: () => string;
  stop(): void;
}

/** Start the game server (a new world on a temp save) and wait until it listens. */
export async function startGame(o: { env?: Record<string, string>; port?: number } = {}): Promise<GameProcess> {
  const port = o.port ?? 42000 + Math.floor(Math.random() * 3000);
  const saves = mkdtempSync(join(tmpdir(), "millbrook-view-"));
  let out = "";
  const proc = spawn(join(root, "node_modules/.bin/tsx"), ["packages/server/src/web/server.ts", "--new"], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(port),
      SAVE_FILE: join(saves, "world.json"),
      DEATHS_FILE: join(saves, "deaths.json"),
      DB_FILE: join(saves, "world.db"),
      OLLAMA_HOST: "http://127.0.0.1:9",
      DIRECTOR: "off",
      PLANNING: "off",
      SUMMARIES: "off",
      COMBAT_TICK_SECONDS: "0",
      ...o.env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`server didn't start:\n${out}`)), 60_000);
    const onData = (d: Buffer) => {
      out += d;
      if (out.includes("The game is open")) {
        clearTimeout(timer);
        resolve();
      }
    };
    proc.stdout!.on("data", onData);
    proc.stderr!.on("data", onData);
    proc.on("exit", (code) => reject(new Error(`server exited (${code}):\n${out}`)));
  });
  return { port, proc, output: () => out, stop: () => proc.kill() };
}

/**
 * A client that knows only the protocol: it keeps the messages, a mirror of the actors and the UI, and can wait for
 * a condition. What a Unity or Unreal adapter would hold, minus the drawing.
 */
export class ProtocolClient {
  readonly msgs: Array<{ at: number; msg: ServerMsg; bytes: number }> = [];
  readonly actors = new Map<string, { id: string; kind: string; x: number; y: number; label: string | null; flags: string[] }>();
  ui: Partial<UiModel> = {};
  map: { id: string; kind: string } | null = null;
  private ws: WebSocket;
  private t0 = Date.now(); // real time: when each message came, for recordings
  private waiters: Array<() => void> = [];

  constructor(port: number) {
    this.ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    this.ws.onmessage = (e) => {
      const msg = JSON.parse(String(e.data)) as ServerMsg;
      this.msgs.push({ at: Date.now() - this.t0, msg, bytes: String(e.data).length });
      if (msg.t === "frame") {
        if (msg.whole) this.actors.clear();
        this.map = msg.frame.map;
        for (const a of msg.frame.actors.upsert) this.actors.set(a.id, { ...a });
        for (const [id, x, y] of msg.frame.actors.move ?? []) {
          const a = this.actors.get(id);
          if (a) Object.assign(a, { x, y });
        }
        for (const id of msg.frame.actors.remove) this.actors.delete(id);
      }
      if (msg.t === "ui") Object.assign(this.ui, msg.ui);
      if (msg.t === "feed" && this.ui.feed) this.ui.feed = { lines: [...this.ui.feed.lines, ...msg.lines].slice(-200) };
      for (const w of this.waiters.splice(0)) w();
    };
  }

  opened(): Promise<void> {
    return new Promise((r, j) => {
      this.ws.onopen = () => r();
      this.ws.onerror = () => j(new Error("socket error"));
    });
  }

  closed(): Promise<{ code: number }> {
    return new Promise((r) => (this.ws.onclose = (e) => r({ code: e.code })));
  }

  send(i: Intent | Record<string, unknown>): void {
    this.ws.send(JSON.stringify(i));
  }

  hello(view = { w: 26, h: 18 }, version = PROTOCOL_VERSION): void {
    this.send({ t: "hello", version, view, engine: "test" });
  }

  close(): void {
    this.ws.close();
  }

  /** Messages since index `from`. */
  since(from: number): ServerMsg[] {
    return this.msgs.slice(from).map((m) => m.msg);
  }

  /** Wait until `test` is true (checked after every message), or fail after `ms`. */
  async until(test: () => boolean, ms = 15_000, what = "a condition"): Promise<void> {
    const end = Date.now() + ms;
    while (!test()) {
      if (Date.now() > end) throw new Error(`timed out waiting for ${what}; the feed ended: ${this.feedText().split("\n").slice(-4).join(" | ")}; errors: ${JSON.stringify(this.msgs.filter((m) => m.msg.t === "error").map((m) => m.msg))}`);
      await new Promise<void>((r) => {
        this.waiters.push(r);
        setTimeout(r, 200);
      });
    }
  }

  me(): { x: number; y: number } {
    return this.actors.get("player")!;
  }

  feedText(): string {
    return (this.ui.feed?.lines ?? []).map((l) => l.text).join("\n");
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
