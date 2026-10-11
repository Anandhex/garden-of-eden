/** The conversation panel: who you're talking to, the log, offers, quick lines, tools, and the mic. */
import type { NpcView } from "@millbrook/shared";
import { $, coins, el } from "../dom";
import { act, addNote, chatHooks, closeChat, feed, npcById, onRender, renderAll, scrollLog, sendLine } from "../game";
import { game, store } from "../store";
import { micSupported, PushToTalk } from "../voice/mic";
import { speaker } from "../voice/speaker";
import { confirmOrder, showAbilities, showFavours, showGive, showOrders, showRepairs, showSteal, showTraining, showWares } from "./modals";

export function renderChat(rebuildLog = false): void {
  if (!store.talking) return;
  const npc = npcById(store.talking);
  if (!npc) return;
  const s = game();
  $("repair-btn").hidden = !npc.repairs;
  $("chat-role").textContent = `${npc.role} · ${npc.age}-year-old ${npc.species}${npc.ageStage === "elder" || npc.ageStage === "venerable" ? ` (${npc.ageStage})` : ""}`;
  $("chat-name").textContent = npc.titles.length > 0 ? `${npc.name}, ${npc.titles.join(", ")}` : npc.name;
  const stats = $("chat-stats");
  stats.replaceChildren();
  const rank = npc.atPeak ? `rank ${npc.rank} (peak)` : npc.readyToBreakThrough ? `rank ${npc.rank} (ready to break through)` : `rank ${npc.rank} (${npc.rankXp}/${npc.rankXpNext} xp, max ${npc.potential})`;
  const bond = [npc.friendship, npc.respect ? `respect ${npc.respect}` : null, npc.fear ? `fear ${npc.fear}` : null, npc.knowsYouAs ? `knows you as ${npc.knowsYouAs}` : "doesn't know your name"]
    .filter(Boolean)
    .join(", ");
  for (const line of [
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
  ]) {
    if (line) stats.append(el("span", { textContent: line }));
  }
  if (rebuildLog) {
    $("log").replaceChildren();
    for (const m of store.logs[store.talking] ?? []) $("log").append(el("div", { className: m.kind.startsWith("note") ? m.kind : `msg ${m.kind}`, textContent: m.text }));
    scrollLog();
  }
  renderOffers(npc);
  renderQuick(npc);
  const tool = (what: string) => $("tools").querySelector<HTMLButtonElement>(`[data-do="${what}"]`)!;
  tool("train").hidden = npc.teaches.length === 0;
  tool("wares").hidden = npc.wares.length === 0;
  $("order-btn").hidden = npc.makes.length === 0 || npc.commission !== null;
  $("collect-btn").hidden = npc.commission?.status !== "ready";
  $("repay-btn").hidden = !npc.loan;
  $("retrieve-btn").hidden = !npc.kept;
  tool("introduce").hidden = npc.knowsYouAs === s.player.name;
  $("payfine-btn").hidden = !npc.guard || !s.player.bounty;
  $("surrender-btn").hidden = !npc.guard || !s.player.bounty;
  $("dismiss-btn").hidden = !npc.companion;
  $("propose-btn").hidden = !npc.canPropose;
  // A child is never attacked (design rule 7): the server refuses, so don't offer it.
  tool("attack").hidden = npc.minor;
  tool("subdue").hidden = npc.minor;
  tool("ability").hidden = !npc.inCombat || s.player.abilities.length === 0;
}

function renderQuick(npc: NpcView): void {
  const box = $("quick");
  box.replaceChildren();
  const p = game().player;
  const lines = ["Hello there.", "What's for sale?", "Any work for me?", "Could you teach me something?", "Tell me about this place."];
  if (npc.services.some((x) => x.kind === "lodging")) lines.push("Could I get a room for the night?");
  if (npc.services.some((x) => x.kind === "heal") && p.hp < p.maxHp) lines.push("Could you tend my wounds?");
  if (npc.grudge) lines.push("I'm sorry. How can I make it right?");
  if (npc.hire && !npc.companion) lines.push("Would you come with me? I can pay.");
  lines.push("Heard any gossip?");
  for (const l of lines) {
    const b = el("button", { type: "button", textContent: l, disabled: store.working });
    b.onclick = () => sendLine("say", l);
    box.append(b);
  }
}

