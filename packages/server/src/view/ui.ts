/**
 * The UI model (G5): what each panel holds, with every sentence written and every button an intent. The text
 * here was built in the browser before (ui/chat.ts, sheet.ts, roadbar.ts, realm.ts, modals.ts); an adapter now
 * only lays it out. It reads the snapshot and never changes the game.
 */
import { CLASSES, CLASS_WORDS, DEFAULT_VOICE, type NpcView, type RealmView, type Snapshot } from "@millbrook/shared";
import type { Intent, UiAction, UiModel } from "@millbrook/shared/view";
import { formatMoney as coins } from "../game/money.js";
import type { CrowdClock, Traveller } from "./frame.js";

type Section = UiModel["sheet"]["tabs"][number]["sections"][number];
type Row = Section["rows"][number];
export type FeedLine = UiModel["feed"]["lines"][number];

export const SPEEDS = {
  slow: { hours: 1, everyMs: 3000, label: "1h / 3s" },
  normal: { hours: 1, everyMs: 1000, label: "1h / 1s" },
  fast: { hours: 4, everyMs: 500, label: "4h / 0.5s" },
  days: { hours: 24, everyMs: 500, label: "1 day / 0.5s" },
} as const;
export type Speed = keyof typeof SPEEDS;

/** What the panels need that isn't the game: the session's own state. */
export interface UiState {
  talking: string | null;
  logs: Record<string, Array<{ kind: string; text: string }>>;
  feed: FeedLine[];
  modal: { kind: string; arg?: string } | null;
  realmSelected: string | null;
  timeFlows: boolean;
  simulate: { speed: Speed; running: boolean; note: string | null };
  busy: boolean;
  traveller: Traveller | null;
  crowd: CrowdClock;
  realm: RealmView | null;
}

// ---------- helpers ----------

export const act = (action: string, args: Record<string, unknown> = {}): Intent => ({ t: "act", action, args });
const panel = (name: string, arg?: string): Intent => ({ t: "panel", panel: name, ...(arg ? { arg } : {}) });

function button(id: string, label: string, intent: Intent, o: { enabled?: boolean; why?: string; style?: UiAction["style"]; input?: UiAction["input"] } = {}): UiAction {
  return { id, label, enabled: o.enabled ?? true, intent, ...(o.why ? { why: o.why } : {}), ...(o.style ? { style: o.style } : {}), ...(o.input ? { input: o.input } : {}) };
}

/** Rows for a section, written as a list. */
class Sheet {
  readonly sections: Section[] = [];
  private cur: Section | null = null;
  h(title: string): this {
    this.cur = { title, rows: [] };
    this.sections.push(this.cur);
    return this;
  }
  p(text: string): this {
    return this.row({ text });
  }
  kv(text: string, value: string, actions?: UiAction[]): this {
    return this.row({ text, value, ...(actions?.length ? { actions } : {}) });
  }
  bar(frac: number): this {
    const last = this.cur?.rows.at(-1);
    if (last) last.bar = Math.max(0, Math.min(1, frac));
    return this;
  }
  row(r: Row): this {
    if (!this.cur) this.h("");
    this.cur!.rows.push(r);
    return this;
  }
}

const npcOf = (s: Snapshot, id: string | null): NpcView | undefined => (id ? s.npcs.find((n) => n.id === id) : undefined);

// ---------- header ----------

function header(s: Snapshot, st: UiState): UiModel["header"] {
  const where = s.road ? `On ${s.road.where}` : s.site.area.id === "village" ? s.site.name : `${s.site.name} · ${s.site.area.name}`;
  const ways = s.site.area.exits.length > 0 ? ` Walk off the map's edge: ${s.site.area.exits.join(", ")}.` : "";
  const busy = st.busy;
  return {
    place: where,
    placeTip: `${s.site.name}, a ${s.site.kind}${s.site.kingdom ? ` of ${s.site.kingdom}` : ""}. Travel from the Realm tab.${ways}`,
    clock: s.time.text,
    today: `${s.time.weather}, ${s.time.season}${s.time.events.length ? ` · ${s.time.events.join(", ")}` : ""}`,
    todayTip: s.time.today,
    hp: `HP ${s.player.hp}/${s.player.maxHp}`,
    mp: `MP ${s.player.mp}/${s.player.maxMp}`,
    coin: coins(s.player.money),
    model: { ready: s.llm.ready, text: s.llm.ready ? (s.queue > 0 ? `model busy (${s.queue} waiting)` : "model ready") : "model offline", banner: s.llm.ready ? "" : s.llm.error },
    busy,
    actions: [
      button("forage", "Forage", act("forage"), { enabled: !busy, why: "Gather herbs and pelts where they grow (by the gate)" }),
      button("craft", "Craft…", panel("craft"), { enabled: !busy, why: "Make something yourself: smithing at the forge, brewing and cooking at the inn" }),
      button("sneak", "Sneak", act("sneak"), { enabled: !busy, why: "Try to move unseen here" }),
      button("wait1", "Wait 1h", act("wait", { hours: 1 }), { enabled: !busy }),
      button("wait4", "Wait 4h", act("wait", { hours: 4 }), { enabled: !busy }),
      button("newgame", "New game", { t: "newGame" }, { style: "ghost" }),
    ],
    time: { flows: st.timeFlows, shown: s.timeFlowSeconds > 0 },
    simulate: { speed: st.simulate.running ? st.simulate.speed : "off", note: st.simulate.running ? (st.simulate.note ?? `${SPEEDS[st.simulate.speed].hours}h a step`) : null, speeds: (Object.keys(SPEEDS) as Speed[]).map((id) => ({ id, label: SPEEDS[id].label })) },
  };
}

