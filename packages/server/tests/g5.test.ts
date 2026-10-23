/**
 * G5: the switchable client. A real game server (a new world, a fake model, VIEW_CHECK=1) played through the view
 * protocol only, the way any engine adapter would: handshake, walking, clicking someone to talk, speech, prompts,
 * the clocks, the road, frame sizes, reconnecting, and that the view never changes the game. Plus the committed
 * JSON Schema and the line the client code may not cross.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Snapshot } from "@millbrook/shared";
import { schemaFiles } from "../../shared/src/view/jsonSchema.js";
import { fakeModel, ProtocolClient, sleep, startGame, type GameProcess } from "../scripts/game-process.js";
import { heldBy } from "../src/view/session.js";

const root = fileURLToPath(new URL("../../../", import.meta.url));
let game: GameProcess;
let model: Awaited<ReturnType<typeof fakeModel>>;
const LINE = "Good day to you, traveller.";

beforeAll(async () => {
  model = await fakeModel(LINE);
  game = await startGame({ env: { OLLAMA_HOST: model.url, TIME_FLOW_SECONDS: "0.3", VIEW_CHECK: "1" } });
}, 90_000);

afterAll(() => {
  game?.stop();
  model?.close();
});

/** A connected client that has said hello and has the first frame and UI. */
async function connect(): Promise<ProtocolClient> {
  const c = new ProtocolClient(game.port);
  await c.opened();
  c.hello();
  await c.until(() => !!c.ui.header && c.actors.has("player"), 20_000, "the first frame and UI");
  return c;
}

/** Connected, with no chat or dialog left open by an earlier test. */
async function fresh(): Promise<ProtocolClient> {
  const c = await connect();
  c.send({ t: "close" });
  await c.until(() => c.ui.chat?.open === false && c.ui.modal === null && c.ui.header?.busy === false, 30_000, "a clear screen");
  return c;
}

const state = async () => (await (await fetch(`http://127.0.0.1:${game.port}/api/state`)).json()) as Snapshot;

describe("G5 the protocol, published", () => {
  it("the committed JSON Schema is what `npm run schema` makes now", () => {
    for (const [name, text] of Object.entries(schemaFiles())) expect(readFileSync(join(root, "protocol/schema", name), "utf8"), `protocol/schema/${name} is stale: run npm run schema`).toBe(text);
  });
});

describe("G5 the line: the client code holds no game rules", () => {
  const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? files(join(dir, f)) : f.endsWith(".ts") ? [join(dir, f)] : []));
  const client = [...files(join(root, "packages/client/src/core")), ...files(join(root, "packages/client/src/adapter"))];

  it("core/ and adapter/ import nothing from @millbrook/shared but its view", () => {
    expect(client.length).toBeGreaterThan(8);
    for (const f of client) {
      const src = readFileSync(f, "utf8");
      const bad = [...src.matchAll(/from\s+"(@millbrook\/shared[^"]*)"/g)].map((m) => m[1]).filter((m) => m !== "@millbrook/shared/view");
      expect(bad, f).toEqual([]);
      // Nor the server's code, nor the simulation's by another path.
      expect(src, f).not.toMatch(/from\s+"[^"]*(packages\/server|shared\/src\/(crowd|path|road|chatter))[^"]*"/);
    }
  });

  it("none of the simulation, terrain, placement or pathfinding code is used there", () => {
    const banned = ["CrowdSim", "findPath", "chunkAt", "partyAt", "journeyLine", "shortestWay", "tileDistance", "isHostile", "CLASS_RANK"];
    for (const f of client) {
      const src = readFileSync(f, "utf8");
      for (const name of banned) expect(src.includes(name), `${f} uses ${name}`).toBe(false);
    }
  });

  it("core/ is engine-free and small, and the old client logic is gone", () => {
    const core = files(join(root, "packages/client/src/core"));
    const lines = core.reduce((n, f) => n + readFileSync(f, "utf8").split("\n").length, 0);
    expect(lines).toBeLessThan(400);
    for (const f of core) expect(readFileSync(f, "utf8"), f).not.toMatch(/phaser|document\.|HTMLElement/i);
    for (const gone of ["game.ts", "simulate.ts", "store.ts", "api.ts", "crowd.ts", "roadData.ts", "travellers.ts"]) expect(() => statSync(join(root, "packages/client/src", gone))).toThrow();
  });
});

