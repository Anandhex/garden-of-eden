/**
 * The Realm tab (N13.9): a map of the kingdoms, towns and villages around
 * Millbrook, and what's going on out there: wars, treaties, factions and their
 * hierarchy, dungeons, beasts, notable people and the news. The server keeps the
 * realm; this fetches GET /api/realm when the realm's day changes, and draws it.
 */
import type { RealmView } from "@millbrook/shared";
import { coins, el, emptyP } from "../dom";
import { act } from "../game";
import { game, store } from "../store";
import { drawRealmMap, realmLegend } from "../realmMap";
import { button } from "./modals";

let cached: RealmView | null = null;
let loading = false;
let selected: string | null = null;

/** "5 hours", "2 days". */
const hoursWords = (h: number) => (h < 20 ? `${h}h` : `${Math.round((h / 24) * 2) / 2} days`);

/** Get the realm if the day moved on (or we have none), then draw again. */
async function load(): Promise<void> {
  if (loading) return;
  loading = true;
  try {
    const res = await fetch("/api/realm");
    cached = (await res.json()) as RealmView | null;
  } catch {
    // Keep what we had.
  } finally {
    loading = false;
  }
  if (store.tab === "realm") renderRealm(document.getElementById("tab-body")!);
}

export function renderRealm(body: HTMLElement): void {
  body.replaceChildren();
  const s = game();
  const h = (t: string) => body.append(el("h3", { textContent: t }));
  if (!s.realm) {
    body.append(emptyP("This world has no wider realm (the server runs with REALM=off)."));
    return;
  }
  if (!cached || cached.day !== s.realm.day) void load();
  if (!cached) {
    body.append(emptyP("Unrolling the map…"));
    return;
  }
  const r = cached;
  const at = (id: string | null) => r.settlements.find((x) => x.id === id);

  // ---- The map ----
  body.append(
    drawRealmMap(r, {
      here: s.site.id,
      selected,
      onPick: (id) => {
        selected = id;
        renderRealm(body);
      },
    }),
  );
  body.append(realmLegend(r));

  // ---- The chosen place ----
  const place = at(selected) ?? at(s.site.id) ?? r.settlements.find((x) => x.home);
  if (place) {
    h(`${place.name} (${place.abandoned ? "abandoned " : ""}${place.kind})`);
    const liege = at(place.liege);
    body.append(
      emptyP(
        `${place.population} people · prosperity ${place.prosperity} · food ${place.food} · coffers ${coins(place.treasury)}. Head: ${place.leader ?? "no one"}. ${liege ? `Pays ${Math.round(place.taxRate * 100)}% in taxes to ${liege.name}${place.arrears ? ` (${place.arrears} tax days behind)` : ""}.` : "Answers to no one."}`,
      ),
    );
    const b = Object.entries(place.buildings).map(([k, v]) => `${k} ${v}`).join(", ");
    body.append(emptyP(`Buildings: ${b || "none"}${place.project ? `. Building: ${place.project}` : ""}.`));
    const here = r.factions.filter((f) => f.branches.includes(place.name));
    if (here.length) body.append(emptyP(`Here: ${here.map((f) => f.name).join(", ")}.`));
  }

  // ---- Travel (N14) ----
  h(`Travel (you're in ${s.site.name})`);
  const dest = place ? s.site.destinations.find((d) => d.id === place.id) : undefined;
  if (place && dest) {
    body.append(emptyP(`To ${dest.name}: about ${hoursWords(dest.hours)} on the road${dest.dangers.length ? `. On the way: ${dest.dangers.join(", ")}` : ", and the road is quiet"}.`));
    body.append(button(`Travel to ${dest.name}`, () => void act({ action: "travel", to: dest.id })));
  } else if (place && place.id === s.site.id) {
    body.append(emptyP("Click a place on the map to see the road there."));
  }
  const near = s.site.destinations.slice(0, 5);
  if (near.length) {
    const row = el("div", { className: "realm-legend" });
    for (const d of near) {
      const b = button(`${d.name} · ${hoursWords(d.hours)}`, () => void act({ action: "travel", to: d.id }));
      b.title = d.dangers.length ? `On the way: ${d.dangers.join(", ")}` : "A quiet road";
      row.append(b);
    }
    body.append(row);
  }

  // ---- Adventuring (the player) ----
  h("Adventuring");
  const adv = s.adventurer;
  if (adv.member) body.append(emptyP(`You're a guild ${adv.rank ?? "member"} (renown ${adv.renown}).`));
  if (!adv.member) {
    const p = emptyP(`Members of the adventurers' guild delve the dungeons for treasure. Joining costs ${coins(adv.fee)}.`);
    body.append(p);
    body.append(button("Join the guild", () => void act({ action: "joinguild" }), s.player.money < adv.fee));
  }
  for (const d of adv.dungeons) {
    const row = el("div", { className: "row" });
    row.append(el("span", { textContent: `${d.name} [${d.tier}, ${d.depth} levels]` }), el("span", { textContent: d.cleared ? "cleared" : `danger ${d.danger}${d.bounty ? `, bounty ${coins(d.bounty)}` : ""}` }));
    // Down from its mouth only (N15): walk there first.
    if (adv.member && !d.cleared && d.here) row.append(button("Delve", () => void act({ action: "delve", dungeon: d.id })));
    body.append(row);
    if (adv.member && !d.cleared && !d.here) body.append(emptyP(`${d.mouth}. Walk there to go down.`));
  }

  // ---- Wars and treaties ----
  h("Wars");
  if (r.wars.length === 0) body.append(emptyP("Peace, for now."));
  for (const w of r.wars.slice().reverse()) {
    body.append(emptyP(`${w.attackers.join(" & ")} against ${w.defenders.join(" & ")} (${w.cause}), from day ${w.start}: ${w.end !== null ? `over on day ${w.end}, ${w.outcome}` : `${w.battles} battles, score ${w.score}`}.`));
  }
  h(`Treaties (${r.treaties.length})`);
  for (const t of r.treaties.slice(0, 12)) body.append(emptyP(`${t.kind.replace("_", " ")}: ${t.a} and ${t.b} (${t.why}), until day ${t.until}.`));

  // ---- Factions ----
  h(`Factions (${r.factions.length})`);
  for (const f of r.factions) {
    body.append(el("h4", { textContent: `${f.name} [${f.kind}]${f.parent ? ` (split from ${f.parent})` : ""}` }));
    body.append(emptyP(`"${f.creed}". ${f.size} members${f.branches.length ? `, halls in ${f.branches.join(", ")}` : ""}. ${f.members.join(", ")}`));
  }

  // ---- People and beasts ----
  h("Notable people");
  for (const n of r.notables.slice(0, 16)) {
    body.append(emptyP(`${n.name}: ${n.role}, rank ${n.rank}, renown ${n.renown}${n.home ? `, of ${n.home}` : ""}${n.superior ? `; answers to ${n.superior}` : ""}${n.talks ? " (you can talk to them)" : ""}${n.rose ? " (rose from the crowd)" : ""}.${n.deeds.length ? ` ${n.deeds.join("; ")}.` : ""}`));
  }
  h("Beasts");
  for (const p of r.packs.slice(0, 10)) body.append(emptyP(`${p.count} ${p.species}s near ${p.near} (the land feeds ${p.cap})${p.alpha ? `, led by ${p.alpha}` : ""}${p.bounty ? `; bounty ${coins(p.bounty)}` : ""}.`));
  h("Dungeons");
  for (const d of r.dungeons) body.append(emptyP(`${d.name} near ${d.near}: rank ${d.tier}, ${d.depth} levels, danger ${d.danger}${d.cleared ? ", cleared for now" : ""}${d.bounty ? `, bounty ${coins(d.bounty)}` : ""}.`));

  // ---- News and the director ----
  h("News from the realm");
  for (const n of r.news.slice(0, 20)) body.append(emptyP(`Day ${n.day}: ${n.text}${n.heard ? "" : " (not heard in Millbrook yet)"}`));
  h("What the director pushed");
  for (const d of r.director) body.append(emptyP(`Day ${d.day}: ${d.kind.replace(/_/g, " ")} (${d.reason})${d.ok ? "" : ", but it came to nothing"}.`));
}
