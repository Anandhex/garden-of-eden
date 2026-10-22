/**
 * The townsfolk on the map (N16): every one of a place's people as a light sprite
 * (a body tinted by the clothes of their class, and a head), walking from tile to
 * tile as the minutes pass. Names show for the few nearest the player and for
 * whoever the pointer is on; a handful of the conversations in view show as
 * bubbles, and the low-born bow when their betters pass.
 */
import * as Phaser from "phaser";
import { CLASS_RANK, isHostile, type Snapshot } from "@millbrook/shared";
import { crowd, crowdChats, freshTold, person, promoted } from "../crowd";
import { nearestShown, walkAt } from "./frame";
import { hexColor, ORIGINS, TILE } from "./textures";

const DPR = Math.min(2, window.devicePixelRatio || 1);
const px = (t: number) => t * TILE + TILE / 2;
/** Names shown at once (nearest the player), and conversations shown at once (nearest first). */
const LABELS = 6;
const BUBBLES = 6;
const LABEL_RANGE = 3;

interface Sprite {
  body: Phaser.GameObjects.Image;
  head: Phaser.GameObjects.Image;
  x: number;
  y: number;
  fx: number;
  fy: number;
  tx: number;
  ty: number;
  t0: number;
  dur: number;
  shown: boolean;
  scale: number;
}

interface Say {
  c: Phaser.GameObjects.Container;
  bg: Phaser.GameObjects.Graphics;
  text: Phaser.GameObjects.Text;
  who: number;
  until: number;
  /** Pixels higher than usual (the reply sits above the first line, so side by side they don't overlap). */
  lift: number;
}

export class CrowdLayer {
  private sprites: Sprite[] = [];
  private labels: Phaser.GameObjects.Text[] = [];
  private says: Say[] = [];
  private moving = new Set<number>();
  private map: string | null = null;
  private lastMinute = -1;
  /** The last gossip bubble shown (N33): each thing said is shown once. */
  private lastTold = 0;
  /** The person the pointer is on. */
  hover: number | null = null;

  constructor(private readonly scene: Phaser.Scene) {
    const style = { fontFamily: "system-ui, sans-serif", fontSize: "10px", color: "#f3e9d2", stroke: "rgba(0,0,0,0.8)", strokeThickness: 3 };
    for (let i = 0; i < LABELS + 1; i++) this.labels.push(scene.add.text(0, 0, "", style).setOrigin(0.5, 1).setResolution(DPR).setDepth(900).setVisible(false));
    for (let i = 0; i < BUBBLES * 2 + 1; i++) {
      const bg = scene.add.graphics();
      const text = scene.add.text(0, 0, "", { fontFamily: "system-ui, sans-serif", fontSize: "11px", color: "#1d2026", wordWrap: { width: 150 } }).setOrigin(0.5, 1).setResolution(DPR);
      const c = scene.add.container(0, 0, [bg, text]).setDepth(950).setVisible(false);
      this.says.push({ c, bg, text, who: -1, until: 0, lift: 0 });
    }
  }

  /** Make (or clear) the sprites for the townsfolk of this map. */
  private build(): void {
    for (const s of this.sprites) {
      s.body.destroy();
      s.head.destroy();
    }
    this.sprites = [];
    this.moving.clear();
    const people = crowd.sim?.roster.people ?? [];
    for (const p of people) {
      const scale = p.job === "child" ? 0.68 : 0.88;
      const body = this.scene.add.image(0, 0, "body").setOrigin(...ORIGINS.body).setTint(hexColor(p.color)).setScale(scale).setVisible(false);
      const head = this.scene.add.image(0, 0, "head").setOrigin(...ORIGINS.head).setScale(scale).setVisible(false);
      // Nobles and royals stand out: a gold or purple trim.
      if (CLASS_RANK[p.cls] >= 6) head.setTint(p.cls === "royal" ? 0xffe9a0 : 0xf0d8f0);
      this.sprites.push({ body, head, x: -1, y: -1, fx: 0, fy: 0, tx: 0, ty: 0, t0: 0, dur: 0, shown: false, scale });
    }
    this.map = crowd.map;
    this.lastMinute = -1;
  }

