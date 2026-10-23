/**
 * The world view of the web adapter (G5, G6), in Phaser 3. It draws only what the server sends: terrain from the
 * frame's patches, buildings dressed in their templates, signs, lights, and every actor where the frame puts it,
 * walking along the route the server gives. Four layers (depth.ts): the ground; props, front walls and people
 * y-sorted together; roofs over them; names and bubbles on top. Light2D lights it all by the frame's `ambience`
 * and `lights`. Speech, crowd chatter and the typed events (T13) become bubbles and animations. A click is a tile
 * sent to the server; what it means is the server's to decide.
 */
import * as Phaser from "phaser";
import type { Frame, GameEvent } from "@millbrook/shared/view";
import type { Core, FrameChange } from "../../../core";
import { shortCoins } from "../../../dom";
import { SHEET_NAMES, sheetsLoaded } from "../art";
import { Bubble, DPR, font, Sprite } from "./actors";
import { Atmosphere } from "./atmosphere";
import { BuildingLayer } from "./buildings";
import { DEPTH } from "./depth";
import { fpsWanted, mountFpsOverlay, nearestShown } from "./fps";
import { GroundLayer } from "./ground";
import { LIGHT_BUDGET, Lighting } from "./lighting";
import { lookPrefs, saveLook, type LookPrefs } from "./look";
import { makeTextures, TILE } from "./textures";

/** The view: 26 by 18 tiles, following the player round bigger places. */
export const VIEW_W = 26;
export const VIEW_H = 18;
/** The ground drawn: the view and a little more, so the edges never show while the camera catches up. */
const POOL_W = VIEW_W + 6;
const POOL_H = VIEW_H + 6;
/** Townsfolk names shown at once, nearest the player, and how near. */
const FOLK_LABELS = 6;
const FOLK_LABEL_RANGE = 3;

const MOOD_EMOTE: Record<string, string> = { happy: "😊", neutral: "😐", annoyed: "😒", angry: "😠", afraid: "😨", sad: "😢" };

export class WorldScene extends Phaser.Scene {
  core!: Core;
  private sprites = new Map<string, Sprite>();
  private player: Sprite | null = null;
  /** The map drawn; a new one starts the scene's layers over. */
  private mapId: string | null = null;
  /** The tile drawn at the scene's (0, 0): the road's tiles are far from it, and the GPU wants small numbers. */
  origin = { x: 0, y: 0 };
  private ground!: GroundLayer;
  private buildings!: BuildingLayer;
  private lighting!: Lighting;
  private atmosphere!: Atmosphere;
  private look: LookPrefs = lookPrefs();
  private signs = new Map<string, Phaser.GameObjects.Text>();
  private hover!: Phaser.GameObjects.Graphics;
  private hoverTile: { x: number; y: number } | null = null;
  private prompt!: Phaser.GameObjects.Text;
  private clock!: Phaser.GameObjects.Graphics;
  private clockText!: Phaser.GameObjects.Text;
  private tip!: Phaser.GameObjects.Text;
  private chatter: Bubble[] = [];
  private ready = false;
  private fps: { update(now: number, delta: number, loopFps: number): void } | null = fpsWanted() ? mountFpsOverlay() : null;

  constructor() {
    super("world");
  }

  /** The packed sheets (`npm run art`); one that fails to load leaves its ids on their code-drawn fallbacks. */
  preload(): void {
    const failed = new Set<string>();
    this.load.on("loaderror", (f: Phaser.Loader.File) => failed.add(f.key));
    for (const sheet of SHEET_NAMES) this.load.atlas(sheet, `art/${sheet}.png`, `art/${sheet}.json`);
    this.load.once("complete", () => {
      const ok = SHEET_NAMES.filter((n) => !failed.has(n) && this.textures.exists(n));
      // Pixel art stays crisp: nearest-neighbour for the sheets (the text keeps its smoothing).
      for (const n of ok) this.textures.get(n).setFilter(Phaser.Textures.FilterMode.NEAREST);
      sheetsLoaded(ok);
      if (ok.length < SHEET_NAMES.length) console.warn(`[art] sheets missing: ${SHEET_NAMES.filter((n) => !ok.includes(n)).join(", ")}; drawing their fallbacks`);
    });
  }

