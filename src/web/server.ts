import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../config.js";
import { absoluteHour, advanceMinutes, advanceTime, formatTime } from "../game/clock.js";
import { countItem } from "../game/crafting.js";
import { DeathRegistry } from "../game/deaths.js";
import { xpToNextLevel } from "../game/levels.js";
import { importDeaths, loadWorld, newWorld, saveWorld, type SavedWorld } from "../game/save.js";
import {
  DEFAULT_SESSION_HOURS,
  feePerHour,
  hoursToNextLevel,
  MAX_SESSION_HOURS,
  parseSkill,
  quoteTraining,
  TRUST_FOR_TIER,
  teachableSkills,
  trustCap,
} from "../game/training.js";
import { findQuest } from "../game/quests.js";
import { OllamaProvider } from "../llm/ollama.js";
import { npcPrice } from "../npc/actions.js";
import { NpcAgent } from "../npc/NpcAgent.js";
import { parsePersona } from "../npc/personaSchema.js";
import { SKILLS, skillLevel, TIERS } from "../npc/skills.js";
import type { NpcPersona, TurnResult } from "../npc/types.js";
import { BUILDINGS, distance, isSolid, MAP_H, MAP_W, MINUTES_PER_STEP, NPC_SPOTS, PLAYER_START, TALK_RANGE, TILES } from "./map.js";

const PORT = Number(process.env.PORT ?? 3000);
const WEB_DIR = fileURLToPath(new URL("../../web/", import.meta.url));
const NPC_DIR = new URL("../data/npcs/", import.meta.url);

// ---- Game setup (same data and rules as the CLI) ----

const ids = readdirSync(NPC_DIR).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, ""));
const personas: Record<string, NpcPersona> = Object.fromEntries(
  ids.map((id) => [id, parsePersona(JSON.parse(readFileSync(new URL(`${id}.json`, NPC_DIR), "utf8")), `${id}.json`)]),
);
for (const id of ids) if (!NPC_SPOTS[id]) throw new Error(`NPC "${id}" has no spot on the map (src/web/map.ts).`);

const llm = new OllamaProvider();
const deaths = new DeathRegistry(config.deathsFile);
let world: SavedWorld;
let agents: Record<string, NpcAgent>;
/** NPCs who ran off and will be back, by the game hour they return. Not saved. */
const awayUntil: Record<string, number> = {};
let llmReady = false;
let llmError = "";

function startGame(fresh: boolean): void {
  world = fresh ? newWorld(personas) : importDeaths(loadWorld(config.saveFile, personas), config.deathsFile);
  world.position ??= { ...PLAYER_START };
  for (const key of Object.keys(awayUntil)) delete awayUntil[key];
  agents = Object.fromEntries(ids.map((id) => [id, new NpcAgent(personas[id]!, llm, undefined, world.npcStates[id])]));
  for (const id of ids) {
    const state = agents[id]!.state;
    // A fresh server means nobody is mid-conversation: let fled NPCs come back.
    if (state.outcome === "fled" || state.outcome === "player fled") state.outcome = null;
    if (state.outcome !== "dead") state.conversationOver = false;
    if (world.deaths[id] && state.outcome !== "dead") state.outcome = "dead";
  }
  persist();
}

function persist(): void {
  for (const id of ids) world.npcStates[id] = agents[id]!.state;
  saveWorld(config.saveFile, world);
}

async function checkLlm(): Promise<void> {
  try {
    await llm.warmUp();
    llmReady = true;
    llmError = "";
  } catch (err) {
    llmReady = false;
    llmError = `Could not reach Ollama at ${config.ollamaHost}. Is it running? (${(err as Error).message})`;
  }
}

// ---- Time ----

/** Run `hours` of NPC life from `at`. NPCs get a copy of the clock so it only moves once. */
function simulate(hours: number, at: SavedWorld, log: string[]): void {
  for (const id of ids) {
    const clock = { ...at };
    log.push(...agents[id]!.wait(clock, hours));
  }
  for (const [id, until] of Object.entries(awayUntil)) {
    if (absoluteHour(at) + hours >= until) {
      delete awayUntil[id];
      if (agents[id]!.state.outcome === "fled") agents[id]!.state.outcome = null;
      log.push(`${personas[id]!.name} is back.`);
    }
  }
}

/** Let `hours` pass for the whole village. */
function passHours(hours: number): string[] {
  const log: string[] = [];
  simulate(hours, world, log);
  advanceTime(world, hours);
  return log;
}

