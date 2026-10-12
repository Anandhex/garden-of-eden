/**
 * The townsfolk (N16): everyone who lives in a place, on its map, going about
 * their day minute by minute. The server rolls who they are (the roster: name,
 * class, job, faction, home, workplace; game/realm/townsfolk.ts); where they are
 * at any minute is worked out here, from the roster, the map and the clock, the
 * same way on the server and in the browser. Nothing is sent per step and nothing
 * costs a model call: a person becomes a talking NPC only when the player talks to
 * them.
 *
 * A day: asleep at home, up and out, the walk to work (one tile a minute, by the
 * shortest way), work (roaming a little about their spot, in and out of the
 * building for indoor trades), a midday break at the inn, the market or the well,
 * errands, an evening out for some, home to bed. Slaves work longer and rest less;
 * nobles take their ease; guards stand watches round the clock; children play.
 * People standing near each other talk (chatLines): what they say depends on their
 * rank (bows, deference and scorn), their factions (old grudges) and the day.
 */

// ---------- who they are ----------

/** Social classes, lowest first. */
export const CLASSES = ["slave", "serf", "commoner", "artisan", "merchant", "clergy", "gentry", "noble", "royal"] as const;
export type SocialClass = (typeof CLASSES)[number];

/** Standing in the pecking order: higher outranks lower. Artisans and merchants stand level. */
export const CLASS_RANK: Record<SocialClass, number> = { slave: 0, serf: 1, commoner: 2, artisan: 3, merchant: 3, clergy: 4, gentry: 5, noble: 6, royal: 7 };

export const CLASS_WORDS: Record<SocialClass, string> = {
  slave: "slave",
  serf: "serf",
  commoner: "commoner",
  artisan: "craftsman",
  merchant: "merchant",
  clergy: "cleric",
  gentry: "gentry",
  noble: "noble",
  royal: "royal",
};

/** Clothes by class (sprite colour); each person's is shaded a little from it. */
export const CLASS_COLORS: Record<SocialClass, string> = {
  slave: "#6f6455",
  serf: "#8a8455",
  commoner: "#a2865c",
  artisan: "#7d5f45",
  merchant: "#3f7f6f",
  clergy: "#ddd6c2",
  gentry: "#4f6fa0",
  noble: "#83408a",
  royal: "#d4a017",
};

export const JOBS = [
  "farmer",
  "labourer",
  "porter",
  "washer",
  "weaver",
  "carpenter",
  "cobbler",
  "tailor",
  "potter",
  "smith",
  "apprentice",
  "baker",
  "stallholder",
  "merchant",
  "innkeeper",
  "server",
  "guard",
  "knight",
  "priest",
  "acolyte",
  "clerk",
  "scholar",
  "courtier",
  "noble",
  "royal",
  "servant",
  "slave",
  "child",
  "elder",
  "beggar",
  "miner",
  "hunter",
  "adventurer",
] as const;
export type Job = (typeof JOBS)[number];

export interface JobInfo {
  /** "a farmer", for the words. */
  words: string;
  /** They keep goods to sell (only traders do). */
  sells: boolean;
  /** Works out of doors all day (stays in in a storm). */
  outdoor?: boolean;
  /** Works inside a building, coming out now and then. */
  indoor?: boolean;
}

export const JOB_INFO: Record<Job, JobInfo> = {
  farmer: { words: "farmer", sells: false, outdoor: true },
  labourer: { words: "labourer", sells: false, outdoor: true },
  porter: { words: "porter", sells: false, outdoor: true },
  washer: { words: "washerwoman", sells: false, outdoor: true },
  weaver: { words: "weaver", sells: true, indoor: true },
  carpenter: { words: "carpenter", sells: false },
  cobbler: { words: "cobbler", sells: true, indoor: true },
  tailor: { words: "tailor", sells: true, indoor: true },
  potter: { words: "potter", sells: true },
  smith: { words: "smith", sells: true },
  apprentice: { words: "apprentice", sells: false },
  baker: { words: "baker", sells: true, indoor: true },
  stallholder: { words: "stallholder", sells: true, outdoor: true },
  merchant: { words: "merchant", sells: true },
  innkeeper: { words: "innkeeper", sells: true, indoor: true },
  server: { words: "serving hand", sells: false, indoor: true },
  guard: { words: "guard", sells: false },
  knight: { words: "knight", sells: false },
  priest: { words: "priest", sells: false, indoor: true },
  acolyte: { words: "acolyte", sells: false, indoor: true },
  clerk: { words: "clerk", sells: false, indoor: true },
  scholar: { words: "scholar", sells: false, indoor: true },
  courtier: { words: "courtier", sells: false, indoor: true },
  noble: { words: "noble", sells: false },
  royal: { words: "royal", sells: false },
  servant: { words: "servant", sells: false, indoor: true },
  slave: { words: "slave", sells: false, outdoor: true },
  child: { words: "child", sells: false, outdoor: true },
  elder: { words: "elder", sells: false },
  beggar: { words: "beggar", sells: false, outdoor: true },
  miner: { words: "miner", sells: false },
  hunter: { words: "hunter", sells: false },
  adventurer: { words: "adventurer", sells: false },
};

/** One of the townsfolk. Their id is `t_<site>_<n>`; it's their persona id if they come to talk. */
export interface Townsperson {
  id: string;
  name: string;
  gender: "female" | "male";
  age: number;
  cls: SocialClass;
  job: Job;
  /** Their faction (realm faction id) and its name, if they belong to one. */
  faction: string | null;
  factionName: string | null;
  /** The building they live in (index into the map's buildings). */
  home: number;
  /**
   * Where they work: `front:<building>` (outside its door, and in and out of it for indoor trades),
   * `zone:<zone id>` (the market, the fields, the gate), `streets` (about the town, from door to door),
   * `out:<zone id>` (out through an exit, to the mine or the woods) or `home`.
   */
  work: string;
  /** Who they belong to or serve (a slave's master, a servant's employer, a serf's lord), by name. */
  master: string | null;
  /** The townsperson id of their master, when that's one of the townsfolk. */
  masterId: string | null;
  color: string;
}

