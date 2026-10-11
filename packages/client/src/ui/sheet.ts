/** The side sheet: character, inventory, quests and the world, plus the header pills. */
import { $, coins, el, emptyP } from "../dom";
import { act, onRender } from "../game";
import { game, store } from "../store";
import { speaker } from "../voice/speaker";
import { button } from "./modals";

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
      if (it.slot) {
        const b = button("Equip", () => void act({ action: "equip", item: it.item }), Boolean(it.needs));
        if (it.needs) b.title = it.needs;
        r.append(b);
      }
    }
    body.append(emptyP("Gear takes a slot each; other goods stack 20 to a slot. A full pack takes nothing more."));
  } else if (store.tab === "world") {
    h("How the village sees you");
    body.append(emptyP(p.reputation.words ? `As ${p.reputation.words}.` : "Nobody's made up their mind about you yet."));
    row("trust · fear · respect · liking", `${p.reputation.trust} · ${p.reputation.fear} · ${p.reputation.respect} · ${p.reputation.affection}`);
    if (p.bounty) {
      h("Wanted");
      body.append(emptyP(`The guard wants you for ${p.crimes.join(", ")}. Fine: ${coins(p.bounty)}. Pay it or give yourself up to Corporal Hale.`));
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