/** Walking moves the clock a minute at a time; each new hour the village gets an hour of life. */
function walkMinutes(minutes: number): string[] {
  const log: string[] = [];
  const before = absoluteHour(world);
  advanceMinutes(world, minutes);
  const crossed = absoluteHour(world) - before;
  if (crossed > 0) {
    const start = { ...world };
    advanceMinutes(start, -crossed * 60);
    simulate(crossed, start, log);
  }
  return log;
}

// ---- Views for the client ----

function npcView(id: string) {
  const persona = personas[id]!;
  const agent = agents[id]!;
  const s = agent.state;
  const spot = NPC_SPOTS[id]!;
  const dead = agent.isDead;
  const quests = [...(persona.quests ?? []), ...s.questBoard];
  const byTrust = trustCap(s.relationship);
  const wares = Object.entries(s.inventory)
    .filter(([, qty]) => qty > 0)
    .map(([item, qty]) => ({ item, qty, price: npcPrice(persona, item) ?? null }));
  return {
    id,
    name: persona.name,
    role: persona.role,
    x: spot.x,
    y: spot.y,
    color: spot.color,
    hp: s.hp,
    maxHp: persona.stats.maxHp,
    mood: s.mood,
    trust: s.relationship,
    dead,
    away: awayUntil[id] !== undefined,
    inCombat: s.inCombat,
    busy: dead ? null : agent.busyWith(world),
    wares,
    teaches: dead
      ? []
      : teachableSkills(persona, world).map((t) => {
          const next = skillLevel(world.player.skills, t.skill) + 1;
          return {
            skill: t.skill,
            upTo: TIERS[t.upTo],
            feePerHour: feePerHour(persona, s, next),
            locked: next > byTrust ? `needs trust ${TRUST_FOR_TIER[next]}` : null,
          };
        }),
    pending: {
      quest: (() => {
        const q = s.pendingQuest ? findQuest(persona, s, s.pendingQuest) : undefined;
        return q ? { title: q.title, tier: q.tier, item: q.objective.item, qty: q.objective.qty, gold: q.reward.gold } : null;
      })(),
      training: s.pendingTraining,
      purchase: s.pendingPurchase,
      offer: s.pendingOffer,
    },
    questCount: quests.length,
  };
}

function snapshot() {
  const p = world.player;
  return {
    llm: { ready: llmReady, error: llmError },
    map: { w: MAP_W, h: MAP_H, tiles: TILES, buildings: BUILDINGS, talkRange: TALK_RANGE },
    time: { text: formatTime(world), day: world.day, hour: world.hour, minute: world.minute ?? 0, timeOfDay: world.timeOfDay },
    position: world.position,
    player: {
      name: p.name,
      gold: p.gold,
      hp: p.hp,
      maxHp: p.maxHp,
      level: p.level,
      xp: p.xp,
      xpNext: xpToNextLevel(p.level),
      attributes: p.attributes,
      inventory: p.inventory,
      skills: SKILLS.map((s) => {
        const level = skillLevel(p.skills, s);
        return { skill: s, level, tier: TIERS[level], progress: p.skillProgress[s] ?? 0, needed: level < 5 ? hoursToNextLevel(level) : 0 };
      }).filter((s) => s.level > 0 || s.progress > 0),
      quests: p.quests.active.map((q) => ({
        title: q.title,
        tier: q.tier,
        giver: q.giverName,
        item: q.objective.item,
        qty: q.objective.qty,
        have: countItem(p.inventory, q.objective.item),
        gold: q.reward.gold,
      })),
      completed: p.quests.completed.length,
      journal: p.journal ?? [],
    },
    npcs: ids.map(npcView),
  };
}

// ---- Actions ----

type Emit = (event: Record<string, unknown>) => void;

const rollOf = (message: string) => message.match(/\(rolled[^)]*\)/)?.[0] ?? "";

function npcInRange(id: string): string | null {
  const spot = NPC_SPOTS[id]!;
  if (agents[id]!.isDead) return `${personas[id]!.name} is dead.`;
  if (awayUntil[id] !== undefined) return `${personas[id]!.name} has run off.`;
  if (distance(world.position!, spot) > TALK_RANGE) return `You are too far from ${personas[id]!.name}.`;
  return null;
}

function setScene(id: string): void {
  const spot = NPC_SPOTS[id]!;
  world.location = spot.location;
  world.nearby = spot.nearby;
}

