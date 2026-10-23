/**
 * The frame builder (G5): what an adapter draws, for the view box round the player. Everything the browser used
 * to work out for itself is here: where the townsfolk are (CrowdSim), who is on the road (partyAt), the land
 * (chunks cut into 16×16 patches), who E talks to, labels and hover text. It reads the game and never writes it.
 */
import {
  CLASS_RANK,
  CLASS_WORDS,
  CrowdSim,
  Ground,
  JOB_INFO,
  STEPS_PER_SECOND,
  findPath,
  isHostile,
  isSolidGround,
  markKey,
  partyAt,
  journeyLine,
  tileDistance,
  type Chat,
  type CrowdPos,
  type Snapshot,
} from "@millbrook/shared";
import { OBJECT_IDS, TERRAIN_IDS, type Actor, type Frame, type Patch } from "@millbrook/shared/view";
import { groundAt } from "../game/road/ground.js";
import type { Land, ViewHost } from "./host.js";

export const PATCH = 16;
/** Tiles drawn beyond the adapter's viewport on each side. */
export const MARGIN = 6;
const STEP_MS = Math.round(1000 / STEPS_PER_SECOND);
/** Crowd conversations shown at once, and how far apart they must be. */
const BUBBLES = 6;

const T = (id: (typeof TERRAIN_IDS)[number]) => TERRAIN_IDS.indexOf(id);
const O = (id: NonNullable<(typeof OBJECT_IDS)[number]>) => OBJECT_IDS.indexOf(id);

/** A journey's colour by its kind (N26). */
export const KIND_COLOR: Record<string, string> = { caravan: "#b5763f", courier: "#d9a441", market: "#9aa86a", kin: "#b58aa0", work: "#a08a6a", officials: "#6a7fa8", patrol: "#4f6fa0", pilgrims: "#c9c3b0", adventurers: "#b5503f", refugees: "#8a7a5f", migrants: "#8a7a5f", coach: "#7a9b57" };

/** A road tile as terrain and object art. */
function roadArt(g: number): [number, number] {
  switch (g) {
    case Ground.tree: return [T("terrain/grass"), O("props/tree")];
    case Ground.rock: return [T("terrain/grass"), O("props/rock")];
    case Ground.reeds: return [T("terrain/marsh"), O("props/reeds")];
    case Ground.water: return [T("terrain/water"), 0];
    case Ground.sand: return [T("terrain/sand"), 0];
    case Ground.road: return [T("terrain/road"), 0];
    case Ground.bridge: return [T("terrain/bridge"), 0];
    case Ground.ford: return [T("terrain/ford"), 0];
    case Ground.field: return [T("terrain/field"), 0];
    case Ground.hill: return [T("terrain/hill"), 0];
    case Ground.marsh: return [T("terrain/marsh"), 0];
    case Ground.town: return [T("terrain/town"), 0];
    case Ground.wall: return [T("terrain/town"), O("buildings/wall")];
    case Ground.milestone: return [T("terrain/grass"), O("props/milestone")];
    case Ground.signpost: return [T("terrain/grass"), O("props/signpost")];
    case Ground.shrine: return [T("terrain/grass"), O("props/shrine")];
    case Ground.farmhouse: return [T("terrain/yard"), O("props/farmhouse")];
    case Ground.yard: return [T("terrain/yard"), 0];
    case Ground.bar: return [T("terrain/road"), O("props/bar")];
    case Ground.gate: return [T("terrain/road"), O("buildings/gate")];
    case Ground.thatch: return [T("terrain/yard"), O("props/thatch")];
    default: return [T("terrain/grass"), 0];
  }
}

/** A map tile (a place, N15/N16) as terrain and object art. */
function placeArt(t: string | undefined, inBuilding: boolean): [number, number] {
  switch (t) {
    case "path": return [T("terrain/path"), 0];
    case "water": return [T("terrain/water"), 0];
    case "tree": return [T("terrain/grass"), O("props/tree")];
    case "wall": return inBuilding ? [T("terrain/town"), 0] : [T("terrain/town"), O("buildings/wall")];
    case "door": return [T("terrain/path"), O("buildings/door")];
    default: return [T("terrain/grass"), 0];
  }
}

