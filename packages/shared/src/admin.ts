import type { CrowdDay, CrowdMap, CrowdRoster, SocialClass } from "./crowd.js";
import type { RealmView } from "./protocol.js";

/**
 * The admin world view (N17, `/admin`): shapes sent by `GET /api/admin/*`. The admin
 * view shows the truth (what really happened), not what the player knows, and
 * changes nothing except the clock (`POST /api/admin/time`).
 *
 * People are named by **refs**, one string for any kind of person:
 * `player`, `cast:<persona id>`, `figure:<figure id>`, `town:<townsperson id>`,
 * `beast:<creature uid>`, and `place:<settlement id>` for a place.
 */

export type AdminSource = "game" | "realm" | "director";

/** One row in the admin event stream: any of the three kinds of event, made alike. */
export interface AdminEvent {
  /** "e:<GameEvent.id>", "n:<RealmNews.id>", "d:<day>:<kind>:<target>" (a push) or "l:<n>" (the director's log). */
  ref: string;
  day: number;
  hour: number;
  source: AdminSource;
  /** GameEvent.kind, RealmNews.kind or the push's kind. */
  kind: string;
  /** What happened: details, the news text, or the push's reason. */
  text: string;
  /** 1..10. */
  importance: number;
  /** The settlement it happened in, where known. */
  site: string | null;
  /** Person refs involved. */
  people: string[];
  /** Faction ids involved. */
  factions: string[];
  /** The reason behind it: the director's reason, a war's cause, an NPC's choice (N38 later). */
  why: string | null;
  /** The events that caused it (empty until N20). */
  causedBy: string[];
  /** Where it sits in the stream, for the cursor: "day:hour:rank:n". */
  at: string;
}

export interface AdminEventQuery {
  site?: string;
  faction?: string;
  person?: string;
  kind?: string;
  minImportance?: number;
  source?: AdminSource;
  /** A cursor from an earlier page: only rows after it. */
  after?: string;
  limit?: number;
}

export interface AdminEventsPage {
  /** Newest first. */
  events: AdminEvent[];
  /** The newest row's cursor in the whole stream (not just this page): pass it as `after` to poll. */
  cursor: string | null;
  /** How many rows matched before `limit`. */
  matched: number;
  /** Names for the refs in these rows (people, and `place:<id>` for sites). */
  names: Record<string, string>;
}

export interface AdminClock {
  day: number;
  hour: number;
  minute: number;
  paused: boolean;
}

/** Where things are on the realm map beyond the places themselves. */
export interface AdminMapLayer {
  packs: Array<{ id: string; species: string; count: number; near: string; x: number; y: number }>;
  /** A war, drawn as a line between the warring sides' seats. */
  fronts: Array<{ attackers: string; defenders: string; cause: string; score: number; from: { x: number; y: number }; to: { x: number; y: number } }>;
  /** Caravans on the road: empty until they are real journeys (N26). */
  caravans: Array<{ from: string; to: string; x: number; y: number }>;
  /** What the map can't show yet, for the legend. */
  missing: string[];
}

export type ClassCounts = Partial<Record<SocialClass, number>>;

export interface AdminOverview {
  clock: AdminClock;
  realm: RealmView | null;
  layer: AdminMapLayer;
  totals: { kingdoms: number; settlements: number; population: number; figuresAlive: number; figuresDead: number; factions: number; wars: number; treaties: number };
  /** People by class for the settlements worked out so far (a few more with each request); the rest come with the place card. */
  classes: Record<string, ClassCounts>;
  classesPending: number;
  /** `describeRealm`: the lines `npm run sim:realm` prints. */
  summary: string[];
}

export interface AdminTiming {
  last: number;
  p50: number;
  p95: number;
  count: number;
}

/** One tick budget against what was measured. `status`: ok (under 75%), warn (under 100%), over, idle (not measured yet). */
export interface AdminBudgetRow {
  name: string;
  label: string;
  budgetMs: number;
  p95Ms: number | null;
  ratio: number | null;
  status: "ok" | "warn" | "over" | "idle";
}

/** One kind of model call today. `cap` is null when the kind has none (talking). */
export interface AdminModelKind {
  kind: string;
  callsToday: number;
  cap: number | null;
  avgMs: number;
  droppedToday: number;
  droppedTotal: number;
  tokensIn: number;
  tokensOut: number;
}

export interface AdminBudgets {
  tick: AdminBudgetRow[];
  model: AdminModelKind[];
  queue: { length: number; estimatedWaitMs: number; maxWaitMs: number; running: string | null; dropped: number };
  /** Median and worst player first-token times, ms (null: no talk yet), against the target. */
  talk: { firstTokenMs: { last: number; worst: number } | null; targetMs: number };
  /** The browser's side, which only the browser can measure: `?fps=1`. */
  frame: { capitalCrowdMs: number; capitalMinuteMs: number; targetFps: number };
}

