/**
 * A view session (G5): one per save, whichever socket is attached. It holds what a view needs that isn't the game
 * (the feed, the chat logs, open dialogs, prompts, the walk and the clocks) and turns intents into the game's own
 * calls. Nothing here is saved except the time-flow switch: a reconnect rebuilds the screen from the game and this.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { cumulative, findPath, isSolidGround, project, resample, shortestWay, tileDistance, type GameEvent, type NpcVoice, type Snapshot, type StreamEvent, type Tile } from "@millbrook/shared";
import { PROTOCOL_VERSION, type Frame, type Intent, type ServerMsg } from "@millbrook/shared/view";
import { groundAt } from "../game/road/ground.js";
import { boxOf, buildFrame, CrowdClock, diffFrame, gossipBubble, nearOf, pickChatter, SentFrame, solidOf, travellersNow } from "./frame.js";
import type { ViewHost } from "./host.js";
import { formatMoney as formatCoins } from "../game/money.js";
import { buildUi, diffUi, SPEEDS, type FeedLine, type Speed, type UiState } from "./ui.js";

export interface Sock {
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Actions that start no reply from the NPC (no "…" bubble while they run). */
const NO_REPLY = ["open", "look", "wait", "turnin", "loot"];
const STEP_MS = 100;
const CHECK = process.env.VIEW_CHECK === "1";

/** Why time can't pass now (the server won't wait mid-fight), or null. */
export function heldBy(s: Snapshot): string | null {
  if (s.engaged || s.creatures.some((c) => c.engaged)) return "you're in a fight";
  const fighter = s.npcs.find((n) => n.inCombat && !n.dead);
  return fighter ? `${fighter.name} is in a fight` : null;
}

export class ViewSession {
  private socket: Sock | null = null;
  readonly id = Math.random().toString(36).slice(2, 10);
  private view = { w: 26, h: 18 };
  private hidden = false;
  private sent = new SentFrame();
  private sentUi = new Map<string, string>();
  private seq = 0;
  private crowd = new CrowdClock();
  private st: UiState;
  private feedId = 0;
  private pendingFeed: FeedLine[] = [];
  private lastNewsId: number | null = null;
  private prompts = new Map<string, { handle: (option: string) => void | Promise<void> }>();
  private promptSeq = 0;
  private walkToken = 0;
  private walking = false;
  private moving = false;
  private chatMinute = -1;
  private lastTold: number | null = null;
  private realmKey = "";
  private last: Snapshot | null = null;
  private lastTick = Date.now(); // real time, not simulation: the time-flow clock
  private lastLlmCheck = Date.now();
  private simRun = 0;
  /** The NPC whose reply is streaming, and its log entry. */
  private bubble: { npc: string; entry: { kind: string; text: string } } | null = null;
  private pushing = false;
  private pushAgain = false;
  private timer: ReturnType<typeof setInterval>;
  /** Every message sent, for `npm run frames:record`. */
  recorder: ((msg: ServerMsg) => void) | null = null;

  constructor(private readonly host: ViewHost) {
    this.st = { talking: null, logs: {}, feed: [], modal: null, realmSelected: null, timeFlows: this.loadTimeFlows(), simulate: { speed: "normal", running: false, note: null }, busy: false, traveller: null, crowd: this.crowd, realm: null };
    host.onNews(() => void this.push());
    this.timer = setInterval(() => void this.clocks(), 250);
  }

  // ---------- the socket ----------

  /** A client said hello: it takes the session over (an older socket is told it was replaced). */
  attach(socket: Sock, view: { w: number; h: number }): void {
    if (this.socket && this.socket !== socket) {
      this.sendTo(this.socket, { t: "replaced" });
      this.socket.close(4000, "replaced");
    }
    this.socket = socket;
    this.view = { w: clamp(view.w, 8, 80), h: clamp(view.h, 6, 60) };
    this.hidden = false;
    this.send({ t: "hello", version: PROTOCOL_VERSION, session: this.id });
    this.sent.reset();
    this.sentUi.clear();
    this.pendingFeed = [];
    if (this.st.feed.length === 0) {
      const s = this.host.snapshot();
      this.feed(`You're in ${s.site.name}. Walk up to anyone and press E to talk.`);
      this.pendingFeed = [];
    }
    void this.push(undefined, true);
  }

  detach(socket: Sock): void {
    if (this.socket !== socket) return;
    this.socket = null;
    this.cancelWalk();
    this.stopSim();
  }

