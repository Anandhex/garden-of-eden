/**
 * The people and beasts on the map (G6): a person is one body drawn in layers from the people sheet, the clothes
 * tinted by `look.tint`, the trim by `look.trim` and the hair by a pick from the id, walking in four directions;
 * a beast trots from the side. Each walks along the tiles the server gives. Their names, HP bars and bubbles sit on
 * the label layer above everything, so roofs and trees never hide them.
 */
import * as Phaser from "phaser";
import type { Actor as ActorData } from "@millbrook/shared/view";
import type { Core } from "../../../core";
import { framesOf, hasFrame, lookOf, PERSON_LAYERS, pickFrame, textureFor, warnMissing, type Pick } from "../art";
import { DEPTH, sortDepth } from "./depth";
import { hexColor, ORIGINS, TILE } from "./textures";

/** How long a tile's walk takes on screen, by who's walking. */
const WALK_MS: Record<ActorData["kind"], number> = { player: 90, npc: 150, companion: 90, creature: 200, folk: 450, traveller: 450 };
/** Hair colours: a person keeps theirs (a pick by id); it is drawing, not a fact. */
const HAIR = [0x3b2a20, 0x6a4428, 0x9a6a3a, 0xc8a060, 0x2a2a30, 0x8a3a24, 0xb0aaa0, 0x5a4a3a];
/** Trim when the server gives none: a leather belt and collar. */
const PLAIN_TRIM = 0x6e5036;
/** The foot stands this far below the tile's middle. */
const FOOT = TILE * 0.38;
/** The walk cycle: stand, left foot, stand, right foot. */
const CYCLE = [1, 0, 2, 0];
const DPR = Math.min(2, window.devicePixelRatio || 1);

export const font = (size: number, color = "#ffffff", bold = true): Phaser.Types.GameObjects.Text.TextStyle => ({
  fontFamily: "system-ui, sans-serif",
  fontSize: `${size}px`,
  fontStyle: bold ? "bold" : "normal",
  color,
  stroke: "rgba(0,0,0,0.75)",
  strokeThickness: 3,
});
export { DPR };

export interface ActorScene extends Phaser.Scene {
  core: Core;
  px(x: number, y: number): { x: number; y: number };
  lit<T extends Phaser.GameObjects.GameObject & { setPipeline(p: string): unknown }>(o: T): T;
  /** The scene's origin row, so depth is by rows from it. */
  origin: { x: number; y: number };
}

const idHash = (id: string) => {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h;
};

function setPick(img: Phaser.GameObjects.Image, p: Pick): Phaser.GameObjects.Image {
  return img.setTexture(p.sheet ?? p.frame, p.sheet ? p.frame : undefined).setOrigin(p.ox, p.oy).setScale(p.scale);
}

/** One character: a container at the foot, its layers, and a label container above everything. */
export class Sprite {
  /** At the actor's tile middle; depth by its foot. */
  readonly c: Phaser.GameObjects.Container;
  /** Name, HP bar and the player's marker, on the label layer. */
  private readonly top: Phaser.GameObjects.Container;
  private layers: Phaser.GameObjects.Image[] = [];
  private label: Phaser.GameObjects.Text | null = null;
  private bar: Phaser.GameObjects.Graphics | null = null;
  private marker: Phaser.GameObjects.Image | null = null;
  private look: string | null = null;
  private mode: "person" | "beast" | "grave" | "fallback-person" | "fallback" = "fallback";
  private tints: number[] = [];
  private path: Array<{ x: number; y: number }> = [];
  private speed = 0.25;
  private stride = 0;
  private facing: "n" | "e" | "s" | "w" = "s";
  private side: "e" | "w" = "e";
  private frameShown = "";
  bubble: Bubble | null = null;
  data: ActorData;

  constructor(
    private readonly scene: ActorScene,
    a: ActorData,
  ) {
    this.data = a;
    const p = scene.px(a.x, a.y);
    const shadowPick = pickFrame("fx/shadow");
    const shadow = shadowPick ? setPick(scene.add.image(0, FOOT, ""), shadowPick).setOrigin(0.5, 0.6) : scene.add.image(0, 12, "shadow");
    this.c = scene.add.container(p.x, p.y, [shadow]);
    this.top = scene.add.container(p.x, p.y).setDepth(DEPTH.labels);
    this.facing = a.facing ?? "s";
    this.set(a);
  }

