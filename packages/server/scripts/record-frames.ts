/**
 * `npm run frames:record -- [minutes] [name]`: a scripted session against a real game server (a new world, a fake
 * model), with every server message written to protocol/recordings/<name>.jsonl as `{ at, msg }`. An adapter plays
 * it back with `?replay=/recordings/<name>.jsonl` and no game running (G5 step 8): G6 and any Unity or Unreal
 * prototype can be built against it.
 *
 * The script: look about town, walk up to someone and talk, stand about while time flows for `minutes` game
 * minutes, then set out on the road to the nearest place and walk a stretch of it.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Intent } from "@millbrook/shared/view";
import { fakeModel, ProtocolClient, sleep, startGame } from "./game-process.js";

const minutes = Math.max(1, Number(process.argv[2] ?? 10));
const name = process.argv[3] ?? "town-and-road";
const out = fileURLToPath(new URL(`../../../protocol/recordings/${name}.jsonl`, import.meta.url));

const model = await fakeModel("Well met. The harvest's been kind to us this year, gods be thanked.");
const game = await startGame({ env: { OLLAMA_HOST: model.url, TIME_FLOW_SECONDS: "0.5" } });
try {
  const c = new ProtocolClient(game.port);
  await c.opened();
  c.hello();
  await c.until(() => !!c.ui.header && c.actors.has("player"), 20_000, "the first frame");
  await sleep(1500);
  // Walk up to the nearest of the town's talkers (they keep to their spot), else a townsperson, and talk.
  const me = c.me();
  const near = (kind: string) => [...c.actors.values()].filter((a) => a.kind === kind && !a.flags.includes("dead")).sort((a, b) => Math.hypot(a.x - me.x, a.y - me.y) - Math.hypot(b.x - me.x, b.y - me.y))[0];
  const who = near("npc") ?? near("folk");
  if (who) {
    c.send({ t: "click", x: who.x, y: who.y });
    await c.until(() => c.ui.chat?.open === true, 20_000, "the chat").catch(() => {});
    if (!c.ui.chat?.open) {
      c.send({ t: "interact" });
      await c.until(() => c.ui.chat?.open === true, 5000, "the chat").catch(() => {});
    }
    if (c.ui.chat?.open) {
      c.send({ t: "say", mode: "say", text: "Good day! How's the harvest?" });
      await c.until(() => c.msgs.some((m) => m.msg.t === "speech" && m.msg.done), 20_000, "the reply").catch(() => {});
      await sleep(1000);
      c.send({ t: "close" });
    }
  }
  // Stand about while the town goes on.
  for (const [dx, dy] of [[1, 0], [1, 0], [0, 1]] as const) {
    c.send({ t: "step", dx, dy });
    await sleep(250);
  }
  await sleep(minutes * 500 + 500);
  // Out onto the road.
  const travel = (c.ui.sheet?.tabs ?? []).flatMap((t) => t.sections).flatMap((s) => s.rows).flatMap((r) => r.actions ?? []).find((a) => a.id.startsWith("travel:"));
  if (travel) {
    c.send(travel.intent as Intent);
    await sleep(6000);
    c.send({ t: "cancel" });
  }
  await sleep(500);
  mkdirSync(fileURLToPath(new URL("../../../protocol/recordings/", import.meta.url)), { recursive: true });
  writeFileSync(out, c.msgs.map((m) => JSON.stringify({ at: m.at, msg: m.msg })).join("\n") + "\n");
  const bytes = c.msgs.reduce((n, m) => n + m.bytes, 0);
  console.log(`Recorded ${c.msgs.length} messages (${Math.round(bytes / 1024)} KB, ${Math.round((c.msgs.at(-1)?.at ?? 0) / 1000)} s) to protocol/recordings/${name}.jsonl.`);
  console.log(`Play it back: npm run dev -w @millbrook/client, then open http://localhost:5173/?replay=/recordings/${name}.jsonl (or canvas.html?replay=…).`);
  c.close();
} finally {
  game.stop();
  model.close();
}
