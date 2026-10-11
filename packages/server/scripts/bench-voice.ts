/**
 * T14: what NPC voices cost on this machine, next to the language model.
 *
 *   npm run bench:voice                 # Piper from PIPER_URL / PIPER_BIN, else starts the one `npm run voices:install` set up
 *   npm run bench:voice -- --lines 8    # more sentences per voice
 *
 * For each NPC's Piper voice: time to synthesize a sentence (first and warm), the
 * real-time factor (synthesis time ÷ audio length; under 1 means it keeps up with
 * speech), then the same while the language model is writing a reply, and how much
 * each slows the other. Memory: the language model (from Ollama) and Piper's process.
 * The browser's own voices cost the game nothing and aren't measured here.
 * Results go to saves/bench/voice-<date>.json.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { freemem, totalmem } from "node:os";
import { DEFAULT_VOICE, SentenceSplitter, type NpcVoice } from "@millbrook/shared";
import { Ollama } from "ollama";
import { config } from "../src/config.js";
import { parsePersona } from "../src/npc/personaSchema.js";
import { setUpVoice, type TtsProvider } from "../src/voice/tts.js";
import { PIPER_URL, piperInstalled, startPiper } from "./piper.js";

const LINES = [
  "Iron sword for four gold. Take it or leave it.",
  "You smell of smoke and trouble, stranger.",
  "The mine road isn't safe after dark, and I won't be the one to tell the captain why.",
  "Ale's two silver, and a room is five. Rumours cost extra, friend.",
  "Hold on.",
  "Mistress Ashford doesn't sell blades to just anyone.",
  "Every traveller pays the toll. The only question is how.",
  "Come back when the forge has cooled, and we'll talk about the hammer.",
];

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const perVoice = Math.max(2, Math.min(LINES.length, Number(arg("lines") ?? 5)));

/** Seconds of audio in a 16-bit PCM WAV. */
function wavSeconds(wav: Buffer): number {
  const byteRate = wav.readUInt32LE(28);
  const data = wav.indexOf("data");
  if (data < 0 || byteRate === 0) return 0;
  return wav.readUInt32LE(data + 4) / byteRate;
}

const ms = (start: bigint) => Number(process.hrtime.bigint() - start) / 1e6;
const pct = (xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor((xs.length - 1) * p))] ?? 0;
const mb = (bytes: number) => Math.round(bytes / 1024 / 1024);

/**
 * Memory of whatever listens on a port (the Piper HTTP server), in MB. On macOS this is
 * `footprint`, which counts pages the system has compressed or swapped out; plain RSS
 * reads far too low on a Mac under memory pressure (17 MB for a 262 MB Piper).
 */
function memoryOfPort(url: string): number | null {
  try {
    const port = new URL(url).port || "80";
    const pid = execFileSync("lsof", ["-ti", `tcp:${port}`, "-sTCP:LISTEN"], { encoding: "utf8" }).trim().split("\n")[0];
    if (!pid) return null;
    const fp = spawnSync("footprint", ["-p", pid], { encoding: "utf8" });
    const m = /Footprint: ([\d.]+) (KB|MB|GB)/.exec(fp.stdout ?? "");
    if (m) return Math.round(Number(m[1]) * (m[2] === "GB" ? 1024 : m[2] === "KB" ? 1 / 1024 : 1));
    return Math.round(Number(execFileSync("ps", ["-o", "rss=", "-p", pid], { encoding: "utf8" }).trim()) / 1024);
  } catch {
    return null;
  }
}

/** Peak memory of one `piper` run (macOS /usr/bin/time -l), in MB. */
function rssOfCliRun(bin: string, voicesDir: string, model: string): number | null {
  const run = spawnSync("/usr/bin/time", ["-l", bin, "--model", `${voicesDir}/${model}.onnx`, "--output_file", "/dev/null"], { input: "Testing.", encoding: "utf8" });
  const m = /(\d+)\s+maximum resident set size/.exec(run.stderr ?? "");
  return m ? Math.round(Number(m[1]) / 1024 / 1024) : null;
}

/** macOS's own verdict on memory pressure, if it's there. */
function memoryPressure(): string | null {
  try {
    return /System-wide memory free percentage: (\d+%)/.exec(execFileSync("memory_pressure", { encoding: "utf8" }))?.[1] ?? null;
  } catch {
    return null;
  }
}

async function timeVoice(tts: TtsProvider, voice: NpcVoice, lines: string[]) {
  const times: number[] = [];
  const rtf: number[] = [];
  for (const line of lines) {
    const t = process.hrtime.bigint();
    const wav = await tts.synthesize(line, voice);
    const took = ms(t);
    times.push(took);
    const secs = wavSeconds(wav);
    if (secs > 0) rtf.push(took / 1000 / secs);
  }
  return { first: Math.round(times[0]!), warmP50: Math.round(pct(times.slice(1), 0.5)), warmP95: Math.round(pct(times.slice(1), 0.95)), rtf: Math.round(pct(rtf, 0.5) * 100) / 100 };
}

