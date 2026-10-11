/**
 * What the player does, sent to the server, and what comes back, shown. The server
 * owns every rule; this file only sends intents and routes the answers to the chat,
 * the feed, the world view and the voices.
 */
import { findPath, tileDistance, type CreatureView, type GameEvent, type NpcView, type Snapshot, type StreamEvent, type Tile } from "@millbrook/shared";
import { fetchState, postMove, postNew, streamAct } from "./api";
import { $ } from "./dom";
import { game, store, world } from "./store";
import { speaker } from "./voice/speaker";

// ---------- rendering hooks (set by main.ts) ----------

const renderers: Array<() => void> = [];
export const onRender = (fn: () => void) => renderers.push(fn);
export const renderAll = () => {
  if (store.state) for (const fn of renderers) fn();
};

/** The chat panel's own refresh (ui/chat.ts registers it). */
export const chatHooks = { render: (_rebuild: boolean) => {}, onClose: () => {}, onConfirmOrder: (_ev: Extract<StreamEvent, { t: "quote" }>) => {} };

// ---------- helpers ----------

export const npcById = (id: string | null): NpcView | undefined => (id ? store.state?.npcs.find((n) => n.id === id) : undefined);
export const dist = tileDistance;
export const solid = (x: number, y: number) => {
  const t = game().map.tiles[y]?.[x];
  return t === undefined || t === "tree" || t === "wall" || t === "water";
};
export const creatureAt = (x: number, y: number) => game().creatures.find((c) => c.x === x && c.y === y);
const npcAt = (x: number, y: number) => game().npcs.find((n) => n.x === x && n.y === y && !n.away && !n.companion) ?? creatureAt(x, y);
/** The creature to fight: the one you're engaged with, else the closest in reach. */
export const nearestCreature = (): CreatureView | undefined => {
  const s = game();
  return s.creatures.find((c) => c.engaged) ?? s.creatures.filter((c) => dist(s.position, c) <= s.map.talkRange).sort((a, b) => dist(s.position, a) - dist(s.position, b))[0];
};
export const nearest = (): NpcView | undefined => {
  const s = game();
  return s.npcs.filter((n) => !n.dead && !n.away && dist(s.position, n) <= s.map.talkRange).sort((a, b) => dist(s.position, a) - dist(s.position, b))[0];
};

export function feed(text: string): void {
  const p = document.createElement("p");
  p.textContent = text;
  $("feed").append(p);
  $("feed").scrollTop = $("feed").scrollHeight;
}

export function setBusy(on: boolean): void {
  for (const el of document.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLSelectElement>(
    "#form input, #form select, #form button, #tools button, #quick button, .offer button, [data-wait], #forage-btn, #craft-btn, #sneak-btn",
  )) {
    el.disabled = on;
  }
}

// ---------- chat log ----------

export const scrollLog = () => ($("log").scrollTop = $("log").scrollHeight);

export function addBubble(npcId: string, entry: { kind: string; text: string }): HTMLDivElement {
  const el = document.createElement("div");
  el.className = `msg ${entry.kind}`;
  el.textContent = entry.text;
  if (store.talking === npcId) {
    $("log").append(el);
    scrollLog();
  }
  return el;
}

export function addNote(kind: string, text: string, npcId: string | null | undefined = store.talking): void {
  if (!npcId) return feed(text);
  (store.logs[npcId] ??= []).push({ kind: `note ${kind}`, text });
  if (store.talking === npcId) {
    const el = document.createElement("div");
    el.className = `note ${kind}`;
    el.textContent = text;
    $("log").append(el);
    scrollLog();
  }
}

// ---------- state ----------

/** Take a new state from the server: show news we haven't seen (e.g. a turn lost to the combat clock). */
export function setState(s: Snapshot): void {
  store.state = s;
  if (store.lastNewsId === null) store.lastNewsId = s.news.at(-1)?.id ?? 0; // don't replay old news on load
  for (const ev of s.news) {
    if (ev.id <= store.lastNewsId) continue;
    store.lastNewsId = ev.id;
    handleEvent(ev, ev.npc ?? null, null);
  }
  store.fightClock = s.fight ? { left: s.fight.secondsLeft, tick: s.fight.tick, at: performance.now() } : null;
  world.state(s);
}

export async function refresh(poll = false): Promise<void> {
  setState(await fetchState(poll));
  renderAll();
}

// ---------- actions ----------

interface Bubble {
  entry: { kind: string; text: string };
  el: HTMLDivElement;
  npc: string;
}

/** The "…" bubble shown the moment the player speaks, until the first word (or a filler) arrives. */
let waiting: { el: HTMLDivElement; npc: string } | null = null;