  /** New facts from the server: how it looks, its HP, which way it faces. */
  set(a: ActorData): void {
    this.data = a;
    if (a.facing && !this.walking) this.face(a.facing);
    const key = `${a.look.sprite}|${a.look.tint ?? ""}|${a.look.trim ?? ""}|${a.kind}`;
    if (key !== this.look) {
      this.look = key;
      this.build(a);
    }
    this.c.setScale(a.look.size ?? 1);
    this.setHp(a.hp ?? 1);
    this.pose(true);
  }

  private build(a: ActorData): void {
    for (const l of this.layers) l.destroy();
    this.layers = [];
    this.marker?.destroy();
    this.marker = null;
    const kind = lookOf(a.look.sprite);
    const tint = a.look.tint ? hexColor(a.look.tint) : 0xffffff;
    const frames = framesOf(a.look.sprite);
    const art = frames.length > 0 && frames.every(hasFrame);
    if (!art) warnMissing(a.look.sprite);
    const add = (img: Phaser.GameObjects.Image) => {
      this.scene.lit(img);
      this.layers.push(img);
      this.c.add(img);
      return img;
    };
    if (kind === "person" && art) {
      this.mode = "person";
      this.tints = [0xffffff, tint, HAIR[idHash(a.id) % HAIR.length]!, a.look.trim ? hexColor(a.look.trim) : PLAIN_TRIM];
      for (let i = 0; i < PERSON_LAYERS.length; i++) add(this.scene.add.image(0, FOOT, "")).setTint(this.tints[i]!);
    } else if (kind === "beast" && art) {
      this.mode = "beast";
      // Known kinds are drawn in their own colours; the stand-in beast takes the creature's.
      this.tints = [a.look.sprite === "creature/beast" ? tint : 0xffffff];
      add(this.scene.add.image(0, FOOT, "")).setTint(this.tints[0]!);
    } else if (kind === "grave" && art) {
      this.mode = "grave";
      this.tints = [0xffffff];
      setPick(add(this.scene.add.image(0, FOOT, "")), pickFrame("fx/grave")!);
    } else if (kind === "person") {
      // The fallback: the old code-drawn body and head.
      this.mode = "fallback-person";
      this.tints = [tint, a.look.trim ? hexColor(a.look.trim) : 0xffffff];
      add(this.scene.add.image(0, 4.5, textureFor(a.look.sprite)).setOrigin(...ORIGINS.body)).setTint(tint);
      const head = add(this.scene.add.image(0, -9, "head").setOrigin(...ORIGINS.head));
      if (a.look.trim) head.setTint(hexColor(a.look.trim));
    } else {
      this.mode = "fallback";
      this.tints = [kind === "grave" ? 0xffffff : tint];
      add(this.scene.add.image(0, kind === "grave" ? 4 : 2, textureFor(a.look.sprite)).setOrigin(...(kind === "grave" ? ORIGINS.grave : ORIGINS.beast))).setTint(this.tints[0]!);
    }
    if (a.kind === "player") {
      const m = pickFrame("fx/marker");
      this.marker = m ? setPick(this.scene.add.image(0, -TILE * 1.05, ""), m).setOrigin(0.5, 1) : this.scene.add.image(0, -36, "marker");
      this.top.add(this.marker);
    }
    this.frameShown = "";
  }

  /** Show the frame for the facing and the stride (forced after a rebuild). */
  private pose(force = false): void {
    const step = this.walking ? CYCLE[Math.floor(this.stride / (TILE * 0.3)) % CYCLE.length]! : 0;
    if (this.mode === "person") {
      const name = `people/body/${this.facing}${step}`;
      if (!force && name === this.frameShown) return;
      this.frameShown = name;
      PERSON_LAYERS.forEach((l, i) => setPick(this.layers[i]!, pickFrame(`${name}.${l}`)!));
    } else if (this.mode === "beast") {
      const name = `${this.data.look.sprite}/${this.side}${this.walking ? Math.floor(this.stride / (TILE * 0.35)) % 2 : 0}`;
      if (!force && name === this.frameShown) return;
      this.frameShown = name;
      setPick(this.layers[0]!, pickFrame(name)!);
    }
  }

  private face(d: "n" | "e" | "s" | "w"): void {
    this.facing = d;
    if (d === "e" || d === "w") this.side = d;
  }

