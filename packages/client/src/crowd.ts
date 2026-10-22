/**
 * The townsfolk in the browser (N16): who lives on this map (fetched once per map
 * from GET /api/crowd) and where each of them is this minute, worked out by the
 * same code the server uses (@millbrook/shared crowd.ts). Nothing per person comes
 * over the wire per step. Someone the player has talked to is a full NPC in the
 * snapshot; the crowd leaves them out so they aren't drawn twice.
 */
import { CLASS_WORDS, CrowdSim, JOB_INFO, markKey, tileDistance, type Chat, type CrowdPos, type GossipTold, type Snapshot, type Townsperson } from "@millbrook/shared";
import { fetchCrowd } from "./api";

export const crowd = {
  sim: null as CrowdSim | null,
  /** The map the sim is for. */
  map: null as string | null,
  /** Where everyone is, by roster index, for `minute`. */
  pos: [] as CrowdPos[],
  /** The absolute game minute `pos` is for. */
  minute: -1,
  loading: null as Promise<void> | null,
};

/** Make sure we have the townsfolk of the map the snapshot is on (null-op if we do). Resolves when loaded. */
export function loadCrowd(s: Snapshot): Promise<void> {
  const want = s.crowd?.map ?? null;
  if (want === crowd.map && (crowd.sim || !want)) return crowd.loading ?? Promise.resolve();
  crowd.map = want;
  crowd.sim = null;
  crowd.pos = [];
  crowd.minute = -1;
  if (!want) return Promise.resolve();
  const p = fetchCrowd()
    .then((roster) => {
      // Moved on before it came back: drop it.
      if (crowd.map !== want || !roster || roster.map !== want) return;
      const m = s.map;
      crowd.sim = new CrowdSim({ id: m.id, w: m.w, h: m.h, tiles: m.tiles, buildings: m.buildings, zones: m.zones }, roster);
    })
    .catch(() => {
      crowd.map = null;
    })
    .finally(() => {
      if (crowd.loading === p) crowd.loading = null;
    });
  crowd.loading = p;
  return p;
}

const absMinute = (s: Snapshot) => s.time.day * 1440 + s.time.hour * 60 + s.time.minute;

/** Everyone's place for the snapshot's minute (worked out once per minute). Returns true if it changed. */
export function updateCrowd(s: Snapshot): boolean {
  const sim = crowd.sim;
  if (!sim || !s.crowd || s.crowd.map !== crowd.map) return false;
  const m = absMinute(s);
  if (m === crowd.minute) return false;
  crowd.minute = m;
  crowd.pos = sim.all(s.time.day, s.time.hour * 60 + s.time.minute, s.crowd.day);
  return true;
}

/** Who's talking to whom inside a box of tiles, this minute. */
export function crowdChats(s: Snapshot, box: { x0: number; y0: number; x1: number; y1: number }): Chat[] {
  const sim = crowd.sim;
  if (!sim || !s.crowd || crowd.pos.length === 0) return [];
  // The server says what really passed between some of them (N37): those chats get the words and the look of it.
  const marks = s.crowd.marks && s.crowd.marks.length > 0 ? new Map(s.crowd.marks.map((m) => [markKey(m.a, m.b, m.k), m])) : undefined;
  return sim.chats(s.time.day, s.time.hour * 60 + s.time.minute, s.crowd.day, crowd.pos, box, marks).filter((c) => !promoted(s, c.a) && !promoted(s, c.b));
}

/** Is this roster index someone who's a full NPC in the snapshot (drawn as one)? */
export function promoted(s: Snapshot, i: number): boolean {
  const id = crowd.sim?.roster.people[i]?.id;
  return !!id && s.npcs.some((n) => n.id === id);
}

export function person(i: number): Townsperson | undefined {
  return crowd.sim?.roster.people[i];
}

/** Someone of the crowd out on this tile. */
export function folkAt(s: Snapshot, x: number, y: number): number | null {
  for (let i = 0; i < crowd.pos.length; i++) {
    const p = crowd.pos[i]!;
    if (p.visible && p.x === x && p.y === y && !promoted(s, i)) return i;
  }
  return null;
}

/** The nearest of the crowd within talking range, with how far. */
export function nearestFolk(s: Snapshot): { i: number; d: number } | null {
  let best: { i: number; d: number } | null = null;
  for (let i = 0; i < crowd.pos.length; i++) {
    const p = crowd.pos[i]!;
    if (!p.visible) continue;
    const d = tileDistance(s.position, p);
    if (d <= s.map.talkRange && (!best || d < best.d) && !promoted(s, i)) best = { i, d };
  }
  return best;
}

/** "Ada Lowe — weaver (craftsman), the Weavers' Guild · at the loom". */
export function describeFolk(i: number): string {
  const p = person(i);
  const at = crowd.pos[i];
  if (!p) return "";
  const job = JOB_INFO[p.job].words;
  const cls = CLASS_WORDS[p.cls];
  const what = p.job === "child" ? `child (${cls})` : job === cls ? job : `${job} (${cls})`;
  const master = p.master ? (p.cls === "slave" ? `, slave of ${p.master}` : p.cls === "serf" ? `, bound to ${p.master}` : p.job === "servant" ? `, serves ${p.master}` : "") : "";
  return `${p.name}, ${p.age} — ${what}${master}${p.factionName ? `, ${p.factionName}` : ""}${at ? ` · ${at.doing}` : ""}`;
}

/** Who's inside a building now. */
export function insideOf(building: number): number[] {
  const out: number[] = [];
  crowd.pos.forEach((p, i) => p.inside === building && out.push(i));
  return out;
}

/** The bubble for something a townsperson passed on (N33): what they said, in their words, short enough to read at a glance. */
export function gossipBubble(text: string): string {
  const line = `Did you hear? ${text.replace(/\.$/, "")}.`;
  return line.length > 70 ? `${line.slice(0, 68)}…` : line;
}

/** What was said since the last one shown (by `seq`), with the roster index of whoever said it, for those on this map. */
export function freshTold(s: Snapshot, after: number): Array<{ seq: number; who: number; line: string }> {
  const told: GossipTold[] = s.crowd?.told ?? [];
  const sim = crowd.sim;
  if (!sim || told.length === 0) return [];
  return told.filter((t) => t.seq > after).flatMap((t) => {
    const who = sim.index.get(t.who);
    return who === undefined ? [] : [{ seq: t.seq, who, line: gossipBubble(t.text) }];
  });
}