/** Everyone in a place, and what they talk about. */
export interface CrowdRoster {
  site: string;
  /** The map they're on (a settlement's village). */
  map: string;
  /** "Ashby". */
  place: string;
  /** The head of the place, titled ("Mayor Ada Lowe"), and the crown over it ("Queen Maud Reed"). */
  lord: string | null;
  ruler: string | null;
  /** The kingdom's laws: are there slaves, are there serfs. */
  laws: { slavery: boolean; serfdom: boolean };
  people: Townsperson[];
  /** Factions (ids) that despise each other: their members trade insults. */
  rivals: Array<[string, string]>;
  /** Factions that look down on others: [the haughty one, the one they look down on]. */
  scorn: Array<[string, string]>;
  /** What the town is talking about: the realm's latest news. */
  talk: string[];
}

// ---------- where they go ----------

export interface CrowdZone {
  id: string;
  /** "square", "market", "fields", "gate", "exit_road", "exit_woods", "yard". */
  kind: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface CrowdBuilding {
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** "house", "manor", "inn", "smithy", "hall", "temple", "market", "guildhall", "barracks", "granary", "palace". */
  kind?: string;
  /** The tile outside its door, where people come and go. */
  front?: { x: number; y: number };
}

/** What the simulation needs of a map. */
export interface CrowdMap {
  id: string;
  w: number;
  h: number;
  tiles: string[][];
  buildings: CrowdBuilding[];
  zones: CrowdZone[];
}

/** Today's conditions. */
export interface CrowdDay {
  weather: string;
  festival: boolean;
}

export interface CrowdPos {
  x: number;
  y: number;
  /** Out on the map (not indoors). */
  visible: boolean;
  /** On the way somewhere (not stopping to talk). */
  moving: boolean;
  /** "at work", "on a break", "heading home". */
  doing: string;
  /** Indoors: the building they're in. */
  inside?: number;
}

export interface Chat {
  a: number;
  b: number;
  lines: [string, string];
  /** The lower of the two bows to the higher. */
  bow: boolean;
}

type Target = { k: "in"; b: number } | { k: "front"; b: number } | { k: "zone"; z: string } | { k: "out"; z: string };

interface PlanEntry {
  at: number;
  t: Target;
  doing: string;
}

/** Minutes a person stays at one spot before shifting a step or two. */
export const WANDER_MINUTES = 4;
/** Minutes two people keep at one exchange. */
export const CHAT_MINUTES = 3;

// ---------- hashing (the same on server and client) ----------

/** FNV-1a: a stable 32-bit hash of a string. */
export function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Mulberry32: a small seeded generator, 0..1. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const mix = (...parts: Array<string | number>) => hashStr(parts.join("|"));

// ---------- the simulation ----------

const SOLID = new Set(["tree", "wall", "water", "door"]);
const DIRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

/**
 * Where the townsfolk of one map are. Distance fields (one per place people go) and
 * each person's plan for the day are worked out once and kept.
 */
export class CrowdSim {
  private readonly fields = new Map<string, Int16Array>();
  private readonly masks = new Map<string, Uint8Array>();
  private readonly tileLists = new Map<string, number[]>();
  private readonly plans = new Map<string, { key: string; plan: PlanEntry[] }>();
  private readonly byKind = new Map<string, number[]>();
  private readonly zoneIds = new Set<string>();
  readonly index = new Map<string, number>();

  constructor(
    readonly map: CrowdMap,
    /** Who's here; swapped for a fresh copy (new news, a new lord) when the people are the same. */
    public roster: CrowdRoster,
  ) {
    map.buildings.forEach((b, i) => {
      if (!b.kind || !b.front) return;
      const list = this.byKind.get(b.kind) ?? [];
      list.push(i);
      this.byKind.set(b.kind, list);
    });
    for (const z of map.zones) this.zoneIds.add(z.id);
    roster.people.forEach((p, i) => this.index.set(p.id, i));
  }

  private solid(x: number, y: number): boolean {
    const t = this.map.tiles[y]?.[x];
    return t === undefined || SOLID.has(t);
  }

  /** Buildings of a kind (with a door). */
  buildingsOf(kind: string): number[] {
    return this.byKind.get(kind) ?? [];
  }

  hasZone(id: string): boolean {
    return this.zoneIds.has(id);
  }

  private key(t: Target): string {
    return t.k === "in" || t.k === "front" ? `b${t.b}` : `z${t.z}`;
  }

  /** The tiles someone can stand on at a target (indices y*w+x). */
  private tilesOf(t: Target): number[] {
    const key = this.key(t);
    const hit = this.tileLists.get(key);
    if (hit) return hit;
    const { w } = this.map;
    const out: number[] = [];
    if (t.k === "in" || t.k === "front") {
      const f = this.map.buildings[t.b]?.front;
      if (f && !this.solid(f.x, f.y)) {
        out.push(f.y * w + f.x);
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && !this.solid(f.x + dx, f.y + dy)) out.push((f.y + dy) * w + f.x + dx);
      }
    } else {
      const z = this.map.zones.find((x) => x.id === t.z);
      if (z) for (let y = z.y0; y <= z.y1; y++) for (let x = z.x0; x <= z.x1; x++) if (!this.solid(x, y)) out.push(y * w + x);
    }
    // Nowhere to stand: the square, or anywhere open.
    if (out.length === 0) {
      const sq = this.map.zones.find((x) => x.kind === "square");
      if (sq && !(t.k === "zone" && t.z === sq.id)) out.push(...this.tilesOf({ k: "zone", z: sq.id }));
      else for (let i = 0; i < this.map.w * this.map.h && out.length === 0; i++) if (!this.solid(i % w, Math.floor(i / w))) out.push(i);
    }
    this.tileLists.set(key, out);
    const mask = new Uint8Array(this.map.w * this.map.h);
    for (const i of out) mask[i] = 1;
    this.masks.set(key, mask);
    return out;
  }