describe("G5 playing through the protocol", () => {
  it("handshake: hello, then a whole frame, then the whole UI; a wrong version is refused", async () => {
    const c = await connect();
    const kinds = c.msgs.map((m) => m.msg.t);
    expect(kinds.slice(0, 3)).toEqual(["hello", "frame", "ui"]);
    const first = c.msgs[1]!.msg;
    expect(first.t === "frame" && first.whole).toBe(true);
    expect(Object.keys(c.ui).sort()).toEqual(["cast", "chat", "feed", "header", "modal", "realm", "roadbar", "sheet"]);
    c.close();

    const old = new ProtocolClient(game.port);
    await old.opened();
    const closed = old.closed();
    old.hello({ w: 26, h: 18 }, 0);
    expect((await closed).code).toBe(4001);
    expect(old.msgs.map((m) => m.msg)).toEqual([expect.objectContaining({ t: "error", text: expect.stringMatching(/protocol 1.*0/) })]);

    const rude = new ProtocolClient(game.port);
    await rude.opened();
    rude.send({ t: "step", dx: 1, dy: 0 });
    rude.send({ t: "teleport" });
    await rude.until(() => rude.msgs.length >= 2, 5000, "two errors");
    expect(rude.msgs.map((m) => m.msg.t)).toEqual(["error", "error"]);
    rude.close();
  });

  it("a newer window takes the session over; the older one is told", async () => {
    const a = await connect();
    const closed = a.closed();
    const b = await connect();
    expect((await closed).code).toBe(4000);
    expect(a.msgs.some((m) => m.msg.t === "replaced")).toBe(true);
    b.close();
  });

  it("walks with steps; a click on someone far off walks the player there and opens the chat; a line gets a streamed reply", async () => {
    const c = await fresh();
    c.send({ t: "time", flow: false });
    const x0 = c.me().x;
    c.send({ t: "step", dx: 1, dy: 0 });
    await c.until(() => c.me().x !== x0, 5000, "a step");
    expect(c.me().x - x0).toBe(1);

    const me = c.me();
    const npc = [...c.actors.values()].filter((a) => a.kind === "npc" && !a.flags.includes("dead")).sort((a, b) => Math.hypot(a.x - me.x, a.y - me.y) - Math.hypot(b.x - me.x, b.y - me.y))[0]!;
    expect(npc).toBeTruthy();
    const from = c.msgs.length;
    c.send({ t: "click", x: npc.x, y: npc.y });
    await c.until(() => c.ui.chat?.open === true && c.ui.header?.busy === false, 30_000, "the chat to open (and their greeting to finish)");
    // The server walked: frames came with the player somewhere new, and no step was sent.
    const moved = c.since(from).filter((m) => m.t === "frame" && (m.frame.actors.upsert.some((a) => a.id === "player") || m.frame.actors.move?.some(([id]) => id === "player")));
    if (Math.hypot(npc.x - me.x, npc.y - me.y) > 3) expect(moved.length).toBeGreaterThan(1);
    const chat = c.ui.chat!;
    expect(chat.open && chat.tools.map((t) => t.id)).toEqual(expect.arrayContaining(["look", "give", "flee"]));

    const said = c.msgs.length;
    c.send({ t: "say", mode: "say", text: "Hello there." });
    await c.until(() => c.since(said).some((m) => m.t === "speech" && m.done), 20_000, "the reply");
    const talker = chat.open ? chat.npc : "";
    const speech = c.since(said).filter((m) => m.t === "speech" && m.npc === talker);
    expect(speech[0]).toMatchObject({ thinking: true });
    // Their reply up to its end (someone else nearby may chime in after, N6.5).
    const end = speech.findIndex((m) => m.t === "speech" && m.done);
    expect(speech.slice(0, end).map((m) => (m.t === "speech" ? (m.delta ?? "") : "")).join("")).toBe(LINE);
    await c.until(() => c.ui.chat?.open === true && c.ui.chat.log.some((l) => l.kind === "you" && l.text === "Hello there.") && c.ui.chat.log.some((l) => l.text === LINE), 5000, "the log");

    // A reconnect gives back the same screen: the chat open, with its log.
    c.close();
    const again = await connect();
    expect(again.ui.chat?.open).toBe(true);
    expect(again.ui.chat?.open && again.ui.chat.log.some((l) => l.text === LINE)).toBe(true);
    again.send({ t: "close" });
    await again.until(() => again.ui.chat?.open === false, 5000, "the chat to close");
    again.close();
  });

  it("asks before what can't be undone (a prompt), and does nothing on no", async () => {
    const c = await fresh();
    const before = (await state()).time.text;
    const from = c.msgs.length;
    c.send({ t: "newGame" });
    await c.until(() => c.since(from).some((m) => m.t === "prompt"), 5000, "the prompt");
    const p = c.since(from).find((m) => m.t === "prompt")!;
    expect(p.t === "prompt" && p.options.map((o) => o.id)).toEqual(["yes", "no"]);
    if (p.t === "prompt") c.send({ t: "answer", prompt: p.id, option: "no" });
    await sleep(500);
    expect((await state()).player.name).toBeTruthy();
    expect(c.feedText()).not.toMatch(/A new game/);
    void before;
    c.close();
  });

  it("dialogs open on the server: Craft lists what can be made, and closes", async () => {
    const c = await fresh();
    c.send({ t: "panel", panel: "craft" });
    await c.until(() => c.ui.modal?.kind === "craft", 5000, "the craft dialog");
    expect(c.ui.modal!.sections.flatMap((s) => s.rows).map((r) => r.text)).toEqual(expect.arrayContaining(["horseshoe", "stew"]));
    c.send({ t: "panel", panel: null });
    await c.until(() => c.ui.modal === null, 5000, "the dialog to close");
    c.close();
  });

  it("clocks: time flows with no intents sent, waits while hidden, and Simulate passes hours", async () => {
    const c = await fresh();
    c.send({ t: "time", flow: true });
    const t0 = c.ui.header!.clock;
    await c.until(() => c.ui.header!.clock !== t0, 10_000, "the clock to move by itself");
    c.send({ t: "view", hidden: true });
    await sleep(600);
    const hidden = c.ui.header!.clock;
    await sleep(1500);
    expect(c.ui.header!.clock).toBe(hidden);
    c.send({ t: "view", hidden: false });
    c.send({ t: "time", flow: false });

    const h0 = (await state()).time;
    c.send({ t: "simulate", speed: "fast" });
    await c.until(() => c.ui.header!.simulate.speed === "fast", 5000, "simulate on");
    await sleep(2500);
    c.send({ t: "simulate", speed: "off" });
    await c.until(() => c.ui.header!.simulate.speed === "off", 10_000, "simulate off");
    const h1 = (await state()).time;
    expect((h1.day - h0.day) * 24 + h1.hour - h0.hour).toBeGreaterThanOrEqual(4);
    expect(c.feedText()).toMatch(/Simulate mode/);
    c.close();
  });

  it("a fight holds Simulate and time (heldBy)", () => {
    const s = { engaged: null, creatures: [{ engaged: true }], npcs: [] } as unknown as Snapshot;
    expect(heldBy(s)).toBe("you're in a fight");
    expect(heldBy({ engaged: null, creatures: [], npcs: [{ name: "Ada", inCombat: true, dead: false }] } as unknown as Snapshot)).toBe("Ada is in a fight");
    expect(heldBy({ engaged: null, creatures: [], npcs: [] } as unknown as Snapshot)).toBeNull();
  });

  it("frames are small: a step sends only changes, standing still sends only who moved", async () => {
    const c = await fresh();
    c.send({ t: "time", flow: false });
    await sleep(500);
    const sizes: number[] = [];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [-1, 0], [1, 0]] as const) {
      const from = c.msgs.length;
      c.send({ t: "step", dx, dy });
      await sleep(400);
      sizes.push(...c.msgs.slice(from).filter((m) => m.msg.t === "frame").map((m) => m.bytes));
    }
    expect(sizes.length).toBeGreaterThan(0);
    expect(Math.max(...sizes)).toBeLessThan(8 * 1024);
    // A minute passing with the player still: no terrain, and no actor sent whole unless it changed more than its place.
    const from = c.msgs.length;
    c.send({ t: "act", action: "wait", args: { hours: 1 } });
    await c.until(() => c.since(from).some((m) => m.t === "feed" && m.lines.some((l) => /Time passes/.test(l.text))), 15_000, "the wait");
    const still = c.since(from).filter((m) => m.t === "frame");
    for (const f of still) if (f.t === "frame") expect(f.frame.patches ?? []).toEqual([]);
    c.close();
  });

  it("the road: travel sets out, the server walks it, frames carry road patches", async () => {
    const c = await fresh();
    c.send({ t: "time", flow: false });
    const travel = c.ui.sheet!.tabs.flatMap((t) => t.sections).flatMap((s) => s.rows).flatMap((r) => r.actions ?? []).find((a) => a.id.startsWith("travel:"))!;
    expect(travel).toBeTruthy();
    const from = c.msgs.length;
    c.send(travel.intent);
    await c.until(() => c.map?.kind === "road", 20_000, "the road");
    const p0 = { ...c.me() };
    await c.until(() => c.me().x !== p0.x || c.me().y !== p0.y, 10_000, "walking on its own");
    await c.until(() => c.since(from).filter((m) => m.t === "frame" && m.frame.map.kind === "road").length >= 5, 10_000, "a few road frames");
    c.send({ t: "cancel" });
    const road = c.since(from).filter((m) => m.t === "frame" && m.frame.map.kind === "road");
    expect(road.length).toBeGreaterThan(2);
    expect(road.some((m) => m.t === "frame" && (m.frame.patches?.length ?? 0) > 0 && m.frame.patches!.every((p) => p.key.startsWith("road:") && p.ground.length === p.w * p.h))).toBe(true);
    expect(c.ui.roadbar?.shown).toBe(true);
    for (const a of c.actors.values()) if (a.kind === "traveller") expect(Number.isFinite(a.x)).toBe(true);
    c.close();
  });

  it("a fight: walk out to the woods, click a beast to walk up, click again (or F) to strike, R to run", async () => {
    const c = await fresh();
    c.send({ t: "time", flow: false });
    const home = await state();
    const woods = home.map.exits.find((e) => /woods/i.test(e.label));
    if (!woods) return;
    c.send({ t: "moveTo", x: woods.x, y: woods.y });
    await c.until(() => c.map?.id === `${home.site.id}:woods`, 60_000, "the woods");
    const s = await state();
    const beast = s.creatures.filter((b) => b.hp > 0).sort((a, b) => Math.hypot(a.x - s.position.x, a.y - s.position.y) - Math.hypot(b.x - s.position.x, b.y - s.position.y))[0];
    if (!beast) return; // nothing roams these woods today
    const from = c.msgs.length;
    /** A round was fought: its lines are in the feed (a round of two misses changes no HP, so it has no event). */
    const fought = () => c.since(from).some((m) => m.t === "feed" && m.lines.some((l) => l.kind === "combat"));
    c.send({ t: "click", x: beast.x, y: beast.y });
    // Walked up (or jumped by it on the way): within reach, or already fighting.
    await c.until(() => c.ui.header?.busy === false && (fought() || Math.hypot(c.me().x - beast.x, c.me().y - beast.y) <= 3), 40_000, "reaching the beast");
    for (let i = 0; i < 3 && !fought(); i++) {
      c.send({ t: "fight" });
      await sleep(800);
    }
    expect(fought()).toBe(true);
    c.send({ t: "flee" });
    await sleep(800);
    c.close();
  });

  it("the same game with a view as without: building frames and panels never changed the world (VIEW_CHECK)", () => {
    expect(game.output()).not.toMatch(/VIEW_CHECK/);
  });
});
