/**
 * The world view of the web adapter (G5), in Phaser 3. It draws only what the server sends: terrain from the
 * frame's patches, buildings, signs and lights, and every actor where the frame puts it, walking along the route
 * the server gives. Speech, crowd chatter and the typed events (T13) become bubbles and animations. A click is a
 * tile sent to the server; what it means is the server's to decide.
 */
import * as Phaser from "phaser";
import type { Actor as ActorData, Frame, GameEvent } from "@millbrook/shared/view";
import type { Core, FrameChange } from "../../../core";
import { shortCoins } from "../../../dom";
import { lookOf, textureFor } from "../art";
import { fpsWanted, mountFpsOverlay, nearestShown } from "./fps";
import { hexColor, makeTextures, ORIGINS, TILE, tileHash } from "./textures";

/** The view: 26 by 18 tiles, following the player round bigger places. */
export const VIEW_W = 26;
export const VIEW_H = 18;
/** The ground drawn: the view and a little more, so the edges never show while the camera catches up. */
const POOL_W = VIEW_W + 6;
const POOL_H = VIEW_H + 6;
/** How long a tile's walk takes on screen, by who's walking. */
const WALK_MS: Record<ActorData["kind"], number> = { player: 90, npc: 150, companion: 90, creature: 200, folk: 450, traveller: 450 };
/** Townsfolk names shown at once, nearest the player, and how near. */
const FOLK_LABELS = 6;
const FOLK_LABEL_RANGE = 3;

const MOOD_EMOTE: Record<string, string> = { happy: "😊", neutral: "😐", annoyed: "😒", angry: "😠", afraid: "😨", sad: "😢" };
const DPR = Math.min(2, window.devicePixelRatio || 1);
const font = (size: number, color = "#ffffff", bold = true): Phaser.Types.GameObjects.Text.TextStyle => ({
  fontFamily: "system-ui, sans-serif",
  fontSize: `${size}px`,
  fontStyle: bold ? "bold" : "normal",
  color,
  stroke: "rgba(0,0,0,0.75)",
  strokeThickness: 3,
});

/** One character on the map: a container that walks along tiles, with its label, HP bar and speech bubble. */
class Sprite {
  readonly c: Phaser.GameObjects.Container;
  private body: Phaser.GameObjects.Image;
  private head: Phaser.GameObjects.Image | null = null;
  private label: Phaser.GameObjects.Text | null = null;
  private bar: Phaser.GameObjects.Graphics | null = null;
  private look: string | null = null;
  private tint = 0xffffff;
  private path: Array<{ x: number; y: number }> = [];
  private speed = 0.25;
  private walkClock = 0;
  bubble: Bubble | null = null;
  data: ActorData;

  constructor(
    private readonly scene: WorldScene,
    a: ActorData,
  ) {
    this.data = a;
    const p = scene.px(a.x, a.y);
    const shadow = scene.add.image(0, 12, "shadow");
    this.body = scene.add.image(0, 4.5, "body");
    this.c = scene.add.container(p.x, p.y, [shadow, this.body]);
    this.set(a);
  }

  /** New facts from the server: how it looks, its HP. */
  set(a: ActorData): void {
    this.data = a;
    const tint = a.look.tint ? hexColor(a.look.tint) : 0xffffff;
    const key = `${a.look.sprite}|${a.look.trim ?? ""}|${a.kind}`;
    if (key !== this.look || tint !== this.tint) {
      this.look = key;
      this.tint = tint;
      this.head?.destroy();
      this.head = null;
      this.c.list.filter((o) => o.name === "extra").forEach((o) => o.destroy());
      const kind = lookOf(a.look.sprite);
      const tex = textureFor(a.look.sprite);
      if (kind === "grave") this.body.setTexture(tex).setOrigin(...ORIGINS.grave).setPosition(0, 4).clearTint();
      else if (kind === "beast") this.body.setTexture(tex).setOrigin(...ORIGINS.beast).setPosition(0, 2).setTint(tint);
      else {
        this.body.setTexture(tex).setOrigin(...ORIGINS.body).setPosition(0, 4.5).setTint(tint);
        this.head = this.scene.add.image(0, -9, "head").setOrigin(...ORIGINS.head);
        if (a.look.trim) this.head.setTint(hexColor(a.look.trim));
        this.c.addAt(this.head, 2);
        if (a.kind === "player") {
          this.c.addAt(this.scene.add.graphics().lineStyle(2, 0xffd27a).strokeRoundedRect(-8, -4, 16, 17, 5).setName("extra"), 2);
          this.c.add(this.scene.add.image(0, -36, "marker").setName("extra"));
        }
      }
      this.c.setScale(a.look.size ?? 1);
    }
    this.setHp(a.hp ?? 1);
  }