  /** Steps from every tile to a target (-1: no way there). */
  private field(t: Target): Int16Array {
    const key = this.key(t);
    const hit = this.fields.get(key);
    if (hit) return hit;
    const { w, h } = this.map;
    const f = new Int16Array(w * h).fill(-1);
    const queue: number[] = [];
    for (const i of this.tilesOf(t)) {
      f[i] = 0;
      queue.push(i);
    }
    for (let head = 0; head < queue.length; head++) {
      const i = queue[head]!;
      const x = i % w;
      const y = (i - x) / w;
      for (const [dx, dy] of DIRS) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const n = ny * w + nx;
        if (f[n] !== -1 || this.solid(nx, ny)) continue;
        f[n] = f[i]! + 1;
        queue.push(n);
      }
    }
    this.fields.set(key, f);
    return f;
  }

  /** Where someone stands at a target at an absolute minute: their own spot there, shifting a step or two now and then. */
  private restAt(p: Townsperson, t: Target, abs: number): number {
    const tiles = this.tilesOf(t);
    const key = this.key(t);
    const anchor = tiles[mix(p.id, key) % tiles.length]!;
    const mask = this.masks.get(key)!;
    const { w } = this.map;
    const ax = anchor % w;
    const ay = (anchor - ax) / w;
    const cands: number[] = [anchor];
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const x = ax + dx;
        const y = ay + dy;
        if ((dx || dy) && x >= 0 && y >= 0 && x < w && y < this.map.h && mask[y * w + x]) cands.push(y * w + x);
      }
    }
    const k = Math.floor(abs / WANDER_MINUTES);
    // Half the time they're at their own spot; otherwise a step or two from it.
    const r = mix(p.id, k);
    return r % 2 === 0 ? anchor : cands[r % cands.length]!;
  }

  private tileOf(t: Target): number {
    return this.tilesOf(t)[0]!;
  }

  /** Walk `steps` along the shortest way from `from` towards `t`. Returns the tile and whether they got there. */
  private walk(p: Townsperson, from: number, t: Target, steps: number): { at: number; arrived: boolean; left: number } {
    const f = this.field(t);
    const { w, h } = this.map;
    if (f[from] === undefined || f[from]! < 0) return { at: this.tileOf(t), arrived: true, left: steps };
    let cur = from;
    let s = 0;
    const seed = hashStr(p.id);
    while (s < steps && f[cur]! > 0) {
      const x = cur % w;
      const y = (cur - x) / w;
      const next: number[] = [];
      for (const [dx, dy] of DIRS) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const n = ny * w + nx;
        if (f[n] === f[cur]! - 1) next.push(n);
      }
      if (next.length === 0) break;
      cur = next[(seed + s) % next.length]!;
      s++;
    }
    return { at: cur, arrived: f[cur] === 0, left: steps - s };
  }

  /** Their plan for a day (kept until the day or the weather changes). */
  plan(p: Townsperson, day: number, d: CrowdDay): PlanEntry[] {
    const key = `${day}|${d.weather}|${d.festival}`;
    const hit = this.plans.get(p.id);
    if (hit && hit.key === key) return hit.plan;
    const plan = dayPlan(this, p, day, d);
    this.plans.set(p.id, { key, plan });
    return plan;
  }

  /** Where a person is at a minute of a day. */
  at(p: Townsperson, day: number, minute: number, d: CrowdDay): CrowdPos {
    const plan = this.plan(p, day, d);
    let i = 0;
    for (let j = 0; j < plan.length; j++) if (plan[j]!.at <= minute) i = j;
    const e = plan[i]!;
    const abs = day * 1440 + minute;
    const prev = i > 0 ? plan[i - 1]! : plan.at(-1)!;
    const origin = prev.t.k === "in" || prev.t.k === "out" ? this.tileOf(prev.t.k === "in" ? { k: "front", b: prev.t.b } : { k: "zone", z: prev.t.z }) : this.restAt(p, prev.t, day * 1440 + e.at);
    const r = this.walk(p, origin, e.t, minute - e.at);
    const { w } = this.map;
    const xy = (i: number) => ({ x: i % w, y: Math.floor(i / w) });
    if (!r.arrived) return { ...xy(r.at), visible: true, moving: true, doing: headingWords(this, e) };
    if (e.t.k === "in") return { ...xy(r.at), visible: false, moving: false, doing: e.doing, inside: e.t.b };
    if (e.t.k === "out") return { ...xy(r.at), visible: false, moving: false, doing: e.doing };
    // Just got there this minute: where they arrived; after that, about their spot.
    const spot = r.left === 0 ? r.at : this.restAt(p, e.t, abs);
    return { ...xy(spot), visible: true, moving: false, doing: e.doing };
  }

  /** Everyone, at a minute. */
  all(day: number, minute: number, d: CrowdDay): CrowdPos[] {
    return this.roster.people.map((p) => this.at(p, day, minute, d));
  }

  /**
   * Who's talking to whom: people standing next to each other (not on their way
   * somewhere) strike up an exchange now and then. Only those inside `near` (a
   * box of tiles) if given, so the browser works out only what it shows.
   */
  chats(day: number, minute: number, d: CrowdDay, at: CrowdPos[], near?: { x0: number; y0: number; x1: number; y1: number }): Chat[] {
    const { w } = this.map;
    const people = this.roster.people;
    const byTile = new Map<number, number[]>();
    at.forEach((pos, i) => {
      if (!pos.visible) return;
      if (near && (pos.x < near.x0 || pos.x > near.x1 || pos.y < near.y0 || pos.y > near.y1)) return;
      const k = pos.y * w + pos.x;
      const list = byTile.get(k) ?? [];
      list.push(i);
      byTile.set(k, list);
    });
    const k = Math.floor((day * 1440 + minute) / CHAT_MINUTES);
    const paired = new Set<number>();
    const out: Chat[] = [];
    for (const [tile, here] of byTile) {
      for (const i of here) {
        if (paired.has(i)) continue;
        const a = at[i]!;
        const x = tile % w;
        const y = (tile - x) / w;
        let best: number | null = null;
        for (let dy = -1; dy <= 1 && best === null; dy++) {
          for (let dx = -1; dx <= 1 && best === null; dx++) {
            for (const j of byTile.get((y + dy) * w + x + dx) ?? []) {
              if (j === i || paired.has(j)) continue;
              const b = at[j]!;
              const pa = people[i]!;
              const pb = people[j]!;
              // A noble passing by: the low-born bow, even mid-stride.
              const gap = Math.abs(CLASS_RANK[pa.cls] - CLASS_RANK[pb.cls]);
              const passing = (a.moving || b.moving) && gap >= 4 && Math.min(CLASS_RANK[pa.cls], CLASS_RANK[pb.cls]) <= 2;
              if ((a.moving || b.moving) && !passing) continue;
              const [lo, hi] = i < j ? [pa.id, pb.id] : [pb.id, pa.id];
              if (mix(lo, hi, k) % 100 >= (passing ? 70 : 40)) continue;
              best = j;
              break;
            }
          }
        }
        if (best === null) continue;
        paired.add(i);
        paired.add(best);
        const pa = people[i]!;
        const pb = people[best]!;
        // The one who speaks first: the lower to the higher (a greeting), else either.
        const first = CLASS_RANK[pa.cls] === CLASS_RANK[pb.cls] ? (mix(pa.id, k) % 2 === 0 ? i : best) : CLASS_RANK[pa.cls] < CLASS_RANK[pb.cls] ? i : best;
        const second = first === i ? best : i;
        const lines = chatLines(this.roster, people[first]!, people[second]!, d, minute, mix(people[first]!.id, people[second]!.id, k));
        out.push({ a: first, b: second, lines, bow: CLASS_RANK[people[second]!.cls] - CLASS_RANK[people[first]!.cls] >= 3 });
      }
    }
    return out;
  }
}

