import type { AdminClock, AdminJourney, AdminNewsChain, AdminRoads } from "@millbrook/shared";
import { el, emptyP } from "../../dom";
import { api } from "../api";
import { nav } from "../nav";
import type { View } from "./types";

/**
 * The roads (N26 Part E): every journey that is not over, by kind, with its party (each a person you can open), where it is, why,
 * and the news it carries (click one for the chain of who carried it where).
 */
export class RoadsView implements View {
  readonly el = el("section", { className: "view roads" });
  private data: AdminRoads | null = null;
  private kind = "";
  private chain: AdminNewsChain | null = null;
  private busy = false;

  async refresh(_clock?: AdminClock): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      this.data = await api.roads();
      this.draw();
    } catch (err) {
      this.el.replaceChildren(emptyP(`Couldn't load the roads: ${(err as Error).message}`));
    } finally {
      this.busy = false;
    }
  }

  private draw(): void {
    const d = this.data;
    if (!d) return;
    this.el.replaceChildren();
    const kinds = [...new Set(d.journeys.map((j) => j.kind))].sort();
    const bar = el("p");
    const all = el("button", { type: "button", className: this.kind === "" ? "on" : "", textContent: `All (${d.journeys.length})` });
    all.addEventListener("click", () => {
      this.kind = "";
      this.draw();
    });
    bar.append(all);
    for (const k of kinds) {
      const b = el("button", { type: "button", className: this.kind === k ? "on" : "", textContent: `${k} (${d.journeys.filter((j) => j.kind === k).length}, ${d.onTheRoad[k] ?? 0} walking)` });
      b.addEventListener("click", () => {
        this.kind = k;
        this.draw();
      });
      bar.append(b);
    }
    this.el.append(bar);
    if (this.chain) this.el.append(this.chainBox(this.chain));
    const rows = d.journeys.filter((j) => this.kind === "" || j.kind === this.kind).sort((a, b) => a.depart - b.depart);
    if (rows.length === 0) this.el.append(emptyP("Nobody is on the roads."));
    const table = el("table", { className: "grid" });
    const head = el("tr");
    for (const h of ["Journey", "Now", "People", "Carrying"]) head.append(el("th", { textContent: h }));
    table.append(head);
    for (const j of rows) table.append(this.row(j));
    this.el.append(table);
  }

  private row(j: AdminJourney): HTMLElement {
    const tr = el("tr");
    const people = el("td");
    for (const p of j.party) {
      const b = el("button", { className: "link", type: "button", textContent: `${p.name} (${p.role})` });
      b.addEventListener("click", () => nav.openCard(p.ref));
      people.append(b, document.createTextNode(" "));
    }
    const carries = el("td");
    for (const c of j.carries) {
      const b = el("button", { className: "link", type: "button", textContent: c.text.length > 60 ? `${c.text.slice(0, 57)}...` : c.text, title: `heard at ${c.from}: who carried it?` });
      b.addEventListener("click", () => void this.showChain(c.news, j.to));
      carries.append(b, el("br"));
    }
    tr.append(el("td", { textContent: j.text }), el("td", { textContent: j.where }), people, carries);
    return tr;
  }

  private async showChain(news: string, site: string): Promise<void> {
    try {
      this.chain = await api.chain(news, site);
    } catch {
      this.chain = null;
    }
    this.draw();
  }

  private chainBox(c: AdminNewsChain): HTMLElement {
    const box = el("div", { className: "place-card" });
    box.append(el("h3", { textContent: `Who carried it: ${c.text}` }));
    for (const s of c.steps) box.append(emptyP(`Day ${s.day}: ${s.name}${s.viaText ? `, brought by ${s.viaText}` : s.via ? "" : ", where it happened"}.`));
    return box;
  }
}