  setLabel(text: string | null, highlight: boolean): void {
    if (!text) return void this.label?.setVisible(false);
    if (!this.label) {
      this.label = this.scene.add.text(0, -20, "", font(this.data.kind === "folk" ? 10 : 11)).setOrigin(0.5, 1).setResolution(DPR);
      this.c.add(this.label);
    }
    if (this.label.text !== text) this.label.setText(text);
    this.label.setVisible(true).setColor(highlight ? "#ffd27a" : this.data.flags.includes("noble") ? "#ffd27a" : this.data.flags.includes("lowborn") ? "#b9b2a6" : "#ffffff");
    this.label.setY(lookOf(this.data.look.sprite) === "beast" ? -14 : -20).setScale(1 / (this.data.look.size ?? 1));
  }

  private setHp(share: number): void {
    if (share >= 1 || lookOf(this.data.look.sprite) === "grave") return void this.bar?.clear();
    if (!this.bar) {
      this.bar = this.scene.add.graphics();
      this.c.add(this.bar);
    }
    this.bar.clear();
    this.bar.fillStyle(0x000000, 0.65).fillRect(-12, 15, 24, 4);
    this.bar.fillStyle(0xe0675b).fillRect(-12, 15, 24 * Math.max(0, share), 4);
  }

  /** Walk to where the server says, along its route if it gave one; far jumps (a new spot, a fast travel) are instant. */
  goTo(a: ActorData, jump = false): void {
    const to = this.scene.px(a.x, a.y);
    const from = { x: this.c.x, y: this.c.y };
    const far = Math.hypot(to.x - from.x, to.y - from.y) / TILE;
    if (jump || (far > 6 && !a.route)) {
      this.path = [];
      this.c.setPosition(to.x, to.y);
      return;
    }
    this.path = (a.route ?? [{ x: a.x, y: a.y }]).map((t) => this.scene.px(t.x, t.y));
    this.speed = TILE / (this.data.kind === "player" ? Math.min(WALK_MS.player, this.scene.core.frame.stepMs) : WALK_MS[this.data.kind]);
  }

  get walking(): boolean {
    return this.path.length > 0;
  }

  update(delta: number): void {
    let budget = this.speed * delta;
    while (this.path.length > 0 && budget > 0) {
      const next = this.path[0]!;
      const dx = next.x - this.c.x;
      const dy = next.y - this.c.y;
      const d = Math.hypot(dx, dy);
      if (d <= budget) {
        this.c.setPosition(next.x, next.y);
        this.path.shift();
        budget -= d;
      } else {
        this.c.setPosition(this.c.x + (dx / d) * budget, this.c.y + (dy / d) * budget);
        budget = 0;
      }
    }
    // A little bob while walking.
    this.walkClock = this.walking ? this.walkClock + delta : 0;
    const bob = this.walking ? Math.abs(Math.sin(this.walkClock / 70)) * -2 : 0;
    const kind = lookOf(this.data.look.sprite);
    if (kind !== "grave") this.body.setY((kind === "beast" ? 2 : 4.5) + bob);
    this.head?.setY(-9 + bob);
    this.c.setDepth(10 + this.c.y / TILE);
    this.bubble?.follow(this.c.x, this.c.y);
  }

  flash(): void {
    this.body.setTintFill(0xffffff);
    this.scene.time.delayedCall(90, () => (lookOf(this.data.look.sprite) === "grave" ? this.body.clearTint() : this.body.setTint(this.tint)));
  }

  /** Lean towards a point and back: an attack. */
  lunge(toX: number, toY: number): void {
    const d = Math.hypot(toX - this.c.x, toY - this.c.y) || 1;
    this.scene.tweens.add({ targets: this.body, x: ((toX - this.c.x) / d) * 6, y: this.body.y + ((toY - this.c.y) / d) * 6, duration: 70, yoyo: true, onComplete: () => this.body.setX(0) });
  }

  destroy(): void {
    this.bubble?.destroy();
    this.c.destroy();
  }
}

/** A speech bubble: what someone says as it streams, "…" while they think, or a line of the crowd's chatter. */
class Bubble {
  private readonly c: Phaser.GameObjects.Container;
  private readonly bg: Phaser.GameObjects.Graphics;
  private readonly text: Phaser.GameObjects.Text;
  private thinking = false;
  private dots = 0;
  private hideTimer: Phaser.Time.TimerEvent | null = null;
  lift = 0;

