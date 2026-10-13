/**
 * The realm map as SVG: roads, dungeons and settlements coloured by kingdom. Shared by
 * the game's Realm tab (N13.9) and the admin page (N17), so both draw the same map.
 * The admin page adds a layer on top: packs, war fronts and pinned places.
 */
import type { AdminMapLayer, RealmView } from "@millbrook/shared";
import { el } from "./dom";

const NS = "http://www.w3.org/2000/svg";

export const svg = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
};

export const RADIUS: Record<string, number> = { hamlet: 7, village: 10, town: 14, city: 18, capital: 22 };

export interface RealmMapOptions {
  /** The settlement to ring as "you are here" (the game's player). */
  here?: string | null;
  selected?: string | null;
  /** Called with a settlement id when one is clicked or entered. */
  onPick?: (id: string) => void;
  /** Admin extras drawn over the map. */
  layer?: AdminMapLayer;
  /** Settlements with a pinned card (admin). */
  pinned?: ReadonlySet<string>;
}

export function drawRealmMap(r: RealmView, o: RealmMapOptions = {}): SVGSVGElement {
  const at = (id: string | null) => r.settlements.find((x) => x.id === id);
  const map = svg("svg", { viewBox: `0 0 ${r.size.w} ${r.size.h}`, class: "realm-map", role: "img", "aria-label": "Map of the realm" });
  const drawn = new Set<string>();
  for (const a of r.settlements) {
    for (const id of a.roads) {
      const b = at(id);
      const key = [a.id, id].sort().join("|");
      if (!b || drawn.has(key)) continue;
      drawn.add(key);
      map.append(svg("line", { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: a.liege === b.id || b.liege === a.id ? "road liege" : "road" }));
    }
  }
  // War fronts go under the places so the rings stay clear.
  for (const f of o.layer?.fronts ?? []) {
    const line = svg("line", { x1: f.from.x, y1: f.from.y, x2: f.to.x, y2: f.to.y, class: "front" });
    const t = svg("title", {});
    t.textContent = `${f.attackers} against ${f.defenders} (${f.cause}), score ${f.score}`;
    line.append(t);
    map.append(line);
  }
  for (const d of r.dungeons) {
    const g = svg("g", { class: `dungeon${d.cleared ? " cleared" : ""}` });
    g.append(svg("rect", { x: d.x - 8, y: d.y - 8, width: 16, height: 16, transform: `rotate(45 ${d.x} ${d.y})` }));
    const t = svg("title", {});
    t.textContent = `${d.name} (rank ${d.tier}, ${d.depth} levels, danger ${d.danger}${d.cleared ? ", cleared" : ""})`;
    g.append(t);
    map.append(g);
  }
  for (const x of r.settlements) {
    const k = r.kingdoms.find((k) => k.id === x.kingdom);
    const g = svg("g", { class: `place${x.id === o.here ? " here" : ""}${x.home ? " home" : ""}${x.abandoned ? " abandoned" : ""}${x.id === o.selected ? " selected" : ""}${o.pinned?.has(x.id) ? " pinned" : ""}`, tabindex: 0 });
    if (x.atWar || x.raided) g.append(svg("circle", { cx: x.x, cy: x.y, r: (RADIUS[x.kind] ?? 6) + 5, class: x.atWar ? "war-ring" : "raid-ring" }));
    g.append(svg("circle", { cx: x.x, cy: x.y, r: RADIUS[x.kind] ?? 6, fill: k?.color ?? "#888" }));
    if (x.kind === "capital" || x.kind === "city" || x.kind === "town" || x.home || x.id === o.selected) {
      const label = svg("text", { x: x.x, y: x.y - (RADIUS[x.kind] ?? 6) - 4, "text-anchor": "middle" });
      label.textContent = x.name;
      g.append(label);
    }
    const t = svg("title", {});
    t.textContent = `${x.name}, ${x.kind} of ${k?.name ?? "no crown"}: ${x.population} people, prosperity ${x.prosperity}`;
    g.append(t);
    const pick = () => o.onPick?.(x.id);
    g.addEventListener("click", pick);
    g.addEventListener("keydown", (e) => (e as KeyboardEvent).key === "Enter" && pick());
    map.append(g);
  }
  // Packs: a small paw-coloured dot beside their settlement, sized by how many.
  (o.layer?.packs ?? []).forEach((p, i) => {
    const a = (i * 2.4) % (Math.PI * 2);
    const near = at(p.near);
    const rad = (near ? (RADIUS[near.kind] ?? 6) : 8) + 10;
    const g = svg("g", { class: "pack" });
    g.append(svg("circle", { cx: p.x + Math.cos(a) * rad, cy: p.y + Math.sin(a) * rad, r: 3 + Math.min(6, p.count / 3) }));
    const t = svg("title", {});
    t.textContent = `${p.count} ${p.species}s near ${near?.name ?? p.near}`;
    g.append(t);
    map.append(g);
  });
  return map;
}

/** Kingdom chips and a key to the symbols. */
export function realmLegend(r: RealmView, extra = "◆ dungeon · red ring: war · amber: raided"): HTMLElement {
  const legend = el("div", { className: "realm-legend" });
  for (const k of r.kingdoms) {
    const chip = el("span", { className: "chip", textContent: `${k.name}${k.ruler ? ` · ${k.ruler}` : ""}` });
    chip.style.borderColor = k.color;
    legend.append(chip);
  }
  legend.append(el("span", { className: "chip", textContent: extra }));
  return legend;
}
