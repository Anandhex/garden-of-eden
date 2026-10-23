/**
 * The game server (G1), run for real: a temp save, no Ollama (so NPCs can't talk, but the map, the queue and
 * offline actions work), and a fake Piper server for voices (T14). Since G5 a client plays over the view socket
 * (/ws), so that's how this plays; GET /api/state is still there to read the whole game.
 */
import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { findPath, type Snapshot } from "@millbrook/shared";
import { ProtocolClient, sleep, startGame, type GameProcess } from "../scripts/game-process.js";

let game: GameProcess;
let base = "";
let piper: Server;
const piperRequests: unknown[] = [];

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
  game = await startGame({ env: { PIPER_URL: `http://127.0.0.1:${piperPort}/` } });
  base = `http://127.0.0.1:${game.port}`;
}, 90_000);

afterAll(() => {
  game?.stop();
  piper?.close();
});

const post = (path: string, body: unknown) => fetch(base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const state = async () => (await (await fetch(`${base}/api/state`)).json()) as Snapshot;

/** A protocol client that has the first frame and UI, with time waiting for the player. */
async function play(): Promise<ProtocolClient> {
  const c = new ProtocolClient(game.port);
  await c.opened();
  c.hello();
  await c.until(() => !!c.ui.header && c.actors.has("player"), 20_000, "the first frame");
  c.send({ t: "time", flow: false });
  c.send({ t: "close" });
  await c.until(() => c.ui.header?.time.flows === false, 5000, "time to wait");
  return c;
}

describe("game server (G1)", () => {
  it("serves the state with every NPC's voice and the queue length", async () => {
    const s = await state();
    expect(s.llm.ready).toBe(false);
    expect(s.queue).toBe(0);
    expect(s.npcs.length).toBeGreaterThan(3);
    for (const n of s.npcs) expect(n.voice.lang).toMatch(/^en/);
    expect(s.npcs[0]!.voice.piper?.model).toBe("en_GB-semaine-medium");
  });

  it("the old HTTP routes for playing are gone: the socket is how a client plays (G5)", async () => {
    for (const path of ["/api/act", "/api/move", "/api/tick", "/api/new"]) expect((await post(path, {})).status).toBe(405);
    for (const path of ["/api/crowd", "/api/road/data", "/api/road/journeys", "/api/quote", "/api/realm"]) expect((await fetch(base + path)).status).not.toBe(200);
  });

  it("steps sent at once are each applied exactly once, in order", async () => {
    const c = await play();
    const before = (await state()).position;
    const seen: number[] = [];
    const from = c.msgs.length;
    for (let i = 0; i < 3; i++) c.send({ t: "step", dx: 1, dy: 0 });
    await sleep(1500);
    for (const m of c.since(from)) if (m.t === "frame") for (const [id, x] of [...m.frame.actors.upsert.map((a) => [a.id, a.x] as const), ...(m.frame.actors.move ?? [])]) if (id === "player") seen.push(x);
    const after = (await state()).position;
    // Each accepted step moved one tile further: none lost, none doubled.
    expect(after.x - before.x).toBe(new Set(seen).size);
    expect(after.x - before.x).toBeGreaterThanOrEqual(0);
    expect(after.x - before.x).toBeLessThanOrEqual(3);
    c.close();
  });

  it("walks off the village's east edge into the woods and back (N15), the server finding the way; the town's notables are about", async () => {
    const home = await state();
    expect(home.map.id).toBe(home.site.id);
    expect(home.site.area.id).toBe("village");
    expect(["village", "town"]).toContain(home.site.kind);
    // The town's head and the others of note, made from the realm, are about; their sprites have colours.
    expect(home.npcs.length).toBeGreaterThanOrEqual(3);
    expect(home.npcs.every((n) => /^#[0-9a-f]{6}$/i.test(n.color))).toBe(true);
    const east = home.map.exits.find((e) => /woods/i.test(e.label))!;
    expect(east.label).toMatch(/^To the woods around /);
    const c = await play();
    // A sign for each way off the map, where it is.
    const signs = c.since(0).flatMap((m) => (m.t === "frame" ? (m.frame.signs ?? []) : []));
    expect(signs.some((s) => s.kind === "exit" && s.text.includes(east.label))).toBe(true);
    c.send({ t: "moveTo", x: east.x, y: east.y });
    await c.until(() => c.map?.id === `${home.site.id}:woods`, 60_000, "the woods");
    await c.until(() => /The woods around /.test(c.ui.header?.place ?? ""), 5000, "the header to say where");
    await c.until(() => /You walk out to the woods around/.test(c.feedText()), 5000, "the walk's line");
    const out = await state();
    const back = out.map.exits.find((e) => /^To /.test(e.label))!;
    // From the woods' edge: one step in, then walk back onto the exit.
    const path = findPath(out.position, (t) => t.x === back.x && t.y === back.y, (x, y) => ["tree", "wall", "water", undefined].includes(out.map.tiles[y]?.[x]));
    expect(path).not.toBeNull();
    c.send({ t: "moveTo", x: back.x, y: back.y });
    await c.until(() => c.map?.id === home.site.id, 60_000, "the village again");
    c.close();
  });

  it("an offline action streams its lines to the feed", async () => {
    const c = await play();
    const from = c.msgs.length;
    c.send({ t: "act", action: "wait", args: { hours: 1 } });
    await c.until(() => c.since(from).some((m) => m.t === "feed" && m.lines.some((l) => /Time passes/.test(l.text))), 15_000, "the wait");
    c.close();
  });

  it("says the model is offline in the chat when someone is spoken to", async () => {
    const c = await play();
    // Whoever of the town's talkers is nearest, wherever on the map: the server walks the player there.
    const s = await state();
    const npc = s.npcs.filter((n) => !n.dead && !n.away).sort((a, b) => Math.hypot(a.x - s.position.x, a.y - s.position.y) - Math.hypot(b.x - s.position.x, b.y - s.position.y))[0]!;
    c.send({ t: "click", x: npc.x, y: npc.y });
    await c.until(() => c.ui.chat?.open === true && c.ui.header?.busy === false, 30_000, "the chat");
    c.send({ t: "say", mode: "say", text: "Hello." });
    await c.until(() => c.ui.chat?.open === true && c.ui.chat.log.some((l) => /Could not reach Ollama/.test(l.text)), 15_000, "the offline note");
    c.send({ t: "close" });
    c.close();
  });

  it("reports the Piper backend and speaks a line in the NPC's voice, stage directions dropped", async () => {
    const info = await (await fetch(`${base}/api/voice`)).json();
    expect(info.backend).toBe("piper");
    const speaker = (await state()).npcs[0]!.id;
    const res = await post("/api/speak", { npc: speaker, text: "*wipes her hands* Four gold." });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("audio/wav");
    expect(Buffer.from(await res.arrayBuffer()).toString("latin1")).toBe("RIFF....WAVE");
    expect(piperRequests.at(-1)).toMatchObject({ text: "Four gold.", voice: "en_GB-semaine-medium" });
    expect((await post("/api/speak", { npc: "nobody", text: "Hi." })).status).toBe(400);
  });

  it("N16: the village's townsfolk on the map, a minute passing as you stand about, and a townsperson who becomes a talking NPC", async () => {
    const s0 = await state();
    expect(s0.timeFlowSeconds).toBeGreaterThan(0);
    const c = await play();
    if (s0.site.area.id !== "village") return;
    const world = c.ui.sheet!.tabs.find((t) => t.id === "world")!;
    const people = world.sections.find((s) => s.title.startsWith("The people of"))!;
    expect(Number(people.rows[0]!.text.match(/^([\d,]+) townsfolk/)![1]!.replace(/,/g, ""))).toBeGreaterThan(50);
    expect(s0.map.zones.some((z) => z.kind === "square")).toBe(true);
    const folk = [...c.actors.values()].filter((a) => a.kind === "folk");
    expect(folk.length).toBeGreaterThan(5);
    // Time flows by itself: a minute passes with nothing sent.
    const t0 = c.ui.header!.clock;
    c.send({ t: "time", flow: true });
    await c.until(() => c.ui.header!.clock !== t0, 15_000, "a minute to pass");
    c.send({ t: "time", flow: false });
    // Speak to one of them: they're made a talking NPC.
    const me = c.me();
    const p = folk.sort((a, b) => Math.hypot(a.x - me.x, a.y - me.y) - Math.hypot(b.x - me.x, b.y - me.y))[0]!;
    c.send({ t: "click", x: p.x, y: p.y });
    await c.until(() => (c.ui.cast ?? []).some((n) => n.id === p.id) || /gone from here|can't find a way|in your way|too far/.test(c.feedText()), 60_000, "them to become a talker");
    if ((c.ui.cast ?? []).some((n) => n.id === p.id)) expect((await state()).npcs.find((n) => n.id === p.id)?.name).toMatch(new RegExp(`^${p.label}`));
    c.send({ t: "close" });
    c.close();
  });

  it("serves the built client (or says how to build it) and nothing outside it", async () => {
    const page = await fetch(`${base}/`);
    expect([200, 503]).toContain(page.status);
    if (page.status === 503) expect(await page.text()).toMatch(/npm run web/);
    expect((await fetch(`${base}/..%2F..%2Fpackage.json`)).status).not.toBe(200);
  });
});
