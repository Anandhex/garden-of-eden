/** Dialogs: training, wares, repairs, gifts, favours, orders, stealing, abilities, crafting, voices. */
import type { NpcView, StreamEvent } from "@millbrook/shared";
import { fetchQuote } from "../api";
import { $, coins, el, emptyP } from "../dom";
import { act, npcById } from "../game";
import { game, store } from "../store";
import { micSupported } from "../voice/mic";
import { speaker } from "../voice/speaker";

/** A small button for a row. */
export function button(label: string, onClick: () => void, disabled = false): HTMLButtonElement {
  const b = el("button", { className: "small", textContent: label, disabled: disabled || store.working });
  b.onclick = onClick;
  return b;
}

const modal = () => $<HTMLDialogElement>("modal");
const close = () => modal().close();
const heading = (text: string) => el("h3", { textContent: text });

export function openModal(build: (body: HTMLElement) => void): void {
  const body = $("modal-body");
  body.replaceChildren();
  build(body);
  if (!modal().open) modal().showModal();
}

function row(...children: Array<HTMLElement | string>): HTMLDivElement {
  const r = el("div", { className: "row" });
  r.append(...children.map((c) => (typeof c === "string" ? el("span", { textContent: c }) : c)));
  return r;
}

const talkingTo = (): NpcView => {
  const npc = npcById(store.talking);
  if (!npc) throw new Error("No conversation open.");
  return npc;
};

export function showTraining(): void {
  const npc = talkingTo();
  openModal((body) => {
    body.append(heading(`${npc.name} can teach`));
    for (const t of npc.teaches) {
      const line = el("div", { className: "train-row" });
      const info = el("div", { textContent: t.skill.replace("_", "-") });
      info.append(el("small", { textContent: `up to ${t.upTo}, ${coins(t.feePerHour)}/hour${t.locked ? `, ${t.locked}` : ""}` }));
      const hours = el("select");
      for (const n of [2, 4, 8]) hours.add(new Option(`${n}h`, String(n)));
      const go = el("button", { textContent: "Train", disabled: Boolean(t.locked) });
      go.onclick = async () => {
        const quote = await fetchQuote(npc.id, t.skill, Number(hours.value));
        openModal((b) => {
          b.append(el("p", { textContent: quote.ok ? `${quote.message} You have ${coins(quote.money)}.` : quote.message }));
          if (quote.ok) {
            const pay = el("button", { textContent: "Pay and train" });
            pay.onclick = () => {
              close();
              void act({ action: "train", npc: npc.id, skill: t.skill, hours: quote.hours });
            };
            b.append(pay);
          }
          const back = el("button", { className: "ghost", textContent: "Back" });
          back.onclick = showTraining;
          b.append(back);
        });
      };
      line.append(info, hours, go);
      body.append(line);
    }
  });
}

/** A smith's repair list: your worn gear, equipped or packed, with what each costs. */
export function showRepairs(): void {
  const npc = talkingTo();
  openModal((body) => {
    body.append(heading(`${npc.name} can mend your gear`));
    const p = game().player;
    const worn = [
      ...["weapon", "armor"].flatMap((s) => {
        const g = p.gear[s];
        return g && g.repairCost > 0 ? [{ which: s, item: g.item, cost: g.repairCost }] : [];
      }),
      ...p.items.filter((i) => i.repairCost > 0).map((i) => ({ which: i.item, item: i.item, cost: i.repairCost })),
    ];
    if (worn.length === 0) body.append(emptyP("Nothing of yours needs mending."));
    for (const w of worn) {
      body.append(row(`${w.item} — ${coins(w.cost)}`, button("Repair", () => (close(), void act({ action: "repair", npc: store.talking, which: w.which })), w.cost > p.money)));
    }
  });
}

export function showWares(): void {
  const npc = talkingTo();
  openModal((body) => {
    body.append(heading(`${npc.name}'s wares`));
    for (const w of npc.wares) body.append(row(`${w.item} ×${w.qty}`, w.price ? coins(w.price) : `not for sale (${w.reason})`));
    body.append(emptyP(`Stock: ${npc.stock.used}/${npc.stock.slots} slots${npc.stock.storage ? ` (pack and ${npc.stock.storage})` : ""}.`));
    body.append(emptyP("Ask to buy something and they'll make an offer. Haggle to lower the price."));
  });
}

/** Give a gift: an item from your pack, or some coin. */
export function showGive(): void {
  const npc = talkingTo();
  openModal((body) => {
    body.append(heading(`Give ${npc.name} something`));
    for (const it of game().player.items) body.append(row(`${it.item} ×${it.qty}`, button("Give", () => (close(), void act({ action: "give", npc: store.talking, what: it.item })))));
    const amount = el("input", { placeholder: "e.g. 5 silver", size: 10 });
    body.append(row(amount, button("Give coin", () => amount.value.trim() && (close(), void act({ action: "give", npc: store.talking, what: amount.value.trim() })))));
    body.append(emptyP("Something they love counts for more than its price."));
  });
}