function renderOffers(npc: NpcView): void {
  const box = $("offers");
  box.replaceChildren();
  const p = npc.pending;
  const money = game().player.money;
  const offer = (label: string, buttons: Array<[string, () => void, string?]>) => {
    const line = el("div", { className: "offer" });
    const btns = el("div", { className: "btns" });
    for (const [text, onClick, cls] of buttons) {
      const b = el("button", { type: "button", textContent: text, className: cls ?? "" });
      b.onclick = onClick;
      btns.append(b);
    }
    line.append(el("span", { textContent: label }), btns);
    box.append(line);
  };
  const add = (kind: string, label: string) =>
    offer(label, [
      ["Accept", () => void act({ action: "accept", kind, npc: npc.id }), "yes"],
      ["Decline", () => void act({ action: "decline", kind, npc: npc.id })],
    ]);
  if (p.quest) add("quest", `Job [${p.quest.tier}] "${p.quest.title}": ${p.quest.goal} for ${coins(p.quest.money)}.`);
  if (p.training) add("training", `Train ${p.training.skill.replace("_", "-")} for ${p.training.hours}h, ${coins(p.training.cost)} (you have ${coins(money)}).`);
  if (p.purchase) add("purchase", `Sell your ${p.purchase.item} for ${coins(p.purchase.price)}?`);
  if (p.offer) add("offer", `Buy ${p.offer.item} for ${coins(p.offer.price)}? (you have ${coins(money)})`);
  if (p.favour) add("favour", `Favour: ${p.favour.kind.replace("_", " ")}${p.favour.amount ? ` of ${coins(p.favour.amount)}` : ""}${p.favour.item ? ` (${p.favour.item})` : ""}. You'll owe them one.`);
  if (p.amends) add("amends", `Pay ${coins(p.amends.fine)} to make amends?`);
  if (p.service) add("service", `${p.service.kind === "lodging" ? "A room for the night" : "Tend your wounds"} for ${coins(p.service.price)}?`);
  if (npc.pendingHire) add("hire", `${npc.name} will come with you for ${coins(npc.pendingHire.wage)} a day (first day now).`);
  if (npc.pendingCommission) add("commission", `Have ${npc.name} make you a ${npc.pendingCommission} to order (deposit now)?`);
  if (npc.dilemma) offer(`${npc.name} asks you to choose: ${npc.dilemma.offer}.`, npc.dilemma.options.map((o) => [o.label, () => void act({ action: "choose", npc: npc.id, option: o.id })] as [string, () => void]));
}

/** Push-to-talk: hold the 🎙 button, or V when you're not typing. */
function setUpMic(): void {
  const btn = $<HTMLButtonElement>("mic");
  const line = $<HTMLInputElement>("line");
  if (!micSupported) return;
  btn.hidden = false;
  btn.title = "Hold to speak (or hold V). Your browser turns speech into text; where it can't do that on this device, its own speech service hears the audio.";
  let before = "";
  const ptt = new PushToTalk({
    onInterim: (text) => (line.value = before ? `${before} ${text}` : text),
    onFinal: (text) => {
      const said = before ? `${before} ${text}` : text;
      if (speaker.prefs.micAutoSend && store.talking && !store.working) {
        line.value = "";
        sendLine($<HTMLSelectElement>("mode").value, said);
        $<HTMLSelectElement>("mode").value = "say";
      } else {
        line.value = said;
        line.focus();
      }
    },
    onState: (on) => {
      btn.classList.toggle("listening", on);
      line.classList.toggle("listening", on);
      if (on) speaker.stop(); // don't let the NPC hear themselves
    },
    onError: (message) => (store.talking ? addNote("fail", message) : feed(message)),
  });
  const start = () => {
    if (!store.talking || store.working) return;
    before = line.value.trim();
    ptt.start();
  };
  btn.addEventListener("pointerdown", (e) => (e.preventDefault(), start()));
  for (const ev of ["pointerup", "pointerleave", "pointercancel"]) btn.addEventListener(ev, () => ptt.stop());
  addEventListener("keydown", (e) => {
    if (e.key.toLowerCase() !== "v" || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
    if (["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement?.tagName ?? "") || $<HTMLDialogElement>("modal").open) return;
    e.preventDefault();
    start();
  });
  addEventListener("keyup", (e) => {
    if (e.key.toLowerCase() === "v" && ptt.isListening) ptt.stop();
  });
  addEventListener("blur", () => ptt.isListening && ptt.stop());
}

export function setUpChat(): void {
  chatHooks.render = renderChat;
  chatHooks.onConfirmOrder = confirmOrder;
  onRender(() => renderChat());
  $("form").addEventListener("submit", (e) => {
    e.preventDefault();
    const line = $<HTMLInputElement>("line");
    const mode = $<HTMLSelectElement>("mode");
    if (mode.value === "say" && !line.value.trim()) return;
    const text = line.value;
    line.value = "";
    sendLine(mode.value, text);
    mode.value = "say";
  });
  $("mode").addEventListener("change", () => {
    const m = $<HTMLSelectElement>("mode").value;
    const line = $<HTMLInputElement>("line");
    line.placeholder = m === "say" ? "Say something…" : m === "haggle" ? "Make your case on the price…" : `Words to ${m} with…`;
    line.focus();
  });
  $("chat-close").onclick = () => {
    closeChat();
    renderAll();
  };
  $("tools").addEventListener("click", (e) => {
    const what = (e.target as HTMLElement).closest<HTMLElement>("[data-do]")?.dataset.do;
    if (!what || !store.talking) return;
    const dialogs: Record<string, () => void> = { train: showTraining, wares: showWares, repair: showRepairs, give: showGive, favour: showFavours, order: showOrders, steal: showSteal, ability: showAbilities };
    if (dialogs[what]) dialogs[what]();
    else void act({ action: what, npc: store.talking });
  });
  setUpMic();
}
