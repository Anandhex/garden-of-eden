// Starts the game server for the Unity client on port 3000 (or PORT) with a fake model, so no Ollama is needed.
// Run from the repo root:  npm run unity:server -w packages/server   (or: npx tsx packages/server/scripts/unity-server.mts)
import { startGame, fakeModel } from "./game-process.js";

const port = Number(process.env.PORT ?? 3000);
const m = await fakeModel();
const g = await startGame({ port, env: { OLLAMA_HOST: m.url, FIRST_HOUR: "off" } });
console.log("READY", g.port);
setInterval(() => {}, 1e6);
const stop = () => { g.stop(); m.close(); process.exit(0); };
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
