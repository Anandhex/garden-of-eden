/**
 * The latest of what the server sent (G5): the frame applied change by change (actors, the patch cache, buildings,
 * lights, signs) and the UI model panel by panel. No rules: it only keeps what it was told.
 */
import { OBJECT_IDS, TERRAIN_IDS, type Actor, type Frame, type Patch, type UiModel } from "@millbrook/shared/view";

export interface FrameChange {
  /** A new map (or the first frame): everything was replaced. */
  whole: boolean;
  added: string[];
  updated: string[];
  moved: string[];
  removed: string[];
  patches: Patch[];
  buildings: boolean;
  lights: boolean;
  signs: boolean;
}

export const PATCH = 16;

export class Mirror {
  map: Frame["map"] | null = null;
  box: Frame["box"] = { x0: 0, y0: 0, x1: 0, y1: 0 };
  readonly actors = new Map<string, Actor>();
  readonly patches = new Map<string, Patch>();
  buildings: NonNullable<Frame["buildings"]> = [];
  lights: NonNullable<Frame["lights"]> = [];
  signs: NonNullable<Frame["signs"]> = [];
  player = { id: "player" as const, x: 0, y: 0 };
  ambience: Frame["ambience"] = { light: 1, timeOfDay: "day", weather: "clear", season: "spring" };
  prompt: Frame["prompt"] = null;
  /** The fight clock, and when it was heard (performance.now), so it can count down between frames. */
  fight: (NonNullable<Frame["fight"]> & { at: number }) | null = null;
  stepMs = 100;
  ui: UiModel | null = null;

  applyFrame(f: Frame, whole: boolean): FrameChange {
    const change: FrameChange = { whole, added: [], updated: [], moved: [], removed: [], patches: f.patches ?? [], buildings: !!f.buildings, lights: !!f.lights, signs: !!f.signs };
    if (whole) {
      this.actors.clear();
      this.patches.clear();
      this.buildings = [];
      this.lights = [];
      this.signs = [];
    }
    this.map = f.map;
    this.box = f.box;
    for (const p of change.patches) this.patches.set(this.patchKey(p.x0, p.y0), p);
    for (const a of f.actors.upsert) {
      (this.actors.has(a.id) ? change.updated : change.added).push(a.id);
      this.actors.set(a.id, a);
    }
    const routes = new Map((f.actors.routes ?? []).map((r) => [r.id, r.route]));
    for (const [id, x, y] of f.actors.move ?? []) {
      const a = this.actors.get(id);
      if (!a) continue;
      a.x = x;
      a.y = y;
      const route = routes.get(id);
      if (route) a.route = route;
      else delete a.route;
      change.moved.push(id);
    }
    for (const id of f.actors.remove) if (this.actors.delete(id)) change.removed.push(id);
    if (f.buildings) this.buildings = f.buildings;
    if (f.lights) this.lights = f.lights;
    if (f.signs) this.signs = f.signs;
    this.player = f.player;
    this.ambience = f.ambience;
    this.prompt = f.prompt;
    this.fight = f.fight ? { ...f.fight, at: performance.now() } : null;
    this.stepMs = f.stepMs;
    return change;
  }

  private patchKey(x0: number, y0: number): string {
    return `${Math.floor(x0 / PATCH)}:${Math.floor(y0 / PATCH)}`;
  }

  /** The art at a tile, if its patch has come (undefined until then). */
  tileAt(x: number, y: number): { ground: (typeof TERRAIN_IDS)[number]; object: (typeof OBJECT_IDS)[number] } | undefined {
    const p = this.patches.get(this.patchKey(x, y));
    if (!p) return undefined;
    const i = (y - p.y0) * p.w + (x - p.x0);
    if (x < p.x0 || y < p.y0 || x >= p.x0 + p.w || y >= p.y0 + p.h) return undefined;
    return { ground: TERRAIN_IDS[p.ground[i]!] ?? "terrain/grass", object: OBJECT_IDS[p.objects[i]!] ?? null };
  }

  /** Someone to point at on a tile (the nearest actor within half a tile; travellers stand between tiles). */
  actorAt(x: number, y: number): Actor | undefined {
    let best: Actor | undefined;
    let bd = 0.75;
    for (const a of this.actors.values()) {
      if (a.id === "player") continue;
      const d = Math.hypot(a.x - x, a.y - y);
      if (d < bd) {
        bd = d;
        best = a;
      }
    }
    return best;
  }

  buildingAt(x: number, y: number): NonNullable<Frame["buildings"]>[number] | undefined {
    return this.buildings.find((b) => x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h);
  }

  applyUi(u: Partial<UiModel>): Array<keyof UiModel> {
    const keys = Object.keys(u) as Array<keyof UiModel>;
    this.ui = { ...(this.ui ?? ({} as UiModel)), ...u } as UiModel;
    return keys;
  }

  appendFeed(lines: UiModel["feed"]["lines"]): void {
    if (!this.ui) return;
    const all = [...(this.ui.feed?.lines ?? []), ...lines];
    this.ui.feed = { lines: all.slice(-200) };
  }
}
