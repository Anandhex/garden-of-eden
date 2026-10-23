/**
 * The crowd's per-frame work as plain functions (N19), so a test can time it without Phaser:
 * where a walker is part-way through a step, and which few townsfolk get their names shown.
 * `CrowdLayer` calls these every frame, and `FrameMeter` is what the `?fps=1` overlay reads.
 */

/** One step of a walk: from (fx, fy) to (tx, ty) over `dur` ms starting at `t0`. */
export interface Walker {
  fx: number;
  fy: number;
  tx: number;
  ty: number;
  t0: number;
  dur: number;
}

/** Where a walker is at `time`, the little bob of its stride, and whether the step is done. */
export function walkAt(w: Walker, time: number): { x: number; y: number; bob: number; done: boolean } {
  const k = Math.min(1, (time - w.t0) / Math.max(1, w.dur));
  return { x: w.fx + (w.tx - w.fx) * k, y: w.fy + (w.ty - w.fy) * k, bob: k < 1 ? Math.abs(Math.sin(time / 70)) * -1.5 : 0, done: k >= 1 };
}

/** The indices of the nearest `max` shown people within `range` tiles of the player, nearest first. */
export function nearestShown(sprites: ReadonlyArray<{ shown: boolean; x: number; y: number }>, player: { x: number; y: number }, range: number, max: number): number[] {
  const near: Array<{ i: number; d: number }> = [];
  for (let i = 0; i < sprites.length; i++) {
    const sp = sprites[i]!;
    if (!sp.shown) continue;
    const d = Math.hypot(sp.x - player.x, sp.y - player.y);
    if (d <= range) near.push({ i, d });
  }
  near.sort((a, b) => a.d - b.d);
  return near.slice(0, max).map((n) => n.i);
}

/** The window the overlay reports the worst frame over, ms. */
export const WORST_WINDOW_MS = 10_000;

/** Frame times as they come in: the frames per second over the last second, and the worst frame in the last 10 s. */
export class FrameMeter {
  private frames: Array<{ at: number; ms: number }> = [];

  /** One frame took `ms` and ended at `at` (both ms). */
  push(at: number, ms: number): void {
    this.frames.push({ at, ms });
    const cutoff = at - WORST_WINDOW_MS;
    let drop = 0;
    while (drop < this.frames.length && this.frames[drop]!.at < cutoff) drop++;
    if (drop > 0) this.frames.splice(0, drop);
  }

  /** Frames per second over the last second. */
  fps(now: number): number {
    const recent = this.frames.filter((f) => f.at > now - 1000);
    return recent.length;
  }

  /** The longest frame in the last 10 s, ms. */
  worst(): number {
    return this.frames.reduce((m, f) => Math.max(m, f.ms), 0);
  }
}

/** `?fps=1` on the game's address shows the frame meter. */
export function fpsWanted(search = typeof location === "undefined" ? "" : location.search): boolean {
  return new URLSearchParams(search).get("fps") === "1";
}

/** A small box in a corner of the page: frames per second, the worst frame of the last 10 s, and the 60 fps verdict. */
export function mountFpsOverlay(): { update(now: number, delta: number, loopFps: number): void } {
  const meter = new FrameMeter();
  const box = document.createElement("div");
  box.style.cssText = "position:fixed;right:8px;bottom:8px;z-index:99999;padding:4px 8px;font:12px/1.3 ui-monospace,monospace;color:#fff;background:rgba(0,0,0,.65);border-radius:6px;pointer-events:none;white-space:pre";
  document.body.append(box);
  let shown = 0;
  return {
    update(now, delta, loopFps) {
      meter.push(now, delta);
      // The text changes a few times a second, not every frame (so the meter doesn't cost what it measures).
      if (now - shown < 250) return;
      shown = now;
      const fps = Math.round(loopFps || meter.fps(now));
      const worst = meter.worst();
      box.textContent = `${fps} fps\nworst frame ${worst.toFixed(1)} ms (last 10 s)`;
      box.style.background = fps >= 58 && worst < 34 ? "rgba(20,90,40,.8)" : fps >= 45 ? "rgba(120,90,10,.8)" : "rgba(130,30,30,.85)";
    },
  };
}
