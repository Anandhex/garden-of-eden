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
  marks?: boolean;
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
  /** The place's marks (N31): burned houses, scaffolding, graves, banners, empty stalls. */
  marks: NonNullable<Frame["marks"]> = [];
  player = { id: "player" as const, x: 0, y: 0 };
  ambience: Frame["ambience"] = { light: 1, timeOfDay: "day", weather: "clear", season: "spring" };
  prompt: Frame["prompt"] = null;
  /** The fight clock, and when it was heard (performance.now), so it can count down between frames. */
  fight: (NonNullable<Frame["fight"]> & { at: number }) | null = null;
  stepMs = 100;
  ui: UiModel | null = null;

  applyFrame(f: Frame, whole: boolean): FrameChange {
    const change: FrameChange = { whole, added: [], updated: [], moved: [], removed: [], patches: f.patches ?? [], buildings: !!f.buildings, lights: !!f.lights, signs: !!f.signs, marks: !!f.marks };
    if (whole) {
      this.marks = [];
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
    if (f.drop) {
      // Changes only: drop what left the view, then put in the new and changed by id.
      this.buildings = mergeById(this.buildings, f.buildings ?? [], f.drop.buildings);
      this.lights = mergeById(this.lights, f.lights ?? [], f.drop.lights);
      change.buildings = !!f.buildings?.length || f.drop.buildings.length > 0;
      change.lights = !!f.lights?.length || f.drop.lights.length > 0;
    } else {
      if (f.buildings) this.buildings = f.buildings;
      if (f.lights) this.lights = f.lights;
    }
    if (f.signs) this.signs = f.signs;
    if (f.marks) this.marks = f.marks;
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

  /** The land's height at a tile in tiles (G7 Part B), if its patch has come; a patch without heights is flat. */
  heightAt(x: number, y: number): number | undefined {
    const p = this.patches.get(this.patchKey(x, y));
    if (!p || x < p.x0 || y < p.y0 || x >= p.x0 + p.w || y >= p.y0 + p.h) return undefined;
    return (p.height?.[(y - p.y0) * p.w + (x - p.x0)] ?? 0) / 8;
  }

  /** A mark on a tile, if any (its words go in the hover). */
  markAt(x: number, y: number): NonNullable<Frame["marks"]>[number] | undefined {
    return this.marks.find((m) => x >= m.x && x < m.x + m.w && y >= m.y && y < m.y + m.h);
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

/** A list with `gone` taken out and `upsert` put in by id (in place where it was, at the end if new). */
function mergeById<T extends { id: K }, K>(list: T[], upsert: T[], gone: K[]): T[] {
  const drop = new Set(gone);
  const byId = new Map(upsert.map((x) => [x.id, x]));
  const out = list.filter((x) => !drop.has(x.id)).map((x) => byId.get(x.id) ?? x);
  const have = new Set(out.map((x) => x.id));
  for (const x of upsert) if (!have.has(x.id)) out.push(x);
  return out;
}
