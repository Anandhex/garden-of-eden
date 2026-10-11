/**
 * Helpers for running Piper (T14) from the npm scripts: where it's installed, which
 * voice models the NPC files ask for, and starting its HTTP server for the game.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
export const VENV = join(ROOT, ".venv-piper");
export const PYTHON = join(VENV, "bin", "python");
export const VOICES_DIR = join(ROOT, process.env.PIPER_VOICES ?? "voices");
export const PIPER_PORT = Number(process.env.PIPER_PORT ?? 5055);
export const PIPER_URL = `http://127.0.0.1:${PIPER_PORT}/synthesize`;

export const piperInstalled = () => existsSync(PYTHON);

/** The Piper models the NPC files use, e.g. ["en_GB-semaine-medium"]. */
export function modelsInNpcFiles(): string[] {
  const dir = join(ROOT, "packages/server/src/data/npcs");
  const models = new Set<string>();
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".json"))) {
    const model = (JSON.parse(readFileSync(join(dir, f), "utf8")) as { voice?: { piper?: { model?: string } } }).voice?.piper?.model;
    if (model) models.add(model);
  }
  return [...models].sort();
}

export const modelDownloaded = (model: string) => existsSync(join(VOICES_DIR, `${model}.onnx`)) && existsSync(join(VOICES_DIR, `${model}.onnx.json`));

/** Is a Piper server answering at this URL? (A GET gets 405 from a live one.) */
export async function piperUp(url = PIPER_URL): Promise<boolean> {
  try {
    await fetch(url, { signal: AbortSignal.timeout(1000) });
    return true;
  } catch {
    return false;
  }
}

/**
 * Start Piper's HTTP server with the first model the NPC files use (the others load
 * on demand) and wait until it answers. Returns the process, or null if one was already running.
 */
export async function startPiper(log: (line: string) => void = console.log): Promise<ChildProcess | null> {
  if (await piperUp()) {
    log(`Piper is already running at ${PIPER_URL}.`);
    return null;
  }
  if (!piperInstalled()) throw new Error("Piper isn't installed. Run `npm run voices:install` first.");
  const model = modelsInNpcFiles()[0];
  if (!model || !modelDownloaded(model)) throw new Error(`Voice model ${model ?? "(none)"} isn't in ${VOICES_DIR}. Run \`npm run voices:install\`.`);
  const child = spawn(PYTHON, ["-m", "piper.http_server", "--data-dir", VOICES_DIR, "-m", model, "--host", "127.0.0.1", "--port", String(PIPER_PORT)], { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"], detached: true });
  let output = "";
  child.stdout!.on("data", (d) => (output += d));
  child.stderr!.on("data", (d) => (output += d));
  for (let i = 0; i < 60; i++) {
    if (child.exitCode !== null) throw new Error(`Piper stopped (${child.exitCode}):\n${output.slice(-800)}`);
    if (await piperUp()) {
      log(`Piper is up at ${PIPER_URL} (${model}).`);
      return child;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  child.kill();
  throw new Error(`Piper didn't answer within 30 s:\n${output.slice(-800)}`);
}
