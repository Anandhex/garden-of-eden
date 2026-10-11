// Millbrook in the browser: a Phaser world view (world/WorldScene.ts), DOM side panels
// (ui/), and NPC voices (voice/). The server owns every rule; this only shows its
// state and sends what the player does.
import "./style.css";
import { $ } from "./dom";
import { act, cancelWalk, closeChat, feed, fightCreature, nearest, nearestCreature, newGame, openChat, refresh, renderAll, runFrom, step } from "./game";
import { store } from "./store";
import { setUpChat } from "./ui/chat";
import { showCraft, showVoices } from "./ui/modals";
import { renderHeader, setUpSheet } from "./ui/sheet";
import { speaker } from "./voice/speaker";
import { startWorld } from "./world/WorldScene";

setUpChat();
setUpSheet();

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
    const n = nearest();
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

// Ollama may start after the page does: keep checking until it's up.
setInterval(() => {
  if (store.state && !store.state.llm.ready && !store.working) void refresh();
}, 15000);

// ---------- start ----------

await Promise.all([refresh(), speaker.init()]);
startWorld($("map"), store.state!);
renderAll();
feed("You arrive in Millbrook. Walk up to someone and press E to talk.");
if (speaker.info.backend === "piper") feed(`Voices: ${speaker.info.note}`);
