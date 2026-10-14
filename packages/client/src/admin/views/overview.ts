import type { AdminClock, AdminOverview } from "@millbrook/shared";
import { coins, el, emptyP } from "../../dom";
import { drawRealmMap, realmLegend } from "../../realmMap";
import { api } from "../api";
import { renderCard } from "../card";
import { forgetCrowds } from "../follow";
import { nav } from "../nav";
import { pins } from "../pins";
import type { View } from "./types";

/** The realm: the map with its packs and war fronts, the numbers, and the places in a table. */
export class OverviewView implements View {
  readonly el = el("section", { className: "view overview" });
  private data: AdminOverview | null = null;
  private selected: string | null = null;
  private lastKey = "";
  private markers: Array<{ x: number; y: number; label: string }> = [];
  private busy = false;

  constructor() {
    pins.onChange(() => void this.loadMarkers().then(() => this.draw()));
  }

  async refresh(clock: AdminClock): Promise<void> {
    if (this.busy) return;
    // The realm only changes when a day passes; the class counts fill in a few places a request.
    const key = `${clock.day}`;
    if (this.data && key === this.lastKey && this.data.classesPending === 0) return;
    this.busy = true;
    try {
      const next = await api.overview();
      if (this.lastKey !== key) forgetCrowds();
      this.lastKey = key;
      this.data = next;
      await this.loadMarkers();
      this.draw();
      // Class counts come a few places at a time: ask again soon rather than wait for the next poll.
      if (next.classesPending > 0) setTimeout(() => void this.refresh(clock), 300);
    } catch (err) {
      this.el.replaceChildren(emptyP(`Couldn't load the realm: ${(err as Error).message}`));
    } finally {
      this.busy = false;
    }
  }

  /** Pinned people who are on a journey are marked on the map where their journey has them. */
  private async loadMarkers(): Promise<void> {
    const people = new Set(pins.list().filter((p) => p.startsWith("town:")));
    if (people.size === 0) {
      this.markers = [];
      return;
    }
    try {
      const roads = await api.roads();
      this.markers = roads.journeys.flatMap((j) => j.party.filter((p) => people.has(p.ref)).map((p) => ({ x: j.x, y: j.y, label: `${p.name}: ${j.where}` })));
    } catch {
      this.markers = [];
    }
  }

  private draw(): void {
    const o = this.data;
    if (!o) return;
    this.el.replaceChildren();
    if (!o.realm) {
      this.el.append(emptyP("This world has no realm (REALM=off)."));
      return;
    }
    const r = o.realm;
    const left = el("div", { className: "col" });
    const pinnedPlaces = new Set(pins.list().filter((p) => p.startsWith("place:")).map((p) => p.slice(6)));
    left.append(
      drawRealmMap(r, {
        selected: this.selected,
        layer: o.layer,
        pinned: pinnedPlaces,
        markers: this.markers,
        onPick: (id) => {
          this.selected = id;
          this.draw();
        },
      }),
      realmLegend(r, `◆ dungeon · red ring: war · amber: raided · dashed red: war front · dots: beast packs · not yet: ${o.layer.missing.join(", ")}`),
    );

    const t = o.totals;
    const totals = el("div", { className: "totals" });
    for (const [label, value] of [
      ["Kingdoms", t.kingdoms],
      ["Settlements", t.settlements],
      ["People", t.population.toLocaleString()],
      ["Notables alive", t.figuresAlive],
      ["Notables dead", t.figuresDead],
      ["Factions", t.factions],
      ["Wars", t.wars],
      ["Treaties", t.treaties],
    ] as const) {
      const box = el("div", { className: "stat" });
      box.append(el("b", { textContent: String(value) }), el("span", { textContent: label }));
      totals.append(box);
    }
    left.append(totals);

    const right = el("div", { className: "col" });
    if (this.selected) {
      const box = el("div", { className: "place-card" });
      box.append(emptyP("Loading…"));
      right.append(box);
      void api.card(`place:${this.selected}`).then((c) => box.replaceChildren(renderCard(c, { nowHour: o.clock.hour }))).catch((err: Error) => box.replaceChildren(emptyP(err.message)));
    } else {
      right.append(emptyP("Click a place on the map for its card."));
    }
    right.append(el("h3", { textContent: "At war" }));
    const wars = r.wars.filter((w) => w.end === null);
    if (wars.length === 0) right.append(emptyP("Peace, for now."));
    for (const w of wars) right.append(emptyP(`${w.attackers.join(" & ")} against ${w.defenders.join(" & ")} (${w.cause}), from day ${w.start}: ${w.battles} battles, score ${w.score}.`));
    right.append(el("h3", { textContent: `Treaties in force (${r.treaties.length})` }));
    for (const x of r.treaties.slice(0, 10)) right.append(emptyP(`${x.kind.replace("_", " ")}: ${x.a} and ${x.b} (${x.why}), until day ${x.until}.`));
    right.append(el("h3", { textContent: `Factions (${r.factions.length})` }));
    for (const f of r.factions) right.append(emptyP(`${f.name} [${f.kind}]${f.parent ? `, split from ${f.parent}` : ""}: ${f.size} members, led by ${f.leader ?? "no one"}.`));

    const top = el("div", { className: "split" });
    top.append(left, right);
    this.el.append(top, el("h3", { textContent: "Every place" }), this.table(o));
  }

  private table(o: AdminOverview): HTMLElement {
    const r = o.realm!;
    const table = el("table", { className: "grid" });
    const head = el("tr");
    for (const h of ["Place", "Kind", "Kingdom", "People", "By class", "Prosperity", "Food", "Coffers", "Head", "Now"]) head.append(el("th", { textContent: h }));
    table.append(head);
    const kingdom = (id: string | null) => r.kingdoms.find((k) => k.id === id)?.name ?? "free";
    for (const s of r.settlements.slice().sort((a, b) => b.population - a.population)) {
      const tr = el("tr", { className: s.id === this.selected ? "sel" : "" });
      const name = el("td");
      const b = el("button", { className: "link", textContent: s.name, type: "button" });
      b.addEventListener("click", () => nav.openCard(`place:${s.id}`));
      name.append(b);
      const classes = o.classes[s.id];
      tr.append(
        name,
        el("td", { textContent: `${s.abandoned ? "abandoned " : ""}${s.kind}` }),
        el("td", { textContent: kingdom(s.kingdom) }),
        el("td", { className: "num", textContent: s.population.toLocaleString() }),
        el("td", { className: "muted", textContent: classes ? Object.entries(classes).map(([c, n]) => `${c} ${n}`).join(", ") : "…" }),
        el("td", { className: "num", textContent: String(s.prosperity) }),
        el("td", { className: "num", textContent: String(s.food) }),
        el("td", { className: "num", textContent: coins(s.treasury) }),
        el("td", { textContent: s.leader ?? "no one" }),
        el("td", { textContent: [s.atWar ? "at war" : "", s.raided ? "raided" : "", s.project ?? ""].filter(Boolean).join(", ") }),
      );
      table.append(tr);
    }
    if (o.classesPending > 0) table.append(el("caption", { className: "muted", textContent: `Counting people by class… ${o.classesPending} places to go.` }));
    return table;
  }
}