/** "heading to the market". */
function headingWords(sim: CrowdSim, e: PlanEntry): string {
  if (e.doing === "asleep" || e.doing === "home for the night") return "heading home";
  if (e.doing === "on a break") return "off for a break";
  if (e.t.k === "out") return "heading out of town";
  const b = e.t.k === "in" || e.t.k === "front" ? sim.map.buildings[e.t.b] : undefined;
  if (b?.kind === "house" || b?.kind === "manor") return "heading home";
  if (b) return `heading to the ${b.kind === "smithy" ? "smithy" : (b.kind ?? "door")}`;
  return `heading to the ${e.t.k === "zone" ? (sim.map.zones.find((z) => z.id === (e.t as { z: string }).z)?.kind ?? "square") : "square"}`;
}

// ---------- the day ----------

const H = 60;

/** Parse a roster `work` string to a target. */
function workTarget(sim: CrowdSim, p: Townsperson): Target | "streets" {
  const w = p.work;
  if (w === "streets") return "streets";
  if (w === "home") return { k: "front", b: p.home };
  const [kind, rest] = w.split(":") as [string, string | undefined];
  if (kind === "front" && rest !== undefined && sim.map.buildings[Number(rest)]?.front) return { k: "front", b: Number(rest) };
  if (kind === "zone" && rest && sim.hasZone(rest)) return { k: "zone", z: rest };
  if (kind === "out" && rest && sim.hasZone(rest)) return { k: "out", z: rest };
  return square(sim);
}

function square(sim: CrowdSim): Target {
  const z = sim.map.zones.find((x) => x.kind === "square") ?? sim.map.zones[0];
  return z ? { k: "zone", z: z.id } : { k: "front", b: 0 };
}

/** A building of a kind's front, or the square. */
function frontOf(sim: CrowdSim, kind: string, r: () => number): Target {
  const list = sim.buildingsOf(kind);
  return list.length > 0 ? { k: "front", b: list[Math.floor(r() * list.length)]! } : square(sim);
}

function zoneOr(sim: CrowdSim, kind: string): Target {
  const z = sim.map.zones.find((x) => x.kind === kind);
  return z ? { k: "zone", z: z.id } : square(sim);
}

/** Somewhere to spend a break or an evening, by class. */
function leisure(sim: CrowdSim, p: Townsperson, r: () => number, evening: boolean): Target {
  const roll = r();
  const rank = CLASS_RANK[p.cls];
  if (p.cls === "clergy") return frontOf(sim, "temple", r);
  if (rank >= 6) return roll < 0.4 ? frontOf(sim, "temple", r) : roll < 0.7 ? zoneOr(sim, "market") : frontOf(sim, sim.buildingsOf("palace").length > 0 ? "palace" : "hall", r);
  if (evening) return roll < 0.55 ? frontOf(sim, "inn", r) : roll < 0.85 ? square(sim) : frontOf(sim, "temple", r);
  return roll < 0.4 ? frontOf(sim, "inn", r) : roll < 0.75 ? zoneOr(sim, "market") : square(sim);
}

/** Some fronts about town, for people whose work moves them from door to door. */
function rounds(sim: CrowdSim, r: () => number): Target {
  const kinds = ["market", "inn", "smithy", "hall", "temple", "granary", "guildhall", "house", "house"];
  const kind = kinds[Math.floor(r() * kinds.length)]!;
  if (kind === "market" && sim.hasZone("market")) return { k: "zone", z: "market" };
  return frontOf(sim, kind, r);
}

/**
 * A person's day, as a list of (minute, where, doing). Rolled from their id and the
 * day, so it's the same wherever it's worked out.
 */