  /** Light an object (Light2D, when WebGL is there). */
  lit<T extends Phaser.GameObjects.GameObject & { setPipeline(p: string): unknown }>(o: T): T {
    return this.lighting ? this.lighting.lit(o) : o;
  }

  /** Atmosphere and its blur, on or off (the header's ✨ button). */
  setLook(p: Partial<LookPrefs>): LookPrefs {
    this.look = { ...this.look, ...p };
    saveLook(this.look);
    this.atmosphere?.setOn(this.look.atmosphere, this.look.blur);
    return this.look;
  }

  get lookNow(): LookPrefs {
    return this.look;
  }

  create(): void {
    makeTextures(this);
    this.sprites = new Map();
    this.player = null;
    this.mapId = null;
    this.cameras.main.setRoundPixels(true);
    this.lighting = new Lighting(this);
    this.ground = new GroundLayer(this, POOL_W, POOL_H);
    this.buildings = new BuildingLayer(this);
    this.atmosphere = new Atmosphere(this, this.look);
    this.hover = this.add.graphics().setDepth(DEPTH.hover);
    this.prompt = this.add.text(0, 0, "", font(13, "#ffd27a")).setOrigin(0.5, 0).setDepth(DEPTH.prompt).setResolution(DPR);
    this.clock = this.add.graphics().setDepth(DEPTH.prompt);
    this.clockText = this.add.text(0, 0, "", font(11)).setOrigin(0.5, 0).setDepth(DEPTH.prompt).setResolution(DPR);
    this.tip = this.add.text(0, 0, "", { ...font(11, "#f3e9d2", false), backgroundColor: "#000000b0", padding: { x: 5, y: 3 }, wordWrap: { width: 300 } }).setDepth(DEPTH.tip).setResolution(DPR).setVisible(false);
    for (let i = 0; i < 14; i++) this.chatter.push(new Bubble(this, true));

    this.input.on("pointerdown", (p: Phaser.Input.Pointer) => {
      const t = this.tileOf(p.worldX, p.worldY);
      this.core.send({ t: "click", x: t.x, y: t.y });
    });
    this.input.on("pointermove", (p: Phaser.Input.Pointer) => this.hoverAt(this.tileOf(p.worldX, p.worldY), p.worldX, p.worldY));
    this.input.on("gameout", () => {
      this.hover.clear();
      this.tip.setVisible(false);
      this.hoverTile = null;
      this.labels();
    });
    this.ready = true;
    if (this.core.frame.map) this.frame({ whole: true, added: [...this.core.frame.actors.keys()], updated: [], moved: [], removed: [], patches: [], buildings: true, lights: true, signs: true }, null);
  }

  // ---------- tiles and pixels ----------

  /** The middle of a game tile, in scene pixels. */
  px(x: number, y: number): { x: number; y: number } {
    return { x: (x - this.origin.x) * TILE + TILE / 2, y: (y - this.origin.y) * TILE + TILE / 2 };
  }

  private tileOf(wx: number, wy: number): { x: number; y: number } {
    return { x: Math.floor(wx / TILE) + this.origin.x, y: Math.floor(wy / TILE) + this.origin.y };
  }

  // ---------- the frame ----------

