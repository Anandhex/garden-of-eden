/**
 * What the view layer (G5) needs from the game server: the game's state as a snapshot, and the calls that change
 * it (act, move, tick), each through the server's one queue. server.ts builds this; nothing in
 * view/ reaches into the game any other way, and nothing in view/ changes the game except through these calls.
 */
import type { CrowdDay, CrowdSim, GameEvent, Journey, RealmView, RoadData, Snapshot, StreamEvent } from "@millbrook/shared";
import type { landOf } from "../game/road/ground.js";

export type Land = ReturnType<typeof landOf>;

export interface ViewHost {
  /** The game as the client sees it (the same as GET /api/state). */
  snapshot(): Snapshot;
  /** An action (`{ action, npc, ...args }`), streamed; ends with `done` carrying the new snapshot. Through the queue. */
  act(body: Record<string, unknown>, emit: (ev: StreamEvent) => void): Promise<void>;
  /** One step. Through the queue. */
  move(dx: number, dy: number): Promise<{ ok: boolean; log: string[]; reason?: string; events: GameEvent[]; state: Snapshot }>;
  /** A game minute passes while the player stands about, or null when it can't now (a fight, paused, busy). */
  tick(): Promise<{ log: string[]; events: GameEvent[]; state: Snapshot } | null>;
  /** Start a new game (overwrites the save), with the seed and start town chosen on the new-game screen (N39). Through the queue. */
  newGame(opts?: { seed?: number; start?: string }): Promise<void>;
  /** The towns a new game could begin in (N39): a fresh seed and a few of its startable towns, each with a line. */
  startChoices?(): { seed: number; choices: Array<{ id: string; name: string; line: string }> } | null;
  /** The townsfolk of the map the player is on, or null. */
  crowd(): CrowdSim | null;
  /** The land between places (N26), or null in a world without a realm. */
  land(): Land | null;
  roadData(): RoadData | null;
  /** The fields in a rectangle of the road world (N26G): each plot tile's stage (0..7 growing, 10+ a mark), keyed "x,y". */
  fieldStages?(x0: number, y0: number, w: number, h: number): Map<string, number>;
  /** The marks on the place the player is in (N31): burned houses, scaffolding, graves, banners, empty stalls. */
  marks?(): import("@millbrook/shared/view").Mark[];
  /** The journeys within `radius` tiles of the player on the road now. */
  journeysNear(radius: number): Journey[];
  /** People walking to work along the road near the player (N26F decision 12): miners, hunters, the ore cart, the watch. */
  commuters?(radius: number): Array<{ id: string; x: number; y: number; name: string; role: string; kind: string; purpose: string; from: string; to: string; journey: string }>;
  /** A settlement's name by id. */
  placeName(id: string): string;
  realm(): RealmView | null;
  quoteTraining(npc: string, skill: string, hours: number): { ok: boolean; message: string; hours: number; money: number };
  quoteCoach(to: string): { ok: boolean; message: string; price: number };
  /** Try to reach the model again (it may have started after the server). */
  checkLlm(): Promise<void>;
  /** The admin view has stopped the clock (N17). */
  paused(): boolean;
  /** Something is running or waiting in the queue. */
  busy(): boolean;
  /** Real seconds per game minute while the player stands about (0: time waits). */
  timeFlowSeconds: number;
  saveFile: string;
  /** A hash of the saved world, for VIEW_CHECK=1 (the view must never change it). */
  worldHash(): string;
  /** Called when the combat clock (or other background work) adds news. */
  onNews(fn: () => void): void;
}

export type { CrowdDay };
