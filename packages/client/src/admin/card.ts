import type { AdminCard, AdminEvent, AdminSection } from "@millbrook/shared";
import { el } from "../dom";
import { nav } from "./nav";
import { pins } from "./pins";

/** Cards: a person or place as a list of sections (N17). */

const linkButton = (text: string, onClick: () => void, title?: string): HTMLButtonElement => {
  const b = el("button", { className: "link", textContent: text, type: "button" });
  if (title) b.title = title;
  b.addEventListener("click", onClick);
  return b;
};

function sectionEl(s: AdminSection): HTMLElement {
  const d = el("details", { className: "section" });
  d.open = !("unavailable" in s) && s.rows.length > 0;
  d.append(el("summary", { textContent: s.title }));
  if ("unavailable" in s) {
    d.append(el("p", { className: "empty", textContent: `Not built yet: ${s.unavailable}` }));
    return d;
  }
  if (s.rows.length === 0) {
    d.append(el("p", { className: "empty", textContent: "Nothing to show." }));
    return d;
  }
  const t = el("table", { className: "rows" });
  for (const [label, value, ref] of s.rows) {
    const tr = el("tr");
    tr.append(el("th", { textContent: label }));
    const td = el("td");
    if (ref) td.append(linkButton(value, () => nav.openCard(ref), ref));
    else td.append(valueEl(label, value));
    tr.append(td);
    t.append(tr);
  }
  d.append(t);
  return d;
}

/**
 * A row's value, drawn by what it is: a ladder ("a → [b] → c", the rung reached in brackets) as steps, a share ("35% toward …") with a small
 * meter in front, anything else as text.
 */
function valueEl(label: string, value: string): Node {
  if (label === "Ladder" && value.includes("→")) {
    const steps = el("div", { className: "ladder" });
    const parts = value.split("→").map((x) => x.trim());
    const at = parts.findIndex((x) => x.startsWith("["));
    parts.forEach((x, i) => steps.append(el("span", { className: i < at ? "step done" : i === at ? "step now" : "step", textContent: x.replace(/^\[|\]$/g, "") })));
    return steps;
  }
  const pct = /^(\d{1,3})%/.exec(value);
  if (pct) {
    const box = el("div", { className: "metered" });
    const bar = el("span", { className: `meter${label === "Frustration" ? " hot" : ""}` });
    const fill = el("i");
    fill.style.width = `${Math.min(100, Number(pct[1]))}%`;
    bar.append(fill);
    box.append(bar, el("span", { textContent: value }));
    return box;
  }
  return document.createTextNode(value);
}

/** A townsperson's day, hour by hour. */
function dayEl(card: AdminCard, nowHour: number): HTMLElement {
  const d = el("details", { className: "section" });
  d.open = true;
  d.append(el("summary", { textContent: `Their day, hour by hour (rolled on day ${card.rolledOn ?? "?"})` }));
  const t = el("table", { className: "day" });
  for (const h of card.day ?? []) {
    const tr = el("tr", { className: h.hour === nowHour ? "now" : "" });
    tr.append(el("th", { textContent: `${String(h.hour).padStart(2, "0")}:00` }), el("td", { textContent: h.doing }), el("td", { className: "muted", textContent: h.visible ? `out at ${h.x}, ${h.y}` : h.inside ? `in ${h.inside}` : "out of sight" }));
    t.append(tr);
  }
  d.append(t);
  return d;
}

export interface CardOptions {
  nowHour: number;
  /** Show the follow view for this card. */
  onFollow?: (card: AdminCard) => void;
  following?: boolean;
}

export function renderCard(card: AdminCard, o: CardOptions): HTMLElement {
  const root = el("article", { className: `card ${card.alive ? "" : "dead"}` });
  const head = el("header", { className: "card-head" });
  const title = el("div");
  title.append(el("h2", { textContent: card.name }), el("p", { className: "muted", textContent: `${card.subtitle}${card.alive ? "" : " (dead)"}` }));
  const actions = el("div", { className: "actions" });
  const pinBtn = el("button", { textContent: pins.has(card.ref) ? "Unpin" : "Pin", type: "button" });
  pinBtn.addEventListener("click", () => pins.toggle(card.ref));
  actions.append(pinBtn);
  if (card.follow) {
    const f = el("button", { textContent: o.following ? "Stop following" : "Follow on map", type: "button" });
    f.addEventListener("click", () => o.onFollow?.(card));
    actions.append(f);
  }
  actions.append(linkButton("Events about them", () => nav.eventsAbout(card.ref)));
  head.append(title, actions);
  root.append(head);
  root.append(el("p", { className: "doing", textContent: `${card.siteName ? `${card.siteName}: ` : ""}${card.doing}` }));
  if (card.day) root.append(dayEl(card, o.nowHour));
  for (const s of card.sections) root.append(sectionEl(s));
  return root;
}

/** One event as a block: its text, why, people (links) and what caused it. */
export function renderEvent(e: AdminEvent, names: (ref: string) => string): HTMLElement {
  const root = el("article", { className: "card" });
  root.append(el("h2", { textContent: e.text }));
  const t = el("table", { className: "rows" });
  const row = (label: string, value: string | HTMLElement) => {
    const tr = el("tr");
    tr.append(el("th", { textContent: label }));
    const td = el("td");
    td.append(value);
    tr.append(td);
    t.append(tr);
  };
  row("When", `day ${e.day}${e.source === "game" ? `, ${String(e.hour).padStart(2, "0")}:00` : ""}`);
  row("Kind", `${e.kind} (${e.source}), importance ${e.importance}`);
  row("Why", e.why ?? "no reason recorded");
  if (e.site) row("Place", names(`place:${e.site}`));
  const people = el("span");
  e.people.forEach((p, i) => {
    if (i > 0) people.append(", ");
    people.append(linkButton(names(p), () => nav.openCard(p), p));
  });
  row("People", e.people.length ? people : "none recorded");
  row("Caused by", e.causedBy.length ? e.causedBy.join(", ") : "not tracked yet (N20)");
  row("Ref", e.ref);
  root.append(t);
  return root;
}
