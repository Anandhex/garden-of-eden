/**
 * The world view (G1), in Phaser 3: the village map, everyone on it, and what they
 * do. It only shows the server's state: positions come from snapshots, and the
 * animations come from typed events (T13). Clicks go back to game.ts as intents.
 */
import * as Phaser from "phaser";
import { findPath, type CreatureView, type GameEvent, type NpcView, type Snapshot } from "@millbrook/shared";
import { shortCoins } from "../dom";
import { clickTile, creatureAt, nearest, nearestCreature, nearestTalker, npcById } from "../game";
import { store, world } from "../store";
import { crowd, describeFolk, folkAt, insideOf, loadCrowd, updateCrowd } from "../crowd";
import { CrowdLayer } from "./CrowdLayer";
import { fpsWanted, mountFpsOverlay } from "./frame";
import { GRASS_VARIANTS, hexColor, makeTextures, ORIGINS, PATH_VARIANTS, TILE, tileHash } from "./textures";

/** The view (N16): 26 by 18 tiles of the map, following the player round bigger places. */
export const VIEW_W = 26;
export const VIEW_H = 18;
/** How long a townsperson's step takes on screen. */
const CROWD_STEP_MS = 450;

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

const px = (t: number) => t * TILE + TILE / 2;

type Look = "person" | "player" | "beast" | "grave";

/** One character on the map: a container that walks tile paths, with its label and HP bar. */
class Actor {
  readonly c: Phaser.GameObjects.Container;
  private body: Phaser.GameObjects.Image;
  private head: Phaser.GameObjects.Image | null = null;
  private readonly label: Phaser.GameObjects.Text;
  private readonly bar: Phaser.GameObjects.Graphics;
  private look: Look | null = null;
  private tint = 0xffffff;
  /** The tile the server says it's on (the container may still be walking there). */
  tile: { x: number; y: number };
  private path: Array<{ x: number; y: number }> = [];
  private speed = 0.25; // px per ms
  private walkClock = 0;
  bubble: Bubble | null = null;

  constructor(
    private readonly scene: WorldScene,
    tile: { x: number; y: number },
  ) {
    this.tile = { ...tile };
    const shadow = scene.add.image(0, 12, "shadow");
    this.body = scene.add.image(0, 4.5, "body");
    this.label = scene.add.text(0, -20, "", font(11)).setOrigin(0.5, 1).setResolution(DPR);
    this.bar = scene.add.graphics();
    this.c = scene.add.container(px(tile.x), px(tile.y), [shadow, this.body, this.bar, this.label]);
  }

  setLook(look: Look, color: string): void {
    const tint = hexColor(color);
    if (look === this.look && tint === this.tint) return;
    this.look = look;
    this.tint = tint;
    this.head?.destroy();
    this.head = null;
    this.c.list.filter((o) => o.name === "player-extra").forEach((o) => o.destroy());
    if (look === "grave") {
      this.body.setTexture("grave").setOrigin(...ORIGINS.grave).setPosition(0, 4).clearTint();
    } else if (look === "beast") {
      this.body.setTexture("beast").setOrigin(...ORIGINS.beast).setPosition(0, 2).setTint(tint);
    } else {
      this.body.setTexture("body").setOrigin(...ORIGINS.body).setPosition(0, 4.5).setTint(tint);
      this.head = this.scene.add.image(0, -9, "head").setOrigin(...ORIGINS.head);
      this.c.addAt(this.head, 2);
      if (look === "player") {
        const ring = this.scene.add.graphics({ x: 0, y: 0 }).lineStyle(2, 0xffd27a).strokeRoundedRect(-8, -4, 16, 17, 5).setName("player-extra");
        const marker = this.scene.add.image(0, -36, "marker").setName("player-extra");
        this.c.addAt(ring, 2);
        this.c.add(marker);
      }
    }
  }