// ---------- the conversation ----------

const MODES = [
  { id: "say", label: "Say", placeholder: "Say something…" },
  { id: "persuade", label: "Persuade", placeholder: "Words to persuade with…" },
  { id: "intimidate", label: "Intimidate", placeholder: "Words to intimidate with…" },
  { id: "haggle", label: "Haggle", placeholder: "Make your case on the price…" },
  { id: "lie", label: "Lie", placeholder: "Words to lie with…" },
];

function chat(s: Snapshot, st: UiState): UiModel["chat"] {
  const npc = npcOf(s, st.talking);
  if (!npc || !st.talking) return { open: false };
  const p = s.player;
  const busy = st.busy;
  const rank = npc.atPeak ? `rank ${npc.rank} (peak)` : npc.readyToBreakThrough ? `rank ${npc.rank} (ready to break through)` : `rank ${npc.rank} (${npc.rankXp}/${npc.rankXpNext} xp, max ${npc.potential})`;
  const bond = [npc.friendship, npc.respect ? `respect ${npc.respect}` : null, npc.fear ? `fear ${npc.fear}` : null, npc.knowsYouAs ? `knows you as ${npc.knowsYouAs}` : "doesn't know your name"].filter(Boolean).join(", ");
  const stats = [
    rank,
    `mood: ${npc.mood}`,
    `trust: ${npc.trust}`,
    bond,
    `HP ${npc.hp}/${npc.maxHp}`,
    npc.doing,
    npc.grudge ? `grudge: ${npc.grudge}` : null,
    npc.feeling ? `feels ${npc.feeling}` : null,
    npc.busy ? `busy ${npc.busy}` : null,
    npc.inCombat ? "⚔ in a fight" : null,
    npc.statuses ? `(${npc.statuses})` : null,
    npc.health.length ? npc.health.join(", ") : null,
    npc.companion ? `with you · loyalty ${npc.companion.loyalty}${npc.companion.unpaidDays ? `, ${npc.companion.unpaidDays} day(s) unpaid` : ""}` : null,
    npc.factionView ? npc.factionView.replace(/^As one of /, "one of ").replace(/\.$/, "") : null,
    npc.revenge ? `wants revenge (${npc.revenge})` : null,
    npc.plan ? `today: ${npc.plan.join("; ")}` : null,
    npc.family,
  ].filter((x): x is string => Boolean(x));

  // Offers waiting for an answer.
  const pend = npc.pending;
  const offers: Array<{ text: string; actions: UiAction[] }> = [];
  const yesNo = (kind: string, text: string) =>
    offers.push({ text, actions: [button(`accept:${kind}`, "Accept", act("accept", { kind, npc: npc.id }), { style: "yes", enabled: !busy }), button(`decline:${kind}`, "Decline", act("decline", { kind, npc: npc.id }), { enabled: !busy })] });
  if (pend.quest) yesNo("quest", `Job [${pend.quest.tier}] "${pend.quest.title}": ${pend.quest.goal} for ${coins(pend.quest.money)}.`);
  if (pend.training) yesNo("training", `Train ${pend.training.skill.replace("_", "-")} for ${pend.training.hours}h, ${coins(pend.training.cost)} (you have ${coins(p.money)}).`);
  if (pend.purchase) yesNo("purchase", `Sell your ${pend.purchase.item} for ${coins(pend.purchase.price)}?`);
  if (pend.offer) yesNo("offer", `Buy ${pend.offer.item} for ${coins(pend.offer.price)}? (you have ${coins(p.money)})`);
  if (pend.favour) yesNo("favour", `Favour: ${pend.favour.kind.replace("_", " ")}${pend.favour.amount ? ` of ${coins(pend.favour.amount)}` : ""}${pend.favour.item ? ` (${pend.favour.item})` : ""}. You'll owe them one.`);
  if (pend.amends) yesNo("amends", `Pay ${coins(pend.amends.fine)} to make amends?`);
  if (pend.service) yesNo("service", `${pend.service.kind === "lodging" ? "A room for the night" : "Tend your wounds"} for ${coins(pend.service.price)}?`);
  if (npc.pendingHire) yesNo("hire", `${npc.name} will come with you for ${coins(npc.pendingHire.wage)} a day (first day now).`);
  if (npc.pendingCommission) yesNo("commission", `Have ${npc.name} make you a ${npc.pendingCommission} to order (deposit now)?`);
  if (npc.dilemma) offers.push({ text: `${npc.name} asks you to choose: ${npc.dilemma.offer}.`, actions: npc.dilemma.options.map((o) => button(`choose:${o.id}`, o.label, act("choose", { npc: npc.id, option: o.id }), { enabled: !busy })) });

  // Quick lines.
  const lines = ["Hello there.", "What's for sale?", "Any work for me?", "Could you teach me something?", "Tell me about this place."];
  if (npc.services.some((x) => x.kind === "lodging")) lines.push("Could I get a room for the night?");
  if (npc.services.some((x) => x.kind === "heal") && p.hp < p.maxHp) lines.push("Could you tend my wounds?");
  if (npc.grudge) lines.push("I'm sorry. How can I make it right?");
  if (npc.hire && !npc.companion) lines.push("Would you come with me? I can pay.");
  lines.push("Heard any gossip?");
  const quick = lines.map((l, i) => button(`quick:${i}`, l, { t: "say", mode: "say", text: l }, { enabled: !busy }));

  // Tools: what can be done with them now.
  const tools: UiAction[] = [];
  const tool = (id: string, label: string, intent: Intent, style?: UiAction["style"], why?: string) => tools.push(button(id, label, intent, { enabled: !busy, ...(style ? { style } : {}), ...(why ? { why } : {}) }));
  const on = (action: string) => act(action, { npc: npc.id });
  tool("turnin", "Hand in quests", on("turnin"));
  if (npc.teaches.length > 0) tool("train", "Train…", panel("train"));
  if (npc.wares.length > 0) tool("wares", "Wares", panel("wares"));
  if (npc.repairs) tool("repair", "Repair…", panel("repair"));
  tool("look", "Look", on("look"));
  if (npc.knowsYouAs !== p.name) tool("introduce", "Introduce yourself", on("introduce"));
  tool("give", "Give…", panel("give"));
  tool("favour", "Ask a favour…", panel("favour"));
  if (npc.makes.length > 0 && npc.commission === null) tool("order", "Order…", panel("order"));
  if (npc.commission?.status === "ready") tool("collect", "Collect order", on("collect"));
  if (npc.loan) tool("repay", "Repay loan", on("repay"));
  if (npc.kept) tool("retrieve", "Take back what they hid", on("retrieve"));
  tool("steal", "Steal…", panel("steal"), "danger");
  if (npc.guard && p.bounty) {
    tool("payfine", "Pay fine", on("payfine"));
    tool("surrender", "Give yourself up", on("surrender"));
  }
  if (npc.companion) tool("dismiss", "Dismiss", on("dismiss"));
  if (npc.canPropose) tool("propose", "Ask to marry", on("propose"));
  // The N38 menu, done by the player: the same exchange NPCs choose.
  if (!npc.minor) {
    tool("insult", "Insult", on("insult"), "danger", "Say something cutting: they'll remember it");
    tool("confront", "Confront", on("confront"), "danger", "Have it out with them over a wrong");
  }
  tool("flee", "Flee", on("flee"), "danger");
  if (npc.inCombat && p.abilities.length > 0) tool("ability", "Ability…", panel("ability"), "danger");
  // A child is never attacked (design rule 7): the server refuses, so it isn't offered.
  if (!npc.minor) {
    tool("subdue", "Subdue", on("subdue"), "danger", "Fight to knock them out, not to kill");
    tool("attack", "Attack", on("attack"), "danger");
  }

  return {
    open: true,
    npc: npc.id,
    name: npc.titles.length > 0 ? `${npc.name}, ${npc.titles.join(", ")}` : npc.name,
    role: `${npc.role} · ${npc.age}-year-old ${npc.species}${npc.ageStage === "elder" || npc.ageStage === "venerable" ? ` (${npc.ageStage})` : ""}`,
    stats,
    log: (st.logs[npc.id] ?? []).slice(-120),
    offers,
    quick,
    modes: MODES,
    tools,
  };
}

