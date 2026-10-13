/**
 * Export a world to one file, or import one (N18).
 *
 *   npm run world:export -- worlds/day20.mbworld          # the world in saves/ (what the game last saved)
 *   npm run world:export -- worlds/day20.mbworld --pretty # also write <file>.json, readable
 *   npm run world:import -- worlds/day20.mbworld          # into a new save: saves/imported/world.json + world.db
 *   npm run world:import -- worlds/day20.mbworld --to saves/world.json --force   # over the current world
 *
 * Stop the game first: it holds saves/.lock while it plays.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { config } from "../src/config.js";
import { loadCreatureTemplates } from "../src/game/creatures.js";
import { WorldStore } from "../src/game/db.js";
import { loadWorld } from "../src/game/save.js";
import { ImportError, importWorld, readMbWorld, writeMbWorld, exportWorld } from "../src/store/exchange.js";
import { acquireSaveLock } from "../src/store/lock.js";


const [command, file, ...rest] = process.argv.slice(2);
const flag = (name: string) => rest.includes(`--${name}`);
const option = (name: string) => rest[rest.indexOf(`--${name}`) + 1];

if (!file || (command !== "export" && command !== "import")) {
  console.error("Usage: world.ts export <out.mbworld> [--pretty] | world.ts import <file.mbworld> [--to <save.json>] [--force]");
  process.exit(1);
}

try {
  if (command === "export") {
    acquireSaveLock(config.saveFile);
    if (!existsSync(config.saveFile)) throw new ImportError(`There is no world at ${config.saveFile}.`);
    const store = new WorldStore(config.dbFile);
    const world = loadWorld(config.saveFile, {}, loadCreatureTemplates(), store);
    const bytes = writeMbWorld(file, world, store);
    console.log(`Exported day ${world.day} (${store.people.count()} people, ${store.eventCount()} events) to ${file}: ${(bytes / 1e6).toFixed(1)} MB.`);
    if (flag("pretty")) {
      writeFileSync(`${file}.json`, JSON.stringify(exportWorld(world, store), null, 2));
      console.log(`Readable copy: ${file}.json`);
    }
    store.close();
  } else {
    const doc = readMbWorld(file);
    const saveFile = option("to") ?? "saves/imported/world.json";
    const dbFile = saveFile.replace(/\.json$/, ".db");
    if (!flag("force") && (existsSync(saveFile) || existsSync(dbFile))) throw new ImportError(`${existsSync(saveFile) ? saveFile : dbFile} already exists. Import into a new path (--to), or add --force to replace it.`);
    mkdirSync(dirname(saveFile), { recursive: true });
    acquireSaveLock(saveFile);
    const store = new WorldStore(dbFile);
    importWorld(doc, { saveFile, store, force: flag("force") });
    console.log(`Imported day ${doc.world.day} into ${saveFile} and ${dbFile}. Play it with SAVE_FILE=${saveFile} DB_FILE=${dbFile}.`);
    store.close();
  }
} catch (err) {
  console.error((err as Error).message);
  process.exit(1);
}