  setLabel(text: string | null, highlight: boolean): void {
    if (!text) return void this.label?.setVisible(false);
    if (!this.label) {
      this.label = this.scene.add.text(0, 0, "", font(this.data.kind === "folk" ? 10 : 11)).setOrigin(0.5, 1).setResolution(DPR);
      this.top.add(this.label);
    }
    if (this.label.text !== text) this.label.setText(text);
    this.label.setVisible(true).setColor(highlight ? "#ffd27a" : this.data.flags.includes("noble") ? "#ffd27a" : this.data.flags.includes("lowborn") ? "#b9b2a6" : "#ffffff");
    const size = this.data.look.size ?? 1;
    const head = lookOf(this.data.look.sprite) === "beast" ? -TILE * 0.45 : -TILE * 0.78;
    this.label.setY(head * size - (this.data.kind === "player" ? 14 : 2));
  }

  private setHp(share: number): void {
    if (share >= 1 || lookOf(this.data.look.sprite) === "grave") return void this.bar?.clear();
    if (!this.bar) {
      this.bar = this.scene.add.graphics();
      this.top.add(this.bar);
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
    const was = this.walking;
    while (this.path.length > 0 && budget > 0) {
      const next = this.path[0]!;
      const dx = next.x - this.c.x;
      const dy = next.y - this.c.y;
      const d = Math.hypot(dx, dy);
      if (d > 0.01) this.face(Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? "e" : "w") : dy > 0 ? "s" : "n");
      if (d <= budget) {
        this.c.setPosition(next.x, next.y);
        this.path.shift();
        budget -= d;
        this.stride += d;
      } else {
        this.c.setPosition(this.c.x + (dx / d) * budget, this.c.y + (dy / d) * budget);
        this.stride += budget;
        budget = 0;
      }
    }
    if (!this.walking) {
      this.stride = 0;
      // Standing again: face the way the server says (in a conversation, each other).
      if (was && this.data.facing) this.face(this.data.facing);
    }
    // A little bob while walking.
    const bob = this.walking ? -Math.abs(Math.sin(this.stride / (TILE * 0.3) * Math.PI)) * 1.2 : 0;
    for (const l of this.layers) l.setY((this.mode === "fallback-person" ? (l === this.layers[0] ? 4.5 : -9) : this.mode === "fallback" ? 2 : FOOT) + bob);
    this.pose();
    this.c.setDepth(sortDepth(this.c.y / TILE + 0.38));
    this.top.setPosition(this.c.x, this.c.y);
    this.bubble?.follow(this.c.x, this.c.y);
  }

  flash(): void {
    for (const l of this.layers) l.setTintFill(0xffffff);
    this.scene.time.delayedCall(90, () => this.layers.forEach((l, i) => l.setTint(this.tints[i] ?? 0xffffff)));
  }

  /** Lean towards a point and back: an attack. */
  lunge(toX: number, toY: number): void {
    const d = Math.hypot(toX - this.c.x, toY - this.c.y) || 1;
    this.scene.tweens.add({ targets: this.layers, x: ((toX - this.c.x) / d) * 6, duration: 70, yoyo: true, onComplete: () => this.layers.forEach((l) => l.setX(0)) });
  }

  fadeIn(): void {
    this.c.setAlpha(0);
    this.top.setAlpha(0);
    this.scene.tweens.add({ targets: [this.c, this.top], alpha: 1, duration: 300 });
  }

  fadeOut(): void {
    this.scene.tweens.add({ targets: [this.c, this.top], alpha: 0, duration: 300, onComplete: () => this.destroy() });
  }

  destroy(): void {
    this.bubble?.destroy();
    this.c.destroy();
    this.top.destroy();
  }
}

/** A speech bubble: what someone says as it streams, "…" while they think, or a line of the crowd's chatter. */
export class Bubble {
  private readonly c: Phaser.GameObjects.Container;
  private readonly bg: Phaser.GameObjects.Graphics;
  private readonly text: Phaser.GameObjects.Text;
  private thinking = false;
  private dots = 0;
  private hideTimer: Phaser.Time.TimerEvent | null = null;
  lift = 0;
  who?: string;

  constructor(
    private readonly scene: Phaser.Scene,
    small = false,
  ) {
    this.bg = scene.add.graphics();
    this.text = scene.add.text(0, 0, "", { fontFamily: "system-ui, sans-serif", fontSize: small ? "11px" : "12px", color: "#1d2026", wordWrap: { width: small ? 150 : 170 } }).setResolution(DPR).setOrigin(0.5, 1);
    this.c = scene.add.container(0, 0, [this.bg, this.text]).setDepth(small ? DEPTH.bubbles - 1 : DEPTH.bubbles);
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
    this.c.setPosition(Phaser.Math.Clamp(x, v.x + half + 2, v.right - half - 2), Math.max(v.y + this.text.height + 18, y - 34 - this.lift));
  }

  destroy(): void {
    this.hideTimer?.remove();
    this.c.destroy();
  }
}
