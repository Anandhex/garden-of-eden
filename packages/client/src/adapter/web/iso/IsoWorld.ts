/**
 * The 2.5D world view of the web adapter (G7), in Three.js: an isometric HD-2D diorama. It draws only what the
 * server sends, like the flat view (world/WorldScene.ts): the ground from the patches, buildings as boxes dressed in
 * their templates, everything that stands as a sprite facing the camera, people walking the server's routes, the
 * server's lights, the weather. The camera looks down from a corner and turns a quarter with Q and E; the wheel
 * zooms. Keys follow the screen (W is always up-right). A click is a tile sent to the server; what it means is the
 * server's to decide.
 */
import * as THREE from "three";
import type { Frame, GameEvent } from "@millbrook/shared/view";
import type { Core, FrameChange } from "../../../core";
import { shortCoins } from "../../../dom";
import type { WorldView } from "../worldView";
import { fpsWanted, mountFpsOverlay, nearestShown } from "../world/fps";
import { lookPrefs, saveLook, type LookPrefs } from "../world/look";
import { IsoActor } from "./actors";
import { Atlas } from "./atlas";
import { IsoAtmosphere } from "./atmosphere";
import { IsoBuildings } from "./buildings";
import { cameraOffset, CAMERA_DISTANCE, clampZoom, stepFor, VIEW_TILES, yawOf, type Turn } from "./camera";
import type { IsoCtx } from "./ctx";
import { IsoGround } from "./ground";
import { IsoLights } from "./lights";
import { IsoMarks } from "./marks";
import { Overlay, type Bubble } from "./overlay";
import { HeightField } from "./terrain";

const FOLK_LABELS = 6;
const FOLK_LABEL_RANGE = 3;
const MOOD_EMOTE: Record<string, string> = { happy: "😊", neutral: "😐", annoyed: "😒", angry: "😠", afraid: "😨", sad: "😢" };
/** How close the camera comes inside a building. */
const INDOOR_ZOOM = 1.9;
/** How long a quarter turn of the camera takes. */
const TURN_MS = 420;

export class IsoWorld implements WorldView {
  private renderer: THREE.WebGLRenderer | null = null;
  private camera: THREE.OrthographicCamera;
  private ctx: IsoCtx;
  private overlay: Overlay;
  private canvas: HTMLCanvasElement | null = null;
  private ground!: IsoGround;
  private buildings!: IsoBuildings;
  private marks!: IsoMarks;
  private lights!: IsoLights;
  private atmosphere!: IsoAtmosphere;
  private actors = new Map<string, IsoActor>();
  private bubbles = new Map<string, Bubble>();
  private chatter: Bubble[] = [];
  private look: LookPrefs = lookPrefs();
  private mapId: string | null = null;
  private ready = false;
  private target = new THREE.Vector3();
  private turn: Turn = 0;
  private turnFrom = 0;
  private turnAt = 0;
  private zoom = 1;
  private outdoorZoom = 1;
  private shake = { until: 0, amount: 0 };
  private hoverTile: { x: number; y: number } | null = null;
  private hover: THREE.LineLoop;
  private raycaster = new THREE.Raycaster();
  private last = performance.now();
  private fps = fpsWanted() ? mountFpsOverlay() : null;
  private frames = 0;
  private fpsAt = performance.now();
  private loopFps = 60;