/** One NPC reply, streamed. Records everything the NPC did as events. */
async function npcSpeaks(id: string, emit: Emit, run: (agent: NpcAgent, onText: (delta: string) => void) => Promise<TurnResult>) {
  const agent = agents[id]!;
  const name = personas[id]!.name;
  const result = await run(agent, (delta) => emit({ t: "text", npc: id, delta }));
  for (const a of result.actions) {
    if (a.name === "attack_player" && a.ok) emit({ t: "note", kind: "combat", text: `${name} attacks. ${a.message.replace(/^You /, "").replace(/\(rolled[^)]*\)\s*/, "")}` });
    else emit({ t: "note", kind: a.ok ? "action" : "fail", text: `${a.name}: ${a.message}` });
  }
}

async function act(body: Record<string, unknown>, emit: Emit): Promise<void> {
  const action = String(body.action ?? "");
  const text = String(body.text ?? "").trim().slice(0, 500);
  const id = String(body.npc ?? "");

  if (action === "wait") {
    if (Object.values(agents).some((a) => a.state.inCombat)) return void emit({ t: "system", text: "You can't wait around in the middle of a fight." });
    const hours = Math.max(1, Math.min(24, Math.floor(Number(body.hours ?? 1))));
    for (const line of passHours(hours)) emit({ t: "system", text: line });
    emit({ t: "system", text: `Time passes. It's now ${formatTime(world)}.` });
    return;
  }

  const agent = agents[id];
  if (!agent) return void emit({ t: "error", text: "Unknown character." });
  const name = personas[id]!.name;

  if (action === "open") {
    const problem = npcInRange(id);
    if (problem) return void emit({ t: "system", text: problem });
    // A new conversation starts fresh unless a fight is still going.
    if (!agent.state.inCombat && agent.state.outcome !== "dead") {
      agent.state.conversationOver = false;
      agent.state.outcome = null;
    }
    setScene(id);
    return void emit({ t: "opened", npc: id });
  }

  const problem = npcInRange(id);
  if (problem) return void emit({ t: "system", text: problem });
  setScene(id);

  // A busy NPC can't be interacted with. Turning in quests and waiting are free.
  const busy = agent.busyWith(world);
  if (busy) return void emit({ t: "system", text: `${name} is busy ${busy}. Try waiting.` });
  if (agent.state.conversationOver) return void emit({ t: "ended", npc: id, text: `${name} has nothing more to say.` });

  const p = world.player;
  switch (action) {
    case "say":
      if (!text) return;
      await npcSpeaks(id, emit, (a, on) => a.respond(text, world, on));
      break;
    case "persuade":
    case "intimidate": {
      const kind = action;
      await npcSpeaks(id, emit, (a, on) =>
        a.attempt(kind, text || (kind === "persuade" ? "Please, hear me out." : "You'd better listen."), world, on, (r) =>
          emit({ t: "note", kind: "roll", text: r.ok ? `${kind} ${r.success ? "succeeded" : "failed"} ${rollOf(r.message)}` : r.message }),
        ),
      );
      break;
    }
    case "haggle":
      await npcSpeaks(id, emit, (a, on) =>
        a.haggle(text || "Can you do better on the price?", world, on, (r) =>
          emit({ t: "note", kind: "roll", text: r.ok ? `haggle ${r.success ? "succeeded" : "failed"} ${rollOf(r.message)}` : r.message }),
        ),
      );
      break;
    case "attack":
      await npcSpeaks(id, emit, (a, on) =>
        a.attackedByPlayer(world, on, (r) => emit({ t: "note", kind: "combat", text: `You ${r.damage > 0 ? `hit for ${r.damage}` : "miss"} ${rollOf(r.message)}` })),
      );
      break;
    case "flee":
      await npcSpeaks(id, emit, (a, on) =>
        a.playerFlees(world, on, (r) => emit({ t: "note", kind: "roll", text: r.ok ? `flee ${r.escaped ? "succeeded" : "failed"} ${rollOf(r.message)}` : r.message })),
      );
      break;
    case "turnin":
      await npcSpeaks(id, emit, async (a, on) => {
        const r = await a.turnIn(world, on);
        emit({
          t: "note",
          kind: r.turnIn.completed.length > 0 ? "quest" : "fail",
          text: r.turnIn.completed.length > 0 ? `Quest complete: ${r.turnIn.completed.map((q) => q.title).join(", ")}. You are level ${p.level}, ${p.gold} gold.` : r.turnIn.message,
        });
        return r;
      });
      break;
    case "train": {
      const skill = parseSkill(String(body.skill ?? ""));
      const hours = Math.max(1, Math.min(MAX_SESSION_HOURS, Math.floor(Number(body.hours ?? DEFAULT_SESSION_HOURS))));
      if (!skill) return void emit({ t: "system", text: "Unknown skill." });
      const quote = quoteTraining(personas[id]!, agent.state, world, skill, hours);
      if (!quote.ok) return void emit({ t: "system", text: quote.message });
      await npcSpeaks(id, emit, (a, on) =>
        a.train(skill, hours, world, on, (r) =>
          emit({ t: "note", kind: r.ok ? "action" : "fail", text: r.ok ? `Trained ${r.hoursSpent}h${r.levelsGained ? ", level up!" : ""}. Now ${formatTime(world)}.` : r.message }),
        ),
      );
      break;
    }
    case "accept":
    case "decline": {
      const yes = action === "accept";
      const kind = String(body.kind ?? "");
      if (kind === "quest")
        await npcSpeaks(id, emit, async (a, on) => {
          if (!yes) return a.declineQuest(world, on);
          const r = await a.acceptQuest(world, on);
          emit({ t: "note", kind: "quest", text: r.quest ? `Quest accepted: ${r.quest}` : "That job is no longer available." });
          return r;
        });
      else if (kind === "training")
        await npcSpeaks(id, emit, (a, on) =>
          yes
            ? a.acceptTraining(world, on, (r) => emit({ t: "note", kind: r.ok ? "action" : "fail", text: r.ok ? `Trained ${r.hoursSpent}h${r.levelsGained ? ", level up!" : ""}. Now ${formatTime(world)}.` : r.message }))
            : a.declineTraining(world, on),
        );
      else if (kind === "purchase")
        await npcSpeaks(id, emit, async (a, on) => {
          if (!yes) return a.declinePurchase(world, on);
          const r = await a.acceptPurchase(world, on);
          emit({ t: "note", kind: r.sale.ok ? "action" : "fail", text: `${r.sale.message} You have ${p.gold} gold.` });
          return r;
        });
      else if (kind === "offer")
        await npcSpeaks(id, emit, async (a, on) => {
          if (!yes) return a.declineOffer(world, on);
          const r = await a.acceptOffer(world, on);
          emit({ t: "note", kind: r.sale.ok ? "action" : "fail", text: r.sale.message });
          return r;
        });
      break;
    }
    default:
      return void emit({ t: "error", text: `Unknown action "${action}".` });
  }

  afterTurn(id, emit);
}