/** Ask a favour: a loan, a good word, hiding something, a warning. */
export function showFavours(): void {
  const words: Record<string, string> = { lend_gold: "Lend me some gold", vouch: "Put in a good word for me", hide_item: "Hide something for me", warn_me: "Warn me if there's danger" };
  openModal((body) => {
    body.append(heading("Ask a favour"));
    const items = game().player.items;
    for (const [kind, label] of Object.entries(words)) {
      const r = row(label);
      let pick: HTMLSelectElement | null = null;
      if (kind === "hide_item") {
        pick = el("select");
        for (const it of items) pick.add(new Option(it.item, it.item));
        r.append(pick);
      }
      r.append(button("Ask", () => (close(), void act({ action: "ask", npc: store.talking, favour: kind, item: pick?.value })), kind === "hide_item" && items.length === 0));
      body.append(r);
    }
    body.append(emptyP("They decide from how well they know and rate you. Every favour leaves you owing one."));
  });
}

/** Order something the NPC makes (a commission). */
export function showOrders(): void {
  const npc = talkingTo();
  openModal((body) => {
    body.append(heading(`Order from ${npc.name}`));
    for (const item of npc.makes) body.append(row(item, button("Ask the price", () => void act({ action: "commission", npc: store.talking, item }))));
  });
}

export function confirmOrder(ev: Extract<StreamEvent, { t: "quote" }>): void {
  openModal((body) => {
    body.append(el("p", { textContent: ev.text }));
    if (ev.ok) body.append(button("Order and pay the deposit", () => (close(), void act({ action: "commission", npc: store.talking, item: ev.item, confirm: true }))));
  });
}

export function showSteal(): void {
  const npc = talkingTo();
  openModal((body) => {
    body.append(heading(`Steal from ${npc.name}`));
    body.append(emptyP(npc.busy ? `They're busy (${npc.busy}): easier.` : "Face to face: hard. Better while they're busy, asleep, or after you've slipped about unseen (Sneak). Getting caught is a crime."));
    for (const w of npc.wares) body.append(row(`${w.item} ×${w.qty}`, button("Steal", () => (close(), void act({ action: "steal", npc: store.talking, item: w.item })))));
  });
}

export function showAbilities(): void {
  const p = game().player;
  openModal((body) => {
    body.append(heading(`Abilities (${p.mp}/${p.maxMp} MP)`));
    for (const a of p.abilities) body.append(row(`${a.name}: ${a.describe} (${a.mp} MP)`, button("Use", () => (close(), void act({ action: "ability", npc: store.talking, ability: a.id })), a.mp > p.mp)));
  });
}

const RECIPES = ["horseshoe", "dagger", "iron sword", "ale", "stew", "healing salve"];
export function showCraft(): void {
  openModal((body) => {
    body.append(heading("Make something"));
    body.append(emptyP("Smithing needs the forge; brewing, salves and cooking the inn's kitchen. Better materials make better work."));
    for (const r of RECIPES) body.append(row(r, button("Make", () => (close(), void act({ action: "craft", item: r })))));
  });
}

/** Voice settings (T14): on/off, volume, engine, and a sample of each NPC's voice. */
export function showVoices(onChange: () => void): void {
  openModal((body) => {
    body.append(heading("Voices"));
    const p = speaker.prefs;
    const toggle = (label: string, hint: string, checked: boolean, set: (v: boolean) => void, disabled = false) => {
      const r = el("label", { className: "voice-row" });
      const text = el("span", { textContent: label });
      text.append(el("small", { textContent: hint }));
      const box = el("input", { type: "checkbox", checked, disabled });
      box.onchange = () => (set(box.checked), onChange());
      r.append(text, box);
      body.append(r);
    };
    toggle("NPCs speak aloud", speaker.available ? "Sentence by sentence, as they reply." : "This browser has no speech engine.", p.voices, (v) => speaker.setPrefs({ voices: v }), !speaker.available);

    const vol = el("label", { className: "voice-row" });
    vol.append(el("span", { textContent: "Volume" }));
    const range = el("input", { type: "range", min: "0", max: "1", step: "0.05", value: String(p.volume) });
    range.oninput = () => speaker.setPrefs({ volume: Number(range.value) });
    vol.append(range);
    body.append(vol);

    const piper = speaker.info.backend === "piper";
    toggle(
      "Use the server's Piper voices",
      piper ? speaker.info.note : `${speaker.info.note} See the README (NPC voices) to set Piper up.`,
      piper && p.engine === "auto",
      (v) => speaker.setPrefs({ engine: v ? "auto" : "browser" }),
      !piper,
    );
    toggle(
      "Send what I say straight away",
      micSupported ? "Hold V or 🎙 to speak; let go to send. Off: the words wait in the box." : "This browser can't recognise speech (try Chrome, Edge or Safari).",
      p.micAutoSend,
      (v) => speaker.setPrefs({ micAutoSend: v }),
      !micSupported,
    );

    body.append(heading("Who sounds like what"));
    for (const n of game().npcs.filter((x) => !x.dead)) {
      const r = el("div", { className: "voice-row" });
      const who = el("span", { textContent: n.name });
      who.append(el("small", { textContent: speaker.usingPiper && n.voice.piper ? `Piper: ${n.voice.piper.model}${n.voice.piper.speaker !== undefined ? ` #${n.voice.piper.speaker}` : ""}` : speaker.browserVoiceName(n.id, n.voice) }));
      const test = el("button", { className: "small", textContent: "▶ Hear" });
      test.onclick = () => {
        speaker.stop();
        const was = speaker.prefs.voices;
        speaker.prefs.voices = true;
        speaker.say(n.id, `I'm ${n.name.split(" ")[0]}, ${n.role}.`, n.voice);
        speaker.prefs.voices = was;
      };
      r.append(who, test);
      body.append(r);
    }
  });
}