  setLabel(text: string, highlight: boolean): void {
    if (this.label.text !== text) this.label.setText(text);
    this.label.setColor(highlight ? "#ffd27a" : "#ffffff");
    this.label.setY(this.look === "beast" ? -14 : -20);
  }

  setHp(share: number): void {
    this.bar.clear();
    if (share >= 1 || this.look === "grave") return;
    this.bar.fillStyle(0x000000, 0.65).fillRect(-12, 15, 24, 4);
    this.bar.fillStyle(0xe0675b).fillRect(-12, 15, 24 * Math.max(0, share), 4);
  }

  /** Walk to a tile: along a path when it's near, straight there when it isn't (or `jump`). */
  goTo(tile: { x: number; y: number }, opts: { stepMs: number; jump?: boolean; blocked?: (x: number, y: number) => boolean }): void {
    if (tile.x === this.tile.x && tile.y === this.tile.y && this.path.length === 0) return;
    const from = this.path.length > 0 ? this.path[0]! : this.tile;
    this.tile = { ...tile };
    if (opts.jump) {
      this.path = [];
      this.c.setPosition(px(tile.x), px(tile.y));
      return;
    }
    const route = Math.abs(from.x - tile.x) + Math.abs(from.y - tile.y) <= 1 ? [tile] : opts.blocked ? findPath(from, (t) => t.x === tile.x && t.y === tile.y, opts.blocked, 2000) : null;
    if (!route || route.length > 40) {
      this.path = [];
      this.c.setPosition(px(tile.x), px(tile.y));
      return;
    }
    this.path = route.map((t) => ({ ...t }));
    this.speed = TILE / opts.stepMs;
  }

  get walking(): boolean {
    return this.path.length > 0;
  }