  /** A frame came in (the core has applied it): draw what changed. */
  frame(change: FrameChange, f: Frame | null): void {
    const m = this.core.frame;
    if (!m.map || !this.ready) return;
    const me = m.actors.get("player");
    // A new map: start over, with the origin at the player on the road (whose tiles are far out).
    if (change.whole || m.map.id !== this.mapId) {
      this.mapId = m.map.id;
      for (const s of this.sprites.values()) s.destroy();
      this.sprites.clear();
      this.player = null;
      this.origin = m.map.kind === "road" ? { x: m.player.x, y: m.player.y } : { x: 0, y: 0 };
      if (m.map.kind === "place" && m.map.w && m.map.h) this.cameras.main.setBounds(0, 0, m.map.w * TILE, m.map.h * TILE);
      else this.cameras.main.removeBounds();
      change = { ...change, added: [...m.actors.keys()], buildings: true, lights: true, signs: true };
      this.buildings.invalidate();
      this.lighting.clear();
      this.ground.dirty = true;
    } else if (m.map.kind === "road" && me && (Math.abs(me.x - this.origin.x) > 2500 || Math.abs(me.y - this.origin.y) > 2500)) {
      // Far from the origin: move it, and everything with it.
      this.origin = { x: me.x, y: me.y };
      for (const s of this.sprites.values()) s.goTo(s.data, true);
      change = { ...change, buildings: true, lights: true, signs: true };
      this.buildings.invalidate();
      this.ground.dirty = true;
    }
    if (change.patches.length > 0) this.ground.dirty = true;
    for (const id of change.removed) {
      const s = this.sprites.get(id);
      if (!s) continue;
      this.sprites.delete(id);
      s.bubble?.destroy();
      s.bubble = null;
      s.fadeOut();
    }
    for (const id of change.added) {
      const a = m.actors.get(id);
      if (!a) continue;
      this.sprites.get(id)?.destroy();
      const s = new Sprite(this, a);
      this.sprites.set(id, s);
      if (id === "player") {
        this.player = s;
        this.cameras.main.startFollow(s.c, true, 0.18, 0.18);
      } else s.fadeIn();
    }
    for (const id of [...change.updated, ...change.moved]) {
      const a = m.actors.get(id);
      const s = this.sprites.get(id);
      if (!a || !s) continue;
      s.set(a);
      s.goTo(a);
    }
    if (change.buildings && this.buildings.draw(m.buildings)) {
      this.ground.dressedDoors = this.buildings.doors;
      this.ground.dirty = true;
      change = { ...change, lights: true };
    }
    if (change.signs) this.drawSigns();
    this.lighting.setAmbience(m.ambience);
    this.atmosphere.setAmbience(m.ambience);
    if (change.lights) this.buildings.setLights(m.lights);
    // The nearest lights change as the player walks, so they are picked again every frame.
    this.lighting.setLights(m.lights, m.player);
    if (f?.chatter?.length) this.showChatter(f.chatter);
    for (const g of f?.gossip ?? []) this.say(g.who, g.text, 0, 5200, false);
    this.labels();
    if (this.hoverTile) this.hoverAt(this.hoverTile);
  }

  private drawSigns(): void {
    const want = new Set(this.core.frame.signs.map((s) => s.id));
    for (const [id, t] of this.signs) if (!want.has(id)) (t.destroy(), this.signs.delete(id));
    const m = this.core.frame;
    for (const s of m.signs) {
      let t = this.signs.get(s.id);
      if (!t) {
        t = s.kind === "exit" ? this.add.text(0, 0, s.text, { ...font(11, "#ffd27a"), backgroundColor: "#00000088", padding: { x: 4, y: 2 } }) : this.add.text(0, 0, s.text, { fontFamily: "system-ui, sans-serif", fontSize: "13px", fontStyle: "bold", color: "#ffe9b0", stroke: "#000000", strokeThickness: 3 });
        t.setDepth(s.kind === "exit" ? DEPTH.signs : DEPTH.signs + 1).setResolution(DPR);
        this.signs.set(s.id, t);
      }
      const p = this.px(s.x, s.y);
      if (s.kind === "exit" && m.map?.w && m.map.h) {
        // At the map's edge, pointing out: the sign sits just inside it.
        const left = s.x === 0, right = s.x === m.map.w - 1, top = s.y === 0, bottom = s.y === m.map.h - 1;
        t.setOrigin(left ? 0 : right ? 1 : 0.5, top ? 0 : bottom ? 1 : 0.5).setPosition(left ? TILE * 1.1 : right ? (m.map.w - 1.1) * TILE : p.x, top ? TILE * 1.1 : bottom ? (m.map.h - 1.1) * TILE : p.y);
      } else t.setOrigin(0.5, 1).setPosition(p.x, p.y - TILE / 2);
    }
  }

