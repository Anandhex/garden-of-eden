/** The side sheet: character, inventory, quests and the world, plus the header pills. */
import { $, coins, el, emptyP } from "../dom";
import { act, onRender } from "../game";
import { game, store } from "../store";
import { speaker } from "../voice/speaker";
import { button } from "./modals";
import { renderRealm } from "./realm";
import { crowd } from "../crowd";
import { CLASSES, CLASS_WORDS } from "@millbrook/shared";

export function renderSheet(): void {
  const body = $("tab-body");
  body.replaceChildren();
  const s = game();
  const p = s.player;
  const h = (t: string) => body.append(el("h3", { textContent: t }));
  const row = (a: string, b: string) => {
    const r = el("div", { className: "row" });
    r.append(el("span", { textContent: a }), el("span", { textContent: b }));
    body.append(r);
    return r;
  };
  const bar = (frac: number) => {
    const wrap = el("div", { className: "bar" });
    const i = el("i");
    i.style.width = `${Math.max(0, Math.min(1, frac)) * 100}%`;
    wrap.append(i);
    body.append(wrap);
  };
  if (store.tab === "skills") {
    h(`${p.name}${p.titles.length > 0 ? `, ${p.titles.join(", ")}` : ""}, level ${p.level} (rank ${p.rank})`);
    body.append(emptyP(p.look));
    row("XP", `${p.xp}/${p.xpNext}`);
    bar(p.xp / p.xpNext);
    row("MP", `${p.mp}/${p.maxMp}`);
    if (p.statuses) row("Status", p.statuses);
    if (p.health.length) row("Ailing", p.health.join(", "));
    h(`Attributes${p.attributePoints ? ` (${p.attributePoints} point${p.attributePoints > 1 ? "s" : ""} to spend)` : ""}`);
    for (const [k, v] of Object.entries(p.attributes)) {
      const r = row(k, String(v));
      if (p.attributePoints) r.append(button("+1", () => void act({ action: "raise", attribute: k })));
    }
    h("Skills");
    if (p.skills.length === 0) body.append(emptyP("No trained skills yet."));
    for (const sk of p.skills) {
      row(sk.skill.replace("_", "-"), sk.needed ? `${sk.tier} (${sk.progress}/${sk.needed}h)` : sk.tier);
      if (sk.needed) bar(sk.progress / sk.needed);
    }
  } else if (store.tab === "inv") {
    h("Equipped");
    for (const slot of ["weapon", "armor"]) {
      const g = p.gear[slot];
      const r = row(slot, g ? `${g.item}${g.broken ? " (broken)" : ""}` : "nothing");
      if (g) r.append(button("Take off", () => void act({ action: "unequip", slot }), p.pack.used >= p.pack.slots));
    }
    body.append(emptyP(`Fighting with ${p.fightingWith}; armour stops ${p.armorValue} a hit. You can use gear up to tier ${p.gearTier}.`));
    h(`Pack (${p.pack.used}/${p.pack.slots} slots)`);
    row("Money", coins(p.money));
    if (p.items.length === 0) body.append(emptyP("Nothing but lint."));
    for (const it of p.items) {
      const r = row(it.item, `×${it.qty}`);
      r.dataset.item = it.item;
      // Food and drink (N26): eaten on the road or anywhere; a mount eats what it can.
      if (/^(bread loaf|stew|eggs|turnips|ale|wild herbs)\b/.test(it.item)) r.append(button("Eat", () => void act({ action: "eat", item: it.item.replace(/ \[.*$/, "") })));
      if (s.road?.mount && /^(turnips|bread loaf|wild herbs)\b/.test(it.item)) r.append(button("Feed", () => void act({ action: "mount", op: "feed", item: it.item.replace(/ \[.*$/, "") })));
      if (it.slot) {
        const b = button("Equip", () => void act({ action: "equip", item: it.item }), Boolean(it.needs));
        if (it.needs) b.title = it.needs;
        r.append(b);
      }
    }
    body.append(emptyP("Gear takes a slot each; other goods stack 20 to a slot. A full pack takes nothing more."));
  } else if (store.tab === "world") {
    // The people of this place (N16), highest first, and the laws that bind them.
    const r = crowd.sim?.roster;
    if (r) {
      h(`The people of ${r.place}`);
      const out = crowd.pos.filter((x) => x.visible).length;
      body.append(emptyP(`${r.people.length.toLocaleString()} townsfolk, ${out.toLocaleString()} out and about now${r.lord ? `, under ${r.lord}` : ""}${r.ruler && r.ruler !== r.lord ? `; the crown is ${r.ruler}'s` : ""}. ${r.laws.slavery ? "Slavery is lawful here." : r.laws.serfdom ? "Serfs are bound to the land here." : "Everyone here is free."}`));
      for (const cls of [...CLASSES].reverse()) {
        const n = r.people.filter((x) => x.cls === cls).length;
        if (n > 0) row(cls === "gentry" ? "gentry" : cls === "artisan" ? "craftsmen" : `${CLASS_WORDS[cls]}s`, n.toLocaleString());
      }
      const facs = new Map<string, number>();
      for (const x of r.people) if (x.factionName) facs.set(x.factionName, (facs.get(x.factionName) ?? 0) + 1);
      if (facs.size > 0) body.append(emptyP(`Sworn to factions: ${[...facs].sort((a, b) => b[1] - a[1]).map(([n, c]) => `${n} (${c})`).join(", ")}.`));
    }
    h("How the village sees you");
    body.append(emptyP(p.reputation.words ? `As ${p.reputation.words}.` : "Nobody's made up their mind about you yet."));
    row("trust · fear · respect · liking", `${p.reputation.trust} · ${p.reputation.fear} · ${p.reputation.respect} · ${p.reputation.affection}`);
    if (p.bounty) {
      h("Wanted");
      body.append(emptyP(`The guard wants you for ${p.crimes.join(", ")}. Fine: ${coins(p.bounty)}. Pay it or give yourself up to the guard.`));
    }
    h("Factions");
    for (const f of p.factions) {
      const r = row(f.name, `${f.rank} (${f.standing})`);
      if (!f.member) r.append(button("Join", () => void act({ action: "join", faction: f.id })));
    }
    h("Travelling with you");
    body.append(emptyP(p.party.length ? p.party.join(", ") : "Nobody. Some will come along for a daily wage."));
    h("Families");
    if (s.family.length === 0) body.append(emptyP("No weddings or births yet. Folk who grow fond of each other court, marry and have children."));
    for (const l of s.family) body.append(emptyP(l));
    h("The chronicle");
    if (s.chronicle.lore.length === 0) body.append(emptyP("Nothing yet. It's written at midnight, from what happened."));
    for (const l of s.chronicle.lore) body.append(emptyP(l));
  } else if (store.tab === "realm") {
    renderRealm(body);
  } else {
    h("Active quests");
    if (p.quests.length === 0) body.append(emptyP("None. Ask around for work."));
    for (const q of p.quests) {
      row(`[${q.tier}] ${q.title}`, `${q.have}/${q.qty} ${q.item}`);
      body.append(el("div", { className: "empty", textContent: `For ${q.giver}. Reward ${coins(q.money)}.` }));
    }
    if (p.completed) body.append(emptyP(`${p.completed} completed.`));
    if (p.failed) body.append(emptyP(`${p.failed} failed.`));
    h("Journal");
    if (p.journal.length === 0) body.append(emptyP("Nothing yet. Secrets, likes, promises and names you learn go here."));
    for (const g of p.journal) {
      body.append(el("h4", { textContent: g.who }));
      for (const l of g.lines.slice(-8)) body.append(emptyP(l));
    }
  }
}

export function renderHeader(): void {
  const s = game();
  // Out at a locality (N15): "Ashby · The road out".
  const where = s.road ? `On ${s.road.where}` : s.site.area.id === "village" ? s.site.name : `${s.site.name} · ${s.site.area.name}`;
  $("site-name").textContent = where;
  const ways = s.site.area.exits.length > 0 ? ` Walk off the map's edge: ${s.site.area.exits.join(", ")}.` : "";
  $("site-name").title = `${s.site.name}, a ${s.site.kind}${s.site.kingdom ? ` of ${s.site.kingdom}` : ""}. Travel from the Realm tab.${ways}`;
  document.title = where;
  $("time").textContent = s.time.text;
  $("today").textContent = `${s.time.weather}, ${s.time.season}${s.time.events.length ? ` · ${s.time.events.join(", ")}` : ""}`;
  $("today").title = s.time.today;
  const p = s.player;
  $("hpbar").textContent = `HP ${p.hp}/${p.maxHp}`;
  $("mpbar").textContent = `MP ${p.mp}/${p.maxMp}`;
  $("gold").textContent = coins(p.money);
  $("llm").textContent = s.llm.ready ? (s.queue > 0 ? `model busy (${s.queue} waiting)` : "model ready") : "model offline";
  $("llm").className = `pill ${s.llm.ready ? "ok" : "err"}`;
  $("banner").hidden = s.llm.ready;
  $("banner").textContent = s.llm.error || "";
  const vb = $("voice-btn");
  vb.classList.toggle("off", !speaker.prefs.voices);
  vb.textContent = speaker.prefs.voices ? "🔊 Voices" : "🔇 Voices";
}

export function setUpSheet(): void {
  onRender(renderHeader);
  onRender(renderSheet);
  $("tabs").addEventListener("click", (e) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>("[data-tab]")?.dataset.tab;
    if (!t) return;
    store.tab = t;
    for (const b of $("tabs").children) b.classList.toggle("on", (b as HTMLElement).dataset.tab === t);
    renderSheet();
  });
}
