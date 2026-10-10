// Millbrook web client. The server owns every rule; this file draws the world,
// sends what the player does, and shows what comes back. Text from the model is
// only ever inserted with textContent.

const TILE = 32;
const $ = (id) => document.getElementById(id);
const canvas = $("map");
const ctx = canvas.getContext("2d");

let state = null;
let talking = null; // npc id of the open conversation
let working = false; // a model reply is in flight
let moving = false; // a step request is in flight
let walkToken = 0; // bumped to cancel a click-to-walk path
let tab = "skills";
const logs = {}; // npc id -> [{ kind, text }]

// ---------- server calls ----------

async function getState() {
  const res = await fetch("/api/state");
  state = await res.json();
  renderAll();
}

/** POST an action and read the streamed events. */
async function act(body) {
  if (working) return;
  working = true;
  setBusy(true);
  let bubble = null;
  try {
    const res = await fetch("/api/act", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if (res.status === 409) return addNote("system", "Hold on, something is still happening.");
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        if (line.trim()) bubble = handleEvent(JSON.parse(line), body.npc, bubble);
      }
    }
  } catch (err) {
    addNote("fail", `Connection problem: ${err.message}`);
  } finally {
    if (bubble) bubble.el.classList.remove("typing");
    working = false;
    setBusy(false);
    renderAll();
  }
}

function handleEvent(ev, npcId, bubble) {
  // Anything but more text ends the reply that was streaming.
  if (bubble && ev.t !== "text" && ev.t !== "done") bubble.el.classList.remove("typing");
  switch (ev.t) {
    case "text": {
      if (!bubble) {
        const entry = { kind: "npc", text: "" };
        (logs[ev.npc] ??= []).push(entry);
        const el = addBubble(ev.npc, entry);
        bubble = { entry, el };
        el.classList.add("typing");
      }
      bubble.entry.text += ev.delta;
      bubble.el.textContent = bubble.entry.text;
      scrollLog();
      return bubble;
    }
    case "note":
      addNote(ev.kind, ev.text, npcId);
      return null;
    case "system":
      addNote("system", ev.text, npcId);
      feed(ev.text);
      return null;
    case "error":
      addNote("fail", ev.text, npcId);
      return null;
    case "ended":
      addNote("end", ev.text, ev.npc);
      feed(ev.text);
      if (talking === ev.npc) closeChat();
      return null;
    case "opened":
      return null;
    case "done":
      state = ev.state;
      return bubble;
  }
  return bubble;
}

async function step(dx, dy) {
  if (moving || working) return false;
  moving = true;
  try {
    const res = await fetch("/api/move", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ dx, dy }) });
    const data = await res.json();
    if (data.state) state = data.state;
    if (data.reason) feed(data.reason);
    for (const line of data.log ?? []) feed(line);
    if (talking) {
      const npc = npcById(talking);
      if (npc && dist(state.position, npc) > state.map.talkRange) {
        addNote("end", "You walk away.", talking);
        closeChat();
      }
    }
    renderAll();
    return data.ok;
  } finally {
    moving = false;
  }
}

// ---------- helpers ----------

const npcById = (id) => state.npcs.find((n) => n.id === id);
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const solid = (x, y) => {
  const t = state.map.tiles[y]?.[x];
  return t === undefined || t === "tree" || t === "wall" || t === "water";
};
const npcAt = (x, y) => state.npcs.find((n) => n.x === x && n.y === y && !n.away);
const nearest = () =>
  state.npcs.filter((n) => !n.dead && !n.away && dist(state.position, n) <= state.map.talkRange).sort((a, b) => dist(state.position, a) - dist(state.position, b))[0];

function feed(text) {
  const p = document.createElement("p");
  p.textContent = text;
  $("feed").append(p);
  $("feed").scrollTop = $("feed").scrollHeight;
}

function setBusy(on) {
  for (const el of document.querySelectorAll("#form input, #form select, #form button, #tools button, #quick button, .offer button, [data-wait]")) {
    el.disabled = on;
  }
}

// ---------- chat ----------

function addBubble(npcId, entry) {
  const el = document.createElement("div");
  el.className = `msg ${entry.kind}`;
  el.textContent = entry.text;
  if (talking === npcId) $("log").append(el);
  return el;
}