  /** Who shows a name: the player, the NPCs, the one the prompt is under, the townsfolk nearest and the one pointed at; others their short label. */
  private labels(): void {
    const m = this.core.frame;
    const target = m.prompt?.target ?? null;
    const me = m.player;
    const folk: Sprite[] = [];
    for (const s of this.sprites.values()) {
      const a = s.data;
      const hl = a.id === target;
      if (a.kind === "folk") {
        folk.push(s);
        s.setLabel(null, false);
      } else if (a.kind === "traveller") s.setLabel(hl || Math.hypot(a.x - me.x, a.y - me.y) <= 8 ? a.label : (a.shortLabel ?? null), hl);
      else if (a.kind === "creature") s.setLabel(hl || a.flags.includes("engaged") ? a.label : (a.shortLabel ?? null), hl);
      else s.setLabel(a.label, hl || a.kind === "player");
    }
    const near = nearestShown(folk.map((s) => ({ shown: true, x: s.data.x, y: s.data.y })), me, FOLK_LABEL_RANGE, FOLK_LABELS).map((i) => folk[i]!);
    const pointed = this.hoverTile ? m.actorAt(this.hoverTile.x, this.hoverTile.y) : undefined;
    for (const s of folk) if (near.includes(s) || s.data.id === pointed?.id || s.data.id === target) s.setLabel(s.data.label, s.data.id === target);
  }

  // ---------- speech, chatter and events ----------

  speech(npc: string, text: string | null, opts: { done?: boolean; filler?: boolean } = {}): void {
    const s = this.ready ? this.sprites.get(npc) : undefined;
    if (!s) return;
    s.bubble ??= new Bubble(this);
    s.bubble.show(text, { done: opts.done, italic: opts.filler });
    s.bubble.follow(s.c.x, s.c.y);
  }

  /** A line over one of the crowd, on a bubble of the pool. */
  private say(who: string, line: string, lift: number, ms: number, hot: boolean): void {
    const s = this.sprites.get(who);
    const b = this.chatter.find((x) => !x.visible) ?? this.chatter[0]!;
    if (!s) return;
    b.lift = lift;
    b.show(line.length > 70 ? `${line.slice(0, 68)}…` : line, { ms, hot });
    b.follow(s.c.x, s.c.y);
    b.who = who;
  }

  private showChatter(list: NonNullable<Frame["chatter"]>): void {
    for (const c of list) {
      this.say(c.a, c.lines[0], 0, 3200, c.hot);
      this.time.delayedCall(1500, () => this.say(c.b, c.lines[1], 22, 3000, c.hot));
      if (c.bow) this.emote(c.a, "🙇", 14);
      else if (c.hot) this.emote(c.a, "💢", 14);
    }
  }

  private actorFor(who: string): Sprite | undefined {
    return this.sprites.get(who);
  }

  /** A word or number that floats up from someone and fades. */
  private float(who: string, text: string, color: string, dy = 0): void {
    const a = this.actorFor(who);
    if (!a) return;
    const t = this.add.text(a.c.x, a.c.y - 26 + dy, text, font(12, color)).setOrigin(0.5).setDepth(DEPTH.float).setResolution(DPR);
    this.tweens.add({ targets: t, y: t.y - 26, alpha: 0, duration: 1400, ease: "Cubic.easeOut", onComplete: () => t.destroy() });
  }

  private emote(who: string, symbol: string, size = 18): void {
    const a = this.actorFor(who);
    if (!a) return;
    const t = this.add.text(a.c.x + 12, a.c.y - 34, symbol, { fontSize: `${size}px` }).setOrigin(0.5).setDepth(DEPTH.float).setResolution(DPR);
    this.tweens.add({ targets: t, y: t.y - 14, duration: 500, ease: "Back.easeOut" });
    this.tweens.add({ targets: t, alpha: 0, delay: 1600, duration: 400, onComplete: () => t.destroy() });
  }

