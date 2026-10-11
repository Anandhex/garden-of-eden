/**
 * `npm run dev`: the game server and the Vite dev server for the client, together.
 * Open http://localhost:5173 (Vite hands /api to the game server on PORT, 3000 by default).
 * `npm run dev -- --voices` starts Piper too (after `npm run voices:install`). Ctrl+C stops them all.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { PIPER_URL, startPiper } from "./piper.js";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const children: ChildProcess[] = [];

const env = { ...process.env };

/** Stop a child and everything it started (npx runs tsx and vite as their own children). */
function stopTree(c: ChildProcess): void {
  try {
    process.kill(-c.pid!, "SIGTERM");
  } catch {
    c.kill();
  }
}

function run(name: string, cmd: string, args: string[]): void {
  const child = spawn(cmd, args, { cwd: root, stdio: ["ignore", "pipe", "pipe"], env, detached: true });
  const prefix = (chunk: Buffer) =>
    String(chunk)
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => `[${name}] ${l}`)
      .join("\n");
  child.stdout!.on("data", (c: Buffer) => console.log(prefix(c)));
  child.stderr!.on("data", (c: Buffer) => console.error(prefix(c)));
  child.on("exit", (code) => {
    console.log(`[${name}] exited (${code ?? "signal"}).`);
    for (const other of children) stopTree(other);
    process.exit(code ?? 0);
  });
  children.push(child);
}

if (process.argv.includes("--voices")) {
  const piper = await startPiper((l) => console.log(`[voices] ${l}`));
  if (piper) children.push(piper);
  env.PIPER_URL = PIPER_URL;
}

run("server", "npx", ["tsx", "watch", "--env-file-if-exists=.env", "packages/server/src/web/server.ts"]);
run("client", "npx", ["vite", "--config", "packages/client/vite.config.ts", "packages/client"]);

for (const sig of ["SIGINT", "SIGTERM"] as const)
  process.on(sig, () => {
    children.forEach(stopTree);
    process.exit(0);
  });
