/**
 * The view socket (G5): one WebSocket per player at /ws. Every message is one JSON object. The first must be
 * `hello` with this server's PROTOCOL_VERSION; after that each intent is checked with zod (a bad one is answered
 * with `error`) and run in order. The newest connection takes the session over; the older one is told `replaced`.
 */
import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, type WebSocket } from "ws";
import { IntentSchema, PROTOCOL_VERSION, type Intent } from "@millbrook/shared/view";
import type { ViewHost } from "./host.js";
import { ViewSession } from "./session.js";

export function attachViews(server: Server, host: ViewHost): ViewSession {
  const session = new ViewSession(host);
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
  server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    if ((req.url ?? "").split("?")[0] !== "/ws") return void socket.destroy();
    wss.handleUpgrade(req, socket, head, (ws) => serve(ws, session));
  });
  return session;
}

function serve(ws: WebSocket, session: ViewSession): void {
  let greeted = false;
  // Intents run one after another, in the order they came.
  let chain: Promise<void> = Promise.resolve();
  const error = (text: string) => ws.send(JSON.stringify({ t: "error", text }));
  ws.on("message", (data) => {
    let intent: Intent;
    try {
      const parsed = IntentSchema.safeParse(JSON.parse(String(data)));
      if (!parsed.success) return error(`Bad intent: ${parsed.error.issues.map((i) => `${i.path.join(".") || "message"}: ${i.message}`).join("; ")}`);
      intent = parsed.data;
    } catch {
      return error("Bad intent: not JSON.");
    }
    if (!greeted) {
      if (intent.t !== "hello") return error("Say hello first.");
      if (intent.version !== PROTOCOL_VERSION) {
        error(`This server speaks protocol ${PROTOCOL_VERSION}; the client speaks ${intent.version}. Update the client.`);
        return ws.close(4001, "protocol version");
      }
      greeted = true;
      session.attach(ws, intent.view);
      return;
    }
    // Walking and talking may take a while: a new intent (a key to stop the walk) must still get through, so
    // only the quick ones wait in this chain; the game's own queue keeps the slow ones in order.
    chain = chain.then(() => session.intent(intent).catch((err: Error) => error(err.message)));
  });
  ws.on("close", () => session.detach(ws));
}
