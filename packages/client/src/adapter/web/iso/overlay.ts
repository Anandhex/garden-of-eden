/**
 * The words over the 2.5D view (G7): names, speech bubbles, the E/F prompt, the fight clock, floating numbers and
 * emotes, signs, building names and the hover tip. They are HTML over the canvas, so they stay crisp at any zoom and
 * are never lit, blurred or hidden behind a roof; each is pinned to a point in the scene, projected every frame.
 */
type P = { x: number; y: number; z: number };
type Anchor = () => P | null;
export type Project = (p: P) => { x: number; y: number };

const make = (cls: string, parent: HTMLElement, text = ""): HTMLDivElement => {
  const d = document.createElement("div");
  d.className = cls;
  d.textContent = text;
  parent.appendChild(d);
  return d;
};

interface Pinned {
  el: HTMLElement;
  anchor: Anchor;
  /** Pixels to move it up from its point. */
  lift: number;
  /** Keep it inside the view (bubbles), else it may go off the edge. */
  clamp?: boolean;
}

/** A speech bubble: what someone says as it streams, "…" while they think, or a line of the crowd's chatter. */
export class Bubble {
  readonly el: HTMLDivElement;
  private thinking = false;
  private dots = 0;
  private hideAt: number | null = null;
  who?: string;
  lift = 0;
  anchor: Anchor = () => null;

  constructor(parent: HTMLElement, small = false) {
    this.el = make(`iso-bubble${small ? " small" : ""}`, parent);
    this.el.hidden = true;
  }

  show(text: string | null, opts: { done?: boolean; italic?: boolean; hot?: boolean; ms?: number } = {}): void {
    this.el.hidden = false;
    this.el.classList.remove("gone");
    this.thinking = text === null;
    const clean = text === null ? "…" : text.replace(/\s+/g, " ").trim();
    this.el.textContent = clean.length > 110 ? `…${clean.slice(-108)}` : clean || "…";
    this.el.classList.toggle("italic", opts.italic === true || clean.startsWith("*"));
    this.el.classList.toggle("hot", opts.hot === true);
    const ms = opts.ms ?? (opts.done ? 3500 + Math.min(4000, text?.length ?? 0) * 25 : null);
    this.hideAt = ms === null ? null : performance.now() + ms;
  }

  get visible(): boolean {
    return !this.el.hidden;
  }

  tick(now: number): void {
    if (this.hideAt !== null && now >= this.hideAt) {
      this.hideAt = null;
      this.el.classList.add("gone");
      setTimeout(() => {
        if (this.el.classList.contains("gone")) this.el.hidden = true;
      }, 400);
    }
    if (!this.thinking) return;
    const dots = Math.floor(now / 350) % 4;
    if (dots !== this.dots) {
      this.dots = dots;
      this.el.textContent = ".".repeat(dots || 1);
    }
  }

  destroy(): void {
    this.el.remove();
  }
}

export class Overlay {
  readonly root: HTMLDivElement;
  private names = new Map<string, Pinned>();
  private places = new Map<string, Pinned>();
  private signs = new Map<string, Pinned>();
  private bubbles: Bubble[] = [];
  private floats: Pinned[] = [];
  private promptEl: HTMLDivElement;
  private prompt: Anchor | null = null;
  private clockEl: HTMLDivElement;
  private clockBar: HTMLDivElement;
  private clockText: HTMLDivElement;
  private clock: Anchor | null = null;
  private tipEl: HTMLDivElement;

  constructor(parent: HTMLElement) {
    this.root = make("iso-overlay", parent);
    this.promptEl = make("iso-prompt", this.root);
    this.promptEl.hidden = true;
    this.clockEl = make("iso-clock", this.root);
    this.clockBar = make("bar", make("track", this.clockEl));
    this.clockText = make("text", this.clockEl);
    this.clockEl.hidden = true;
    this.tipEl = make("iso-tip", this.root);
    this.tipEl.hidden = true;
  }

  /** Someone's name over their head (null hides it). */
  name(id: string, text: string | null, cls: string, anchor: Anchor, lift: number): void {
    let n = this.names.get(id);
    if (!text) {
      if (n) n.el.hidden = true;
      return;
    }
    if (!n) {
      n = { el: make("iso-name", this.root), anchor, lift };
      this.names.set(id, n);
    }
    n.anchor = anchor;
    n.lift = lift;
    n.el.hidden = false;
    if (n.el.textContent !== text) n.el.textContent = text;
    if (n.el.className !== `iso-name ${cls}`) n.el.className = `iso-name ${cls}`;
  }

  dropName(id: string): void {
    this.names.get(id)?.el.remove();
    this.names.delete(id);
  }