/** The box of tiles in view: the adapter's viewport round the player, plus a margin. */
export function boxOf(s: Snapshot, view: { w: number; h: number }): Frame["box"] {
  const p = s.position;
  let x0 = p.x - Math.floor(view.w / 2) - MARGIN;
  let y0 = p.y - Math.floor(view.h / 2) - MARGIN;
  let x1 = x0 + view.w + 2 * MARGIN - 1;
  let y1 = y0 + view.h + 2 * MARGIN - 1;
  if (!s.road) {
    x0 = Math.max(0, x0);
    y0 = Math.max(0, y0);
    x1 = Math.min(s.map.w - 1, x1);
    y1 = Math.min(s.map.h - 1, y1);
  }
  return { x0, y0, x1, y1 };
}

const inBox = (b: Frame["box"], x: number, y: number) => x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1;

/** Is a tile one a walker can't enter (for the player's paths, and the routes NPCs are drawn along). */
export function solidOf(s: Snapshot, land: Land | null): (x: number, y: number) => boolean {
  if (s.road) return (x, y) => !land || isSolidGround(groundAt(land, x, y));
  return (x, y) => {
    const t = s.map.tiles[y]?.[x];
    return t === undefined || t === "tree" || t === "wall" || t === "water";
  };
}

// ---------- the townsfolk ----------

/** The townsfolk's places this minute, worked out once per map and minute. */
export class CrowdClock {
  private key = "";
  pos: CrowdPos[] = [];
  sim: CrowdSim | null = null;

  at(s: Snapshot, sim: CrowdSim | null): CrowdPos[] {
    if (!sim || !s.crowd || s.crowd.map !== sim.map.id) {
      this.sim = null;
      this.pos = [];
      this.key = "";
      return this.pos;
    }
    const key = `${sim.map.id}:${s.time.day}:${s.time.hour * 60 + s.time.minute}`;
    if (key !== this.key || sim !== this.sim) {
      this.key = key;
      this.sim = sim;
      this.pos = sim.all(s.time.day, s.time.hour * 60 + s.time.minute, s.crowd.day);
    }
    return this.pos;
  }
}

/** "Ada Lowe, 34 — weaver (craftsman), the Weavers' Guild · at the loom". */
export function describeFolk(sim: CrowdSim, i: number, at: CrowdPos | undefined): string {
  const p = sim.roster.people[i];
  if (!p) return "";
  const job = JOB_INFO[p.job].words;
  const cls = CLASS_WORDS[p.cls];
  const what = p.job === "child" ? `child (${cls})` : job === cls ? job : `${job} (${cls})`;
  const master = p.master ? (p.cls === "slave" ? `, slave of ${p.master}` : p.cls === "serf" ? `, bound to ${p.master}` : p.job === "servant" ? `, serves ${p.master}` : "") : "";
  return `${p.name}, ${p.age} — ${what}${master}${p.factionName ? `, ${p.factionName}` : ""}${at ? ` · ${at.doing}` : ""}`;
}

/** The bubble for something a townsperson passed on (N33): short enough to read at a glance. */
export function gossipBubble(text: string): string {
  const line = `Did you hear? ${text.replace(/\.$/, "")}.`;
  return line.length > 70 ? `${line.slice(0, 68)}…` : line;
}

// ---------- the road's people ----------

export interface Traveller {
  id: string;
  x: number;
  y: number;
  name: string;
  role: string;
  kind: string;
  purpose: string;
  from: string;
  to: string;
  journey: string;
}

/** The people of the journeys near the player on the road, where they are this minute (the server's own formula). */
export function travellersNow(host: ViewHost, s: Snapshot, radius: number): Traveller[] {
  const data = host.roadData();
  if (!s.road || !data) return [];
  const m = (s.time.day - 1) * 1440 + s.time.hour * 60 + s.time.minute;
  const out: Traveller[] = [];
  for (const j of host.journeysNear(radius)) {
    if (m < j.depart || m >= (j.ended ? Math.min(j.ended.minute, j.arrive) : j.arrive)) continue;
    const line = journeyLine(data, j.roads, j.path);
    partyAt(j, line, m).forEach((p, k) => {
      const who = j.party[k]!;
      if (Math.hypot(p.x - s.position.x, p.y - s.position.y) > radius) return;
      out.push({ id: who.person, x: p.x, y: p.y, name: who.name, role: who.role, kind: j.kind, purpose: j.purpose, from: host.placeName(j.path[0]!), to: host.placeName(j.path.at(-1)!), journey: j.id });
    });
  }
  return out;
}

// ---------- who is near ----------