  get attached(): boolean {
    return this.socket !== null;
  }

  dispose(): void {
    clearInterval(this.timer);
  }

  private send(msg: ServerMsg): void {
    this.recorder?.(msg);
    if (this.socket) this.sendTo(this.socket, msg);
  }

  private sendTo(socket: Sock, msg: ServerMsg): void {
    try {
      socket.send(JSON.stringify(msg));
    } catch {
      // a closed socket: the client will reconnect
    }
  }

  // ---------- what the screen shows ----------

  /** The game now, as frame and panel changes (whole when `whole`). */
  async push(state?: Snapshot, whole = false): Promise<void> {
    if (this.pushing) {
      this.pushAgain = true;
      return;
    }
    this.pushing = true;
    try {
      const s = state ?? this.host.snapshot();
      this.last = s;
      this.takeNews(s);
      const before = CHECK ? this.host.worldHash() : "";
      this.buildAndSend(s, whole);
      if (CHECK && this.host.worldHash() !== before) {
        console.error("VIEW_CHECK: building the view changed the game");
        this.send({ t: "error", text: "VIEW_CHECK: building the view changed the game." });
      }
    } finally {
      this.pushing = false;
    }
    if (this.pushAgain) {
      this.pushAgain = false;
      await this.push();
    }
  }

  private buildAndSend(s: Snapshot, whole: boolean): void {
    if (!this.socket && !this.recorder) return;
    if (s.realm && this.realmKey !== `${s.realm.day}:${s.site.id}`) {
      this.realmKey = `${s.realm.day}:${s.site.id}`;
      this.st.realm = this.host.realm();
    }
    const solid = solidOf(s, s.road ? this.host.land() : null);
    // The crowd's conversations (every third minute) and fresh gossip (N33), picked for this box.
    const sim = s.road ? null : this.host.crowd();
    this.crowd.at(s, sim);
    const minute = (s.time.day - 1) * 1440 + s.time.hour * 60 + s.time.minute;
    let chatter: Frame["chatter"] = [];
    if (minute !== this.chatMinute && minute % 3 === 0) chatter = pickChatter(s, this.crowd, boxOf(s, this.view));
    this.chatMinute = minute;
    const told = s.crowd?.told ?? [];
    if (this.lastTold === null) this.lastTold = Math.max(0, ...told.map((t) => t.seq));
    const gossip = told.filter((t) => t.seq > this.lastTold!).map((t) => ({ who: t.who, text: gossipBubble(t.text) }));
    if (gossip.length) this.lastTold = Math.max(...told.map((t) => t.seq));
    const full = buildFrame({ s, host: this.host, crowd: this.crowd, view: this.view, talking: this.st.talking, hasPatch: (k) => this.sent.patches.has(k), chatter, gossip });
    const d = diffFrame(this.sent, full, solid);
    if (!d.empty || whole) this.send({ t: "frame", seq: ++this.seq, whole: d.whole || whole, frame: d.frame });
    // The traveller in reach, for the road bar's offers.
    this.st.traveller = s.road ? (travellersNow(this.host, s, 6).sort((a, b) => tileDistance(s.position, a) - tileDistance(s.position, b))[0] ?? null) : null;
    const ui = diffUi(this.sentUi, buildUi(s, this.st), whole);
    if (ui) this.send({ t: "ui", ui });
    this.flushFeed();
  }

  private flushFeed(): void {
    if (this.pendingFeed.length === 0) return;
    this.send({ t: "feed", lines: this.pendingFeed });
    this.pendingFeed = [];
  }

  feed(text: string, kind = "line"): void {
    const line = { id: ++this.feedId, kind, text };
    this.st.feed.push(line);
    if (this.st.feed.length > 200) this.st.feed.shift();
    this.pendingFeed.push(line);
  }

  /** A note in the open chat (or the feed with no chat). */
  private note(kind: string, text: string, npc: string | null | undefined = this.st.talking): void {
    if (!npc) return this.feed(text, kind);
    (this.st.logs[npc] ??= []).push({ kind: `note ${kind}`, text });
  }

  /** News from outside a request (the combat clock, the chronicle): shown once. */
  private takeNews(s: Snapshot): void {
    if (this.lastNewsId === null) {
      this.lastNewsId = s.news.at(-1)?.id ?? 0;
      return;
    }
    for (const ev of s.news) {
      if (ev.id <= this.lastNewsId) continue;
      this.lastNewsId = ev.id;
      this.stream(ev, ev.npc ?? null);
    }
  }

