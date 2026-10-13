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
import { findPath, NdjsonDecoder, type CrowdRoster, type MoveResponse, type Snapshot, type StreamEvent, type TickResponse } from "@millbrook/shared";

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
      if (output.includes("The game is open")) {
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
    expect(s.npcs[0]!.voice.piper?.model).toBe("en_GB-semaine-medium");
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

  it("walks off the village's east edge into the woods and back (N15); the town's notables are about", async () => {
    const state = async () => (await (await fetch(`${base}/api/state`)).json()) as Snapshot;
    /** Walk to a tile on the current map, one step at a time, around whoever's in the way. */
    async function walkTo(goal: { x: number; y: number }, startMap: string): Promise<MoveResponse | null> {
      for (let i = 0; i < 160; i++) {
        const s = await state();
        if (s.map.id !== startMap) return null;
        const busy = (x: number, y: number) => s.npcs.some((n) => n.x === x && n.y === y && !n.companion) || s.creatures.some((c) => c.x === x && c.y === y);
        const path = findPath(s.position, (t) => t.x === goal.x && t.y === goal.y, (x, y) => ["tree", "wall", "water", undefined].includes(s.map.tiles[y]?.[x]) || busy(x, y));
        expect(path, `no way to ${goal.x},${goal.y}`).not.toBeNull();
        const next = path![0]!;
        const r = (await (await post("/api/move", { dx: next.x - s.position.x, dy: next.y - s.position.y })).json()) as MoveResponse;
        if (r.state.map.id !== startMap) return r;
      }
      return null;
    }
    const home = await state();
    expect(home.map.id).toBe(home.site.id);
    expect(home.site.area.id).toBe("village");
    expect(["village", "town"]).toContain(home.site.kind);
    // The town's head and the others of note, made from the realm, are about; their sprites have colours.
    expect(home.npcs.length).toBeGreaterThanOrEqual(3);
    expect(home.npcs.every((n) => /^#[0-9a-f]{6}$/i.test(n.color))).toBe(true);
    const east = home.map.exits.find((e) => /woods/i.test(e.label))!;
    expect(east.label).toMatch(/^To the woods around /);
    const out = await walkTo(east, home.map.id);
    expect(out?.ok).toBe(true);
    expect(out!.state.map.id).toBe(`${home.site.id}:woods`);
    expect(out!.state.site.area.name).toMatch(/^The woods around /);
    expect(out!.log.join(" ")).toMatch(/You walk out to the woods around/);
    const back = await walkTo(out!.state.map.exits.find((e) => /^To /.test(e.label))!, out!.state.map.id);
    expect(back?.state.map.id).toBe(home.site.id);
  });

  it("streams an offline action as events and ends with the new state", async () => {
    const events = await actStream({ action: "wait", hours: 1 });
    const done = events.at(-1)!;
    expect(done.t).toBe("done");
    expect(events.some((e) => e.t === "system")).toBe(true);
  });

  it("says the model is offline in the stream, and still ends with done", async () => {
    const first = ((await (await fetch(`${base}/api/state`)).json()) as Snapshot).npcs[0]!.id;
    const events = await actStream({ action: "say", npc: first, text: "Hello." });
    expect(events.some((e) => e.t === "error")).toBe(true);
    expect(events.at(-1)!.t).toBe("done");
  });

  it("reports the Piper backend and speaks a line in the NPC's voice, stage directions dropped", async () => {
    const info = await (await fetch(`${base}/api/voice`)).json();
    expect(info.backend).toBe("piper");
    const speaker = ((await (await fetch(`${base}/api/state`)).json()) as Snapshot).npcs[0]!.id;
    const res = await post("/api/speak", { npc: speaker, text: "*wipes her hands* Four gold." });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("audio/wav");
    expect(Buffer.from(await res.arrayBuffer()).toString("latin1")).toBe("RIFF....WAVE");
    expect(piperRequests.at(-1)).toMatchObject({ text: "Four gold.", voice: "en_GB-semaine-medium" });
    expect((await post("/api/speak", { npc: "nobody", text: "Hi." })).status).toBe(400);
  });

  it("N16: the village's townsfolk, a minute passing as you stand about, and a townsperson who becomes a talking NPC", async () => {
    const s0 = (await (await fetch(`${base}/api/state`)).json()) as Snapshot;
    expect(s0.timeFlowSeconds).toBeGreaterThan(0);
    const roster = (await (await fetch(`${base}/api/crowd`)).json()) as CrowdRoster | null;
    if (s0.site.area.id !== "village") {
      expect(roster).toBeNull();
      return;
    }
    expect(roster!.map).toBe(s0.map.id);
    expect(roster!.people.length).toBeGreaterThan(50);
    expect(s0.crowd?.count).toBe(roster!.people.length);
    expect(s0.map.zones.some((z) => z.kind === "square")).toBe(true);
    const tick = (await (await post("/api/tick", {})).json()) as TickResponse;
    expect(tick.ok).toBe(true);
    const before = s0.time.hour * 60 + s0.time.minute;
    const after = tick.state.time.hour * 60 + tick.state.time.minute;
    expect((after - before + 1440) % 1440).toBe(1);
    // Speak to one of them: they're made a talking NPC (too far to talk, but they're about now).
    const p = roster!.people[3]!;
    const events = await actStream({ action: "open", npc: p.id });
    const done = events.at(-1) as Extract<StreamEvent, { t: "done" }>;
    expect(done.t).toBe("done");
    const npc = done.state.npcs.find((n) => n.id === p.id);
    expect(npc?.name).toBe(p.name);
    expect(events.some((e) => e.t === "system" || e.t === "opened")).toBe(true);
  });

  it("serves the built client (or says how to build it) and nothing outside it", async () => {
    const page = await fetch(`${base}/`);
    expect([200, 503]).toContain(page.status);
    if (page.status === 503) expect(await page.text()).toMatch(/npm run web/);
    expect((await fetch(`${base}/..%2F..%2Fpackage.json`)).status).not.toBe(200);
  });
});
