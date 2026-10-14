/**
 * The HTTP contract between the server (packages/server/src/web/server.ts) and the
 * browser client. The server builds `Snapshot` from game state; the client only reads it.
 */
import type { CrowdDay, CrowdZone } from "./crowd.js";
import type { GameEvent } from "./events.js";
import type { NpcVoice } from "./voice.js";

export type TileKind = "grass" | "path" | "water" | "tree" | "wall" | "door";

/** A way off the map's edge to the next area (N15): "To the mine road". */
export interface MapExit {
  x: number;
  y: number;
  label: string;
}

export interface MapBuilding {
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  /** What it is (N16): "house", "manor", "inn", "smithy", "hall", "temple", "market", "palace"... */
  kind?: string;
  /** The tile outside its door (N16). */
  front?: Pos;
}

export interface Pos {
  x: number;
  y: number;
}

export interface NpcView {
  id: string;
  name: string;
  role: string;
  species: string;
  age: number;
  ageStage: string;
  rank: string;
  rankXp: number;
  rankXpNext: number;
  potential: string;
  atPeak: boolean;
  readyToBreakThrough: boolean;
  growth: string;
  titles: string[];
  deathCause: string | null | undefined;
  gear: { weapon: string | null; armor: string | null };
  stock: { used: number; slots: number; storage: string | null };
  repairs: boolean;
  x: number;
  y: number;
  color: string;
  place: string | null;
  doing: string;
  absent: string | null;
  look: string;
  friendship: string;
  fear: number;
  respect: number;
  affection: number;
  knowsYouAs: string | null;
  grudge: string | null;
  feeling: string | null;
  needs: Record<string, number>;
  makes: string[];
  commission: { item: string; status: string; late: boolean; balance: number } | null;
  loan: number | null;
  kept: boolean;
  services: Array<{ kind: string; price: number | undefined }>;
  hp: number;
  maxHp: number;
  mood: string;
  trust: number;
  dead: boolean;
  away: boolean;
  inCombat: boolean;
  busy: string | null;
  wares: Array<{ item: string; qty: number; price: number | null; reason: string | null | undefined }>;
  teaches: Array<{ skill: string; upTo: string; feePerHour: number; locked: string | null }>;
  pending: {
    quest: { title: string; tier: string; goal: string; qty: number; money: number } | null;
    training: { skill: string; hours: number; cost: number } | null;
    purchase: { item: string; price: number } | null;
    offer: { item: string; price: number } | null;
    favour: { kind: string; amount?: number; item?: string } | null;
    service: { kind: string; price: number } | null;
    amends: { fine: number } | null;
  };
  questCount: number;
  unconscious: boolean;
  statuses: string | null;
  health: string[];
  companion: { wage: number; loyalty: number; unpaidDays: number } | null;
  hire: number | null;
  factionView: string | null;
  arcs: string[];
  plan: string[] | null;
  revenge: string | null;
  dilemma: { offer: string; options: Array<{ id: string; label: string }> } | null;
  pendingHire: { wage: number } | null;
  pendingCommission: string | null;
  guard: boolean;
  /** How this NPC sounds (T14). */
  voice: NpcVoice;
  /** A child (design rule 7): never romance, never attacked. */
  minor: boolean;
  /** Their family in words (N11.3), or null. */
  family: string | null;
  /** The player may ask them to marry (romance on, open to it, together, both unmarried). */
  canPropose: boolean;
}

export interface CreatureView {
  uid: string;
  name: string;
  kind: string;
  x: number;
  y: number;
  color: string;
  hp: number;
  maxHp: number;
  rank: string;
  age: number;
  growth: string;
  titles: string[];
  aggressive: boolean;
  engaged: boolean;
}

export interface PlayerView {
  name: string;
  money: number;
  hp: number;
  maxHp: number;
  level: number;
  rank: string;
  titles: string[];
  xp: number;
  xpNext: number;
  gear: Record<string, { item: string; broken: boolean; repairCost: number } | null>;
  fightingWith: string;
  armorValue: number;
  gearTier: string;
  pack: { used: number; slots: number };
  items: Array<{ item: string; qty: number; slot: string | null; needs: string | null; repairCost: number }>;
  attributes: Record<string, number>;
  inventory: Record<string, number>;
  skills: Array<{ skill: string; level: number; tier: string; progress: number; needed: number }>;
  quests: Array<{ title: string; tier: string; giver: string; item: string; qty: number; have: number; money: number }>;
  completed: number;
  journal: Array<{ who: string; lines: string[] }>;
  look: string;
  place: string | null;
  mp: number;
  maxMp: number;
  attributePoints: number;
  abilities: Array<{ id: string; name: string; mp: number; describe: string }>;
  statuses: string | null;
  health: string[];
  reputation: { trust: number; fear: number; respect: number; affection: number; words: string | null };
  bounty: number;
  crimes: string[];
  factions: Array<{ id: string; name: string; standing: number; rank: string; member: boolean }>;
  failed: number;
  party: string[];
}