  private voiceOf(npc: string): NpcVoice | null {
    return this.last?.npcs.find((n) => n.id === npc)?.voice ?? null;
  }

  private endBubble(): void {
    const b = this.bubble;
    if (!b) return;
    this.bubble = null;
    this.send({ t: "speech", npc: b.npc, voice: this.voiceOf(b.npc) as Record<string, unknown> | null, done: true });
  }

  /** One event of an action's stream, to the chat, the feed, the voices and the screen. */
  private stream(ev: StreamEvent, npcId: string | null): void {
    if (this.bubble && ev.t !== "text" && ev.t !== "done" && ev.t !== "event") this.endBubble();
    switch (ev.t) {
      case "text": {
        const log = this.st.talking ?? ev.npc;
        if (this.bubble && this.bubble.npc !== ev.npc) this.endBubble();
        if (!this.bubble) {
          const other = ev.npc !== log ? this.last?.npcs.find((n) => n.id === ev.npc)?.name : null;
          const entry = { kind: other ? "npc other" : "npc", text: other ? `${other}: ` : "" };
          (this.st.logs[log] ??= []).push(entry);
          this.bubble = { npc: ev.npc, entry };
        }
        this.bubble.entry.text += ev.delta;
        this.send({ t: "speech", npc: ev.npc, voice: this.voiceOf(ev.npc) as Record<string, unknown> | null, delta: ev.delta });
        return;
      }
      case "filler":
        (this.st.logs[this.st.talking ?? ev.npc] ??= []).push({ kind: "npc filler", text: ev.text });
        this.send({ t: "speech", npc: ev.npc, voice: this.voiceOf(ev.npc) as Record<string, unknown> | null, filler: ev.text });
        return;
      case "queued":
        return this.note("system", ev.position === 1 ? "Waiting for the last thing to finish…" : `Waiting in line (${ev.position} ahead)…`, npcId);
      case "event":
        return this.send({ t: "event", event: ev.event as unknown as Record<string, unknown> });
      case "note":
        return this.note(ev.kind, ev.text, npcId);
      case "system":
        this.note("system", ev.text, npcId);
        if (npcId) this.feed(ev.text, "system");
        return;
      case "error":
        return this.note("fail", ev.text, npcId);
      case "ended":
        this.note("end", ev.text, ev.npc);
        this.feed(ev.text, "end");
        if (this.st.talking === ev.npc) this.st.talking = null;
        return;
      case "quote":
        if (ev.kind === "commission" && ev.ok && ev.item && this.st.talking) {
          const npc = this.st.talking;
          const item = ev.item;
          this.ask("Order", ev.text, [{ id: "yes", label: "Order and pay the deposit" }, { id: "no", label: "Not now" }], (o) => (o === "yes" ? this.runAct({ action: "commission", npc, item, confirm: true }) : undefined));
        } else if (ev.kind === "commission") this.note(ev.ok ? "action" : "fail", ev.text, npcId);
        return;
      case "opened":
      case "done":
        return;
    }
  }

  // ---------- prompts ----------

  private ask(title: string, body: string, options: Array<{ id: string; label: string }>, handle: (option: string) => void | Promise<void>): void {
    const id = `p${++this.promptSeq}`;
    this.prompts.set(id, { handle });
    this.send({ t: "prompt", id, title, body, options });
  }

  // ---------- intents ----------

