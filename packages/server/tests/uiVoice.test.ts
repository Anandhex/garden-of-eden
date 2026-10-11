/** G1 request queue, T13 typed events and T14 voices (server side). The HTTP server itself is in server.test.ts. */
import { EventEmitter } from "node:events";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { DEFAULT_VOICE, type NpcVoice } from "@millbrook/shared";
import { captureFrame, turnEvents } from "../src/game/turnEvents.js";
import { parsePersona } from "../src/npc/personaSchema.js";
import { CachedTts, findProgram, listPiperModels, PiperCliTts, PiperHttpTts, setUpVoice, type TtsProvider } from "../src/voice/tts.js";
import { ActionQueue, QueueFullError } from "../src/web/queue.js";
import brenaJson from "../src/data/npcs/brena.json" with { type: "json" };
import { allPersonas, makeTown } from "./helpers.js";

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("ActionQueue (G1)", () => {
  it("runs actions one at a time, in order, instead of turning the second away", async () => {
    const q = new ActionQueue(5);
    const log: string[] = [];
    let release!: () => void;
    const first = q.run(async () => {
      log.push("a start");
      await new Promise<void>((r) => (release = r));
      log.push("a end");
      return "a";
    });
    const positions: number[] = [];
    const second = q.run(() => (log.push("b"), "b"), (p) => positions.push(p));
    await tick();
    expect(q.busy).toBe(true);
    expect(q.length).toBe(1);
    expect(positions).toEqual([1]);
    expect(log).toEqual(["a start"]);
    release();
    expect(await Promise.all([first, second])).toEqual(["a", "b"]);
    expect(log).toEqual(["a start", "a end", "b"]);
    expect(q.busy).toBe(false);
    expect(q.length).toBe(0);
  });

  it("doesn't say 'queued' when nothing is ahead", async () => {
    const q = new ActionQueue(5);
    const positions: number[] = [];
    await q.run(() => 1, (p) => positions.push(p));
    expect(positions).toEqual([]);
  });

  it("a failed action doesn't block the next", async () => {
    const q = new ActionQueue(5);
    await expect(q.run(() => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    expect(await q.run(() => "next")).toBe("next");
  });

  it("turns new actions away once too many are waiting", async () => {
    const q = new ActionQueue(1);
    let release!: () => void;
    const running = q.run(() => new Promise<void>((r) => (release = r)));
    const waiting = q.run(() => "waited");
    await expect(q.run(() => "too many")).rejects.toBeInstanceOf(QueueFullError);
    release();
    await running;
    expect(await waiting).toBe("waited");
  });
});

describe("turn events from game state (T13)", () => {
  it("a purchase is an item to the player, coin to the seller", () => {
    const town = makeTown();
    const { world } = town;
    const brena = town.agents.brena!;
    brena.state.inventory["iron sword"] = 2;
    const before = captureFrame(world, town.agents);
    brena.state.inventory["iron sword"] = 1;
    brena.state.money += 400;
    world.player.inventory["iron sword"] = 1;
    world.player.money -= 400;
    brena.state.mood = "happy";
    const events = turnEvents(before, captureFrame(world, town.agents), { npc: "brena", playerAction: "accept" });
    expect(events).toContainEqual({ type: "item_moved", item: "iron sword", qty: 1, from: "brena", to: "player" });
    expect(events).toContainEqual({ type: "gold_moved", amount: 400, from: "player", to: "brena" });
    expect(events).toContainEqual({ type: "mood_changed", npc: "brena", from: "neutral", to: "happy" });
    // The frame is a copy: changing the state afterwards doesn't change it.
    world.player.inventory["iron sword"] = 7;
    expect(before.player.inventory["iron sword"]).toBeUndefined();
  });

  it("attacks come first, from the player's action and the NPC's attack_player call, with the damage done", () => {
    const town = makeTown();
    const { world } = town;
    const hale = town.agents.hale!;
    const before = captureFrame(world, town.agents);
    hale.state.hp -= 6;
    world.player.hp -= 4;
    const events = turnEvents(before, captureFrame(world, town.agents), {
      npc: "hale",
      playerAction: "attack",
      actions: [{ name: "attack_player", args: {}, ok: true, message: "You hit Traveler." }],
    });
    expect(events.slice(0, 2)).toEqual([
      { type: "attack", by: "player", target: "hale", hit: true, damage: 6 },
      { type: "attack", by: "hale", target: "player", hit: true, damage: 4 },
    ]);
    expect(events).toContainEqual({ type: "hp_changed", who: "hale", from: before.npcs.hale!.hp, to: before.npcs.hale!.hp - 6 });
  });

  it("a job offer is reported by its title", () => {
    const town = makeTown();
    const brena = town.agents.brena!;
    const quest = brena.persona.quests![0]!;
    const before = captureFrame(town.world, town.agents);
    brena.state.pendingQuest = quest.id;
    expect(turnEvents(before, captureFrame(town.world, town.agents))).toContainEqual({ type: "quest_offered", npc: "brena", title: quest.title });
  });
});

describe("NPC voices in NPC files (T14)", () => {
  it("every NPC has a voice, and the schema fills in defaults", () => {
    for (const p of Object.values(allPersonas())) {
      expect(p.voice, p.id).toBeDefined();
      expect(p.voice!.browser.length, p.id).toBeGreaterThan(0);
    }
    const minimal = parsePersona({ ...brenaJson, voice: { gender: "female" } });
    expect(minimal.voice).toEqual({ lang: "en-GB", pitch: 1, rate: 1, browser: [], gender: "female" });
  });

  it("rejects a bad voice: pitch out of range, a path as a Piper model, unknown fields", () => {
    expect(() => parsePersona({ ...brenaJson, voice: { pitch: 3 } })).toThrow(/voice\.pitch/);
    expect(() => parsePersona({ ...brenaJson, voice: { piper: { model: "../../etc/passwd" } } })).toThrow(/voice\.piper\.model/);
    expect(() => parsePersona({ ...brenaJson, voice: { accent: "posh" } })).toThrow(/voice/);
    expect(() => parsePersona({ ...brenaJson, fillerLines: [] })).toThrow(/fillerLines/);
  });
});

const voice: NpcVoice = { ...DEFAULT_VOICE, piper: { model: "en_GB-semaine-medium", speaker: 2, lengthScale: 1.1 } };

describe("Piper backends (T14)", () => {
  it("the HTTP backend posts the text with the NPC's voice, speaker and speed", async () => {
    const seen: Array<{ url: string; body: unknown }> = [];
    const fakeFetch = (async (url: string, init: RequestInit) => {
      seen.push({ url, body: JSON.parse(String(init.body)) });
      return new Response(new Uint8Array([82, 73, 70, 70]), { status: 200 });
    }) as unknown as typeof fetch;
    const tts = new PiperHttpTts("http://piper.local:5000", 1000, fakeFetch);
    const audio = await tts.synthesize("Four gold.", voice);
    expect(audio.toString("latin1")).toBe("RIFF");
    expect(seen).toEqual([{ url: "http://piper.local:5000", body: { text: "Four gold.", voice: "en_GB-semaine-medium", speaker_id: 2, length_scale: 1.1 } }]);
  });

  it("the HTTP backend fails loudly on an error answer", async () => {
    const fakeFetch = (async () => new Response("no", { status: 500 })) as unknown as typeof fetch;
    await expect(new PiperHttpTts("http://x", 1000, fakeFetch).synthesize("Hi.", voice)).rejects.toThrow(/500/);
  });

  it("the program backend runs piper with the model, speaker and speed, text on stdin", async () => {
    const dir = mkdtempSync(join(tmpdir(), "voices-"));
    const calls: Array<{ bin: string; args: string[]; stdin: string }> = [];
    const fakeSpawn = ((bin: string, args: string[]) => {
      const child = new EventEmitter() as EventEmitter & { stdin: PassThrough; stderr: PassThrough; kill: () => void };
      child.stdin = new PassThrough();
      child.stderr = new PassThrough();
      child.kill = () => {};
      let stdin = "";
      child.stdin.on("data", (d) => (stdin += d));
      child.stdin.on("end", () => {
        calls.push({ bin, args, stdin });
        writeFileSync(args[args.indexOf("--output_file") + 1]!, "RIFFwav");
        child.emit("close", 0);
      });
      return child;
    }) as unknown as typeof import("node:child_process").spawn;
    const tts = new PiperCliTts("/usr/bin/piper", dir, 1000, fakeSpawn);
    expect((await tts.synthesize("Take it or leave it.", voice)).toString()).toBe("RIFFwav");
    expect(calls[0]!.bin).toBe("/usr/bin/piper");
    expect(calls[0]!.stdin).toBe("Take it or leave it.");
    expect(calls[0]!.args).toEqual(expect.arrayContaining(["--model", join(dir, "en_GB-semaine-medium.onnx"), "--speaker", "2", "--length_scale", "1.1"]));
  });

  it("the program backend reports a failed run", async () => {
    const fakeSpawn = (() => {
      const child = new EventEmitter() as EventEmitter & { stdin: PassThrough; stderr: PassThrough; kill: () => void };
      child.stdin = new PassThrough();
      child.stderr = new PassThrough();
      child.kill = () => {};
      child.stdin.on("finish", () => {
        child.stderr.write("model not found");
        setTimeout(() => child.emit("close", 1), 5);
      });
      return child;
    }) as unknown as typeof import("node:child_process").spawn;
    await expect(new PiperCliTts("piper", "voices", 1000, fakeSpawn).synthesize("Hi.", voice)).rejects.toThrow(/exited with 1: model not found/);
  });

  it("caches repeated lines, least recently used out first", async () => {
    let calls = 0;
    const inner: TtsProvider = { name: "fake", synthesize: async (text) => (calls++, Buffer.from(text)) };
    const tts = new CachedTts(inner, 2);
    await tts.synthesize("a", voice);
    await tts.synthesize("a", voice);
    expect(calls).toBe(1);
    await tts.synthesize("b", voice);
    await tts.synthesize("a", voice); // refreshes "a"
    await tts.synthesize("c", voice); // pushes out "b"
    await tts.synthesize("a", voice);
    expect(calls).toBe(3);
    await tts.synthesize("b", voice);
    expect(calls).toBe(4);
    // A different voice is a different line.
    await tts.synthesize("a", { ...voice, piper: { model: "other" } });
    expect(calls).toBe(5);
  });

  it("finds voice models (with their config) and programs on PATH", () => {
    const dir = mkdtempSync(join(tmpdir(), "voices-"));
    writeFileSync(join(dir, "en_GB-alan-medium.onnx"), "");
    writeFileSync(join(dir, "en_GB-alan-medium.onnx.json"), "{}");
    writeFileSync(join(dir, "half.onnx"), ""); // no config: not usable
    expect(listPiperModels(dir)).toEqual(["en_GB-alan-medium"]);
    expect(listPiperModels(join(dir, "missing"))).toEqual([]);
    writeFileSync(join(dir, "piper"), "");
    expect(findProgram("piper", `/nowhere:${dir}`)).toBe(join(dir, "piper"));
    expect(findProgram("piper", "/nowhere")).toBeNull();
    expect(findProgram("")).toBeNull();
  });

  it("picks Piper's server when it answers, and the browser when nothing is set up", async () => {
    const cfg = { piperUrl: "", piperBin: "/no/such/piper", piperVoices: "/no/such/dir", cacheEntries: 10, timeoutMs: 1000 };
    const none = await setUpVoice(cfg);
    expect(none.tts).toBeNull();
    expect(none.info.backend).toBe("browser");
    expect(none.info.note).toMatch(/isn't installed/);

    const up = (async () => new Response("", { status: 404 })) as unknown as typeof fetch;
    const http = await setUpVoice({ ...cfg, piperUrl: "http://127.0.0.1:5000" }, up);
    expect(http.info.backend).toBe("piper");
    expect(http.tts?.name).toBe("piper (http)");

    const down = (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    const fallback = await setUpVoice({ ...cfg, piperUrl: "http://127.0.0.1:5000" }, down);
    expect(fallback.info.backend).toBe("browser");
    expect(fallback.info.note).toMatch(/No Piper server/);
  });
});
