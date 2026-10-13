// The realm in the browser: a Phaser world view (world/WorldScene.ts), DOM side panels
// (ui/), and NPC voices (voice/). The server owns every rule; this only shows its
// state and sends what the player does.
import "./style.css";
import { setUpSimulation } from "./simulate";
import { $ } from "./dom";
import { act, cancelWalk, closeChat, feed, fightCreature, handleEvent, nearestCreature, nearestTalker, newGame, openChat, refresh, renderAll, runFrom, setState, step } from "./game";
import { postTick } from "./api";
import { heldBy, simulation } from "./simulate";
import { store } from "./store";
import { setUpChat } from "./ui/chat";
import { showCraft, showVoices } from "./ui/modals";
import { renderHeader, setUpSheet } from "./ui/sheet";
import { speaker } from "./voice/speaker";
import { startWorld } from "./world/WorldScene";

setUpChat();
setUpSheet();
setUpSimulation();

// ---------- keys (read by the page, not Phaser, so typing never moves you) ----------

const KEYS: Record<string, [number, number]> = { ArrowUp: [0, -1], w: [0, -1], ArrowDown: [0, 1], s: [0, 1], ArrowLeft: [-1, 0], a: [-1, 0], ArrowRight: [1, 0], d: [1, 0] };

addEventListener("keydown", (e) => {
  if (!store.state || e.metaKey || e.ctrlKey || e.altKey) return;
  const typing = ["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement?.tagName ?? "");
  const modalOpen = $<HTMLDialogElement>("modal").open;
  if (e.key === "Escape" && store.talking && !modalOpen) return void (closeChat(), renderAll());
  if (e.key === "Escape" && typing) return void (document.activeElement as HTMLElement).blur();
  if (typing || modalOpen) return;
  const dir = KEYS[e.key] ?? KEYS[e.key.toLowerCase()];
  const key = e.key.toLowerCase();
  if (dir) {
    e.preventDefault();
    cancelWalk();
    void step(dir[0], dir[1]);
  } else if (key === "e") {
    const n = nearestTalker();
    if (n) void openChat(n.id);
  } else if (key === "f" && !store.talking) {
    const c = nearestCreature();
    if (c) void fightCreature(c);
  } else if (key === "r" && !store.talking) {
    const c = store.state.creatures.find((x) => x.engaged);
    if (c) void runFrom(c);
  }
});

// ---------- header buttons ----------

$("forage-btn").onclick = () => void act({ action: "forage" });
$("craft-btn").onclick = () => showCraft();
$("sneak-btn").onclick = () => void act({ action: "sneak" });
for (const b of document.querySelectorAll<HTMLButtonElement>("[data-wait]")) b.onclick = () => void act({ action: "wait", hours: Number(b.dataset.wait) });
$("newgame").onclick = () => void newGame();
$("voice-btn").onclick = () => showVoices(() => renderHeader());
$("modal-close").onclick = () => $<HTMLDialogElement>("modal").close();

// ---------- polling ----------

// In a fight the server's combat clock may play the opponent's turn: poll for it.
setInterval(async () => {
  if (!store.state?.fight || store.working || store.moving) return;
  try {
    await refresh(true);
  } catch {
    // the next poll will try again
  }
}, 500);

// Time flows while you stand about (N16): a game minute every few seconds, so the townsfolk keep
// going about their day. Not while you talk, fight, walk or simulate, nor with the tab hidden.
const TIME_KEY = "millbrook.timeFlows";
let timeFlows = (() => {
  try {
    return localStorage.getItem(TIME_KEY) !== "off";
  } catch {
    return true;
  }
})();
const timeBtn = $<HTMLButtonElement>("time-btn");
const showTime = () => {
  const off = !store.state?.timeFlowSeconds;
  timeBtn.hidden = off;
  timeBtn.textContent = timeFlows ? "⏸ Time" : "▶ Time";
  timeBtn.title = timeFlows ? "Time flows while you stand about. Click to make it wait for you." : "Time waits for you. Click to let it flow while you stand about.";
  timeBtn.classList.toggle("on", timeFlows);
};
timeBtn.onclick = () => {
  timeFlows = !timeFlows;
  try {
    localStorage.setItem(TIME_KEY, timeFlows ? "on" : "off");
  } catch {
    // remembered for this page only
  }
  showTime();
};
let lastTick = performance.now();
setInterval(async () => {
  const s = store.state;
  if (!s || !timeFlows || !s.timeFlowSeconds) return;
  if (performance.now() - lastTick < s.timeFlowSeconds * 1000) return;
  if (store.talking || store.working || store.moving || simulation.running || heldBy(s) || s.fight || document.visibilityState !== "visible") {
    lastTick = performance.now();
    return;
  }
  lastTick = performance.now();
  try {
    const r = await postTick();
    // Something else got in first (a step, a word): its own answer has the state.
    if (!r.state || store.working || store.moving) return;
    setState(r.state);
    for (const line of r.log) feed(line);
    for (const e of r.events) handleEvent({ t: "event", event: e }, null, null);
    renderAll();
  } catch {
    // the next tick will try again
  }
}, 250);

// Ollama may start after the page does: keep checking until it's up.
setInterval(() => {
  if (store.state && !store.state.llm.ready && !store.working) void refresh();
}, 15000);

// ---------- start ----------

await Promise.all([refresh(), speaker.init()]);
showTime();
startWorld($("map"), store.state!);
renderAll();
feed(`You're in ${store.state!.site.name}. Walk up to anyone and press E to talk.`);
if (speaker.info.backend === "piper") feed(`Voices: ${speaker.info.note}`);