  event(e: GameEvent): void {
    if (!this.ready) return;
    switch (e.type) {
      case "mood_changed":
        return this.emote(e.npc, MOOD_EMOTE[e.to] ?? "❔");
      case "trust_changed": {
        const d = e.to - e.from;
        if (Math.abs(d) >= 3) this.float(e.npc, `trust ${d > 0 ? "+" : ""}${d}`, d > 0 ? "#7bc47f" : "#e0675b", 12);
        return;
      }
      case "item_moved":
        if (e.to === "player") this.float("player", `+ ${e.qty > 1 ? `${e.qty} ` : ""}${e.item}`, "#7bc47f");
        if (e.from === "player") this.float("player", `− ${e.qty > 1 ? `${e.qty} ` : ""}${e.item}`, "#c9ccd2");
        if (e.to !== "player" && this.sprites.has(e.to)) this.float(e.to, `+ ${e.item}`, "#7bc47f");
        return;
      case "gold_moved":
        if (e.to === "player") this.float("player", `+${shortCoins(e.amount)}`, "#ffd27a", -12);
        if (e.from === "player") this.float("player", `−${shortCoins(e.amount)}`, "#e0a64b", -12);
        if (e.to !== "player" && this.sprites.has(e.to)) this.float(e.to, `+${shortCoins(e.amount)}`, "#ffd27a", -12);
        return;
      case "hp_changed":
        if (e.to < e.from) this.float(e.who, `−${e.from - e.to}`, "#ff6b5b", -4);
        else if (e.to > e.from) this.float(e.who, `+${e.to - e.from} HP`, "#7bc47f", -4);
        return;
      case "attack": {
        const by = this.actorFor(e.by);
        const target = this.actorFor(e.target);
        if (by && target) by.lunge(target.c.x, target.c.y);
        if (target && e.hit) {
          target.flash();
          if (e.target === "player") this.cameras.main.shake(140, 0.006);
        } else if (target) this.float(e.target, "miss", "#c9ccd2", 6);
        return;
      }
      case "quest_offered":
        return this.emote(e.npc, "❗");
      case "npc_busy":
        return this.emote(e.npc, "⏳");
      case "npc_died":
        return this.emote(e.npc, "💀");
      case "following":
        return this.emote(e.npc, e.on ? "🤝" : "👋");
    }
  }

  // ---------- pointing ----------

  private hoverAt(t: { x: number; y: number }, wx?: number, wy?: number): void {
    this.hover.clear();
    this.tip.setVisible(false);
    const m = this.core.frame;
    const was = this.hoverTile;
    this.hoverTile = t;
    if (!was || was.x !== t.x || was.y !== t.y) this.labels();
    const who = m.actorAt(t.x, t.y);
    const tile = m.tileAt(t.x, t.y);
    const solid = !tile || tile.ground === "terrain/water" || (!!tile.object && tile.object !== "buildings/door" && tile.object !== "buildings/gate");
    this.input.setDefaultCursor(who ? "pointer" : solid ? "default" : "crosshair");
    const tip = who?.tip ?? m.buildingAt(t.x, t.y)?.tip ?? "";
    if (tip && wx !== undefined && wy !== undefined) {
      const v = this.cameras.main.worldView;
      this.tip.setText(tip);
      this.tip.setPosition(Math.min(wx + 14, v.right - this.tip.width - 4), Math.min(wy + 14, v.bottom - this.tip.height - 4)).setVisible(true);
    }
    if (solid && !who) return;
    this.hover.lineStyle(2, who ? 0xffd27a : 0xffffff, who ? 0.8 : 0.35).strokeRect((t.x - this.origin.x) * TILE + 1, (t.y - this.origin.y) * TILE + 1, TILE - 2, TILE - 2);
  }