/** Deaths, knockouts and runaways: the consequences that outlive one reply. */
function afterTurn(id: string, emit: Emit): void {
  const agent = agents[id]!;
  const name = personas[id]!.name;
  const s = agent.state;

  if (agent.isDead) {
    deaths.record({ npcId: id, name, day: world.day, hour: world.hour, killedBy: world.player.name });
    world.deaths[id] = deaths.get(id)!;
    emit({ t: "ended", npc: id, text: `${name} falls and doesn't get up. They're dead, and they won't be coming back.` });
  } else if (s.outcome === "knocked out") {
    // Same as the CLI: you come round hours later, healed, and the fight is over.
    for (const line of passHours(config.knockoutRecoveryHours)) emit({ t: "system", text: line });
    world.player.hp = world.player.maxHp;
    s.inCombat = false;
    s.outcome = null;
    s.conversationOver = false;
    emit({ t: "ended", npc: id, text: `You were knocked out. You wake after ${config.knockoutRecoveryHours} hours of rest. It is now ${formatTime(world)}.` });
  } else if (s.outcome === "player fled") {
    s.outcome = null;
    s.conversationOver = false;
    emit({ t: "ended", npc: id, text: `You get away from ${name}.` });
  } else if (s.outcome === "fled") {
    awayUntil[id] = absoluteHour(world) + 2;
    emit({ t: "ended", npc: id, text: `${name} runs off into the village.` });
  } else if (s.conversationOver) {
    emit({ t: "ended", npc: id, text: `${name} goes back to work.` });
  }
}