function addNote(kind, text, npcId = talking) {
  if (!npcId) return feed(text);
  (logs[npcId] ??= []).push({ kind: `note ${kind}`, text });
  if (talking === npcId) {
    const el = document.createElement("div");
    el.className = `note ${kind}`;
    el.textContent = text;
    $("log").append(el);
    scrollLog();
  }
}

const scrollLog = () => ($("log").scrollTop = $("log").scrollHeight);

async function openChat(id) {
  if (working) return;
  const npc = npcById(id);
  if (!npc) return;
  if (npc.dead) return feed(`${npc.name} is dead.`);
  if (npc.away) return feed(`${npc.name} has run off.`);
  if (dist(state.position, npc) > state.map.talkRange) return feed(`You are too far from ${npc.name}.`);
  talking = id;
  logs[id] ??= [];
  $("chat").hidden = false;
  renderChat(true);
  await act({ action: "open", npc: id });
  if (talking === id) $("line").focus();
}

function closeChat() {
  talking = null;
  $("chat").hidden = true;
}

function renderChat(rebuildLog = false) {
  if (!talking) return;
  const npc = npcById(talking);
  $("chat-name").textContent = npc.name;
  $("chat-role").textContent = npc.role;
  const stats = $("chat-stats");
  stats.replaceChildren();
  for (const s of [`mood: ${npc.mood}`, `trust: ${npc.trust}`, `HP ${npc.hp}/${npc.maxHp}`, npc.busy ? `busy ${npc.busy}` : null, npc.inCombat ? "⚔ in a fight" : null]) {
    if (!s) continue;
    const span = document.createElement("span");
    span.textContent = s;
    stats.append(span);
  }
  if (rebuildLog) {
    $("log").replaceChildren();
    for (const m of logs[talking]) {
      const el = document.createElement("div");
      el.className = m.kind.startsWith("note") ? m.kind : `msg ${m.kind}`;
      el.textContent = m.text;
      $("log").append(el);
    }
    scrollLog();
  }
  renderOffers(npc);
  renderQuick(npc);
  $("tools").querySelector('[data-do="train"]').hidden = npc.teaches.length === 0;
  $("tools").querySelector('[data-do="wares"]').hidden = npc.wares.length === 0;
}

function renderQuick(npc) {
  const box = $("quick");
  box.replaceChildren();
  const lines = ["Hello there.", "What's for sale?", "Any work for me?", "Could you teach me something?", "Tell me about this place."];
  for (const l of lines) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = l;
    b.disabled = working;
    b.onclick = () => sendLine("say", l);
    box.append(b);
  }
}

function renderOffers(npc) {
  const box = $("offers");
  box.replaceChildren();
  const p = npc.pending;
  const add = (kind, label) => {
    const row = document.createElement("div");
    row.className = "offer";
    const span = document.createElement("span");
    span.textContent = label;
    const btns = document.createElement("div");
    btns.className = "btns";
    for (const [verb, text] of [["accept", "Accept"], ["decline", "Decline"]]) {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = text;
      if (verb === "accept") b.className = "yes";
      b.onclick = () => act({ action: verb, kind, npc: npc.id });
      btns.append(b);
    }
    row.append(span, btns);
    box.append(row);
  };
  if (p.quest) add("quest", `Job [${p.quest.tier}] "${p.quest.title}": bring ${p.quest.qty} ${p.quest.item} for ${p.quest.gold} gold.`);
  if (p.training) add("training", `Train ${p.training.skill.replace("_", "-")} for ${p.training.hours}h, ${p.training.cost} gold (you have ${state.player.gold}).`);
  if (p.purchase) add("purchase", `Sell your ${p.purchase.item} for ${p.purchase.price} gold?`);
  if (p.offer) add("offer", `Buy ${p.offer.item} for ${p.offer.price} gold? (you have ${state.player.gold})`);
}