  constructor(
    private readonly parent: HTMLElement,
    readonly core: Core,
  ) {
    parent.replaceChildren();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, CAMERA_DISTANCE * 3);
    const origin = { x: 0, y: 0 };
    this.ctx = { scene: new THREE.Scene(), atlas: null as unknown as Atlas, core, origin, yaw: yawOf(0), height: new HeightField((x, y) => core.frame.heightAt(x, y), () => this.ctx.origin) };
    this.hover = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0.05, 0, 0.05), new THREE.Vector3(0.95, 0, 0.05), new THREE.Vector3(0.95, 0, 0.95), new THREE.Vector3(0.05, 0, 0.95)]), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, depthTest: false }));
    this.hover.visible = false;
    this.hover.renderOrder = 10;
    this.ctx.scene.add(this.hover);
    try {
      this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
    } catch {
      this.renderer = null;
    }
    this.overlay = new Overlay(parent);
    if (!this.renderer) {
      const p = document.createElement("p");
      p.className = "iso-error";
      p.textContent = "This browser can't draw the 2.5D view (no WebGL). Switch to the flat view with the ▦ button in the header.";
      parent.prepend(p);
      return;
    }
    const r = this.renderer;
    r.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    r.outputColorSpace = THREE.SRGBColorSpace;
    this.canvas = r.domElement;
    this.canvas.className = "iso-canvas";
    parent.prepend(this.canvas);
    for (let i = 0; i < 14; i++) this.chatter.push(this.overlay.bubble(true));
    this.wireInput();
    void Atlas.load().then((atlas) => this.begin(atlas));
  }

  /** The art is in: build the layers, then draw what the core already holds. */
  private begin(atlas: Atlas): void {
    const r = this.renderer!;
    this.ctx.atlas = atlas;
    this.ground = new IsoGround(this.ctx);
    this.buildings = new IsoBuildings(this.ctx);
    this.marks = new IsoMarks(this.ctx);
    this.lights = new IsoLights(this.ctx);
    this.resize();
    this.atmosphere = new IsoAtmosphere(this.ctx, r, this.camera, this.look, this.ground.surface);
    new ResizeObserver(() => this.resize()).observe(this.parent);
    this.ready = true;
    if (new URLSearchParams(location.search).has("debug")) Object.assign(window, { iso: this, THREE });
    const m = this.core.frame;
    if (m.map) this.frame({ whole: true, added: [...m.actors.keys()], updated: [], moved: [], removed: [], patches: [], buildings: true, lights: true, signs: true }, null);
    r.setAnimationLoop(() => this.tick());
  }

  private resize(): void {
    if (!this.renderer) return;
    const w = Math.max(1, this.parent.clientWidth);
    const h = Math.max(1, this.parent.clientHeight);
    this.renderer.setSize(w, h, false);
    this.atmosphere?.resize(w, h);
    this.frustum();
  }

  private frustum(): void {
    const w = Math.max(1, this.parent.clientWidth);
    const h = Math.max(1, this.parent.clientHeight);
    const half = VIEW_TILES / 2 / this.zoom;
    this.camera.top = half;
    this.camera.bottom = -half;
    this.camera.left = -half * (w / h);
    this.camera.right = half * (w / h);
    this.camera.updateProjectionMatrix();
  }

  // ---------- the look ----------

  setLook(p: Partial<LookPrefs>): LookPrefs {
    this.look = { ...this.look, ...p };
    saveLook(this.look);
    this.atmosphere?.setOn(this.look.atmosphere, this.look.blur);
    return this.look;
  }

  get lookNow(): LookPrefs {
    return this.look;
  }

  // ---------- keys: turning the camera, steps that follow the screen ----------

  key(k: string): boolean {
    if (k !== "q" && k !== "e") return false;
    this.turnFrom = this.ctx.yaw;
    this.turnAt = performance.now();
    this.turn = (((this.turn + (k === "e" ? 1 : -1)) % 4) + 4) % 4 as Turn;
    return true;
  }

  stepFor(dx: -1 | 0 | 1, dy: -1 | 0 | 1): { dx: -1 | 0 | 1; dy: -1 | 0 | 1 } {
    return stepFor(yawOf(this.turn), dx, dy);
  }

  // ---------- the frame ----------

  frame(change: FrameChange, f: Frame | null): void {
    const m = this.core.frame;
    if (!m.map || !this.ready) return;
    const me = m.actors.get("player");
    if (change.whole || m.map.id !== this.mapId) {
      // Indoors (N32) the camera comes in closer: a room is small. Back out, it goes back to where it was.
      const indoors = m.map.id.startsWith("in:");
      if (indoors !== this.mapId?.startsWith("in:")) {
        if (indoors) this.outdoorZoom = this.zoom;
        this.zoom = indoors ? Math.max(this.zoom, INDOOR_ZOOM) : this.outdoorZoom;
        this.frustum();
      }
      this.mapId = m.map.id;
      for (const a of this.actors.values()) a.destroy();
      this.actors.clear();
      for (const id of [...this.bubbles.keys()]) this.dropBubble(id);
      this.overlay.clear();
      this.ctx.origin = m.map.kind === "road" ? { x: m.player.x, y: m.player.y } : { x: 0, y: 0 };
      change = { ...change, added: [...m.actors.keys()], buildings: true, lights: true, signs: true };
      this.buildings.invalidate();
      this.lights.clear();
      this.ground.dirty = true;
      this.target.set(m.player.x - this.ctx.origin.x + 0.5, 0, m.player.y - this.ctx.origin.y + 0.5);
    } else if (m.map.kind === "road" && me && (Math.abs(me.x - this.ctx.origin.x) > 2500 || Math.abs(me.y - this.ctx.origin.y) > 2500)) {
      // Far from the origin: move it, and everything with it.
      const dx = me.x - this.ctx.origin.x;
      const dy = me.y - this.ctx.origin.y;
      this.ctx.origin = { x: me.x, y: me.y };
      this.target.x -= dx;
      this.target.z -= dy;
      for (const a of this.actors.values()) a.goTo(a.data, true);
      change = { ...change, buildings: true, lights: true, signs: true };
      this.buildings.invalidate();
      this.ground.dirty = true;
    }
    if (change.patches.length > 0) this.ground.dirty = true;
    for (const id of change.removed) {
      const a = this.actors.get(id);
      if (!a) continue;
      this.actors.delete(id);
      this.dropBubble(id);
      this.overlay.dropName(id);
      a.fadeOut(() => a.destroy());
      this.fading.add(a);
    }
    for (const id of change.added) {
      const data = m.actors.get(id);
      if (!data) continue;
      this.actors.get(id)?.destroy();
      const a = new IsoActor(this.ctx, data);
      this.actors.set(id, a);
      if (id !== "player") a.fadeIn();
    }
    for (const id of [...change.updated, ...change.moved]) {
      const data = m.actors.get(id);
      const a = this.actors.get(id);
      if (!data || !a) continue;
      a.set(data);
      a.goTo(data);
    }
    if (change.buildings && this.buildings.draw(m.buildings)) {
      this.ground.dressedDoors = this.buildings.doors;
      this.ground.dirty = true;
      change = { ...change, lights: true };
      this.overlay.setPlaces(this.buildings.labels.map((l) => ({ id: `b${l.id}`, text: l.text, cls: "iso-place", anchor: () => l })));
    }
    if (change.signs) this.drawSigns();
    if (change.marks || change.whole || change.buildings) {
      this.marks.draw(m.marks);
      this.atmosphere.setChimneys(this.buildings.smoke);
    }
    this.lights.setAmbience(m.ambience);
    this.atmosphere.setAmbience(m.ambience);
    if (change.lights) this.buildings.setLights(m.lights);
    this.lights.setLights(m.lights, m.player);
    if (f?.chatter?.length) this.showChatter(f.chatter);
    for (const g of f?.gossip ?? []) this.say(g.who, g.text, 0, 5200, false);
    this.labels();
  }

  /** Actors fading out after they left the frame (drawn until they're gone). */
  private fading = new Set<IsoActor>();

  private drawSigns(): void {
    const m = this.core.frame;
    this.overlay.setPlaces(
      m.signs.map((s) => {
        const x = s.x - this.ctx.origin.x + 0.5;
        const z = s.y - this.ctx.origin.y + 0.5;
        const up = s.kind === "exit" ? 0.4 : 1.6;
        return { id: s.id, text: s.text, cls: s.kind === "exit" ? "iso-sign exit" : "iso-sign", anchor: () => ({ x, y: this.ctx.height.scene(x, z) + up, z }) };
      }),
      "signs",
    );
  }

  /** Who shows a name: as the flat view (the player, NPCs, the prompt's target, the nearest townsfolk, the one pointed at). */
  private labels(): void {
    const m = this.core.frame;
    const target = m.prompt?.target ?? null;
    const me = m.player;
    const folk: IsoActor[] = [];
    for (const a of this.actors.values()) {
      const d = a.data;
      const hl = d.id === target;
      if (d.kind === "folk") {
        folk.push(a);
        this.nameOf(a, null, false);
      } else if (d.kind === "traveller") this.nameOf(a, hl || Math.hypot(d.x - me.x, d.y - me.y) <= 8 ? d.label : (d.shortLabel ?? null), hl);
      else if (d.kind === "creature") this.nameOf(a, hl || d.flags.includes("engaged") ? d.label : (d.shortLabel ?? null), hl);
      else this.nameOf(a, d.label, hl || d.kind === "player");
    }
    const near = nearestShown(folk.map((a) => ({ shown: true, x: a.data.x, y: a.data.y })), me, FOLK_LABEL_RANGE, FOLK_LABELS).map((i) => folk[i]!);
    const pointed = this.hoverTile ? m.actorAt(this.hoverTile.x, this.hoverTile.y) : undefined;
    for (const a of folk) if (near.includes(a) || a.data.id === pointed?.id || a.data.id === target) this.nameOf(a, a.data.label, a.data.id === target);
  }

  private nameOf(a: IsoActor, text: string | null, hl: boolean): void {
    const d = a.data;
    const cls = [d.kind === "folk" ? "folk" : "", hl ? "hl" : d.flags.includes("noble") ? "noble" : d.flags.includes("lowborn") ? "lowborn" : ""].join(" ").trim();
    this.overlay.name(d.id, text, cls, () => a.head(), d.kind === "player" ? 16 : 2);
  }

  // ---------- speech, chatter and events ----------

  speech(npc: string, text: string | null, opts: { done?: boolean; filler?: boolean } = {}): void {
    const a = this.ready ? this.actors.get(npc) : undefined;
    if (!a) return;
    let b = this.bubbles.get(npc);
    if (!b) {
      b = this.overlay.bubble();
      b.anchor = () => a.head();
      b.lift = 14;
      this.bubbles.set(npc, b);
    }
    b.show(text, { done: opts.done, italic: opts.filler });
  }

  private dropBubble(id: string): void {
    const b = this.bubbles.get(id);
    if (!b) return;
    this.overlay.dropBubble(b);
    this.bubbles.delete(id);
  }

  private say(who: string, line: string, lift: number, ms: number, hot: boolean): void {
    const a = this.actors.get(who);
    if (!a) return;
    const b = this.chatter.find((x) => !x.visible) ?? this.chatter[0]!;
    b.lift = 14 + lift;
    b.anchor = () => (this.actors.get(who) ? a.head() : null);
    b.who = who;
    b.show(line.length > 70 ? `${line.slice(0, 68)}…` : line, { ms, hot });
  }

  private showChatter(list: NonNullable<Frame["chatter"]>): void {
    for (const c of list) {
      this.say(c.a, c.lines[0], 0, 3200, c.hot);
      setTimeout(() => this.say(c.b, c.lines[1], 22, 3000, c.hot), 1500);
      if (c.bow) this.emote(c.a, "🙇", 14);
      else if (c.hot) this.emote(c.a, "💢", 14);
    }
  }

  private anchorOf(who: string): (() => { x: number; y: number; z: number }) | null {
    const a = this.actors.get(who);
    if (!a) return null;
    const p = a.head();
    return () => p;
  }

  private float(who: string, text: string, color: string, dy = 0): void {
    const anchor = this.anchorOf(who);
    if (anchor) this.overlay.float(text, color, anchor, dy);
  }

  private emote(who: string, symbol: string, size = 18): void {
    const anchor = this.anchorOf(who);
    if (anchor) this.overlay.emote(symbol, size, anchor);
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
        const by = this.actors.get(e.by);
        const target = this.actors.get(e.target);
        if (by && target) by.lunge({ x: target.mesh.position.x, z: target.mesh.position.z });
        if (target && e.hit) {
          target.flash();
          if (e.target === "player") this.shake = { until: performance.now() + 140, amount: 0.12 };
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

  private wireInput(): void {
    const c = this.canvas!;
    c.addEventListener("pointerdown", (e) => {
      const t = this.pick(e);
      if (t) this.core.send({ t: "click", x: t.x, y: t.y });
    });
    c.addEventListener("pointermove", (e) => this.hoverAt(e));
    c.addEventListener("pointerleave", () => {
      this.hover.visible = false;
      this.overlay.tip(null);
      this.hoverTile = null;
      this.labels();
    });
    c.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        this.zoom = clampZoom(this.zoom * Math.exp(-e.deltaY * 0.0015));
        this.frustum();
      },
      { passive: false },
    );
  }

  /** The tile under the pointer: a person or beast drawn there first (they stand taller than their tile), else the ground. */
  private pick(e: PointerEvent): { x: number; y: number; actor?: string } | null {
    if (!this.ready || !this.canvas) return null;
    const r = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hits = this.raycaster.intersectObjects([...this.actors.values()].map((a) => a.mesh), false);
    for (const h of hits) {
      const id = h.object.userData.actor as string | undefined;
      const d = id ? this.core.frame.actors.get(id) : undefined;
      if (d && id !== "player") return { x: d.x, y: d.y, actor: id };
    }
    // The land (it rolls, so the ray hits its mesh); off it, the plane at the player's height.
    const land = this.raycaster.intersectObject(this.ground.surface, false)[0];
    let x: number;
    let z: number;
    if (land) ({ x, z } = land.point);
    else {
      const ray = this.raycaster.ray;
      if (Math.abs(ray.direction.y) < 1e-6) return null;
      const t = (this.target.y - ray.origin.y) / ray.direction.y;
      x = ray.origin.x + ray.direction.x * t;
      z = ray.origin.z + ray.direction.z * t;
    }
    return { x: Math.floor(x) + this.ctx.origin.x, y: Math.floor(z) + this.ctx.origin.y };
  }

  private hoverAt(e: PointerEvent): void {
    const t = this.pick(e);
    this.overlay.tip(null);
    this.hover.visible = false;
    if (!t) return;
    const m = this.core.frame;
    const was = this.hoverTile;
    this.hoverTile = { x: t.x, y: t.y };
    if (!was || was.x !== t.x || was.y !== t.y) this.labels();
    const who = t.actor ? m.actors.get(t.actor) : m.actorAt(t.x, t.y);
    const tile = m.tileAt(t.x, t.y);
    const solid = !tile || tile.ground === "terrain/water" || (!!tile.object && tile.object !== "buildings/door" && tile.object !== "buildings/gate" && tile.object !== "buildings/stairs");
    this.canvas!.classList.toggle("on-actor", !!who);
    const tip = who?.tip ?? m.markAt(t.x, t.y)?.label ?? m.buildingAt(t.x, t.y)?.tip ?? "";
    if (tip) {
      const r = this.canvas!.getBoundingClientRect();
      this.overlay.tip(tip, e.clientX - r.left, e.clientY - r.top);
    }
    if (solid && !who) return;
    this.hover.visible = true;
    this.hover.position.set(t.x - this.ctx.origin.x, 0.03, t.y - this.ctx.origin.y);
    // The outline lies on the tile's corners.
    const H = this.ctx.height;
    const pos = this.hover.geometry.getAttribute("position") as THREE.BufferAttribute;
    [H.at(t.x + 0.05, t.y + 0.05), H.at(t.x + 0.95, t.y + 0.05), H.at(t.x + 0.95, t.y + 0.95), H.at(t.x + 0.05, t.y + 0.95)].forEach((h, k) => pos.setY(k, h));
    pos.needsUpdate = true;
    (this.hover.material as THREE.LineBasicMaterial).color.setHex(who ? 0xffd27a : 0xffffff);
  }

  // ---------- each frame ----------

  private tick(): void {
    const now = performance.now();
    const delta = Math.min(100, now - this.last);
    this.last = now;
    this.frames++;
    if (now - this.fpsAt >= 1000) {
      this.loopFps = (this.frames * 1000) / (now - this.fpsAt);
      this.frames = 0;
      this.fpsAt = now;
    }
    this.fps?.update(now, delta, this.loopFps);
    // The camera's turn eases to its quarter, by the shorter way round.
    const want = yawOf(this.turn);
    const k = Math.min(1, (now - this.turnAt) / TURN_MS);
    let diff = want - this.turnFrom;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    this.ctx.yaw = k >= 1 ? want : this.turnFrom + diff * (1 - (1 - k) ** 3);
    const me = this.actors.get("player");
    const boxes = this.buildings.boxes;
    for (const a of this.actors.values()) a.update(delta, now, boxes);
    for (const a of this.fading) {
      a.update(delta, now, boxes);
      if (a.opacity <= 0.001) this.fading.delete(a);
    }
    if (me) {
      const f = 1 - Math.exp(-delta / 110);
      this.target.x += (me.x - this.target.x) * f;
      this.target.z += (me.z - this.target.z) * f;
      this.target.y += (this.ctx.height.scene(this.target.x, this.target.z) - this.target.y) * f;
    }
    const off = cameraOffset(this.ctx.yaw);
    const s = now < this.shake.until ? this.shake.amount : 0;
    this.camera.position.set(this.target.x + off.x + (Math.random() - 0.5) * s, this.target.y + off.y, this.target.z + off.z + (Math.random() - 0.5) * s);
    this.camera.lookAt(this.target.x, this.target.y, this.target.z);
    const m = this.core.frame;
    if (m.map) {
      this.ground.draw(Math.round(this.target.x - 0.5) + this.ctx.origin.x, Math.round(this.target.z - 0.5) + this.ctx.origin.y, now);
      this.ground.update();
      this.buildings.update(me ? { x: me.x, y: me.mesh.position.y, z: me.z } : null, delta);
    }
    this.lights.update(now, delta, this.target);
    this.atmosphere.update(now, delta, this.target, this.lights.ambientColor);
    this.drawPrompt();
    this.drawFightClock();
    this.atmosphere.composer.render(delta / 1000);
    const w = this.parent.clientWidth;
    const h = this.parent.clientHeight;
    const v = new THREE.Vector3();
    this.overlay.update((p) => {
      v.set(p.x, p.y, p.z).project(this.camera);
      return { x: ((v.x + 1) / 2) * w, y: ((1 - v.y) / 2) * h };
    }, now);
  }

  private drawPrompt(): void {
    const p = this.core.frame.prompt;
    const a = p ? this.actors.get(p.target) : undefined;
    this.overlay.setPrompt(p && a ? p.text : null, p?.tone ?? "talk", a ? () => ({ x: a.mesh.position.x, y: a.mesh.position.y, z: a.mesh.position.z }) : null);
  }

  private drawFightClock(): void {
    const f = this.core.frame.fight;
    const me = this.actors.get("player");
    if (!f || !me || this.core.ui?.header.busy) return this.overlay.setClock(null, "", null);
    const left = Math.max(0, f.secondsLeft - (performance.now() - f.at) / 1000);
    this.overlay.setClock(left / Math.max(0.1, f.tick), `your move: ${Math.ceil(left)}s`, () => ({ x: me.mesh.position.x, y: me.mesh.position.y, z: me.mesh.position.z }));
  }
}

/** Start the 2.5D view in `parent`, drawing what `core` holds. */
export function startIso(parent: HTMLElement, core: Core): WorldView {
  return new IsoWorld(parent, core);
}