  update(delta: number): void {
    let budget = this.speed * delta;
    while (this.path.length > 0 && budget > 0) {
      const next = this.path[0]!;
      const dx = px(next.x) - this.c.x;
      const dy = px(next.y) - this.c.y;
      const d = Math.hypot(dx, dy);
      if (d <= budget) {
        this.c.setPosition(px(next.x), px(next.y));
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
    if (this.look !== "grave") this.body.setY((this.look === "beast" ? 2 : 4.5) + bob);
    if (this.head) this.head.setY(-9 + bob);
    this.c.setDepth(10 + this.c.y / TILE);
    this.bubble?.follow(this.c.x, this.c.y);
  }

  flash(): void {
    this.body.setTintFill(0xffffff);
    this.scene.time.delayedCall(90, () => (this.look === "grave" ? this.body.clearTint() : this.body.setTint(this.tint)));
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

/** A speech bubble above someone: what they're saying as it streams, or "…" while they think. */
class Bubble {
  private readonly c: Phaser.GameObjects.Container;
  private readonly bg: Phaser.GameObjects.Graphics;
  private readonly text: Phaser.GameObjects.Text;
  private thinking = false;
  private dots = 0;
  private hideTimer: Phaser.Time.TimerEvent | null = null;

  constructor(private readonly scene: Phaser.Scene) {
    this.bg = scene.add.graphics();
    this.text = scene.add.text(0, 0, "", { fontFamily: "system-ui, sans-serif", fontSize: "12px", color: "#1d2026", wordWrap: { width: 170 }, align: "left" }).setResolution(DPR).setOrigin(0.5, 1);
    this.c = scene.add.container(0, 0, [this.bg, this.text]).setDepth(1000);
  }

  show(text: string | null, opts: { done?: boolean; filler?: boolean } = {}): void {
    this.hideTimer?.remove();
    this.hideTimer = null;
    this.c.setAlpha(1).setVisible(true);
    this.thinking = text === null;
    if (text !== null) {
      const clean = text.replace(/\s+/g, " ").trim();
      this.setText(clean.length > 110 ? `…${clean.slice(-108)}` : clean || "…", opts.filler === true);
    } else this.setText("…", false);
    if (opts.done) {
      this.hideTimer = this.scene.time.delayedCall(3500 + Math.min(4000, text?.length ?? 0) * 25, () =>
        this.scene.tweens.add({ targets: this.c, alpha: 0, duration: 400, onComplete: () => this.c.setVisible(false) }),
      );
    }
  }

  tick(time: number): void {
    if (!this.thinking) return;
    const dots = Math.floor(time / 350) % 4;
    if (dots !== this.dots) {
      this.dots = dots;
      this.setText(".".repeat(dots || 1).padEnd(3, " "), false);
    }
  }

  private setText(text: string, italic: boolean): void {
    this.text.setText(text).setFontStyle(italic ? "italic" : "normal");
    const w = Math.max(28, this.text.width + 14);
    const h = this.text.height + 10;
    this.bg.clear();
    this.bg.fillStyle(0xf3e9d2, 0.96).fillRoundedRect(-w / 2, -h - 6, w, h, 7);
    this.bg.fillTriangle(-5, -7, 5, -7, 0, 0);
    this.bg.lineStyle(1, 0x000000, 0.25).strokeRoundedRect(-w / 2, -h - 6, w, h, 7);
    this.text.setPosition(0, -11);
  }

  follow(x: number, y: number): void {
    // Keep it on screen at the view's edges.
    const half = (this.text.width + 14) / 2;
    const v = this.scene.cameras.main.worldView;
    this.c.setPosition(Phaser.Math.Clamp(x, v.x + half + 2, v.right - half - 2), Math.max(v.y + this.text.height + 18, y - 30));
  }

  destroy(): void {
    this.hideTimer?.remove();
    this.c.destroy();
  }
}

export class WorldScene extends Phaser.Scene {
  private actors = new Map<string, Actor>();
  private player!: Actor;
  private built = false;
  /** The map drawn (N14: a new place means a new map). */
  private mapId: string | null = null;
  private night!: Phaser.GameObjects.Rectangle;
  private rain!: Phaser.GameObjects.Particles.ParticleEmitter;
  private snow!: Phaser.GameObjects.Particles.ParticleEmitter;
  private hover!: Phaser.GameObjects.Graphics;
  private prompt!: Phaser.GameObjects.Text;
  private clock!: Phaser.GameObjects.Graphics;
  private clockText!: Phaser.GameObjects.Text;
  private crowdLayer!: CrowdLayer;
  /** `?fps=1`: frames per second and the worst frame, for the manual 60 fps check (N19). */
  private fps: { update(now: number, delta: number, loopFps: number): void } | null = fpsWanted() ? mountFpsOverlay() : null;
  private tip!: Phaser.GameObjects.Text;

  constructor() {
    super("world");
  }

  create(): void {
    // A restart (a new place) starts from nothing.
    this.actors = new Map();
    this.built = false;
    makeTextures(this);
    this.night = this.add.rectangle(0, 0, this.scale.width, this.scale.height, 0x0a1030, 0).setOrigin(0).setDepth(500).setScrollFactor(0);
    this.rain = this.add.particles(0, -10, "drop", {
      x: { min: 0, max: this.scale.width + 120 },
      speedY: { min: 380, max: 480 },
      speedX: { min: -90, max: -60 },
      lifespan: 1600,
      quantity: 3,
      frequency: 25,
      alpha: { start: 0.7, end: 0.3 },
      emitting: false,
    });
    this.rain.setDepth(600).setScrollFactor(0);
    this.snow = this.add.particles(0, -10, "flake", {
      x: { min: 0, max: this.scale.width },
      speedY: { min: 30, max: 60 },
      speedX: { min: -20, max: 20 },
      lifespan: 12000,
      quantity: 1,
      frequency: 90,
      scale: { min: 0.5, max: 1 },
      alpha: 0.85,
      emitting: false,
    });
    this.snow.setDepth(600).setScrollFactor(0);
    this.hover = this.add.graphics().setDepth(5);
    this.prompt = this.add.text(0, 0, "", font(13, "#ffd27a")).setOrigin(0.5, 0).setDepth(700).setResolution(DPR);
    this.clock = this.add.graphics().setDepth(700);
    this.clockText = this.add.text(0, 0, "", font(11)).setOrigin(0.5, 0).setDepth(700).setResolution(DPR);
    this.crowdLayer = new CrowdLayer(this);
    this.tip = this.add.text(0, 0, "", { ...font(11, "#f3e9d2", false), backgroundColor: "#000000b0", padding: { x: 5, y: 3 }, wordWrap: { width: 300 } }).setDepth(1200).setResolution(DPR).setVisible(false);

    this.input.on("pointerdown", (p: Phaser.Input.Pointer) => clickTile(Math.floor(p.worldX / TILE), Math.floor(p.worldY / TILE)));
    this.input.on("pointermove", (p: Phaser.Input.Pointer) => this.hoverAt(Math.floor(p.worldX / TILE), Math.floor(p.worldY / TILE), p.worldX, p.worldY));
    this.input.on("gameout", () => {
      this.hover.clear();
      this.tip.setVisible(false);
      this.crowdLayer.hover = null;
    });

    world.state = (s) => this.sync(s);
    world.event = (e) => this.animate(e);
    world.speech = (npc, text, opts) => this.speech(npc, text, opts);
    if (store.state) this.sync(store.state);
  }

  // ---------- the map ----------

  private buildMap(s: Snapshot): void {
    const { w, h, tiles } = s.map;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const t = tiles[y]![x]!;
        const n = tileHash(x, y);
        const ground = t === "path" ? `path${Math.floor(n * PATH_VARIANTS)}` : t === "water" ? "water" : `grass${Math.floor(n * GRASS_VARIANTS)}`;
        this.add.image(x * TILE, y * TILE, ground).setOrigin(0).setDepth(0);
        if (t === "tree") this.add.image(x * TILE, y * TILE, "tree").setOrigin(0).setDepth(10 + y + 0.4);
        // Town walls: wall tiles that aren't part of a building.
        if (t === "wall" && !s.map.buildings.some((b) => x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h)) this.add.image(x * TILE, y * TILE, "stonewall").setOrigin(0).setDepth(3);
        if (t === "water") {
          // Ripples that drift back and forth.
          for (const [ox, oy, phase] of [[6, 10, 0], [12, 22, 1]] as const) {
            const r = this.add.image(x * TILE + ox, y * TILE + oy, "ripple").setOrigin(0).setDepth(1);
            this.tweens.add({ targets: r, x: r.x + 4, duration: 1200 + n * 600, yoyo: true, repeat: -1, ease: "Sine.easeInOut", delay: (phase + n) * 400 });
          }
        }
      }
    }
    const g = this.add.graphics().setDepth(2);
    for (const b of s.map.buildings) {
      const bx = b.x * TILE, by = b.y * TILE, bw = b.w * TILE, bh = b.h * TILE;
      g.fillStyle(0x6a5a48).fillRect(bx, by, bw, bh);
      g.fillStyle(hexColor(b.color)).fillRect(bx, by, bw, bh - 10);
      g.fillStyle(0x000000, 0.2);
      for (let i = 0; i < bw; i += 8) g.fillRect(bx + i, by, 2, bh - 10);
      g.lineStyle(2, 0x000000, 0.45).strokeRect(bx + 1, by + 1, bw - 2, bh - 2);
      if (b.name !== "Gate" && b.name) this.add.text(bx + bw / 2, by + (bh - 10) / 2, b.name, font(12, "#f3e9d2")).setOrigin(0.5, 0.5).setDepth(4).setResolution(DPR);
    }
    tiles.forEach((row, ty) => row.forEach((t, tx) => t === "door" && this.add.image(tx * TILE, ty * TILE, "door").setOrigin(0).setDepth(3)));
    // The ways off this map (N15): a marked edge tile and a signpost with where it goes.
    for (const e of s.map.exits) {
      const left = e.x === 0, right = e.x === w - 1, top = e.y === 0;
      const arrow = left ? "◀" : right ? "▶" : top ? "▲" : "▼";
      g.fillStyle(0xffd27a, 0.35).fillRect(e.x * TILE, e.y * TILE, TILE, TILE);
      const tx = left ? TILE * 1.1 : right ? (w - 1.1) * TILE : (e.x + 0.5) * TILE;
      const ty = top ? TILE * 1.1 : e.y === h - 1 ? (h - 1.1) * TILE : (e.y + 0.5) * TILE;
      const ox = left ? 0 : right ? 1 : 0.5;
      const oy = top ? 0 : e.y === h - 1 ? 1 : 0.5;
      const text = left || top ? `${arrow} ${e.label}` : `${e.label} ${arrow}`;
      this.add.text(tx, ty, text, { ...font(11, "#ffd27a"), backgroundColor: "#00000088", padding: { x: 4, y: 2 } }).setOrigin(ox, oy).setDepth(450).setResolution(DPR);
    }
    this.player = new Actor(this, s.position);
    this.player.setLook("player", "#3f7fd0");
    // Bigger places are bigger than the view: it follows the player.
    this.cameras.main.setBounds(0, 0, w * TILE, h * TILE);
    this.cameras.main.startFollow(this.player.c, true, 0.18, 0.18);
    this.built = true;
  }

  /** Tiles a walker can't cross (for drawing NPCs walking between places). */
  private blocked = (x: number, y: number): boolean => {
    const t = store.state?.map.tiles[y]?.[x];
    return t === undefined || t === "tree" || t === "wall" || t === "water";
  };

  // ---------- following the server's state ----------

  private sync(s: Snapshot): void {
    // Arrived somewhere else (N14): draw that place's map.
    if (this.built && this.mapId !== s.map.id) {
      this.scene.restart();
      return;
    }
    if (!this.built) {
      this.buildMap(s);
      this.mapId = s.map.id;
    }
    const seen = new Set<string>();
    const near = nearest();
    for (const n of s.npcs) {
      if (n.away) continue;
      seen.add(n.id);
      this.place(n.id, n, n.dead ? "grave" : "person", n.color, n.dead ? `${n.name} †` : n.name, near?.id === n.id, n.dead ? 1 : n.hp / n.maxHp, n.companion ? 90 : 150);
    }
    const prey = nearestCreature();
    for (const c of s.creatures) {
      seen.add(c.uid);
      const label = prey?.uid === c.uid || c.engaged ? `${c.name} [${c.rank}]` : `[${c.rank}]`;
      this.place(c.uid, c, c.kind === "bandit" || c.kind === "villager" ? "person" : "beast", c.color, label, prey?.uid === c.uid, c.hp / c.maxHp, 200);
    }
    for (const [id, a] of this.actors) {
      if (seen.has(id)) continue;
      this.actors.delete(id);
      a.bubble?.destroy();
      a.bubble = null;
      this.tweens.add({ targets: a.c, alpha: 0, duration: 300, onComplete: () => a.destroy() });
    }
    const far = Math.abs(this.player.tile.x - s.position.x) + Math.abs(this.player.tile.y - s.position.y) > 1;
    this.player.goTo(s.position, { stepMs: 80, jump: far });
    // The townsfolk (N16): fetched once per map, then placed by the clock.
    void loadCrowd(s).then(() => {
      if (store.state !== s || this.mapId !== s.map.id) return;
      updateCrowd(s);
      this.crowdLayer.sync(s, CROWD_STEP_MS);
    });
    this.player.setLabel(`${s.player.name} (YOU)`, true);
    this.player.setHp(s.player.hp / s.player.maxHp);
    this.setSky(s);
  }

  private place(id: string, at: NpcView | CreatureView, look: Look, color: string, label: string, highlight: boolean, hp: number, stepMs: number): void {
    let a = this.actors.get(id);
    if (!a) {
      a = new Actor(this, at);
      a.c.setAlpha(0);
      this.tweens.add({ targets: a.c, alpha: 1, duration: 300 });
      this.actors.set(id, a);
    }
    a.setLook(look, color);
    a.setLabel(label, highlight);
    a.setHp(hp);
    a.goTo(at, { stepMs, blocked: this.blocked });
  }

  /** Night falls and weather comes in. */
  private setSky(s: Snapshot): void {
    const hour = s.time.hour + s.time.minute / 60;
    const dark = hour < 5 || hour >= 21 ? 0.45 : hour < 6.5 ? 0.45 * (6.5 - hour) / 1.5 : hour >= 19 ? 0.45 * (hour - 19) / 2 : 0;
    if (Math.abs(this.night.fillAlpha - dark) > 0.01) this.tweens.add({ targets: this.night, fillAlpha: dark, duration: 800 });
    const rainy = s.time.weather === "rain" || s.time.weather === "storm";
    if (rainy !== this.rain.emitting) rainy ? this.rain.start() : this.rain.stop();
    const snowy = s.time.weather === "snow";
    if (snowy !== this.snow.emitting) snowy ? this.snow.start() : this.snow.stop();
    this.rain.frequency = s.time.weather === "storm" ? 10 : 25;
  }

  // ---------- speech and events ----------

  private actorFor(who: string): Actor | undefined {
    return who === "player" ? this.player : this.actors.get(who);
  }

  private speech(npc: string, text: string | null, opts: { done?: boolean; filler?: boolean } = {}): void {
    const a = this.actors.get(npc);
    if (!a) return;
    a.bubble ??= new Bubble(this);
    a.bubble.show(text, opts);
    a.bubble.follow(a.c.x, a.c.y);
  }

  /** A word or number that floats up from someone and fades. */
  private float(who: string, text: string, color: string, dy = 0): void {
    const a = this.actorFor(who);
    if (!a) return;
    const t = this.add.text(a.c.x, a.c.y - 26 + dy, text, font(12, color)).setOrigin(0.5).setDepth(1100).setResolution(DPR);
    this.tweens.add({ targets: t, y: t.y - 26, alpha: 0, duration: 1400, ease: "Cubic.easeOut", onComplete: () => t.destroy() });
  }

  private emote(who: string, symbol: string): void {
    const a = this.actorFor(who);
    if (!a) return;
    const t = this.add.text(a.c.x + 12, a.c.y - 34, symbol, { fontSize: "18px" }).setOrigin(0.5).setDepth(1100).setResolution(DPR);
    this.tweens.add({ targets: t, y: t.y - 14, duration: 500, ease: "Back.easeOut" });
    this.tweens.add({ targets: t, alpha: 0, delay: 1600, duration: 400, onComplete: () => t.destroy() });
  }

  private animate(e: GameEvent): void {
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
        if (e.to !== "player" && this.actors.has(e.to)) this.float(e.to, `+ ${e.item}`, "#7bc47f");
        return;
      case "gold_moved":
        if (e.to === "player") this.float("player", `+${shortCoins(e.amount)}`, "#ffd27a", -12);
        if (e.from === "player") this.float("player", `−${shortCoins(e.amount)}`, "#e0a64b", -12);
        if (e.to !== "player" && this.actors.has(e.to)) this.float(e.to, `+${shortCoins(e.amount)}`, "#ffd27a", -12);
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

  // ---------- input feedback ----------

  private hoverAt(x: number, y: number, wx = 0, wy = 0): void {
    this.hover.clear();
    this.tip.setVisible(false);
    this.crowdLayer.hover = null;
    const s = store.state;
    if (!s || x < 0 || y < 0 || x >= s.map.w || y >= s.map.h) return;
    const npc = s.npcs.find((n) => n.x === x && n.y === y && !n.away);
    const folk = npc ? null : folkAt(s, x, y);
    const someone = npc ?? creatureAt(x, y) ?? (folk !== null ? folk : undefined);
    this.input.setDefaultCursor(someone !== undefined ? "pointer" : this.blocked(x, y) ? "default" : "crosshair");
    let tip = "";
    if (npc) tip = `${npc.name} — ${npc.role} · ${npc.doing}`;
    else if (folk !== null) {
      this.crowdLayer.hover = folk;
      tip = describeFolk(folk);
    } else {
      // A building: what it is, and who's inside.
      const i = s.map.buildings.findIndex((b) => x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h);
      const b = s.map.buildings[i];
      if (b && crowd.sim) {
        const inside = insideOf(i);
        const names = inside.slice(0, 6).map((k) => crowd.sim!.roster.people[k]!.name.split(" ")[0]);
        tip = `${b.name || (b.kind === "house" ? "A house" : (b.kind ?? "A building"))}: ${inside.length === 0 ? "nobody inside" : `${inside.length} inside (${names.join(", ")}${inside.length > 6 ? ", …" : ""})`}`;
      }
    }
    if (tip) {
      const v = this.cameras.main.worldView;
      this.tip.setText(tip);
      this.tip.setPosition(Math.min(wx + 14, v.right - this.tip.width - 4), Math.min(wy + 14, v.bottom - this.tip.height - 4)).setVisible(true);
    }
    if (this.blocked(x, y) && someone === undefined) return;
    this.hover.lineStyle(2, someone !== undefined ? 0xffd27a : 0xffffff, someone !== undefined ? 0.8 : 0.35).strokeRect(x * TILE + 1, y * TILE + 1, TILE - 2, TILE - 2);
  }

  update(time: number, delta: number): void {
    this.fps?.update(time, delta, this.game.loop.actualFps);
    if (!this.built) return;
    this.player.update(delta);
    this.crowdLayer.update(time, this.player.tile);
    for (const a of this.actors.values()) {
      a.update(delta);
      a.bubble?.tick(time);
    }
    this.drawPrompts();
    this.drawFightClock();
  }

  /** "E: talk" under the nearest villager, "F: fight" under the nearest creature. */
  private drawPrompts(): void {
    const s = store.state;
    if (!s) return;
    const n = nearestTalker();
    const prey = nearestCreature();
    let text = "";
    let at: { x: number; y: number } | null = null;
    if (prey && !store.talking) {
      text = prey.engaged ? "F: fight · R: run" : "F: fight";
      at = prey;
      this.prompt.setColor(prey.engaged ? "#ff8a7a" : "#ffd27a");
    } else if (n && store.talking !== n.id && !npcById(n.id)?.companion) {
      text = "E: talk";
      at = n;
      this.prompt.setColor("#ffd27a");
    }
    this.prompt.setVisible(Boolean(at));
    if (at) this.prompt.setText(text).setPosition(px(at.x), at.y * TILE + TILE + 2);
  }

  /** In a fight: a bar under the player for the seconds left to act before the opponent strikes. */
  private drawFightClock(): void {
    this.clock.clear();
    const f = store.fightClock;
    if (!f || store.working) return void this.clockText.setVisible(false);
    const left = Math.max(0, f.left - (performance.now() - f.at) / 1000);
    const share = left / f.tick;
    const x = this.player.c.x;
    const y = this.player.c.y + TILE / 2 + 2;
    this.clock.fillStyle(0x000000, 0.65).fillRect(x - 16, y, 32, 5);
    this.clock.fillStyle(share > 0.5 ? 0x7ac77a : share > 0.2 ? 0xe0b45b : 0xe0675b).fillRect(x - 16, y, 32 * share, 5);
    this.clockText.setVisible(true).setText(`your move: ${Math.ceil(left)}s`).setPosition(x, y + 6);
  }
}

export function startWorld(parent: HTMLElement, s: Snapshot): Phaser.Game {
  parent.replaceChildren();
  return new Phaser.Game({
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
    scene: [WorldScene],
  });
}