  async intent(i: Intent): Promise<void> {
    // Moving or clicking hands control back from Simulate mode.
    if (this.st.simulate.running && ["step", "moveTo", "click", "interact", "fight", "flee", "say", "act"].includes(i.t)) this.stopSim("You take over.");
    // Any other intent stops a walk.
    if (i.t !== "view" && i.t !== "answer") this.cancelWalk();
    switch (i.t) {
      case "hello":
        return;
      case "view":
        if (i.w && i.h) this.view = { w: clamp(i.w, 8, 80), h: clamp(i.h, 6, 60) };
        if (i.hidden !== undefined) this.hidden = i.hidden;
        return this.push();
      case "step":
        await this.step(i.dx, i.dy);
        return;
      case "moveTo":
        return this.click(i.x, i.y, true);
      case "click":
        return this.click(i.x, i.y, false);
      case "interact": {
        const s = this.snap();
        const n = nearOf(s, this.crowd, travellersNow(this.host, s, 20)).talker;
        if (n) await this.openChat(n.id);
        return;
      }
      case "fight": {
        if (this.st.talking) return;
        const s = this.snap();
        const prey = nearOf(s, this.crowd, []).prey;
        if (prey) await this.runAct({ action: "hunt", creature: prey.uid });
        return;
      }
      case "flee": {
        if (this.st.talking) return;
        const c = this.snap().creatures.find((x) => x.engaged);
        if (c) await this.runAct({ action: "escape", creature: c.uid });
        return;
      }
      case "say":
        return this.say(i.mode, i.text);
      case "act":
        return this.act(i.action, i.args ?? {});
      case "panel":
        this.st.modal = i.panel ? { kind: i.panel, ...(i.arg ? { arg: i.arg } : {}) } : null;
        return this.push();
      case "select":
        if (i.what === "realm") this.st.realmSelected = i.id;
        return this.push();
      case "close":
        this.st.talking = null;
        this.st.modal = null;
        return this.push();
      case "answer": {
        const p = this.prompts.get(i.prompt);
        this.prompts.delete(i.prompt);
        if (p) await p.handle(i.option);
        return;
      }
      case "time":
        this.st.timeFlows = i.flow;
        this.saveTimeFlows();
        this.lastTick = Date.now();
        return this.push();
      case "simulate":
        if (i.speed === "off") this.stopSim("Simulate mode off.");
        else {
          this.st.simulate.speed = i.speed;
          this.startSim();
        }
        return this.push();
      case "cancel":
        this.stopSim();
        this.st.modal = null;
        return this.push();
      case "newGame":
        return this.ask("New game", "Start a new game? This overwrites your save. NPC deaths stay permanent.", [{ id: "yes", label: "Start again" }, { id: "no", label: "Keep playing" }], async (o) => {
          if (o !== "yes") return;
          await this.host.newGame();
          this.st.logs = {};
          this.st.feed = [];
          this.st.talking = null;
          this.st.modal = null;
          this.lastNewsId = null;
          this.lastTold = null;
          this.sent.reset();
          this.sentUi.clear();
          this.feed(`A new game. You're in ${this.host.snapshot().site.name}.`);
          this.pendingFeed = [];
          await this.push(undefined, true);
        });
    }
  }

  private snap(): Snapshot {
    return (this.last ??= this.host.snapshot());
  }

  /** Actions with a step of their own before the game's: quotes and confirms. */
  private async act(action: string, args: Record<string, unknown>): Promise<void> {
    if (action !== "situation") this.st.modal = null;
    switch (action) {
      case "walk":
        return void this.autoWalk();
      case "trainquote": {
        const q = this.host.quoteTraining(String(args.npc ?? ""), String(args.skill ?? ""), Number(args.hours ?? 2));
        if (!q.ok) {
          this.note("fail", q.message);
          return this.push();
        }
        await this.push();
        return this.ask("Training", `${q.message} You have ${formatCoins(q.money)}.`, [{ id: "yes", label: "Pay and train" }, { id: "no", label: "Back" }], (o) => {
          if (o === "yes") return this.runAct({ action: "train", npc: args.npc, skill: args.skill, hours: q.hours });
          this.st.modal = { kind: "train" };
          return this.push();
        });
      }
      case "coachquote": {
        const q = this.host.quoteCoach(String(args.to ?? ""));
        if (!q.ok) {
          this.feed(q.message, "fail");
          return this.push();
        }
        return this.ask("The coach", `${q.message} Take it?`, [{ id: "yes", label: "Take the coach" }, { id: "no", label: "Not now" }], (o) => (o === "yes" ? this.runAct({ action: "coach", to: args.to }) : undefined));
      }
      case "robask":
        return this.ask("Rob the caravan", "Rob this caravan? It is a crime, and its guards will fight you.", [{ id: "yes", label: "Rob them" }, { id: "no", label: "Leave them be" }], (o) => (o === "yes" ? this.runAct({ action: "rob", journey: args.journey }) : undefined));
    }
    await this.runAct({ action, ...args });
    // Bound for somewhere (N26): the player is on the road now; walk it for them until something happens.
    if (action === "travel" && this.last?.road?.dest) void this.autoWalk();
  }