  /** Follow the clock: everyone to where they are this minute. `stepMs`: how long a step's walk takes on screen. */
  sync(s: Snapshot, stepMs: number): void {
    if (crowd.map !== this.map || this.sprites.length !== (crowd.sim?.roster.people.length ?? 0)) this.build();
    if (!crowd.sim || crowd.minute === this.lastMinute) return;
    const jump = this.lastMinute < 0 || Math.abs(crowd.minute - this.lastMinute) > 3;
    this.lastMinute = crowd.minute;
    const now = this.scene.time.now;
    crowd.pos.forEach((p, i) => {
      const sp = this.sprites[i];
      if (!sp) return;
      const show = p.visible && !promoted(s, i);
      if (!show) {
        if (sp.shown) {
          sp.body.setVisible(false);
          sp.head.setVisible(false);
          sp.shown = false;
          this.moving.delete(i);
        }
        return;
      }
      const tx = px(p.x);
      const ty = px(p.y);
      if (!sp.shown || jump || Math.abs(p.x - sp.x) + Math.abs(p.y - sp.y) > 4) {
        sp.fx = sp.tx = tx;
        sp.fy = sp.ty = ty;
        this.place(sp, tx, ty, 0);
        this.moving.delete(i);
      } else if (p.x !== sp.x || p.y !== sp.y) {
        sp.fx = sp.body.x;
        sp.fy = sp.body.y - 4.5 * sp.scale;
        sp.tx = tx;
        sp.ty = ty;
        sp.t0 = now;
        sp.dur = stepMs * Math.max(1, Math.abs(p.x - sp.x) + Math.abs(p.y - sp.y));
        this.moving.add(i);
      }
      sp.x = p.x;
      sp.y = p.y;
      if (!sp.shown) {
        sp.body.setVisible(true);
        sp.head.setVisible(true);
        sp.shown = true;
      }
    });
    this.talk(s);
    this.gossip(s);
  }

  private place(sp: Sprite, x: number, y: number, bob: number): void {
    sp.body.setPosition(x, y + 4.5 * sp.scale + bob);
    sp.head.setPosition(x, y - 9 * sp.scale + bob);
    const depth = 10 + y / TILE;
    sp.body.setDepth(depth);
    sp.head.setDepth(depth + 0.01);
  }

  /** Each frame: walkers along, names and bubbles follow. */
  update(time: number, player: { x: number; y: number } | null): void {
    for (const i of this.moving) {
      const sp = this.sprites[i]!;
      const { x, y, bob, done } = walkAt(sp, time);
      this.place(sp, x, y, bob);
      if (done) this.moving.delete(i);
    }
    this.drawLabels(player);
    for (const say of this.says) {
      if (!say.c.visible) continue;
      if (time > say.until) {
        say.c.setVisible(false);
        continue;
      }
      const sp = this.sprites[say.who];
      if (!sp?.shown) {
        say.c.setVisible(false);
        continue;
      }
      say.c.setPosition(sp.body.x, sp.head.y - 12 - say.lift);
    }
  }

  /** Names over the nearest few, and over whoever the pointer is on. */
  private drawLabels(player: { x: number; y: number } | null): void {
    const who = player ? nearestShown(this.sprites, player, LABEL_RANGE, LABELS) : [];
    if (this.hover !== null && this.sprites[this.hover]?.shown && !who.includes(this.hover)) who.push(this.hover);
    this.labels.forEach((label, k) => {
      const i = who[k];
      const sp = i === undefined ? undefined : this.sprites[i];
      if (i === undefined || !sp) return void label.setVisible(false);
      const p = person(i)!;
      const text = p.name.split(" ")[0]!;
      if (label.text !== text) label.setText(text);
      label.setColor(CLASS_RANK[p.cls] >= 6 ? "#ffd27a" : p.cls === "slave" ? "#b9b2a6" : "#f3e9d2");
      label.setPosition(sp.body.x, sp.head.y - 8).setVisible(true);
    });
  }