  update(time: number, delta: number): void {
    this.fps?.update(time, delta, this.game.loop.actualFps);
    this.lighting.update(time, delta);
    this.atmosphere.update(time, delta, this.lighting.tint);
    // Off the map's edge is the grass colour, darkened like the lit world round it.
    const t = this.lighting.tint;
    this.cameras.main.setBackgroundColor((((0x2d * ((t >> 16) & 255)) / 255) << 16) | (((0x4a * ((t >> 8) & 255)) / 255) << 8) | ((0x2b * (t & 255)) / 255));
    if (!this.player) return;
    const before = this.ground.trees;
    this.ground.draw(Math.round(this.player.c.x / TILE - 0.5) + this.origin.x, Math.round(this.player.c.y / TILE - 0.5) + this.origin.y, time);
    if (this.ground.trees !== before) this.atmosphere.setTrees(this.ground.trees, this.origin);
    this.buildings.update({ x: this.player.c.x / TILE - 0.5 + this.origin.x, y: this.player.c.y / TILE - 0.5 + this.origin.y }, delta);
    for (const s of this.sprites.values()) {
      s.update(delta);
      s.bubble?.tick(time);
    }
    for (const b of this.chatter) {
      const who = b.who;
      const s = who ? this.sprites.get(who) : undefined;
      if (b.visible && s) b.follow(s.c.x, s.c.y);
    }
    this.drawPrompt();
    this.drawFightClock();
  }

  /** "E: talk to …" or "F: fight" under whoever the server says it's for. */
  private drawPrompt(): void {
    const p = this.core.frame.prompt;
    const s = p ? this.sprites.get(p.target) : undefined;
    this.prompt.setVisible(Boolean(p && s));
    if (!p || !s) return;
    this.prompt.setColor(p.tone === "danger" ? "#ff8a7a" : "#ffd27a");
    if (this.prompt.text !== p.text) this.prompt.setText(p.text);
    this.prompt.setPosition(s.c.x, s.c.y + TILE / 2 + 2);
  }

  /** In a fight: a bar under the player for the seconds left to act before the opponent strikes. */
  private drawFightClock(): void {
    this.clock.clear();
    const f = this.core.frame.fight;
    if (!f || !this.player || this.core.ui?.header.busy) return void this.clockText.setVisible(false);
    const left = Math.max(0, f.secondsLeft - (performance.now() - f.at) / 1000);
    const share = left / Math.max(0.1, f.tick);
    const x = this.player.c.x;
    const y = this.player.c.y + TILE / 2 + 2;
    this.clock.fillStyle(0x000000, 0.65).fillRect(x - 16, y, 32, 5);
    this.clock.fillStyle(share > 0.5 ? 0x7ac77a : share > 0.2 ? 0xe0b45b : 0xe0675b).fillRect(x - 16, y, 32 * share, 5);
    this.clockText.setVisible(true).setText(`your move: ${Math.ceil(left)}s`).setPosition(x, y + 6);
  }
}

/** Start Phaser in `parent`, drawing what `core` holds. */
export function startWorld(parent: HTMLElement, core: Core): WorldScene {
  parent.replaceChildren();
  const scene = new WorldScene();
  scene.core = core;
  // `?debug=1`: the scene on `window.world`, to look at the layers and lights from the console.
  if (new URLSearchParams(location.search).has("debug")) Object.assign(window, { world: scene });
  new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    width: VIEW_W * TILE,
    height: VIEW_H * TILE,
    backgroundColor: "#2d4a2b",
    // Keys are read by the page (so typing in the chat box never moves you); Phaser only gets the mouse.
    input: { keyboard: false },
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_HORIZONTALLY },
    // Light2D's limit per camera: the nearest lights get a real one (lighting.ts), the rest glow without.
    render: { antialias: true, roundPixels: true, maxLights: LIGHT_BUDGET },
    banner: false,
    scene: [scene],
  });
  return scene;
}