  private async say(mode: string, text: string): Promise<void> {
    // A line said while the last reply is still coming waits its turn (up to half a minute) rather than being lost.
    for (let waited = 0; this.st.busy && waited < 30_000; waited += 50) await sleep(50);
    const npc = this.st.talking;
    if (!npc || this.st.busy) return;
    const trimmed = text.trim();
    if (mode === "say" && !trimmed) return;
    (this.st.logs[npc] ??= []).push({ kind: "you", text: mode === "say" ? trimmed : `(${mode}) ${trimmed || "…"}` });
    return this.runAct({ action: mode, text: trimmed, npc });
  }

  /** An action, streamed: what comes back goes to the chat, the feed, the voices and the screen. */
  async runAct(body: Record<string, unknown>, opts: { quiet?: (ev: StreamEvent) => boolean } = {}): Promise<void> {
    if (this.st.busy) return;
    this.st.busy = true;
    const talksTo = typeof body.npc === "string" ? body.npc : null;
    let final: Snapshot | undefined;
    try {
      // Hide the latency (G1): "…" at once while the model loads its first words.
      if (talksTo && this.st.talking === talksTo && !NO_REPLY.includes(String(body.action))) this.send({ t: "speech", npc: talksTo, voice: this.voiceOf(talksTo) as Record<string, unknown> | null, thinking: true });
      await this.push();
      await this.host.act(body, (ev) => {
        if (ev.t === "done") final = ev.state;
        else if (!opts.quiet?.(ev)) this.stream(ev, talksTo);
      });
    } catch (err) {
      this.note("fail", `Something went wrong: ${(err as Error).message}`, talksTo);
    } finally {
      this.endBubble();
      this.st.busy = false;
      await this.push(final);
    }
  }

  // ---------- walking ----------

  private cancelWalk(): void {
    this.walkToken++;
  }

  /** One step; what it says goes to the feed. Walking out of talking range ends the chat. */
  private async step(dx: number, dy: number): Promise<boolean> {
    if (this.moving || this.st.busy) return false;
    if (Math.abs(dx) + Math.abs(dy) !== 1) return false;
    this.moving = true;
    try {
      const r = await this.host.move(dx, dy);
      if (r.reason) this.feed(r.reason);
      for (const line of r.log) this.feed(line);
      for (const e of r.events) this.send({ t: "event", event: e as unknown as Record<string, unknown> });
      const s = r.state;
      if (this.st.talking) {
        const npc = s.npcs.find((n) => n.id === this.st.talking);
        if (npc && tileDistance(s.position, npc) > s.map.talkRange) {
          this.note("end", "You walk away.");
          this.st.talking = null;
        }
      }
      await this.push(s);
      return r.ok;
    } finally {
      this.moving = false;
    }
  }

  /** Tiles the player can't walk onto: walls and water, and anyone standing there. */
  private playerBlocked(s: Snapshot): (x: number, y: number) => boolean {
    const solid = solidOf(s, s.road ? this.host.land() : null);
    if (s.road) return solid;
    const taken = new Set([...s.npcs.filter((n) => !n.away && !n.companion).map((n) => `${n.x},${n.y}`), ...s.creatures.map((c) => `${c.x},${c.y}`)]);
    return (x, y) => solid(x, y) || taken.has(`${x},${y}`);
  }

  /**
   * Walk a path a step at a time. Someone stepping into the way refuses a step: with `goal`, the way is planned again
   * from where the player stands (a few times), as a walker would, before giving up.
   */
  private async walk(path: Tile[], then?: () => Promise<void> | void, goal?: (t: Tile) => boolean): Promise<void> {
    const token = ++this.walkToken;
    const map = this.snap().road ? "road" : this.snap().map.id;
    this.walking = true;
    let replans = 4;
    try {
      let pos = { ...this.snap().position };
      for (let i = 0; i < path.length; i++) {
        const next = path[i]!;
        if (token !== this.walkToken) return;
        while (this.moving || this.st.busy) await sleep(30);
        if (token !== this.walkToken) return;
        const began = Date.now();
        if (!(await this.step(next.x - pos.x, next.y - pos.y))) {
          const s = this.snap();
          const again = goal && replans-- > 0 ? findPath(s.position, goal, this.playerBlocked(s), 3000) : null;
          if (!again) {
            if (goal) {
              this.feed("Someone's in your way.");
              await this.push();
            }
            return;
          }
          path = again;
          i = -1;
          pos = { ...s.position };
          await sleep(STEP_MS);
          continue;
        }
        const s = this.snap();
        // Walked off the edge into the next area (N15): the rest of the route was on the old map.
        if ((s.road ? "road" : s.map.id) !== map) return;
        pos = { ...s.position };
        await sleep(Math.max(0, STEP_MS - (Date.now() - began)));
      }
      if (token === this.walkToken) await then?.();
    } finally {
      if (token === this.walkToken) this.walking = false;
    }
  }