export interface Near {
  /** Who E talks to: an NPC, a townsperson or a traveller in reach. */
  talker: { id: string; name: string; x: number; y: number } | null;
  /** The creature F fights: the one engaged, else the closest in reach. */
  prey: Snapshot["creatures"][number] | null;
}

export function nearOf(s: Snapshot, crowd: CrowdClock, travellers: Traveller[]): Near {
  const range = s.map.talkRange;
  const d = (p: { x: number; y: number }) => tileDistance(s.position, p);
  const prey = s.creatures.find((c) => c.engaged) ?? s.creatures.filter((c) => d(c) <= range).sort((a, b) => d(a) - d(b))[0] ?? null;
  if (s.road) {
    const t = travellers.filter((x) => d(x) <= range).sort((a, b) => d(a) - d(b))[0];
    return { talker: t ? { id: t.id, name: t.name, x: t.x, y: t.y } : null, prey };
  }
  const n = s.npcs.filter((x) => !x.dead && !x.away && d(x) <= range).sort((a, b) => d(a) - d(b))[0];
  let folk: { i: number; d: number } | null = null;
  const sim = crowd.sim;
  if (sim) {
    const promoted = new Set(s.npcs.map((x) => x.id));
    crowd.pos.forEach((p, i) => {
      if (!p.visible) return;
      const dd = d(p);
      if (dd <= range && (!folk || dd < folk.d) && !promoted.has(sim.roster.people[i]!.id)) folk = { i, d: dd };
    });
  }
  const f = folk as { i: number; d: number } | null;
  if (f && sim && f.d < (n ? d(n) : Infinity)) {
    const p = crowd.pos[f.i]!;
    const who = sim.roster.people[f.i]!;
    return { talker: { id: who.id, name: who.name, x: p.x, y: p.y }, prey };
  }
  return { talker: n ? { id: n.id, name: n.name, x: n.x, y: n.y } : null, prey };
}

// ---------- the frame ----------

export interface FrameInput {
  s: Snapshot;
  host: ViewHost;
  crowd: CrowdClock;
  view: { w: number; h: number };
  /** The NPC the player is talking to (no E prompt over them). */
  talking: string | null;
  /** Patches the adapter already has: not cut again. */
  hasPatch: (key: string) => boolean;
  /** Crowd conversations and gossip to show this frame (chosen by the session once per minute). */
  chatter?: Frame["chatter"];
  gossip?: Frame["gossip"];
}

/** The daylight (0 night … 1 day) at an hour and minute: the old night overlay's curve. */
export function daylight(hour: number, minute: number): number {
  const h = hour + minute / 60;
  const dark = h < 5 || h >= 21 ? 0.45 : h < 6.5 ? (0.45 * (6.5 - h)) / 1.5 : h >= 19 ? (0.45 * (h - 19)) / 2 : 0;
  return Math.round((1 - dark / 0.45) * 100) / 100;
}

