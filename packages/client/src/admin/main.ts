/**
 * The admin page (N17, /admin): the whole world as it really is. A realm map with its
 * numbers, an event stream with reasons, search, pinned people and places (the player
 * too), and health. Read-only; the time controls in the header are the one exception.
 * Imported only by admin.html, so the game's bundle never carries it.
 */
import type { AdminClock, AdminTimeRequest } from "@millbrook/shared";
import { $ } from "../dom";
import { api } from "./api";
import { nav } from "./nav";
import { EventsView } from "./views/events";
import { GossipView } from "./views/gossip";
import { HealthView } from "./views/health";
import { OverviewView } from "./views/overview";
import { PinnedView } from "./views/pinned";
import { RoadsView } from "./views/roads";
import { SearchView } from "./views/search";
import type { View } from "./views/types";

const POLL_MS = 2000;

const views: Record<string, View> = {
  overview: new OverviewView(),
  events: new EventsView(),
  search: new SearchView(),
  pinned: new PinnedView(),
  roads: new RoadsView(),
  gossip: new GossipView(),
  health: new HealthView(),
};
let tab = "overview";
let clock: AdminClock | null = null;
let ticking = false;

const mount = $("views");
for (const [name, v] of Object.entries(views)) {
  v.el.hidden = name !== tab;
  mount.append(v.el);
}

function show(name: string): void {
  tab = name;
  for (const [n, v] of Object.entries(views)) v.el.hidden = n !== name;
  for (const b of document.querySelectorAll<HTMLButtonElement>("#tabs button")) b.classList.toggle("on", b.dataset.tab === name);
  void tick();
}
for (const b of document.querySelectorAll<HTMLButtonElement>("#tabs button")) b.addEventListener("click", () => show(b.dataset.tab!));

nav.openCard = (ref) => {
  (views.pinned as PinnedView).open(ref);
  show("pinned");
};

function drawClock(c: AdminClock): void {
  clock = c;
  $("clock").textContent = `Day ${c.day}, ${String(c.hour).padStart(2, "0")}:${String(c.minute).padStart(2, "0")}`;
  $("paused").hidden = !c.paused;
  $("pause-btn").textContent = c.paused ? "▶ Resume" : "⏸ Pause";
}

let noteTimer: ReturnType<typeof setTimeout> | undefined;
/** Show a line under the header; an error stays until the next good poll, a result for a few seconds. */
function note(text: string | null, lasts = 0): void {
  const n = $("note");
  n.hidden = text === null;
  n.textContent = text ?? "";
  clearTimeout(noteTimer);
  if (text !== null && lasts > 0) noteTimer = setTimeout(() => note(null), lasts);
}
let errorShown = false;

async function tick(): Promise<void> {
  if (ticking || document.visibilityState === "hidden") return;
  ticking = true;
  try {
    drawClock(await api.clock());
    // The pickers in the events tab need the realm's places and factions once.
    if (!(views.events as EventsView & { ready?: boolean }).ready) {
      const o = await api.overview();
      (views.events as EventsView).fill(o.realm?.settlements ?? [], o.realm?.factions ?? []);
      (views.events as EventsView & { ready?: boolean }).ready = true;
    }
    if (errorShown) note(null);
    errorShown = false;
    await views[tab]!.refresh(clock!);
  } catch (err) {
    errorShown = true;
    note(`Can't reach the game server: ${(err as Error).message}`);
  } finally {
    ticking = false;
  }
}

async function time(req: AdminTimeRequest): Promise<void> {
  const buttons = document.querySelectorAll<HTMLButtonElement>("#time-controls button");
  buttons.forEach((b) => (b.disabled = true));
  note(req.action === "fast" ? `Fast-forwarding ${req.days} days… (the game answers when it's done)` : null);
  try {
    const r = await api.time(req);
    drawClock(r.clock);
    note(r.ok ? r.message : `Not done: ${r.message}`, 6000);
  } catch (err) {
    note(`The time control failed: ${(err as Error).message}`);
  } finally {
    buttons.forEach((b) => (b.disabled = false));
    await tick();
  }
}

$("pause-btn").addEventListener("click", () => void time({ action: clock?.paused ? "resume" : "pause" }));
for (const b of document.querySelectorAll<HTMLButtonElement>("[data-time]")) b.addEventListener("click", () => void time({ action: b.dataset.time as AdminTimeRequest["action"] }));
$("fast-btn").addEventListener("click", () => void time({ action: "fast", days: Number(($("fast-days") as HTMLSelectElement).value) }));

document.addEventListener("visibilitychange", () => void tick());
setInterval(() => void tick(), POLL_MS);
void tick();