function move(dx: number, dy: number): { ok: boolean; log: string[]; reason?: string } {
  const pos = world.position!;
  const nx = pos.x + Math.sign(dx);
  const ny = pos.y + Math.sign(dy);
  if (Math.abs(dx) + Math.abs(dy) !== 1) return { ok: false, log: [], reason: "One step at a time." };
  if (Object.values(agents).some((a) => a.state.inCombat && !a.isDead)) return { ok: false, log: [], reason: "You can't walk away from a fight. Flee or fight on." };
  if (isSolid(nx, ny)) return { ok: false, log: [] };
  if (ids.some((id) => !agents[id]!.isDead && awayUntil[id] === undefined && NPC_SPOTS[id]!.x === nx && NPC_SPOTS[id]!.y === ny)) return { ok: false, log: [] };
  pos.x = nx;
  pos.y = ny;
  return { ok: true, log: walkMinutes(MINUTES_PER_STEP) };
}

// ---- HTTP ----

/** One thing at a time: a model reply must finish before the next action starts. */
let working = false;

function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 20_000) reject(new Error("Body too large."));
    });
    req.on("end", () => {
      try {
        resolve(raw ? (JSON.parse(raw) as Record<string, unknown>) : {});
      } catch {
        reject(new Error("Invalid JSON."));
      }
    });
  });
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
};

function serveStatic(url: string, res: ServerResponse): void {
  const path = url === "/" ? "/index.html" : decodeURIComponent(url);
  const file = normalize(join(WEB_DIR, path));
  if (!file.startsWith(WEB_DIR) || !existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404).end("Not found");
    return;
  }
  res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream", "cache-control": "no-store" });
  res.end(readFileSync(file));
}

const server = createServer(async (req, res) => {
  const url = (req.url ?? "/").split("?")[0]!;
  try {
    if (req.method === "GET" && url === "/api/state") {
      if (!llmReady && !working) await checkLlm();
      return json(res, 200, snapshot());
    }

    if (req.method === "GET" && url === "/api/quote") {
      const q = new URL(req.url!, "http://x").searchParams;
      const id = q.get("npc") ?? "";
      const skill = parseSkill(q.get("skill") ?? "");
      if (!personas[id] || !skill) return json(res, 400, { ok: false, message: "Unknown NPC or skill." });
      const hours = Math.max(1, Math.min(MAX_SESSION_HOURS, Number(q.get("hours") ?? DEFAULT_SESSION_HOURS)));
      const quote = quoteTraining(personas[id]!, agents[id]!.state, world, skill, hours);
      return json(res, 200, { ...quote, gold: world.player.gold });
    }

    if (req.method === "POST" && url === "/api/move") {
      if (working) return json(res, 409, { ok: false, reason: "Busy." });
      const body = await readBody(req);
      const result = move(Number(body.dx ?? 0), Number(body.dy ?? 0));
      if (result.ok) persist();
      return json(res, 200, { ...result, state: snapshot() });
    }

    if (req.method === "POST" && url === "/api/new") {
      if (working) return json(res, 409, { ok: false, reason: "Busy." });
      startGame(true);
      return json(res, 200, { state: snapshot() });
    }

    if (req.method === "POST" && url === "/api/act") {
      if (working) return json(res, 409, { error: "Another action is still running." });
      const body = await readBody(req);
      working = true;
      res.writeHead(200, { "content-type": "application/x-ndjson", "cache-control": "no-store" });
      const emit: Emit = (event) => res.write(`${JSON.stringify(event)}\n`);
      try {
        if (!llmReady && body.action !== "wait" && body.action !== "open") await checkLlm();
        if (!llmReady && body.action !== "wait" && body.action !== "open") emit({ t: "error", text: llmError });
        else await act(body, emit);
        persist();
      } catch (err) {
        emit({ t: "error", text: (err as Error).message });
      } finally {
        working = false;
        emit({ t: "done", state: snapshot() });
        res.end();
      }
      return;
    }

    if (req.method === "GET") return serveStatic(url, res);
    res.writeHead(405).end();
  } catch (err) {
    if (!res.headersSent) json(res, 500, { error: (err as Error).message });
    else res.end();
  }
});

startGame(process.argv.includes("--new"));
server.listen(PORT, "127.0.0.1", () => {
  console.log(`Millbrook is open at http://localhost:${PORT}`);
});
console.log(`Loading ${config.model}...`);
await checkLlm();
console.log(llmReady ? "Model ready." : `Warning: ${llmError}\nThe map works, but NPCs can't talk until Ollama is running.`);