  /** Someone of the place just passed something on (N33): a bubble over them, on a slot of its own, if they are on screen. */
  private gossip(s: Snapshot): void {
    const fresh = freshTold(s, this.lastTold);
    if (fresh.length === 0) return;
    this.lastTold = Math.max(...fresh.map((t) => t.seq));
    // Many are indoors (a household, a workplace): the bubble goes over the first who is out on the map.
    for (const t of fresh) if (this.say(BUBBLES * 2, t.who, t.line, 0, this.scene.time.now + 5200)) break;
  }

  /** A new minute: a few of the conversations in view, nearest the player first. */
  private talk(s: Snapshot): void {
    const v = this.scene.cameras.main.worldView;
    const box = { x0: Math.floor(v.x / TILE), y0: Math.floor(v.y / TILE), x1: Math.ceil(v.right / TILE), y1: Math.ceil(v.bottom / TILE) };
    // A new exchange only every third minute, so they're readable.
    if (crowd.minute % 3 !== 0) return;
    const chats = crowdChats(s, box);
    const me = s.position;
    // A quarrel is worth watching: those first, then by how near the player they are.
    const quarrel = (c: (typeof chats)[number]) => (c.kind && isHostile(c.kind) ? 0 : 1);
    chats.sort((a, b) => quarrel(a) - quarrel(b) || dist2(crowd.pos[a.a]!, me) - dist2(crowd.pos[b.a]!, me));
    const now = this.scene.time.now;
    // Far enough apart that the bubbles don't sit on each other.
    const picked: typeof chats = [];
    for (const c of chats) {
      const a = crowd.pos[c.a]!;
      if (picked.every((o) => Math.abs(crowd.pos[o.a]!.x - a.x) >= 7 || Math.abs(crowd.pos[o.a]!.y - a.y) >= 4)) picked.push(c);
      if (picked.length >= BUBBLES) break;
    }
    picked.forEach((c, k) => {
      const hot = !!c.kind && isHostile(c.kind);
      this.say(2 * k, c.a, c.lines[0], 0, now + 3200, hot);
      this.scene.time.delayedCall(1500, () => this.say(2 * k + 1, c.b, c.lines[1], 22, this.scene.time.now + 3000, hot));
      if (c.bow) this.emote(c.a, "🙇");
      else if (hot) this.emote(c.actor ?? c.a, "💢");
    });
  }

  private say(slot: number, who: number, line: string, lift: number, until: number, hot = false): boolean {
    const say = this.says[slot];
    const sp = this.sprites[who];
    if (!say || !sp?.shown) return false;
    const clean = line.length > 70 ? `${line.slice(0, 68)}…` : line;
    say.text.setText(clean).setFontStyle(line.startsWith("*") ? "italic" : "normal");
    const w = Math.max(24, say.text.width + 12);
    const h = say.text.height + 8;
    say.bg.clear();
    say.bg.fillStyle(0xf3e9d2, 0.92).fillRoundedRect(-w / 2, -h - 5, w, h, 6);
    // A hostile exchange (N37) has a red edge.
    if (hot) say.bg.lineStyle(2, 0xb03a2e, 1).strokeRoundedRect(-w / 2, -h - 5, w, h, 6);
    say.bg.fillTriangle(-4, -6, 4, -6, 0, 0);
    say.text.setPosition(0, -9);
    say.who = who;
    say.until = until;
    say.lift = lift;
    say.c.setPosition(sp.body.x, sp.head.y - 12 - lift).setVisible(true);
    return true;
  }

  private emote(who: number, symbol: string): void {
    const sp = this.sprites[who];
    if (!sp?.shown) return;
    const t = this.scene.add.text(sp.body.x + 10, sp.head.y - 14, symbol, { fontSize: "14px" }).setOrigin(0.5).setDepth(1100).setResolution(DPR);
    this.scene.tweens.add({ targets: t, y: t.y - 10, alpha: 0, delay: 900, duration: 600, onComplete: () => t.destroy() });
  }

  destroy(): void {
    for (const s of this.sprites) {
      s.body.destroy();
      s.head.destroy();
    }
    this.sprites = [];
    for (const l of this.labels) l.destroy();
    for (const s of this.says) s.c.destroy();
  }
}

const dist2 = (a: { x: number; y: number }, b: { x: number; y: number }) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