function clearWaiting(): void {
  waiting?.el.remove();
  waiting = null;
}

/** POST an action and play out the streamed events. */
export async function act(body: Record<string, unknown>): Promise<void> {
  if (store.working) return;
  store.working = true;
  setBusy(true);
  let bubble: Bubble | null = null;
  const talksTo = typeof body.npc === "string" ? body.npc : null;
  // Hide the latency (G1): something shows at once while the model loads its first words.
  if (talksTo && store.talking === talksTo && !["open", "look", "wait", "turnin", "loot"].includes(String(body.action))) {
    const el = addBubble(talksTo, { kind: "npc waiting", text: "" });
    waiting = { el, npc: talksTo };
    world.speech(talksTo, null);
  }
  try {
    const result = await streamAct(body, (ev) => {
      bubble = handleEvent(ev, talksTo, bubble);
    });
    if (result === "busy") addNote("system", "The village is busy. Try again in a moment.");
  } catch (err) {
    addNote("fail", `Connection problem: ${(err as Error).message}`);
  } finally {
    clearWaiting();
    if (bubble) endBubble(bubble);
    store.working = false;
    setBusy(false);
    renderAll();
  }
}

function endBubble(b: Bubble): void {
  b.el.classList.remove("typing");
  const npc = npcById(b.npc);
  if (npc) speaker.end(b.npc, npc.voice);
  world.speech(b.npc, b.entry.text.replace(/^[^:]+: /, ""), { done: true });
}

export function handleEvent(ev: StreamEvent, npcId: string | null, bubble: Bubble | null): Bubble | null {
  // Anything but more text ends the reply that was streaming.
  if (bubble && ev.t !== "text" && ev.t !== "done" && ev.t !== "event") {
    endBubble(bubble);
    bubble = null;
  }
  switch (ev.t) {
    case "text": {
      clearWaiting();
      // In a group scene (N6.5) another NPC may chime in: their words go in the open chat, with their name.
      const log = store.talking ?? ev.npc;
      if (bubble && bubble.npc !== ev.npc) {
        endBubble(bubble);
        bubble = null;
      }
      if (!bubble) {
        const other = ev.npc !== log ? npcById(ev.npc)?.name : null;
        const entry = { kind: other ? "npc other" : "npc", text: other ? `${other}: ` : "" };
        (store.logs[log] ??= []).push(entry);
        const el = addBubble(log, entry);
        bubble = { entry, el, npc: ev.npc };
        el.classList.add("typing");
      }
      bubble.entry.text += ev.delta;
      bubble.el.textContent = bubble.entry.text;
      scrollLog();
      const npc = npcById(ev.npc);
      if (npc) speaker.text(ev.npc, ev.delta, npc.voice);
      world.speech(ev.npc, bubble.entry.text.replace(/^[^:]+: /, ""));
      return bubble;
    }
    case "filler": {
      // The model is slow: the NPC says something short while we keep waiting.
      const log = store.talking ?? ev.npc;
      const entry = { kind: "npc filler", text: ev.text };
      (store.logs[log] ??= []).push(entry);
      addBubble(log, entry);
      if (waiting) $("log").append(waiting.el); // keep the "…" last
      const npc = npcById(ev.npc);
      if (npc) speaker.say(ev.npc, ev.text, npc.voice);
      world.speech(ev.npc, ev.text, { filler: true });
      return bubble;
    }
    case "queued":
      addNote("system", ev.position === 1 ? "Waiting for the last thing to finish…" : `Waiting in line (${ev.position} ahead)…`, npcId);
      return bubble;
    case "event":
      onGameEvent(ev.event);
      return bubble;
    case "note":
      addNote(ev.kind, ev.text, npcId);
      return null;
    case "system":
      addNote("system", ev.text, npcId);
      feed(ev.text);
      return null;
    case "error":
      addNote("fail", ev.text, npcId);
      return null;
    case "ended":
      addNote("end", ev.text, ev.npc);
      feed(ev.text);
      if (store.talking === ev.npc) closeChat();
      return null;
    case "opened":
      return null;
    case "quote":
      if (ev.kind === "commission") chatHooks.onConfirmOrder(ev);
      return null;
    case "done":
      setState(ev.state);
      return bubble;
  }
  return bubble;
}

/** T13: things that happened, for the world view, plus a nudge in the side panel. */
function onGameEvent(e: GameEvent): void {
  world.event(e);
  if (e.type === "item_moved" && (e.to === "player" || e.from === "player")) {
    const tab = document.getElementById("tab-inv");
    if (tab) {
      tab.classList.remove("pulse");
      void tab.offsetWidth; // restart the animation
      tab.classList.add("pulse");
    }
  }
}