  /** A click on the map: fight, loot (asked first), talk, or walk there. `only`: walk there and nothing else. */
  private async click(x: number, y: number, only: boolean): Promise<void> {
    if (this.st.busy) return;
    const s = this.host.snapshot();
    this.last = s;
    const range = s.map.talkRange;
    const d = (p: { x: number; y: number }) => tileDistance(s.position, p);
    const blocked = this.playerBlocked(s);
    const goTo = (goal: (t: Tile) => boolean, then?: () => Promise<void> | void, max = 3000) => {
      const path = findPath(s.position, goal, blocked, max);
      if (!path) return void this.feed("You can't find a way there.");
      void this.walk(path, then, goal);
    };
    if (only) return blocked(x, y) ? undefined : goTo((c) => c.x === x && c.y === y);
    // On the open road (N26): walk up to someone and talk, or walk to the tile.
    if (s.road) {
      const who = travellersNow(this.host, s, 40).find((t) => Math.abs(t.x - x) <= 1 && Math.abs(t.y - y) <= 1);
      if (who) return d(who) <= range ? this.openChat(who.id) : this.approach(who.id);
      if (blocked(x, y)) return;
      return goTo((c) => c.x === x && c.y === y);
    }
    const beast = s.creatures.find((c) => c.x === x && c.y === y);
    if (beast) return d(beast) <= range ? this.runAct({ action: "hunt", creature: beast.uid }) : goTo((c) => tileDistance(c, beast) <= range);
    const npc = s.npcs.find((n) => n.x === x && n.y === y && !n.away);
    if (!npc) {
      const sim = this.crowd.sim;
      const promoted = new Set(s.npcs.map((n) => n.id));
      const i = sim ? this.crowd.pos.findIndex((p, k) => p.visible && p.x === x && p.y === y && !promoted.has(sim.roster.people[k]!.id)) : -1;
      if (sim && i >= 0) {
        const id = sim.roster.people[i]!.id;
        const at = this.crowd.pos[i]!;
        // They walk on while you walk up: head for where they are, then talk if they're still in reach.
        return d(at) <= range ? this.openChat(id) : this.approach(id);
      }
    }
    if (npc) {
      if ((npc.dead || npc.unconscious) && d(npc) <= range) {
        return this.ask("Take what they carry?", `${npc.name} lies ${npc.dead ? "dead" : "out cold"}. Take what they carry? (It's a crime, if anyone sees.)`, [{ id: "yes", label: "Take it" }, { id: "no", label: "Leave it" }], (o) => (o === "yes" ? this.runAct({ action: "loot", npc: npc.id }) : undefined));
      }
      if (d(npc) <= range) return this.openChat(npc.id);
      if (npc.dead) return;
      return this.approach(npc.id);
    }
    if (blocked(x, y)) return;
    goTo((c) => c.x === x && c.y === y);
  }

  /** Where someone is now: a talker, one of the townsfolk, or a traveller on the road; null when they're not about. */
  private whereIs(s: Snapshot, id: string): { x: number; y: number } | null {
    const n = s.npcs.find((x) => x.id === id && !x.away);
    if (n) return n;
    if (s.road) return travellersNow(this.host, s, 60).find((t) => t.id === id) ?? null;
    const pos = this.crowd.at(s, this.host.crowd());
    const i = this.crowd.sim?.index.get(id);
    const at = i === undefined ? undefined : pos[i];
    return at?.visible ? at : null;
  }

  /** Walk up to someone and talk. They may walk on while the player comes: follow them a few times, then talk if in reach. */
  private approach(id: string, tries = 4): void {
    const s = this.host.snapshot();
    this.last = s;
    const at = this.whereIs(s, id);
    if (!at) return void (this.feed("They've gone from here."), this.push());
    const range = s.map.talkRange;
    if (tileDistance(s.position, at) <= range || tries <= 0) return void this.openChat(id);
    const goal = (c: Tile) => tileDistance(c, at) <= range;
    const path = findPath(s.position, goal, this.playerBlocked(s), 3000);
    if (!path) return void (this.feed("You can't find a way there."), this.push());
    void this.walk(path, () => this.approach(id, tries - 1), goal);
  }