function dayPlan(sim: CrowdSim, p: Townsperson, day: number, d: CrowdDay): PlanEntry[] {
  const r = seeded(mix(p.id, day));
  const roll = (lo: number, hi: number) => Math.round(lo + r() * (hi - lo));
  const home: Target = { k: "in", b: p.home };
  const homeFront: Target = { k: "front", b: p.home };
  const storm = d.weather === "storm";
  const wet = storm || d.weather === "rain" || d.weather === "snow";
  const info = JOB_INFO[p.job];
  const out: PlanEntry[] = [];
  const push = (at: number, t: Target, doing: string) => {
    if (out.length > 0 && at <= out.at(-1)!.at) at = out.at(-1)!.at + 1;
    if (at < 1440) out.push({ at, t, doing });
  };

  // Night watchmen and others who work the small hours start the day at their post.
  const guardShift = p.job === "guard" ? mix(p.id, "shift") % 3 : -1;
  const target = workTarget(sim, p);
  const doingWork = workDoing(p.job);

  /** Work from `from` to `to`: at their post, in and out for indoor trades, door to door for rounds. */
  const work = (from: number, to: number) => {
    if (to <= from) return;
    if (target === "streets") {
      for (let t = from; t < to; t += roll(35, 70)) push(t, rounds(sim, r), doingWork);
      return;
    }
    if (storm && info.outdoor && target.k === "zone") {
      push(from, home, "sheltering from the storm");
      return;
    }
    if (info.indoor && (target.k === "front" || target.k === "in")) {
      const b = target.k === "front" ? target.b : target.b;
      for (let t = from; t < to; ) {
        const inside = roll(25, 50);
        push(t, { k: "in", b }, doingWork);
        t += inside;
        if (t >= to) break;
        push(t, { k: "front", b }, doingWork);
        t += roll(12, 25);
      }
      return;
    }
    push(from, target, doingWork);
    // Errands: a trip to the market or a neighbour's door for some.
    if (to - from > 3 * H && r() < 0.3) {
      const at = roll(from + H, to - H);
      push(at, rounds(sim, r), "on an errand");
      push(at + roll(15, 30), target, doingWork);
    }
  };

  const sleepAt = (lo: number, hi: number) => Math.min(1439, roll(lo, hi));

  switch (p.job) {
    case "child": {
      push(0, home, "asleep");
      const wake = roll(6.5 * H, 7.5 * H);
      push(wake, homeFront, "up and about");
      if (storm) {
        push(wake + 20, home, "kept indoors");
        break;
      }
      push(wake + roll(20, 60), r() < 0.6 ? square(sim) : rounds(sim, r), "playing");
      push(roll(11.5 * H, 12.5 * H), home, "home for a meal");
      push(roll(13 * H, 13.5 * H), r() < 0.5 ? square(sim) : rounds(sim, r), "playing");
      push(roll(15 * H, 15.5 * H), r() < 0.5 ? square(sim) : zoneOr(sim, "market"), "running about");
      push(roll(17.5 * H, 18.5 * H), homeFront, "called in");
      push(sleepAt(19 * H, 20 * H), home, "asleep");
      break;
    }
    case "elder": {
      push(0, home, "asleep");
      push(roll(6 * H, 8 * H), homeFront, "up and about");
      if (!wet) push(roll(9 * H, 10 * H), r() < 0.6 ? square(sim) : frontOf(sim, "temple", r), "taking the air");
      push(roll(12 * H, 12.5 * H), home, "at home");
      if (!wet) push(roll(14 * H, 15 * H), r() < 0.5 ? frontOf(sim, "temple", r) : square(sim), "sitting in the sun");
      push(roll(17 * H, 18 * H), home, "at home");
      push(sleepAt(20 * H, 21 * H), home, "asleep");
      break;
    }
    case "beggar": {
      push(0, home, "asleep");
      push(roll(6 * H, 7 * H), r() < 0.5 ? square(sim) : zoneOr(sim, "gate"), "begging");
      push(roll(13 * H, 14 * H), frontOf(sim, "temple", r), "begging at the temple");
      push(roll(17 * H, 18 * H), frontOf(sim, "inn", r), "begging by the inn");
      push(sleepAt(21 * H, 23 * H), home, "asleep");
      break;
    }
    case "noble":
    case "royal":
    case "courtier": {
      push(0, home, "asleep");
      const wake = roll(7 * H, 9 * H);
      push(wake, home, "at home");
      const outings = storm ? 0 : wet ? 1 : roll(1, 3);
      let t = roll(9.5 * H, 11 * H);
      if (p.job === "courtier") {
        work(t, 12.5 * H);
        t = 12.5 * H;
      } else {
        for (let o = 0; o < outings && t < 12.5 * H; o++) {
          push(t, leisure(sim, p, r, false), o === 0 ? "out with their retinue" : "paying calls");
          t += roll(40, 75);
        }
      }
      push(Math.max(t, 12.5 * H), home, "dining at home");
      t = roll(14.5 * H, 15.5 * H);
      if (p.job === "courtier") work(t, 17.5 * H);
      else if (!storm && r() < 0.7) push(t, frontOf(sim, sim.buildingsOf("palace").length > 0 ? "palace" : "hall", r), "at court");
      push(roll(17.5 * H, 18.5 * H), home, "at home");
      if (!wet && r() < 0.35) {
        push(roll(19 * H, 20 * H), leisure(sim, p, r, true), "out for the evening");
        push(roll(21 * H, 22 * H), home, "at home");
      }
      push(sleepAt(22 * H, 23.5 * H), home, "asleep");
      break;
    }
    case "slave": {
      push(0, home, "asleep");
      const wake = roll(4.5 * H, 5.25 * H);
      push(wake, homeFront, "up before dawn");
      const brk = roll(12 * H, 13 * H);
      work(wake + 15, brk);
      push(brk, target === "streets" ? homeFront : target, "a short rest");
      work(brk + roll(15, 25), roll(20 * H, 21 * H));
      push(sleepAt(21 * H, 21.5 * H), home, "asleep");
      break;
    }
    case "innkeeper":
    case "server": {
      push(0, home, "asleep");
      const wake = roll(7.5 * H, 8.5 * H);
      push(wake, homeFront, "up and about");
      const brk = roll(15 * H, 16 * H);
      work(wake + 20, brk);
      push(brk, square(sim), "on a break");
      work(brk + roll(25, 40), roll(23 * H, 23.6 * H));
      push(sleepAt(23.6 * H, 23.9 * H), home, "asleep");
      break;
    }
    case "guard": {
      // Three watches: dawn to mid-afternoon, then to late evening, then through the night.
      const post = target === "streets" ? null : target;
      const watch = (from: number, to: number) => {
        for (let t = from; t < to; t += roll(45, 80)) push(t, post && r() < 0.6 ? post : rounds(sim, r), "on watch");
      };
      if (guardShift === 0) {
        push(0, home, "asleep");
        push(roll(5.5 * H, 6 * H), homeFront, "up and about");
        watch(6 * H, 14 * H);
        push(14 * H + roll(0, 20), leisure(sim, p, r, false), "off duty");
        push(roll(16 * H, 18 * H), home, "at home");
        if (!wet && r() < 0.4) {
          push(roll(18.5 * H, 19.5 * H), leisure(sim, p, r, true), "off duty");
          push(roll(20.5 * H, 21.5 * H), home, "at home");
        }
        push(sleepAt(21.5 * H, 22 * H), home, "asleep");
      } else if (guardShift === 1) {
        push(0, home, "asleep");
        push(roll(8 * H, 9 * H), homeFront, "up and about");
        push(roll(9.5 * H, 10.5 * H), leisure(sim, p, r, false), "off duty");
        push(roll(12 * H, 13 * H), home, "at home");
        watch(14 * H, 22 * H);
        push(22 * H + roll(5, 20), home, "asleep");
      } else {
        watch(0, 6 * H);
        push(6 * H + roll(5, 20), home, "asleep");
        push(roll(14 * H, 15 * H), homeFront, "up and about");
        push(roll(15 * H, 16 * H), leisure(sim, p, r, false), "off duty");
        push(roll(19 * H, 20 * H), home, "at home");
        watch(22 * H, 24 * H);
      }
      break;
    }
    default: {
      // The working day: up at dawn, a break at midday, maybe an evening out.
      const early = p.cls === "serf" || p.job === "farmer" || p.job === "smith" || p.job === "baker";
      push(0, home, "asleep");
      const wake = early ? roll(5 * H, 6 * H) : roll(6 * H, 7 * H);
      push(wake, homeFront, "up and about");
      const start = wake + roll(15, 45);
      const lunch = roll(11.5 * H, 13.5 * H);
      const lunchEnd = lunch + (p.cls === "serf" ? roll(20, 35) : roll(30, 60));
      const end = p.cls === "serf" ? roll(18.5 * H, 19.5 * H) : p.job === "baker" ? roll(15 * H, 16 * H) : roll(17 * H, 18.5 * H);
      // A short morning break at the well for some.
      if (r() < 0.3 && !storm) {
        const brk = roll(9.5 * H, 10.5 * H);
        work(start, brk);
        push(brk, square(sim), "a breather at the well");
        work(brk + roll(10, 20), lunch);
      } else work(start, lunch);
      push(lunch, storm ? home : leisure(sim, p, r, false), storm ? "eating at home" : "on a break");
      work(lunchEnd, end);
      const outFor = d.festival ? 1 : storm ? 0 : wet ? 0.15 : p.cls === "serf" ? 0.2 : 0.45;
      if (r() < outFor) {
        push(end + roll(10, 40), d.festival ? square(sim) : leisure(sim, p, r, true), d.festival ? "at the festival" : "taking their ease");
        push(roll(21 * H, 22.5 * H), homeFront, "home for the night");
        push(sleepAt(22.5 * H, 23.5 * H), home, "asleep");
      } else {
        push(end + roll(5, 20), homeFront, "home from work");
        push(end + roll(40, 70), home, "at home");
        push(sleepAt(21 * H, 22.5 * H), home, "asleep");
      }
    }
  }
  // The festival: the evening in the square for everyone free to go.
  if (d.festival && p.job !== "slave" && p.job !== "guard" && !out.some((e) => e.doing === "at the festival")) {
    const at = roll(18 * H, 19 * H);
    const kept = out.filter((e) => e.at < at);
    const sleep = out.find((e) => e.at >= at && e.doing === "asleep");
    out.length = 0;
    out.push(...kept, { at, t: square(sim), doing: "at the festival" });
    out.push({ at: Math.max(at + 60, Math.min(1439, sleep?.at ?? 22 * H)), t: home, doing: "asleep" });
  }
  if (out.length === 0) out.push({ at: 0, t: home, doing: "at home" });
  return out;
}