function sendLine(mode, text) {
  if (!talking || working) return;
  const trimmed = text.trim();
  if (mode === "say" && !trimmed) return;
  const label = mode === "say" ? trimmed : `(${mode}) ${trimmed || "…"}`;
  (logs[talking] ??= []).push({ kind: "you", text: label });
  const el = document.createElement("div");
  el.className = "msg you";
  el.textContent = label;
  $("log").append(el);
  scrollLog();
  act({ action: mode, text: trimmed, npc: talking });
}

// ---------- modal (training, wares) ----------

function openModal(build) {
  const body = $("modal-body");
  body.replaceChildren();
  build(body);
  if (!$("modal").open) $("modal").showModal();
}

function showTraining() {
  const npc = npcById(talking);
  openModal((body) => {
    const h = document.createElement("h3");
    h.textContent = `${npc.name} can teach`;
    body.append(h);
    for (const t of npc.teaches) {
      const row = document.createElement("div");
      row.className = "train-row";
      const info = document.createElement("div");
      info.textContent = t.skill.replace("_", "-");
      const small = document.createElement("small");
      small.textContent = `up to ${t.upTo}, ${t.feePerHour} gold/hour${t.locked ? `, ${t.locked}` : ""}`;
      info.append(small);
      const hours = document.createElement("select");
      for (const n of [2, 4, 8]) hours.add(new Option(`${n}h`, n));
      const go = document.createElement("button");
      go.textContent = "Train";
      go.disabled = !!t.locked;
      go.onclick = async () => {
        const res = await fetch(`/api/quote?npc=${npc.id}&skill=${t.skill}&hours=${hours.value}`);
        const quote = await res.json();
        openModal((b) => {
          const p = document.createElement("p");
          p.textContent = quote.ok
            ? `${quote.message} You have ${quote.gold} gold.`
            : quote.message;
          b.append(p);
          if (quote.ok) {
            const pay = document.createElement("button");
            pay.textContent = "Pay and train";
            pay.onclick = () => {
              $("modal").close();
              act({ action: "train", npc: npc.id, skill: t.skill, hours: quote.hours });
            };
            b.append(pay);
          }
          const back = document.createElement("button");
          back.className = "ghost";
          back.textContent = "Back";
          back.onclick = showTraining;
          b.append(back);
        });
      };
      row.append(info, hours, go);
      body.append(row);
    }
  });
}

function showWares() {
  const npc = npcById(talking);
  openModal((body) => {
    const h = document.createElement("h3");
    h.textContent = `${npc.name}'s wares`;
    body.append(h);
    for (const w of npc.wares) {
      const row = document.createElement("div");
      row.className = "row";
      const a = document.createElement("span");
      a.textContent = `${w.item} ×${w.qty}`;
      const b = document.createElement("span");
      b.textContent = w.price ? `${w.price} gold` : "not for sale";
      row.append(a, b);
      body.append(row);
    }
    const p = document.createElement("p");
    p.className = "empty";
    p.textContent = "Ask to buy something and they'll make an offer. Haggle to lower the price.";
    body.append(p);
  });
}

// ---------- side sheet ----------

function renderSheet() {
  const body = $("tab-body");
  body.replaceChildren();
  const p = state.player;
  const h = (t) => {
    const el = document.createElement("h3");
    el.textContent = t;
    body.append(el);
  };
  const row = (a, b) => {
    const r = document.createElement("div");
    r.className = "row";
    const l = document.createElement("span");
    l.textContent = a;
    const rt = document.createElement("span");
    rt.textContent = b;
    r.append(l, rt);
    body.append(r);
    return r;
  };
  const bar = (frac) => {
    const wrap = document.createElement("div");
    wrap.className = "bar";
    const i = document.createElement("i");
    i.style.width = `${Math.max(0, Math.min(1, frac)) * 100}%`;
    wrap.append(i);
    body.append(wrap);
  };
  if (tab === "skills") {
    h(`${p.name}, level ${p.level}`);
    row("XP", `${p.xp}/${p.xpNext}`);
    bar(p.xp / p.xpNext);
    h("Attributes");
    for (const [k, v] of Object.entries(p.attributes)) row(k, String(v));
    h("Skills");
    if (p.skills.length === 0) body.append(emptyP("No trained skills yet."));
    for (const s of p.skills) {
      row(s.skill.replace("_", "-"), s.needed ? `${s.tier} (${s.progress}/${s.needed}h)` : s.tier);
      if (s.needed) bar(s.progress / s.needed);
    }
  } else if (tab === "inv") {
    h("Inventory");
    row("Gold", String(p.gold));
    const items = Object.entries(p.inventory).filter(([, q]) => q > 0);
    if (items.length === 0) body.append(emptyP("Nothing but lint."));
    for (const [k, q] of items) row(k, `×${q}`);
  } else {
    h("Active quests");
    if (p.quests.length === 0) body.append(emptyP("None. Ask around for work."));
    for (const q of p.quests) {
      row(`[${q.tier}] ${q.title}`, `${q.have}/${q.qty} ${q.item}`);
      const sub = document.createElement("div");
      sub.className = "empty";
      sub.textContent = `For ${q.giver}. Reward ${q.gold} gold.`;
      body.append(sub);
    }
    if (p.completed) body.append(emptyP(`${p.completed} completed.`));
    if (p.journal.length) {
      h("Journal");
      for (const j of p.journal.slice(-10).reverse()) row(`Day ${j.day}`, j.text);
    }
  }
}
const emptyP = (t) => Object.assign(document.createElement("p"), { className: "empty", textContent: t });

