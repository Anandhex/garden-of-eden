/**
 * NPC voices with Piper (T14), from npm:
 *
 *   npm run voices:install   # once: a Python venv in .venv-piper/ and the voice models the NPC files use, in voices/
 *   npm run voices           # run Piper's HTTP server (port PIPER_PORT, 5055) until Ctrl+C
 *   npm run web:voices       # Piper, then the browser game speaking through it; Ctrl+C stops both
 *
 * Without any of this the browser's own voices are used, at no memory cost.
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { modelDownloaded, modelsInNpcFiles, PIPER_URL, piperInstalled, PYTHON, ROOT, startPiper, VENV, VOICES_DIR } from "./piper.js";

function run(cmd: string, args: string[]): void {
  console.log(`$ ${[cmd, ...args].join(" ")}`);
  const r = spawnSync(cmd, args, { cwd: ROOT, stdio: "inherit" });
  if (r.status !== 0) throw new Error(`${cmd} failed (${r.status ?? r.error?.message}).`);
}

function install(): void {
  if (!piperInstalled()) {
    run("python3", ["-m", "venv", VENV]);
    run(join(VENV, "bin", "pip"), ["install", "--quiet", "piper-tts[http]"]);
  } else console.log(`Piper is installed in ${VENV}.`);
  mkdirSync(VOICES_DIR, { recursive: true });
  for (const model of modelsInNpcFiles()) {
    if (modelDownloaded(model)) console.log(`${model} is in ${VOICES_DIR}.`);
    else run(PYTHON, ["-m", "piper.download_voices", "--data-dir", VOICES_DIR, model]);
  }
  console.log(`\nDone. Play with voices: npm run web:voices (or start Piper with npm run voices, and set PIPER_URL=${PIPER_URL}).`);
}

/** Stop a child and everything it started (npm runs the game server as its own child). */
const stopTree = (c: ChildProcess) => {
  try {
    process.kill(-c.pid!, "SIGTERM");
  } catch {
    c.kill();
  }
};

/** Keep children until Ctrl+C, then stop them all. */
function holdUntilStopped(children: ChildProcess[]): void {
  const stop = () => {
    for (const c of children) stopTree(c);
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  for (const c of children) c.on("exit", (code) => (console.log(`A process exited (${code ?? "signal"}); stopping.`), stop()));
}

async function serve(): Promise<void> {
  const piper = await startPiper();
  if (!piper) return;
  console.log("Ctrl+C to stop.");
  holdUntilStopped([piper]);
}

async function webWithVoices(): Promise<void> {
  const piper = await startPiper();
  const web = spawn("npm", ["run", "web", "--", ...process.argv.slice(3)], { cwd: ROOT, stdio: "inherit", env: { ...process.env, PIPER_URL }, detached: true });
  holdUntilStopped(piper ? [piper, web] : [web]);
}

const commands: Record<string, () => void | Promise<void>> = { install, serve, web: webWithVoices };
const command = commands[process.argv[2] ?? ""];
if (!command) {
  console.error("Usage: voices.ts install | serve | web");
  process.exit(1);
}
try {
  await command();
} catch (err) {
  console.error((err as Error).message);
  process.exit(1);
}