  private async openChat(id: string): Promise<void> {
    if (this.st.busy) return;
    const s = this.host.snapshot();
    this.last = s;
    const npc = s.npcs.find((n) => n.id === id);
    if (!npc) {
      // One of the townsfolk (or a traveller), not yet a talking NPC: the server makes them one as the chat opens.
      this.st.talking = id;
      this.st.logs[id] ??= [];
      await this.runAct({ action: "open", npc: id });
      // Not made a talker, or they walked on out of reach while the player came up: no chat, the reason in the feed.
      const now = this.last?.npcs.find((n) => n.id === id);
      if (this.st.talking === id && (!now || now.away || tileDistance(this.last!.position, now) > this.last!.map.talkRange)) {
        const said = this.st.logs[id]?.at(-1);
        if (said?.kind === "note system") this.feed(said.text);
        this.st.talking = null;
        await this.push();
      }
      return;
    }
    if (npc.dead) return void (this.feed(`${npc.name} is dead.`), this.push());
    if (npc.away) return void (this.feed(npc.absent ?? `${npc.name} isn't around.`), this.push());
    if (tileDistance(s.position, npc) > s.map.talkRange) return void (this.feed(`You are too far from ${npc.name}.`), this.push());
    this.st.talking = id;
    this.st.logs[id] ??= [];
    await this.runAct({ action: "open", npc: id });
  }

  /** The line to follow from where the player stands to the gate of `dest`: along their road to the end on the shortest way, then on. */
  private routeTo(s: Snapshot, dest: string): Array<{ x: number; y: number }> | null {
    const data = this.host.roadData();
    if (!data || !s.road) return null;
    const at = s.position;
    let near: { road: (typeof data.roads)[number]; t: number; d: number } | null = null;
    for (const r of data.roads) {
      const pr = project(r.pts, cumulative(r.pts), at);
      if (pr.d < 400 && (!near || pr.d < near.d)) near = { road: r, t: pr.t, d: pr.d };
    }
    if (!near) return null;
    const r = near.road;
    if (r.id.startsWith("spur:")) return resample([...r.pts].reverse(), 10);
    const cum = cumulative(r.pts);
    const t0 = near.t;
    const tail = (reverse: boolean) => {
      const pts = r.pts.filter((_, i) => (reverse ? cum[i]! < t0 : cum[i]! > t0));
      return reverse ? pts.reverse() : pts;
    };
    let best: { out: Array<{ x: number; y: number }>; cost: number } | null = null;
    for (const [end, reverse, along] of [[r.b, false, r.length - t0], [r.a, true, t0]] as const) {
      const w = end === dest ? { path: [end], roads: [], tiles: 0 } : shortestWay(data, end, dest, (id) => id === (reverse ? r.b : r.a));
      if (!w || (best && best.cost <= along + w.tiles)) continue;
      const out = [at, ...tail(reverse)];
      for (const jr of w.roads) {
        const rr = data.roads.find((x) => x.id === jr.id)!;
        out.push(...(jr.rev ? [...rr.pts].reverse() : rr.pts));
      }
      best = { out, cost: along + w.tiles };
    }
    return best ? resample(best.out, 10) : null;
  }

  /** Walk the road toward the destination, stopping when something happens: a person, a choice, a fight, harm, arriving. */
  private async autoWalk(): Promise<void> {
    const s0 = this.host.snapshot();
    this.last = s0;
    if (!s0.road) return;
    const dest = s0.road.dest?.id;
    if (!dest) return void (this.feed("Choose where you're going first (the Realm tab, Travel here)."), this.push());
    const line = this.routeTo(s0, dest);
    const land = this.host.land();
    if (!line || !land) return void (this.feed("You can't see the way from here. Get back to the road."), this.push());
    const solid = (x: number, y: number) => isSolidGround(groundAt(land, x, y));
    const token = ++this.walkToken;
    this.walking = true;
    let i = 0;
    let hp = s0.player.hp;
    let stuck = 0;
    this.feed("You set out along the road. (Press a key or click to stop.)");
    await this.push(s0);
    try {
      while (token === this.walkToken) {
        const s = this.snap();
        if (!s.road || this.st.talking || s.fight || s.road.pending || s.player.hp < hp) break;
        hp = s.player.hp;
        const p = s.position;
        while (i < line.length - 1 && Math.hypot(line[i]!.x - p.x, line[i]!.y - p.y) < 3) i++;
        const target = line[i]!;
        const dx = target.x - p.x;
        const dy = target.y - p.y;
        if (dx === 0 && dy === 0) break;
        // A short way round trees, water and the like to the next point of the road.
        const path = findPath(p, (c) => (i === line.length - 1 ? c.x === target.x && c.y === target.y : Math.hypot(c.x - target.x, c.y - target.y) < 1.5), solid, 1500);
        const pick: [number, number] = path?.[0] ? [path[0].x - p.x, path[0].y - p.y] : Math.abs(dx) >= Math.abs(dy) ? [Math.sign(dx), 0] : [0, Math.sign(dy)];
        while (this.moving || this.st.busy) await sleep(20);
        if (token !== this.walkToken) break;
        const began = Date.now();
        const ok = await this.step(pick[0], pick[1]);
        const now = this.snap().position;
        stuck = ok && (now.x !== p.x || now.y !== p.y) ? 0 : stuck + 1;
        if (stuck > 4) break;
        await sleep(Math.max(0, STEP_MS - (Date.now() - began)));
      }
    } finally {
      if (token === this.walkToken) {
        this.walking = false;
        this.walkToken++;
      }
    }
  }

