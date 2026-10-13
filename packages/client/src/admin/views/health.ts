import type { AdminBudgets, AdminClock } from "@millbrook/shared";
import { el, emptyP } from "../../dom";
import { api } from "../api";
import type { View } from "./types";

/** Health: how long each step takes, counts of things, and the numbers `npm run sim:realm` prints. */
export class HealthView implements View {
  readonly el = el("section", { className: "view health" });
  private busy = false;

  /** Tick budgets with how close each is, model calls by kind against their daily caps, and the queue. */
  private budgets(b: AdminBudgets): void {
    this.el.append(el("h3", { textContent: "Budgets (budgets.ts)" }));
    const tick = el("table", { className: "grid" });
    const head = el("tr");
    for (const c of ["Budget", "Limit (ms)", "95th (ms)", "Share", ""]) head.append(el("th", { textContent: c }));
    tick.append(head);
    for (const r of b.tick) {
      const tr = el("tr");
      const share = r.ratio === null ? "not measured yet" : `${Math.round(r.ratio * 100)}%`;
      tr.append(el("td", { textContent: r.label }), el("td", { className: "num", textContent: String(r.budgetMs) }), el("td", { className: "num", textContent: r.p95Ms === null ? "-" : String(r.p95Ms) }), el("td", { className: "num", textContent: share }), el("td", { className: `badge ${r.status}`, textContent: r.status }));
      tick.append(tr);
    }
    this.el.append(tick);
    this.el.append(el("p", { className: "muted", textContent: `Frame (the browser's side; open the game with ?fps=1): ${b.frame.targetFps} fps; the capital's crowd may take ${b.frame.capitalCrowdMs} ms a frame and ${b.frame.capitalMinuteMs} ms for each game minute's burst.` }));

    this.el.append(el("h3", { textContent: "Model calls today, by kind (most protected first)" }));
    const model = el("table", { className: "grid" });
    const mh = el("tr");
    for (const c of ["Kind", "Today", "Cap", "Average ms", "Dropped today", "Dropped ever", "Tokens in", "Tokens out", ""]) mh.append(el("th", { textContent: c }));
    model.append(mh);
    for (const k of b.model) {
      const status = k.cap === null ? "ok" : k.callsToday >= k.cap ? "over" : k.callsToday >= k.cap * 0.75 ? "warn" : "ok";
      const tr = el("tr");
      tr.append(
        el("td", { textContent: k.kind }),
        ...[k.callsToday, k.cap === null ? "none" : k.cap, k.avgMs, k.droppedToday, k.droppedTotal, k.tokensIn, k.tokensOut].map((v) => el("td", { className: "num", textContent: String(v) })),
        el("td", { className: `badge ${status}`, textContent: k.cap === null ? "never dropped" : status === "over" ? "spent" : status }),
      );
      model.append(tr);
    }
    this.el.append(model);
    const q = b.queue;
    const ft = b.talk.firstTokenMs;
    this.el.append(
      el("p", { className: "muted", textContent: `Background queue: ${q.length} waiting${q.running ? `, running ${q.running}` : ""}; estimated wait ${(q.estimatedWaitMs / 1000).toFixed(1)} s of ${(q.maxWaitMs / 1000).toFixed(0)} s allowed; ${q.dropped} dropped for being too long.` }),
      el("p", { className: "muted", textContent: ft ? `The player's first word: last ${ft.last} ms, worst ${ft.worst} ms (target ${b.talk.targetMs} ms).` : `The player's first word: no talk yet (target ${b.talk.targetMs} ms).` }),
    );
  }

  async refresh(_clock?: AdminClock): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const h = await api.health();
      this.el.replaceChildren();
      const dl = el("p");
      dl.append(el("a", { href: "/api/admin/export", download: "", textContent: "Download this world (.mbworld)" }), el("span", { className: "muted", textContent: " the save and every table in one file; import it with npm run world:import." }));
      this.el.append(dl);
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
      this.budgets(h.budgets);
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