function workDoing(job: Job): string {
  switch (job) {
    case "farmer":
      return "working the fields";
    case "labourer":
    case "porter":
      return "hauling loads";
    case "washer":
      return "washing linen";
    case "smith":
    case "apprentice":
      return "at the forge";
    case "stallholder":
    case "merchant":
      return "minding the stall";
    case "innkeeper":
    case "server":
      return "serving at the inn";
    case "guard":
    case "knight":
      return "on watch";
    case "priest":
    case "acolyte":
      return "tending the temple";
    case "clerk":
    case "scholar":
      return "at their books";
    case "courtier":
      return "at court";
    case "servant":
      return "about the household";
    case "slave":
      return "toiling";
    case "miner":
      return "down the mine";
    case "hunter":
      return "out hunting";
    case "adventurer":
      return "looking for work";
    case "baker":
      return "baking";
    case "weaver":
      return "at the loom";
    case "carpenter":
      return "sawing and planing";
    case "cobbler":
      return "mending shoes";
    case "tailor":
      return "stitching";
    case "potter":
      return "at the wheel";
    default:
      return "at work";
  }
}

// ---------- what they say ----------

/** What a lower-born calls someone above them. */
export function honorific(p: Pick<Townsperson, "cls" | "gender" | "job">, by: Pick<Townsperson, "cls">): string {
  const f = p.gender === "female";
  switch (p.cls) {
    case "royal":
      return "Your Highness";
    case "noble":
      return f ? "my lady" : "my lord";
    case "gentry":
      return f ? "madam" : "sir";
    case "clergy":
      return f ? "Mother" : "Father";
    case "merchant":
    case "artisan":
      return CLASS_RANK[by.cls] <= 1 ? (f ? "mistress" : "master") : f ? "goodwife" : "goodman";
    default:
      return "friend";
  }
}

const first = (name: string) => name.split(" ")[0]!;
/** "the Crown of Aldmar" → "Crown of Aldmar", for "your Crown of Aldmar friends". */
const bare = (name: string | null) => (name ?? "lot").replace(/^the /i, "");
/** "Crown of Aldmar" → "the Crown of Aldmar"; "the Ravens" stays. */
const the = (name: string | null) => `the ${bare(name)}`;

/** A pick from a list, by seed. */
const pickBy = <T>(list: readonly T[], seed: number): T => list[seed % list.length]!;

/**
 * Two lines for an exchange between `a` (who speaks first) and `b`. Code's words:
 * greetings up and down the pecking order, slaves and serfs among themselves,
 * faction grudges, gossip, the news, the weather and the hour.
 */