  /** Building names and signs: replaced as a set. */
  setPlaces(list: Array<{ id: string; text: string; cls: string; anchor: Anchor; lift?: number }>, which: "places" | "signs" = "places"): void {
    const map = which === "places" ? this.places : this.signs;
    const want = new Set(list.map((l) => l.id));
    for (const [id, p] of map) if (!want.has(id)) (p.el.remove(), map.delete(id));
    for (const l of list) {
      let p = map.get(l.id);
      if (!p) {
        p = { el: make(l.cls, this.root, l.text), anchor: l.anchor, lift: l.lift ?? 0 };
        map.set(l.id, p);
      }
      p.anchor = l.anchor;
      p.el.className = l.cls;
      if (p.el.textContent !== l.text) p.el.textContent = l.text;
    }
  }

  bubble(small = false): Bubble {
    const b = new Bubble(this.root, small);
    this.bubbles.push(b);
    return b;
  }

  dropBubble(b: Bubble): void {
    b.destroy();
    this.bubbles = this.bubbles.filter((x) => x !== b);
  }

  /** A word or number that floats up from someone and fades. */
  float(text: string, color: string, anchor: Anchor, dy = 0, cls = "iso-float"): void {
    const el = make(cls, this.root, text);
    el.style.color = color;
    const f: Pinned = { el, anchor, lift: 26 - dy };
    this.floats.push(f);
    el.addEventListener("animationend", () => {
      el.remove();
      this.floats = this.floats.filter((x) => x !== f);
    });
  }

  emote(symbol: string, size: number, anchor: Anchor): void {
    this.float(symbol, "", anchor, -8, "iso-emote");
    this.floats[this.floats.length - 1]!.el.style.fontSize = `${size}px`;
  }

  setPrompt(text: string | null, tone: string, anchor: Anchor | null): void {
    this.prompt = text ? anchor : null;
    this.promptEl.hidden = !this.prompt;
    if (!text) return;
    if (this.promptEl.textContent !== text) this.promptEl.textContent = text;
    this.promptEl.classList.toggle("danger", tone === "danger");
  }

  setClock(share: number | null, text: string, anchor: Anchor | null): void {
    this.clock = share === null ? null : anchor;
    this.clockEl.hidden = !this.clock;
    if (share === null) return;
    this.clockBar.style.width = `${Math.round(Math.max(0, Math.min(1, share)) * 100)}%`;
    this.clockBar.style.background = share > 0.5 ? "#7ac77a" : share > 0.2 ? "#e0b45b" : "#e0675b";
    this.clockText.textContent = text;
  }

  tip(text: string | null, x = 0, y = 0): void {
    this.tipEl.hidden = !text;
    if (!text) return;
    this.tipEl.textContent = text;
    const w = this.root.clientWidth;
    const h = this.root.clientHeight;
    this.tipEl.style.left = `${Math.min(x + 14, w - this.tipEl.offsetWidth - 4)}px`;
    this.tipEl.style.top = `${Math.min(y + 14, h - this.tipEl.offsetHeight - 4)}px`;
  }

  /** Each frame: put everything at its point. */
  update(project: Project, now: number): void {
    const w = this.root.clientWidth;
    const h = this.root.clientHeight;
    const place = (el: HTMLElement, anchor: Anchor, lift: number, clamp = false) => {
      const p = anchor();
      if (!p) return void (el.style.visibility = "hidden");
      const s = project(p);
      let x = s.x;
      let y = s.y - lift;
      if (clamp) {
        const half = el.offsetWidth / 2;
        x = Math.max(half + 2, Math.min(w - half - 2, x));
        y = Math.max(el.offsetHeight + 4, y);
      }
      el.style.visibility = x < -200 || x > w + 200 || y < -200 || y > h + 200 ? "hidden" : "visible";
      el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    };
    for (const n of this.names.values()) if (!n.el.hidden) place(n.el, n.anchor, n.lift);
    for (const p of this.places.values()) place(p.el, p.anchor, p.lift);
    for (const p of this.signs.values()) place(p.el, p.anchor, p.lift);
    for (const f of this.floats) place(f.el, f.anchor, f.lift);
    for (const b of this.bubbles) {
      b.tick(now);
      if (b.visible) place(b.el, b.anchor, 8 + b.lift, true);
    }
    if (this.prompt) place(this.promptEl, this.prompt, -6);
    if (this.clock) place(this.clockEl, this.clock, -26);
  }

  clear(): void {
    for (const n of this.names.values()) n.el.remove();
    this.names.clear();
    for (const p of [...this.places.values(), ...this.signs.values()]) p.el.remove();
    this.places.clear();
    this.signs.clear();
  }
}