// ---------- the side sheet ----------

function skillsTab(s: Snapshot, busy: boolean): Section[] {
  const p = s.player;
  const t = new Sheet().h(`${p.name}${p.titles.length > 0 ? `, ${p.titles.join(", ")}` : ""}, level ${p.level} (rank ${p.rank})`).p(p.look);
  t.kv("XP", `${p.xp}/${p.xpNext}`).bar(p.xp / Math.max(1, p.xpNext));
  t.kv("MP", `${p.mp}/${p.maxMp}`);
  if (p.statuses) t.kv("Status", p.statuses);
  if (p.health.length) t.kv("Ailing", p.health.join(", "));
  t.h(`Attributes${p.attributePoints ? ` (${p.attributePoints} point${p.attributePoints > 1 ? "s" : ""} to spend)` : ""}`);
  for (const [k, v] of Object.entries(p.attributes)) t.kv(k, String(v), p.attributePoints ? [button(`raise:${k}`, "+1", act("raise", { attribute: k }), { enabled: !busy })] : undefined);
  t.h("Skills");
  if (p.skills.length === 0) t.p("No trained skills yet.");
  for (const sk of p.skills) {
    t.kv(sk.skill.replace("_", "-"), sk.needed ? `${sk.tier} (${sk.progress}/${sk.needed}h)` : sk.tier);
    if (sk.needed) t.bar(sk.progress / sk.needed);
  }
  return t.sections;
}

