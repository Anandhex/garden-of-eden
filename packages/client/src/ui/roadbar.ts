/** The strip under the map while the player is on the open road (N26): where, how far, supplies, and what they can do here. */
import { $, el } from "../dom";
import { act, autoWalk, cancelWalk, onRender } from "../game";
import { store } from "../store";
import { showSituation } from "./modals";
import { travellerNear } from "../travellers";

export function setUpRoadbar(): void {
  onRender(renderRoadbar);
}

const need = (label: string, v: number) => {
  const s = el("span", { className: `need${v < 25 ? " low" : ""}` });
  const bar = el("i");
  const fill = document.createElement("b");
  fill.style.width = `${Math.max(0, Math.min(100, v))}%`;
  bar.append(fill);
  s.append(label, bar);
  return s;
};

const btn = (text: string, title: string, onclick: () => void) => {
  const b = el("button", { textContent: text, title });
  b.onclick = onclick;
  return b;
};

export function renderRoadbar(): void {
  const bar = $("roadbar");
  const s = store.state;
  const r = s?.road;
  bar.hidden = !r;
  if (!r || !s) return;
  bar.replaceChildren();
  bar.append(el("span", { className: "where", textContent: r.off ? `Off the road (${r.off} tiles) · ${r.where}` : r.where }));
  for (const e of r.ends) bar.append(el("span", { className: "dim", textContent: `${e.name}: ${e.walk}` }));
  if (r.dest) {
    bar.append(el("span", { textContent: `→ ${r.dest.name}: ${r.dest.walk}` }));
    bar.append(btn("Walk", "Walk the road to your destination (any key stops)", () => void autoWalk()));
    if (r.canFast) bar.append(btn("Fast travel", "Along stretches you've walked before; stops for anything worth stopping for", () => void act({ action: "fasttravel" })));
  }
  if (r.inn) bar.append(el("span", { className: "dim", textContent: `An inn nearby: ${r.inn.name}` }));
  if (r.needs) {
    bar.append(need("food", r.needs.food), need("water", r.needs.water), need("rest", r.needs.rest));
    if (r.needs.words) bar.append(el("span", { className: "dim", textContent: r.needs.words }));
  }
  if (r.mount) bar.append(el("span", { textContent: `${r.mount.name} (${r.mount.kind}${r.mount.lame ? ", lame" : ""})` }));
  // People within reach (N26): go along with them, or rob a caravan.
  const who = travellerNear(s, 6);
  if (who) {
    const journey = /^v_(j\d+)_/.exec(who.id)?.[1] ?? "";
    bar.append(el("span", { className: "dim", textContent: `${who.name} (${who.kind})` }));
    if (["caravan", "pilgrims", "adventurers", "patrol", "migrants", "refugees"].includes(who.kind)) bar.append(btn("Travel with them", `Go along with them to ${who.to}: safer, and at their pace`, () => void act({ action: "joinjourney", journey })));
    if (who.kind === "caravan") bar.append(btn("Rob the caravan", "A crime. Its guards will fight you.", () => confirm("Rob this caravan? It is a crime, and its guards will fight you.") && void act({ action: "rob", journey })));
  }
  bar.append(el("span", { className: "spacer" }));
  bar.append(btn("Camp", "Make camp off the road: a fire, a watch, rest", () => void act({ action: "camp" })));
  bar.append(btn("Drink", "Drink from a river, a well or a trough close by", () => void act({ action: "drink" })));
  for (const n of r.nearby) for (const o of n.offers) bar.append(btn(o.label, n.name, () => void act({ action: "roadplace", place: n.id, op: o.op })));
  if (r.pending) showSituation(r.pending);
  void cancelWalk;
}