  constructor(
    private readonly scene: Phaser.Scene,
    small = false,
  ) {
    this.bg = scene.add.graphics();
    this.text = scene.add.text(0, 0, "", { fontFamily: "system-ui, sans-serif", fontSize: small ? "11px" : "12px", color: "#1d2026", wordWrap: { width: small ? 150 : 170 } }).setResolution(DPR).setOrigin(0.5, 1);
    this.c = scene.add.container(0, 0, [this.bg, this.text]).setDepth(small ? 950 : 1000);
  }

  show(text: string | null, opts: { done?: boolean; italic?: boolean; hot?: boolean; ms?: number } = {}): void {
    this.hideTimer?.remove();
    this.hideTimer = null;
    this.c.setAlpha(1).setVisible(true);
    this.thinking = text === null;
    if (text !== null) {
      const clean = text.replace(/\s+/g, " ").trim();
      this.setText(clean.length > 110 ? `…${clean.slice(-108)}` : clean || "…", opts.italic === true, opts.hot === true);
    } else this.setText("…", false, false);
    const ms = opts.ms ?? (opts.done ? 3500 + Math.min(4000, text?.length ?? 0) * 25 : null);
    if (ms !== null) this.hideTimer = this.scene.time.delayedCall(ms, () => this.scene.tweens.add({ targets: this.c, alpha: 0, duration: 400, onComplete: () => this.c.setVisible(false) }));
  }

  get visible(): boolean {
    return this.c.visible;
  }

  tick(time: number): void {
    if (!this.thinking) return;
    const dots = Math.floor(time / 350) % 4;
    if (dots !== this.dots) {
      this.dots = dots;
      this.setText(".".repeat(dots || 1).padEnd(3, " "), false, false);
    }
  }

  private setText(text: string, italic: boolean, hot: boolean): void {
    this.text.setText(text).setFontStyle(italic || text.startsWith("*") ? "italic" : "normal");
    const w = Math.max(28, this.text.width + 14);
    const h = this.text.height + 10;
    this.bg.clear();
    this.bg.fillStyle(0xf3e9d2, 0.96).fillRoundedRect(-w / 2, -h - 6, w, h, 7);
    this.bg.fillTriangle(-5, -7, 5, -7, 0, 0);
    // A hostile exchange (N37) has a red edge.
    this.bg.lineStyle(hot ? 2 : 1, hot ? 0xb03a2e : 0x000000, hot ? 1 : 0.25).strokeRoundedRect(-w / 2, -h - 6, w, h, 7);
    this.text.setPosition(0, -11);
  }

  follow(x: number, y: number): void {
    const half = (this.text.width + 14) / 2;
    const v = this.scene.cameras.main.worldView;
    this.c.setPosition(Phaser.Math.Clamp(x, v.x + half + 2, v.right - half - 2), Math.max(v.y + this.text.height + 18, y - 30 - this.lift));
  }

  destroy(): void {
    this.hideTimer?.remove();
    this.c.destroy();
  }
}

export class WorldScene extends Phaser.Scene {
  core!: Core;
  private sprites = new Map<string, Sprite>();
  private player: Sprite | null = null;
  /** The map drawn; a new one starts the scene's layers over. */
  private mapId: string | null = null;
  /** The tile drawn at the scene's (0, 0): the road's tiles are far from it, and the GPU wants small numbers. */
  origin = { x: 0, y: 0 };
  private ground: Phaser.GameObjects.Image[] = [];
  private objects: Phaser.GameObjects.Image[] = [];
  private groundAt = { x: Number.NaN, y: Number.NaN };
  private groundDirty = true;
  private buildingGfx!: Phaser.GameObjects.Graphics;
  private buildingText: Phaser.GameObjects.Text[] = [];
  private signs = new Map<string, Phaser.GameObjects.Text>();
  private night!: Phaser.GameObjects.Rectangle;
  private rain!: Phaser.GameObjects.Particles.ParticleEmitter;
  private snow!: Phaser.GameObjects.Particles.ParticleEmitter;
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