export async function step(dx: number, dy: number): Promise<boolean> {
  if (store.moving || store.working) return false;
  store.moving = true;
  try {
    const data = await postMove(dx, dy);
    if (data.state) setState(data.state);
    if (data.reason) feed(data.reason);
    for (const line of data.log ?? []) feed(line);
    for (const e of data.events ?? []) onGameEvent(e);
    if (store.talking) {
      const npc = npcById(store.talking);
      if (npc && dist(game().position, npc) > game().map.talkRange) {
        addNote("end", "You walk away.", store.talking);
        closeChat();
      }
    }
    renderAll();
    return data.ok;
  } finally {
    store.moving = false;
  }
}

let walkToken = 0;
export const cancelWalk = () => walkToken++;

/** A route for the player: around walls, water, trees and anyone standing in the way. */
export const playerPath = (goal: (t: Tile) => boolean) => findPath(game().position, goal, (x, y) => solid(x, y) || Boolean(npcAt(x, y)));

export async function walk(path: Tile[], then?: () => void): Promise<void> {
  const token = ++walkToken;
  let pos = { ...game().position };
  for (const next of path) {
    if (token !== walkToken) return;
    while (store.moving || store.working) await new Promise((r) => setTimeout(r, 30));
    if (!(await step(next.x - pos.x, next.y - pos.y))) return;
    pos = { ...game().position };
    await new Promise((r) => setTimeout(r, 60));
  }
  if (token === walkToken) then?.();
}

export async function openChat(id: string): Promise<void> {
  if (store.working) return;
  const npc = npcById(id);
  if (!npc) return;
  if (npc.dead) return feed(`${npc.name} is dead.`);
  if (npc.away) return feed(npc.absent ?? `${npc.name} isn't around.`);
  if (dist(game().position, npc) > game().map.talkRange) return feed(`You are too far from ${npc.name}.`);
  speaker.stop();
  store.talking = id;
  store.logs[id] ??= [];
  $("chat").hidden = false;
  chatHooks.render(true);
  await act({ action: "open", npc: id });
  if (store.talking === id) $("line").focus();
}

export function closeChat(): void {
  store.talking = null;
  $("chat").hidden = true;
  speaker.stop();
  chatHooks.onClose();
}

export function sendLine(mode: string, text: string): void {
  if (!store.talking || store.working) return;
  const trimmed = text.trim();
  if (mode === "say" && !trimmed) return;
  speaker.stop(); // you talk over them
  const label = mode === "say" ? trimmed : `(${mode}) ${trimmed || "…"}`;
  (store.logs[store.talking] ??= []).push({ kind: "you", text: label });
  addBubble(store.talking, { kind: "you", text: label });
  void act({ action: mode, text: trimmed, npc: store.talking });
}

export const fightCreature = (c: CreatureView) => act({ action: "hunt", creature: c.uid });
export const runFrom = (c: CreatureView) => act({ action: "escape", creature: c.uid });

export async function newGame(): Promise<void> {
  if (!confirm("Start a new game? This overwrites your save. NPC deaths stay permanent.")) return;
  const data = await postNew();
  if (!data.state) return;
  for (const k of Object.keys(store.logs)) delete store.logs[k];
  store.lastNewsId = null;
  setState(data.state);
  closeChat();
  $("feed").replaceChildren();
  renderAll();
}

/** Clicking the map: fight, talk, loot, or walk there. */
export function clickTile(x: number, y: number): void {
  if (!store.state || store.working) return;
  const s = store.state;
  const range = s.map.talkRange;
  const beast = creatureAt(x, y);
  if (beast) {
    if (dist(s.position, beast) <= range) return void fightCreature(beast);
    const path = playerPath((c) => dist(c, beast) <= range);
    return path ? void walk(path) : feed("You can't find a way there.");
  }
  const npc = s.npcs.find((n) => n.x === x && n.y === y && !n.away);
  if (npc) {
    if ((npc.dead || npc.unconscious) && dist(s.position, npc) <= range) {
      if (confirm(`${npc.name} lies ${npc.dead ? "dead" : "out cold"}. Take what they carry? (It's a crime, if anyone sees.)`)) void act({ action: "loot", npc: npc.id });
      return;
    }
    if (dist(s.position, npc) <= range) return void openChat(npc.id);
    if (npc.dead) return;
    const path = playerPath((c) => dist(c, npc) <= range);
    return path ? void walk(path, () => void openChat(npc.id)) : feed("You can't find a way there.");
  }
  if (solid(x, y)) return;
  const path = playerPath((c) => c.x === x && c.y === y);
  if (path) void walk(path);
}
