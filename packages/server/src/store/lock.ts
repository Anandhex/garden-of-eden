import { closeSync, mkdirSync, openSync, readFileSync, rmSync, writeSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * One writer at a time (N18). The CLI and the web server share `saves/`: with SQLite two
 * writers can lock each other, and the pair of files (world.json and world.db) must agree.
 * `saves/.lock` holds the pid of the process that is playing; a second one refuses to start.
 * A lock left by a process that is gone is taken over.
 */

const held = new Set<string>();

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** The lock file for a save file: beside it. */
export const lockFileFor = (saveFile: string) => join(dirname(saveFile), ".lock");

/** Take the lock, or exit with a clear message when another game is writing to these saves. Released when this process exits. */
export function acquireSaveLock(saveFile: string): void {
  const file = lockFileFor(saveFile);
  mkdirSync(dirname(file), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = openSync(file, "wx");
      writeSync(fd, String(process.pid));
      closeSync(fd);
      held.add(file);
      process.once("exit", () => releaseSaveLock(saveFile));
      return;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      const pid = Number(readFileSync(file, "utf8").trim());
      if (Number.isInteger(pid) && pid !== process.pid && alive(pid)) {
        console.error(`Another game (process ${pid}) is already using ${dirname(file)}. Run one at a time: the save file and the database go together. (If it isn't running, delete ${file}.)`);
        process.exit(1);
      }
      rmSync(file, { force: true }); // a stale lock, or our own from before
    }
  }
}

export function releaseSaveLock(saveFile: string): void {
  const file = lockFileFor(saveFile);
  if (!held.delete(file)) return;
  rmSync(file, { force: true });
}