  create(): void {
    makeTextures(this);
    this.sprites = new Map();
    this.player = null;
    this.mapId = null;
    this.ground = [];
    this.objects = [];
    for (let i = 0; i < POOL_W * POOL_H; i++) {
      this.ground.push(this.add.image(0, 0, "grass0").setOrigin(0).setDepth(0));
      this.objects.push(this.add.image(0, 0, "tree").setOrigin(0).setVisible(false));
    }
    this.buildingGfx = this.add.graphics().setDepth(2);
    this.night = this.add.rectangle(0, 0, this.scale.width, this.scale.height, 0x0a1030, 0).setOrigin(0).setDepth(500).setScrollFactor(0);
    this.rain = this.add.particles(0, -10, "drop", { x: { min: 0, max: this.scale.width + 120 }, speedY: { min: 380, max: 480 }, speedX: { min: -90, max: -60 }, lifespan: 1600, quantity: 3, frequency: 25, alpha: { start: 0.7, end: 0.3 }, emitting: false });
    this.rain.setDepth(600).setScrollFactor(0);
    this.snow = this.add.particles(0, -10, "flake", { x: { min: 0, max: this.scale.width }, speedY: { min: 30, max: 60 }, speedX: { min: -20, max: 20 }, lifespan: 12000, quantity: 1, frequency: 90, scale: { min: 0.5, max: 1 }, alpha: 0.85, emitting: false });
    this.snow.setDepth(600).setScrollFactor(0);
    this.hover = this.add.graphics().setDepth(5);
    this.prompt = this.add.text(0, 0, "", font(13, "#ffd27a")).setOrigin(0.5, 0).setDepth(700).setResolution(DPR);
    this.clock = this.add.graphics().setDepth(700);
    this.clockText = this.add.text(0, 0, "", font(11)).setOrigin(0.5, 0).setDepth(700).setResolution(DPR);
    this.tip = this.add.text(0, 0, "", { ...font(11, "#f3e9d2", false), backgroundColor: "#000000b0", padding: { x: 5, y: 3 }, wordWrap: { width: 300 } }).setDepth(1200).setResolution(DPR).setVisible(false);
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
      change = { ...change, added: [...m.actors.keys()], buildings: true, signs: true };
      this.groundDirty = true;
    } else if (m.map.kind === "road" && me && (Math.abs(me.x - this.origin.x) > 2500 || Math.abs(me.y - this.origin.y) > 2500)) {
      // Far from the origin: move it, and everything with it.
      this.origin = { x: me.x, y: me.y };
      for (const s of this.sprites.values()) s.goTo(s.data, true);
      change = { ...change, buildings: true, signs: true };
      this.groundDirty = true;
    }
    if (change.patches.length > 0) this.groundDirty = true;
    for (const id of change.removed) {
      const s = this.sprites.get(id);
      if (!s) continue;
      this.sprites.delete(id);
      s.bubble?.destroy();
      s.bubble = null;
      this.tweens.add({ targets: s.c, alpha: 0, duration: 300, onComplete: () => s.destroy() });
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
      } else {
        s.c.setAlpha(0);
        this.tweens.add({ targets: s.c, alpha: 1, duration: 300 });
      }
    }
    for (const id of [...change.updated, ...change.moved]) {
      const a = m.actors.get(id);
      const s = this.sprites.get(id);
      if (!a || !s) continue;
      s.set(a);
      s.goTo(a);
    }
    if (change.buildings) this.drawBuildings();
    if (change.signs) this.drawSigns();
    this.setSky();
    if (f?.chatter?.length) this.showChatter(f.chatter);
    for (const g of f?.gossip ?? []) this.say(g.who, g.text, 0, 5200, false);
    this.labels();
    if (this.hoverTile) this.hoverAt(this.hoverTile);
  }

  /** The ground round the camera, from the patches (unknown tiles show grass until theirs comes). */
  private drawGround(cx: number, cy: number): void {
    if (!this.groundDirty && cx === this.groundAt.x && cy === this.groundAt.y) return;
    this.groundDirty = false;
    this.groundAt = { x: cx, y: cy };
    const m = this.core.frame;
    const x0 = cx - Math.floor(POOL_W / 2);
    const y0 = cy - Math.floor(POOL_H / 2);
    for (let j = 0; j < POOL_H; j++) {
      for (let i = 0; i < POOL_W; i++) {
        const gx = x0 + i;
        const gy = y0 + j;
        const k = j * POOL_W + i;
        const t = m.tileAt(gx, gy);
        const sx = (gx - this.origin.x) * TILE;
        const sy = (gy - this.origin.y) * TILE;
        const off = m.map?.kind === "place" && (gx < 0 || gy < 0 || gx >= (m.map.w ?? 0) || gy >= (m.map.h ?? 0));
        this.ground[k]!.setTexture(textureFor(t?.ground ?? "terrain/grass", tileHash(gx, gy))).setPosition(sx, sy).setVisible(!off);
        const obj = this.objects[k]!;
        if (t?.object && !off) obj.setTexture(textureFor(t.object, tileHash(gx, gy))).setPosition(sx, sy).setDepth(t.object === "buildings/wall" || t.object === "buildings/door" ? 3 : 10 + gy - this.origin.y + 0.4).setVisible(true);
        else obj.setVisible(false);
      }
    }
  }

  private drawBuildings(): void {
    const g = this.buildingGfx.clear();
    for (const t of this.buildingText) t.destroy();
    this.buildingText = [];
    for (const b of this.core.frame.buildings) {
      const bx = (b.x - this.origin.x) * TILE;
      const by = (b.y - this.origin.y) * TILE;
      const bw = b.w * TILE;
      const bh = b.h * TILE;
      g.fillStyle(0x6a5a48).fillRect(bx, by, bw, bh);
      g.fillStyle(hexColor(b.color)).fillRect(bx, by, bw, bh - 10);
      g.fillStyle(0x000000, 0.2);
      for (let i = 0; i < bw; i += 8) g.fillRect(bx + i, by, 2, bh - 10);
      g.lineStyle(2, 0x000000, 0.45).strokeRect(bx + 1, by + 1, bw - 2, bh - 2);
      // A lit window after dark (the server says who is home).
      if (b.lit) g.fillStyle(0xffd27a, 0.9).fillRect(bx + bw / 2 - 4, by + bh - 9, 8, 6);
      if (b.label) this.buildingText.push(this.add.text(bx + bw / 2, by + (bh - 10) / 2, b.label, font(12, "#f3e9d2")).setOrigin(0.5, 0.5).setDepth(4).setResolution(DPR));
    }
  }

  private drawSigns(): void {
    const want = new Set(this.core.frame.signs.map((s) => s.id));
    for (const [id, t] of this.signs) if (!want.has(id)) (t.destroy(), this.signs.delete(id));
    const m = this.core.frame;
    for (const s of m.signs) {
      let t = this.signs.get(s.id);
      if (!t) {
        t = s.kind === "exit" ? this.add.text(0, 0, s.text, { ...font(11, "#ffd27a"), backgroundColor: "#00000088", padding: { x: 4, y: 2 } }) : this.add.text(0, 0, s.text, { fontFamily: "system-ui, sans-serif", fontSize: "13px", fontStyle: "bold", color: "#ffe9b0", stroke: "#000000", strokeThickness: 3 });
        t.setDepth(s.kind === "exit" ? 450 : 460).setResolution(DPR);
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

  /** Night falls and weather comes in. */
  private setSky(): void {
    const a = this.core.frame.ambience;
    const dark = (1 - a.light) * 0.45;
    if (Math.abs(this.night.fillAlpha - dark) > 0.01) this.tweens.add({ targets: this.night, fillAlpha: dark, duration: 800 });
    const rainy = a.weather === "rain" || a.weather === "storm";
    if (rainy !== this.rain.emitting) rainy ? this.rain.start() : this.rain.stop();
    const snowy = a.weather === "snow";
    if (snowy !== this.snow.emitting) snowy ? this.snow.start() : this.snow.stop();
    this.rain.frequency = a.weather === "storm" ? 10 : 25;
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
    (b as Bubble & { who?: string }).who = who;
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
    const t = this.add.text(a.c.x, a.c.y - 26 + dy, text, font(12, color)).setOrigin(0.5).setDepth(1100).setResolution(DPR);
    this.tweens.add({ targets: t, y: t.y - 26, alpha: 0, duration: 1400, ease: "Cubic.easeOut", onComplete: () => t.destroy() });
  }

  private emote(who: string, symbol: string, size = 18): void {
    const a = this.actorFor(who);
    if (!a) return;
    const t = this.add.text(a.c.x + 12, a.c.y - 34, symbol, { fontSize: `${size}px` }).setOrigin(0.5).setDepth(1100).setResolution(DPR);
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
    if (!this.player) return;
    this.drawGround(Math.round(this.player.c.x / TILE - 0.5) + this.origin.x, Math.round(this.player.c.y / TILE - 0.5) + this.origin.y);
    for (const s of this.sprites.values()) {
      s.update(delta);
      s.bubble?.tick(time);
    }
    for (const b of this.chatter) {
      const who = (b as Bubble & { who?: string }).who;
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
  new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    width: VIEW_W * TILE,
    height: VIEW_H * TILE,
    backgroundColor: "#2d4a2b",
    // Keys are read by the page (so typing in the chat box never moves you); Phaser only gets the mouse.
    input: { keyboard: false },
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_HORIZONTALLY },
    render: { antialias: true, roundPixels: true },
    banner: false,
    scene: [scene],
  });
  return scene;
}