/** The wider realm (N13): kingdoms, settlements, factions, treaties, wars, dungeons, beasts and news. */
export interface RealmView {
  day: number;
  size: { w: number; h: number };
  kingdoms: Array<{ id: string; name: string; color: string; ruler: string | null; capital: string; weariness: number }>;
  settlements: Array<{
    id: string;
    name: string;
    kind: string;
    kingdom: string | null;
    liege: string | null;
    x: number;
    y: number;
    population: number;
    prosperity: number;
    food: number;
    treasury: number;
    leader: string | null;
    buildings: Record<string, number>;
    project: string | null;
    roads: string[];
    /** The player is here. */
    here: boolean;
    abandoned: boolean;
    atWar: boolean;
    raided: boolean;
    arrears: number;
    taxRate: number;
  }>;
  factions: Array<{ id: string; name: string; kind: string; creed: string; leader: string | null; members: string[]; size: number; branches: string[]; wealth: number; parent: string | null; founded: number }>;
  treaties: Array<{ kind: string; a: string; b: string; until: number; why: string }>;
  wars: Array<{ attackers: string[]; defenders: string[]; cause: string; start: number; score: number; battles: number; end: number | null; outcome: string | null }>;
  dungeons: Array<{ id: string; name: string; near: string; x: number; y: number; tier: string; depth: number; danger: number; bounty: number; cleared: boolean }>;
  packs: Array<{ species: string; near: string; count: number; cap: number; alpha: string | null; bounty: number }>;
  notables: Array<{ name: string; role: string; rank: string; renown: number; home: string | null; faction: string | null; superior: string | null; deeds: string[]; talks: boolean; rose: boolean }>;
  news: Array<{ day: number; text: string; importance: number; heard: boolean }>;
  director: Array<{ day: number; kind: string; target: string; reason: string; ok: boolean }>;
  stats: Record<string, number>;
}

/** A news item: something that happened outside a request (the combat clock, the chronicle). */
export type NewsItem = StreamEvent & { id: number; npc?: string };

/** A walk to a place, in tiles and in words. */
export interface RoadLeg {
  id: string;
  name: string;
  tiles: number;
  walk: string;
}

/** Something to stop for on the road (N26): a situation waiting for a choice. */
export interface SituationView {
  id: string;
  title: string;
  text: string;
  choices: Array<{ id: string; label: string; hint?: string }>;
}

/** The player's supplies on the road (N26 D1): 0 is none, 100 is full. */
export interface RoadNeedsView {
  food: number;
  water: number;
  rest: number;
  /** "hungry", "parched"... or null when all is well. */
  words: string | null;
}

/** A horse or a cart (N26 D2). */
export interface MountView {
  kind: string;
  name: string;
  fitness: number;
  fed: number;
  lame: boolean;
  /** Pace as a multiple of walking. */
  speed: number;
}

/** What is beside the road within reach: a place to use (E), with its kind and a line of what it offers. */
export interface RoadNearby {
  id: string;
  kind: string;
  name: string;
  x: number;
  y: number;
  /** What can be done here (E, or the buttons under the map): `op` goes to the server, `label` is what the button says. */
  offers: Array<{ op: string; label: string }>;
}

/** The player on the open road (N26): where, how far, what is near. The land itself is made in the browser from GET /api/road/data. */
export interface RoadView {
  where: string;
  off: number | null;
  ends: RoadLeg[];
  dest: RoadLeg | null;
  inn: { id: string; name: string; tiles: number } | null;
  ground: string;
  /** This stretch has been walked end to end before (fast travel runs on it). */
  walked: boolean;
  /** Fast travel to the destination is on offer (the whole way has been walked). */
  canFast: boolean;
  needs: RoadNeedsView | null;
  mount: MountView | null;
  pending: SituationView | null;
  nearby: RoadNearby[];
  /** Road steps in one game minute. */
  stepsPerMinute: number;
  /** Game minutes of daylight left to walk today (a walker rests at night), or null at night. */
  lightLeft: number | null;
}

