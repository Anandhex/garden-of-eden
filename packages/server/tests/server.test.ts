/**
 * The HTTP server (G1), run for real: a temp save, no Ollama (so NPCs can't talk, but
 * the map, the queue and offline actions work), and a fake Piper server for voices (T14).
 */
import { spawn, type ChildProcess } from "node:child_process";
import { createServer, type Server } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NdjsonDecoder, type MoveResponse, type Snapshot, type StreamEvent } from "@millbrook/shared";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const port = 41000 + Math.floor(Math.random() * 2000);
const base = `http://127.0.0.1:${port}`;
let server: ChildProcess;
let piper: Server;
const piperRequests: unknown[] = [];
let output = "";

beforeAll(async () => {
  // A stand-in for `python -m piper.http_server`: takes JSON, answers with a WAV header.
  piper = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      if (req.method === "POST") piperRequests.push(JSON.parse(body));
      res.writeHead(req.method === "POST" ? 200 : 405, { "content-type": "audio/wav" }).end("RIFF....WAVE");
    });
  });
  await new Promise<void>((r) => piper.listen(0, "127.0.0.1", r));
  const piperPort = (piper.address() as { port: number }).port;

  const saves = mkdtempSync(join(tmpdir(), "millbrook-test-"));
  server = spawn(join(root, "node_modules/.bin/tsx"), ["packages/server/src/web/server.ts", "--new"], {
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
      PIPER_URL: `http://127.0.0.1:${piperPort}/`,
      COMBAT_TICK_SECONDS: "0",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`server didn't start:\n${output}`)), 30_000);
    const onData = (d: Buffer) => {
      output += d;
      if (output.includes("Millbrook is open")) {
        clearTimeout(timer);
        resolve();
      }
    };
    server.stdout!.on("data", onData);
    server.stderr!.on("data", onData);
    server.on("exit", (code) => reject(new Error(`server exited (${code}):\n${output}`)));
  });
}, 40_000);

afterAll(() => {
  server?.kill();
  piper?.close();
});

const post = (path: string, body: unknown) => fetch(base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

async function actStream(body: unknown): Promise<StreamEvent[]> {
  const res = await post("/api/act", body);
  expect(res.status).toBe(200);
  const d = new NdjsonDecoder<StreamEvent>();
  return d.push(`${await res.text()}\n`);
}

describe("game server (G1)", () => {
  it("serves the state with every NPC's voice and the queue length", async () => {
    const s = (await (await fetch(`${base}/api/state`)).json()) as Snapshot;
    expect(s.llm.ready).toBe(false);
    expect(s.queue).toBe(0);
    expect(s.npcs.length).toBeGreaterThan(3);
    for (const n of s.npcs) expect(n.voice.lang).toMatch(/^en/);
    expect(s.npcs.find((n) => n.id === "brena")!.voice.piper?.model).toBe("en_GB-semaine-medium");
  });

  it("queues moves sent at once instead of turning them away, and applies each exactly once", async () => {
    const before = ((await (await fetch(`${base}/api/state`)).json()) as Snapshot).position;
    const results = await Promise.all([1, 2, 3].map(() => post("/api/move", { dx: 1, dy: 0 })));
    expect(results.map((r) => r.status)).toEqual([200, 200, 200]);
    const moves = (await Promise.all(results.map((r) => r.json()))) as MoveResponse[];
    const ok = moves.filter((m) => m.ok);
    for (const m of moves) expect(Array.isArray(m.events)).toBe(true);
    // Each accepted step moved one tile further: no step was lost or doubled.
    expect(new Set(ok.map((m) => m.state.position.x)).size).toBe(ok.length);
    const after = ((await (await fetch(`${base}/api/state`)).json()) as Snapshot).position;
    expect(after.x - before.x).toBe(ok.length);
  });

  it("streams an offline action as events and ends with the new state", async () => {
    const events = await actStream({ action: "wait", hours: 1 });
    const done = events.at(-1)!;
    expect(done.t).toBe("done");
    expect(events.some((e) => e.t === "system")).toBe(true);
  });

  it("says the model is offline in the stream, and still ends with done", async () => {
    const events = await actStream({ action: "say", npc: "brena", text: "Hello." });
    expect(events.some((e) => e.t === "error")).toBe(true);
    expect(events.at(-1)!.t).toBe("done");
  });

  it("reports the Piper backend and speaks a line in the NPC's voice, stage directions dropped", async () => {
    const info = await (await fetch(`${base}/api/voice`)).json();
    expect(info.backend).toBe("piper");
    const res = await post("/api/speak", { npc: "brena", text: "*wipes her hands* Four gold." });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("audio/wav");
    expect(Buffer.from(await res.arrayBuffer()).toString("latin1")).toBe("RIFF....WAVE");
    expect(piperRequests.at(-1)).toEqual({ text: "Four gold.", voice: "en_GB-semaine-medium", speaker_id: 0, length_scale: 1.05 });
    expect((await post("/api/speak", { npc: "nobody", text: "Hi." })).status).toBe(400);
  });

  it("serves the built client (or says how to build it) and nothing outside it", async () => {
    const page = await fetch(`${base}/`);
    expect([200, 503]).toContain(page.status);
    if (page.status === 503) expect(await page.text()).toMatch(/npm run web/);
    expect((await fetch(`${base}/..%2F..%2Fpackage.json`)).status).not.toBe(200);
  });
});