// ---------- header ----------

function renderHeader() {
  $("time").textContent = state.time.text;
  const p = state.player;
  $("hpbar").textContent = `HP ${p.hp}/${p.maxHp}`;
  $("gold").textContent = `${p.gold} gold`;
  $("llm").textContent = state.llm.ready ? "model ready" : "model offline";
  $("llm").className = `pill ${state.llm.ready ? "ok" : "err"}`;
  $("banner").hidden = state.llm.ready;
  $("banner").textContent = state.llm.error || "";
}

function renderAll() {
  if (!state) return;
  renderHeader();
  renderSheet();
  renderChat();
  draw();
}

// ---------- drawing ----------

const hash = (x, y) => {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
};

function drawTile(t, x, y, time) {
  const px = x * TILE;
  const py = y * TILE;
  const n = hash(x, y);
  if (t === "path") {
    ctx.fillStyle = n > 0.5 ? "#a88b5e" : "#9e8256";
    ctx.fillRect(px, py, TILE, TILE);
    ctx.fillStyle = "rgba(0,0,0,.08)";
    ctx.fillRect(px + n * 20, py + ((n * 97) % 1) * 20, 4, 3);
    return;
  }
  ctx.fillStyle = n > 0.5 ? "#4a7a3f" : "#477439";
  ctx.fillRect(px, py, TILE, TILE);
  if (t === "grass") {
    ctx.fillStyle = "rgba(255,255,255,.07)";
    ctx.fillRect(px + n * 24, py + ((n * 31) % 1) * 24, 2, 4);
  } else if (t === "water") {
    ctx.fillStyle = "#3b6fa5";
    ctx.fillRect(px, py, TILE, TILE);
    ctx.fillStyle = "rgba(255,255,255,.18)";
    const off = Math.sin(time / 600 + x + y) * 4;
    ctx.fillRect(px + 6 + off, py + 10, 12, 2);
    ctx.fillRect(px + 12 - off, py + 22, 10, 2);
  } else if (t === "tree") {
    ctx.fillStyle = "#5b3d22";
    ctx.fillRect(px + 13, py + 18, 6, 12);
    ctx.fillStyle = n > 0.5 ? "#2f5a2c" : "#336232";
    ctx.beginPath();
    ctx.arc(px + 16, py + 14, 12, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawBuildings() {
  for (const b of state.map.buildings) {
    const x = b.x * TILE, y = b.y * TILE, w = b.w * TILE, h = b.h * TILE;
    ctx.fillStyle = "#6a5a48";
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = b.color;
    ctx.fillRect(x, y, w, h - 10);
    ctx.fillStyle = "rgba(0,0,0,.2)";
    for (let i = 0; i < w; i += 8) ctx.fillRect(x + i, y, 2, h - 10);
    ctx.strokeStyle = "rgba(0,0,0,.45)";
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
    if (b.name !== "Gate") {
      ctx.fillStyle = "#f3e9d2";
      ctx.font = "bold 12px system-ui";
      ctx.textAlign = "center";
      ctx.fillText(b.name, x + w / 2, y + 16);
    }
  }
  state.map.tiles.forEach((row, ty) =>
    row.forEach((t, tx) => {
      if (t !== "door") return;
      ctx.fillStyle = "#3a2a1c";
      ctx.fillRect(tx * TILE + 6, ty * TILE + 2, TILE - 12, TILE - 2);
      ctx.fillStyle = "#c9a24a";
      ctx.fillRect(tx * TILE + TILE - 12, ty * TILE + 16, 3, 3);
    }),
  );
}

function drawPerson(x, y, color, label, opts = {}) {
  const px = x * TILE + TILE / 2;
  const py = y * TILE + TILE / 2;
  ctx.fillStyle = "rgba(0,0,0,.3)";
  ctx.beginPath();
  ctx.ellipse(px, py + 12, 10, 4, 0, 0, Math.PI * 2);
  ctx.fill();
  if (opts.dead) {
    ctx.fillStyle = "#8d9097";
    ctx.fillRect(px - 8, py - 8, 16, 20);
    ctx.beginPath();
    ctx.arc(px, py - 8, 8, Math.PI, 0);
    ctx.fill();
    ctx.fillStyle = "#555";
    ctx.fillRect(px - 1, py - 6, 2, 8);
    ctx.fillRect(px - 4, py - 3, 8, 2);
  } else {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(px - 8, py - 4, 16, 17, 5);
    ctx.fill();
    ctx.fillStyle = "#f0d2b0";
    ctx.beginPath();
    ctx.arc(px, py - 9, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(0,0,0,.35)";
    ctx.beginPath();
    ctx.arc(px, py - 11, 7, Math.PI, 0);
    ctx.fill();
  }
  ctx.font = "bold 11px system-ui";
  ctx.textAlign = "center";
  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgba(0,0,0,.7)";
  ctx.strokeText(label, px, py - 22);
  ctx.fillStyle = opts.near ? "#ffd27a" : "#fff";
  ctx.fillText(label, px, py - 22);
  if (opts.hp !== undefined && opts.hp < 1) {
    ctx.fillStyle = "#000a";
    ctx.fillRect(px - 12, py + 15, 24, 4);
    ctx.fillStyle = "#e0675b";
    ctx.fillRect(px - 12, py + 15, 24 * Math.max(0, opts.hp), 4);
  }
}

function draw(time = performance.now()) {
  if (!state) return;
  const { w, h, tiles } = state.map;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) drawTile(tiles[y][x] === "wall" || tiles[y][x] === "door" ? "grass" : tiles[y][x], x, y, time);
  drawBuildings();
  const near = nearest();
  for (const n of state.npcs) {
    if (n.away) continue;
    drawPerson(n.x, n.y, n.color, n.dead ? `${n.name} †` : n.name, { dead: n.dead, near: near?.id === n.id, hp: n.hp / n.maxHp });
  }
  drawPerson(state.position.x, state.position.y, "#3f7fd0", state.player.name, {});
  if (near && talking !== near.id) {
    ctx.font = "bold 13px system-ui";
    ctx.textAlign = "center";
    ctx.fillStyle = "#ffd27a";
    ctx.fillText("E: talk", near.x * TILE + TILE / 2, near.y * TILE + TILE + 12);
  }
}

// ---------- input ----------

const KEYS = { ArrowUp: [0, -1], w: [0, -1], ArrowDown: [0, 1], s: [0, 1], ArrowLeft: [-1, 0], a: [-1, 0], ArrowRight: [1, 0], d: [1, 0] };

addEventListener("keydown", (e) => {
  if (!state || e.metaKey || e.ctrlKey || e.altKey) return;
  const typing = ["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement?.tagName);
  if (e.key === "Escape" && talking && !$("modal").open) return closeChat(), renderAll();
  if (typing || $("modal").open) return;
  const dir = KEYS[e.key] ?? KEYS[e.key.toLowerCase()];
  if (dir) {
    e.preventDefault();
    walkToken++;
    step(dir[0], dir[1]);
  } else if (e.key.toLowerCase() === "e") {
    const n = nearest();
    if (n) openChat(n.id);
  }
});

function findPath(from, goalTest) {
  const key = (x, y) => y * 1000 + x;
  const prev = new Map([[key(from.x, from.y), null]]);
  const queue = [from];
  while (queue.length) {
    const cur = queue.shift();
    if (goalTest(cur)) {
      const path = [];
      for (let c = cur; prev.get(key(c.x, c.y)); c = prev.get(key(c.x, c.y))) path.unshift(c);
      return path;
    }
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cur.x + dx, ny = cur.y + dy;
      if (solid(nx, ny) || npcAt(nx, ny) || prev.has(key(nx, ny))) continue;
      prev.set(key(nx, ny), cur);
      queue.push({ x: nx, y: ny });
    }
  }
  return null;
}

async function walk(path, then) {
  const token = ++walkToken;
  let pos = { ...state.position };
  for (const next of path) {
    if (token !== walkToken) return;
    while (moving || working) await new Promise((r) => setTimeout(r, 30));
    if (!(await step(next.x - pos.x, next.y - pos.y))) return;
    pos = { ...state.position };
    await new Promise((r) => setTimeout(r, 70));
  }
  if (token === walkToken) then?.();
}

canvas.addEventListener("click", (e) => {
  if (!state || working) return;
  const rect = canvas.getBoundingClientRect();
  const x = Math.floor(((e.clientX - rect.left) / rect.width) * state.map.w);
  const y = Math.floor(((e.clientY - rect.top) / rect.height) * state.map.h);
  const npc = state.npcs.find((n) => n.x === x && n.y === y);
  const range = state.map.talkRange;
  if (npc) {
    if (dist(state.position, npc) <= range) return openChat(npc.id);
    if (npc.dead || npc.away) return;
    const path = findPath(state.position, (c) => dist(c, npc) <= range);
    return path ? walk(path, () => openChat(npc.id)) : feed("You can't find a way there.");
  }
  if (solid(x, y)) return;
  const path = findPath(state.position, (c) => c.x === x && c.y === y);
  if (path) walk(path);
});

$("form").addEventListener("submit", (e) => {
  e.preventDefault();
  const text = $("line").value;
  const mode = $("mode").value;
  if (mode === "say" && !text.trim()) return;
  $("line").value = "";
  sendLine(mode, text);
  $("mode").value = "say";
});
$("mode").addEventListener("change", () => {
  const m = $("mode").value;
  $("line").placeholder = m === "say" ? "Say something…" : m === "haggle" ? "Make your case on the price…" : `Words to ${m} with…`;
  $("line").focus();
});
$("chat-close").onclick = () => {
  closeChat();
  renderAll();
};
$("modal-close").onclick = () => $("modal").close();
$("tools").addEventListener("click", (e) => {
  const what = e.target.closest("[data-do]")?.dataset.do;
  if (!what || !talking) return;
  if (what === "train") showTraining();
  else if (what === "wares") showWares();
  else act({ action: what, npc: talking });
});
for (const b of document.querySelectorAll("[data-wait]")) {
  b.onclick = () => act({ action: "wait", hours: Number(b.dataset.wait) });
}
$("tabs").addEventListener("click", (e) => {
  const t = e.target.closest("[data-tab]")?.dataset.tab;
  if (!t) return;
  tab = t;
  for (const b of $("tabs").children) b.classList.toggle("on", b.dataset.tab === t);
  renderSheet();
});
$("newgame").onclick = async () => {
  if (!confirm("Start a new game? This overwrites your save. NPC deaths stay permanent.")) return;
  const res = await fetch("/api/new", { method: "POST" });
  const data = await res.json();
  if (data.state) {
    state = data.state;
    for (const k of Object.keys(logs)) delete logs[k];
    closeChat();
    $("feed").replaceChildren();
    renderAll();
  }
};

// Ollama may start after the page does: keep checking until it's up.
setInterval(() => {
  if (state && !state.llm.ready && !working) getState();
}, 15000);
(function loop() {
  draw();
  requestAnimationFrame(loop);
})();

await getState();
feed("You arrive in Millbrook. Walk up to someone and press E to talk.");