/** Something a townsperson of the player's place just passed on (N33): a bubble over their head, once (`seq` never repeats). */
export interface GossipTold {
  seq: number;
  /** The speaker's person id (a roster id). */
  who: string;
  /** What they said, in words: "Wenna Tanner died of an illness". */
  text: string;
}

export interface Snapshot {
  llm: { ready: boolean; error: string };
  /** The map the player is on: a village, or one of the localities around it (N15). Walk onto an exit to go there. */
  map: { id: string; name: string; w: number; h: number; tiles: TileKind[][]; buildings: MapBuilding[]; talkRange: number; exits: MapExit[]; zones: CrowdZone[] };
  /**
   * The townsfolk on this map (N16), or null where there are none (the localities, a world
   * without a realm). Who they are is GET /api/crowd (CrowdRoster, fetched once per map);
   * where they are is worked out from it and the clock (crowd.ts), with today's conditions here.
   */
  crowd: { map: string; count: number; day: CrowdDay; told?: GossipTold[] } | null;
  /** N16: real seconds per game minute while the player stands about (POST /api/tick), or 0 when time waits for the player. */
  timeFlowSeconds: number;
  /**
   * Where the player is (N14), and the places the roads lead to from here; `area` is
   * where around it (N15): its village or a locality, and the ways on from there.
   */
  site: {
    id: string;
    name: string;
    kind: string;
    kingdom: string | null;
    destinations: Array<{ id: string; name: string; kind: string; hours: number; dangers: string[] }>;
    area: { id: string; name: string; exits: string[] };
  };
  time: {
    text: string;
    day: number;
    hour: number;
    minute: number;
    timeOfDay: string;
    today: string;
    weather: string;
    season: string;
    events: string[];
    daysPerYear: number;
  };
  position: Pos;
  /** On the open road between places (N26), or null. While it is set, `position` is a global tile and `map` is a stand-in. */
  road: RoadView | null;
  player: PlayerView;
  chronicle: { lore: string[]; log: Array<{ day: number; kind: string; ok: boolean; reason: string; proposal: string; event?: string }> };
  /** Marriages, courtships, children on the way and children born in play (N11.3), in words. */
  family: string[];
  /** The wider realm (N13) in brief, or null in worlds without one; the whole of it is GET /api/realm (RealmView). */
  realm: { day: number; latest: string | null; wars: number } | null;
  /**
   * The player's guild membership and the dungeons in reach (N13.6). One is delved
   * from its mouth (N15): `here` when the player stands there, else `mouth` says where it is.
   */
  adventurer: {
    member: boolean;
    fee: number;
    renown: number;
    rank: string | null;
    dungeons: Array<{ id: string; name: string; tier: string; depth: number; danger: number; cleared: boolean; bounty: number; here: boolean; mouth: string }>;
  };
  npcs: NpcView[];
  creatures: CreatureView[];
  engaged: string | null;
  fight: { secondsLeft: number; tick: number } | null;
  news: NewsItem[];
  /** Requests waiting in the server's queue, not counting the one running. */
  queue: number;
}

/** Note colours in the chat log. */
export type NoteKind = "roll" | "combat" | "fail" | "quest" | "action" | "end" | "system";

/** One line of the `POST /api/act` stream. */
export type StreamEvent =
  | { t: "text"; npc: string; delta: string }
  | { t: "note"; kind: NoteKind | string; text: string; npc?: string }
  | { t: "system"; text: string; npc?: string }
  | { t: "error"; text: string }
  | { t: "ended"; npc: string; text: string }
  | { t: "opened"; npc: string }
  | { t: "quote"; kind: string; ok: boolean; text: string; item?: string }
  /** No first word from the model yet: a canned line to fill the wait (G2 timeout budget). */
  | { t: "filler"; npc: string; text: string }
  /** The request is waiting behind others in the server's queue. */
  | { t: "queued"; position: number }
  /** Something that happened, for the screen to animate (T13). */
  | { t: "event"; event: GameEvent }
  | { t: "done"; state: Snapshot };

/** Response of `POST /api/tick` (N16): a minute passes while the player stands about. */
export interface TickResponse {
  ok: boolean;
  log: string[];
  events: GameEvent[];
  state: Snapshot;
}

/** Response of `POST /api/move`. */
export interface MoveResponse {
  ok: boolean;
  log: string[];
  reason?: string;
  events: GameEvent[];
  state: Snapshot;
}