/** The whole frame for the box (patches the adapter has are left out). */
export function buildFrame(f: FrameInput): Frame {
  const { s, host } = f;
  const box = boxOf(s, f.view);
  const land = s.road ? host.land() : null;
  const sim = s.road ? null : host.crowd();
  const pos = f.crowd.at(s, sim);
  const travellers = s.road ? travellersNow(host, s, Math.max(f.view.w, f.view.h) + MARGIN * 2) : [];
  const near = nearOf(s, f.crowd, travellers);
  const mapId = s.road ? "road" : s.map.id;

  // ---- terrain ----
  const patches: Patch[] = [];
  for (let py = Math.floor(box.y0 / PATCH); py <= Math.floor(box.y1 / PATCH); py++) {
    for (let px = Math.floor(box.x0 / PATCH); px <= Math.floor(box.x1 / PATCH); px++) {
      const key = `${mapId}:${px}:${py}`;
      if (f.hasPatch(key)) continue;
      const x0 = px * PATCH;
      const y0 = py * PATCH;
      const w = s.road ? PATCH : Math.min(PATCH, s.map.w - x0);
      const h = s.road ? PATCH : Math.min(PATCH, s.map.h - y0);
      if (w <= 0 || h <= 0) continue;
      const ground: number[] = [];
      const objects: number[] = [];
      for (let y = y0; y < y0 + h; y++) {
        for (let x = x0; x < x0 + w; x++) {
          const [g, o] = land ? roadArt(groundAt(land, x, y)) : placeArt(s.map.tiles[y]?.[x], s.map.buildings.some((b) => x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h));
          ground.push(g);
          objects.push(o);
        }
      }
      patches.push({ key, x0, y0, w, h, ground, objects });
    }
  }

  // ---- buildings, lights and signs ----
  const light = daylight(s.time.hour, s.time.minute);
  const buildings: NonNullable<Frame["buildings"]> = [];
  const lights: NonNullable<Frame["lights"]> = [];
  const signs: NonNullable<Frame["signs"]> = [];
  if (!s.road) {
    const inside = new Map<number, number[]>();
    pos.forEach((p, i) => p.inside !== undefined && (inside.get(p.inside) ?? inside.set(p.inside, []).get(p.inside)!).push(i));
    s.map.buildings.forEach((b, i) => {
      if (b.x + b.w < box.x0 || b.x > box.x1 || b.y + b.h < box.y0 || b.y > box.y1) return;
      const who = inside.get(i) ?? [];
      const what = b.name || (b.kind === "house" ? "A house" : (b.kind ?? "A building"));
      const names = sim ? who.slice(0, 6).map((k) => sim.roster.people[k]!.name.split(" ")[0]) : [];
      const tip = sim ? `${what}: ${who.length === 0 ? "nobody inside" : `${who.length} inside (${names.join(", ")}${who.length > 6 ? ", …" : ""})`}` : what;
      // A window is lit after dark while someone is at home (G6: a fact, so the server says it).
      const lit = light < 0.6 && who.length > 0;
      buildings.push({ id: i, x: b.x, y: b.y, w: b.w, h: b.h, kind: b.kind ?? "house", color: b.color, lit, label: b.name && b.name !== "Gate" ? b.name : "", tip });
      if (b.kind !== "market") lights.push({ id: `win:${i}`, x: b.x + b.w / 2, y: b.y + b.h - 1, kind: b.kind === "smithy" ? "forge" : "window", on: lit || (b.kind === "smithy" && light >= 0.6) });
    });
    for (const e of s.map.exits) {
      const arrow = e.x === 0 ? "◀" : e.x === s.map.w - 1 ? "▶" : e.y === 0 ? "▲" : "▼";
      signs.push({ id: `exit:${e.x}:${e.y}`, x: e.x, y: e.y, text: e.x === 0 || e.y === 0 ? `${arrow} ${e.label}` : `${e.label} ${arrow}`, kind: "exit" });
    }
  } else {
    for (const fp of host.roadData()?.footprints ?? []) {
      if (fp.x1 < box.x0 - 20 || fp.x0 > box.x1 + 20 || fp.y1 < box.y0 - 20 || fp.y0 > box.y1 + 20) continue;
      signs.push({ id: `place:${fp.id}`, x: (fp.x0 + fp.x1 + 1) / 2, y: fp.y0 - 0.2, text: fp.name, kind: "place" });
    }
  }

  // ---- actors ----
  const actors: Actor[] = [];
  const p = s.player;
  actors.push({ id: "player", kind: "player", x: s.position.x, y: s.position.y, look: { sprite: "people/player", tint: "#3f7fd0" }, label: `${p.name} (YOU)`, tip: `${p.name}, level ${p.level}`, hp: p.hp / Math.max(1, p.maxHp), flags: [] });
  const promoted = new Set<string>();
  if (s.road) {
    for (const t of travellers) {
      if (!inBox(box, Math.round(t.x), Math.round(t.y))) continue;
      promoted.add(t.id);
      actors.push({ id: t.id, kind: "traveller", x: t.x, y: t.y, look: { sprite: "people/body", tint: KIND_COLOR[t.kind] ?? "#8a7a5f" }, label: t.name, shortLabel: `[${t.kind}]`, tip: `${t.name}, ${t.role} of ${t.from}: ${t.purpose}`, flags: [] });
    }
  } else {
    for (const n of s.npcs) {
      promoted.add(n.id);
      if (n.away || !inBox(box, n.x, n.y)) continue;
      const flags: Actor["flags"] = [];
      if (n.dead) flags.push("dead");
      if (n.unconscious) flags.push("unconscious");
      if (n.inCombat) flags.push("engaged");
      if (n.pending.quest) flags.push("quest");
      if (n.busy) flags.push("busy");
      actors.push({
        id: n.id,
        kind: n.companion ? "companion" : "npc",
        x: n.x,
        y: n.y,
        look: { sprite: n.dead ? "fx/grave" : "people/body", tint: n.color },
        label: n.dead ? `${n.name} †` : n.name,
        tip: `${n.name} — ${n.role} · ${n.doing}`,
        hp: n.dead ? 1 : n.hp / Math.max(1, n.maxHp),
        flags,
      });
    }
  }
  for (const c of s.creatures) {
    if (!inBox(box, c.x, c.y)) continue;
    const person = c.kind === "bandit" || c.kind === "villager";
    const flags: Actor["flags"] = [];
    if (c.aggressive) flags.push("hostile");
    if (c.engaged) flags.push("engaged");
    actors.push({ id: c.uid, kind: "creature", x: c.x, y: c.y, look: { sprite: person ? "people/body" : `creature/${["wolf", "bear", "boar", "spider", "horse"].includes(c.kind) ? c.kind : "beast"}`, tint: c.color }, label: `${c.name} [${c.rank}]`, shortLabel: `[${c.rank}]`, tip: `${c.name}, ${c.kind} [${c.rank}], ${c.growth}`, hp: c.hp / Math.max(1, c.maxHp), flags });
  }
  if (sim) {
    pos.forEach((at, i) => {
      if (!at.visible || !inBox(box, at.x, at.y)) return;
      const who = sim.roster.people[i]!;
      if (promoted.has(who.id)) return;
      const flags: Actor["flags"] = [];
      if (CLASS_RANK[who.cls] >= 6) flags.push("noble");
      if (who.cls === "slave") flags.push("lowborn");
      actors.push({
        id: who.id,
        kind: "folk",
        x: at.x,
        y: at.y,
        look: { sprite: "people/body", tint: who.color, size: who.job === "child" ? 0.68 : 0.88, ...(CLASS_RANK[who.cls] >= 6 ? { trim: who.cls === "royal" ? "#ffe9a0" : "#f0d8f0" } : {}) },
        label: who.name.split(" ")[0]!,
        tip: describeFolk(sim, i, at),
        flags,
      });
    });
  }

  // ---- the prompt under whoever E or F acts on ----
  let prompt: Frame["prompt"] = null;
  if (near.prey && !f.talking) prompt = { text: near.prey.engaged ? "F: fight · R: run" : "F: fight", target: near.prey.uid, x: near.prey.x, y: near.prey.y, tone: near.prey.engaged ? "danger" : "fight" };
  else if (near.talker && f.talking !== near.talker.id && !s.npcs.find((n) => n.id === near.talker!.id)?.companion) {
    prompt = { text: `E: talk to ${near.talker.name}`, target: near.talker.id, x: near.talker.x, y: near.talker.y, tone: "talk" };
  }

  return {
    map: { id: mapId, name: s.road ? s.road.where : s.map.name, kind: s.road ? "road" : "place", w: s.road ? null : s.map.w, h: s.road ? null : s.map.h },
    box,
    patches,
    buildings,
    lights,
    signs,
    actors: { upsert: actors, remove: [] },
    player: { id: "player", x: s.position.x, y: s.position.y },
    ambience: { light, timeOfDay: s.time.timeOfDay, weather: s.time.weather, season: s.time.season },
    prompt,
    fight: s.fight,
    chatter: f.chatter ?? [],
    gossip: f.gossip ?? [],
    stepMs: STEP_MS,
  };
}