export function chatLines(roster: Pick<CrowdRoster, "place" | "lord" | "ruler" | "rivals" | "talk" | "laws"> & Partial<Pick<CrowdRoster, "scorn">>, a: Townsperson, b: Townsperson, d: CrowdDay, minute: number, seed: number): [string, string] {
  const ra = CLASS_RANK[a.cls];
  const rb = CLASS_RANK[b.cls];
  const s2 = Math.floor(seed / 7);
  const titleB = honorific(b, a);
  const lord = roster.lord ?? "the lord";
  const ruler = roster.ruler ?? "the crown";
  const rival = a.faction && b.faction && a.faction !== b.faction && roster.rivals.some(([x, y]) => (x === a.faction && y === b.faction) || (x === b.faction && y === a.faction));

  // A master and their own slave or servant.
  if (b.masterId === a.id || a.masterId === b.id) {
    const master = a.masterId === b.id ? b : a;
    const owned = master === a ? b : a;
    const word = master.gender === "female" ? "mistress" : "master";
    const order = pickBy(["Back to work.", "Fetch water, and be quick.", "I want the yard swept by noon.", "Don't let me catch you idling.", "Bring my cloak."], seed);
    const reply = pickBy([`Yes, ${word}.`, `At once, ${word}.`, `As you say, ${word}.`], s2);
    return master === a ? [order, reply] : [`${cap(word)}?`, owned.cls === "slave" ? "Did I say you could speak? Get on." : "Not now. Get on with it."];
  }

  // A grown-up and a child: no bowing to a noble's brat, just a word.
  if ((a.job === "child") !== (b.job === "child")) {
    const kid = a.job === "child" ? a : b;
    const adult = kid === a ? b : a;
    const young = kid.gender === "female" ? "young mistress" : "young master";
    const highKid = CLASS_RANK[kid.cls] >= 5 && CLASS_RANK[adult.cls] <= 3;
    if (kid === a) {
      return highKid
        ? [pickBy(["You there! Fetch my ball.", "My father owns this street.", "Bow when I pass."], seed), pickBy([`Yes, ${young}.`, `Of course, ${young}.`, "*bows stiffly*"], s2)]
        : [pickBy(["Mister, got a copper?", "Can I help carry that?", "Did you see the knight go by?", "Is it true there's a dragon?"], seed), pickBy(["Off with you.", "Not today, scamp.", "Maybe later.", "Ha! No dragons here."], s2)];
    }
    return highKid
      ? [pickBy([`Good day, ${young}.`, `Mind your step, ${young}.`], seed), pickBy(["Hmph.", "Out of my way.", "Do you know who my father is?"], s2)]
      : [pickBy(["Mind the carts, little one.", "Shouldn't you be at home?", "Run along now.", "Stop that racket!"], seed), pickBy(["Yes!", "Sorry!", "Can't catch me!", "I wasn't doing anything!"], s2)];
  }

  // Rival factions.
  if (rival && ra >= 2 && rb >= 2 && Math.abs(ra - rb) <= 3) {
    const lines: Array<[string, string]> = [
      [`Your ${bare(b.factionName)} friends are robbing this town blind.`, `Better than your ${bare(a.factionName)} lot, sucking it dry.`],
      [`Keep walking, ${bare(b.factionName)} scum.`, `Mind your tongue, or lose it.`],
      [`Heard what ${the(b.factionName)} did last week? Shameful.`, `Lies. ${cap(the(a.factionName))} spread them.`],
      [`*spits* ${bare(b.factionName)}.`, `Say that again. I dare you.`],
      [`There'll be a reckoning for ${the(b.factionName)} one day.`, `Not from the likes of you.`],
    ];
    return pickBy(lines, seed);
  }

  // One faction looking down on another.
  const scorns = a.faction && b.faction && a.faction !== b.faction ? (roster.scorn ?? []).find(([x, y]) => (x === a.faction && y === b.faction) || (x === b.faction && y === a.faction)) : undefined;
  if (scorns && Math.abs(ra - rb) <= 3 && ra >= 2 && rb >= 2 && r100(seed) < 60) {
    const haughty = scorns[0] === a.faction ? a : b;
    const low = haughty === a ? b : a;
    const lines: Array<[string, string]> = [
      [`${cap(the(low.factionName))} think they run this town.`, `Someone has to, while ${the(haughty.factionName)} sit on their hands.`],
      [`Still scraping by with ${the(low.factionName)}?`, `Better honest scraping than ${the(haughty.factionName)}'s airs.`],
      [`I wouldn't let ${the(low.factionName)} near my coin.`, `Nobody asked you to.`],
      [`${cap(the(low.factionName))}? Small folk with big ideas.`, `We'll see who's small when the dues come in.`],
    ];
    const pair = pickBy(lines, seed);
    return haughty === a ? pair : [pickBy([`Good day.`, `Fine weather.`, `Busy at the hall?`], s2), pickBy([`Hmph. ${cap(the(a.factionName))}.`, `I don't talk shop with ${the(a.factionName)}.`], seed)];
  }

  // Up and down the pecking order.
  if (rb - ra >= 3) {
    // a is far below b.
    if (b.cls === "royal") return [pickBy([`Your Highness!`, `Long live the crown!`, `Gods bless you, Your Highness.`], seed), pickBy(["Carry on.", "Hm.", "Make way, please.", "Thank you, good people."], s2)];
    if (a.cls === "slave") return [pickBy([`*bows low* ${cap(titleB)}.`, `Forgive me, ${titleB}.`, `*steps aside, eyes down*`], seed), b.cls === "clergy" ? pickBy(["The gods see you too, child.", "Bear it. The gods are watching.", "*makes a sign of blessing*"], s2) : pickBy(["Out of my way.", "Don't look at me.", "Filthy thing.", "Hm."], s2)];
    if (a.job === "beggar") return [pickBy([`Spare a copper, ${titleB}?`, `Alms, ${titleB}, for the love of the gods.`], seed), b.cls === "clergy" ? "Here, child. The gods keep you." : pickBy(["Begone.", "Get away from me.", "Ask the temple.", "*walks past*"], s2)];
    return [
      pickBy([`Good day, ${titleB}.`, `${cap(titleB)}. *bows*`, `Your servant, ${titleB}.`, `*tugs forelock* ${cap(titleB)}.`, `Fine morning, ${titleB}.`], seed),
      b.cls === "clergy"
        ? pickBy(["The gods keep you.", "Bless you, child.", "Come to the temple this week."], s2)
        : pickBy(["Mind your place.", "Hmph.", "Yes, yes.", "Carry on.", "Out of the way, you.", "Is the tithe paid this month?", "You smell of the midden. Stand back."], s2),
    ];
  }
  if (ra - rb >= 3) {
    // a is far above b: an order, or a word of scorn.
    return [
      pickBy(["You there. Out of my way.", "Stand aside.", "Is the road always this crowded with your sort?", "Fetch my steward.", "Look at me when I speak to you. No, don't."], seed),
      b.cls === "slave" ? pickBy([`Yes, ${titleFor(a)}.`, "*bows, says nothing*"], s2) : pickBy([`Yes, ${titleFor(a)}.`, `Begging your pardon, ${titleFor(a)}.`, `At once, ${titleFor(a)}.`], s2),
    ];
  }

  // Among slaves, serfs, nobles: their own talk.
  if (a.cls === "slave" && b.cls === "slave") {
    return pickBy<[string, string]>(
      [
        ["Keep your head down today.", "I always do. It's not enough."],
        ["They say the old master freed his slaves when he died.", "Stories. Don't let them hear you."],
        ["My back's raw.", "Mine too. Two more hours."],
        ["One day...", "Hush. Not here."],
        ["Did they feed you?", "Bread and water. Same as ever."],
      ],
      seed,
    );
  }
  if (a.cls === "serf" && b.cls === "serf") {
    return pickBy<[string, string]>(
      [
        [`${lord} wants three days' work on his fields again.`, "And when do we tend our own?"],
        ["The tithe's due Friday.", "Then we eat thin till spring."],
        ["My boy wants to leave for the city.", "He'll need the lord's leave. He won't get it."],
        ["Good soil this year.", "Good for him. We see little of it."],
      ],
      seed,
    );
  }
  if (ra >= 6 && rb >= 6) {
    return pickBy<[string, string]>(
      [
        [`Did you see what Lady ${first(a.name)} wore at court?`, "Positively provincial."],
        ["The commons grow insolent.", "A few hangings would settle them."],
        ["My steward robs me blind.", "They all do. Hang one, the rest behave."],
        [`${ruler} asked after you.`, "Did they now? Interesting."],
        ["Hunting tomorrow?", "If this weather holds."],
      ],
      seed,
    );
  }
  if (a.job === "child" && b.job === "child") {
    return pickBy<[string, string]>(
      [
        ["Tag! You're it!", "Not fair!"],
        ["Race you to the well!", "Go!"],
        ["I saw a knight today!", "Did not!"],
        ["My da says there's a dragon in the hills.", "Your da's a liar."],
      ],
      seed,
    );
  }
  if (a.job === "guard" && b.job !== "guard") return [pickBy(["Move along.", "Keep the way clear.", "Seen anything odd today?", "No trouble now."], seed), pickBy(["Yes, sir.", "Nothing, sir.", "Just going.", "Quiet as the grave."], s2)];
  if (b.cls === "clergy" && a.cls !== "clergy") return [pickBy([`Good day, ${titleB}.`, `Pray for me, ${titleB}.`], seed), pickBy(["The gods keep you.", "Come to prayers.", "Go in peace."], s2)];
  if (a.job === "beggar") return [pickBy(["Spare a copper?", "A crust, friend?"], seed), pickBy(["Sorry, friend.", "Here. Don't spend it on ale.", "Not today.", "I've nothing myself."], s2)];

  // Same faction.
  if (a.faction && a.faction === b.faction && r100(seed) < 40) {
    return pickBy<[string, string]>(
      [
        [`Meeting at ${the(a.factionName)} hall tonight?`, "Wouldn't miss it."],
        [`${cap(the(a.factionName))} looks after its own.`, "That it does."],
        ["Dues are up again.", "Worth every copper."],
      ],
      seed,
    );
  }

  // Grumbling about those above, when none are about.
  if (ra <= 3 && rb <= 3 && r100(seed) < 15) {
    return pickBy<[string, string]>(
      [
        [`${lord} raised the taxes again.`, "Of course he did. Someone's got to pay for his feasts."],
        ["The nobles don't know what bread costs.", "Or care."],
        [`They say ${ruler} wants more soldiers.`, "Then it's our sons again."],
        ["Saw a lady's carriage splash a child in the square.", "Didn't even stop, I'll wager."],
        ...(roster.laws.slavery ? ([["More slaves came in on the caravan.", "Poor devils. And less work for free folk."]] as Array<[string, string]>) : []),
      ],
      seed,
    );
  }

  // News, weather, the hour, the day.
  const news = roster.talk.length > 0 && r100(seed) < 35 ? roster.talk[s2 % roster.talk.length] : null;
  if (news) return [`Heard the news? ${news}`, pickBy(["Gods. What next?", "I heard it different.", "Can't be true.", "Bad times.", "Good riddance, I say."], seed)];
  if (d.weather === "rain" || d.weather === "storm") return pickBy<[string, string]>([["This rain won't quit.", "Good for the crops, they say."], ["Soaked to the bone.", "Inn's warm."]], seed);
  if (d.weather === "snow") return pickBy<[string, string]>([["Cold enough to freeze an ale.", "Then drink it faster."], ["Snow on the roofs again.", "Winter's long this year."]], seed);
  if (minute < 5 * H || minute >= 22 * H) return pickBy<[string, string]>([["Quiet night.", "Too quiet."], ["Cold out.", "Colder in the barracks."], ["You hear that?", "Just a cat. Probably."], ["Long watch.", "Dawn can't come soon enough."]], seed);
  if (minute >= 18 * H) return pickBy<[string, string]>([["Long day.", "They're all long."], ["One for the road?", "Just the one."], [`To ${roster.place}!`, `To ${roster.place}!`]], seed);
  return pickBy<[string, string]>(
    [
      ["Bread's gone up a copper.", "Everything has."],
      [`Morning, ${first(b.name)}.`, `Morning, ${first(a.name)}.`],
      ["How's the family?", "Growing. Eating."],
      ["Busy today.", "Market day, near enough."],
      ["Did you hear about the miller's daughter?", "Who hasn't!"],
      ["My knees ache. Rain coming.", "Your knees are always wrong."],
      ["Fine day.", "For now."],
      [`Seen ${pickBy(["the smith", "the baker", "old Tam", "the widow"], s2)} today?`, "Not since yesterday."],
    ],
    seed,
  );
}

const r100 = (seed: number) => (seed >>> 3) % 100;
const cap = (t: string) => t.replace(/^./, (c) => c.toUpperCase());

/** How someone lower addresses this person. */
function titleFor(p: Townsperson): string {
  return honorific(p, { cls: "commoner" });
}
