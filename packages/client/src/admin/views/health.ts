import type { AdminClock } from "@millbrook/shared";
import { el, emptyP } from "../../dom";
import { api } from "../api";
import type { View } from "./types";

/** Health: how long each step takes, counts of things, and the numbers `npm run sim:realm` prints. */
export class HealthView implements View {
  readonly el = el("section", { className: "view health" });
  private busy = false;

  async refresh(_clock?: AdminClock): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const h = await api.health();
      this.el.replaceChildren();
      this.el.append(el("h3", { textContent: "Step timings (milliseconds, last 200 calls)" }));
      const names = Object.keys(h.tickMs).sort();
      if (names.length === 0) this.el.append(emptyP("Nothing has run yet: let a game hour pass."));
      else {
        const t = el("table", { className: "grid" });
        const head = el("tr");
        for (const c of ["Step", "Last", "Median", "95th", "Calls"]) head.append(el("th", { textContent: c }));
        t.append(head);
        for (const n of names) {
          const x = h.tickMs[n]!;
          const tr = el("tr");
          tr.append(el("td", { textContent: n }), ...[x.last, x.p50, x.p95, x.count].map((v) => el("td", { className: "num", textContent: String(v) })));
          t.append(tr);
        }
        this.el.append(t);
      }
      this.el.append(el("p", { className: "muted", textContent: "Budgets (what each step may take, and how close it is) arrive with N19." }));
      this.el.append(el("h3", { textContent: "Counts" }));
      const counts = el("div", { className: "totals" });
      for (const [k, v] of Object.entries(h.counts)) {
        const box = el("div", { className: "stat" });
        box.append(el("b", { textContent: v.toLocaleString() }), el("span", { textContent: k.replace(/([A-Z])/g, " $1").toLowerCase() }));
        counts.append(box);
      }
      this.el.append(counts, el("h3", { textContent: "What has happened (realm.stats)" }));
      this.el.append(emptyP(Object.entries(h.stats).filter(([k]) => !k.startsWith("quest_")).map(([k, v]) => `${k} ${v}`).join(", ") || "Nothing yet."));
      this.el.append(el("h3", { textContent: "The realm in words (what sim:realm prints)" }));
      for (const line of h.summary) this.el.append(el("p", { className: "mono", textContent: line }));
    } catch (err) {
      this.el.replaceChildren(emptyP(`Couldn't load health: ${(err as Error).message}`));
    } finally {
      this.busy = false;
    }
  }
}