/**
 * A few of the crowd's conversations in the box, quarrels first then nearest the player, far enough apart that the
 * bubbles don't sit on each other (the rule the browser used for the camera's box, now in one place).
 */
export function pickChatter(s: Snapshot, crowd: CrowdClock, box: Frame["box"]): NonNullable<Frame["chatter"]> {
  const sim = crowd.sim;
  if (!sim || !s.crowd || crowd.pos.length === 0) return [];
  const marks = s.crowd.marks && s.crowd.marks.length > 0 ? new Map(s.crowd.marks.map((m) => [markKey(m.a, m.b, m.k), m])) : undefined;
  const promoted = new Set(s.npcs.map((n) => n.id));
  const id = (i: number) => sim.roster.people[i]!.id;
  const chats = sim.chats(s.time.day, s.time.hour * 60 + s.time.minute, s.crowd.day, crowd.pos, box, marks).filter((c) => !promoted.has(id(c.a)) && !promoted.has(id(c.b)));
  const me = s.position;
  const d2 = (i: number) => (crowd.pos[i]!.x - me.x) ** 2 + (crowd.pos[i]!.y - me.y) ** 2;
  const quarrel = (c: Chat) => (c.kind && isHostile(c.kind) ? 0 : 1);
  chats.sort((a, b) => quarrel(a) - quarrel(b) || d2(a.a) - d2(b.a));
  const picked: Chat[] = [];
  for (const c of chats) {
    const a = crowd.pos[c.a]!;
    if (picked.every((o) => Math.abs(crowd.pos[o.a]!.x - a.x) >= 7 || Math.abs(crowd.pos[o.a]!.y - a.y) >= 4)) picked.push(c);
    if (picked.length >= BUBBLES) break;
  }
  return picked.map((c) => ({ a: id(c.a), b: id(c.b), lines: c.lines, hot: !!c.kind && isHostile(c.kind), bow: c.bow }));
}

