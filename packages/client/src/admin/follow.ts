import { type AdminClock, type AdminCrowd, CrowdSim } from "@millbrook/shared";
import { el } from "../dom";
import { api } from "./api";

/**
 * Following someone (N17): their settlement's map with every townsperson on it, drawn
 * on a canvas with the same crowd simulation the game uses (@millbrook/shared), centred
 * on the person followed. Read-only: where everyone is comes from the roster, the map and the clock.
 */

const TILE_COLORS: Record<string, string> = { grass: "#2d4a2b", path: "#8a7a5a", water: "#3b6fa5", tree: "#1d3a1c", wall: "#5b5b63", door: "#a0743c" };
/** Most tiles across/down the view; a bigger map is cropped around the person. */
const VIEW_W = 44;
const VIEW_H = 30;

interface Loaded {
  crowd: AdminCrowd;
  sim: CrowdSim;
}

const cache = new Map<string, Promise<Loaded>>();

function load(site: string): Promise<Loaded> {
  let p = cache.get(site);
  if (!p) {
    p = api.crowd(site).then((crowd) => ({ crowd, sim: new CrowdSim(crowd.map, crowd.roster) }));
    cache.set(site, p);
    p.catch(() => cache.delete(site));
  }
  return p;
}

/** Forget loaded places (the roster changes with the realm's days). */
export function forgetCrowds(): void {
  cache.clear();
}

export class FollowView {
  readonly el = el("div", { className: "follow" });
  private readonly canvas = el("canvas", { className: "follow-canvas" });
  private readonly caption = el("p", { className: "muted" });
  private who: { site: string; id: string } | null = null;

  constructor() {
    this.el.append(this.caption, this.canvas);
    this.el.hidden = true;
  }

  follow(who: { site: string; id: string } | null): void {
    this.who = who;
    this.el.hidden = who === null;
  }

  get following(): boolean {
    return this.who !== null;
  }

  /** Redraw for the clock. */
  async draw(clock: AdminClock): Promise<void> {
    if (!this.who) return;
    const who = this.who;
    let loaded: Loaded;
    try {
      loaded = await load(who.site);
    } catch (err) {
      this.caption.textContent = `Couldn't load that place: ${(err as Error).message}`;
      return;
    }
    if (this.who !== who) return;
    const { crowd, sim } = loaded;
    const minute = clock.hour * 60 + clock.minute;
    const pos = sim.all(clock.day, minute, crowd.day);
    const idx = who.id ? sim.index.get(who.id) : undefined;
    const target = idx !== undefined ? pos[idx] : undefined;
    const { w, h } = crowd.map;
    // The view: the whole map if it fits, else a window around the person (or the middle).
    const vw = Math.min(w, VIEW_W);
    const vh = Math.min(h, VIEW_H);
    const cx = target?.x ?? Math.floor(w / 2);
    const cy = target?.y ?? Math.floor(h / 2);
    const x0 = Math.max(0, Math.min(w - vw, Math.round(cx - vw / 2)));
    const y0 = Math.max(0, Math.min(h - vh, Math.round(cy - vh / 2)));
    const cell = Math.max(8, Math.floor(Math.min(this.el.clientWidth || 640, 880) / vw));
    this.canvas.width = vw * cell;
    this.canvas.height = vh * cell;
    const g = this.canvas.getContext("2d")!;
    for (let y = 0; y < vh; y++) for (let x = 0; x < vw; x++) {
      g.fillStyle = TILE_COLORS[crowd.map.tiles[y0 + y]?.[x0 + x] ?? "grass"] ?? "#2d4a2b";
      g.fillRect(x * cell, y * cell, cell, cell);
    }
    g.font = `${Math.max(9, cell * 0.8)}px system-ui, sans-serif`;
    for (const b of crowd.map.buildings) {
      if (b.x + b.w < x0 || b.y + b.h < y0 || b.x > x0 + vw || b.y > y0 + vh) continue;
      g.fillStyle = "rgba(160,116,60,0.55)";
      g.fillRect((b.x - x0) * cell, (b.y - y0) * cell, b.w * cell, b.h * cell);
      g.strokeStyle = "rgba(0,0,0,0.5)";
      g.strokeRect((b.x - x0) * cell, (b.y - y0) * cell, b.w * cell, b.h * cell);
      if (b.name) {
        g.fillStyle = "#f3efe6";
        g.fillText(b.name, (b.x - x0) * cell + 2, (b.y - y0) * cell + cell * 0.9);
      }
    }
    let out = 0;
    sim.roster.people.forEach((p, i) => {
      const at = pos[i]!;
      if (!at.visible) return;
      out++;
      if (at.x < x0 || at.y < y0 || at.x >= x0 + vw || at.y >= y0 + vh) return;
      g.fillStyle = p.color;
      g.beginPath();
      g.arc((at.x - x0 + 0.5) * cell, (at.y - y0 + 0.5) * cell, cell * (i === idx ? 0.5 : 0.32), 0, Math.PI * 2);
      g.fill();
    });
    if (target?.visible) {
      const p = sim.roster.people[idx!]!;
      g.strokeStyle = "#ffd27a";
      g.lineWidth = 2;
      g.beginPath();
      g.arc((target.x - x0 + 0.5) * cell, (target.y - y0 + 0.5) * cell, cell * 0.85, 0, Math.PI * 2);
      g.stroke();
      g.fillStyle = "#ffd27a";
      g.fillText(p.name, (target.x - x0 + 1.5) * cell, (target.y - y0 + 0.3) * cell);
    }
    const p = idx !== undefined ? sim.roster.people[idx] : undefined;
    this.caption.textContent = `${crowd.name} at ${String(clock.hour).padStart(2, "0")}:${String(clock.minute).padStart(2, "0")}, day ${clock.day}: ${out} of ${sim.roster.people.length} townsfolk out.${p ? ` ${p.name} is ${target?.visible ? target.doing : `${target?.doing ?? "out of sight"} (indoors)`}.` : who.id ? "" : " (Talking NPCs' spots are the live game's, so none is picked out here.)"}`;
  }
}
