/**
 * G6: the look. The art ids are covered both ways (the frame builder → art.ts → the web manifest → packed frames);
 * the committed sheets, tilesets and templates are what `npm run art` makes now; every template tile is in a
 * tileset and every template dresses a building fully; a town at night has lit windows exactly where someone is
 * home; the light plan (ambient, nearest lights); and a recording replays with no art falling back.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ART_IDS, CREATURE_IDS, dress, FrameSchema, OBJECT_IDS, TEMPLATE_IDS, TEMPLATES, templateFor, TERRAIN_IDS, WINDOW_TILES, type Frame } from "@millbrook/shared/view";
import { decodePng } from "../../../art/png.js";
import { packAll } from "../../../art/pack.js";
import { Mirror } from "../../client/src/core/mirror.js";
import { FRAMES, framesOf, MANIFEST, missingArt, SHEET_ART } from "../../client/src/adapter/web/art.js";
import { ambientOf, nearestLights } from "../../client/src/adapter/web/world/lightPlan.js";
import { fakeModel, ProtocolClient, startGame, type GameProcess } from "../scripts/game-process.js";
import { buildingLights, daylight } from "../src/view/frame.js";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const read = (p: string) => readFileSync(join(root, p));

describe("G6 art ids, both ways", () => {
  it("every id the frame builder can send is in art.ts", () => {
    const src = read("packages/server/src/view/frame.ts").toString();
    const literal = [...src.matchAll(/"((?:terrain|props|buildings|people|creature|fx)\/[a-z_]+)"/g)].map((m) => m[1]!);
    const creatures = /\["wolf", "bear", "boar", "spider", "horse"\]/.exec(src) ? ["wolf", "bear", "boar", "spider", "horse"].map((k) => `creature/${k}`) : [];
    expect(creatures.length).toBe(5);
    const sent = [...new Set([...literal, ...creatures, "creature/beast", ...TERRAIN_IDS, ...OBJECT_IDS.filter((x) => x !== null)])];
    expect(sent.filter((id) => !ART_IDS.includes(id))).toEqual([]);
    expect(CREATURE_IDS).toContain("creature/beast");
  });

  it("every id in art.ts has a code-drawn fallback and real art, every frame of which was packed", () => {
    expect(ART_IDS.filter((id) => !(id in MANIFEST))).toEqual([]);
    expect(ART_IDS.filter((id) => !(id in SHEET_ART))).toEqual([]);
    expect(missingArt(ART_IDS)).toEqual([]);
    // People walk four ways in three steps, each in four tinted layers; creatures trot two frames each way.
    expect(framesOf("people/body")).toHaveLength(4 * 3 * 4);
    for (const c of CREATURE_IDS) expect(framesOf(c)).toHaveLength(4);
  });
});

describe("G6 the art pipeline", () => {
  const packed = packAll(root);

  it("the committed sheets, tilesets, frame index and templates are what `npm run art` makes now", () => {
    for (const [path, body] of packed.files) {
      if (path.endsWith(".png")) {
        const want = decodePng(body as Buffer);
        const have = decodePng(read(path));
        expect([have.w, have.h], `${path} is stale: run npm run art`).toEqual([want.w, want.h]);
        expect(Buffer.from(have.rgba).equals(Buffer.from(want.rgba)), `${path} is stale: run npm run art`).toBe(true);
      } else expect(read(path).toString(), `${path} is stale: run npm run art`).toBe(body);
    }
  });

  it("sheets are 64 px a tile (16 px art at ×4), every frame inside its atlas", () => {
    for (const sheet of ["terrain", "buildings", "props", "people", "creatures", "fx"]) {
      const atlas = JSON.parse(read(`packages/client/public/art/${sheet}.json`).toString()) as { frames: Record<string, { frame: { x: number; y: number; w: number; h: number } }>; meta: { size: { w: number; h: number } } };
      for (const [name, f] of Object.entries(atlas.frames)) {
        expect(f.frame.x + f.frame.w, name).toBeLessThanOrEqual(atlas.meta.size.w);
        expect(f.frame.y + f.frame.h, name).toBeLessThanOrEqual(atlas.meta.size.h);
        expect(f.frame.w, name).toBe(FRAMES[name]!.w * 4);
      }
    }
    expect(FRAMES["terrain/grass_0"]).toMatchObject({ w: 16, h: 16 });
  });

  it("templates load, and every template tile is in a Tiled tileset (and every prop a packed frame)", () => {
    const tsj = JSON.parse(read("art/tiled/buildings.tsj").toString()) as { tiles: Array<{ properties: Array<{ name: string; value: string }> }>; wangsets: Array<{ name: string }> };
    const inTileset = new Set(tsj.tiles.map((t) => t.properties.find((p) => p.name === "art")!.value));
    expect(TEMPLATE_IDS.length).toBeGreaterThanOrEqual(8);
    for (const id of ["house_a", "smithy", "inn", "farm", "market"]) expect(TEMPLATES[id], id).toBeTruthy();
    for (const [id, t] of Object.entries(TEMPLATES)) {
      for (const name of [...t.roof.flat(), ...t.walls.flat(), t.door, t.porch]) if (name) expect(inTileset.has(name), `${id}: ${name}`).toBe(true);
      for (const p of t.props) expect(FRAMES[p.art!], `${id}: ${p.art}`).toBeTruthy();
      for (const l of t.lights) expect(["lamp", "fire", "torch", "forge", "magic"]).toContain(l.kind);
    }
    for (const glow of Object.values(WINDOW_TILES)) expect(FRAMES[glow]).toBeTruthy();
    // The Wang sets: grass with path, road, water and sand (corners), and the walls (edges).
    const terrain = JSON.parse(read("art/tiled/terrain.tsj").toString()) as { wangsets: Array<{ name: string; wangtiles: unknown[] }> };
    expect(terrain.wangsets.map((w) => w.name).sort()).toEqual(["grass-path", "grass-road", "grass-sand", "grass-water"]);
    for (const w of terrain.wangsets) expect(w.wangtiles).toHaveLength(16);
    expect(tsj.wangsets.map((w) => w.name)).toEqual(["walls"]);
  });

  it("every building kind the generator makes has a template, picked the same every time", () => {
    for (const k of ["house", "manor", "inn", "smithy", "hall", "temple", "market", "guildhall", "barracks", "granary", "palace"]) expect(TEMPLATES[templateFor(k, "", `m:${k}`)], k).toBeTruthy();
    expect(templateFor(undefined, "Fire", "camp:4")).toBe("camp");
    expect(templateFor(undefined, "Chief's tent", "camp:0")).toBe("tent");
    expect(templateFor(undefined, "Spoil heap", "mine:1")).toBe("heap");
    expect(templateFor("house", "", "town:7")).toBe(templateFor("house", "", "town:7"));
    const picks = new Set(Array.from({ length: 40 }, (_, i) => templateFor("house", "", `town:${i}`)));
    expect(picks.size).toBeGreaterThan(1);
  });

  it("a template dresses a building of any size fully: nothing in it drawn as empty, the door in the front wall", () => {
    for (const id of TEMPLATE_IDS) {
      const t = TEMPLATES[id]!;
      for (let w = 1; w <= 7; w++) {
        for (let h = 1; h <= 4; h++) {
          const b = { x: 10, y: 10, w, h, door: { x: 10 + Math.floor(w / 2), y: 10 + h - 1 } };
          const d = dress(t, b);
          const covered = new Set([...d.roof, ...d.walls].map((p) => `${p.x},${p.y}`));
          for (let y = b.y; y < b.y + h; y++) for (let x = b.x; x < b.x + w; x++) expect(covered.has(`${x},${y}`), `${id} ${w}×${h} at ${x},${y}`).toBe(true);
          expect(d.walls.find((p) => p.x === b.door.x && p.y === b.door.y)?.frame, `${id} ${w}×${h}`).toBe(t.door);
        }
      }
    }
    // A north door gets a porch instead.
    expect(dress(TEMPLATES.house_a!, { x: 0, y: 0, w: 3, h: 2, door: { x: 1, y: 0 } }).door).toEqual({ x: 1, y: 0, front: false });
  });
});

describe("G6 light as facts", () => {
  it("windows are lit after dark only where someone is home; lamps after dark; a smithy's forge by day", () => {
    const b = { x: 2, y: 2, w: 4, h: 3, door: { x: 3, y: 4 } };
    const night = { dark: true, lit: true, occupied: true };
    const empty = { dark: true, lit: false, occupied: false };
    expect(buildingLights(0, "house_a", b, night).filter((l) => l.kind === "window").every((l) => l.on)).toBe(true);
    expect(buildingLights(0, "house_a", b, night).filter((l) => l.kind === "window").length).toBeGreaterThan(0);
    expect(buildingLights(0, "house_a", b, empty).some((l) => l.on)).toBe(false);
    const inn = buildingLights(1, "inn", b, empty);
    expect(inn.filter((l) => l.kind === "lamp").every((l) => l.on)).toBe(true);
    expect(inn.find((l) => l.kind === "fire")?.on).toBe(false);
    expect(buildingLights(2, "smithy", b, { dark: false, lit: false, occupied: false }).find((l) => l.kind === "forge")?.on).toBe(true);
    expect(buildingLights(3, "camp", { x: 1, y: 1, w: 1, h: 1, door: null }, empty).find((l) => l.kind === "fire")?.on).toBe(true);
    expect(daylight(23, 0)).toBe(0);
    expect(daylight(12, 0)).toBe(1);
  });

  it("the ambient light: night blue, noon white, dusk orange, dawn warm; weather dims it", () => {
    const at = (light: number, timeOfDay: string, weather = "clear") => ambientOf({ light, timeOfDay, weather, season: "spring" });
    const [nr, ng, nb] = at(0, "night");
    expect(nb).toBeGreaterThan(nr);
    expect(nr + ng + nb).toBeLessThan(1.2);
    expect(at(1, "afternoon")).toEqual([1, 1, 1]);
    const dusk = at(0.6, "evening");
    expect(dusk[0]).toBeGreaterThan(dusk[2] + 0.4);
    const dawn = at(0.6, "morning");
    expect(dawn[0]).toBeGreaterThan(dawn[2]);
    expect(at(1, "afternoon", "storm")[0]).toBeLessThan(at(1, "afternoon", "rain")[0]);
    expect(at(1, "afternoon", "rain")[0]).toBeLessThan(1);
  });

  it("the real lights go to the nearest that are on, within the budget", () => {
    const lights = Array.from({ length: 40 }, (_, i) => ({ id: `l${i}`, x: i, y: 0, kind: "lamp" as const, on: i % 2 === 0 }));
    const near = nearestLights(lights, { x: 20, y: 0 }, 5);
    expect(near.map((l) => l.x)).toEqual([20, 18, 22, 16, 24]);
  });
});

describe("G6 a town at night, through the protocol", () => {
  let game: GameProcess;
  let model: Awaited<ReturnType<typeof fakeModel>>;
  beforeAll(async () => {
    model = await fakeModel();
    game = await startGame({ env: { OLLAMA_HOST: model.url, TIME_FLOW_SECONDS: "0" } });
  }, 90_000);
  afterAll(() => {
    game?.stop();
    model?.close();
  });

  it("occupied houses have lit windows and empty ones none; buildings say their template and door; lamps are on", async () => {
    const c = new ProtocolClient(game.port);
    await c.opened();
    c.hello({ w: 60, h: 40 });
    await c.until(() => !!c.ui.header && c.actors.has("player"), 20_000, "the first frame");
    const hour = Number(/(\d\d):\d\d/.exec(c.ui.header!.clock)![1]);
    const from = c.msgs.length;
    c.send({ t: "act", action: "wait", args: { hours: (23 - hour + 24) % 24 || 24 } });
    const night = (): Frame | null => {
      const m = new Mirror();
      for (const x of c.msgs) if (x.msg.t === "frame") m.applyFrame(x.msg.frame, x.msg.whole);
      return m.ambience.light === 0 && m.buildings.length > 0 ? ({ buildings: m.buildings, lights: m.lights, ambience: m.ambience } as unknown as Frame) : null;
    };
    await c.until(() => c.since(from).some((m) => m.t === "feed" && m.lines.some((l) => /Time passes/.test(l.text))) && !!night(), 30_000, "night");
    const f = night()!;
    expect(FrameSchema.shape.buildings.parse(f.buildings)).toBeTruthy();
    const houses = f.buildings!.filter((b) => b.kind === "house");
    expect(houses.length).toBeGreaterThan(2);
    let occupied = 0;
    let empty = 0;
    for (const b of f.buildings!) {
      expect(TEMPLATES[b.template!], b.kind).toBeTruthy();
      const windows = f.lights!.filter((l) => l.kind === "window" && l.id.startsWith(`win:${b.id}:`));
      const home = !/nobody inside/.test(b.tip);
      expect(b.lit).toBe(home);
      if (b.kind !== "house") continue;
      expect(windows.length, `house ${b.id} has windows`).toBeGreaterThan(0);
      for (const w of windows) expect(w.on, `${w.id}: ${b.tip}`).toBe(home);
      if (home) occupied++;
      else empty++;
    }
    expect(occupied).toBeGreaterThan(0);
    void empty;
    const lamps = f.lights!.filter((l) => l.kind === "lamp");
    if (lamps.length > 0) expect(lamps.every((l) => l.on)).toBe(true);
    c.close();
  });
});

describe("G6 a recording replays with no art falling back", () => {
  it("every art id, template and window glow in protocol/recordings/town-and-road.jsonl has real art", () => {
    const lines = read("protocol/recordings/town-and-road.jsonl").toString().trim().split("\n");
    const m = new Mirror();
    const ids = new Set<string>();
    const templates = new Set<string>();
    let frames = 0;
    for (const line of lines) {
      const { msg } = JSON.parse(line) as { msg: { t: string; frame?: Frame; whole?: boolean } };
      if (msg.t !== "frame" || !msg.frame) continue;
      frames++;
      m.applyFrame(msg.frame, !!msg.whole);
      for (const a of msg.frame.actors.upsert) ids.add(a.look.sprite);
      for (const p of msg.frame.patches ?? []) {
        p.ground.forEach((g) => ids.add(TERRAIN_IDS[g]!));
        p.objects.forEach((o) => o && ids.add(OBJECT_IDS[o]!));
      }
      for (const b of msg.frame.buildings ?? []) templates.add(b.template ?? "(none)");
    }
    expect(frames).toBeGreaterThan(10);
    expect(ids.size).toBeGreaterThan(5);
    expect(missingArt(ids)).toEqual([]);
    expect([...templates].filter((t) => !TEMPLATES[t])).toEqual([]);
    expect([...ids].some((id) => id.startsWith("terrain/road"))).toBe(true);
  });
});
