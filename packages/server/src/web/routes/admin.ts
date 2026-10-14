import type { IncomingMessage, ServerResponse } from "node:http";
import type { AdminCardKind, AdminEventQuery, AdminSource, AdminTimeRequest } from "@millbrook/shared";
import { card, crowdOf, pinned } from "../../admin/person.js";
import type { AdminContext } from "../../admin/context.js";
import { eventByRef, events } from "../../admin/events.js";
import { health } from "../../admin/health.js";
import { clockOf, overview } from "../../admin/overview.js";
import { playerView } from "../../admin/player.js";
import { gossipOverview, knowersOf } from "../../admin/gossip.js";
import { newsChainOf, roadsOf } from "../../admin/roads.js";
import { search } from "../../admin/search.js";
import { timeControl } from "../../admin/time.js";
import { config } from "../../config.js";
import { encodeMbWorld, exportWorld } from "../../store/exchange.js";

/**
 * The admin view's routes (N17). `GET /api/admin/*` only: nothing there writes, and any
 * other method answers 405, except the time controls (`POST /api/admin/time`), which move
 * the clock exactly as the player waiting would. It shows the truth (spoilers) and will
 * grow powers, so it answers only to this machine unless ADMIN=on.
 */

export const ADMIN_PREFIX = "/api/admin/";

const LOCAL = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

/** Is this request from this machine (or is ADMIN=on)? */
export function adminAllowed(req: Pick<IncomingMessage, "socket">): boolean {
  return config.admin || LOCAL.has(req.socket?.remoteAddress ?? "");
}

function send(res: ServerResponse, status: number, body: unknown): true {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
  return true;
}

/** Refuse a request for the admin page from another machine. */
export function refuseAdmin(res: ServerResponse): true {
  return send(res, 403, { error: "The admin view is only for this machine. (ADMIN=on lifts that.)" });
}

const num = (v: string | null): number | undefined => (v !== null && v !== "" && Number.isFinite(Number(v)) ? Number(v) : undefined);
const SOURCES: AdminSource[] = ["game", "realm", "director"];
const KINDS: AdminCardKind[] = ["cast", "figure", "townsperson", "beast", "player", "place"];

function eventQuery(q: URLSearchParams): AdminEventQuery {
  const out: AdminEventQuery = {};
  for (const key of ["site", "faction", "person", "kind", "after"] as const) {
    const v = q.get(key);
    if (v) out[key] = v;
  }
  const source = q.get("source") as AdminSource | null;
  if (source && SOURCES.includes(source)) out.source = source;
  const min = num(q.get("minImportance"));
  if (min !== undefined) out.minImportance = min;
  const limit = num(q.get("limit"));
  if (limit !== undefined) out.limit = limit;
  return out;
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 10_000) throw new Error("Request too large.");
  }
  try {
    return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  } catch {
    throw new Error("Invalid JSON.");
  }
}

/** Answer an `/api/admin/*` request. Returns false for anything else (the caller carries on). */
export async function handleAdmin(req: IncomingMessage, res: ServerResponse, ctx: AdminContext): Promise<boolean> {
  const url = new URL(req.url ?? "/", "http://x");
  if (!url.pathname.startsWith(ADMIN_PREFIX)) return false;
  if (!adminAllowed(req)) return refuseAdmin(res);
  const route = url.pathname.slice(ADMIN_PREFIX.length);
  const q = url.searchParams;

  if (route === "time") {
    if (req.method !== "POST") return send(res, 405, { error: "Use POST for the time controls." });
    try {
      const body = await readJson(req);
      const action = String(body.action ?? "") as AdminTimeRequest["action"];
      return send(res, 200, await timeControl(ctx, { action, ...(body.days !== undefined ? { days: Number(body.days) } : {}) }));
    } catch (err) {
      return send(res, 400, { error: (err as Error).message });
    }
  }
  if (req.method !== "GET") return send(res, 405, { error: "The admin view is read-only: GET only." });

  switch (route) {
    case "overview":
      return send(res, 200, overview(ctx));
    case "clock":
      return send(res, 200, clockOf(ctx));
    case "health":
      return send(res, 200, health(ctx));
    case "events":
      return send(res, 200, events(ctx, eventQuery(q)));
    case "event": {
      const e = eventByRef(ctx, q.get("ref") ?? "");
      return e ? send(res, 200, e) : send(res, 404, { error: "No such event." });
    }
    case "search": {
      const kind = q.get("kind") as AdminCardKind | null;
      return send(res, 200, search(ctx, q.get("q") ?? "", { ...(kind && KINDS.includes(kind) ? { kind } : {}), ...(q.get("site") ? { site: q.get("site")! } : {}) }));
    }
    case "card": {
      const c = card(ctx, q.get("ref") ?? "");
      return c ? send(res, 200, c) : send(res, 404, { error: "Nobody there." });
    }
    case "pinned": {
      const refs = (q.get("refs") ?? "").split(",").filter(Boolean);
      return send(res, 200, { ...pinned(ctx, refs), player: refs.includes("player") ? playerView(ctx) : null });
    }
    case "player":
      return send(res, 200, playerView(ctx));
    case "roads":
      return send(res, 200, roadsOf(ctx));
    case "gossip":
      return send(res, 200, gossipOverview(ctx));
    case "knowers": {
      const k = knowersOf(ctx, q.get("ref") ?? "");
      return k ? send(res, 200, k) : send(res, 404, { error: "Nobody knows that." });
    }
    case "chain": {
      const c = newsChainOf(ctx, q.get("news") ?? "", q.get("site") ?? "");
      return c ? send(res, 200, c) : send(res, 404, { error: "No such news." });
    }
    case "export": {
      // The whole world as one file (N18): read-only, like every other GET here.
      if (!ctx.store) return send(res, 404, { error: "This world has no database to export." });
      const body = encodeMbWorld(exportWorld(ctx.world(), ctx.store));
      res.writeHead(200, { "content-type": "application/gzip", "content-length": body.length, "content-disposition": `attachment; filename="millbrook-day${ctx.world().day}.mbworld"`, "cache-control": "no-store" });
      res.end(body);
      return true;
    }
    case "crowd": {
      const c = crowdOf(ctx, q.get("site") ?? "");
      return c ? send(res, 200, { ...c, clock: clockOf(ctx) }) : send(res, 404, { error: "No such place." });
    }
    default:
      return send(res, 404, { error: "Not an admin route." });
  }
}
