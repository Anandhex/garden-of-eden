import type { AdminClock, AdminGossip, AdminKnowers } from "@millbrook/shared";
import { el, emptyP } from "../../dom";
import { api } from "../api";
import { nav } from "../nav";
import type { View } from "./types";

/**
 * Gossip (N33): what the most people know, and for one thing who knows it and where, in what order the places learned it, and what
 * each person would say, with the truth beside it when their version is wrong.
 */
export class GossipView implements View {
  readonly el = el("section", { className: "view gossip" });
  private data: AdminGossip | null = null;
  private open: AdminKnowers | null = null;
  private busy = false;

  async refresh(_clock?: AdminClock): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      this.data = await api.gossip();
      this.draw();
    } catch (err) {
      this.el.replaceChildren(emptyP(`Couldn't load the gossip: ${(err as Error).message}`));
    } finally {
      this.busy = false;
    }
  }

  private async show(ref: string): Promise<void> {
    try {
      this.open = await api.knowers(ref);
    } catch {
      this.open = null;
    }
    this.draw();
  }

  private draw(): void {
    const d = this.data;
    if (!d) return;
    this.el.replaceChildren(el("p", { textContent: d.on ? `${d.rows} things known by ${d.people} people; the most anyone holds is ${d.mostHeld} (of 24).` : "Gossip is off (GOSSIP=off)." }));
    if (this.open) this.el.append(this.knowers(this.open));
    if (d.popular.length === 0) return void this.el.append(emptyP("Nobody knows anything yet."));
    const table = el("table", { className: "grid" });
    const head = el("tr");
    for (const h of ["Known by", "What it is"]) head.append(el("th", { textContent: h }));
    table.append(head);
    for (const p of d.popular) {
      const b = el("button", { className: "link", type: "button", textContent: p.text });
      b.addEventListener("click", () => void this.show(p.ref));
      const tr = el("tr");
      tr.append(el("td", { textContent: String(p.count) }));
      const td = el("td");
      td.append(b);
      tr.append(td);
      table.append(tr);
    }
    this.el.append(table);
  }

  private knowers(k: AdminKnowers): HTMLElement {
    const box = el("div", { className: "card" });
    box.append(el("h3", { textContent: k.truth ?? k.ref }), el("p", { textContent: `Known by ${k.total}. The places, in the order they learned it:` }));
    const places = el("ol");
    for (const p of k.places) places.append(el("li", { textContent: `${p.name}: ${p.count} of ${p.people}, from day ${p.firstDay}` }));
    box.append(places);
    const list = el("ul");
    for (const h of k.holders) {
      const li = el("li");
      const who = el("button", { className: "link", type: "button", textContent: h.name });
      who.addEventListener("click", () => nav.openCard(h.ref));
      li.append(who, document.createTextNode(` (${h.siteName}, day ${h.day}, ${Math.round(h.accuracy * 100)}% sure, from ${h.from}): ${h.told ?? "?"}${h.wrong ? " (differs from the truth)" : ""}`));
      list.append(li);
    }
    box.append(list);
    return box;
  }
}
