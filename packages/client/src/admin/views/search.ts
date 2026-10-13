import type { AdminClock, AdminSearchResult } from "@millbrook/shared";
import { el, emptyP } from "../../dom";
import { api } from "../api";
import { nav } from "../nav";
import { pins } from "../pins";
import type { View } from "./types";

/** Search: anyone by name, class, job, role, place or faction. Townsfolk are listed place by place, so a first search may need to ask again. */
export class SearchView implements View {
  readonly el = el("section", { className: "view search" });
  private readonly input = el("input", { type: "search", placeholder: "Name, job, class, place or faction (try: miller, serf, a place name, brena, player)", autocomplete: "off" });
  private readonly kind = el("select");
  private readonly out = el("div", { className: "results" });
  private readonly status = el("p", { className: "muted" });
  private timer: ReturnType<typeof setTimeout> | undefined;
  private seq = 0;

  constructor() {
    for (const [v, t] of [["", "anyone"], ["cast", "the cast"], ["figure", "notables"], ["townsperson", "townsfolk"], ["beast", "beasts"], ["place", "places"], ["player", "the player"]]) this.kind.append(new Option(t, v));
    const bar = el("div", { className: "filters" });
    bar.append(this.input, this.kind);
    this.el.append(bar, this.status, this.out);
    this.input.addEventListener("input", () => this.later(250));
    this.kind.addEventListener("change", () => this.later(0));
    pins.onChange(() => void this.run());
  }

  async refresh(_clock?: AdminClock): Promise<void> {
    if (this.out.childElementCount === 0) await this.run();
  }

  private later(ms: number): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.run(), ms);
  }

  private async run(): Promise<void> {
    const seq = ++this.seq;
    const q = this.input.value.trim();
    let r: AdminSearchResult;
    try {
      r = await api.search(q, { ...(this.kind.value ? { kind: this.kind.value } : {}) });
    } catch (err) {
      this.status.textContent = `Search failed: ${(err as Error).message}`;
      return;
    }
    if (seq !== this.seq) return;
    this.status.textContent = r.complete ? (q ? `${r.hits.length}${r.hits.length >= 50 ? "+" : ""} found.` : "Type to search.") : `Listing the townsfolk of every place… ${r.indexed} of ${r.places}. Showing what's found so far.`;
    this.out.replaceChildren();
    if (r.hits.length === 0 && r.complete && q) this.out.append(emptyP("Nobody by that description."));
    for (const h of r.hits) {
      const row = el("div", { className: "hit" });
      const open = el("button", { className: "link", textContent: h.name, type: "button" });
      open.addEventListener("click", () => nav.openCard(h.ref));
      const pin = el("button", { textContent: pins.has(h.ref) ? "Unpin" : "Pin", type: "button" });
      pin.addEventListener("click", () => pins.toggle(h.ref));
      row.append(open, el("span", { className: "muted", textContent: h.detail }), pin);
      this.out.append(row);
    }
    // More of the index to build: ask again shortly.
    if (!r.complete) this.later(700);
  }
}