/** One model reply, streamed: time to first token and total, and the sentences it would speak. */
async function modelReply(ollama: Ollama) {
  const t = process.hrtime.bigint();
  let first = 0;
  let text = "";
  const stream = await ollama.chat({
    model: config.model,
    stream: true,
    think: false,
    keep_alive: config.keepAlive,
    options: { num_ctx: config.numCtx, num_predict: config.maxReplyTokens, temperature: config.temperature },
    messages: [
      { role: "system", content: "You are Brena, a blunt village blacksmith. Reply in two or three short sentences." },
      { role: "user", content: "What do you have for sale, and what's the news on the mine road?" },
    ],
  });
  for await (const part of stream) {
    if (!first && part.message.content) first = ms(t);
    text += part.message.content;
  }
  return { firstTokenMs: Math.round(first), totalMs: Math.round(ms(t)), text };
}

async function main() {
  // No sentence cache here: every line must really be synthesized, even when a run repeats one.
  // With nothing configured, start the Piper that `npm run voices:install` set up (and stop it at the end).
  let piperUrl = config.voice.piperUrl;
  if (!piperUrl && !config.voice.piperBin && piperInstalled()) {
    const child = await startPiper();
    if (child) process.on("exit", () => child.kill());
    piperUrl = PIPER_URL;
  }
  const voice = await setUpVoice({ ...config.voice, piperUrl, cacheEntries: 0 });
  console.log(`Voices: ${voice.info.note}`);
  if (!voice.tts) {
    console.log("\nNothing to measure: the browser's voices cost the game no memory or time on the server.");
    console.log("To measure Piper: npm run voices:install, then run this again.");
    return;
  }
  const personas = readdirSync(new URL("../src/data/npcs/", import.meta.url))
    .filter((f) => f.endsWith(".json"))
    .map((f) => parsePersona(JSON.parse(readFileSync(new URL(`../src/data/npcs/${f}`, import.meta.url), "utf8")), f));
  const ollama = new Ollama({ host: config.ollamaHost });

  console.log(`\nMachine: ${mb(totalmem())} MB RAM, ${mb(freemem())} MB free at start${memoryPressure() ? `, ${memoryPressure()} free by macOS's count` : ""}.`);

  // 1. Each voice on its own.
  const alone: Record<string, Awaited<ReturnType<typeof timeVoice>>> = {};
  for (const p of personas) {
    const v = p.voice ?? DEFAULT_VOICE;
    alone[p.id] = await timeVoice(voice.tts, v, LINES.slice(0, perVoice));
    const r = alone[p.id]!;
    console.log(`  ${p.name.padEnd(16)} first ${r.first} ms · warm p50 ${r.warmP50} ms, p95 ${r.warmP95} ms · real-time factor ${r.rtf}`);
  }

  // 2. The language model alone, then both at once (the game's real case: speak sentence 1 while the model writes sentence 2).
  let llm: { alone: Awaited<ReturnType<typeof modelReply>>; together: Awaited<ReturnType<typeof modelReply>> } | null = null;
  let together: Awaited<ReturnType<typeof timeVoice>> | null = null;
  try {
    await modelReply(ollama); // warm
    const llmAlone = await modelReply(ollama);
    const brenaVoice = personas.find((p) => p.id === "brena")?.voice ?? DEFAULT_VOICE;
    const [llmTogether, ttsTogether] = await Promise.all([modelReply(ollama), timeVoice(voice.tts, brenaVoice, LINES.slice(0, perVoice))]);
    llm = { alone: llmAlone, together: llmTogether };
    together = ttsTogether;
    const sentences = new SentenceSplitter().push(`${llmAlone.text} `).length;
    console.log(`\n  Model alone:        first token ${llmAlone.firstTokenMs} ms, reply ${llmAlone.totalMs} ms (${sentences} sentence(s) ready to speak as they finish)`);
    console.log(`  Model while voicing: first token ${llmTogether.firstTokenMs} ms, reply ${llmTogether.totalMs} ms`);
    console.log(`  Voice while model runs: warm p50 ${together.warmP50} ms (alone ${alone.brena?.warmP50 ?? "?"} ms), real-time factor ${together.rtf}`);
  } catch (err) {
    console.log(`\n  (Skipped the model comparison: ${(err as Error).message})`);
  }

  // 3. Memory.
  let ollamaMb: number | null = null;
  try {
    const ps = await ollama.ps();
    ollamaMb = mb(ps.models.find((m) => m.name.startsWith(config.model))?.size ?? 0) || null;
  } catch {
    // Ollama not running
  }
  const firstModel = voice.info.models[0] ?? personas[0]?.voice?.piper?.model ?? "";
  const piperMb = piperUrl ? memoryOfPort(piperUrl) : rssOfCliRun(config.voice.piperBin || "piper", config.voice.piperVoices, firstModel);
  console.log(`\n  Memory: language model ${ollamaMb ?? "?"} MB, Piper ${piperMb ?? "?"} MB, ${mb(freemem())} MB free now${memoryPressure() ? ` (${memoryPressure()} free by macOS's count)` : ""}.`);

  const result = {
    date: new Date().toISOString(),
    backend: voice.tts.name,
    model: config.model,
    linesPerVoice: perVoice,
    machine: { totalMb: mb(totalmem()), freeMbAfter: mb(freemem()), pressureFree: memoryPressure() },
    voices: alone,
    llm,
    voiceWhileModelRuns: together,
    memory: { ollamaMb, piperMb },
  };
  mkdirSync("saves/bench", { recursive: true });
  const file = `saves/bench/voice-${result.date.slice(0, 10)}.json`;
  writeFileSync(file, `${JSON.stringify(result, null, 2)}\n`);
  console.log(`\nSaved ${file}.`);
}

await main();
process.exit(0); // also stops a Piper this script started