function invTab(s: Snapshot, busy: boolean): Section[] {
  const p = s.player;
  const t = new Sheet().h("Equipped");
  for (const slot of ["weapon", "armor"]) {
    const g = p.gear[slot];
    t.kv(slot, g ? `${g.item}${g.broken ? " (broken)" : ""}` : "nothing", g ? [button(`unequip:${slot}`, "Take off", act("unequip", { slot }), { enabled: !busy && p.pack.used < p.pack.slots })] : undefined);
  }
  t.p(`Fighting with ${p.fightingWith}; armour stops ${p.armorValue} a hit. You can use gear up to tier ${p.gearTier}.`);
  t.h(`Pack (${p.pack.used}/${p.pack.slots} slots)`);
  t.kv("Money", coins(p.money));
  if (p.items.length === 0) t.p("Nothing but lint.");
  for (const it of p.items) {
    const name = it.item.replace(/ \[.*$/, "");
    const acts: UiAction[] = [];
    // Food and drink (N26): eaten on the road or anywhere; a mount eats what it can.
    if (/^(bread loaf|stew|eggs|turnips|ale|wild herbs)\b/.test(it.item)) acts.push(button(`eat:${it.item}`, "Eat", act("eat", { item: name }), { enabled: !busy }));
    if (s.road?.mount && /^(turnips|bread loaf|wild herbs)\b/.test(it.item)) acts.push(button(`feed:${it.item}`, "Feed", act("mount", { op: "feed", item: name }), { enabled: !busy }));
    if (it.slot) acts.push(button(`equip:${it.item}`, "Equip", act("equip", { item: it.item }), { enabled: !busy && !it.needs, ...(it.needs ? { why: it.needs } : {}) }));
    t.kv(it.item, `×${it.qty}`, acts);
  }
  t.p("Gear takes a slot each; other goods stack 20 to a slot. A full pack takes nothing more.");
  return t.sections;
}

function questsTab(s: Snapshot): Section[] {
  const p = s.player;
  const t = new Sheet().h("Active quests");
  if (p.quests.length === 0) t.p("None. Ask around for work.");
  for (const q of p.quests) {
    t.kv(`[${q.tier}] ${q.title}`, `${q.have}/${q.qty} ${q.item}`);
    t.p(`For ${q.giver}. Reward ${coins(q.money)}.`);
  }
  if (p.completed) t.p(`${p.completed} completed.`);
  if (p.failed) t.p(`${p.failed} failed.`);
  t.h("Journal");
  if (p.journal.length === 0) t.p("Nothing yet. Secrets, likes, promises and names you learn go here.");
  for (const g of p.journal) {
    t.h(g.who);
    for (const l of g.lines.slice(-8)) t.p(l);
  }
  return t.sections;
}

function worldTab(s: Snapshot, st: UiState): Section[] {
  const p = s.player;
  const t = new Sheet();
  // The people of this place (N16), highest first.
  const r = st.crowd.sim?.roster;
  if (r) {
    t.h(`The people of ${r.place}`);
    const out = st.crowd.pos.filter((x) => x.visible).length;
    t.p(`${r.people.length.toLocaleString()} townsfolk, ${out.toLocaleString()} out and about now${r.lord ? `, under ${r.lord}` : ""}${r.ruler && r.ruler !== r.lord ? `; the crown is ${r.ruler}'s` : ""}. ${r.laws.slavery ? "Slavery is lawful here." : r.laws.serfdom ? "Serfs are bound to the land here." : "Everyone here is free."}`);
    for (const cls of [...CLASSES].reverse()) {
      const n = r.people.filter((x) => x.cls === cls).length;
      if (n > 0) t.kv(cls === "gentry" ? "gentry" : cls === "artisan" ? "craftsmen" : `${CLASS_WORDS[cls]}s`, n.toLocaleString());
    }
    const facs = new Map<string, number>();
    for (const x of r.people) if (x.factionName) facs.set(x.factionName, (facs.get(x.factionName) ?? 0) + 1);
    if (facs.size > 0) t.p(`Sworn to factions: ${[...facs].sort((a, b) => b[1] - a[1]).map(([n, c]) => `${n} (${c})`).join(", ")}.`);
  }
  t.h("How the village sees you").p(p.reputation.words ? `As ${p.reputation.words}.` : "Nobody's made up their mind about you yet.");
  t.kv("trust · fear · respect · liking", `${p.reputation.trust} · ${p.reputation.fear} · ${p.reputation.respect} · ${p.reputation.affection}`);
  if (p.bounty) t.h("Wanted").p(`The guard wants you for ${p.crimes.join(", ")}. Fine: ${coins(p.bounty)}. Pay it or give yourself up to the guard.`);
  t.h("Factions");
  for (const f of p.factions) t.kv(f.name, `${f.rank} (${f.standing})`, f.member ? undefined : [button(`join:${f.id}`, "Join", act("join", { faction: f.id }), { enabled: !st.busy })]);
  t.h("Travelling with you").p(p.party.length ? p.party.join(", ") : "Nobody. Some will come along for a daily wage.");
  t.h("Families");
  if (s.family.length === 0) t.p("No weddings or births yet. Folk who grow fond of each other court, marry and have children.");
  for (const l of s.family) t.p(l);
  t.h("The chronicle");
  if (s.chronicle.lore.length === 0) t.p("Nothing yet. It's written at midnight, from what happened.");
  for (const l of s.chronicle.lore) t.p(l);
  return t.sections;
}

/** "5h walking", "2 days' walk". */
const hoursWords = (h: number) => (h <= 10 ? `${h}h walking` : `${Math.round((h / 10) * 2) / 2} days' walk`);

function realmTab(s: Snapshot, st: UiState): Section[] {
  const t = new Sheet();
  const r = st.realm;
  if (!s.realm || !r) return t.h("The realm").p("This world has no wider realm (the server runs with REALM=off).").sections;
  const busy = st.busy;
  const at = (id: string | null) => r.settlements.find((x) => x.id === id);
  const place = at(st.realmSelected) ?? at(s.site.id) ?? r.settlements.find((x) => x.here);
  if (place) {
    t.h(`${place.name} (${place.abandoned ? "abandoned " : ""}${place.kind})`);
    const liege = at(place.liege);
    t.p(`${place.population} people · prosperity ${place.prosperity} · food ${place.food} · coffers ${coins(place.treasury)}. Head: ${place.leader ?? "no one"}. ${liege ? `Pays ${Math.round(place.taxRate * 100)}% in taxes to ${liege.name}${place.arrears ? ` (${place.arrears} tax days behind)` : ""}.` : "Answers to no one."}`);
    const b = Object.entries(place.buildings).map(([k, v]) => `${k} ${v}`).join(", ");
    t.p(`Buildings: ${b || "none"}${place.project ? `. Building: ${place.project}` : ""}.`);
    const here = r.factions.filter((f) => f.branches.includes(place.name));
    if (here.length) t.p(`Here: ${here.map((f) => f.name).join(", ")}.`);
  }
  // Travel (N14).
  t.h(`Travel (you're in ${s.site.name})`);
  const dest = place ? s.site.destinations.find((d) => d.id === place.id) : undefined;
  if (place && dest) {
    const acts = [button(`travel:${dest.id}`, `Walk to ${dest.name}`, act("travel", { to: dest.id }), { enabled: !busy })];
    if (!s.road && s.site.kind !== "hamlet" && s.site.kind !== "village") acts.push(button(`coach:${dest.id}`, `Coach to ${dest.name}`, act("coachquote", { to: dest.id }), { enabled: !busy }));
    t.row({ text: `To ${dest.name}: about ${hoursWords(dest.hours)} on the road${dest.dangers.length ? `. On the way: ${dest.dangers.join(", ")}` : ", and the road is quiet"}.`, actions: acts });
  } else if (place && place.id === s.site.id) t.p("Click a place on the map to see the road there.");
  const near = s.site.destinations.slice(0, 5);
  if (near.length) t.row({ text: "Nearest:", actions: near.map((d) => button(`travel:${d.id}`, `${d.name} · ${hoursWords(d.hours)}`, act("travel", { to: d.id }), { enabled: !busy, why: d.dangers.length ? `On the way: ${d.dangers.join(", ")}` : "A quiet road" })) });
  // Adventuring.
  t.h("Adventuring");
  const adv = s.adventurer;
  if (adv.member) t.p(`You're a guild ${adv.rank ?? "member"} (renown ${adv.renown}).`);
  else t.row({ text: `Members of the adventurers' guild delve the dungeons for treasure. Joining costs ${coins(adv.fee)}.`, actions: [button("joinguild", "Join the guild", act("joinguild"), { enabled: !busy && s.player.money >= adv.fee })] });
  for (const d of adv.dungeons) {
    t.kv(`${d.name} [${d.tier}, ${d.depth} levels]`, d.cleared ? "cleared" : `danger ${d.danger}${d.bounty ? `, bounty ${coins(d.bounty)}` : ""}`, adv.member && !d.cleared && d.here ? [button(`delve:${d.id}`, "Delve", act("delve", { dungeon: d.id }), { enabled: !busy })] : undefined);
    if (adv.member && !d.cleared && !d.here) t.p(`${d.mouth}. Walk there to go down.`);
  }
  t.h("Wars");
  if (r.wars.length === 0) t.p("Peace, for now.");
  for (const w of r.wars.slice().reverse()) t.p(`${w.attackers.join(" & ")} against ${w.defenders.join(" & ")} (${w.cause}), from day ${w.start}: ${w.end !== null ? `over on day ${w.end}, ${w.outcome}` : `${w.battles} battles, score ${w.score}`}.`);
  t.h(`Treaties (${r.treaties.length})`);
  for (const x of r.treaties.slice(0, 12)) t.p(`${x.kind.replace("_", " ")}: ${x.a} and ${x.b} (${x.why}), until day ${x.until}.`);
  t.h(`Factions (${r.factions.length})`);
  for (const f of r.factions) t.p(`${f.name} [${f.kind}]${f.parent ? ` (split from ${f.parent})` : ""}: "${f.creed}". ${f.size} members${f.branches.length ? `, halls in ${f.branches.join(", ")}` : ""}. ${f.members.join(", ")}`);
  t.h("Notable people");
  for (const n of r.notables.slice(0, 16)) t.p(`${n.name}: ${n.role}, rank ${n.rank}, renown ${n.renown}${n.home ? `, of ${n.home}` : ""}${n.superior ? `; answers to ${n.superior}` : ""}${n.talks ? " (you can talk to them)" : ""}${n.rose ? " (rose from the crowd)" : ""}.${n.deeds.length ? ` ${n.deeds.join("; ")}.` : ""}`);
  t.h("Beasts");
  for (const x of r.packs.slice(0, 10)) t.p(`${x.count} ${x.species}s near ${x.near} (the land feeds ${x.cap})${x.alpha ? `, led by ${x.alpha}` : ""}${x.bounty ? `; bounty ${coins(x.bounty)}` : ""}.`);
  t.h("Dungeons");
  for (const d of r.dungeons) t.p(`${d.name} near ${d.near}: rank ${d.tier}, ${d.depth} levels, danger ${d.danger}${d.cleared ? ", cleared for now" : ""}${d.bounty ? `, bounty ${coins(d.bounty)}` : ""}.`);
  t.h("News from the realm");
  for (const n of r.news.slice(0, 20)) t.p(`Day ${n.day}: ${n.text}${n.heard ? "" : " (not heard here yet)"}`);
  t.h("What the director pushed");
  for (const d of r.director) t.p(`Day ${d.day}: ${d.kind.replace(/_/g, " ")} (${d.reason})${d.ok ? "" : ", but it came to nothing"}.`);
  return t.sections;
}

// ---------- the road bar ----------

const JOINABLE = ["caravan", "pilgrims", "adventurers", "patrol", "migrants", "refugees"];

function roadbar(s: Snapshot, st: UiState): UiModel["roadbar"] {
  const r = s.road;
  if (!r) return { shown: false, items: [], actions: [] };
  const busy = st.busy;
  const items: UiModel["roadbar"]["items"] = [{ text: r.off ? `Off the road (${r.off} tiles) · ${r.where}` : r.where }];
  for (const e of r.ends) items.push({ text: `${e.name}: ${e.walk}`, dim: true });
  const actions: UiAction[] = [];
  if (r.dest) {
    items.push({ text: `→ ${r.dest.name}: ${r.dest.walk}` });
    actions.push(button("walk", "Walk", act("walk"), { enabled: !busy, why: "Walk the road to your destination (any key stops)" }));
    if (r.canFast) actions.push(button("fasttravel", "Fast travel", act("fasttravel"), { enabled: !busy, why: "Along stretches you've walked before; stops for anything worth stopping for" }));
  }
  if (r.inn) items.push({ text: `An inn nearby: ${r.inn.name}`, dim: true });
  if (r.needs) {
    items.push({ text: "food", need: r.needs.food }, { text: "water", need: r.needs.water }, { text: "rest", need: r.needs.rest });
    if (r.needs.words) items.push({ text: r.needs.words, dim: true });
  }
  if (r.mount) items.push({ text: `${r.mount.name} (${r.mount.kind}${r.mount.lame ? ", lame" : ""})` });
  const who = st.traveller;
  if (who) {
    items.push({ text: `${who.name} (${who.kind})`, dim: true });
    if (JOINABLE.includes(who.kind)) actions.push(button("joinjourney", "Travel with them", act("joinjourney", { journey: who.journey }), { enabled: !busy, why: `Go along with them to ${who.to}: safer, and at their pace` }));
    if (who.kind === "caravan") actions.push(button("rob", "Rob the caravan", act("robask", { journey: who.journey }), { enabled: !busy, style: "danger", why: "A crime. Its guards will fight you." }));
  }
  actions.push(button("camp", "Camp", act("camp"), { enabled: !busy, why: "Make camp off the road: a fire, a watch, rest" }));
  actions.push(button("drink", "Drink", act("drink"), { enabled: !busy, why: "Drink from a river, a well or a trough close by" }));
  for (const n of r.nearby) for (const o of n.offers) actions.push(button(`roadplace:${n.id}:${o.op}`, o.label, act("roadplace", { place: n.id, op: o.op }), { enabled: !busy, why: n.name }));
  return { shown: true, items, actions };
}

// ---------- dialogs ----------

const RECIPES = ["horseshoe", "dagger", "iron sword", "ale", "stew", "healing salve"];
const FAVOURS: Record<string, string> = { lend_gold: "Lend me some gold", vouch: "Put in a good word for me", hide_item: "Hide something for me", warn_me: "Warn me if there's danger" };

function modal(s: Snapshot, st: UiState): UiModel["modal"] {
  const m = st.modal;
  // A choice on the road (N26) comes first: it stays until it is made.
  if (s.road?.pending) {
    const sit = s.road.pending;
    return { kind: "situation", title: sit.title, body: sit.text, sections: [], actions: sit.choices.map((c) => button(`situation:${c.id}`, c.label, act("situation", { situation: sit.id, choice: c.id }), { enabled: !st.busy, ...(c.hint ? { why: c.hint } : {}) })) };
  }
  if (!m) return null;
  const p = s.player;
  const npc = npcOf(s, st.talking);
  const busy = st.busy;
  const t = new Sheet();
  const done = (kind: string, title: string, body = "", actions: UiAction[] = []) => ({ kind, title, body, sections: t.sections, actions });
  if (m.kind === "craft") {
    t.h("").p("Smithing needs the forge; brewing, salves and cooking the inn's kitchen. Better materials make better work.");
    for (const r of RECIPES) t.kv(r, "", [button(`craft:${r}`, "Make", act("craft", { item: r }), { enabled: !busy })]);
    return done("craft", "Make something");
  }
  if (!npc) return null;
  const to = (action: string, args: Record<string, unknown> = {}) => act(action, { npc: npc.id, ...args });
  switch (m.kind) {
    case "train":
      for (const x of npc.teaches) {
        t.h(x.skill.replace("_", "-")).p(`up to ${x.upTo}, ${coins(x.feePerHour)}/hour${x.locked ? `, ${x.locked}` : ""}`);
        t.row({ text: "Hours", actions: [2, 4, 8].map((h) => button(`train:${x.skill}:${h}`, `${h}h`, act("trainquote", { npc: npc.id, skill: x.skill, hours: h }), { enabled: !busy && !x.locked })) });
      }
      return done("train", `${npc.name} can teach`);
    case "wares":
      t.h("");
      for (const w of npc.wares) t.kv(`${w.item} ×${w.qty}`, w.price ? coins(w.price) : `not for sale (${w.reason})`);
      t.p(`Stock: ${npc.stock.used}/${npc.stock.slots} slots${npc.stock.storage ? ` (pack and ${npc.stock.storage})` : ""}.`);
      t.p("Ask to buy something and they'll make an offer. Haggle to lower the price.");
      return done("wares", `${npc.name}'s wares`);
    case "repair": {
      const worn = [
        ...["weapon", "armor"].flatMap((sl) => {
          const g = p.gear[sl];
          return g && g.repairCost > 0 ? [{ which: sl, item: g.item, cost: g.repairCost }] : [];
        }),
        ...p.items.filter((i) => i.repairCost > 0).map((i) => ({ which: i.item, item: i.item, cost: i.repairCost })),
      ];
      t.h("");
      if (worn.length === 0) t.p("Nothing of yours needs mending.");
      for (const w of worn) t.kv(`${w.item} — ${coins(w.cost)}`, "", [button(`repair:${w.which}`, "Repair", to("repair", { which: w.which }), { enabled: !busy && w.cost <= p.money })]);
      return done("repair", `${npc.name} can mend your gear`);
    }
    case "give":
      t.h("");
      for (const it of p.items) t.kv(`${it.item} ×${it.qty}`, "", [button(`give:${it.item}`, "Give", to("give", { what: it.item }), { enabled: !busy })]);
      t.row({ text: "Coin", actions: [button("give:coin", "Give coin", to("give"), { enabled: !busy, input: { arg: "what", placeholder: "e.g. 5 silver" } })] });
      t.p("Something they love counts for more than its price.");
      return done("give", `Give ${npc.name} something`);
    case "favour":
      for (const [kind, label] of Object.entries(FAVOURS)) {
        if (kind === "hide_item") {
          t.h(label);
          if (p.items.length === 0) t.p("You carry nothing to hide.");
          for (const it of p.items) t.kv(it.item, "", [button(`favour:hide:${it.item}`, "Ask", to("ask", { favour: kind, item: it.item }), { enabled: !busy })]);
        } else t.h("").kv(label, "", [button(`favour:${kind}`, "Ask", to("ask", { favour: kind }), { enabled: !busy })]);
      }
      t.h("").p("They decide from how well they know and rate you. Every favour leaves you owing one.");
      return done("favour", "Ask a favour");
    case "order":
      t.h("");
      for (const item of npc.makes) t.kv(item, "", [button(`order:${item}`, "Ask the price", to("commission", { item }), { enabled: !busy })]);
      return done("order", `Order from ${npc.name}`);
    case "steal":
      t.h("").p(npc.busy ? `They're busy (${npc.busy}): easier.` : "Face to face: hard. Better while they're busy, asleep, or after you've slipped about unseen (Sneak). Getting caught is a crime.");
      for (const w of npc.wares) t.kv(`${w.item} ×${w.qty}`, "", [button(`steal:${w.item}`, "Steal", to("steal", { item: w.item }), { enabled: !busy, style: "danger" })]);
      return done("steal", `Steal from ${npc.name}`);
    case "ability":
      t.h("");
      for (const a of p.abilities) t.kv(`${a.name}: ${a.describe} (${a.mp} MP)`, "", [button(`ability:${a.id}`, "Use", to("ability", { ability: a.id }), { enabled: !busy && a.mp <= p.mp })]);
      return done("ability", `Abilities (${p.mp}/${p.maxMp} MP)`);
  }
  return null;
}

// ---------- the whole model ----------

/** Who speaks, for the adapter's voice settings. */
function cast(s: Snapshot): UiModel["cast"] {
  return s.npcs.filter((n) => !n.dead).map((n) => ({ id: n.id, name: n.name, sample: `I'm ${n.name.split(" ")[0]}, ${n.role}.`, voice: (n.voice ?? DEFAULT_VOICE) as unknown as Record<string, unknown> }));
}

export function buildUi(s: Snapshot, st: UiState): UiModel {
  return {
    header: header(s, st),
    feed: { lines: st.feed.slice(-200) },
    chat: chat(s, st),
    sheet: {
      tabs: [
        { id: "skills", label: "Character", sections: skillsTab(s, st.busy) },
        { id: "inv", label: "Inventory", sections: invTab(s, st.busy) },
        { id: "quests", label: "Quests", sections: questsTab(s) },
        { id: "world", label: "World", sections: worldTab(s, st) },
        { id: "realm", label: "Realm", sections: realmTab(s, st) },
      ],
    },
    roadbar: roadbar(s, st),
    realm: st.realm ? ({ ...st.realm, here: s.site.id, selected: st.realmSelected } as unknown as Record<string, unknown>) : null,
    modal: modal(s, st),
    cast: cast(s),
  };
}

/** The panels that changed since `sent` (the feed goes on its own, as `feed` messages). */
export function diffUi(sent: Map<string, string>, ui: UiModel, whole: boolean): Partial<UiModel> | null {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(ui) as Array<keyof UiModel>) {
    if (key === "feed" && !whole) continue;
    const json = JSON.stringify(ui[key]);
    if (!whole && sent.get(key) === json) continue;
    sent.set(key, json);
    out[key] = ui[key];
  }
  return Object.keys(out).length > 0 ? (out as Partial<UiModel>) : null;
}
