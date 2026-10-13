import { type AdminClock, type AdminEvent, type AdminEventQuery, type AdminSource, compareAt } from "@millbrook/shared";
import { el, emptyP } from "../../dom";
import { api } from "../api";
import { renderEvent } from "../card";
import { nav } from "../nav";
import type { View } from "./types";

const ROW_H = 46;
/** Rows kept in the browser. */
const KEEP = 3000;

/**
 * The event stream: every event in the realm, newest first, in a list that draws only
 * the rows in view (it can hold thousands). Polls with a cursor for new ones.
 */
export class EventsView implements View {
  readonly el = el("section", { className: "view events" });
  private rows: AdminEvent[] = [];
  private names: Record<string, string> = {};
  private cursor: string | null = null;
  private matched = 0;
  private filters: AdminEventQuery = {};
  private busy = false;
  private readonly list = el("div", { className: "vlist", tabIndex: 0 });
  private readonly sizer = el("div", { className: "vlist-sizer" });
  private readonly detail = el("div", { className: "detail" });
  private readonly status = el("p", { className: "muted" });
  private readonly person = el("input", { placeholder: "person ref, e.g. figure:fig-12" });
  private readonly kind = el("input", { placeholder: "kind, e.g. war" });
  private readonly site = el("select");
  private readonly faction = el("select");
  private selected: string | null = null;
  private sitesFilled = false;

  constructor() {
    const bar = el("div", { className: "filters" });
    const source = el("select");
    for (const [v, t] of [["", "all sources"], ["game", "game events"], ["realm", "realm news"], ["director", "director"]]) source.append(new Option(t, v));
    const importance = el("select");
    for (const [v, t] of [["", "any importance"], ["3", "3+"], ["5", "5+"], ["7", "7+ (big)"], ["9", "9+ (huge)"]]) importance.append(new Option(t, v));
    const apply = () => {
      const f: AdminEventQuery = {};
      if (source.value) f.source = source.value as AdminSource;
      if (importance.value) f.minImportance = Number(importance.value);
      if (this.kind.value.trim()) f.kind = this.kind.value.trim();
      if (this.person.value.trim()) f.person = this.person.value.trim();
      if (this.site.value) f.site = this.site.value;
      if (this.faction.value) f.faction = this.faction.value;
      this.filters = f;
      void this.reload();
    };
    this.site.append(new Option("any place", ""));
    this.faction.append(new Option("any faction", ""));
    for (const x of [source, importance, this.site, this.faction]) x.addEventListener("change", apply);
    for (const x of [this.kind, this.person]) x.addEventListener("change", apply);
    const clear = el("button", { textContent: "Clear", type: "button" });
    clear.addEventListener("click", () => {
      source.value = importance.value = this.site.value = this.faction.value = this.kind.value = this.person.value = "";
      apply();
    });
    bar.append(source, importance, this.site, this.faction, this.kind, this.person, clear);
    this.list.append(this.sizer);
    this.list.addEventListener("scroll", () => this.paint());
    const split = el("div", { className: "split events-split" });
    split.append(this.list, this.detail);
    this.detail.append(emptyP("Click an event to see who, where and why."));
    this.el.append(bar, this.status, split);
    nav.eventsAbout = (ref) => {
      this.person.value = ref;
      this.person.dispatchEvent(new Event("change"));
    };
  }

  /** Fill the place and faction pickers once the realm is known. */
  fill(sites: Array<{ id: string; name: string }>, factions: Array<{ id: string; name: string }>): void {
    if (this.sitesFilled) return;
    this.sitesFilled = true;
    for (const s of sites.slice().sort((a, b) => a.name.localeCompare(b.name))) this.site.append(new Option(s.name, s.id));
    for (const f of factions) this.faction.append(new Option(f.name, f.id));
  }

  private async reload(): Promise<void> {
    this.rows = [];
    this.cursor = null;
    this.list.scrollTop = 0;
    await this.refresh();
  }

  async refresh(_clock?: AdminClock): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const first = this.cursor === null;
      const page = await api.events({ ...this.filters, limit: first ? 1000 : 500, ...(this.cursor ? { after: this.cursor } : {}) });
      Object.assign(this.names, page.names);
      if (first) {
        this.rows = page.events;
      } else if (page.events.length > 0) {
        this.rows = [...page.events, ...this.rows].slice(0, KEEP);
      }
      // A new game: the stream's newest row is older than ours. Start again.
      if (!first && page.cursor && this.cursor && compareAt(page.cursor, this.cursor) < 0) {
        this.cursor = null;
        this.busy = false;
        return this.refresh();
      }
      // `after` is relative to the whole stream; keep the newest row we have seen.
      if (page.cursor && (first || page.events.length > 0)) this.cursor = page.cursor;
      this.matched = first ? page.matched : this.matched + page.events.length;
      this.status.textContent = `${this.matched.toLocaleString()} events match${this.rows.length < this.matched ? `; showing the newest ${this.rows.length.toLocaleString()}` : ""}.`;
      this.paint();
    } catch (err) {
      this.status.textContent = `Couldn't load events: ${(err as Error).message}`;
    } finally {
      this.busy = false;
    }
  }

  /** Draw only the rows in view. */
  private paint(): void {
    this.sizer.style.height = `${this.rows.length * ROW_H}px`;
    const top = Math.max(0, Math.floor(this.list.scrollTop / ROW_H) - 4);
    const count = Math.ceil((this.list.clientHeight || 600) / ROW_H) + 8;
    const rows = this.rows.slice(top, top + count);
    this.sizer.replaceChildren(
      ...rows.map((e, i) => {
        const row = el("div", { className: `ev imp${Math.min(9, e.importance)} ${e.source}${e.ref === this.selected ? " sel" : ""}` });
        row.style.top = `${(top + i) * ROW_H}px`;
        row.style.height = `${ROW_H}px`;
        row.append(
          el("span", { className: "day", textContent: `d${e.day}` }),
          el("span", { className: "kind", textContent: e.kind }),
          el("span", { className: "txt", textContent: e.text }),
          el("span", { className: "why", textContent: e.why ? `why: ${e.why}` : "" }),
        );
        row.addEventListener("click", () => this.open(e));
        return row;
      }),
    );
  }

  private open(e: AdminEvent): void {
    this.selected = e.ref;
    this.detail.replaceChildren(renderEvent(e, (ref) => this.names[ref] ?? ref));
    this.paint();
  }
}

nav.openEvent = () => {};