  // ---------- the clocks ----------

  private async clocks(): Promise<void> {
    if (!this.socket) return;
    const now = Date.now();
    const s = this.last;
    // Ollama may start after the server: keep checking until it's up.
    if (s && !s.llm.ready && !this.st.busy && now - this.lastLlmCheck > 15_000) {
      this.lastLlmCheck = now;
      await this.host.checkLlm();
      if (!this.st.busy) await this.push();
    }
    // Time flows while the player stands about (N16): not while talking, working, walking, simulating or fighting, nor unseen.
    const every = this.host.timeFlowSeconds * 1000;
    if (!s || !this.st.timeFlows || every <= 0 || now - this.lastTick < every) return;
    this.lastTick = now;
    if (this.st.talking || this.st.busy || this.moving || this.walking || this.st.simulate.running || heldBy(s) || s.fight || this.hidden || this.host.busy() || this.host.paused()) return;
    const r = await this.host.tick();
    if (!r || this.st.busy || this.moving) return;
    for (const line of r.log) this.feed(line);
    for (const e of r.events as GameEvent[]) this.send({ t: "event", event: e as unknown as Record<string, unknown> });
    await this.push(r.state);
  }

  /** Simulate mode: the village lives on its own while the player watches, through the same call as Wait. */
  private startSim(): void {
    if (this.st.simulate.running) return;
    this.st.simulate.running = true;
    this.st.simulate.note = null;
    const run = ++this.simRun;
    this.feed("Simulate mode: the village lives on its own. Move or click the map to take over.");
    void this.simLoop(run);
  }

  private stopSim(why?: string): void {
    if (!this.st.simulate.running) return;
    this.st.simulate.running = false;
    this.simRun++;
    if (why) this.feed(why);
  }

  private async simLoop(run: number): Promise<void> {
    while (this.st.simulate.running && run === this.simRun) {
      const s = this.last;
      if (!s || this.st.busy || this.moving) {
        await sleep(100);
        continue;
      }
      const held = heldBy(s);
      if (held) {
        // A fight plays out on the server's combat clock; its news pushes the frames.
        if (this.st.simulate.note !== `paused: ${held}`) {
          this.st.simulate.note = `paused: ${held}`;
          await this.push();
        }
        await sleep(1000);
        await this.push();
        continue;
      }
      this.st.simulate.note = null;
      const { hours, everyMs } = SPEEDS[this.st.simulate.speed as Speed];
      // Wait, as the button does, but without a "Time passes" line every step: the clock shows that.
      await this.runAct({ action: "wait", hours }, { quiet: (ev) => ev.t === "system" && ev.text.startsWith("Time passes.") });
      await sleep(everyMs);
    }
  }

  // ---------- kept per save ----------

  private loadTimeFlows(): boolean {
    try {
      return (JSON.parse(readFileSync(`${this.host.saveFile}.view.json`, "utf8")) as { timeFlows?: boolean }).timeFlows !== false;
    } catch {
      return true;
    }
  }

  private saveTimeFlows(): void {
    try {
      writeFileSync(`${this.host.saveFile}.view.json`, JSON.stringify({ timeFlows: this.st.timeFlows }));
    } catch {
      // kept for this run only
    }
  }
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(v)));
