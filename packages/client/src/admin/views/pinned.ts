import type { AdminCard, AdminClock, AdminPlayerView } from "@millbrook/shared";
import { el, emptyP } from "../../dom";
import { api } from "../api";
import { renderCard } from "../card";
import { FollowView } from "../follow";
import { nav } from "../nav";
import { pins } from "../pins";
import type { View } from "./types";

/**
 * Pinned: the people and places the administrator follows, and whoever was just opened.
 * A card for each, refreshed as the game runs; the player's pin adds a table of who
 * believes what; a townsperson can be followed on their town's map.
 */
export class PinnedView implements View {
  readonly el = el("section", { className: "view pinned" });
  private readonly chips = el("div", { className: "chips" });
  private readonly body = el("div", { className: "pinned-body" });
  private readonly follow = new FollowView();
  private current: string | null = null;
  private busy = false;
  private clock: AdminClock | null = null;
  private lastDay = -1;

  constructor() {
    const split = el("div", { className: "split" });
    const main = el("div", { className: "col" });
    main.append(this.follow.el, this.body);
    split.append(this.chips, main);
    this.el.append(split);
    pins.onChange(() => {
      if (this.current && !pins.has(this.current) && !this.opened.has(this.current)) this.current = pins.list()[0] ?? null;
      this.drawChips();
      void this.load();
    });
    this.drawChips();
  }

  /** Refs opened without being pinned stay in the list until the page is closed. */
  private readonly opened = new Set<string>();

  open(ref: string): void {
    this.opened.add(ref);
    this.current = ref;
    this.follow.follow(null);
    this.drawChips();
    void this.load();
  }

  async refresh(clock: AdminClock): Promise<void> {
    this.clock = clock;
    if (!this.current && pins.list().length > 0) this.current = pins.list()[0]!;
    // Pins from an earlier visit are shown by name, not id.
    const unnamed = pins.list().filter((r) => !this.names.has(r));
    if (unnamed.length > 0) {
      const got = await api.pinned(unnamed).catch(() => null);
      for (const c of got?.cards ?? []) this.names.set(c.ref, c.name);
      for (const r of got?.missing ?? []) this.names.set(r, `${r} (gone)`);
      this.drawChips();
    }
    // Cards are cheap to ask for but not to draw; once a game hour is enough.
    if (this.current && (clock.day !== this.lastDay || this.lastHour !== clock.hour)) await this.load();
    await this.follow.draw(clock);
  }
  private lastHour = -1;

  private drawChips(): void {
    this.chips.replaceChildren(el("h3", { textContent: "Pinned" }));
    const refs = [...new Set([...pins.list(), ...this.opened])];
    if (refs.length === 0) this.chips.append(emptyP("Nothing pinned yet. Search for someone, or click a place on the map, then Pin."));
    for (const ref of refs) {
      const b = el("button", { className: `chip-btn${ref === this.current ? " on" : ""}`, type: "button", textContent: ref === "player" ? "The player" : ref.replace(/^[a-z]+:/, ""), title: ref });
      b.addEventListener("click", () => {
        this.current = ref;
        this.follow.follow(null);
        this.drawChips();
        void this.load();
      });
      this.chips.append(b);
      this.names.get(ref) && (b.textContent = this.names.get(ref)!);
      const x = el("button", { className: "x", textContent: "×", type: "button", title: "Unpin / close" });
      x.addEventListener("click", () => {
        this.opened.delete(ref);
        pins.remove(ref);
        if (this.current === ref) this.current = refs.find((r) => r !== ref) ?? null;
        this.drawChips();
        void this.load();
      });
      this.chips.append(x);
    }
  }
  private readonly names = new Map<string, string>();

  private async load(): Promise<void> {
    if (this.busy) return;
    const ref = this.current;
    if (!ref) {
      this.body.replaceChildren(emptyP("Pick someone from the list, or search."));
      return;
    }
    this.busy = true;
    try {
      const card = await api.card(ref);
      this.names.set(ref, card.name);
      this.lastDay = this.clock?.day ?? -1;
      this.lastHour = this.clock?.hour ?? -1;
      this.drawChips();
      const view = ref === "player" ? await api.player() : null;
      if (this.current !== ref) return;
      this.draw(card, view);
    } catch (err) {
      this.body.replaceChildren(emptyP(`Couldn't load ${ref}: ${(err as Error).message}`));
    } finally {
      this.busy = false;
    }
  }

  private draw(card: AdminCard, view: AdminPlayerView | null): void {
    this.body.replaceChildren(
      renderCard(card, {
        nowHour: this.clock?.hour ?? 0,
        following: this.follow.following,
        onFollow: (c) => {
          this.follow.follow(this.follow.following ? null : (c.follow ?? null));
          this.draw(card, view);
          if (this.clock) void this.follow.draw(this.clock);
        },
      }),
    );
    if (view) this.body.append(this.believers(view));
  }

  private believers(v: AdminPlayerView): HTMLElement {
    const box = el("article", { className: "card" });
    box.append(el("h2", { textContent: "Who believes what about the player" }));
    if (v.beliefs.length === 0) box.append(emptyP("No rumours about the player are going round."));
    for (const b of v.beliefs) {
      const d = el("details", { className: "section" });
      d.open = true;
      d.append(el("summary", { textContent: `"${b.text}" (${b.truth}; first heard day ${b.firstHeard}; ${b.holders.length} know it)` }));
      const t = el("table", { className: "rows" });
      for (const h of b.holders) {
        const tr = el("tr");
        const who = el("td");
        const link = el("button", { className: "link", textContent: h.name, type: "button" });
        link.addEventListener("click", () => nav.openCard(h.ref));
        who.append(link);
        tr.append(who, el("td", { textContent: `${Math.round(h.accuracy * 100)}% sure` }), el("td", { className: "muted", textContent: `${h.heardFrom ? `from ${h.heardFrom}` : "first hand"}, day ${h.day}` }));
        t.append(tr);
      }
      d.append(t);
      box.append(d);
    }
    box.append(el("h3", { textContent: "What each of them feels" }));
    const t = el("table", { className: "grid" });
    const head = el("tr");
    for (const h of ["Who", "Trust", "Fear", "Respect", "Affection", "Grudge or goal", "Owed"]) head.append(el("th", { textContent: h }));
    t.append(head);
    for (const o of v.opinions.slice(0, 40)) {
      const tr = el("tr");
      const who = el("td");
      const link = el("button", { className: "link", textContent: o.name, type: "button" });
      link.addEventListener("click", () => nav.openCard(o.ref));
      who.append(link);
      tr.append(who, ...[o.trust, o.fear, o.respect, o.affection].map((n) => el("td", { className: "num", textContent: String(Math.round(n)) })), el("td", { textContent: [o.grudge ? `grudge: ${o.grudge}` : "", ...o.goals].filter(Boolean).join("; ") }), el("td", { textContent: o.owes.join("; ") }));
      t.append(tr);
    }
    box.append(t);
    return box;
  }
}
