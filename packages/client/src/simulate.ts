/**
 * Simulate mode: press ▶ Simulate and the village lives on its own while you watch.
 * The player does nothing; the clock just keeps moving, an hour (or more) at a time,
 * through the same server call as Wait. NPCs keep their schedules, eat and gossip at the
 * inn, work, court, marry, age and die, creatures roam and hunt, bandits raid at night,
 * and the director writes the chronicle. Moving or clicking the map hands control back.
 */
import type { Snapshot } from "@millbrook/shared";
import { $ } from "./dom";
import { streamAct } from "./api";
import { feed, handleEvent, renderAll, setBusy } from "./game";
import { store } from "./store";

/** Hours passed per tick, and the pause between ticks, by speed. */
export const SPEEDS = {
  slow: { hours: 1, everyMs: 3000 },
  normal: { hours: 1, everyMs: 1000 },
  fast: { hours: 4, everyMs: 500 },
  days: { hours: 24, everyMs: 500 },
} as const;
export type Speed = keyof typeof SPEEDS;

/** Why time can't pass right now (the server won't wait mid-fight), or null. */
export function heldBy(s: Snapshot): string | null {
  if (s.engaged || s.creatures.some((c) => c.engaged)) return "you're in a fight";
  const fighter = s.npcs.find((n) => n.inCombat && !n.dead);
  if (fighter) return `${fighter.name} is in a fight`;
  return null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

class Simulation {
  running = false;
  speed: Speed = "normal";
  /** Bumped on stop, so a loop started earlier ends. */
  private run = 0;

  start(): void {
    if (this.running || !store.state) return;
    this.running = true;
    const run = ++this.run;
    feed("Simulate mode: the village lives on its own. Move or click the map to take over.");
    this.show();
    void this.loop(run);
  }

  stop(why?: string): void {
    if (!this.running) return;
    this.running = false;
    this.run++;
    if (why) feed(why);
    this.show();
  }

  toggle(): void {
    if (this.running) this.stop("Simulate mode off.");
    else this.start();
  }

  private async loop(run: number): Promise<void> {
    while (this.running && run === this.run) {
      const s = store.state;
      // Let anything in flight finish (a request, a step) before the next hour.
      if (!s || store.working || store.moving) {
        await sleep(100);
        continue;
      }
      const held = heldBy(s);
      if (held) {
        // A fight plays out on the server's combat clock; the 500 ms poll in main.ts shows it.
        this.show(`paused: ${held}`);
        await sleep(1000);
        continue;
      }
      const { hours, everyMs } = SPEEDS[this.speed];
      this.show();
      await this.passTime(hours);
      await sleep(everyMs);
    }
  }

  /** Wait, as the button does, but without a "Time passes" line every step: the clock shows that. */
  private async passTime(hours: number): Promise<void> {
    store.working = true;
    setBusy(true);
    try {
      await streamAct({ action: "wait", hours }, (ev) => {
        if (ev.t === "system" && ev.text.startsWith("Time passes.")) return;
        handleEvent(ev, null, null);
      });
    } catch (err) {
      this.stop(`Simulate mode stopped: ${(err as Error).message}`);
    } finally {
      store.working = false;
      setBusy(false);
      renderAll();
    }
  }

  private show(note?: string): void {
    const btn = $<HTMLButtonElement>("sim-btn");
    btn.textContent = this.running ? "⏸ Stop" : "▶ Simulate";
    btn.classList.toggle("on", this.running);
    const st = $("sim-status");
    st.hidden = !this.running;
    st.textContent = note ?? `${SPEEDS[this.speed].hours}h a step`;
  }
}

export const simulation = new Simulation();

/** Wire the header controls. Moving (keys) or clicking the map hands control back. */
export function setUpSimulation(): void {
  const btn = $<HTMLButtonElement>("sim-btn");
  const speed = $<HTMLSelectElement>("sim-speed");
  btn.onclick = () => simulation.toggle();
  speed.onchange = () => (simulation.speed = speed.value as Speed);
  simulation.speed = speed.value as Speed;
  const typing = () => ["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement?.tagName ?? "");
  // Capture phase: we hear it before the game acts on it.
  addEventListener("keydown", (e) => {
    if (simulation.running && e.isTrusted && !typing() && !e.metaKey && !e.ctrlKey && !e.altKey && e.key !== "Escape") simulation.stop("You take over.");
  }, true);
  $("map").addEventListener("pointerdown", (e) => {
    if (simulation.running && e.isTrusted) simulation.stop("You take over.");
  }, true);
}