export interface AdminHealth {
  clock: AdminClock;
  /** Milliseconds per call, by step name (the last 200 calls). */
  tickMs: Record<string, AdminTiming>;
  counts: Record<string, number>;
  /** `realm.stats`: what has happened, by kind. */
  stats: Record<string, number>;
  /** N19: each budget and how close it is. */
  budgets: AdminBudgets;
  /** The numbers `npm run sim:realm` prints. */
  summary: string[];
}

export type AdminCardKind = "cast" | "figure" | "townsperson" | "beast" | "player" | "place";

/** A group of facts on a card. `rows` are [label, value, ref?]: a ref makes the value a link. */
export type AdminSection = { title: string; rows: Array<[string, string, string?]> } | { title: string; unavailable: string };

/** One hour of a townsperson's day. */
export interface AdminHour {
  hour: number;
  doing: string;
  x: number;
  y: number;
  visible: boolean;
  /** The building they're in when indoors. */
  inside: string | null;
}

export interface AdminCard {
  ref: string;
  kind: AdminCardKind;
  name: string;
  subtitle: string;
  alive: boolean;
  /** The settlement they're in, if they are anywhere in particular. */
  site: string | null;
  siteName: string | null;
  /** What they're doing now, in words. */
  doing: string;
  sections: AdminSection[];
  /** A townsperson's day, hour by hour: no simulation, worked out from the roster, the map and the clock. */
  day?: AdminHour[];
  /** Roster facts can shift until storage freezes them (N18): "rolled on day N". */
  rolledOn?: number;
  /** Where to draw them: their settlement's map, with this townsperson picked out (`id` is empty for the talking cast, whose spots are the live game's). */
  follow?: { site: string; id: string };
}

export interface AdminSearchHit {
  ref: string;
  kind: AdminCardKind;
  name: string;
  detail: string;
  site: string | null;
}

export interface AdminSearchResult {
  hits: AdminSearchHit[];
  /** False while the townsfolk of some places are still being listed: ask again. */
  complete: boolean;
  /** Settlements listed so far / in all. */
  indexed: number;
  places: number;
}

/** One rumour about the player, and who has heard it. */
export interface AdminBelief {
  key: string;
  text: string;
  truth: string;
  firstHeard: number;
  holders: Array<{ ref: string; name: string; accuracy: number; heardFrom: string | null; day: number }>;
}

/** What one NPC makes of the player. */
export interface AdminOpinion {
  ref: string;
  name: string;
  trust: number;
  fear: number;
  respect: number;
  affection: number;
  grudge: string | null;
  goals: string[];
  /** What is owed between them and the player: favours, a loan. */
  owes: string[];
  rumours: Array<{ key: string; text: string; accuracy: number }>;
}

export interface AdminPlayerView {
  name: string;
  money: number;
  bounty: number;
  reputation: { trust: number; fear: number; respect: number; affection: number } | null;
  standing: Record<string, number>;
  opinions: AdminOpinion[];
  beliefs: AdminBelief[];
}

export interface AdminPinned {
  cards: AdminCard[];
  /** Refs that no longer lead anywhere. */
  missing: string[];
  player: AdminPlayerView | null;
}

/** The crowd of one settlement, for drawing it: the map, the people and the clock to place them by. */
export interface AdminCrowd {
  site: string;
  name: string;
  map: CrowdMap;
  roster: CrowdRoster;
  day: CrowdDay;
  clock: AdminClock;
}

export type AdminTimeAction = "pause" | "resume" | "step-hour" | "step-day" | "fast";

export interface AdminTimeRequest {
  action: AdminTimeAction;
  /** For "fast": how many days (up to 30). */
  days?: number;
}

export interface AdminTimeResponse {
  ok: boolean;
  message: string;
  clock: AdminClock;
  /** Days or hours that actually passed. */
  advanced: number;
}

// ---------- cursors ----------

/** A row's place in the stream: "day:hour:rank:n". Rows are ordered by these four numbers. */
export function atKey(day: number, hour: number, rank: number, n: number): string {
  return `${day}:${hour}:${rank}:${n}`;
}

/** Negative if `a` is earlier in the stream than `b`, positive if later, 0 if the same place. */
export function compareAt(a: string, b: string): number {
  const x = a.split(":").map(Number);
  const y = b.split(":").map(Number);
  for (let i = 0; i < 4; i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}