// ---------- changes only ----------

/** What the adapter has, so a frame can send only what changed. */
export class SentFrame {
  map: string | null = null;
  patches = new Set<string>();
  actors = new Map<string, { json: string; x: number; y: number }>();
  buildings = "";
  lights = "";
  signs = "";
  rest = "";

  reset(): void {
    this.map = null;
    this.patches.clear();
    this.actors.clear();
    this.buildings = this.lights = this.signs = this.rest = "";
  }
}

/** A route to draw a walker along between two tiles, or undefined (a step, or too far: the adapter moves them straight). */
function routeBetween(from: { x: number; y: number }, to: { x: number; y: number }, solid: (x: number, y: number) => boolean, budget: number): Array<{ x: number; y: number }> | undefined {
  const far = Math.abs(from.x - to.x) + Math.abs(from.y - to.y);
  if (far <= 1 || far > 30 || !Number.isInteger(to.x) || !Number.isInteger(from.x)) return undefined;
  const path = findPath(from, (t) => t.x === to.x && t.y === to.y, (x, y) => solid(x, y) && !(x === to.x && y === to.y), budget);
  return path && path.length <= 40 ? path : undefined;
}

/**
 * Turn a whole frame into what changed since `sent` (and remember it). A new map is sent whole. Actors that only
 * moved go as `move` entries, with a route round walls when they went more than a step.
 */
export function diffFrame(sent: SentFrame, full: Frame, solid: (x: number, y: number) => boolean): { frame: Frame; whole: boolean; empty: boolean } {
  const whole = sent.map !== full.map.id;
  if (whole) sent.reset();
  sent.map = full.map.id;
  for (const p of full.patches ?? []) sent.patches.add(p.key);
  const upsert: Actor[] = [];
  const move: NonNullable<Frame["actors"]["move"]> = [];
  const routes: NonNullable<Frame["actors"]["routes"]> = [];
  const seen = new Set<string>();
  let budget = 4000;
  for (const a of full.actors.upsert) {
    seen.add(a.id);
    const { x, y, route: _r, ...rest } = a;
    const json = JSON.stringify(rest);
    const old = sent.actors.get(a.id);
    if (!old || old.json !== json) upsert.push(a);
    else if (old.x !== x || old.y !== y) {
      // NPCs and beasts get a route round walls; townsfolk and travellers move a tile or two and are drawn straight.
      const route = a.kind === "npc" || a.kind === "companion" || a.kind === "creature" ? routeBetween(old, a, solid, Math.min(800, budget)) : undefined;
      budget -= 200;
      move.push([a.id, x, y]);
      if (route) routes.push({ id: a.id, route });
    }
    sent.actors.set(a.id, { json, x, y });
  }
  const remove = [...sent.actors.keys()].filter((id) => !seen.has(id));
  for (const id of remove) sent.actors.delete(id);
  const frame: Frame = { ...full, actors: { upsert, move, routes, remove } };
  const same = (k: "buildings" | "lights" | "signs") => {
    const json = JSON.stringify(full[k] ?? []);
    if (json === sent[k] && !whole) delete frame[k];
    sent[k] = json;
  };
  same("buildings");
  same("lights");
  same("signs");
  if (!frame.patches?.length) delete frame.patches;
  if (!frame.chatter?.length) delete frame.chatter;
  if (!frame.gossip?.length) delete frame.gossip;
  const rest = JSON.stringify([full.box, full.player, full.ambience, full.prompt, full.fight, full.map]);
  const empty = !whole && upsert.length === 0 && move.length === 0 && remove.length === 0 && !frame.patches && !frame.buildings && !frame.lights && !frame.signs && !frame.chatter && !frame.gossip && rest === sent.rest;
  sent.rest = rest;
  if (move.length === 0) delete frame.actors.move;
  if (routes.length === 0) delete frame.actors.routes;
  return { frame, whole, empty };
}
